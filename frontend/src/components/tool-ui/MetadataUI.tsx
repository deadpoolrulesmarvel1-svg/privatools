import { useState, useRef } from "react";
import { Upload, Loader2, CheckCircle2, X, FileText, AlertCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, uploadFileGetJson, downloadBlob, formatFileSize } from "@/lib/api";

export function MetadataUI() {
  const [file, setFile] = useState<{ name: string; size: string; raw: File } | null>(null);
  const [mode, setMode] = useState<"read" | "write">("read");
  const [meta, setMeta] = useState<Record<string, string> | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [subject, setSubject] = useState("");
  const [keywords, setKeywords] = useState("");
  const [state, setState] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const pick = (fl: FileList) => { const f = fl[0]; setFile({ name: f.name, size: formatFileSize(f.size), raw: f }); setState("idle"); setError(null); setMeta(null); };

  const readMeta = async () => {
    if (!file) return;
    setState("processing"); setError(null);
    try {
      const data = await uploadFileGetJson<Record<string, string>>("/metadata", file.raw);
      setMeta(data);
      setTitle(data.title || ""); setAuthor(data.author || ""); setSubject(data.subject || ""); setKeywords(data.keywords || "");
      setState("done");
    } catch (e: any) { setError(e.message || "Failed"); setState("idle"); }
  };

  const writeMeta = async () => {
    if (!file) return;
    setState("processing"); setError(null);
    try {
      const res = await uploadFile("/metadata/update", file.raw, { title, author, subject, keywords });
      const blob = await res.blob();
      downloadBlob(blob, file ? `${file.name.replace(/\.pdf$/i, "")}_metadata.pdf` : "updated_metadata.pdf");
      setState("done");
    } catch (e: any) { setError(e.message || "Failed"); setState("idle"); }
  };

  if (state === "done" && mode === "read" && meta) return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
        <CheckCircle2 size={32} className="mx-auto mb-3 text-emerald-400" strokeWidth={1.5} />
        <h2 className="text-center text-lg font-bold text-foreground mb-4">Metadata</h2>
        <div className="space-y-2">
          {Object.entries(meta).map(([k, v]) => (
            <div key={k} className="flex items-start gap-3 text-sm">
              <span className="text-muted-foreground min-w-[100px] font-medium capitalize">{k.replace(/_/g, " ")}</span>
              <span className="text-foreground break-all">{String(v) || "—"}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="flex gap-3">
        <Button variant="outline" className="border-border text-muted-foreground" onClick={() => { setMode("write"); setState("idle"); }}>Edit metadata</Button>
        <Button variant="outline" className="border-border text-muted-foreground" onClick={() => { setFile(null); setState("idle"); setMeta(null); }}>New file</Button>
      </div>
    </div>
  );

  if (state === "done" && mode === "write") return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
      <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
      <h2 className="text-lg font-bold text-foreground mb-1">Metadata updated!</h2>
      <Button variant="outline" className="border-border text-muted-foreground mt-4" onClick={() => { setFile(null); setState("idle"); setMeta(null); setMode("read"); }}>Process another</Button>
    </div>
  );

  return (
    <div className="space-y-4">
      {!file ? (
        <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) pick(e.dataTransfer.files); }}
          onClick={() => ref.current?.click()}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
          role="button"
          tabIndex={0}
          aria-label="Upload file"
          className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-14 px-6 text-center",
            drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 hover:bg-secondary/40 bg-secondary/20")}>
          <input ref={ref} type="file" accept=".pdf" className="hidden" onChange={e => e.target.files && pick(e.target.files)} />
          <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", drag ? "bg-accent/20" : "bg-secondary")}><Upload size={22} className={drag ? "text-primary" : "text-muted-foreground"} strokeWidth={1.5} /></div>
          <p className="text-sm font-semibold text-foreground">Select a PDF</p><p className="text-xs text-muted-foreground">Drag & drop or click</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary"><FileText size={14} className="text-muted-foreground" /></div>
            <div className="flex-1 min-w-0"><p className="text-sm font-medium text-foreground truncate">{file.name}</p><p className="text-xs text-muted-foreground">{file.size}</p></div>
            <button onClick={() => setFile(null)} className="text-muted-foreground hover:text-foreground"><X size={15} /></button>
          </div>
          <div className="flex gap-2">
            {(["read", "write"] as const).map(m => (
              <button key={m} onClick={() => setMode(m)}
                className={cn("flex-1 rounded-lg border py-2 text-xs font-medium transition-all",
                  mode === m ? "border-accent bg-accent/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary/40")}>
                {m === "read" ? "View metadata" : "Edit metadata"}
              </button>
            ))}
          </div>
          {mode === "write" && (
            <div className="rounded-xl border border-border bg-card p-5 space-y-3">
              <div><label className="text-xs font-medium text-muted-foreground">Title</label>
                <input value={title} onChange={e => setTitle(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50" /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Author</label>
                <input value={author} onChange={e => setAuthor(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50" /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Subject</label>
                <input value={subject} onChange={e => setSubject(e.target.value)} className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50" /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Keywords</label>
                <input value={keywords} onChange={e => setKeywords(e.target.value)} placeholder="comma-separated" className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50" /></div>
            </div>
          )}
          {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}
          <Button onClick={mode === "read" ? readMeta : writeMeta} disabled={state === "processing"} className="glow-primary">
            {state === "processing" ? <><Loader2 size={15} className="animate-spin" />Processing…</> : mode === "read" ? "Read Metadata" : "Update Metadata"}
          </Button>
        </>
      )}
    </div>
  );
}
