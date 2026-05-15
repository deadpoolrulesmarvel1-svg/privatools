import { useState, useRef, useEffect, useCallback } from "react";
import { Upload, Download, Loader2, CheckCircle2, X, FileText, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize, processFilesAndDownload, MAX_FILE_SIZE_LABEL, buildOutputFilename } from "@/lib/api";

type Level = "light" | "recommended" | "extreme" | "custom";
type CompressFile = { id: string; name: string; size: string; bytes: number; raw: File };
let fileId = 0;

const levels: { id: Level; label: string; desc: string; saving: string; intensity: number }[] = [
  { id: "light", label: "Light", desc: "Minimal quality loss", saving: "~20% smaller", intensity: 25 },
  { id: "recommended", label: "Recommended", desc: "Balanced quality & size", saving: "~50% smaller", intensity: 55 },
  { id: "extreme", label: "Extreme", desc: "Maximum compression", saving: "~75% smaller", intensity: 85 },
  { id: "custom", label: "Custom", desc: "Set JPEG quality + max image dimension yourself", saving: "Tunable", intensity: 65 },
];

export function CompressUI() {
  const [files, setFiles] = useState<CompressFile[]>([]);
  const [level, setLevel] = useState<Level>("recommended");
  const [customQuality, setCustomQuality] = useState<number>(75);
  const [customMaxDim, setCustomMaxDim] = useState<number>(1800);
  const [state, setState] = useState<"idle" | "processing" | "done">("idle");
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [compressedSize, setCompressedSize] = useState<number>(0);
  const ref = useRef<HTMLInputElement>(null);

  const addFiles = (fl: FileList) => {
    const newFiles: CompressFile[] = Array.from(fl)
      .filter(f => f.name.toLowerCase().endsWith(".pdf"))
      .map(f => ({ id: String(++fileId), name: f.name, size: formatFileSize(f.size), bytes: f.size, raw: f }));
    if (newFiles.length) {
      setFiles(prev => [...prev, ...newFiles]);
      setState("idle");
      setError(null);
    }
  };

  const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));
  const totalBytes = files.reduce((s, f) => s + f.bytes, 0);
  const canProcess = files.length > 0 && state !== "processing";

  const process = useCallback(async () => {
    if (!files.length) return;
    setState("processing");
    setError(null);
    try {
      const params: Record<string, string | number> = { level };
      if (level === "custom") {
        params.jpeg_quality = customQuality;
        params.max_image_dim = customMaxDim;
      }
      if (files.length === 1) {
        const res = await uploadFile("/compress", files[0].raw, params);
        const blob = await res.blob();
        const cSize = parseInt(res.headers.get("X-Compressed-Size") || "0") || blob.size;
        setCompressedSize(cSize);
        setResultBlob(blob);
        setState("done");
        const base = files[0].name.replace(/\.pdf$/i, "");
        downloadBlob(blob, `${base}_compressed.pdf`);
      } else {
        await processFilesAndDownload("/compress", files.map(f => f.raw), buildOutputFilename(files[0]?.name, "compressed", "zip"), params);
        setCompressedSize(0);
        setResultBlob(null);
        setState("done");
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Compression failed";
      setError(msg);
      setState("idle");
    }
  }, [files, level, customQuality, customMaxDim]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canProcess, process]);

  if (state === "done") {
    const savings = files.length === 1 && compressedSize > 0 ? Math.round((1 - compressedSize / totalBytes) * 100) : 0;
    const originalBarWidth = 100;
    const compressedBarWidth = compressedSize > 0 ? Math.max(5, Math.round((compressedSize / totalBytes) * 100)) : 0;

    return (
      <div className="animate-confetti rounded-2xl border border-accent/20 bg-accent/5 p-10 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,hsl(var(--accent)/0.10),transparent_70%)]" />
        <div className="relative">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-accent/10 ring-4 ring-accent/5">
            <CheckCircle2 size={32} className="text-accent" strokeWidth={1.5} />
          </div>
          <h2 className="font-heading text-xl font-bold text-foreground mb-2">Compressed & Downloaded!</h2>

          {files.length === 1 && compressedSize > 0 ? (
            <div className="max-w-xs mx-auto mb-8 space-y-4">
              {/* Visual bar chart comparison */}
              <div className="space-y-3 text-left">
                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-muted-foreground">Original</span>
                    <span className="text-muted-foreground font-medium">{files[0].size}</span>
                  </div>
                  <div className="h-3 rounded-full bg-muted-foreground/15 overflow-hidden">
                    <div className="h-full rounded-full bg-muted-foreground/85" style={{ width: `${originalBarWidth}%` }} />
                  </div>
                </div>
                <div>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="text-accent font-medium">Compressed</span>
                    <span className="text-accent font-bold">{formatFileSize(compressedSize)}</span>
                  </div>
                  <div className="h-3 rounded-full bg-muted-foreground/15 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-accent shadow-[0_0_10px_hsl(var(--accent)/0.35)] transition-all duration-1000"
                      style={{ width: `${compressedBarWidth}%` }}
                    />
                  </div>
                </div>
              </div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-accent/10 text-accent text-sm font-bold">
                -{savings}% smaller
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground mb-8">{files.length} PDFs compressed and downloaded as ZIP.</p>
          )}

          <div className="flex justify-center gap-3 flex-wrap">
            {resultBlob && (
              <Button className="glow-primary" onClick={() => { const base = files[0].name.replace(/\.pdf$/i, ""); downloadBlob(resultBlob, `${base}_compressed.pdf`); }}>
                <Download size={15} />Download again
              </Button>
            )}
            <Button variant="outline" className="border-border text-muted-foreground hover:text-foreground" onClick={() => { setFiles([]); setState("idle"); setResultBlob(null); }}>
              Compress more
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Upload zone */}
      <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
        onClick={() => ref.current?.click()}
        onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
        role="button" tabIndex={0} aria-label="Upload files"
        className={cn(
          "relative flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-16 px-8 text-center overflow-hidden",
          drag
            ? "border-accent bg-accent/5 shadow-[0_0_30px_-5px_hsl(var(--accent)/0.18)]"
            : "border-border hover:border-accent/40 hover:bg-secondary/30 bg-secondary/10"
        )}>
        {/* Subtle grid background */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none"
          style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='40' height='40' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0h40v40' fill='none' stroke='white' stroke-width='0.5'/%3E%3C/svg%3E\")", backgroundSize: "40px 40px" }}
        />
        <input ref={ref} type="file" accept=".pdf" multiple className="hidden" onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
        <div className={cn(
          "flex h-14 w-14 items-center justify-center rounded-2xl transition-all",
          drag ? "bg-accent/20 scale-110" : "bg-secondary/80"
        )}>
          <Upload size={24} className={cn("transition-colors", drag ? "text-accent" : "text-muted-foreground")} strokeWidth={1.5} />
        </div>
        <div className="relative">
          <p className="font-heading text-base font-semibold text-foreground">
            {files.length ? "Add more PDFs" : "Select PDFs to compress"}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Drag & drop or click · Multiple files supported · Max {MAX_FILE_SIZE_LABEL} each
          </p>
        </div>
      </div>

      {files.length > 0 && (
        <>
          {/* File list */}
          <div className="space-y-2">
            {files.map(f => (
              <div key={f.id} className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm px-4 py-3.5 shadow-sm">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/10">
                  <FileText size={16} className="text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{f.name}</p>
                  <p className="text-xs text-muted-foreground">{f.size}</p>
                </div>
                <button
                  onClick={() => removeFile(f.id)}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/80 hover:text-foreground hover:bg-destructive/10 transition-all"
                >
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>

          {/* Compression level selector */}
          <div className="rounded-xl border border-border/60 bg-card/50 backdrop-blur-sm p-5 space-y-4 shadow-sm">
            <p className="font-heading text-sm font-semibold text-foreground">Compression level</p>

            {/* Gradient progress bar showing intensity */}
            <div className="h-2 rounded-full bg-secondary/60 overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500 ease-out"
                style={{
                  width: `${levels.find(l => l.id === level)?.intensity || 50}%`,
                  background: "linear-gradient(90deg, hsl(var(--accent)/0.45), hsl(var(--accent)))",
                }}
              />
            </div>

            <div className="grid gap-2">
              {levels.map(l => (
                <button key={l.id} onClick={() => setLevel(l.id)}
                  className={cn(
                    "w-full flex items-center gap-4 rounded-xl border p-4 text-left transition-all",
                    level === l.id
                      ? "border-accent/40 bg-accent/5 shadow-[0_0_15px_-3px_hsl(var(--accent)/0.18)]"
                      : "border-border/40 hover:border-border/70 hover:bg-secondary/30"
                  )}>
                  {/* Visual intensity bar */}
                  <div className="flex flex-col items-center gap-1 shrink-0">
                    <div className="w-1.5 h-8 rounded-full bg-secondary/60 overflow-hidden flex flex-col justify-end">
                      <div
                        className={cn("w-full rounded-full transition-all duration-300", level === l.id ? "bg-accent" : "bg-muted-foreground/85")}
                        style={{ height: `${l.intensity}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className={cn("text-sm font-medium", level === l.id ? "text-foreground" : "text-foreground/80")}>{l.label}</p>
                      <span className={cn("text-xs font-semibold", level === l.id ? "text-accent" : "text-muted-foreground")}>{l.saving}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{l.desc}</p>
                  </div>
                </button>
              ))}
            </div>

            {/* Custom-level sliders */}
            {level === "custom" && (
              <div className="rounded-xl border border-border/60 bg-secondary/30 p-4 space-y-4">
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label htmlFor="jpeg-q" className="text-[13px] font-medium text-foreground">JPEG quality</label>
                    <span className="text-xs font-mono text-accent">{customQuality}</span>
                  </div>
                  <input
                    id="jpeg-q"
                    type="range" min={15} max={95} step={1}
                    value={customQuality}
                    onChange={e => setCustomQuality(parseInt(e.target.value, 10))}
                    className="w-full accent-foreground"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span>15 — tiny, lossy</span>
                    <span>95 — pristine</span>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label htmlFor="max-dim" className="text-[13px] font-medium text-foreground">Max image dimension (px)</label>
                    <span className="text-xs font-mono text-accent">{customMaxDim}</span>
                  </div>
                  <input
                    id="max-dim"
                    type="range" min={300} max={4000} step={100}
                    value={customMaxDim}
                    onChange={e => setCustomMaxDim(parseInt(e.target.value, 10))}
                    className="w-full accent-foreground"
                  />
                  <div className="flex justify-between text-[10px] text-muted-foreground mt-1">
                    <span>300 — heavily downsampled</span>
                    <span>4000 — preserve detail</span>
                  </div>
                </div>

                <p className="text-[11px] text-muted-foreground/80">
                  Tip: typical photos look fine at quality 75 + dim 1800.
                  Drop below 50 only for low-importance scans.
                </p>
              </div>
            )}
          </div>

          {/* Error state */}
          {error && (
            <div className="flex items-center gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-5 py-4 text-sm text-destructive backdrop-blur-sm">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10">
                <AlertCircle size={16} className="shrink-0" />
              </div>
              <div>
                <p className="font-medium">Compression failed</p>
                <p className="text-xs opacity-80 mt-0.5">{error}</p>
              </div>
            </div>
          )}

          {/* Action buttons */}
          <div className="flex items-center gap-3">
            <Button onClick={process} disabled={!canProcess} className="glow-primary">
              {state === "processing" ? <><Loader2 size={15} className="animate-spin" />Compressing…</> : `Compress ${files.length > 1 ? `${files.length} PDFs` : "PDF"}`}
            </Button>
            {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>}
          </div>
        </>
      )}
    </div>
  );
}
