import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
    FEATURES, FEATURE_IDS, NATIVE_SURFACES, EXTENSION_SURFACES, PENDING, coveredBy,
} from "@/skins/features";
import { SKIN_IDS } from "@/lib/skins";

/**
 * Feature parity across skins.
 *
 * The standing requirement is that no theme offers less than another. This is
 * the guard that makes that enforceable instead of aspirational: a feature that
 * goes missing from one skin fails the build, unless it is explicitly recorded
 * in PENDING as work not yet done.
 */

const SKINS = [...SKIN_IDS];

describe("feature manifest", () => {
    it("has no duplicate ids", () => {
        expect(new Set(FEATURE_IDS).size).toBe(FEATURE_IDS.length);
    });

    it("gives every feature a path and a reason it must exist", () => {
        for (const f of FEATURES) {
            expect(f.path.startsWith("/"), `${f.id} path`).toBe(true);
            expect(f.why.length, `${f.id} why`).toBeGreaterThan(0);
        }
    });

    it("covers every skin", () => {
        expect(Object.keys(NATIVE_SURFACES).sort()).toEqual(SKINS.slice().sort());
        expect(Object.keys(EXTENSION_SURFACES).sort()).toEqual(SKINS.slice().sort());
        expect(Object.keys(PENDING).sort()).toEqual(SKINS.slice().sort());
    });

    it("only names real features", () => {
        for (const skin of SKINS) {
            for (const list of [NATIVE_SURFACES[skin], EXTENSION_SURFACES[skin], PENDING[skin]]) {
                for (const id of list) {
                    expect(FEATURE_IDS, `${skin} names unknown feature "${id}"`).toContain(id);
                }
            }
        }
    });

    it("never lists a feature as both delivered and pending", () => {
        for (const skin of SKINS) {
            const overlap = PENDING[skin].filter((id) => coveredBy(skin).has(id));
            expect(overlap, `${skin} claims to both have and lack: ${overlap.join(", ")}`).toEqual([]);
        }
    });
});

describe("parity", () => {
    for (const skin of SKINS) {
        it(`${skin} reaches every feature, or records the gap`, () => {
            const covered = coveredBy(skin);
            const pending = new Set(PENDING[skin]);
            const unaccounted = FEATURE_IDS.filter((id) => !covered.has(id) && !pending.has(id));
            expect(
                unaccounted,
                `${skin} is missing ${unaccounted.join(", ")} and has not recorded them as pending. ` +
                `Every theme must offer the same features — add the surface, or add it to PENDING.`,
            ).toEqual([]);
        });
    }

    it("every skin with an extension list has the file to back it", () => {
        for (const skin of SKINS) {
            if (EXTENSION_SURFACES[skin].length === 0) continue;
            const file = resolve(__dirname, `../skins/extensions/${skin}.tsx`);
            expect(existsSync(file), `${skin} declares extension surfaces but ${file} does not exist`).toBe(true);
        }
    });
});

describe("outstanding work", () => {
    it("reports what is still missing", () => {
        const summary = SKINS.map((s) => `${s}: ${PENDING[s].length}`).join("  ");
        // Not an assertion — this keeps the remaining gap visible in test output
        // rather than buried in a file nobody opens.
        expect(summary.length).toBeGreaterThan(0);
        console.log(`  parity gaps —  ${summary}`);
    });
});
