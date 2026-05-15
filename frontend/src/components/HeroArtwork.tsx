/**
 * Animated SVG hero artwork — depicts the privacy promise visually.
 *
 * Composition (back → front):
 *   1. Faint orbital rings, slowly rotating.
 *   2. Six color-coded category "chips" — orbit at different radii / phases.
 *   3. A central rounded-square shield containing a stylized lock + the
 *      brand monogram. This is the "vault" everything funnels into.
 *   4. Two stylized document cards floating on either side, drifting.
 *
 * All animation is pure CSS (SMIL has been deprecated in some renderers).
 * Respects prefers-reduced-motion.
 */
import { CSSProperties } from "react";

// (label, hsl tile, angle deg) — colors mirror the per-category icon-tile values
const CHIPS: { label: string; tile: string; angle: number; r: number; delay: number }[] = [
    { label: "PDF",   tile: "200 90% 50%", angle: -90, r: 130, delay: 0 },
    { label: "Image", tile: "320 85% 60%", angle: -30, r: 130, delay: 0.6 },
    { label: "Video", tile: "18 90% 55%",  angle: 30,  r: 130, delay: 1.2 },
    { label: "Dev",   tile: "195 90% 55%", angle: 90,  r: 130, delay: 1.8 },
    { label: "Edit",  tile: "270 85% 60%", angle: 150, r: 130, delay: 2.4 },
    { label: "AI",    tile: "32 95% 50%",  angle: 210, r: 130, delay: 3.0 },
];

export function HeroArtwork() {
    return (
        <div
            aria-hidden="true"
            className="hero-artwork relative w-[340px] h-[340px] sm:w-[420px] sm:h-[420px] mx-auto pointer-events-none select-none"
        >
            {/* Outer orbital ring */}
            <div className="absolute inset-0 hero-art-ring" />
            {/* Inner orbital ring */}
            <div className="absolute inset-[40px] hero-art-ring hero-art-ring-2" />

            {/* Floating category chips */}
            {CHIPS.map(c => {
                const rad = (c.angle * Math.PI) / 180;
                const x = Math.cos(rad) * c.r;
                const y = Math.sin(rad) * c.r;
                const style: CSSProperties = {
                    transform: `translate(calc(50% + ${x}px - 50%), calc(50% + ${y}px - 50%))`,
                    animationDelay: `${c.delay}s`,
                    "--tile": c.tile,
                } as CSSProperties;
                return (
                    <span
                        key={c.label}
                        className="hero-art-chip absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                        style={style}
                    >
                        <span
                            className="block text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-full border"
                            style={{
                                color: `hsl(var(--tile))`,
                                background: `hsl(var(--tile) / 0.10)`,
                                borderColor: `hsl(var(--tile) / 0.28)`,
                            }}
                        >
                            {c.label}
                        </span>
                    </span>
                );
            })}

            {/* Side document cards */}
            <span className="hero-art-doc hero-art-doc-left absolute left-2 top-1/2 -translate-y-1/2">
                <DocCard tone="light" />
            </span>
            <span className="hero-art-doc hero-art-doc-right absolute right-2 top-1/2 -translate-y-1/2">
                <DocCard tone="dark" />
            </span>

            {/* Center shield */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hero-art-shield">
                <div className="relative h-[88px] w-[88px] sm:h-[104px] sm:w-[104px] rounded-2xl bg-card border border-accent/40 shadow-[0_8px_30px_-8px_hsl(var(--accent)/0.45)] flex items-center justify-center">
                    {/* glow */}
                    <span className="absolute inset-0 rounded-2xl pointer-events-none"
                          style={{ boxShadow: "inset 0 0 32px -10px hsl(var(--accent) / 0.35)" }} />
                    {/* shield/lock svg */}
                    <svg viewBox="0 0 24 24" className="h-9 w-9 sm:h-11 sm:w-11" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "hsl(var(--accent))" }}>
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        <rect x="9" y="11" width="6" height="5" rx="1" />
                        <path d="M10 11V9a2 2 0 0 1 4 0v2" />
                    </svg>
                </div>
            </div>
        </div>
    );
}

function DocCard({ tone }: { tone: "light" | "dark" }) {
    return (
        <span className="block w-[58px] sm:w-[68px] h-[78px] sm:h-[88px] rounded-md border bg-card-tint shadow-[0_4px_14px_-4px_rgba(0,0,0,0.20)] relative"
              style={{ borderColor: tone === "light" ? "hsl(var(--border))" : "hsl(var(--border) / 1.6)" }}>
            {/* fake lines */}
            <span className="absolute left-2 right-3 top-2 h-1 rounded bg-foreground/12" />
            <span className="absolute left-2 right-5 top-4 h-1 rounded bg-foreground/12" />
            <span className="absolute left-2 right-2 top-6 h-1 rounded bg-foreground/12" />
            <span className="absolute left-2 right-7 top-8 h-1 rounded bg-foreground/12" />
            <span className="absolute left-2 right-4 top-10 h-1 rounded bg-foreground/12" />
            {/* corner fold */}
            <span className="absolute right-0 top-0 w-3 h-3 bg-card border-l border-b border-border rounded-bl" />
        </span>
    );
}
