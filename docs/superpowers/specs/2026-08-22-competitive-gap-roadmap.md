# Competitive Gap Roadmap

**Date:** 2026-08-22
**Source:** first-party audit of 10 competitors (21 Aug 2026) — live uploads, network
captures, JS bundle reads, vendor pricing APIs.

---

## The decision this encodes

The audit found 15 capabilities PrivaTools lacks. **Nine are account-shaped** and are a
positioning boundary, not a backlog. **Six are achievable without state** and are the
roadmap below.

### Not building (and why)

Send-for-signature · multi-signer ordering · reminders/expiry/void · audit trails and
completion certificates · bulk send · document tracking · reusable templates and fill
links · cloud storage and sync · real-time collaboration.

Every one requires identity, persistence and notification. Building them means becoming
the thing the product exists not to be. Adobe, Foxit, Nitro and DocHub all have them;
that is what their subscription pays for. The counter-position is that PrivaTools needs
none of it — and that only stays true if we don't build it.

### The one competitor that matters

`ihatepdf.cv` makes the same argument and can prove it: zero backend endpoints across
57 audited chunks, a real upload firing no network request, 14 MB of Ghostscript
compiled to WASM. It is also **PDF-only and four times narrower** — 54 tools to our 216,
with no image, video, audio or developer tools. Breadth is the defensible counter.

---

## Priority 1 — Accessibility checking ✅ **shipped**

**Status:** implemented 2026-08-22. `POST /api/accessibility-check` → `/tool/accessibility-check`.

**Why this first.** It is the only capability every competitor either paywalls behind a
Windows desktop app (Adobe, Foxit) or lacks entirely (DocHub, PDFescape, ihatepdf,
TinyWow, LightPDF). It needs no state. The keyword is held by tiny niche tools with no
budget — PAC, freepdfchecker.com, AccessiTool — not by anyone defending a free tier.

**Files:**
- `backend/app/services/accessibility_service.py` — audit engine (pikepdf for the object
  model, fitz for page content)
- `backend/app/routes/accessibility.py` — JSON endpoint, read-only
- `frontend/src/components/tool-ui/AccessibilityCheckUI.tsx` — report UI
- `backend/tests/test_accessibility_service.py` — 35 tests

