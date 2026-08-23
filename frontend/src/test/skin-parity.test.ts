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

    it("every ported skin with an extension list has the file to back it", () => {
        for (const skin of SKINS) {
            // Signature is not a ported design — it is this app's own React
            // routes, so it delivers extra surfaces as pages rather than
            // through the generator seam and has no extensions file.
            if (skin === "signature") continue;
            if (EXTENSION_SURFACES[skin].length === 0) continue;
            const file = resolve(__dirname, `../skins/extensions/${skin}.tsx`);
            expect(existsSync(file), `${skin} declares extension surfaces but ${file} does not exist`).toBe(true);
        }
    });

    it("signature's extra surfaces exist as real routed pages", () => {
        // The parity manifest is only as good as the files behind it.
        for (const page of ["AccountPage", "VaultPage", "StatusPage", "SupportPage"]) {
            const file = resolve(__dirname, `../pages/${page}.tsx`);
            expect(existsSync(file), `${page}.tsx is missing`).toBe(true);
        }
        const app = readFileSync(resolve(__dirname, "../App.tsx"), "utf8");
        for (const path of ["/account", "/account/keys", "/my-stuff/vault", "/status", "/support"]) {
            expect(app, `App.tsx has no route for ${path}`).toContain(`path="${path}"`);
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

/**
 * Parity of *capability*, not just of route.
 *
 * The manifest above tracks surfaces — "does this skin have an account page".
 * That passed for months while all three ported skins had an account page that
 * threw the recovery code away, which is the only way back into an account
 * when there is no reset email. A surface can exist and still be missing the
 * thing that makes it worth having, so the parts that matter are named here.
 */
describe("account capability parity", () => {
    const IMPORTED = SKINS.filter((s) => s !== "signature");

    // Each is a binding the markup must reference for the capability to exist.
    const REQUIRED = [
        ["shows the recovery code at signup", "acctRecoveryCode"],
        ["lets the visitor copy it", "acctCopyRecovery"],
        ["makes them acknowledge it", "acctAckRecovery"],
        ["offers a way to redeem one", "acctShowRecover"],
        ["takes the code as input", "acctRecoveryInput"],
        ["lets it be saved to a file", "acctDownloadRecovery"],
        ["can replace a mislaid code", "acctToggleRotate"],
        ["asks for the password before doing so", "acctSetRotatePassword"],
    ];

    for (const skin of IMPORTED) {
        const file = resolve(__dirname, `../skins/extensions/${skin}.html`);
        for (const [what, binding] of REQUIRED) {
            it(`${skin} ${what}`, () => {
                expect(existsSync(file)).toBe(true);
                expect(readFileSync(file, "utf8")).toContain(binding);
            });
        }
    }

    it("rotating a code is gated on the password, not the session alone", () => {
        // A stolen cookie must not mint a code the thief keeps — one that
        // outlives the owner noticing and changing their password.
        const src = readFileSync(resolve(__dirname, "../../../backend/app/routes/accounts.py"), "utf8");
        const route = src.slice(src.indexOf('@router.post("/auth/recovery-code")'));
        const body = route.slice(0, route.indexOf("@router.get"));
        expect(body).toContain("current_password");
        expect(body).toContain("hashing_pool.verify");
    });

    it("the mixin keeps the code the register call returns", () => {
        // `_acctSubmit` used to destructure `{ user }` and drop recovery_code.
        const src = readFileSync(resolve(__dirname, "../skins/withAccounts.tsx"), "utf8");
        expect(src).toContain("recovery_code");
    });
});
