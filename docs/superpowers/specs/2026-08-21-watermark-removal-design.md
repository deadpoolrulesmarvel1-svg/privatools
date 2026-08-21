# Watermark Removal — Design

*Date: 2026-08-21 · Standalone tool spec (independent of the sub-project 0 → 3 chain) · Status: proposed*

---

## 1. Context

Two tools: **remove a visible watermark from a PDF**, and **remove a visible watermark from an image**. Both are among the most-searched file-tool queries, and the closest competitor (`ihatepdf.cv`, 54 tools) ships **neither** — see `docs/…/ihatepdf teardown`. Acrobat Pro has had PDF watermark removal for twenty years, so this is a table-stakes professional feature, not an exotic one.

This is explicitly **not** the `guillaumemeyer/watermarks-remover` project, which despite its name strips *AI provenance marks* — SynthID, C2PA content credentials, LLM token watermarks — and is out of scope for PrivaTools. This spec covers visible marks only: a logo, a diagonal "CONFIDENTIAL", a stock-preview stamp.

### Why this fits PrivaTools specifically

Everything needed is already installed:

| Capability | Already present | Evidence |
|---|---|---|
| PDF object model access | `pikepdf==8.12.0` | 43 files import it |
| Page/XObject/OCG introspection | `pymupdf==1.28.0` | `get_xobjects`, `get_ocgs`, `get_drawings`, `xref_object` all verified present |
| True content removal | in production | `apply_redactions()` already used by `redact_service`, `smart_redact_service`, `flatten_service` |
| Image inpainting | `opencv-python-headless==4.13.0.92` | pulled in by rembg; `cv2.inpaint` + `INPAINT_TELEA`/`INPAINT_NS` verified |
| Array/mask work | `numpy==2.2.6` | already locked |

**Zero new dependencies.** That matters on a 2-core VM whose lock is hashed and `--require-hashes` pinned.

### Goal

Detect visible watermarks in a PDF, show the user exactly what was found, and remove the ones they confirm — losslessly where the PDF structure allows it. Plus a mask-based inpainting tool for raster images.

### Non-goals

- **No AI-provenance stripping.** No SynthID, no C2PA, no LLM token watermarks, no detector evasion.
- **No ML.** No diffusion, no ControlNet. Deterministic object removal and classical inpainting only.
- **No silent removal.** Detection always produces a preview the user confirms (§5).
- **No promise of perfection** on watermarks flattened and rasterized into page content (§4.4).

### Intended use

Removing marks from documents you own or are authorised to modify — a draft stamp you applied, a template's placeholder logo, a "CONFIDENTIAL" banner on your own file. The UI states this plainly once, near the upload control, without lecturing.

---

## 2. The actual problem: where watermarks live

"Watermark" is not one thing in PDF. It is at least five, and they have completely different removability. Getting this taxonomy right *is* the design.

| # | How it's embedded | Detect via | Removal | Lossless? |
|---|---|---|---|---|
| **A** | **Watermark annotation** — `/Subtype /Watermark` (or `/Stamp`) in the page's `/Annots` | `page.annots()` | Delete the annotation | **Yes** — page content untouched |
| **B** | **Optional Content Group** — a layer, often literally named "Watermark" | `doc.get_ocgs()` | Drop the OCG and its marked content | **Yes** |
| **C** | **Form XObject** — one reusable object drawn on every page | `page.get_xobjects()`, repeated xref across pages | Remove the `/XObject` resource entry + its `Do` invocation | **Yes** |
| **D** | **Image XObject** — a stamped logo, usually with a transparency `/SMask` | `page.get_images()` | `page.delete_image(xref)` | **Yes** |
| **E** | **Flattened into the content stream** — text/vector operators inlined among real content | `get_texttrace()` / `get_drawings()` heuristics (§3) | Redaction over the region, or raster inpainting | **No** — see §4.4 |

