import { useState, useRef } from "react";
import { Loader2, CheckCircle2, X, ImageIcon, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { processFilesAndDownload, formatFileSize, buildOutputFilename } from "@/lib/api";

type MergeFile = { id: string; name: string; size: string; raw: File; preview: string };
let fileId = 0;

export function MergeImagesUI() {
    const [files, setFiles] = useState<MergeFile[]>([]);
    const [direction, setDirection] = useState<"horizontal" | "vertical">("horizontal");
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const addFiles = (fl: FileList) => {
        const newFiles: MergeFile[] = Array.from(fl)
            .filter(f => /\.(jpe?g|png|webp|bmp)$/i.test(f.name))
            .map(f => ({ id: String(++fileId), name: f.name, size: formatFileSize(f.size), raw: f, preview: URL.createObjectURL(f) }));
        if (newFiles.length) { setFiles(prev => [...prev, ...newFiles]); setState("idle"); setError(null); }
    };

    const removeFile = (id: string) => {
        setFiles(prev => {
            const f = prev.find(x => x.id === id);
            if (f) URL.revokeObjectURL(f.preview);
            return prev.filter(x => x.id !== id);
        });
    };

    const process = async () => {
        if (files.length < 2) return;
        setState("processing"); setError(null);
        try {
            const outName = buildOutputFilename(files[0]?.raw.name, "merged", "png");
            await processFilesAndDownload("/merge-images", files.map(f => f.raw), outName, { direction });
            setState("done");
        } catch (e: any) { setError(e.message || "Merge failed"); setState("idle"); }
    };

    if (state === "done") return (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
            <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
            <h2 className="text-lg font-bold text-foreground mb-1">Merged!</h2>
            <p className="text-sm text-muted-foreground mb-6">{files.length} images merged {direction}ly and downloaded.</p>
            <Button variant="outline" className="border-border text-muted-foreground" onClick={() => { setFiles([]); setState("idle"); }}>Merge more</Button>
        </div>
    );

    return (
        <div className="space-y-4">
            <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button" tabIndex={0} aria-label="Upload images"
                className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-14 px-6 text-center",
                    drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 hover:bg-secondary/40 bg-secondary/20")}>
                <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.webp,.bmp" multiple className="hidden" onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
                <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", drag ? "bg-accent/20" : "bg-secondary")}>
                    <ImageIcon size={22} className={drag ? "text-primary" : "text-muted-foreground"} strokeWidth={1.5} />
                </div>
                <p className="text-sm font-semibold text-foreground">{files.length ? "Add more images" : "Select images to merge"}</p>
                <p className="text-xs text-muted-foreground">JPG, PNG, WebP, BMP · At least 2 images required</p>
            </div>

            {files.length > 0 && (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {files.map(f => (
                            <div key={f.id} className="relative group rounded-lg border border-border bg-card overflow-hidden">
                                <img src={f.preview} alt={f.name} className="w-full h-24 object-cover" />
                                <div className="px-2 py-1.5"><p className="text-xs text-muted-foreground truncate">{f.name}</p></div>
                                <button onClick={() => removeFile(f.id)} className="absolute top-1 right-1 bg-background/80 rounded-full p-0.5 text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                                    <X size={13} />
                                </button>
                            </div>
                        ))}
                    </div>

                    <div className="rounded-xl border border-border bg-card p-4">
                        <p className="text-sm font-semibold text-foreground mb-2">Direction</p>
                        <div className="flex gap-2">
                            {(["horizontal", "vertical"] as const).map(d => (
                                <button key={d} onClick={() => setDirection(d)}
                                    className={cn("flex-1 py-2 rounded-lg text-sm font-medium border transition-all capitalize",
                                        direction === d ? "border-accent bg-accent/10 text-primary" : "border-border text-muted-foreground")}>
                                    {d === "horizontal" ? "Side by Side" : "Top to Bottom"}
                                </button>
                            ))}
                        </div>
                    </div>

                    {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}

                    <Button onClick={process} disabled={files.length < 2 || state === "processing"} className="glow-primary">
                        {state === "processing" ? <><Loader2 size={15} className="animate-spin" />Merging…</> : `Merge ${files.length} Images`}
                    </Button>
                </>
            )}
        </div>
    );
}
