/**
 * ImageOcrUI — extract text from an image with Tesseract OCR.
 * Workshop: source preview, language picker (13 langs), code-editor styled output panel.
 *
 * Three engines: the server (Tesseract, best format support), the user's own
 * vision-model key (BYOK — far better on hard scans), or tesseract.js running
 * entirely in this tab (nothing uploads; language data is fetched from a CDN
 * once and cached).
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { ScanText, Trash2, Copy, Download, Loader2, AlertCircle, Check, Languages, Ban } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFileGetJson, uploadFile, downloadBlob, buildOutputFilename } from "@/lib/api";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { useByok } from "@/hooks/useByok";
import { ByokPanel } from "@/components/byok/ByokPanel";
import { getBaseUrl, getKey } from "@/lib/byok/keyStore";
import { providerById } from "@/lib/byok/providers";
import { visionOcrWithByok } from "@/lib/byok/tasks";
import { ByokError } from "@/lib/byok/errors";

interface OcrResult { text: string; language: string; characters: number; }
interface ImgFile { file: File; preview: string; }

const LANGUAGES = [
    { code: "eng",     label: "English" },
    { code: "fra",     label: "French" },
    { code: "deu",     label: "German" },
    { code: "spa",     label: "Spanish" },
    { code: "ita",     label: "Italian" },
    { code: "por",     label: "Portuguese" },
    { code: "chi_sim", label: "Chinese (Simp.)" },
    { code: "chi_tra", label: "Chinese (Trad.)" },
    { code: "jpn",     label: "Japanese" },
    { code: "kor",     label: "Korean" },
    { code: "ara",     label: "Arabic" },
    { code: "hin",     label: "Hindi" },
    { code: "rus",     label: "Russian" },
];

const IMAGE_OCR_DEFAULTS = {
    lang: "eng",
};

/** Which OCR engine runs: the server, the user's own vision key, or
 *  tesseract.js in this tab. */
type Engine = "server" | "byok" | "local";

// tesseract.js loads its worker, wasm core and language data from jsDelivr —
// the one external CDN the prod CSP allows besides huggingface.co. It hosts
// both the tesseract.js dist files and the @tesseract.js-data language packs.
// Versions are pinned to the installed npm packages (keep in sync with
// package.json). Language data is cached in IndexedDB after the first
// download, so a language costs its few-MB fetch exactly once.
const TESSERACT_WORKER_PATH = "https://cdn.jsdelivr.net/npm/tesseract.js@v7.0.0/dist/worker.min.js";
const TESSERACT_CORE_PATH = "https://cdn.jsdelivr.net/npm/tesseract.js-core@v7.0.0";
const tesseractLangPath = (lang: string) =>
    `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0_best_int`;

/** Decode an image in the browser and re-encode it as JPEG. Both client
 *  engines want a format every consumer accepts (vision APIs don't take
 *  BMP/TIFF, and neither does the tesseract.js wasm decoder for TIFF), so
 *  everything is normalised through a canvas. Throws when the browser cannot
 *  decode the format — the server engine remains the answer for those. */
async function normalizeImage(file: File): Promise<{ mimeType: string; dataBase64: string; dataUrl: string }> {
    let source: ImageBitmap | HTMLImageElement | null =
        await createImageBitmap(file).catch(() => null);
    if (!source) {
        source = await new Promise<HTMLImageElement | null>(resolve => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
            img.src = url;
        });
    }
    const w = source ? ("naturalWidth" in source ? source.naturalWidth : source.width) : 0;
    const h = source ? ("naturalHeight" in source ? source.naturalHeight : source.height) : 0;
    if (!source || !w || !h) {
        throw new Error("This browser can't decode that image format — use the server engine instead.");
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Couldn't create a canvas for the image.");
    // JPEG has no alpha — without a white backing, transparent PNG text
    // flattens onto black and becomes unreadable to OCR.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(source, 0, 0);
    if ("close" in source) source.close();
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    canvas.width = 0;
    canvas.height = 0;
    return {
        mimeType: "image/jpeg",
        dataBase64: dataUrl.slice(dataUrl.indexOf(",") + 1),
        dataUrl,
    };
}

