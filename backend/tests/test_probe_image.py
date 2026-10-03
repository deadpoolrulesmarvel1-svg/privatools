"""The CI image probe boots releases the way production runs them.

Production runs async jobs. The deploy's first deploy after the cut-over
makes a release's job supervisor take the queue only after traffic has moved
(the old supervisor cannot hand over), so CI must have seen that supervisor
take the lock in a booted image before any release is tagged.

A booted image must also keep a Word equation through Office to PDF: without
LibreOffice's Math module the conversion succeeds with a blank where the
equation was. Only CI checks that, never the deploy's --running probe.
"""
from __future__ import annotations

import importlib.util
import io
import os
import subprocess
import zipfile
from pathlib import Path
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from xml.etree import ElementTree

import pytest

ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture
def probe(monkeypatch):
    spec = importlib.util.spec_from_file_location("probe_image", ROOT / "scripts/ci/probe-image.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_ci_boots_the_image_with_async_jobs_enabled(probe, monkeypatch):
    monkeypatch.setenv("API_V1_JOBS_ENABLED", "false")
    probe.isolate_environment("some-image", "some-sha")
    assert os.environ["API_V1_JOBS_ENABLED"] == "true"
    assert (os.environ["PRIVATOOLS_IMAGE"], os.environ["GIT_SHA"]) == ("some-image", "some-sha")


@pytest.mark.parametrize("local,ok", [
    ({"role": "active", "alive": True}, True),
    ({"role": "standby", "alive": True}, False),
    ({"role": "active", "alive": False}, False),
    (None, False),
])
def test_ci_requires_the_job_supervisor_to_hold_the_queue(probe, local, ok):
    status = {"enabled": True, "local": local}
    if ok:
        assert "holds the job queue" in probe.check_supervisor_status(status)
    else:
        with pytest.raises(probe.CheckFailed):
            probe.check_supervisor_status(status)
    with pytest.raises(probe.CheckFailed):
        probe.check_supervisor_status({"enabled": False, "local": None})


class _HostEcho(BaseHTTPRequestHandler):
    """Answers like TrustedHostMiddleware: 400 unless the Host header is allowed."""

    allowed = "privatools.me"

    def do_GET(self):  # noqa: N802 (http.server's name)
        ok = self.headers.get("Host") == self.allowed
        body = self.headers.get("Host", "").encode()
        self.send_response(200 if ok else 400)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


@pytest.mark.parametrize("host_header,expected", [(None, 400), ("privatools.me", 200)])
def test_the_deploy_probe_asks_for_the_public_host_name(probe, monkeypatch, host_header, expected):
    # The rollout sets PRIVATOOLS_PROBE_HOST, so a release whose TRUSTED_HOSTS
    # rejects the public name fails the page probe instead of the check through
    # nginx after a switch. Unset (CI), requests go to 127.0.0.1 as before.
    if host_header:
        monkeypatch.setenv("PRIVATOOLS_PROBE_HOST", host_header)
    else:
        monkeypatch.delenv("PRIVATOOLS_PROBE_HOST", raising=False)
    server = ThreadingHTTPServer(("127.0.0.1", 0), _HostEcho)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        status, body = probe.fetch(f"http://127.0.0.1:{server.server_address[1]}", "/")
    finally:
        server.shutdown()
        server.server_close()
    assert status == expected, body


@pytest.mark.parametrize("path", ["/tool/merge-pdf", "/tools/image-compressor"])
def test_the_page_probe_expects_the_heading_the_server_renders(probe, monkeypatch, path):
    """The tool pages' H1 is the tool's name and promise, as seo_meta renders
    it into the real index.html. The probe also still accepts the search-title
    H1 of releases up to v2.7.14: the rollout's fallback probes the canonical
    container with the newer checkout's probe."""
    import html

    from backend.app import seo_meta

    rows = seo_meta._load_manifest(str(seo_meta._TOOL_JSON), seo_meta.blog_content_mtime_ns())
    manifest = {row["path"]: row for row in rows.values()}
    row = manifest[path]
    pages = {
        "current": seo_meta.inject_seo((ROOT / "frontend/index.html").read_text("utf-8"), path),
        "older": f"<html><body><div id=\"root\"><h1>{html.escape(row['seoTitle'])}</h1></div></body></html>",
    }
    for kind, page in pages.items():
        monkeypatch.setattr(probe, "fetch", lambda _base, _path, timeout=None, page=page: (200, page.encode()))
        found = probe.check_tool_page("http://127.0.0.1:1", path, manifest)
        assert ("tool-promise" in found) == (kind == "current"), (kind, found)
    assert probe.tool_headings(row)[0] == f'<h1>{html.escape(row["name"])}<span class="tool-promise">: {html.escape(row["description"])}</span></h1>'
    monkeypatch.setattr(probe, "fetch", lambda *_args, **_kwargs: (200, b"<h1>Something else</h1>"))
    with pytest.raises(probe.CheckFailed):
        probe.check_tool_page("http://127.0.0.1:1", path, manifest)


# ── Office to PDF keeps a Word equation (the CI image only) ──────────────────

MATH = "{http://schemas.openxmlformats.org/officeDocument/2006/math}"
WORD = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"


def test_the_equation_document_is_a_sentence_around_one_fraction(probe):
    import docx  # python-docx: a reader independent of the probe

    data = probe.equation_docx()
    assert data == probe.equation_docx()
    with zipfile.ZipFile(io.BytesIO(data)) as package:
        assert sorted(package.namelist()) == sorted(probe.EQUATION_DOCX)
        body = ElementTree.fromstring(package.read("word/document.xml"))
    assert len(list(body.iter(f"{MATH}oMath"))) == 1
    (fraction,) = body.iter(f"{MATH}f")
    assert [t.text for t in fraction.find(f"{MATH}num").iter(f"{MATH}t")] == [probe.EQUATION_TERMS[0]]
    assert [t.text for t in fraction.find(f"{MATH}den").iter(f"{MATH}t")] == [probe.EQUATION_TERMS[1]]
    # The words around the equation hold neither of its letters, so finding
    # both in the PDF means the equation was drawn.
    words = "".join(t.text for t in body.iter(f"{WORD}t"))
    assert words.split() == list(probe.EQUATION_CONTEXT)
    assert not set("".join(probe.EQUATION_TERMS)) & set(words)
    assert docx.Document(io.BytesIO(data)).paragraphs[0].text.split() == list(probe.EQUATION_CONTEXT)


@pytest.mark.parametrize("text,ok", [
    ("Before x\ny after.\n", True),  # what the PDF from an image with the Math module reads
    ("Before \U0001d465\n\U0001d466 after.\n", True),  # mathematical italic x and y
    ("Before  after.\n", False),  # an image without it: a blank where the equation was
    ("Before x after.\n", False),  # half a fraction
    ("", False),  # no text at all
])
def test_the_equation_check_wants_the_equation_not_only_its_sentence(probe, text, ok):
    if ok:
        assert "are in the PDF" in probe.check_equation_text(text)
    else:
        with pytest.raises(probe.CheckFailed):
            probe.check_equation_text(text)


def test_the_probe_uploads_the_document_as_the_office_route_reads_it(probe, client, monkeypatch, tmp_path):
    from backend.app.services import office_to_pdf_service

    received = []

    async def convert(input_path):
        received.append((Path(input_path).suffix, Path(input_path).read_bytes()))
        output = tmp_path / "converted.pdf"
        output.write_bytes(b"%PDF-1.7\n%%EOF\n")
        return str(output)

    monkeypatch.setattr(office_to_pdf_service, "office_to_pdf", convert)
    content_type, body = probe.multipart_file("equation.docx", probe.equation_docx())
    response = client.post(probe.OFFICE_TO_PDF, content=body, headers={"Content-Type": content_type})
    assert response.status_code == 200, response.text
    assert response.content.startswith(b"%PDF-")
    assert received == [(".docx", probe.equation_docx())]


def test_only_a_freshly_booted_image_converts_the_equation(probe, monkeypatch):
    """The deploy's --running probe checks live containers, including older
    releases from before the Math module (the rollout's fallback to the
    canonical container), so it never converts anything."""
    uploads = []
    pdf_text = {"text": "Before x\ny after.\n"}

    def post_file(_base_url, path, filename, content, _timeout):
        uploads.append((path, filename, content))
        return 200, b"%PDF-1.7\n"

    monkeypatch.setattr(probe, "post_file", post_file)
    monkeypatch.setattr(probe, "pdf_text", lambda _container, _pdf: pdf_text["text"])
    # Every page check runs and fails; what matters is that none uploads.
    monkeypatch.setattr(probe, "fetch", lambda *_args, **_kwargs: (404, b""))
    monkeypatch.setattr(probe, "read_manifest", lambda _container: {})
    assert probe.probe_running(["--running", "c0ffee", "--url", "http://127.0.0.1:9", "--sha", "some-sha"]) == 1
    assert uploads == []

    monkeypatch.setattr(probe, "compose", lambda *args, **_kwargs: subprocess.CompletedProcess(args, 0, "", ""))
    monkeypatch.setattr(probe, "container_id", lambda: "c0ffee")
    monkeypatch.setattr(probe, "published_url", lambda: "http://127.0.0.1:9")
    monkeypatch.setattr(probe, "wait_until_ready", lambda _base_url, _container: 0.0)
    monkeypatch.setattr(probe, "check_supervisor", lambda _container: "the job supervisor holds the job queue")
    check = f"POST {probe.OFFICE_TO_PDF}"
    assert check not in probe.probe("some-image", "some-sha")
    assert uploads == [(probe.OFFICE_TO_PDF, "equation.docx", probe.equation_docx())]
    pdf_text["text"] = "Before  after.\n"
    assert check in probe.probe("some-image", "some-sha")
