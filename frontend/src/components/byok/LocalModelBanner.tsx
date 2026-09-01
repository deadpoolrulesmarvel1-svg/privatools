/**
 * Fetches a tool's on-device model the moment the tool opens.
 *
 * Before this, a first-time visitor to Summarize PDF picked a file, pressed
 * run, and then waited on a silent 250 MB download with no indication that
 * anything was happening. Now the download starts on mount and says so.
 *
 * Rendered from `withRealTools`, which is the one place every tool page in
 * every skin passes through, so PDF and non-PDF tools get it alike.
 */

import { useEffect, useRef, useState } from "react";
import { Loader2, Check, HardDrive, RotateCw } from "lucide-react";

import { LOCAL_MODELS, listCachedModels, type LocalModelInfo } from "@/lib/localModels";

/**
 * The model a slug needs, or undefined.
 *
 * `LOCAL_MODELS` order decides ties: Transcribe Audio lists Whisper Tiny
 * before Whisper Base, so the small one is what we fetch unprompted. Anyone
 * who wants the accurate one can still install it from the AI hub.
 */
const BY_SLUG = new Map<string, LocalModelInfo>();
for (const m of LOCAL_MODELS) {
    const slug = m.toolHref.replace(/^#\/tools?\//, "");
    if (!BY_SLUG.has(slug)) BY_SLUG.set(slug, m);
}

type Phase = "checking" | "idle" | "downloading" | "ready" | "error";

/** Whether the visitor asked their browser not to burn data. */
function saveDataOn(): boolean {
    const c = (navigator as { connection?: { saveData?: boolean } }).connection;
    return c?.saveData === true;
}

export function LocalModelBanner({ slug }: { slug: string }) {
    const model = BY_SLUG.get(slug);
    const [phase, setPhase] = useState<Phase>("checking");
    const [pct, setPct] = useState(0);
    const [err, setErr] = useState("");
    // StrictMode mounts twice in development; without this the download starts
    // twice and the two progress streams fight over the same number.
    const started = useRef(false);
    // Set by the effect so the retry button can call it. A ref rather than a
    // window global: two banners must not clobber each other's handler.
    const beginRef = useRef<() => void>(() => {});

    useEffect(() => {
        if (!model) return;
        let alive = true;

        const begin = async () => {
            if (started.current) return;
            started.current = true;
            setPhase("downloading");
            setPct(0);
            try {
                await model.predownload((p) => { if (alive) setPct(p); });
                if (alive) { setPct(100); setPhase("ready"); }
            } catch (e) {
                started.current = false;
                if (alive) {
                    setErr(e instanceof Error ? e.message : "The download did not finish.");
                    setPhase("error");
                }
            }
        };

        (async () => {
            try {
                const cached = await listCachedModels();
                if (!alive) return;
                // A model whose weights are missing shows up as a tiny entry —
                // config and tokenizer only. Treat that as not installed.
                const have = cached.some((c) => c.hfId === model.hfId && c.bytes > 1_000_000);
                if (have) { setPhase("ready"); setPct(100); return; }
                if (saveDataOn()) { setPhase("idle"); return; }
                void begin();
            } catch {
                if (alive) setPhase("idle");
            }
        })();

        beginRef.current = () => { void begin(); };
        return () => { alive = false; };
    }, [model]);

    // Nothing to fetch, still looking, or it was already here when we arrived:
    // say nothing. A banner that announces a no-op is noise.
    if (!model || phase === "checking") return null;
    if (phase === "ready" && pct === 100 && !started.current) return null;

    const retry = () => beginRef.current();

    return (
        <div
            className="mb-4 rounded-xl border border-border bg-card px-4 py-3"
            role="status"
            aria-live="polite"
        >
            <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-secondary">
                    {phase === "downloading" && <Loader2 size={14} className="animate-spin text-accent" />}
                    {phase === "ready" && <Check size={14} className="text-accent" />}
                    {phase === "idle" && <HardDrive size={14} className="text-muted-foreground" />}
                    {phase === "error" && <RotateCw size={14} className="text-destructive" />}
                </div>

                <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-foreground">
                        {phase === "downloading" && `Getting this tool ready — ${pct}%`}
                        {phase === "ready" && "Ready. This tool runs on your device."}
                        {phase === "idle" && `This tool needs a ${model.approxLabel.replace("~", "")} model`}
                        {phase === "error" && "The model could not download"}
                    </p>
                    <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                        {phase === "downloading"
                            && `${model.label} downloads once into this browser, then works every visit, even offline.`}
                        {phase === "ready"
                            && "Nothing you run here is uploaded."}
                        {phase === "idle"
                            && "Your browser is set to save data, so it is not downloading on its own."}
                        {phase === "error" && err}
                    </p>
                </div>

                {(phase === "idle" || phase === "error") && (
                    <button
                        type="button"
                        onClick={retry}
                        className="shrink-0 rounded-lg border border-border bg-card px-3 py-1.5 text-[12px] font-semibold text-foreground transition-colors hover:border-border-strong"
                    >
                        {phase === "error" ? "Try again" : "Download"}
                    </button>
                )}
            </div>

            {phase === "downloading" && (
                <div className="mt-2.5 h-1 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                        className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out"
                        style={{ width: `${Math.max(2, pct)}%` }}
                    />
                </div>
            )}
        </div>
    );
}
