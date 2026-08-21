import "@testing-library/jest-dom";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// IndexedDB — jsdom ships none. The localStore tests need a real implementation
// so the encrypted-at-rest and structured-clone behaviours are exercised for
// real rather than mocked.
import "fake-indexeddb/auto";

// WebCrypto — jsdom defines `crypto` without `subtle`. Bind Node's webcrypto so
// the non-extractable-key path runs against a genuine implementation.
import { webcrypto } from "node:crypto";
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}
