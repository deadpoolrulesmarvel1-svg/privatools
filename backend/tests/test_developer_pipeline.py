import json


def test_api_docs_are_public(client):
    resp = client.get("/api-docs")
    assert resp.status_code == 200
    assert "text/html" in resp.headers.get("content-type", "")
    assert "swagger" in resp.text.lower()


def test_pipeline_validate_returns_share_path(client):
    resp = client.post(
        "/api/pipeline/validate",
        json={"steps": ["compress-pdf", "strip-metadata"]},
    )
    assert resp.status_code == 200
    payload = resp.json()
    assert payload["ok"] is True
    assert payload["steps"] == ["compress-pdf", "strip-metadata"]
    assert payload["sharePath"].startswith("/pipeline?p=")
    assert "compress-pdf" in payload["supportedSteps"]


def test_pipeline_validate_rejects_unknown_step(client):
    resp = client.post("/api/pipeline/validate", json={"steps": ["merge-pdf"]})
    assert resp.status_code == 400
    detail = resp.json()["detail"]
    assert "merge-pdf" in detail
    assert "compress-pdf" in detail


def test_pipeline_api_key_enforced_when_configured(client, monkeypatch):
    monkeypatch.setenv("PRIVATOOLS_API_KEYS", "secret-key")

    no_key = client.post("/api/pipeline/validate", json={"steps": ["strip-metadata"]})
    assert no_key.status_code == 401

    with_key = client.post(
        "/api/pipeline/validate",
        headers={"X-API-Key": "secret-key"},
        json={"steps": ["strip-metadata"]},
    )
    assert with_key.status_code == 200


def test_pipeline_runs_supported_pdf_steps(client, sample_pdf):
    resp = client.post(
        "/api/pipeline",
        data={"steps": json.dumps(["compress-pdf", "strip-metadata"])},
        files={"file": ("sample.pdf", sample_pdf, "application/pdf")},
    )
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/pdf")
    assert resp.headers["x-pipeline-steps"] == "compress-pdf,strip-metadata"
    assert resp.content.startswith(b"%PDF")
