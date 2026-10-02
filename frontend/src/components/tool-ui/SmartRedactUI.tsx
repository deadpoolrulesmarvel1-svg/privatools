import { modelProgress } from "@/lib/modelProgress";
import { AiTaskWorkspace } from "./AiTaskWorkspace";
/**
 * Smart Redact PDF — auto-detects PII (people, organizations, locations,
 * emails, phones, SSNs, credit cards) using a local NER model + regex.
 *
 * Pipeline:
 *  1. pdf.js extracts text (client-side).
 *  2. Regex passes find emails / phones / SSNs / credit cards / dates.
 *  3. @huggingface/transformers loads Xenova/bert-base-NER (~110 MB, cached
 *     in the browser Cache API after first load) and tags PER / ORG / LOC / MISC.
 *  4. UI groups results by type with checkboxes, all on by default.
 *  5. POST /api/smart-redact with the chosen strings; backend searches the
 *     real PDF and applies PyMuPDF redaction annotations (permanent, not a
 *     black overlay). PDF is downloaded.
 *
 * With the on-device model, the PDF *content* never leaves the browser before
 * the user reviews; only the chosen redaction strings are sent server-side for
 * the actual page-level apply step.
 *
 * With BYOK, the document text IS sent to the user's chosen AI provider for
 * the entity pass — that is the whole point of the option, and the UI says so
 * plainly rather than burying it. What the regex pass already found (SSNs,
 * cards, emails, phones) is masked out first, so those specific values never
 * reach the provider. See lib/byok/redactTask.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useByok } from "@/hooks/useByok";
import { ByokPanel } from "@/components/byok/ByokPanel";
import { getBaseUrl, getKey } from "@/lib/byok/keyStore";
import { providerById } from "@/lib/byok/providers";
import { findEntitiesWithByok } from "@/lib/byok/redactTask";
import { ByokError } from "@/lib/byok/errors";
import { configureTransformers } from "@/lib/transformersEnv";
import { Upload, Loader2, AlertCircle, FileText, X, Sparkles, CheckCircle2, ShieldAlert, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";
import { emitToolRun } from "@/lib/toolRun";
import { adviseRejection } from "@/lib/file-acceptance";
import { useToolDefaults } from "@/hooks/useToolDefaults";

const MODEL_ID = "Xenova/bert-base-NER";
type Stage = "idle" | "extracting" | "loading-model" | "scanning" | "review" | "redacting" | "done" | "error";

type EntityType = "PER" | "ORG" | "LOC" | "MISC" | "EMAIL" | "PHONE" | "SSN" | "CARD" | "DATE";

interface Detection {
    text: string;
    type: EntityType;
    /** how many distinct page-hits the regex/NER produced; cosmetic only. */
    occurrences: number;
}

// Each chip names its category in words; the colour only groups. Every pair
// is a designed token pair (the Air/Play papers, or a semantic tone) that
// passes 4.5:1 in all four palettes: the old Tailwind -300 inks were
// dark-theme leftovers at 1.1–1.5:1 on the light papers.
const TYPE_META: Record<EntityType, { label: string; color: string }> = {
    PER:   { label: "People",        color: "bg-destructive/10 text-destructive border-destructive/30" },
    ORG:   { label: "Organizations", color: "bg-[var(--pt-image)] text-[color:var(--pt-image-ink)] border-transparent" },
    LOC:   { label: "Locations",     color: "bg-accent/10 text-accent border-accent/30" },
    MISC:  { label: "Other entities",color: "bg-[var(--pt-panel)] text-[color:var(--pt-muted)] border-[color:var(--pt-line)]" },
    EMAIL: { label: "Emails",        color: "bg-[var(--pt-pdf)] text-[color:var(--pt-pdf-ink)] border-transparent" },
    PHONE: { label: "Phone numbers", color: "bg-[var(--pt-media)] text-[color:var(--pt-media-ink)] border-transparent" },
    SSN:   { label: "SSNs",          color: "bg-warning-soft text-warning border-warning/30" },
    CARD:  { label: "Credit cards",  color: "bg-copper-soft text-copper border-copper/30" },
    DATE:  { label: "Dates",         color: "bg-[var(--pt-code)] text-[color:var(--pt-code-ink)] border-transparent" },
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
        configureTransformers(env);
        return pipeline("token-classification", MODEL_ID, {
            progress_callback: modelProgress(onProgress, 110 * 1024 * 1024),
        });
    })().catch(error => { pipelinePromise = null; throw error; });
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

