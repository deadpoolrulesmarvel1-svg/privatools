/**
 * ImageOcrUI — extract text from an image with Tesseract OCR.
 * Workshop: source preview, language picker (13 langs), code-editor styled output panel.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { ScanText, Trash2, Copy, Download, Loader2, AlertCircle, Check, Languages } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFileGetJson, uploadFile, downloadBlob, buildOutputFilename } from "@/lib/api";

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

export function ImageOcrUI() {
    const [imgFile, setImgFile] = useState<ImgFile | null>(null);
    const [lang, setLang] = useState("eng");
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<OcrResult | null>(null);
    const [copied, setCopied] = useState(false);
    const [drag, setDrag] = useState(false);
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
        setImgFile(null); setResult(null); setStatus("idle"); setError(null);
    };

    const canProcess = !!imgFile && status !== "processing";

    const process = useCallback(async () => {
        if (!imgFile) return;
        setStatus("processing"); setError(null); setResult(null);
        try {
            const data = await uploadFileGetJson<OcrResult>("/image-ocr", imgFile.file, { lang, output: "json" });
            setResult(data);
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "OCR failed";
            setError(friendlyError(msg, "OCR failed"));
            setStatus("idle");
        }
    }, [imgFile, lang]);

    const copyText = async () => {
        if (!result) return;
        await navigator.clipboard.writeText(result.text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
    };

    const downloadTxt = async () => {
        if (!imgFile) return;
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
                        "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                        drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                    )}
                >
                    <CornerMarks />
                    <input id="ocr-file-input" type="file" accept=".jpg,.jpeg,.png,.webp,.bmp,.tiff,.tif,.gif" className="hidden" onChange={e => { e.target.files && handleFiles(e.target.files); e.target.value = ""; }} />
                    <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                        <ScanText size={20} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">Drop an image to OCR</p>
                    <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">JPG · PNG · WebP · BMP · TIFF · 13 languages</p>
                </div>
            ) : (
                <div className="rounded-xl border border-accent/30 bg-card overflow-hidden">
                    <img src={imgFile.preview} alt={imgFile.file.name} className="w-full max-h-72 object-contain bg-paper-2/40" />
                    <div className="flex items-center gap-3 px-4 py-3 border-t border-border">
                        <div className="flex-1 min-w-0">
                            <p className="text-[14px] font-medium text-foreground truncate">{imgFile.file.name}</p>
                            <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground mt-0.5">
                                {(imgFile.file.size / 1024).toFixed(0)} KB
                            </p>
                        </div>
                        <button onClick={clear} className="h-8 w-8 coarse:h-11 coarse:w-11 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 inline-flex items-center justify-center" aria-label="Remove">
                            <Trash2 size={14} />
                        </button>
                    </div>
                </div>
            )}

            {/* Language */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
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

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            {/* Result */}
            {result && (
                <div className="rounded-xl border border-accent/30 bg-card overflow-hidden animate-fade-up">
                    <div className="flex items-center justify-between px-4 py-2 border-b border-accent/20 bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                            <span className="text-accent">§</span> Extracted text
                            <span className="text-muted-foreground/60">({result.characters} chars)</span>
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
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
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
