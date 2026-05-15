/**
 * Smart Redact PDF — auto-detects PII (people, organizations, locations,
 * emails, phones, SSNs, credit cards) using a local NER model + regex.
 *
 * Pipeline:
 *  1. pdf.js extracts text (client-side).
 *  2. Regex passes find emails / phones / SSNs / credit cards / dates.
 *  3. @huggingface/transformers loads Xenova/bert-base-NER (~256MB, cached
 *     in IndexedDB after first load) and tags PER / ORG / LOC / MISC.
 *  4. UI groups results by type with checkboxes, all on by default.
 *  5. POST /api/smart-redact with the chosen strings; backend searches the
 *     real PDF and applies PyMuPDF redaction annotations (permanent, not a
 *     black overlay). PDF is downloaded.
 *
 * The PDF *content* never leaves the browser before the user reviews;
 * only the chosen redaction strings are sent server-side for the actual
 * page-level apply step.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { Upload, Loader2, AlertCircle, FileText, X, Sparkles, CheckCircle2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";

const MODEL_ID = "Xenova/bert-base-NER";
type Stage = "idle" | "extracting" | "loading-model" | "scanning" | "review" | "redacting" | "done" | "error";

type EntityType = "PER" | "ORG" | "LOC" | "MISC" | "EMAIL" | "PHONE" | "SSN" | "CARD" | "DATE";

interface Detection {
    text: string;
    type: EntityType;
    /** how many distinct page-hits the regex/NER produced; cosmetic only. */
    occurrences: number;
}

const TYPE_META: Record<EntityType, { label: string; color: string }> = {
    PER:   { label: "People",        color: "bg-rose-500/10 text-rose-300 border-rose-500/30" },
    ORG:   { label: "Organizations", color: "bg-violet-500/10 text-violet-300 border-violet-500/30" },
    LOC:   { label: "Locations",     color: "bg-emerald-500/10 text-emerald-300 border-emerald-500/30" },
    MISC:  { label: "Other entities",color: "bg-slate-500/10 text-slate-300 border-slate-500/30" },
    EMAIL: { label: "Emails",        color: "bg-blue-500/10 text-blue-300 border-blue-500/30" },
    PHONE: { label: "Phone numbers", color: "bg-cyan-500/10 text-cyan-300 border-cyan-500/30" },
    SSN:   { label: "SSNs",          color: "bg-orange-500/10 text-orange-300 border-orange-500/30" },
    CARD:  { label: "Credit cards",  color: "bg-amber-500/10 text-amber-300 border-amber-500/30" },
    DATE:  { label: "Dates",         color: "bg-pink-500/10 text-pink-300 border-pink-500/30" },
};

