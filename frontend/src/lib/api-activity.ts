import { z } from "@/lib/zod";

const count = z.number().finite().int().nonnegative();
const duration = z.number().finite().nonnegative();
const identifier = z.string().max(160);
const timestamp = z.string().max(40).refine(value => Number.isFinite(Date.parse(value)));
const activityKey = z.object({
    key_id: identifier, label: z.string().max(64), revoked: z.boolean(),
    units: z.object({ used: count, limit: count, remaining: count }),
    bytes: z.object({ used: count, limit: count }),
});
export const apiActivitySchema = z.object({
    retention_days: z.literal(7), recent_limit: z.literal(50), resets_at: timestamp,
    keys: z.array(activityKey),
    days: z.array(z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), requests: count, succeeded: count, failed: count, avg_duration_ms: duration })).max(7),
    recent: z.array(z.object({ request_id: identifier, key_id: identifier, operation: identifier, method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]), status_code: z.number().int().min(100).max(599), error_code: z.string().max(80).nullable(), duration_ms: duration, created_at: timestamp })).max(50),
});

export type ApiActivityData = z.infer<typeof apiActivitySchema>;
export type ActivityKey = z.infer<typeof activityKey>;
