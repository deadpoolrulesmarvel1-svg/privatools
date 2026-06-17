"""SEO/AEO/GEO guardrails for server-rendered metadata.

These tests validate the route-aware JSON-LD generator directly. They avoid
calling external validators, but catch the regressions that usually hurt rich
results and AI answer surfaces: missing graph roots, unknown-tool schema,
stale privacy overclaims, and malformed tool FAQ/HowTo nodes.
"""

from __future__ import annotations

import json
import os

from backend.app import seo_meta
from backend.app.seo_meta import TOOL_META, get_jsonld_for_path, get_meta_for_path, inject_seo
from backend.app.tool_content import TOOL_FAQ, TOOL_HOWTO


STALE_PRIVACY_CLAIMS = (
    "All processing happens on your device",
    "All processing happens locally",
    "Zero uploads",
    "No accounts, no tracking",
    "no tracking, no ads",
)

STALE_STORAGE_CLAIMS = (
    "temp memory",
    "temporary memory",
    "temporary server memory",
    "memory only",
    "processed in memory",
    "self-hostable via Docker, so files stay on your own infrastructure",
    "never written to disk",
    "never persisted to disk",
    "No copy is kept on any disk",
    "files never leave the processing container",
    "files never leave the container",
    "File content never leaves the processing container",
)


def _graph_for(path: str) -> list[dict]:
    data = get_jsonld_for_path(path)
    assert isinstance(data, dict)
    assert data.get("@context") == "https://schema.org"
    graph = data.get("@graph")
    assert isinstance(graph, list)
    assert graph, f"{path} emitted an empty JSON-LD graph"
    json.dumps(data)
    return graph


def _types(graph: list[dict]) -> set[str]:
    found: set[str] = set()
    for node in graph:
        node_type = node.get("@type")
        if isinstance(node_type, list):
            found.update(str(t) for t in node_type)
        elif node_type:
            found.add(str(node_type))
    return found


def test_homepage_jsonld_has_entity_and_answer_graph():
    graph = _graph_for("/")
    types = _types(graph)

    assert {"WebSite", "Organization", "ItemList", "FAQPage"} <= types
    website = next(node for node in graph if node.get("@type") == "WebSite")
    assert website["potentialAction"]["@type"] == "SearchAction"
    item_list = next(node for node in graph if node.get("@type") == "ItemList")
    assert item_list["numberOfItems"] == len(item_list["itemListElement"])
    assert item_list["numberOfItems"] >= 20


def test_tool_jsonld_has_application_howto_faq_and_breadcrumbs():
    graph = _graph_for("/tool/merge-pdf")
    types = _types(graph)

    assert {"WebPage", "SoftwareApplication", "BreadcrumbList", "HowTo", "FAQPage"} <= types
    app = next(node for node in graph if node.get("@type") == "SoftwareApplication")
    assert app["@id"].endswith("#app")
    assert app["isAccessibleForFree"] is True
    assert app["offers"]["price"] == "0"
    assert app["featureList"]
    assert app["creator"]["sameAs"] == ["https://github.com/deadpoolrulesmarvel1-svg/privatools"]

    howto = next(node for node in graph if node.get("@type") == "HowTo")
    assert howto["name"] == "How to use the Merge PDF tool on PrivaTools"
    assert len(howto["step"]) >= 3
    assert all(step["@type"] == "HowToStep" for step in howto["step"])

    faq = next(node for node in graph if node.get("@type") == "FAQPage")
    assert len(faq["mainEntity"]) >= 3


def test_non_pdf_tool_jsonld_uses_tools_route_and_utility_category():
    graph = _graph_for("/tools/image-compressor")
    app = next(node for node in graph if node.get("@type") == "SoftwareApplication")

    assert app["url"] == "https://privatools.me/tools/image-compressor"
    assert app["applicationCategory"] == "UtilitiesApplication"
    assert app["applicationSubCategory"] == "Image tools"


def test_tool_jsonld_application_subcategories_are_specific():
    examples = {
        "/tool/merge-pdf": "PDF organization tools",
        "/tool/pdf-to-word": "Convert from PDF tools",
        "/tool/word-to-pdf": "Convert to PDF tools",
        "/tools/video-converter": "Video and audio tools",
        "/tools/generate-barcode": "Developer tools",
        "/tools/extract-archive": "Archive tools",
        "/tools/csv-json": "Document and data tools",
    }

    for path, expected in examples.items():
        graph = _graph_for(path)
        app = next(node for node in graph if node.get("@type") == "SoftwareApplication")

        assert app["applicationSubCategory"] == expected, path


def test_barcode_meta_does_not_advertise_unsupported_svg_output():
    title, description = get_meta_for_path("/tools/generate-barcode")
    combined = f"{title}\n{description}"

    assert "SVG" not in combined
    assert "PNG" in description


def test_tool_meta_does_not_overclaim_unlimited_file_sizes():
    offenders = [
        slug
        for slug, meta in TOOL_META.items()
        if "no file size limits" in f"{meta['description']} {meta['long_description']}".lower()
    ]

    assert offenders == []


def test_extract_archive_meta_does_not_advertise_unsupported_formats():
    title, description = get_meta_for_path("/tools/extract-archive")
    combined = f"{title}\n{description}"

    assert "RAR" not in combined
    assert "7Z" not in combined
    assert "ZIP" in combined
    assert "TAR" in combined


def test_extract_archive_faq_does_not_claim_password_support():
    graph = _graph_for("/tools/extract-archive")
    faq = next(node for node in graph if node.get("@type") == "FAQPage")
    faq_text = json.dumps(faq)

    assert "Password input is supported" not in faq_text
    assert "not supported yet" in faq_text


