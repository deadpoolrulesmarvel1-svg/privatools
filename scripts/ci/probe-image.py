#!/usr/bin/env python3
"""Boot a built PrivaTools image the way production does, then probe it over HTTP.

    python3 scripts/ci/probe-image.py IMAGE
    python3 scripts/ci/probe-image.py --running CONTAINER --url BASE_URL --sha BUILD_SHA

The second form runs the same checks against a container that is already
running and starts, stops and removes nothing. The zero-downtime deploy
(deploy/oracle-vm/rollout.sh) uses it as its real-page probe: a release whose
/readyz is ready but which cannot serve the homepage, a tool page or the
sitemap never receives traffic.

The container comes from the repository's docker-compose.yml, started with the
deploy script's own command (`docker compose up -d --no-build --pull never`).
The read-only root, the /tmp tmpfs, both named volumes, the dropped
capabilities, the resource limits and the environment are therefore
production's by construction, not a copy of its flags that can drift. Every
variable the compose file interpolates is cleared and no .env file is read, so
Clerk and analytics stay in their documented unconfigured mode wherever this
runs, and no secret is needed.

The checks are the ones a broken image fails first: readiness reporting the
build revision (the deploy gate's own test), a real 404, the tool count the
homepage advertises, server-rendered tool pages and the sitemap. Expected
values come from the tool manifest inside the container, read as the app user
reads it, never from literals here.

It uses its own compose project, so it cannot touch a deployment's containers
or volumes, but it does publish the compose file's port. To run it beside
something already on that port, add a file with a `ports: !override` entry
through COMPOSE_FILE; the probe follows whichever port compose reports.

Standard library only. Exits 0 when every check passes and 1 otherwise, after
printing the container's logs. The container, its network and its volumes are
removed either way.
"""
from __future__ import annotations

import html
import json
import os
import re
import secrets
import signal
import subprocess
import sys
import time
from collections.abc import Callable
from http.client import HTTPException
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from xml.etree import ElementTree

USAGE = ("usage: python3 scripts/ci/probe-image.py IMAGE\n"
         "       python3 scripts/ci/probe-image.py --running CONTAINER --url BASE_URL --sha BUILD_SHA")
REPO_ROOT = Path(__file__).resolve().parents[2]
COMPOSE_YAML = REPO_ROOT / "docker-compose.yml"
PROJECT = "privatools-probe"
SERVICE = "privatools"
CONTAINER_PORT = "8000"
# The file seo_meta reads. Production leaves FRONTEND_PATH unset.
MANIFEST_IN_IMAGE = "/app/frontend/dist/tool-content.json"

# A healthy image is ready within seconds; the deadline only bounds a hang.
# Uvicorn restarts workers that die on import, so a broken app does not exit.
READY_DEADLINE_SECONDS = 60
POLL_TIMEOUT_SECONDS = 3
REQUEST_TIMEOUT_SECONDS = 10
LOG_TAIL_LINES = 200

# One PDF tool and one non-PDF tool, which are served from different
# registries under different route prefixes.
TOOL_PAGES = ("/tool/merge-pdf", "/tools/image-compressor")
UNKNOWN_TOOL_PAGE = "/tool/this-slug-does-not-exist"
# A floor, not the tool total: the total comes from the manifest, and the
# sitemap must also list every tool the manifest does.
SITEMAP_FLOOR = 200
SITEMAP_NS = "{http://www.sitemaps.org/schemas/sitemap/0.9}"

# URLError and socket timeouts are OSErrors too.
NETWORK_ERRORS = (OSError, HTTPException)


class ProbeFailure(Exception):
    """The container did not start or never became ready, so nothing was checked."""


class CheckFailed(Exception):
    """An assertion about the running container did not hold."""


def expect(condition: object, message: str) -> None:
    if not condition:
        raise CheckFailed(message)


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


_opener = build_opener(_NoRedirect)


def run(*args: str, timeout: int = 60) -> subprocess.CompletedProcess:
    return subprocess.run(args, cwd=REPO_ROOT, timeout=timeout, capture_output=True, text=True, errors="replace")


def compose(*args: str, timeout: int = 60) -> subprocess.CompletedProcess:
    # An empty env file, so a local .env cannot configure the container.
    return run("docker", "compose", "--project-name", PROJECT, "--env-file", os.devnull, *args, timeout=timeout)


def output_of(result: subprocess.CompletedProcess) -> str:
    return (result.stdout + result.stderr).strip()


def isolate_environment(image: str, build_sha: str) -> None:
    """Clear what the compose file reads, so its defaults apply, then set what the deploy passes.

    Async jobs are on, as in production: the image's job supervisor must take
    the queue here before any release is tagged. The first deploy after the
    zero-downtime cut-over can only hand it the queue after traffic has moved.
    """
    for name in set(re.findall(r"\$\{(\w+)", COMPOSE_YAML.read_text(encoding="utf-8"))):
        os.environ.pop(name, None)
    os.environ.update(PRIVATOOLS_IMAGE=image, GIT_SHA=build_sha, API_V1_JOBS_ENABLED="true")


