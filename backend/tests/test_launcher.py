"""Exercise supervisor failure and shutdown using real, inert child processes."""

import json
from pathlib import Path
import signal
import subprocess
import sys
import time

from backend.app import launcher


def child_commands(tmp_path: Path, *, fail: bool) -> list[list[str]]:
    waiting = (
        "import pathlib,signal,time,sys; "
        f"p=pathlib.Path({str(tmp_path / 'web-state')!r}); "
        "signal.signal(signal.SIGTERM, lambda *_: (p.write_text('stopped'),sys.exit(0))); "
        "p.write_text('started'); time.sleep(15)"
    )
    worker = "import time,sys; time.sleep(0.5); sys.exit(7)" if fail else waiting.replace("web-state", "worker-state")
    return [[sys.executable, "-c", worker], [sys.executable, "-c", waiting]]


def start_supervisor(tmp_path, *, fail):
    code = (
        "from backend.app.launcher import supervise; "
        f"raise SystemExit(supervise({child_commands(tmp_path, fail=fail)!r}, grace_seconds=2))"
    )
    return subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def test_worker_failure_stops_web_and_returns_failure(tmp_path):
    process = start_supervisor(tmp_path, fail=True)
    _, stderr = process.communicate(timeout=6)
    assert process.returncode == 7, stderr.decode()
    assert (tmp_path / "web-state").read_text() == "stopped"


def test_sigterm_drains_both_children(tmp_path):
    process = start_supervisor(tmp_path, fail=False)
    try:
        deadline = time.monotonic() + 4
        while not all((tmp_path / name).exists() for name in ("web-state", "worker-state")):
            assert time.monotonic() < deadline
            time.sleep(0.02)
        process.send_signal(signal.SIGTERM)
        _, stderr = process.communicate(timeout=5)
        assert process.returncode == 0, stderr.decode()
        assert (tmp_path / "web-state").read_text() == "stopped"
        assert (tmp_path / "worker-state").read_text() == "stopped"
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()


def test_drain_and_resume_signals_reach_only_the_job_worker(tmp_path):
    # SIGUSR1's default action terminates a process, so a web server that got
    # it would die. The deploy signals the container (the launcher is its
    # PID 1); only the worker may receive the relay.
    worker = (
        "import pathlib,signal,sys,time; "
        f"p=pathlib.Path({str(tmp_path / 'worker-signals')!r}); "
        "record=lambda s,_: p.open('a').write(signal.Signals(s).name+'\\n'); "
        "signal.signal(signal.SIGUSR1, record); signal.signal(signal.SIGUSR2, record); "
        "signal.signal(signal.SIGTERM, lambda *_: sys.exit(0)); "
        "p.write_text(''); time.sleep(15)"
    )
    web = (
        "import pathlib,signal,sys,time; "
        f"p=pathlib.Path({str(tmp_path / 'web-state')!r}); "
        "signal.signal(signal.SIGTERM, lambda *_: (p.write_text('stopped'),sys.exit(0))); "
        "p.write_text('started'); time.sleep(15)"
    )
    code = (
        "from backend.app.launcher import supervise; "
        f"raise SystemExit(supervise({[[sys.executable, '-c', worker], [sys.executable, '-c', web]]!r}, "
        "grace_seconds=2, relay_to=0))"
    )
    process = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        deadline = time.monotonic() + 4
        while not all((tmp_path / name).exists() for name in ("web-state", "worker-signals")):
            assert time.monotonic() < deadline
            time.sleep(0.02)
        # One signal at a time: Python runs the handler of a signal that lands
        # while another handler is running first, so two sent back to back
        # were sometimes relayed and recorded in the opposite order. The
        # deploy never sends them together.
        for expected in (["SIGUSR1"], ["SIGUSR1", "SIGUSR2"]):
            process.send_signal(getattr(signal, expected[-1]))
            deadline = time.monotonic() + 4
            while (tmp_path / "worker-signals").read_text().split() != expected:
                assert time.monotonic() < deadline, (tmp_path / "worker-signals").read_text()
                time.sleep(0.02)
        assert process.poll() is None
        assert (tmp_path / "web-state").read_text() == "started"
        process.send_signal(signal.SIGTERM)
        _, stderr = process.communicate(timeout=5)
        assert process.returncode == 0, stderr.decode()
        assert (tmp_path / "web-state").read_text() == "stopped"
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()


