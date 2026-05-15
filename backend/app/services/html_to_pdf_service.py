import ipaddress
import re
import uuid
from urllib.parse import urlparse

from fastapi import HTTPException

from ..utils.cleanup import get_temp_path, ensure_temp_dir

_PRIVATE_NETWORKS = [
    ipaddress.ip_network("10.0.0.0/8"),
    ipaddress.ip_network("172.16.0.0/12"),
    ipaddress.ip_network("192.168.0.0/16"),
    ipaddress.ip_network("127.0.0.0/8"),
    ipaddress.ip_network("169.254.0.0/16"),
    ipaddress.ip_network("::1/128"),
    ipaddress.ip_network("fc00::/7"),
]

_BLOCKED_HOSTNAMES = {"localhost", "0.0.0.0", "127.0.0.1", "::1", "169.254.169.254"}


def _validate_url(url: str) -> None:
    """Raise HTTPException(400) for URLs that could cause SSRF.

    Performs DNS resolution to prevent DNS rebinding attacks.
    """
    try:
        parsed = urlparse(url)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid URL")

    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="Only http and https URLs are allowed")

    hostname = parsed.hostname or ""
    if hostname.lower() in _BLOCKED_HOSTNAMES:
        raise HTTPException(status_code=400, detail="URL points to a blocked host")

    # Check if hostname is a literal IP
    try:
        addr = ipaddress.ip_address(hostname)
        for network in _PRIVATE_NETWORKS:
            if addr in network:
                raise HTTPException(status_code=400, detail="URL points to a private or reserved IP address")
    except ValueError:
        pass

    # Resolve hostname to prevent DNS rebinding attacks
    import socket
    try:
        resolved = socket.getaddrinfo(hostname, None)
        for family, _type, _proto, _canonname, sockaddr in resolved:
            ip_str = sockaddr[0]
            try:
                addr = ipaddress.ip_address(ip_str)
                for network in _PRIVATE_NETWORKS:
                    if addr in network:
                        raise HTTPException(
                            status_code=400,
                            detail="URL resolves to a private or reserved IP address",
                        )
            except ValueError:
                continue
    except socket.gaierror:
        raise HTTPException(status_code=400, detail="Could not resolve hostname")


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


def _weasyprint_html_to_pdf(html_content: str, output_path: str) -> None:
    """Render with WeasyPrint — proper CSS/font/layout support. Preferred."""
    from weasyprint import HTML
    HTML(string=_wrap_html(html_content)).write_pdf(output_path)


def _fitz_html_to_pdf(html_content: str, output_path: str) -> None:
    """PyMuPDF fallback — used only when WeasyPrint isn't available."""
    import fitz
    html_content = _wrap_html(html_content)
    writer = fitz.DocumentWriter(output_path)
    story = fitz.Story(html=html_content)
    mediabox = fitz.paper_rect("a4")
    where = mediabox + fitz.Rect(40, 40, -40, -40)
    more = True
    while more:
        dev = writer.begin_page(mediabox)
        more, _ = story.place(where)
        story.draw(dev)
        writer.end_page()
    writer.close()


def html_to_pdf(html_content: str) -> str:
    """Convert an HTML string to a PDF file. Prefers WeasyPrint (best CSS/font
    fidelity) and falls back to PyMuPDF Story only if WeasyPrint is missing.
    Errors are surfaced to the caller — never silently degraded to plain text.
    """
    ensure_temp_dir()
    output_path = str(get_temp_path(f"html2pdf_{uuid.uuid4().hex}.pdf"))
    try:
        _weasyprint_html_to_pdf(html_content, output_path)
    except ImportError:
        # WeasyPrint not installed — try fitz Story as a fallback
        try:
            _fitz_html_to_pdf(html_content, output_path)
        except Exception as exc:
            raise HTTPException(
                status_code=500,
                detail=f"HTML rendering failed (PyMuPDF fallback): {exc}",
            ) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"HTML rendering failed: {exc}") from exc
    return output_path


def url_to_pdf(url: str) -> str:
    """Fetch a URL and convert it to a PDF file."""
    _validate_url(url)
    ensure_temp_dir()
    output_path = str(get_temp_path(f"html2pdf_{uuid.uuid4().hex}.pdf"))

    import urllib.request
    with urllib.request.urlopen(url, timeout=30) as resp:
        html_content = resp.read().decode("utf-8", errors="replace")
    _fitz_html_to_pdf(html_content, output_path)
    return output_path
