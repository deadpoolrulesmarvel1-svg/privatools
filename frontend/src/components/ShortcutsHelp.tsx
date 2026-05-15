/**
 * Press `?` anywhere on the site (when not focused on a text input) to open
 * a small overlay listing the global keyboard shortcuts.
 */
import { useCallback, useEffect, useState } from "react";
import { Command, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface Shortcut { keys: string[]; label: string }

const SHORTCUTS: Shortcut[] = [
    { keys: ["⌘", "K"],     label: "Open command palette / search tools" },
    { keys: ["⌘", "↵"],     label: "Run the current tool" },
    { keys: ["?"],          label: "Show this help" },
    { keys: ["Esc"],        label: "Close any modal or palette" },
    { keys: ["↑", "↓"],     label: "Navigate results in palette" },
    { keys: ["↵"],          label: "Open selected tool" },
];

function isTypingInField(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    if (target.isContentEditable) return true;
    return false;
}

export function ShortcutsHelp() {
    const [open, setOpen] = useState(false);

    const close = useCallback(() => setOpen(false), []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "?" && !isTypingInField(e.target)) {
                e.preventDefault();
                setOpen(o => !o);
            } else if (e.key === "Escape") {
                setOpen(false);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    if (!open) return null;

    return (
        <>
            <button
                type="button"
                aria-label="Close shortcuts help"
                className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm animate-in fade-in-0 duration-200 cursor-default"
                onClick={close}
            />
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="shortcuts-title"
                className="fixed inset-x-0 top-[20vh] z-[201] mx-auto w-full max-w-md px-5 animate-in fade-in-0 slide-in-from-bottom-4 duration-200"
            >
                <div className="rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
                    <div className="flex items-center justify-between px-5 py-3.5 border-b border-border">
                        <div className="flex items-center gap-2">
                            <Command size={14} className="text-accent" />
                            <h2 id="shortcuts-title" className="text-sm font-semibold text-foreground">Keyboard shortcuts</h2>
                        </div>
                        <button onClick={close} aria-label="Close" className="text-muted-foreground hover:text-foreground transition-colors">
                            <X size={16} />
                        </button>
                    </div>
                    <ul className="p-2.5">
                        {SHORTCUTS.map(s => (
                            <li key={s.label} className="flex items-center justify-between px-3 py-2 rounded-md hover:bg-secondary/50">
                                <span className="text-[13px] text-foreground">{s.label}</span>
                                <span className="flex items-center gap-1">
                                    {s.keys.map(k => (
                                        <kbd
                                            key={k}
                                            className={cn(
                                                "inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded border border-border bg-secondary/60 font-mono text-[11px] text-foreground/80"
                                            )}
                                        >
                                            {k}
                                        </kbd>
                                    ))}
                                </span>
                            </li>
                        ))}
                    </ul>
                    <p className="px-5 py-2.5 border-t border-border text-[11px] text-muted-foreground/85">
                        Press <kbd className="font-mono">?</kbd> anywhere to toggle this help.
                    </p>
                </div>
            </div>
        </>
    );
}
