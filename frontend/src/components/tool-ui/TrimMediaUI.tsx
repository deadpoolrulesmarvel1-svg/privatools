import { useState } from "react";
import { Upload, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { processAndDownload, buildOutputFilename } from "@/lib/api";

export function TrimMediaUI() {
  const [file, setFile] = useState<File | null>(null);
  const [start, setStart] = useState("00:00:00");
  const [end, setEnd] = useState("00:00:10");
  const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const process = async () => {
    if (!file) return;
    setStatus("processing"); setError(null);
    try {
      const ext = file.name.split(".").pop() || "mp4";
      await processAndDownload("/trim-media", file, buildOutputFilename(file.name, "trimmed", ext), { start, end });
      setStatus("done");
    } catch (e: any) { setError(e.message || "Failed"); setStatus("idle"); }
  };

  return (
    <div className="space-y-5">
      <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-secondary/30 px-6 py-12 cursor-pointer hover:border-accent/40 transition-all">
        <Upload size={22} className="text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">{file ? file.name : "Drop video/audio here"}</p>
        <p className="text-xs text-muted-foreground">MP4, MP3, WebM, AVI, WAV</p>
        <input type="file" accept=".mp4,.mp3,.webm,.avi,.wav,.mov,.mkv,.aac,.flac,.ogg" className="hidden" onChange={e => e.target.files?.[0] && setFile(e.target.files[0])} />
      </label>
      <div className="rounded-xl border border-border bg-card p-5 space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="text-xs font-medium text-muted-foreground">Start time (HH:MM:SS)</label>
            <input value={start} onChange={e => setStart(e.target.value)} placeholder="00:00:00"
              className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none font-mono" /></div>
          <div><label className="text-xs font-medium text-muted-foreground">End time (HH:MM:SS)</label>
            <input value={end} onChange={e => setEnd(e.target.value)} placeholder="00:00:10"
              className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none font-mono" /></div>
        </div>
      </div>
      {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} />{error}</div>}
      {status === "done" ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
          <p className="text-sm font-semibold text-emerald-400 mb-3">Trimmed!</p>
          <Button variant="outline" onClick={() => { setFile(null); setStatus("idle"); }}>Trim another</Button>
        </div>
      ) : (
        <Button className="w-full" disabled={!file || status === "processing"} onClick={process}>
          {status === "processing" ? <><Loader2 size={14} className="animate-spin mr-2" />Trimming…</> : "Trim Media"}
        </Button>
      )}
    </div>
  );
}
