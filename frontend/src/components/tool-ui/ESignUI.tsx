/**
 * ESignUI — e-signature with Draw / Type / Upload modes + position panel + page preview.
 * Workshop: 3-tab signature builder, drafting-paper canvas, mini page diagram.
 */
import { useEffect, useState, useRef, useCallback } from "react";
import { Download, Loader2, AlertCircle, PenTool, Type, Image as ImageIcon, CheckCircle2, RotateCcw, Star } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile, downloadBlob } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";
import { loadSignature, saveSignature, forgetSignature } from "@/lib/signatureStore";

type SigMode = "draw" | "type" | "upload";

const PAGE_W = 612;
const PAGE_H = 792;
const MAX_SIG_FILE_BYTES = 4 * 1024 * 1024;
// The signature now lives in the shared asset store (lib/localStore/assets)
// so it appears in /my-stuff and can be reused by the watermark and stamp
// tools. The old raw localStorage key is migrated on first load by
// lib/localStore/migrate.ts.

const TYPE_FONTS: { value: string; label: string; css: string }[] = [
    { value: "fraunces",    label: "Classic italic",  css: "italic 44px 'Fraunces', Georgia, serif" },
    { value: "caveat",      label: "Handwritten",     css: "italic 48px 'Caveat', 'Brush Script MT', cursive" },
    { value: "dancing",     label: "Flowing script",  css: "italic 46px 'Dancing Script', 'Lucida Handwriting', cursive" },
    { value: "great-vibes", label: "Formal cursive",  css: "italic 50px 'Great Vibes', 'Apple Chancery', cursive" },
];

