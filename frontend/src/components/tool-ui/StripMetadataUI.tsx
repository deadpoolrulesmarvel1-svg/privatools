import { useState, useRef, useEffect, useCallback } from "react";
import { Loader2, CheckCircle2, X, FileText, AlertCircle, DatabaseZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { processFilesAndDownload, formatFileSize, buildOutputFilename, MAX_FILE_SIZE_LABEL } from "@/lib/api";

type StripFile = { id: string; name: string; size: string; raw: File };
let fileId = 0;

export function StripMetadataUI() {
    const [files, setFiles] = useState<StripFile[]>([]);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const addFiles = (fl: FileList) => {
        const newFiles: StripFile[] = Array.from(fl)
            .filter(f => f.name.toLowerCase().endsWith(".pdf"))
            .map(f => ({ id: String(++fileId), name: f.name, size: formatFileSize(f.size), raw: f }));
        if (newFiles.length) { setFiles(prev => [...prev, ...newFiles]); setState("idle"); setError(null); }
    };

    const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));
    const canProcess = files.length > 0 && state !== "processing";

    const process = useCallback(async () => {
        if (!files.length) return;
        setState("processing"); setError(null);
        try {
            const outExt = files.length === 1 ? "pdf" : "zip";
            const outName = buildOutputFilename(files[0]?.raw.name, "stripped", outExt);
            await processFilesAndDownload("/strip-metadata", files.map(f => f.raw), outName);
            setState("done");
        } catch (e: any) { setError(e.message || "Failed"); setState("idle"); }
    }, [files]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);

    if (state === "done") return (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
            <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
            <h2 className="text-lg font-bold text-foreground mb-1">Metadata Stripped!</h2>
            <p className="text-sm text-muted-foreground mb-6">All hidden metadata has been removed from your {files.length > 1 ? "PDFs" : "PDF"}.</p>
            <Button variant="outline" className="border-border text-muted-foreground" onClick={() => { setFiles([]); setState("idle"); }}>Strip more</Button>
        </div>
    );

    return (
        <div className="space-y-4">
            <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button" tabIndex={0} aria-label="Upload files"
                className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-14 px-6 text-center",
                    drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 hover:bg-secondary/40 bg-secondary/20")}>
                <input ref={ref} type="file" accept=".pdf" multiple className="hidden" onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
                <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", drag ? "bg-accent/20" : "bg-secondary")}>
                    <DatabaseZap size={22} className={drag ? "text-primary" : "text-muted-foreground"} strokeWidth={1.5} />
                </div>
                <p className="text-sm font-semibold text-foreground">{files.length ? "Add more PDFs" : "Select PDFs to strip metadata"}</p>
                <p className="text-xs text-muted-foreground">Drag & drop or click · Multiple files supported · Max {MAX_FILE_SIZE_LABEL} each</p>
            </div>

            {files.length > 0 && (
                <>
                    <div className="space-y-2">
                        {files.map(f => (
                            <div key={f.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary"><FileText size={14} className="text-muted-foreground" /></div>
                                <div className="flex-1 min-w-0"><p className="text-sm font-medium text-foreground truncate">{f.name}</p><p className="text-xs text-muted-foreground">{f.size}</p></div>
                                <button onClick={() => removeFile(f.id)} className="text-muted-foreground hover:text-foreground"><X size={15} /></button>
                            </div>
                        ))}
                    </div>

                    <div className="rounded-xl border border-border bg-card p-4">
                        <p className="text-xs text-muted-foreground">This will remove: author, creation date, modification date, GPS coordinates, software info, and all XMP metadata.</p>
                    </div>

                    {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}

                    <div className="flex items-center gap-3">
                        <Button onClick={process} disabled={!canProcess} className="glow-primary">
                            {state === "processing" ? <><Loader2 size={15} className="animate-spin" />Stripping…</> : `Strip ${files.length > 1 ? `${files.length} PDFs` : "PDF"}`}
                        </Button>
                        {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>}
                    </div>
                </>
            )}
        </div>
    );
}
