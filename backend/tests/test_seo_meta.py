"""SEO/AEO/GEO guardrails for server-rendered metadata.

These tests validate the route-aware JSON-LD generator directly. They avoid
calling external validators, but catch the regressions that usually hurt rich
results and AI answer surfaces: missing graph roots, unknown-tool schema,
stale privacy overclaims, and malformed tool FAQ/HowTo nodes.
"""

from __future__ import annotations

import json
import os
import re
from html import escape

from backend.app import seo_meta
from backend.app.seo_meta import TOOL_META, get_jsonld_for_path, get_meta_for_path, inject_seo
from backend.app.tool_content import TOOL_FAQ, TOOL_HOWTO


STALE_PRIVACY_CLAIMS = (
    "All processing happens on your device",
    "All processing happens locally",
    "Zero uploads",
    "No accounts, no tracking",
    "no tracking, no ads",
    # Optional developer accounts exist (they issue API keys), so any phrasing
    # that says accounts do not exist is now false. "No account needed" and
    # "no account required" stay true and are what the copy should say.
    "No accounts,",
    "no accounts,",
    "no accounts exist",
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
    "The redacted PDF is then constructed in your browser",
    "the original is never uploaded",
    "Smart Redact uses BERT-base-NER for PII detection. Neither sends data",
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


def _application_subcategory(path: str) -> str:
    app = next(node for node in _graph_for(path) if node.get("@type") == "SoftwareApplication")
    return app["applicationSubCategory"]


def _tool_row(slug: str, prefix: str, category: str, popularity: int | None = None) -> dict:
    """One tool-content.json row in the shape gen-llms.mjs emits. `popularity`
    is optional in the registries, so an unranked row simply omits the key."""
    name = slug.replace("-", " ").title()
    row = {
        "slug": slug, "name": name, "description": f"{name} short copy.",
        "longDescription": f"{name} long copy for the page intro.",
        "seoTitle": f"{name} Online Free", "metaDescription": f"{name} online, free and without an account.",
        "synonyms": "", "category": category, "accepts": ".pdf", "outputLabel": "PDF",
        "lastReviewed": "2026-09-01", "path": f"/{prefix}/{slug}", "priority": 0.6,
    }
    if popularity is not None:
        row["popularity"] = popularity
    return row


def _use_tool_manifest(monkeypatch, tmp_path, rows: list[dict] | None) -> None:
    """Point seo_meta at a hand-written tool manifest, or at a missing one
    (`rows=None`), which is what a checkout without a frontend build sees."""
    path = tmp_path / "tool-content.json"
    if rows is not None:
        path.write_text(json.dumps(rows), encoding="utf-8")
    monkeypatch.setattr(seo_meta, "_TOOL_JSON", path)
    seo_meta._load_manifest.cache_clear()


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
    assert app["creator"]["sameAs"] == ["https://github.com/ethereaglehq/privatools"]

    howto = next(node for node in graph if node.get("@type") == "HowTo")
    assert howto["name"] == "How to use Merge PDF"
    assert len(howto["step"]) >= 3
    assert all(step["@type"] == "HowToStep" for step in howto["step"])

    html = "<html><head><title>Old</title></head><body><div id='root'></div></body></html>"
    injected = inject_seo(html, "/tool/merge-pdf")
    assert f"<h2>{howto['name']}</h2>" in injected

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
        "/tool/compress-pdf": "PDF optimization tools",
        # Later additions to the registries. The subcategory was once decoded
        # from a hand-kept rank table that never listed them, so they fell
        # through to the generic "PDF tools" / "File tools".
        "/tool/remove-watermark": "PDF editing tools",
        "/tool/bates-remove": "PDF security tools",
        "/tool/translate-pdf": "Advanced PDF tools",
        "/tool/pdf-to-long-image": "Convert from PDF tools",
        "/tools/jpg-to-tiff": "Image tools",
        "/tools/mp3-to-wav": "Video and audio tools",
        "/tools/cron-parser": "Developer tools",
    }

    for path, expected in examples.items():
        graph = _graph_for(path)
        app = next(node for node in graph if node.get("@type") == "SoftwareApplication")

        assert app["applicationSubCategory"] == expected, path


