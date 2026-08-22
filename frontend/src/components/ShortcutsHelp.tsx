/**
 * Press `?` anywhere on the site (when not focused on a text input) to open
 * a small overlay listing the global keyboard shortcuts.
 *
 * Workshop aesthetic: dateline header, Fraunces title, mono kbd chips,
 * paper-2 row hover.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Command, X, Keyboard } from "lucide-react";

interface Shortcut { keys: string[]; label: string; }
interface ShortcutGroup { title: string; items: Shortcut[]; }

const GROUPS: ShortcutGroup[] = [
    {
        title: "Navigation",
        items: [
            { keys: ["⌘", "K"], label: "Open command palette" },
            { keys: ["⌘", "B"], label: "Toggle sidebar" },
            { keys: ["⌘", "/"], label: "Open this help" },
            { keys: ["?"],      label: "Open this help (no modifier)" },
            { keys: ["Esc"],    label: "Close palette or modal" },
        ],
    },
    {
        title: "Command palette",
        items: [
            { keys: ["↑", "↓"], label: "Move selection" },
            { keys: ["↵"],      label: "Open the highlighted tool" },
            { keys: ["⌘", "K"], label: "Toggle palette" },
        ],
    },
    {
        title: "Tools",
        items: [
            { keys: ["⌘", "↵"], label: "Run the current tool" },
        ],
    },
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
    const previouslyFocused = useRef<HTMLElement | null>(null);
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const closeBtnRef = useRef<HTMLButtonElement | null>(null);
    const close = useCallback(() => setOpen(false), []);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            // `?` (shift + /) anywhere — VSCode / GitHub / Linear convention.
            if (e.key === "?" && !isTypingInField(e.target)) {
                e.preventDefault();
                setOpen(o => !o);
            }
            // ⌘ /  — the documented binding from the spec. Works even
            // inside form fields so the user can always escape to help.
            if ((e.metaKey || e.ctrlKey) && e.key === "/") {
                e.preventDefault();
                setOpen(o => !o);
            }
            if (e.key === "Escape") setOpen(false);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // Save focus on open, restore on close — keyboard users land back
    // where they were before pressing ?. When open, move focus to the close
    // button so screen-reader users know they're inside a dialog.
    useEffect(() => {
        if (open) {
            previouslyFocused.current = document.activeElement as HTMLElement | null;
            requestAnimationFrame(() => closeBtnRef.current?.focus());
        } else if (previouslyFocused.current) {
            if (document.contains(previouslyFocused.current)) {
                previouslyFocused.current.focus();
            }
            previouslyFocused.current = null;
        }
    }, [open]);

    // Simple focus trap — when Tab leaves the dialog, wrap focus back to the
    // first focusable element (close button). The shortcuts dialog has only a
    // couple of interactive elements so a full focus-trap library is overkill.
    useEffect(() => {
        if (!open) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Tab") return;
            const root = dialogRef.current;
            if (!root) return;
            const focusable = root.querySelectorAll<HTMLElement>(
                'a, button, input, textarea, select, [tabindex]:not([tabindex="-1"])'
            );
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
            }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [open]);

    if (!open) return null;

    return (
        <>
            {/* Backdrop — non-focusable; tabIndex=-1 keeps it out of the Tab order,
               click still closes the dialog. */}
            <button
                type="button"
                aria-label="Close shortcuts help"
                tabIndex={-1}
                className="fixed inset-0 z-[200] bg-foreground/35 backdrop-blur-md animate-in fade-in-0 duration-200 cursor-default"
                onClick={close}
            />
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="shortcuts-title"
                className="fixed inset-x-0 top-[16vh] z-[201] mx-auto w-full max-w-lg px-5 animate-in fade-in-0 slide-in-from-bottom-4 duration-200"
            >
                <div
                    className="rounded-2xl border border-border-strong overflow-hidden shadow-[0_30px_60px_-20px_rgba(20,15,5,0.35)] dark:shadow-[0_30px_60px_-20px_rgba(0,0,0,0.7)]"
                    style={{ background: "hsl(var(--background))" }}
                >
                    {/* Dateline header */}
                    <div className="font-medium px-5 py-2 border-b border-border bg-paper-2/50 flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>Keyboard reference</span>
                        <button
                            ref={closeBtnRef}
                            onClick={close}
                            className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                            aria-label="Close shortcuts help"
                        >
                            <X size={11} aria-hidden="true" />
                        </button>
                    </div>

                    {/* Title */}
                    <div className="px-6 pt-6 pb-3">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="h-10 w-10 rounded-xl bg-accent/12 border border-accent/30 flex items-center justify-center">
                                <Keyboard size={18} className="text-accent" />
                            </div>
                            <h2 id="shortcuts-title" className="font-display text-[22px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                Keyboard <span className="italic text-accent">shortcuts</span>
                            </h2>
                        </div>
                        <p className="text-[13px] text-muted-foreground leading-relaxed">
                            Move faster — every action below has a keyboard binding.
                        </p>
                    </div>

                    {/* Groups */}
                    <div className="px-3 pb-3 space-y-1">
                        {GROUPS.map(group => (
                            <div key={group.title} className="rounded-lg overflow-hidden">
                                <p className="px-3 py-2 text-[11px] font-medium text-muted-foreground/85">
                                    {group.title}
                                </p>
                                <ul className="px-1">
                                    {group.items.map(s => (
                                        <li key={s.label} className="flex items-center justify-between gap-3 px-3 py-2 rounded-md hover:bg-secondary/50 transition-colors">
                                            <span className="text-[13px] text-foreground">{s.label}</span>
                                            <span className="flex items-center gap-1 shrink-0">
                                                {s.keys.map((k, i) => (
                                                    <span key={i} className="inline-flex items-center gap-1">
                                                        <kbd className="inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded border border-border bg-paper-2/60 font-mono text-[11px] font-medium text-foreground">
                                                            {k}
                                                        </kbd>
                                                        {i < s.keys.length - 1 && <span className="text-muted-foreground/70 font-mono text-[10px]">+</span>}
                                                    </span>
                                                ))}
                                            </span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>

                    {/* Footer */}
                    <div className="font-medium px-6 py-3 border-t border-border bg-paper-2/30 flex items-center gap-2 text-[11.5px] text-muted-foreground">
                        <Command size={11} className="text-accent" />
                        <span>Press <kbd className="px-1 rounded bg-card border border-border text-foreground">?</kbd> anywhere to toggle</span>
                    </div>
                </div>
            </div>
        </>
    );
}
