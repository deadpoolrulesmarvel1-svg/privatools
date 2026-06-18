from __future__ import annotations

import os
import time


def test_janitor_transparency_reports_real_cleanup_counts(client, tmp_path, monkeypatch):
    from backend.app.utils import cleanup as _cleanup

    _cleanup._reset_janitor_stats_for_tests()
    monkeypatch.setattr(_cleanup, "TEMP_DIR", tmp_path)

    stale = tmp_path / "stale-upload.pdf"
    stale.write_bytes(b"%PDF- stale")
    old = time.time() - 2 * 60 * 60
    os.utime(stale, (old, old))

    assert _cleanup.cleanup_old_files(max_age_seconds=60) == (1, 0)

    resp = client.get("/api/transparency/janitor")
    assert resp.status_code == 200
    data = resp.json()

    assert data == {
        "last_sweep_at": data["last_sweep_at"],
        "files_swept_last_hour": 1,
        "files_swept_last_24h": 1,
    }
    assert data["last_sweep_at"].endswith("Z")
    assert str(tmp_path) not in resp.text
    assert "stale-upload" not in resp.text
