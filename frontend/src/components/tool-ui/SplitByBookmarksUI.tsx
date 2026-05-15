import { useState } from "react";
import { Loader2, AlertCircle, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { processAndDownload, buildOutputFilename } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";

export function SplitByBookmarksUI() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const process = async () => {
    if (!file) return;
    setStatus("processing");
    setError(null);
    try {
      await processAndDownload("/split-by-bookmarks", file, buildOutputFilename(file.name, "split_bookmarks", "zip"));
      setStatus("done");
    } catch (e: any) {
      setError(e.message || "Split by bookmarks failed");
      setStatus("idle");
    }
  };

  if (status === "done") {
    return (
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
        <BookOpen size={30} className="mx-auto mb-3 text-emerald-400" />
        <h2 className="mb-1 text-lg font-bold text-foreground">Split Complete</h2>
        <p className="mb-5 text-sm text-muted-foreground">Bookmarks were split and downloaded as a ZIP.</p>
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
        label="Drop PDF with bookmarks"
        hint="Chapters/sections will be split into separate PDFs"
      />
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle size={15} className="shrink-0" />
          {error}
        </div>
      )}
      <Button onClick={process} disabled={!file || status === "processing"} className="glow-primary">
        {status === "processing" ? <><Loader2 size={15} className="animate-spin" />Splitting…</> : "Split by Bookmarks"}
      </Button>
    </div>
  );
}
