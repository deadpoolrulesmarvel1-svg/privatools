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
import { Button } from "@/components/ui/button";
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
            {/* Privacy banner — this is the moat */}
            <div className="rounded-xl border border-accent/20 bg-accent/[0.04] px-4 py-3 flex items-start gap-3">
                <Sparkles size={16} className="text-primary mt-0.5 shrink-0" />
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">100% browser-based AI</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                        Your PDF never leaves this tab. The summarization model runs locally via WebAssembly — no calls to OpenAI,
                        Anthropic, or any other server. First load downloads the ~250 MB model and caches it for next time.
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
                        "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-14 px-6 text-center",
                        drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 hover:bg-secondary/40 bg-secondary/20"
                    )}
                >
                    <input ref={inputRef} type="file" accept=".pdf" className="hidden" onChange={e => onPick(e.target.files)} />
                    <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", drag ? "bg-accent/20" : "bg-secondary")}>
                        <Upload size={22} className={drag ? "text-primary" : "text-muted-foreground"} strokeWidth={1.5} />
                    </div>
                    <p className="text-sm font-semibold text-foreground">Pick a PDF to summarize</p>
                    <p className="text-xs text-muted-foreground">PDF only · best on text-based PDFs (run OCR first if it's a scan)</p>
                </div>
            ) : (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3">
                    <FileText size={18} className="text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                    </div>
                    {stage === "idle" && (
                        <button onClick={() => { setFile(null); setSummary(""); }} aria-label="Remove file" className="text-muted-foreground hover:text-foreground">
                            <X size={16} />
                        </button>
                    )}
                </div>
            )}

            {/* Length selector */}
            {file && stage === "idle" && (
                <div className="rounded-xl border border-border bg-card/40 p-5">
                    <p className="text-sm font-semibold text-foreground mb-2">Summary length</p>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {(Object.keys(LENGTH_PARAMS) as Length[]).map(l => (
                            <button
                                key={l}
                                type="button"
                                onClick={() => setLength(l)}
                                aria-pressed={length === l}
                                className={cn(
                                    "rounded-lg border p-2 text-left transition-all",
                                    length === l ? "border-accent bg-accent/5" : "border-border hover:border-border/70 hover:bg-secondary/40"
                                )}
                            >
                                <p className="text-xs font-medium text-foreground">{LENGTH_PARAMS[l].label}</p>
                                <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{LENGTH_PARAMS[l].desc}</p>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* Progress */}
            {(stage === "extracting" || stage === "loading-model" || stage === "summarizing") && (
                <div className="rounded-xl border border-accent/15 bg-accent/[0.03] px-5 py-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Loader2 size={14} className="animate-spin text-primary" />
                        {stage === "extracting" && (
                            <>Extracting text… page {progress.pages}{progress.totalPages ? ` of ${progress.totalPages}` : ""}</>
                        )}
                        {stage === "loading-model" && (
                            <>Loading AI model… {progress.modelPercent}% (one-time download, cached for next time)</>
                        )}
                        {stage === "summarizing" && (
                            <>Summarizing… chunk {progress.chunks} of {progress.totalChunks}</>
                        )}
                    </div>
                    <div className="h-1.5 w-full bg-secondary/60 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-accent/60 transition-all"
                            style={{
                                width: stage === "extracting"
                                    ? progress.totalPages ? `${(progress.pages / progress.totalPages) * 100}%` : "10%"
                                    : stage === "loading-model"
                                        ? `${progress.modelPercent}%`
                                        : progress.totalChunks ? `${(progress.chunks / progress.totalChunks) * 100}%` : "10%",
                            }}
                        />
                    </div>
                    <button onClick={cancel} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle size={15} className="shrink-0" />{error}
                </div>
            )}

            {/* Action */}
            {file && stage === "idle" && (
                <div className="flex gap-3 pt-1">
                    <Button onClick={run} className="glow-primary">
                        <Sparkles size={15} className="mr-1.5" />Summarize this PDF
                    </Button>
                    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { setFile(null); setSummary(""); setError(null); }}>
                        Clear
                    </Button>
                </div>
            )}

            {/* Result */}
            {stage === "done" && summary && (
                <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 space-y-4">
                    <div className="flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <CheckCircle2 size={18} className="text-emerald-400" />
                            <p className="text-sm font-semibold text-foreground">Summary ready</p>
                        </div>
                        <div className="flex gap-2">
                            <Button variant="outline" size="sm" className="border-border" onClick={copy}>
                                <Copy size={13} className="mr-1.5" />Copy
                            </Button>
                            <Button variant="outline" size="sm" className="border-border" onClick={download}>
                                <Download size={13} className="mr-1.5" />Download .txt
                            </Button>
                        </div>
                    </div>
                    <pre className="text-sm text-foreground whitespace-pre-wrap leading-relaxed bg-background/40 rounded-lg p-4 border border-border/40 max-h-[60vh] overflow-y-auto font-serif-body">
                        {summary}
                    </pre>
                    <Button
                        variant="outline"
                        size="sm"
                        className="border-border text-muted-foreground"
                        onClick={() => { setFile(null); setSummary(""); setStage("idle"); }}
                    >
                        Summarize another PDF
                    </Button>
                </div>
            )}
        </div>
    );
}
