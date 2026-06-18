import re

from backend.app import seo_meta


def _top_tool_paths(limit: int = 50) -> list[tuple[str, str]]:
    ranked: list[tuple[int, str, str]] = []
    for slug in seo_meta._PDF_TOOLS:
        ranked.append((seo_meta._POPULARITY.get(slug, 999), slug, f"/tool/{slug}"))
    for slug in seo_meta._NONPDF_TOOLS:
        ranked.append((seo_meta._POPULARITY.get(slug, 999), slug, f"/tools/{slug}"))
    return [(slug, path) for _, slug, path in sorted(ranked)[:limit]]


def _word_count(html: str) -> int:
    text = re.sub(r"<[^>]+>", " ", html)
    return len(re.findall(r"\w+", text))


def _jsonld_types(path: str) -> set[str]:
    jsonld = seo_meta.get_jsonld_for_path(path)
    assert jsonld is not None
    types: set[str] = set()
    for node in jsonld.get("@graph", []):
        value = node.get("@type")
        if isinstance(value, list):
            types.update(str(item) for item in value)
        elif value:
            types.add(str(value))
    return types


def test_top_50_tool_pages_have_required_geo_content():
    missing: list[str] = []
    for slug, path in _top_tool_paths():
        body = seo_meta._build_ssr_content(path, *seo_meta.get_meta_for_path(path))
        types = _jsonld_types(path)
        checks = {
            "800_words": _word_count(body) >= 800,
            "tldr": 'class="tool-tldr"' in body,
            "deep_content": 'class="tool-depth"' in body,
            "visible_review": "Last reviewed" in body,
            "howto_schema": "HowTo" in types,
            "faq_schema": "FAQPage" in types,
            "software_schema": "SoftwareApplication" in types,
        }
        failed = [name for name, ok in checks.items() if not ok]
        if failed:
            missing.append(f"{slug} ({path}): {', '.join(failed)}")

    assert not missing, "Top-50 SEO/GEO coverage gaps:\n" + "\n".join(missing)
