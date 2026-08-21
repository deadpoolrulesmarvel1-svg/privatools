# BYOK AI — Design

**Status:** spec. Decomposed into four sub-projects; this document specs 0.75a
in full and scopes b/c/d well enough to plan later.

**Date:** 2026-08-21

## The idea

Let people bring their own AI API key and use it against their own documents,
with the key and the document going straight from their browser to the provider
— never through PrivaTools. The existing privacy claim, extended to AI rather
than compromised for it.

## Why decompose

The request covers three scopes at once (upgrade the two existing AI tools, add
new AI-native tools, and build a general AI-actions layer) across every
provider worth supporting. That is not one spec. But the split is not arbitrary
— everything depends on one engine, and that engine is where all the risk is:

- **0.75a — BYOK foundation.** Provider registry, key storage, the call layer,
  error surface, CSP. Nothing else can start.
- **0.75b — Upgrade Summarize PDF and Smart Redact.** Smallest real proof; the
  UI already exists.
- **0.75c — New AI-native tools.** Chat-with-PDF, translate, rewrite,
  extract-to-JSON. Only viable *because* the user pays for inference.
- **0.75d — General AI actions layer.** Free-form prompt over any document.

Ship a, then b. b is the honest test of whether a is right, and it is small
enough that being wrong is cheap.

---

## The constraint that shapes everything: CSP

Browser-direct works at the network layer. Verified by preflight from
`https://privatools.me` on 2026-08-21:

| Provider | `Access-Control-Allow-Origin` | Key header allowed |
|---|---|---|
| Anthropic | `*` | `x-api-key`, `anthropic-dangerous-direct-browser-access` |
| OpenAI | echoes origin | `authorization` |
| Gemini | echoes origin | `x-goog-api-key` |

**But production CSP is:**

```
connect-src 'self' https://huggingface.co https://cdn.jsdelivr.net https://api.privatools.me
```

Every provider call would be refused by the browser before it left the page.
CORS being fine is irrelevant while CSP says no. This is the single most
important implementation fact in this document.

Worse, it interacts badly with the custom-endpoint requirement: a user-supplied
URL cannot appear in a statically-served allowlist.

### Decision: curated origins + localhost, not a wildcard

`connect-src` gains one explicit entry per supported provider, plus loopback
for local models:

```
connect-src 'self'
  https://huggingface.co https://cdn.jsdelivr.net https://api.privatools.me
  https://api.anthropic.com
  https://api.openai.com
  https://generativelanguage.googleapis.com
  https://openrouter.ai
  https://api.groq.com
  https://api.together.xyz
  https://api.mistral.ai
  https://api.deepseek.com
  http://localhost:* http://127.0.0.1:*
```

Rejected alternatives, and why:

- **`connect-src https:`** — would allow any tool page to exfiltrate to any
  host. On a product whose entire claim is that data does not leave the device,
  this trades away the mechanism that actually enforces it. No.
- **Sandboxed iframe with its own permissive CSP** — technically works and
  isolates the relaxation, but the key must then live inside the iframe, which
  splits the key store across two origins and makes the security story harder
  to explain than the thing it protects. No.
- **Server proxy for unsupported endpoints** — explicitly ruled out; see
  Failure behaviour.

The cost is honest and should be stated in the UI: **truly arbitrary endpoints
are not supported.** A curated list plus loopback covers Ollama, LM Studio,
OpenRouter, Groq, Together, Mistral and DeepSeek, which is the great majority
of real use. Adding a provider is a one-line CSP change and a registry entry —
deliberately a code change, because silently allowing a new egress destination
should not be a runtime decision a user can make.

`http://localhost:*` is safe here in a way it would not be elsewhere: it can
only reach a server on the user's own machine, and mixed-content rules already
confine it.

### Where the CSP change actually goes

Verified 2026-08-21, because getting this wrong wastes a release cycle.

CSP is emitted in **two** places, and they do not both apply everywhere:

- `backend/app/main.py:218` builds it per-request (it carries the script nonce).
- The live nginx config sets its own, but only inside four static-asset
  locations — `= /sw.js`, `^~ /assets/`, the manifest/robots/llms regex, and
  the static file-extension regex. Each does `proxy_hide_header
  Content-Security-Policy` then `add_header` its own.

