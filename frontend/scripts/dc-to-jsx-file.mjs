/** Converts a markup file with dc-to-jsx's transform. Used by build-skin-app.mjs. */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const { convert, interactionCss } = await import(pathToFileURL(resolve(HERE, "dc-convert.mjs")).href);
const iconRe = process.argv[3] ? new RegExp(process.argv[3], "i") : undefined;
const skin = process.argv[4] || "";
// The interaction rules are a by-product of the conversion, so they ride back
// on stdout after a sentinel rather than through a second file.
process.stdout.write(convert(readFileSync(process.argv[2], "utf8"), iconRe));
if (skin) process.stdout.write("\n/*__DC_INTERACTION_CSS__*/\n" + interactionCss(skin));
