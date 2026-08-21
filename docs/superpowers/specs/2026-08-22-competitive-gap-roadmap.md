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

### What the checker found in our own product ✅ **fixed**

Pointing the checker at our own output turned up a real data-loss bug. Feeding an
accessible PDF that scores **96/100** through each tool:

| Tool | Before | After fix |
|---|---|---|
| grayscale-pdf | **11** (−85) | **96** |
| merge-pdf | **39** (−57) | **72** |
| extract-pages | **39** (−57) | **72** |
| rotate · watermark · page-numbers · delete-pages · flatten · compress · pdf-to-pdfa | 96 (no loss) | 96 |
| strip-metadata | 89 | 89 — correct, it strips the title by design |

**Causes.** `merge` and `extract-pages` build on `pikepdf.Pdf.new()`, whose catalog starts
empty, so `/Lang`, the title and `/ViewerPreferences` were never carried across. And
`grayscale` ran a 200 DPI rasterising pass **unconditionally**, contradicting its own
module docstring — every PDF through `/grayscale` came back as flat images with no
selectable text, no search, no structure tree and a bigger file.

This matters beyond compliance: someone who paid to have a document remediated lost that
work by merging it, and nothing in the output said so.

**Fixed** in `backend/app/utils/pdf_accessibility.py` (property preservation) and
`grayscale_service.py` (rasterise only when coloured vector content is actually present),
with 12 tests including one proving grayscale still converts colour.

**Structure tree — also done.** Every tool now reaches **96, full parity with its input.**

The tractable part was one pikepdf behaviour: `dst.pages.append()` copies through the same
object map as `copy_foreign`, so copying the StructTreeRoot *after* appending pages makes
every `/Pg` resolve to the page already in the destination rather than a duplicate. That
turns "re-point every reference" into "prune what didn't come along".

Merge needed more: `/StructParents` keys are only unique within a document, so two tagged
inputs both numbering from 0 collide — and a collision doesn't error, it silently points
half the pages at the other document's elements. `StructureTreeMerger` shifts each source
into its own key range and renumbers the pages it contributed.

It stays all-or-nothing: merging a tagged file with an untagged one leaves the output
honestly untagged rather than declaring `/Marked true` over content that has no structure.

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

## Priority 3 — Bates numbering variants ✅ **shipped**

**Gap:** ours exposes prefix, start, digits and 6 positions. Adobe and Foxit both have
suffix, font control, page range, **a continuous sequence across a multi-file batch**, and
**Remove Bates Numbering**.

Our own code comment admits the limitation: *"each PDF gets its own sequence starting at
`start_number`"*. For the legal audience this is the difference between usable and not —
a production set is numbered continuously across every file in it.

**Files:** `backend/app/services/bates_numbering_service.py`,
`backend/app/routes/bates_numbering.py`, `frontend/src/components/tool-ui/BatesUI.tsx`.

**Shipped 2026-08-22.** `POST /api/bates-numbering-batch` stamps a set as one continuous
sequence and returns a ZIP plus a numbering manifest recording which range landed on which
file — the production log a paralegal would otherwise rebuild by hand. The single-file
endpoint gained a suffix, a page range and font size, and reports `X-Bates-Next` so a
caller can chain documents manually. `POST /api/bates-remove` and `/tool/bates-remove`
strip stamps back off by **redaction** rather than an overlay, since the point of removing
a production number is that it is no longer in the file.

Removal is guarded twice: the text must match the Bates pattern *and* sit within 72pt of
the page edge, so a figure caption reading "000123" mid-page survives. There is a test for
exactly that.

The old UI carried a banner telling users "each PDF restarts numbering — merge first if
you need one continuous run". That banner is gone.

**Still open:** per-page font/colour control, and Adobe's "apply to a folder including
subfolders" (which has no meaning without a filesystem).

---

## Priority 4 — Redaction exemption codes ✅ **shipped**

**Gap:** Adobe ships two pre-populated exemption-code sets (US FOIA, US Privacy Act),
stamps the code as overlay text on each redaction, and allows custom sets. **No other
competitor has this at all.**

Ours takes box coordinates with no codes, no overlay text and no report. Adding code
overlays plus a redaction summary makes the tool usable for actual FOIA production work,
which is a small audience that currently has exactly one option and pays Adobe for it.

**Shipped 2026-08-22.** Each redaction box takes an optional `code`, drawn inside the box
by PyMuPDF's own redaction machinery so the citation is flattened into the page rather than
left as an annotation someone can peel off. Box colour picks black or white text by
perceived luminance — an unreadable citation is the same as no citation.

`/api/redact` returns an `X-Redaction-Report` header: the withholding log, counting
redactions per page and per exemption code, with uncoded ones tracked separately. The UI
shows it on the result screen and says plainly that it isn't stored anywhere.

Two code sets ship pre-populated in `frontend/src/data/redaction-codes.ts` — **US FOIA**
(5 U.S.C. § 552(b), 14 codes) and the **US Privacy Act** (5 U.S.C. § 552a, 10 codes).
Default is no codes, which is right: most redaction is not a statutory production, and an
unexplained citation is worse than none.

There were no redaction tests in the repo at all before this, so the basics are now covered
too — content under a rect is genuinely removed, other pages are untouched, out-of-range
pages are skipped rather than fatal.

---

## Priority 5 — Named optimisation profiles ✅ **shipped**

**Gap:** Adobe, Nitro and Foxit all ship saveable compression/downsampling profiles;
we ship one Compress button with three levels.

**Shipped 2026-08-22.** Four purpose-named profiles — **email**, **print**, **archive**,
**web** — alongside the existing intensity levels. You know you are emailing something;
you should not have to translate that into a quality percentage.

Plus `target_size_mb`: "make this fit under 10 MB", which is the form of the question
people actually have. ihatepdf.cv answers it free; Smallpdf and iLovePDF paywall it. It
binary-searches a seven-rung ladder so it lands on the *lightest* setting that fits in
about three passes rather than grinding to the bottom, discards the losing passes, and
returns `X-Target-Met: false` when even the harshest rung overshoots rather than silently
handing back a file that misses.

No "strip metadata" flag on any profile, deliberately. Adobe's optimizer has one, but
folding it into a compression preset would silently delete the document title — the same
quiet accessibility loss the merge and grayscale fixes were about.

### And it surfaced a production bug

`_recompress_image` opened `read_raw_bytes()` with PIL. For `/DCTDecode` those bytes are a
complete JPEG, so it worked. For `/FlateDecode` they are zlib-compressed samples with no
container — PIL raised, the image was skipped, and **the file came back the size it went
in while the UI reported success.**

Measured on the same generated page at `extreme`:

| Encoding | Before fix | After fix |
|---|---|---|
| `/DCTDecode` | 0.18 | 0.18 |
| `/FlateDecode` | **1.00 — nothing** | **0.47** |

Flate is how screenshots, PNG exports and much scanner output is stored, so this was not
an edge case. The tell was the `current_filter` argument the function accepted and never
read. Now decoded through `pikepdf.PdfImage`, which understands the filters and the colour
space, with the raw-bytes path kept as a fallback and stencil masks skipped.

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
