import { useRef, useState } from "react";
import { Upload, Shuffle, Loader2, AlertCircle, FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { downloadBlob, formatFileSize, buildOutputFilename } from "@/lib/api";

type MixMode = "alternate" | "reverse-alternate";

const MODES: { value: MixMode; label: string; desc: string }[] = [
  { value: "alternate", label: "Alternate", desc: "1A,1B,2A,2B..." },
  { value: "reverse-alternate", label: "Reverse Alternate", desc: "1A,lastB,2A,prevB..." },
];

export function AlternateMixUI() {
  const [file1, setFile1] = useState<{ name: string; size: string; raw: File } | null>(null);
  const [file2, setFile2] = useState<{ name: string; size: string; raw: File } | null>(null);
  const [mode, setMode] = useState<MixMode>("alternate");
  const [state, setState] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const r1 = useRef<HTMLInputElement>(null);
  const r2 = useRef<HTMLInputElement>(null);

  const process = async () => {
    if (!file1 || !file2) return;
    setState("processing");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file1", file1.raw);
      fd.append("file2", file2.raw);
      fd.append("mode", mode);
      const res = await fetch("/api/alternate-mix", { method: "POST", body: fd });
      if (!res.ok) {
        const b = await res.json().catch(() => ({ detail: "Failed" }));
        throw new Error(b.detail || "Alternate mix failed");
      }
      const blob = await res.blob();
      downloadBlob(blob, buildOutputFilename(file1?.name, "alternate_mix", "pdf"));
      setState("done");
    } catch (e: any) {
      setError(e.message || "Alternate mix failed");
      setState("idle");
    }
  };

  const Box = ({
    label,
    file,
    setFile,
    inputRef,
  }: {
    label: string;
    file: typeof file1;
    setFile: (f: typeof file1) => void;
    inputRef: React.RefObject<HTMLInputElement>;
  }) => (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">{label}</p>
      {!file ? (
        <div
          onClick={() => inputRef.current?.click()}
          className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-secondary/20 py-8 transition-all hover:border-accent/40 hover:bg-secondary/40"
        >
          <input
            ref={inputRef as any}
            type="file"
            accept=".pdf"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) setFile({ name: f.name, size: formatFileSize(f.size), raw: f });
            }}
          />
          <Upload size={18} className="text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Select PDF</span>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary">
            <FileText size={13} className="text-muted-foreground" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{file.name}</p>
            <p className="text-xs text-muted-foreground">{file.size}</p>
          </div>
          <button onClick={() => setFile(null)} className="text-muted-foreground hover:text-foreground">
            <X size={14} />
          </button>
        </div>
      )}
    </div>
  );

  if (state === "done") {
    return (
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
        <Shuffle size={30} className="mx-auto mb-3 text-emerald-400" />
        <h2 className="mb-1 text-lg font-bold text-foreground">Alternate Mix Complete!</h2>
        <p className="mb-5 text-sm text-muted-foreground">Your mixed PDF has been downloaded.</p>
        <Button
          variant="outline"
          onClick={() => {
            setFile1(null);
            setFile2(null);
            setState("idle");
          }}
        >
          Mix another pair
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Box label="PDF A" file={file1} setFile={setFile1} inputRef={r1} />
        <Box label="PDF B" file={file2} setFile={setFile2} inputRef={r2} />
      </div>

      <div className="rounded-xl border border-border bg-card p-4">
        <label className="text-sm font-semibold text-foreground">Mix mode</label>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {MODES.map(m => (
            <button
              key={m.value}
              onClick={() => setMode(m.value)}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-left transition-all",
                mode === m.value ? "border-accent bg-accent/10" : "border-border hover:border-accent/30",
              )}
            >
              <div className={cn("text-xs font-bold", mode === m.value ? "text-primary" : "text-foreground")}>{m.label}</div>
              <div className="text-[10px] text-muted-foreground">{m.desc}</div>
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle size={15} className="shrink-0" />
          {error}
        </div>
      )}

      <Button onClick={process} disabled={!file1 || !file2 || state === "processing"} className="glow-primary">
        {state === "processing" ? <><Loader2 size={15} className="animate-spin" />Mixing…</> : "Mix PDFs"}
      </Button>
    </div>
  );
}
