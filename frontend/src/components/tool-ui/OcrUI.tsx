import { useCallback, useEffect, useState, useRef } from "react";
import { Upload, Loader2, CheckCircle2, AlertCircle, RotateCcw, Download, Copy, Check, Ban } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { downloadBlob, buildOutputFilename } from "@/lib/api";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { FileUploadZone } from "./FileUploadZone";
import { useByok } from "@/hooks/useByok";
import { ByokPanel } from "@/components/byok/ByokPanel";
import { getBaseUrl, getKey } from "@/lib/byok/keyStore";
import { providerById } from "@/lib/byok/providers";
import { visionOcrWithByok } from "@/lib/byok/tasks";
import { ByokError } from "@/lib/byok/errors";

// Tesseract language packs actually installed in the production image — keep
// in sync with the `tesseract-ocr-*` packages in /Dockerfile.
const INSTALLED_PACKS = new Set([
  "eng", "fra", "deu", "spa", "ita", "por", "nld", "rus", "pol", "tur",
  "jpn", "kor", "chi_sim", "chi_tra", "ara", "hin", "vie",
]);

const DPI_PRESETS: { id: number; label: string; desc: string }[] = [
  { id: 150, label: "Fast",     desc: "150 DPI · best for clean digital scans" },
  { id: 200, label: "Balanced", desc: "200 DPI · default, good for most scans" },
  { id: 300, label: "Precise",  desc: "300 DPI · best for low-quality / handwriting" },
];

const OCR_DEFAULTS: { lang: string; dpi: number } = {
    lang: "eng",
    dpi: 200,
};

/** Which OCR engine runs: the server (multi-file, searchable-PDF capable),
 *  the user's own vision-model key, or tesseract.js in this tab. */
type Engine = "server" | "byok" | "local";

/** The client-side engines read at most this many pages per run. The server
 *  engine has no such cap — big documents belong there. */
const MAX_CLIENT_PAGES = 50;
/** pdf.js render scale for the client engines — ~144 DPI for a Letter page. */
const PAGE_RENDER_SCALE = 2;

// tesseract.js loads its worker, wasm core and language data from jsDelivr —
// the one external CDN the prod CSP allows besides huggingface.co. It hosts
// both the tesseract.js dist files and the @tesseract.js-data language packs.
// Versions are pinned to the installed npm packages (keep in sync with
// package.json). Language data is cached in IndexedDB after the first
// download, so a language costs its few-MB fetch exactly once.
const TESSERACT_WORKER_PATH = "https://cdn.jsdelivr.net/npm/tesseract.js@v7.0.0/dist/worker.min.js";
const TESSERACT_CORE_PATH = "https://cdn.jsdelivr.net/npm/tesseract.js-core@v7.0.0";
const tesseractLangPath = (lang: string) =>
  `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}/4.0.0_best_int`;

interface RenderedPage { mimeType: string; dataBase64: string; dataUrl: string }

type ClientStage =
  | { kind: "render"; done: number; total: number }
  | { kind: "model"; label: string; pct: number }
  | { kind: "read"; done: number; total: number };

/** Render every page of a PDF to a JPEG in the browser (same memoised pdf.js
 *  loader arrangement as Summarize / Translate PDF). */
async function renderPdfPages(
  file: File,
  onPage: (n: number, total: number) => void,
  isCancelled: () => boolean,
): Promise<RenderedPage[]> {
  const pdfjsLib = await import("pdfjs-dist");
  const workerSrc = (await import("pdfjs-dist/build/pdf.worker.mjs?url")).default;
  pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

  const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  if (pdf.numPages > MAX_CLIENT_PAGES) {
    throw new Error(
      `This PDF has ${pdf.numPages} pages — the AI-key and in-browser engines read up to ${MAX_CLIENT_PAGES} at a time. Use the server engine for bigger documents.`,
    );
  }
  const out: RenderedPage[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    if (isCancelled()) break;
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: PAGE_RENDER_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
    // Release the bitmap eagerly — 50 pages of live canvases is real memory.
    canvas.width = 0;
    canvas.height = 0;
    out.push({
      mimeType: "image/jpeg",
      dataBase64: dataUrl.slice(dataUrl.indexOf(",") + 1),
      dataUrl,
    });
    onPage(i, pdf.numPages);
  }
  return out;
}

