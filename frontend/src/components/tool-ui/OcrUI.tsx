import { useCallback, useEffect, useState, useRef } from "react";
import { Upload, Loader2, CheckCircle2, X, FileText, AlertCircle } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";
import { useToolDefaults } from "@/hooks/useToolDefaults";

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

export function OcrUI() {
    const [config, , { setField }] = useToolDefaults("ocr-pdf", OCR_DEFAULTS);
    const { lang, dpi } = config;
    const setLang = useCallback((v: React.SetStateAction<typeof OCR_DEFAULTS["lang"]>) => setField("lang", v), [setField]);
    const setDpi = useCallback((v: React.SetStateAction<typeof OCR_DEFAULTS["dpi"]>) => setField("dpi", v), [setField]);
  const [file, setFile] = useState<{ name: string; size: string; raw: File } | null>(null);

  const [output, setOutput] = useState<"json" | "txt" | "searchable_pdf">("json");
  const [state, setState] = useState<"idle" | "processing" | "done">("idle");
  const [error, setError] = useState<string | null>(null);
  const [extractedText, setExtractedText] = useState("");
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

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

  const pick = (fl: FileList) => { const f = fl[0]; setFile({ name: f.name, size: formatFileSize(f.size), raw: f }); setState("idle"); setError(null); };

  const canProcess = !!file && state !== "processing";

  const process = useCallback(async () => {
    if (!file) return;
    setState("processing"); setError(null);
    try {
      const res = await uploadFile("/ocr", file.raw, { lang, output, dpi });
      if (output === "json") {
        const data = await res.json();
        setExtractedText(data.text || "");
      } else {
        const blob = await res.blob();
        const filename = output === "txt" ? "extracted_text.txt" : "searchable.pdf";
        downloadBlob(blob, filename);
        setExtractedText("");
      }
      setState("done");
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "OCR failed";
      setError(friendlyError(msg, "OCR couldn't read this PDF."));
      setState("idle");
    }
  }, [file, lang, output, dpi]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [canProcess, process]);

  if (state === "done") return (
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
                {output === "searchable_pdf" ? <>Searchable <span className="italic text-accent">PDF</span> created.</> : <><span className="italic text-accent">Text</span> extracted.</>}
              </h2>
            </div>
          </div>
        </div>
      </div>
      {extractedText && (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="font-medium flex items-center justify-between px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
            <span>Extracted text · {extractedText.length.toLocaleString()} chars</span>
            <button onClick={() => navigator.clipboard.writeText(extractedText)} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors">
              Copy
            </button>
          </div>
          <pre className="font-mono text-[13px] text-foreground whitespace-pre-wrap max-h-80 overflow-y-auto p-4">{extractedText}</pre>
        </div>
      )}
      <button
        onClick={() => { setFile(null); setState("idle"); setExtractedText(""); }}
        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
      >
        OCR another file
      </button>
    </div>
  );

  return (
    <div className="space-y-4">
      {!file ? (
        <div
          onDragOver={e => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) pick(e.dataTransfer.files); }}
          onClick={() => ref.current?.click()}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
          role="button"
          tabIndex={0}
          aria-label="Upload file"
          className={cn(
            "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
            drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
          )}
        >
          <CornerMarks />
          <input ref={ref} type="file" accept=".pdf" className="hidden" onChange={e => { e.target.files && pick(e.target.files); e.target.value = ""; }} />
          <div className={cn(
            "h-12 w-12 rounded-xl flex items-center justify-center transition-colors",
            drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15"
          )}>
            <Upload size={20} className="text-accent" strokeWidth={1.75} />
          </div>
          <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">Select a scanned PDF</p>
          <p className="font-medium text-[11.5px] text-muted-foreground">{langs.length}+ languages supported · Tesseract on-server</p>
        </div>
      ) : (
        <>
          {/* File card */}
          <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3">
            <div className="h-10 w-10 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
              <FileText size={16} className="text-accent" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[14px] font-medium text-foreground truncate">{file.name}</p>
              <p className="font-medium text-[11.5px] text-muted-foreground mt-0.5">{file.size}</p>
            </div>
            <button
              onClick={() => setFile(null)}
              className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
              aria-label="Remove file"
            >
              <X size={13} />
            </button>
          </div>

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

          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
              <AlertCircle size={13} className="shrink-0" />{error}
            </div>
          )}

          <div className="flex items-center gap-3 flex-wrap">
            <button onClick={process} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
              {state === "processing"
                ? <><Loader2 size={13} className="animate-spin" /> Extracting text…</>
                : <>Run OCR</>}
            </button>
            {canProcess && (
              <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
            )}
          </div>
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
