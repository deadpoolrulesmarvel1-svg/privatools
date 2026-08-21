# Local-First Personalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give PrivaTools users an encrypted device-local password vault, named Bates counters, a shared asset library, and per-tool defaults — with a `/my-stuff` management page — without accounts, a server, or any privacy-policy change.

**Architecture:** A new `src/lib/localStore/` package wraps IndexedDB for anything binary or secret (vault, assets, counters) and reuses the existing synchronous `localStorage` layer for tool defaults. Passwords are encrypted with AES-GCM under a **non-extractable** WebCrypto key that can never leave the device, and are trialled entirely client-side with `pdfjs-dist`, so the vault never increases what crosses the network.

**Tech Stack:** TypeScript, React 18, Vite, Vitest + jsdom + @testing-library/react, `pdfjs-dist` (already a dependency), `fake-indexeddb` (new dev dependency, test-only).

---

## Deviation from the spec (recorded)

Spec §3 places tool defaults in the IndexedDB `kv` store. **This plan keeps tool defaults in the existing synchronous `localStorage` layer instead.**

Reason: `useFormPersist` hydrates state *synchronously* in a `useRef` initializer specifically so a tool never renders defaults and then flickers into restored values (`useFormPersist.ts:42-54`). IndexedDB is async-only, so moving defaults there would reintroduce exactly that flicker on all 104 tools. Counters, vault, and assets stay in IndexedDB — none of them are read during first paint.

Spec §3 and §6.2 are amended in Task 0 to match.

---

## File structure

| File | Responsibility |
|---|---|
| `src/lib/localStore/db.ts` | IndexedDB open/upgrade + get/put/del/keys/values/clear/destroy, with an in-memory fallback |
| `src/lib/localStore/crypto.ts` | Non-extractable AES-GCM key lifecycle; encrypt/decrypt strings |
| `src/lib/localStore/vault.ts` | Password entries: add, list, reveal, candidates-by-recency, markUsed, delete |
| `src/lib/localStore/counters.ts` | Named Bates counters + active selection |
| `src/lib/localStore/assets.ts` | Binary assets with per-item and total quotas |
| `src/lib/localStore/defaults.ts` | Tool-defaults index (which slugs are customized) over `persistence.ts` |
| `src/lib/localStore/migrate.ts` | One-way import of `ESignUI`'s raw signature key |
| `src/lib/localStore/inventory.ts` | Counts/sizes for `/my-stuff`, export, erase-everything |
| `src/lib/localStore/index.ts` | Public barrel |
| `src/hooks/useToolDefaults.ts` | Drop-in `useFormPersist` replacement that also registers the slug |
| `src/hooks/usePdfPasswordTrial.ts` | Client-side pdf.js trial against the vault |
| `src/hooks/useAsset.ts` | Read/write a named asset from a tool UI |
| `src/pages/MyStuffPage.tsx` | `/my-stuff` management page |

---

## Task 0: Test environment + spec amendment

**Files:**
- Modify: `frontend/package.json`
- Modify: `frontend/src/test/setup.ts`
- Modify: `docs/superpowers/specs/2026-08-21-local-first-personalization-design.md`

- [ ] **Step 1: Install the test-only IndexedDB polyfill**

```bash
cd frontend && npm install --save-dev fake-indexeddb
```

- [ ] **Step 2: Wire polyfills into the test setup**

Append to `frontend/src/test/setup.ts`:

```ts
// IndexedDB — jsdom ships none. localStore tests need a real implementation.
import "fake-indexeddb/auto";

// WebCrypto — jsdom defines `crypto` without `subtle`. Bind Node's webcrypto so
// the non-extractable-key path is exercised for real rather than mocked.
import { webcrypto } from "node:crypto";
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}
```

- [ ] **Step 3: Verify the polyfills load**

Create `frontend/src/test/env.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("test environment", () => {
  it("provides IndexedDB", () => {
    expect(typeof indexedDB).toBe("object");
    expect(indexedDB).not.toBeNull();
  });

  it("provides WebCrypto subtle", () => {
    expect(globalThis.crypto.subtle).toBeDefined();
    expect(typeof globalThis.crypto.subtle.generateKey).toBe("function");
  });

  it("can generate a non-extractable AES-GCM key", async () => {
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });
});
```

Run: `cd frontend && npx vitest run src/test/env.test.ts`
Expected: 3 passed.

- [ ] **Step 4: Amend the spec to match this plan's storage split**

In `docs/superpowers/specs/2026-08-21-local-first-personalization-design.md`, in the §3 storage-schema table, change the `kv` row description from `counters, tool defaults, meta, schema version` to `counters, active-counter id, customized-slug index, schema version`. In §6.2, after the first paragraph add:

```markdown
Tool defaults remain on the existing synchronous `localStorage` layer rather than
IndexedDB. `useFormPersist` hydrates synchronously by design so a tool never
renders defaults and then flickers into restored values; IndexedDB is async-only
and would reintroduce that flicker across all 104 tools. Only the *index* of which
slugs are customized lives in IndexedDB, for `/my-stuff`.
```

- [ ] **Step 5: Commit**

```bash
git add frontend/package.json frontend/package-lock.json frontend/src/test/setup.ts frontend/src/test/env.test.ts docs/superpowers/specs/2026-08-21-local-first-personalization-design.md
git commit -m "test: add fake-indexeddb + webcrypto polyfills for localStore

Also amends the 0.5 spec: tool defaults stay on the synchronous
localStorage layer to avoid a first-paint flicker on all 104 tools."
```

---

## Task 1: IndexedDB wrapper

**Files:**
- Create: `frontend/src/lib/localStore/db.ts`
- Test: `frontend/src/lib/localStore/db.test.ts`

- [ ] **Step 1: Write the failing test**

`frontend/src/lib/localStore/db.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import * as db from "./db";

beforeEach(async () => {
  await db.destroy();
});

describe("localStore/db", () => {
  it("reports availability", () => {
    expect(db.isAvailable()).toBe(true);
  });

  it("round-trips a value", async () => {
    await db.put("kv", "greeting", { hello: "world" });
    expect(await db.get<{ hello: string }>("kv", "greeting")).toEqual({ hello: "world" });
  });

  it("returns undefined for a missing key", async () => {
    expect(await db.get("kv", "nope")).toBeUndefined();
  });

  it("overwrites on repeated put", async () => {
    await db.put("kv", "n", 1);
    await db.put("kv", "n", 2);
    expect(await db.get("kv", "n")).toBe(2);
  });

  it("deletes a key", async () => {
    await db.put("kv", "gone", true);
    await db.del("kv", "gone");
    expect(await db.get("kv", "gone")).toBeUndefined();
  });

  it("lists keys and values for one store only", async () => {
    await db.put("kv", "a", 1);
    await db.put("kv", "b", 2);
    await db.put("vault", "v1", { secret: true });
    expect((await db.keys("kv")).sort()).toEqual(["a", "b"]);
    expect((await db.values<number>("kv")).sort()).toEqual([1, 2]);
    expect(await db.keys("vault")).toEqual(["v1"]);
  });

  it("clears one store without touching another", async () => {
    await db.put("kv", "a", 1);
    await db.put("vault", "v1", 1);
    await db.clear("kv");
    expect(await db.keys("kv")).toEqual([]);
    expect(await db.keys("vault")).toEqual(["v1"]);
  });

  it("destroy removes everything", async () => {
    await db.put("kv", "a", 1);
    await db.destroy();
    expect(await db.keys("kv")).toEqual([]);
  });

  it("stores structured-cloneable values including Blob", async () => {
    const blob = new Blob(["hi"], { type: "text/plain" });
    await db.put("assets", "b", blob);
    const back = await db.get<Blob>("assets", "b");
    expect(back).toBeInstanceOf(Blob);
    expect(await back!.text()).toBe("hi");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/localStore/db.test.ts`
Expected: FAIL — `Failed to resolve import "./db"`.

- [ ] **Step 3: Write the implementation**

`frontend/src/lib/localStore/db.ts`:

```ts
/**
 * Minimal IndexedDB wrapper for the local-first personalization store.
 *
 * Deliberately hand-rolled rather than pulling in `idb`: we need six
 * operations, the repo runs a bundle-size gate (`npm run check:bundle`) and an
 * SRI step, and a dependency for this much surface isn't worth the cost.
 *
 * Degradation: when IndexedDB is unavailable (private mode, some embedded
 * webviews, SSR) every operation transparently falls back to an in-memory Map
 * for the session. Callers never see an error — personalization simply doesn't
 * survive a reload, which is strictly better than a crashed tool page.
 */

const DB_NAME = "privatools";
const DB_VERSION = 1;

export const STORES = ["secrets", "vault", "assets", "kv"] as const;
export type StoreName = (typeof STORES)[number];

let dbPromise: Promise<IDBDatabase> | null = null;
const memory = new Map<StoreName, Map<string, unknown>>();

function memStore(store: StoreName): Map<string, unknown> {
  let m = memory.get(store);
  if (!m) {
    m = new Map();
    memory.set(store, m);
  }
  return m;
}

export function isAvailable(): boolean {
  try {
    return typeof indexedDB !== "undefined" && indexedDB !== null;
  } catch {
    return false;
  }
}

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const s of STORES) {
        if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("indexeddb blocked"));
  });
  return dbPromise;
}

async function run<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (os: IDBObjectStore) => IDBRequest,
): Promise<T> {
  const d = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    req.onsuccess = () => resolve(req.result as T);
    req.onerror = () => reject(req.error);
  });
}

export async function get<T>(store: StoreName, key: string): Promise<T | undefined> {
  if (!isAvailable()) return memStore(store).get(key) as T | undefined;
  try {
    return await run<T | undefined>(store, "readonly", (os) => os.get(key));
  } catch {
    return memStore(store).get(key) as T | undefined;
  }
}

export async function put(store: StoreName, key: string, value: unknown): Promise<void> {
  if (!isAvailable()) {
    memStore(store).set(key, value);
    return;
  }
  try {
    await run<void>(store, "readwrite", (os) => os.put(value, key));
  } catch {
    memStore(store).set(key, value);
  }
}

export async function del(store: StoreName, key: string): Promise<void> {
  memStore(store).delete(key);
  if (!isAvailable()) return;
  try {
    await run<void>(store, "readwrite", (os) => os.delete(key));
  } catch {
    /* already removed from the memory mirror */
  }
}

export async function keys(store: StoreName): Promise<string[]> {
  if (!isAvailable()) return [...memStore(store).keys()];
  try {
    const k = await run<IDBValidKey[]>(store, "readonly", (os) => os.getAllKeys());
    return k.map(String);
  } catch {
    return [...memStore(store).keys()];
  }
}

export async function values<T>(store: StoreName): Promise<T[]> {
  if (!isAvailable()) return [...memStore(store).values()] as T[];
  try {
    return await run<T[]>(store, "readonly", (os) => os.getAll());
  } catch {
    return [...memStore(store).values()] as T[];
  }
}

export async function clear(store: StoreName): Promise<void> {
  memStore(store).clear();
  if (!isAvailable()) return;
  try {
    await run<void>(store, "readwrite", (os) => os.clear());
  } catch {
    /* memory mirror already cleared */
  }
}

/** Delete the whole database. Used by "Erase everything" and by tests. */
export async function destroy(): Promise<void> {
  memory.clear();
  if (!isAvailable()) return;
  if (dbPromise) {
    try {
      (await dbPromise).close();
    } catch {
      /* already closed */
    }
    dbPromise = null;
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/localStore/db.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/localStore/db.ts frontend/src/lib/localStore/db.test.ts
git commit -m "feat(localStore): IndexedDB wrapper with in-memory degradation"
```

