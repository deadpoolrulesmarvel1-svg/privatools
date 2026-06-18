from __future__ import annotations

import json
import logging
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Response
from pydantic import BaseModel, Field

router = APIRouter()
logger = logging.getLogger(__name__)

_DEFAULT_MEASUREMENT_ID = "G-B3VWQ44MX1"
_PUBLIC_BASE_URL = os.environ.get("PUBLIC_BASE_URL", "https://privatools.me").rstrip("/")
_CLIENT_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{8,96}$")


class AnalyticsPageview(BaseModel):
    path: str = Field(default="/", max_length=512)
    title: str | None = Field(default=None, max_length=160)
    referrer: str | None = Field(default=None, max_length=512)
    client_id: str | None = Field(default=None, max_length=96)


def _clean_path(path: str | None) -> str:
    value = (path or "/").strip()
    if not value.startswith("/") or value.startswith("//"):
        return "/"
    # Keep aggregate page metrics from accidentally carrying share/query data.
    return value.split("?", 1)[0].split("#", 1)[0][:512] or "/"


def _clean_text(value: str | None, limit: int) -> str | None:
    if not value:
        return None
    cleaned = re.sub(r"[\x00-\x1f\x7f]+", " ", value).strip()
    return cleaned[:limit] or None


def _clean_referrer(value: str | None) -> str | None:
    cleaned = _clean_text(value, 512)
    if not cleaned:
        return None
    parsed = urllib.parse.urlsplit(cleaned)
    if parsed.scheme != "https" or parsed.hostname not in {"privatools.me", "www.privatools.me"}:
        return None
    path = parsed.path or "/"
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))
    return None


def _analytics_config() -> tuple[str, str] | None:
    secret = os.environ.get("GA4_API_SECRET")
    if not secret:
        return None
    measurement_id = os.environ.get("GA4_MEASUREMENT_ID", _DEFAULT_MEASUREMENT_ID)
    return measurement_id, secret


def _build_ga4_payload(pageview: AnalyticsPageview) -> dict[str, Any] | None:
    client_id = (pageview.client_id or "").strip()
    if not _CLIENT_ID_RE.fullmatch(client_id):
        return None

    path = _clean_path(pageview.path)
    params: dict[str, Any] = {
        "page_location": f"{_PUBLIC_BASE_URL}{path}",
        "page_path": path,
    }
    title = _clean_text(pageview.title, 160)
    referrer = _clean_referrer(pageview.referrer)
    if title:
        params["page_title"] = title
    if referrer:
        params["page_referrer"] = referrer

    return {
        "client_id": client_id,
        "non_personalized_ads": True,
        "events": [{"name": "page_view", "params": params}],
    }


def _send_ga4_pageview(endpoint: str, body: dict[str, Any]) -> None:
    data = json.dumps(body, separators=(",", ":")).encode("utf-8")
    request = urllib.request.Request(
        endpoint,
        data=data,
        method="POST",
        headers={
            "content-type": "application/json",
            "user-agent": "PrivaTools analytics proxy",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=1.5) as response:
            response.read(128)
    except (OSError, urllib.error.URLError) as exc:
        logger.debug("ga4 analytics proxy send failed: %s", exc.__class__.__name__)


@router.post("/analytics/pageview", status_code=204)
async def analytics_pageview(
    pageview: AnalyticsPageview,
    background_tasks: BackgroundTasks,
) -> Response:
    config = _analytics_config()
    body = _build_ga4_payload(pageview)
    if config and body:
        measurement_id, secret = config
        query = urllib.parse.urlencode({"measurement_id": measurement_id, "api_secret": secret})
        endpoint = f"https://www.google-analytics.com/mp/collect?{query}"
        background_tasks.add_task(_send_ga4_pageview, endpoint, body)
    return Response(status_code=204)