export function ESignUI() {
    const [file, setFile] = useState<File | null>(null);
    const [mode, setMode] = useState<SigMode>("draw");
    const [typedName, setTypedName] = useState("");
    const [typedFont, setTypedFont] = useState<string>(TYPE_FONTS[0].value);
    const [sigImage, setSigImage] = useState<string | null>(null);
    const [pageNumber, setPageNumber] = useState(1);
    const [posX, setPosX] = useState(100);
    const [posY, setPosY] = useState(650);
    const [sigWidth, setSigWidth] = useState(200);
    const [sigHeight, setSigHeight] = useState(80);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [savedSig, setSavedSig] = useState<string | null>(null);
    // Default ON — most repeat-signers want their signature to persist.
    // Clearing the signature (Forget) is the escape hatch.
    const [rememberSig, setRememberSig] = useState(true);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDrawingRef = useRef(false);
    const [hasDrawn, setHasDrawn] = useState(false);

    // Retina-aware canvas. Initializes whenever the draw tab is active.
    const initCanvas = useCallback(() => {
        const c = canvasRef.current;
        if (!c) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const cssW = c.clientWidth || 600;
        const cssH = 140;
        c.width = Math.round(cssW * dpr);
        c.height = Math.round(cssH * dpr);
        c.style.height = `${cssH}px`;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
    }, []);

    useEffect(() => {
        if (file && mode === "draw") initCanvas();
    }, [file, mode, initCanvas]);

    // Restore saved sig from localStorage on mount — and auto-apply it
    // to the upload slot so users don't have to click "Use" every visit.
    useEffect(() => {
        void loadSignature().then(saved => {
            if (saved) {
                setSavedSig(saved);
                setSigImage(saved);
                setMode("upload");
            }
        });
    }, []);

    const getPos = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        if ("touches" in e) {
            return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
        }
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const startDraw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        const { x, y } = getPos(e);
        ctx.beginPath();
        ctx.moveTo(x, y);
        isDrawingRef.current = true;
    };
    const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
        if (!isDrawingRef.current) return;
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        const { x, y } = getPos(e);
        ctx.lineTo(x, y);
        ctx.strokeStyle = "hsl(var(--foreground))";
        ctx.lineWidth = 2.5;
        ctx.stroke();
        setHasDrawn(true);
    };
    const endDraw = () => {
        isDrawingRef.current = false;
        // Auto-persist on every stroke completion so the drawn signature
        // is captured progressively (the hasDrawn-driven effect only fires
        // on the first stroke).
        if (rememberSig && hasDrawn && canvasRef.current) {
            try {
                const data = canvasRef.current.toDataURL("image/png");
                void saveSignature(data);
                setSavedSig(data);
            } catch { /* noop */ }
        }
    };
    const clearCanvas = () => {
        const c = canvasRef.current;
        if (!c) return;
        const ctx = c.getContext("2d");
        if (!ctx) return;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.restore();
        setHasDrawn(false);
        // Clearing the drawn signature is an escape hatch — wipe the
        // persisted copy too so it doesn't auto-reload on next visit.
        void forgetSignature();
        setSavedSig(null);
    };

    // Auto-persist signature on every change (when remember is on).
    // We watch the inputs rather than getSignatureData() to avoid drawing
    // to a fresh canvas on every keystroke — for draw mode we read the
    // canvas directly when hasDrawn toggles true, then on each mouse-up.
    useEffect(() => {
        if (!rememberSig) return;
        const persist = (data: string) => {
            void saveSignature(data);
            setSavedSig(data);
        };
        if (mode === "type" && typedName.trim()) {
            const c = document.createElement("canvas");
            c.width = 600; c.height = 160;
            const ctx = c.getContext("2d");
            if (!ctx) return;
            const font = TYPE_FONTS.find(f => f.value === typedFont) ?? TYPE_FONTS[0];
            ctx.font = font.css;
            ctx.fillStyle = "#1a1a1a";
            ctx.textBaseline = "alphabetic";
            ctx.fillText(typedName.trim(), 20, 100);
            persist(c.toDataURL("image/png"));
            return;
        }
        if (mode === "upload" && sigImage) {
            persist(sigImage);
            return;
        }
        if (mode === "draw" && hasDrawn && canvasRef.current) {
            persist(canvasRef.current.toDataURL("image/png"));
        }
    }, [rememberSig, mode, typedName, typedFont, sigImage, hasDrawn]);

    const getSignatureData = useCallback((): string | null => {
        if (mode === "draw") {
            if (!hasDrawn || !canvasRef.current) return null;
            return canvasRef.current.toDataURL("image/png");
        }
        if (mode === "type") {
            if (!typedName.trim()) return null;
            const c = document.createElement("canvas");
            c.width = 600; c.height = 160;
            const ctx = c.getContext("2d")!;
            const font = TYPE_FONTS.find(f => f.value === typedFont) ?? TYPE_FONTS[0];
            ctx.font = font.css;
            ctx.fillStyle = "#1a1a1a";
            ctx.textBaseline = "alphabetic";
            ctx.fillText(typedName.trim(), 20, 100);
            return c.toDataURL("image/png");
        }
        if (mode === "upload") return sigImage;
        return null;
    }, [mode, hasDrawn, typedName, typedFont, sigImage]);

    const handleSigUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        e.target.value = "";
        if (!f) return;
        if (f.size > MAX_SIG_FILE_BYTES) {
            setError("Signature image is too large (max 4 MB) — please choose a smaller file");
            return;
        }
        setError(null);
        const reader = new FileReader();
        reader.onload = () => setSigImage(reader.result as string);
        reader.readAsDataURL(f);
    };

    const applySavedSig = () => {
        if (!savedSig) return;
        setSigImage(savedSig);
        setMode("upload");
    };

    const forgetSavedSig = () => {
        void forgetSignature();
        setSavedSig(null);
        setRememberSig(false);
    };

    const process = useCallback(async () => {
        if (!file) return;
        const sigData = getSignatureData();
        if (!sigData) { setError("Create a signature first — draw it, type it, or upload an image"); return; }
        setStatus("processing"); setError(null);
        try {
            const res = await uploadFile("/esign-pdf", file, {
                signature_data: sigData,
                page_number: pageNumber,
                x: posX, y: posY,
                width: sigWidth, height: sigHeight,
            });
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
            downloadBlob(blob, file.name.replace(/\.pdf$/i, "_signed.pdf"));
            // Note: persistence is handled by the auto-save effect — no
            // need to write here. Submit-time write would be a stale
            // duplicate of what the user already has.
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Signing failed";
            setError(friendlyError(msg, "Couldn't apply that signature."));
            setStatus("idle");
        }
    }, [file, getSignatureData, pageNumber, posX, posY, sigWidth, sigHeight]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && file && status !== "processing") {
                e.preventDefault();
                process();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [file, status, process]);

    if (status === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Signed</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">E-signature</span> applied
                        </h2>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <button onClick={() => resultBlob && file && downloadBlob(resultBlob, file.name.replace(/\.pdf$/i, "_signed.pdf"))} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                <Download size={13} /> Download again
                            </button>
                            <button
                                onClick={() => { setFile(null); setStatus("idle"); setResultBlob(null); clearCanvas(); }}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                            >
                                <RotateCcw size={12} /> Sign another
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <FileUploadZone
                file={file}
                onFileSelect={setFile}
                onClear={() => setFile(null)}
                accept=".pdf"
                label="Drop PDF to e-sign"
                hint="Draw, type, or upload your signature"
            />

            {file && (
                <>
                    {/* Signature builder */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                            Signature
                        </div>
                        <div className="p-3 space-y-3">
                            {savedSig && (
                                <div className="flex items-center gap-3 rounded-md border border-accent/30 bg-accent/[0.04] px-3 py-2">
                                    <div className="h-9 w-16 rounded border border-border bg-card flex items-center justify-center overflow-hidden shrink-0">
                                        <img src={savedSig} alt="Saved signature preview" className="max-h-9 max-w-full object-contain" />
                                    </div>
                                    <p className="font-medium text-[11.5px] text-muted-foreground flex-1 min-w-0">
                                        <span className="text-foreground">Saved signature</span>
                                    </p>
                                    <button
                                        type="button"
                                        onClick={applySavedSig}
                                        className="font-medium h-7 px-2.5 rounded text-accent hover:bg-accent/10 text-[11.5px] tracking-wider"
                                    >
                                        Use
                                    </button>
                                    <button
                                        type="button"
                                        onClick={forgetSavedSig}
                                        className="font-medium h-7 px-2 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 text-[11px] tracking-wider"
                                        aria-label="Forget saved signature"
                                    >
                                        Forget
                                    </button>
                                </div>
                            )}
                            <div className="grid grid-cols-3 gap-1 p-1 rounded-md border border-border bg-paper-2/40" role="tablist" aria-label="Signature mode">
                                {([
                                    { m: "draw" as SigMode, icon: PenTool, label: "Draw" },
                                    { m: "type" as SigMode, icon: Type, label: "Type" },
                                    { m: "upload" as SigMode, icon: ImageIcon, label: "Upload" },
                                ]).map(({ m, icon: I, label }) => (
                                    <button
                                        key={m}
                                        onClick={() => setMode(m)}
                                        role="tab"
                                        aria-selected={mode === m}
                                        className={cn(
                                            "flex items-center justify-center gap-1.5 rounded h-9 text-[12.5px] font-medium transition-colors",
                                            mode === m ? "bg-card border border-accent text-accent" : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                                        )}
                                    >
                                        <I size={12} /> {label}
                                    </button>
                                ))}
                            </div>

                            {mode === "draw" && (
                                <div className="space-y-2 animate-fade-in">
                                    <div className="relative rounded-md border border-dashed border-border-strong bg-paper-2/40 overflow-hidden">
                                        <canvas
                                            ref={canvasRef}
                                            onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                                            onTouchStart={e => { e.preventDefault(); startDraw(e); }}
                                            onTouchMove={e => { e.preventDefault(); draw(e); }}
                                            onTouchEnd={endDraw}
                                            aria-label="Draw your signature"
                                            className="w-full cursor-crosshair touch-none"
                                        />
                                        {!hasDrawn && (
                                            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                                <p className="font-medium text-[12px] text-muted-foreground">Draw signature here</p>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <p className="font-medium text-[11px] text-muted-foreground">
                                            Mouse, trackpad, or touch
                                        </p>
                                        <button onClick={clearCanvas} className="font-medium text-[11px] text-accent hover:opacity-80">Clear</button>
                                    </div>
                                </div>
                            )}

                            {mode === "type" && (
                                <div className="space-y-2 animate-fade-in">
                                    <input
                                        type="text" value={typedName} onChange={e => setTypedName(e.target.value)}
                                        placeholder="Type your name…"
                                        autoFocus
                                        maxLength={60}
                                        className="w-full rounded-md border border-border bg-card px-3 py-2 text-[14px] text-foreground placeholder:text-muted-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                    />
                                    {/* Font picker */}
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5" role="radiogroup" aria-label="Signature font">
                                        {TYPE_FONTS.map(f => (
                                            <button
                                                key={f.value}
                                                type="button"
                                                role="radio"
                                                aria-checked={typedFont === f.value}
                                                onClick={() => setTypedFont(f.value)}
                                                className={cn(
                                                    "rounded-md border px-2 py-2 text-left transition-colors overflow-hidden",
                                                    typedFont === f.value ? "border-accent bg-accent/[0.06]" : "border-border bg-card hover:border-border-strong"
                                                )}
                                            >
                                                <p className="font-medium text-[10.5px] text-muted-foreground truncate">{f.label}</p>
                                                <p
                                                    className="text-[20px] italic leading-tight text-foreground truncate"
                                                    style={{ font: f.css, fontSize: 20 }}
                                                >
                                                    {typedName.trim() || "Sample"}
                                                </p>
                                            </button>
                                        ))}
                                    </div>
                                    {typedName && (
                                        <div className="rounded-md border border-border bg-paper-2/40 p-6 text-center overflow-hidden">
                                            <p
                                                className="text-foreground leading-tight truncate"
                                                style={{ font: (TYPE_FONTS.find(f => f.value === typedFont) ?? TYPE_FONTS[0]).css, fontSize: 44 }}
                                            >
                                                {typedName}
                                            </p>
                                        </div>
                                    )}
                                </div>
                            )}

                            {mode === "upload" && (
                                <div className="space-y-2 animate-fade-in">
                                    <label className="relative flex flex-col items-center gap-2 rounded-md border border-dashed border-border-strong bg-paper-2/30 px-4 py-6 cursor-pointer hover:border-accent/55 hover:bg-accent/[0.04] transition-colors">
                                        <ImageIcon size={18} className="text-muted-foreground" />
                                        <span className="font-medium text-[12px] text-muted-foreground">
                                            {sigImage ? "Replace signature" : "Upload signature image"}
                                        </span>
                                        <input type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" onChange={handleSigUpload} />
                                    </label>
                                    {sigImage && (
                                        <div className="rounded-md border border-border bg-card p-3 flex items-center justify-center">
                                            <img src={sigImage} alt="Uploaded signature" className="max-h-24" />
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Placement */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                            Placement
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-[1fr_180px] gap-5 p-4 items-center">
                            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                                {([
                                    { label: "Page", val: pageNumber, set: setPageNumber, min: 1, max: 999 },
                                    { label: "X",    val: posX,       set: setPosX,       min: 0, max: 1000 },
                                    { label: "Y",    val: posY,       set: setPosY,       min: 0, max: 1000 },
                                    { label: "W",    val: sigWidth,   set: setSigWidth,   min: 50, max: 400 },
                                    { label: "H",    val: sigHeight,  set: setSigHeight,  min: 20, max: 200 },
                                ] as const).map(c => (
                                    <div key={c.label}>
                                        <label className="font-medium text-[9.5px] text-muted-foreground">{c.label}</label>
                                        <input
                                            type="number" inputMode="numeric" min={c.min} max={c.max} value={c.val}
                                            onChange={e => c.set(+e.target.value || c.min)}
                                            className="mt-0.5 w-full rounded-md border border-border bg-paper-2/40 px-2 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 text-center"
                                        />
                                    </div>
                                ))}
                            </div>
                            {/* Mini page preview */}
                            <div className="relative aspect-[3/4] bg-card border border-border rounded-md mx-auto w-full max-w-[180px] overflow-hidden">
                                <div
                                    className="absolute border-2 border-accent bg-accent/15 flex items-center justify-center"
                                    style={{
                                        left: `${(posX / PAGE_W) * 100}%`,
                                        top: `${(posY / PAGE_H) * 100}%`,
                                        width: `${(sigWidth / PAGE_W) * 100}%`,
                                        height: `${(sigHeight / PAGE_H) * 100}%`,
                                        minWidth: 4, minHeight: 4,
                                    }}
                                >
                                    <span className="font-display italic text-accent text-[7px]">sign</span>
                                </div>
                                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-wider text-muted-foreground">page {pageNumber}</span>
                            </div>
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                            <AlertCircle size={13} className="shrink-0" />{error}
                        </div>
                    )}

                    <div className="flex items-center justify-between gap-3 flex-wrap">
                        <div className="flex items-center gap-3">
                            <button onClick={process} disabled={status === "processing"} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                                {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Signing…</> : <><PenTool size={13} /> Apply e-signature</>}
                            </button>
                            {status !== "processing" && (
                                <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>
                            )}
                        </div>
                        <label className="font-medium inline-flex items-center gap-2 text-[11.5px] text-muted-foreground cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={rememberSig}
                                onChange={e => setRememberSig(e.target.checked)}
                                className="accent-accent h-3.5 w-3.5"
                            />
                            <Star size={11} className={cn(rememberSig ? "text-accent" : "text-muted-foreground/60")} />
                            Remember this signature
                        </label>
                    </div>
                </>
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