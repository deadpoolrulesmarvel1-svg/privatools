import { useState, useRef } from "react";
import { Upload, Download, Loader2, AlertCircle, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";

export function BackgroundRemoverUI() {
    const [file, setFile] = useState<File | null>(null);
    const [previewSrc, setPreviewSrc] = useState<string | null>(null);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [resultUrl, setResultUrl] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const handleFile = (f: File) => {
        setFile(f);
        const reader = new FileReader();
        reader.onload = () => setPreviewSrc(reader.result as string);
        reader.readAsDataURL(f);
    };

    const process = async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const res = await uploadFile("/remove-background", file);
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            setResultBlob(blob);
            setResultUrl(url);
            setStatus("done");
        } catch (e: any) { setError(e.message || "Failed"); setStatus("idle"); }
    };

    if (status === "done" && resultUrl) return (
        <div className="space-y-5">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center">
                <h2 className="text-lg font-bold text-foreground mb-4">Background Removed!</h2>
                <div className="grid grid-cols-2 gap-4 mb-6 max-w-md mx-auto">
                    <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Before</p>
                        <div className="rounded-xl border border-border bg-card p-2 aspect-square overflow-hidden">
                            {previewSrc && <img src={previewSrc} alt="Original" className="w-full h-full object-contain" />}
                        </div>
                    </div>
                    <div className="space-y-1">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">After</p>
                        <div className="rounded-xl border border-border p-2 aspect-square overflow-hidden" style={{ background: "repeating-conic-gradient(#e5e5e5 0% 25%, transparent 0% 50%) 50% / 16px 16px" }}>
                            <img src={resultUrl} alt="No background" className="w-full h-full object-contain" />
                        </div>
                    </div>
                </div>
                <div className="flex justify-center gap-3 flex-wrap">
                    <Button className="glow-primary" onClick={() => resultBlob && downloadBlob(resultBlob, `nobg_${file?.name || "image.png"}`)}><Download size={15} /> Download PNG</Button>
                    <Button variant="outline" onClick={() => { setFile(null); setPreviewSrc(null); setResultBlob(null); setResultUrl(null); setStatus("idle"); }}>Process another</Button>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
                onClick={() => ref.current?.click()}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
          role="button"
          tabIndex={0}
          aria-label="Upload file"
                className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-12 px-6 text-center",
                    drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 bg-secondary/20")}>
                <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.webp,.bmp" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
                <Eraser size={22} className={drag ? "text-primary" : "text-muted-foreground"} />
                <p className="text-sm font-semibold text-foreground">{file ? file.name : "Drop image here"}</p>
                {file && <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>}
                <p className="text-[11px] text-muted-foreground/80">AI-powered background removal · Runs on-device</p>
            </div>

            {previewSrc && (
                <div className="rounded-xl border border-border bg-card p-3 flex justify-center">
                    <img src={previewSrc} alt="Preview" className="max-h-40 rounded-lg object-contain" />
                </div>
            )}

            {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}

            {file && (
                <Button onClick={process} disabled={status === "processing"} className="w-full glow-primary">
                    {status === "processing" ? <><Loader2 size={15} className="animate-spin" /> Removing background…</> : "Remove Background"}
                </Button>
            )}
        </div>
    );
}
