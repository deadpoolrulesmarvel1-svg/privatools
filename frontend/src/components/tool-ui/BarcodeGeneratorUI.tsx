import { useState } from "react";
import { Download, Loader2, AlertCircle, Hash, QrCode } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const API_BASE = "/api";

const BARCODE_TYPES = [
  { value: "code128", label: "Code 128", desc: "General purpose" },
  { value: "code39", label: "Code 39", desc: "Alphanumeric" },
  { value: "ean13", label: "EAN-13", desc: "Retail products" },
  { value: "ean8", label: "EAN-8", desc: "Small products" },
  { value: "upca", label: "UPC-A", desc: "US/Canada retail" },
  { value: "isbn13", label: "ISBN-13", desc: "Books" },
  { value: "qr", label: "QR Code", desc: "Any text/URL" },
];

export function BarcodeGeneratorUI() {
  const [data, setData] = useState("");
  const [barcodeType, setBarcodeType] = useState("code128");
  const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const generate = async () => {
    if (!data.trim()) {
      setError("Please enter barcode data");
      return;
    }
    setStatus("processing");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("data", data.trim());
      fd.append("barcode_type", barcodeType);
      const res = await fetch(`${API_BASE}/generate-barcode`, { method: "POST", body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: "Generation failed" }));
        throw new Error(body.detail || `Request failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setStatus("done");
    } catch (e: any) {
      setError(e.message || "Generation failed");
      setStatus("idle");
    }
  };

  const download = () => {
    if (!previewUrl) return;
    const a = document.createElement("a");
    a.href = previewUrl;
    a.download = `barcode_${barcodeType}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const reset = () => {
    setData("");
    setBarcodeType("code128");
    setStatus("idle");
    setError(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  };

  if (status === "done" && previewUrl) {
    return (
      <div className="space-y-5">
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
          <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-500/10">
            <Hash size={24} className="text-emerald-400" />
          </div>
          <h2 className="text-lg font-bold text-foreground mb-2">Barcode Generated!</h2>
          <div className="mx-auto mb-6 max-w-sm rounded-xl border border-border bg-white p-4">
            <img src={previewUrl} alt="Generated barcode" className="mx-auto max-h-48 object-contain" />
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            {BARCODE_TYPES.find(t => t.value === barcodeType)?.label} · Data: {data}
          </p>
          <div className="flex justify-center gap-3 flex-wrap">
            <Button className="glow-primary" onClick={download}>
              <Download size={15} /> Download PNG
            </Button>
            <Button variant="outline" className="border-border text-muted-foreground" onClick={reset}>
              Generate another
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Data input */}
      <div className="space-y-2">
        <label className="text-sm font-semibold text-foreground">Barcode Data</label>
        <input
          type="text"
          value={data}
          onChange={e => setData(e.target.value)}
          placeholder={barcodeType === "qr" ? "Enter URL or text…" : "Enter barcode number/text…"}
          className="w-full rounded-xl border border-border bg-secondary/30 px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/80 focus:border-accent/50 focus:outline-none focus:ring-1 focus:ring-accent/20 transition-colors"
        />
        <p className="text-xs text-muted-foreground">
          {barcodeType === "ean13" ? "Must be exactly 12 digits (check digit auto-calculated)" :
           barcodeType === "ean8" ? "Must be exactly 7 digits" :
           barcodeType === "upca" ? "Must be exactly 11 digits" :
           barcodeType === "isbn13" ? "Must be exactly 12 digits" :
           barcodeType === "qr" ? "Any text, URL, or data up to 4296 characters" :
           "Alphanumeric text supported"}
        </p>
      </div>

      {/* Barcode type selector */}
      <div className="space-y-2">
        <label className="text-sm font-semibold text-foreground">Barcode Format</label>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {BARCODE_TYPES.map(type => (
            <button
              key={type.value}
              onClick={() => setBarcodeType(type.value)}
              className={cn(
                "flex flex-col items-start gap-0.5 rounded-xl border px-3 py-2.5 text-left transition-all",
                barcodeType === type.value
                  ? "border-accent bg-accent/5 ring-1 ring-accent/20"
                  : "border-border bg-card hover:border-accent/30 hover:bg-secondary/40"
              )}
            >
              <div className="flex items-center gap-1.5">
                {type.value === "qr" ? <QrCode size={12} className="text-primary" /> : <Hash size={12} className="text-muted-foreground" />}
                <span className={cn("text-xs font-semibold", barcodeType === type.value ? "text-primary" : "text-foreground")}>{type.label}</span>
              </div>
              <span className="text-[10px] text-muted-foreground">{type.desc}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle size={15} className="shrink-0" />
          {error}
        </div>
      )}

      {/* Generate button */}
      <Button
        className="w-full glow-primary"
        disabled={!data.trim() || status === "processing"}
        onClick={generate}
      >
        {status === "processing" ? (
          <><Loader2 size={15} className="animate-spin" /> Generating…</>
        ) : (
          <>Generate {BARCODE_TYPES.find(t => t.value === barcodeType)?.label || "Barcode"}</>
        )}
      </Button>

      <p className="text-[11px] text-center text-muted-foreground/80">
        Free · No sign-up · Generated on your self-hosted server
      </p>
    </div>
  );
}
