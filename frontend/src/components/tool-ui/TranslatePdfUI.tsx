/**
 * TranslatePdfUI — translate a PDF's text without it leaving the device.
 *
 * Foxit, Nitro, LightPDF and TinyWow all ship document translation; we had
 * none. All of them do it on their servers.
 *
 * This runs the whole pipeline locally: pdf.js extracts the text, an OPUS-MT
 * model runs in the browser through transformers.js, and the result is written
 * out with the File System / Blob APIs. Same local-first arrangement as
 * Summarize PDF and Smart Redact.
 *
 * The one exception is explicit and opt-in: "Save as PDF" posts the *translated
 * text* (never the original document) to the existing text-to-PDF renderer,
 * because there is no PDF writer in the browser bundle. It is labelled as such
 * at the point of use rather than in a policy page.
 */
import { useState, useCallback, useRef } from "react";
import {
    Loader2, AlertCircle, CheckCircle2, Languages, RotateCcw, Download,
    FileText, Copy, Check, Ban,
} from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile, downloadBlob } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";
import { chunkForTranslation } from "@/lib/translate/chunk";
import {
    APPROX_MODEL_MB,
    availableSources,
    languageName,
    modelIdFor,
    targetsFor,
} from "@/lib/translate/languages";
import { useByok } from "@/hooks/useByok";
import { ByokPanel } from "@/components/byok/ByokPanel";
import { getBaseUrl, getKey } from "@/lib/byok/keyStore";
import { providerById } from "@/lib/byok/providers";
import { translateWithByok } from "@/lib/byok/tasks";
import { ByokError } from "@/lib/byok/errors";

/** Targets offered on the BYOK engine — an LLM translates any of these, far
 *  beyond the one-directional OPUS pairs, and detects the source itself. */
const BYOK_LANGS = [
    "English", "Spanish", "French", "German", "Italian", "Portuguese", "Dutch",
    "Polish", "Ukrainian", "Russian", "Turkish", "Arabic", "Hebrew", "Hindi",
    "Bengali", "Indonesian", "Vietnamese", "Thai", "Chinese (Simplified)",
    "Chinese (Traditional)", "Japanese", "Korean", "Swedish", "Norwegian",
    "Danish", "Finnish", "Czech", "Romanian", "Greek", "Hungarian",
];

type Phase = "idle" | "extracting" | "loading-model" | "translating" | "done";

interface TranslatedPage {
    page: number;
    source: string;
    translated: string;
}

// One pipeline per model id, kept across runs so switching back to a language
// you've already used doesn't re-download 107 MB.
const pipelineCache = new Map<string, Promise<unknown>>();

async function getTranslator(modelId: string, onProgress: (pct: number) => void) {
    const cached = pipelineCache.get(modelId);
    if (cached) { onProgress(100); return cached; }

    const promise = (async () => {
        // Dynamic import keeps the transformers bundle out of the main chunk.
        const { pipeline, env } = await import("@huggingface/transformers");
        env.allowLocalModels = false;
        env.allowRemoteModels = true;
        return pipeline("translation", modelId, {
            progress_callback: (info: { status: string; progress?: number }) => {
                if (info.status === "progress" && typeof info.progress === "number") {
                    onProgress(Math.min(100, Math.max(0, Math.round(info.progress))));
                } else if (info.status === "ready") {
                    onProgress(100);
                }
            },
        });
    })();
    pipelineCache.set(modelId, promise);
    try {
        return await promise;
    } catch (e) {
        // A failed download must not poison the cache — the next attempt should
        // be allowed to retry rather than replaying the same rejection.
        pipelineCache.delete(modelId);
        throw e;
    }
}

async function extractPages(
    file: File,
    onPage: (n: number, total: number) => void,
): Promise<string[]> {
    const pdfjsLib = await import("pdfjs-dist");
    const workerSrc = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
    pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
        const content = await (await pdf.getPage(i)).getTextContent();
        pages.push(
            content.items
                .map((it: unknown) => (it as { str?: string }).str ?? "")
                .join(" ")
                .replace(/\s+/g, " ")
                .trim(),
        );
        onPage(i, pdf.numPages);
    }
    return pages;
}

