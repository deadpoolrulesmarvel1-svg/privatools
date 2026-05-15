import { useState } from "react";
import { Upload, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { processAndDownload } from "@/lib/api";

export function VideoToGifUI() {
  const [file, setFile] = useState<File | null>(null);
  const [fps, setFps] = useState(10);
  const [width, setWidth] = useState(480);
  const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const process = async () => {
    if (!file) return;
    setStatus("processing"); setError(null);
    try { await processAndDownload("/video-to-gif", file, "output.gif", { fps, width }); setStatus("done"); }
    catch (e: any) { setError(e.message || "Failed"); setStatus("idle"); }
  };

  return (
    <div className="space-y-5">
      <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-secondary/30 px-6 py-12 cursor-pointer hover:border-accent/40 transition-all">
        <Upload size={22} className="text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">{file ? file.name : "Drop video here"}</p>
        <p className="text-xs text-muted-foreground">MP4, WebM, AVI, MOV</p>
        <input type="file" accept=".mp4,.webm,.avi,.mov" className="hidden" onChange={e => e.target.files?.[0] && setFile(e.target.files[0])} />
      </label>
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs font-medium text-muted-foreground">FPS</label>
            <input type="number" value={fps} onChange={e => setFps(parseInt(e.target.value) || 10)} min={1} max={30}
              className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none" /></div>
          <div><label className="text-xs font-medium text-muted-foreground">Width (px)</label>
            <input type="number" value={width} onChange={e => setWidth(parseInt(e.target.value) || 480)} min={100}
              className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none" /></div>
        </div>
      </div>
      {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} />{error}</div>}
      {status === "done" ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
          <p className="text-sm font-semibold text-emerald-400 mb-3">GIF created!</p>
          <Button variant="outline" onClick={() => { setFile(null); setStatus("idle"); }}>Convert another</Button>
        </div>
      ) : (
        <Button className="w-full" disabled={!file || status === "processing"} onClick={process}>
          {status === "processing" ? <><Loader2 size={14} className="animate-spin mr-2" />Converting…</> : "Convert to GIF"}
        </Button>
      )}
    </div>
  );
}
