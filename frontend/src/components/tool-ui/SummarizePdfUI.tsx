/**
 * Summarize PDF — runs entirely in the browser.
 *
 * 1. pdfjs-dist extracts text from the PDF (client-side).
 * 2. @huggingface/transformers loads a small distilbart-cnn model (~250 MB,
 *    cached in IndexedDB after the first load).
 * 3. Long PDFs are chunked at sentence boundaries and summarized chunk-by-
 *    chunk; the chunk summaries are stitched back together. For very long
 *    docs we run a second-pass summary over the joined chunk summaries to
 *    produce a coherent overview.
 *
 * No file content ever touches the network — the marketing wedge that makes
 * this tool different from iLovePDF / Smallpdf / Adobe AI summarizers.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Upload, Loader2, AlertCircle, FileText, X, Sparkles, CheckCircle2, Download, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatFileSize, downloadBlob } from "@/lib/api";

type Length = "short" | "medium" | "long";
const LENGTH_PARAMS: Record<Length, { max: number; min: number; label: string; desc: string }> = {
    short:  { max: 60,  min: 20, label: "Short",  desc: "1-2 sentences per chunk" },
    medium: { max: 130, min: 50, label: "Medium", desc: "A short paragraph per chunk" },
    long:   { max: 220, min: 90, label: "Long",   desc: "A detailed paragraph per chunk" },
};

const MODEL_ID = "Xenova/distilbart-cnn-6-6";
// Approximate words per chunk (model context ≈ 1024 tokens ≈ 700 words).
const CHUNK_WORDS = 600;
const CHUNK_OVERLAP_WORDS = 50;

type Stage =
    | "idle"
    | "extracting"
    | "loading-model"
    | "summarizing"
    | "done"
    | "error";

interface PageProgress {
    pages: number;
    totalPages: number;
    chunks: number;
    totalChunks: number;
    modelPercent: number; // 0..100
}

let pipelinePromise: Promise<unknown> | null = null;

async function getPipeline(onProgress: (p: number) => void) {
    if (pipelinePromise) return pipelinePromise;
    pipelinePromise = (async () => {
        // Dynamic import keeps the 1.6MB transformers bundle out of the main chunk.
        const { pipeline, env } = await import("@huggingface/transformers");
        // Use the official CDN for model files (cached in IndexedDB after first load).
        env.allowLocalModels = false;
        env.allowRemoteModels = true;
        return pipeline("summarization", MODEL_ID, {
            progress_callback: (info: { status: string; progress?: number }) => {
                if (info.status === "progress" && typeof info.progress === "number") {
                    onProgress(Math.min(100, Math.max(0, Math.round(info.progress))));
                } else if (info.status === "ready") {
                    onProgress(100);
                }
            },
        });
    })();
    return pipelinePromise;
}

async function extractPdfText(file: File, onPage: (n: number, total: number) => void): Promise<string> {
    const pdfjsLib = await import("pdfjs-dist");
    // Configure worker — bundled by Vite via ?url import.
    const workerSrc = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

    const buf = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const text = content.items
            .map((it: unknown) => (it as { str?: string }).str ?? "")
            .join(" ")
            .replace(/\s+/g, " ")
            .trim();
        pages.push(text);
        onPage(i, pdf.numPages);
    }
    return pages.join("\n\n");
}

function chunkBySentence(text: string, maxWords: number, overlapWords: number): string[] {
    const sentences = text
        .replace(/\s+/g, " ")
        .split(/(?<=[.!?])\s+(?=[A-Z(])/g)
        .filter(s => s.trim().length > 0);
    const chunks: string[] = [];
    let current: string[] = [];
    let currentWordCount = 0;
    for (const sent of sentences) {
        const words = sent.split(/\s+/).length;
        if (currentWordCount + words > maxWords && current.length > 0) {
            chunks.push(current.join(" "));
            // Keep last `overlap` words for context continuity.
            const tail = current.join(" ").split(/\s+/).slice(-overlapWords).join(" ");
            current = tail ? [tail, sent] : [sent];
            currentWordCount = current.join(" ").split(/\s+/).length;
        } else {
            current.push(sent);
            currentWordCount += words;
        }
    }
    if (current.length) chunks.push(current.join(" "));
    return chunks;
}

export function SummarizePdfUI() {
    const [file, setFile] = useState<File | null>(null);
    const [length, setLength] = useState<Length>("medium");
    const [stage, setStage] = useState<Stage>("idle");
    const [progress, setProgress] = useState<PageProgress>({ pages: 0, totalPages: 0, chunks: 0, totalChunks: 0, modelPercent: 0 });
    const [summary, setSummary] = useState<string>("");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const cancelledRef = useRef(false);

    // Reset cancellation flag whenever a new run starts.
    useEffect(() => {
        if (stage === "idle" || stage === "done" || stage === "error") cancelledRef.current = false;
    }, [stage]);

    const onPick = useCallback((fl: FileList | null) => {
        if (!fl || !fl[0]) return;
        if (!fl[0].name.toLowerCase().endsWith(".pdf")) {
            setError("Please pick a PDF file.");
            return;
        }
        setFile(fl[0]);
        setError(null);
        setSummary("");
        setStage("idle");
    }, []);

    const run = useCallback(async () => {
        if (!file) return;
        setError(null);
        setSummary("");
        setProgress({ pages: 0, totalPages: 0, chunks: 0, totalChunks: 0, modelPercent: 0 });
        try {
            // 1. Extract text
            setStage("extracting");
            const text = await extractPdfText(file, (n, total) =>
                setProgress(p => ({ ...p, pages: n, totalPages: total }))
            );
            if (cancelledRef.current) return;
            if (!text.trim()) {
                throw new Error("No extractable text found in this PDF. If it's a scan, run OCR first, then try again.");
            }

            // 2. Load model (cached after first run)
            setStage("loading-model");
            const summarizer = (await getPipeline(percent =>
                setProgress(p => ({ ...p, modelPercent: percent }))
            )) as (input: string, opts: { max_length: number; min_length: number }) => Promise<Array<{ summary_text: string }>>;
            if (cancelledRef.current) return;

            // 3. Chunk + summarize
            setStage("summarizing");
            const chunks = chunkBySentence(text, CHUNK_WORDS, CHUNK_OVERLAP_WORDS);
            setProgress(p => ({ ...p, totalChunks: chunks.length, chunks: 0 }));
            const opts = { max_length: LENGTH_PARAMS[length].max, min_length: LENGTH_PARAMS[length].min };

            const partials: string[] = [];
            for (let i = 0; i < chunks.length; i++) {
                if (cancelledRef.current) return;
                const out = await summarizer(chunks[i], opts);
                partials.push(out[0]?.summary_text ?? "");
                setProgress(p => ({ ...p, chunks: i + 1 }));
            }

            // 4. Stitch — for very long docs, second-pass summary of the joined partials
            let final = partials.join("\n\n");
            if (partials.length > 4) {
                const stitchInput = partials.join(" ");
                const stitched = await summarizer(stitchInput, {
                    max_length: Math.max(opts.max_length * 2, 200),
                    min_length: opts.min_length,
                });
                const overview = stitched[0]?.summary_text ?? "";
                final = `Overview\n${overview}\n\nSection summaries\n${partials.map((p, i) => `${i + 1}. ${p}`).join("\n\n")}`;
            }

            setSummary(final.trim());
            setStage("done");
        } catch (err) {
            console.error(err);
            const msg = err instanceof Error ? err.message : "Summarization failed";
            setError(msg);
            setStage("error");
        }
    }, [file, length]);

    const cancel = () => {
        cancelledRef.current = true;
        setStage("idle");
    };

    const copy = () => navigator.clipboard.writeText(summary).catch(() => {});

    const download = () => {
        const blob = new Blob([summary], { type: "text/plain;charset=utf-8" });
        const baseName = file?.name?.replace(/\.pdf$/i, "") || "summary";
        downloadBlob(blob, `${baseName}_summary.txt`);
    };

    return (
        <div className="space-y-4">
            {/* Browser-AI banner — this is the moat */}
            <div className="rounded-xl border border-accent/30 bg-accent/[0.05] px-4 py-3 flex items-start gap-3">
                <div className="h-9 w-9 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center shrink-0">
                    <Sparkles size={15} className="text-accent" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent font-medium">§ Browser AI</span>
                        <span className="font-mono text-[10px] tracking-[0.06em] uppercase text-muted-foreground">distilbart-cnn-6-6 · ~250 MB · cached</span>
                    </div>
                    <p className="text-[12.5px] text-foreground leading-relaxed">
                        <span className="font-medium">Your PDF never leaves this tab.</span> Summarization runs locally via WebAssembly — no AI APIs (OpenAI, Anthropic), and your document is never uploaded. The model itself downloads once from a public CDN, then caches in your browser.
                    </p>
                </div>
            </div>

            {!file ? (
                <div
                    onDragOver={e => { e.preventDefault(); setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={e => { e.preventDefault(); setDrag(false); onPick(e.dataTransfer.files); }}
                    onClick={() => inputRef.current?.click()}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
                    role="button"
                    tabIndex={0}
                    aria-label="Upload PDF to summarize"
                    className={cn(
                        "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                        drag
                            ? "border-accent bg-accent/[0.06]"
                            : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                    )}
                >
                    <CornerMarks />
                    <input ref={inputRef} type="file" accept=".pdf" className="hidden" onChange={e => { onPick(e.target.files); e.target.value = ""; }} />
                    <div className={cn(
                        "h-12 w-12 rounded-xl flex items-center justify-center transition-colors",
                        drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15"
                    )}>
                        <Upload size={20} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">Pick a PDF to summarize</p>
                    <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">Best on text PDFs · OCR first if it's a scan</p>
                </div>
            ) : (
                <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3">
                    <div className="h-10 w-10 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                        <FileText size={16} className="text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium text-foreground truncate">{file.name}</p>
                        <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground mt-0.5">{formatFileSize(file.size)}</p>
                    </div>
                    {stage === "idle" && (
                        <button
                            onClick={() => { setFile(null); setSummary(""); }}
                            aria-label="Remove file"
                            className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <X size={13} />
                        </button>
                    )}
                </div>
            )}

            {/* Length selector */}
            {file && stage === "idle" && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                        <span className="text-accent">§</span> Summary length
                    </div>
                    <div className="p-3 grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {(Object.keys(LENGTH_PARAMS) as Length[]).map((l, idx) => (
                            <button
                                key={l}
                                type="button"
                                onClick={() => setLength(l)}
                                aria-pressed={length === l}
                                className={cn(
                                    "rounded-lg border p-3 text-left transition-colors",
                                    length === l
                                        ? "border-accent bg-accent/[0.06]"
                                        : "border-border hover:border-border-strong hover:bg-paper-2/30"
                                )}
                            >
                                <div className="flex items-baseline gap-2 mb-1">
                                    <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent">{String(idx + 1).padStart(2, "0")}</span>
                                    <p className="font-display text-[14px] font-semibold text-foreground tracking-[-0.015em]">{LENGTH_PARAMS[l].label}</p>
                                </div>
                                <p className="text-[11.5px] text-muted-foreground leading-snug">{LENGTH_PARAMS[l].desc}</p>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Progress */}
            {(stage === "extracting" || stage === "loading-model" || stage === "summarizing") && (
                <div className="rounded-xl border border-accent/30 bg-accent/[0.04] overflow-hidden">
                    <div className="px-4 py-3 flex items-center gap-3">
                        <Loader2 size={14} className="animate-spin text-accent shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="font-display text-[14px] font-medium text-foreground">
                                {stage === "extracting" && <>Extracting text from PDF</>}
                                {stage === "loading-model" && <>Loading AI model</>}
                                {stage === "summarizing" && <>Summarizing chunks</>}
                            </p>
                            <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground mt-0.5">
                                {stage === "extracting" && <>Page {progress.pages}{progress.totalPages ? ` of ${progress.totalPages}` : ""}</>}
                                {stage === "loading-model" && <>{progress.modelPercent}% · one-time download, cached</>}
                                {stage === "summarizing" && <>Chunk {progress.chunks} of {progress.totalChunks}</>}
                            </p>
                        </div>
                        <button
                            onClick={cancel}
                            className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Cancel
                        </button>
                    </div>
                    <div className="h-1 bg-paper-2 relative">
                        <div
                            className="h-full bg-accent transition-all"
                            style={{
                                width: stage === "extracting"
                                    ? progress.totalPages ? `${(progress.pages / progress.totalPages) * 100}%` : "10%"
                                    : stage === "loading-model"
                                        ? `${progress.modelPercent}%`
                                        : progress.totalChunks ? `${(progress.chunks / progress.totalChunks) * 100}%` : "10%",
                            }}
                        />
                    </div>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            {/* Action */}
            {file && stage === "idle" && (
                <div className="flex items-center gap-3 pt-1 flex-wrap">
                    <button onClick={run} className="btn-accent">
                        <Sparkles size={13} /> Summarize this PDF
                    </button>
                    <button
                        onClick={() => { setFile(null); setSummary(""); setError(null); }}
                        className="font-mono text-[11px] tracking-wider uppercase text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
                    >
                        Clear
                    </button>
                </div>
            )}

            {/* Result */}
            {stage === "done" && summary && (
                <div className="rounded-2xl border border-accent/30 bg-accent/[0.04] overflow-hidden">
                    <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border bg-paper-2/40">
                        <div className="flex items-center gap-2 font-mono text-[10.5px] tracking-[0.10em] uppercase text-accent">
                            <CheckCircle2 size={12} />
                            Summary ready
                        </div>
                        <div className="flex items-center gap-1">
                            <button
                                onClick={copy}
                                className="inline-flex items-center gap-1 h-7 px-2 rounded border border-border bg-card font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <Copy size={10} /> Copy
                            </button>
                            <button
                                onClick={download}
                                className="inline-flex items-center gap-1 h-7 px-2 rounded border border-border bg-card font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground hover:text-foreground transition-colors"
                            >
                                <Download size={10} /> .txt
                            </button>
                        </div>
                    </div>
                    <div className="px-5 py-5">
                        <pre
                            className="font-display text-[15px] text-foreground whitespace-pre-wrap leading-[1.65] max-h-[60vh] overflow-y-auto"
                            style={{ fontVariationSettings: '"opsz" 14' }}
                        >
                            {summary}
                        </pre>
                    </div>
                    <div className="px-4 py-2 border-t border-border bg-paper-2/30 flex">
                        <button
                            onClick={() => { setFile(null); setSummary(""); setStage("idle"); }}
                            className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground hover:text-foreground transition-colors"
                        >
                            Summarize another PDF
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

function CornerMarks() {
    const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}>
                <span className="absolute top-0 left-0 h-px w-3 bg-accent/70" />
                <span className="absolute top-0 left-0 w-px h-3 bg-accent/70" />
            </span>
            <span className={`${cls} -top-1 -right-1`}>
                <span className="absolute top-0 right-0 h-px w-3 bg-accent/70" />
                <span className="absolute top-0 right-0 w-px h-3 bg-accent/70" />
            </span>
            <span className={`${cls} -bottom-1 -left-1`}>
                <span className="absolute bottom-0 left-0 h-px w-3 bg-accent/70" />
                <span className="absolute bottom-0 left-0 w-px h-3 bg-accent/70" />
            </span>
            <span className={`${cls} -bottom-1 -right-1`}>
                <span className="absolute bottom-0 right-0 h-px w-3 bg-accent/70" />
                <span className="absolute bottom-0 right-0 w-px h-3 bg-accent/70" />
            </span>
        </>
    );
}