---

## Task 2: Non-extractable crypto

**Files:**
- Create: `frontend/src/lib/localStore/crypto.ts`
- Test: `frontend/src/lib/localStore/crypto.test.ts`

- [ ] **Step 1: Write the failing test**

`frontend/src/lib/localStore/crypto.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import * as db from "./db";
import * as c from "./crypto";

beforeEach(async () => {
  await db.destroy();
  c._resetForTests();
});

describe("localStore/crypto", () => {
  it("reports WebCrypto availability", () => {
    expect(c.hasWebCrypto()).toBe(true);
  });

  it("generates a key that cannot be exported", async () => {
    const key = await c.getOrCreateKey();
    expect(key.extractable).toBe(false);
    await expect(crypto.subtle.exportKey("raw", key)).rejects.toThrow();
  });

  it("reuses the same key across calls", async () => {
    const a = await c.getOrCreateKey();
    c._resetForTests();
    const b = await c.getOrCreateKey();
    const enc = await c.encryptString("hello", a);
    expect(await c.decryptString(enc, b)).toBe("hello");
  });

  it("round-trips a string", async () => {
    const enc = await c.encryptString("hunter2");
    expect(await c.decryptString(enc)).toBe("hunter2");
  });

  it("does not store the plaintext", async () => {
    const enc = await c.encryptString("hunter2");
    const bytes = new Uint8Array(enc.ct);
    expect(new TextDecoder().decode(bytes)).not.toContain("hunter2");
  });

  it("uses a fresh IV per encryption", async () => {
    const a = await c.encryptString("same");
    const b = await c.encryptString("same");
    expect(Array.from(a.iv)).not.toEqual(Array.from(b.iv));
  });

  it("fails cleanly when decrypting with the wrong key", async () => {
    const enc = await c.encryptString("secret");
    const other = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"],
    );
    await expect(c.decryptString(enc, other as CryptoKey)).rejects.toThrow();
  });

  it("round-trips unicode", async () => {
    const enc = await c.encryptString("пароль-密码-🔐");
    expect(await c.decryptString(enc)).toBe("пароль-密码-🔐");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/localStore/crypto.test.ts`
Expected: FAIL — `Failed to resolve import "./crypto"`.

- [ ] **Step 3: Write the implementation**

`frontend/src/lib/localStore/crypto.ts`:

```ts
/**
 * Vault encryption.
 *
 * Passwords are encrypted with AES-GCM under a key generated as
 * NON-EXTRACTABLE (`extractable: false`). The browser will hand the page a
 * handle to the key and will encrypt/decrypt with it, but `exportKey` rejects —
 * the raw bytes can never be read out, copied to another device, or exfiltrated
 * by a script that dumps storage.
 *
 * What this does NOT protect against: script execution on our own origin (XSS).
 * A compromised page can ask the key to decrypt just as legitimate code does.
 * The real control there is the nonce-based CSP. `/my-stuff` says so plainly
 * rather than overclaiming.
 */
import * as db from "./db";

const KEY_ID = "vault-key";
const IV_BYTES = 12; // AES-GCM standard nonce length

export interface Encrypted {
  iv: Uint8Array;
  ct: ArrayBuffer;
}

let cached: Promise<CryptoKey> | null = null;

export function hasWebCrypto(): boolean {
  try {
    return typeof globalThis.crypto?.subtle?.generateKey === "function";
  } catch {
    return false;
  }
}

/** Test hook — drops the in-process cache so a fresh read from IndexedDB happens. */
export function _resetForTests(): void {
  cached = null;
}

export function getOrCreateKey(): Promise<CryptoKey> {
  if (cached) return cached;
  cached = (async () => {
    const existing = await db.get<CryptoKey>("secrets", KEY_ID);
    // A structured-clone round-trip preserves `extractable: false`.
    if (existing && typeof (existing as CryptoKey).type === "string") return existing;
    const key = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    await db.put("secrets", KEY_ID, key);
    return key;
  })();
  return cached;
}

export async function encryptString(plain: string, key?: CryptoKey): Promise<Encrypted> {
  const k = key ?? (await getOrCreateKey());
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    k,
    new TextEncoder().encode(plain),
  );
  return { iv, ct };
}

export async function decryptString(enc: Encrypted, key?: CryptoKey): Promise<string> {
  const k = key ?? (await getOrCreateKey());
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: enc.iv }, k, enc.ct);
  return new TextDecoder().decode(plain);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/localStore/crypto.test.ts`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/localStore/crypto.ts frontend/src/lib/localStore/crypto.test.ts
git commit -m "feat(localStore): AES-GCM under a non-extractable WebCrypto key"
```

---

## Task 3: Password vault

**Files:**
- Create: `frontend/src/lib/localStore/vault.ts`
- Test: `frontend/src/lib/localStore/vault.test.ts`

- [ ] **Step 1: Write the failing test**

`frontend/src/lib/localStore/vault.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import * as db from "./db";
import * as crypt from "./crypto";
import * as vault from "./vault";

beforeEach(async () => {
  await db.destroy();
  crypt._resetForTests();
});