const SMART_REDACT_DEFAULTS: { color: string } = {
    color: "#000000",
};

export function SmartRedactUI() {
    const [config, , { setField }] = useToolDefaults("smart-redact", SMART_REDACT_DEFAULTS);
    const { color } = config;
    const setColor = useCallback((v: React.SetStateAction<typeof SMART_REDACT_DEFAULTS["color"]>) => setField("color", v), [setField]);
    const [file, setFile] = useState<File | null>(null);
    const [stage, setStage] = useState<Stage>("idle");
    const [progress, setProgress] = useState({ pages: 0, totalPages: 0, modelPercent: 0 });
    const [detections, setDetections] = useState<Detection[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);

    const [resultBlob,setResultBlob] = useState<Blob | null>(null);
    const [hits, setHits] = useState<number | null>(null);
    const [drag, setDrag] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const cancelledRef = useRef(false);
    const runId = useRef(0);
    useEffect(() => () => { runId.current++; cancelledRef.current = true;  }, []);

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
            setError(adviseRejection([fl[0]], { accepts: ".pdf" })?.text ?? "Please pick a PDF file."); return;
        }
        setFile(fl[0]); setError(null); setDetections([]); setSelected(new Set());
        setHits(null); setStage("idle");
    }, []);

    const byok = useByok();
    const [engine, setEngine] = useState<"local" | "byok">("local");
    const [byokModel, setByokModel] = useState("");

    const scan = useCallback(async () => {
        if (!file) return;
        const current = ++runId.current;
        setError(null); setDetections([]); setSelected(new Set());
        cancelledRef.current = false;
        try {
            setStage("extracting");
            const text = await extractPdfText(file, (n, t) =>
                setProgress(p => ({ ...p, pages: n, totalPages: t }))
            );
            if (cancelledRef.current || current !== runId.current) return;
            if (!text.trim()) throw new Error("No extractable text. If this is a scan, run OCR first.");

            // Regex pass — fast, no model needed.
            const regexHits: { text: string; type: EntityType }[] = [];
            for (const { type, re } of REGEX_PASSES) {
                let m: RegExpExecArray | null;
                while ((m = re.exec(text)) !== null) {
                    regexHits.push({ text: m[0].trim(), type });
                }
            }

            // Entity pass. BYOK branches BEFORE the local model loads, so
            // choosing it never downloads ~110 MB the user did not ask for.
            //
            // The regex hits above are passed as knownPii and masked out
            // before anything is sent: this tool exists to remove PII, so
            // shipping the SSNs and card numbers it already found to a third
            // party — in order to find names — would undercut the point.
            if (engine === "byok") {
                if (!byok.ready) throw new Error("Add an API key first, or switch back to the on-device model.");
                const apiKey = await getKey(byok.provider);
                if (!apiKey) throw new Error("That saved key could not be read. Enter it again, or switch back to the on-device model.");
                setStage("scanning");
                const found = await findEntitiesWithByok({
                    providerId: byok.provider,
                    apiKey,
                    baseUrl: getBaseUrl(byok.provider),
                    model: byokModel || providerById(byok.provider)?.models[0] || "",
                    text,
                    knownPii: regexHits.map(h => h.text),
                });
                if (cancelledRef.current || current !== runId.current) return;
                const byokHits = found
                    // Only keep what actually occurs in the document: the model
                    // is asked to copy exactly, but a paraphrase would silently
                    // redact nothing, or the wrong thing.
                    .filter(e => text.includes(e.text))
                    .map(e => ({ text: e.text.trim(), type: (e.type as EntityType) ?? "MISC" }));
                const merged = dedupeDetections([...regexHits, ...byokHits]);
                setDetections(merged);
                setSelected(new Set(merged.map(keyFor)));
                setStage("review");
                return;
            }

            // NER pass — slow first time (model load), fast after.
            setStage("loading-model");
            const ner = (await getNer(percent =>
                setProgress(p => ({ ...p, modelPercent: percent }))
            )) as (input: string, opts?: Record<string, unknown>) => Promise<NerToken[]>;
            if (cancelledRef.current || current !== runId.current) return;

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
                if (cancelledRef.current || current !== runId.current) return;
                const tokens = await ner(chunks[i], { aggregation_strategy: "simple" });
                nerHits.push(...groupNerTokens(tokens));
            }

            if (current !== runId.current || cancelledRef.current) return;
            const all = dedupeDetections([...regexHits, ...nerHits]);
            setDetections(all);
            // Default-on: select everything found. User can uncheck.
            setSelected(new Set(all.map(keyFor)));
            setStage("review");
        } catch (err) {
            if (current !== runId.current || cancelledRef.current) return;
            // ByokError carries wording written for a user and, by
            // construction, no key material. The raw error is kept out of
            // console.error because provider errors can echo the request back.
            const msg = err instanceof ByokError
                ? err.userMessage
                : err instanceof Error ? err.message : "Scan failed";
            if (!(err instanceof ByokError)) console.error(err);
            setError(msg);
            setStage("error");
        }
    }, [file, engine, byokModel, byok.ready, byok.provider]);

    const apply = useCallback(async () => {
        if (!file || selected.size === 0) return;
        const current = ++runId.current; setResultBlob(null);
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
            if (current !== runId.current) return;
            setResultBlob(blob);
            const baseName = file.name.replace(/\.pdf$/i, "");
            downloadBlob(blob, `${baseName}_redacted.pdf`);
            setHits(hitHeader ? parseInt(hitHeader, 10) : null);
            setStage("done");
            emitToolRun({ outcome: "success", files: 1 });
        } catch (err) {
            if (current !== runId.current) return;
            setError(err instanceof Error ? err.message : "Redaction failed");
            setStage("review");
            emitToolRun({ outcome: "error", files: 1 }, err);
        }
    }, [file, selected, detections, color]);

    if (stage === "done") {
        return (
            <AiTaskWorkspace kind="redact" title="Review before you redact" description="Find possible personal information, check every selection, then create a redacted copy." engine={engine} phase={stage}>
                <div className="relative p-7 sm:p-9 animate-corner-extend">
                    <CornerMarks accent />
                    <div className="flex items-start gap-5">
                        <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                            <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">Redacted</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {hits !== null ? <><span className="italic text-accent">{hits}</span> match{hits === 1 ? "" : "es"} removed.</> : <><span className="italic text-accent">Redacted</span> PDF ready.</>}
                            </h2>
                            <p className="font-medium mt-2 text-[12px] text-muted-foreground">
                                {selected.size} selected item{selected.size === 1 ? "" : "s"} submitted for redaction. The match count reports the actual removals.
                            </p>
                            {resultBlob && <button className="pt-lab-button is-primary pt-lab-spaced" onClick={() => downloadBlob(resultBlob, `${file?.name.replace(/\.pdf$/i, "") || "document"}_redacted.pdf`)}><Download size={15}/>Download redacted PDF</button>}
                            <button
                                onClick={() => { setFile(null); setResultBlob(null); setDetections([]); setSelected(new Set()); setStage("idle"); }}
                                className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                            >
                                Redact another PDF
                            </button>
                        </div>
                    </div>
                </div>
            </AiTaskWorkspace>
        );
    }

    return (
        <AiTaskWorkspace kind="redact" title="Review before you redact" description="Find possible personal information, check every selection, then create a redacted copy." engine={engine} phase={stage}>
            {/* Browser-AI banner */}
            <div className="pt-ai-privacy rounded-xl border border-accent/30 bg-accent/[0.05] px-4 py-3 flex items-start gap-3">
                <div className="h-9 w-9 rounded-lg bg-accent/15 border border-accent/30 flex items-center justify-center shrink-0">
                    <ShieldAlert size={15} className="text-accent" />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                        <span className="text-[11px] text-accent font-medium">{engine === "byok" ? "Your AI provider" : "Browser NER"}</span>
                        <span className="font-medium text-[11px] text-muted-foreground">{engine === "byok" ? providerById(byok.provider)?.label ?? "Choose a provider" : "BERT-base · runs locally"}</span>
                    </div>
                    <p className="text-[12.5px] text-foreground leading-relaxed">
                        {engine === "byok" ? <>Detection sends extracted PDF text directly to your chosen AI provider using your key. When you apply, the PDF and selected strings are sent to the PrivaTools server to remove the content, then deleted on response.</> : <><span className="font-medium">Detection happens in your browser.</span> The model + regex passes execute via WebAssembly, so your PDF stays local while PII is found. When you apply, the PDF and your selected strings are sent to our isolated backend for the PyMuPDF redaction, then deleted on response.</>}
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
                        "pt-ai-source dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                        drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
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
                    <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">Pick a PDF to auto-redact</p>
                    <p className="font-medium text-[11.5px] text-muted-foreground">Text-based PDF · OCR first if it's a scan</p>
                </div>
            ) : (
                <div className="pt-ai-source flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3">
                    <div className="h-10 w-10 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                        <FileText size={16} className="text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium text-foreground truncate">{file.name}</p>
                        <p className="font-medium text-[11.5px] text-muted-foreground mt-0.5">{formatFileSize(file.size)}</p>
                    </div>
                    {(stage === "idle" || stage === "review" || stage === "error") && (
                        <button
                            onClick={() => { setFile(null); setDetections([]); setSelected(new Set()); }}
                            className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                            aria-label="Remove file"
                        >
                            <X size={13} />
                        </button>
                    )}
                </div>
            )}

            {/* Progress */}
            {(stage === "extracting" || stage === "loading-model" || stage === "scanning" || stage === "redacting") && (
                <div className="rounded-xl border border-accent/30 bg-accent/[0.04] overflow-hidden">
                    <div className="px-4 py-3 flex items-center gap-3">
                        <Loader2 size={14} className="animate-spin text-accent shrink-0" />
                        <div className="flex-1 min-w-0">
                            <p className="font-display text-[14px] font-medium text-foreground">
                                {stage === "extracting"   && <>Extracting text from PDF</>}
                                {stage === "loading-model" && <>Loading NER model</>}
                                {stage === "scanning"      && <>Scanning for personal information</>}
                                {stage === "redacting"     && <>Applying redactions on the server</>}
                            </p>
                            <p className="font-medium text-[11.5px] text-muted-foreground mt-0.5">
                                {stage === "extracting"   && <>Page {progress.pages}{progress.totalPages ? ` of ${progress.totalPages}` : ""}</>}
                                {stage === "loading-model" && <>{progress.modelPercent}% · one-time, cached</>}
                                {stage === "scanning"      && <>Combining NER + regex patterns</>}
                                {stage === "redacting"     && <>PyMuPDF · permanent removal</>}
                            </p>
                        </div>
                        {(stage === "extracting" || stage === "loading-model" || stage === "scanning") && (
                            <button
                                onClick={() => { runId.current++; cancelledRef.current = true; setStage("idle"); }}
                                className="font-medium text-[11.5px] text-muted-foreground hover:text-foreground transition-colors"
                            >
                                Cancel
                            </button>
                        )}
                    </div>
                    <div className="h-1 bg-paper-2 relative">
                        <div
                            className="h-full bg-accent transition-all"
                            style={{
                                width: stage === "extracting"
                                    ? progress.totalPages ? `${(progress.pages / progress.totalPages) * 100}%` : "10%"
                                    : stage === "loading-model"
                                        ? `${progress.modelPercent}%`
                                        : "60%",
                            }}
                        />
                    </div>
                </div>
            )}

            {error && (
                <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            {/* Engine choice. The warning here is deliberately stronger than
                on Summarize PDF: by definition this document contains the
                personal information the user is trying to remove. */}
            {file && stage === "idle" && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                        <span className="text-accent">§</span> How to find names and organisations
                    </div>
                    <div className="p-3 space-y-3">
                        <p className="text-[12px] text-muted-foreground leading-snug">
                            Emails, phone numbers, SSNs and card numbers are always found here in
                            your browser by pattern matching — no model, no network, either way.
                            This choice only affects how names, organisations and locations are found.
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <button
                                type="button"
                                onClick={() => setEngine("local")}
                                aria-pressed={engine === "local"}
                                className={cn(
                                    "rounded-lg border p-3 text-left transition-colors",
                                    engine === "local" ? "border-accent bg-accent/[0.07]" : "border-border hover:border-accent/40",
                                )}
                            >
                                <span className="block text-[13.5px] font-medium text-foreground">On this device</span>
                                <span className="block text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
                                    Nothing leaves this tab. Downloads a ~110 MB model once. Misses
                                    some names and indirect identifiers.
                                </span>
                            </button>
                            <button
                                type="button"
                                onClick={() => setEngine("byok")}
                                aria-pressed={engine === "byok"}
                                className={cn(
                                    "rounded-lg border p-3 text-left transition-colors",
                                    engine === "byok" ? "border-accent bg-accent/[0.07]" : "border-border hover:border-accent/40",
                                )}
                            >
                                <span className="block text-[13.5px] font-medium text-foreground">My own API key</span>
                                <span className="block text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
                                    Catches far more, including indirect identifiers. Sends the rest
                                    of the document text to your provider.
                                </span>
                            </button>
                        </div>

                        {engine === "byok" && (
                            <>
                                <div className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 space-y-1">
                                    <span className="font-mono text-[11px] tracking-[0.10em] uppercase text-warning font-medium">
                                        § Read this first
                                    </span>
                                    <p className="text-[12px] text-foreground leading-snug">
                                        This document contains the personal information you are trying
                                        to remove. Choosing your own key sends its text to your AI
                                        provider — that is a real trade, and worth a moment's thought
                                        for anything sensitive.
                                    </p>
                                    <p className="text-[11.5px] text-muted-foreground leading-snug">
                                        What we can do, we do: anything the pattern pass already found —
                                        SSNs, card numbers, emails, phone numbers — is replaced with
                                        placeholders before the text is sent, so your provider never
                                        receives those. The remaining text is sent intact, because a
                                        model cannot identify names without the sentences around them.
                                    </p>
                                </div>
                                <ByokPanel
                                    byok={byok}
                                    purpose="Used to find names, organisations and locations in this document."
                                />
                                {byok.ready && (
                                    <label className="block">
                                        <span className="font-mono text-[10px] tracking-[0.08em] uppercase text-muted-foreground">
                                            Model (optional)
                                        </span>
                                        <input
                                            type="text"
                                            value={byokModel}
                                            onChange={e => setByokModel(e.target.value)}
                                            placeholder={providerById(byok.provider)?.models[0] ?? "provider default"}
                                            className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] font-mono"
                                        />
                                    </label>
                                )}
                            </>
                        )}
                    </div>
                </div>
            )}

            {file && stage === "idle" && (
                <button onClick={scan} className="btn-accent">
                    <Sparkles size={13} /> Scan for PII
                </button>
            )}

            {/* Review UI */}
            {stage === "review" && (
                <div className="space-y-4">
                    {/* Review header */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                            <span>Detections — {detections.length} items, {grouped.size} categor{grouped.size === 1 ? "y" : "ies"}</span>
                            <span>{selected.size} selected for redaction</span>
                        </div>
                        <div className="px-4 py-3 flex items-center justify-between gap-3">
                            <p className="text-[13px] text-muted-foreground">
                                Uncheck anything you want to keep — the rest will be permanently redacted.
                            </p>
                            <div className="flex items-center gap-2 shrink-0">
                                <span className="font-medium text-[11.5px] text-muted-foreground">Color</span>
                                <input
                                    type="color"
                                    value={color}
                                    onChange={e => setColor(e.target.value)}
                                    className="h-7 w-9 rounded border border-border bg-transparent cursor-pointer"
                                />
                            </div>
                        </div>
                    </div>

                    {detections.length === 0 ? (
                        <div className="rounded-xl border border-border bg-card p-6 text-center">
                            <p className="font-display text-[16px] text-foreground italic">No personal information detected.</p>
                            <p className="font-medium text-[11.5px] text-muted-foreground mt-2">Use the regular Redact tool to draw rectangles manually.</p>
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
                                    <div key={type} className="rounded-xl border border-border bg-card overflow-hidden">
                                        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-paper-2/40">
                                            <div className="flex items-center gap-2">
                                                <span className={cn("inline-flex items-center px-2 h-6 rounded text-[11px] font-medium border", meta.color)}>
                                                    {meta.label}
                                                </span>
                                                <span className="font-medium text-[11.5px] text-muted-foreground">{items.length} item{items.length === 1 ? "" : "s"}</span>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => toggleType(type, !allOn)}
                                                className="font-medium text-[11.5px] text-muted-foreground hover:text-foreground transition-colors"
                                            >
                                                {allOn ? "Deselect all" : "Select all"}
                                            </button>
                                        </div>
                                        <div className="p-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
                                            {items.map(d => {
                                                const checked = isSelected(d);
                                                return (
                                                    <label
                                                        key={keyFor(d)}
                                                        className={cn(
                                                            "flex items-center gap-2.5 px-2.5 py-1.5 rounded cursor-pointer transition-colors",
                                                            checked ? "bg-accent/[0.06]" : "hover:bg-paper-2/30"
                                                        )}
                                                    >
                                                        <span className={cn(
                                                            "h-4 w-4 rounded border flex items-center justify-center shrink-0",
                                                            checked ? "border-accent bg-accent" : "border-border-strong bg-card"
                                                        )}>
                                                            {checked && <CheckCircle2 size={10} className="text-accent-foreground" strokeWidth={3} />}
                                                        </span>
                                                        <input type="checkbox" checked={checked} onChange={() => toggle(d)} className="sr-only" />
                                                        <span className="text-[13px] text-foreground truncate">{d.text}</span>
                                                        {d.occurrences > 1 && (
                                                            <span className="font-mono text-[10px] text-muted-foreground ml-auto shrink-0">×{d.occurrences}</span>
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
                        <button onClick={apply} disabled={selected.size === 0} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            <ShieldAlert size={13} /> Redact {selected.size} selected
                        </button>
                        <button
                            onClick={() => { setStage("idle"); setDetections([]); setSelected(new Set()); }}
                            className="font-medium text-[12px] tracking-wider text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
                        >
                            Re-scan
                        </button>
                    </div>
                </div>
            )}
        </AiTaskWorkspace>
    );
}

function CornerMarks({ accent }: { accent?: boolean }) {
    const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
    const color = accent ? "bg-accent" : "bg-accent/70";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}>
                <span className={`absolute top-0 left-0 h-px w-3 ${color}`} />
                <span className={`absolute top-0 left-0 w-px h-3 ${color}`} />
            </span>
            <span className={`${cls} -top-1 -right-1`}>
                <span className={`absolute top-0 right-0 h-px w-3 ${color}`} />
                <span className={`absolute top-0 right-0 w-px h-3 ${color}`} />
            </span>
            <span className={`${cls} -bottom-1 -left-1`}>
                <span className={`absolute bottom-0 left-0 h-px w-3 ${color}`} />
                <span className={`absolute bottom-0 left-0 w-px h-3 ${color}`} />
            </span>
            <span className={`${cls} -bottom-1 -right-1`}>
                <span className={`absolute bottom-0 right-0 h-px w-3 ${color}`} />
                <span className={`absolute bottom-0 right-0 w-px h-3 ${color}`} />
            </span>
        </>
    );
}
