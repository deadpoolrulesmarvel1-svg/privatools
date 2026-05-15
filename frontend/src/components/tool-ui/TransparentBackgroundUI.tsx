import { useState } from "react";
import { Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { processAndDownload } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";

export function TransparentBackgroundUI() {
  const [file, setFile] = useState<File | null>(null);
  const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [threshold, setThreshold] = useState(245);
  const [dpi, setDpi] = useState(144);

  const process = async () => {
    if (!file) return;
    setStatus("processing");
    setError(null);
    try {
      await processAndDownload("/transparent-background", file, "transparent.pdf", {
        threshold,
        dpi,
      });
      setStatus("done");
    } catch (e: any) {
      setError(e.message || "Failed");
      setStatus("idle");
    }
  };

  return (
    <div className="space-y-5">
      {!file ? (
        <FileUploadZone
          file={null}
          onFileSelect={setFile}
          onClear={() => setFile(null)}
          accept=".pdf"
          label="Drop PDF here"
          hint="Convert near-white pixels to transparent"
        />
      ) : (
        <FileUploadZone
          file={file}
          onFileSelect={setFile}
          onClear={() => {
            setFile(null);
            setStatus("idle");
          }}
          accept=".pdf"
        />
      )}

      <div className="rounded-xl border border-border bg-card p-4 space-y-4">
        <div>
          <label className="text-xs font-medium text-muted-foreground">White threshold ({threshold})</label>
          <input
            type="range"
            min={180}
            max={255}
            value={threshold}
            onChange={(e) => setThreshold(parseInt(e.target.value, 10))}
            className="mt-1 w-full accent-foreground"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            Higher values remove only very bright whites. Lower values remove more light backgrounds.
          </p>
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground">Render DPI ({dpi})</label>
          <input
            type="range"
            min={72}
            max={300}
            value={dpi}
            onChange={(e) => setDpi(parseInt(e.target.value, 10))}
            className="mt-1 w-full accent-foreground"
          />
          <p className="text-[11px] text-muted-foreground mt-1">
            This operation rasterizes pages. Higher DPI improves detail but increases file size.
          </p>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle size={15} />
          {error}
        </div>
      )}

      {status === "done" ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
          <p className="text-sm font-semibold text-emerald-400 mb-3">Background removed</p>
          <Button variant="outline" onClick={() => { setFile(null); setStatus("idle"); }}>
            Process another
          </Button>
        </div>
      ) : (
        <Button className="w-full" disabled={!file || status === "processing"} onClick={process}>
          {status === "processing" ? (
            <>
              <Loader2 size={14} className="animate-spin mr-2" />
              Processing...
            </>
          ) : (
            "Remove Background"
          )}
        </Button>
      )}
    </div>
  );
}
