/**
 * RemoveWatermarkUI — detect, confirm, remove.
 *
 * Deliberately two-phase. A false positive here deletes content the user
 * wanted and they may not notice for months, so nothing is removed without
 * being shown first and ticked. The preview IS the feature; there is no
 * one-click auto-remove, and adding one later would be a mistake.
 *
 * Each candidate is described in plain language — "Rotated translucent text
 * “CONFIDENTIAL” on 3 of 3 pages" — never as `image_xobject xref=42`, and
 * lossless vs destructive removal is stated per candidate rather than buried.
 */
import { useCallback, useRef, useState } from "react";
import {
    AlertCircle, CheckCircle2, Download, Eraser, FileText, Loader2, RotateCcw, Search, X,
} from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import {
    MAX_FILE_SIZE_LABEL, buildOutputFilename, downloadBlob, formatFileSize, postFormData,
} from "@/lib/api";
import { useToolDefaults } from "@/hooks/useToolDefaults";

interface Candidate {
    id: string;
    kind: string;
    confidence: number;
    pages: number[];
    page_count: number;
    bbox: number[];
    removal: "lossless" | "destructive";
    text?: string;
    label: string;
}

interface DetectResult {
    candidates: Candidate[];
    page_count: number;
    flattened_suspected: boolean;
}

const REMOVE_WATERMARK_DEFAULTS: { autoSelectConfident: boolean } = {
    autoSelectConfident: true,
};

type Phase = "idle" | "detecting" | "review" | "removing" | "done";

