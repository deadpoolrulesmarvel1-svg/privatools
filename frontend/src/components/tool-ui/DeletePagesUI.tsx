import { useState } from "react";
import { Loader2, AlertCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { processAndDownload, buildOutputFilename } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";

export function DeletePagesUI() {
  const [file, setFile] = useState<File | null>(null);
  const [pages, setPages] = useState("1,3-5");
  const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const process = async () => {
    if (!file || !pages.trim()) return;
    setStatus("processing");
    setError(null);
    try {
      await processAndDownload("/delete-pages", file, buildOutputFilename(file.name, "trimmed", "pdf"), { pages });
      setStatus("done");
    } catch (e: any) {
      setError(e.message || "Delete pages failed");
      setStatus("idle");
    }
  };

  if (status === "done") {
    return (
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
        <Trash2 size={30} className="mx-auto mb-3 text-emerald-400" />
        <h2 className="mb-1 text-lg font-bold text-foreground">Pages Deleted</h2>
        <p className="mb-5 text-sm text-muted-foreground">Your updated PDF has been downloaded.</p>
        <Button variant="outline" onClick={() => { setFile(null); setStatus("idle"); }}>Process another</Button>
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
        label="Drop PDF to delete pages"
        hint="Use range syntax like 1,3-5,9"
      />
      <div className="rounded-xl border border-border bg-card p-4">
        <label className="text-sm font-semibold text-foreground">Pages to delete</label>
        <input
          value={pages}
          onChange={e => setPages(e.target.value)}
          placeholder="e.g. 1,3-5,9"
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
        {status === "processing" ? <><Loader2 size={15} className="animate-spin" />Deleting…</> : "Delete Pages"}
      </Button>
    </div>
  );
}