def test_every_tool_gets_a_specific_application_subcategory():
    """A registry category with no label — or a lookup that misses some tools —
    silently demotes those pages to the generic subcategory. Walk the whole
    manifest, not a sample, so a newly added category or tool can't do that."""
    manifest = seo_meta._load_manifest(str(seo_meta._TOOL_JSON), seo_meta.blog_content_mtime_ns())
    assert manifest, "tool-content.json manifest not found — run `npm run build` in frontend/ first"

    generic = [row["path"] for row in manifest.values()
               if _application_subcategory(row["path"]) in ("PDF tools", "File tools")]

    assert not generic, f"tools with only a generic applicationSubCategory: {generic}"


def test_tool_jsonld_subcategory_follows_the_manifest_category(tmp_path, monkeypatch):
    """The manifest's `category` decides the label — not the slug, and not the
    tool's popularity. Both rows here carry a category and rank their real
    registry entries don't have, so nothing slug-keyed can produce these."""
    _use_tool_manifest(monkeypatch, tmp_path, [
        _tool_row("merge-pdf", "tool", "security", 300),
        _tool_row("image-compressor", "tools", "archive", 15),
    ])

    assert _application_subcategory("/tool/merge-pdf") == "PDF security tools"
    assert _application_subcategory("/tools/image-compressor") == "Archive tools"


def test_tool_jsonld_subcategory_is_generic_without_a_manifest(tmp_path, monkeypatch):
    """A checkout without a frontend build has no category data. The registry
    tables still say which tools are PDF tools, so the label degrades to the
    generic one for that family instead of failing or going missing."""
    _use_tool_manifest(monkeypatch, tmp_path, None)

    assert _application_subcategory("/tool/merge-pdf") == "PDF tools"
    assert _application_subcategory("/tools/image-compressor") == "File tools"


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
    expected = "How to use Barcode Generator"

    assert howto["name"] == expected
    assert "How to Barcode Generator" not in howto["name"]

    html = "<html><head><title>Old</title></head><body><div id='root'></div></body></html>"
    injected = inject_seo(html, "/tools/generate-barcode")

    assert f"<h2>{expected}</h2>" in injected
    assert "How to Barcode Generator" not in injected


def test_unknown_tool_does_not_emit_soft_404_schema():
    assert get_jsonld_for_path("/tool/not-a-real-tool") is None
    assert get_jsonld_for_path("/tools/not-a-real-tool") is None


def test_security_route_is_known_and_has_meta():
    assert seo_meta.path_is_known("/security")
    title, description = get_meta_for_path("/security")

    assert "Security" in title
    assert "threat model" in description


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


# The steps and questions render to visitors under every tool, so they may only
# promise what the privacy policy promises: temporary per-request storage,
# response cleanup plus a background sweep, and file-size, resource and rate
# limits. Each pattern below is a sentence that shipped and was not true.
GUIDE_OVERCLAIMS = {
    "retention absolute": r"never (?:logged|stored|kept|inspected|persisted|indexed|written|retained|saved)",
    "no-logs claim": r"\bno logs?\b|nothing is logged|no log captures",
    "permanent-storage or backup promise": r"permanent storage|logs, or backups",
    "per-request container claim": r"docker container",
    "instant deletion": (
        r"\bunlink|(?:deleted|removed|discarded|erased)[^.]{0,50}\b(?:immediately|instantly|the moment|"
        r"within seconds|within minutes|seconds later|as soon as|right after)\b"
    ),
    "no-quota claim": (
        r"no (?:daily|weekly|monthly|per-day|per-month)[^.]{0,40}(?:limit|quota|cap)|\bunlimited\b|"
        r"no file size limits?"
    ),
    "invented throughput": r"\broutinely\b",
    "security grade": r"bank-grade|military-grade",
}

# Server tools whose guide legitimately describes a browser-side engine or step.
_HYBRID_GUIDES = {"smart-redact", "remove-background", "ocr-pdf", "image-ocr"}
_BROWSER_ONLY_CLAIM = re.compile(
    r"(?:runs|happens|works|processed|converted) (?:entirely |100% |fully )?in your browser|"
    r"never leaves your (?:device|machine|browser|computer)|(?:is|are) never uploaded|nothing is uploaded",
    re.I,
)


