import { useState } from "react";
import { Loader2, AlertCircle, Maximize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { processAndDownload, buildOutputFilename } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";

export function SplitBySizeUI() {
  const [file, setFile] = useState<File | null>(null);
  const [maxSizeMb, setMaxSizeMb] = useState(10);
  const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const process = async () => {
    if (!file || maxSizeMb <= 0) return;
    setStatus("processing");
    setError(null);
    try {
      await processAndDownload("/split-by-size", file, buildOutputFilename(file.name, "split", "zip"), { max_size_mb: maxSizeMb });
      setStatus("done");
    } catch (e: any) {
      setError(e.message || "Split by size failed");
      setStatus("idle");
    }
  };

  if (status === "done") {
    return (
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
        <Maximize2 size={30} className="mx-auto mb-3 text-emerald-400" />
        <h2 className="mb-1 text-lg font-bold text-foreground">Split Complete</h2>
        <p className="mb-5 text-sm text-muted-foreground">Parts up to {maxSizeMb} MB were downloaded as a ZIP.</p>
        <Button variant="outline" onClick={() => { setFile(null); setStatus("idle"); }}>Split another</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <FileUploadZone
        file={file}
        onFileSelect={setFile}
        onClear={() => setFile(null)}
        accept=".pdf"
        label="Drop PDF to split by size"
        hint="Creates ZIP parts that target your max size"
      />
      <div className="rounded-xl border border-border bg-card p-4">
        <label className="text-sm font-semibold text-foreground">Max part size (MB)</label>
        <input
          type="number"
          min={1}
          max={1024}
          value={maxSizeMb}
          onChange={e => setMaxSizeMb(Math.max(1, parseInt(e.target.value || "1", 10)))}
          className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50"
        />
      </div>
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle size={15} className="shrink-0" />
          {error}
        </div>
      )}
      <Button onClick={process} disabled={!file || status === "processing"} className="glow-primary">
        {status === "processing" ? <><Loader2 size={15} className="animate-spin" />Splitting…</> : "Split by Size"}
      </Button>
    </div>
  );
}
