import { useState, useRef } from "react";
import { Upload, Loader2, CheckCircle2, X, FileText, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { processAndDownload, formatFileSize } from "@/lib/api";

export function BookmarksUI() {
  const [file, setFile] = useState<{ name: string; size: string; raw: File } | null>(null);
  const [bookmarks, setBookmarks] = useState('[{"title": "Chapter 1", "page": 1}, {"title": "Chapter 2", "page": 5}]');
  const [state, setState] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const pick = (fl: FileList) => { const f = fl[0]; setFile({ name: f.name, size: formatFileSize(f.size), raw: f }); setState("idle"); setError(null); };

  const process = async () => {
    if (!file) return;
    setState("processing"); setError(null);
    try {
      await processAndDownload("/bookmarks", file.raw, "bookmarked.pdf", { bookmarks });
      setState("done");
    } catch (e: any) { setError(e.message || "Failed"); setState("idle"); }
  };

  if (state === "done") return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
      <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
      <h2 className="text-lg font-bold text-foreground mb-1">Bookmarks added!</h2>
      <Button variant="outline" className="border-border text-muted-foreground mt-4" onClick={() => { setFile(null); setState("idle"); }}>Process another</Button>
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
          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <label className="text-sm font-semibold text-foreground">Bookmarks (JSON)</label>
            <p className="text-xs text-muted-foreground">Array of {`{title, page}`} objects</p>
            <textarea value={bookmarks} onChange={e => setBookmarks(e.target.value)} rows={4}
              className="w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground font-mono outline-none focus:border-accent/50" />
          </div>
          {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}
          <Button onClick={process} disabled={state === "processing"} className="glow-primary">
            {state === "processing" ? <><Loader2 size={15} className="animate-spin" />Adding…</> : "Add Bookmarks"}
          </Button>
        </>
      )}
    </div>
  );
}
