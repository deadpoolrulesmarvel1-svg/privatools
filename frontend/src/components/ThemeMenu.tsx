/**
 * ThemeMenu — light plus three dark grounds, switchable live.
 *
 * The three darks differ only in ground and elevation; the colour system on
 * top is identical, which is what makes them comparable. Judging a dark theme
 * from a screenshot is unreliable — the same hex reads differently depending
 * on surrounding light — so this exists to be toggled while looking at a real
 * page.
 */
import { useEffect, useRef, useState } from "react";
import { Check, Moon, Sun } from "lucide-react";
import { cn } from "@/lib/utils";
import { DARK_VARIANTS, useTheme, type DarkVariant } from "@/hooks/useTheme";

export function ThemeMenu({ className }: { className?: string }) {
    const { theme, setTheme, darkVariant, setDarkVariant } = useTheme();
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    const choose = (t: "light" | "dark", v?: DarkVariant) => {
        setTheme(t);
        if (v) setDarkVariant(v);
        setOpen(false);
    };

    const swatch = (v: DarkVariant) =>
        v === "midnight" ? "#070707" : v === "carbon" ? "#14161a" : "#0a121e";

    return (
        <div ref={wrapRef} className={cn("relative", className)}>
            <button
                onClick={() => setOpen(o => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label="Appearance"
                title="Appearance"
                className="inline-flex h-9 w-9 coarse:h-11 coarse:w-11 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
                {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
            </button>

            {open && (
                <div
                    role="menu"
                    aria-label="Appearance"
                    className="absolute right-0 top-11 z-50 w-60 rounded-2xl border border-border bg-popover p-1.5 shadow-xl animate-pop-in origin-top-right"
                >
                    <button
                        role="menuitemradio"
                        aria-checked={theme === "light"}
                        onClick={() => choose("light")}
                        className="w-full flex items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                        <span className="h-6 w-6 rounded-lg border border-border shrink-0" style={{ background: "#ffffff" }} />
                        <span className="flex-1 text-[13.5px] font-medium text-foreground">Light</span>
                        {theme === "light" && <Check size={15} className="text-primary shrink-0" />}
                    </button>

                    <div className="px-2.5 pt-2.5 pb-1 text-[11.5px] font-medium text-muted-foreground">Dark</div>

                    {DARK_VARIANTS.map(v => {
                        const active = theme === "dark" && darkVariant === v.id;
                        return (
                            <button
                                key={v.id}
                                role="menuitemradio"
                                aria-checked={active}
                                onClick={() => choose("dark", v.id)}
                                className="w-full flex items-start gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            >
                                <span className="mt-0.5 h-6 w-6 rounded-lg border border-border shrink-0" style={{ background: swatch(v.id) }} />
                                <span className="flex-1 min-w-0">
                                    <span className="block text-[13.5px] font-medium text-foreground">{v.label}</span>
                                    <span className="block text-[12px] text-muted-foreground leading-snug">{v.hint}</span>
                                </span>
                                {active && <Check size={15} className="text-primary shrink-0 mt-0.5" />}
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
