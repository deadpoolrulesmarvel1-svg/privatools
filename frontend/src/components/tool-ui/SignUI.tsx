import { useState, useRef } from "react";
import { Upload, Loader2, CheckCircle2, X, FileText, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";

export function SignUI() {
  const [file, setFile] = useState<{ name: string; size: string; raw: File } | null>(null);
  const [sigData, setSigData] = useState("");
  const [page, setPage] = useState(1);
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const [width, setWidth] = useState(200);
  const [height, setHeight] = useState(80);
  const [state, setState] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [sigFile, setSigFile] = useState<File | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const sigRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);

  const pick = (fl: FileList) => { const f = fl[0]; setFile({ name: f.name, size: formatFileSize(f.size), raw: f }); setState("idle"); setError(null); };

  const startDraw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    setDrawing(true);
    const rect = canvasRef.current!.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };
  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing) return;
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
  };
  const endDraw = () => {
    setDrawing(false);
    if (canvasRef.current) setSigData(canvasRef.current.toDataURL("image/png"));
  };
  const clearCanvas = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (ctx && canvasRef.current) { ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height); setSigData(""); }
  };

  const process = async () => {
    if (!file) return;
    setState("processing"); setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file.raw);
      fd.append("page", String(page));
      fd.append("x", String(x));
      fd.append("y", String(y));
      fd.append("width", String(width));
      fd.append("height", String(height));
      if (sigFile) { fd.append("signature", sigFile); }
      else if (sigData) { fd.append("signature_data", sigData); }
      else { setError("Please draw or upload a signature"); setState("idle"); return; }
      const res = await fetch("/api/sign-pdf", { method: "POST", body: fd });
      if (!res.ok) { const b = await res.json().catch(() => ({ detail: "Failed" })); throw new Error(b.detail); }
      const blob = await res.blob();
      downloadBlob(blob, file ? `${file.name.replace(/\.pdf$/i, "")}_signed.pdf` : "signed.pdf");
      setState("done");
    } catch (e: any) { setError(e.message || "Failed"); setState("idle"); }
  };

  if (state === "done") return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
      <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
      <h2 className="text-lg font-bold text-foreground mb-1">Signed!</h2>
      <p className="text-sm text-muted-foreground mb-6">Your signed PDF has been downloaded.</p>
      <Button variant="outline" className="border-border text-muted-foreground" onClick={() => { setFile(null); setState("idle"); setSigData(""); setSigFile(null); }}>Sign another</Button>
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
          <p className="text-sm font-semibold text-foreground">Select a PDF to sign</p>
          <p className="text-xs text-muted-foreground">Drag & drop or click to browse</p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary"><FileText size={14} className="text-muted-foreground" /></div>
            <div className="flex-1 min-w-0"><p className="text-sm font-medium text-foreground truncate">{file.name}</p><p className="text-xs text-muted-foreground">{file.size}</p></div>
            <button onClick={() => setFile(null)} className="text-muted-foreground hover:text-foreground"><X size={15} /></button>
          </div>

          <div className="rounded-xl border border-border bg-card p-5 space-y-4">
            <p className="text-sm font-semibold text-foreground">Draw your signature</p>
            <div className="relative rounded-lg border border-border bg-secondary/20 overflow-hidden">
              <canvas ref={canvasRef} width={400} height={120} className="w-full cursor-crosshair"
                onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw} />
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={clearCanvas}>Clear</Button>
              <span className="text-xs text-muted-foreground/80 self-center">or</span>
              <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => sigRef.current?.click()}>Upload image</Button>
              <input ref={sigRef} type="file" accept=".png,.jpg,.jpeg" className="hidden" onChange={e => { if (e.target.files?.[0]) { setSigFile(e.target.files[0]); setSigData("uploaded"); } }} />
            </div>
            {sigFile && <p className="text-xs text-emerald-400">✓ Signature image: {sigFile.name}</p>}

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div><label className="text-xs font-medium text-muted-foreground">Page</label>
                <input type="number" value={page} onChange={e => setPage(Math.max(1, parseInt(e.target.value) || 1))} min={1}
                  className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50" /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Width</label>
                <input type="number" value={width} onChange={e => setWidth(parseInt(e.target.value) || 200)} min={10}
                  className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50" /></div>
              <div><label className="text-xs font-medium text-muted-foreground">X position</label>
                <input type="number" value={x} onChange={e => setX(parseInt(e.target.value) || 0)} min={0}
                  className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50" /></div>
              <div><label className="text-xs font-medium text-muted-foreground">Y position</label>
                <input type="number" value={y} onChange={e => setY(parseInt(e.target.value) || 0)} min={0}
                  className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none focus:border-accent/50" /></div>
            </div>
          </div>

          {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}

          <Button onClick={process} disabled={state === "processing"} className="glow-primary">
            {state === "processing" ? <><Loader2 size={15} className="animate-spin" />Signing…</> : "Sign PDF"}
          </Button>
        </>
      )}
    </div>
  );
}
