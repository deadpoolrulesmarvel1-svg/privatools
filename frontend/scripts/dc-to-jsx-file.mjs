/** Converts a markup file with dc-to-jsx's transform. Used by build-skin-app.mjs. */
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const HERE = dirname(fileURLToPath(import.meta.url));
const { convert } = await import(pathToFileURL(resolve(HERE, "dc-convert.mjs")).href);
const iconRe = process.argv[3] ? new RegExp(process.argv[3], "i") : undefined;
process.stdout.write(convert(readFileSync(process.argv[2], "utf8"), iconRe));
