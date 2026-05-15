import { useState, useRef } from "react";
import { Upload, Download, Loader2, AlertCircle, LayoutGrid } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { downloadBlob, formatFileSize } from "@/lib/api";

const API_BASE = "/api";

export function CollageUI() {
    const [files, setFiles] = useState<File[]>([]);
    const [columns, setColumns] = useState(3);
    const [spacing, setSpacing] = useState(10);
    const [bgColor, setBgColor] = useState("#ffffff");
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const addFiles = (newFiles: FileList | File[]) => {
        const imgs = Array.from(newFiles).filter(f => f.type.startsWith("image/"));
        setFiles(prev => [...prev, ...imgs]);
    };

    const process = async () => {
        if (files.length < 2) return;
        setStatus("processing"); setError(null);
        try {
            const fd = new FormData();
            for (const f of files) fd.append("files", f);
            fd.append("columns", String(columns));
            fd.append("spacing", String(spacing));
            fd.append("bg_color", bgColor);
            const res = await fetch(`${API_BASE}/make-collage`, { method: "POST", body: fd });
            if (!res.ok) { const b = await res.json().catch(() => ({ detail: "Failed" })); throw new Error(b.detail); }
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
        } catch (e: any) { setError(e.message || "Failed"); setStatus("idle"); }
    };

    if (status === "done") return (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
            <LayoutGrid size={28} className="mx-auto mb-3 text-emerald-400" />
            <h2 className="text-lg font-bold text-foreground mb-1">Collage Created!</h2>
            <p className="text-sm text-muted-foreground mb-6">{files.length} images arranged in {columns} columns</p>
            <div className="flex justify-center gap-3 flex-wrap">
                <Button className="glow-primary" onClick={() => resultBlob && downloadBlob(resultBlob, "collage.jpg")}><Download size={15} /> Download</Button>
                <Button variant="outline" onClick={() => { setFiles([]); setStatus("idle"); setResultBlob(null); }}>Create another</Button>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); addFiles(e.dataTransfer.files); }}
                onClick={() => ref.current?.click()}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
          role="button"
          tabIndex={0}
          aria-label="Upload file"
                className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-10 px-6 text-center",
                    drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 bg-secondary/20")}>
                <input ref={ref} type="file" accept="image/*" multiple className="hidden" onChange={e => e.target.files && addFiles(e.target.files)} />
                <Upload size={22} className={drag ? "text-primary" : "text-muted-foreground"} />
                <p className="text-sm font-semibold text-foreground">{files.length > 0 ? `${files.length} image(s) selected` : "Drop images here"}</p>
                <p className="text-[11px] text-muted-foreground/80">Select at least 2 images · JPG, PNG, WEBP</p>
            </div>

            {files.length > 0 && (
                <>
                    <div className="flex flex-wrap gap-1.5">
                        {files.map((f, i) => (
                            <div key={i} className="flex items-center gap-1 rounded-lg border border-border bg-card px-2 py-1 text-[10px]">
                                <span className="text-foreground truncate max-w-[100px]">{f.name}</span>
                                <button onClick={() => setFiles(prev => prev.filter((_, j) => j !== i))} className="text-muted-foreground hover:text-destructive">×</button>
                            </div>
                        ))}
                    </div>

                    <div className="grid grid-cols-3 gap-3">
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Columns</label>
                            <input type="number" min={1} max={10} value={columns} onChange={e => setColumns(+e.target.value)}
                                className="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm text-foreground focus:outline-none text-center" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Spacing (px)</label>
                            <input type="number" min={0} max={50} value={spacing} onChange={e => setSpacing(+e.target.value)}
                                className="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm text-foreground focus:outline-none text-center" />
                        </div>
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Background</label>
                            <div className="flex items-center gap-2">
                                <input type="color" value={bgColor} onChange={e => setBgColor(e.target.value)} className="h-8 w-8 rounded border border-border cursor-pointer" />
                                <span className="text-[10px] text-muted-foreground">{bgColor}</span>
                            </div>
                        </div>
                    </div>
                </>
            )}

            {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}

            {files.length >= 2 && (
                <Button onClick={process} disabled={status === "processing"} className="w-full glow-primary">
                    {status === "processing" ? <><Loader2 size={15} className="animate-spin" /> Creating…</> : `Create Collage (${files.length} images)`}
                </Button>
            )}
        </div>
    );
}
