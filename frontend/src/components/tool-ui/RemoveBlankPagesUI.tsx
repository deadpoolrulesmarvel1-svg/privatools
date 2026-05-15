import { useState } from "react";
import { Upload, FileText, Trash2, Download, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { processAndDownload } from "@/lib/api";

export function RemoveBlankPagesUI() {
  const [file, setFile] = useState<File | null>(null);
  const [sensitivity, setSensitivity] = useState([85]);
  const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const handleFile = (f: File) => { setFile(f); setError(null); };

  const process = async () => {
    if (!file) return;
    setStatus("processing"); setError(null);
    try {
      await processAndDownload("/remove-blank-pages", file, "cleaned.pdf", { sensitivity: sensitivity[0] });
      setStatus("done");
    } catch (e: any) { setError(e.message || "Failed"); setStatus("idle"); }
  };

  return (
    <div className="space-y-5">
      <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-secondary/30 px-6 py-12 cursor-pointer hover:border-accent/40 hover:bg-secondary/50 transition-all">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-secondary"><Upload size={22} className="text-muted-foreground" /></div>
        <div className="text-center"><p className="text-sm font-medium text-foreground">Drop your PDF here</p><p className="text-xs text-muted-foreground mt-1">or click to browse</p></div>
        <input type="file" accept=".pdf" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
      </label>

      {file && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
          <FileText size={16} className="text-primary shrink-0" />
          <span className="text-sm text-foreground flex-1 truncate">{file.name}</span>
          <button onClick={() => { setFile(null); setStatus("idle"); }} className="text-muted-foreground hover:text-foreground"><Trash2 size={14} /></button>
        </div>
      )}

      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <h2 className="text-sm font-semibold text-foreground">Detection Settings</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-sm text-foreground">Blank page sensitivity</Label>
            <span className="text-sm font-mono text-primary">{sensitivity[0]}%</span>
          </div>
          <Slider min={50} max={100} step={5} value={sensitivity} onValueChange={setSensitivity} aria-label="Blank-page detection sensitivity, 50 to 100 percent" />
          <p className="text-xs text-muted-foreground">Higher sensitivity removes pages with slight scan noise.</p>
        </div>
      </div>

      {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}

      {status === "done" ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
          <p className="text-sm font-semibold text-emerald-400 mb-3">Blank pages removed!</p>
          <Button variant="outline" onClick={() => { setFile(null); setStatus("idle"); }}>Process another</Button>
        </div>
      ) : (
        <Button className="w-full" disabled={!file || status === "processing"} onClick={process}>
          {status === "processing" ? <><Loader2 size={14} className="animate-spin mr-2" />Scanning…</> : "Remove Blank Pages"}
        </Button>
      )}
    </div>
  );
}
