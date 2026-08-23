/**
 * EmptyState — shared workshop-styled placeholder for sections with no data yet.
 *
 * Used on the Dashboard when Recent / Pinned have no entries, and anywhere
 * else we want to invite a first action instead of showing a sad void. The
 * styling mirrors the rest of the workshop language: dashed border, corner
 * registration marks, a single accent icon, and chip-style CTA links.
 *
 *   <EmptyState
 *     icon={Sparkles}
 *     eyebrow="No history yet"
 *     title="Start with a popular tool"
 *     description="Or drop a file anywhere to detect the right tool."
 *     ctas={[
 *       { label: "Compress PDF", href: "/tool/compress-pdf" },
 *       { label: "Merge PDF",    href: "/tool/merge-pdf"    },
 *     ]}
 *   />
 *
 * `ctas[0]` is rendered with `btn-accent` (primary). Subsequent CTAs use the
 * outlined "chip" style. Use `onClick` instead of `href` when the action is
 * local (e.g. opening the command palette).
 */
import { Link } from "react-router-dom";
import { ArrowRight, Zap, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils"; export interface EmptyStateCTA { label: string; /** External or in-app link. Mutually exclusive with `onClick`. */ href?: string; /** Local action (e.g. open command palette). Mutually exclusive with `href`. */ onClick?: () => void; /** Tiny icon shown left of the label. Defaults to a `Zap` for the primary * CTA, none for the chip variants. */ icon?: LucideIcon; } export interface EmptyStateProps { /** Lucide icon shown in the accent tile at the top-left. */ icon: LucideIcon; /** Mono line above the title — keeps the section-mark rhythm. */ eyebrow?: string; title: string; description: string; ctas?: EmptyStateCTA[]; /** Optional className to merge into the outer container. */ className?: string; /** Tone:"neutral" (default, paper background) or "accent" (subtle green wash). */
    tone?: "neutral" | "accent";
}

function CornerMarks() {
    const cls = "absolute h-3 w-3 pointer-events-none";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}><span className="absolute top-0 left-0 h-px w-3 bg-accent/60" /><span className="absolute top-0 left-0 w-px h-3 bg-accent/60" /></span>
            <span className={`${cls} -top-1 -right-1`}><span className="absolute top-0 right-0 h-px w-3 bg-accent/60" /><span className="absolute top-0 right-0 w-px h-3 bg-accent/60" /></span>
            <span className={`${cls} -bottom-1 -left-1`}><span className="absolute bottom-0 left-0 h-px w-3 bg-accent/60" /><span className="absolute bottom-0 left-0 w-px h-3 bg-accent/60" /></span>
            <span className={`${cls} -bottom-1 -right-1`}><span className="absolute bottom-0 right-0 h-px w-3 bg-accent/60" /><span className="absolute bottom-0 right-0 w-px h-3 bg-accent/60" /></span>
        </>
    );
}

export function EmptyState({
    icon: Icon,
    eyebrow,
    title,
    description,
    ctas,
    className,
    tone = "neutral",
}: EmptyStateProps) {
    return (
        <div
            className={cn(
                "relative rounded-xl border border-dashed p-5 sm:p-6",
                tone === "accent"
                    ? "border-accent/40 bg-accent/[0.04]"
                    : "border-border-strong bg-paper-2/30",
                className
            )}
        >
            <CornerMarks />

            <div className="flex items-start gap-4">
                <span className="h-11 w-11 shrink-0 rounded-xl bg-accent/12 border border-accent/35 flex items-center justify-center">
                    <Icon size={17} className="text-accent" strokeWidth={1.75} />
                </span>

                <div className="min-w-0 flex-1">
                    {eyebrow && (
                        <p className="section-mark mb-1.5">{eyebrow}</p>
                    )}
                    <h3
                        className="font-display text-[18px] sm:text-[19px] font-semibold text-foreground tracking-[-0.018em] leading-tight"
                        style={{ fontVariationSettings: '"opsz" 32' }}
                    >
                        {title}
                    </h3>
                    <p className="mt-1.5 text-[13px] sm:text-[13.5px] text-muted-foreground leading-relaxed max-w-[58ch]">
                        {description}
                    </p>

                    {ctas && ctas.length > 0 && (
                        <div className="mt-4 flex flex-wrap gap-2">
                            {ctas.map((cta, idx) => {
                                // Primary action gets the accent button; the rest are chips.
                                const isPrimary = idx === 0;
                                const ChipIcon = cta.icon ?? (isPrimary ? ArrowRight : Zap);

                                if (isPrimary) {
                                    const inner = (
                                        <>
                                            {cta.label}
                                            <ArrowRight size={12} aria-hidden="true" className="ml-0.5" />
                                        </>
                                    );
                                    return cta.href ? (
                                        <Link key={cta.label} to={cta.href} className="btn-accent h-9 px-3.5 text-[12.5px]">
                                            {inner}
                                        </Link>
                                    ) : (
                                        <button
                                            key={cta.label}
                                            type="button"
                                            onClick={cta.onClick}
                                            className="btn-accent h-9 px-3.5 text-[12.5px]"
                                        >
                                            {inner}
                                        </button>
                                    );
                                }

                                // Chip variant — mono label, outlined, accent on hover.
                                const chipCls = "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border border-border bg-card hover:border-accent/40 hover:bg-accent/[0.04] font-mono text-[11px] text-foreground/85 hover:text-foreground transition-colors";
                                return cta.href ? (
                                    <Link key={cta.label} to={cta.href} className={chipCls}>
                                        <ChipIcon size={10} className="text-accent" />
                                        {cta.label}
                                    </Link>
                                ) : (
                                    <button
                                        key={cta.label}
                                        type="button"
                                        onClick={cta.onClick}
                                        className={chipCls}
                                    >
                                        <ChipIcon size={10} className="text-accent" />
                                        {cta.label}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
