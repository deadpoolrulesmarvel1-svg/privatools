/**
 * FirstRunWelcome — the hero card a brand-new visitor sees in place of the
 * "Good evening, what are we doing today?" greeting on the Dashboard.
 *
 * The card sells the proposition (179 tools, files never leave the
 * container) and offers three obvious next actions:
 *
 *   1. Try sample PDF   → loads `/samples/sample.pdf` and jumps to compress
 *   2. Pick a tool      → opens the command palette (⌘K)
 *   3. Take the tour    → dispatches the START_TOUR_EVENT so OnboardingTour opens
 *
 * Any of those CTAs (or pressing dismiss, or 5 minutes of idle session)
 * calls `markCompleted()` so the welcome won't show again. State lives in
 * the `useFirstRun` hook — see that file for the storage key + reset.
 */
import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Sparkles, FileText, Search, PlayCircle, X, ShieldCheck, ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { loadSamplePdf } from "@/lib/sample-files";
import { START_TOUR_EVENT } from "@/components/OnboardingTour";

interface FirstRunWelcomeProps {
    /** Called when any CTA fires or the session times out. */
    onComplete: () => void;
}

/** After this many ms of dashboard time we assume the user has oriented and
 *  the welcome can step out of the way. 5 minutes feels generous without
 *  leaving the card permanently parked at the top of the page. */
const AUTO_COMPLETE_MS = 5 * 60 * 1000;

/** Storage key for the pre-selected sample handoff between Dashboard and
 *  Compress UI. The tool UI reads this on mount via `useSamplePrefill`
 *  inside `CompressUI`. Kept namespaced + scoped to sessionStorage so the
 *  link doesn't follow the user across browser sessions. */
export const PREFILL_KEY = "privatools.prefill-sample";

