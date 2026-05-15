import { useState, useRef } from "react";
import { Upload, Download, Loader2, AlertCircle, Droplets } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";

const POSITIONS = [
    { value: "center", label: "Center" },
    { value: "tile", label: "Tile (Repeat)" },
    { value: "top-left", label: "Top Left" },
    { value: "top-right", label: "Top Right" },
    { value: "bottom-left", label: "Bottom Left" },
    { value: "bottom-right", label: "Bottom Right" },
];

export function ImageWatermarkUI() {
    const [file, setFile] = useState<File | null>(null);
    const [text, setText] = useState("WATERMARK");
    const [opacity, setOpacity] = useState(80);
    const [position, setPosition] = useState("center");
    const [fontSize, setFontSize] = useState(40);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const process = async () => {
        if (!file || !text.trim()) return;
        setStatus("processing"); setError(null);
        try {
            const res = await uploadFile("/image-watermark", file, { text: text.trim(), opacity, position, font_size: fontSize });
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
        } catch (e: any) { setError(e.message || "Failed"); setStatus("idle"); }
    };

    const handleDownload = () => {
        if (resultBlob) downloadBlob(resultBlob, file ? `watermarked_${file.name}` : "watermarked.png");
    };

    if (status === "done") return (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
            <Droplets size={28} className="mx-auto mb-3 text-emerald-400" />
            <h2 className="text-lg font-bold text-foreground mb-1">Watermark Applied!</h2>
            <p className="text-sm text-muted-foreground mb-6">Your watermarked image is ready</p>
            <div className="flex justify-center gap-3 flex-wrap">
                <Button className="glow-primary" onClick={handleDownload}><Download size={15} /> Download</Button>
                <Button variant="outline" onClick={() => { setFile(null); setStatus("idle"); setResultBlob(null); }}>Process another</Button>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); }}
                onClick={() => ref.current?.click()}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
          role="button"
          tabIndex={0}
          aria-label="Upload file"
                className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-10 px-6 text-center",
                    drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 hover:bg-secondary/40 bg-secondary/20")}>
                <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.webp,.bmp" className="hidden" onChange={e => e.target.files?.[0] && setFile(e.target.files[0])} />
                <Upload size={22} className={drag ? "text-primary" : "text-muted-foreground"} />
                <p className="text-sm font-semibold text-foreground">{file ? file.name : "Drop image here"}</p>
                {file && <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>}
            </div>

            {file && (
                <>
                    <div className="space-y-1">
                        <label className="text-sm font-semibold text-foreground">Watermark Text</label>
                        <input type="text" value={text} onChange={e => setText(e.target.value)} placeholder="Enter watermark text"
                            className="w-full rounded-xl border border-border bg-secondary/30 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/80 focus:border-accent/50 focus:outline-none" />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1">
                            <div className="flex justify-between"><label className="text-xs font-medium text-muted-foreground">Opacity</label><span className="text-xs text-muted-foreground">{opacity}</span></div>
                            <input type="range" min={10} max={255} value={opacity} onChange={e => setOpacity(+e.target.value)} className="w-full accent-foreground" />
                        </div>
                        <div className="space-y-1">
                            <div className="flex justify-between"><label className="text-xs font-medium text-muted-foreground">Font Size</label><span className="text-xs text-muted-foreground">{fontSize}px</span></div>
                            <input type="range" min={12} max={120} value={fontSize} onChange={e => setFontSize(+e.target.value)} className="w-full accent-foreground" />
                        </div>
                    </div>

                    <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Position</label>
                        <div className="flex gap-1.5 flex-wrap">
                            {POSITIONS.map(p => (
                                <button key={p.value} onClick={() => setPosition(p.value)}
                                    className={cn("rounded-lg border px-2.5 py-1 text-xs transition-all",
                                        position === p.value ? "border-accent bg-accent/10 text-primary font-medium" : "border-border text-muted-foreground hover:border-accent/30")}>
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}

            {file && (
                <Button onClick={process} disabled={status === "processing" || !text.trim()} className="w-full glow-primary">
                    {status === "processing" ? <><Loader2 size={15} className="animate-spin" /> Applying…</> : "Apply Watermark"}
                </Button>
            )}
        </div>
    );
}
