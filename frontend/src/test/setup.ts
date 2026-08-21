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

// localStorage — this jsdom build exposes a bare object with no methods, and
// `lib/persistence.ts` swallows storage errors by design, so without this the
// persistence layer silently no-ops in tests instead of being exercised.
if (typeof localStorage?.setItem !== "function") {
  const store = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return store.size;
    },
    key: (i: number) => [...store.keys()][i] ?? null,
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
  };
  Object.defineProperty(globalThis, "localStorage", { value: shim, configurable: true, writable: true });
  Object.defineProperty(window, "localStorage", { value: shim, configurable: true, writable: true });
}

// Object URLs — jsdom implements neither createObjectURL nor revokeObjectURL.
// Real browsers do (verified: the /my-stuff export downloads correctly), so
// this is purely a test-environment gap. The shim hands back a blob: URL and
// tracks revocation so tests can assert cleanup.
if (typeof URL.createObjectURL !== "function") {
  let n = 0;
  const live = new Set<string>();
  URL.createObjectURL = () => {
    const url = `blob:privatools/${++n}`;
    live.add(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => void live.delete(url);
  (globalThis as { __liveObjectUrls?: Set<string> }).__liveObjectUrls = live;
}
