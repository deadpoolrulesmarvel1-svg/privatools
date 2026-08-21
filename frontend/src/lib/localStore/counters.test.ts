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
    const c = await counters.createCounter({
      name: "M",
      prefix: "SMITH-",
      digits: 6,
      next: 412,
    });
    expect(counters.formatNext(c)).toBe("SMITH-000412");
  });
});
