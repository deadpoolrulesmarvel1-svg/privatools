/**
 * Animated Pipeline diagram — a "file" dot drifts through 4 stages, each
 * lighting up as the dot passes. Pure CSS animation (single keyframe drives
 * the dot; staggered animation-delay drives the chip pulses) so it stays
 * smooth and respects prefers-reduced-motion.
 */
import { ArrowRight, FileText } from "lucide-react";
import { cn } from "@/lib/utils";

interface Stage {
    n: string;
    c: string; // cat-* class
}

const DEFAULT_STAGES: Stage[] = [
    { n: "Compress", c: "cat-optimize" },
    { n: "Rotate", c: "cat-optimize" },
    { n: "Stamp", c: "cat-edit" },
    { n: "Sign", c: "cat-edit" },
];

export function AnimatedPipeline({ stages = DEFAULT_STAGES }: { stages?: Stage[] }) {
    const cycle = 6.4; // seconds per full pass
    const slot = cycle / stages.length; // per-stage window
    return (
        <div className="relative mt-9 inline-flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 rounded-2xl border border-border bg-card overflow-hidden pipeline-anim">
            {/* moving "file" dot, sits behind chips */}
            <span aria-hidden="true" className="pipeline-file">
                <FileText size={11} strokeWidth={2.2} />
            </span>

            {stages.map((s, i) => {
                const delay = (slot * i).toFixed(2);
                return (
                    <span key={s.n + i} className="flex items-center gap-2 sm:gap-3">
                        <span
                            className={cn(
                                "pipeline-chip relative inline-flex items-center gap-1.5 px-2.5 h-7 rounded-full bg-card-tint border border-border text-[11px] sm:text-[12px] font-medium text-foreground",
                                s.c,
                            )}
                            style={{ animationDelay: `${delay}s` }}
                        >
                            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "hsl(var(--tile))" }} />
                            {s.n}
                        </span>
                        {i < stages.length - 1 && <ArrowRight size={11} className="text-muted-foreground/80" />}
                    </span>
                );
            })}
        </div>
    );
}