export function OcrUI() {
    const [config, , { setField }] = useToolDefaults("ocr-pdf", OCR_DEFAULTS);
    const { lang, dpi } = config;
    const setLang = useCallback((v: React.SetStateAction<typeof OCR_DEFAULTS["lang"]>) => setField("lang", v), [setField]);
    const setDpi = useCallback((v: React.SetStateAction<typeof OCR_DEFAULTS["dpi"]>) => setField("dpi", v), [setField]);
  const proc = useMultiFileProcessor();

  const [output, setOutput] = useState<"json" | "txt" | "searchable_pdf">("json");
  const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
  // Per-file extracted text, keyed by queue entry id (json output only).
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  // ── Client engines (BYOK vision / in-browser tesseract.js) ──
  const byok = useByok();
  const [engine, setEngine] = useState<Engine>("server");
  const [byokModel, setByokModel] = useState("");
  const [singleFile, setSingleFile] = useState<File | null>(null);
  const [clientPhase, setClientPhase] = useState<"idle" | "working" | "done">("idle");
  const [stage, setStage] = useState<ClientStage | null>(null);
  const [clientError, setClientError] = useState<string | null>(null);
  const [pageTexts, setPageTexts] = useState<string[]>([]);
  const [copied, setCopied] = useState(false);
  const cancelRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const workerRef = useRef<{ terminate: () => Promise<unknown> } | null>(null);

  const langs = [
    // European
    { id: "eng", label: "English" }, { id: "fra", label: "French" }, { id: "deu", label: "German" },
    { id: "spa", label: "Spanish" }, { id: "ita", label: "Italian" }, { id: "por", label: "Portuguese" },
    { id: "nld", label: "Dutch" }, { id: "pol", label: "Polish" }, { id: "rus", label: "Russian" },
    { id: "ukr", label: "Ukrainian" }, { id: "ces", label: "Czech" }, { id: "ron", label: "Romanian" },
    { id: "hun", label: "Hungarian" }, { id: "ell", label: "Greek" }, { id: "bul", label: "Bulgarian" },
    { id: "hrv", label: "Croatian" }, { id: "slk", label: "Slovak" }, { id: "slv", label: "Slovenian" },
    { id: "srp", label: "Serbian" }, { id: "cat", label: "Catalan" }, { id: "dan", label: "Danish" },
    { id: "fin", label: "Finnish" }, { id: "nor", label: "Norwegian" }, { id: "swe", label: "Swedish" },
    { id: "tur", label: "Turkish" },
    // Asian
    { id: "chi_sim", label: "Chinese (Simplified)" }, { id: "chi_tra", label: "Chinese (Traditional)" },
    { id: "jpn", label: "Japanese" }, { id: "kor", label: "Korean" }, { id: "tha", label: "Thai" },
    { id: "vie", label: "Vietnamese" }, { id: "ind", label: "Indonesian" }, { id: "msa", label: "Malay" },
    // South Asian
    { id: "hin", label: "Hindi" }, { id: "ben", label: "Bengali" }, { id: "tam", label: "Tamil" },
    { id: "tel", label: "Telugu" }, { id: "kan", label: "Kannada" }, { id: "mal", label: "Malayalam" },
    { id: "mar", label: "Marathi" }, { id: "guj", label: "Gujarati" }, { id: "pan", label: "Punjabi" },
    { id: "urd", label: "Urdu" },
    // Middle Eastern
    { id: "ara", label: "Arabic" }, { id: "heb", label: "Hebrew" },
  ];

  const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");
  const clientBusy = clientPhase === "working";
  const canProcess = engine === "server"
    ? proc.entries.length > 0 && phase !== "processing"
    : !!singleFile && !clientBusy && (engine !== "byok" || byok.ready);

  const process = useCallback(async (retry = false) => {
    setPhase("processing");
    await proc.run({
      endpoint: "/ocr",
      // json → text shown inline, nothing downloaded; txt → per-file .txt;
      // searchable_pdf → per-file *_searchable.pdf. Server Content-Disposition
      // (when present) still wins over the built name.
      outputSuffix: output === "searchable_pdf" ? "searchable" : null,
      outputExt: output === "searchable_pdf" ? "pdf" : output === "txt" ? "txt" : "json",
      params: { lang, output, dpi },
    }, retry);
    setPhase("done");
  }, [proc, lang, output, dpi]);

  // ── Client-engine run: render pages, then read them with the chosen engine ──
  const clientProcess = useCallback(async () => {
    if (!singleFile) return;
    cancelRef.current = false;
    setClientError(null);
    setPageTexts([]);
    setClientPhase("working");
    setStage({ kind: "render", done: 0, total: 0 });
    try {
      const rendered = await renderPdfPages(
        singleFile,
        (n, total) => setStage({ kind: "render", done: n, total }),
        () => cancelRef.current,
      );
      if (cancelRef.current) return;
      if (!rendered.length) throw new Error("Couldn't read any pages from that PDF.");

      let out: string[];
      if (engine === "byok") {
        if (!byok.ready) throw new Error("Add an API key first, or pick another engine.");
        const apiKey = await getKey(byok.provider);
        if (!apiKey) throw new Error("That saved key could not be read. Enter it again.");
        const controller = new AbortController();
        abortRef.current = controller;
        setStage({ kind: "read", done: 0, total: rendered.length });
        out = await visionOcrWithByok({
          providerId: byok.provider,
          apiKey,
          baseUrl: getBaseUrl(byok.provider),
          model: byokModel.trim() || providerById(byok.provider)?.models[0] || "",
          pages: rendered.map(r => ({ mimeType: r.mimeType, dataBase64: r.dataBase64 })),
          signal: controller.signal,
          onProgress: (done, total) => setStage({ kind: "read", done, total }),
        });
      } else {
        const { createWorker } = await import("tesseract.js");
        setStage({ kind: "model", label: "Downloading OCR engine", pct: 0 });
        const worker = await createWorker(lang, undefined, {
          workerPath: TESSERACT_WORKER_PATH,
          corePath: TESSERACT_CORE_PATH,
          langPath: tesseractLangPath(lang),
          logger: m => {
            if (cancelRef.current) return;
            const pct = Math.round((m.progress ?? 0) * 100);
            if (m.status === "loading tesseract core") {
              setStage({ kind: "model", label: "Downloading OCR engine", pct });
            } else if (m.status === "loading language traineddata") {
              setStage({ kind: "model", label: "Downloading language data", pct });
            }
          },
        });
        workerRef.current = worker;
        try {
          out = [];
          for (let i = 0; i < rendered.length; i++) {
            if (cancelRef.current) return;
            setStage({ kind: "read", done: i, total: rendered.length });
            const res = await worker.recognize(rendered[i].dataUrl);
            out.push(res.data.text.trim());
            setStage({ kind: "read", done: i + 1, total: rendered.length });
          }
        } finally {
          // One worker per run, always torn down — even on error or cancel.
          if (workerRef.current === worker) {
            workerRef.current = null;
            try { await worker.terminate(); } catch { /* already terminated */ }
          }
        }
        if (cancelRef.current) return;
      }

      setPageTexts(out);
      setClientPhase("done");
    } catch (e: unknown) {
      if (cancelRef.current) return;
      const msg = e instanceof ByokError ? e.userMessage : e instanceof Error ? e.message : "OCR failed";
      setClientError(friendlyError(msg, "Couldn't read that PDF."));
      setClientPhase("idle");
    } finally {
      setStage(null);
      abortRef.current = null;
    }
  }, [singleFile, engine, lang, byok.ready, byok.provider, byokModel]);

  const cancelClient = () => {
    cancelRef.current = true;
    abortRef.current?.abort();
    const w = workerRef.current;
    workerRef.current = null;
    if (w) void w.terminate().catch(() => { /* already gone */ });
    setClientPhase("idle");
    setStage(null);
  };

  const clientReset = () => {
    cancelRef.current = false;
    setSingleFile(null);
    setClientPhase("idle");
    setStage(null);
    setPageTexts([]);
    setClientError(null);
    setCopied(false);
  };

  const onSingleFile = (f: File) => {
    setSingleFile(f);
    setClientPhase("idle");
    setPageTexts([]);
    setClientError(null);
  };

  const clientText = pageTexts.length > 1
    ? pageTexts.map((t, i) => `— Page ${i + 1} —\n\n${t}`).join("\n\n")
    : (pageTexts[0] ?? "");

  const clientCopy = async () => {
    try {
      await navigator.clipboard.writeText(clientText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setClientError("Couldn't copy to the clipboard.");
    }
  };

  const clientDownloadTxt = () => {
    downloadBlob(
      new Blob([clientText], { type: "text/plain;charset=utf-8" }),
      buildOutputFilename(singleFile?.name ?? "document.pdf", "ocr", "txt"),
    );
  };

  // json output: read each done entry's JSON body and pull out `text`.
  useEffect(() => {
    if (phase !== "done" || output !== "json") return;
    let cancelled = false;
    const done = proc.entries.filter(e => e.status === "done" && e.blob);
    Promise.all(done.map(async e => {
      try {
        const data = JSON.parse(await e.blob!.text()) as { text?: string };
        return [e.id, data.text || ""] as const;
      } catch {
        return [e.id, ""] as const;
      }
    })).then(pairs => { if (!cancelled) setTexts(Object.fromEntries(pairs)); });
    return () => { cancelled = true; };
  }, [phase, output, proc.entries]);

  // txt / searchable_pdf: auto-download once (single file direct, several as ZIP).
  const downloadedRef = useRef(false);
  useEffect(() => {
    if (phase === "done" && !downloadedRef.current && proc.doneCount > 0 && output !== "json") {
      downloadedRef.current = true;
      proc.downloadAll(output === "txt" ? "archive_text" : "archive_searchable");
    }
  }, [phase, proc, output]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
        e.preventDefault();
        if (engine === "server") void process(false); else void clientProcess();
      }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [canProcess, process, clientProcess, engine]);

  if (phase === "done") {
    const isMulti = proc.entries.length > 1;
    const doneEntries = proc.entries.filter(e => e.status === "done");
    return (
      <div className="space-y-4">
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
          <div className="relative p-7">
            <CornerMarks accent />
            <div className="flex items-start gap-5">
              <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="section-mark mb-2">OCR complete</p>
                <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                  {isMulti
                    ? <>{output === "searchable_pdf" ? <>Searchable <span className="italic text-accent">PDFs</span></> : <><span className="italic text-accent">Text</span> extracted</>} · <span className="italic text-accent">{proc.doneCount}</span> of {proc.entries.length}{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                    : output === "searchable_pdf" ? <>Searchable <span className="italic text-accent">PDF</span> created.</> : <><span className="italic text-accent">Text</span> extracted.</>}
                </h2>
                {output !== "json" && proc.doneCount > 0 && (
                  <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                    {proc.doneCount > 1 ? "ZIP downloaded" : "Downloaded"}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Per-file extracted text panels (json output) */}
        {output === "json" && doneEntries.map(e => {
          const text = texts[e.id] ?? "";
          if (!text) return null;
          return (
            <div key={e.id} className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="font-medium flex items-center justify-between gap-3 px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                <span className="truncate min-w-0">{isMulti ? <>{e.name} · </> : <>Extracted text · </>}{text.length.toLocaleString()} chars</span>
                <button onClick={() => navigator.clipboard.writeText(text)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors shrink-0">
                  Copy
                </button>
              </div>
              <pre className="font-mono text-[13px] text-foreground whitespace-pre-wrap max-h-80 overflow-y-auto p-4">{text}</pre>
            </div>
          );
        })}

        <div className="flex flex-wrap gap-2">
          {output !== "json" && proc.doneCount > 0 && (
            <button
              onClick={() => proc.downloadAll(output === "txt" ? "archive_text" : "archive_searchable")}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90"
            >
              <Download size={13} /> Download {proc.doneCount > 1 ? "ZIP" : "again"}
            </button>
          )}
          {proc.failedCount > 0 && (
            <button
              onClick={() => { downloadedRef.current = false; void process(true); }}
              className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-copper bg-copper-soft/40 text-[13px] font-medium text-foreground hover:bg-copper-soft/60 transition-colors"
            >
              Retry {proc.failedCount} failed
            </button>
          )}
          <button
            onClick={() => { proc.reset(); setPhase("idle"); setTexts({}); downloadedRef.current = false; }}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
          >
            <RotateCcw size={12} /> OCR another file
          </button>
        </div>
      </div>
    );
  }

  // ── Done view for the client engines: copyable text + Download .txt ──
  if (clientPhase === "done") {
    return (
      <div className="space-y-4 animate-fade-up">
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden">
          <div className="relative p-7">
            <CornerMarks accent />
            <div className="flex items-start gap-5">
              <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="section-mark mb-2">OCR complete</p>
                <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                  <span className="italic text-accent">Text</span> extracted.
                </h2>
                <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                  {pageTexts.length} page{pageTexts.length === 1 ? "" : "s"} · {engine === "byok"
                    ? `read with your ${providerById(byok.provider)?.label ?? "AI"} key`
                    : "read in this browser — nothing was uploaded"}
                </p>
              </div>
            </div>
          </div>
        </div>

        {clientError && (
          <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive" role="alert">
            <AlertCircle size={13} className="shrink-0" />{clientError}
          </div>
        )}

        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="font-medium flex items-center justify-between gap-3 px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
            <span className="truncate min-w-0">Extracted text · {clientText.length.toLocaleString()} chars</span>
            <button onClick={clientCopy} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors shrink-0">
              {copied ? <><Check size={10} className="text-accent" /> Copied</> : <><Copy size={10} /> Copy</>}
            </button>
          </div>
          <pre className="font-mono text-[13px] text-foreground whitespace-pre-wrap max-h-80 overflow-y-auto p-4">{clientText}</pre>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            onClick={clientDownloadTxt}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90"
          >
            <Download size={13} /> Download .txt
          </button>
          <button
            onClick={clientReset}
            className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
          >
            <RotateCcw size={12} /> OCR another file
          </button>
        </div>
        <p className="font-medium text-[11.5px] text-muted-foreground">
          These engines output text only — for a searchable PDF, run the server engine.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {engine === "server" ? (
        <div
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) proc.addFiles(e.dataTransfer.files, isPdfOnly); }}
          onClick={() => ref.current?.click()}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
          role="button"
          tabIndex={0}
          aria-label="Upload files"
          className={cn(
            "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
            drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
          )}
        >
          <CornerMarks />
          <input ref={ref} type="file" accept=".pdf" multiple className="hidden" onChange={e => { if (e.target.files) proc.addFiles(e.target.files, isPdfOnly); e.target.value = ""; }} />
          <div className={cn(
            "h-12 w-12 rounded-xl flex items-center justify-center transition-colors",
            drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15"
          )}>
            <Upload size={20} className="text-accent" strokeWidth={1.75} />
          </div>
          <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">{proc.entries.length ? "Add more files" : "Select scanned PDFs"}</p>
          <p className="font-medium text-[11.5px] text-muted-foreground">{langs.length}+ languages supported · Tesseract on-server · same settings for every file</p>
        </div>
      ) : (
        <FileUploadZone
          file={singleFile}
          onFileSelect={onSingleFile}
          onClear={clientReset}
          accept=".pdf"
          label="Drop a scanned PDF"
          hint={engine === "byok"
            ? "One PDF at a time · pages are read with your own AI key"
            : "One PDF at a time · OCR runs in this tab, nothing uploads"}
        />
      )}

      {/* Engine: server queue, the user's own vision key, or tesseract.js here */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
          Which OCR engine
        </div>
        <div className="p-3 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <button
              type="button"
              onClick={() => setEngine("server")}
              aria-pressed={engine === "server"}
              disabled={clientBusy || phase === "processing"}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                engine === "server" ? "border-accent bg-accent/[0.07]" : "border-border hover:border-accent/40",
              )}
            >
              <span className="block text-[13.5px] font-medium text-foreground">On our server</span>
              <span className="block text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
                Tesseract on the server. Many PDFs at once, and the only engine
                that can write a searchable PDF. Files are deleted after processing.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setEngine("byok")}
              aria-pressed={engine === "byok"}
              disabled={clientBusy || phase === "processing"}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                engine === "byok" ? "border-accent bg-accent/[0.07]" : "border-border hover:border-accent/40",
              )}
            >
              <span className="block text-[13.5px] font-medium text-foreground">My own AI key (vision)</span>
              <span className="block text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
                Far better accuracy on hard scans, billed by your provider. One PDF
                at a time, text only — for a searchable PDF use the server engine.
              </span>
            </button>
            <button
              type="button"
              onClick={() => setEngine("local")}
              aria-pressed={engine === "local"}
              disabled={clientBusy || phase === "processing"}
              className={cn(
                "rounded-lg border p-3 text-left transition-colors",
                engine === "local" ? "border-accent bg-accent/[0.07]" : "border-border hover:border-accent/40",
              )}
            >
              <span className="block text-[13.5px] font-medium text-foreground">In this browser</span>
              <span className="block text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
                tesseract.js, fully local — nothing uploads. Language data downloads
                once and caches. One PDF at a time, text only — for a searchable PDF
                use the server engine.
              </span>
            </button>
          </div>
          {engine === "byok" && (
            <>
              <ByokPanel
                byok={byok}
                purpose="Each page of this PDF is rendered to an image and sent to the provider you choose, using your key."
              />
              {byok.ready && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block">
                    <span className="font-medium text-[11px] text-muted-foreground">Model (optional)</span>
                    <input
                      type="text"
                      value={byokModel}
                      onChange={e => setByokModel(e.target.value)}
                      placeholder={providerById(byok.provider)?.models[0] ?? "provider default"}
                      className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] font-mono"
                    />
                    <span className="mt-1 block text-[11px] text-muted-foreground">
                      Pick a vision-capable model. Any language — it detects the script itself.
                    </span>
                  </label>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {engine === "server" ? (proc.entries.length > 0 && (
        <>
          <MultiFileQueue
            entries={proc.entries}
            reorderable={false}
            onRemove={proc.removeFile}
            onReorder={proc.reorder}
            onClearAll={proc.clearAll}
            onRetryFailed={() => { downloadedRef.current = false; void process(true); }}
            busy={phase === "processing"}
          />

          {/* Options */}
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
              OCR options
            </div>
            <div className="p-5 space-y-5">
              {/* Language */}
              <div>
                <label htmlFor="ocr-lang" className="font-medium text-[11.5px] text-muted-foreground">Language</label>
                <select
                  id="ocr-lang"
                  value={lang}
                  onChange={e => setLang(e.target.value)}
                  className="mt-1.5 w-full rounded-md border border-border bg-card px-3 py-2 text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                >
                  {langs.map(l => (
                    <option key={l.id} value={l.id}>
                      {l.label}{INSTALLED_PACKS.has(l.id) ? "" : " — pack not installed"}
                    </option>
                  ))}
                </select>
                {!INSTALLED_PACKS.has(lang) && (
                  <p className="font-medium mt-2 text-[11.5px] text-copper">
                    <AlertCircle size={11} className="inline -mt-0.5 mr-1" />
                    Self-host to add this pack — apt install tesseract-ocr-{lang}
                  </p>
                )}
              </div>

              {/* DPI */}
              <div>
                <label className="font-medium text-[11.5px] text-muted-foreground">Quality (DPI)</label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1.5">
                  {DPI_PRESETS.map((p, idx) => {
                    const active = dpi === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => setDpi(p.id)}
                        aria-pressed={active}
                        className={cn(
                          "rounded-lg border p-3 text-left transition-colors",
                          active ? "border-accent bg-accent/[0.06]" : "border-border hover:border-border-strong hover:bg-paper-2/30"
                        )}
                      >
                        <div className="flex items-baseline gap-1.5 mb-0.5">
                          <span className="font-medium text-[9.5px] text-accent">{String(idx + 1).padStart(2, "0")}</span>
                          <p className="font-display text-[14px] font-semibold text-foreground tracking-[-0.015em]">{p.label}</p>
                        </div>
                        <p className="text-[11.5px] text-muted-foreground leading-snug">{p.desc}</p>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Output format */}
              <div>
                <label className="font-medium text-[11.5px] text-muted-foreground">Output</label>
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {([
                    { id: "json" as const,            label: "Show text" },
                    { id: "txt" as const,             label: "Download .txt" },
                    { id: "searchable_pdf" as const,  label: "Searchable PDF" },
                  ]).map(o => {
                    const active = output === o.id;
                    return (
                      <button
                        key={o.id}
                        onClick={() => setOutput(o.id)}
                        className={cn(
                          "inline-flex items-center h-8 px-3 rounded-md border text-[12.5px] font-medium transition-colors",
                          active ? "border-accent bg-accent/[0.06] text-foreground" : "border-border text-muted-foreground hover:text-foreground hover:bg-paper-2/30"
                        )}
                      >
                        {o.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <p className="font-medium text-[11.5px] text-muted-foreground">
                ≈0.5s per page · higher DPI is slower but more accurate on blurry scans
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={() => void process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
              {phase === "processing"
                ? <><Loader2 size={13} className="animate-spin" /> Extracting text… ({proc.doneCount}/{proc.entries.length})</>
                : <>Run OCR{proc.entries.length > 1 ? ` — ${proc.entries.length} PDFs` : ""}</>}
            </button>
            {canProcess && (
              <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
            )}
          </div>
        </>
      )) : (
        <>
          {clientError && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive" role="alert">
              <AlertCircle size={13} className="shrink-0" />{clientError}
            </div>
          )}

          {/* Language — applies to the in-browser engine only; the vision
              model detects the language itself, and DPI / output format are
              server-only knobs, so they stay hidden here. */}
          {engine === "local" && (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                OCR options
              </div>
              <div className="p-5">
                <label htmlFor="ocr-lang-local" className="font-medium text-[11.5px] text-muted-foreground">Language</label>
                <select
                  id="ocr-lang-local"
                  value={lang}
                  onChange={e => setLang(e.target.value)}
                  disabled={clientBusy}
                  className="mt-1.5 w-full rounded-md border border-border bg-card px-3 py-2 text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors disabled:opacity-60"
                >
                  {langs.map(l => (
                    <option key={l.id} value={l.id}>{l.label}</option>
                  ))}
                </select>
                <p className="font-medium mt-2 text-[11.5px] text-muted-foreground">
                  First run downloads this language's data (a few MB) from a CDN, then it's cached in your browser.
                </p>
              </div>
            </div>
          )}

          {clientBusy && stage && (
            <div className="rounded-xl border border-accent/30 bg-accent/[0.05] p-4 space-y-2 animate-fade-in">
              <p className="font-medium text-[12px] text-accent">
                {stage.kind === "render" && `Rendering page ${stage.done} of ${stage.total || "?"}`}
                {stage.kind === "model" && `${stage.label} — ${stage.pct}%`}
                {stage.kind === "read" && `Reading page ${Math.min(stage.done + 1, stage.total)} of ${stage.total}${engine === "byok" ? " with your key" : ""}`}
              </p>
              <div className="h-1.5 rounded-full bg-border/60 overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-300"
                  style={{
                    width: `${stage.kind === "model"
                      ? stage.pct
                      : (stage.total ? (stage.done / stage.total) * 100 : 0)}%`,
                  }}
                />
              </div>
              <button
                onClick={cancelClient}
                className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
              >
                <Ban size={11} /> Cancel
              </button>
            </div>
          )}

          {!clientBusy && (
            <div className="flex items-center gap-3 flex-wrap">
              <button onClick={() => void clientProcess()} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                Run OCR
              </button>
              {canProcess && (
                <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function CornerMarks({ accent }: { accent?: boolean }) {
  const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
  const color = accent ? "bg-accent" : "bg-accent/70";
  return (
    <>
      <span className={`${cls} -top-1 -left-1`}>
        <span className={`absolute top-0 left-0 h-px w-3 ${color}`} />
        <span className={`absolute top-0 left-0 w-px h-3 ${color}`} />
      </span>
      <span className={`${cls} -top-1 -right-1`}>
        <span className={`absolute top-0 right-0 h-px w-3 ${color}`} />
        <span className={`absolute top-0 right-0 w-px h-3 ${color}`} />
      </span>
      <span className={`${cls} -bottom-1 -left-1`}>
        <span className={`absolute bottom-0 left-0 h-px w-3 ${color}`} />
        <span className={`absolute bottom-0 left-0 w-px h-3 ${color}`} />
      </span>
      <span className={`${cls} -bottom-1 -right-1`}>
        <span className={`absolute bottom-0 right-0 h-px w-3 ${color}`} />
        <span className={`absolute bottom-0 right-0 w-px h-3 ${color}`} />
      </span>
    </>
  );
}
