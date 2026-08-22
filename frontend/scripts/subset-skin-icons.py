"""Subsets the Material Symbols icon fonts to the glyphs the designs reference.

    python scripts/subset-skin-icons.py <icon-codepoints.json>

Run between extract-skin-fonts.mjs and hash-skin-fonts.mjs. Needs fontTools and
brotli.

The full icon fonts are 7.3 MB together. Subsetting by codepoint (rather than by
ligature text) is what makes them small: ligature lookups keep every glyph in the
font reachable, so a text-based subset barely shrinks anything.
"""
import json
import os
import sys

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

FONT_DIR = os.path.join(os.path.dirname(__file__), "..", "public", "fonts", "skins")

# FILL, GRAD and opsz sit at their defaults everywhere in all three designs, so
# they are pinned away. wght stays variable — the designs set it per icon.
PINS = {"FILL": 0.0, "GRAD": 0.0, "opsz": 24.0}


def find(prefix):
    for name in sorted(os.listdir(FONT_DIR)):
        if name.startswith(prefix) and name.endswith(".woff2"):
            return os.path.join(FONT_DIR, name)
    raise SystemExit(f"no font matching {prefix!r} in {FONT_DIR}")


def shrink(path, codepoints, label):
    before = os.path.getsize(path)
    font = TTFont(path)
    if "fvar" in font:
        pins = {k: v for k, v in PINS.items() if k in {a.axisTag for a in font["fvar"].axes}}
        if pins:
            font = instancer.instantiateVariableFont(font, pins, inplace=False, updateFontNames=False)

    options = subset.Options()
    options.layout_features = []          # drops the ligature lookups
    options.hinting = False
    options.desubroutinize = True
    options.drop_tables += ["DSIG"]
    options.name_IDs = [1, 2, 3, 4, 6]
    options.notdef_outline = False

    subsetter = subset.Subsetter(options=options)
    subsetter.populate(unicodes=sorted(set(codepoints)))
    subsetter.subset(font)
    font.flavor = "woff2"
    font.save(path)
    font.close()
    print(f"{label:24s} {before / 1048576:6.2f} MB -> {os.path.getsize(path) / 1024:7.1f} KB"
          f"  ({len(set(codepoints))} icons)")


def main():
    default = os.path.join(os.path.dirname(__file__), "skin-icon-codepoints.json")
    with open(sys.argv[1] if len(sys.argv) > 1 else default) as fh:
        icons = json.load(fh)

    # Aurora and Carbon share one Rounded file: two @font-face rules for the
    # same family with no unicode-range would compete and one would lose.
    rounded = set(icons["aurora"].values()) | set(icons["carbon"].values())
    shrink(find("material-symbols-rounded"), rounded, "rounded (aurora+carbon)")
    shrink(find("material-symbols-outlined"), set(icons["structured"].values()), "outlined (structured)")


if __name__ == "__main__":
    main()