def _client_only_slugs() -> set[str]:
    data_dir = os.path.join(os.path.dirname(__file__), "..", "..", "frontend", "src", "data")
    slugs: set[str] = set()
    for name in ("tools.ts", "non-pdf-tools.ts"):
        with open(os.path.join(data_dir, name), encoding="utf-8") as handle:
            source = handle.read()
        for entry in re.finditer(r'\{\s*slug:\s*"([^"]+)"(.*?)\n\s*\},?\s*\n', source, re.S):
            if re.search(r"clientOnly:\s*true", entry.group(2)):
                slugs.add(entry.group(1))
    return slugs


def _guide_sentences():
    for kind, table in (("howto", TOOL_HOWTO), ("faq", TOOL_FAQ)):
        for slug, entries in table.items():
            for index, entry in enumerate(entries):
                yield slug, f"{kind}[{index}]", " ".join(entry.values())


def test_tool_guides_do_not_overclaim_retention_or_limits():
    offenders = [
        f"{slug} {where}: {label}"
        for slug, where, text in _guide_sentences()
        for label, pattern in GUIDE_OVERCLAIMS.items()
        if re.search(pattern, text, re.I)
    ]
    assert offenders == []


def test_server_tool_guides_do_not_claim_browser_only_processing():
    client_only = _client_only_slugs()
    assert len(client_only) >= 20, "parsed too few clientOnly tools — registry parser is wrong"
    offenders = [
        f"{slug} {where}"
        for slug, where, text in _guide_sentences()
        if slug not in client_only and slug not in _HYBRID_GUIDES and _BROWSER_ONLY_CLAIM.search(text)
    ]
    assert offenders == []


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


def test_tool_pages_use_registry_search_copy(tmp_path, monkeypatch):
    """Tool title/description/og:title come from the registry's seoTitle and
    metaDescription — not the old "<name> — Free Online | PrivaTools"
    formula. The SSR `<h1>` is the page's heading instead: the tool's name and
    its one-line promise, the registry `description`."""
    manifest = {
        "merge-pdf": {"slug": "merge-pdf", "name": "Merge PDF", "path": "/tool/merge-pdf", "category": "organize",
                      "description": "Combine PDFs", "longDescription": "Long intro text for the page.",
                      "seoTitle": "Merge PDF Files Online Free – Combine PDFs Privately",
                      "metaDescription": "Combine PDF files in the order you choose. Free, no sign-up, temporary server processing.",
                      "lastReviewed": "2026-08-02"},
        "image-compressor": {"slug": "image-compressor", "name": "Image Compressor", "path": "/tools/image-compressor", "category": "image",
                             "description": "Shrink images", "longDescription": "Long intro for images.",
                             "seoTitle": "Compress Images Online Free – Smaller JPG, PNG and WebP",
                             "metaDescription": "Reduce JPG, PNG and WebP file size with a quality preset you control. Free, no sign-up, temporary server processing."},
    }
    path = tmp_path / "tool-content.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")
    monkeypatch.setattr(seo_meta, "_TOOL_JSON", path)
    seo_meta._load_manifest.cache_clear()

    title, description = get_meta_for_path("/tool/merge-pdf")
    assert title == "Merge PDF Files Online Free – Combine PDFs Privately"
    assert description == manifest["merge-pdf"]["metaDescription"]
    assert "| PrivaTools" not in title

    # og:title comes from a real template with a pre-existing tag — inject_seo
    # updates a meta tag's `content` in place and never invents a missing one.
    from pathlib import Path

    template = (Path(__file__).resolve().parents[2] / "frontend" / "index.html").read_text("utf-8")
    html = inject_seo(template, "/tools/image-compressor")
    assert '<h1>Image Compressor<span class="tool-promise">: Shrink images</span></h1>' in html
    assert "<title>Compress Images Online Free – Smaller JPG, PNG and WebP</title>" in html
    assert '<meta property="og:title" content="Compress Images Online Free – Smaller JPG, PNG and WebP">' in html
    assert "<h1>Compress Images Online Free" not in html

    # The manifest's lastReviewed date reaches both the visible review line
    # and the JSON-LD dateModified — `_last_reviewed_for` is the shared read
    # path for both.
    assert "Last reviewed 2026-08-02" in seo_meta._build_ssr_content("/tool/merge-pdf", *seo_meta.get_meta_for_path("/tool/merge-pdf"))
    graph = seo_meta._get_jsonld_for_path("/tool/merge-pdf", seo_meta.blog_content_mtime_ns())["@graph"]
    assert any(node.get("dateModified") == "2026-08-02" for node in graph)


