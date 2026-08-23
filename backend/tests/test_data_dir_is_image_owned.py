"""The data directory must exist in the image, owned by the runtime user.

Compose mounts the app-data named volume at /app/data. Docker seeds a fresh
volume from whatever the image holds at that path — *including its ownership*.
When the image has nothing there, Docker creates the mountpoint root:root, the
unprivileged runtime user cannot write, and the first signup dies on
``sqlite3.OperationalError: unable to open database file``.

store.py calling ``DATA_DIR.mkdir(parents=True, exist_ok=True)`` does not save
it — the directory already exists, it simply isn't writable — and under
``read_only: true`` there is no fallback location either.

This shipped once: /app/temp was created and chowned, /app/data was not, and
nothing in the suite noticed because the failure only appears on a *fresh*
volume, which no test and no existing deployment ever created.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
DOCKERFILE = REPO_ROOT / "Dockerfile"
COMPOSE = REPO_ROOT / "docker-compose.yml"


def _volume_mount_targets() -> dict[str, str]:
    """{volume name: container path} for the privatools service."""
    spec = yaml.safe_load(COMPOSE.read_text(encoding="utf-8"))
    out: dict[str, str] = {}
    for entry in spec["services"]["privatools"].get("volumes", []):
        if isinstance(entry, str) and ":" in entry and not entry.startswith("/"):
            name, target = entry.split(":")[:2]
            out[name] = target
    assert out, "parsed no named volume mounts from docker-compose.yml"
    return out


def _dockerfile_owned_dirs() -> set[str]:
    """Absolute container paths the Dockerfile creates AND chowns to appuser.

    Handles the WORKDIR-relative form (`mkdir -p temp data`) as well as
    absolute paths, since the file uses both.
    """
    text = DOCKERFILE.read_text(encoding="utf-8")
    owned: set[str] = set()
    for line in text.splitlines():
        if "chown" not in line or "appuser" not in line:
            continue
        for token in re.findall(r"(?:^|\s)((?:/)?[\w./-]+)", line.split("appuser:appuser", 1)[-1]):
            token = token.strip()
            if not token or token in {"-R", "&&", "\\"} or token.startswith("-"):
                continue
            owned.add(token if token.startswith("/") else f"/app/{token}")
    return owned


@pytest.mark.parametrize("volume,target", sorted(_volume_mount_targets().items()))
def test_every_mounted_volume_path_is_created_and_owned_in_the_image(volume: str, target: str):
    owned = _dockerfile_owned_dirs()
    assert target in owned, (
        f"docker-compose mounts the '{volume}' volume at {target}, but the "
        f"Dockerfile never creates and chowns that path (it owns: {sorted(owned)}). "
        "Docker will seed the fresh volume root:root and the unprivileged user "
        "will not be able to write to it — for app-data that is the first "
        "signup failing with 'unable to open database file'."
    )


def test_data_dir_specifically_is_owned():
    """Named separately from the parametrised check so the failure reads plainly."""
    assert "/app/data" in _dockerfile_owned_dirs(), (
        "/app/data must be created and chowned to appuser in the Dockerfile. It "
        "holds accounts and API keys, and there is no email path — an account "
        "that cannot be written is a user who can never sign up."
    )
