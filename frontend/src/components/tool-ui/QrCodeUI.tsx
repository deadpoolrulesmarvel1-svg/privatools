import { useState, useRef } from "react";
import { Upload, Loader2, CheckCircle2, AlertCircle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { downloadBlob } from "@/lib/api";

export function QrCodeUI() {
  const [data, setData] = useState("");
  const [size, setSize] = useState(300);
  const [format, setFormat] = useState<"png" | "pdf">("png");
  const [state, setState] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  const process = async () => {
    if (!data.trim()) return;
    setState("processing"); setError(null);
    try {
      const fd = new FormData();
      fd.append("data", data);
      fd.append("size", String(size));
      fd.append("format", format);
      const res = await fetch("/api/qr-code", { method: "POST", body: fd });
      if (!res.ok) { const b = await res.json().catch(() => ({ detail: "Failed" })); throw new Error(b.detail); }
      const blob = await res.blob();
      downloadBlob(blob, format === "pdf" ? "qr_code.pdf" : "qr_code.png");
      setState("done");
    } catch (e: any) { setError(e.message || "Failed"); setState("idle"); }
  };

  if (state === "done") return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
      <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
      <h2 className="text-lg font-bold text-foreground mb-1">QR Code generated!</h2>
      <p className="text-sm text-muted-foreground mb-6">Your QR code has been downloaded.</p>
      <Button variant="outline" className="border-border text-muted-foreground" onClick={() => { setState("idle"); setData(""); }}>Generate another</Button>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-5 space-y-4">
        <div>
          <label className="text-sm font-semibold text-foreground">Data / URL</label>
          <input value={data} onChange={e => setData(e.target.value)} placeholder="https://example.com or any text"
            className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2.5 text-sm text-foreground outline-none focus:border-accent/50" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground">Size (px)</label>
            <input type="number" value={size} onChange={e => setSize(parseInt(e.target.value) || 300)} min={100} max={2000}
              className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground">Format</label>
            <div className="flex gap-2 mt-1">
              {(["png", "pdf"] as const).map(f => (
                <button key={f} onClick={() => setFormat(f)}
                  className={cn("flex-1 rounded-lg border py-2 text-xs font-medium transition-all uppercase",
                    format === f ? "border-accent bg-accent/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary/40")}>
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
      {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}
      <Button onClick={process} disabled={state === "processing" || !data.trim()} className="glow-primary">
        {state === "processing" ? <><Loader2 size={15} className="animate-spin" />Generating…</> : "Generate QR Code"}
      </Button>
    </div>
  );
}