A–D cover the large majority of real-world watermarks, because tools that *apply* watermarks (including PrivaTools' own `/watermark`) almost always produce one of them. E is the hard case and must be handled honestly rather than pretended away.

> **PrivaTools' own watermark tool produces case C/D.** A useful property: round-tripping our own output through the remover is a perfect end-to-end test (§8).

---

## 3. Detection

`services/watermark_detect_service.py` — pure analysis, no mutation. Returns candidates; never deletes.

### Signals

A candidate scores on independent signals. **Repetition across pages is the dominant one** — a real watermark appears on every page; body content does not.

```
repetition   same xref / same drawing signature on >= 80% of pages   +0.45
transparency graphics state alpha < 1.0, or image has an /SMask      +0.20
rotation     text or form drawn at a non-zero angle (classic 45°)    +0.15
coverage     bbox spans > 25% of the page area                       +0.10
naming       OCG or annotation title matches /water ?mark|draft|
             confidential|sample|specimen|preview|copy/i             +0.25
centrality   bbox centre within 15% of the page centre               +0.05
```

Report a candidate at **score ≥ 0.5**. Cap at 20 candidates per document.

### Deliberately conservative

Two rules keep false positives from destroying real content:

1. **A page header/footer is not a watermark.** Repetition alone is not enough — a candidate that is opaque, unrotated, and occupies < 5% of the page in a margin band is suppressed. Page numbers and running heads live there.
2. **Never report the page's only content.** If removing a candidate would leave a page with no text and no drawings, drop it — that page *is* the watermark, and the user wants a different tool.

### Output

```json
{
  "candidates": [
    { "id": "c1", "kind": "image_xobject", "confidence": 0.86,
      "pages": [1,2,3,4,5], "page_count": 5,
      "bbox": [120.5, 300.2, 475.5, 541.8],
      "removal": "lossless",
      "label": "Repeated transparent image on all 5 pages" }
  ],
  "page_count": 5,
  "flattened_suspected": false
}
```

`removal` is `"lossless"` (cases A–D) or `"destructive"` (case E). The UI renders those differently — this is the single most important field in the payload.

---

## 4. Removal

`services/watermark_remove_service.py`. Takes the PDF plus the confirmed candidate ids.

### 4.1 Annotations (A)

```python
for page in doc:
    for annot in list(page.annots()):
        if annot.type[1] in ("Watermark", "Stamp") and _selected(annot):
            page.delete_annot(annot)
```

### 4.2 Optional content groups (B)

Resolve the OCG xref from `doc.get_ocgs()`, then drop both the group and the content marked with it. Content outside the marked block is untouched.

### 4.3 XObjects (C, D)

Images use PyMuPDF directly:

```python
page.delete_image(xref)          # replaces the image with a blank placeholder
page.clean_contents()            # then tidy the content stream
```

Form XObjects go through pikepdf, which is the right tool for object-graph surgery: remove the `/XObject` entry from the page's `/Resources`, and strip the corresponding `Do` operator from the content stream. **Only remove the `Do` invocation, never rewrite unrelated operators** — a content stream rewrite that drops a `q`/`Q` pair corrupts every graphics state after it.

### 4.4 Flattened content (E) — the honest case

There is no lossless answer. Offer exactly two, and name their costs:

- **Redact the region** — `add_redact_annot(bbox)` + `apply_redactions()`. Genuinely removes the content (the same mechanism `redact_service` already uses), but also removes any real text that overlapped the watermark. Leaves clean whitespace.
- **Rasterize and inpaint** — render the page, inpaint the mask, re-embed as an image. Visually best, but **the page stops being text**: no selection, no search, no accessibility, larger file. This is a one-way door and the UI must say so before the click, not after.

Default to redaction. Inpainting is opt-in per page.

### 4.5 Image watermarks — `remove_image_watermark`

For rasters, `cv2.inpaint` with a user-supplied mask:

```python
img  = cv2.imread(input_path, cv2.IMREAD_COLOR)
mask = _mask_from_regions(regions, img.shape)          # uint8, 255 = remove
out  = cv2.inpaint(img, mask, inpaintRadius=3, flags=cv2.INPAINT_TELEA)
```

`INPAINT_TELEA` is the default (fast, good on thin marks over texture). `INPAINT_NS` is offered as an alternative for large solid regions. Both are already compiled into the installed wheel.

Guards, reusing existing primitives: cap total mask area at 40% of the image (beyond that inpainting invents rather than reconstructs, and the honest answer is "crop it"), reuse `safe_get_pixmap`'s pixel budget for the PDF-render path, and run everything through `run_bounded`.

---

## 5. Flow and UI

Detection and removal are **two round-trips**, deliberately:

```
POST /api/remove-watermark/detect   → candidates + page thumbnails with bboxes drawn
      user reviews, ticks the ones to remove
POST /api/remove-watermark/apply    → cleaned PDF
```

One-shot auto-removal is not offered. A false positive silently deletes a logo the user wanted, and they would not find out until much later. The preview is the feature.

Each candidate renders with its page range, a thumbnail with the bbox outlined, and a plain-language label — *"Repeated transparent image on all 5 pages"*, not `image_xobject xref=42`. Destructive candidates carry a distinct treatment and an explicit consequence line.

---

## 6. Routes

| Route | Body | Returns |
|---|---|---|
| `POST /api/remove-watermark/detect` | PDF | JSON candidates (§3) |
| `POST /api/remove-watermark/apply` | PDF + `candidate_ids` + `mode` | cleaned PDF |
| `POST /api/remove-image-watermark` | image + `regions` JSON + `method` | cleaned image |

All three carry `@limiter.limit(EXPENSIVE_RATE_LIMIT)` and run under `run_bounded` — detection renders thumbnails and inpainting is CPU-bound, so both are heavy by the classification in `utils/concurrency`.

Detection is stateless: `apply` re-runs detection on the re-uploaded file and matches by candidate id. That costs one extra parse and buys statelessness — no server-side session, consistent with a product that stores nothing.

---

## 7. Frontend

`RemoveWatermarkUI.tsx`, two-phase (detect → confirm → apply), reusing `useToolDefaults("remove-watermark", …)` for the persisted preferences: default method (`redact` vs `inpaint`), and whether to auto-select high-confidence candidates.

Registry slugs: `remove-watermark` (PDF, `tools.ts`) and `remove-image-watermark` (`non-pdf-tools.ts`). Both need `tool_content.py` entries — every tool page carries FAQ/how-to content, and `test_route_coverage.py` enforces that FE slugs resolve to live routes.

---

## 8. Testing

| Area | Test |
|---|---|
| **Round-trip** | Apply a watermark with the existing `/watermark` tool, then remove it — output must have no watermark XObject and the original page text intact. The strongest possible end-to-end test, and it exists for free. |
| Detection: annotation | `/Subtype /Watermark` found, marked lossless |
| Detection: OCG | Layer named "Watermark" found |
| Detection: repeated image | Same xref on every page scores ≥ 0.5 |
| **False positives** | A running header on every page is NOT reported. A page number is NOT reported. A one-page document whose only content is a logo is NOT reported. |
| Removal is lossless | Byte-compare extracted text before/after for cases A–D — must be identical |
| Content-stream safety | After Form XObject removal, `q`/`Q` nesting is still balanced |
| Destructive path | Redaction removes the region; response flags `destructive` |
| Inpainting | Mask over a solid region reconstructs plausibly; >40% mask is rejected |
| Caps | Page-count and pixmap caps enforced via the existing `render.py` helpers |

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| **False positive deletes real content** | Preview-then-confirm; never auto-apply; the two suppression rules in §3; lossless-vs-destructive stated per candidate |
| **Content-stream surgery corrupts the PDF** | Only remove `Do` invocations and resource entries — never rewrite unrelated operators. Balanced-`q`/`Q` test. `pikepdf` validates on save. |
| Users expect flattened watermarks to vanish cleanly | Name the case honestly in the UI. "Rasterize" is labelled a one-way door before the click. |
| Inpainting invents content | 40% mask cap; the result is presented as a reconstruction, not a restoration |
| CPU cost on 2 cores | `EXPENSIVE_RATE_LIMIT` + `run_bounded`; detection thumbnails go through `safe_get_pixmap` |
| Dual-use concern | Legitimate and long-standing (Acrobat Pro ships it). Scope is visible marks on documents the user controls; stated once in the UI, not moralised. |

---

## 10. Deferred

- Automatic mask detection for image watermarks (currently user-drawn). A repeated-logo detector across a batch is the natural v2.
- Batch mode — detect once, apply the same removal across many files.
- Reconstructing text that a destructive removal destroyed. That needs OCR of the surrounding region and is a separate project.
