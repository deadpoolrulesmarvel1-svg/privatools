"""Regression coverage for the Phase 2 tool-count slice.

These tests intentionally focus on catalog/discovery contracts, because the
new public tool pages are thin wrappers over existing image/audio/video routes
or browser-only developer utilities.
"""

from __future__ import annotations

import pytest

from app import seo_meta
from app.routes import sitemap
from app.tool_content import TOOL_FAQ, TOOL_HOWTO


P2_CONVERSION_SLUGS = [
    "jpg-to-tiff", "png-to-tiff", "webp-to-tiff",
    "jpg-to-bmp", "png-to-bmp", "webp-to-bmp",
    "mp3-to-wav", "wav-to-mp3", "flac-to-mp3", "ogg-to-mp3",
    "aac-to-mp3", "mp3-to-ogg", "mp3-to-flac", "mp3-to-aac",
    "wav-to-flac", "wav-to-ogg",
    "mkv-to-mp4", "mp4-to-mov", "mov-to-webm", "mkv-to-webm",
    "mp4-to-avi", "avi-to-webm", "webm-to-mov", "mov-to-mkv",
    "webm-to-gif", "mov-to-gif",
]

P2_DEV_SLUGS = [
    "cron-parser", "sql-formatter", "graphql-formatter",
    "yaml-toml-converter", "gitignore-generator", "semver-bumper",
    "env-validator", "json-to-csv-schema",
]

P2_SLUGS = P2_CONVERSION_SLUGS + P2_DEV_SLUGS


@pytest.mark.parametrize("slug", P2_SLUGS)
def test_phase2_slug_is_in_sitemap_registry(slug: str):
    assert slug in sitemap.NON_PDF_TOOLS


@pytest.mark.parametrize("slug", P2_SLUGS)
def test_phase2_slug_has_seo_metadata(slug: str):
    assert slug in seo_meta._NONPDF_TOOLS
    name, description = seo_meta._NONPDF_TOOLS[slug]
    assert name
    assert description.startswith(("Convert", "Parse", "Format", "Generate", "Bump", "Validate"))


@pytest.mark.parametrize("slug", P2_SLUGS)
def test_phase2_slug_has_howto_content(slug: str):
    assert slug in TOOL_HOWTO
    assert len(TOOL_HOWTO[slug]) >= 3


@pytest.mark.parametrize("slug", P2_SLUGS)
def test_phase2_slug_has_faq_content(slug: str):
    assert slug in TOOL_FAQ
    assert len(TOOL_FAQ[slug]) >= 3


@pytest.mark.parametrize("slug", P2_SLUGS)
def test_phase2_slug_renders_in_sitemap_xml(slug: str):
    body = sitemap._build_sitemap_xml("2026-06-18").decode("utf-8")
    assert f"https://privatools.me/tools/{slug}" in body


@pytest.mark.parametrize("slug", P2_SLUGS)
def test_phase2_slug_has_fixed_review_date(slug: str):
    assert seo_meta.TOOL_LAST_REVIEWED[slug] == "2026-06-18"
