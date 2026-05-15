import { useState, useRef } from "react";
import { Upload, Download, Loader2, CheckCircle2, X, Image as ImageIcon, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { processFilesAndDownload, formatFileSize, buildOutputFilename } from "@/lib/api";

type PageSize = "auto" | "a4" | "letter";
const sizes: { id: PageSize; label: string; desc: string }[] = [
    { id: "auto", label: "Auto", desc: "Match image dimensions" },
    { id: "a4", label: "A4", desc: "210 × 297 mm" },
    { id: "letter", label: "Letter", desc: "8.5 × 11 in" },
];

interface ImageToPdfUIProps {
    /** HTML <input accept> value — restrict the picker to specific image types. */
    accept?: string;
    /** Human-readable list shown under the dropzone. */
    formatsLabel?: string;
    /** Verb used in the upload prompt — e.g. "JPG", "PNG", "HEIC". */
    nounLabel?: string;
}

export function ImageToPdfUI({
    accept = "image/*",
    formatsLabel = "JPEG, PNG, WebP, BMP, TIFF, HEIC — multiple allowed",
    nounLabel = "image",
}: ImageToPdfUIProps = {}) {
    const [files, setFiles] = useState<{ id: string; name: string; size: string; raw: File }[]>([]);
    const [pageSize, setPageSize] = useState<PageSize>("auto");
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const add = (fl: FileList) => {
        setFiles(p => [...p, ...Array.from(fl).map(f => ({ id: Math.random().toString(36).slice(2), name: f.name, size: formatFileSize(f.size), raw: f }))]);
        setState("idle"); setError(null);
    };

    const process = async () => {
        if (!files.length) return;
        setState("processing"); setError(null);
        try {
            // Use the first image's stem so the output is recognizable.
            // Multi-image case still names after the first image — the user
            // recognizes their batch by it, and avoids invented suffixes.
            const outName = buildOutputFilename(files[0]?.name, null, "pdf");
            await processFilesAndDownload("/image-to-pdf", files.map(f => f.raw), outName, { page_size: pageSize });
            setState("done");
        } catch (e: any) { setError(e.message || "Conversion failed"); setState("idle"); }
    };

    if (state === "done") return (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
            <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
            <h2 className="text-lg font-bold text-foreground mb-1">Converted!</h2>
            <p className="text-sm text-muted-foreground mb-6">{files.length} {nounLabel}{files.length > 1 ? "s" : ""} converted to PDF.</p>
            <Button variant="outline" className="border-border text-muted-foreground" onClick={() => { setFiles([]); setState("idle"); }}>Convert more</Button>
        </div>
    );

    return (
        <div className="space-y-4">
            <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) add(e.dataTransfer.files); }}
                onClick={() => ref.current?.click()}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
          role="button"
          tabIndex={0}
          aria-label="Upload file"
                className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-14 px-6 text-center",
                    drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 hover:bg-secondary/40 bg-secondary/20")}>
                <input ref={ref} type="file" accept={accept} multiple className="hidden" onChange={e => e.target.files && add(e.target.files)} />
                <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", drag ? "bg-accent/20" : "bg-secondary")}>
                    <ImageIcon size={22} className={drag ? "text-primary" : "text-muted-foreground"} strokeWidth={1.5} />
                </div>
                <p className="text-sm font-semibold text-foreground">{files.length ? `Add more ${nounLabel}s` : `Select ${nounLabel}s to convert`}</p>
                <p className="text-xs text-muted-foreground">{formatsLabel}</p>
            </div>

            {files.length > 0 && (
                <>
                    <div className="space-y-2">
                        {files.map(f => (
                            <div key={f.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary"><ImageIcon size={13} className="text-muted-foreground" /></div>
                                <div className="flex-1 min-w-0"><p className="text-sm font-medium text-foreground truncate">{f.name}</p><p className="text-xs text-muted-foreground">{f.size}</p></div>
                                <button onClick={() => setFiles(p => p.filter(x => x.id !== f.id))} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
                            </div>
                        ))}
                    </div>

                    {/* Page size */}
                    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                        <p className="text-sm font-semibold text-foreground">Page Size</p>
                        <div className="flex gap-2">
                            {sizes.map(s => (
                                <button key={s.id} onClick={() => setPageSize(s.id)}
                                    className={cn("flex-1 rounded-xl border p-3 text-left transition-all",
                                        pageSize === s.id ? "border-accent bg-accent/5" : "border-border hover:border-border/70 hover:bg-secondary/40")}>
                                    <p className="text-sm font-medium text-foreground">{s.label}</p>
                                    <p className="text-xs text-muted-foreground">{s.desc}</p>
                                </button>
                            ))}
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                            <AlertCircle size={15} className="shrink-0" />{error}
                        </div>
                    )}

                    <div className="flex gap-3 pt-1">
                        <Button onClick={process} disabled={state === "processing"} className="glow-primary">
                            {state === "processing" ? <><Loader2 size={15} className="animate-spin" />Converting…</> : `Convert ${files.length} image${files.length > 1 ? "s" : ""} to PDF`}
                        </Button>
                        <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setFiles([])}>Clear</Button>
                    </div>
                </>
            )}
        </div>
    );
}
