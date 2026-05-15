import { useState, useRef } from "react";
import { Upload, Loader2, AlertCircle, FileText, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatFileSize, downloadBlob } from "@/lib/api";

export function CreateZipUI() {
  const [files, setFiles] = useState<{ id: string; name: string; size: string; file: File }[]>([]);
  const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const add = (fl: FileList) => {
    setFiles(p => [...p, ...Array.from(fl).map(f => ({ id: Math.random().toString(36).slice(2), name: f.name, size: formatFileSize(f.size), file: f }))]);
  };

  const process = async () => {
    setStatus("processing"); setError(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append("files", f.file);
      const res = await fetch("/api/create-zip", { method: "POST", body: fd });
      if (!res.ok) { const b = await res.json().catch(() => ({ detail: "Failed" })); throw new Error(b.detail); }
      const blob = await res.blob();
      downloadBlob(blob, "archive.zip");
      setStatus("done");
    } catch (e: any) { setError(e.message || "Failed"); setStatus("idle"); }
  };

  return (
    <div className="space-y-5">
      <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-secondary/30 px-6 py-12 cursor-pointer hover:border-accent/40 transition-all"
        onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); e.dataTransfer.files && add(e.dataTransfer.files); }}>
        <Upload size={22} className="text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">Drop files here to zip</p>
        <p className="text-xs text-muted-foreground">Any file types — add as many as needed</p>
        <input ref={ref} type="file" multiple className="hidden" onChange={e => e.target.files && add(e.target.files)} />
      </label>
      {files.length > 0 && (
        <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-secondary/30">
            <span className="text-xs font-medium text-muted-foreground">{files.length} files</span>
            <button type="button" onClick={() => ref.current?.click()} className="flex items-center gap-1 text-xs text-primary hover:underline">
              <Plus size={12} /> Add more
            </button>
          </div>
          {files.map(f => (
            <div key={f.id} className="flex items-center gap-3 px-4 py-2.5">
              <FileText size={13} className="text-muted-foreground shrink-0" />
              <span className="text-sm text-foreground flex-1 truncate">{f.name}</span>
              <span className="text-xs text-muted-foreground">{f.size}</span>
              <button onClick={() => setFiles(p => p.filter(x => x.id !== f.id))} className="text-muted-foreground hover:text-foreground"><X size={13} /></button>
            </div>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground/80">
        Standard ZIP archives are generated locally. Password-encrypted ZIP output is not enabled yet.
      </p>
      {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} />{error}</div>}
      {status === "done" ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
          <p className="text-sm font-semibold text-emerald-400 mb-3">ZIP created!</p>
          <Button variant="outline" onClick={() => { setFiles([]); setStatus("idle"); }}>Create another</Button>
        </div>
      ) : (
        <Button className="w-full" disabled={files.length === 0 || status === "processing"} onClick={process}>
          {status === "processing" ? <><Loader2 size={14} className="animate-spin mr-2" />Creating…</> : `Create ZIP (${files.length} files)`}
        </Button>
      )}
    </div>
  );
}
