import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DATA_FILES = [
    ROOT / "frontend" / "src" / "data" / "tools.ts",
    ROOT / "frontend" / "src" / "data" / "non-pdf-tools.ts",
]
TOOL_ENDPOINTS_FILE = ROOT / "frontend" / "src" / "lib" / "tool-endpoints.ts"
BACKEND_ROUTES_DIR = ROOT / "backend" / "app" / "routes"
BACKEND_HELPER_POST_ENDPOINTS = {
    # Support endpoints used inside richer tool UIs, not standalone catalog tools.
    "/fill-form/fields",
    "/metadata/update",
    "/organize-pages/thumbnails",
    "/pipeline",
    "/pipeline/validate",
}

# Make `backend.app.main` importable for the live-app checks below.
sys.path.insert(0, str(ROOT))


def _parse_tools(data_file: Path) -> list[tuple[str, bool]]:
    tools: list[tuple[str, bool]] = []
    current_slug: str | None = None
    current_client_only = False

    for raw_line in data_file.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()

        slug_match = re.search(r'slug:\s*"([^"]+)"', line)
        if slug_match:
            current_slug = slug_match.group(1)
            current_client_only = False

        if current_slug is not None and re.search(r"clientOnly:\s*true", line):
            current_client_only = True

        if current_slug is not None and (line == "}," or line == "}"):
            tools.append((current_slug, current_client_only))
            current_slug = None

    return tools


def _parse_endpoint_overrides() -> dict[str, str]:
    text = TOOL_ENDPOINTS_FILE.read_text(encoding="utf-8")
    return {
        slug: endpoint
        for slug, endpoint in re.findall(r'"([^"]+)":\s*"([^"]+)"', text)
    }


def _parse_backend_post_endpoints() -> set[str]:
    endpoints: set[str] = set()
    for route_file in BACKEND_ROUTES_DIR.glob("*.py"):
        text = route_file.read_text(encoding="utf-8")
        for endpoint in re.findall(r'@router\.post\("([^"]+)"\)', text):
            endpoints.add(endpoint)
    return endpoints


def test_all_non_client_only_tools_have_backend_routes():
    tools: list[tuple[str, bool]] = []
    for data_file in FRONTEND_DATA_FILES:
        tools.extend(_parse_tools(data_file))

    endpoint_overrides = _parse_endpoint_overrides()
    backend_endpoints = _parse_backend_post_endpoints()

    missing: list[tuple[str, str]] = []
    for slug, client_only in tools:
        if client_only:
            continue
        endpoint = endpoint_overrides.get(slug, f"/{slug}")
        if endpoint not in backend_endpoints:
            missing.append((slug, endpoint))

    assert not missing, (
        "Missing backend routes for non-client-only tools: "
        + ", ".join(f"{slug} -> {endpoint}" for slug, endpoint in missing)
    )


def test_every_public_backend_tool_endpoint_is_listed_in_frontend_catalog():
    """A real processing endpoint should not exist only as hidden backend code."""
    tools: list[tuple[str, bool]] = []
    for data_file in FRONTEND_DATA_FILES:
        tools.extend(_parse_tools(data_file))

    endpoint_overrides = _parse_endpoint_overrides()
    frontend_endpoints = {
        endpoint_overrides.get(slug, f"/{slug}")
        for slug, client_only in tools
        if not client_only
    }
    backend_public_tool_endpoints = _parse_backend_post_endpoints() - BACKEND_HELPER_POST_ENDPOINTS

    missing_from_catalog = sorted(backend_public_tool_endpoints - frontend_endpoints)

    assert not missing_from_catalog, (
        "Backend POST endpoints are not exposed by any frontend tool registry entry: "
        + ", ".join(missing_from_catalog)
    )


# ---------------------------------------------------------------------------
# Live-app checks — confirm every POST endpoint declared in a route file is
# actually wired into the FastAPI app at /api/<path>. This catches the case
# where someone adds an `@router.post(...)` but forgets to
# `app.include_router(...)` in main.py.
# ---------------------------------------------------------------------------

def test_every_declared_post_route_is_registered_in_app():
    """No orphan @router.post — every one must be in app.routes."""
    from backend.app.main import app

    declared = _parse_backend_post_endpoints()
    # FastAPI app paths come back as "/api/foo", we declared as "/foo".
    registered: set[str] = set()
    for r in app.routes:
        path = getattr(r, "path", None)
        methods = getattr(r, "methods", None) or set()
        if not path or "POST" not in methods:
            continue
        if path.startswith("/api/"):
            registered.add(path[len("/api"):])

    orphan = sorted(declared - registered)
    assert not orphan, (
        f"@router.post() declared but app never includes the router: {orphan}"
    )


def test_no_duplicate_post_endpoint_in_app():
    """Two routers registering the same /api/<x> is a silent footgun."""
    from collections import Counter
    from backend.app.main import app

    paths = []
    for r in app.routes:
        path = getattr(r, "path", None)
        methods = getattr(r, "methods", None) or set()
        if path and path.startswith("/api/") and "POST" in methods:
            paths.append(path)
    duplicates = [p for p, count in Counter(paths).items() if count > 1]
    assert not duplicates, f"Duplicate POST routes registered: {duplicates}"


def test_phased_route_modules_are_all_included():
    """Every phaseN_tools / new_tools / v12_tools / pdf_extra module must be
    wired into app.include_router(...) in main.py."""
    main_py = (ROOT / "backend" / "app" / "main.py").read_text("utf-8")
    expected_modules = [
        "phase1_tools", "phase2_tools", "phase3_tools", "phase4_tools",
        "phase5_tools", "phase6_tools", "phase7_tools",
        "new_tools", "v12_tools", "pdf_extra",
    ]
    missing = [
        m for m in expected_modules
        if f"app.include_router({m}.router" not in main_py
    ]
    assert not missing, (
        f"Phased route modules not included in main.py: {missing}"
    )
