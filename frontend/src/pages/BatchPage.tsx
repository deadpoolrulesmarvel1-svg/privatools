import { useState, useRef, useCallback, useEffect } from "react";
import { Link } from "react-router-dom";
import { Upload, Play, Download, X, CheckCircle, AlertCircle, Loader2, FileText } from "lucide-react";
import { EditorialMasthead } from "@/components/EditorialMasthead";
import { EditorialFooter } from "@/components/EditorialFooter";
import { cn } from "@/lib/utils";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";
import { getToolEndpoint, getFilenameFromContentDisposition, guessExtensionFromContentType } from "@/lib/tool-endpoints";

const API = import.meta.env.VITE_API_URL || "";

const BATCH_TOOL_SLUGS = new Set([
  "split-pdf",
  "split-by-bookmarks",
  "split-by-size",
  "compress-pdf",
  "flatten-pdf",
  "deskew-pdf",
  "repair-pdf",
  "resize-pdf",
  "rotate-pdf",
  "grayscale-pdf",
  "crop-pdf",
  "strip-metadata",
  "delete-annotations",
  "pdf-to-word",
  "pdf-to-excel",
  "pdf-to-pptx",
  "pdf-to-image",
  "extract-images",
  "nup",
  "pdf-to-pdfa",
  "pdf-to-epub",
  "remove-blank-pages",
  "auto-crop",
  "invert-colors",
  "office-to-pdf",
  "word-to-pdf",
  "excel-to-pdf",
  "pptx-to-pdf-convert",
  "txt-to-pdf",
  "json-to-pdf",
  "xml-to-pdf",
  "epub-to-pdf",
  "rtf-to-pdf",
  "stamp-pdf",
  "extract-tables",
  "pdf-to-markdown",
  "add-hyperlinks",
  "transparent-background",
  "sanitize-pdf",
  "page-numbers",
  "bates-numbering",
  "image-compressor",
  "image-converter",
  "remove-exif",
  "resize-crop-image",
  "video-to-gif",
  "extract-audio",
  "trim-media",
  "compress-video",
  "extract-archive",
  "remove-background",
  "svg-to-png",
  "image-watermark",
  "generate-favicon",
  "heic-to-jpg",
]);

const batchableTools = [
  ...tools
    .filter((t) => BATCH_TOOL_SLUGS.has(t.slug))
    .map((t) => ({
      slug: t.slug,
      endpoint: getToolEndpoint(t.slug),
      name: t.name,
      icon: t.icon,
      href: `/tool/${t.slug}`,
      accepts: t.accepts,
      outputLabel: t.outputLabel,
      type: "pdf" as const,
    })),
  ...nonPdfTools
    .filter((t) => BATCH_TOOL_SLUGS.has(t.slug))
    .map((t) => ({
      slug: t.slug,
      endpoint: getToolEndpoint(t.slug),
      name: t.name,
      icon: t.icon,
      href: `/tools/${t.slug}`,
      accepts: t.accepts || "",
      outputLabel: t.outputLabel,
      type: "nonpdf" as const,
    })),
];

interface BatchFile {
  file: File;
  status: "pending" | "processing" | "done" | "error";
  resultUrl?: string;
  downloadName?: string;
  error?: string;
}

