"""O4/O7: /readyz free-disk check + build_sha in the readiness response."""

import collections
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[2]))

from backend.app.utils import health

_Usage = collections.namedtuple("Usage", "total used free")


def test_free_disk_in_checks_list():
    assert "free_disk" in [name for name, _ in health._CHECKS]


def test_free_disk_passes_with_ample_space():
    # The CI runner / dev box always has well over the 250 MB threshold free.
    assert health._check_free_disk() is True


def test_free_disk_fails_below_threshold(monkeypatch):
    monkeypatch.setattr(health, "_FREE_DISK_MIN_MB", 250)
    monkeypatch.setattr(
        health.shutil, "disk_usage", lambda _p: _Usage(10 * 1024**3, 0, 1024 * 1024)
    )  # 1 MB free
    assert health._check_free_disk() is False


def test_free_disk_fails_on_oserror(monkeypatch):
    def boom(_p):
        raise OSError("no such path")

    monkeypatch.setattr(health.shutil, "disk_usage", boom)
    assert health._check_free_disk() is False


def test_readyz_response_includes_build_sha(client):
    body = client.get("/readyz").json()
    assert "build_sha" in body
    assert "checks" in body
    assert "free_disk" in body["checks"]
