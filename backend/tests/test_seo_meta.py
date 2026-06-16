"""SEO/AEO/GEO guardrails for server-rendered metadata.

These tests validate the route-aware JSON-LD generator directly. They avoid
calling external validators, but catch the regressions that usually hurt rich
results and AI answer surfaces: missing graph roots, unknown-tool schema,
stale privacy overclaims, and malformed tool FAQ/HowTo nodes.
"""

from __future__ import annotations

import json

from backend.app.seo_meta import get_jsonld_for_path, get_meta_for_path, inject_seo


STALE_PRIVACY_CLAIMS = (
    "All processing happens on your device",
    "All processing happens locally",
    "Zero uploads",
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
    assert len(howto["step"]) >= 3
    assert all(step["@type"] == "HowToStep" for step in howto["step"])

    faq = next(node for node in graph if node.get("@type") == "FAQPage")
    assert len(faq["mainEntity"]) >= 3


def test_non_pdf_tool_jsonld_uses_tools_route_and_utility_category():
    graph = _graph_for("/tools/image-compressor")
    app = next(node for node in graph if node.get("@type") == "SoftwareApplication")

    assert app["url"] == "https://privatools.me/tools/image-compressor"
    assert app["applicationCategory"] == "UtilitiesApplication"


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


def test_injected_html_has_single_route_aware_jsonld_script():
    html = "<html><head><title>Old</title></head><body><div id='root'></div></body></html>"
    injected = inject_seo(html, "/tool/merge-pdf")

    assert injected.count('type="application/ld+json"') == 1
    assert injected.count('id="jsonld-seo"') == 1
    assert "Merge PDF" in injected
