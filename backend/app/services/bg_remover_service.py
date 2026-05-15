import uuid
import logging
import threading
from ..utils.cleanup import get_temp_path, ensure_temp_dir

logger = logging.getLogger(__name__)

# Use the lightweight u2netp model (44MB vs 170MB for u2net) — fits in 1GB RAM.
# rembg sessions wrap an ONNX runtime that is not safe to mutate concurrently —
# guard initialization with a lock and serialize inference with another so we
# never hand the same session to two threads at once.
_session = None
_session_init_lock = threading.Lock()
_session_inference_lock = threading.Lock()


def _get_session():
    global _session
    if _session is None:
        with _session_init_lock:
            if _session is None:
                from rembg import new_session
                _session = new_session("u2netp")
    return _session


def remove_background(input_path: str) -> str:
    """Remove image background using rembg (runs locally, no API).

    Uses the u2netp model (~44MB) which runs entirely on-device for privacy.
    """
    ensure_temp_dir()
    output_path = get_temp_path(f"nobg_{uuid.uuid4().hex}.png")

    from rembg import remove

    session = _get_session()

    with open(input_path, "rb") as f:
        input_data = f.read()

    with _session_inference_lock:
        output_data = remove(input_data, session=session)

    with open(str(output_path), "wb") as f:
        f.write(output_data)

    return str(output_path)

