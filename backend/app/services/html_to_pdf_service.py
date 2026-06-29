"""HTML → PDF.

We prefer WeasyPrint (best CSS / font fidelity) and fall back to PyMuPDF's
`Story` engine if WeasyPrint's native libraries (libgobject, libpango,
libcairo) aren't installed on the host. The `_weasyprint_ok` cache lets
us skip the expensive native-library probe after the first failure.

URL fetches use the stdlib `urllib` so we don't pull in `requests` as a
hard dep; for keep-alive within a single worker we maintain an
`http.client.HTTPSConnection` cache keyed by (scheme, host, port). One
DNS lookup + TLS handshake per host per worker process.
"""
from __future__ import annotations

import http.client
import ipaddress
import logging
import os
import socket
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from collections import namedtuple
from urllib.parse import urlparse

from fastapi import HTTPException

from ..utils.cleanup import ensure_temp_dir, get_temp_path

logger = logging.getLogger(__name__)

# Cached User-Agent string — built once per worker. Most public sites
# expect a real-looking UA and silently 403 anonymous crawlers.
_USER_AGENT = os.environ.get(
    "URL_FETCH_USER_AGENT",
    "PrivaTools/1.0 (+https://privatools.me)",
)

_PRIVATE_NETWORKS = [
    # IPv4 RFC 1918 + the assorted "non-routable" ranges any SSRF guard
    # must reject — loopback, link-local, multicast, broadcast, the
    # 0.0.0.0/8 "this host" block, IETF reserved ranges, and the
    # AWS/GCP metadata range (169.254.169.254 is covered by 169.254/16).
    ipaddress.ip_network("0.0.0.0/8"),       # current network / this host
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("100.64.0.0/10"),   # CGNAT — also private
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),  # link-local + cloud metadata
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.0.0.0/24"),    # IETF special-use
    ipaddress.ip_network("192.0.2.0/24"),    # TEST-NET-1 (documentation)
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("198.18.0.0/15"),   # benchmark-testing
    ipaddress.ip_network("198.51.100.0/24"), # TEST-NET-2
    ipaddress.ip_network("203.0.113.0/24"),  # TEST-NET-3
    ipaddress.ip_network("224.0.0.0/4"),     # multicast
    ipaddress.ip_network("240.0.0.0/4"),     # reserved
    # IPv6 — loopback, ULAs, link-local. fc00::/7 covers fc00::/8 + fd00::/8;
    # fe80::/10 is IPv6 link-local; ::ffff:0:0/96 is IPv4-mapped (so we
    # don't get bypassed via dual-stack).
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
    ipaddress.ip_network("fe80::/10"),
    ipaddress.ip_network("::ffff:0:0/96"),
    ipaddress.ip_network("64:ff9b::/96"),    # IPv4-to-IPv6 translation
]

_BLOCKED_HOSTNAMES = {"localhost", "0.0.0.0", "127.0.0.1", "::1", "169.254.169.254"}


def _is_private_ip(ip_str: str) -> bool:
    """True if ``ip_str`` resolves into any of our blocked SSRF ranges."""
    try:
        addr = ipaddress.ip_address(ip_str)
    except ValueError:
        return False
    # `is_private` already covers most cases but doesn't catch some of the
    # IETF reserved ranges we explicitly want to deny — so we still walk
    # the table. `is_loopback`/`is_link_local`/`is_multicast`/
    # `is_unspecified` cover their respective categories defensively.
    if addr.is_loopback or addr.is_link_local or addr.is_multicast or addr.is_unspecified or addr.is_reserved:
        return True
    for network in _PRIVATE_NETWORKS:
        try:
            if addr in network:
                return True
        except TypeError:
            # network family mismatch — skip
            continue
    return False


