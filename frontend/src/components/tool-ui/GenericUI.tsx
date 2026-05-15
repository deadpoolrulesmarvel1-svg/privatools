import { useState, useRef, useEffect, useCallback } from "react";
import { Upload, Download, Loader2, CheckCircle2, X, FileText, AlertCircle, Clock, ArrowRight, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize, MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { getToolEndpoint } from "@/lib/tool-endpoints";
import { getFileSizeWarning, estimateTime } from "@/hooks/useUxHelpers";
import { ProcessingBar } from "./FileUploadZone";

interface GenericUIProps {
  toolName: string;
  outputLabel: string;
  accepts: string;
  actionLabel?: string;
  slug: string;
  apiEndpoint?: string;
  params?: Record<string, string | number | boolean>;
}

export function GenericUI({ toolName, outputLabel, accepts, actionLabel, slug, apiEndpoint, params }: GenericUIProps) {
  const [files, setFiles] = useState<{ id: string; name: string; size: string; file: File }[]>([]);
  const [state, setState] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [resultBlob, setResultBlob] = useState<Blob | null>(null);
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const add = (fl: FileList) => {
    const selected = fl[0];
    if (!selected) return;
    setFiles([{ id: Math.random().toString(36).slice(2), name: selected.name, size: formatFileSize(selected.size), file: selected }]);
    setState("idle");
    setError(null);
  };

  const sizeWarning = files.length > 0 ? getFileSizeWarning(files[0].file.size) : null;
  const timeEstimate = files.length > 0 ? estimateTime(files[0].file.size) : null;
  const canProcess = files.length > 0 && state !== "processing";

  const processRef = useRef<() => void>();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
        e.preventDefault();
        processRef.current?.();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [canProcess]);

  const getOutputFilename = () => {
    if (!files.length) return outputLabel;
    const original = files[0].name;
    const lastDot = original.lastIndexOf(".");
    const baseName = lastDot > 0 ? original.substring(0, lastDot) : original;
    const outDot = outputLabel.lastIndexOf(".");
    const ext = outDot > 0 ? outputLabel.substring(outDot) : ".pdf";
    const suffix = outDot > 0 ? "_" + outputLabel.substring(0, outDot) : "";
    return `${baseName}${suffix}${ext}`;
  };

  const process = useCallback(async () => {
    if (!files.length) return;
    setState("processing");
    setError(null);
    try {
      const endpoint = apiEndpoint || getToolEndpoint(slug);
      const res = await uploadFile(endpoint, files[0].file, params);
      const blob = await res.blob();
      setResultBlob(blob);
      setState("done");
      downloadBlob(blob, getOutputFilename());
    } catch (e: any) {
      setError(e.message || "Processing failed");
      setState("idle");
    }
  }, [files, apiEndpoint, slug, params]);

  processRef.current = process;

  const handleDownload = () => {
    if (resultBlob) downloadBlob(resultBlob, getOutputFilename());
  };

  const stepIndex = state === "idle" ? (files.length > 0 ? 1 : 0) : state === "processing" ? 1 : 2;

  // ── Step Timeline ──────────────────────────────────────────────────
  const StepTimeline = ({ completed }: { completed?: boolean }) => {
    const steps = [
      { label: "Upload", num: 1 },
      { label: "Process", num: 2 },
      { label: "Download", num: 3 },
    ];
    return (
      <div className="flex items-center justify-center gap-0 mb-6">
        {steps.map((step, i) => {
          const isDone = completed || i < stepIndex;
          const isCurrent = !completed && i === stepIndex;
          const isProcessing = isCurrent && state === "processing";
          return (
            <div key={step.label} className="flex items-center">
              <div className="flex flex-col items-center gap-1.5">
                <div className={cn(
                  "h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-bold transition-all duration-500",
                  isDone
                    ? "bg-accent text-accent-foreground shadow-md shadow-accent/20"
                    : isCurrent
                      ? "bg-accent/15 text-accent ring-2 ring-accent/30"
                      : "bg-secondary/60 text-muted-foreground/80"
                )}>
                  {isDone ? (
                    <CheckCircle2 size={14} strokeWidth={2.5} />
                  ) : isProcessing ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    step.num
                  )}
                </div>
                <span className={cn(
                  "text-[10px] font-semibold tracking-wide transition-colors",
                  isDone ? "text-accent/70" : isCurrent ? "text-accent" : "text-muted-foreground/35"
                )}>
                  {step.label}
                </span>
              </div>
              {i < 2 && (
                <div className="w-10 sm:w-16 h-[2px] mx-1.5 sm:mx-2.5 mb-5 rounded-full bg-secondary/60 overflow-hidden">
                  <div className={cn(
                    "h-full rounded-full transition-all duration-700 ease-out",
                    (completed || i < stepIndex) ? "w-full bg-accent/50" : "w-0"
                  )} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  // ── Success state ──────────────────────────────────────────────────
  // ── Success state — tightened (was a 10-rem-tall celebration card) ──
  if (state === "done") return (
    <div className="rounded-2xl border border-accent/25 bg-accent/[0.04] overflow-hidden">
      <div className="relative p-6 sm:p-8 text-center">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-10%,hsl(var(--accent)/0.10),transparent_60%)] pointer-events-none" />
        <div className="relative flex flex-col items-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 ring-4 ring-accent/6">
            <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
          </div>
          <h2 className="text-base font-bold text-foreground mb-1">Done</h2>
          <p className="text-[13px] text-muted-foreground mb-5">
            <span className="text-foreground/80 font-medium">{getOutputFilename()}</span> downloaded
          </p>
          <div className="flex justify-center gap-2 flex-wrap">
            <Button size="sm" className="glow-primary rounded-full h-9 px-4 bg-foreground text-background hover:bg-foreground/90" onClick={handleDownload}>
              <Download size={13} className="mr-1.5" />Download again
            </Button>
            <Button variant="outline" size="sm" className="rounded-full h-9 px-4 border-border text-muted-foreground hover:text-foreground" onClick={() => { setFiles([]); setState("idle"); setResultBlob(null); }}>
              <RotateCcw size={12} className="mr-1.5" />Process another
            </Button>
          </div>
        </div>
      </div>
    </div>
  );

  // ── Main UI ────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      {/* Upload zone */}
      <div
        onDragOver={e => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) add(e.dataTransfer.files); }}
        onClick={() => ref.current?.click()}
        onKeyDown={e => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            ref.current?.click();
          }
        }}
        role="button"
        tabIndex={0}
        aria-label={`Upload file for ${toolName}`}
        className={cn(
          "upload-zone-enhanced group relative flex flex-col items-center justify-center gap-4 rounded-2xl cursor-pointer transition-all duration-300 py-14 sm:py-16 px-8 text-center overflow-hidden",
          drag
            ? "border-2 border-accent bg-accent/5 shadow-[0_0_50px_-10px_hsl(var(--accent)/0.25)] scale-[1.008]"
            : "border-2 border-border/50 hover:border-accent/25 bg-card/20 hover:bg-card/40"
        )}
      >
        {/* Grid pattern */}
        <div className="absolute inset-0 opacity-[0.025] pointer-events-none"
          style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='40' height='40' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M0 0h40v40' fill='none' stroke='white' stroke-width='0.5'/%3E%3C/svg%3E\")", backgroundSize: "40px 40px" }}
        />

        {/* Corner brackets that appear on hover/drag */}
        <div className={cn(
          "absolute top-3 left-3 transition-all duration-300",
          drag ? "opacity-100 scale-100" : "opacity-0 group-hover:opacity-60 scale-95 group-hover:scale-100"
        )}>
          <div className="w-5 h-[2px] bg-accent/60 rounded-full" />
          <div className="w-[2px] h-5 bg-accent/60 rounded-full" />
        </div>
        <div className={cn(
          "absolute top-3 right-3 transition-all duration-300",
          drag ? "opacity-100 scale-100" : "opacity-0 group-hover:opacity-60 scale-95 group-hover:scale-100"
        )}>
          <div className="w-5 h-[2px] bg-accent/60 rounded-full ml-auto" />
          <div className="w-[2px] h-5 bg-accent/60 rounded-full ml-auto" />
        </div>
        <div className={cn(
          "absolute bottom-3 left-3 transition-all duration-300",
          drag ? "opacity-100 scale-100" : "opacity-0 group-hover:opacity-60 scale-95 group-hover:scale-100"
        )}>
          <div className="w-[2px] h-5 bg-accent/60 rounded-full" />
          <div className="w-5 h-[2px] bg-accent/60 rounded-full" />
        </div>
        <div className={cn(
          "absolute bottom-3 right-3 transition-all duration-300",
          drag ? "opacity-100 scale-100" : "opacity-0 group-hover:opacity-60 scale-95 group-hover:scale-100"
        )}>
          <div className="w-[2px] h-5 bg-accent/60 rounded-full ml-auto" />
          <div className="w-5 h-[2px] bg-accent/60 rounded-full ml-auto" />
        </div>

        <input ref={ref} type="file" accept={accepts} className="hidden" onChange={e => e.target.files && add(e.target.files)} />

        <div className={cn(
          "flex h-14 w-14 items-center justify-center rounded-2xl transition-all duration-300",
          drag
            ? "bg-accent/20 scale-110 shadow-lg shadow-accent/15"
            : "bg-secondary/50 group-hover:bg-accent/10 group-hover:scale-105"
        )}>
          <Upload size={22} className={cn(
            "transition-all duration-300",
            drag ? "text-accent -translate-y-0.5" : "text-muted-foreground group-hover:text-accent"
          )} strokeWidth={1.75} />
        </div>

        <div className="relative">
          <p className="font-heading text-base font-semibold text-foreground">
            {drag ? "Drop your file here" : "Click to select or drag & drop"}
          </p>
          <p className="text-xs text-muted-foreground mt-1.5">
            Accepts <span className="font-medium text-foreground/60">{accepts.split(",").join(", ")}</span> · Max {MAX_FILE_SIZE_LABEL}
          </p>
        </div>

        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground/35">
          <div className="h-1 w-1 rounded-full bg-accent/30" />
          Free · No sign-up · Processed locally on your server
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-destructive/20 bg-destructive/5 px-5 py-4 text-sm text-destructive backdrop-blur-sm animate-fade-in">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-destructive/10 mt-0.5">
            <AlertCircle size={16} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-medium">Something went wrong</p>
            <p className="text-xs opacity-80 mt-0.5 break-words">{error}</p>
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={process}
                disabled={!canProcess}
                className="text-xs font-semibold text-destructive hover:underline disabled:opacity-50"
              >
                Try again
              </button>
              <button
                type="button"
                onClick={() => navigator.clipboard.writeText(error || "").catch(() => {})}
                className="text-xs text-destructive/80 hover:underline"
              >
                Copy error
              </button>
            </div>
          </div>
        </div>
      )}

      {/* After file selected */}
      {files.length > 0 && (
        <div className="space-y-4">
          <StepTimeline />

          {/* Size warning */}
          {sizeWarning && (
            <div className="flex items-center gap-2 rounded-xl border border-yellow-500/20 bg-yellow-500/5 px-4 py-2.5 text-[12px] text-yellow-400">
              <AlertCircle size={13} className="shrink-0" />
              {sizeWarning}
            </div>
          )}

          {/* File card */}
          {files.map(f => (
            <div key={f.id} className={cn(
              "flex items-center gap-3.5 rounded-xl border px-4 py-3.5 transition-all duration-300",
              state === "processing"
                ? "border-accent/20 bg-accent/[0.03] shadow-sm shadow-accent/5"
                : "border-border/50 bg-card/40 shadow-sm"
            )}>
              <div className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all",
                state === "processing" ? "bg-accent/12" : "bg-accent/8"
              )}>
                <FileText size={18} className="text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">{f.name}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{f.size}</p>
              </div>
              {state !== "processing" && (
                <button
                  onClick={(e) => { e.stopPropagation(); setFiles(p => p.filter(x => x.id !== f.id)); }}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground/85 hover:text-foreground hover:bg-destructive/10 transition-all"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          ))}

          {/* Processing progress */}
          {state === "processing" && (
            <div className="rounded-xl border border-accent/15 bg-accent/[0.03] px-5 py-4">
              <ProcessingBar label={`Processing ${files[0].name}`} />
            </div>
          )}

          {/* Action */}
          {state !== "processing" ? (
            <div className="flex items-center gap-3 pt-1">
              <Button onClick={process} disabled={!canProcess} className="glow-primary rounded-xl h-10 px-6 font-semibold">
                <ArrowRight size={15} className="mr-1.5" />{actionLabel || toolName}
              </Button>
              <Button variant="ghost" size="sm" className="rounded-xl text-muted-foreground hover:text-foreground" onClick={() => setFiles([])}>
                Clear
              </Button>
              <span className="flex items-center gap-2.5 text-[11px] text-muted-foreground/35 ml-auto">
                {timeEstimate && <span className="flex items-center gap-1"><Clock size={10} /> {timeEstimate}</span>}
                <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono bg-secondary/20 border border-border/25 rounded-md px-1.5 py-0.5 text-[10px]">⌘↵</kbd>
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-3 pt-1">
              <Button disabled className="rounded-xl h-10 px-6">
                <Loader2 size={15} className="animate-spin mr-1.5" />Processing…
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