def test_compare_tool_count_claims_match_catalog_size():
    total = len(seo_meta._PDF_TOOLS) + len(seo_meta._NONPDF_TOOLS)
    breadth_feature = f"{total} tools (PDF, image, video, audio, dev)"
    comparison_copy = json.dumps(
        [seo_meta._PRIVATOOLS_FEATURES, seo_meta._COMPARE_DATA],
        sort_keys=True,
    )

    assert seo_meta._TOTAL_TOOL_COUNT == total
    assert breadth_feature in comparison_copy
    assert f"Yes ({total} tools)" in comparison_copy
    assert "175+" not in comparison_copy


def test_public_tool_count_claims_match_catalog_size():
    total = len(seo_meta._PDF_TOOLS) + len(seo_meta._NONPDF_TOOLS)
    html = "<html><head></head><body><div id='root'></div></body></html>"
    surfaces = "\n".join(
        [
            seo_meta.get_meta_for_path("/")[1],
            seo_meta.get_meta_for_path("/compare/smallpdf")[1],
            seo_meta.get_meta_for_path("/compare/adobe-acrobat")[1],
            seo_meta.get_meta_for_path("/definitely-missing")[1],
            inject_seo(html, "/"),
            inject_seo(html, "/definitely-missing"),
        ]
    )

    assert f"{total} free" in surfaces
    assert f"{total} tools" in surfaces
    assert "179" not in surfaces


def test_injected_html_has_single_route_aware_jsonld_script():
    html = "<html><head><title>Old</title></head><body><div id='root'></div></body></html>"
    injected = inject_seo(html, "/tool/merge-pdf")

    assert injected.count('type="application/ld+json"') == 1
    assert injected.count('id="jsonld-seo"') == 1
    assert "Merge PDF" in injected


def test_ssr_body_injected_into_real_nonempty_root_template():
    """Regression guard for the prepaint-shell bug.

    The production template ships a NON-empty `<div id="root">` (a pre-hydration
    brand shell for LCP). The SSR body MUST still be injected into it. A
    bare-empty-root fixture hides this bug, so this test reads the REAL
    frontend/index.html template the backend serves in production.
    """
    from pathlib import Path

    index_html = Path(__file__).resolve().parents[2] / "frontend" / "index.html"
    template = index_html.read_text("utf-8")
    # Sanity: confirm the root is genuinely non-empty (the condition that broke
    # the old empty-root regex). If a future refactor empties it, that's fine —
    # the assertions below still guarantee the body ships.
    assert '<div id="root">' in template

    out = inject_seo(template, "/tool/merge-pdf")
    body = out.split("</head>", 1)[-1]
    assert "<h1" in body, "tool <h1> missing from SSR body — injection regex regressed"
    assert 'href="/tool/' in body, "internal tool links missing from SSR body"
    # The injected root must not be left empty.
    assert '<div id="root"></div>' not in out


