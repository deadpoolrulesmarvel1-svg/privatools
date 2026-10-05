import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { readContentArray } from "./content-data.mjs";

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

// Data tables allowed past the per-chunk budget, each held to a ceiling of
// its own: gpt-tokenizer's rank tables, which the AI Token Counter loads only
// when a visitor counts. Each encoding has a worker that builds its one table
// into its own script (src/lib/tokens/tokens-*.worker.ts), started only on
// Count; the page's own copies (src/lib/tokens/encoders.ts) load only where no
// worker can start. They are lists of strings, not code a page runs as it
// loads, and no page may load them eagerly (checked below with the entry and
// preloads). A table that grows past its ceiling, or turns eager, still
// fails; nothing else is exempt. No ceiling here passes 2048 KiB: the backend
// compresses responses with Brotli only up to 2 MiB (middleware/brotli.py),
// and a larger script goes out with gzip made on the fly, about 1.4 seconds
// of server time for each download of 3 MB.
const DATA_CHUNKS = [
  { pattern: /^o200k_base-[\w-]+\.js$/, rawKiB: 2048, gzipKiB: 1060, what: "gpt-tokenizer's o200k_base rank table" },
  { pattern: /^cl100k_base-[\w-]+\.js$/, rawKiB: 1000, gzipKiB: 460, what: "gpt-tokenizer's cl100k_base rank table" },
  { pattern: /^tokens-o200k\.worker-[\w-]+\.js$/, rawKiB: 2048, gzipKiB: 1060, what: "the AI Token Counter's o200k_base worker, with its table" },
  { pattern: /^tokens-cl100k\.worker-[\w-]+\.js$/, rawKiB: 1050, gzipKiB: 480, what: "the AI Token Counter's cl100k_base worker, with its table and the Word reader" },
];
const dataChunk = (name) => DATA_CHUNKS.find((data) => data.pattern.test(name));

// WebAssembly served as an asset of its own, each held to a ceiling: RNNoise's
// module, which Voice Noise Remover fetches only when a visitor cleans a
// recording (src/lib/noise/engine.ts, through virtual:rnnoise-wasm and
// scripts/rnnoise-wasm.mjs). It is the model's weights more than code, 3.4 MiB
// raw and 2.7 MiB gzipped. Its ceiling passes the 2048 KiB above, which is
// about Brotli: the backend never compresses application/wasm with Brotli, at
// any size. The module goes out gzipped on the fly, which took 0.14 s of
// server time per download when measured in review. Like the data tables it
// must stay lazy (checked below), and the build must hold exactly one.
// (onnxruntime-web's own .wasm files, which Vite copies in, are not budgeted
// here.)
const WASM_ASSETS = [
  { pattern: /^rnnoise-[\w-]+\.wasm$/, rawKiB: 3600, gzipKiB: 2850, what: "RNNoise's WebAssembly, for Voice Noise Remover" },
];
const wasmAssets = readdirSync(assetsDir).flatMap((name) => {
  const budget = WASM_ASSETS.find((asset) => asset.pattern.test(name));
  if (!budget) return [];
  const file = join(assetsDir.pathname, name);
  return [{ name, rawKiB: toKiB(statSync(file).size), gzipKiB: toKiB(gzipSync(readFileSync(file)).length), budget }];
});
const wasmOffenders = [
  ...wasmAssets.filter((asset) => asset.rawKiB > asset.budget.rawKiB || asset.gzipKiB > asset.budget.gzipKiB),
  ...WASM_ASSETS.filter((budget) => wasmAssets.filter((asset) => asset.budget === budget).length !== 1)
    .map((budget) => ({ name: `${budget.what}: expected one file matching ${budget.pattern}`, rawKiB: 0, gzipKiB: 0, budget })),
];

const offenders = chunks.filter((chunk) => {
  const data = dataChunk(chunk.name);
  return data
    ? chunk.rawKiB > data.rawKiB || chunk.gzipKiB > data.gzipKiB
    : chunk.rawKiB > maxRawKiB || chunk.gzipKiB > maxGzipKiB;
});

console.log(`JS bundle budget: raw <= ${maxRawKiB} KiB, gzip <= ${maxGzipKiB} KiB per chunk`);
for (const data of DATA_CHUNKS) {
  console.log(`  except lazy data: ${data.what}, raw <= ${data.rawKiB} KiB, gzip <= ${data.gzipKiB} KiB`);
}
for (const chunk of chunks.slice(0, 20)) {
  console.log(`${chunk.gzipKiB.toFixed(1).padStart(7)} KiB gzip  ${chunk.rawKiB.toFixed(1).padStart(7)} KiB raw  ${chunk.name}`);
}
for (const asset of WASM_ASSETS) {
  console.log(`Lazy WebAssembly: ${asset.what}, raw <= ${asset.rawKiB} KiB, gzip <= ${asset.gzipKiB} KiB`);
}
for (const asset of wasmAssets) {
  console.log(`${asset.gzipKiB.toFixed(1).padStart(7)} KiB gzip  ${asset.rawKiB.toFixed(1).padStart(7)} KiB raw  ${asset.name}`);
}

