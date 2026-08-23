/**
 * Content-hashes the extracted skin fonts and rewrites skin-fonts.css.
 *
 *   node scripts/hash-skin-fonts.mjs
 *
 * These live in public/, which Vite copies verbatim without hashing. The
 * filenames carry a UUID from the source asset store, so re-subsetting a font
 * leaves the name unchanged and browsers keep serving the old glyphs — which
 * looks exactly like missing icons and wastes an afternoon.
 */
import { readFileSync, writeFileSync, renameSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = resolve(HERE, "../public/fonts/skins");
const CSS = resolve(HERE, "../src/styles/skin-fonts.css");

let css = readFileSync(CSS, "utf8");
let renamed = 0;

for (const file of readdirSync(DIR)) {
  if (!file.endsWith(".woff2")) continue;
  const buf = readFileSync(resolve(DIR, file));
  const hash = createHash("sha256").update(buf).digest("hex").slice(0, 10);
  // strip any hash this script added on a previous run
  const base = file.replace(/\.[0-9a-f]{10}\.woff2$/, ".woff2");
  const next = base.replace(/\.woff2$/, `.${hash}.woff2`);
  if (next === file) continue;
  renameSync(resolve(DIR, file), resolve(DIR, next));
  css = css.split(file).join(next).split(base).join(next);
  renamed++;
}

writeFileSync(CSS, css, "utf8");
console.log(`${renamed} font file(s) hashed; skin-fonts.css rewritten`);
