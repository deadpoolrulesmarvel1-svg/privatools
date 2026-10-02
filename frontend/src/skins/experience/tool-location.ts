import { createContext, useContext } from "react";
import { Laptop, Server, Sparkles, type LucideIcon } from "lucide-react";

/**
 * Where a tool's input goes: this browser, temporary server processing, the
 * visitor's own AI provider, or (Background Remover) the visitor's choice.
 * The registry's `clientOnly` and `byok` flags decide it, in this order, and
 * the words are the tool page's existing disclosure: change them only when the
 * processing itself changes. The intake says it in full (ToolWhere), the
 * action bar by its label, and the "How it works" panel repeats the detail.
 */
export type ToolLocationKind = "device" | "server" | "ai" | "choice";

export interface ToolLocation {
    kind: ToolLocationKind;
    /** A few words: the action bar and the intake's lead. */
    label: string;
    /** What happens to the input, in full. */
    detail: string;
}

export function toolLocation(tool: { slug: string; clientOnly?: boolean; byok?: boolean }): ToolLocation {
    if (tool.slug === "remove-background") return {
        kind: "choice",
        label: "Browser or server · your choice",
        detail: "Choose where to process before running. On this device downloads the model and processes images in your browser. The default server engine uploads images for temporary processing. Both options work without an account or an AI provider key.",
    };
    if (tool.byok) return {
        kind: "ai",
        label: "Your choice of AI",
        detail: "Review your AI settings before running. Your provider receives requests you choose to send; some document steps also use PrivaTools.",
    };
    if (tool.clientOnly) return {
        kind: "device",
        label: "Stays on your device",
        detail: "Processing happens in this browser. Your input stays on this device.",
    };
    return {
        kind: "server",
        label: "Temporary server processing",
        detail: "Files are uploaded only when you run the tool. PrivaTools processes them in temporary storage and removes the job’s files after the response.",
    };
}

export const LOCATION_ICONS: Record<ToolLocationKind, LucideIcon> = { device: Laptop, server: Server, ai: Sparkles, choice: Sparkles };

const ToolLocationContext = createContext<ToolLocation | null>(null);
export const ToolLocationProvider = ToolLocationContext.Provider;

/** The tool page's location, or null outside a tool page (tests, Batch, Pipeline). */
export function useToolLocation(): ToolLocation | null {
    return useContext(ToolLocationContext);
}