def test_deploy_signals_that_arrive_before_the_worker_is_ready_are_harmless(tmp_path):
    # The worker installs its handlers only after its imports; until then a
    # relayed SIGUSR1/SIGUSR2 had its default action and killed it, and the
    # launcher then stopped the web server too. Children now start with both
    # ignored, and the worker replaces that with its handlers when it is ready.
    worker = (
        "import pathlib,signal,sys,time; "
        f"p=pathlib.Path({str(tmp_path / 'worker-signals')!r}); "
        "time.sleep(1.0); "
        "record=lambda s,_: p.open('a').write(signal.Signals(s).name+'\\n'); "
        "signal.signal(signal.SIGUSR1, record); "
        "signal.signal(signal.SIGTERM, lambda *_: sys.exit(0)); "
        "p.write_text('ready\\n'); time.sleep(15)"
    )
    web = (
        "import pathlib,signal,sys,time; "
        f"p=pathlib.Path({str(tmp_path / 'web-state')!r}); "
        "signal.signal(signal.SIGTERM, lambda *_: (p.write_text('stopped'),sys.exit(0))); "
        "p.write_text('started'); time.sleep(15)"
    )
    code = (
        "from backend.app.launcher import supervise; "
        f"raise SystemExit(supervise({[[sys.executable, '-c', worker], [sys.executable, '-c', web]]!r}, "
        "grace_seconds=2, relay_to=0))"
    )
    process = subprocess.Popen([sys.executable, "-c", code], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    try:
        deadline = time.monotonic() + 4
        while not (tmp_path / "web-state").exists():
            assert time.monotonic() < deadline
            time.sleep(0.02)
        process.send_signal(signal.SIGUSR1)  # before the worker's handler exists
        deadline = time.monotonic() + 5
        while not (tmp_path / "worker-signals").exists():
            assert time.monotonic() < deadline
            assert process.poll() is None, process.communicate()[1].decode()
            time.sleep(0.02)
        process.send_signal(signal.SIGUSR1)  # after
        deadline = time.monotonic() + 4
        while (tmp_path / "worker-signals").read_text().split() != ["ready", "SIGUSR1"]:
            assert time.monotonic() < deadline, (tmp_path / "worker-signals").read_text()
            time.sleep(0.02)
        assert process.poll() is None
        assert (tmp_path / "web-state").read_text() == "started"
        process.send_signal(signal.SIGTERM)
        _, stderr = process.communicate(timeout=5)
        assert process.returncode == 0, stderr.decode()
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()


def test_enabled_jobs_relay_deploy_signals_to_the_worker(monkeypatch):
    monkeypatch.setenv("API_V1_JOBS_ENABLED", "true")
    calls = []
    monkeypatch.setattr(launcher, "supervise", lambda commands, **kwargs: calls.append((commands, kwargs)) or 0)
    assert launcher.main() == 0
    commands, kwargs = calls[0]
    assert commands[kwargs["relay_to"]][-1] == "backend.app.api_v1.jobs.worker"


def test_disabled_jobs_exec_the_existing_web_command(monkeypatch):
    monkeypatch.setenv("API_V1_JOBS_ENABLED", "false")
    calls = []

    def execv(binary, args):
        calls.append((binary, args))
        raise SystemExit(0)

    monkeypatch.setattr(launcher.os, "execv", execv)
    try:
        launcher.main()
    except SystemExit:
        pass
    assert calls == [(sys.executable, launcher.web_command())]
    assert calls[0][1][calls[0][1].index("--workers") + 1] == "2"


def test_container_uses_launcher_and_preserves_combined_resource_limits():
    root = Path(__file__).resolve().parents[2]
    dockerfile = (root / "Dockerfile").read_text()
    command = next(line[4:] for line in dockerfile.splitlines() if line.startswith("CMD "))
    assert json.loads(command) == ["python", "-m", "backend.app.launcher"]
    compose = (root / "docker-compose.yml").read_text()
    assert "memory: 4G" in compose and "cpus: '1.8'" in compose
    assert "stop_grace_period: 45s" in compose
