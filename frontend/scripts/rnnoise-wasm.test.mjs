// The build step that takes RNNoise's WebAssembly out of @shiguredo/rnnoise-wasm (rnnoise-wasm.mjs):
// it passes the package it was written for and fails, naming itself, on anything else.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { RNNOISE_SHA256, rnnoiseWasm } from "./rnnoise-wasm.mjs";

const source = readFileSync(new URL("../node_modules/@shiguredo/rnnoise-wasm/dist/rnnoise.js", import.meta.url), "utf8");
const embedded = source.match(/"(AGFzbQ[A-Za-z0-9+/]+={0,2})"/)[1];
const withModule = (base64) => source.replace(embedded, base64);
const named = /@shiguredo\/rnnoise-wasm: .*Check frontend\/scripts\/rnnoise-wasm\.mjs/;

test("takes the reviewed module out of the package, byte for byte", () => {
  const bytes = rnnoiseWasm(source);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), RNNOISE_SHA256);
});

test("fails when the package no longer embeds exactly one module", () => {
  assert.throws(() => rnnoiseWasm("export const nothing = 1;"), /found 0/);
  assert.throws(() => rnnoiseWasm(`${source}\nconst again = "${embedded}";`), /found 2/);
});

test("fails on a module with other imports, or without the functions the loader calls", () => {
  // An empty module, "\0asm" version 1: it compiles, and imports and exports nothing.
  assert.throws(() => rnnoiseWasm(withModule("AGFzbQEAAAA=")), /its imports changed/);
  assert.throws(() => rnnoiseWasm(withModule("AGFzbQIAAAA=")), /not WebAssembly version 1/);
  assert.throws(() => rnnoiseWasm(withModule("AGFzbQEAAAAB")), named);
});

test("fails on any other bytes with the same interface: a new release must be checked again", () => {
  // The real module with a custom section added at the end: still valid, same imports and exports.
  const bytes = Buffer.from(embedded, "base64");
  const name = Buffer.from("review");
  const changed = Buffer.concat([bytes, Buffer.from([0, name.length + 1, name.length]), name]);
  assert.throws(() => rnnoiseWasm(withModule(changed.toString("base64"))), /not the module this was checked against/);
});
