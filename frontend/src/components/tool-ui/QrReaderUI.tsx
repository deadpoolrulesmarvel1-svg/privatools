/**
 * QrReaderUI — decode QR & barcodes in an uploaded image.
 * Workshop: source preview, decoded code rows with copy, type chips.
 * Detected codes are highlighted on the source with overlay rectangles.
 */
import { useCallback, useEffect, useState, useRef } from "react";
import { Loader2, AlertCircle, QrCode, Copy, Check, RotateCcw } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFileGetJson } from "@/lib/api";

interface QrResult { data: string; type: string; rect: { left: number; top: number; width: number; height: number } }

export function QrReaderUI() {
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [codes, setCodes] = useState<QrResult[]>([]);
    const [copied, setCopied] = useState<number | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);
    // Track preview URL via ref so the unmount cleanup runs against the most
    // recent value without needing an effect dep on every selection.
    const previewRef = useRef<string | null>(null);

    useEffect(() => () => { if (previewRef.current) URL.revokeObjectURL(previewRef.current); }, []);

    const pick = (fl: FileList) => {
        const f = fl[0];
        if (!f) return;
        if (previewRef.current) URL.revokeObjectURL(previewRef.current);
        const url = URL.createObjectURL(f);
        previewRef.current = url;
        setFile(f);
        setPreview(url);
        setState("idle"); setError(null); setCodes([]); setNaturalDims(null);
    };

    const canProcess = !!file && state !== "processing";

    const process = useCallback(async () => {
        if (!file) return;
        setState("processing"); setError(null);
        try {
            const res = await uploadFileGetJson<{ codes: QrResult[] }>("/read-qr", file);
            setCodes(res.codes);
            if (res.codes.length === 0) setError("No QR codes or barcodes found in this image.");
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed to read QR code";
            setError(friendlyError(msg, "Couldn't decode any codes from this image."));
            setState("idle");
        }
    }, [file]);

    const copyToClipboard = async (text: string, idx: number) => {
        await navigator.clipboard.writeText(text);
        setCopied(idx);
        setTimeout(() => setCopied(null), 1800);
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
            <div
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) pick(e.dataTransfer.files); }}
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button" tabIndex={0} aria-label="Upload image"
                className={cn(
                    "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.webp,.bmp" className="hidden" onChange={e => { if (e.target.files) pick(e.target.files); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    <QrCode size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">{file ? "Change image" : "Upload image with QR / barcode"}</p>
                <p className="font-medium text-[11.5px] text-muted-foreground">JPG · PNG · WebP · BMP</p>
            </div>

            {preview && (
                <div className="rounded-xl border border-border bg-card p-3 flex justify-center">
                    <div className="relative inline-block">
                        <img
                            src={preview}
                            alt="Preview"
                            className="max-h-56 rounded-md object-contain"
                            onLoad={e => {
                                const t = e.currentTarget;
                                setNaturalDims({ w: t.naturalWidth, h: t.naturalHeight });
                            }}
                        />
                        {/* Overlay bounding boxes once results are in. */}
                        {naturalDims && codes.length > 0 && codes.map((c, i) => (
                            <div
                                key={i}
                                className="absolute border-2 border-accent bg-accent/10 rounded-sm pointer-events-none"
                                style={{
                                    left: `${(c.rect.left / naturalDims.w) * 100}%`,
                                    top: `${(c.rect.top / naturalDims.h) * 100}%`,
                                    width: `${(c.rect.width / naturalDims.w) * 100}%`,
                                    height: `${(c.rect.height / naturalDims.h) * 100}%`,
                                }}
                                aria-hidden="true"
                            >
                                <span className="font-medium absolute -top-4 left-0 text-[10.5px] tracking-wider rounded bg-accent text-background px-1">
                                    #{i + 1}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {file && state !== "done" && (
                <div className="flex items-center gap-3 flex-wrap">
                    <button onClick={process} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                        {state === "processing" ? <><Loader2 size={13} className="animate-spin" /> Scanning…</> : <><QrCode size={13} /> Scan for codes</>}
                    </button>
                    {canProcess && (
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                    )}
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            {codes.length > 0 && (
                <div className="rounded-xl border border-accent/30 bg-card overflow-hidden animate-fade-up">
                    <div className="font-medium px-4 py-2 border-b border-accent/20 bg-paper-2/40 text-[11.5px] text-muted-foreground">
                        Decoded ({codes.length})
                    </div>
                    <div className="divide-y divide-border">
                        {codes.map((c, i) => (
                            <div key={i} className="flex items-start gap-3 px-4 py-3">
                                <span className="font-mono text-[10px] tracking-wider text-muted-foreground/70 w-6 text-right shrink-0">{String(i + 1).padStart(2, "0")}</span>
                                <span className="font-medium h-5 px-2 inline-flex items-center text-[9.5px] tracking-wider rounded bg-accent/15 text-accent shrink-0 mt-0.5">
                                    {c.type}
                                </span>
                                <p className="flex-1 min-w-0 text-[13px] text-foreground break-all">{c.data}</p>
                                <button onClick={() => copyToClipboard(c.data, i)} className={cn("h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-accent hover:bg-accent/[0.06] shrink-0", copied === i && "animate-copy-flash")}>
                                    {copied === i ? <Check size={12} className="text-accent" /> : <Copy size={12} />}
                                </button>
                            </div>
                        ))}
                    </div>
                    <div className="px-4 py-2 border-t border-border">
                        <button
                            onClick={() => { setFile(null); if (preview) URL.revokeObjectURL(preview); setPreview(null); setState("idle"); setCodes([]); setError(null); }}
                            className="inline-flex items-center gap-1.5 h-8 px-3 rounded text-[12px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={11} /> Scan another
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
            <span className={`${cls} -top-1 -left-1`}><span className="absolute top-0 left-0 h-px w-3 bg-accent/70" /><span className="absolute top-0 left-0 w-px h-3 bg-accent/70" /></span>
            <span className={`${cls} -top-1 -right-1`}><span className="absolute top-0 right-0 h-px w-3 bg-accent/70" /><span className="absolute top-0 right-0 w-px h-3 bg-accent/70" /></span>
            <span className={`${cls} -bottom-1 -left-1`}><span className="absolute bottom-0 left-0 h-px w-3 bg-accent/70" /><span className="absolute bottom-0 left-0 w-px h-3 bg-accent/70" /></span>
            <span className={`${cls} -bottom-1 -right-1`}><span className="absolute bottom-0 right-0 h-px w-3 bg-accent/70" /><span className="absolute bottom-0 right-0 w-px h-3 bg-accent/70" /></span>
        </>
    );
}
