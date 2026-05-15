import { useState, useRef, useCallback } from "react";
import { FileText, Upload, X, Download, Loader2, CheckCircle2, GripVertical, Plus, AlertCircle, ChevronUp, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { processFilesAndDownload, formatFileSize, buildOutputFilename } from "@/lib/api";

interface MergeFile { id: string; name: string; size: string; file: File; pages: string; }

export function MergeUI() {
  const [files, setFiles] = useState<MergeFile[]>([]);
  const [state, setState] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const add = useCallback((fl: FileList) => {
    setFiles(p => [
      ...p,
      ...Array.from(fl).map(f => ({
        id: Math.random().toString(36).slice(2),
        name: f.name,
        size: formatFileSize(f.size),
        file: f,
        pages: "",  // empty = all
      })),
    ]);
    setState("idle");
    setError(null);
  }, []);

  const updatePages = (id: string, pages: string) =>
    setFiles(prev => prev.map(f => (f.id === id ? { ...f, pages } : f)));

  const process = async () => {
    setState("processing");
    setError(null);
    try {
      // Only send page_ranges if at least one file restricts pages.
      const anyRange = files.some(f => f.pages.trim() !== "" && f.pages.trim().toLowerCase() !== "all");
      const params: Record<string, string> | undefined = anyRange
        ? { page_ranges: JSON.stringify(files.map(f => (f.pages.trim() || "all"))) }
        : undefined;
      const outName = buildOutputFilename(files[0]?.file.name, "merged", "pdf");
      await processFilesAndDownload("/merge", files.map(f => f.file), outName, params);
      setState("done");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Merge failed";
      setError(msg);
      setState("idle");
    }
  };

  const moveFile = (fromIndex: number, toIndex: number) => {
    setFiles(prev => {
      if (toIndex < 0 || toIndex >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      return next;
    });
  };

  if (state === "done") return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
      <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
      <h2 className="text-lg font-bold text-foreground mb-1">Merged successfully!</h2>
      <p className="text-sm text-muted-foreground mb-6">{files.length} files combined into <span className="text-foreground font-medium">merged.pdf</span></p>
      <div className="flex justify-center gap-3 flex-wrap">
        <Button variant="outline" className="border-border text-muted-foreground" onClick={() => { setFiles([]); setState("idle"); }}>Merge more files</Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) add(e.dataTransfer.files); }}
        onClick={() => ref.current?.click()}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
        role="button"
        tabIndex={0}
        aria-label="Upload file"
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-10 px-6 text-center",
          drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 hover:bg-secondary/40 bg-secondary/20"
        )}
      >
        <input ref={ref} type="file" accept=".pdf" multiple className="hidden" onChange={e => e.target.files && add(e.target.files)} />
        <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", drag ? "bg-accent/20" : "bg-secondary")}>
          <Upload size={22} className={drag ? "text-primary" : "text-muted-foreground"} strokeWidth={1.5} />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground">{drag ? "Drop PDFs here" : "Click to select or drag & drop PDFs"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">Add as many files as you need</p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle size={15} className="shrink-0" />
          {error}
        </div>
      )}

      {files.length > 0 && (
        <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
          <div className="flex items-center justify-between px-4 py-2.5 bg-secondary/30">
            <span className="text-xs font-medium text-muted-foreground">
              {files.length} file{files.length !== 1 ? "s" : ""} · drag to reorder · leave Pages blank to include all
            </span>
            <button type="button" onClick={() => ref.current?.click()} className="flex items-center gap-1 text-xs text-accent hover:underline">
              <Plus size={12} /> Add more
            </button>
          </div>
          {files.map((f, i) => (
            <div key={f.id}
              draggable
              onDragStart={() => setDragIdx(i)}
              onDragOver={e => { e.preventDefault(); setDragOverIdx(i); }}
              onDragEnd={() => {
                if (dragIdx !== null && dragOverIdx !== null && dragIdx !== dragOverIdx) {
                  moveFile(dragIdx, dragOverIdx);
                }
                setDragIdx(null); setDragOverIdx(null);
              }}
              className={cn("flex items-center gap-3 px-4 py-3 transition-all",
                dragIdx === i ? "opacity-40 scale-95" : "hover:bg-secondary/30",
                dragOverIdx === i && dragIdx !== i ? "border-t-2 border-primary" : "")}>
              <GripVertical size={15} className="text-muted-foreground/80 shrink-0 cursor-grab active:cursor-grabbing" />
              <span className="text-xs text-muted-foreground w-5 shrink-0">{i + 1}.</span>
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary">
                <FileText size={13} className="text-muted-foreground" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{f.name}</p>
                <p className="text-xs text-muted-foreground">{f.size}</p>
              </div>
              <div className="hidden sm:flex items-center gap-1.5">
                <label htmlFor={`pages-${f.id}`} className="text-[11px] text-muted-foreground">Pages</label>
                <input
                  id={`pages-${f.id}`}
                  type="text"
                  value={f.pages}
                  onChange={e => updatePages(f.id, e.target.value)}
                  placeholder="all"
                  title='Page range: "all", "1-3,5", "2-end"'
                  className="w-24 h-7 px-2 rounded-md border border-border bg-background text-[12px] text-foreground placeholder:text-muted-foreground/80 focus:outline-none focus:border-accent transition-colors"
                />
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => moveFile(i, i - 1)}
                  disabled={i === 0}
                  className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                  aria-label="Move file up"
                >
                  <ChevronUp size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => moveFile(i, i + 1)}
                  disabled={i === files.length - 1}
                  className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                  aria-label="Move file down"
                >
                  <ChevronDown size={14} />
                </button>
              </div>
              <button onClick={() => setFiles(p => p.filter(x => x.id !== f.id))} className="text-muted-foreground hover:text-foreground">
                <X size={14} />
              </button>
            </div>
          ))}
        </div>
      )}

      {files.length > 0 && (
        <div className="flex items-center gap-3 pt-1">
          <Button onClick={process} disabled={state === "processing" || files.length < 2} className="glow-primary">
            {state === "processing" ? <><Loader2 size={15} className="animate-spin" />Merging…</> : <>Merge {files.length} PDFs</>}
          </Button>
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setFiles([])}>Clear all</Button>
        </div>
      )}
    </div>
  );
}
