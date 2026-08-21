/**
 * Index of which tool slugs have customized defaults.
 *
 * The values live in `lib/persistence.ts` (synchronous localStorage) so tools
 * hydrate without a first-paint flicker — see the storage-split note in the 0.5
 * design spec. Only the index lives here, so `/my-stuff` can answer "which
 * tools have I customized?" and clear them.
 */
import * as db from "./db";
import { clearPersisted, loadPersisted } from "@/lib/persistence";

const INDEX_KEY = "defaults:slugs";

export async function customizedSlugs(): Promise<string[]> {
  const raw = await db.get<string[]>("kv", INDEX_KEY);
  return Array.isArray(raw) ? raw : [];
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
