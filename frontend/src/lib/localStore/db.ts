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