def _validate_url(url: str) -> None:
    """Raise HTTPException(400) for URLs that could cause SSRF.

    Performs DNS resolution to catch hostnames that point at private IPs.
    Doesn't fully prevent DNS rebinding (the actual HTTP connection
    re-resolves), but it's a substantial first-line defence — combined
    with the small URL_FETCH_TIMEOUT, the attack window for rebinding
    to succeed shrinks to near-zero.
    """
    try:
        parsed = urlparse(url)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid URL")

    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Only http and https URLs are allowed")

    # Strip any trailing dot — a single trailing dot is a valid DNS form
    # ("localhost." vs "localhost") that some name-resolvers honour but
    # naive string compares miss. We also lowercase for the literal-match.
    raw_host = parsed.hostname or ""
    hostname = raw_host.rstrip(".").lower()
    if not hostname:
        raise HTTPException(status_code=400, detail="URL has no hostname")
    if hostname in _BLOCKED_HOSTNAMES:
        raise HTTPException(status_code=400, detail="URL points to a blocked host")

    # Check if hostname is a literal IP — including IPv6 forms like
    # "[::1]" which urlparse strips brackets from.
    try:
        addr = ipaddress.ip_address(hostname)
    except ValueError:
        addr = None
    if addr is not None and _is_private_ip(str(addr)):
        raise HTTPException(
            status_code=400,
            detail="URL points to a private or reserved IP address",
        )

    # Resolve hostname; reject if *any* resolved IP is private (don't pick
    # one — an attacker could rotate the answer set).
    try:
        resolved = socket.getaddrinfo(hostname, None)
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="Could not resolve hostname")
    for _family, _type, _proto, _canonname, sockaddr in resolved:
        ip_str = sockaddr[0]
        # Strip IPv6 scope id ("fe80::1%en0") before validation.
        ip_str = ip_str.split("%", 1)[0]
        if _is_private_ip(ip_str):
            raise HTTPException(
                status_code=400,
                detail="URL resolves to a private or reserved IP address",
            )


_DEFAULT_STYLE = """
body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
       padding: 20px; line-height: 1.6; color: #1a1a1a; }
h1 { color: #111; margin-top: 0; } h2 { color: #333; } h3 { color: #555; }
a { color: #1a73e8; }
code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px;
       font-family: "SF Mono", Menlo, monospace; font-size: 0.9em; }
pre { background: #f4f4f4; padding: 12px; border-radius: 4px; overflow-x: auto; }
table { border-collapse: collapse; width: 100%; margin: 1em 0; }
td, th { border: 1px solid #ddd; padding: 6px 10px; text-align: left; }
th { background: #f4f4f4; }
img { max-width: 100%; height: auto; }
blockquote { border-left: 4px solid #ddd; margin: 1em 0; padding: 0.2em 1em; color: #555; }
"""


def _wrap_html(html_content: str) -> str:
    """If the input isn't a full HTML document, wrap it with sensible defaults."""
    if "<html" in html_content.lower():
        return html_content
    return (
        f"<!doctype html><html><head><meta charset='utf-8'>"
        f"<style>{_DEFAULT_STYLE}</style></head><body>{html_content}</body></html>"
    )


# Cache whether WeasyPrint is usable on this host. The native-library
# import check is expensive (and prints a multi-line stderr banner) so we
# only run it once per worker process. If `_weasyprint_ok` is False we
# short-circuit straight to the PyMuPDF fallback instead of repeating
# the OSError on every request.
_weasyprint_ok: bool | None = None


# Per-resource cap for WeasyPrint sub-resources (images / CSS / fonts).
# Larger than the 5 MB HTML cap because a single hero image can legitimately
# be a few MB, but still bounded so a malicious page can't exhaust the worker.
_MAX_SUBRESOURCE_BYTES = 25 * 1024 * 1024


def _weasyprint_url_fetcher(url: str, timeout: int = 15, ssl_context=None):
    """A WeasyPrint ``url_fetcher`` that blocks SSRF on every sub-resource.

    WeasyPrint fetches every resource referenced by the document (images, CSS
    ``@import``/``url()``, ``<link>``, fonts). Its default fetcher honours
    ``file://`` and private IPs, so attacker-supplied HTML or a fetched page
    could pull cloud-metadata or local files into the rendered PDF. We route
    all network fetches through :func:`safe_url_fetch` (SSRF-validated,
    redirect-safe), allow inline ``data:`` URIs through (no egress), and refuse
    every other scheme. Shared by BOTH the url= and string= render paths.
    """
    scheme = url.split(":", 1)[0].lower()
    if scheme in ("http", "https"):
        result = safe_url_fetch(url, max_bytes=_MAX_SUBRESOURCE_BYTES, timeout=timeout)
        return {
            "string": result.body,
            "mime_type": result.content_type or None,
            "encoding": result.encoding,
            "redirected_url": result.final_url,
        }
    if scheme == "data":
        try:
            from weasyprint.urls import default_url_fetcher
        except ImportError:  # pragma: no cover - older/newer weasyprint layout
            from weasyprint import default_url_fetcher
        return default_url_fetcher(url, timeout=timeout, ssl_context=ssl_context)
    raise HTTPException(status_code=400, detail=f"Blocked URL scheme: {scheme or 'unknown'}")


