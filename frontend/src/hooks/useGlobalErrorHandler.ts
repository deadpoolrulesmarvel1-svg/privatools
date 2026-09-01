/**
 * useGlobalErrorHandler — surface unhandled JS errors and Promise rejections
 * as a Sonner toast with a "Copy details" action.
 *
 * Without this, a thrown error inside an event handler or an unawaited
 * promise rejection silently logs to the console and the user sees nothing.
 * That's terrifying — the page just stops responding with no explanation.
 *
 * Throttled to one toast per ~2 seconds so a runaway loop of errors doesn't
 * spam the screen. The latest error message wins.
 *
 * We deliberately skip:
 *   - ResizeObserver loop noise ("ResizeObserver loop completed with
 *     undelivered notifications") — known benign Chrome quirk.
 *   - Script-load errors from third-party scripts (cross-origin, masked as
 *     "Script error.") — nothing we can do, and the message is unhelpful.
 *   - AbortError — these come from user-initiated cancels; tooling captures
 *     them where it cares.
 */
import { useEffect } from "react";
import { toast } from "sonner";
import { formatErrorForClipboard } from "@/lib/api";

const TOAST_THROTTLE_MS = 2000;

function isNoiseError(message: string): boolean {
    if (!message) return true;
    const m = message.toLowerCase();
    if (m.includes("resizeobserver loop")) return true;
    if (m === "script error.") return true;
    if (m.includes("aborterror")) return true;
    // clerk-js blocked by an extension. The account page states this inline,
    // with the one action that fixes it; a raw "failed to load script" toast
    // on every page load says nothing a visitor can act on.
    if (m.includes("failed to load clerk")) return true;
    return false;
}

export function useGlobalErrorHandler(): void {
    useEffect(() => {
        let lastShownAt = 0;

        const surface = (err: unknown, message: string, source?: string) => {
            const now = Date.now();
            if (now - lastShownAt < TOAST_THROTTLE_MS) return;
            if (isNoiseError(message)) return;
            lastShownAt = now;

            const summary = message.length > 90 ? message.slice(0, 87) + "…" : message;
            toast.error("Something went wrong", {
                description: summary || "Press 'Copy details' to capture the full error.",
                duration: 8000,
                action: {
                    label: "Copy details",
                    onClick: () => {
                        const blob = formatErrorForClipboard(err, source ?? "Global error");
                        navigator.clipboard?.writeText(blob)
                            .then(() => toast.success("Copied"))
                            .catch(() => toast.error("Couldn't access clipboard"));
                    },
                },
            });
        };

        const onError = (event: ErrorEvent) => {
            const err = event.error ?? new Error(event.message);
            surface(err, event.message || (err instanceof Error ? err.message : String(err)), event.filename);
        };

        const onUnhandledRejection = (event: PromiseRejectionEvent) => {
            const reason = event.reason;
            const msg = reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "Unhandled promise rejection";
            surface(reason, msg, "unhandledrejection");
        };

        window.addEventListener("error", onError);
        window.addEventListener("unhandledrejection", onUnhandledRejection);

        return () => {
            window.removeEventListener("error", onError);
            window.removeEventListener("unhandledrejection", onUnhandledRejection);
        };
    }, []);
}
