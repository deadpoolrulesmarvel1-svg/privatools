import { describe, expect, it } from "vitest";
import { costFor, formatCost, parseAmount } from "./cost";

describe("cost from a price per million tokens", () => {
    it("is the tokens times the price, over a million", () => {
        expect(costFor(1_000_000, 2.5)).toBe(2.5);
        expect(costFor(2_000_000, 0.15)).toBeCloseTo(0.3, 12);
        expect(costFor(1234, 2)).toBeCloseTo(0.002468, 12);
        expect(costFor(0, 15)).toBe(0);
        expect(costFor(500, 0)).toBe(0);
    });

    it("reads prices and counts as people type them", () => {
        expect(parseAmount("2.50")).toBe(2.5);
        expect(parseAmount(" 3 ")).toBe(3);
        expect(parseAmount(".75")).toBe(0.75);
        expect(parseAmount("0")).toBe(0);
        for (const bad of ["", "  ", "-1", "abc", "Infinity", "NaN", "1,5"]) expect(parseAmount(bad), bad).toBeNull();
    });

    it("shows small amounts without rounding them to nothing", () => {
        expect(formatCost(0)).toBe("$0.00");
        expect(formatCost(0.002468)).toBe("$0.00247");
        expect(formatCost(0.0000003)).toBe("$0.0000003");
        expect(formatCost(0.05)).toBe("$0.05");
        expect(formatCost(0.012345)).toBe("$0.0123");
        expect(formatCost(1.5)).toBe("$1.50");
        expect(formatCost(1234.5)).toBe("$1,234.50");
    });
});