export function RemoveWatermarkUI() {
    const [config, , { setField }] = useToolDefaults(
        "remove-watermark", REMOVE_WATERMARK_DEFAULTS,
    );
    const { autoSelectConfident } = config;
    const setAutoSelectConfident = useCallback(
        (v: React.SetStateAction<boolean>) => setField("autoSelectConfident", v),
        [setField],
    );

    const [file, setFile] = useState<File | null>(null);
    const [phase, setPhase] = useState<Phase>("idle");
    const [result, setResult] = useState<DetectResult | null>(null);
    const [chosen, setChosen] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const reset = () => {
        setFile(null); setPhase("idle"); setResult(null);
        setChosen(new Set()); setError(null);
    };

    const detect = useCallback(async (f: File) => {
        setPhase("detecting"); setError(null); setResult(null);
        try {
            const resp = await postFormData("/remove-watermark/detect", () => {
                const fd = new FormData();
                fd.append("file", f, f.name);
                return fd;
            }, { timeoutMs: 300_000 });
            const data = (await resp.json()) as DetectResult;
            setResult(data);
            setChosen(new Set(
                autoSelectConfident
                    ? data.candidates.filter(c => c.confidence >= 0.8 && c.removal === "lossless")
                        .map(c => c.id)
                    : [],
            ));
            setPhase("review");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Detection failed";
            setError(friendlyError(msg, "Couldn't analyse that PDF."));
            setPhase("idle");
        }
    }, [autoSelectConfident]);

    const addFile = (f: File) => {
        if (!f.name.toLowerCase().endsWith(".pdf")) {
            setError("Please choose a PDF."); return;
        }
        setFile(f); void detect(f);
    };

    const apply = async () => {
        if (!file || chosen.size === 0) return;
        setPhase("removing"); setError(null);
        try {
            const resp = await postFormData("/remove-watermark/apply", () => {
                const fd = new FormData();
                fd.append("file", file, file.name);
                fd.append("candidate_ids", JSON.stringify([...chosen]));
                return fd;
            }, { timeoutMs: 300_000 });
            downloadBlob(await resp.blob(), buildOutputFilename(file.name, "no_watermark", "pdf"));
            setPhase("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Removal failed";
            setError(friendlyError(msg, "Couldn't remove that watermark."));
            setPhase("review");
        }
    };

    const toggle = (id: string) => setChosen(prev => {
        const next = new Set(prev);
        next.has(id) ? next.delete(id) : next.add(id);
        return next;
    });

    if (phase === "done") {
        return (
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] p-7 sm:p-9">
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 shrink-0 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="section-mark mb-2">Watermark removed</p>
                        <h2 className="font-display text-[26px] font-bold tracking-[-0.025em]">
                            <span className="italic text-accent">{chosen.size}</span>{" "}
                            watermark{chosen.size !== 1 && "s"} removed
                        </h2>
                        <p className="mt-1 text-[11px] tracking-[0.04em] text-muted-foreground">
                            The rest of the page is untouched
                        </p>
                        <button onClick={reset} className="mt-5 inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-4 text-[13px] font-medium hover:bg-secondary/60">
                            <RotateCcw size={12} /> Clean another PDF
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {!file && (
                <div
                    onDragOver={e => { e.preventDefault(); setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) addFile(e.dataTransfer.files[0]); }}
                    onClick={() => inputRef.current?.click()}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
                    role="button" tabIndex={0} aria-label="Upload a PDF"
                    className={cn(
                        "dropzone-surface rounded-2xl border-2 border-dashed p-10 text-center transition-colors cursor-pointer",
                        drag ? "border-accent bg-accent/[0.04]" : "border-border hover:border-accent/40",
                    )}
                >
                    <Eraser size={22} className="mx-auto text-accent" />
                    <p className="mt-3 font-display text-[19px] font-semibold">Drop a watermarked PDF</p>
                    <p className="font-medium mt-1 text-[11.5px] text-muted-foreground">
                        We show you what we found before removing anything · max {MAX_FILE_SIZE_LABEL}
                    </p>
                    <input ref={inputRef} type="file" accept=".pdf" className="hidden"
                        onChange={e => { if (e.target.files?.[0]) addFile(e.target.files[0]); e.target.value = ""; }} />
                </div>
            )}

            {file && (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-accent/30 bg-accent/12">
                        <FileText size={15} className="text-accent" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-[14px] font-medium">{file.name}</p>
                        <p className="font-medium mt-0.5 text-[11.5px] text-muted-foreground">
                            {formatFileSize(file.size)}
                        </p>
                    </div>
                    <button onClick={reset} aria-label="Remove file"
                        className="inline-flex h-7 w-7 items-center justify-center rounded text-muted-foreground hover:bg-secondary/60 hover:text-foreground">
                        <X size={13} />
                    </button>
                </div>
            )}

            {phase === "detecting" && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-paper-2/40 px-3 py-2.5 text-[13px] text-muted-foreground">
                    <Loader2 size={13} className="animate-spin" /> Looking for watermarks…
                </div>
            )}

            {phase === "review" && result && result.candidates.length === 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-border bg-paper-2/40 px-3 py-2.5 text-[13px] text-muted-foreground">
                    <Search size={13} className="shrink-0" />
                    No watermark found. It may be drawn directly into the page content, which
                    can&apos;t be removed cleanly.
                </div>
            )}

            {phase !== "detecting" && result && result.candidates.length > 0 && (
                <div className="overflow-hidden rounded-xl border border-border bg-card">
                    <div className="font-medium border-b border-border bg-paper-2/40 px-4 py-2 text-[11.5px] text-muted-foreground">
                        Found {result.candidates.length} — tick what to remove
                    </div>
                    <div className="divide-y divide-border">
                        {result.candidates.map(c => (
                            <label key={c.id} className="flex cursor-pointer items-start gap-3 p-3 hover:bg-secondary/30">
                                <input type="checkbox" checked={chosen.has(c.id)} onChange={() => toggle(c.id)}
                                    className="mt-0.5 h-4 w-4 shrink-0 accent-current text-accent" />
                                <span className="min-w-0 flex-1">
                                    <span className="block text-[14px]">{c.label}</span>
                                    <span className="mt-1 flex flex-wrap items-center gap-2">
                                        <span className={cn(
                                            "font-medium rounded px-1.5 py-0.5 text-[11px]",
                                            c.removal === "lossless"
                                                ? "bg-accent/10 text-accent"
                                                : "bg-destructive/10 text-destructive",
                                        )}>
                                            {c.removal === "lossless" ? "Lossless" : "Removes overlapping text"}
                                        </span>
                                        <span className="font-medium text-[11px] text-muted-foreground">
                                            {Math.round(c.confidence * 100)}% confident
                                        </span>
                                    </span>
                                </span>
                            </label>
                        ))}
                    </div>
                    <div className="border-t border-border px-4 py-2.5">
                        <label className="font-medium flex cursor-pointer items-center gap-2 text-[11.5px] text-muted-foreground">
                            <input type="checkbox" checked={autoSelectConfident}
                                onChange={e => setAutoSelectConfident(e.target.checked)}
                                className="h-3.5 w-3.5 accent-current text-accent" />
                            Pre-tick high-confidence matches next time
                        </label>
                    </div>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            {phase === "review" && result && result.candidates.length > 0 && (
                <button onClick={apply} disabled={chosen.size === 0}
                    className="btn-accent disabled:cursor-not-allowed disabled:opacity-60">
                    <Download size={13} /> Remove {chosen.size} and download
                </button>
            )}
            {phase === "removing" && (
                <button disabled className="btn-accent opacity-70">
                    <Loader2 size={13} className="animate-spin" /> Removing…
                </button>
            )}
        </div>
    );
}