def request_headers() -> dict[str, str]:
    """The deploy's probe (rollout.sh) sets PRIVATOOLS_PROBE_HOST to the public
    site's name, the Host nginx forwards, so a release whose TRUSTED_HOSTS
    rejects it fails here rather than after traffic moved. Unset in CI."""
    headers = {"User-Agent": "privatools-image-probe"}
    host = os.environ.get("PRIVATOOLS_PROBE_HOST", "").strip()
    if host:
        headers["Host"] = host
    return headers


def fetch(base_url: str, path: str, timeout: float = REQUEST_TIMEOUT_SECONDS) -> tuple[int, bytes]:
    """Status and body, without following redirects or raising on 4xx and 5xx."""
    request = Request(base_url + path, headers=request_headers())
    try:
        with _opener.open(request, timeout=timeout) as response:
            return response.status, response.read()
    except HTTPError as error:
        return error.code, error.read()


def container_id() -> str:
    listed = compose("ps", "--all", "--quiet", SERVICE)
    ids = listed.stdout.split() if listed.returncode == 0 else []
    return ids[0] if ids else ""


def published_url() -> str:
    published = compose("port", SERVICE, CONTAINER_PORT)
    words = published.stdout.split() if published.returncode == 0 else []
    host, _, port = (words[0] if words else "").rpartition(":")
    if not port.isdigit():
        raise ProbeFailure(f"port {CONTAINER_PORT} is not published: {output_of(published)}")
    return f"http://{'127.0.0.1' if host in ('', '0.0.0.0', '[::]') else host}:{port}"


def gave_up(container: str) -> str | None:
    """Why waiting is pointless, once the container's main process has died."""
    inspected = run("docker", "inspect", "--format", "{{.State.Status}} {{.RestartCount}}", container)
    if inspected.returncode != 0:
        return "the container no longer exists"
    status, _, restarts = inspected.stdout.strip().partition(" ")
    if status in ("exited", "dead"):
        return f"the container stopped ({status})"
    if restarts.isdigit() and int(restarts) > 0:
        return f"the container restarted {restarts} time(s)"
    return None


def wait_until_ready(base_url: str, container: str) -> float:
    started = time.monotonic()
    last = "no answer"
    while time.monotonic() - started < READY_DEADLINE_SECONDS:
        try:
            status, body = fetch(base_url, "/readyz", POLL_TIMEOUT_SECONDS)
            if status == 200:
                return time.monotonic() - started
            last = f"HTTP {status} {body[:300].decode('utf-8', 'replace')}"
        except NETWORK_ERRORS as error:
            last = str(getattr(error, "reason", error))
        reason = gave_up(container)
        if reason:
            raise ProbeFailure(f"{reason} before /readyz answered 200 (last: {last})")
        time.sleep(1)
    raise ProbeFailure(f"/readyz did not answer 200 within {READY_DEADLINE_SECONDS} s (last: {last})")


def read_manifest(container: str) -> dict[str, dict]:
    """The tool manifest the server reads, read as the app user reads it, keyed by path."""
    shown = run("docker", "exec", container, "cat", MANIFEST_IN_IMAGE)
    expect(shown.returncode == 0, f"cannot read {MANIFEST_IN_IMAGE}: {output_of(shown)}")
    try:
        rows = json.loads(shown.stdout)
    except ValueError as error:
        raise CheckFailed(f"{MANIFEST_IN_IMAGE} is not JSON: {error}") from error
    expect(isinstance(rows, list) and rows and all(isinstance(row, dict) and row.get("path") for row in rows),
           f"{MANIFEST_IN_IMAGE} does not list tools with a path")
    return {row["path"]: row for row in rows}


def check_readyz(base_url: str, build_sha: str) -> str:
    status, body = fetch(base_url, "/readyz")
    expect(status == 200, f"HTTP {status}")
    payload = json.loads(body)
    expect(payload.get("status") == "ready", f"status is {payload.get('status')!r}")
    checks = payload.get("checks") or {}
    failing = sorted(name for name, ok in checks.items() if not ok)
    expect(not failing, "failing dependency checks: " + ", ".join(failing))
    # The deploy gate rolls back unless this matches, so prove it is plumbed.
    expect(payload.get("build_sha") == build_sha, f"build_sha is {payload.get('build_sha')!r}, expected {build_sha!r}")
    return f"ready, {len(checks)} dependency checks pass, build_sha matches"


