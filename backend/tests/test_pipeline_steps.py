"""The pipeline API's step catalog must match what the SPA offers to chain.

Before this, `/api/pipeline` supported exactly two steps (compress-pdf,
strip-metadata) while `PipelinePage.tsx` offered 25 — so the SPA could not use
the API at all and instead re-uploaded the whole document once per step. For a
50 MB PDF through 5 steps that is 250 MB up and 250 MB down, versus one upload
for the whole chain.

These tests pin the catalog: every advertised step must resolve to a real
service callable, and every callable must satisfy the pipeline's contract of
taking a single input path and returning an output path.
"""

from __future__ import annotations

import inspect
import json

import pytest

from app.routes.developer import PIPELINE_STEP_META, _run_step


# Steps the SPA offers whose implementation lives in a reusable service.
# `invert-colors` and `remove-blank-pages` are deliberately absent: their logic
# is inline in the route handler rather than a service module, so the pipeline
# cannot call them without a refactor. Add them here once extracted.
EXPECTED_STEPS = {
    "compress-pdf",
    "strip-metadata",
    "flatten-pdf",
    "deskew-pdf",
    "repair-pdf",
    "grayscale-pdf",
    "rotate-pdf",
    "reverse-pdf",
    "nup",
    "booklet-pdf",
    "delete-annotations",
    "pdf-to-pdfa",
    "page-numbers",
    "bates-numbering",
    "stamp-pdf",
    "watermark",
    "header-footer",
}


def test_catalog_covers_every_expected_step():
    missing = sorted(EXPECTED_STEPS - set(PIPELINE_STEP_META))
    assert not missing, f"pipeline cannot run these SPA steps: {missing}"


def test_catalog_grew_well_beyond_the_original_two():
    assert len(PIPELINE_STEP_META) >= 17, (
        f"only {len(PIPELINE_STEP_META)} steps — the SPA offers 25 and will keep "
        "round-tripping per step until the catalog covers them"
    )


@pytest.mark.parametrize("slug", sorted(EXPECTED_STEPS))
def test_every_step_has_user_facing_metadata(slug):
    meta = PIPELINE_STEP_META[slug]
    assert meta["label"] and not meta["label"].endswith("."), slug
    assert meta["description"].endswith("."), slug


@pytest.mark.parametrize("slug", sorted(EXPECTED_STEPS))
def test_every_step_resolves_to_a_callable_with_the_pipeline_contract(slug, sample_pdf, tmp_path):
    """Each step must be callable as run(input_path) -> output_path.

    Resolved without executing the tool: a service whose only required argument
    is the input path satisfies the contract, and executing 17 real PDF
    pipelines here would make the suite slow for no extra signal.
    """
    fn = PIPELINE_STEP_META[slug]["run"]
    assert callable(fn), slug
    params = inspect.signature(fn).parameters
    required = [
        name for name, p in params.items()
        if p.default is inspect.Parameter.empty
        and p.kind not in (p.VAR_POSITIONAL, p.VAR_KEYWORD)
    ]
    assert len(required) == 1, f"{slug}: expected exactly one required arg, got {required}"


def test_run_step_rejects_an_unknown_slug():
    with pytest.raises(Exception) as exc:
        _run_step("not-a-real-step", "/tmp/nope.pdf")
    assert "not-a-real-step" in str(exc.value)


def test_validate_advertises_the_full_catalog(client):
    resp = client.post("/api/pipeline/validate", json={"steps": ["compress-pdf"]})
    assert resp.status_code == 200
    supported = resp.json()["supportedSteps"]
    for slug in sorted(EXPECTED_STEPS):
        assert slug in supported, f"{slug} missing from supportedSteps"


def test_validate_accepts_a_long_realistic_chain(client):
    chain = ["repair-pdf", "deskew-pdf", "grayscale-pdf", "compress-pdf", "strip-metadata"]
    resp = client.post("/api/pipeline/validate", json={"steps": chain})
    assert resp.status_code == 200
    assert resp.json()["steps"] == chain


def test_run_executes_a_multi_step_chain_in_one_request(client, sample_pdf):
    """The whole point: N operations, ONE upload."""
    chain = ["grayscale-pdf", "strip-metadata", "compress-pdf"]
    resp = client.post(
        "/api/pipeline",
        files={"file": ("in.pdf", sample_pdf, "application/pdf")},
        data={"steps": json.dumps(chain)},
    )
    assert resp.status_code == 200, resp.text
    assert resp.headers["x-pipeline-steps"] == ",".join(chain)
    assert resp.headers["x-pipeline-step-count"] == "3"
    assert resp.content[:5] == b"%PDF-"


def test_step_metadata_is_json_serialisable(client):
    """`run` is a callable and must not leak into the JSON response."""
    resp = client.post("/api/pipeline/validate", json={"steps": ["compress-pdf"]})
    assert resp.status_code == 200
    json.dumps(resp.json())  # raises if a callable slipped through
