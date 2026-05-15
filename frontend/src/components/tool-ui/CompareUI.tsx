import { useState, useRef } from "react";
import { Upload, Loader2, X, FileText, AlertCircle, Download, GitCompare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { downloadBlob, formatFileSize } from "@/lib/api";

const COMPARE_MODES = [
  { value: "visual", label: "Visual Diff", desc: "Side-by-side with highlights" },
  { value: "text", label: "Text Diff", desc: "Compare text content only" },
];

interface TextCompareResult {
  diff: string[];
  page_count_1: number;
  page_count_2: number;
}

export function CompareUI() {
  const [file1, setFile1] = useState<{ name: string; size: string; raw: File } | null>(null);
  const [file2, setFile2] = useState<{ name: string; size: string; raw: File } | null>(null);
  const [mode, setMode] = useState<"visual" | "text">("visual");
  const [highlightColor, setHighlightColor] = useState("#ff0000");
  const [state, setState] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [textResult, setTextResult] = useState<TextCompareResult | null>(null);
  const ref1 = useRef<HTMLInputElement>(null);
  const ref2 = useRef<HTMLInputElement>(null);

  const process = async () => {
    if (!file1 || !file2) return;
    setState("processing"); setError(null);
    try {
      const fd = new FormData();
      fd.append("file1", file1.raw);
      fd.append("file2", file2.raw);
      fd.append("mode", mode);
      fd.append("highlight_color", highlightColor);
      const res = await fetch("/api/compare", { method: "POST", body: fd });
      if (!res.ok) { const b = await res.json().catch(() => ({ detail: "Failed" })); throw new Error(b.detail); }
      if (mode === "visual") {
        const blob = await res.blob();
        setResultBlob(blob);
        setTextResult(null);
        downloadBlob(blob, "comparison.pdf");
      } else {
        const json = await res.json() as TextCompareResult;
        setTextResult(json);
        setResultBlob(null);
      }
      setState("done");
    } catch (e: any) { setError(e.message || "Failed"); setState("idle"); }
  };

  const FileBox = ({ label, file, setFile, inputRef, hint }: {
    label: string; file: typeof file1; setFile: (f: typeof file1) => void;
    inputRef: React.RefObject<HTMLInputElement>; hint: string;
  }) => (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className="text-[10px] text-muted-foreground/80">{hint}</p>
      </div>
      {!file ? (
        <div onClick={() => inputRef.current?.click()}
          className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border hover:border-accent/40 cursor-pointer py-8 transition-all bg-secondary/20 hover:bg-secondary/40">
          <input ref={inputRef as any} type="file" accept=".pdf" className="hidden" onChange={e => { if (e.target.files?.[0]) { const f = e.target.files[0]; setFile({ name: f.name, size: formatFileSize(f.size), raw: f }); } }} />
          <Upload size={18} className="text-muted-foreground" /><span className="text-sm text-muted-foreground">Select PDF</span>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary"><FileText size={13} className="text-muted-foreground" /></div>
          <div className="flex-1 min-w-0"><p className="text-sm font-medium text-foreground truncate">{file.name}</p><p className="text-xs text-muted-foreground">{file.size}</p></div>
          <button onClick={() => setFile(null)} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
        </div>
      )}
    </div>
  );

  if (state === "done") return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
      <GitCompare size={32} className="mx-auto mb-3 text-emerald-400" />
      <h2 className="text-lg font-bold text-foreground mb-1">Comparison Complete!</h2>
      <p className="text-sm text-muted-foreground mb-6">
        {mode === "visual" ? "Differences highlighted in your downloaded PDF" : "Text comparison finished"}
      </p>
      {mode === "text" && textResult && (
        <div className="mx-auto mb-6 max-w-2xl rounded-xl border border-border bg-card p-4 text-left">
          <p className="mb-2 text-xs text-muted-foreground">
            Pages: {textResult.page_count_1} vs {textResult.page_count_2} · Diff lines: {textResult.diff.length}
          </p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-md bg-secondary/30 p-3 text-xs text-foreground">
            {textResult.diff.slice(0, 120).join("\n") || "No textual differences found."}
          </pre>
        </div>
      )}
      <div className="flex justify-center gap-3 flex-wrap">
        {mode === "visual" && (
          <Button className="glow-primary" onClick={() => resultBlob && downloadBlob(resultBlob, "comparison.pdf")}><Download size={15} /> Download Again</Button>
        )}
        <Button variant="outline" onClick={() => { setFile1(null); setFile2(null); setState("idle"); setResultBlob(null); setTextResult(null); }}>Compare more</Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <FileBox label="Original PDF" hint="Before changes" file={file1} setFile={setFile1} inputRef={ref1} />
        <FileBox label="Modified PDF" hint="After changes" file={file2} setFile={setFile2} inputRef={ref2} />
      </div>

      {(file1 || file2) && (
        <div className="rounded-xl border border-border bg-card p-4 space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-semibold text-foreground">Comparison Mode</label>
            <div className="grid grid-cols-2 gap-2">
              {COMPARE_MODES.map(m => (
                <button key={m.value} onClick={() => setMode(m.value as "visual" | "text")}
                  className={cn("rounded-xl border px-3 py-2.5 text-center transition-all",
                    mode === m.value ? "border-accent bg-accent/10 ring-1 ring-accent/20" : "border-border hover:border-accent/30")}>
                  <div className={cn("text-xs font-bold", mode === m.value ? "text-primary" : "text-foreground")}>{m.label}</div>
                  <div className="text-[9px] text-muted-foreground">{m.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-muted-foreground">Highlight Color</label>
            <input type="color" value={highlightColor} onChange={e => setHighlightColor(e.target.value)}
              className="h-7 w-7 rounded border border-border cursor-pointer" disabled={mode !== "visual"} />
            <span className="text-[10px] text-muted-foreground">{highlightColor}</span>
          </div>
        </div>
      )}

      {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}
      <Button onClick={process} disabled={state === "processing" || !file1 || !file2} className="glow-primary">
        {state === "processing" ? <><Loader2 size={15} className="animate-spin" />Comparing…</> : "Compare PDFs"}
      </Button>
    </div>
  );
}
