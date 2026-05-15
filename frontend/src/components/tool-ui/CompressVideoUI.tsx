import { useState } from "react";
import { Upload, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { processAndDownload } from "@/lib/api";

export function CompressVideoUI() {
  const [file, setFile] = useState<File | null>(null);
  const [quality, setQuality] = useState([28]);
  const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const process = async () => {
    if (!file) return;
    setStatus("processing"); setError(null);
    try { await processAndDownload("/compress-video", file, `compressed_${file.name}`, { quality: quality[0] }); setStatus("done"); }
    catch (e: any) { setError(e.message || "Failed"); setStatus("idle"); }
  };

  return (
    <div className="space-y-5">
      <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-secondary/30 px-6 py-12 cursor-pointer hover:border-accent/40 transition-all">
        <Upload size={22} className="text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">{file ? file.name : "Drop video here"}</p>
        <p className="text-xs text-muted-foreground">{file ? `${(file.size / 1048576).toFixed(1)} MB` : "MP4, WebM, AVI, MOV"}</p>
        <input type="file" accept=".mp4,.webm,.avi,.mov,.mkv" className="hidden" onChange={e => e.target.files?.[0] && setFile(e.target.files[0])} />
      </label>
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="flex items-center justify-between">
          <Label className="text-sm text-foreground">Quality (CRF)</Label>
          <span className="text-sm font-mono text-primary">{quality[0]}</span>
        </div>
        <Slider min={18} max={40} step={1} value={quality} onValueChange={setQuality} aria-label="Video quality (CRF), 18 to 40" />
        <div className="flex justify-between text-xs text-muted-foreground"><span>Higher quality</span><span>Smaller file</span></div>
      </div>
      {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} />{error}</div>}
      {status === "done" ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
          <p className="text-sm font-semibold text-emerald-400 mb-3">Compressed!</p>
          <Button variant="outline" onClick={() => { setFile(null); setStatus("idle"); }}>Compress another</Button>
        </div>
      ) : (
        <Button className="w-full" disabled={!file || status === "processing"} onClick={process}>
          {status === "processing" ? <><Loader2 size={14} className="animate-spin mr-2" />Compressing…</> : "Compress Video"}
        </Button>
      )}
    </div>
  );
}
