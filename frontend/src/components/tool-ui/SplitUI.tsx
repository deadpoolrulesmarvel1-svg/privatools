import { useState, useRef } from "react";
import { Upload, Download, Loader2, CheckCircle2, X, FileText, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";

type Mode = "pages" | "individual" | "every_n";

const modes: { id: Mode; label: string; desc: string }[] = [
  { id: "pages", label: "By page ranges", desc: "e.g. 1-3, 5, 7-end, -4, 9-" },
  { id: "individual", label: "Every page", desc: "Each page becomes a separate file" },
  { id: "every_n", label: "Every N pages", desc: "Split into chunks of N pages" },
];

export function SplitUI() {
  const [file, setFile] = useState<{ name: string; size: string; raw: File } | null>(null);
  const [mode, setMode] = useState<Mode>("pages");
  const [pages, setPages] = useState("1-3");
  const [n, setN] = useState(2);
  const [state, setState] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const pick = (fl: FileList) => { const f = fl[0]; setFile({ name: f.name, size: formatFileSize(f.size), raw: f }); setState("idle"); setError(null); };

  const process = async () => {
    if (!file) return;
    setState("processing");
    setError(null);
    try {
      const params: Record<string, string | number> = { mode };
      if (mode === "pages") params.pages = pages;
      if (mode === "every_n") params.n = n;
      const res = await uploadFile("/split", file.raw, params);
      const blob = await res.blob();
      const fname = blob.type.includes("zip") ? "split_pages.zip" : "split.pdf";
      downloadBlob(blob, fname);
      setState("done");
    } catch (e: any) {
      setError(e.message || "Split failed");
      setState("idle");
    }
  };

  if (state === "done") return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
      <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
      <h2 className="text-lg font-bold text-foreground mb-1">Split complete!</h2>
      <p className="text-sm text-muted-foreground mb-6">Your split file has been downloaded.</p>
      <Button variant="outline" className="border-border text-muted-foreground" onClick={() => { setFile(null); setState("idle"); }}>Split another file</Button>
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
          <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", drag ? "bg-accent/20" : "bg-secondary")}>
            <Upload size={22} className={drag ? "text-primary" : "text-muted-foreground"} strokeWidth={1.5} />
          </div>
          <p className="text-sm font-semibold text-foreground">Select a PDF to split</p>
          <p className="text-xs text-muted-foreground">Drag & drop or click to browse</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary"><FileText size={14} className="text-muted-foreground" /></div>
            <div className="flex-1 min-w-0"><p className="text-sm font-medium text-foreground truncate">{file.name}</p><p className="text-xs text-muted-foreground">{file.size}</p></div>
            <button onClick={() => setFile(null)} className="text-muted-foreground hover:text-foreground"><X size={15} /></button>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 space-y-3">
            <p className="text-sm font-semibold text-foreground">Split mode</p>
            <div className="space-y-2">
              {modes.map(m => (
                <button key={m.id} onClick={() => setMode(m.id)}
                  className={cn("w-full flex items-center gap-3 rounded-xl border p-3.5 text-left transition-all",
                    mode === m.id ? "border-accent bg-accent/5" : "border-border hover:border-border/70 hover:bg-secondary/40")}>
                  <div className={cn("h-4 w-4 rounded-full border-2 flex items-center justify-center", mode === m.id ? "border-primary" : "border-border")}>
                    {mode === m.id && <div className="h-2 w-2 rounded-full bg-primary" />}
                  </div>
                  <div><p className="text-sm font-medium text-foreground">{m.label}</p><p className="text-xs text-muted-foreground">{m.desc}</p></div>
                </button>
              ))}
            </div>
            {mode === "pages" && (
              <div className="pt-2">
                <label className="text-xs font-medium text-muted-foreground">Page ranges</label>
                <input value={pages} onChange={e => setPages(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50"
                  placeholder="e.g. 1-3, 5, 7-end, -4, 9-" />
              </div>
            )}
            {mode === "every_n" && (
              <div className="pt-2">
                <label className="text-xs font-medium text-muted-foreground">Pages per chunk</label>
                <input type="number" value={n} onChange={e => setN(Math.max(1, parseInt(e.target.value) || 1))} min={1}
                  className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50" />
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <AlertCircle size={15} className="shrink-0" />{error}
            </div>
          )}

          <Button onClick={process} disabled={state === "processing"} className="glow-primary">
            {state === "processing" ? <><Loader2 size={15} className="animate-spin" />Splitting…</> : "Split PDF"}
          </Button>
        </>
      )}
    </div>
  );
}
