import { useState, useRef } from "react";
import { Upload, Download, Loader2, CheckCircle2, X, FileText, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";

type Fmt = "jpeg" | "png";
const formats: { id: Fmt; label: string; desc: string }[] = [
    { id: "jpeg", label: "JPEG", desc: "Smaller file, lossy" },
    { id: "png", label: "PNG", desc: "Lossless, larger file" },
];
const dpiOptions = [72, 150, 300];

export function PdfToImageUI() {
    const [file, setFile] = useState<{ name: string; size: string; raw: File } | null>(null);
    const [format, setFormat] = useState<Fmt>("jpeg");
    const [dpi, setDpi] = useState(150);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const pick = (fl: FileList) => { const f = fl[0]; setFile({ name: f.name, size: formatFileSize(f.size), raw: f }); setState("idle"); setError(null); };

    const process = async () => {
        if (!file) return;
        setState("processing"); setError(null);
        try {
            const res = await uploadFile("/pdf-to-image", file.raw, { format, dpi });
            const blob = await res.blob();
            setResultBlob(blob);
            setState("done");
        } catch (e: any) { setError(e.message || "Conversion failed"); setState("idle"); }
    };

    const handleDownload = () => {
        if (resultBlob) {
            const ext = format === "jpeg" ? "jpg" : "png";
            downloadBlob(resultBlob, `images.zip`);
        }
    };

    if (state === "done") return (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
            <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
            <h2 className="text-lg font-bold text-foreground mb-1">Converted!</h2>
            <p className="text-sm text-muted-foreground mb-6">Your PDF pages have been converted to {format.toUpperCase()} images.</p>
            <div className="flex justify-center gap-3 flex-wrap">
                <Button className="glow-primary" onClick={handleDownload}><Download size={15} />Download Images</Button>
                <Button variant="outline" className="border-border text-muted-foreground" onClick={() => { setFile(null); setState("idle"); setResultBlob(null); }}>Convert another</Button>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            {!file ? (
                <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                    onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) pick(e.dataTransfer.files); }}
                    onClick={() => ref.current?.click()}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
          role="button"
          tabIndex={0}
          aria-label="Upload file"
                    className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-14 px-6 text-center",
                        drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 hover:bg-secondary/40 bg-secondary/20")}>
                    <input ref={ref} type="file" accept=".pdf" className="hidden" onChange={e => e.target.files && pick(e.target.files)} />
                    <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", drag ? "bg-accent/20" : "bg-secondary")}>
                        <Upload size={22} className={drag ? "text-primary" : "text-muted-foreground"} strokeWidth={1.5} />
                    </div>
                    <p className="text-sm font-semibold text-foreground">Select a PDF to convert</p>
                    <p className="text-xs text-muted-foreground">Each page becomes an image</p>
                </div>
            ) : (
                <>
                    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary"><FileText size={14} className="text-muted-foreground" /></div>
                        <div className="flex-1 min-w-0"><p className="text-sm font-medium text-foreground truncate">{file.name}</p><p className="text-xs text-muted-foreground">{file.size}</p></div>
                        <button onClick={() => setFile(null)} className="text-muted-foreground hover:text-foreground"><X size={15} /></button>
                    </div>

                    {/* Format */}
                    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                        <p className="text-sm font-semibold text-foreground">Output Format</p>
                        <div className="flex gap-2">
                            {formats.map(f => (
                                <button key={f.id} onClick={() => setFormat(f.id)}
                                    className={cn("flex-1 rounded-xl border p-3 text-left transition-all",
                                        format === f.id ? "border-accent bg-accent/5" : "border-border hover:border-border/70 hover:bg-secondary/40")}>
                                    <p className="text-sm font-medium text-foreground">{f.label}</p>
                                    <p className="text-xs text-muted-foreground">{f.desc}</p>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* DPI */}
                    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                        <p className="text-sm font-semibold text-foreground">Resolution (DPI)</p>
                        <div className="flex gap-2">
                            {dpiOptions.map(d => (
                                <button key={d} onClick={() => setDpi(d)}
                                    className={cn("flex-1 rounded-xl border py-2.5 text-center text-sm transition-all",
                                        dpi === d ? "border-accent bg-accent/5 text-primary font-semibold" : "border-border text-muted-foreground hover:border-border/70 hover:bg-secondary/40")}>
                                    {d} DPI
                                </button>
                            ))}
                        </div>
                        <p className="text-xs text-muted-foreground">{dpi <= 72 ? "Screen quality — fast" : dpi <= 150 ? "Good quality — balanced" : "Print quality — slower, larger files"}</p>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                            <AlertCircle size={15} className="shrink-0" />{error}
                        </div>
                    )}

                    <Button onClick={process} disabled={state === "processing"} className="glow-primary">
                        {state === "processing" ? <><Loader2 size={15} className="animate-spin" />Converting…</> : "Convert to Images"}
                    </Button>
                </>
            )}
        </div>
    );
}
