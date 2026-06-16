/**
 * StatusBar — bottom strip, mono, like a code-editor status line.
 *
 * Left: privacy attestations (the receipts).
 * Right: tool count / MIT badge / Cmd+K hint.
 *
 * Stays mounted at all times — same role as VS Code's status bar.
 */
import { memo, useEffect, useState } from "react";
import { Command, Lock, Github } from "lucide-react";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";

const TOOL_TOTAL = tools.length + nonPdfTools.length;

// Privacy attestations — varied so the rotation doesn't feel like the
// same three platitudes. Each one is concrete and falsifiable.
const FACTS = [
    "0 files uploaded to a third party",
    "Local AI via WebAssembly",
    "Files deleted within seconds of response",
    "No accounts, no ad pixels",
    "MIT licensed — every line public",
    "Self-hostable in one Docker command",
    "Anonymized pageview analytics only",
    "Open source — read the source on GitHub",
    "Temp files unlinked after response",
    "Browser-side tools run with no server",
    "Server tools run in isolated containers",
];

function StatusBarInner() {
    // Rotate through facts every 5 seconds — adds a sense of liveness
    // without being noisy. Respects reduced-motion (locked to first).
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const [factIdx, setFactIdx] = useState(0);
    const [fading, setFading] = useState(false);
    useEffect(() => {
        if (reduce) return;
        const id = setInterval(() => {
            // Brief fade-out, swap fact, fade in — 200ms cross-fade keeps
            // the rotation calm.
            setFading(true);
            setTimeout(() => {
                setFactIdx(i => (i + 1) % FACTS.length);
                setFading(false);
            }, 200);
        }, 5500);
        return () => clearInterval(id);
    }, [reduce]);

    const openCmdK = () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    };

    return (
        <footer
            role="contentinfo"
            className="relative z-30 flex-shrink-0 h-7 border-t border-border bg-paper-2/70 backdrop-blur-md flex items-center justify-between px-3 font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground"
        >
            <div className="flex items-center gap-3 min-w-0">
                <span className="inline-flex items-center gap-1.5 shrink-0" title="Browser-only where possible; isolated backend processing when needed">
                    <span className="h-1.5 w-1.5 rounded-full bg-accent animate-accent-pulse" />
                    <span className="text-foreground/80">Private</span>
                </span>
                <span className="opacity-40">—</span>
                <span className="inline-flex items-center gap-1.5 min-w-0" aria-live="polite">
                    <Lock size={10} className="text-accent shrink-0" />
                    <span className={`truncate transition-opacity duration-200 ${fading ? "opacity-0" : "opacity-100"}`}>
                        {FACTS[factIdx]}
                    </span>
                </span>
            </div>

            <div className="hidden sm:flex items-center gap-3 shrink-0">
                <span title={`${TOOL_TOTAL} privacy-first tools, browser-side or isolated backend`}>
                    <span className="text-accent">§</span> {TOOL_TOTAL} tools live
                </span>
                <span className="opacity-40">—</span>
                <a
                    href="https://github.com/deadpoolrulesmarvel1-svg/privatools"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 hover:text-foreground hover:underline underline-offset-2 decoration-accent/40 transition-colors"
                    title="View source on GitHub"
                >
                    <Github size={10} /> MIT · v.live
                </a>
                <span className="opacity-40">—</span>
                <button
                    onClick={openCmdK}
                    className="inline-flex items-center gap-1.5 hover:text-foreground transition-colors"
                    aria-label="Open command palette (Cmd+K)"
                    title="Search every tool (⌘K)"
                >
                    <Command size={10} /> K — Search
                </button>
            </div>
        </footer>
    );
}

// StatusBar is mounted persistently inside AppShell and re-renders on every
// route change — wrap with memo so it only re-renders when its own state
// (fact rotation / fading) ticks.
export const StatusBar = memo(StatusBarInner);
