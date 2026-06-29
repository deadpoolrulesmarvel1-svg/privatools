"""Unit tests for the api-subdomain-split runtime config helpers.

Stdlib-only (no FastAPI / native-lib import) so they run without the full
backend venv. They cover the pure logic behind the ``PUBLIC_API_BASE_URL``
flag: the runtime ``<meta>`` tag injected into ``index.html``, its escaped
value, and host parsing used to extend ``TRUSTED_HOSTS``.
"""

from app.runtime_config import (
    API_BASE_META_NAME,
    host_from_url,
    inject_runtime_config,
    normalize_origin,
    runtime_config_meta,
)


class TestHostFromUrl:
    def test_strips_scheme_path_and_port(self):
        assert host_from_url("https://api.privatools.me") == "api.privatools.me"
        assert host_from_url("https://api.privatools.me:443/api/health") == "api.privatools.me"
        assert host_from_url("http://api.privatools.me/") == "api.privatools.me"

    def test_accepts_bare_host(self):
        assert host_from_url("api.privatools.me") == "api.privatools.me"

    def test_blank_yields_empty(self):
        assert host_from_url("") == ""
        assert host_from_url("   ") == ""


class TestNormalizeOrigin:
    def test_trims_whitespace_and_trailing_slash(self):
        assert normalize_origin("  https://api.privatools.me/  ") == "https://api.privatools.me"
        assert normalize_origin("https://api.privatools.me") == "https://api.privatools.me"


class TestRuntimeConfigMeta:
    def test_empty_when_no_api_base(self):
        assert runtime_config_meta("") == ""
        assert runtime_config_meta("   ") == ""

    def test_emits_meta_tag(self):
        assert (
            runtime_config_meta("https://api.privatools.me")
            == '<meta name="privatools:api-base" content="https://api.privatools.me">'
        )

    def test_trailing_slash_normalized(self):
        assert 'content="https://api.privatools.me"' in runtime_config_meta(
            "https://api.privatools.me/"
        )

    def test_meta_name_matches_constant(self):
        assert f'name="{API_BASE_META_NAME}"' in runtime_config_meta("https://api.privatools.me")

    def test_escapes_attribute_to_block_injection(self):
        tag = runtime_config_meta('https://x"><script>alert(1)</script>')
        assert "<script>" not in tag
        assert "&quot;" in tag and "&lt;script&gt;" in tag


class TestInjectRuntimeConfig:
    def test_noop_when_no_api_base(self):
        html = "<html><head></head><body>x</body></html>"
        assert inject_runtime_config(html, "") == html

    def test_inserts_before_head_close(self):
        html = "<html><head><title>t</title></head><body>x</body></html>"
        out = inject_runtime_config(html, "https://api.privatools.me")
        assert 'name="privatools:api-base"' in out
        assert out.index("privatools:api-base") < out.index("</head>")
        assert "<title>t</title>" in out and "<body>x</body>" in out

    def test_falls_back_to_prepend_without_head(self):
        html = "<div>no head here</div>"
        out = inject_runtime_config(html, "https://api.privatools.me")
        assert out.startswith('<meta name="privatools:api-base"')
        assert "<div>no head here</div>" in out