`location /`, which serves every SPA page including the tool pages, does
**neither** — so the app's header passes straight through. Confirmed against
production: exactly one CSP header is returned and it contains
`'nonce-…'`, which only the app emits (nginx's uses `'wasm-unsafe-eval'`).

**Therefore the change is a one-file edit to `main.py` and ships through the
normal release pipeline.** No hand-edit of the VM's nginx config is required,
which matters because that file is hand-maintained and not auto-deployed —
`deploy/nginx.conf` in the repo is stale and must not be trusted.

Had both layers emitted a header, the browser would enforce the intersection
and an app-only change would have silently failed.

### Loopback and mixed content

`http://localhost` / `http://127.0.0.1` from an HTTPS page is **not** blocked as
mixed content: the spec classifies loopback as a potentially trustworthy origin
precisely because it cannot leave the device. So local models (Ollama, LM
Studio) work without an HTTPS certificate.

---

## Key storage

**The honest caveat, stated up front and in the UI.** The PDF-password vault
uses non-extractable WebCrypto keys — the browser will decrypt on your behalf
but never hand the key back, so even fully compromised page JS cannot read it.
**A BYOK API key cannot work that way.** It has to be readable to go in an
`Authorization` header. It can be encrypted at rest; it cannot be
non-extractable.

So: encrypted at rest in IndexedDB via the existing `localStore` AES-GCM
wrapping key, plaintext existing only transiently in memory during a call.

This is still materially better than the comparison point — ihatepdf.cv stores
its Gemini key in **plaintext localStorage**, readable by any script and
visible in devtools — but "better than them" is not the standard. The UI says
what is true: *encrypted on this device; readable in memory while a request is
in flight; never sent anywhere but the provider.*

**Session-only toggle.** Default is persist-encrypted. An explicit
"this session only" option keeps the key in memory, never written to
IndexedDB — for shared or borrowed machines. Chosen over session-only-always
because forcing a re-paste on every reload makes the feature annoying enough to
go unused, and an unused security feature protects nobody.

### Non-negotiables

- Never in a URL, query string, or fragment.
- Never in telemetry, analytics, or any log line — including error reports.
- Never sent to any origin but the selected provider's.
- Cleared by the existing `eraseEverything()` path, which must learn about it.
- A redaction helper wraps error surfacing so a provider error echoing the
  request cannot leak the key into a toast or console.

---

## Architecture

New package `frontend/src/lib/byok/`, mirroring how `localStore/` is laid out:

| File | Responsibility |
|---|---|
| `providers.ts` | Registry: id, label, origin, auth header shape, model list, request/response adapters. Pure data + pure functions. |
| `keyStore.ts` | Encrypted persistence on `localStore`, session-only mode, erase integration. |
| `client.ts` | `complete({provider, model, messages, signal})` → text or stream. The only module that performs `fetch`. |
| `errors.ts` | Typed failures: `CspBlocked`, `BadKey`, `RateLimited`, `NoCredit`, `ProviderDown`, `Unsupported`. |
| `redact.ts` | Strips key material from anything user- or console-facing. |

Three provider shapes, not one abstraction pretending they are the same:

- **Anthropic** — `x-api-key` + `anthropic-version` +
  `anthropic-dangerous-direct-browser-access: true`; `/v1/messages`.
- **OpenAI-shaped** — `Authorization: Bearer`; `/v1/chat/completions`. Covers
  OpenAI itself and every compatible endpoint, which is why custom base URLs
  are cheap to support.
- **Gemini** — `x-goog-api-key`; `:generateContent`.

`client.ts` is the sole `fetch` caller so that the never-leak rules are
enforceable by reading one file.

## Failure behaviour

Chosen: **fail with a clear explanation, never proxy.**

A blocked or failed call says what happened and what to do. It does not fall
back to a server proxy, because routing the key and document through
PrivaTools' backend would falsify the one claim the product is built on — and
a privacy guarantee with an automatic exception is not a guarantee.

It also does not silently fall back to the local WASM model. Degrading from
Claude to distilbart without saying so hands the user a much worse result while
implying it came from the model they chose. If local fallback is offered at
all, the user chooses it explicitly, after being told the first attempt failed.

`CspBlocked` deserves its own message: it means a genuine misconfiguration or
an unsupported custom endpoint, and "your network blocked this" would be a lie.

## Testing

- Provider adapters: request shape and response parsing, per provider, against
  recorded fixtures. No network in unit tests.
- `keyStore`: round-trip encrypt/decrypt; session-only never touches
  IndexedDB; `eraseEverything()` removes keys.
- **Leak tests** — the ones that matter: assert a key never appears in a
  serialised error, a toast, a log line, or a URL. Written as a fixture-driven
  sweep so new error paths are covered by default.
- A CSP contract test asserting every registry origin is present in
  `connect-src`, so adding a provider without the CSP entry fails CI rather
  than at runtime in a user's browser. This is the same class as the tool
  registry parity bug that put two 404s into production.

## Open questions for 0.75b+

- Do documents get chunked client-side for long PDFs, or is the context limit
  surfaced honestly and the user asked to narrow the range?
- Is there a cost estimate before a call? Users spending their own money will
  want one; it needs a token count, which needs a tokenizer per provider.
- Does Smart Redact's BYOK path keep the local model as a first pass to avoid
  sending obvious PII to a third party at all?
