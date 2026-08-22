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


# ── structure tree ──────────────────────────────────────────────────────────
#
# The catalog properties above are the cheap half. Carrying the *structure
# tree* is what actually keeps a document tagged, and it is only tractable
# because of one pikepdf behaviour worth stating explicitly:
#
#   `dst.pages.append(src.pages[i])` copies the page through the same
#   object map that `dst.copy_foreign()` uses. So copying the StructTreeRoot
#   *after* the pages have been appended makes every struct element's `/Pg`
#   resolve to the page object already in `dst`, not a duplicate.
#
# Verified empirically before this was written: with pages 0 and 2 extracted
# from a 4-page tagged source, 2 of the 4 struct elements pointed at real pages
# in the output and 2 dangled. So the work is not re-pointing references — it
# is pruning the elements whose page didn't come along, and keeping the
# ParentTree consistent with what survived.

_MAX_PRUNE_DEPTH = 64


def _page_objgens(pdf: pikepdf.Pdf) -> set:
    out = set()
    for page in pdf.pages:
        try:
            out.add(page.obj.objgen)
        except Exception:
            continue
    return out


def _prune_struct_node(node, keep_objgens: set, depth: int = 0):
    """Drop struct elements whose page is not in the output.

    Returns the node to keep, or None to drop it. A container with no `/Pg`
    survives as long as at least one descendant does — otherwise a <Sect>
    wrapping only dropped pages would linger as an empty shell.
    """
    if depth > _MAX_PRUNE_DEPTH:
        return None

    if isinstance(node, pikepdf.Array):
        kept = []
        for kid in node:
            result = _prune_struct_node(kid, keep_objgens, depth + 1)
            if result is not None:
                kept.append(result)
        return pikepdf.Array(kept) if kept else None

    if not isinstance(node, pikepdf.Dictionary):
        # An integer MCID or another leaf — it belongs to whichever element
        # owns it, and that element's /Pg has already been checked.
        return node

    page = node.get("/Pg")
    if page is not None:
        try:
            if page.objgen not in keep_objgens:
                return None
        except Exception:
            return None

    kids = node.get("/K")
    if kids is not None:
        pruned = _prune_struct_node(kids, keep_objgens, depth + 1)
        if pruned is None:
            # Nothing survived underneath. Keep the element only if it is
            # anchored to a page that did survive.
            if page is None:
                return None
            del node["/K"]
        else:
            node["/K"] = pruned

    return node


def _prune_parent_tree(root, dst: pikepdf.Pdf, live_keys: set) -> None:
    """Drop ParentTree entries for pages that aren't in the output.

    `/StructParents` values ride along on the page objects untouched, so the
    surviving keys stay valid and nothing needs renumbering — the dead entries
    just have to go.
    """
    try:
        parent_tree = root.get("/ParentTree")
        if not isinstance(parent_tree, pikepdf.Dictionary):
            return
        nums = parent_tree.get("/Nums")
        if not isinstance(nums, pikepdf.Array):
            return
        kept = []
        for i in range(0, len(nums) - 1, 2):
            try:
                key = int(nums[i])
            except (TypeError, ValueError):
                continue
            if key in live_keys:
                kept.extend([key, nums[i + 1]])
        parent_tree["/Nums"] = pikepdf.Array(kept)
    except Exception:
        logger.debug("preserve: could not prune ParentTree", exc_info=True)


def _live_struct_parent_keys(dst: pikepdf.Pdf) -> set:
    keys = set()
    for page in dst.pages:
        try:
            value = page.obj.get("/StructParents")
            if value is not None:
                keys.add(int(value))
        except (TypeError, ValueError):
            continue
    return keys


def preserve_structure_tree(src: pikepdf.Pdf, dst: pikepdf.Pdf) -> bool:
    """Carry `src`'s structure tree onto `dst`, pruned to `dst`'s pages.

    Call this AFTER the pages have been appended — the object map that makes
    `/Pg` resolve correctly is populated by those appends.

    Returns True when `dst` ends up genuinely tagged. Only then is it safe for
    the caller to set `/MarkInfo << /Marked true >>`; setting it otherwise
    claims the document is tagged when it is not.
    """
    try:
        src_root = src.Root.get("/StructTreeRoot")
    except Exception:
        return False
    if not isinstance(src_root, pikepdf.Dictionary):
        return False

    try:
        copied = dst.copy_foreign(src_root)
    except Exception:
        logger.debug("preserve: structure tree could not be copied", exc_info=True)
        return False

    try:
        keep = _page_objgens(dst)
        kids = copied.get("/K")
        if kids is None:
            return False
        pruned = _prune_struct_node(kids, keep)
        if pruned is None:
            return False  # nothing survived — leave the output honestly untagged
        copied["/K"] = pruned

        _prune_parent_tree(copied, dst, _live_struct_parent_keys(dst))

        dst.Root["/StructTreeRoot"] = copied
        dst.Root["/MarkInfo"] = pikepdf.Dictionary(Marked=True)
        return True
    except Exception:
        logger.debug("preserve: structure tree transplant failed", exc_info=True)
        # Never leave a half-built tree behind — an output that claims to be
        # tagged but isn't is worse than one that admits it isn't.
        try:
            if "/StructTreeRoot" in dst.Root:
                del dst.Root["/StructTreeRoot"]
            if "/MarkInfo" in dst.Root:
                del dst.Root["/MarkInfo"]
        except Exception:
            pass
        return False


