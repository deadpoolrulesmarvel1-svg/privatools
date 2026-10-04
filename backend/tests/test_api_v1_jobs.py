"""Durable jobs use synthetic identities and PDFs; never production resources."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import threading
import time

from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from backend.app import job_handover, store
from backend.app.api_v1 import quota
from backend.app.api_v1.body_accounting import V1AccountingMiddleware
from backend.app.api_v1.jobs import config, storage
from backend.app.api_v1.jobs.router import router
from backend.app.api_v1.jobs.worker import child_environment, run_job, terminate_group
from backend.app.api_v1.jobs import worker
from backend.app.auth import accounts


@pytest.fixture
def jobs(tmp_path,monkeypatch):
    store.reset_for_tests(tmp_path)
    monkeypatch.setenv("API_V1_JOBS_ENABLED","true")
    monkeypatch.setenv("PRIVATOOLS_BUILD_SHA","jobs-test-build")
    # The supervisor's per-container state file; never the host's /tmp.
    monkeypatch.setenv("API_V1_JOBS_WORKER_STATE",str(tmp_path/"worker-state.json"))
    storage.init_schema()
    storage.heartbeat()
    user = accounts.create_user("job-tests@example.com","synthetic-long-password")
    raw,key = accounts.issue_api_key(user.id,"synthetic job tests")
    app = FastAPI()
    app.include_router(router,prefix="/api/v1")
    app.add_middleware(V1AccountingMiddleware)
    with TestClient(app) as client:
        yield client,raw,key
    store.reset_for_tests(tmp_path)


def submit(jobs,pdf,*,operation="grayscale",options="{}",idempotency="request-1",raw=None):
    client,secret,_ = jobs
    files = [("files",("input.pdf",pdf,"application/pdf"))]
    if operation=="merge":
        files *= 2
    return client.post("/api/v1/jobs",headers={"X-API-Key":raw or secret,"Idempotency-Key":idempotency},
                       data={"operation":operation,"options":options},files=files)


def headers(jobs):
    return {"X-API-Key":jobs[1]}


def test_feature_and_worker_must_be_ready(jobs,sample_pdf,monkeypatch):
    monkeypatch.setenv("API_V1_JOBS_ENABLED","false")
    assert submit(jobs,sample_pdf).status_code==503
    monkeypatch.setenv("API_V1_JOBS_ENABLED","true")
    storage.heartbeat(now=time.time()-100)
    assert submit(jobs,sample_pdf).json()["code"]=="jobs_unavailable"
    storage.heartbeat()
    monkeypatch.setenv("PRIVATOOLS_BUILD_SHA","different-build")
    assert not storage.capability()["available"]


def test_validated_submission_is_durable_and_charges_actual_multipart(jobs,sample_pdf):
    response = submit(jobs,sample_pdf)
    assert response.status_code==202,response.text
    body = response.json()
    row = storage.lookup(body["id"],jobs[2].key_id)
    assert row["state"]=="queued"
    assert (storage.job_dir(row["id"])/"inputs"/"0.pdf").read_bytes()==sample_pdf
    usage = quota.peek(jobs[2].key_id)
    assert usage.units_used==quota.cost_for("/api/v1/grayscale")
    assert usage.bytes_used>len(sample_pdf)
    with storage.connection() as conn:
        assert conn.execute("PRAGMA synchronous").fetchone()[0]==2
        assert conn.execute("SELECT COUNT(*) FROM api_async_ingest").fetchone()[0]==0


def test_invalid_options_or_unsupported_operation_never_charge(jobs,sample_pdf):
    for operation,options in [("ocr","{}"),("grayscale",'{"anything":true}'),("compress",'{"level":"custom"}')]:
        assert submit(jobs,sample_pdf,operation=operation,options=options).status_code in (400,422)
    assert quota.peek(jobs[2].key_id).units_used==0
    assert not [p for p in config.root().iterdir() if p.is_dir()]


def test_duplicate_and_conflict_are_scoped_to_fingerprint(jobs,sample_pdf):
    first = submit(jobs,sample_pdf)
    before = quota.peek(jobs[2].key_id)
    again = submit(jobs,sample_pdf)
    assert again.status_code==202,again.text
    assert again.json()["id"]==first.json()["id"]
    assert again.headers["Idempotency-Replayed"]=="true"
    assert quota.peek(jobs[2].key_id)==before
    conflict = submit(jobs,sample_pdf,operation="compress")
    assert conflict.status_code==409
    assert conflict.json()["code"]=="idempotency_conflict"


def test_duplicate_replay_works_when_key_queue_is_full_or_worker_is_down(jobs,sample_pdf,monkeypatch):
    monkeypatch.setattr(config,"LIMITS",replace(config.LIMITS,per_key=1))
    first = submit(jobs,sample_pdf)
    before = quota.peek(jobs[2].key_id)
    assert submit(jobs,sample_pdf,idempotency="different-job").status_code==429
    storage.heartbeat(accepting=False)
    replay = submit(jobs,sample_pdf)
    assert replay.status_code==202,replay.text
    assert replay.json()["id"]==first.json()["id"]
    assert quota.peek(jobs[2].key_id)==before


def test_duplicate_acceptance_race_has_one_job_and_receipt(jobs,sample_pdf):
    key = jobs[2]
    identifiers = [storage.begin_ingest(key.key_id,key.user_id) for _ in range(2)]
    inputs = [{"name":"0.pdf","sha256":hashlib.sha256(sample_pdf).hexdigest(),"bytes":len(sample_pdf)}]
    barrier = threading.Barrier(2)
    def accept(identifier):
        barrier.wait()
        return storage.accept(identifier,key.key_id,key.user_id,"concurrent-key","grayscale",{},inputs,1234)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(accept,identifiers))
    assert len({r[0]["id"] for r in results})==1
    assert sorted(r[2] for r in results)==[False,True]
    assert quota.peek(key.key_id).units_used==1
    assert quota.peek(key.key_id).bytes_used==1234
    for identifier in identifiers:
        storage.abandon_ingest(identifier)


def test_all_job_access_is_key_scoped_and_status_is_free(jobs,sample_pdf):
    client,raw,key = jobs
    other_raw,_ = accounts.issue_api_key(key.user_id,"different key same account")
    job_id = submit(jobs,sample_pdf).json()["id"]
    before = quota.peek(key.key_id)
    assert client.get(f"/api/v1/jobs/{job_id}",headers=headers(jobs)).status_code==200
    for method,suffix in [("get",""),("get","/result"),("delete","")]:
        response = getattr(client,method)(f"/api/v1/jobs/{job_id}{suffix}",headers={"X-API-Key":other_raw})
        assert response.status_code==404,response.text
    assert quota.peek(key.key_id)==before
    assert client.get(f"/api/v1/jobs/{job_id}").status_code==401


@pytest.mark.parametrize("operation",["grayscale","compress","merge","pdf-to-text"])
def test_process_adapters_publish_retrievable_results_and_remove_inputs(jobs,sample_pdf,operation):
    response = submit(jobs,sample_pdf,operation=operation)
    assert response.status_code==202,response.text
    row = storage.claim()
    assert row is not None
    assert storage.claim() is None
    run_job(row,threading.Event())
    finished = storage.lookup(row["id"],jobs[2].key_id)
    assert finished["state"]=="succeeded",finished
    assert finished["expires"]-finished["completed"]==3600
    assert not (storage.job_dir(row["id"])/"inputs").exists()
    assert sorted(p.name for p in storage.job_dir(row["id"]).iterdir())==["result"]
    result = jobs[0].get(f'/api/v1/jobs/{row["id"]}/result',headers=headers(jobs))
    assert result.status_code==200,result.text
    if operation=="pdf-to-text":
        assert "Hello, PrivaTools" in result.json()["text"]
    else:
        assert result.content.startswith(b"%PDF")


def _cut_short() -> bytes:
    """A four-page PDF cut at a tenth, as by an interrupted download."""
    import fitz  # PyMuPDF
    doc = fitz.open()
    for i in range(4):
        doc.new_page().insert_text((72,100),f"Page {i+1}. "+"A synthetic contract. "*8,fontsize=11)
    data = doc.tobytes(garbage=0,deflate=True)
    doc.close()
    return data[:len(data)//10]


# A synchronous call answers a PDF its libraries cannot read with a 400 in the
# standard words (utils.pdf_errors); a job failed on it as "job_processing_failed",
# "The job could not be completed.", like a fault of the server's own.
REFUSED = {
    "damaged":("job_input_damaged","This PDF appears to be corrupt or invalid."),
    "locked":("job_input_password_protected","This PDF is password-protected. Unlock it first, then try again."),
}


@pytest.mark.parametrize("sample",sorted(REFUSED))
@pytest.mark.parametrize("operation",["grayscale","compress","merge","pdf-to-text"])
def test_a_job_fails_an_input_it_cannot_read_with_the_words_a_synchronous_call_gets(jobs,locked_pdf,operation,sample):
    response = submit(jobs,_cut_short() if sample=="damaged" else locked_pdf,operation=operation)
    assert response.status_code==202,response.text
    row = storage.claim()
    run_job(row,threading.Event())
    body = jobs[0].get(f'/api/v1/jobs/{row["id"]}',headers=headers(jobs)).json()
    code,message = REFUSED[sample]
    assert body["state"]=="failed",body
    assert body["error"]=={"code":code,"message":message}
    assert not storage.job_dir(row["id"]).exists()


def _child(monkeypatch,script: str) -> None:
    """Run `script` in place of the transformation child."""
    real_popen = subprocess.Popen
    def child(command,**kwargs):
        return real_popen([sys.executable,"-c",script,command[-1]],**kwargs)
    monkeypatch.setattr(worker.subprocess,"Popen",child)


def test_a_child_that_fails_otherwise_is_still_a_processing_failure(jobs,sample_pdf,monkeypatch):
    identifier = submit(jobs,sample_pdf).json()["id"]
    _child(monkeypatch,"raise SystemExit(1)")
    run_job(storage.claim(),threading.Event())
    body = jobs[0].get(f"/api/v1/jobs/{identifier}",headers=headers(jobs)).json()
    assert body["error"]=={"code":"job_processing_failed","message":"The job could not be completed."}


def test_only_a_known_refusal_is_taken_from_the_child(jobs,sample_pdf,monkeypatch):
    identifier = submit(jobs,sample_pdf).json()["id"]
    _child(monkeypatch,"import json,pathlib,sys; "
           "(pathlib.Path(sys.argv[1]).parent/'manifest.json').write_text(json.dumps({'refused':'anything_else'}))")
    run_job(storage.claim(),threading.Event())
    assert storage.lookup(identifier,jobs[2].key_id)["error_code"]=="job_processing_failed"


def test_input_refusal_reads_only_the_pdf_libraries_errors(locked_pdf):
    import io
    import pikepdf
    with pytest.raises(pikepdf.PdfError) as damaged:
        pikepdf.open(io.BytesIO(_cut_short()))
    with pytest.raises(pikepdf.PasswordError) as locked:
        pikepdf.open(io.BytesIO(locked_pdf))
    assert worker.input_refusal(damaged.value)=="job_input_damaged"
    assert worker.input_refusal(locked.value)=="job_input_password_protected"
    for own in (RuntimeError("boom"),ValueError("max_size_mb must be > 0"),OSError(28,"No space left on device")):
        assert worker.input_refusal(own) is None


def test_expiry_checked_before_sweep_and_delete_is_idempotent(jobs,sample_pdf):
    identifier = submit(jobs,sample_pdf).json()["id"]
    run_job(storage.claim(),threading.Event())
    with storage.connection(write=True) as conn:
        conn.execute("UPDATE api_async_jobs SET expires=? WHERE id=?",(time.time()-1,identifier))
    assert jobs[0].get(f"/api/v1/jobs/{identifier}",headers=headers(jobs)).json()["state"]=="expired"
    assert jobs[0].get(f"/api/v1/jobs/{identifier}/result",headers=headers(jobs)).status_code==410
    for _ in range(2):
        response = jobs[0].delete(f"/api/v1/jobs/{identifier}",headers=headers(jobs))
        assert response.status_code==200,response.text
    assert not storage.job_dir(identifier).exists()


def test_claim_recovery_is_bounded_and_fences_old_publisher(jobs,sample_pdf):
    identifier = submit(jobs,sample_pdf).json()["id"]
    first = storage.claim()
    leftover=storage.job_dir(identifier)/first["claim"]
    leftover.mkdir()
    (leftover/"unfinished-output").write_bytes(b"old result")
    with storage.connection(write=True) as conn:
        conn.execute("UPDATE api_async_jobs SET lease_until=0 WHERE id=?",(identifier,))
    storage.recover_and_sweep()
    assert not leftover.exists()
    assert (storage.job_dir(identifier)/"inputs"/"0.pdf").exists()
    second = storage.claim()
    assert second["attempts"]==2
    assert second["claim"]!=first["claim"]
    assert not storage.finish(identifier,first["claim"],error="stale_attempt")
    assert storage.lookup(identifier,jobs[2].key_id)["state"]=="running"
    with storage.connection(write=True) as conn:
        conn.execute("UPDATE api_async_jobs SET lease_until=0 WHERE id=?",(identifier,))
    storage.recover_and_sweep()
    assert storage.lookup(identifier,jobs[2].key_id)["state"]=="failed"
    assert storage.claim() is None
    assert not storage.job_dir(identifier).exists()
    assert quota.peek(jobs[2].key_id).units_used==1


def test_gracefully_requeued_attempts_cannot_exceed_retry_bound(jobs,sample_pdf):
    identifier=submit(jobs,sample_pdf).json()["id"]
    with storage.connection(write=True) as conn:
        conn.execute("UPDATE api_async_jobs SET attempts=? WHERE id=?",(config.LIMITS.attempts,identifier))
    assert storage.claim() is None
    storage.maintenance()
    assert storage.lookup(identifier,jobs[2].key_id)["state"]=="failed"


def test_active_shutdown_kills_child_preserves_inputs_and_clears_scratch(jobs,sample_pdf,monkeypatch):
    identifier=submit(jobs,sample_pdf).json()["id"]
    real_popen=subprocess.Popen
    children=[]
    def slow_child(_command,**kwargs):
        process=real_popen([sys.executable,"-c","import time; time.sleep(30)"],**kwargs)
        children.append(process)
        return process
    monkeypatch.setattr(worker.subprocess,"Popen",slow_child)
    stop=threading.Event()
    stop.set()
    row=storage.claim()
    run_job(row,stop)
    current=storage.lookup(identifier,jobs[2].key_id)
    assert current["state"]=="queued" and current["claim"] is None
    assert children[0].poll() is not None
    assert sorted(p.name for p in storage.job_dir(identifier).iterdir())==["inputs"]


def test_output_cap_prevents_publication(jobs,sample_pdf,monkeypatch):
    identifier = submit(jobs,sample_pdf).json()["id"]
    row = storage.claim()
    scratch = storage.job_dir(identifier)/row["claim"]
    scratch.mkdir()
    output = scratch/"large.pdf"
    output.write_bytes(b"x"*20)
    monkeypatch.setattr(config,"LIMITS",replace(config.LIMITS,result_bytes=10))
    storage.finish(identifier,row["claim"],output=output)
    current = storage.lookup(identifier,jobs[2].key_id)
    assert current["state"]=="failed"
    assert current["error_code"]=="job_output_too_large"
    assert not (storage.job_dir(identifier)/"result").exists()


def test_queue_storage_and_account_limits_are_atomic(jobs,monkeypatch):
    key = jobs[2]
    monkeypatch.setattr(config,"LIMITS",replace(config.LIMITS,per_key=1))
    identifier = storage.begin_ingest(key.key_id,key.user_id)
    with pytest.raises(storage.JobError,match="identity"):
        storage.begin_ingest(key.key_id,key.user_id)
    storage.abandon_ingest(identifier)
    monkeypatch.setattr(config,"LIMITS",replace(config.LIMITS,storage_bytes=1))
    with pytest.raises(storage.JobError,match="queue"):
        storage.begin_ingest(key.key_id,key.user_id)


def test_revoked_key_cannot_start_or_retrieve_job(jobs,sample_pdf):
    identifier = submit(jobs,sample_pdf).json()["id"]
    accounts.revoke_key(jobs[2].user_id,jobs[2].key_id)
    assert storage.claim() is None
    assert jobs[0].get(f"/api/v1/jobs/{identifier}",headers=headers(jobs)).status_code==401
    storage.recover_and_sweep()
    assert storage.lookup(identifier,jobs[2].key_id)["state"]=="canceled"
    assert not storage.job_dir(identifier).exists()


def test_cancel_running_prevents_publish_then_removes_artifacts(jobs,sample_pdf):
    identifier = submit(jobs,sample_pdf).json()["id"]
    row = storage.claim()
    response = jobs[0].delete(f"/api/v1/jobs/{identifier}",headers=headers(jobs))
    assert response.status_code==202
    assert storage.job_dir(identifier).exists() # still owned by executing child
    assert not storage.renew(identifier,row["claim"])
    assert not storage.finish(identifier,row["claim"],error="job_canceled")
    storage.recover_and_sweep()
    assert not storage.job_dir(identifier).exists()


def test_worker_child_does_not_receive_credentials(tmp_path,monkeypatch):
    monkeypatch.setenv("CLERK_WEBHOOK_SECRET","synthetic-sensitive-value")
    monkeypatch.setenv("GA4_API_SECRET","synthetic-sensitive-value")
    env = child_environment(tmp_path)
    assert "CLERK_WEBHOOK_SECRET" not in env and "GA4_API_SECRET" not in env
    assert env["TEMP_DIR"]==env["TMPDIR"]==str(tmp_path)


def test_process_group_timeout_terminates_and_reaps_ignoring_child():
    process = subprocess.Popen([sys.executable,"-c","import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(30)"],start_new_session=True)
    try:
        time.sleep(0.1)
        terminate_group(process,grace=0.1)
        assert process.poll() is not None
        with pytest.raises(ProcessLookupError):
            os.kill(process.pid,0)
    finally:
        if process.poll() is None:
            terminate_group(process)


def test_disabled_feature_still_expires_results_and_queued_inputs(jobs,sample_pdf,monkeypatch):
    finished = submit(jobs,sample_pdf).json()["id"]
    run_job(storage.claim(),threading.Event())
    queued = submit(jobs,sample_pdf,idempotency="queued").json()["id"]
    with storage.connection(write=True) as conn:
        conn.execute("UPDATE api_async_jobs SET expires=? WHERE id=?",(time.time()-1,finished))
        conn.execute("UPDATE api_async_jobs SET deadline=? WHERE id=?",(time.time()-1,queued))
    monkeypatch.setenv("API_V1_JOBS_ENABLED","false")
    storage.maintenance()
    assert not storage.job_dir(finished).exists()
    assert not storage.job_dir(queued).exists()
    assert storage.lookup(finished,jobs[2].key_id)["state"]=="expired"
    assert storage.lookup(queued,jobs[2].key_id)["state"]=="failed"


@pytest.mark.parametrize("reason",["deadline","delete","revoked"])
def test_disabled_maintenance_retires_abandoned_claims(jobs,sample_pdf,monkeypatch,reason):
    identifier=submit(jobs,sample_pdf).json()["id"]
    claimed=storage.claim()
    with storage.connection(write=True) as conn:
        conn.execute("UPDATE api_async_jobs SET lease_until=? WHERE id=?",(time.time()-1,identifier))
        if reason=="deadline":
            conn.execute("UPDATE api_async_jobs SET deadline=? WHERE id=?",(time.time()-1,identifier))
    monkeypatch.setenv("API_V1_JOBS_ENABLED","false")
    if reason=="delete":
        response=jobs[0].delete(f"/api/v1/jobs/{identifier}",headers=headers(jobs))
        assert response.status_code==202
        assert response.json()["deletion_pending"] is True
    elif reason=="revoked":
        accounts.revoke_key(jobs[2].user_id,jobs[2].key_id)
    assert storage.job_dir(identifier).exists()
    storage.maintenance()
    row=storage.lookup(identifier,jobs[2].key_id)
    assert row["state"]==("failed" if reason=="deadline" else "canceled")
    assert row["claim"] is None and row["lease_until"] is None
    assert row["reserved_bytes"]==0
    assert not storage.job_dir(identifier).exists()


def test_disabled_maintenance_never_retires_a_live_supervisor_claim(jobs,sample_pdf,monkeypatch):
    identifier=submit(jobs,sample_pdf).json()["id"]
    claimed=storage.claim()
    with storage.connection(write=True) as conn:
        conn.execute("UPDATE api_async_jobs SET lease_until=?,deadline=? WHERE id=?",(time.time()-1,time.time()-1,identifier))
    monkeypatch.setenv("API_V1_JOBS_ENABLED","false")
    # A stalled supervisor can have expired timestamps while it remains alive.
    # Maintenance must use the actual singleton lock, not those timestamps.
    with (config.root()/"worker.lock").open("a") as live_supervisor:
        fcntl.flock(live_supervisor,fcntl.LOCK_EX|fcntl.LOCK_NB)
        storage.maintenance()
        row=storage.lookup(identifier,jobs[2].key_id)
        assert row["state"]=="running" and row["claim"]==claimed["claim"]
        assert (storage.job_dir(identifier)/"inputs"/"0.pdf").exists()
        response=jobs[0].delete(f"/api/v1/jobs/{identifier}",headers=headers(jobs))
        assert response.status_code==202
        storage.maintenance()
        assert storage.lookup(identifier,jobs[2].key_id)["claim"]==claimed["claim"]
        assert storage.job_dir(identifier).exists()
    # Simulate the owner dying/releasing its lock: cancellation can now finish.
    storage.maintenance()
    assert storage.lookup(identifier,jobs[2].key_id)["claim"] is None
    assert not storage.job_dir(identifier).exists()


def test_disabled_maintenance_leaves_unexpired_orphan_work_recoverable(jobs,sample_pdf,monkeypatch):
    identifier=submit(jobs,sample_pdf).json()["id"]
    claimed=storage.claim()
    with storage.connection(write=True) as conn:
        conn.execute("UPDATE api_async_jobs SET lease_until=? WHERE id=?",(time.time()-1,identifier))
    monkeypatch.setenv("API_V1_JOBS_ENABLED","false")
    storage.maintenance()
    row=storage.lookup(identifier,jobs[2].key_id)
    assert row["state"]=="running" and row["claim"]==claimed["claim"]
    assert (storage.job_dir(identifier)/"inputs"/"0.pdf").exists()


def test_accounts_and_keys_are_fairly_scheduled(jobs,sample_pdf):
    _,_,key = jobs
    other_user = accounts.create_user("second-job-tests@example.com","synthetic-long-password")
    other_raw,other_key = accounts.issue_api_key(other_user.id,"other tests")
    first = submit(jobs,sample_pdf,idempotency="a1").json()["id"]
    second = submit(jobs,sample_pdf,idempotency="a2").json()["id"]
    third = submit(jobs,sample_pdf,idempotency="b1",raw=other_raw).json()["id"]
    row = storage.claim()
    assert row["id"]==first
    storage.finish(row["id"],row["claim"],error="test_complete")
    assert storage.claim()["id"]==third # another account before A's next job


def test_cross_process_duplicate_acceptance_charges_once(jobs,sample_pdf):
    key = jobs[2]
    identifiers = [storage.begin_ingest(key.key_id,key.user_id) for _ in range(2)]
    inputs = [{"name":"0.pdf","sha256":hashlib.sha256(sample_pdf).hexdigest(),"bytes":len(sample_pdf)}]
    code = """import json,sys