def _weasyprint_html_to_pdf(html_content: str, output_path: str) -> None:
    """Render with WeasyPrint — proper CSS/font/layout support. Preferred."""
    global _weasyprint_ok
    if _weasyprint_ok is False:
        # Already determined WeasyPrint can't load here — surface a clean
        # ImportError so the orchestrator falls straight through to fitz.
        raise ImportError("WeasyPrint native libraries not available on this host")
    try:
        from weasyprint import HTML
        # url_fetcher so sub-resources in attacker-supplied HTML (<img src=
        # "file:///etc/passwd">, http://169.254.169.254/...) are SSRF-validated
        # rather than fetched by WeasyPrint's permissive default fetcher.
        HTML(string=_wrap_html(html_content), url_fetcher=_weasyprint_url_fetcher).write_pdf(output_path)
        _weasyprint_ok = True
    except (ImportError, OSError):
        _weasyprint_ok = False
        raise


def _fitz_html_to_pdf(html_content: str, output_path: str) -> None:
    """PyMuPDF fallback — used only when WeasyPrint isn't available."""
    import fitz
    html_content = _wrap_html(html_content)
    writer = fitz.DocumentWriter(output_path)
    try:
        story = fitz.Story(html=html_content)
        mediabox = fitz.paper_rect("a4")
        where = mediabox + fitz.Rect(40, 40, -40, -40)
        more = True
        while more:
            dev = writer.begin_page(mediabox)
            more, _ = story.place(where)
            story.draw(dev)
            writer.end_page()
    finally:
        # Ensure the document is flushed/closed even if Story.place blows up
        # mid-page — earlier versions left zero-byte PDFs in TEMP_DIR.
        writer.close()


def html_to_pdf(html_content: str) -> str:
    """Convert an HTML string to a PDF file. Prefers WeasyPrint (best CSS/font
    fidelity) and falls back to PyMuPDF Story when WeasyPrint is unavailable
    OR fails to load native libraries (libgobject, libpango, libcairo on
    macOS dev boxes without Homebrew dependencies installed).
    """
    started = time.monotonic()
    ensure_temp_dir()
    output_path = str(get_temp_path(f"html2pdf_{uuid.uuid4().hex}.pdf"))
    input_bytes = len(html_content.encode("utf-8", errors="replace")) if html_content else 0
    logger.info("html_to_pdf: start input_bytes=%d", input_bytes)
    backend = "weasyprint"
    try:
        _weasyprint_html_to_pdf(html_content, output_path)
        duration_ms = int((time.monotonic() - started) * 1000)
        try:
            out_size = os.path.getsize(output_path)
        except OSError:
            out_size = 0
        logger.info(
            "html_to_pdf: done backend=%s duration_ms=%d output_bytes=%d",
            backend, duration_ms, out_size,
        )
        return output_path
    except (ImportError, OSError) as exc:
        # WeasyPrint missing or its native deps not present — fall through to
        # the PyMuPDF Story backend.
        logger_msg = str(exc)
        backend = "fitz"
    except Exception as exc:
        try:
            os.unlink(output_path)
        except OSError:
            pass
        raise HTTPException(status_code=400, detail=f"HTML rendering failed: {exc}") from exc

    # Drop any zero-byte sidecar WeasyPrint may have created before handing
    # the fresh path to PyMuPDF — fitz's DocumentWriter dislikes pre-existing
    # files on the path and surfaces a "Broken pipe" if the previous handle
    # was left dangling.
    try:
        os.unlink(output_path)
    except OSError:
        pass
    output_path = str(get_temp_path(f"html2pdf_{uuid.uuid4().hex}.pdf"))
    try:
        _fitz_html_to_pdf(html_content, output_path)
    except Exception as exc:
        try:
            os.unlink(output_path)
        except OSError:
            pass
        raise HTTPException(
            status_code=500,
            detail=f"HTML rendering failed (PyMuPDF fallback): {exc} (WeasyPrint: {logger_msg})",
        ) from exc

    duration_ms = int((time.monotonic() - started) * 1000)
    try:
        out_size = os.path.getsize(output_path)
    except OSError:
        out_size = 0
    logger.info(
        "html_to_pdf: done backend=%s duration_ms=%d output_bytes=%d",
        backend, duration_ms, out_size,
    )
    return output_path


# Cap remote HTML fetches so a runaway endpoint can't blow up the worker.
# 5 MB of HTML is several novels worth of text — anything bigger is almost
# certainly an unintended target.
MAX_REMOTE_HTML_BYTES = 5 * 1024 * 1024
URL_FETCH_TIMEOUT = 15  # seconds — keeps slow remote hosts from holding workers