def test_create_zip_faq_does_not_claim_password_encryption_support():
    graph = _graph_for("/tools/create-zip")
    faq = next(node for node in graph if node.get("@type") == "FAQPage")
    faq_text = json.dumps(faq)

    assert "AES-256" not in faq_text
    assert "password-protect" in faq_text
    assert "Not yet" in faq_text


def test_noun_tool_howto_names_are_readable_in_jsonld_and_ssr_html():
    graph = _graph_for("/tools/generate-barcode")
    howto = next(node for node in graph if node.get("@type") == "HowTo")
    expected = "How to use the Barcode Generator tool on PrivaTools"

    assert howto["name"] == expected
    assert "How to Barcode Generator" not in howto["name"]

    html = "<html><head><title>Old</title></head><body><div id='root'></div></body></html>"
    injected = inject_seo(html, "/tools/generate-barcode")

    assert f"<h2>{expected}</h2>" in injected
    assert "How to Barcode Generator" not in injected


def test_unknown_tool_does_not_emit_soft_404_schema():
    assert get_jsonld_for_path("/tool/not-a-real-tool") is None
    assert get_jsonld_for_path("/tools/not-a-real-tool") is None


def test_meta_descriptions_do_not_repeat_stale_privacy_overclaims():
    paths = [
        "/",
        "/tool/merge-pdf",
        "/tools/video-converter",
        "/about",
        "/compare/ilovepdf",
        "/blog/how-to-merge-pdfs-online-free",
    ]

    for path in paths:
        title, description = get_meta_for_path(path)
        combined = f"{title}\n{description}"
        for stale in STALE_PRIVACY_CLAIMS:
            assert stale not in combined, f"{path} contains stale claim: {stale!r}"


def test_server_side_storage_claims_match_temp_file_architecture():
    surfaces = [
        json.dumps(get_jsonld_for_path("/"), sort_keys=True),
        json.dumps(get_jsonld_for_path("/tool/merge-pdf"), sort_keys=True),
        json.dumps(get_jsonld_for_path("/tools/image-compressor"), sort_keys=True),
        inject_seo("<html><head></head><body><div id='root'></div></body></html>", "/"),
        inject_seo("<html><head></head><body><div id='root'></div></body></html>", "/about"),
        inject_seo("<html><head></head><body><div id='root'></div></body></html>", "/privacy"),
        inject_seo("<html><head></head><body><div id='root'></div></body></html>", "/terms"),
        json.dumps(TOOL_FAQ, sort_keys=True),
        json.dumps(TOOL_HOWTO, sort_keys=True),
    ]
    combined = "\n".join(surfaces)

    for stale in STALE_STORAGE_CLAIMS:
        assert stale not in combined, f"stale storage claim leaked: {stale!r}"
    assert "temporary per-request storage" in combined
    assert "isolated temporary storage" in combined


def test_generated_blog_content_refreshes_by_mtime(tmp_path, monkeypatch):
    blog_json = tmp_path / "blog-content.json"
    html = "<html><head></head><body><div id='root'></div></body></html>"

    def write_blog(body: str, title: str, mtime_ns: int) -> None:
        blog_json.write_text(
            json.dumps([
                {
                    "slug": "heic-conversion-guide-2026",
                    "title": title,
                    "tldr": "Short generated summary.",
                    "body": body,
                    "relatedTools": ["split-in-half"],
                }
            ]),
            encoding="utf-8",
        )
        os.utime(blog_json, ns=(mtime_ns, mtime_ns))

    monkeypatch.setattr(seo_meta, "_BLOG_JSON", blog_json)
    seo_meta._load_blog_bodies.cache_clear()
    seo_meta._tool_to_blogs_for_mtime.cache_clear()
    seo_meta._get_jsonld_for_path.cache_clear()

    write_blog("<p>first generated body</p>", "First generated guide", 1_000_000_000)
    first_blog = inject_seo(html, "/blog/heic-conversion-guide-2026")
    first_tool = inject_seo(html, "/tool/split-in-half")

    assert "first generated body" in first_blog
    assert "First generated guide" in first_tool

    write_blog("<p>second generated body</p>", "Second generated guide", 2_000_000_000)
    second_blog = inject_seo(html, "/blog/heic-conversion-guide-2026")
    second_tool = inject_seo(html, "/tool/split-in-half")

    assert "second generated body" in second_blog
    assert "first generated body" not in second_blog
    assert "Second generated guide" in second_tool
    assert "First generated guide" not in second_tool


def test_compare_tool_count_claims_match_catalog_size():
    total = len(seo_meta._PDF_TOOLS) + len(seo_meta._NONPDF_TOOLS)
    breadth_feature = f"{total} tools (PDF, image, video, audio, dev)"
    comparison_copy = json.dumps(
        [seo_meta._PRIVATOOLS_FEATURES, seo_meta._COMPARE_DATA],
        sort_keys=True,
    )
    non_pdf_html = inject_seo(
        '<html><head></head><body><div id="root"></div></body></html>',
        "/tools/image-compressor",
    )

    assert seo_meta._TOTAL_TOOL_COUNT == total
    assert breadth_feature in comparison_copy
    assert f"Yes ({total} tools)" in comparison_copy
    assert f"all {total} tools" in non_pdf_html
    assert "175+" not in comparison_copy
    assert "all 175+ tools" not in non_pdf_html


def test_injected_html_has_single_route_aware_jsonld_script():
    html = "<html><head><title>Old</title></head><body><div id='root'></div></body></html>"
    injected = inject_seo(html, "/tool/merge-pdf")

    assert injected.count('type="application/ld+json"') == 1
    assert injected.count('id="jsonld-seo"') == 1
    assert "Merge PDF" in injected
