import { useState, useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { X, ArrowRight, Shield, Layers, Sparkles, GitBranch, Star, MousePointerSquareDashed } from "lucide-react";
import { cn } from "@/lib/utils";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";
import { START_TOUR_EVENT } from "@/lib/events";

const STORAGE_KEY = "privatools_onboarding_done";
const TOOL_TOTAL = tools.length + nonPdfTools.length;

interface Step {
    icon: typeof Shield;
    title: string;
    description: string;
}

const steps: Step[] = [
    {
        icon: Sparkles,
        title: "Welcome to PrivaTools",
        description: `${TOOL_TOTAL} file tools — PDF, image, video, audio, developer — browser-only where possible, self-hosted when processing needs a server. No accounts, no watermarks. Free and open-source under MIT.`,
    },
    {
        icon: MousePointerSquareDashed,
        title: "Drop a file anywhere",
        description: "Drag any file onto this page and we'll match it to every tool that handles it. Prefer the keyboard? Press ⌘K (or Ctrl+K) to search by name.",
    },
    {
        icon: Layers,
        title: "Organized by suite",
        description: "PDF, Image, Video, Developer, Archive and Office. Browse a suite from the left sidebar — each tool keeps its inputs, options and output in one panel.",
    },
    {
        icon: Shield,
        title: "No third-party file processors",
        description: "Server-side jobs use isolated temporary storage on the PrivaTools backend and are deleted after the response. Self-hosted? One Docker command and the whole stack runs on your hardware.",
    },
    {
        icon: GitBranch,
        title: "Pipelines & local AI",
        description: "Chain merge → compress → watermark in one click. Summarize in-browser, detect Smart Redact entities in-browser, and apply approved redactions on the isolated backend — no OpenAI, no cloud GPU.",
    },
    {
        icon: Star,
        title: "Star a tool to pin it",
        description: "The star next to any tool's title pins it to the sidebar for one-click access. Press ? anytime to see every keyboard shortcut.",
    },
];

export function OnboardingTour() {
    const [show, setShow] = useState(false);
    const [step, setStep] = useState(0);
    const location = useLocation();
    const previouslyFocused = useRef<HTMLElement | null>(null);
    const dialogRef = useRef<HTMLDivElement | null>(null);
    const nextBtnRef = useRef<HTMLButtonElement | null>(null);

    // Listen for an explicit "start the tour" event dispatched by the Dashboard
    // welcome card. We honor this even if the tour has been dismissed before —
    // re-opening the tour on demand is the user's intent.
    useEffect(() => {
        const handler = () => {
            setStep(0);
            setShow(true);
        };
        window.addEventListener(START_TOUR_EVENT, handler);
        return () => window.removeEventListener(START_TOUR_EVENT, handler);
    }, []);

    useEffect(() => {
        // The auto-show behavior only fires on the homepage. Visitors landing
        // on a deep tool URL (e.g. from Google) already have an obvious task
        // in front of them — opening a modal would force them to dismiss it
        // before they can engage.
        //
        // The Dashboard's first-run welcome card now invites the tour
        // explicitly, so we no longer auto-pop the modal on first visit. The
        // STORAGE_KEY is still respected (manual `?tour=1` queries, etc.)
        // and kept in localStorage for back-compat with older sessions.
        if (location.pathname !== "/") return;

        // Allow ?tour=1 (or #tour) to force-open. Useful for QA + links from
        // marketing pages that say "show me how it works".
        const url = new URL(window.location.href);
        if (url.searchParams.get("tour") === "1" || url.hash === "#tour") {
            setStep(0);
            const t = setTimeout(() => setShow(true), 250);
            return () => clearTimeout(t);
        }
    }, [location.pathname]);

    // Focus management — when the tour opens, remember the previously focused
    // element and move focus to the primary CTA. On close, restore focus.
    // Escape closes the dialog so the user can always escape without a mouse.
    useEffect(() => {
        if (show) {
            previouslyFocused.current = document.activeElement as HTMLElement | null;
            requestAnimationFrame(() => nextBtnRef.current?.focus());
            const onKey = (e: KeyboardEvent) => {
                if (e.key === "Escape") {
                    e.preventDefault();
                    setShow(false);
                    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { }
                }
                // Focus trap
                if (e.key === "Tab" && dialogRef.current) {
                    const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
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
                }
            };
            document.addEventListener("keydown", onKey);
            return () => document.removeEventListener("keydown", onKey);
        } else if (previouslyFocused.current) {
            if (document.contains(previouslyFocused.current)) {
                previouslyFocused.current.focus();
            }
            previouslyFocused.current = null;
        }
    }, [show]);

    const dismiss = () => {
        setShow(false);
        try { localStorage.setItem(STORAGE_KEY, "1"); } catch { }
    };

    const next = () => {
        if (step < steps.length - 1) {
            setStep(step + 1);
        } else {
            dismiss();
        }
    };

    if (!show) return null;

    const current = steps[step];
    const Icon = current.icon;

    return (
        <>
            {/* Backdrop — non-focusable */}
            <button
                type="button"
                aria-label="Close tutorial"
                tabIndex={-1}
                className="fixed inset-0 z-[200] bg-foreground/35 backdrop-blur-md animate-in fade-in-0 duration-200 cursor-default"
                onClick={dismiss}
            />

            {/* Modal */}
            <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="onboarding-title"
                aria-describedby="onboarding-desc"
                className="fixed inset-x-0 top-[18vh] z-[201] mx-auto w-full max-w-md px-5 animate-in fade-in-0 slide-in-from-bottom-4 duration-300"
            >
                <div
                    className="rounded-2xl border border-border-strong overflow-hidden shadow-[0_30px_60px_-20px_rgba(20,15,5,0.35)] dark:shadow-[0_30px_60px_-20px_rgba(0,0,0,0.7)]"
                    style={{ background: "hsl(var(--background))" }}
                >
                    {/* Dateline header */}
                    <div className="px-5 py-2 border-b border-border bg-paper-2/50 flex items-center justify-between font-mono text-[10px] tracking-[0.12em] uppercase text-muted-foreground">
                        <span><span className="text-accent">§</span> Welcome · {String(step + 1).padStart(2, "0")} / {String(steps.length).padStart(2, "0")}</span>
                        <button
                            onClick={dismiss}
                            aria-label="Close tutorial"
                            className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <X size={11} />
                        </button>
                    </div>

                    {/* Content */}
                    <div className="px-7 pt-8 pb-4">
                        <div className="h-14 w-14 rounded-2xl bg-accent/12 border border-accent/35 mb-5 flex items-center justify-center">
                            <Icon size={22} className="text-accent" strokeWidth={1.75} />
                        </div>

                        <h3
                            id="onboarding-title"
                            className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-[1.05] mb-3"
                            style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}
                        >
                            {current.title}
                        </h3>
                        <p id="onboarding-desc" className="font-display text-[15.5px] text-muted-foreground leading-[1.55]" style={{ fontVariationSettings: '"opsz" 14' }}>
                            {current.description}
                        </p>
                    </div>

                    {/* Footer — dots + actions */}
                    <div className="px-7 py-4 border-t border-border bg-paper-2/30 flex items-center justify-between">
                        <div
                            className="flex gap-1.5"
                            role="progressbar"
                            aria-valuenow={step + 1}
                            aria-valuemin={1}
                            aria-valuemax={steps.length}
                            aria-label={`Step ${step + 1} of ${steps.length}`}
                        >
                            {steps.map((_, i) => (
                                <div
                                    key={i}
                                    aria-hidden="true"
                                    className={cn(
                                        "h-1.5 rounded-full transition-all duration-300",
                                        i === step
                                            ? "w-6 bg-accent"
                                            : i < step
                                                ? "w-1.5 bg-accent/40"
                                                : "w-1.5 bg-border"
                                    )}
                                />
                            ))}
                        </div>

                        <div className="flex items-center gap-2">
                            <button
                                onClick={dismiss}
                                className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground hover:text-foreground transition-colors px-2"
                            >
                                Skip
                            </button>
                            <button
                                ref={nextBtnRef}
                                onClick={next}
                                className="btn-accent"
                            >
                                {step < steps.length - 1 ? (
                                    <>Next <ArrowRight size={13} aria-hidden="true" /></>
                                ) : (
                                    "Get started"
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </>
    );
}