def test_ssr_injects_into_built_dist_style_template():
    """Regression guard for the BUILT template shape.

    Production serves frontend/dist/index.html, where Vite hoists the entry
    `<script type="module">` into <head> and the only script AFTER `<div id="root">`
    is a plain inline `<script>`. An injector that anchors on a type="module"
    script following root matches the source index.html but NOT the built file —
    which shipped an empty SSR body to production. This fixture mirrors the built
    structure exactly.
    """
    # Mirrors the real built dist/index.html: entry module script hoisted to
    # <head>, and an HTML COMMENT (not a script) immediately follows root. Both
    # earlier regex anchors (type="module"-after-root, then any-script-after-root)
    # failed on this exact shape and shipped an empty body to production.
    template = (
        "<html><head><title>x</title>"
        '<meta name="robots" content="index,follow" />'
        '<script type="module" crossorigin src="/assets/index-abc123.js"></script>'
        "</head><body>"
        '<div id="prepaint-brand" aria-hidden="true">Privatools</div>'
        '<div id="root">\n'
        '      <div style="min-height:100vh;background:#0b0b0c">\n'
        "        <header><span>Privatools</span></header>\n"
        "      </div>\n"
        "    </div>\n"
        "    <!-- Service worker registration lives in src/lib/sw-register.ts -->\n"
        '    <script nonce="z">/* analytics */</script>'
        "</body></html>"
    )
    out = inject_seo(template, "/tool/merge-pdf")
    body = out.split("</head>", 1)[-1]
    assert "<h1" in body, "SSR body not injected into built-dist-style template"
    assert 'href="/tool/' in body, "internal tool links missing from built-style body"
    assert "min-height:100vh" not in body, "prepaint shell not replaced by SSR content"
    assert '<div id="root"></div>' not in out
    # The comment and trailing script after root must survive intact.
    assert "sw-register.ts" in out and 'nonce="z"' in out


def test_unknown_path_is_noindex_and_not_self_canonical():
    """A 404/unknown route must be noindex and must NOT self-canonicalize
    (self-canonical on a missing URL is the classic Soft-404 trigger). Uses the
    real template so the robots-meta and canonical handling match production."""
    from pathlib import Path

    index_html = Path(__file__).resolve().parents[2] / "frontend" / "index.html"
    template = index_html.read_text("utf-8")
    out = inject_seo(template, "/tool/this-slug-does-not-exist-zzz")
    assert 'content="noindex,nofollow"' in out
    assert 'rel="canonical"' not in out, "404/unknown path must not emit a canonical"


def test_tools_hub_is_known_and_renders_full_directory():
    """The /tools hub must be a known route that server-renders crawlable links
    to both PDF (/tool/) and non-PDF (/tools/) tools, plus CollectionPage JSON-LD."""
    from pathlib import Path

    assert seo_meta.path_is_known("/tools")
    index_html = Path(__file__).resolve().parents[2] / "frontend" / "index.html"
    template = index_html.read_text("utf-8")
    out = inject_seo(template, "/tools")
    body = out.split("</head>", 1)[-1]
    assert "<h1>All Free Online Tools</h1>" in body
    assert 'href="/tool/merge-pdf"' in body
    assert 'href="/tools/jwt-decoder"' in body
    assert '"CollectionPage"' in out
    # canonical points at the hub itself
    assert 'rel="canonical" href="https://privatools.me/tools"' in out


def test_tool_heading_is_the_name_and_promise_the_page_shows():
    """Every tool's crawler H1 says what the page's H1 says (ToolWorkspace via
    frontend/src/lib/tool-seo.ts): the tool's name, then its one-line promise,
    the registry `description`, after a colon the page keeps for screen
    readers. The search title is the <title> and the meta title, never the H1,
    and the promise is not repeated in a paragraph of its own."""
    import html as html_lib

    manifest = seo_meta._load_manifest(str(seo_meta._TOOL_JSON), seo_meta.blog_content_mtime_ns())
    assert manifest, "tool-content.json manifest not found"
    checked = 0
    for slug, row in manifest.items():
        title, description = seo_meta.get_meta_for_path(row["path"])
        body = seo_meta._build_ssr_content(row["path"], title, description)
        assert body.count("<h1") == 1, slug
        heading = re.search(r"<h1>(.*?)</h1>", body, re.S)
        assert heading, slug
        text = html_lib.unescape(re.sub(r"<[^>]+>", "", heading.group(1)))
        promise = (row.get("description") or "").strip()
        assert text == (f"{row['name']}: {promise}" if promise else row["name"]), slug
        if row.get("seoTitle") and row["seoTitle"] != text:
            assert title == row["seoTitle"], slug
            assert row["seoTitle"] not in heading.group(1), slug
        assert 'class="tool-summary"' not in body, slug
        checked += 1
    assert checked == len(manifest) > 200


