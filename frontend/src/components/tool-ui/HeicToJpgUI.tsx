import { useState, useRef } from "react";
import { Upload, Download, Loader2, AlertCircle, Image } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";

const QUALITIES = [
    { value: 85, label: "Standard", desc: "Good balance" },
    { value: 95, label: "High", desc: "Best quality" },
    { value: 70, label: "Compressed", desc: "Smaller file" },
];

export function HeicToJpgUI() {
    const [file, setFile] = useState<File | null>(null);
    const [quality, setQuality] = useState(85);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const process = async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const res = await uploadFile("/heic-to-jpg", file, { quality });
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
        } catch (e: any) { setError(e.message || "Conversion failed"); setStatus("idle"); }
    };

    if (status === "done") return (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
            <Image size={28} className="mx-auto mb-3 text-emerald-400" />
            <h2 className="text-lg font-bold text-foreground mb-1">Converted!</h2>
            <p className="text-sm text-muted-foreground mb-6">HEIC → JPG at {quality}% quality</p>
            <div className="flex justify-center gap-3 flex-wrap">
                <Button className="glow-primary" onClick={() => resultBlob && downloadBlob(resultBlob, file?.name.replace(/\.heic$/i, ".jpg") || "converted.jpg")}><Download size={15} /> Download JPG</Button>
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
                <input ref={ref} type="file" accept=".heic,.heif" className="hidden" onChange={e => e.target.files?.[0] && setFile(e.target.files[0])} />
                <Upload size={22} className={drag ? "text-primary" : "text-muted-foreground"} />
                <p className="text-sm font-semibold text-foreground">{file ? file.name : "Drop HEIC file here"}</p>
                {file && <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>}
                <p className="text-[11px] text-muted-foreground/80">Apple's HEIC format → universal JPG</p>
            </div>

            {file && (
                <div className="space-y-2">
                    <label className="text-sm font-semibold text-foreground">Output Quality</label>
                    <div className="grid grid-cols-3 gap-2">
                        {QUALITIES.map(q => (
                            <button key={q.value} onClick={() => setQuality(q.value)}
                                className={cn("rounded-xl border px-3 py-2.5 text-center transition-all",
                                    quality === q.value ? "border-accent bg-accent/10 ring-1 ring-accent/20" : "border-border bg-card hover:border-accent/30")}>
                                <div className={cn("text-sm font-bold", quality === q.value ? "text-primary" : "text-foreground")}>{q.label}</div>
                                <div className="text-[9px] text-muted-foreground">{q.desc} · {q.value}%</div>
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}

            {file && (
                <Button onClick={process} disabled={status === "processing"} className="w-full glow-primary">
                    {status === "processing" ? <><Loader2 size={15} className="animate-spin" /> Converting…</> : `Convert to JPG (${quality}%)`}
                </Button>
            )}
        </div>
    );
}