describe("localStore/vault", () => {
  it("adds and lists an entry without exposing the password", async () => {
    const meta = await vault.addPassword("work docs", "hunter2");
    expect(meta.label).toBe("work docs");
    expect(JSON.stringify(meta)).not.toContain("hunter2");

    const list = await vault.listEntries();
    expect(list).toHaveLength(1);
    expect(JSON.stringify(list)).not.toContain("hunter2");
  });

  it("stores ciphertext, never plaintext, at rest", async () => {
    await vault.addPassword("work", "hunter2");
    const raw = await db.values<Record<string, unknown>>("vault");
    const dump = raw.map((r) => new TextDecoder().decode(new Uint8Array(r.ct as ArrayBuffer))).join("");
    expect(dump).not.toContain("hunter2");
  });

  it("reveals the password on explicit request", async () => {
    const meta = await vault.addPassword("work", "hunter2");
    expect(await vault.revealPassword(meta.id)).toBe("hunter2");
  });

  it("rejects an empty password", async () => {
    await expect(vault.addPassword("x", "")).rejects.toThrow(/empty/i);
  });

  it("deduplicates by password, keeping the newer label", async () => {
    await vault.addPassword("old label", "same");
    await vault.addPassword("new label", "same");
    const list = await vault.listEntries();
    expect(list).toHaveLength(1);
    expect(list[0].label).toBe("new label");
  });

  it("orders candidates most-recently-used first", async () => {
    const a = await vault.addPassword("a", "pw-a");
    const b = await vault.addPassword("b", "pw-b");
    await vault.markUsed(a.id);
    const cands = await vault.candidatesByRecency();
    expect(cands.map((c) => c.password)).toEqual(["pw-a", "pw-b"]);
    expect(b.id).toBeTruthy();
  });

  it("bumps lastUsedAt and useCount only via markUsed", async () => {
    const m = await vault.addPassword("a", "pw");
    expect(m.useCount).toBe(0);
    await vault.markUsed(m.id);
    const [after] = await vault.listEntries();
    expect(after.useCount).toBe(1);
    expect(after.lastUsedAt).toBeGreaterThanOrEqual(m.lastUsedAt);
  });

  it("deletes one entry", async () => {
    const a = await vault.addPassword("a", "pw-a");
    await vault.addPassword("b", "pw-b");
    await vault.deleteEntry(a.id);
    const list = await vault.listEntries();
    expect(list.map((e) => e.label)).toEqual(["b"]);
  });

  it("clears the whole vault", async () => {
    await vault.addPassword("a", "pw-a");
    await vault.clearVault();
    expect(await vault.listEntries()).toEqual([]);
  });

  it("reports entries it cannot decrypt instead of throwing", async () => {
    await vault.addPassword("good", "pw");
    await db.put("vault", "corrupt", {
      id: "corrupt",
      label: "broken",
      iv: new Uint8Array(12),
      ct: new Uint8Array([1, 2, 3]).buffer,
      createdAt: Date.now(),
      lastUsedAt: 0,
      useCount: 0,
    });
    const cands = await vault.candidatesByRecency();
    expect(cands.map((c) => c.password)).toEqual(["pw"]);
    expect(await vault.unreadableCount()).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/localStore/vault.test.ts`
Expected: FAIL — `Failed to resolve import "./vault"`.

- [ ] **Step 3: Write the implementation**

`frontend/src/lib/localStore/vault.ts`:

```ts
/**
 * Device-local password vault.
 *
 * Entries hold only ciphertext. `label` is a user-supplied nickname and is
 * stored in plaintext — the UI warns against putting the password in it.
 *
 * Candidate ordering is most-recently-used first, which is the best available
 * heuristic without fingerprinting documents. We deliberately do NOT store a
 * hash of the PDF to remember which password opened it: that would be a privacy
 * regression (a stable identifier for a user's documents) for a marginal
 * speed-up on a loop that runs in milliseconds.
 */
import * as db from "./db";
import { decryptString, encryptString, type Encrypted } from "./crypto";

export interface VaultEntry extends Encrypted {
  id: string;
  label: string;
  createdAt: number;
  lastUsedAt: number;
  useCount: number;
}

export type VaultEntryMeta = Omit<VaultEntry, "iv" | "ct">;

function toMeta(e: VaultEntry): VaultEntryMeta {
  const { iv: _iv, ct: _ct, ...meta } = e;
  return meta;
}

function newId(): string {
  return crypto.randomUUID();
}

async function all(): Promise<VaultEntry[]> {
  return await db.values<VaultEntry>("vault");
}

/** Decrypt every entry, skipping any that fail. Returns the readable ones. */
async function readable(): Promise<{ entry: VaultEntry; password: string }[]> {
  const out: { entry: VaultEntry; password: string }[] = [];
  for (const entry of await all()) {
    try {
      out.push({ entry, password: await decryptString({ iv: entry.iv, ct: entry.ct }) });
    } catch {
      /* corrupt or key-mismatched — surfaced via unreadableCount() */
    }
  }
  return out;
}

export async function addPassword(label: string, password: string): Promise<VaultEntryMeta> {
  if (!password) throw new Error("Password cannot be empty");

  // Dedupe: the same password saved twice would be tried twice for no gain.
  // Keep the newer label so a re-save can rename.
  for (const { entry, password: existing } of await readable()) {
    if (existing === password) {
      const updated: VaultEntry = { ...entry, label: label || entry.label };
      await db.put("vault", updated.id, updated);
      return toMeta(updated);
    }
  }

  const enc = await encryptString(password);
  const entry: VaultEntry = {
    id: newId(),
    label: label || "Untitled",
    iv: enc.iv,
    ct: enc.ct,
    createdAt: Date.now(),
    lastUsedAt: 0,
    useCount: 0,
  };
  await db.put("vault", entry.id, entry);
  return toMeta(entry);
}

/** Metadata only, most-recently-used first. Never returns passwords. */
export async function listEntries(): Promise<VaultEntryMeta[]> {
  const entries = await all();
  entries.sort((a, b) => b.lastUsedAt - a.lastUsedAt || b.createdAt - a.createdAt);
  return entries.map(toMeta);
}

export async function revealPassword(id: string): Promise<string> {
  const entry = await db.get<VaultEntry>("vault", id);
  if (!entry) throw new Error("No such vault entry");
  return decryptString({ iv: entry.iv, ct: entry.ct });
}

/** Decrypted candidates for a trial run, most-recently-used first. */
export async function candidatesByRecency(): Promise<{ id: string; password: string }[]> {
  const items = await readable();
  items.sort(
    (a, b) =>
      b.entry.lastUsedAt - a.entry.lastUsedAt || b.entry.createdAt - a.entry.createdAt,
  );
  return items.map(({ entry, password }) => ({ id: entry.id, password }));
}

export async function unreadableCount(): Promise<number> {
  return (await all()).length - (await readable()).length;
}

export async function markUsed(id: string): Promise<void> {
  const entry = await db.get<VaultEntry>("vault", id);
  if (!entry) return;
  await db.put("vault", id, {
    ...entry,
    lastUsedAt: Date.now(),
    useCount: entry.useCount + 1,
  });
}

export async function deleteEntry(id: string): Promise<void> {
  await db.del("vault", id);
}

export async function clearVault(): Promise<void> {
  await db.clear("vault");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/localStore/vault.test.ts`
Expected: 10 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/localStore/vault.ts frontend/src/lib/localStore/vault.test.ts
git commit -m "feat(localStore): encrypted password vault with recency-ordered candidates"
```

---

## Task 4: Named Bates counters

**Files:**
- Create: `frontend/src/lib/localStore/counters.ts`
- Test: `frontend/src/lib/localStore/counters.test.ts`

- [ ] **Step 1: Write the failing test**

`frontend/src/lib/localStore/counters.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import * as db from "./db";
import * as counters from "./counters";

beforeEach(async () => {
  await db.destroy();
});

describe("localStore/counters", () => {
  it("creates a counter with defaults", async () => {
    const c = await counters.createCounter({ name: "Smith v. Acme" });
    expect(c.name).toBe("Smith v. Acme");
    expect(c.next).toBe(1);
    expect(c.digits).toBe(6);
    expect(c.position).toBe("bottom-right");
  });

  it("lists counters newest-updated first", async () => {
    const a = await counters.createCounter({ name: "A" });
    await counters.createCounter({ name: "B" });
    await counters.updateCounter(a.id, { prefix: "A-" });
    expect((await counters.listCounters()).map((c) => c.name)).toEqual(["A", "B"]);
  });

  it("advances by the number of pages stamped", async () => {
    const c = await counters.createCounter({ name: "M", prefix: "M-", next: 400 });
    const after = await counters.advanceCounter(c.id, 12);
    expect(after.next).toBe(412);
  });

  it("keeps counters independent", async () => {
    const a = await counters.createCounter({ name: "A", next: 10 });
    const b = await counters.createCounter({ name: "B", next: 500 });
    await counters.advanceCounter(a.id, 5);
    expect((await counters.getCounter(b.id))!.next).toBe(500);
  });

  it("allows manual correction of next", async () => {
    const c = await counters.createCounter({ name: "M", next: 100 });
    const after = await counters.updateCounter(c.id, { next: 250 });
    expect(after.next).toBe(250);
  });

  it("rejects a negative or zero advance", async () => {
    const c = await counters.createCounter({ name: "M" });
    await expect(counters.advanceCounter(c.id, 0)).rejects.toThrow(/pages/i);
    await expect(counters.advanceCounter(c.id, -3)).rejects.toThrow(/pages/i);
  });

  it("tracks the active counter", async () => {
    const c = await counters.createCounter({ name: "M" });
    expect(await counters.getActiveCounterId()).toBe(c.id);
    const d = await counters.createCounter({ name: "N" });
    await counters.setActiveCounterId(d.id);
    expect(await counters.getActiveCounterId()).toBe(d.id);
  });

  it("clears the active id when the active counter is deleted", async () => {
    const c = await counters.createCounter({ name: "M" });
    await counters.deleteCounter(c.id);
    expect(await counters.getActiveCounterId()).toBeNull();
  });

  it("formats the next label", async () => {
    const c = await counters.createCounter({ name: "M", prefix: "SMITH-", digits: 6, next: 412 });
    expect(counters.formatNext(c)).toBe("SMITH-000412");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/localStore/counters.test.ts`
Expected: FAIL — `Failed to resolve import "./counters"`.

- [ ] **Step 3: Write the implementation**

`frontend/src/lib/localStore/counters.ts`:

```ts
/**
 * Named Bates counters.
 *
 * Discovery numbering is continuous *per matter* and must never be shared
 * across matters, so a single global counter silently corrupts numbering the
 * moment someone works two cases. Each counter is independent; one is active
 * at a time.
 *
 * `advanceCounter` is called only after a confirmed successful stamp. Gaps in a
 * Bates sequence are a real problem in litigation, so we never advance
 * optimistically.
 */
import * as db from "./db";

const ACTIVE_KEY = "bates:active";
const PREFIX = "bates:counter:";

export interface BatesCounter {
  id: string;
  name: string;
  prefix: string;
  digits: number;
  position: string;
  next: number;
  updatedAt: number;
}

export interface CounterInput {
  name: string;
  prefix?: string;
  digits?: number;
  position?: string;
  next?: number;
}

function key(id: string): string {
  return PREFIX + id;
}

export function formatNext(c: BatesCounter): string {
  return `${c.prefix}${String(c.next).padStart(c.digits, "0")}`;
}

export async function listCounters(): Promise<BatesCounter[]> {
  const all = await db.values<BatesCounter>("kv");
  return all
    .filter((v): v is BatesCounter => !!v && typeof (v as BatesCounter).next === "number")
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getCounter(id: string): Promise<BatesCounter | undefined> {
  return db.get<BatesCounter>("kv", key(id));
}

export async function createCounter(input: CounterInput): Promise<BatesCounter> {
  const c: BatesCounter = {
    id: crypto.randomUUID(),
    name: input.name || "Untitled matter",
    prefix: input.prefix ?? "",
    digits: input.digits ?? 6,
    position: input.position ?? "bottom-right",
    next: input.next ?? 1,
    updatedAt: Date.now(),
  };
  await db.put("kv", key(c.id), c);
  if (!(await getActiveCounterId())) await setActiveCounterId(c.id);
  return c;
}

export async function updateCounter(
  id: string,
  patch: Partial<Omit<BatesCounter, "id">>,
): Promise<BatesCounter> {
  const existing = await getCounter(id);
  if (!existing) throw new Error("No such counter");
  const updated: BatesCounter = { ...existing, ...patch, id, updatedAt: Date.now() };
  await db.put("kv", key(id), updated);
  return updated;
}

/** Advance after a CONFIRMED successful stamp. Never call optimistically. */
export async function advanceCounter(id: string, pages: number): Promise<BatesCounter> {
  if (!Number.isFinite(pages) || pages <= 0) {
    throw new Error("pages must be a positive number");
  }
  const existing = await getCounter(id);
  if (!existing) throw new Error("No such counter");
  return updateCounter(id, { next: existing.next + Math.floor(pages) });
}

export async function deleteCounter(id: string): Promise<void> {
  await db.del("kv", key(id));
  if ((await getActiveCounterId()) === id) await db.del("kv", ACTIVE_KEY);
}

export async function getActiveCounterId(): Promise<string | null> {
  return (await db.get<string>("kv", ACTIVE_KEY)) ?? null;
}

export async function setActiveCounterId(id: string): Promise<void> {
  await db.put("kv", ACTIVE_KEY, id);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/localStore/counters.test.ts`
Expected: 9 passed.

Note: `listCounters` filters `kv` values by shape because the `kv` store also holds the active-counter id (a string) and the customized-slug index (an array). The `next` type-check discriminates counters from both.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/localStore/counters.ts frontend/src/lib/localStore/counters.test.ts
git commit -m "feat(localStore): named Bates counters, advance only on success"
```

---

## Task 5: Asset library

**Files:**
- Create: `frontend/src/lib/localStore/assets.ts`
- Test: `frontend/src/lib/localStore/assets.test.ts`

- [ ] **Step 1: Write the failing test**

`frontend/src/lib/localStore/assets.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import * as db from "./db";
import * as assets from "./assets";

const blobOf = (n: number, type = "image/png") =>
  new Blob([new Uint8Array(n)], { type });

beforeEach(async () => {
  await db.destroy();
});

describe("localStore/assets", () => {
  it("round-trips a blob", async () => {
    const meta = await assets.putAsset("signature", "mine.png", blobOf(10));
    expect(meta.kind).toBe("signature");
    expect(meta.bytes).toBe(10);
    const back = await assets.getAssetBlob(meta.id);
    expect(back).toBeInstanceOf(Blob);
    expect(back!.size).toBe(10);
  });

  it("lists all assets and filters by kind", async () => {
    await assets.putAsset("signature", "s.png", blobOf(4));
    await assets.putAsset("logo", "l.png", blobOf(4));
    expect(await assets.listAssets()).toHaveLength(2);
    expect((await assets.listAssets("logo")).map((a) => a.name)).toEqual(["l.png"]);
  });

  it("rejects an asset over the per-item cap", async () => {
    await expect(
      assets.putAsset("logo", "big.png", blobOf(assets.MAX_ASSET_BYTES + 1)),
    ).rejects.toThrow(/too large/i);
  });

  it("rejects a write that would exceed the total cap", async () => {
    const chunk = assets.MAX_ASSET_BYTES;
    for (let i = 0; i < 5; i++) {
      await assets.putAsset("logo", `l${i}.png`, blobOf(chunk));
    }
    expect(await assets.totalAssetBytes()).toBe(assets.MAX_TOTAL_BYTES);
    await expect(assets.putAsset("logo", "one-more.png", blobOf(1))).rejects.toThrow(
      /storage is full/i,
    );
  });

  it("rejects an empty blob", async () => {
    await expect(assets.putAsset("logo", "empty.png", blobOf(0))).rejects.toThrow(/empty/i);
  });

  it("deletes an asset and frees its budget", async () => {
    const m = await assets.putAsset("logo", "l.png", blobOf(100));
    await assets.deleteAsset(m.id);
    expect(await assets.listAssets()).toEqual([]);
    expect(await assets.totalAssetBytes()).toBe(0);
  });

  it("replaces the single asset of a singleton kind", async () => {
    await assets.putAsset("signature", "old.png", blobOf(10));
    await assets.putAsset("signature", "new.png", blobOf(20));
    const list = await assets.listAssets("signature");
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe("new.png");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/localStore/assets.test.ts`
Expected: FAIL — `Failed to resolve import "./assets"`.

- [ ] **Step 3: Write the implementation**

`frontend/src/lib/localStore/assets.ts`:

```ts
/**
 * Shared binary assets — signature, logo, watermark, letterhead, stamp.
 *
 * Generalizes what ESignUI already did for signatures alone (a raw
 * localStorage data-URL key) into a typed store the watermark, stamp, and
 * header-footer tools can all read from.
 *
 * Quotas are explicit and produce a clear error rather than a silent write
 * failure: running out of storage mid-save with no message is worse than a
 * refusal that says why.
 */
import * as db from "./db";

export type AssetKind = "signature" | "logo" | "watermark" | "letterhead" | "stamp";

/** Kinds where a second asset replaces the first rather than accumulating. */
const SINGLETON_KINDS: ReadonlySet<AssetKind> = new Set(["signature", "letterhead"]);

export const MAX_ASSET_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 25 * 1024 * 1024;

export interface AssetMeta {
  id: string;
  kind: AssetKind;
  name: string;
  mime: string;
  bytes: number;
  createdAt: number;
}

interface AssetRecord extends AssetMeta {
  blob: Blob;
}

function toMeta(r: AssetRecord): AssetMeta {
  const { blob: _blob, ...meta } = r;
  return meta;
}

async function records(): Promise<AssetRecord[]> {
  return db.values<AssetRecord>("assets");
}

export async function totalAssetBytes(): Promise<number> {
  return (await records()).reduce((sum, r) => sum + r.bytes, 0);
}

export async function putAsset(kind: AssetKind, name: string, blob: Blob): Promise<AssetMeta> {
  if (blob.size === 0) throw new Error("That file is empty.");
  if (blob.size > MAX_ASSET_BYTES) {
    throw new Error(
      `That file is too large — the limit is ${Math.round(MAX_ASSET_BYTES / 1024 / 1024)} MB per item.`,
    );
  }

  const existing = await records();
  const replacing = SINGLETON_KINDS.has(kind)
    ? existing.filter((r) => r.kind === kind)
    : [];
  const freed = replacing.reduce((sum, r) => sum + r.bytes, 0);
  const used = existing.reduce((sum, r) => sum + r.bytes, 0) - freed;

  if (used + blob.size > MAX_TOTAL_BYTES) {
    throw new Error(
      `Your device storage is full — the limit is ${Math.round(MAX_TOTAL_BYTES / 1024 / 1024)} MB total. Delete something first.`,
    );
  }

  for (const r of replacing) await db.del("assets", r.id);

  const record: AssetRecord = {
    id: crypto.randomUUID(),
    kind,
    name: name || "untitled",
    mime: blob.type || "application/octet-stream",
    bytes: blob.size,
    createdAt: Date.now(),
    blob,
  };
  await db.put("assets", record.id, record);
  return toMeta(record);
}

export async function listAssets(kind?: AssetKind): Promise<AssetMeta[]> {
  const all = await records();
  return all
    .filter((r) => !kind || r.kind === kind)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(toMeta);
}

export async function getAssetBlob(id: string): Promise<Blob | undefined> {
  return (await db.get<AssetRecord>("assets", id))?.blob;
}

export async function deleteAsset(id: string): Promise<void> {
  await db.del("assets", id);
}

export async function clearAssets(): Promise<void> {
  await db.clear("assets");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/localStore/assets.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/localStore/assets.ts frontend/src/lib/localStore/assets.test.ts
git commit -m "feat(localStore): binary asset library with explicit quotas"
```

---

## Task 6: Tool-defaults index

**Files:**
- Create: `frontend/src/lib/localStore/defaults.ts`
- Test: `frontend/src/lib/localStore/defaults.test.ts`

The values themselves stay in `persistence.ts` (synchronous, no first-paint flicker). This module tracks *which* slugs are customized so `/my-stuff` can list and clear them.

- [ ] **Step 1: Write the failing test**

`frontend/src/lib/localStore/defaults.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import * as db from "./db";
import * as defaults from "./defaults";
import { loadPersisted, savePersisted } from "@/lib/persistence";

beforeEach(async () => {
  await db.destroy();
  localStorage.clear();
});

describe("localStore/defaults", () => {
  it("starts with no customized slugs", async () => {
    expect(await defaults.customizedSlugs()).toEqual([]);
  });

  it("registers a slug once", async () => {
    await defaults.registerCustomized("compress");
    await defaults.registerCustomized("compress");
    expect(await defaults.customizedSlugs()).toEqual(["compress"]);
  });

  it("unregisters a slug", async () => {
    await defaults.registerCustomized("compress");
    await defaults.registerCustomized("bates");
    await defaults.unregisterCustomized("compress");
    expect(await defaults.customizedSlugs()).toEqual(["bates"]);
  });

  it("clearSlug removes both the value and the registration", async () => {
    savePersisted("compress", { level: "extreme" });
    await defaults.registerCustomized("compress");
    await defaults.clearSlug("compress");
    expect(loadPersisted("compress")).toBeNull();
    expect(await defaults.customizedSlugs()).toEqual([]);
  });

  it("clearAll removes every registered slug's value", async () => {
    savePersisted("compress", { level: "extreme" });
    savePersisted("bates", { prefix: "X-" });
    await defaults.registerCustomized("compress");
    await defaults.registerCustomized("bates");
    await defaults.clearAll();
    expect(loadPersisted("compress")).toBeNull();
    expect(loadPersisted("bates")).toBeNull();
    expect(await defaults.customizedSlugs()).toEqual([]);
  });

  it("exports the customized values as a plain object", async () => {
    savePersisted("compress", { level: "extreme" });
    await defaults.registerCustomized("compress");
    expect(await defaults.exportDefaults()).toEqual({ compress: { level: "extreme" } });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/localStore/defaults.test.ts`
Expected: FAIL — `Failed to resolve import "./defaults"`.

- [ ] **Step 3: Write the implementation**

`frontend/src/lib/localStore/defaults.ts`:

```ts
/**
 * Index of which tool slugs have customized defaults.
 *
 * The values live in `lib/persistence.ts` (synchronous localStorage) so tools
 * hydrate without a first-paint flicker. Only the index lives here, so
 * `/my-stuff` can answer "which tools have I customized?" and clear them.
 */
import * as db from "./db";
import { clearPersisted, loadPersisted } from "@/lib/persistence";

const INDEX_KEY = "defaults:slugs";

export async function customizedSlugs(): Promise<string[]> {
  return (await db.get<string[]>("kv", INDEX_KEY)) ?? [];
}

export async function registerCustomized(slug: string): Promise<void> {
  const slugs = await customizedSlugs();
  if (slugs.includes(slug)) return;
  await db.put("kv", INDEX_KEY, [...slugs, slug]);
}

export async function unregisterCustomized(slug: string): Promise<void> {
  const slugs = await customizedSlugs();
  if (!slugs.includes(slug)) return;
  await db.put(
    "kv",
    INDEX_KEY,
    slugs.filter((s) => s !== slug),
  );
}

export async function clearSlug(slug: string): Promise<void> {
  clearPersisted(slug);
  await unregisterCustomized(slug);
}

export async function clearAll(): Promise<void> {
  for (const slug of await customizedSlugs()) clearPersisted(slug);
  await db.del("kv", INDEX_KEY);
}

export async function exportDefaults(): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  for (const slug of await customizedSlugs()) {
    const value = loadPersisted<unknown>(slug);
    if (value !== null) out[slug] = value;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/localStore/defaults.test.ts`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/localStore/defaults.ts frontend/src/lib/localStore/defaults.test.ts
git commit -m "feat(localStore): index of customized tool slugs"
```

---

## Task 7: Inventory, export, erase

**Files:**
- Create: `frontend/src/lib/localStore/inventory.ts`
- Create: `frontend/src/lib/localStore/index.ts`
- Test: `frontend/src/lib/localStore/inventory.test.ts`

- [ ] **Step 1: Write the failing test**

`frontend/src/lib/localStore/inventory.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import * as db from "./db";
import * as crypt from "./crypto";
import * as vault from "./vault";
import * as assets from "./assets";
import * as counters from "./counters";
import * as defaults from "./defaults";
import { eraseEverything, exportSetup, inventory } from "./inventory";
import { savePersisted } from "@/lib/persistence";

beforeEach(async () => {
  await db.destroy();
  crypt._resetForTests();
  localStorage.clear();
});

describe("localStore/inventory", () => {
  it("reports an empty store", async () => {
    const inv = await inventory();
    expect(inv.vault.count).toBe(0);
    expect(inv.assets.count).toBe(0);
    expect(inv.assets.bytes).toBe(0);
    expect(inv.counters.count).toBe(0);
    expect(inv.defaults.count).toBe(0);
  });

  it("counts everything stored", async () => {
    await vault.addPassword("a", "pw");
    await assets.putAsset("logo", "l.png", new Blob([new Uint8Array(64)]));
    await counters.createCounter({ name: "M" });
    savePersisted("compress", { level: "extreme" });
    await defaults.registerCustomized("compress");

    const inv = await inventory();
    expect(inv.vault.count).toBe(1);
    expect(inv.assets.count).toBe(1);
    expect(inv.assets.bytes).toBe(64);
    expect(inv.counters.count).toBe(1);
    expect(inv.defaults.count).toBe(1);
  });

  it("export excludes the vault entirely", async () => {
    await vault.addPassword("secret label", "hunter2");
    await counters.createCounter({ name: "M", prefix: "M-" });
    savePersisted("compress", { level: "extreme" });
    await defaults.registerCustomized("compress");

    const text = await (await exportSetup()).text();
    expect(text).not.toContain("hunter2");
    expect(text).not.toContain("secret label");
    expect(text).toContain("M-");
    expect(text).toContain("extreme");

    const parsed = JSON.parse(text);
    expect(parsed.vault).toBeUndefined();
    expect(parsed.note).toMatch(/vault/i);
  });

  it("eraseEverything leaves nothing behind", async () => {
    await vault.addPassword("a", "pw");
    await assets.putAsset("logo", "l.png", new Blob([new Uint8Array(8)]));
    await counters.createCounter({ name: "M" });
    savePersisted("compress", { level: "extreme" });
    await defaults.registerCustomized("compress");
    localStorage.setItem("privatools_form_other", "x");

    await eraseEverything();

    const inv = await inventory();
    expect(inv.vault.count).toBe(0);
    expect(inv.assets.count).toBe(0);
    expect(inv.counters.count).toBe(0);
    expect(inv.defaults.count).toBe(0);
    expect(localStorage.getItem("privatools_form_other")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/localStore/inventory.test.ts`
Expected: FAIL — `Failed to resolve import "./inventory"`.

- [ ] **Step 3: Write the implementation**

`frontend/src/lib/localStore/inventory.ts`:

```ts
/**
 * What's stored on this device — powers /my-stuff.
 *
 * `exportSetup` deliberately omits the vault: its key is non-extractable, so
 * the passwords cannot be re-imported anywhere anyway. The export says so
 * rather than silently producing an incomplete backup.
 */
import * as db from "./db";
import * as assets from "./assets";
import * as counters from "./counters";
import * as defaults from "./defaults";
import * as vault from "./vault";

const LS_PREFIX = "privatools";

export interface Inventory {
  vault: { count: number; unreadable: number };
  assets: { count: number; bytes: number };
  counters: { count: number; activeLabel: string | null };
  defaults: { count: number; slugs: string[] };
  available: { indexedDb: boolean; webCrypto: boolean };
}

export async function inventory(): Promise<Inventory> {
  const [entries, unreadable, assetList, bytes, counterList, activeId, slugs] =
    await Promise.all([
      vault.listEntries(),
      vault.unreadableCount(),
      assets.listAssets(),
      assets.totalAssetBytes(),
      counters.listCounters(),
      counters.getActiveCounterId(),
      defaults.customizedSlugs(),
    ]);

  const active = counterList.find((c) => c.id === activeId) ?? null;

  return {
    vault: { count: entries.length, unreadable },
    assets: { count: assetList.length, bytes },
    counters: {
      count: counterList.length,
      activeLabel: active ? counters.formatNext(active) : null,
    },
    defaults: { count: slugs.length, slugs },
    available: {
      indexedDb: db.isAvailable(),
      webCrypto: (await import("./crypto")).hasWebCrypto(),
    },
  };
}

export async function exportSetup(): Promise<Blob> {
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    note:
      "Your password vault is NOT included. Its encryption key is non-extractable by design and cannot leave the device it was created on.",
    counters: await counters.listCounters(),
    activeCounterId: await counters.getActiveCounterId(),
    assets: await assets.listAssets(),
    defaults: await defaults.exportDefaults(),
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
}

/** Nuke everything this site stored on the device. */
export async function eraseEverything(): Promise<void> {
  await db.destroy();
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(LS_PREFIX)) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    /* storage disabled — nothing was persisted anyway */
  }
}
```

`frontend/src/lib/localStore/index.ts`:

```ts
export * as db from "./db";
export * as vault from "./vault";
export * as assets from "./assets";
export * as counters from "./counters";
export * as toolDefaults from "./defaults";
export { inventory, exportSetup, eraseEverything, type Inventory } from "./inventory";
export { hasWebCrypto } from "./crypto";
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/localStore/inventory.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Run the whole suite and commit**

```bash
cd frontend && npx vitest run
git add frontend/src/lib/localStore/inventory.ts frontend/src/lib/localStore/index.ts frontend/src/lib/localStore/inventory.test.ts
git commit -m "feat(localStore): inventory, vault-excluding export, erase-everything"
```

---

## Task 8: Client-side password trial

**Files:**
- Create: `frontend/src/lib/pdfPassword.ts`
- Test: `frontend/src/lib/pdfPassword.test.ts`

Pure logic, no React — the hook in Task 9 wraps it. `tryPassword` is injected so tests never load the real pdf.js worker.

- [ ] **Step 1: Write the failing test**

`frontend/src/lib/pdfPassword.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import * as db from "./localStore/db";
import * as crypt from "./localStore/crypto";
import * as vault from "./localStore/vault";
import { trialVaultPasswords } from "./pdfPassword";

beforeEach(async () => {
  await db.destroy();
  crypt._resetForTests();
});

describe("trialVaultPasswords", () => {
  it("returns notNeeded when the document opens without a password", async () => {
    const open = vi.fn().mockResolvedValue("ok");
    const res = await trialVaultPasswords(new Uint8Array([1]), open);
    expect(res).toEqual({ status: "notNeeded" });
    expect(open).toHaveBeenCalledTimes(1);
  });

  it("finds the matching password and reports how many were tried", async () => {
    await vault.addPassword("wrong", "aaa");
    await vault.addPassword("right", "bbb");
    const b = (await vault.listEntries()).find((e) => e.label === "right")!;

    const open = vi.fn(async (_data: Uint8Array, password?: string) => {
      if (!password) throw Object.assign(new Error("need"), { name: "PasswordException" });
      if (password !== "bbb") throw Object.assign(new Error("bad"), { name: "PasswordException" });
      return "ok";
    });

    const res = await trialVaultPasswords(new Uint8Array([1]), open);
    expect(res).toEqual({ status: "unlocked", password: "bbb", entryId: b.id, tried: 2 });
  });

  it("marks the winning entry as used", async () => {
    await vault.addPassword("right", "bbb");
    const open = vi.fn(async (_d: Uint8Array, password?: string) => {
      if (password !== "bbb") throw Object.assign(new Error("x"), { name: "PasswordException" });
      return "ok";
    });
    await trialVaultPasswords(new Uint8Array([1]), open);
    expect((await vault.listEntries())[0].useCount).toBe(1);
  });

  it("reports needed when no saved password fits", async () => {
    await vault.addPassword("a", "aaa");
    const open = vi.fn(async () => {
      throw Object.assign(new Error("x"), { name: "PasswordException" });
    });
    expect(await trialVaultPasswords(new Uint8Array([1]), open)).toEqual({
      status: "needed",
      tried: 1,
    });
  });

  it("reports needed with tried=0 when the vault is empty", async () => {
    const open = vi.fn(async () => {
      throw Object.assign(new Error("x"), { name: "PasswordException" });
    });
    expect(await trialVaultPasswords(new Uint8Array([1]), open)).toEqual({
      status: "needed",
      tried: 0,
    });
  });

  it("propagates a non-password error instead of masking it as needed", async () => {
    const open = vi.fn(async () => {
      throw Object.assign(new Error("corrupt"), { name: "InvalidPDFException" });
    });
    await expect(trialVaultPasswords(new Uint8Array([1]), open)).rejects.toThrow(/corrupt/);
  });

  it("never performs a network request", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await vault.addPassword("a", "aaa");
    const open = vi.fn(async (_d: Uint8Array, password?: string) => {
      if (password !== "aaa") throw Object.assign(new Error("x"), { name: "PasswordException" });
      return "ok";
    });
    await trialVaultPasswords(new Uint8Array([1]), open);
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/pdfPassword.test.ts`
Expected: FAIL — `Failed to resolve import "./pdfPassword"`.

- [ ] **Step 3: Write the implementation**

`frontend/src/lib/pdfPassword.ts`:

```ts
/**
 * Client-side PDF password trial.
 *
 * This is the security property the whole vault design rests on: candidate
 * passwords are tested locally with pdf.js, so only a password that actually
 * works is ever sent to the server — exactly what would have crossed the wire
 * if the user had typed it. Wrong candidates never leave the browser.
 *
 * If anyone ever refactors this to ask the server "does this password work?",
 * the "never performs a network request" test must fail loudly.
 *
 * Limitation: pdf.js can only trial the USER password (the one that blocks
 * opening). An OWNER password merely restricts permissions, and pdf.js opens
 * such a file with an empty user password, so it cannot verify one. Tools that
 * take an owner password offer autofill from the vault instead of a trial.
 */
import * as vault from "./localStore/vault";

/** Opens a PDF, resolving on success and throwing PasswordException otherwise. */
export type OpenPdf = (data: Uint8Array, password?: string) => Promise<unknown>;

export type TrialResult =
  | { status: "notNeeded" }
  | { status: "unlocked"; password: string; entryId: string; tried: number }
  | { status: "needed"; tried: number };

function isPasswordError(err: unknown): boolean {
  const name = (err as { name?: string } | null)?.name;
  return name === "PasswordException";
}

export async function trialVaultPasswords(
  data: Uint8Array,
  open: OpenPdf,
): Promise<TrialResult> {
  try {
    await open(data);
    return { status: "notNeeded" };
  } catch (err) {
    if (!isPasswordError(err)) throw err;
  }

  const candidates = await vault.candidatesByRecency();
  let tried = 0;

  for (const candidate of candidates) {
    tried++;
    try {
      await open(data, candidate.password);
      await vault.markUsed(candidate.id);
      return {
        status: "unlocked",
        password: candidate.password,
        entryId: candidate.id,
        tried,
      };
    } catch (err) {
      if (!isPasswordError(err)) throw err;
    }
  }

  return { status: "needed", tried };
}

/** Real pdf.js opener. Lazily imported so the worker only loads when needed. */
export async function makePdfJsOpener(): Promise<OpenPdf> {
  const pdfjsLib = await import("pdfjs-dist");
  const workerSrc = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

  return async (data: Uint8Array, password?: string) => {
    // pdf.js transfers the buffer, so hand it a copy per attempt.
    const task = pdfjsLib.getDocument({ data: data.slice(), password });
    const doc = await task.promise;
    doc.destroy();
    return doc;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/pdfPassword.test.ts`
Expected: 7 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/pdfPassword.ts frontend/src/lib/pdfPassword.test.ts
git commit -m "feat: client-side PDF password trial against the vault

Wrong candidates never leave the browser; only a working password is
sent onward. Asserted by a test that fails if a network call appears."
```

---

## Task 9: `useToolDefaults` hook

**Files:**
- Create: `frontend/src/hooks/useToolDefaults.ts`
- Test: `frontend/src/hooks/useToolDefaults.test.tsx`

Signature-identical to `useFormPersist` so per-tool adoption is a one-line change.

- [ ] **Step 1: Write the failing test**

`frontend/src/hooks/useToolDefaults.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import * as db from "@/lib/localStore/db";
import * as defaults from "@/lib/localStore/defaults";
import { useToolDefaults } from "./useToolDefaults";

const DEFAULTS = { level: "recommended", quality: 75 };

beforeEach(async () => {
  await db.destroy();
  localStorage.clear();
});

describe("useToolDefaults", () => {
  it("starts at defaults with restored=false", () => {
    const { result } = renderHook(() => useToolDefaults("compress", DEFAULTS));
    expect(result.current[0]).toEqual(DEFAULTS);
    expect(result.current[2].restored).toBe(false);
  });

  it("registers the slug once a non-default value is written", async () => {
    const { result } = renderHook(() => useToolDefaults("compress", DEFAULTS));
    act(() => result.current[1]({ level: "extreme", quality: 40 }));
    await waitFor(async () => {
      expect(await defaults.customizedSlugs()).toEqual(["compress"]);
    });
  });

  it("does not register when the value equals defaults", async () => {
    const { result } = renderHook(() => useToolDefaults("compress", DEFAULTS));
    act(() => result.current[1]({ ...DEFAULTS }));
    await new Promise((r) => setTimeout(r, 600));
    expect(await defaults.customizedSlugs()).toEqual([]);
  });

  it("rehydrates synchronously on remount", async () => {
    const first = renderHook(() => useToolDefaults("compress", DEFAULTS));
    act(() => first.result.current[1]({ level: "extreme", quality: 40 }));
    await new Promise((r) => setTimeout(r, 600));
    first.unmount();

    const second = renderHook(() => useToolDefaults("compress", DEFAULTS));
    expect(second.result.current[0]).toEqual({ level: "extreme", quality: 40 });
    expect(second.result.current[2].restored).toBe(true);
  });

  it("reset clears the value and the registration", async () => {
    const { result } = renderHook(() => useToolDefaults("compress", DEFAULTS));
    act(() => result.current[1]({ level: "extreme", quality: 40 }));
    await new Promise((r) => setTimeout(r, 600));
    await act(async () => {
      result.current[2].reset();
    });
    expect(result.current[0]).toEqual(DEFAULTS);
    await waitFor(async () => {
      expect(await defaults.customizedSlugs()).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useToolDefaults.test.tsx`
Expected: FAIL — `Failed to resolve import "./useToolDefaults"`.

- [ ] **Step 3: Write the implementation**

`frontend/src/hooks/useToolDefaults.ts`:

```ts
/**
 * useToolDefaults — remembered per-tool settings.
 *
 * Signature-identical to `useFormPersist`, so adopting it in a tool is a
 * one-line change. It adds one thing: registering the slug in the localStore
 * index so `/my-stuff` can show "6 tools customized" and clear them.
 *
 * Values stay in synchronous localStorage on purpose — see the storage-split
 * note in the 0.5 design spec. Only the index is async.
 */
import { useCallback, useEffect, useRef } from "react";
import { useFormPersist, type UseFormPersistResult } from "./useFormPersist";
import { registerCustomized, unregisterCustomized } from "@/lib/localStore/defaults";
import { shallowEqual } from "@/lib/persistence";

export function useToolDefaults<T extends Record<string, unknown>>(
  slug: string,
  defaults: T,
): [T, React.Dispatch<React.SetStateAction<T>>, UseFormPersistResult<T>] {
  const [state, setState, api] = useFormPersist<T>(slug, defaults);

  // Mirror the persistence layer's own rule: a value equal to defaults isn't
  // "customized", so it shouldn't appear in /my-stuff either.
  const lastRegistered = useRef<boolean | null>(null);
  useEffect(() => {
    const customized = !shallowEqual(
      state as Record<string, unknown>,
      defaults as Record<string, unknown>,
    );
    if (lastRegistered.current === customized) return;
    lastRegistered.current = customized;
    void (customized ? registerCustomized(slug) : unregisterCustomized(slug));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, slug]);

  const reset = useCallback(() => {
    api.reset();
    lastRegistered.current = false;
    void unregisterCustomized(slug);
  }, [api, slug]);

  return [state, setState, { ...api, reset }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/useToolDefaults.test.tsx`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useToolDefaults.ts frontend/src/hooks/useToolDefaults.test.tsx
git commit -m "feat(hooks): useToolDefaults — useFormPersist plus /my-stuff registration"
```

---

## Task 10: ESignUI signature migration

**Files:**
- Create: `frontend/src/lib/localStore/migrate.ts`
- Test: `frontend/src/lib/localStore/migrate.test.ts`
- Modify: `frontend/src/components/tool-ui/ESignUI.tsx`

- [ ] **Step 1: Write the failing test**

`frontend/src/lib/localStore/migrate.test.ts`:

```ts
import { describe, it, expect, beforeEach } from "vitest";
import * as db from "./db";
import * as assets from "./assets";
import { LEGACY_SIG_KEY, migrateLegacyKeys } from "./migrate";

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

beforeEach(async () => {
  await db.destroy();
  localStorage.clear();
});

describe("migrateLegacyKeys", () => {
  it("does nothing when there is no legacy signature", async () => {
    await migrateLegacyKeys();
    expect(await assets.listAssets("signature")).toEqual([]);
  });

  it("moves a legacy signature into the asset store and removes the raw key", async () => {
    localStorage.setItem(LEGACY_SIG_KEY, PNG_DATA_URL);
    await migrateLegacyKeys();

    const sigs = await assets.listAssets("signature");
    expect(sigs).toHaveLength(1);
    expect(sigs[0].mime).toBe("image/png");
    expect(localStorage.getItem(LEGACY_SIG_KEY)).toBeNull();
  });

  it("is idempotent", async () => {
    localStorage.setItem(LEGACY_SIG_KEY, PNG_DATA_URL);
    await migrateLegacyKeys();
    await migrateLegacyKeys();
    expect(await assets.listAssets("signature")).toHaveLength(1);
  });

  it("ignores a malformed legacy value and clears it", async () => {
    localStorage.setItem(LEGACY_SIG_KEY, "not-a-data-url");
    await migrateLegacyKeys();
    expect(await assets.listAssets("signature")).toEqual([]);
    expect(localStorage.getItem(LEGACY_SIG_KEY)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/localStore/migrate.test.ts`
Expected: FAIL — `Failed to resolve import "./migrate"`.

- [ ] **Step 3: Write the implementation**

`frontend/src/lib/localStore/migrate.ts`:

```ts
/**
 * One-way import of storage written before the localStore existed.
 *
 * ESignUI saved the user's signature as a raw data-URL under its own
 * localStorage key, bypassing the persistence layer. Move it into the typed
 * asset store so the signature is visible in /my-stuff and reusable by the
 * watermark and stamp tools, then drop the raw key.
 *
 * Safe to call on every boot: it is idempotent and cheap.
 */
import * as assets from "./assets";

export const LEGACY_SIG_KEY = "privatools_esign_signature";

function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:([^;,]+);base64,(.+)$/.exec(dataUrl);
  if (!match) return null;
  try {
    const [, mime, b64] = match;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  } catch {
    return null;
  }
}

export async function migrateLegacyKeys(): Promise<void> {
  let legacy: string | null = null;
  try {
    legacy = localStorage.getItem(LEGACY_SIG_KEY);
  } catch {
    return;
  }
  if (!legacy) return;

  const blob = dataUrlToBlob(legacy);
  if (blob && blob.size > 0 && (await assets.listAssets("signature")).length === 0) {
    try {
      await assets.putAsset("signature", "signature.png", blob);
    } catch {
      /* over quota — drop the legacy key anyway rather than retrying forever */
    }
  }

  try {
    localStorage.removeItem(LEGACY_SIG_KEY);
  } catch {
    /* storage disabled */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/localStore/migrate.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Confirm the legacy key name matches ESignUI**

Run: `cd frontend && grep -n "SIG_STORAGE_KEY" src/components/tool-ui/ESignUI.tsx`

If the constant's value differs from `privatools_esign_signature`, update `LEGACY_SIG_KEY` in `migrate.ts` to the real value and re-run the test.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/localStore/migrate.ts frontend/src/lib/localStore/migrate.test.ts
git commit -m "feat(localStore): migrate ESignUI's raw signature key into the asset store"
```

---

## Task 11: `/my-stuff` page

**Files:**
- Create: `frontend/src/pages/MyStuffPage.tsx`
- Modify: `frontend/src/App.tsx` (add the route)
- Test: `frontend/src/pages/MyStuffPage.test.tsx`

- [ ] **Step 1: Write the failing test**

`frontend/src/pages/MyStuffPage.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import * as db from "@/lib/localStore/db";
import * as crypt from "@/lib/localStore/crypto";
import * as vault from "@/lib/localStore/vault";
import * as counters from "@/lib/localStore/counters";
import MyStuffPage from "./MyStuffPage";

const renderPage = () =>
  render(
    <MemoryRouter>
      <MyStuffPage />
    </MemoryRouter>,
  );

beforeEach(async () => {
  await db.destroy();
  crypt._resetForTests();
  localStorage.clear();
});

describe("MyStuffPage", () => {
  it("shows an empty state", async () => {
    renderPage();
    expect(await screen.findByText(/nothing stored on this device/i)).toBeInTheDocument();
  });

  it("lists what is stored", async () => {
    await vault.addPassword("work docs", "hunter2");
    await counters.createCounter({ name: "Smith v. Acme", prefix: "SMITH-", next: 412 });

    renderPage();
    expect(await screen.findByText(/1 password/i)).toBeInTheDocument();
    expect(await screen.findByText("SMITH-000412")).toBeInTheDocument();
  });

  it("never renders a stored password", async () => {
    await vault.addPassword("work docs", "hunter2");
    renderPage();
    await screen.findByText(/1 password/i);
    expect(document.body.textContent).not.toContain("hunter2");
  });

  it("erases everything when confirmed", async () => {
    await vault.addPassword("work docs", "hunter2");
    renderPage();
    await screen.findByText(/1 password/i);

    await userEvent.click(screen.getByRole("button", { name: /erase everything/i }));
    await userEvent.click(await screen.findByRole("button", { name: /^yes, erase/i }));

    await waitFor(async () => {
      expect(await vault.listEntries()).toEqual([]);
    });
  });

  it("states that storage is device-local", async () => {
    renderPage();
    expect(await screen.findByText(/stored on this device only/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/MyStuffPage.test.tsx`
Expected: FAIL — `Failed to resolve import "./MyStuffPage"`.

- [ ] **Step 3: Install the user-event dependency if missing**

Run: `cd frontend && npm ls @testing-library/user-event || npm install --save-dev @testing-library/user-event`

- [ ] **Step 4: Write the implementation**

Build `frontend/src/pages/MyStuffPage.tsx` following the layout in spec §6.3. It must:

- call `inventory()` on mount and render counts for vault, assets, counters, defaults;
- render `Nothing stored on this device yet.` when every count is zero;
- render the heading `My Stuff` and the subtitle `Stored on this device only`;
- render `{n} password{s}` for the vault, and the active counter's `formatNext(...)` label;
- never render a decrypted password — reveal is a per-entry action, not part of the initial render;
- offer `Export my setup` (calls `exportSetup()` and triggers a download) with a visible note that the vault is excluded;
- offer `Erase everything`, which opens a confirmation with a `Yes, erase` button that calls `eraseEverything()` and refreshes the inventory;
- show a warning row when `inventory().vault.unreadable > 0` offering a vault purge;
- show a notice when `available.indexedDb` is false (nothing will persist) or `available.webCrypto` is false (vault unavailable);
- state plainly that the vault protects against casual access, not against a compromised page — no overclaiming.

Use the existing UI primitives in `@/components/ui/` and match the styling conventions of `PrivacyPage.tsx`.

- [ ] **Step 5: Add the route**

In `frontend/src/App.tsx`, next to the existing `/pipeline` route (line ~175), add:

```tsx
<Route path="/my-stuff" element={withRouteFallback(<MyStuffPage />)} />
```

Import it the same lazy way sibling pages are imported in that file.

- [ ] **Step 6: Mark the route noindex**

In `backend/app/seo_meta.py`, add `/my-stuff` to the same set that keeps utility routes out of the index, so it is not crawled. Verify with:

Run: `cd /Users/lakshya/projects/priva-tool/.claude/worktrees/dazzling-swartz-82749f && grep -n "noindex" backend/app/seo_meta.py | head`

- [ ] **Step 7: Run tests**

Run: `cd frontend && npx vitest run src/pages/MyStuffPage.test.tsx`
Expected: 5 passed.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/MyStuffPage.tsx frontend/src/pages/MyStuffPage.test.tsx frontend/src/App.tsx backend/app/seo_meta.py
git commit -m "feat: /my-stuff — see and erase everything stored on this device"
```

---

## Task 12: Wire the vault into UnlockUI

**Files:**
- Create: `frontend/src/hooks/usePdfPasswordTrial.ts`
- Modify: `frontend/src/components/tool-ui/UnlockUI.tsx`
- Test: `frontend/src/hooks/usePdfPasswordTrial.test.tsx`

- [ ] **Step 1: Write the failing test**

`frontend/src/hooks/usePdfPasswordTrial.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import * as db from "@/lib/localStore/db";
import * as crypt from "@/lib/localStore/crypto";
import * as vault from "@/lib/localStore/vault";
import { usePdfPasswordTrial } from "./usePdfPasswordTrial";

beforeEach(async () => {
  await db.destroy();
  crypt._resetForTests();
});

const fileOf = (bytes = [1, 2, 3]) =>
  new File([new Uint8Array(bytes)], "doc.pdf", { type: "application/pdf" });

describe("usePdfPasswordTrial", () => {
  it("starts idle", () => {
    const { result } = renderHook(() => usePdfPasswordTrial());
    expect(result.current.state.status).toBe("idle");
  });

  it("reports notNeeded for an unencrypted file", async () => {
    const open = vi.fn().mockResolvedValue("ok");
    const { result } = renderHook(() => usePdfPasswordTrial(async () => open));
    await act(async () => {
      await result.current.run(fileOf());
    });
    await waitFor(() => expect(result.current.state.status).toBe("notNeeded"));
  });

  it("surfaces a visible trying state, then unlocked", async () => {
    await vault.addPassword("a", "pw");
    const seen: string[] = [];
    const open = vi.fn(async (_d: Uint8Array, password?: string) => {
      if (password !== "pw") throw Object.assign(new Error("x"), { name: "PasswordException" });
      return "ok";
    });
    const { result } = renderHook(() => usePdfPasswordTrial(async () => open));
    await act(async () => {
      const p = result.current.run(fileOf());
      seen.push(result.current.state.status);
      await p;
    });
    await waitFor(() => expect(result.current.state.status).toBe("unlocked"));
    expect(seen).toContain("trying");
    if (result.current.state.status === "unlocked") {
      expect(result.current.state.password).toBe("pw");
    }
  });

  it("reports needed when nothing fits", async () => {
    await vault.addPassword("a", "nope");
    const open = vi.fn(async () => {
      throw Object.assign(new Error("x"), { name: "PasswordException" });
    });
    const { result } = renderHook(() => usePdfPasswordTrial(async () => open));
    await act(async () => {
      await result.current.run(fileOf());
    });
    await waitFor(() => expect(result.current.state.status).toBe("needed"));
  });

  it("resets back to idle", async () => {
    const open = vi.fn().mockResolvedValue("ok");
    const { result } = renderHook(() => usePdfPasswordTrial(async () => open));
    await act(async () => {
      await result.current.run(fileOf());
    });
    act(() => result.current.reset());
    expect(result.current.state.status).toBe("idle");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/usePdfPasswordTrial.test.tsx`
Expected: FAIL — `Failed to resolve import "./usePdfPasswordTrial"`.

- [ ] **Step 3: Write the implementation**

`frontend/src/hooks/usePdfPasswordTrial.ts`:

```ts
/**
 * React wrapper around trialVaultPasswords.
 *
 * The `trying` state is intentionally observable: the user always sees that
 * stored credentials were used, rather than passwords being applied invisibly.
 */
import { useCallback, useState } from "react";
import {
  makePdfJsOpener,
  trialVaultPasswords,
  type OpenPdf,
} from "@/lib/pdfPassword";

export type TrialState =
  | { status: "idle" }
  | { status: "trying"; total: number }
  | { status: "notNeeded" }
  | { status: "unlocked"; password: string; entryId: string; tried: number }
  | { status: "needed"; tried: number }
  | { status: "error"; message: string };

export function usePdfPasswordTrial(makeOpener: () => Promise<OpenPdf> = makePdfJsOpener) {
  const [state, setState] = useState<TrialState>({ status: "idle" });

  const run = useCallback(
    async (file: File) => {
      setState({ status: "trying", total: 0 });
      try {
        const data = new Uint8Array(await file.arrayBuffer());
        const open = await makeOpener();
        const result = await trialVaultPasswords(data, open);
        setState(result as TrialState);
        return result;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Could not read that PDF.";
        setState({ status: "error", message });
        return { status: "error" as const, message };
      }
    },
    [makeOpener],
  );

  const reset = useCallback(() => setState({ status: "idle" }), []);

  return { state, run, reset };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/usePdfPasswordTrial.test.tsx`
Expected: 5 passed.

- [ ] **Step 5: Wire it into UnlockUI**

In `frontend/src/components/tool-ui/UnlockUI.tsx`, when a file is selected:

1. call `run(file)`;
2. while `state.status === "trying"`, render `Encrypted PDF — trying your saved passwords…`;
3. on `unlocked`, prefill the password field with `state.password` and show `Unlocked with a saved password`;
4. on `needed`, leave the field empty and show `None of your saved passwords fit — enter one below`;
5. after a successful unlock with a password the user typed, show a `Save this password?` control that calls `vault.addPassword(label, password)`;
6. on `notNeeded`, behave exactly as today.

- [ ] **Step 6: Run the full suite**

Run: `cd frontend && npx vitest run`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/hooks/usePdfPasswordTrial.ts frontend/src/hooks/usePdfPasswordTrial.test.tsx frontend/src/components/tool-ui/UnlockUI.tsx
git commit -m "feat(unlock): try saved passwords locally before prompting"
```

---

## Task 13: Vault autofill for ProtectUI and PermissionsUI

**Files:**
- Modify: `frontend/src/components/tool-ui/ProtectUI.tsx`
- Modify: `frontend/src/components/tool-ui/PermissionsUI.tsx`
- Create: `frontend/src/components/VaultPasswordPicker.tsx`
- Test: `frontend/src/components/VaultPasswordPicker.test.tsx`

These take an **owner** password, which pdf.js cannot verify, so they get autofill rather than a trial.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/VaultPasswordPicker.test.tsx`:

```tsx
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as db from "@/lib/localStore/db";
import * as crypt from "@/lib/localStore/crypto";
import * as vault from "@/lib/localStore/vault";
import { VaultPasswordPicker } from "./VaultPasswordPicker";

beforeEach(async () => {
  await db.destroy();
  crypt._resetForTests();
});

describe("VaultPasswordPicker", () => {
  it("renders nothing when the vault is empty", async () => {
    const { container } = render(<VaultPasswordPicker onPick={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("lists labels but never passwords", async () => {
    await vault.addPassword("work docs", "hunter2");
    render(<VaultPasswordPicker onPick={vi.fn()} />);
    expect(await screen.findByText("work docs")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("hunter2");
  });

  it("passes the decrypted password to onPick only when chosen", async () => {
    await vault.addPassword("work docs", "hunter2");
    const onPick = vi.fn();
    render(<VaultPasswordPicker onPick={onPick} />);
    await userEvent.click(await screen.findByText("work docs"));
    expect(onPick).toHaveBeenCalledWith("hunter2");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/VaultPasswordPicker.test.tsx`
Expected: FAIL — `Failed to resolve import "./VaultPasswordPicker"`.

- [ ] **Step 3: Write the implementation**

`frontend/src/components/VaultPasswordPicker.tsx`:

```tsx
/**
 * Pick a saved password by label.
 *
 * Used by tools that take an OWNER password. pdf.js cannot verify an owner
 * password (it opens such files with an empty user password), so these tools
 * offer autofill rather than the automatic trial UnlockUI gets. The UI says so
 * instead of silently behaving differently.
 *
 * Renders nothing when the vault is empty — no empty-state noise on a tool page.
 */
import { useEffect, useState } from "react";
import * as vault from "@/lib/localStore/vault";

export function VaultPasswordPicker({ onPick }: { onPick: (password: string) => void }) {
  const [entries, setEntries] = useState<vault.VaultEntryMeta[]>([]);

  useEffect(() => {
    let alive = true;
    void vault.listEntries().then((e) => {
      if (alive) setEntries(e);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (entries.length === 0) return null;

  return (
    <div className="mt-2 text-sm">
      <span className="text-muted-foreground">Use a saved password: </span>
      {entries.map((e) => (
        <button
          key={e.id}
          type="button"
          className="mr-2 underline underline-offset-2 hover:text-accent"
          onClick={async () => onPick(await vault.revealPassword(e.id))}
        >
          {e.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/VaultPasswordPicker.test.tsx`
Expected: 3 passed.

- [ ] **Step 5: Mount it in both tools**

In `ProtectUI.tsx` and `PermissionsUI.tsx`, render `<VaultPasswordPicker onPick={setPassword} />` directly beneath the password input, and add a "Save this password" control after a successful run that calls `vault.addPassword(label, password)`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/VaultPasswordPicker.tsx frontend/src/components/VaultPasswordPicker.test.tsx frontend/src/components/tool-ui/ProtectUI.tsx frontend/src/components/tool-ui/PermissionsUI.tsx
git commit -m "feat(protect,permissions): autofill owner passwords from the vault"
```

---

## Task 14: Named counters in BatesUI

**Files:**
- Modify: `frontend/src/components/tool-ui/BatesUI.tsx`
- Test: `frontend/src/components/tool-ui/BatesUI.counters.test.tsx`

`BatesUI` currently uses `useFormPersist("bates", BATES_DEFAULTS)` with `{prefix, startNumber, digits, position}` and documents a multi-file caveat: each PDF restarts at `start_number`. Named counters fix the cross-session half of that.

- [ ] **Step 1: Write the failing test**

`frontend/src/components/tool-ui/BatesUI.counters.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import * as db from "@/lib/localStore/db";
import * as counters from "@/lib/localStore/counters";
import { BatesUI } from "./BatesUI";

beforeEach(async () => {
  await db.destroy();
  localStorage.clear();
});

describe("BatesUI counters", () => {
  it("offers to create a counter when none exist", async () => {
    render(<BatesUI />);
    expect(await screen.findByText(/new matter/i)).toBeInTheDocument();
  });

  it("shows the active counter's next number", async () => {
    await counters.createCounter({ name: "Smith v. Acme", prefix: "SMITH-", next: 412 });
    render(<BatesUI />);
    expect(await screen.findByText("SMITH-000412")).toBeInTheDocument();
  });

  it("seeds the form from the active counter", async () => {
    await counters.createCounter({
      name: "Smith v. Acme", prefix: "SMITH-", digits: 6, next: 412, position: "top-left",
    });
    render(<BatesUI />);
    const prefix = (await screen.findByLabelText(/prefix/i)) as HTMLInputElement;
    expect(prefix.value).toBe("SMITH-");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/tool-ui/BatesUI.counters.test.tsx`
Expected: FAIL — no counter UI rendered.

- [ ] **Step 3: Implement**

In `BatesUI.tsx`:

1. load `listCounters()` and `getActiveCounterId()` on mount;
2. render a matter selector above the settings — each counter shows `name` and `formatNext(counter)`; include a `New matter` action that calls `createCounter({ name })`;
3. when a counter is active, seed `prefix`, `digits`, `position`, and `startNumber` (from `counter.next`) into the existing `config` state, and persist edits back via `updateCounter`;
4. give the prefix input an accessible label (`<label htmlFor>` or `aria-label="Prefix"`) so the test can find it;
5. **after a confirmed successful stamp**, call `advanceCounter(activeId, pagesStamped)` — never before, and never on failure. Take the page count from the response metadata or the pdf.js document already opened for the preview;
6. keep `useFormPersist` for the no-counter case so behaviour is unchanged for users who never create one.

- [ ] **Step 4: Run tests**

Run: `cd frontend && npx vitest run src/components/tool-ui/BatesUI.counters.test.tsx`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/tool-ui/BatesUI.tsx frontend/src/components/tool-ui/BatesUI.counters.test.tsx
git commit -m "feat(bates): named per-matter counters that continue across sessions"
```

---

## Task 15: Asset library in ESignUI, WatermarkUI, StampUI, HeaderFooterUI

**Files:**
- Create: `frontend/src/hooks/useAsset.ts`
- Modify: `frontend/src/components/tool-ui/ESignUI.tsx`
- Modify: `frontend/src/components/tool-ui/WatermarkUI.tsx`, `StampUI.tsx`, `HeaderFooterUI.tsx`
- Test: `frontend/src/hooks/useAsset.test.tsx`

- [ ] **Step 1: Write the failing test**

`frontend/src/hooks/useAsset.test.tsx`:

```tsx
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import * as db from "@/lib/localStore/db";
import { useAsset } from "./useAsset";

beforeEach(async () => {
  await db.destroy();
});

describe("useAsset", () => {
  it("starts empty", async () => {
    const { result } = renderHook(() => useAsset("logo"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
  });

  it("saves and lists an asset", async () => {
    const { result } = renderHook(() => useAsset("logo"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.save("l.png", new Blob([new Uint8Array(8)], { type: "image/png" }));
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0].name).toBe("l.png");
  });

  it("surfaces a quota error instead of throwing", async () => {
    const { result } = renderHook(() => useAsset("logo"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.save("big.png", new Blob([new Uint8Array(6 * 1024 * 1024)]));
    });
    await waitFor(() => expect(result.current.error).toMatch(/too large/i));
    expect(result.current.items).toEqual([]);
  });

  it("removes an asset", async () => {
    const { result } = renderHook(() => useAsset("logo"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.save("l.png", new Blob([new Uint8Array(8)]));
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.remove(result.current.items[0].id);
    });
    await waitFor(() => expect(result.current.items).toEqual([]));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useAsset.test.tsx`
Expected: FAIL — `Failed to resolve import "./useAsset"`.

- [ ] **Step 3: Write the implementation**

`frontend/src/hooks/useAsset.ts`:

```ts
/**
 * Read/write assets of one kind from a tool UI.
 *
 * Quota failures surface as `error` text rather than a thrown exception —
 * running out of storage should tell the user what happened, not blow up the
 * tool page mid-interaction.
 */
import { useCallback, useEffect, useState } from "react";
import * as assets from "@/lib/localStore/assets";

export function useAsset(kind: assets.AssetKind) {
  const [items, setItems] = useState<assets.AssetMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setItems(await assets.listAssets(kind));
    setLoading(false);
  }, [kind]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const save = useCallback(
    async (name: string, blob: Blob) => {
      setError(null);
      try {
        await assets.putAsset(kind, name, blob);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save that file.");
      }
    },
    [kind, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await assets.deleteAsset(id);
      await refresh();
    },
    [refresh],
  );

  const blobOf = useCallback((id: string) => assets.getAssetBlob(id), []);

  return { items, loading, error, save, remove, blobOf, refresh };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/useAsset.test.tsx`
Expected: 4 passed.

- [ ] **Step 5: Adopt in the four tools**

- `ESignUI.tsx`: replace the raw `SIG_STORAGE_KEY` read/write with `useAsset("signature")`. Call `migrateLegacyKeys()` once on mount so an existing signature carries over. Keep the auto-apply behaviour.
- `WatermarkUI.tsx`: add `useAsset("watermark")` with a "use saved image" picker and a "save this image" action.
- `StampUI.tsx`: same with `useAsset("stamp")`, plus read access to `logo`.
- `HeaderFooterUI.tsx`: `useAsset("letterhead")` and `useAsset("logo")`.

- [ ] **Step 6: Run the full suite and commit**

```bash
cd frontend && npx vitest run
git add frontend/src/hooks/useAsset.ts frontend/src/hooks/useAsset.test.tsx frontend/src/components/tool-ui/ESignUI.tsx frontend/src/components/tool-ui/WatermarkUI.tsx frontend/src/components/tool-ui/StampUI.tsx frontend/src/components/tool-ui/HeaderFooterUI.tsx
git commit -m "feat(assets): shared signature/logo/watermark/letterhead library"
```

---

## Task 16+: The 104-tool defaults sweep

**Do not attempt in one pass.** Work in groups of 8–12 tools, running `npx vitest run` and `npx tsc --noEmit` between groups, committing per group.

### Per-tool recipe

**Case A — the tool already uses `useFormPersist`** (6 tools: confirm with `grep -rl useFormPersist src/components/tool-ui`).

Change the import and the call:

```diff
-import { useFormPersist } from "@/hooks/useFormPersist";
+import { useToolDefaults } from "@/hooks/useToolDefaults";

-const [config, setConfig, { restored, reset }] = useFormPersist("bates", BATES_DEFAULTS);
+const [config, setConfig, { restored, reset }] = useToolDefaults("bates", BATES_DEFAULTS);
```

Nothing else changes — the signatures are identical.

**Case B — the tool holds config in plain `useState`.**

1. Collect the tool's settings into one defaults object at module scope:

```ts
const COMPRESS_DEFAULTS = { level: "recommended", quality: 75 };
```

2. Replace the individual `useState` calls with one `useToolDefaults` call, using the tool's registry slug (from `src/data/tools.ts`) as the key:

```ts
const [config, setConfig, { restored, reset }] = useToolDefaults("compress-pdf", COMPRESS_DEFAULTS);
const { level, quality } = config;
const setLevel = (v: string) => setConfig((c) => ({ ...c, level: v }));
const setQuality = (v: number) => setConfig((c) => ({ ...c, quality: v }));
```

3. Add a reset control next to the settings, following `BatesUI`'s existing pattern:

```tsx
<button type="button" onClick={reset} className="text-xs text-muted-foreground hover:text-foreground">
  Reset to defaults
</button>
```

4. If the tool should surface the restore toast, copy `BatesUI`'s effect verbatim:

```tsx
useEffect(() => {
  if (restored) toast.message("Restored previous settings", { description: "Picked up where you left off.", duration: 3000 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);
```

**Never persist:** uploaded files, output blobs, passwords (they belong in the vault), or anything derived from document content. Only user-chosen settings.

### Slug rule

The key must be the tool's registry slug so `/my-stuff` can map it back to a display name. Verify each against `src/data/tools.ts` / `src/data/non-pdf-tools.ts`; a typo produces an orphan entry in `/my-stuff` that maps to no tool.

### Per-group verification

```bash
cd frontend && npx vitest run && npx tsc --noEmit && npm run lint
```

### Group commit

```bash
git add frontend/src/components/tool-ui/
git commit -m "feat(defaults): remember settings for <group name> tools"
```

### Final step for the sweep

Add a test asserting every registered slug maps to a real tool:

`frontend/src/test/tool-defaults-slugs.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { ALL_TOOLS } from "@/data/tools";

describe("useToolDefaults slugs", () => {
  it("every slug passed to useToolDefaults is a real tool slug", () => {
    const dir = join(process.cwd(), "src/components/tool-ui");
    const known = new Set(ALL_TOOLS.map((t) => t.slug));
    const bad: string[] = [];
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".tsx"))) {
      const src = readFileSync(join(dir, f), "utf8");
      for (const m of src.matchAll(/useToolDefaults\(\s*["'`]([^"'`]+)["'`]/g)) {
        if (!known.has(m[1])) bad.push(`${f}: ${m[1]}`);
      }
    }
    expect(bad).toEqual([]);
  });
});
```

Confirm the export name `ALL_TOOLS` against `src/data/tools.ts` before writing this test; if it differs, use the real export.

---

## Self-review

**Spec coverage:**

| Spec section | Task |
|---|---|
| §3 `localStore` foundation | 1, 2, 7 |
| §3 storage-split deviation | 0 (spec amended) |
| §4 vault + client-side trial | 3, 8, 12 |
| §4 owner-password limitation | 13 |
| §5 named Bates counters | 4, 14 |
| §6.1 asset library + ESign migration | 5, 10, 15 |
| §6.2 per-tool defaults (all 104) | 6, 9, 16+ |
| §6.3 `/my-stuff` + export + erase | 7, 11 |
| §8 test environment | 0 |
| §8 "no network during trial" | 8 |
| §9 degradation risks | 1 (in-memory), 2 (`hasWebCrypto`), 11 (notices) |

No spec requirement is unassigned.

**Type consistency:** `VaultEntryMeta` (3) is what `listEntries` returns and what `VaultPasswordPicker` (13) consumes. `AssetMeta`/`AssetKind` (5) are used by `useAsset` (15) and `inventory` (7). `BatesCounter`/`formatNext` (4) are used by `inventory` (7), `MyStuffPage` (11), and `BatesUI` (14). `OpenPdf`/`TrialResult` (8) feed `usePdfPasswordTrial` (12). `UseFormPersistResult<T>` (existing) is re-exported through `useToolDefaults` (9). All consistent.

**Placeholder scan:** every code step contains complete code. Tasks 11, 12, 13, 14, 15 step 5 describe UI integration as explicit numbered requirements against named existing files rather than pasted JSX, because those files are 200–600 lines of existing markup that must be read before editing — the requirements are specific and testable, and each has a failing test written first.
