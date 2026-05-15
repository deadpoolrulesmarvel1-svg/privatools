import { useState } from "react";
import { GenericUI } from "./GenericUI";
import { cn } from "@/lib/utils";

type Direction = "vertical" | "horizontal";

const options: { id: Direction; label: string; desc: string }[] = [
    { id: "vertical",   label: "Vertical",   desc: "Each page → left half, then right half" },
    { id: "horizontal", label: "Horizontal", desc: "Each page → top half, then bottom half" },
];

export function SplitInHalfUI() {
    const [direction, setDirection] = useState<Direction>("vertical");

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card/40 p-5 space-y-3">
                <p className="text-sm font-semibold text-foreground">Cut direction</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {options.map(o => (
                        <button
                            key={o.id}
                            type="button"
                            onClick={() => setDirection(o.id)}
                            aria-pressed={direction === o.id}
                            className={cn(
                                "rounded-xl border p-3 text-left transition-all",
                                direction === o.id
                                    ? "border-accent bg-accent/5"
                                    : "border-border hover:border-border/70 hover:bg-secondary/40"
                            )}
                        >
                            <p className="text-sm font-medium text-foreground">{o.label}</p>
                            <p className="text-xs text-muted-foreground mt-0.5">{o.desc}</p>
                        </button>
                    ))}
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
