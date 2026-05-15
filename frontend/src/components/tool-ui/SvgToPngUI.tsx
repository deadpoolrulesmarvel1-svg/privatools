import { useState, useRef } from "react";
import { Upload, Download, Loader2, AlertCircle, Scaling } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";

const SCALES = [
    { value: 1, label: "1x", desc: "Original" },
    { value: 2, label: "2x", desc: "Default" },
    { value: 3, label: "3x", desc: "High DPI" },
    { value: 4, label: "4x", desc: "Ultra HD" },
];

export function SvgToPngUI() {
    const [file, setFile] = useState<File | null>(null);
    const [scale, setScale] = useState(2);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const process = async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const res = await uploadFile("/svg-to-png", file, { scale });
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
        } catch (e: any) { setError(e.message || "Failed"); setStatus("idle"); }
    };

    if (status === "done") return (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
            <h2 className="text-lg font-bold text-foreground mb-1">Converted!</h2>
            <p className="text-sm text-muted-foreground mb-6">SVG converted to {scale}x PNG</p>
            <div className="flex justify-center gap-3 flex-wrap">
                <Button className="glow-primary" onClick={() => resultBlob && downloadBlob(resultBlob, file?.name.replace(/\.svg$/i, ".png") || "converted.png")}><Download size={15} /> Download PNG</Button>
                <Button variant="outline" onClick={() => { setFile(null); setStatus("idle"); setResultBlob(null); }}>Convert another</Button>
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
                className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-12 px-6 text-center",
                    drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 bg-secondary/20")}>
                <input ref={ref} type="file" accept=".svg" className="hidden" onChange={e => e.target.files?.[0] && setFile(e.target.files[0])} />
                <Upload size={22} className={drag ? "text-primary" : "text-muted-foreground"} />
                <p className="text-sm font-semibold text-foreground">{file ? file.name : "Drop SVG file here"}</p>
                {file && <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>}
            </div>

            {file && (
                <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">Output Scale</label>
                    <div className="grid grid-cols-4 gap-2">
                        {SCALES.map(s => (
                            <button key={s.value} onClick={() => setScale(s.value)}
                                className={cn("rounded-xl border px-3 py-2.5 text-center transition-all",
                                    scale === s.value ? "border-accent bg-accent/10 ring-1 ring-accent/20" : "border-border bg-card hover:border-accent/30")}>
                                <div className={cn("text-sm font-bold", scale === s.value ? "text-primary" : "text-foreground")}>{s.label}</div>
                                <div className="text-[9px] text-muted-foreground">{s.desc}</div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}

            {file && (
                <Button onClick={process} disabled={status === "processing"} className="w-full glow-primary">
                    {status === "processing" ? <><Loader2 size={15} className="animate-spin" /> Converting…</> : `Convert at ${scale}x Scale`}
                </Button>
            )}
        </div>
    );
}
