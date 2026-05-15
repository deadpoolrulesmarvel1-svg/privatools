import { useState, useRef } from "react";
import { Loader2, AlertCircle, X, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { processAndDownload, processFilesAndDownload, formatFileSize, buildOutputFilename } from "@/lib/api";

type ExifFile = { id: string; name: string; size: string; raw: File };
let fileId = 0;

export function RemoveExifUI() {
  const [files, setFiles] = useState<ExifFile[]>([]);
  const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const addFiles = (fl: FileList) => {
    const newFiles: ExifFile[] = Array.from(fl)
      .filter(f => /\.(jpe?g|png|webp|tiff?)$/i.test(f.name))
      .map(f => ({ id: String(++fileId), name: f.name, size: formatFileSize(f.size), raw: f }));
    if (newFiles.length) { setFiles(prev => [...prev, ...newFiles]); setStatus("idle"); setError(null); }
  };

  const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));

  const process = async () => {
    if (!files.length) return;
    setStatus("processing"); setError(null);
    try {
      if (files.length === 1) {
        await processAndDownload("/remove-exif", files[0].raw, `clean_${files[0].name}`);
      } else {
        await processFilesAndDownload("/remove-exif", files.map(f => f.raw), buildOutputFilename(files[0]?.raw.name, "clean", "zip"));
      }
      setStatus("done");
    } catch (e: any) { setError(e.message || "Failed"); setStatus("idle"); }
  };

  if (status === "done") return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
      <p className="text-lg font-bold text-foreground mb-1">EXIF Data Removed!</p>
      <p className="text-sm text-muted-foreground mb-6">{files.length > 1 ? `${files.length} images cleaned` : "Image cleaned"} and downloaded.</p>
      <Button variant="outline" className="border-border text-muted-foreground" onClick={() => { setFiles([]); setStatus("idle"); }}>Clean more</Button>
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
        <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.webp,.tiff" multiple className="hidden" onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", drag ? "bg-accent/20" : "bg-secondary")}>
          <ImageIcon size={22} className={drag ? "text-primary" : "text-muted-foreground"} strokeWidth={1.5} />
        </div>
        <p className="text-sm font-semibold text-foreground">{files.length ? "Add more images" : "Select images to clean"}</p>
        <p className="text-xs text-muted-foreground">JPEG, PNG, WebP, TIFF · Multiple files supported</p>
      </div>

      {files.length > 0 && (
        <>
          <div className="space-y-2">
            {files.map(f => (
              <div key={f.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary"><ImageIcon size={14} className="text-muted-foreground" /></div>
                <div className="flex-1 min-w-0"><p className="text-sm font-medium text-foreground truncate">{f.name}</p><p className="text-xs text-muted-foreground">{f.size}</p></div>
                <button onClick={() => removeFile(f.id)} className="text-muted-foreground hover:text-foreground"><X size={15} /></button>
              </div>
            ))}
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <p className="text-xs text-muted-foreground">Removes: GPS location, camera model, timestamps, lens info, and all EXIF/XMP metadata.</p>
          </div>

          {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}

          <Button onClick={process} disabled={status === "processing"} className="glow-primary">
            {status === "processing" ? <><Loader2 size={15} className="animate-spin" />Removing…</> : `Remove EXIF from ${files.length > 1 ? `${files.length} images` : "image"}`}
          </Button>
        </>
      )}
    </div>
  );
}
