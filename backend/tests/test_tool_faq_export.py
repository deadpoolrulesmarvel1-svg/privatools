"""The frontend FAQ export must not drift from the Python it came from.

`backend/app/tool_content.py` has held hand-written HowTo and FAQ copy for 213
tools since long before this test, but only ever as JSON-LD for crawlers — no
visitor saw a word of it. The tool pages now render the FAQ, which means the
copy exists in two places: the Python dict (still the source for schema markup
and SSR) and `frontend/src/data/tool-faq.json` (what people read).

Two copies of the same content is exactly the drift this repo keeps getting
bitten by — six slug registries, five compare lists. Same guard as those: the
Python stays authoritative and the export has to match it exactly.

To regenerate after editing tool_content.py:

    python3 -c "
    import json,sys; sys.path.insert(0,'backend')
    from app.tool_content import TOOL_FAQ
    print(json.dumps({s: TOOL_FAQ[s] for s in sorted(TOOL_FAQ)}, indent=0, ensure_ascii=False))
    " > frontend/src/data/tool-faq.json
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.tool_content import TOOL_FAQ

EXPORT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "data" / "tool-faq.json"


def _export() -> dict:
    if not EXPORT.is_file():  # pragma: no cover - repo layout change
        pytest.skip("tool-faq.json not present")
    return json.loads(EXPORT.read_text(encoding="utf-8"))


def test_export_covers_exactly_the_python_tools():
    exported = _export()
    missing = sorted(set(TOOL_FAQ) - set(exported))
    extra = sorted(set(exported) - set(TOOL_FAQ))
    assert not missing, f"tools with FAQ copy that the frontend never shows: {missing}"
    assert not extra, f"tools in the export that no longer exist in tool_content.py: {extra}"


def test_export_content_matches_exactly():
    exported = _export()
    drifted = [slug for slug, entries in TOOL_FAQ.items() if exported.get(slug) != entries]
    assert not drifted, (
        "FAQ copy differs between tool_content.py and the frontend export for: "
        f"{drifted[:8]}{'…' if len(drifted) > 8 else ''}. Regenerate the export."
    )


def test_every_entry_has_a_question_and_an_answer():
    for slug, entries in TOOL_FAQ.items():
        assert entries, f"{slug} has an empty FAQ list"
        for e in entries:
            assert set(e) == {"q", "a"}, f"{slug} entry has unexpected keys: {sorted(e)}"
            assert e["q"].strip(), f"{slug} has an entry with no question"
            assert len(e["a"].strip()) > 20, f"{slug} answers {e['q']!r} with almost nothing"


def test_questions_are_unique_within_a_tool():
    for slug, entries in TOOL_FAQ.items():
        questions = [e["q"] for e in entries]
        assert len(questions) == len(set(questions)), f"{slug} asks the same question twice"
