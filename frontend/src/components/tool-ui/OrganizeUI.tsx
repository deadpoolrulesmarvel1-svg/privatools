import { useState, useRef } from "react";
import { Upload, Loader2, CheckCircle2, X, FileText, AlertCircle, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";

export function OrganizeUI() {
  const [file, setFile] = useState<{ name: string; size: string; raw: File } | null>(null);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [pageOrder, setPageOrder] = useState<number[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "editing" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const pick = async (fl: FileList) => {
    const f = fl[0];
    setFile({ name: f.name, size: formatFileSize(f.size), raw: f });
    setError(null);
    setState("loading");
    try {
      const res = await uploadFile("/organize-pages/thumbnails", f);
      const data = await res.json();
      setThumbnails(data.thumbnails || []);
      setPageOrder(data.thumbnails.map((_: string, i: number) => i + 1));
      setState("editing");
    } catch (e: any) { setError(e.message || "Failed to load thumbnails"); setState("idle"); }
  };

  const moveUp = (i: number) => {
    if (i === 0) return;
    setPageOrder(p => { const c = [...p];[c[i - 1], c[i]] = [c[i], c[i - 1]]; return c; });
  };
  const moveDown = (i: number) => {
    if (i === pageOrder.length - 1) return;
    setPageOrder(p => { const c = [...p];[c[i], c[i + 1]] = [c[i + 1], c[i]]; return c; });
  };
  const removePage = (i: number) => { setPageOrder(p => p.filter((_, idx) => idx !== i)); };

  const process = async () => {
    if (!file) return;
    setState("processing"); setError(null);
    try {
      const res = await uploadFile("/organize-pages", file.raw, { page_order: JSON.stringify(pageOrder) });
      const blob = await res.blob();
      downloadBlob(blob, file ? `${file.name.replace(/\.pdf$/i, "")}_organized.pdf` : "organized.pdf");
      setState("done");
    } catch (e: any) { setError(e.message || "Failed"); setState("editing"); }
  };

  if (state === "done") return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
      <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
      <h2 className="text-lg font-bold text-foreground mb-1">Pages organized!</h2>
      <Button variant="outline" className="border-border text-muted-foreground mt-4" onClick={() => { setFile(null); setState("idle"); setThumbnails([]); setPageOrder([]); }}>Organize another</Button>
    </div>
  );

  return (
    <div className="space-y-4">
      {state === "idle" && (
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
          <p className="text-sm font-semibold text-foreground">Select a PDF to organize</p><p className="text-xs text-muted-foreground">Drag & drop or click</p>
        </div>
      )}

      {state === "loading" && (
        <div className="flex items-center justify-center gap-2 py-10"><Loader2 size={20} className="animate-spin text-primary" /><span className="text-sm text-muted-foreground">Loading page thumbnails…</span></div>
      )}

      {(state === "editing" || state === "processing") && (
        <>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <FileText size={14} className="text-muted-foreground" />
            <span className="text-sm font-medium text-foreground truncate">{file?.name}</span>
            <span className="text-xs text-muted-foreground ml-auto">{pageOrder.length} pages</span>
          </div>
          <div className="grid grid-cols-3 md:grid-cols-5 gap-3">
            {pageOrder.map((pageNum, i) => (
              <div key={`${pageNum}-${i}`} className="rounded-lg border border-border bg-card p-2 text-center group">
                <div className="bg-secondary/30 rounded mb-1 h-20 flex items-center justify-center text-muted-foreground text-xs">Page {pageNum}</div>
                <div className="flex items-center justify-center gap-1">
                  <button onClick={() => moveUp(i)} className="text-xs text-muted-foreground hover:text-foreground" disabled={i === 0}>←</button>
                  <button onClick={() => removePage(i)} className="text-xs text-destructive hover:text-destructive/80">✕</button>
                  <button onClick={() => moveDown(i)} className="text-xs text-muted-foreground hover:text-foreground" disabled={i === pageOrder.length - 1}>→</button>
                </div>
              </div>
            ))}
          </div>
          {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}
          <Button onClick={process} disabled={state === "processing"} className="glow-primary">
            {state === "processing" ? <><Loader2 size={15} className="animate-spin" />Organizing…</> : "Apply & Download"}
          </Button>
        </>
      )}
    </div>
  );
}