def check_supervisor_status(status: dict) -> str:
    """The async job supervisor took the singleton lock and keeps its state fresh."""
    expect(status.get("enabled"), "async jobs are not enabled in the container")
    local = status.get("local") or {}
    expect(local.get("role") == "active" and local.get("alive"),
           f"the job supervisor does not hold the queue (role {local.get('role')!r}, alive {local.get('alive')!r})")
    return "the job supervisor holds the job queue"


def check_supervisor(container: str) -> str:
    shown = run("docker", "exec", container, "python", "-m", "backend.app.job_handover", "--status")
    expect(shown.returncode == 0, f"no job status: {output_of(shown)}")
    deadline = time.monotonic() + READY_DEADLINE_SECONDS
    while True:
        try:
            return check_supervisor_status(json.loads(shown.stdout))
        except (CheckFailed, ValueError):
            if time.monotonic() >= deadline:
                raise
        time.sleep(1)
        shown = run("docker", "exec", container, "python", "-m", "backend.app.job_handover", "--status")


def check_unknown_tool(base_url: str) -> str:
    status, _ = fetch(base_url, UNKNOWN_TOOL_PAGE)
    expect(status == 404, f"HTTP {status}, expected 404")
    return "HTTP 404"


def check_homepage(base_url: str, tool_count: int) -> str:
    status, body = fetch(base_url, "/")
    expect(status == 200, f"HTTP {status}")
    expect(tool_count > 0, "the manifest lists no tools")
    # "N tools" and "N free, open-source file tools" both count; the bare
    # number somewhere else on the page does not.
    advertised = re.search(
        rf"(?<!\d){tool_count}(?!\d)(?:\s+[\w,-]+){{0,4}}?\s+tools\b", body.decode("utf-8", "replace"))
    expect(advertised, f"the page does not advertise the manifest's {tool_count} tools")
    return f"advertises {advertised.group(0)!r}"


def tool_headings(row: dict) -> list[str]:
    """The server-rendered H1s a release may give this tool, current first.

    seo_meta's `_tool_page_body` renders the page's heading: the tool's name,
    then its one-line promise (the manifest `description`) after a colon. Up to
    v2.7.14 it rendered the search title (`seoTitle`, else the name). This probe
    runs from the deploy checkout, which can be newer than a container it
    checks (the rollout's fallback to the canonical container), so it accepts
    both.
    """
    name = str(row.get("name") or "").strip()
    promise = str(row.get("description") or "").strip()
    headings = []
    if name:
        headings.append(f'<h1>{html.escape(name)}<span class="tool-promise">: {html.escape(promise)}</span></h1>' if promise else f"<h1>{html.escape(name)}</h1>")
    title = str(row.get("seoTitle") or name).strip()
    if title:
        headings.append(f"<h1>{html.escape(title)}</h1>")
    return headings


def check_tool_page(base_url: str, path: str, manifest: dict[str, dict]) -> str:
    row = manifest.get(path)
    expect(row, f"the manifest has no tool at {path}")
    headings = tool_headings(row)
    expect(headings, f"the manifest gives {path} neither a name nor a seoTitle")
    status, body = fetch(base_url, path)
    expect(status == 200, f"HTTP {status}")
    page = body.decode("utf-8", "replace")
    found = next((heading for heading in headings if heading in page), None)
    expect(found, f"the page lacks the server-rendered {headings[0]}")
    return f"contains {found}"


def check_sitemap(base_url: str, manifest: dict[str, dict]) -> str:
    status, body = fetch(base_url, "/sitemap.xml")
    expect(status == 200, f"HTTP {status}")
    root = ElementTree.fromstring(body)
    expect(root.tag == SITEMAP_NS + "urlset", f"the root element is {root.tag!r}")
    entries = root.findall(SITEMAP_NS + "url")
    expect(len(entries) > SITEMAP_FLOOR, f"{len(entries)} <url> entries, expected more than {SITEMAP_FLOOR}")
    listed = {urlsplit(entry.findtext(SITEMAP_NS + "loc") or "").path for entry in entries}
    missing = sorted(path for path in manifest if path not in listed)
    expect(not missing, f"{len(missing)} manifest tool(s) are absent, the first is {missing[:1]}")
    return f"{len(entries)} <url> entries, every manifest tool among them"


def run_checks(checks: list[tuple[str, Callable[[], str]]], failed: list[str]) -> None:
    for name, check in checks:
        try:
            print(f"ok    {name}: {check()}")
        except (CheckFailed, ValueError, ElementTree.ParseError, *NETWORK_ERRORS) as error:
            failed.append(name)
            print(f"FAIL  {name}: {error}")


