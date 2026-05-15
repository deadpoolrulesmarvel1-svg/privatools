import { useState, useRef } from "react";
import { Upload, Loader2, CheckCircle2, X, FileText, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { processAndDownload, formatFileSize } from "@/lib/api";

export function HeaderFooterUI() {
  const [file, setFile] = useState<{ name: string; size: string; raw: File } | null>(null);
  const [headerText, setHeaderText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [fontSize, setFontSize] = useState(10);
  const [state, setState] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const pick = (fl: FileList) => { const f = fl[0]; setFile({ name: f.name, size: formatFileSize(f.size), raw: f }); setState("idle"); setError(null); };

  const process = async () => {
    if (!file || (!headerText.trim() && !footerText.trim())) return;
    setState("processing"); setError(null);
    try {
      await processAndDownload("/header-footer", file.raw, "header_footer.pdf", { header_text: headerText, footer_text: footerText, font_size: fontSize });
      setState("done");
    } catch (e: any) { setError(e.message || "Failed"); setState("idle"); }
  };

  if (state === "done") return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
      <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
      <h2 className="text-lg font-bold text-foreground mb-1">Header/Footer added!</h2>
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
          <p className="text-sm font-semibold text-foreground">Select a PDF</p><p className="text-xs text-muted-foreground">Drag & drop or click to browse</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary"><FileText size={14} className="text-muted-foreground" /></div>
            <div className="flex-1 min-w-0"><p className="text-sm font-medium text-foreground truncate">{file.name}</p><p className="text-xs text-muted-foreground">{file.size}</p></div>
            <button onClick={() => setFile(null)} className="text-muted-foreground hover:text-foreground"><X size={15} /></button>
          </div>
          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div><label className="text-sm font-semibold text-foreground">Header text</label>
              <input value={headerText} onChange={e => setHeaderText(e.target.value)} placeholder="e.g. Company Report 2024"
                className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50" /></div>
            <div><label className="text-sm font-semibold text-foreground">Footer text</label>
              <input value={footerText} onChange={e => setFooterText(e.target.value)} placeholder="e.g. Confidential"
                className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50" /></div>
            <div><label className="text-xs font-medium text-muted-foreground">Font size</label>
              <input type="number" value={fontSize} onChange={e => setFontSize(parseInt(e.target.value) || 10)} min={6} max={48}
                className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50" /></div>
          </div>
          {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}
          <Button onClick={process} disabled={state === "processing" || (!headerText.trim() && !footerText.trim())} className="glow-primary">
            {state === "processing" ? <><Loader2 size={15} className="animate-spin" />Adding…</> : "Add Header/Footer"}
          </Button>
        </>
      )}
    </div>
  );
}
