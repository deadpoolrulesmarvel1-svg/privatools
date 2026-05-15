import { useState, useRef } from "react";
import { Upload, Loader2, AlertCircle, Presentation } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { processAndDownload, formatFileSize } from "@/lib/api";

export function PdfToPptxUI() {
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const process = async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try { await processAndDownload("/pdf-to-pptx", file, file.name.replace(/\.pdf$/i, ".pptx")); setStatus("done"); }
        catch (e: any) { setError(e.message || "Failed"); setStatus("idle"); }
    };

    if (status === "done") return (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
            <Presentation size={28} className="mx-auto mb-3 text-emerald-400" />
            <h2 className="text-lg font-bold text-foreground mb-1">Converted!</h2>
            <p className="text-sm text-muted-foreground mb-4">Your PowerPoint file has been downloaded</p>
            <Button variant="outline" onClick={() => { setFile(null); setStatus("idle"); }}>Convert another</Button>
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
                    drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 hover:bg-secondary/40 bg-secondary/20")}>
                <input ref={ref} type="file" accept=".pdf" className="hidden" onChange={e => e.target.files?.[0] && setFile(e.target.files[0])} />
                <Upload size={22} className={drag ? "text-primary" : "text-muted-foreground"} />
                <p className="text-sm font-semibold text-foreground">{file ? file.name : "Drop PDF here"}</p>
                {file && <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>}
                <p className="text-[11px] text-muted-foreground/80">Each PDF page becomes a PowerPoint slide</p>
            </div>
            {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}
            {file && (
                <div className="flex items-center gap-3">
                    <Button onClick={process} disabled={status === "processing"} className="glow-primary">
                        {status === "processing" ? <><Loader2 size={15} className="animate-spin" /> Converting…</> : "Convert to PowerPoint"}
                    </Button>
                    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setFile(null)}>Clear</Button>
                </div>
            )}
        </div>
    );
}
