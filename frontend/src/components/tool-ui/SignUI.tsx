/**
 * SignUI — basic draw-or-upload signature with position controls.
 * Workshop: drafting-paper canvas + position panel + page preview.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle, PenTool, Upload, RotateCcw } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { downloadBlob, postFormData } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";

const PAGE_W = 612;
const PAGE_H = 792;
const MAX_SIG_FILE_BYTES = 4 * 1024 * 1024; // 4 MB ceiling for sig image upload

export function SignUI() {
    const [file, setFile] = useState<File | null>(null);
    const [sigData, setSigData] = useState("");
    const [sigFile, setSigFile] = useState<File | null>(null);
    const [page, setPage] = useState(1);
    const [x, setX] = useState(50);
    const [y, setY] = useState(650);
    const [width, setWidth] = useState(200);
    const [height, setHeight] = useState(80);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const sigRef = useRef<HTMLInputElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const drawingRef = useRef(false);

    // Retina-aware canvas init: match CSS px size at devicePixelRatio for crisp strokes.
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
        if (file) initCanvas();
    }, [file, initCanvas]);

    const getPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const rect = canvasRef.current!.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        e.preventDefault();
        drawingRef.current = true;
        const { x, y } = getPos(e);
        ctx.beginPath();
        ctx.moveTo(x, y);
    };
    const draw = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!drawingRef.current) return;
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        e.preventDefault();
        const { x, y } = getPos(e);
        ctx.lineTo(x, y);
        ctx.strokeStyle = "hsl(var(--foreground))";
        ctx.lineWidth = 2.5;
        ctx.stroke();
    };
    const endDraw = (e?: React.PointerEvent<HTMLCanvasElement>) => {
        if (e?.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
        drawingRef.current = false;
        if (canvasRef.current) setSigData(canvasRef.current.toDataURL("image/png"));
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
        setSigData("");
    };

    const process = useCallback(async () => {
        if (!file) return;
        setState("processing"); setError(null);
        try {
            if (!sigFile && !sigData) {
                setError("Draw a signature or upload an image first");
                setState("idle");
                return;
            }

            const res = await postFormData("/sign-pdf", () => {
                const fd = new FormData();
                fd.append("file", file);
                fd.append("page", String(page));
                fd.append("x", String(x));
                fd.append("y", String(y));
                fd.append("width", String(width));
                fd.append("height", String(height));
                if (sigFile) fd.append("signature", sigFile);
                else if (sigData) fd.append("signature_data", sigData);
                return fd;
            }, { timeoutMs: 300_000 });
            const blob = await res.blob();
            downloadBlob(blob, `${file.name.replace(/\.pdf$/i, "")}_signed.pdf`);
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Could not sign PDF";
            setError(friendlyError(msg, "Couldn't sign that PDF."));
            setState("idle");
        }
    }, [file, page, x, y, width, height, sigFile, sigData]);

    useEffect(() => {
        const canProcess = !!file && state !== "processing" && (!!sigData || !!sigFile);
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [file, state, sigData, sigFile, process]);

    if (state === "done") return (
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
                            <span className="italic text-accent">Signature</span> applied
                        </h2>
                        <button
                            onClick={() => { setFile(null); setState("idle"); setSigData(""); setSigFile(null); clearCanvas(); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Sign another
                        </button>
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
                label="Drop PDF to sign"
                hint="Draw or upload a signature"
            />

            {file && (
                <>
                    {/* Signature panel */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span><span className="text-accent">§</span> Signature</span>
                            <div className="flex items-center gap-1">
                                <button onClick={clearCanvas} className="h-6 px-2 rounded text-muted-foreground hover:bg-secondary/40">Clear</button>
                                <button
                                    onClick={() => sigRef.current?.click()}
                                    className="h-6 px-2 rounded inline-flex items-center gap-1 text-accent hover:opacity-80"
                                >
                                    <Upload size={10} /> Image
                                </button>
                                <input
                                    ref={sigRef}
                                    type="file"
                                    accept=".png,.jpg,.jpeg"
                                    className="hidden"
                                    onChange={e => {
                                        const f = e.target.files?.[0];
                                        e.target.value = "";
                                        if (!f) return;
                                        if (f.size > MAX_SIG_FILE_BYTES) {
                                            setError("Signature image is too large (max 4 MB) — please choose a smaller file");
                                            return;
                                        }
                                        setSigFile(f);
                                        setError(null);
                                    }}
                                />
                            </div>
                        </div>
                        <div className="p-3">
                            <div className="relative rounded-md border border-dashed border-border-strong bg-paper-2/40 overflow-hidden">
                                <canvas
                                    ref={canvasRef}
                                    onPointerDown={startDraw}
                                    onPointerMove={draw}
                                    onPointerUp={endDraw}
                                    onPointerCancel={endDraw}
                                    aria-label="Draw your signature"
                                    className="w-full cursor-crosshair touch-none"
                                    style={{ touchAction: "none" }}
                                />
                                {!sigData && !sigFile && (
                                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                                        <p className="font-mono text-[11px] tracking-[0.06em] uppercase text-muted-foreground/60">Draw signature here</p>
                                    </div>
                                )}
                            </div>
                            {sigFile && (
                                <div className="mt-2 flex items-center gap-3 rounded-md border border-border bg-paper-2/40 px-3 py-2">
                                    <img
                                        src={URL.createObjectURL(sigFile)}
                                        alt="Signature preview"
                                        className="max-h-12 max-w-[120px] object-contain"
                                        onLoad={(e) => URL.revokeObjectURL((e.currentTarget as HTMLImageElement).src)}
                                    />
                                    <p className="font-mono text-[10px] tracking-[0.04em] uppercase text-accent truncate">
                                        <span>§</span> <span className="text-foreground truncate">{sigFile.name}</span>
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => setSigFile(null)}
                                        className="ml-auto h-7 px-2 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 font-mono text-[10px] uppercase tracking-wider"
                                    >
                                        Remove
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Placement panel */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span className="text-accent">§</span> Placement (points)
                        </div>
                        <div className="grid grid-cols-1 lg:grid-cols-[1fr_180px] gap-5 p-4 items-center">
                            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                                {([
                                    { f: "page", label: "Page", val: page, set: setPage, min: 1 },
                                    { f: "x", label: "X", val: x, set: setX, min: 0 },
                                    { f: "y", label: "Y", val: y, set: setY, min: 0 },
                                    { f: "width", label: "W", val: width, set: setWidth, min: 10 },
                                    { f: "height", label: "H", val: height, set: setHeight, min: 10 },
                                ] as const).map(c => (
                                    <div key={c.f}>
                                        <label className="font-mono text-[9.5px] tracking-[0.10em] uppercase text-muted-foreground">{c.label}</label>
                                        <input
                                            type="number" inputMode="numeric" min={c.min} value={c.val}
                                            onChange={e => c.set(parseInt(e.target.value) || c.min)}
                                            className="mt-0.5 w-full rounded-md border border-border bg-paper-2/40 px-2 py-1.5 font-mono text-[13px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 text-center"
                                        />
                                    </div>
                                ))}
                            </div>
                            {/* Mini page preview */}
                            <div className="relative aspect-[3/4] bg-card border border-border rounded-md mx-auto w-full max-w-[180px] overflow-hidden">
                                <div
                                    className="absolute border-2 border-accent bg-accent/15"
                                    style={{
                                        left: `${(x / PAGE_W) * 100}%`,
                                        top: `${(y / PAGE_H) * 100}%`,
                                        width: `${(width / PAGE_W) * 100}%`,
                                        height: `${(height / PAGE_H) * 100}%`,
                                        minWidth: 4, minHeight: 4,
                                    }}
                                >
                                    <span className="absolute inset-0 flex items-center justify-center font-display italic text-accent text-[7px]">sign</span>
                                </div>
                                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-wider text-muted-foreground/40">page {page}</span>
                            </div>
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                            <AlertCircle size={13} className="shrink-0" />{error}
                        </div>
                    )}

                    <div className="flex items-center gap-3">
                        <button onClick={process} disabled={state === "processing"} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {state === "processing" ? <><Loader2 size={13} className="animate-spin" /> Signing…</> : <><PenTool size={13} /> Sign PDF</>}
                        </button>
                        {state !== "processing" && (
                            <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/80 bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>
                        )}
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
