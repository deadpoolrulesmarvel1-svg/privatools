# Imported design sources

The three Claude Design projects the skins in `frontend/src/skins/` are ported
from. Vendored so the port pipeline is reproducible without the projects.

| File | Project | Claude Design |
| --- | --- | --- |
| `aurora.dc.html` | Obsidian Aurora | `85b1aeac-7153-4f86-b31c-09eaaaab5d06` |
| `carbon.dc.html` | Carbon Glass | `1a6c637b-1829-4b4b-bdfa-22046514f7e6` |
| `structured.dc.html` | Structured Privacy OS | `cc03b160-9ec9-414f-8790-6300ae8934ed` |

`*.dc.html` are the component sources — markup, inline styles and the component
class — and are what the skins are generated from.

The standalone exports (`*.standalone.html`) additionally embed the font
binaries, which `frontend/scripts/extract-skin-fonts.mjs` reads so that no font
is ever downloaded. They are **not committed**: 13 MB between them, and the
subset faces they produce already live in `frontend/public/fonts/skins/`.
Re-download them from the Claude Design projects above if you need a different
set of glyphs, or want to serve them for a side-by-side comparison:

    python3 -m http.server 8095 --directory design-sources

## Regenerating a skin

    cd frontend
    node scripts/extract-skin-fonts.mjs      # faces out of the standalone exports
    python scripts/subset-skin-icons.py      # 7.3 MB of icon fonts -> 118 KB
    node scripts/hash-skin-fonts.mjs         # content-hash so re-subsetting busts caches
    node scripts/extract-native-css.mjs      # each design's own CSS, rescoped per skin
    node scripts/build-skin-app.mjs          # markup + logic -> src/skins/<id>/SkinApp.tsx

Do not hand-edit `frontend/src/skins/*/SkinApp.tsx`. Change the source here or
the scripts, and regenerate.