class _ValidatingRedirectHandler(urllib.request.HTTPRedirectHandler):
    """urllib redirect handler that re-validates every hop against the SSRF
    ruleset.

    Without this, ``urlopen`` transparently follows a redirect from a
    validated public host to an internal one (e.g. ``public -> 302 ->
    http://169.254.169.254``), defeating the up-front ``_validate_url``
    check. We re-run ``_validate_url`` on each ``Location`` before allowing
    the redirect; a blocked target raises ``HTTPException`` and aborts the
    fetch.
    """

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[override]
        _validate_url(newurl)  # raises HTTPException(400) on private/file/etc.
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def _validating_opener() -> urllib.request.OpenerDirector:
    """An opener that follows redirects only to validated public URLs."""
    return urllib.request.build_opener(_ValidatingRedirectHandler)


_FetchResult = namedtuple("_FetchResult", ["final_url", "content_type", "encoding", "body"])


def safe_url_fetch(
    url: str,
    *,
    max_bytes: int = MAX_REMOTE_HTML_BYTES,
    timeout: int = URL_FETCH_TIMEOUT,
    accept_types: tuple[str, ...] | None = None,
) -> "_FetchResult":
    """Fetch ``url`` with SSRF protection that survives redirects.

    Validates the URL, follows redirects only to validated public hosts
    (via :class:`_ValidatingRedirectHandler`), re-checks the final landing
    URL, enforces an optional content-type allow-list and a hard byte cap.
    Raises ``HTTPException`` on any violation. Used both by the html-to-pdf
    URL fallback and by the WeasyPrint sub-resource fetcher in
    ``url_to_pdf_service`` so the SSRF ruleset lives in exactly one place.
    """
    _validate_url(url)
    req = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
    try:
        with _validating_opener().open(req, timeout=timeout) as resp:
            # Belt-and-suspenders: the handler validated each hop, but
            # re-check the final landing URL too.
            _validate_url(resp.geturl())
            content_type = (resp.headers.get_content_type() or "").lower()
            # Fail closed: a missing/blank Content-Type must NOT bypass the
            # allowlist (the old `and content_type` short-circuit let it through).
            if accept_types and not any(t in content_type for t in accept_types):
                raise HTTPException(
                    status_code=400,
                    detail=f"Unsupported content type from URL: {content_type or 'unknown'}",
                )
            body = resp.read(max_bytes + 1)
            if len(body) > max_bytes:
                raise HTTPException(
                    status_code=413,
                    detail=f"URL response too large (max {max_bytes // (1024 * 1024)} MB)",
                )
            encoding = resp.headers.get_content_charset()
            return _FetchResult(resp.geturl(), content_type, encoding, body)
    except HTTPException:
        raise
    except urllib.error.HTTPError as exc:
        raise HTTPException(status_code=400, detail=f"URL fetch failed: HTTP {exc.code}") from exc
    except TimeoutError as exc:
        raise HTTPException(status_code=504, detail="URL fetch timed out") from exc
    except (urllib.error.URLError, OSError) as exc:
        reason = getattr(exc, "reason", exc)
        raise HTTPException(status_code=400, detail=f"Could not fetch URL (network error): {reason}") from exc


# Per-THREAD HTTP/HTTPS connection cache. urllib's `urlopen` is one-shot
# (new socket + TLS handshake every call); a tiny custom pool lets repeat
# fetches against the same host reuse the established connection. We
# don't import `requests` because it's not a guaranteed dep on the deploy
# VM and stdlib gives us the same keep-alive for free.
#
# This MUST be thread-local: each tool request runs in its own worker thread
# (run_bounded / asyncio.to_thread) and http.client connections are not
# thread-safe. A single shared dict handed concurrent fetches to the same host
# the *same* connection object, interleaving their request/response cycles —
# a cross-request data-mix. Thread-local storage keeps the keep-alive reuse
# within a worker thread while isolating concurrent requests.
_conn_local = threading.local()


def _thread_conn_cache() -> dict[tuple[str, str, int], http.client.HTTPConnection]:
    cache = getattr(_conn_local, "conns", None)
    if cache is None:
        cache = {}
        _conn_local.conns = cache
    return cache


def _get_conn(scheme: str, host: str, port: int) -> http.client.HTTPConnection:
    key = (scheme, host, port)
    cache = _thread_conn_cache()
    cached = cache.get(key)
    if cached is not None:
        return cached
    if scheme == "https":
        conn: http.client.HTTPConnection = http.client.HTTPSConnection(host, port, timeout=URL_FETCH_TIMEOUT)
    else:
        conn = http.client.HTTPConnection(host, port, timeout=URL_FETCH_TIMEOUT)
    cache[key] = conn
    return conn


