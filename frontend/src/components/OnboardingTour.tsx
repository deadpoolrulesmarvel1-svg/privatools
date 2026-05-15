import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { X, ArrowRight, Shield, Layers, Search, Sparkles, GitBranch } from "lucide-react";
import { cn } from "@/lib/utils";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";

const STORAGE_KEY = "privatools_onboarding_done";
const TOOL_TOTAL = tools.length + nonPdfTools.length;

interface Step {
    icon: typeof Shield;
    title: string;
    description: string;
}

const steps: Step[] = [
    {
        icon: Shield,
        title: "Self-hosted by default",
        description: "Open-source under MIT — run it on your own infrastructure with one Docker command. Files stay on hardware you control.",
    },
    {
        icon: Layers,
        title: `${TOOL_TOTAL}+ tools, one place`,
        description: "PDF, image, video, audio, and developer utilities. All free. No accounts, no upsells, no watermarks.",
    },
    {
        icon: Sparkles,
        title: "Local AI, no third-party",
        description: "Summarize PDFs and detect PII without sending anything to OpenAI. The model runs in your browser via WebAssembly.",
    },
    {
        icon: GitBranch,
        title: "Pipeline — industry first",
        description: "Chain merge → compress → watermark in one click. No competitor offers this.",
    },
    {
        icon: Search,
        title: "⌘K to search anything",
        description: "Press ⌘K (or Ctrl+K) anytime to jump straight to a tool, or press ? to see all keyboard shortcuts.",
    },
];

export function OnboardingTour() {
    const [show, setShow] = useState(false);
    const [step, setStep] = useState(0);

    useEffect(() => {
        try {
            if (!localStorage.getItem(STORAGE_KEY)) {
                // Show after a short delay so the page loads first
                const t = setTimeout(() => setShow(true), 1200);
                return () => clearTimeout(t);
            }
        } catch { }
    }, []);

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
            {/* Backdrop */}
            <button
                type="button"
                aria-label="Close tutorial"
                className="fixed inset-0 z-[200] bg-black/50 backdrop-blur-sm animate-in fade-in-0 duration-200 cursor-default"
                onClick={dismiss}
            />

            {/* Modal */}
            <div role="dialog" aria-modal="true" aria-labelledby="onboarding-title" className="fixed inset-x-0 top-[20vh] z-[201] mx-auto w-full max-w-sm px-5 animate-in fade-in-0 slide-in-from-bottom-4 duration-300">
                <div className="rounded-2xl border border-border/60 bg-card shadow-2xl shadow-black/50 overflow-hidden">
                    {/* Header */}
                    <div className="relative px-6 pt-8 pb-4 text-center">
                        <button onClick={dismiss} aria-label="Close tutorial" className="absolute top-3 right-3 text-muted-foreground/85 hover:text-muted-foreground">
                            <X size={16} aria-hidden="true" />
                        </button>

                        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 border border-primary/20 mx-auto mb-4">
                            <Icon size={24} className="text-primary" />
                        </div>

                        <h3 id="onboarding-title" className="text-lg font-bold text-foreground mb-1">{current.title}</h3>
                        <p className="text-[13px] text-muted-foreground leading-relaxed">{current.description}</p>
                    </div>

                    {/* Dots + action */}
                    <div className="px-6 pb-6 flex items-center justify-between">
                        <div className="flex gap-1.5">
                            {steps.map((_, i) => (
                                <div
                                    key={i}
                                    className={cn(
                                        "h-1.5 rounded-full transition-all duration-300",
                                        i === step ? "w-5 bg-primary" : "w-1.5 bg-secondary"
                                    )}
                                />
                            ))}
                        </div>

                        <button
                            onClick={next}
                            className="flex items-center gap-1.5 h-9 px-4 rounded-xl bg-primary text-primary-foreground text-[13px] font-semibold hover:bg-primary/90 transition-all"
                        >
                            {step < steps.length - 1 ? (
                                <>Next <ArrowRight size={13} /></>
                            ) : (
                                "Get Started"
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
}
