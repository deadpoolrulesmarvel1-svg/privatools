import { useState, useCallback} from "react";
import { GenericUI } from "./GenericUI";
import { cn } from "@/lib/utils";
import { useToolDefaults } from "@/hooks/useToolDefaults";

type Direction = "vertical" | "horizontal";

const options: { id: Direction; label: string; desc: string }[] = [
    { id: "vertical",   label: "Vertical cut",   desc: "Each page → left half, then right half"  },
    { id: "horizontal", label: "Horizontal cut", desc: "Each page → top half, then bottom half"  },
];

const SPLIT_IN_HALF_DEFAULTS: { direction: Direction } = {
    direction: "vertical",
};

export function SplitInHalfUI() {
    const [config, , { setField }] = useToolDefaults("split-in-half", SPLIT_IN_HALF_DEFAULTS);
    const { direction } = config;
    const setDirection = useCallback((v: React.SetStateAction<typeof SPLIT_IN_HALF_DEFAULTS["direction"]>) => setField("direction", v), [setField]);

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                    <span className="text-accent">§</span> Cut direction
                </div>
                <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {options.map((o, idx) => {
                        const active = direction === o.id;
                        return (
                            <button
                                key={o.id}
                                type="button"
                                onClick={() => setDirection(o.id)}
                                aria-pressed={active}
                                className={cn(
                                    "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                                    active
                                        ? "border-accent bg-accent/[0.06]"
                                        : "border-border hover:border-border-strong hover:bg-secondary/40"
                                )}
                            >
                                {/* SVG mini preview: page with cut + arrows showing flow */}
                                <div className={cn(
                                    "relative h-12 w-9 rounded-sm border shrink-0 overflow-hidden transition-colors",
                                    active ? "bg-accent/10 border-accent/40" : "bg-paper-2 border-border"
                                )} aria-hidden>
                                    {o.id === "vertical" ? (
                                        <>
                                            <span className={cn("absolute top-0.5 bottom-0.5 left-1/2 w-px", active ? "bg-accent" : "bg-muted-foreground/60")} />
                                            <span className={cn("absolute top-1.5 left-0.5 text-[7px] font-mono", active ? "text-accent" : "text-muted-foreground")}>L</span>
                                            <span className={cn("absolute top-1.5 right-0.5 text-[7px] font-mono", active ? "text-accent" : "text-muted-foreground")}>R</span>
                                        </>
                                    ) : (
                                        <>
                                            <span className={cn("absolute left-0.5 right-0.5 top-1/2 h-px", active ? "bg-accent" : "bg-muted-foreground/60")} />
                                            <span className={cn("absolute top-0.5 left-1/2 -translate-x-1/2 text-[7px] font-mono", active ? "text-accent" : "text-muted-foreground")}>T</span>
                                            <span className={cn("absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[7px] font-mono", active ? "text-accent" : "text-muted-foreground")}>B</span>
                                        </>
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-baseline gap-2">
                                        <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent">{String(idx + 1).padStart(2, "0")}</span>
                                        <p className="font-display text-[14px] font-semibold text-foreground tracking-[-0.015em]">{o.label}</p>
                                    </div>
                                    <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-snug">{o.desc}</p>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>
            <GenericUI
                slug="split-in-half"
                toolName="Split each page in half"
                outputLabel="split-in-half.pdf"
                accepts=".pdf"
                params={{ direction }}
            />
        </div>
    );
}