// The Vite entry chunk (assets/index-<hash>.js — the module the shell
// <script type="module"> tag loads eagerly on every single page) must never
// contain the per-tool guide glob map. `frontend/src/lib/tool-guide.ts`
// builds an `import.meta.glob` over all 221 `data/tool-guide/*.json` files
// (~24 KiB minified) so any one tool's guide can be lazy-loaded; it belongs
// behind the dynamic `import("@/lib/tool-guide")` its consumers (ToolGuide.tsx,
// ToolFaq.tsx) use, not statically imported where every visitor pays for it
// regardless of which page (or no tool page at all) they're on.
const entryChunk = chunks.find((chunk) => /^index-.*\.js$/.test(chunk.name));
let entryChunkLeaksToolGuide = false;
if (entryChunk) {
  const source = readFileSync(join(assetsDir.pathname, entryChunk.name), "utf8");
  entryChunkLeaksToolGuide = source.includes("tool-guide/");
} else {
  console.error("\nWarning: could not find the Vite entry chunk (assets/index-*.js) to check for the tool-guide glob leak.");
}

if (offenders.length > 0) {
  console.error("\nOversized JS chunks:");
  for (const chunk of offenders) {
    console.error(`- ${chunk.name}: ${chunk.gzipKiB.toFixed(1)} KiB gzip, ${chunk.rawKiB.toFixed(1)} KiB raw`);
  }
}

if (wasmOffenders.length > 0) {
  console.error("\nWebAssembly over its ceiling, or missing:");
  for (const asset of wasmOffenders) {
    console.error(`- ${asset.name}: ${asset.gzipKiB.toFixed(1)} KiB gzip, ${asset.rawKiB.toFixed(1)} KiB raw`);
  }
}

if (entryChunkLeaksToolGuide) {
  console.error(
    `\n${entryChunk.name} (the entry chunk) contains "tool-guide/" — the per-tool guide glob map from ` +
    "frontend/src/lib/tool-guide.ts leaked into it. Its consumers (ToolGuide.tsx, ToolFaq.tsx) must import " +
    'it dynamically inside their effect (e.g. `import("@/lib/tool-guide").then(({ loadToolGuide }) => ...)`) ' +
    "instead of as a static top-level import, or every visitor downloads the full 221-tool glob map."
  );
}

