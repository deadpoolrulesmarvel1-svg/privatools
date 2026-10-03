"""Execute deploy/oracle-vm/rollout.sh against inert command doubles.

A simulated host stands in for docker, curl, ps, id, the nginx switch and the
page probe. It keeps containers with their readiness, pages and job
supervisors (a free lock goes to the first eager supervisor; a broken one
crashes its container instead), nginx's worker generations and the port nginx
really routes to (which a killed run can leave different from the upstream
file), and the traffic that reaches a container. These prove sequencing and
failure handling:

- a new release takes traffic only after it is ready, serves real pages and
  its job supervisor holds the queue;
- every failure leaves a serving release behind nginx;
- the queue is handed over, never interrupted;
- nothing that still receives requests is removed.

They run no Docker, nginx or network. deploy/README.md records the live load
test on a real stand-in.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import signal
import socket
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

ROOT = Path(__file__).resolve().parents[2]
ROLLOUT = ROOT / "deploy/oracle-vm/rollout.sh"
HELPER = ROOT / "deploy/oracle-vm/nginx-upstream.sh"
OLD, NEW = "b" * 40, "a" * 40

FAKE = r'''
import json, os, pathlib, sys
root = pathlib.Path(os.environ["FAKE_ROOT"])
world_path = root / "world.json"
world = json.loads(world_path.read_text())
containers, nginx = world["containers"], world["nginx"]
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]

def save():
    world_path.write_text(json.dumps(world))

def event(*item):
    with (root / "events.jsonl").open("a") as f:
        f.write(json.dumps(list(item)) + "\n")

def image(c):
    return world["images"].get(c["image"], {})

def running(c):
    return c["status"] == "running"

def by_port(port):
    for cid, c in sorted(containers.items()):
        if c["port"] == port and running(c):
            return cid, c
    return None, None

def ready(port):
    _, c = by_port(port)
    return c is not None and image(c).get("ready", True)

def settle():
    """A free job lock goes to the first eager supervisor; a broken one crashes its container."""
    if not world.get("jobs", True):
        return
    if any(c["role"] in ("active", "draining") and running(c) for c in containers.values()):
        return
    for cid, c in sorted(containers.items()):
        if not running(c) or not c["booted"] or c["passive"] or image(c).get("never_takes_lock"):
            continue
        if image(c).get("crash_on_lock"):
            c["restarts"] += 1          # the launcher stops the container; Docker restarts it
            event("crash", c["project"])
            continue
        c["role"] = "active"
        return

def roles():
    return {c["project"]: [c["role"], c["passive"]] for c in containers.values() if running(c)}

if name == "id":
    print(world.get("uid", 1000))

elif name == "curl":
    url = next(a for a in args if a.startswith("http"))
    public = url == os.environ["PUBLIC_READY_URL"]
    if public:
        if world.get("public_down"):
            sys.exit(7)
        port = nginx["port"]
    else:
        port = int(url.split(":")[2].split("/")[0])
        flaky = world.get("flaky_ready", {})
        if flaky.get(str(port), 0) > 0:
            flaky[str(port)] -= 1       # one failed probe, as a 503 under load gives
            save()
            sys.exit(22)
    cid, c = by_port(port)
    if c is None or not image(c).get("ready", True) or cid in world.get("unready", []):
        sys.exit(22)
    if public and image(c).get("rejects_host"):
        sys.exit(22)                    # nginx forwards the public Host, which this release rejects
    print(json.dumps({"status": "ready", "build_sha": c["sha"], "checks": {}}))

elif name == "nginx-switch":
    port = int(args[-1])
    _, target = by_port(port)
    event("switch", port, roles(), target["image"] if target else None)
    if world.get("switch_fails_to") == port:
        sys.exit(3)
    if not ready(port):
        sys.exit(5)                     # the helper refuses a target that is not ready
    pathlib.Path(os.environ["UPSTREAM_FILE"]).write_text(f"upstream privatools_app {{\n    server 127.0.0.1:{port};\n}}\n")
    if nginx.get("stuck_to") in (port, "any"):
        nginx["stuck_to"] = None        # the helper said yes, but nginx did not reload
    else:
        for pid in nginx["workers"]:
            nginx["retired"][str(pid)] = nginx.get("retire_polls", 1)
        nginx["workers"] = [nginx["next_pid"], nginx["next_pid"] + 1]
        nginx["next_pid"] += 2
        nginx["port"] = port
    crash = world.get("crash_on_switch_to")
    if crash:
        for c in containers.values():
            if c["project"] == crash and c["port"] == port and running(c):
                c["restarts"] += 1      # its supervisor died after the switch
                c["role"] = "standby"
                world["crash_on_switch_to"] = None
                event("crash", c["project"])
        settle()
    save()

elif name == "ps":
    if "--ppid" in args:
        for pid in nginx["workers"]:
            print(f"{pid} nginx: worker process")
        for pid in nginx["retired"]:
            print(f"{pid} nginx: worker process is shutting down")
    else:
        pid = args[args.index("-p") + 1]
        if int(pid) in nginx["workers"]:
            print("nginx: worker process")
        elif pid in nginx["retired"]:
            if nginx["retired"][pid] <= 0:
                del nginx["retired"][pid]
                save()
                sys.exit(1)
            nginx["retired"][pid] -= 1
            print("nginx: worker process is shutting down")
        else:
            sys.exit(1)
    save()

elif name == "probe":
    c = containers[args[args.index("--running") + 1]]
    host_header = os.environ.get("PRIVATOOLS_PROBE_HOST")
    event("probe", c["project"], host_header)
    rejected = image(c).get("rejects_host")
    sys.exit(0 if image(c).get("pages", True) and not (rejected and rejected == host_header) else 1)

elif name == "docker":
    if args[0] == "compose":
        project = args[args.index("-p") + 1]
        rest = args[args.index("-p") + 2:]
        while rest and rest[0] == "-f":
            rest = rest[2:]
        command = rest[0]
        event("compose", project, command, os.environ.get("PRIVATOOLS_IMAGE"), os.environ.get("GIT_SHA"),
              os.environ.get("PRIVATOOLS_HOST_PORT"), os.environ.get("PRIVATOOLS_DATA_VOLUME"))
        mine = [cid for cid, c in containers.items() if c["project"] == project]
        if command == "up":
            if project in world.get("up_fails", []):
                sys.exit(1)
            for cid in mine:
                del containers[cid]
            ref = os.environ["PRIVATOOLS_IMAGE"]
            world["next"] += 1
            polls = world.get("boot_polls", 0)
            containers[f"c{world['next']:02d}{project.replace('-', '')}"] = {
                "project": project, "image": world["refs"].get(ref, ref), "sha": os.environ["GIT_SHA"],
                "port": int(os.environ["PRIVATOOLS_HOST_PORT"]), "status": "running", "role": "standby",
                "passive": False, "restarts": 0, "booted": polls == 0, "boot_polls": polls}
        elif command == "down":
            for cid in mine:
                del containers[cid]
        elif command == "stop":
            for cid in mine:
                containers[cid]["status"] = "exited"
                containers[cid]["role"] = "standby"
        settle()
        save()
    elif args[0] == "ps":
        project = next(a.split("=", 2)[2] for a in args if a.startswith("label=com.docker.compose.project="))
        for cid, c in sorted(containers.items()):
            if c["project"] == project:
                print(cid)
    elif args[0] == "inspect":
        form, cid = args[2], args[3]
        c = containers.get(cid)
        if c is None:
            print(f"Error: No such object: {cid}", file=sys.stderr)
            sys.exit(1)
        flaky = world.get("flaky") or {}
        if (flaky.get("armed") and flaky.get("inspect", 0) > 0 and flaky.get("project") == c["project"]
                and (".State" in form or ".RestartCount" in form)):
            flaky["inspect"] -= 1           # a Docker CLI call that fails once, not a restart
            save()
            print("error during connect: simulated transient failure", file=sys.stderr)
            sys.exit(1)
        if form == "{{.State.Running}} {{.RestartCount}}":
            print("true" if running(c) else "false", c["restarts"])
        elif form == "{{.Image}}":
            print(c["image"])
        elif ".Config.Env" in form:
            print(f"PRIVATOOLS_BUILD_SHA={c['sha']}")
        elif ".Mounts" in form:
            print("privatools_app-data" if "/app/data" in form else "privatools_app-temp")
        elif form == "{{.State.Running}}":
            print("true" if running(c) else "false")
        elif form == "{{.RestartCount}}":
            print(c["restarts"])
        else:
            print(c["status"], c["restarts"])
    elif args[0] == "image":
        print(world["refs"].get(args[-1], args[-1]))
    elif args[0] == "exec":
        c = containers.get(args[1])
        if c is None or not running(c):
            sys.exit(1)
        if "--status" in args:
            if image(c).get("legacy"):
                sys.exit(1)             # older releases have no status command
            flaky = world.get("flaky") or {}
            if flaky.get("project") == c["project"] and flaky.get("armed") and flaky.get("status", 0) > 0:
                flaky["status"] -= 1        # one status poll that fails, as a busy Docker daemon can
                save()
                print("Error response from daemon: simulated transient failure", file=sys.stderr)
                sys.exit(1)
            local = None
            if not c["booted"]:
                c["boot_polls"] -= 1
                if c["boot_polls"] <= 0:
                    c["booted"] = True
                    settle()
            elif world.get("jobs", True):
                local = {"role": c["role"], "passive": c["passive"], "alive": True, "ready": True}
                if flaky.get("project") == c["project"] and flaky.get("after_active") and c["role"] == "active":
                    flaky["armed"] = True   # the failures start once it holds the queue: inside the soak
            save()
            print(json.dumps({"enabled": world.get("jobs", True), "local": local,
                              "running_jobs": 0, "queued_jobs": 0}))
        else:
            print("  sl  local_address rem_address   st")
            late = world.get("pin_until_retired") or {}
            if world.get("traffic") and (c["port"] == nginx["port"] or world.get("pin_traffic_to") == c["project"]
                                         or (late.get("project") == c["project"]
                                             and any(str(p) in nginx["retired"] for p in late["pids"]))):
                print("   0: 020012AC:1F40 010012AC:D431 01 00000000:00000000 00:00000000 00000000 1000 0 1")
    elif args[0] == "kill":
        sig, cid = args[2], args[3]
        c = containers[cid]
        event("kill", sig, c["project"], c["passive"], c["booted"], c["role"])
        if sig == "SIGUSR1":
            if world.get("stuck_job") == c["project"] and c["role"] == "active":
                c["role"] = "draining"      # finishing a long job; reports passive false, like the worker
            elif c["role"] in ("active", "draining"):
                c["role"] = "standby"
                c["passive"] = True
            else:
                c["passive"] = True
        elif sig == "SIGUSR2":
            if c["role"] == "draining":
                c["role"] = "active"        # eager again: it retakes the lock as its job ends
            c["passive"] = False
        settle()
        save()
    elif args[0] in ("stop", "start", "rm"):
        cid = args[-1]
        c = containers.get(cid)
        if c is not None:
            event(args[0], c["project"])
            if args[0] == "rm":
                del containers[cid]
            else:
                c["status"] = "running" if args[0] == "start" else "exited"
                c["role"] = "standby"
                c["passive"] = False
            settle()
            save()
'''


def reserve_ports(count: int) -> list[socket.socket]:
    """COUNT loopback ports, as sockets bound to them and not listening.

    Each socket stays bound while the next port is chosen, so the ports
    differ: two probes that each release their port can be handed the same
    one. Close the sockets once the ports are no longer needed. Until then no
    other process can take a port, and a connection to one is refused, which
    is what the rollout's check for a free interim port looks for.
    """
    held: list[socket.socket] = []
    try:
        for _ in range(count):
            probe = socket.socket()
            held.append(probe)
            probe.bind(("127.0.0.1", 0))
    except BaseException:
        for probe in held:
            probe.close()
        raise
    return held


def bash() -> str:
    found = shutil.which("bash") or "/bin/bash"
    major = subprocess.run([found, "-c", "echo ${BASH_VERSINFO[0]}"], capture_output=True, text=True).stdout.strip()
    if not major.isdigit() or int(major) < 4:
        pytest.skip("rollout.sh needs bash 4 (the VM's bash); this host has an older one")
    return found


class Host:
    """The simulated VM: one canonical container on OLD whose supervisor holds the queue, nginx on it."""

    def __init__(self, tmp_path: Path):
        self.root = tmp_path
        self.bin = tmp_path / "bin"
        self.bin.mkdir()
        for name in ("docker", "curl", "nginx-switch", "probe", "ps", "id"):
            script = self.bin / name
            script.write_text(f"#!{sys.executable}\n" + FAKE)
            script.chmod(0o755)
        self.reserved = reserve_ports(2)
        self.canonical_port, self.interim_port = (probe.getsockname()[1] for probe in self.reserved)
        self.upstream = tmp_path / "privatools-upstream.conf"
        self.set_upstream(self.canonical_port)
        self.site = tmp_path / "site.conf"
        self.site.write_text("location / { proxy_pass http://privatools_app; }\n")
        self.meminfo = tmp_path / "meminfo"
        self.meminfo.write_text("MemTotal: 12000000 kB\nMemAvailable: 6000000 kB\n")
        (tmp_path / "nginx.pid").write_text("100\n")
        self.world = {
            "next": 1,
            "refs": {"ghcr.io/x@sha256:new": "sha256:new", "ghcr.io/x@sha256:old": "sha256:old"},
            "images": {"sha256:new": {}, "sha256:old": {}},
            "containers": {"c01privatools": {
                "project": "privatools", "image": "sha256:old", "sha": OLD, "port": self.canonical_port,
                "status": "running", "role": "active", "passive": False, "restarts": 0, "booted": True,
                "boot_polls": 0}},
            "nginx": {"port": self.canonical_port, "workers": [101, 102], "retired": {}, "next_pid": 200,
                      "retire_polls": 1},
            "traffic": True,
        }
        self.save()

    def close(self):
        for probe in self.reserved:
            probe.close()

    def save(self):
        (self.root / "world.json").write_text(json.dumps(self.world))

    def load(self) -> dict:
        return json.loads((self.root / "world.json").read_text())

    def update(self, **changes):
        self.world = self.load()
        self.world.update(changes)
        self.save()

    def set_upstream(self, port: int):
        self.upstream.write_text(f"upstream privatools_app {{\n    server 127.0.0.1:{port};\n}}\n")

    def interrupted_switch(self, port: int, retired: list[int]):
        """What a run killed inside a switch leaves: its record of the switch it started."""
        (self.root / ".privatools-deploy.switching").write_text(f"{port} {' '.join(map(str, retired))}\n")

    def switched_to(self, image: str) -> bool:
        """Whether nginx was ever switched to a container running IMAGE."""
        return any(item[0] == "switch" and item[3] == image for item in self.events())

    def live_port(self) -> int:
        return int(self.upstream.read_text().split("server 127.0.0.1:")[1].split(";")[0])

    def events(self) -> list[list]:
        path = self.root / "events.jsonl"
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def clear_events(self):
        (self.root / "events.jsonl").unlink(missing_ok=True)

    def run(self, *args: str, **env: str) -> subprocess.CompletedProcess:
        environment = {
            **os.environ,
            "PATH": f"{self.bin}{os.pathsep}{os.environ['PATH']}",
            "FAKE_ROOT": str(self.root),
            "REPO_DIR": str(ROOT),
            "STATE_DIR": str(self.root),
            "UPSTREAM_FILE": str(self.upstream),
            "NGINX_SITE": str(self.site),
            "NGINX_SWITCH": "nginx-switch set",
            "NGINX_PID_FILE": str(self.root / "nginx.pid"),
            "PUBLIC_READY_URL": "http://public.test/readyz",
            "PUBLIC_RESOLVE": "",
            "PROBE_SCRIPT": str(self.bin / "probe"),
            "CANONICAL_PORT": str(self.canonical_port),
            "INTERIM_PORT": str(self.interim_port),
            "MEMINFO": str(self.meminfo),
            "PRIVATOOLS_DEPLOY_LOCK_HELD": "1",
            # Upper bounds, generous for a loaded CI runner; happy paths finish early.
            "READY_TIMEOUT": "6", "DRAIN_MAX": "1", "DRAIN_EXTRA": "1", "DRAIN_QUIET": "0",
            "DRAIN_ROUTED_GRACE": "0", "SWITCH_VERIFY": "3", "HANDOVER_MAX": "10", "HANDOVER_IDLE_WAIT": "1",
            "HANDOVER_CONFIRM": "10", "HANDOVER_SOAK": "0", "RECONCILE_WAIT": "1", "POLL": "0.05",
            **env,
        }
        environment.pop("COMPOSE_PROJECT", None)
        return subprocess.run([bash(), str(ROLLOUT), *args], env=environment, capture_output=True, text=True,
                              timeout=180)

    def containers(self, project: str) -> list[dict]:
        return [c for c in self.load()["containers"].values() if c["project"] == project]


@pytest.fixture
def host(tmp_path):
    simulated = Host(tmp_path)
    yield simulated
    simulated.close()


def test_the_simulated_host_never_gets_one_port_for_both_containers(tmp_path, monkeypatch):
    # A kernel may hand a port it has just released straight back: two
    # separate probes returned the same port for 17 pairs in 200,000 on the
    # dev VM. With one port for both, the rollout reads the upstream as naming
    # the interim container, logs "resuming" and exits 3, and a release gate
    # fails. This kernel always hands out the lowest port nobody holds.
    held: set[int] = set()

    class LowestFreePort:
        def __init__(self, *args, **kwargs):
            self.port = None

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            self.close()

        def bind(self, address):
            self.port = min(set(range(40000, 40010)) - held)
            held.add(self.port)

        def getsockname(self):
            return ("127.0.0.1", self.port)

        def close(self):
            held.discard(self.port)

    monkeypatch.setattr(socket, "socket", LowestFreePort)
    simulated = Host(tmp_path)
    try:
        assert simulated.canonical_port != simulated.interim_port
    finally:
        simulated.close()


def steps(events: list[list]) -> list[tuple]:
    """The externally visible actions, in order, without their details."""
    out = []
    for item in events:
        if item[0] == "compose":
            out.append(("compose", item[1], item[2]))
        elif item[0] in ("switch", "probe"):
            out.append((item[0], item[1]))
        elif item[0] == "kill":
            out.append(("kill", item[1], item[2]))
        elif item[0] in ("stop", "start"):
            out.append((item[0], item[1]))
    return out


def switch_roles(events: list[list], port: int) -> dict:
    """Supervisor roles at the first switch to PORT."""
    return next(item[2] for item in events if item[0] == "switch" and item[1] == port)


def signals_were_safe(events: list[list]):
    for item in events:
        if item[0] == "kill":
            _, sig, project, passive, booted, role = item
            assert booted, f"{sig} sent to {project} before its supervisor was running"
            if sig == "SIGUSR2":
                assert passive or role == "draining", f"SIGUSR2 sent to {project}, whose supervisor was not passive"


# ── the normal path ──────────────────────────────────────────────────────────

def test_good_release_takes_the_queue_before_any_switch_and_returns_to_the_canonical_port(host):
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 0, result.stdout + result.stderr
    assert steps(host.events()) == [
        ("compose", "privatools-interim", "up"),    # nothing to repair: nginx is left alone
        ("probe", "privatools-interim"),
        ("kill", "SIGUSR1", "privatools"),          # old supervisor finishes its job and hands over...
        ("switch", host.interim_port),              # ...before any traffic moves
        ("compose", "privatools", "up"),            # only after the old container drained
        ("probe", "privatools"),
        ("kill", "SIGUSR1", "privatools-interim"),
        ("switch", host.canonical_port),
        ("compose", "privatools-interim", "down"),
    ]
    # At each switch the release that takes traffic already holds the job queue.
    assert switch_roles(host.events(), host.interim_port) == {
        "privatools": ["standby", True], "privatools-interim": ["active", False]}
    final = [item for item in host.events() if item[0] == "switch"][-1][2]
    assert final == {"privatools": ["active", False], "privatools-interim": ["standby", True]}
    signals_were_safe(host.events())
    up = next(e for e in host.events() if e[:3] == ["compose", "privatools-interim", "up"])
    assert up[3:] == ["ghcr.io/x@sha256:new", NEW, str(host.interim_port), "privatools_app-data"]
    assert host.live_port() == host.canonical_port and host.load()["nginx"]["port"] == host.canonical_port
    [canonical] = host.containers("privatools")
    assert (canonical["image"], canonical["sha"], canonical["role"]) == ("sha256:new", NEW, "active")
    assert not host.containers("privatools-interim")
    assert (host.root / ".privatools-deploy.previous").read_text().split() == ["sha256:old", OLD]
    # The page probe asks for the public site by name, as nginx does.
    assert {item[2] for item in host.events() if item[0] == "probe"} == {"privatools.me"}
    assert not (host.root / ".privatools-deploy.switching").exists()


@pytest.mark.parametrize("fault,message", [("ready", "never became ready"), ("pages", "failed the real-page probe")])
def test_rejected_release_never_takes_traffic_or_the_queue(host, fault, message):
    host.world["images"]["sha256:new"] = {fault: False}
    host.save()
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 1, result.stdout + result.stderr
    assert message in result.stdout
    actions = steps(host.events())
    assert actions[0] == ("compose", "privatools-interim", "up")
    assert not [a for a in actions if a[0] == "switch"], "nginx must not be touched"
    assert not [a for a in actions if a[0] == "kill"], "the old supervisor must keep the queue"
    assert actions[-1] == ("compose", "privatools-interim", "down")
    assert host.live_port() == host.canonical_port
    assert [(c["sha"], c["role"]) for c in host.containers("privatools")] == [(OLD, "active")]
    assert not host.containers("privatools-interim")
    assert not (host.root / ".privatools-deploy.previous").exists()


# ── review item 3: the new supervisor must hold the queue before traffic moves ─

def test_supervisor_that_crashes_on_taking_the_queue_is_rejected_before_any_switch(host):
    host.world["images"]["sha256:new"] = {"crash_on_lock": True}
    host.save()
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "job supervisor" in result.stdout and "REJECTED" in result.stdout
    actions = steps(host.events())
    assert ("switch", host.interim_port) not in actions
    assert any(item[0] == "crash" for item in host.events())
    # The broken candidate goes first, so it cannot grab the lock again; then
    # the old supervisor is resumed.
    down = actions.index(("compose", "privatools-interim", "down"))
    assert actions[down + 1:] == [("kill", "SIGUSR2", "privatools")]
    signals_were_safe(host.events())
    assert [(c["sha"], c["role"]) for c in host.containers("privatools")] == [(OLD, "active")]
    assert not host.containers("privatools-interim")
    assert host.load()["nginx"]["port"] == host.canonical_port


def test_supervisor_that_dies_after_the_switch_is_caught_before_the_old_release_is_destroyed(host):
    host.update(crash_on_switch_to="privatools-interim")
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 1, result.stdout + result.stderr
    actions = steps(host.events())
    assert ("compose", "privatools", "up") not in actions, "the old release must survive"
    assert actions[actions.index(("switch", host.interim_port)) + 1:] == [
        ("switch", host.canonical_port),
        ("compose", "privatools-interim", "down"),
        ("kill", "SIGUSR2", "privatools"),
    ]
    assert host.load()["nginx"]["port"] == host.canonical_port
    assert [(c["image"], c["role"]) for c in host.containers("privatools")] == [("sha256:old", "active")]
    assert "c01privatools" in host.load()["containers"]


def test_first_deploy_after_the_cut_over_stops_the_old_supervisor_only_when_idle(host):
    host.world["images"]["sha256:old"] = {"legacy": True}
    host.save()
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 0, result.stdout + result.stderr
    actions = steps(host.events())
    assert ("kill", "SIGUSR1", "privatools") not in actions
    assert "predates handover" in result.stdout
    stop = actions.index(("stop", "privatools"))
    assert actions.index(("switch", host.interim_port)) < stop < actions.index(("compose", "privatools", "up"))


def test_first_deploy_whose_supervisor_breaks_brings_the_old_release_back(host):
    host.world["images"]["sha256:old"] = {"legacy": True}
    host.world["images"]["sha256:new"] = {"crash_on_lock": True}
    host.save()
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 1, result.stdout + result.stderr
    actions = steps(host.events())
    assert actions.index(("stop", "privatools")) < actions.index(("start", "privatools"))
    assert actions[-2:] == [("switch", host.canonical_port), ("compose", "privatools-interim", "down")]
    assert ("compose", "privatools", "up") not in actions
    assert host.load()["nginx"]["port"] == host.canonical_port
    assert [(c["sha"], c["status"], c["role"]) for c in host.containers("privatools")] == [(OLD, "running", "active")]
    assert not host.containers("privatools-interim")


# ── review item 2: nginx must really route where the file says ───────────────

def test_run_after_a_killed_switch_back_repairs_nginx_before_removing_anything(host):
    # A run killed between renaming the upstream file and reloading nginx left
    # the file naming the canonical port while nginx still routes to the
    # interim. The next run must not trust the file.
    host.world["containers"]["c01privatools"].update(image="sha256:new", sha=NEW)
    host.world["containers"]["c01privatools"]["role"] = "active"
    host.world["containers"]["c09privatoolsinterim"] = {
        "project": "privatools-interim", "image": "sha256:new", "sha": NEW, "port": host.interim_port,
        "status": "running", "role": "standby", "passive": True, "restarts": 0, "booted": True, "boot_polls": 0}
    host.world["nginx"]["port"] = host.interim_port
    host.interrupted_switch(host.canonical_port, [101, 102])
    host.save()
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "not seen to take effect" in result.stdout
    assert steps(host.events())[0] == ("switch", host.canonical_port)
    assert host.load()["nginx"]["port"] == host.canonical_port
    assert not host.containers("privatools-interim")
    assert "already serves" in result.stdout


def test_container_that_still_receives_requests_after_nginx_moved_on_is_never_removed(host):
    host.update(pin_traffic_to="privatools")
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 4, result.stdout + result.stderr
    assert "still receives requests" in result.stdout
    actions = steps(host.events())
    assert ("compose", "privatools", "up") not in actions
    assert host.containers("privatools") and host.containers("privatools-interim")


def test_switch_that_nginx_never_applied_is_undone_and_retried_later(host):
    # Re-applying an interrupted switch is checked like any switch.
    host.interrupted_switch(host.canonical_port, [101, 102])
    host.world["nginx"]["stuck_to"] = "any"
    host.save()
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 2, result.stdout + result.stderr
    assert "did not reload" in result.stdout
    assert not [a for a in steps(host.events()) if a[0] == "compose"]

    # The switch to the new release: the helper reports success, nginx keeps
    # routing to the old port. Undone, not counted as a deploy.
    host.clear_events()
    host.update(nginx={**host.load()["nginx"], "stuck_to": host.interim_port})
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 2, result.stdout + result.stderr
    actions = steps(host.events())
    switch = actions.index(("switch", host.interim_port))
    assert ("switch", host.canonical_port) in actions[switch + 1:]
    assert host.live_port() == host.canonical_port and host.load()["nginx"]["port"] == host.canonical_port
    assert [(c["sha"], c["role"]) for c in host.containers("privatools")] == [(OLD, "active")]
    assert not host.containers("privatools-interim")
    assert not (host.root / ".privatools-deploy.switching").exists(), "the undo was verified"


def test_old_supervisor_whose_job_outlasts_the_handover_keeps_the_queue(host):
    # Its job runs past HANDOVER_MAX: the attempt is undone (a host matter, not
    # the release's), and the drain is cancelled so it keeps serving jobs.
    host.update(stuck_job="privatools")
    result = host.run("ghcr.io/x@sha256:new", NEW, HANDOVER_MAX="1")
    assert result.returncode == 2, result.stdout + result.stderr
    actions = steps(host.events())
    assert ("switch", host.interim_port) not in actions
    down = actions.index(("compose", "privatools-interim", "down"))
    assert actions[down + 1:] == [("kill", "SIGUSR2", "privatools")]
    assert [c["role"] for c in host.containers("privatools")] == ["active"]
    signals_were_safe(host.events())


def test_requests_from_workers_a_killed_run_retired_are_not_mistaken_for_routing(host):
    # A run died inside its switch, after nginx reloaded. The workers that
    # reload retired (301, 302) are still finishing uploads to the old
    # container. The next run re-applies the upstream and must wait for them
    # too, not call it misrouting.
    host.set_upstream(host.interim_port)
    host.interrupted_switch(host.interim_port, [301, 302])
    host.world["nginx"].update(port=host.interim_port, retired={"301": 6, "302": 6})
    host.world["pin_until_retired"] = {"project": "privatools", "pids": [301, 302]}
    host.world["containers"]["c09privatoolsinterim"] = {
        "project": "privatools-interim", "image": "sha256:new", "sha": NEW, "port": host.interim_port,
        "status": "running", "role": "standby", "passive": False, "restarts": 0, "booted": True, "boot_polls": 0}
    host.save()
    # Caps long enough that only those workers' exit can end the drain. Their
    # last connection, counted just before they exit, is not routing either.
    result = host.run("ghcr.io/x@sha256:new", NEW, DRAIN_MAX="60", DRAIN_EXTRA="60")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "still receives requests" not in result.stdout
    assert "retiring it anyway" not in result.stdout
    assert host.live_port() == host.canonical_port
    assert [c["sha"] for c in host.containers("privatools")] == [NEW]


@pytest.mark.parametrize("rollback,expected", [(False, 3), (True, 2)])
def test_moving_back_from_the_degraded_state_checks_memory_first(host, rollback, expected):
    host.update(up_fails=["privatools"])
    assert host.run("ghcr.io/x@sha256:new", NEW).returncode == 3
    host.update(up_fails=[])
    past = time.time() - 3600
    os.utime(host.root / ".privatools-deploy.resume", (past, past))
    host.meminfo.write_text("MemAvailable: 1000000 kB\n")
    host.clear_events()
    result = host.run(*(["--rollback"] if rollback else ["ghcr.io/x@sha256:new", NEW]))
    assert result.returncode == expected, result.stdout + result.stderr
    assert "refusing to start a second container" in result.stdout
    assert ("compose", "privatools", "up") not in steps(host.events())
    assert host.live_port() == host.interim_port


# ── review item 5: host trouble is retried, not blamed on the release ─────────

@pytest.mark.parametrize("fault", ["interim_up", "switch", "public"])
def test_infrastructure_failure_exits_2_and_leaves_the_old_release_in_charge(host, fault):
    if fault == "interim_up":
        host.update(up_fails=["privatools-interim"])
    elif fault == "switch":
        host.update(switch_fails_to=host.interim_port)
    else:
        host.update(public_down=True)
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 2, result.stdout + result.stderr
    assert host.live_port() == host.canonical_port and host.load()["nginx"]["port"] == host.canonical_port
    assert [(c["sha"], c["role"]) for c in host.containers("privatools")] == [(OLD, "active")]
    assert not host.containers("privatools-interim")
    signals_were_safe(host.events())


# ── review item 4: the rollback record and --rollback while degraded ─────────

def test_degraded_run_records_the_replaced_release_before_destroying_it(host):
    host.update(up_fails=["privatools"])
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 3, result.stdout + result.stderr
    assert "DEGRADED" in result.stdout
    assert (host.root / ".privatools-deploy.previous").read_text().split() == ["sha256:old", OLD]
    assert host.live_port() == host.interim_port
    [interim] = host.containers("privatools-interim")
    assert (interim["sha"], interim["role"]) == (NEW, "active")


def test_rollback_while_degraded_restores_the_previous_release_at_once(host):
    host.update(up_fails=["privatools"])
    assert host.run("ghcr.io/x@sha256:new", NEW).returncode == 3
    host.update(up_fails=[])
    host.clear_events()
    result = host.run("--rollback")                  # inside the resume backoff
    assert result.returncode == 0, result.stdout + result.stderr
    assert "failed less than" not in result.stdout
    assert host.live_port() == host.canonical_port and host.load()["nginx"]["port"] == host.canonical_port
    assert [(c["image"], c["sha"], c["role"]) for c in host.containers("privatools")] == [("sha256:old", OLD, "active")]
    assert not host.containers("privatools-interim")
    assert (host.root / ".privatools-deploy.previous").read_text().split() == ["sha256:new", NEW]
    signals_were_safe(host.events())


def test_degraded_run_backs_off_then_finishes_the_move(host):
    host.update(up_fails=["privatools"])
    assert host.run("ghcr.io/x@sha256:new", NEW).returncode == 3
    again = host.run("ghcr.io/x@sha256:new", NEW)
    assert again.returncode == 3 and "failed less than" in again.stdout
    host.update(up_fails=[])
    past = time.time() - 3600
    os.utime(host.root / ".privatools-deploy.resume", (past, past))
    host.clear_events()
    resumed = host.run("ghcr.io/x@sha256:new", NEW)
    assert resumed.returncode == 0, resumed.stdout + resumed.stderr
    assert "resuming" in resumed.stdout
    actions = steps(host.events())
    assert actions[0] == ("compose", "privatools", "up")
    # nginx is untouched until the one switch back.
    assert [a for a in actions if a[0] == "switch"] == [("switch", host.canonical_port)]
    assert host.live_port() == host.canonical_port
    assert [(c["sha"], c["role"]) for c in host.containers("privatools")] == [(NEW, "active")]
    assert not host.containers("privatools-interim")
    assert not (host.root / ".privatools-deploy.resume").exists()


# ── review item 13: a failed record must not be reported as done ──────────────

def test_release_that_cannot_be_recorded_for_rollback_is_not_destroyed(host):
    result = host.run("ghcr.io/x@sha256:new", NEW, PREVIOUS_FILE=str(host.root / "missing-dir" / "previous"))
    assert result.returncode == 3, result.stdout + result.stderr
    assert "cannot record" in result.stdout and "recorded " not in result.stdout
    assert ("compose", "privatools", "up") not in steps(host.events())
    assert "c01privatools" in host.load()["containers"]


# ── resuming and reconciling ─────────────────────────────────────────────────

def test_run_killed_after_its_switch_is_finished_by_the_next_run(host):
    host.set_upstream(host.interim_port)
    host.world["nginx"]["port"] = host.interim_port
    host.world["containers"]["c09privatoolsinterim"] = {
        "project": "privatools-interim", "image": "sha256:new", "sha": NEW, "port": host.interim_port,
        "status": "running", "role": "standby", "passive": False, "restarts": 0, "booted": True, "boot_polls": 0}
    host.save()
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "resuming" in result.stdout
    assert steps(host.events()) == [
        ("kill", "SIGUSR1", "privatools"),          # the old canonical hands the queue over...
        ("compose", "privatools", "up"),            # ...before compose stops it
        ("probe", "privatools"),
        ("kill", "SIGUSR1", "privatools-interim"),
        ("switch", host.canonical_port),
        ("compose", "privatools-interim", "down"),
    ]
    assert host.live_port() == host.canonical_port
    assert [(c["sha"], c["role"]) for c in host.containers("privatools")] == [(NEW, "active")]
    assert (host.root / ".privatools-deploy.previous").read_text().split() == ["sha256:old", OLD]
    signals_were_safe(host.events())


def test_interim_that_stopped_serving_is_replaced_by_a_serving_canonical(host):
    host.set_upstream(host.interim_port)
    host.world["nginx"]["port"] = host.interim_port
    host.world["images"]["sha256:broken"] = {"ready": False}
    host.world["containers"]["c09privatoolsinterim"] = {
        "project": "privatools-interim", "image": "sha256:broken", "sha": NEW, "port": host.interim_port,
        "status": "running", "role": "active", "passive": False, "restarts": 0, "booted": True, "boot_polls": 0}
    host.world["containers"]["c01privatools"]["role"] = "standby"
    host.world["containers"]["c01privatools"]["passive"] = True
    host.save()
    result = host.run("ghcr.io/x@sha256:old", OLD)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "switching to" in result.stdout
    assert steps(host.events()) == [
        ("probe", "privatools"),                    # the fallback passes the page probe first
        ("switch", host.canonical_port),
        ("kill", "SIGUSR1", "privatools-interim"),
        ("kill", "SIGUSR2", "privatools"),
        ("compose", "privatools-interim", "down"),
    ]
    assert host.live_port() == host.canonical_port
    assert [c["role"] for c in host.containers("privatools")] == ["active"]
    signals_were_safe(host.events())


def test_leftover_interim_is_retired_without_signalling_an_eager_successor(host):
    host.world["containers"]["c09privatoolsinterim"] = {
        "project": "privatools-interim", "image": "sha256:old", "sha": OLD, "port": host.interim_port,
        "status": "running", "role": "standby", "passive": False, "restarts": 0, "booted": True, "boot_polls": 0}
    host.save()
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "left an interim container behind" in result.stdout
    assert steps(host.events())[:1] == [("compose", "privatools-interim", "down")]
    signals_were_safe(host.events())


def test_supervisors_are_signalled_only_once_they_run(host):
    host.update(boot_polls=3)
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 0, result.stdout + result.stderr
    signals_were_safe(host.events())


def test_stopped_canonical_container_is_replaced_without_drain_or_signals(host):
    host.world["containers"]["c01privatools"]["status"] = "exited"
    host.world["containers"]["c01privatools"]["role"] = "standby"
    host.save()
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "is not running" in result.stdout
    actions = steps(host.events())
    assert not [a for a in actions[:actions.index(("compose", "privatools", "up"))] if a[0] == "kill"]
    assert [c["sha"] for c in host.containers("privatools")] == [NEW]
    assert (host.root / ".privatools-deploy.previous").read_text().split() == ["sha256:old", OLD]


def test_same_image_and_build_changes_nothing(host):
    result = host.run("ghcr.io/x@sha256:old", OLD)
    assert result.returncode == 0, result.stdout + result.stderr
    assert "already serves" in result.stdout
    assert steps(host.events()) == []


@pytest.mark.parametrize("breakage,message", [
    ("root", "as root"),
    ("memory", "refusing to start a second container"),
    ("upstream", "install the nginx switch first"),
    ("site", "does not proxy only through"),
])
def test_unmet_preconditions_start_nothing(host, breakage, message):
    if breakage == "root":
        host.update(uid=0)
    elif breakage == "memory":
        host.meminfo.write_text("MemAvailable: 1000000 kB\n")
    elif breakage == "upstream":
        host.upstream.unlink()
    else:
        host.site.write_text("location / { proxy_pass http://127.0.0.1:8000; }\n")
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 2, result.stdout + result.stderr
    assert message in result.stdout
    assert steps(host.events()) == []


def test_rollback_redeploys_the_recorded_previous_release(host):
    assert host.run("ghcr.io/x@sha256:new", NEW).returncode == 0
    host.clear_events()
    result = host.run("--rollback")
    assert result.returncode == 0, result.stdout + result.stderr
    assert [c["sha"] for c in host.containers("privatools")] == [OLD]
    assert (host.root / ".privatools-deploy.previous").read_text().split() == ["sha256:new", NEW]
    assert steps(host.events())[0] == ("compose", "privatools-interim", "up")


def test_disabled_jobs_send_no_supervisor_signals(host):
    host.update(jobs=False)
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 0, result.stdout + result.stderr
    assert not [a for a in steps(host.events()) if a[0] == "kill"]


# ── re-review item 1: nothing ungated takes traffic ──────────────────────────

def leftover_interim(host, image="sha256:leftover"):
    """What a run killed in phase 1 leaves: an interim that never passed the gates.

    It answers /readyz but fails the page probe, the worst case.
    """
    host.world["images"][image] = {"pages": False}
    host.world["containers"]["c09privatoolsinterim"] = {
        "project": "privatools-interim", "image": image, "sha": "c" * 40, "port": host.interim_port,
        "status": "running", "role": "standby", "passive": False, "restarts": 0, "booted": True, "boot_polls": 0}


def test_one_failed_probe_never_routes_traffic_to_a_leftover_interim(host):
    leftover_interim(host)
    host.world["flaky_ready"] = {str(host.canonical_port): 1}   # one 503 under load
    host.save()
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 0, result.stdout + result.stderr
    assert not host.switched_to("sha256:leftover"), "an interim that never passed the gates took traffic"
    assert "left an interim container behind" in result.stdout
    [canonical] = host.containers("privatools")
    assert (canonical["sha"], canonical["role"]) == (NEW, "active")


def test_a_canonical_that_stays_down_is_replaced_through_the_gates_not_by_a_leftover(host):
    leftover_interim(host)
    host.world["unready"] = ["c01privatools"]                # the running release broke for good
    host.save()
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 0, result.stdout + result.stderr
    assert not host.switched_to("sha256:leftover")
    assert "never passed" in result.stdout
    # Traffic moves only to the new release, after its gates.
    assert host.switched_to("sha256:new")
    [canonical] = host.containers("privatools")
    assert (canonical["sha"], canonical["role"]) == (NEW, "active")


# ── re-review item 2: no reload of the shared nginx unless a switch needs it ──

def test_a_degraded_state_leaves_the_shared_nginx_alone_while_it_backs_off(host):
    host.update(up_fails=["privatools"])
    assert host.run("ghcr.io/x@sha256:new", NEW).returncode == 3
    host.clear_events()
    for _ in range(3):                                     # three timer ticks
        again = host.run("ghcr.io/x@sha256:new", NEW)
        assert again.returncode == 3 and "failed less than" in again.stdout
    assert not [item for item in host.events() if item[0] == "switch"], "nginx was reloaded for nothing"


def test_only_an_interrupted_switch_is_re_applied(host):
    result = host.run("ghcr.io/x@sha256:old", OLD)
    assert result.returncode == 0 and not host.events(), "nothing to do must touch nothing"
    host.interrupted_switch(host.canonical_port, [101, 102])
    result = host.run("ghcr.io/x@sha256:old", OLD)
    assert result.returncode == 0, result.stdout + result.stderr
    assert steps(host.events()) == [("switch", host.canonical_port)]
    assert not (host.root / ".privatools-deploy.switching").exists()


def test_a_failed_re_apply_keeps_the_workers_the_interrupted_switch_retired(host):
    # Worker 301, retired by the killed run's switch, is still finishing an
    # upload. If the re-apply fails too, the record must still name it, or a
    # later drain would take its late request for misrouting.
    host.interrupted_switch(host.canonical_port, [301])
    host.world["nginx"]["retired"] = {"301": 10 ** 6}
    host.world["switch_fails_to"] = host.canonical_port
    host.save()
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 2, result.stdout + result.stderr
    record = (host.root / ".privatools-deploy.switching").read_text().split()
    assert record[0] == str(host.canonical_port) and "301" in record[1:], record


# ── re-review item 3: a failed Docker call is not a failed supervisor ────────

def test_a_failed_status_poll_inside_the_cut_over_soak_is_asked_again_not_an_outage(host):
    host.world["images"]["sha256:old"] = {"legacy": True}
    host.world["flaky"] = {"project": "privatools-interim", "after_active": True, "status": 1}
    host.save()
    result = host.run("ghcr.io/x@sha256:new", NEW, HANDOVER_SOAK="1")
    assert result.returncode == 0, result.stdout + result.stderr
    actions = steps(host.events())
    assert ("compose", "privatools-interim", "stop") not in actions, "the interim nginx routes to was stopped"
    assert ("start", "privatools") not in actions
    [canonical] = host.containers("privatools")
    assert (canonical["sha"], canonical["role"]) == (NEW, "active")


def test_a_failed_docker_inspect_inside_the_soak_is_not_taken_for_a_restart(host):
    host.world["flaky"] = {"project": "privatools-interim", "after_active": True, "inspect": 1}
    host.save()
    result = host.run("ghcr.io/x@sha256:new", NEW, HANDOVER_SOAK="1")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "REJECTED" not in result.stdout


def test_cut_over_whose_supervisor_never_takes_the_queue_keeps_serving_and_reports_degraded(host):
    # Its web server is healthy and serves, so stopping it to bring the old
    # release back would be an outage. It serves, degraded, and is retried.
    host.world["images"]["sha256:old"] = {"legacy": True}
    host.world["images"]["sha256:new"] = {"never_takes_lock": True}
    host.save()
    result = host.run("ghcr.io/x@sha256:new", NEW, HANDOVER_CONFIRM="2")
    assert result.returncode == 3, result.stdout + result.stderr
    actions = steps(host.events())
    assert ("compose", "privatools-interim", "stop") not in actions
    assert host.live_port() == host.interim_port and host.load()["nginx"]["port"] == host.interim_port
    assert (host.root / ".privatools-deploy.previous").read_text().split() == ["sha256:old", OLD]
    [old] = host.containers("privatools")
    assert old["status"] == "exited", "stopped for the new supervisor, but kept"


def test_run_resumed_after_a_killed_cut_over_stops_the_old_release_once_idle(host):
    # The cut-over run died after its switch. v2.6.1 still runs and holds the
    # queue; it cannot drain, so it is stopped once idle, as the cut-over
    # would have done, never left holding the lock.
    host.world["images"]["sha256:old"] = {"legacy": True}
    host.set_upstream(host.interim_port)
    host.world["nginx"]["port"] = host.interim_port
    host.world["containers"]["c09privatoolsinterim"] = {
        "project": "privatools-interim", "image": "sha256:new", "sha": NEW, "port": host.interim_port,
        "status": "running", "role": "standby", "passive": False, "restarts": 0, "booted": True, "boot_polls": 0}
    host.save()
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 0, result.stdout + result.stderr
    actions = steps(host.events())
    assert actions.index(("stop", "privatools")) < actions.index(("compose", "privatools", "up"))
    assert (host.root / ".privatools-deploy.previous").read_text().split() == ["sha256:old", OLD]
    [canonical] = host.containers("privatools")
    assert (canonical["sha"], canonical["role"]) == (NEW, "active")


# ── re-review nit 4: only this deploy's nginx workers are waited for ──────────

def test_drains_wait_only_for_the_nginx_workers_this_deploy_retired(host):
    # Another site's reload left a worker shutting down, held open by a
    # long-lived connection there. It never talks to PrivaTools' containers.
    host.world["nginx"]["retired"] = {"401": 10 ** 6}
    host.save()
    result = host.run("ghcr.io/x@sha256:new", NEW, DRAIN_MAX="20", DRAIN_EXTRA="1")
    assert result.returncode == 0, result.stdout + result.stderr
    assert "still open" not in result.stdout
    drains = [int(line.split("drained after ")[1].split("s")[0]) for line in result.stdout.splitlines()
              if "drained after" in line]
    assert len(drains) == 2 and max(drains) < 20, drains      # neither waited for DRAIN_MAX


# ── re-review nit 5: the page probe asks for the public host name ────────────

def test_the_page_probe_asks_for_the_public_host_name(host):
    host.world["images"]["sha256:new"] = {"rejects_host": "privatools.me"}   # e.g. a TRUSTED_HOSTS slip
    host.save()
    result = host.run("ghcr.io/x@sha256:new", NEW)
    assert result.returncode == 1, result.stdout + result.stderr
    assert "failed the real-page probe" in result.stdout
    assert ("switch", host.interim_port) not in steps(host.events())


# ── the files the rollout relies on (review item 14: stable interfaces) ──────

def test_ports_and_privilege_are_consistent_across_the_deploy_files():
    rollout = ROLLOUT.read_text()
    helper = HELPER.read_text()
    sudoers = (ROOT / "deploy/oracle-vm/privatools-deploy.sudoers").read_text()
    assert 'CANONICAL_PORT="${CANONICAL_PORT:-8000}"' in rollout
    assert 'INTERIM_PORT="${INTERIM_PORT:-8001}"' in rollout
    assert 'ALLOWED_PORTS="8000 8001"' in helper
    rule = next(line for line in sudoers.splitlines() if line.startswith("ubuntu "))
    assert rule == ("ubuntu ALL=(root) NOPASSWD: /usr/local/sbin/privatools-nginx-upstream set 8000, "
                    "/usr/local/sbin/privatools-nginx-upstream set 8001")
    assert 'NGINX_SWITCH="${NGINX_SWITCH:-sudo -n /usr/local/sbin/privatools-nginx-upstream set}"' in rollout
    unit = (ROOT / "deploy/oracle-vm/privatools-auto-deploy.service").read_text()
    assert "NoNewPrivileges" not in unit.replace("NoNewPrivileges=:", "")
    # Never an image prune: the replaced image is the rollback image.
    for path in ("rollout.sh", "auto-deploy.sh", "deploy.sh"):
        code = [line for line in (ROOT / "deploy/oracle-vm" / path).read_text().splitlines()
                if not line.lstrip().startswith("#")]
        assert not [line for line in code if "docker" in line and "prune" in line], path


def test_the_interfaces_the_installed_rollout_reads_from_a_release():
    rollout = ROLLOUT.read_text()
    # The page probe's command line.
    probe = (ROOT / "scripts/ci/probe-image.py").read_text()
    assert '--running "$1" --url "http://127.0.0.1:$2" --sha "$3"' in rollout
    assert "--running CONTAINER --url BASE_URL --sha BUILD_SHA" in probe
    # The Host the probe sends: an environment variable, which older probes ignore.
    assert 'PRIVATOOLS_PROBE_HOST="$PROBE_HOST"' in rollout and '"PRIVATOOLS_PROBE_HOST"' in probe
    # The status command and the keys it parses.
    assert 'STATUS_MODULE="${STATUS_MODULE:-backend.app.job_handover}"' in rollout
    from backend.app import job_handover
    report = job_handover.status()
    assert set(report) >= {"enabled", "local", "running_jobs", "queued_jobs"}
    for key in ('state.get("enabled")', 'local.get("role")', 'local.get("passive")', 'local.get("alive")',
                '"running_jobs"', '"queued_jobs"'):
        assert key in rollout, key
    # The compose variables and the overlay file.
    compose = (ROOT / "docker-compose.yml").read_text()
    assert '- "127.0.0.1:${PRIVATOOLS_HOST_PORT:-8000}:8000"' in compose
    interim = (ROOT / "deploy/oracle-vm/compose.interim.yml").read_text()
    for volume in ("app-temp", "app-data"):
        block = interim.split(f"  {volume}:\n", 1)[1].split("\n  app-", 1)[0]
        assert "external: true" in block
    assert "${PRIVATOOLS_DATA_VOLUME:?" in interim and "${PRIVATOOLS_TEMP_VOLUME:?" in interim
    # The drain and resume signals the launcher relays to the supervisor.
    launcher = (ROOT / "backend/app/launcher.py").read_text()
    assert "signal.SIGUSR1, signal.SIGUSR2" in launcher
    worker = (ROOT / "backend/app/api_v1/jobs/worker.py").read_text()
    assert "signal.signal(signal.SIGUSR1,control.request_drain)" in worker
    assert "signal.signal(signal.SIGUSR2,control.request_resume)" in worker


# ── the root helper, through its unprivileged testing hook ───────────────────

class ReadyServer:
    """A stand-in app port: /readyz answers ready (or 503 when not ready)."""

    def __init__(self, ready=True):
        state = {"ready": ready}

        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                body = json.dumps({"status": "ready" if state["ready"] else "degraded"}).encode()
                self.send_response(200 if state["ready"] else 503)
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_):
                pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


@pytest.fixture
def ports():
    servers = [ReadyServer(), ReadyServer(), ReadyServer(ready=False)]
    yield [server.port for server in servers]
    for server in servers:
        server.close()


def run_helper(tmp_path, ports, *args, test="true", reload="true", background=False):
    env = {**os.environ, "PRIVATOOLS_UPSTREAM_FILE": str(tmp_path / "up.conf"),
           "PRIVATOOLS_UPSTREAM_LOCK": str(tmp_path / "helper.lock"),
           "PRIVATOOLS_ALLOWED_PORTS": " ".join(map(str, ports)), "PRIVATOOLS_NGINX_TEST": test,
           "PRIVATOOLS_NGINX_RELOAD": reload}
    command = [bash(), str(HELPER), *map(str, args)]
    if background:
        return subprocess.Popen(command, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    return subprocess.run(command, env=env, capture_output=True, text=True, timeout=30)


def shown(tmp_path, ports):
    return run_helper(tmp_path, ports, "show").stdout.strip()


def script(tmp_path, name, body):
    """The helper splits its commands on whitespace, like the real ones: use a file."""
    path = tmp_path / name
    path.write_text(f"#!/bin/sh\n{body}\n")
    path.chmod(0o755)
    return str(path)


@pytest.fixture
def helper_env(tmp_path):
    if os.geteuid() == 0:
        pytest.skip("the testing hook is ignored as root, by design")
    shipped = (ROOT / "deploy/oracle-vm/privatools-upstream.conf").read_text()
    return shipped


def test_helper_switches_only_to_ready_privatools_ports_and_restores_on_failure(tmp_path, ports, helper_env):
    a, b, down = ports
    (tmp_path / "up.conf").write_text(helper_env.replace("8000", str(a)))
    assert run_helper(tmp_path, ports, "set", b).returncode == 0
    assert f"server 127.0.0.1:{b};" in (tmp_path / "up.conf").read_text()
    assert shown(tmp_path, ports) == str(b)

    for port in ("22", "8002", f"{a};", "80 01"):
        assert run_helper(tmp_path, ports, "set", port).returncode == 2
    assert shown(tmp_path, ports) == str(b)

    # Nothing ready listens there (review item 12): a stray switch would be an outage.
    refused = run_helper(tmp_path, ports, "set", down)
    assert refused.returncode == 5 and "nothing ready" in refused.stderr
    assert shown(tmp_path, ports) == str(b)
    assert run_helper(tmp_path, ports, "set", down, "--force").returncode == 2, "--force is for root only"

    # nginx -t rejects the result: the previous file is back and nothing reloads.
    marker = tmp_path / "reloaded"
    failed = run_helper(tmp_path, ports, "set", a, test="false", reload=f"touch {marker}")
    assert failed.returncode == 3 and not marker.exists()
    assert shown(tmp_path, ports) == str(b)

    # The reload itself fails: the file matches what nginx still runs.
    assert run_helper(tmp_path, ports, "set", a, reload="false").returncode == 4
    assert shown(tmp_path, ports) == str(b)

    assert run_helper(tmp_path, ports, "set", a).returncode == 0
    assert (tmp_path / "up.conf").read_text() == helper_env.replace("8000", str(a))
    assert not [p.name for p in tmp_path.iterdir() if p.name.startswith(".privatools-upstream")]


def test_helper_finishes_its_switch_when_terminated_inside_the_rename_to_reload_window(tmp_path, ports, helper_env):
    # systemctl stop, or the unit's start timeout, sends SIGTERM to every
    # process of the deploy. Inside this window the file already names the new
    # port; stopping there would leave nginx on the old one (review item 2).
    a, b, _ = ports
    (tmp_path / "up.conf").write_text(helper_env.replace("8000", str(a)))
    window, reloaded = tmp_path / "in-window", tmp_path / "reloaded"
    process = run_helper(tmp_path, ports, "set", b, test=script(tmp_path, "slow-test", f"touch {window}; sleep 1.5"),
                         reload=f"touch {reloaded}", background=True)
    deadline = time.monotonic() + 10
    while not window.exists():
        assert time.monotonic() < deadline
        time.sleep(0.02)
    process.send_signal(signal.SIGTERM)
    _, stderr = process.communicate(timeout=20)
    assert process.returncode == 0, stderr
    assert reloaded.exists() and shown(tmp_path, ports) == str(b)


def test_concurrent_switches_are_serialized(tmp_path, ports, helper_env):
    a, b, _ = ports
    (tmp_path / "up.conf").write_text(helper_env.replace("8000", str(a)))
    log = tmp_path / "order"
    first = run_helper(tmp_path, ports, "set", b, test=script(tmp_path, "test-b", f"echo test-b >> {log}; sleep 1"),
                       reload=script(tmp_path, "reload-b", f"echo reload-b >> {log}"), background=True)
    time.sleep(0.3)
    second = run_helper(tmp_path, ports, "set", a, test=script(tmp_path, "test-a", f"echo test-a >> {log}"),
                        reload=script(tmp_path, "reload-a", f"echo reload-a >> {log}"), background=True)
    assert first.wait(timeout=20) == 0 and second.wait(timeout=20) == 0
    assert log.read_text().split() == ["test-b", "reload-b", "test-a", "reload-a"]
    assert shown(tmp_path, ports) == str(a)