**What it checks.** Tagging and `MarkInfo/Marked` · document `/Lang` · title and
`DisplayDocTitle` · encryption's accessibility permission · heading order (skipped
levels) · figure `/Alt` and `/ActualText` · table `<TH>` header cells · list `<LI>`
structure · font embedding · extractable text (un-OCR'd scan detection) · page `/Tabs`
· link descriptions · form-field `/TU` labels · bookmarks on long documents.
RoleMap chains are resolved so custom tags grade as their standard type.

**Four checks are reported as `manual` and never scored** — colour contrast, reading
order, alt-text *quality*, and colour-alone encoding. PDF/UA designates these
human-verified and Adobe's Full Check does the same. Scoring them as passes would be a
lie; hiding them would make a clean report look more complete than it is.

### Follow-up: remediation

The checker diagnoses; it cannot fix. Adobe's autotag is their crown jewel and is
genuinely hard. But the metadata-level failures are trivial to repair and account for
most of what real documents fail on:

- set `/Lang` from a user choice or detected text
- set a title and `ViewerPreferences /DisplayDocTitle`
- set `/Tabs /S` on every page
- add `/TU` tooltips to form fields from their field names

**Worth noting:** running the checker against PrivaTools' own tool output scores **28/100**
— our PDFs come out untagged, with no `/Lang` and no `/Tabs`. Fixing our own output is
the cheapest possible credibility for this tool, and a separate small task.

---

## Priority 2 — Translation

**Gap:** Foxit, Nitro, LightPDF and TinyWow all ship document translation. PrivaTools has
none. LightPDF runs five language-pair SEO landing pages off one engine.

**Approach:** extract text with fitz, translate, re-lay. The honest constraint is that
re-laying translated text into the original layout is the hard part — expanded German or
Arabic RTL will not fit the source boxes. Two options:

1. **Translate to a new document** (Markdown or a clean PDF). Loses layout, keeps meaning,
   ships in days.
2. **In-place overlay** with box-fitting and font fallback. Matches what competitors do
   and is a much larger job.

Recommend (1) first, since it is genuinely useful and the SEO landing pages don't care.

**Open question:** which engine. A local model keeps the privacy story intact but is
large; a cloud API breaks "nothing leaves the server" for this one tool and would need
the same explicit per-tool disclosure the BYOK AI tools use.

---

## Priority 3 — Bates numbering variants

**Gap:** ours exposes prefix, start, digits and 6 positions. Adobe and Foxit both have
suffix, font control, page range, **a continuous sequence across a multi-file batch**, and
**Remove Bates Numbering**.

Our own code comment admits the limitation: *"each PDF gets its own sequence starting at
`start_number`"*. For the legal audience this is the difference between usable and not —
a production set is numbered continuously across every file in it.

**Files:** `backend/app/services/bates_numbering_service.py`,
`backend/app/routes/bates_numbering.py`, `frontend/src/components/tool-ui/BatesUI.tsx`.

**Cheapest high-value slice:** continuous cross-file sequencing + suffix + removal.

---

## Priority 4 — Redaction exemption codes

**Gap:** Adobe ships two pre-populated exemption-code sets (US FOIA, US Privacy Act),
stamps the code as overlay text on each redaction, and allows custom sets. **No other
competitor has this at all.**

Ours takes box coordinates with no codes, no overlay text and no report. Adding code
overlays plus a redaction summary makes the tool usable for actual FOIA production work,
which is a small audience that currently has exactly one option and pays Adobe for it.

**Files:** `backend/app/services/redact_service.py`, `frontend/src/components/tool-ui/RedactUI.tsx`.

---

## Priority 5 — Named optimisation profiles

**Gap:** Adobe, Nitro and Foxit all ship saveable compression/downsampling profiles;
we ship one Compress button with three levels.

Not a new engine — a preset layer over the existing compress service, with named
profiles (Email, Print 300 DPI, Archive, Web) exposing image downsampling, colour
conversion and compatibility level. `ihatepdf.cv` already does this inside its workflow
builder, including a custom target-MB mode worth copying.

---

## Priority 6 — PDF/X and PDF/E

**Gap:** Adobe and Foxit create *and validate* PDF/A, PDF/X and PDF/E. We have PDF/A only,
and our validator is explicitly heuristic.

Lowest priority: real demand is small and correct conformance is genuinely hard. Listed
for completeness rather than as a recommendation.

---

## Not a gap, but the two highest-leverage non-tool items

**An MCP server over the 216 tools.** `sign.com` (same legal entity as Smallpdf) ships an
eSignature API with a dedicated AI-agent product — per-agent keys, agent-aware audit
tagging, kill switch — and advertises Claude MCP support. LightPDF publishes MCP docs.
Smallpdf itself has **no API at all**. A stateless MCP server is a stronger version of the
same bet: nothing to meter, nothing to store, no envelopes.

**A browser extension.** Smallpdf's moat is not its tool count — it is a Chrome extension
with 2M users and a Workspace add-on with 3M+, both free. DocHub's entire growth engine is
one Google Drive "Open with" placement (57M+ installs) bought with permissions we would
never ask for: full Drive read, Gmail read, send-on-your-behalf, org directory. An
extension that opens the current PDF in a tool asks for none of that.

---

## Tool-page structure (adopt independently of visual direction)

Adobe, Nitro, Foxit, DocHub and PDFescape converged on the same tool page independently,
which makes it evidence rather than taste:

- size limits stated **inside** the drop zone
- the retention promise **at** the drop zone, not in a policy page
- options revealed **after** upload, never before
- progress in the same card, no page transition
- a rating with a real vote count above the fold
- an FAQ that answers objections; use cases written as personas
- a categorised index of every other tool in every footer

Two worth copying outright: **Nitro's free-vs-paid comparison table** on every tool page
(ours runs with an empty right column), and **Smallpdf's OS-aware size limits** — MB
computed as 1024² on Mac/Linux/Android and 1000² on Windows so the number matches the
user's own file manager.

---

## Already have it, just not surfaced

`/pipeline` has 17 backend steps and single-upload server-side chaining. `ihatepdf.cv`'s
`/workflow` is its standout feature and ours is comparable — but theirs has presets,
save/export as JSON, undo/redo and batch mode, and ours isn't linked from any tool's
result screen. **That is packaging, not engineering**, and it is the cheapest win in this
document.