export function ImageOcrUI() {
    const [config, , { setField }] = useToolDefaults("image-ocr", IMAGE_OCR_DEFAULTS);
    const { lang } = config;
    const setLang = useCallback((v: React.SetStateAction<typeof IMAGE_OCR_DEFAULTS["lang"]>) => setField("lang", v), [setField]);
    const [imgFile, setImgFile] = useState<ImgFile | null>(null);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<OcrResult | null>(null);
    const [copied, setCopied] = useState(false);
    const [drag, setDrag] = useState(false);
    // Engine choice + BYOK wiring.
    const byok = useByok();
    const [engine, setEngine] = useState<Engine>("server");
    const [byokModel, setByokModel] = useState("");
    const [stage, setStage] = useState<{ label: string; pct: number | null } | null>(null);
    const cancelRef = useRef(false);
    const abortRef = useRef<AbortController | null>(null);
    const workerRef = useRef<{ terminate: () => Promise<unknown> } | null>(null);
    // Keep the current blob URL in a ref so the unmount cleanup runs against
    // the latest value without the effect re-binding on every selection.
    const previewRef = useRef<string>("");
    useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

    const handleFiles = useCallback((fileList: FileList) => {
        const f = fileList[0];
        if (!f) return;
        if (previewRef.current) URL.revokeObjectURL(previewRef.current);
        const url = URL.createObjectURL(f);
        previewRef.current = url;
        setImgFile({ file: f, preview: url });
    }, []);

    const clear = () => {
        if (previewRef.current) URL.revokeObjectURL(previewRef.current);
        previewRef.current = "";
        setImgFile(null); setResult(null); setStatus("idle"); setError(null); setStage(null);
    };

    const canProcess = !!imgFile && status !== "processing" && (engine !== "byok" || byok.ready);

    const process = useCallback(async () => {
        if (!imgFile) return;
        cancelRef.current = false;
        setStatus("processing"); setError(null); setResult(null);
        try {
            if (engine === "server") {
                const data = await uploadFileGetJson<OcrResult>("/image-ocr", imgFile.file, { lang, output: "json" });
                setResult(data);
                setStatus("done");
                return;
            }

            const normalized = await normalizeImage(imgFile.file);
            let text: string;
            if (engine === "byok") {
                if (!byok.ready) throw new Error("Add an API key first, or pick another engine.");
                const apiKey = await getKey(byok.provider);
                if (!apiKey) throw new Error("That saved key could not be read. Enter it again.");
                const controller = new AbortController();
                abortRef.current = controller;
                setStage({ label: "Reading the image with your key", pct: null });
                const out = await visionOcrWithByok({
                    providerId: byok.provider,
                    apiKey,
                    baseUrl: getBaseUrl(byok.provider),
                    model: byokModel.trim() || providerById(byok.provider)?.models[0] || "",
                    pages: [{ mimeType: normalized.mimeType, dataBase64: normalized.dataBase64 }],
                    signal: controller.signal,
                });
                text = out.join("\n\n").trim();
            } else {
                const { createWorker } = await import("tesseract.js");
                setStage({ label: "Downloading OCR engine", pct: 0 });
                const worker = await createWorker(lang, undefined, {
                    workerPath: TESSERACT_WORKER_PATH,
                    corePath: TESSERACT_CORE_PATH,
                    langPath: tesseractLangPath(lang),
                    logger: m => {
                        if (cancelRef.current) return;
                        const pct = Math.round((m.progress ?? 0) * 100);
                        if (m.status === "loading tesseract core") {
                            setStage({ label: "Downloading OCR engine", pct });
                        } else if (m.status === "loading language traineddata") {
                            setStage({ label: "Downloading language data", pct });
                        } else if (m.status === "recognizing text") {
                            setStage({ label: "Reading page 1 of 1", pct });
                        }
                    },
                });
                workerRef.current = worker;
                try {
                    const res = await worker.recognize(normalized.dataUrl);
                    text = res.data.text.trim();
                } finally {
                    // One worker per run, always torn down — even on error or cancel.
                    if (workerRef.current === worker) {
                        workerRef.current = null;
                        try { await worker.terminate(); } catch { /* already terminated */ }
                    }
                }
                if (cancelRef.current) return;
            }

            setResult({ text, language: engine === "local" ? lang : "auto", characters: text.length });
            setStatus("done");
        } catch (e: unknown) {
            if (cancelRef.current) return;
            const msg = e instanceof ByokError ? e.userMessage : e instanceof Error ? e.message : "OCR failed";
            setError(friendlyError(msg, "OCR failed"));
            setStatus("idle");
        } finally {
            setStage(null);
            abortRef.current = null;
        }
    }, [imgFile, engine, lang, byok.ready, byok.provider, byokModel]);

    const cancelRun = () => {
        cancelRef.current = true;
        abortRef.current?.abort();
        const w = workerRef.current;
        workerRef.current = null;
        if (w) void w.terminate().catch(() => { /* already gone */ });
        setStatus("idle");
        setStage(null);
    };

    const copyText = async () => {
        if (!result) return;
        await navigator.clipboard.writeText(result.text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
    };

    const downloadTxt = async () => {
        if (!imgFile) return;
        // The client engines already hold the text — build the .txt right here
        // instead of re-uploading the image to the server.
        if (engine !== "server") {
            if (!result) return;
            downloadBlob(
                new Blob([result.text], { type: "text/plain;charset=utf-8" }),
                buildOutputFilename(imgFile.file.name, "extracted_text", "txt"),
            );
            return;
        }
        try {
            const res = await uploadFile("/image-ocr", imgFile.file, { lang, output: "txt" });
            const blob = await res.blob();
            downloadBlob(blob, buildOutputFilename(imgFile.file.name, "extracted_text", "txt"));
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Download failed";
            setError(friendlyError(msg, "Download failed"));
        }
    };

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    return (
        <div className="space-y-4">
            {/* Source */}
            {!imgFile ? (
                <div
                    onDragOver={e => { e.preventDefault(); setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files); }}
                    onClick={() => document.getElementById("ocr-file-input")?.click()}
                    role="button" tabIndex={0}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); document.getElementById("ocr-file-input")?.click(); } }}
                    className={cn(
                        "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                        drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                    )}
                >
                    <CornerMarks />
                    <input id="ocr-file-input" type="file" accept=".jpg,.jpeg,.png,.webp,.bmp,.tiff,.tif,.gif" className="hidden" onChange={e => { e.target.files && handleFiles(e.target.files); e.target.value = ""; }} />
                    <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                        <ScanText size={20} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">Drop an image to OCR</p>
                    <p className="font-medium text-[11.5px] text-muted-foreground">JPG · PNG · WebP · BMP · TIFF · 13 languages</p>
                </div>
            ) : (
                <div className="rounded-xl border border-accent/30 bg-card overflow-hidden">
                    <img src={imgFile.preview} alt={imgFile.file.name} className="w-full max-h-72 object-contain bg-paper-2/40" />
                    <div className="flex items-center gap-3 px-4 py-3 border-t border-border">
                        <div className="flex-1 min-w-0">
                            <p className="text-[14px] font-medium text-foreground truncate">{imgFile.file.name}</p>
                            <p className="font-medium text-[11.5px] text-muted-foreground mt-0.5">
                                {(imgFile.file.size / 1024).toFixed(0)} KB
                            </p>
                        </div>
                        <button onClick={clear} className="h-8 w-8 coarse:h-11 coarse:w-11 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 inline-flex items-center justify-center" aria-label="Remove">
                            <Trash2 size={14} />
                        </button>
                    </div>
                </div>
            )}

            {/* Engine: server, the user's own vision key, or tesseract.js here */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                    Which OCR engine
                </div>
                <div className="p-3 space-y-3">
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <button
                            type="button"
                            onClick={() => setEngine("server")}
                            aria-pressed={engine === "server"}
                            disabled={status === "processing"}
                            className={cn(
                                "rounded-lg border p-3 text-left transition-colors",
                                engine === "server" ? "border-accent bg-accent/[0.07]" : "border-border hover:border-accent/40",
                            )}
                        >
                            <span className="block text-[13.5px] font-medium text-foreground">On our server</span>
                            <span className="block text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
                                Tesseract on the server. Widest format support (TIFF, BMP).
                                The image is deleted after processing.
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setEngine("byok")}
                            aria-pressed={engine === "byok"}
                            disabled={status === "processing"}
                            className={cn(
                                "rounded-lg border p-3 text-left transition-colors",
                                engine === "byok" ? "border-accent bg-accent/[0.07]" : "border-border hover:border-accent/40",
                            )}
                        >
                            <span className="block text-[13.5px] font-medium text-foreground">My own AI key (vision)</span>
                            <span className="block text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
                                Far better accuracy on hard scans and photos, billed by your
                                provider. The image goes to them, not to us.
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => setEngine("local")}
                            aria-pressed={engine === "local"}
                            disabled={status === "processing"}
                            className={cn(
                                "rounded-lg border p-3 text-left transition-colors",
                                engine === "local" ? "border-accent bg-accent/[0.07]" : "border-border hover:border-accent/40",
                            )}
                        >
                            <span className="block text-[13.5px] font-medium text-foreground">In this browser</span>
                            <span className="block text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
                                tesseract.js, fully local — nothing uploads. Language data
                                downloads once and caches.
                            </span>
                        </button>
                    </div>
                    {engine === "byok" && (
                        <>
                            <ByokPanel
                                byok={byok}
                                purpose="This image is sent to the provider you choose, using your key."
                            />
                            {byok.ready && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                    <label className="block">
                                        <span className="font-medium text-[11px] text-muted-foreground">Model (optional)</span>
                                        <input
                                            type="text"
                                            value={byokModel}
                                            onChange={e => setByokModel(e.target.value)}
                                            placeholder={providerById(byok.provider)?.models[0] ?? "provider default"}
                                            className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] font-mono"
                                        />
                                        <span className="mt-1 block text-[11px] text-muted-foreground">
                                            Pick a vision-capable model. Any language — it detects the script itself.
                                        </span>
                                    </label>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Language — the vision model detects it itself, so hide it there */}
            {engine !== "byok" && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                        <span className="flex items-center gap-1.5"><Languages size={11} /> Language</span>
                        <span className="text-accent">{LANGUAGES.find(l => l.code === lang)?.label}</span>
                    </div>
                    <div className="p-3">
                        <select
                            value={lang} onChange={e => setLang(e.target.value)}
                            aria-label="OCR language"
                            className="w-full rounded-md border border-border bg-card px-3 py-2 text-[13.5px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                        >
                            {LANGUAGES.map(l => (
                                <option key={l.code} value={l.code}>{l.label} ({l.code})</option>
                            ))}
                        </select>
                    </div>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            {/* Client-engine progress: model / language download, then reading */}
            {status === "processing" && engine !== "server" && stage && (
                <div className="rounded-xl border border-accent/30 bg-accent/[0.05] p-4 space-y-2 animate-fade-in">
                    <p className="font-medium text-[12px] text-accent">
                        {stage.label}{stage.pct !== null ? ` — ${stage.pct}%` : "…"}
                    </p>
                    {stage.pct !== null && (
                        <div className="h-1.5 rounded-full bg-border/60 overflow-hidden">
                            <div
                                className="h-full rounded-full bg-accent transition-[width] duration-300"
                                style={{ width: `${stage.pct}%` }}
                            />
                        </div>
                    )}
                    <button
                        onClick={cancelRun}
                        className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <Ban size={11} /> Cancel
                    </button>
                </div>
            )}

            {/* Result */}
            {result && (
                <div className="rounded-xl border border-accent/30 bg-card overflow-hidden animate-fade-up">
                    <div className="font-medium flex items-center justify-between px-4 py-2 border-b border-accent/20 bg-paper-2/40 text-[11.5px] text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                            Extracted text
                            <span className="text-muted-foreground">({result.characters} chars)</span>
                        </span>
                        <div className="flex items-center gap-1">
                            <button onClick={copyText} aria-label="Copy extracted text" className={cn("h-7 px-2 rounded inline-flex items-center gap-1 transition-colors text-muted-foreground hover:text-accent hover:bg-accent/[0.06]", copied && "animate-copy-flash")}>
                                {copied ? <><Check size={10} className="text-accent" /> Copied</> : <><Copy size={10} /> Copy</>}
                            </button>
                            <button onClick={downloadTxt} aria-label="Download as .txt" className="h-7 px-2 rounded inline-flex items-center gap-1 transition-colors text-muted-foreground hover:text-accent hover:bg-accent/[0.06]">
                                <Download size={10} /> .txt
                            </button>
                        </div>
                    </div>
                    <textarea
                        readOnly
                        value={result.text}
                        className="w-full min-h-[220px] bg-paper-2/30 text-[13px] text-foreground p-4 font-mono leading-relaxed resize-y outline-none"
                        placeholder="No text detected…"
                    />
                </div>
            )}

            {/* CTA */}
            {status === "done" ? (
                <button onClick={clear} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors">
                    Extract from another image
                </button>
            ) : (
                <div className="flex items-center gap-3 flex-wrap">
                    <button onClick={process} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                        {status === "processing"
                            ? <><Loader2 size={13} className="animate-spin" /> Reading text…</>
                            : <><ScanText size={13} /> Extract text</>}
                    </button>
                    {canProcess && (
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                    )}
                </div>
            )}
        </div>
    );
}

function CornerMarks() {
    const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}><span className="absolute top-0 left-0 h-px w-3 bg-accent/70" /><span className="absolute top-0 left-0 w-px h-3 bg-accent/70" /></span>
            <span className={`${cls} -top-1 -right-1`}><span className="absolute top-0 right-0 h-px w-3 bg-accent/70" /><span className="absolute top-0 right-0 w-px h-3 bg-accent/70" /></span>
            <span className={`${cls} -bottom-1 -left-1`}><span className="absolute bottom-0 left-0 h-px w-3 bg-accent/70" /><span className="absolute bottom-0 left-0 w-px h-3 bg-accent/70" /></span>
            <span className={`${cls} -bottom-1 -right-1`}><span className="absolute bottom-0 right-0 h-px w-3 bg-accent/70" /><span className="absolute bottom-0 right-0 w-px h-3 bg-accent/70" /></span>
        </>
    );
}
