"""One same-host supervisor; each transformation has its own killable process.

Run: python -m backend.app.api_v1.jobs.worker
Health: python -m backend.app.api_v1.jobs.worker --healthcheck
Deploy view: python -m backend.app.api_v1.jobs.worker --status
SIGTERM stops claims, terminates/reaps the active process group, and exits. Its
durable claim is eligible for bounded recovery on the next supervisor start.

Exactly one supervisor is active: it holds an exclusive flock on
jobs/worker.lock in the shared data volume. During a zero-downtime deploy two
containers run side by side, so a supervisor that finds the lock taken waits
as a standby instead of exiting. The deploy hands the queue over with
SIGUSR1 (drain): the active supervisor finishes its current job, stops
claiming and releases the lock, then waits as a passive standby that retakes
the lock only if no supervisor has heartbeated for lease_seconds. SIGUSR2
(resume) makes a passive standby eager again. The handover interrupts no job
and cannot run one twice, because only the lock holder claims.
"""
from __future__ import annotations

import argparse
from collections.abc import Callable
import fcntl
import json
import os
from pathlib import Path
import signal
import shutil
import sqlite3
import subprocess
import sys
import threading
import time

from ... import job_handover
from ...job_handover import StateReporter
from . import config, storage
from .adapters import execute

__all__ = ["StateReporter", "Control", "acquire", "serve", "run_supervisor", "run_job", "status", "main"]


def terminate_group(process: subprocess.Popen, grace: float = 1.0) -> None:
    """Kill the session including native grandchildren, then reap its leader."""
    try:
        os.killpg(process.pid,signal.SIGTERM)
    except ProcessLookupError:
        pass
    try:
        process.wait(timeout=grace)
    except subprocess.TimeoutExpired:
        pass
    # A leader can exit while a native child ignores SIGTERM.
    try:
        os.killpg(process.pid,signal.SIGKILL)
    except ProcessLookupError:
        pass
    process.wait(timeout=5)


def child_environment(scratch: Path) -> dict[str,str]:
    allowed = ("PATH","LANG","LC_ALL","SYSTEMROOT","U2NET_HOME","XDG_CACHE_HOME","NUMBA_DISABLE_JIT")
    env = {key:os.environ[key] for key in allowed if key in os.environ}
    env.update({"TEMP_DIR":str(scratch),"TMPDIR":str(scratch),"PYTHONPATH":str(Path(__file__).resolve().parents[4]),
                "OMP_NUM_THREADS":"1","OPENBLAS_NUM_THREADS":"1","MKL_NUM_THREADS":"1",
                "PRIVATOOLS_JOB_SUPERVISOR_PID":str(os.getpid())})
    return env


