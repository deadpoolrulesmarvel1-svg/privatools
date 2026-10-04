/**
 * RNNoise's WebAssembly, taken out of @shiguredo/rnnoise-wasm at build time.
 *
 * The package (Apache-2.0; RNNoise itself is BSD-3-Clause, see
 * public/third-party/rnnoise.txt) is one 4.8 MB JavaScript file: Emscripten's
 * runtime, built with its debug assertions on, with the 3.6 MB WebAssembly
 * module inside it as a base64 string. Voice Noise Remover serves the module
 * as a file of its own and instantiates it itself (src/lib/noise/rnnoise.ts):
 * 2.7 MB to download compressed instead of 3.1 MB, no 4.8 MB script to parse,
 * and none of the runtime's code. Only the module is ever fetched, and only
 * when a visitor runs the tool.
 *
 * rnnoiseWasm() decodes the string and checks it is the module that loader
 * was written for: its three imports and the functions it calls. A release of
 * the package that changes either fails the build here, with this file named,
 * rather than shipping a module the loader can't drive.
 */
import { readFileSync } from "node:fs";

const PACKAGE_FILE = new URL("../node_modules/@shiguredo/rnnoise-wasm/dist/rnnoise.js", import.meta.url);

/** What src/lib/noise/rnnoise.ts supplies, and what it calls. */
export const RNNOISE_IMPORTS = ["env.__assert_fail", "env.emscripten_resize_heap", "wasi_snapshot_preview1.fd_write"];
export const RNNOISE_EXPORTS = [
  "memory", "malloc", "free", "rnnoise_create", "rnnoise_destroy", "rnnoise_process_frame",
  "rnnoise_get_frame_size", "emscripten_stack_init", "__wasm_call_ctors",
];

function problem(message) {
  return new Error(`@shiguredo/rnnoise-wasm: ${message}. Check frontend/scripts/rnnoise-wasm.mjs and src/lib/noise/rnnoise.ts against the new release before using it.`);
}

/** The WebAssembly module's bytes, checked. `source` is the package's script, for tests. */
export function rnnoiseWasm(source = readFileSync(PACKAGE_FILE, "utf8")) {
  // "AGFzbQ" is base64 for the module's first bytes, "\0asm".
  const found = [...source.matchAll(/"(AGFzbQ[A-Za-z0-9+/]+={0,2})"/g)];
  if (found.length !== 1) throw problem(`expected one embedded WebAssembly module, found ${found.length}`);
  const bytes = new Uint8Array(Buffer.from(found[0][1], "base64"));
  if (bytes[4] !== 1 || bytes[5] !== 0 || bytes[6] !== 0 || bytes[7] !== 0) throw problem("the embedded module is not WebAssembly version 1");
  let module;
  try {
    module = new WebAssembly.Module(bytes);
  } catch (error) {
    throw problem(`the embedded module does not compile (${error.message})`);
  }
  const imports = WebAssembly.Module.imports(module).map(entry => `${entry.module}.${entry.name}`).sort();
  if (imports.join() !== [...RNNOISE_IMPORTS].sort().join()) throw problem(`its imports changed to ${imports.join(", ")}`);
  const exports = new Set(WebAssembly.Module.exports(module).map(entry => entry.name));
  const missing = RNNOISE_EXPORTS.filter(name => !exports.has(name));
  if (missing.length) throw problem(`it no longer exports ${missing.join(", ")}`);
  return bytes;
}

/**
 * `import url from "virtual:rnnoise-wasm"`: in a build, the address of the
 * module, emitted as a hashed asset (assets/rnnoise-<hash>.wasm); in the dev
 * server and in tests, a data: URL of the same bytes.
 */
export function rnnoiseWasmPlugin() {
  const id = "virtual:rnnoise-wasm";
  const resolved = `\0${id}`;
  let build = false;
  return {
    name: "privatools-rnnoise-wasm",
    configResolved(config) {
      build = config.command === "build";
    },
    resolveId(source) {
      return source === id ? resolved : null;
    },
    load(target) {
      if (target !== resolved) return null;
      const bytes = rnnoiseWasm();
      if (build) {
        const reference = this.emitFile({ type: "asset", name: "rnnoise.wasm", source: bytes });
        return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
      }
      return `export default ${JSON.stringify(`data:application/wasm;base64,${Buffer.from(bytes).toString("base64")}`)};`;
    },
  };
}
