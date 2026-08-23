import { useEffect, useRef, useState } from "react";
import { Check, Palette } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSkin } from "@/hooks/useSkin";
import { SKIN_LIST } from "@/lib/skins";

/**
 * Theme picker. Four complete visual themes, independent of light/dark —
 * switching one never changes the other.
 */
export function SkinSwitcher({ className, align = "right" }: { className?: string; align?: "left" | "right" }) {
    const { skin, setSkin } = useSkin();
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const btnRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") { e.stopPropagation(); setOpen(false); btnRef.current?.focus(); }
        };
        document.addEventListener("mousedown", onDown);
        document.addEventListener("keydown", onKey, true);
        return () => {
            document.removeEventListener("mousedown", onDown);
            document.removeEventListener("keydown", onKey, true);
        };
    }, [open]);

    const active = SKIN_LIST.find((s) => s.id === skin) ?? SKIN_LIST[0];

    return (
        <div ref={wrapRef} className={cn("relative", className)}>
            <button
                ref={btnRef}
                type="button"
                onClick={() => setOpen((o) => !o)}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={`Theme: ${active.name}. Change theme`}
                className="inline-flex h-9 coarse:h-11 items-center gap-2 rounded-lg px-2.5 text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
                <Palette size={16} aria-hidden="true" />
                <span className="hidden xl:inline text-[12.5px] font-medium">{active.name}</span>
                <span aria-hidden="true" className="flex -space-x-1">
                    <span className="h-3 w-3 rounded-full ring-1 ring-background" style={{ background: active.swatch[0] }} />
                    <span className="h-3 w-3 rounded-full ring-1 ring-background" style={{ background: active.swatch[1] }} />
                </span>
            </button>

            {open && (
                <div
                    role="menu"
                    aria-label="Theme"
                    className={cn(
                        "absolute top-full mt-2 z-50 w-[19rem] rounded-xl border border-border bg-popover p-1.5 shadow-xl",
                        align === "right" ? "right-0" : "left-0",
                    )}
                >
                    {SKIN_LIST.map((s) => {
                        const selected = s.id === skin;
                        return (
                            <button
                                key={s.id}
                                role="menuitemradio"
                                aria-checked={selected}
                                onClick={() => { setSkin(s.id); setOpen(false); btnRef.current?.focus(); }}
                                className={cn(
                                    "w-full flex items-start gap-3 rounded-lg px-2.5 py-2.5 text-left transition-colors",
                                    selected ? "bg-secondary" : "hover:bg-secondary/60",
                                )}
                            >
                                <span aria-hidden="true" className="mt-0.5 flex -space-x-1.5 shrink-0">
                                    <span className="h-4 w-4 rounded-full ring-1 ring-border" style={{ background: s.swatch[0] }} />
                                    <span className="h-4 w-4 rounded-full ring-1 ring-border" style={{ background: s.swatch[1] }} />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-center gap-1.5">
                                        <span className="text-[13px] font-medium text-foreground">{s.name}</span>
                                        {selected && <Check size={12} className="text-primary shrink-0" aria-hidden="true" />}
                                    </span>
                                    <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">{s.blurb}</span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}