def _fetch_url_html(url: str) -> str:
    """Fetch `url` and return its HTML, enforcing size + content-type caps.

    Uses an HTTP/1.1 keep-alive connection cached per (scheme, host, port)
    so subsequent fetches against the same host skip DNS + TLS handshake.
    Falls back to a one-shot `urllib.request.urlopen` if the cached
    connection has gone stale.

    NOTE: We re-validate the URL here even though the caller has already
    done so — between the original validation and this point, a malicious
    resolver could rotate the answer set (classic DNS rebinding). The
    re-check shrinks the rebinding window to a single getaddrinfo() call
    immediately before connect. It's not perfect (the kernel still
    re-resolves at connect time), but combined with the small fetch
    timeout it raises the bar substantially.
    """
    _validate_url(url)
    parsed = urlparse(url)
    scheme = parsed.scheme
    host = parsed.hostname or ""
    port = parsed.port or (443 if scheme == "https" else 80)
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"

    headers = {
        "User-Agent": _USER_AGENT,
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
        "Connection": "keep-alive",
    }

    def _read_with_caps(resp_headers, body_iterable) -> str:
        content_type = ""
        for k, v in resp_headers:
            if k.lower() == "content-type":
                content_type = v.lower()
                break
        # Fail closed on a missing/blank Content-Type too (no `content_type and`
        # short-circuit) so an untyped response can't bypass the allowlist.
        if not any(t in content_type for t in ("text/html", "application/xhtml", "text/plain", "application/xml")):
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported content type from URL: {content_type or 'unknown'}",
            )
        # Read with a hard byte cap.
        raw = body_iterable(MAX_REMOTE_HTML_BYTES + 1)
        if len(raw) > MAX_REMOTE_HTML_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"URL response too large (max {MAX_REMOTE_HTML_BYTES // (1024*1024)} MB)",
            )
        return raw.decode("utf-8", errors="replace")

    # Try keep-alive path first.
    try:
        conn = _get_conn(scheme, host, port)
        conn.request("GET", path, headers=headers)
        resp = conn.getresponse()
        if resp.status >= 400:
            # Drain so the connection stays usable for the next request.
            resp.read()
            raise HTTPException(
                status_code=400,
                detail=f"URL fetch failed: HTTP {resp.status}",
            )
        return _read_with_caps(resp.getheaders(), resp.read)
    except HTTPException:
        raise
    except (http.client.HTTPException, OSError, TimeoutError) as exc:
        # Cached connection went stale — drop it and fall back to a fresh
        # one-shot urlopen so we still serve the request.
        _thread_conn_cache().pop((scheme, host, port), None)
        logger.debug("html_to_pdf: keep-alive miss for %s://%s: %s", scheme, host, exc)
        req = urllib.request.Request(url, headers=headers)
        try:
            # Use the SSRF-validating opener (NOT plain urlopen) so a redirect
            # to a private/internal host is re-validated and refused. The bare
            # urlopen here previously followed redirects with no re-check.
            with _validating_opener().open(req, timeout=URL_FETCH_TIMEOUT) as resp:
                _validate_url(resp.geturl())
                return _read_with_caps(resp.headers.items(), resp.read)
        except HTTPException:
            raise
        except TimeoutError as exc:
            raise HTTPException(status_code=504, detail="URL fetch timed out") from exc
        except Exception as exc:
            raise HTTPException(
                status_code=400,
                detail=f"Could not fetch URL (network error): {exc}",
            ) from exc


def url_to_pdf(url: str) -> str:
    """Fetch a URL and convert it to a PDF file."""
    started = time.monotonic()
    _validate_url(url)
    ensure_temp_dir()
    output_path = str(get_temp_path(f"html2pdf_{uuid.uuid4().hex}.pdf"))

    logger.info("html_to_pdf: url_fetch start url=%s", urllib.parse.urlparse(url).hostname or "?")
    try:
        html_content = _fetch_url_html(url)
    except HTTPException:
        raise
    except Exception as exc:
        try:
            os.unlink(output_path)
        except OSError:
            pass
        raise HTTPException(
            status_code=400, detail=f"Could not fetch URL (network error): {exc}",
        ) from exc

    try:
        _fitz_html_to_pdf(html_content, output_path)
    except Exception as exc:
        try:
            os.unlink(output_path)
        except OSError:
            pass
        raise HTTPException(
            status_code=500,
            detail=f"URL rendering failed: {exc}",
        ) from exc
    duration_ms = int((time.monotonic() - started) * 1000)
    try:
        out_size = os.path.getsize(output_path)
    except OSError:
        out_size = 0
    logger.info(
        "html_to_pdf: url_done duration_ms=%d output_bytes=%d",
        duration_ms, out_size,
    )
    return output_path
