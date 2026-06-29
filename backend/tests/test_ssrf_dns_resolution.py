"""Tests for the URL-fetch SSRF guard (_validate_url), including the DNS branch.

The audit flagged the DNS-resolution branch — a public-looking hostname whose
DNS answer is a private IP (the DNS-rebinding class) — as untested. These cover
the literal blocks AND that branch (with getaddrinfo mocked so the suite stays
network-free).
"""

import socket
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

sys.path.append(str(Path(__file__).resolve().parents[2]))

from backend.app.services.html_to_pdf_service import _validate_url


def _addrinfo(ip: str):
    return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, 0))]


class TestValidateUrlSSRF:
    @pytest.mark.parametrize(
        "url",
        [
            "ftp://example.com/x",            # non-http(s) scheme
            "file:///etc/passwd",             # file scheme
            "http://localhost/",              # blocked hostname
            "http://127.0.0.1/",              # blocked hostname
            "http://169.254.169.254/meta",    # cloud-metadata IP (blocked name)
            "http://[::1]/",                  # IPv6 loopback (blocked name)
            "http://10.0.0.1/",               # literal RFC1918
            "http://192.168.1.1/",            # literal RFC1918
            "http://172.16.5.5/",             # literal RFC1918
        ],
    )
    def test_blocks_obvious_ssrf_targets_without_dns(self, url):
        # All of these are rejected by scheme / hostname / literal-IP checks
        # before any DNS lookup happens.
        with pytest.raises(HTTPException):
            _validate_url(url)

    def test_rejects_hostname_that_resolves_to_private_ip(self, monkeypatch):
        # DNS-rebinding shape: innocuous hostname, private DNS answer.
        monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: _addrinfo("10.1.2.3"))
        with pytest.raises(HTTPException) as ei:
            _validate_url("http://innocent.example.com/page")
        assert ei.value.status_code == 400
        assert "private" in ei.value.detail.lower() or "reserved" in ei.value.detail.lower()

    def test_rejects_metadata_ip_via_dns(self, monkeypatch):
        monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: _addrinfo("169.254.169.254"))
        with pytest.raises(HTTPException):
            _validate_url("http://metadata.lookup.example/")

    def test_allows_hostname_that_resolves_to_public_ip(self, monkeypatch):
        monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: _addrinfo("93.184.216.34"))
        # Must NOT raise — a genuinely public target is allowed.
        _validate_url("http://example.com/")