class StructureTreeMerger:
    """Accumulate structure trees from several sources into one merged tree.

    Merging is harder than extracting because `/StructParents` keys are only
    unique *within* a document. Two tagged inputs both numbering their pages
    from 0 collide, and the merged ParentTree silently points half the pages at
    the wrong struct elements. So each source's keys are shifted into their own
    range as it is added, and the pages it contributed are renumbered to match.

    Usage, inside the append loop and while each source is still open:

        merger = StructureTreeMerger(dst)
        for path in inputs:
            with open_pdf(path) as src:
                first = len(dst.pages)
                dst.pages.extend(src.pages)
                merger.add_source(src, first, len(dst.pages) - 1)
        merger.finalize()
    """

    def __init__(self, dst: pikepdf.Pdf):
        self.dst = dst
        self._kids: list = []
        self._nums: list = []
        self._role_map: dict[str, object] = {}
        self._next_key = 0
        self._sources = 0
        self._tagged_sources = 0

    def add_source(self, src: pikepdf.Pdf, first_page: int, last_page: int) -> None:
        self._sources += 1
        try:
            src_root = src.Root.get("/StructTreeRoot")
        except Exception:
            return
        if not isinstance(src_root, pikepdf.Dictionary):
            return

        try:
            copied = self.dst.copy_foreign(src_root)
        except Exception:
            logger.debug("merge-struct: copy failed", exc_info=True)
            return

        try:
            pages = list(self.dst.pages)[first_page:last_page + 1]
            keep = set()
            for page in pages:
                try:
                    keep.add(page.obj.objgen)
                except Exception:
                    continue

            kids = copied.get("/K")
            pruned = _prune_struct_node(kids, keep) if kids is not None else None
            if pruned is None:
                return

            offset = self._next_key
            highest = self._shift_parent_tree(copied, offset)
            self._shift_page_struct_parents(pages, offset)
            self._next_key = offset + highest + 1

            self._kids.extend(pruned if isinstance(pruned, pikepdf.Array) else [pruned])
            self._collect_role_map(copied)
            self._tagged_sources += 1
        except Exception:
            logger.debug("merge-struct: source skipped", exc_info=True)

    def _shift_parent_tree(self, root, offset: int) -> int:
        """Shift this source's ParentTree keys by `offset`; return its highest key."""
        highest = -1
        try:
            parent_tree = root.get("/ParentTree")
            if not isinstance(parent_tree, pikepdf.Dictionary):
                return 0
            nums = parent_tree.get("/Nums")
            if not isinstance(nums, pikepdf.Array):
                return 0
            for i in range(0, len(nums) - 1, 2):
                try:
                    key = int(nums[i])
                except (TypeError, ValueError):
                    continue
                highest = max(highest, key)
                self._nums.extend([key + offset, nums[i + 1]])
        except Exception:
            logger.debug("merge-struct: ParentTree shift failed", exc_info=True)
        return max(highest, 0)

    @staticmethod
    def _shift_page_struct_parents(pages, offset: int) -> None:
        if offset == 0:
            return
        for page in pages:
            try:
                value = page.obj.get("/StructParents")
                if value is not None:
                    page.obj["/StructParents"] = int(value) + offset
            except (TypeError, ValueError):
                continue

    def _collect_role_map(self, root) -> None:
        """Union the sources' RoleMaps; first definition of a name wins."""
        try:
            role_map = root.get("/RoleMap")
            if not isinstance(role_map, pikepdf.Dictionary):
                return
            for key, value in role_map.items():
                name = str(key)
                if name not in self._role_map:
                    self._role_map[name] = value
        except Exception:
            logger.debug("merge-struct: RoleMap merge failed", exc_info=True)

    def finalize(self) -> bool:
        """Install the merged tree. Returns True if the output is genuinely tagged.

        Deliberately all-or-nothing: the tree is installed only when *every*
        source contributed structure. Merging one tagged and one untagged file
        and then declaring `/Marked true` would tell downstream tools the whole
        document is tagged while half of it has no structure at all — the same
        lie `preserve_document_properties` refuses to tell about `/MarkInfo`.
        """
        if not self._kids or self._tagged_sources != self._sources:
            if self._kids:
                logger.debug(
                    "merge-struct: %d of %d sources tagged — leaving output untagged",
                    self._tagged_sources, self._sources,
                )
            return False

        try:
            root = self.dst.make_indirect(pikepdf.Dictionary(
                Type=pikepdf.Name("/StructTreeRoot"),
                K=pikepdf.Array(self._kids),
            ))
            if self._nums:
                root["/ParentTree"] = self.dst.make_indirect(
                    pikepdf.Dictionary(Nums=pikepdf.Array(self._nums))
                )
                root["/ParentTreeNextKey"] = self._next_key
            if self._role_map:
                root["/RoleMap"] = pikepdf.Dictionary(self._role_map)

            # Re-point each top-level kid at the new root so /P is not dangling.
            for kid in root["/K"]:
                try:
                    if isinstance(kid, pikepdf.Dictionary) and "/P" in kid:
                        kid["/P"] = root
                except Exception:
                    continue

            self.dst.Root["/StructTreeRoot"] = root
            self.dst.Root["/MarkInfo"] = pikepdf.Dictionary(Marked=True)
            return True
        except Exception:
            logger.debug("merge-struct: finalize failed", exc_info=True)
            try:
                if "/StructTreeRoot" in self.dst.Root:
                    del self.dst.Root["/StructTreeRoot"]
                if "/MarkInfo" in self.dst.Root:
                    del self.dst.Root["/MarkInfo"]
            except Exception:
                pass
            return False
