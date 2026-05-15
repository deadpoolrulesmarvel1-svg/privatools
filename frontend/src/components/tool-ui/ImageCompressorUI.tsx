import { useState } from "react";
import { Upload, ImageIcon, Trash2, Download, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { uploadFile, downloadBlob } from "@/lib/api";

interface ImgFile { file: File; preview: string; }

export function ImageCompressorUI() {
  const [files, setFiles] = useState<ImgFile[]>([]);
  const [quality, setQuality] = useState([82]);
  const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const handleFiles = (newFiles: FileList) => {
    const items = Array.from(newFiles).map(f => ({ file: f, preview: URL.createObjectURL(f) }));
    setFiles(p => [...p, ...items]);
  };

  const remove = (i: number) => setFiles(f => f.filter((_, idx) => idx !== i));

  const process = async () => {
    setStatus("processing"); setError(null);
    try {
      for (const f of files) {
        const res = await uploadFile("/image-compressor", f.file, { quality: quality[0] });
        const blob = await res.blob();
        const ext = f.file.name.split(".").pop() || "jpg";
        downloadBlob(blob, `compressed_${f.file.name}`);
      }
      setStatus("done");
    } catch (e: any) { setError(e.message || "Failed"); setStatus("idle"); }
  };

  return (
    <div className="space-y-5">
      <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-secondary/30 px-6 py-12 cursor-pointer hover:border-accent/40 hover:bg-secondary/50 transition-all"
        onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); e.dataTransfer.files && handleFiles(e.dataTransfer.files); }}>
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary"><Upload size={22} className="text-muted-foreground" /></div>
        <div className="text-center"><p className="text-sm font-medium text-foreground">Drop images here</p><p className="text-xs text-muted-foreground mt-1">JPEG, PNG, WebP — multiple files supported</p></div>
        <input type="file" accept=".jpg,.jpeg,.png,.webp" multiple className="hidden" onChange={e => e.target.files && handleFiles(e.target.files)} />
      </label>

      {files.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {files.map((f, i) => (
            <div key={i} className="relative group rounded-lg overflow-hidden border border-border bg-card aspect-square">
              <img src={f.preview} alt={f.file.name} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-background/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                <button onClick={() => remove(i)} className="rounded-full bg-card p-1.5 text-muted-foreground hover:text-foreground"><Trash2 size={14} /></button>
              </div>
              <div className="absolute bottom-0 left-0 right-0 bg-background/80 px-2 py-1">
                <p className="text-xs text-muted-foreground truncate">{f.file.name}</p>
                <p className="text-xs text-muted-foreground">{(f.file.size / 1024).toFixed(0)} KB</p>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Compression Settings</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm text-foreground">Quality</Label>
            <span className="text-sm font-mono text-primary">{quality[0]}%</span>
          </div>
          <Slider min={20} max={100} step={1} value={quality} onValueChange={setQuality} aria-label="JPEG quality, 20 to 100 percent" />
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Smaller file</span><span>Higher quality</span>
          </div>
        </div>
      </div>

      {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}

      {status === "done" ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
          <p className="text-sm font-semibold text-emerald-400 mb-3">Compressed!</p>
          <Button variant="outline" onClick={() => { setFiles([]); setStatus("idle"); }}>Compress more</Button>
        </div>
      ) : (
        <Button className="w-full" disabled={files.length === 0 || status === "processing"} onClick={process}>
          {status === "processing" ? <><Loader2 size={14} className="animate-spin mr-2" />Compressing…</> : `Compress ${files.length > 0 ? files.length : ""} Image${files.length !== 1 ? "s" : ""}`}
        </Button>
      )}
    </div>
  );
}
