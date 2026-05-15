import { useState } from "react";
import { Upload, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { processAndDownload, buildOutputFilename } from "@/lib/api";

const formats = ["mp3", "wav", "aac", "flac", "ogg"];

export function ExtractAudioUI() {
  const [file, setFile] = useState<File | null>(null);
  const [format, setFormat] = useState("mp3");
  const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const process = async () => {
    if (!file) return;
    setStatus("processing"); setError(null);
    try { await processAndDownload("/extract-audio", file, buildOutputFilename(file.name, null, format), { format }); setStatus("done"); }
    catch (e: any) { setError(e.message || "Failed"); setStatus("idle"); }
  };

  return (
    <div className="space-y-5">
      <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-secondary/30 px-6 py-12 cursor-pointer hover:border-accent/40 transition-all">
        <Upload size={22} className="text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">{file ? file.name : "Drop video here"}</p>
        <p className="text-xs text-muted-foreground">MP4, WebM, AVI, MOV, MKV</p>
        <input type="file" accept=".mp4,.webm,.avi,.mov,.mkv" className="hidden" onChange={e => e.target.files?.[0] && setFile(e.target.files[0])} />
      </label>
      <div className="rounded-xl border border-border bg-card p-5">
        <label className="text-sm font-semibold text-foreground">Output format</label>
        <div className="flex flex-wrap gap-2 mt-2">
          {formats.map(f => (
            <button key={f} onClick={() => setFormat(f)}
              className={cn("rounded-lg border px-4 py-2 text-xs font-medium transition-all uppercase",
                format === f ? "border-accent bg-accent/10 text-primary" : "border-border text-muted-foreground")}>{f}</button>
          ))}
        </div>
      </div>
      {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} />{error}</div>}
      {status === "done" ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
          <p className="text-sm font-semibold text-emerald-400 mb-3">Audio extracted!</p>
          <Button variant="outline" onClick={() => { setFile(null); setStatus("idle"); }}>Extract another</Button>
        </div>
      ) : (
        <Button className="w-full" disabled={!file || status === "processing"} onClick={process}>
          {status === "processing" ? <><Loader2 size={14} className="animate-spin mr-2" />Extracting…</> : "Extract Audio"}
        </Button>
      )}
    </div>
  );
}