// src/data/blog.ts is every article's HTML (~115 KiB). Only blog routes may
// load it, through a dynamic import(). Every page fetches the entry script,
// each chunk index.html module-preloads, and whatever those import statically
// (resolveDependencies in vite.config.ts drops some preload tags, not the
// imports), so none of them may contain it. Chunk names can change and the
// data could be inlined anywhere, so match content: the longest plain run of
// words in each post's body, which minification cannot rewrite.
// HTML tag and attribute names are case-insensitive, so the patterns are too.
const htmlTags = [...readFileSync(new URL("../index.html", assetsDir), "utf8").matchAll(/<(?:script|link)\b[^>]*>/gi)].map(([tag]) => tag);
const assetOf = (tag) => tag.match(/\b(?:src|href)="\/assets\/([^"]+\.js)"/i)?.[1];
const entryScripts = htmlTags.filter((tag) => /\btype="module"/i.test(tag)).map(assetOf).filter(Boolean);
const preloaded = htmlTags.filter((tag) => /\brel="modulepreload"/i.test(tag)).map(assetOf).filter(Boolean);
if (entryScripts.length === 0) {
  console.error("\nNo module script in dist/index.html; the blog-data check cannot run meaningfully.");
  process.exit(1);
}
// Static imports only, the pattern public/sw.js precaches with; import() never matches.
const staticImports = (name) => [...readFileSync(join(assetsDir.pathname, name), "utf8")
  .matchAll(/(?:\b(?:import|export)\s*[^;"'()]*?\bfrom\s*|\bimport\s*)["']\.\/([^"']+\.js)["']/g)].map((match) => match[1]);
const eagerChunks = new Set();
const importers = new Map();
const eagerQueue = [...entryScripts, ...preloaded];
while (eagerQueue.length) {
  const name = eagerQueue.shift();
  if (eagerChunks.has(name)) continue;
  eagerChunks.add(name);
  for (const dependency of staticImports(name)) {
    importers.set(dependency, [...(importers.get(dependency) ?? []), name]);
    eagerQueue.push(dependency);
  }
}
const blogMarkers = readContentArray(new URL("../src/data/blog.ts", import.meta.url), "blogPosts")
  .map((post) => (post.body.match(/[A-Za-z0-9 ]{40,}/g) ?? []).map((run) => run.trim()).sort((a, b) => b.length - a.length)[0])
  .filter(Boolean);
if (blogMarkers.length < 10) {
  console.error(`\nOnly ${blogMarkers.length} blog posts yielded a text marker; the blog-data check cannot run meaningfully.`);
  process.exit(1);
}
const eagerBlogChunks = [...eagerChunks].filter((name) => {
  const source = readFileSync(join(assetsDir.pathname, name), "utf8");
  return blogMarkers.some((marker) => source.includes(marker));
});
if (eagerBlogChunks.length > 0) {
  console.error("\nBlog data (src/data/blog.ts) is in the chunks every page loads:");
  for (const name of eagerBlogChunks) {
    const how = [
      entryScripts.includes(name) && "the entry script",
      preloaded.includes(name) && "module-preloaded by index.html",
      importers.has(name) && `statically imported by ${importers.get(name).join(", ")}`,
    ].filter(Boolean);
    console.error(`- ${name}: ${how.join("; ")}`);
  }
  console.error(
    "Import it only on blog routes, through a dynamic import() — src/test/blog-module-boundary.test.ts " +
    "prints the source-level import chain."
  );
} else {
  console.log(`\nBlog data: absent from all ${eagerChunks.size} chunks loaded on every page (entry, preloads and their static imports).`);
}

// The data tables' own ceilings hold only while they stay lazy.
const eagerDataChunks = [...eagerChunks].filter((name) => dataChunk(name));
if (eagerDataChunks.length > 0) {
  console.error("\nLazy data tables are in the chunks every page loads:");
  for (const name of eagerDataChunks) console.error(`- ${name} (${dataChunk(name).what})`);
  console.error("Import gpt-tokenizer's encodings only through the dynamic import() in src/lib/tokens/encoders.ts, and start the workers only from src/lib/tokens/engine.ts.");
}

// A worker is started by its URL, not imported, so the walk above can't see one
// started on every page. Its file name in any chunk every page loads means it is.
const workerFiles = chunks.map((chunk) => chunk.name).filter((name) => dataChunk(name) && /\.worker-/.test(name));
const eagerWorkerStarts = [...eagerChunks].flatMap((name) => {
  const source = readFileSync(join(assetsDir.pathname, name), "utf8");
  return workerFiles.filter((worker) => source.includes(worker)).map((worker) => `${name} names ${worker}`);
});
if (eagerWorkerStarts.length > 0) {
  console.error("\nA lazy worker is started from the chunks every page loads:");
  for (const line of eagerWorkerStarts) console.error(`- ${line}`);
  console.error("Start the token workers only from src/lib/tokens/engine.ts, which only the AI Token Counter imports, and only through a dynamic import().");
}

// RNNoise's module and the noise remover's worker are fetched by name, so the
// same test: neither file's name may appear in a chunk every page loads.
const lazyFiles = [...wasmAssets.map((asset) => asset.name), ...chunks.map((chunk) => chunk.name).filter((name) => /^noise\.worker-[\w-]+\.js$/.test(name))];
const eagerLazyFiles = [...eagerChunks].flatMap((name) => {
  const source = readFileSync(join(assetsDir.pathname, name), "utf8");
  return lazyFiles.filter((file) => source.includes(file)).map((file) => `${name} names ${file}`);
});
if (eagerLazyFiles.length > 0) {
  console.error("\nVoice Noise Remover's WebAssembly or worker is named by the chunks every page loads:");
  for (const line of eagerLazyFiles) console.error(`- ${line}`);
  console.error("Import src/lib/noise/engine.ts only through the dynamic import() in NoiseRemoverUI, which runs when a recording is cleaned.");
}

// OPUS-MT's worker carries transformers.js and is started by its URL when a
// visitor runs a translation on Translate PDF or Subtitle Translator
// (src/lib/translate/opusMt.ts). Its name in a chunk every page loads would
// mean a page could start it before anyone asked, and the build must hold
// exactly one.
const translateWorkers = chunks.map((chunk) => chunk.name).filter((name) => /^opusMt\.worker-[\w-]+\.js$/.test(name));
const translateWorkerProblems = [
  ...(translateWorkers.length === 1 ? [] : [`expected one opusMt.worker-*.js, found ${translateWorkers.length}`]),
  ...[...eagerChunks].flatMap((name) => {
    const source = readFileSync(join(assetsDir.pathname, name), "utf8");
    return translateWorkers.filter((worker) => source.includes(worker)).map((worker) => `${name} names ${worker}`);
  }),
];
if (translateWorkerProblems.length > 0) {
  console.error("\nThe OPUS-MT translation worker is missing, or named by the chunks every page loads:");
  for (const line of translateWorkerProblems) console.error(`- ${line}`);
  console.error("Import src/lib/translate/opusMt.ts only from the translation tools' own UIs, which the tool pages load lazily, and start the worker only from loadDeviceTranslator.");
}

if (offenders.length > 0 || wasmOffenders.length > 0 || entryChunkLeaksToolGuide || eagerBlogChunks.length > 0 || eagerDataChunks.length > 0 || eagerWorkerStarts.length > 0 || eagerLazyFiles.length > 0 || translateWorkerProblems.length > 0) {
  process.exit(1);
}
