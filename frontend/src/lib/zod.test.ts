/**
 * The production CSP has no 'unsafe-eval'. Zod 4 finds out whether it may
 * compile parsers by trying `new Function("")` when the first object schema
 * is built, and the browser reports that refused try as a script-src
 * violation: on every page, because the account panel's schemas load with
 * the app. Schemas here come through lib/zod.ts, which turns that off before
 * any schema exists. Nothing else in this file may import zod, or it would be
 * loaded before the count starts.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllGlobals());

const activity = {
    retention_days: 7, recent_limit: 50, resets_at: "2026-09-15T00:00:00Z",
    keys: [{ key_id: "a", label: "Workflow a", revoked: false, units: { used: 2, limit: 500, remaining: 498 }, bytes: { used: 1024, limit: 262144000 } }],
    days: [{ date: "2026-09-14", requests: 3, succeeded: 2, failed: 1, avg_duration_ms: 250 }],
    recent: [{ request_id: "request-123", key_id: "a", operation: "v1_post_jobs", method: "POST", status_code: 202, error_code: null, duration_ms: 125, created_at: "2026-09-14T12:00:00Z" }],
};

describe("zod under the production CSP", () => {
    it("never builds a function from a string, and still validates", async () => {
        const built: unknown[][] = [];
        vi.stubGlobal("Function", new Proxy(Function, {
            construct: (target, args, newTarget) => { built.push(args); return Reflect.construct(target, args, newTarget); },
            apply: (target, self, args) => { built.push(args); return Reflect.apply(target, self, args); },
        }));
        const { apiActivitySchema } = await import("@/lib/api-activity");

        expect(apiActivitySchema.safeParse(activity).success).toBe(true);
        expect(apiActivitySchema.safeParse({ ...activity, retention_days: 8 }).success).toBe(false);
        const refused = apiActivitySchema.safeParse({ ...activity, recent: [{ ...activity.recent[0], status_code: 700 }] });
        expect(refused.success).toBe(false);
        expect(refused.error?.issues[0].path).toEqual(["recent", 0, "status_code"]);
        expect(built).toEqual([]);
    });
});
