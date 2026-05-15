import { useState } from "react";
import { Upload, Loader2, AlertCircle, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { processAndDownload } from "@/lib/api";

export function InvertColorsUI() {
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<"full" | "night">("full");
  const [dpi, setDpi] = useState(150);
  const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const process = async () => {
    if (!file) return;
    setStatus("processing"); setError(null);
    try {
      await processAndDownload("/invert-colors", file, "inverted.pdf", { dpi, mode });
      setStatus("done");
    } catch (e: any) { setError(e.message || "Failed"); setStatus("idle"); }
  };

  return (
    <div className="space-y-5">
      <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-secondary/30 px-6 py-12 cursor-pointer hover:border-accent/40 transition-all">
        <Upload size={22} className="text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">{file ? file.name : "Drop PDF here"}</p>
        <p className="text-xs text-muted-foreground">Invert all colors for dark mode reading</p>
        <input type="file" accept=".pdf" className="hidden" onChange={e => e.target.files?.[0] && setFile(e.target.files[0])} />
      </label>

      {/* Mode selector */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <label className="text-sm font-semibold text-foreground">Inversion Mode</label>
        <div className="flex gap-2">
          {([
            { id: "full" as const, label: "Full Invert", desc: "Flip all colors", icon: Moon },
            { id: "night" as const, label: "Night Mode", desc: "Warm dark tint", icon: Sun },
          ]).map(m => (
            <button key={m.id} onClick={() => setMode(m.id)}
              className={cn("flex-1 flex items-center gap-2 rounded-lg border py-3 px-3 text-left transition-all",
                mode === m.id ? "border-accent bg-accent/10" : "border-border hover:bg-secondary/40")}>
              <m.icon size={16} className={mode === m.id ? "text-primary" : "text-muted-foreground"} />
              <div>
                <p className={cn("text-sm font-medium", mode === m.id ? "text-primary" : "text-foreground")}>{m.label}</p>
                <p className="text-xs text-muted-foreground">{m.desc}</p>
              </div>
            </button>
          ))}
        </div>

        {/* DPI selector */}
        <div>
          <label className="text-sm font-semibold text-foreground">Quality (DPI)</label>
          <div className="flex gap-2 mt-1">
            {[72, 150, 200].map(d => (
              <button key={d} onClick={() => setDpi(d)}
                className={cn("flex-1 rounded-lg border py-2 text-xs font-medium transition-all",
                  dpi === d ? "border-accent bg-accent/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary/40")}>
                {d} DPI{d === 150 ? " (default)" : d === 200 ? " (high)" : " (fast)"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} />{error}</div>}
      {status === "done" ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
          <p className="text-sm font-semibold text-emerald-400 mb-3">Colors inverted!</p>
          <Button variant="outline" onClick={() => { setFile(null); setStatus("idle"); }}>Process another</Button>
        </div>
      ) : (
        <Button className="w-full" disabled={!file || status === "processing"} onClick={process}>
          {status === "processing" ? <><Loader2 size={14} className="animate-spin mr-2" />Inverting…</> : "Invert Colors"}
        </Button>
      )}
    </div>
  );
}