def test_tool_body_matches_visible_blocks_in_order():
    """The trimmed SSR body keeps only current blocks, in the order the visible page renders them.

    Related-tools content itself (which tools, in which order) is pinned
    exhaustively by test_related_tools_and_blog_links_match_client_construction
    below — this test only guards structure/ordering, so it no longer asserts
    on the related-tools slugs themselves.
    """
    body = seo_meta._build_ssr_content("/tool/merge-pdf", *seo_meta.get_meta_for_path("/tool/merge-pdf"))
    assert "compare-cta" not in body and "tool-depth" not in body and "TL;DR" not in body
    assert body.index('class="tool-steps"') < body.index('class="tool-faq"') < body.index("Last reviewed")


def test_related_tools_and_blog_links_match_client_construction():
    """Server related-tools and blog-link blocks must match the client's construction.

    `SkinApp.tsx` builds `related` as: same category, exclude self, sort by
    the registry `popularity` field ascending (stable, so equal popularity
    keeps registry order), first three. `postsForTool(slug, 4)` sorts
    mentioning posts by `publishedAt` descending and caps at four. Both are
    reconstructed here directly from the build-owned manifest/blog artifacts
    — the same source of truth the client's registry is generated from — for
    *every* tool, not a sample, and compared against what `_build_ssr_content`
    actually renders.
    """
    manifest = seo_meta._load_manifest(str(seo_meta._TOOL_JSON), seo_meta.blog_content_mtime_ns())
    assert manifest, "tool-content.json manifest not found — run `npm run build` in frontend/ first"
    rows = list(manifest.items())  # preserves the manifest's own iteration/tiebreak order

    checked_related = 0
    checked_guides = 0
    for slug, row in rows:
        category = row.get("category")
        candidates = [(s, r) for s, r in rows if s != slug and r.get("category") == category]
        candidates.sort(key=lambda item: item[1].get("popularity", 999))
        expected_related_hrefs = [r["path"] for _, r in candidates[:3]]

        title, description = seo_meta.get_meta_for_path(row["path"])
        body = seo_meta._build_ssr_content(row["path"], title, description)

        related_html = (
            body.split('class="tool-related"', 1)[1].split("</ul>", 1)[0]
            if 'class="tool-related"' in body
            else ""
        )
        actual_related_hrefs = re.findall(r'<li><a href="([^"]+)">', related_html)
        assert actual_related_hrefs == expected_related_hrefs, (
            f"{slug}: related tools must match the client's same-category popularity sort "
            f"(got {actual_related_hrefs}, expected {expected_related_hrefs})"
        )
        if expected_related_hrefs:
            checked_related += 1

        mentioning = seo_meta._tool_to_blogs().get(slug, [])
        assert len(mentioning) <= 4, f"{slug}: server blog links must be capped at 4 like postsForTool(slug, 4)"
        published = [post.get("publishedAt", "") for post in mentioning]
        assert published == sorted(published, reverse=True), f"{slug}: blog links must be newest-first"

        guide_html = (
            body.split('class="tool-guides"', 1)[1].split("</ul>", 1)[0]
            if 'class="tool-guides"' in body
            else ""
        )
        actual_guide_hrefs = re.findall(r'<li><a href="([^"]+)">', guide_html)
        assert actual_guide_hrefs == [f"/blog/{post['slug']}" for post in mentioning], (
            f"{slug}: rendered blog links must match _tool_to_blogs() order exactly"
        )
        if mentioning:
            checked_guides += 1

    # Sanity: the manifest actually exercises both branches, so a vacuous
    # pass (e.g. an empty/broken manifest) can't slip through.
    assert checked_related > 50, "expected most of the 221 tools to have same-category peers"
    assert checked_guides > 10, "expected multiple tools to have blog mentions capped by this test"


