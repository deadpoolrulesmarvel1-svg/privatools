import { useState, useRef } from "react";
import { Upload, Loader2, CheckCircle2, X, FileText, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";

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

export function OcrUI() {
  const [file, setFile] = useState<{ name: string; size: string; raw: File } | null>(null);
  const [lang, setLang] = useState("eng");
  const [dpi, setDpi] = useState<number>(200);
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

  const process = async () => {
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
    } catch (e: any) { setError(e.message || "OCR failed"); setState("idle"); }
  };

  if (state === "done") return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 text-center">
        <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
        <h2 className="text-lg font-bold text-foreground mb-1">
          {output === "searchable_pdf" ? "Searchable PDF created!" : "Text extracted!"}
        </h2>
      </div>
      {extractedText && (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-muted-foreground">Extracted text</p>
            <button onClick={() => navigator.clipboard.writeText(extractedText)} className="text-xs text-primary hover:underline">Copy</button>
          </div>
          <pre className="text-sm text-foreground whitespace-pre-wrap max-h-80 overflow-y-auto bg-secondary/30 rounded-lg p-3">{extractedText}</pre>
        </div>
      )}
      <Button variant="outline" className="border-border text-muted-foreground" onClick={() => { setFile(null); setState("idle"); setExtractedText(""); }}>OCR another file</Button>
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
          <p className="text-sm font-semibold text-foreground">Select a scanned PDF</p>
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
            <div>
              <label className="text-sm font-semibold text-foreground" htmlFor="ocr-lang">Language</label>
              <select id="ocr-lang" value={lang} onChange={e => setLang(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-foreground outline-none">
                {langs.map(l => (
                  <option key={l.id} value={l.id}>
                    {l.label}{INSTALLED_PACKS.has(l.id) ? "" : " (pack not installed)"}
                  </option>
                ))}
              </select>
              {!INSTALLED_PACKS.has(lang) && (
                <p className="mt-1.5 text-[11px] text-yellow-500">
                  This language pack isn't installed on the public demo. To use it, self-host
                  PrivaTools and add the matching <code className="font-mono">tesseract-ocr-*</code> apt package.
                </p>
              )}
            </div>

            <div>
              <label className="text-sm font-semibold text-foreground">Quality (DPI)</label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mt-1">
                {DPI_PRESETS.map(p => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setDpi(p.id)}
                    aria-pressed={dpi === p.id}
                    className={cn(
                      "rounded-lg border p-2 text-left transition-all",
                      dpi === p.id
                        ? "border-accent bg-accent/5"
                        : "border-border hover:border-border/70 hover:bg-secondary/40"
                    )}
                  >
                    <p className="text-xs font-medium text-foreground">{p.label}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">{p.desc}</p>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="text-sm font-semibold text-foreground">Output</label>
              <div className="flex gap-2 mt-1">
                {(["json", "txt", "searchable_pdf"] as const).map(o => (
                  <button key={o} onClick={() => setOutput(o)}
                    className={cn("flex-1 rounded-lg border py-2 text-xs font-medium transition-all",
                      output === o ? "border-accent bg-accent/10 text-primary" : "border-border text-muted-foreground hover:bg-secondary/40")}>
                    {o === "json" ? "Show text" : o === "txt" ? "Download .txt" : "Download searchable PDF"}
                  </button>
                ))}
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              Tip: OCR runs in parallel across all CPU cores — expect ~0.5s/page on a balanced server.
              Higher DPI gives better accuracy for blurry scans but takes longer.
            </p>
          </div>
          {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}
          <Button onClick={process} disabled={state === "processing"} className="glow-primary">
            {state === "processing" ? <><Loader2 size={15} className="animate-spin" />Extracting text…</> : "Run OCR"}
          </Button>
        </>
      )}
    </div>
  );
}