export default function BatchPage() {
  const [selectedTool, setSelectedTool] = useState(batchableTools[0]);
  const [files, setFiles] = useState<BatchFile[]>([]);
  const [processing, setProcessing] = useState(false);
  const [toolSearch, setToolSearch] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const filteredTools = toolSearch.trim()
    ? batchableTools.filter((t) => t.name.toLowerCase().includes(toolSearch.toLowerCase()))
    : batchableTools.slice(0, 20);

  const clearAllFiles = useCallback(() => {
    setFiles((prev) => {
      for (const f of prev) {
        if (f.resultUrl) URL.revokeObjectURL(f.resultUrl);
      }
      return [];
    });
  }, []);

  useEffect(() => clearAllFiles, [clearAllFiles]);

  const addFiles = useCallback((newFiles: FileList | null) => {
    if (!newFiles) return;
    const added: BatchFile[] = Array.from(newFiles).map((f) => ({ file: f, status: "pending" as const }));
    setFiles((prev) => [...prev, ...added]);
  }, []);

  const removeFile = (idx: number) => {
    setFiles((prev) => {
      const target = prev[idx];
      if (target?.resultUrl) URL.revokeObjectURL(target.resultUrl);
      return prev.filter((_, i) => i !== idx);
    });
  };

  const buildFallbackFilename = useCallback(
    (file: File, contentType: string | null) => {
      const base = file.name.replace(/\.[^.]+$/, "");
      const outputExt = /\.[a-z0-9]+$/i.test(selectedTool.outputLabel)
        ? selectedTool.outputLabel.match(/\.[a-z0-9]+$/i)?.[0]
        : null;
      const guessedExt = guessExtensionFromContentType(contentType);
      const originalExt = file.name.match(/\.[^.]+$/)?.[0] || "";
      const ext = guessedExt || outputExt || originalExt || ".bin";
      return `${base}_${selectedTool.slug}${ext}`;
    },
    [selectedTool.outputLabel, selectedTool.slug],
  );

  const processAll = async () => {
    if (files.length === 0 || processing) return;
    setProcessing(true);
    const updated = [...files];

    for (let i = 0; i < updated.length; i++) {
      if (updated[i].status === "done") continue;
      updated[i] = { ...updated[i], status: "processing" };
      setFiles([...updated]);

      try {
        const formData = new FormData();
        // Append under both field names so the endpoint works whether the
        // FastAPI handler expects `file` (singular) or `files` (plural list).
        formData.append("file", updated[i].file);
        formData.append("files", updated[i].file);

        const resp = await fetch(`${API}/api${selectedTool.endpoint}`, {
          method: "POST",
          body: formData,
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }));
          throw new Error(err.detail || `HTTP ${resp.status}`);
        }

        const blob = await resp.blob();
        const url = URL.createObjectURL(blob);
        const serverFilename = getFilenameFromContentDisposition(resp.headers.get("content-disposition"));
        updated[i] = {
          ...updated[i],
          status: "done",
          resultUrl: url,
          downloadName: serverFilename || buildFallbackFilename(updated[i].file, resp.headers.get("content-type")),
        };
      } catch (e: any) {
        updated[i] = { ...updated[i], status: "error", error: e.message || "Failed" };
      }
      setFiles([...updated]);
    }
    setProcessing(false);
  };

  const downloadAll = () => {
    files.forEach((f) => {
      if (f.resultUrl) {
        const a = document.createElement("a");
        a.href = f.resultUrl;
        a.download = f.downloadName || f.file.name;
        a.click();
      }
    });
  };

  const doneCount = files.filter((f) => f.status === "done").length;

  return (
    <div className="min-h-screen bg-background">
      <EditorialMasthead />

      <main id="main-content" className="mx-auto max-w-6xl px-4 sm:px-6 py-10">
        <div className="mb-8">
          <span className="section-flag">BATCH PROCESS</span>
          <h1 className="font-heading text-3xl sm:text-4xl font-bold text-foreground mt-4 tracking-tight">Batch Process</h1>
          <div className="rule-accent mt-3 mb-3 w-12" />
          <p className="font-serif-body text-base text-foreground/75 max-w-lg">Upload multiple files and apply the same tool to all of them at once.</p>
        </div>

        {/* Tool Selector */}
        <div className="mb-6">
          <label className="text-[12px] font-semibold uppercase tracking-widest text-muted-foreground/80 mb-2 block font-heading">Select Tool</label>
          <input
            className="w-full h-10 rounded-xl border border-border/60 bg-card/60 px-4 text-[14px] text-foreground placeholder:text-muted-foreground/80 outline-none focus:border-primary/30 focus:ring-1 focus:ring-primary/20 transition-all mb-3"
            placeholder="Search tools..."
            value={toolSearch}
            onChange={(e) => setToolSearch(e.target.value)}
          />
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-[220px] overflow-y-auto pr-1">
            {filteredTools.map((t) => {
              const Ic = t.icon;
              const isActive = selectedTool.slug === t.slug;
              return (
                <button
                  key={t.slug}
                  onClick={() => {
                    if (selectedTool.slug !== t.slug) clearAllFiles();
                    setSelectedTool(t);
                  }}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2.5 rounded-xl text-left text-[12px] transition-all border",
                    isActive
                      ? "bg-primary/10 border-primary/25 text-primary font-semibold shadow-sm"
                      : "border-border/40 text-muted-foreground hover:bg-card/60 hover:text-foreground hover:border-border/60",
                  )}
                >
                  <Ic size={13} className="shrink-0" />
                  <span className="truncate">{t.name}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Upload Zone */}
        <div
          className="relative border-2 border-dashed border-border/50 rounded-2xl p-10 text-center cursor-pointer hover:border-primary/40 hover:bg-primary/5 transition-all mb-6 group"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            e.preventDefault();
            addFiles(e.dataTransfer.files);
          }}
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 mx-auto mb-4 group-hover:bg-primary/15 transition-colors">
            <Upload size={22} className="text-primary/60 group-hover:text-primary/80 transition-colors" />
          </div>
          <p className="text-[14px] font-semibold text-foreground mb-1">Drop files here or click to browse</p>
          <p className="text-[12px] text-muted-foreground/80">Accepts: {selectedTool.accepts || "any"}</p>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept={selectedTool.accepts}
            className="hidden"
            onChange={(e) => addFiles(e.target.files)}
          />
        </div>

        {/* File List */}
        {files.length > 0 && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[13px] font-semibold text-foreground font-heading">{files.length} file{files.length !== 1 ? "s" : ""}</span>
              {doneCount > 0 && (
                <button
                  onClick={downloadAll}
                  className="flex items-center gap-1.5 text-[12px] font-medium text-primary hover:text-primary/80 transition-colors"
                >
                  <Download size={12} /> Download All ({doneCount})
                </button>
              )}
            </div>
            <div className="space-y-2">
              {files.map((f, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-center gap-3 px-4 py-3 rounded-xl border backdrop-blur-sm transition-all",
                    f.status === "processing"
                      ? "border-primary/30 bg-primary/5"
                      : f.status === "done"
                        ? "border-green-500/20 bg-green-500/5"
                        : f.status === "error"
                          ? "border-red-400/20 bg-red-500/5"
                          : "border-border/60 bg-card/60",
                  )}
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-card/80 border border-border/40 shrink-0">
                    <FileText size={14} className="text-muted-foreground/80" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-foreground truncate">{f.file.name}</p>
                    <p className="text-[11px] text-muted-foreground/80">{(f.file.size / 1024).toFixed(0)} KB</p>
                  </div>
                  {f.status === "pending" && (
                    <span className="text-[11px] text-muted-foreground/80 px-2 py-0.5 rounded-lg bg-card/40">Pending</span>
                  )}
                  {f.status === "processing" && <Loader2 size={14} className="shrink-0 text-primary animate-spin" />}
                  {f.status === "done" && (
                    <div className="flex items-center gap-2">
                      <CheckCircle size={14} className="shrink-0 text-green-400" />
                      {f.resultUrl && (
                        <a href={f.resultUrl} download={f.downloadName || f.file.name} className="text-[11px] font-medium text-primary hover:underline">
                          Download
                        </a>
                      )}
                    </div>
                  )}
                  {f.status === "error" && (
                    <div className="flex items-center gap-1.5">
                      <AlertCircle size={14} className="shrink-0 text-red-400" />
                      <span className="text-[11px] text-red-400">{f.error}</span>
                    </div>
                  )}
                  {!processing && (
                    <button onClick={() => removeFile(i)} className="shrink-0 text-muted-foreground/85 hover:text-muted-foreground transition-colors">
                      <X size={12} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Actions */}
        {files.length > 0 && (
          <div className="flex items-center gap-3">
            <button
              onClick={processAll}
              disabled={processing || files.every((f) => f.status === "done")}
              className={cn(
                "flex items-center gap-2 h-10 px-6 rounded-xl text-[14px] font-semibold transition-all",
                processing || files.every((f) => f.status === "done")
                  ? "bg-secondary/50 text-muted-foreground cursor-not-allowed"
                  : "bg-primary text-primary-foreground hover:bg-primary/90 shadow-lg shadow-primary/25",
              )}
            >
              {processing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
              {processing ? "Processing..." : `Process ${files.filter((f) => f.status !== "done").length} Files`}
            </button>
            {!processing && (
              <button onClick={clearAllFiles} className="text-[13px] text-muted-foreground hover:text-foreground transition-colors rounded-xl px-3 py-1.5 hover:bg-card/60">
                Clear all
              </button>
            )}
          </div>
        )}
      </main>
      <EditorialFooter />
    </div>
  );
}