def run_job(row: dict, stop: threading.Event, *, accepting: Callable[[], bool] = lambda: True,
            tick: Callable[[], None] = lambda: None) -> None:
    """Run one claimed job to its end. Only stop interrupts it; a drain does not."""
    identifier,token = row["id"],row["claim"]
    directory = storage.job_dir(identifier).resolve()
    scratch = directory/token
    scratch.mkdir(mode=0o700)
    spec = {"operation":row["operation"],"options":json.loads(row["options"]),
            "inputs":[str(directory/"inputs"/item["name"]) for item in json.loads(row["inputs"])],
            "max_result_bytes":config.LIMITS.result_bytes,"runtime_seconds":config.LIMITS.runtime_seconds}
    request_file = scratch/"request.json"
    request_file.write_text(json.dumps(spec),encoding="utf-8")
    process = subprocess.Popen([sys.executable,"-m","backend.app.api_v1.jobs.worker","--execute",str(request_file)],
                               env=child_environment(scratch),start_new_session=True,
                               stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    deadline = time.monotonic()+config.LIMITS.runtime_seconds
    error = None
    interrupted = False
    try:
        while process.poll() is None:
            if stop.is_set():
                interrupted = True
                break
            if not storage.renew(identifier,token):
                error = "job_canceled"
                break
            storage.heartbeat(accepting=accepting())
            tick()
            if time.monotonic()>=deadline:
                error = "job_timeout"
                break
            stop.wait(0.5)
    finally:
        # Also kills lingering grandchildren if the Python leader exited.
        terminate_group(process)
    if interrupted:
        # The process group has been reaped; only the durable original inputs
        # are needed for a retry. Never accumulate one scratch tree per deploy.
        shutil.rmtree(scratch,ignore_errors=True)
        with storage.connection(write=True) as conn:
            conn.execute("UPDATE api_async_jobs SET state=CASE WHEN state='running' THEN 'queued' ELSE state END, "
                         "claim=NULL,lease_until=NULL WHERE id=? AND claim=?",(identifier,token))
        return
    if error or process.returncode:
        storage.finish(identifier,token,error=error or "job_processing_failed")
    else:
        try:
            manifest = json.loads((scratch/"manifest.json").read_text(encoding="utf-8"))
            if manifest.get("refused") in storage.REFUSALS:
                # The child could not read an input (input_refusal).
                storage.finish(identifier,token,error=manifest["refused"])
            else:
                storage.finish(identifier,token,output=Path(manifest["output"]))
        except (OSError,ValueError,KeyError,AttributeError,storage.JobError):
            storage.finish(identifier,token,error="job_processing_failed")
    # Cancellation keeps files until this function has killed/reaped the child.
    current = storage.lookup(identifier,row["key_id"])
    if current["state"] != "succeeded" and current["claim"] is None:
        storage.purge_files(identifier)


def execute_child(request_file: Path) -> int:
    """No API credentials or database path are passed into the transformation."""
    import resource
    # Linux immediately kills the direct child if a supervisor dies abruptly.
    # The first adapters do not spawn external programs. Process-group cleanup
    # remains mandatory before adding OCR/Office/media adapters.
    if sys.platform.startswith("linux"):
        import ctypes
        parent = int(os.environ.get("PRIVATOOLS_JOB_SUPERVISOR_PID","0"))
        if not parent or os.getppid()!=parent:
            return 1
        ctypes.CDLL(None,use_errno=True).prctl(1,signal.SIGKILL)
        if os.getppid()!=parent:
            return 1
    spec = json.loads(request_file.read_text(encoding="utf-8"))
    resource.setrlimit(resource.RLIMIT_FSIZE,(spec["max_result_bytes"],spec["max_result_bytes"]))
    resource.setrlimit(resource.RLIMIT_CPU,(spec["runtime_seconds"],spec["runtime_seconds"]+1))
    # Address-space limit is Linux-only: Darwin maps shared libraries much more
    # sparsely. Production also inherits the existing aggregate container cap.
    if sys.platform.startswith("linux"):
        resource.setrlimit(resource.RLIMIT_AS,(1024*1024*1024,1024*1024*1024))
    scratch = request_file.parent.resolve()
    try:
        output = execute(spec["operation"],spec["options"],spec["inputs"],scratch)
    except Exception as exc:
        refusal = input_refusal(exc)
        if refusal is None:
            raise  # the job's own failure: exit status 1
        manifest = {"refused":refusal}
    else:
        manifest = {"output":str(output.resolve())}
    (scratch/"manifest.json").write_text(json.dumps(manifest),encoding="utf-8")
    return 0


def input_refusal(exc: BaseException) -> str | None:
    """The job's error code for an input the PDF libraries cannot read, or None.

    A synchronous call answers such a file with a 400, damaged or needing a
    password, in the standard words (utils.pdf_errors); a job fails with the
    matching code in storage.REFUSALS, whose message is those words. Anything
    else is the job's own failure. Runs in the child, which holds the error.
    """
    from ...utils.pdf_errors import pdf_read_error
    answer = pdf_read_error(exc)
    if answer is None or answer[0] != 400:
        return None
    return "job_input_password_protected" if "password" in answer[1].lower() else "job_input_damaged"


def status() -> dict:
    """The deploy's view (job_handover.status) of the database this process uses."""
    return job_handover.status(storage.store.DB_PATH)


class Control:
    """Signal-driven intent, read by the supervisor loop between steps."""

    def __init__(self) -> None:
        self.stop = threading.Event()
        self.wake = threading.Event()
        self.drain = False
        self.passive = False

    def request_stop(self, *_args) -> None:
        self.stop.set()
        self.wake.set()

    def request_drain(self, *_args) -> None:
        self.drain = True
        self.passive = True
        self.wake.set()

    def request_resume(self, *_args) -> None:
        self.passive = False
        self.wake.set()

    def pause(self, seconds: float) -> None:
        self.wake.wait(seconds)
        self.wake.clear()


def acquire(lock, control: Control, report: StateReporter) -> bool:
    """Wait as a standby until this supervisor holds the singleton lock.

    An eager standby (a fresh start, or after SIGUSR2) takes the lock as soon
    as it is free. A passive one (after SIGUSR1) leaves it to its successor and
    retakes it only when no supervisor has heartbeated for lease_seconds, so a
    handover whose successor never arrives heals itself. The flock, not the
    heartbeat, decides ownership. Returns False when asked to stop first.
    """
    while not control.stop.is_set():
        take = not control.passive
        if not take:
            try:
                age = storage.heartbeat_age()
            except sqlite3.Error:
                age = 0.0
            take = age is None or age > config.LIMITS.lease_seconds
        if take:
            try:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                # Holding the lock again (a resume or a self-heal) cancels
                # any drain that arrived while this supervisor stood by.
                control.passive = control.drain = False
                return True
            except BlockingIOError:
                pass
        report("standby", passive=control.passive)
        control.pause(0.5)
    return False


def serve(control: Control, report: StateReporter) -> None:
    """Claim and run jobs until stopped or drained. A drain waits for the current job."""
    while not control.stop.is_set() and not control.drain:
        storage.recover_and_sweep()
        storage.heartbeat()
        report("active")
        row = storage.claim()
        if row:
            run_job(row, control.stop, accepting=lambda: not control.drain,
                    tick=lambda: report("draining" if control.drain else "active"))
        else:
            control.pause(1)


def run_supervisor(control: Control, report: StateReporter) -> None:
    """Stand by, serve while holding the singleton lock, and stand by again after a drain."""
    with (config.root()/"worker.lock").open("a") as lock:
        # A web maintenance sweep may briefly own this lock while no
        # supervisor exists, and during a deploy the other container's
        # supervisor owns it until it has drained: wait as a standby.
        while acquire(lock, control, report):
            try:
                serve(control, report)
            finally:
                # accepting=0 is written before the lock is free, so no
                # reader sees a released queue still advertised as served.
                storage.heartbeat(accepting=False)
                fcntl.flock(lock,fcntl.LOCK_UN)
                control.drain = False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--healthcheck",action="store_true")
    parser.add_argument("--status",action="store_true")
    parser.add_argument("--execute",type=Path)
    args = parser.parse_args()
    if args.execute:
        return execute_child(args.execute)
    if args.healthcheck:
        return 0 if storage.capability()["available"] else 1
    if args.status:
        print(json.dumps(status(),sort_keys=True))
        return 0
    if not config.enabled():
        return 0
    # Handlers first. The launcher starts this process with SIGUSR1/SIGUSR2
    # ignored, so a drain sent during imports is dropped rather than fatal;
    # from here on it is honoured, and init_schema() can take a while.
    control = Control()
    for sig in (signal.SIGTERM,signal.SIGINT):
        signal.signal(sig,control.request_stop)
    signal.signal(signal.SIGUSR1,control.request_drain)
    signal.signal(signal.SIGUSR2,control.request_resume)
    storage.init_schema()
    report = StateReporter()
    try:
        run_supervisor(control, report)
    finally:
        report.clear()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