const REGEX_PASSES: { type: EntityType; re: RegExp }[] = [
    { type: "EMAIL", re: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
    // North American + international phone numbers, conservative
    { type: "PHONE", re: /\b(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g },
    // SSN — exactly 9 digits in 3-2-4 format (not strict — flag for review)
    { type: "SSN",   re: /\b\d{3}-\d{2}-\d{4}\b/g },
    // Credit card — Luhn-validatable later, but flag any 13-19 digit run
    { type: "CARD",  re: /\b(?:\d[ -]*?){13,19}\b/g },
    { type: "DATE",  re: /\b(?:\d{1,2}[/-]\d{1,2}[/-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/g },
];

let pipelinePromise: Promise<unknown> | null = null;
async function getNer(onProgress: (p: number) => void) {
    if (pipelinePromise) return pipelinePromise;
    pipelinePromise = (async () => {
        const { pipeline, env } = await import("@huggingface/transformers");
        env.allowLocalModels = false;
        env.allowRemoteModels = true;
        return pipeline("token-classification", MODEL_ID, {
            progress_callback: (info: { status: string; progress?: number }) => {
                if (info.status === "progress" && typeof info.progress === "number") {
                    onProgress(Math.min(100, Math.max(0, Math.round(info.progress))));
                } else if (info.status === "ready") onProgress(100);
            },
        });
    })();
    return pipelinePromise;
}

async function extractPdfText(file: File, onPage: (n: number, total: number) => void): Promise<string> {
    const pdfjsLib = await import("pdfjs-dist");
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
            .replace(/\s+/g, " ");
        pages.push(text);
        onPage(i, pdf.numPages);
    }
    return pages.join("\n\n");
}

function dedupeDetections(items: { text: string; type: EntityType }[]): Detection[] {
    const counts = new Map<string, Detection>();
    for (const item of items) {
        const key = `${item.type}:${item.text}`;
        const existing = counts.get(key);
        if (existing) existing.occurrences++;
        else counts.set(key, { ...item, occurrences: 1 });
    }
    return Array.from(counts.values()).sort(
        (a, b) => b.occurrences - a.occurrences || a.text.localeCompare(b.text)
    );
}

interface NerToken {
    word: string;
    entity: string;
    entity_group?: string;
    score: number;
}

function groupNerTokens(tokens: NerToken[]): { text: string; type: EntityType }[] {
    // Hugging Face token-classification often returns wordpieces with B-/I- tags.
    // Group consecutive tokens with the same entity type.
    const out: { text: string; type: EntityType }[] = [];
    let current: { text: string; type: EntityType } | null = null;
    for (const tok of tokens) {
        const raw = tok.entity_group || tok.entity || "";
        const tag = raw.replace(/^[BI]-/, "");
        if (!tag || tag === "O") { current = null; continue; }
        const knownType: EntityType =
            tag === "PER" || tag === "ORG" || tag === "LOC" || tag === "MISC" ? tag : "MISC";
        let word = tok.word;
        // BERT-style wordpieces start with ##; strip and concatenate.
        const isContinuation = word.startsWith("##");
        if (isContinuation) word = word.slice(2);
        if (current && current.type === knownType && (raw.startsWith("I-") || isContinuation)) {
            current.text += isContinuation ? word : ` ${word}`;
        } else {
            if (current) out.push(current);
            current = { text: word, type: knownType };
        }
    }
    if (current) out.push(current);
    // Drop short / junk tokens
    return out
        .map(d => ({ ...d, text: d.text.trim() }))
        .filter(d => d.text.length >= 2 && /[A-Za-z]/.test(d.text));
}

export function SmartRedactUI() {
    const [file, setFile] = useState<File | null>(null);
    const [stage, setStage] = useState<Stage>("idle");
    const [progress, setProgress] = useState({ pages: 0, totalPages: 0, modelPercent: 0 });
    const [detections, setDetections] = useState<Detection[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const [color, setColor] = useState<string>("#000000");
    const [hits, setHits] = useState<number | null>(null);
    const [drag, setDrag] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const cancelledRef = useRef(false);

    const grouped = useMemo(() => {
        const map = new Map<EntityType, Detection[]>();
        for (const d of detections) {
            map.set(d.type, [...(map.get(d.type) || []), d]);
        }
        return map;
    }, [detections]);

    const keyFor = (d: Detection) => `${d.type}:${d.text}`;
    const isSelected = (d: Detection) => selected.has(keyFor(d));
    const toggle = (d: Detection) => {
        setSelected(prev => {
            const next = new Set(prev);
            const k = keyFor(d);
            if (next.has(k)) next.delete(k); else next.add(k);
            return next;
        });
    };
    const toggleType = (type: EntityType, on: boolean) => {
        setSelected(prev => {
            const next = new Set(prev);
            for (const d of grouped.get(type) || []) {
                const k = keyFor(d);
                if (on) next.add(k); else next.delete(k);
            }
            return next;
        });
    };

    const onPick = useCallback((fl: FileList | null) => {
        if (!fl || !fl[0]) return;
        if (!fl[0].name.toLowerCase().endsWith(".pdf")) {
            setError("Please pick a PDF file."); return;
        }
        setFile(fl[0]); setError(null); setDetections([]); setSelected(new Set());
        setHits(null); setStage("idle");
    }, []);

    const scan = useCallback(async () => {
        if (!file) return;
        setError(null); setDetections([]); setSelected(new Set());
        cancelledRef.current = false;
        try {
            setStage("extracting");
            const text = await extractPdfText(file, (n, t) =>
                setProgress(p => ({ ...p, pages: n, totalPages: t }))
            );
            if (cancelledRef.current) return;
            if (!text.trim()) throw new Error("No extractable text. If this is a scan, run OCR first.");

            // Regex pass — fast, no model needed.
            const regexHits: { text: string; type: EntityType }[] = [];
            for (const { type, re } of REGEX_PASSES) {
                let m: RegExpExecArray | null;
                while ((m = re.exec(text)) !== null) {
                    regexHits.push({ text: m[0].trim(), type });
                }
            }

            // NER pass — slow first time (model load), fast after.
            setStage("loading-model");
            const ner = (await getNer(percent =>
                setProgress(p => ({ ...p, modelPercent: percent }))
            )) as (input: string, opts?: Record<string, unknown>) => Promise<NerToken[]>;
            if (cancelledRef.current) return;

            setStage("scanning");
            // Run NER in chunks so we don't blow past model context window.
            const sentences = text.split(/(?<=[.!?])\s+/);
            const chunks: string[] = [];
            let buf: string[] = [];
            let bufLen = 0;
            for (const s of sentences) {
                if (bufLen + s.length > 1500 && buf.length) {
                    chunks.push(buf.join(" "));
                    buf = []; bufLen = 0;
                }
                buf.push(s); bufLen += s.length + 1;
            }
            if (buf.length) chunks.push(buf.join(" "));

            const nerHits: { text: string; type: EntityType }[] = [];
            for (let i = 0; i < chunks.length; i++) {
                if (cancelledRef.current) return;
                const tokens = await ner(chunks[i], { aggregation_strategy: "simple" });
                nerHits.push(...groupNerTokens(tokens));
            }

            const all = dedupeDetections([...regexHits, ...nerHits]);
            setDetections(all);
            // Default-on: select everything found. User can uncheck.
            setSelected(new Set(all.map(keyFor)));
            setStage("review");
        } catch (err) {
            console.error(err);
            setError(err instanceof Error ? err.message : "Scan failed");
            setStage("error");
        }
    }, [file]);

    const apply = useCallback(async () => {
        if (!file || selected.size === 0) return;
        setError(null);
        setStage("redacting");
        try {
            const needles = detections
                .filter(d => selected.has(keyFor(d)))
                .map(d => d.text);
            const res = await uploadFile("/smart-redact", file, {
                needles: JSON.stringify(needles),
                color,
                case_sensitive: false,
            });
            const hitHeader = res.headers.get("X-Redact-Hits");
            const blob = await res.blob();
            const baseName = file.name.replace(/\.pdf$/i, "");
            downloadBlob(blob, `${baseName}_redacted.pdf`);
            setHits(hitHeader ? parseInt(hitHeader, 10) : null);
            setStage("done");
        } catch (err) {
            setError(err instanceof Error ? err.message : "Redaction failed");
            setStage("review");
        }
    }, [file, selected, detections, color]);

    if (stage === "done") {
        return (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
                <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
                <h2 className="text-lg font-bold text-foreground mb-1">Redacted!</h2>
                <p className="text-sm text-muted-foreground mb-6">
                    {hits !== null ? <>Permanently removed <span className="font-bold text-foreground">{hits}</span> matches across {selected.size} selected items.</> : "Redacted PDF downloaded."}
                </p>
                <Button variant="outline" className="border-border text-muted-foreground" onClick={() => { setFile(null); setDetections([]); setSelected(new Set()); setStage("idle"); }}>
                    Redact another PDF
                </Button>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Privacy banner */}
            <div className="rounded-xl border border-accent/20 bg-accent/[0.04] px-4 py-3 flex items-start gap-3">
                <ShieldAlert size={16} className="text-primary mt-0.5 shrink-0" />
                <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">PII detection runs in your browser</p>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
                        The NER model + regex passes execute locally via WebAssembly — no document content is sent
                        anywhere during scanning. Only after you've reviewed and confirmed do the chosen strings
                        get sent to your own server (or the demo) to apply real PyMuPDF redactions.
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
                    aria-label="Upload PDF for smart redaction"
                    className={cn(
                        "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-14 px-6 text-center",
                        drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 hover:bg-secondary/40 bg-secondary/20"
                    )}
                >
                    <input ref={inputRef} type="file" accept=".pdf" className="hidden" onChange={e => onPick(e.target.files)} />
                    <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", drag ? "bg-accent/20" : "bg-secondary")}>
                        <Upload size={22} className={drag ? "text-primary" : "text-muted-foreground"} strokeWidth={1.5} />
                    </div>
                    <p className="text-sm font-semibold text-foreground">Pick a PDF to auto-redact</p>
                    <p className="text-xs text-muted-foreground">PDF · text-based (run OCR first if it's a scan)</p>
                </div>
            ) : (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3">
                    <FileText size={18} className="text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                    </div>
                    {(stage === "idle" || stage === "review" || stage === "error") && (
                        <button onClick={() => { setFile(null); setDetections([]); setSelected(new Set()); }} className="text-muted-foreground hover:text-foreground" aria-label="Remove file">
                            <X size={16} />
                        </button>
                    )}
                </div>
            )}

            {/* Progress */}
            {(stage === "extracting" || stage === "loading-model" || stage === "scanning" || stage === "redacting") && (
                <div className="rounded-xl border border-accent/15 bg-accent/[0.03] px-5 py-4 space-y-2">
                    <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Loader2 size={14} className="animate-spin text-primary" />
                        {stage === "extracting"   && <>Extracting text… page {progress.pages}{progress.totalPages ? ` / ${progress.totalPages}` : ""}</>}
                        {stage === "loading-model" && <>Loading PII detection model… {progress.modelPercent}% (one-time, cached for next time)</>}
                        {stage === "scanning"      && <>Scanning for personal information…</>}
                        {stage === "redacting"     && <>Applying redactions on the server…</>}
                    </div>
                    <div className="h-1.5 w-full bg-secondary/60 rounded-full overflow-hidden">
                        <div
                            className="h-full bg-accent/60 transition-all"
                            style={{
                                width: stage === "extracting"
                                    ? progress.totalPages ? `${(progress.pages / progress.totalPages) * 100}%` : "10%"
                                    : stage === "loading-model"
                                        ? `${progress.modelPercent}%`
                                        : "60%",
                            }}
                        />
                    </div>
                    {(stage === "extracting" || stage === "loading-model" || stage === "scanning") && (
                        <button onClick={() => { cancelledRef.current = true; setStage("idle"); }} className="text-xs text-muted-foreground hover:text-foreground">Cancel</button>
                    )}
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle size={15} className="shrink-0" />{error}
                </div>
            )}

            {file && stage === "idle" && (
                <Button onClick={scan} className="glow-primary">
                    <Sparkles size={15} className="mr-1.5" />Scan for PII
                </Button>
            )}

            {/* Review UI */}
            {stage === "review" && (
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <p className="text-sm text-muted-foreground">
                            Found <span className="font-bold text-foreground">{detections.length}</span> distinct items across {grouped.size} categor{grouped.size === 1 ? "y" : "ies"}.
                            <span className="text-muted-foreground/80"> Uncheck anything you want to keep.</span>
                        </p>
                        <div className="flex items-center gap-2 text-xs">
                            <span className="text-muted-foreground">Color:</span>
                            <input type="color" value={color} onChange={e => setColor(e.target.value)} className="h-6 w-8 rounded border border-border bg-transparent" />
                        </div>
                    </div>

                    {detections.length === 0 ? (
                        <div className="rounded-xl border border-border bg-card/40 p-6 text-center text-sm text-muted-foreground">
                            No personal information detected. You can still use the regular Redact tool to draw rectangles.
                        </div>
                    ) : (
                        <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                            {(Object.keys(TYPE_META) as EntityType[]).map(type => {
                                const items = grouped.get(type) || [];
                                if (items.length === 0) return null;
                                const meta = TYPE_META[type];
                                const allOn = items.every(isSelected);
                                const someOn = items.some(isSelected);
                                return (
                                    <div key={type} className="rounded-xl border border-border bg-card/40 p-4">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="flex items-center gap-2">
                                                <span className={cn("inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border", meta.color)}>
                                                    {meta.label}
                                                </span>
                                                <span className="text-xs text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"}</span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => toggleType(type, !allOn)}
                                                className="text-xs text-primary hover:underline"
                                            >
                                                {allOn ? "Deselect all" : someOn ? "Select all" : "Select all"}
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                                            {items.map(d => {
                                                const checked = isSelected(d);
                                                return (
                                                    <label key={keyFor(d)} className={cn("flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-colors", checked ? "bg-accent/[0.05]" : "hover:bg-secondary/40")}>
                                                        <input
                                                            type="checkbox"
                                                            checked={checked}
                                                            onChange={() => toggle(d)}
                                                            className="rounded border-border"
                                                        />
                                                        <span className="text-sm text-foreground truncate">{d.text}</span>
                                                        {d.occurrences > 1 && (
                                                            <span className="text-[10px] text-muted-foreground/85 ml-auto shrink-0">×{d.occurrences}</span>
                                                        )}
                                                    </label>
                                                );
                                            })}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}

                    <div className="flex items-center gap-3 pt-1">
                        <Button onClick={apply} disabled={selected.size === 0} className="glow-primary">
                            <ShieldAlert size={15} className="mr-1.5" />Redact {selected.size} selected
                        </Button>
                        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { setStage("idle"); setDetections([]); setSelected(new Set()); }}>
                            Re-scan
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
}