from pathlib import Path
from backend.app import job_handover, store
from backend.app.api_v1.jobs import storage
store.DATA_DIR=Path(sys.argv[1]); store.DB_PATH=store.DATA_DIR/'privatools.db'
row,state,replayed=storage.accept(sys.argv[2],sys.argv[3],sys.argv[4],'process-race','grayscale',{},json.loads(sys.argv[5]),321)
print(json.dumps({'id':row['id'],'replayed':replayed}))
"""
    processes = [subprocess.Popen([sys.executable,"-c",code,str(store.DATA_DIR),identifier,key.key_id,key.user_id,json.dumps(inputs)],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for identifier in identifiers]
    results=[]
    try:
        for process in processes:
            out,err=process.communicate(timeout=15)
            assert process.returncode==0,err
            results.append(json.loads(out))
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()
                process.wait()
    assert len({result["id"] for result in results})==1
    assert sorted(result["replayed"] for result in results)==[False,True]
    assert quota.peek(key.key_id).units_used==1
    assert quota.peek(key.key_id).bytes_used==321


def test_worker_cli_processes_durable_queue_and_drains_on_signal(jobs,sample_pdf):
    identifier=submit(jobs,sample_pdf).json()["id"]
    env=dict(os.environ,PRIVATOOLS_DATA_DIR=str(store.DATA_DIR))
    with (config.root()/"worker.lock").open("a") as maintenance_lock:
        fcntl.flock(maintenance_lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        process=subprocess.Popen([sys.executable,"-m","backend.app.api_v1.jobs.worker"],env=env,
                                 stdout=subprocess.DEVNULL,stderr=subprocess.PIPE,text=True,start_new_session=True)
        # A web maintenance sweep can own the lock during worker startup.
        # The supervisor waits for it rather than making the launcher fail.
        time.sleep(1)
        assert process.poll() is None
    try:
        deadline=time.monotonic()+15
        while time.monotonic()<deadline:
            row=storage.lookup(identifier,jobs[2].key_id)
            if row["state"]=="succeeded":
                break
            assert process.poll() is None
            time.sleep(0.1)
        assert row["state"]=="succeeded",row
        process.send_signal(signal.SIGTERM)
        _,err=process.communicate(timeout=5)
        assert process.returncode==0,err
        assert not storage.capability()["available"]
    finally:
        if process.poll() is None:
            terminate_group(process)


def test_fsync_failure_never_accepts_or_charges(jobs,sample_pdf,monkeypatch):
    def fail(_):
        raise OSError("synthetic disk failure")
    monkeypatch.setattr(storage,"fsync_dir",fail)
    with pytest.raises(OSError,match="synthetic disk"):
        submit(jobs,sample_pdf)
    assert quota.peek(jobs[2].key_id).units_used==0
    with storage.connection() as conn:
        assert conn.execute("SELECT COUNT(*) FROM api_async_jobs").fetchone()[0]==0
        assert conn.execute("SELECT COUNT(*) FROM api_async_ingest").fetchone()[0]==0


def test_download_delete_race_closes_without_reopening_a_deleted_path(jobs,sample_pdf):
    identifier=submit(jobs,sample_pdf).json()["id"]
    run_job(storage.claim(),threading.Event())
    def get():
        return jobs[0].get(f"/api/v1/jobs/{identifier}/result",headers=headers(jobs))
    def delete():
        return jobs[0].delete(f"/api/v1/jobs/{identifier}",headers=headers(jobs))
    with ThreadPoolExecutor(max_workers=2) as pool:
        download=pool.submit(get)
        deleted=pool.submit(delete)
        assert download.result().status_code in (200,409,410)
        assert deleted.result().status_code==200
    assert not storage.job_dir(identifier).exists()


# ── zero-downtime handover between two containers' supervisors ──────────────
#
# A deploy runs the old and the new container side by side on the same data
# volume. These run two supervisors as threads of one process: each opens the
# lock file itself, so their flocks conflict exactly as two containers' do.

SLOW_JOB = (
    "import json,pathlib,shutil,sys,time\n"
    "request=pathlib.Path(sys.argv[1]); spec=json.loads(request.read_text())\n"
    "time.sleep(1.5)\n"
    "out=request.parent/'out.pdf'; shutil.copy(spec['inputs'][0],out)\n"
    "(request.parent/'manifest.json').write_text(json.dumps({'output':str(out)}))\n"
)


def wait_for(condition,timeout=10.0,message="condition"):
    deadline=time.monotonic()+timeout
    while time.monotonic()<deadline:
        if condition():
            return
        time.sleep(0.05)
    raise AssertionError(f"timed out waiting for {message}")


def role(path):
    try:
        return json.loads(path.read_text())["role"]
    except (OSError,ValueError,KeyError):
        return None


@pytest.fixture
def supervisors(jobs,tmp_path,monkeypatch):
    """Start named supervisor threads that run SLOW_JOB for every claim."""
    real_popen=subprocess.Popen
    ran=[]
    def slow_child(command,**kwargs):
        ran.append(threading.current_thread().name)
        return real_popen([sys.executable,"-c",SLOW_JOB,command[-1]],**kwargs)
    monkeypatch.setattr(worker.subprocess,"Popen",slow_child)
    started={}
    def start(name):
        control=worker.Control()
        state=tmp_path/f"{name}-state.json"
        thread=threading.Thread(target=worker.run_supervisor,args=(control,worker.StateReporter(state)),name=name,daemon=True)
        thread.start()
        started[name]=(control,thread,state)
        return control,state
    yield start,ran
    for control,thread,_ in started.values():
        control.request_stop()
    for _,thread,_ in started.values():
        thread.join(timeout=10)
        assert not thread.is_alive()


def test_second_supervisor_stands_by_and_takes_over_only_after_the_drain(jobs,sample_pdf,supervisors):
    start,ran=supervisors
    old,old_state=start("old")
    wait_for(lambda: role(old_state)=="active",message="old supervisor active")
    first=submit(jobs,sample_pdf,idempotency="before-handover").json()["id"]
    wait_for(lambda: storage.lookup(first,jobs[2].key_id)["state"]=="running",message="first job running")

    new,new_state=start("new")
    wait_for(lambda: role(new_state)=="standby",message="new supervisor standing by")
    # A standby never exits and never claims while the other holds the lock.
    time.sleep(1)
    assert role(new_state)=="standby"

    old.request_drain()
    wait_for(lambda: role(new_state)=="active",message="handover to the new supervisor")
    row=storage.lookup(first,jobs[2].key_id)
    # The drain let the running job finish where it started: one attempt, no retry.
    assert row["state"]=="succeeded" and row["attempts"]==1
    wait_for(lambda: role(old_state)=="standby",message="old supervisor passive")
    assert json.loads(old_state.read_text())["passive"] is True

    second=submit(jobs,sample_pdf,idempotency="after-handover").json()["id"]
    wait_for(lambda: storage.lookup(second,jobs[2].key_id)["state"]=="succeeded",message="second job done")
    assert storage.lookup(second,jobs[2].key_id)["attempts"]==1
    assert ran==["old","new"]


def test_drained_supervisor_heals_when_no_successor_arrives_and_resumes_on_request(jobs,sample_pdf,supervisors):
    start,ran=supervisors
    old,old_state=start("old")
    wait_for(lambda: role(old_state)=="active",message="old supervisor active")
    old.request_drain()
    wait_for(lambda: role(old_state)=="standby",message="old supervisor passive")
    # Its own last heartbeat is fresh, so it leaves the queue to a successor...
    time.sleep(1)
    assert role(old_state)=="standby"
    # ...until that heartbeat is older than a lease: nobody took over.
    storage.heartbeat(accepting=False,now=time.time()-config.LIMITS.lease_seconds-5)
    wait_for(lambda: role(old_state)=="active",message="self-heal")

    old.request_drain()
    wait_for(lambda: role(old_state)=="standby",message="drained again")
    old.request_resume()
    wait_for(lambda: role(old_state)=="active",message="resume")
    identifier=submit(jobs,sample_pdf).json()["id"]
    wait_for(lambda: storage.lookup(identifier,jobs[2].key_id)["state"]=="succeeded",message="job done")
    assert ran==["old"]


def test_readiness_accepts_this_containers_live_standby_of_this_build_only(jobs,tmp_path,monkeypatch):
    # The shared heartbeat names another build, as it does while the old
    # container still owns the queue during a deploy.
    monkeypatch.setenv("PRIVATOOLS_BUILD_SHA","old-build")
    storage.heartbeat()
    monkeypatch.setenv("PRIVATOOLS_BUILD_SHA","jobs-test-build")
    assert not storage.capability()["available"]

    reporter=worker.StateReporter()
    reporter("standby")
    assert storage.capability()["available"]
    assert storage.capability()["operations"]

    monkeypatch.setenv("PRIVATOOLS_BUILD_SHA","a-third-build")
    assert not storage.capability()["available"]
    monkeypatch.setenv("PRIVATOOLS_BUILD_SHA","jobs-test-build")

    state=json.loads(config.worker_state_path().read_text())
    for field,value in [("updated",time.time()-config.LIMITS.lease_seconds-1),("host","another-container"),
                        ("role","stopped"),("pid",2**22+12345)]:
        config.worker_state_path().write_text(json.dumps({**state,field:value}))
        assert not storage.capability()["available"],field
    config.worker_state_path().write_text(json.dumps(state))
    assert storage.capability()["available"]
    reporter.clear()
    assert not config.worker_state_path().exists()
    assert not storage.capability()["available"]


def test_status_reports_the_handover_without_creating_a_database(jobs,sample_pdf,tmp_path,monkeypatch):
    submit(jobs,sample_pdf)
    worker.StateReporter()("standby",passive=True)
    report=worker.status()
    assert report["enabled"] and report["build_sha"]=="jobs-test-build"
    assert report["local"]["role"]=="standby" and report["local"]["passive"] and report["local"]["alive"]
    assert report["active"]["build_sha"]=="jobs-test-build" and report["active"]["accepting"]
    assert (report["running_jobs"],report["queued_jobs"])==(0,1)
    storage.claim()
    assert (worker.status()["running_jobs"],worker.status()["queued_jobs"])==(1,0)

    empty=tmp_path/"empty"
    empty.mkdir()
    monkeypatch.setattr(store,"DB_PATH",empty/"privatools.db")
    assert worker.status()["active"] is None
    assert not (empty/"privatools.db").exists()


def test_status_cli_prints_json(jobs):
    env=dict(os.environ,PRIVATOOLS_DATA_DIR=str(store.DATA_DIR))
    result=subprocess.run([sys.executable,"-m","backend.app.api_v1.jobs.worker","--status"],env=env,
                          capture_output=True,text=True,timeout=60)
    assert result.returncode==0,result.stderr
    assert json.loads(result.stdout)["enabled"] is True


def write_state(role,*,since_age=0.0,**changes):
    now=time.time()
    state={"role":role,"passive":False,"pid":os.getpid(),"host":__import__("socket").gethostname(),
           "build_sha":config.build_sha(),"updated":now,"since":now-since_age,**changes}
    config.worker_state_path().write_text(json.dumps(state))


def test_standby_counts_as_ready_only_within_the_queue_deadline(jobs,monkeypatch):
    # A standby that never gets the lock while no supervisor serves the queue
    # would otherwise report ready forever and accept jobs that expire there.
    # Past queue_seconds it is honest to refuse: /readyz turns 503 and
    # submissions get jobs_unavailable, while pages keep serving (exiting would
    # stop the whole container instead).
    monkeypatch.setenv("PRIVATOOLS_BUILD_SHA","old-build")
    storage.heartbeat(accepting=False)          # the holder stopped claiming
    monkeypatch.setenv("PRIVATOOLS_BUILD_SHA","jobs-test-build")
    write_state("standby",since_age=config.LIMITS.queue_seconds-5)
    assert storage.capability()["available"]
    write_state("standby",since_age=config.LIMITS.queue_seconds+5)
    assert not storage.capability()["available"]
    # Holding the queue is never stale: an active or draining supervisor stays ready.
    for role in ("active","draining"):
        write_state(role,since_age=config.LIMITS.queue_seconds*4)
        assert storage.capability()["available"],role


def test_standby_stays_ready_while_another_supervisor_serves_the_queue(jobs,monkeypatch):
    # The first deploy after the cut-over can keep the new container a
    # standby for longer than queue_seconds: a long drain, then the old
    # supervisor stops only once idle. Meanwhile that supervisor claims every
    # job this container accepts, so readiness must not lapse while it serves.
    monkeypatch.setenv("PRIVATOOLS_BUILD_SHA","old-build")
    storage.heartbeat()                         # fresh and still claiming
    monkeypatch.setenv("PRIVATOOLS_BUILD_SHA","jobs-test-build")
    write_state("standby",since_age=config.LIMITS.queue_seconds*2)
    assert storage.capability()["available"]
    assert job_handover.status(storage.store.DB_PATH)["local"]["ready"]
    # Once nobody heartbeats, the bound applies again.
    monkeypatch.setenv("PRIVATOOLS_BUILD_SHA","old-build")
    storage.heartbeat(now=time.time()-config.LIMITS.lease_seconds-5)
    monkeypatch.setenv("PRIVATOOLS_BUILD_SHA","jobs-test-build")
    assert not storage.capability()["available"]
    assert not job_handover.status(storage.store.DB_PATH)["local"]["ready"]


def test_status_command_is_cheap_and_imports_no_web_stack(jobs,sample_pdf):
    # The deploy polls this every second during a handover; the old entry point
    # imported FastAPI, pydantic and the auth stack (about 1 CPU-s, 100 MB each).
    submit(jobs,sample_pdf)
    worker.StateReporter()("standby",passive=True)
    env=dict(os.environ,PRIVATOOLS_DATA_DIR=str(store.DATA_DIR))
    result=subprocess.run([sys.executable,"-X","importtime","-m","backend.app.job_handover","--status"],env=env,
                          capture_output=True,text=True,timeout=60)
    assert result.returncode==0,result.stderr
    imported={line.split("|")[-1].strip().split(".")[0] for line in result.stderr.splitlines() if "|" in line}
    assert not imported & {"fastapi","starlette","pydantic","anyio","slowapi","fitz","pikepdf","PIL"},imported
    assert not any("api_v1" in line for line in result.stderr.splitlines())
    report=json.loads(result.stdout)
    assert report["enabled"] and report["local"]["role"]=="standby" and report["local"]["passive"]
    assert report["local"]["alive"] and report["local"]["ready"]
    assert (report["running_jobs"],report["queued_jobs"])==(0,1)


def test_handover_module_reads_the_database_and_state_file_the_app_uses(tmp_path):
    # One definition of each path: the status command runs without the app's
    # modules, so it must derive them exactly as store.py and the worker do.
    code=("import json; from backend.app import job_handover, store; "
          "from backend.app.api_v1.jobs import config; "
          "print(json.dumps([str(job_handover.database_path()), str(store.DB_PATH), "
          "str(job_handover.state_path()), str(config.worker_state_path())]))")
    for extra in ({}, {"PRIVATOOLS_DATA_DIR":str(tmp_path/"d"),"API_V1_JOBS_WORKER_STATE":str(tmp_path/"s.json")}):
        env={key:value for key,value in os.environ.items() if key not in ("PRIVATOOLS_DATA_DIR","API_V1_JOBS_WORKER_STATE")}
        result=subprocess.run([sys.executable,"-c",code],env={**env,**extra},capture_output=True,text=True,timeout=60)
        assert result.returncode==0,result.stderr
        database,store_path,state,config_state=json.loads(result.stdout)
        assert database==store_path and state==config_state
    from backend.app import job_handover
    assert (config.LIMITS.lease_seconds,config.LIMITS.queue_seconds)==(job_handover.LEASE_SECONDS,job_handover.QUEUE_SECONDS)