export function FirstRunWelcome({ onComplete }: FirstRunWelcomeProps) {
    const navigate = useNavigate();
    const [loadingSample, setLoadingSample] = useState(false);
    const timerRef = useRef<number | null>(null);

    // Auto-graduate after a long delay — if the user is still on the
    // dashboard 5 minutes in, they're not a brand-new visitor anymore
    // and the welcome card shouldn't be there next time.
    useEffect(() => {
        timerRef.current = window.setTimeout(onComplete, AUTO_COMPLETE_MS);
        return () => { if (timerRef.current) window.clearTimeout(timerRef.current); };
    }, [onComplete]);

    const trySample = async () => {
        if (loadingSample) return;
        setLoadingSample(true);
        try {
            const file = await loadSamplePdf();
            // Hand the file to CompressUI via sessionStorage. The tool UI
            // reads + clears the entry on mount.
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    sessionStorage.setItem(
                        PREFILL_KEY,
                        JSON.stringify({ name: file.name, type: file.type, data: reader.result }),
                    );
                } catch {
                    // If sessionStorage is unavailable we still navigate —
                    // the user just has to manually drag the file in.
                }
                onComplete();
                navigate("/tool/compress-pdf");
            };
            reader.readAsDataURL(file);
        } catch (e) {
            console.error("Failed to load sample PDF", e);
            toast.error("Couldn't load the sample PDF. Try opening a tool from the menu instead.");
            setLoadingSample(false);
        }
    };

    const openCmdK = () => {
        onComplete();
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", metaKey: true, bubbles: true }));
    };

    const startTour = () => {
        onComplete();
        window.dispatchEvent(new CustomEvent(START_TOUR_EVENT));
    };

    const dismiss = () => onComplete();

    return (
        <section className="relative mb-10 rounded-2xl border border-accent/35 bg-card overflow-hidden animate-fade-up">
            {/* Corner registration marks for the workshop language */}
            <span className="absolute -top-1 -left-1 h-3 w-3 pointer-events-none">
                <span className="absolute top-0 left-0 h-px w-3 bg-accent" />
                <span className="absolute top-0 left-0 w-px h-3 bg-accent" />
            </span>
            <span className="absolute -top-1 -right-1 h-3 w-3 pointer-events-none">
                <span className="absolute top-0 right-0 h-px w-3 bg-accent" />
                <span className="absolute top-0 right-0 w-px h-3 bg-accent" />
            </span>
            <span className="absolute -bottom-1 -left-1 h-3 w-3 pointer-events-none">
                <span className="absolute bottom-0 left-0 h-px w-3 bg-accent" />
                <span className="absolute bottom-0 left-0 w-px h-3 bg-accent" />
            </span>
            <span className="absolute -bottom-1 -right-1 h-3 w-3 pointer-events-none">
                <span className="absolute bottom-0 right-0 h-px w-3 bg-accent" />
                <span className="absolute bottom-0 right-0 w-px h-3 bg-accent" />
            </span>

            {/* Background flare */}
            <div className="absolute -top-24 -right-20 h-56 w-56 rounded-full bg-accent/15 blur-3xl pointer-events-none" aria-hidden="true" />

            <div className="relative p-6 sm:p-8">
                {/* Header — eyebrow + dismiss */}
                <div className="flex items-start justify-between gap-3 mb-4">
                    <span className="section-mark flex items-center gap-1.5">
                        <Sparkles size={11} className="text-accent" /> Welcome
                    </span>
                    <button
                        type="button"
                        onClick={dismiss}
                        aria-label="Dismiss welcome card"
                        className="h-7 w-7 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors -mt-1 -mr-1"
                    >
                        <X size={13} />
                    </button>
                </div>

                {/* Headline */}
                <h1
                    className="font-display font-bold text-foreground text-[32px] sm:text-[42px] tracking-[-0.03em] leading-[1.05]"
                    style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}
                >
                    Welcome to <span className="italic text-accent">PrivaTools</span>
                </h1>
                <p
                    className="mt-2 font-display text-[17px] sm:text-[19px] text-muted-foreground leading-[1.4] max-w-[44ch]"
                    style={{ fontVariationSettings: '"opsz" 32' }}
                >
                    179 file tools that don't see your files.
                </p>
                <p className="mt-3 max-w-[58ch] text-[14px] sm:text-[14.5px] text-muted-foreground leading-relaxed">
                    PDFs, images, video, code and archives — processed in your browser where possible, or on a server <span className="text-foreground/85 font-medium">you control</span> when a backend is required. No accounts, no third-party file processors, no watermarks.
                </p>

                {/* CTAs */}
                <div className="mt-6 flex flex-wrap gap-2.5">
                    <button
                        type="button"
                        onClick={trySample}
                        disabled={loadingSample}
                        className="btn-accent h-11 px-5 text-[13.5px] gap-2 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        {loadingSample ? (
                            <><Loader2 size={14} className="animate-spin" /> Loading sample…</>
                        ) : (
                            <><FileText size={14} /> Try a sample PDF <ArrowRight size={12} className="opacity-70" /></>
                        )}
                    </button>
                    <button
                        type="button"
                        onClick={openCmdK}
                        className="inline-flex items-center gap-2 h-11 px-5 rounded-md border border-border bg-card text-[13.5px] font-medium text-foreground hover:border-accent/60 hover:bg-accent/[0.04] transition-colors"
                    >
                        <Search size={14} className="text-accent" /> Pick a tool
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md border border-border bg-secondary/60 font-mono text-[10px] text-muted-foreground">⌘K</kbd>
                    </button>
                    <button
                        type="button"
                        onClick={startTour}
                        className="inline-flex items-center gap-2 h-11 px-5 rounded-md border border-border bg-card text-[13.5px] font-medium text-foreground hover:border-accent/60 hover:bg-accent/[0.04] transition-colors"
                    >
                        <PlayCircle size={14} className="text-accent" /> Take the tour
                    </button>
                </div>

                {/* Privacy line — small reassurance + dismiss hint */}
                <div className="mt-5 pt-4 border-t border-border/70 flex items-center gap-2 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground/85">
                    <ShieldCheck size={11} className="text-accent" /> Nothing leaves the container · Self-host with one Docker command
                </div>
            </div>
        </section>
    );
}
