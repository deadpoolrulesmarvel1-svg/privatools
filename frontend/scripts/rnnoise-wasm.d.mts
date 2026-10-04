import type { Plugin } from "vite";

export const RNNOISE_SHA256: string;
export const RNNOISE_IMPORTS: string[];
export const RNNOISE_EXPORTS: string[];
/** RNNoise's WebAssembly module, decoded from @shiguredo/rnnoise-wasm's script and checked. */
export function rnnoiseWasm(source?: string): Uint8Array<ArrayBuffer>;
/** Serves `virtual:rnnoise-wasm`: the module's URL (a hashed asset in builds, a data: URL otherwise). */
export function rnnoiseWasmPlugin(): Plugin;
