import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const assetsDir = new URL("../dist/assets/", import.meta.url);
const maxRawKiB = Number(process.env.MAX_JS_CHUNK_RAW_KIB ?? 1200);
const maxGzipKiB = Number(process.env.MAX_JS_CHUNK_GZIP_KIB ?? 350);

function toKiB(bytes) {
  return bytes / 1024;
}

let entries;
try {
  entries = readdirSync(assetsDir).filter((name) => name.endsWith(".js"));
} catch {
  console.error("Bundle assets not found. Run `npm run build` before `npm run check:bundle`.");
  process.exit(1);
}

const chunks = entries
  .map((name) => {
    const file = join(assetsDir.pathname, name);
    const rawBytes = statSync(file).size;
    const gzipBytes = gzipSync(readFileSync(file)).length;
    return { name, rawKiB: toKiB(rawBytes), gzipKiB: toKiB(gzipBytes) };
  })
  .sort((a, b) => b.gzipKiB - a.gzipKiB);

const offenders = chunks.filter((chunk) => chunk.rawKiB > maxRawKiB || chunk.gzipKiB > maxGzipKiB);

console.log(`JS bundle budget: raw <= ${maxRawKiB} KiB, gzip <= ${maxGzipKiB} KiB per chunk`);
for (const chunk of chunks.slice(0, 20)) {
  console.log(`${chunk.gzipKiB.toFixed(1).padStart(7)} KiB gzip  ${chunk.rawKiB.toFixed(1).padStart(7)} KiB raw  ${chunk.name}`);
}

if (offenders.length > 0) {
  console.error("\nOversized JS chunks:");
  for (const chunk of offenders) {
    console.error(`- ${chunk.name}: ${chunk.gzipKiB.toFixed(1)} KiB gzip, ${chunk.rawKiB.toFixed(1)} KiB raw`);
  }
  process.exit(1);
}