def probe(image: str, build_sha: str) -> list[str]:
    """Names of the checks that failed. Raises ProbeFailure when none could run."""
    up = compose("up", "--detach", "--no-build", "--pull", "never", timeout=180)
    if up.returncode != 0:
        raise ProbeFailure(f"docker compose up failed: {output_of(up)}")
    container = container_id()
    if not container:
        raise ProbeFailure("docker compose up created no container")
    base_url = published_url()
    print(f"container {container[:12]} runs {image} at {base_url}")
    print(f"ready after {wait_until_ready(base_url, container):.1f} s")
    failed: list[str] = []
    run_checks([("async job supervisor", lambda: check_supervisor(container))], failed)
    return failed + check_serving(base_url, build_sha, container)


def check_serving(base_url: str, build_sha: str, container: str) -> list[str]:
    """Names of the checks that failed against a container that is ready."""
    failed: list[str] = []
    run_checks([
        ("GET /readyz", lambda: check_readyz(base_url, build_sha)),
        (f"GET {UNKNOWN_TOOL_PAGE}", lambda: check_unknown_tool(base_url)),
    ], failed)
    try:
        manifest = read_manifest(container)
    except CheckFailed as error:
        print(f"FAIL  tool manifest: {error}")
        print("skip  GET /, the tool pages and GET /sitemap.xml, whose expected values come from the manifest")
        return [*failed, "tool manifest"]
    print(f"ok    tool manifest: {len(manifest)} tools")
    run_checks([
        ("GET /", lambda: check_homepage(base_url, len(manifest))),
        *((f"GET {path}", lambda path=path: check_tool_page(base_url, path, manifest)) for path in TOOL_PAGES),
        ("GET /sitemap.xml", lambda: check_sitemap(base_url, manifest)),
    ], failed)
    return failed


def dump_logs() -> None:
    print(f"\n----- docker logs, last {LOG_TAIL_LINES} lines -----")
    container = container_id()
    if container:
        # Straight to this process's output, keeping the container's stdout
        # and stderr in the order they were written.
        subprocess.run(["docker", "logs", "--tail", str(LOG_TAIL_LINES), container],
                       stderr=subprocess.STDOUT, timeout=60, check=False)
    else:
        print("(no container)")
    print("----- end of docker logs -----\n")


def remove() -> None:
    # A throwaway container has nothing to drain, so do not sit out the 45 s grace.
    down = compose("down", "--volumes", "--remove-orphans", "--timeout", "5", timeout=120)
    if down.returncode != 0:
        print(f"docker compose down failed: {output_of(down)}")


def probe_running(arguments: list[str]) -> int:
    """Check a running container in place: the deploy's real-page probe."""
    options = dict(zip(arguments[::2], arguments[1::2]))
    if len(arguments) != 6 or set(options) != {"--running", "--url", "--sha"} or not all(options.values()):
        print(USAGE, file=sys.stderr)
        return 2
    container, base_url, build_sha = options["--running"], options["--url"].rstrip("/"), options["--sha"]
    sys.stdout.reconfigure(line_buffering=True)
    print(f"probing running container {container[:12]} at {base_url}")
    failed = check_serving(base_url, build_sha, container)
    if failed:
        print("page probe FAILED: " + ", ".join(failed))
        return 1
    print("page probe passed")
    return 0


def main() -> int:
    if sys.argv[1:2] == ["--running"]:
        return probe_running(sys.argv[1:])
    if len(sys.argv) != 2 or sys.argv[1].startswith("-"):
        print(USAGE, file=sys.stderr)
        return 2
    image = sys.argv[1]
    build_sha = os.environ.get("GITHUB_SHA") or "image-probe"
    in_actions = os.environ.get("GITHUB_ACTIONS") == "true"
    sys.stdout.reconfigure(line_buffering=True)
    isolate_environment(image, build_sha)
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(143))
    # Container output is echoed below. On a runner, keep it from being read
    # as workflow commands until the probe's own summary.
    resume = secrets.token_hex(16)
    if in_actions:
        print(f"::stop-commands::{resume}")
    failed: list[str] = []
    fatal = ""
    try:
        remove()  # whatever an interrupted local run left behind
        try:
            failed = probe(image, build_sha)
        except ProbeFailure as error:
            fatal = str(error)
        except subprocess.TimeoutExpired as error:
            fatal = f"timed out after {error.timeout} s: {' '.join(map(str, error.cmd))}"
        if fatal:
            print(f"FAIL  {fatal}")
        if fatal or failed:
            dump_logs()
    finally:
        remove()
        if in_actions:
            print(f"::{resume}::")
    if not (fatal or failed):
        print("image probe passed")
        return 0
    # Only this file's own words reach the annotation, never container output.
    summary = "the container did not start or never became ready" if fatal else "failed: " + ", ".join(failed)
    if in_actions:
        print(f"::error title=Image probe::{summary}")
    print(f"image probe FAILED: {summary}")
    return 1


if __name__ == "__main__":
    sys.exit(main())
