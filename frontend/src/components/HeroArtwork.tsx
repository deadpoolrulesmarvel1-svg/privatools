/**
 * Hero artwork — a live, looping pipeline demonstration.
 *
 * Concept: a document enters from the left, passes through 4 labelled
 * processing nodes (Merge → Compress → Watermark → Sign), each lighting
 * up as the file passes through, and exits as a signed/sealed output.
 *
 * The artwork is the product. Stationary, but always moving. Editorial
 * composition — annotated like a technical schematic.
 *
 * Pure CSS animation. Respects prefers-reduced-motion.
 */
import { FileText, Combine, ArchiveRestore, ShieldCheck, CheckCheck } from "lucide-react";

const NODES = [
    { Icon: Combine,        label: "Merge",      delay: 0.0 },
    { Icon: ArchiveRestore, label: "Compress",   delay: 1.6 },
    { Icon: ShieldCheck,    label: "Watermark",  delay: 3.2 },
    { Icon: CheckCheck,     label: "Sign",       delay: 4.8 },
];

export function HeroArtwork() {
    return (
        <figure
            aria-hidden="true"
            className="relative w-full max-w-[460px] mx-auto pointer-events-none select-none"
        >
            {/* Schematic frame — technical-drawing aesthetic */}
            <div className="relative rounded-2xl border border-border bg-card/60 backdrop-blur-sm p-5 shadow-[0_30px_60px_-30px_rgba(20,15,5,0.25)] dark:shadow-[0_30px_60px_-20px_rgba(0,0,0,0.6)]">
                {/* Corner registration marks — classic editorial drafting flourish */}
                <CornerMarks />

                {/* Header */}
                <div className="flex items-center justify-between mb-5 font-mono text-[10.5px] tracking-[0.12em] uppercase text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                        <span className="h-1.5 w-1.5 rounded-full bg-accent animate-[pulse_2s_ease-in-out_infinite]" />
                        Pipeline · Live
                    </span>
                    <span>Fig. 01</span>
                </div>

                {/* Pipeline track */}
                <div className="relative">
                    {/* Backbone line connecting all nodes */}
                    <div className="absolute top-7 left-7 right-7 h-px bg-gradient-to-r from-border via-border-strong to-border" />
                    {/* Moving spark — the "file" travels along the backbone */}
                    <span className="absolute top-7 left-7 -translate-y-1/2 h-1.5 w-1.5 rounded-full bg-accent shadow-[0_0_12px_3px_hsl(var(--accent)/0.6)] animate-[hero-spark_6.4s_linear_infinite]" />

                    <div className="relative grid grid-cols-4 gap-3">
                        {NODES.map((n, i) => (
                            <Node key={n.label} {...n} index={i} />
                        ))}
                    </div>
                </div>

                {/* Output indicator */}
                <div className="mt-5 flex items-center justify-between">
                    <div className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.08em] uppercase text-muted-foreground">
                        <FileText size={11} />
                        <span>input.pdf</span>
                    </div>
                    <div className="flex-1 mx-3 h-px bg-border border-t border-dashed" />
                    <div className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.08em] uppercase text-accent">
                        <span>signed.pdf</span>
                        <CheckCheck size={11} />
                    </div>
                </div>
            </div>

            {/* Editorial caption underneath */}
            <figcaption className="mt-4 text-center font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground/85">
                <span className="text-accent">Fig. 01</span>
                <span className="mx-2 opacity-50">—</span>
                One file, four tools, isolated processing
            </figcaption>

            <style>{`
                @keyframes hero-spark {
                    0%   { left: 7%;  opacity: 0; }
                    5%   { opacity: 1; }
                    25%  { left: 30%; opacity: 1; }
                    50%  { left: 55%; opacity: 1; }
                    75%  { left: 80%; opacity: 1; }
                    95%  { left: 95%; opacity: 1; }
                    100% { left: 95%; opacity: 0; }
                }
                @keyframes hero-node-pulse {
                    0%, 100% {
                        box-shadow: 0 0 0 0 hsl(var(--accent) / 0);
                        border-color: hsl(var(--border));
                        background: hsl(var(--card));
                    }
                    5%, 15% {
                        box-shadow: 0 0 0 4px hsl(var(--accent) / 0.20),
                                    0 8px 22px -6px hsl(var(--accent) / 0.40);
                        border-color: hsl(var(--accent) / 0.55);
                        background: hsl(var(--accent) / 0.06);
                    }
                }
                .hero-node {
                    animation: hero-node-pulse 6.4s ease-in-out infinite;
                }
                @media (prefers-reduced-motion: reduce) {
                    .hero-node, [class*="hero-spark"] { animation: none !important; }
                }
            `}</style>
        </figure>
    );
}

function Node({
    Icon, label, delay, index,
}: {
    Icon: typeof FileText; label: string; delay: number; index: number;
}) {
    return (
        <div className="flex flex-col items-center text-center">
            <div
                className="hero-node h-14 w-14 rounded-xl border border-border bg-card flex items-center justify-center transition-colors"
                style={{ animationDelay: `${delay}s` }}
            >
                <Icon size={20} className="text-foreground/80" strokeWidth={1.75} />
            </div>
            <div className="mt-2 font-mono text-[9.5px] tracking-[0.10em] uppercase text-muted-foreground">
                <span className="text-accent">0{index + 1}</span>
                <span className="mx-1 opacity-50">·</span>
                {label}
            </div>
        </div>
    );
}

function CornerMarks() {
    const arm = "absolute h-3 w-3";
    const line = "absolute bg-accent";
    return (
        <>
            <span className={`${arm} -top-1 -left-1`}>
                <span className={`${line} top-0 left-0 h-px w-3`} />
                <span className={`${line} top-0 left-0 w-px h-3`} />
            </span>
            <span className={`${arm} -top-1 -right-1`}>
                <span className={`${line} top-0 right-0 h-px w-3`} />
                <span className={`${line} top-0 right-0 w-px h-3`} />
            </span>
            <span className={`${arm} -bottom-1 -left-1`}>
                <span className={`${line} bottom-0 left-0 h-px w-3`} />
                <span className={`${line} bottom-0 left-0 w-px h-3`} />
            </span>
            <span className={`${arm} -bottom-1 -right-1`}>
                <span className={`${line} bottom-0 right-0 h-px w-3`} />
                <span className={`${line} bottom-0 right-0 w-px h-3`} />
            </span>
        </>
    );
}