def test_tool_lists_follow_manifest_popularity(tmp_path, monkeypatch):
    """The homepage and /tools lists mirror how the client sorts its
    registries: manifest `popularity` ascending, equal ranks in manifest order
    (a stable JS sort over the registry), unranked tools last.

    The ranks are deliberately ones no hand-kept mirror would hold — a recent
    tool leads, compress-pdf outranks merge-pdf, split-pdf ties with merge-pdf
    but precedes it in the manifest — so only the manifest can produce this."""
    _use_tool_manifest(monkeypatch, tmp_path, [
        _tool_row("rotate-pdf", "tool", "optimize"),
        _tool_row("split-pdf", "tool", "organize", 3),
        _tool_row("merge-pdf", "tool", "organize", 3),
        _tool_row("compress-pdf", "tool", "optimize", 2),
        _tool_row("remove-watermark", "tool", "edit", 1),
        _tool_row("image-compressor", "tools", "image", 2),
        _tool_row("jpg-to-tiff", "tools", "image", 1),
    ])

    for page in ("/", "/tools"):
        body = seo_meta._build_ssr_content(page, *get_meta_for_path(page))

        assert re.findall(r'<li><a href="/tool/([^"]+)">', body) == [
            "remove-watermark", "compress-pdf", "split-pdf", "merge-pdf", "rotate-pdf"], page
        assert re.findall(r'<li><a href="/tools/([^"]+)">', body) == ["jpg-to-tiff", "image-compressor"], page


def test_tool_lists_keep_registry_table_order_without_a_manifest(tmp_path, monkeypatch):
    """A checkout without a frontend build has no popularity data at all. The
    lists then follow the registry tables as written, rather than a second
    ranking kept by hand that drifts from the registries."""
    _use_tool_manifest(monkeypatch, tmp_path, None)

    for page in ("/", "/tools"):
        body = seo_meta._build_ssr_content(page, *get_meta_for_path(page))

        assert re.findall(r'<li><a href="/tool/([^"]+)">', body) == list(seo_meta._PDF_TOOLS), page
        assert re.findall(r'<li><a href="/tools/([^"]+)">', body) == list(seo_meta._NONPDF_TOOLS), page


def test_related_tools_fall_back_to_registry_table_order_without_a_manifest(tmp_path, monkeypatch):
    """No manifest means no category and no popularity, so a tool page links
    the first three other tools in its registry table. CI always has a
    manifest, so without this the fallback branch would never run."""
    _use_tool_manifest(monkeypatch, tmp_path, None)

    others = [slug for slug in seo_meta._PDF_TOOLS if slug != "compress-pdf"][:3]

    assert seo_meta._related_tools("compress-pdf", seo_meta._PDF_TOOLS, "tool") == [
        (slug, seo_meta._PDF_TOOLS[slug][0], f"/tool/{slug}") for slug in others]


def test_tool_guide_text_and_names_are_html_escaped_in_ssr_body():
    """Hand-written guide prose and tool names can contain literal `<tag>`
    examples or a bare `&` — both must render as HTML entities in the SSR
    body, or the "literal tag" breaks the page's real markup for crawlers.
    JSON-LD is untouched by this (it is JSON, not HTML)."""
    body = seo_meta._build_ssr_content("/tools/gif-to-mp4", *seo_meta.get_meta_for_path("/tools/gif-to-mp4"))
    assert "&lt;video" in body
    assert "<video" not in body

    pdf_registry, _ = seo_meta._tool_registries()
    name = pdf_registry["header-footer"][0]
    assert "&" in name, "header-footer is the fixture for the bare-& regression; update this if its name changes"
    pdf_body = seo_meta._build_ssr_content("/tool/header-footer", *seo_meta.get_meta_for_path("/tool/header-footer"))
    assert escape(name) in pdf_body
    assert name not in pdf_body

    # _howto_name_for() feeds both the JSON-LD HowTo.name and this visible
    # <h2> — they must stay readable-text-identical modulo HTML escaping.
    assert f"<h2>{escape(seo_meta._howto_name_for(name))}</h2>" in pdf_body


def _app_features(path: str) -> str:
    app = next(node for node in _graph_for(path) if node.get("@type") == "SoftwareApplication")
    return " | ".join(app["featureList"])


def test_feature_list_says_browser_tools_never_upload():
    # text-diff is clientOnly in the registry and has no AI provider option.
    features = _app_features("/tools/text-diff")
    assert "never uploaded" in features
    assert "Server processing" not in features
    assert "provider" not in features


