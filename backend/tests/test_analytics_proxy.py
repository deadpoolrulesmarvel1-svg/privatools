"""First-party analytics proxy tests.

The browser should never load Google Analytics scripts directly. It sends a
small first-party pageview beacon, and the backend forwards a sanitized GA4
Measurement Protocol event only when the deployment has configured a secret.
"""

from __future__ import annotations

from backend.app.routes import analytics


def test_pageview_noops_without_ga4_secret(client, monkeypatch):
    calls: list[tuple[str, dict]] = []
    monkeypatch.delenv("GA4_API_SECRET", raising=False)
    monkeypatch.setattr(
        analytics,
        "_send_ga4_pageview",
        lambda endpoint, body: calls.append((endpoint, body)),
    )

    resp = client.post(
        "/api/analytics/pageview",
        json={
            "path": "/tool/compress-pdf",
            "title": "Compress PDF",
            "client_id": "client.12345678",
        },
    )

    assert resp.status_code == 204
    assert resp.content == b""
    assert calls == []


def test_pageview_forwards_sanitized_ga4_payload(client, monkeypatch):
    calls: list[tuple[str, dict]] = []
    monkeypatch.setenv("GA4_API_SECRET", "test-secret")
    monkeypatch.setenv("GA4_MEASUREMENT_ID", "G-TEST123")
    monkeypatch.setattr(
        analytics,
        "_send_ga4_pageview",
        lambda endpoint, body: calls.append((endpoint, body)),
    )

    resp = client.post(
        "/api/analytics/pageview",
        json={
            "path": "/tool/compress-pdf?filename=private.pdf#fragment",
            "title": "Compress\nPDF",
            "referrer": "https://evil.example/private",
            "client_id": "client.12345678",
        },
    )

    assert resp.status_code == 204
    assert len(calls) == 1
    endpoint, body = calls[0]
    assert "measurement_id=G-TEST123" in endpoint
    assert "api_secret=test-secret" in endpoint
    assert body["client_id"] == "client.12345678"
    assert body["non_personalized_ads"] is True

    params = body["events"][0]["params"]
    assert body["events"][0]["name"] == "page_view"
    assert params["page_path"] == "/tool/compress-pdf"
    assert params["page_location"] == "https://privatools.me/tool/compress-pdf"
    assert params["page_title"] == "Compress PDF"
    assert "page_referrer" not in params


def test_pageview_keeps_same_origin_referrer(client, monkeypatch):
    calls: list[tuple[str, dict]] = []
    monkeypatch.setenv("GA4_API_SECRET", "test-secret")
    monkeypatch.setenv("GA4_MEASUREMENT_ID", "G-TEST123")
    monkeypatch.setattr(
        analytics,
        "_send_ga4_pageview",
        lambda endpoint, body: calls.append((endpoint, body)),
    )

    resp = client.post(
        "/api/analytics/pageview",
        json={
            "path": "/privacy",
            "title": "Privacy Policy",
            "referrer": "https://privatools.me/tool/merge-pdf?source=email#top",
            "client_id": "client.87654321",
        },
    )

    assert resp.status_code == 204
    params = calls[0][1]["events"][0]["params"]
    assert params["page_referrer"] == "https://privatools.me/tool/merge-pdf"


def test_pageview_invalid_client_id_noops(client, monkeypatch):
    calls: list[tuple[str, dict]] = []
    monkeypatch.setenv("GA4_API_SECRET", "test-secret")
    monkeypatch.setattr(
        analytics,
        "_send_ga4_pageview",
        lambda endpoint, body: calls.append((endpoint, body)),
    )

    resp = client.post(
        "/api/analytics/pageview",
        json={"path": "/tool/compress-pdf", "client_id": "short"},
    )

    assert resp.status_code == 204
    assert calls == []
