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
import { monotonicNow } from "./clock";

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

function isCounter(v: unknown): v is BatesCounter {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as BatesCounter).next === "number" &&
    typeof (v as BatesCounter).id === "string"
  );
}

export async function listCounters(): Promise<BatesCounter[]> {
  // The `kv` store also holds the active-counter id (a string) and the
  // customized-slug index (an array), so filter by shape rather than assuming
  // every value is a counter.
  const all = await db.values<unknown>("kv");
  return all.filter(isCounter).sort((a, b) => b.updatedAt - a.updatedAt);
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
    updatedAt: monotonicNow(),
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
  const updated: BatesCounter = { ...existing, ...patch, id, updatedAt: monotonicNow() };
  await db.put("kv", key(id), updated);
  return updated;
}

/**
 * Move past a CONFIRMED successful stamp of `pages` pages numbered from
 * `start`. Never call optimistically. The counter goes to where that stamp
 * stopped, so it never issues those numbers again, and never moves back: a
 * stamp that started below it (a replacement page, say) leaves it where it is.
 */
export async function advanceCounter(id: string, start: number, pages: number): Promise<BatesCounter> {
  if (!Number.isFinite(pages) || pages <= 0) {
    throw new Error("pages must be a positive number");
  }
  if (!Number.isFinite(start)) throw new Error("start must be a number");
  const existing = await getCounter(id);
  if (!existing) throw new Error("No such counter");
  return updateCounter(id, { next: Math.max(existing.next, Math.floor(start) + Math.floor(pages)) });
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