def test_feature_list_says_server_tools_remove_files_after_the_response():
    features = _app_features("/tool/merge-pdf")
    assert "Server processing in temporary storage, removed after the response" in features
    assert "never uploaded" not in features


def test_feature_list_names_the_ai_provider_option_only_where_it_exists():
    # summarize-pdf runs in the browser and can optionally use the visitor's own AI key.
    features = _app_features("/tool/summarize-pdf")
    assert "never uploaded" in features
    assert "only to the AI provider you choose" in features


def test_no_tool_page_claims_immediate_deletion():
    for meta in TOOL_META.values():
        features = _app_features(meta["url_path"])
        assert "deleted immediately" not in features, meta["url_path"]
        assert "isolated container" not in features, meta["url_path"]


def test_llms_facts_describe_the_analytics_actually_in_use():
    # Analytics has been default-on Google Analytics with tool-run events since
    # v2.5.0; the facts crawlers read must not call it first-party telemetry.
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    for name in ("llms.txt", "llms-full.txt"):
        with open(os.path.join(root, "frontend", "public", name), encoding="utf-8") as handle:
            text = handle.read()
        assert "Google Analytics" in text, name
        assert "first-party pageview telemetry" not in text, name
        # Since 2026-09-24: arrival attribution, failure categories, automation skip.
        assert "referring site's origin" in text, name
        assert "utm_ campaign tags, sent only with the first page view of each page load" in text, name
        assert "for most failed runs, a fixed failure category" in text, name
        assert "automated or headless are not measured" in text, name


def _body_for(path: str) -> str:
    html = "<html><head><title>Old</title></head><body><div id='root'></div></body></html>"
    return re.sub(r"\s+", " ", inject_seo(html, path))


def test_server_rendered_pages_never_promise_immediate_deletion():
    # Server tools remove files after the response, with a background sweep
    # for leftovers: a cleanup policy, not an instant guarantee.
    for path in ("/tools", "/privacy", "/terms"):
        body = _body_for(path)
        assert "immediately after the response" not in body, path
        assert "immediately delete" not in body, path


def test_server_rendered_privacy_page_describes_default_on_analytics():
    # Since v2.5.0 analytics is on by default; the Privacy page switch is the
    # only opt-out, and Do Not Track or GPC are not read.
    body = _body_for("/privacy")
    assert "on by default" in body
    assert "requires opt-in" not in body
    assert "Do Not Track" not in body


def test_server_rendered_privacy_page_describes_arrival_failures_and_automation():
    # Since 2026-09-24 the first page view carries the linking site's origin and
    # the five utm_ campaign tags, failed tool runs carry a fixed category, and
    # automated or headless browsers never load the tag.
    body = _body_for("/privacy")
    for tag in ("utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"):
        assert tag in body
    assert "except the first page view each time a page loads (when you arrive, open a page in a new tab or reload)" in body
    assert "at most 64 characters" in body
    assert "fewer than 9 digits" in body
    assert "no unbroken run of 16 or more characters that mixes letters and digits" in body
    assert "at most 100" not in body
    assert "by its origin only, for example https://www.google.com/" in body
    assert "never the page you came from there or your search terms" in body
    assert "an IP address, localhost or a name without a dot" in body
    # Arriving from another PrivaTools page records that page, not an origin.
    assert "opened from another public PrivaTools page" in body
    assert "records that page's address without its query, and so does a reload of the page" in body
    assert "Every other query parameter is removed" in body
    for kind in ("too_large", "rate_limited", "bad_input", "timeout", "server", "network", "provider", "browser"):
        assert kind in body
    # Not every screen reports a category yet, so no promise for every failure.
    assert "for most failed runs, a fixed failure category" in body
    assert "never the error message" in body
    assert "navigator.webdriver" in body
    assert "HeadlessChrome" in body
    assert "Optional Google Analytics" not in body
    assert "Last updated:</strong> September 24, 2026" in body


def test_server_rendered_terms_page_does_not_deny_limits():
    body = _body_for("/terms")
    assert "no limits" not in body
    assert "fair-use limits" in body
