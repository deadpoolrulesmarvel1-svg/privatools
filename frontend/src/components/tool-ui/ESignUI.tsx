import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, Download, Loader2, AlertCircle, PenTool, Type, Image } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";

type SigMode = "draw" | "type" | "upload";

export function ESignUI() {
    const [file, setFile] = useState<File | null>(null);
    const [mode, setMode] = useState<SigMode>("draw");
    const [typedName, setTypedName] = useState("");
    const [sigImage, setSigImage] = useState<string | null>(null);
    const [pageNumber, setPageNumber] = useState(1);
    const [posX, setPosX] = useState(100);
    const [posY, setPosY] = useState(650);
    const [sigWidth, setSigWidth] = useState(200);
    const [sigHeight, setSigHeight] = useState(80);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [drag, setDrag] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [hasDrawn, setHasDrawn] = useState(false);

    // Canvas drawing
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
        setIsDrawing(true);
    };

    const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
        if (!isDrawing) return;
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        const { x, y } = getPos(e);
        ctx.lineTo(x, y);
        ctx.strokeStyle = "#e2e2e2";
        ctx.lineWidth = 2.5;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.stroke();
        setHasDrawn(true);
    };

    const endDraw = () => setIsDrawing(false);

    const clearCanvas = () => {
        const ctx = canvasRef.current?.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, canvasRef.current!.width, canvasRef.current!.height);
        setHasDrawn(false);
    };

    const getSignatureData = useCallback((): string | null => {
        if (mode === "draw") {
            if (!hasDrawn || !canvasRef.current) return null;
            return canvasRef.current.toDataURL("image/png");
        }
        if (mode === "type") {
            if (!typedName.trim()) return null;
            const c = document.createElement("canvas");
            c.width = 400; c.height = 120;
            const ctx = c.getContext("2d")!;
            ctx.font = "italic 38px 'Georgia', 'Times New Roman', serif";
            ctx.fillStyle = "#e2e2e2";
            ctx.fillText(typedName.trim(), 20, 75);
            return c.toDataURL("image/png");
        }
        if (mode === "upload") return sigImage;
        return null;
    }, [mode, hasDrawn, typedName, sigImage]);

    const handleSigUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const f = e.target.files?.[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = () => setSigImage(reader.result as string);
        reader.readAsDataURL(f);
    };

    const process = async () => {
        if (!file) return;
        const sigData = getSignatureData();
        if (!sigData) { setError("Please create a signature first"); return; }
        setStatus("processing");
        setError(null);
        try {
            const res = await uploadFile("/esign-pdf", file, {
                signature_data: sigData,
                page_number: pageNumber,
                x: posX,
                y: posY,
                width: sigWidth,
                height: sigHeight,
            });
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
        } catch (e: any) {
            setError(e.message || "Signing failed");
            setStatus("idle");
        }
    };

    const handleDownload = () => {
        if (resultBlob) {
            const name = file ? file.name.replace(/\.pdf$/i, "_signed.pdf") : "signed.pdf";
            downloadBlob(resultBlob, name);
        }
    };

    if (status === "done") {
        return (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
                <h2 className="text-lg font-bold text-foreground mb-1">Document Signed!</h2>
                <p className="text-sm text-muted-foreground mb-6">Your e-signature has been applied</p>
                <div className="flex justify-center gap-3 flex-wrap">
                    <Button className="glow-primary" onClick={handleDownload}><Download size={15} /> Download</Button>
                    <Button variant="outline" className="border-border text-muted-foreground" onClick={() => { setFile(null); setStatus("idle"); setResultBlob(null); clearCanvas(); }}>Sign another</Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {/* File drop */}
            <div
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); }}
                onClick={() => fileRef.current?.click()}
                className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-10 px-6 text-center",
                    drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 hover:bg-secondary/40 bg-secondary/20")}
            >
                <input ref={fileRef} type="file" accept=".pdf" className="hidden" onChange={e => e.target.files?.[0] && setFile(e.target.files[0])} />
                <Upload size={22} className={drag ? "text-primary" : "text-muted-foreground"} />
                <p className="text-sm font-semibold text-foreground">{file ? file.name : "Drop PDF here"}</p>
                {file && <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>}
            </div>

            {file && (
                <>
                    {/* Signature mode tabs */}
                    <div className="space-y-3">
                        <label className="text-sm font-semibold text-foreground">Create Signature</label>
                        <div className="flex gap-1 rounded-xl bg-secondary/50 p-1">
                            {([
                                { m: "draw" as SigMode, icon: PenTool, label: "Draw" },
                                { m: "type" as SigMode, icon: Type, label: "Type" },
                                { m: "upload" as SigMode, icon: Image, label: "Upload" },
                            ]).map(({ m, icon: I, label }) => (
                                <button key={m} onClick={() => setMode(m)}
                                    className={cn("flex-1 flex items-center justify-center gap-1.5 rounded-lg py-2 text-xs font-medium transition-all",
                                        mode === m ? "bg-card shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground")}>
                                    <I size={13} />{label}
                                </button>
                            ))}
                        </div>

                        {/* Draw mode */}
                        {mode === "draw" && (
                            <div className="space-y-2">
                                <canvas ref={canvasRef} width={400} height={120}
                                    onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                                    onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
                                    className="w-full rounded-xl border border-border bg-card cursor-crosshair touch-none"
                                    style={{ height: 120 }} />
                                <div className="flex justify-between">
                                    <p className="text-[10px] text-muted-foreground/80">Draw your signature above</p>
                                    <button onClick={clearCanvas} className="text-[10px] text-primary hover:underline">Clear</button>
                                </div>
                            </div>
                        )}

                        {/* Type mode */}
                        {mode === "type" && (
                            <div className="space-y-2">
                                <input type="text" value={typedName} onChange={e => setTypedName(e.target.value)}
                                    placeholder="Type your name…"
                                    className="w-full rounded-xl border border-border bg-secondary/30 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/80 focus:border-accent/50 focus:outline-none" />
                                {typedName && (
                                    <div className="rounded-xl border border-border bg-card p-4 text-center">
                                        <p className="text-2xl italic text-muted-foreground" style={{ fontFamily: "Georgia, 'Times New Roman', serif" }}>{typedName}</p>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Upload mode */}
                        {mode === "upload" && (
                            <div>
                                <label className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-secondary/20 px-4 py-6 cursor-pointer hover:border-accent/40 transition-all">
                                    <Image size={18} className="text-muted-foreground" />
                                    <span className="text-xs text-muted-foreground">{sigImage ? "Signature loaded ✓" : "Upload signature image (PNG/JPG)"}</span>
                                    <input type="file" accept=".png,.jpg,.jpeg,.webp" className="hidden" onChange={handleSigUpload} />
                                </label>
                                {sigImage && <img src={sigImage} alt="Uploaded signature" className="mt-2 max-h-20 mx-auto rounded border border-border" />}
                            </div>
                        )}
                    </div>

                    {/* Position controls */}
                    <div className="space-y-3">
                        <label className="text-sm font-semibold text-foreground">Placement</label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                            <div>
                                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Page</label>
                                <input type="number" min={1} value={pageNumber} onChange={e => setPageNumber(+e.target.value)}
                                    className="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm text-foreground focus:border-accent/50 focus:outline-none" />
                            </div>
                            <div>
                                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">X Position</label>
                                <input type="number" min={0} max={600} value={posX} onChange={e => setPosX(+e.target.value)}
                                    className="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm text-foreground focus:border-accent/50 focus:outline-none" />
                            </div>
                            <div>
                                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Y Position</label>
                                <input type="number" min={0} max={850} value={posY} onChange={e => setPosY(+e.target.value)}
                                    className="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm text-foreground focus:border-accent/50 focus:outline-none" />
                            </div>
                            <div>
                                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Width</label>
                                <input type="number" min={50} max={400} value={sigWidth} onChange={e => setSigWidth(+e.target.value)}
                                    className="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm text-foreground focus:border-accent/50 focus:outline-none" />
                            </div>
                            <div>
                                <label className="text-[10px] text-muted-foreground uppercase tracking-wider">Height</label>
                                <input type="number" min={20} max={200} value={sigHeight} onChange={e => setSigHeight(+e.target.value)}
                                    className="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm text-foreground focus:border-accent/50 focus:outline-none" />
                            </div>
                        </div>
                        <p className="text-[10px] text-muted-foreground/80">Position is in PDF points from top-left corner (1 point ≈ 0.35 mm)</p>
                    </div>
                </>
            )}

            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle size={15} className="shrink-0" />{error}
                </div>
            )}

            {file && (
                <Button onClick={process} disabled={status === "processing"} className="w-full glow-primary">
                    {status === "processing" ? <><Loader2 size={15} className="animate-spin" /> Signing…</> : "Apply E-Signature"}
                </Button>
            )}
        </div>
    );
}
