"""Carry document-level accessibility properties across tools that rebuild a PDF.

Tools built on `pikepdf.Pdf.new()` (merge, extract-pages) start from an empty
catalog and copy pages in. Page objects carry their own `/Tabs`, but everything
that lives on the *catalog* is silently dropped: `/Lang`, the document title,
`/ViewerPreferences`, and the structure tree.

That is real data loss, not a cosmetic gap. Someone who paid to have a document
remediated for WCAG or Section 508 compliance loses that work by merging it,
and nothing in the output says so. Measured before this helper existed: an
accessible input scoring 96/100 came out of /merge at 39 and /extract-pages
at 39.

What this deliberately does NOT do
----------------------------------
It does not copy `/MarkInfo` or `/StructTreeRoot`. Merging structure trees
correctly means merging the `/K` kid arrays, rewriting every `/ParentTree`
number tree entry, and re-pointing struct elements at their new page objects —
a real piece of work, not a copy. Asserting `/MarkInfo << /Marked true >>` on a
document with no structure tree would be *worse than doing nothing*: it claims
the document is tagged to any tool that asks, when it is not. Better to lose
the tags visibly than to lie about having them.

So the output is honestly "untagged, but keeps its language, title and viewer
preferences" — which recovers most of the score and all of the properties that
can be carried without inventing structure.
"""

from __future__ import annotations

import logging

import pikepdf

logger = logging.getLogger(__name__)

# Catalog keys that describe the document rather than its pages, are safe to
# carry verbatim, and cost nothing to preserve.
_CATALOG_KEYS = ("/Lang", "/ViewerPreferences", "/PageLayout", "/PageMode")


_MAX_TRANSPLANT_DEPTH = 16


def _transplant(value, dst: pikepdf.Pdf, depth: int = 0):
    """Rebuild a pikepdf object so it belongs to `dst`.

    pikepdf refuses cross-document object assignment in *both* directions and
    the two escape hatches don't overlap: assigning a foreign object directly
    raises ForeignObjectError telling you to use `copy_foreign`, and calling
    `copy_foreign` on a *direct* object raises ForeignObjectError telling you
    it only takes indirect ones. `/Lang` is a direct string and
    `/ViewerPreferences` is usually a direct dictionary, so both hit the gap.

    So: indirect objects go through `copy_foreign`, and direct ones are rebuilt
    from their primitives in `dst`'s context.
    """
    if depth > _MAX_TRANSPLANT_DEPTH:
        raise ValueError("catalog value nested too deeply to transplant")

    if getattr(value, "is_indirect", False):
        return dst.copy_foreign(value)
    if isinstance(value, pikepdf.Dictionary):
        return pikepdf.Dictionary(
            {str(k): _transplant(v, dst, depth + 1) for k, v in value.items()}
        )
    if isinstance(value, pikepdf.Array):
        return pikepdf.Array([_transplant(v, dst, depth + 1) for v in value])
    if isinstance(value, pikepdf.String):
        return pikepdf.String(str(value))
    if isinstance(value, pikepdf.Name):
        return pikepdf.Name(str(value))
    # Numbers, booleans and null cross the boundary as plain Python values.
    return value


def preserve_document_properties(src: pikepdf.Pdf, dst: pikepdf.Pdf) -> None:
    """Copy document-level properties from `src`'s catalog onto `dst`'s.

    Best-effort by design: a malformed source shouldn't fail the user's actual
    operation, so every step is individually guarded. Existing values on `dst`
    are not overwritten.
    """
    try:
        src_root = src.Root
    except Exception:  # pragma: no cover - unreadable catalog
        return

    for key in _CATALOG_KEYS:
        try:
            value = src_root.get(key)
            if value is None or key in dst.Root:
                continue
            dst.Root[key] = _transplant(value, dst)
        except Exception:
            logger.debug("preserve: could not carry %s", key, exc_info=True)

    _preserve_title(src, dst)


def _preserve_title(src: pikepdf.Pdf, dst: pikepdf.Pdf) -> None:
    """Carry the document title through both DocInfo and XMP.

    Assistive technology announces the title instead of the filename, and
    `/ViewerPreferences /DisplayDocTitle` (copied above) is meaningless without
    it — so the two have to travel together.
    """
    title = ""
    try:
        info = src.trailer.get("/Info")
        if isinstance(info, pikepdf.Dictionary):
            raw = info.get("/Title")
            if raw is not None:
                title = str(raw).strip()
    except Exception:
        pass

    if not title:
        try:
            with src.open_metadata() as xmp:
                title = str(xmp.get("dc:title") or "").strip()
        except Exception:
            pass

    if not title:
        return

    try:
        with dst.open_metadata(set_pikepdf_as_editor=False) as xmp:
            if not xmp.get("dc:title"):
                xmp["dc:title"] = title
    except Exception:
        logger.debug("preserve: could not carry title to XMP", exc_info=True)

    # Also write DocInfo: readers are split on which one they consult, and a
    # title present in only one of them reads as missing to the other.
    try:
        info = dst.trailer.get("/Info")
        if not isinstance(info, pikepdf.Dictionary):
            info = dst.make_indirect(pikepdf.Dictionary())
            dst.trailer["/Info"] = info
        if not str(info.get("/Title") or "").strip():
            info["/Title"] = pikepdf.String(title)
    except Exception:
        logger.debug("preserve: could not carry title to DocInfo", exc_info=True)