export function TranslatePdfUI() {
    const byok = useByok();
    const [engine, setEngine] = useState<"local" | "byok">("local");
    const [byokTarget, setByokTarget] = useState("French");
    const [byokModel, setByokModel] = useState("");
    const abortRef = useRef<AbortController | null>(null);
    const [file, setFile] = useState<File | null>(null);
    const [source, setSource] = useState("en");
    const [target, setTarget] = useState("fr");
    const [phase, setPhase] = useState<Phase>("idle");
    const [error, setError] = useState<string | null>(null);
    const [pages, setPages] = useState<TranslatedPage[]>([]);
    const [pageProgress, setPageProgress] = useState({ done: 0, total: 0 });
    const [modelPct, setModelPct] = useState(0);
    const [chunkProgress, setChunkProgress] = useState({ done: 0, total: 0 });
    const [copied, setCopied] = useState(false);
    const [savingPdf, setSavingPdf] = useState(false);
    const cancelRef = useRef(false);

    const targets = targetsFor(source);
    const validPair = modelIdFor(source, target) !== null;

    const onSourceChange = (next: string) => {
        setSource(next);
        const allowed = targetsFor(next);
        if (!allowed.includes(target)) setTarget(allowed[0] ?? "");
    };

    const reset = () => {
        cancelRef.current = false;
        setFile(null); setPhase("idle"); setPages([]); setError(null);
        setModelPct(0); setChunkProgress({ done: 0, total: 0 });
        setPageProgress({ done: 0, total: 0 });
    };

    const translate = useCallback(async () => {
        const modelId = modelIdFor(source, target);
        if (!file) return;
        if (engine === "local" && !modelId) return;
        cancelRef.current = false;
        setError(null); setPages([]);

        try {
            setPhase("extracting");
            const raw = await extractPages(file, (n, total) =>
                setPageProgress({ done: n, total }));
            if (cancelRef.current) return;

            const withText = raw
                .map((text, i) => ({ page: i + 1, text }))
                .filter(p => p.text.length > 0);
            if (withText.length === 0) {
                setError("No selectable text found — run the PDF through OCR first.");
                setPhase("idle");
                return;
            }

            if (engine === "byok") {
                if (!byok.ready) throw new Error("Add an API key first, or switch to the on-device model.");
                const apiKey = await getKey(byok.provider);
                if (!apiKey) throw new Error("That saved key could not be read. Enter it again.");
                const controller = new AbortController();
                abortRef.current = controller;
                setPhase("translating");
                setChunkProgress({ done: 0, total: withText.length });
                const out: TranslatedPage[] = [];
                for (let i = 0; i < withText.length; i++) {
                    if (cancelRef.current) return;
                    const pg = withText[i];
                    const translated = await translateWithByok({
                        providerId: byok.provider,
                        apiKey,
                        baseUrl: getBaseUrl(byok.provider),
                        model: byokModel.trim() || providerById(byok.provider)?.models[0] || "",
                        text: pg.text,
                        targetLanguage: byokTarget,
                        signal: controller.signal,
                    });
                    out.push({ page: pg.page, source: pg.text, translated });
                    setPages([...out]);
                    setChunkProgress({ done: i + 1, total: withText.length });
                }
                setPhase("done");
                return;
            }

            setPhase("loading-model");
            const translator = await getTranslator(modelId, setModelPct) as
                (input: string) => Promise<Array<{ translation_text?: string }>>;
            if (cancelRef.current) return;

            setPhase("translating");
            const jobs = withText.map(p => ({ ...p, chunks: chunkForTranslation(p.text) }));
            const totalChunks = jobs.reduce((n, j) => n + j.chunks.length, 0);
            setChunkProgress({ done: 0, total: totalChunks });

            const out: TranslatedPage[] = [];
            let done = 0;
            for (const job of jobs) {
                const parts: string[] = [];
                for (const chunk of job.chunks) {
                    if (cancelRef.current) return;
                    const result = await translator(chunk);
                    parts.push(result?.[0]?.translation_text ?? "");
                    done += 1;
                    setChunkProgress({ done, total: totalChunks });
                }
                out.push({ page: job.page, source: job.text, translated: parts.join(" ").trim() });
                setPages([...out]);
            }
            setPhase("done");
        } catch (e: unknown) {
            if (cancelRef.current) return;
            const msg = e instanceof ByokError ? e.userMessage : e instanceof Error ? e.message : "Translation failed";
            setError(friendlyError(msg, "Couldn't translate that PDF."));
            setPhase("idle");
        }
    }, [file, source, target, engine, byok.ready, byok.provider, byokModel, byokTarget]);

    const asText = useCallback(
        () => pages.map(p => `— Page ${p.page} —\n\n${p.translated}`).join("\n\n"),
        [pages],
    );

    const downloadText = () => {
        const base = (file?.name ?? "document").replace(/\.pdf$/i, "");
        downloadBlob(
            new Blob([asText()], { type: "text/plain;charset=utf-8" }),
            `${base}_${target}.txt`,
        );
    };

    const copyText = async () => {
        try {
            await navigator.clipboard.writeText(asText());
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setError("Couldn't copy to the clipboard.");
        }
    };

    const savePdf = async () => {
        const base = (file?.name ?? "document").replace(/\.pdf$/i, "");
        setSavingPdf(true);
        try {
            const txt = new File([asText()], `${base}.txt`, { type: "text/plain" });
            const res = await uploadFile("/txt-to-pdf", txt, { font_size: 11 });
            downloadBlob(await res.blob(), `${base}_${target}.pdf`);
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't render that as a PDF."));
        } finally {
            setSavingPdf(false);
        }
    };

    const busy = phase === "extracting" || phase === "loading-model" || phase === "translating";

    if (phase === "done") {
        const words = pages.reduce((n, p) => n + p.translated.split(/\s+/).filter(Boolean).length, 0);
        return (
            <div className="space-y-3 animate-fade-up">
                <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden">
                    <div className="p-7">
                        <div className="flex items-start gap-5">
                            <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                                <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="section-mark mb-2">Translated</p>
                                <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight">
                                    {engine === "byok"
                                        ? <>→ <span className="italic text-accent">{byokTarget}</span></>
                                        : <>{languageName(source)} → <span className="italic text-accent">{languageName(target)}</span></>}
                                </h2>
                                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1.5">
                                    {pages.length} page{pages.length === 1 ? "" : "s"} · {words.toLocaleString()} words · {engine === "byok" ? `translated with your ${providerById(byok.provider)?.label ?? "AI"} key` : "translated on your device"}
                                </p>
                                <div className="mt-5 flex flex-wrap gap-2">
                                    <button onClick={downloadText} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                        <Download size={13} /> Download text
                                    </button>
                                    <button onClick={savePdf} disabled={savingPdf} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-60">
                                        {savingPdf ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} Save as PDF
                                    </button>
                                    <button onClick={copyText} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors">
                                        {copied ? <><Check size={13} className="text-accent" /> Copied</> : <><Copy size={13} /> Copy</>}
                                    </button>
                                    <button onClick={reset} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors">
                                        <RotateCcw size={12} /> Translate another
                                    </button>
                                </div>
                                <p className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground mt-3">
                                    Text and copy stay on your device. &ldquo;Save as PDF&rdquo; sends the translated
                                    text — never the original file — to be rendered, then deletes it.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {error && (
                    <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive" role="alert">
                        <AlertCircle size={13} className="shrink-0" />{error}
                    </div>
                )}

                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                        Preview
                    </div>
                    <div className="max-h-96 overflow-y-auto divide-y divide-border">
                        {pages.map(p => (
                            <div key={p.page} className="px-4 py-3">
                                <p className="font-medium text-[11px] text-muted-foreground mb-1.5">
                                    Page {p.page}
                                </p>
                                <p className="text-[13.5px] text-foreground leading-relaxed whitespace-pre-wrap">
                                    {p.translated}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <FileUploadZone
                file={file}
                onFileSelect={setFile}
                onClear={reset}
                accept=".pdf"
                label="Drop PDF to translate"
                hint="Runs entirely in your browser — the file is never uploaded"
            />

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive" role="alert">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            {/* Engine: on-device model vs the user's own API key */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                    Which translator
                </div>
                <div className="p-3 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                            type="button"
                            onClick={() => setEngine("local")}
                            aria-pressed={engine === "local"}
                            disabled={busy}
                            className={cn(
                                "rounded-lg border p-3 text-left transition-colors",
                                engine === "local" ? "border-accent bg-accent/[0.07]" : "border-border hover:border-accent/40",
                            )}
                        >
                            <span className="block text-[13.5px] font-medium text-foreground">On this device</span>
                            <span className="block text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
                                Free, no key. Downloads a ~{APPROX_MODEL_MB} MB model per language pair.
                                English-centric pairs only.
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setEngine("byok")}
                            aria-pressed={engine === "byok"}
                            disabled={busy}
                            className={cn(
                                "rounded-lg border p-3 text-left transition-colors",
                                engine === "byok" ? "border-accent bg-accent/[0.07]" : "border-border hover:border-accent/40",
                            )}
                        >
                            <span className="block text-[13.5px] font-medium text-foreground">My own API key</span>
                            <span className="block text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
                                Any language, much better quality, billed by your provider.
                                The text goes to them, not to us.
                            </span>
                        </button>
                    </div>
                    {engine === "byok" && (
                        <>
                            <ByokPanel
                                byok={byok}
                                purpose="The extracted text of this PDF is sent to the provider you choose, using your key."
                            />
                            {byok.ready && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <label className="block">
                                        <span className="font-medium text-[11px] text-muted-foreground">Translate into</span>
                                        <select
                                            value={byokTarget}
                                            onChange={e => setByokTarget(e.target.value)}
                                            disabled={busy}
                                            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors disabled:opacity-60"
                                        >
                                            {BYOK_LANGS.map(l => <option key={l} value={l}>{l}</option>)}
                                        </select>
                                        <span className="mt-1 block text-[11px] text-muted-foreground">Source language is detected automatically.</span>
                                    </label>
                                    <label className="block">
                                        <span className="font-medium text-[11px] text-muted-foreground">Model (optional)</span>
                                        <input
                                            type="text"
                                            value={byokModel}
                                            onChange={e => setByokModel(e.target.value)}
                                            placeholder={providerById(byok.provider)?.models[0] ?? "provider default"}
                                            className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] font-mono"
                                        />
                                    </label>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            <div className={cn("rounded-xl border border-border bg-card overflow-hidden", engine === "byok" && "hidden")}>
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                    Languages
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                        <label htmlFor="tr-source" className="font-medium text-[11px] text-muted-foreground">From</label>
                        <select
                            id="tr-source" value={source} onChange={e => onSourceChange(e.target.value)}
                            disabled={busy}
                            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors disabled:opacity-60"
                        >
                            {availableSources().map(code => (
                                <option key={code} value={code}>{languageName(code)}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label htmlFor="tr-target" className="font-medium text-[11px] text-muted-foreground">To</label>
                        <select
                            id="tr-target" value={target} onChange={e => setTarget(e.target.value)}
                            disabled={busy || targets.length === 0}
                            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors disabled:opacity-60"
                        >
                            {targets.map(code => (
                                <option key={code} value={code}>{languageName(code)}</option>
                            ))}
                        </select>
                    </div>
                </div>
                <p className="px-4 pb-3 text-[12px] text-muted-foreground leading-relaxed">
                    {source === "en"
                        ? "Translating out of English. Pick a non-English source to translate into English instead."
                        : `${languageName(source)} translates into English only — the models are one-directional.`}
                    {" "}First run downloads about {APPROX_MODEL_MB} MB of model, cached for next time.
                </p>
            </div>

            {busy && (
                <div className="rounded-xl border border-accent/30 bg-accent/[0.05] p-4 space-y-2 animate-fade-in">
                    <p className="font-medium text-[12px] text-accent">
                        {phase === "extracting" && `Reading page ${pageProgress.done} of ${pageProgress.total || "?"}`}
                        {phase === "loading-model" && `Downloading model — ${modelPct}%`}
                        {phase === "translating" && (engine === "byok"
                            ? `Translating page ${Math.min(chunkProgress.done + 1, chunkProgress.total)} of ${chunkProgress.total} with your key`
                            : `Translating ${chunkProgress.done} of ${chunkProgress.total}`)}
                    </p>
                    <div className="h-1.5 rounded-full bg-border/60 overflow-hidden">
                        <div
                            className="h-full rounded-full bg-accent transition-[width] duration-300"
                            style={{
                                width: `${phase === "loading-model"
                                    ? modelPct
                                    : phase === "translating"
                                        ? (chunkProgress.total ? (chunkProgress.done / chunkProgress.total) * 100 : 0)
                                        : (pageProgress.total ? (pageProgress.done / pageProgress.total) * 100 : 0)}%`,
                            }}
                        />
                    </div>
                    <button
                        onClick={() => { cancelRef.current = true; abortRef.current?.abort(); setPhase("idle"); }}
                        className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <Ban size={11} /> Cancel
                    </button>
                </div>
            )}

            {!busy && (
                <button
                    onClick={translate}
                    disabled={!file || (engine === "local" ? !validPair : !byok.ready)}
                    className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    <Languages size={13} /> Translate
                </button>
            )}
        </div>
    );
}
