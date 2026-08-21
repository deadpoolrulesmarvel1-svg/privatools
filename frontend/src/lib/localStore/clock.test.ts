import { describe, it, expect, beforeEach } from "vitest";
import { monotonicNow, _resetClockForTests } from "./clock";

beforeEach(() => {
  _resetClockForTests();
});

describe("monotonicNow", () => {
  it("never returns the same value twice", () => {
    const seen = new Set<number>();
    for (let i = 0; i < 1000; i++) seen.add(monotonicNow());
    expect(seen.size).toBe(1000);
  });

  it("returns strictly increasing values", () => {
    const values = Array.from({ length: 500 }, () => monotonicNow());
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeGreaterThan(values[i - 1]);
    }
  });

  it("stays anchored to wall-clock time", () => {
    const before = Date.now();
    const t = monotonicNow();
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThan(before + 1000);
  });
});
