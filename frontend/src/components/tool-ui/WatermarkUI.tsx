import { useState, useRef } from "react";
import { Upload, Loader2, CheckCircle2, X, FileText, AlertCircle, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { downloadBlob, formatFileSize, buildOutputFilename } from "@/lib/api";

const positions = [
  { id: "center", label: "Center" },
  { id: "top", label: "Top" },
  { id: "bottom", label: "Bottom" },
  { id: "top-left", label: "Top Left" },
  { id: "top-right", label: "Top Right" },
  { id: "bottom-left", label: "Bottom Left" },
  { id: "bottom-right", label: "Bottom Right" },
  { id: "diagonal", label: "Diagonal" },
  { id: "tile", label: "Tile" },
] as const;

type WatermarkMode = "text" | "image";

export function WatermarkUI() {
  const [file, setFile] = useState<{ name: string; size: string; raw: File } | null>(null);
  const [mode, setMode] = useState<WatermarkMode>("text");
  const [text, setText] = useState("CONFIDENTIAL");
  const [watermarkImage, setWatermarkImage] = useState<{ name: string; size: string; raw: File } | null>(null);
  const [opacity, setOpacity] = useState(0.3);
  const [fontSize, setFontSize] = useState(40);
  const [imageScale, setImageScale] = useState(0.25);
  const [position, setPosition] = useState<(typeof positions)[number]["id"]>("center");
  const [state, setState] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const watermarkRef = useRef<HTMLInputElement>(null);

  const pick = (fl: FileList) => {
    const f = fl[0];
    setFile({ name: f.name, size: formatFileSize(f.size), raw: f });
    setState("idle");
    setError(null);
  };

  const pickWatermarkImage = (fl: FileList) => {
    const f = fl[0];
    setWatermarkImage({ name: f.name, size: formatFileSize(f.size), raw: f });
    setError(null);
  };

  const process = async () => {
    if (!file) return;
    if (mode === "text" && !text.trim()) return;
    if (mode === "image" && !watermarkImage) return;

    setState("processing");
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file.raw);
      fd.append("opacity", String(opacity));
      fd.append("position", position);

      if (mode === "text") {
        fd.append("text", text.trim());
        fd.append("font_size", String(fontSize));
      } else if (watermarkImage) {
        fd.append("watermark_image", watermarkImage.raw);
        fd.append("image_scale", String(imageScale));
      }

      const res = await fetch("/api/watermark", { method: "POST", body: fd });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ detail: "Failed to add watermark" }));
        throw new Error(body.detail || `Request failed (${res.status})`);
      }
      const blob = await res.blob();
      downloadBlob(blob, buildOutputFilename(file?.name, "watermarked", "pdf"));
      setState("done");
    } catch (e: any) {
      setError(e.message || "Failed");
      setState("idle");
    }
  };

  if (state === "done") {
    return (
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
        <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
        <h2 className="text-lg font-bold text-foreground mb-1">Watermark added!</h2>
        <p className="text-sm text-muted-foreground mb-6">Your watermarked PDF has been downloaded.</p>
        <Button
          variant="outline"
          className="border-border text-muted-foreground"
          onClick={() => {
            setFile(null);
            setWatermarkImage(null);
            setState("idle");
          }}
        >
          Watermark another
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!file ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (e.dataTransfer.files.length) pick(e.dataTransfer.files);
          }}
          onClick={() => ref.current?.click()}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
          role="button"
          tabIndex={0}
          aria-label="Upload file"
          className={cn(
            "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-14 px-6 text-center",
            drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 hover:bg-secondary/40 bg-secondary/20",
          )}
        >
          <input ref={ref} type="file" accept=".pdf" className="hidden" onChange={(e) => e.target.files && pick(e.target.files)} />
          <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", drag ? "bg-accent/20" : "bg-secondary")}>
            <Upload size={22} className={drag ? "text-accent" : "text-muted-foreground"} strokeWidth={1.5} />
          </div>
          <p className="text-sm font-semibold text-foreground">Select a PDF to watermark</p>
          <p className="text-xs text-muted-foreground">Drag & drop or click to browse</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary">
              <FileText size={14} className="text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
              <p className="text-xs text-muted-foreground">{file.size}</p>
            </div>
            <button onClick={() => setFile(null)} className="text-muted-foreground hover:text-foreground">
              <X size={15} />
            </button>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <div>
              <label className="text-sm font-semibold text-foreground">Watermark type</label>
              <div className="flex gap-2 mt-1">
                {(["text", "image"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={cn(
                      "flex-1 rounded-lg border py-2 text-xs font-medium transition-all",
                      mode === m ? "border-accent bg-accent/10 text-accent" : "border-border text-muted-foreground hover:bg-secondary/40",
                    )}
                  >
                    {m === "text" ? "Text watermark" : "Image watermark"}
                  </button>
                ))}
              </div>
            </div>

            {mode === "text" ? (
              <>
                <div>
                  <label className="text-sm font-semibold text-foreground">Watermark text</label>
                  <input
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    placeholder="e.g. CONFIDENTIAL"
                    className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-muted-foreground">Font size</label>
                  <input
                    type="number"
                    value={fontSize}
                    onChange={(e) => setFontSize(Math.max(8, parseInt(e.target.value, 10) || 8))}
                    min={8}
                    max={200}
                    className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50"
                  />
                </div>
              </>
            ) : (
              <div>
                <label className="text-sm font-semibold text-foreground">Watermark image</label>
                <input
                  ref={watermarkRef}
                  type="file"
                  accept=".png,.jpg,.jpeg,.webp"
                  className="hidden"
                  onChange={(e) => e.target.files && pickWatermarkImage(e.target.files)}
                />
                <button
                  className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-left text-sm text-foreground hover:bg-secondary/40"
                  onClick={() => watermarkRef.current?.click()}
                >
                  {watermarkImage ? `${watermarkImage.name} (${watermarkImage.size})` : "Choose PNG/JPG/WebP watermark image"}
                </button>
                <div className="mt-2">
                  <label className="text-xs font-medium text-muted-foreground">Image scale ({Math.round(imageScale * 100)}% of page width)</label>
                  <input
                    type="range"
                    min={5}
                    max={100}
                    value={Math.round(imageScale * 100)}
                    onChange={(e) => setImageScale(parseInt(e.target.value, 10) / 100)}
                    className="mt-1 w-full accent-foreground"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-muted-foreground">Opacity ({Math.round(opacity * 100)}%)</label>
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(opacity * 100)}
                onChange={(e) => setOpacity(parseInt(e.target.value, 10) / 100)}
                className="mt-1 w-full accent-foreground"
              />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground">Position</label>
              <div className="grid grid-cols-3 gap-2 mt-1">
                {positions.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPosition(p.id)}
                    className={cn(
                      "rounded-lg border py-2 px-2 text-[11px] font-medium transition-all",
                      position === p.id ? "border-accent bg-accent/10 text-accent" : "border-border text-muted-foreground hover:bg-secondary/40",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {error && (
            <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
              <AlertCircle size={15} className="shrink-0" />
              {error}
            </div>
          )}

          <Button
            onClick={process}
            disabled={state === "processing" || (mode === "text" ? !text.trim() : !watermarkImage)}
            className="glow-primary"
          >
            {state === "processing" ? (
              <>
                <Loader2 size={15} className="animate-spin" />
                Adding watermark…
              </>
            ) : (
              "Add Watermark"
            )}
          </Button>
          {mode === "image" && (
            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
              <ImageIcon size={12} />
              PNG, JPG, and WebP watermarks are supported.
            </p>
          )}
        </>
      )}
    </div>
  );
}
