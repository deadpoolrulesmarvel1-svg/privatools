import { useState, useRef } from "react";
import { Upload, Copy, Download, Loader2, X, FileText, AlertCircle, CheckCircle2, Hash, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFileGetJson, formatFileSize } from "@/lib/api";

interface ExtractedResult {
    text: string;
    pages?: number;
}

export function PdfToTextUI() {
    const [file, setFile] = useState<{ name: string; size: string; raw: File } | null>(null);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<ExtractedResult | null>(null);
    const [copied, setCopied] = useState(false);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const pick = (fl: FileList) => {
        const f = fl[0];
        setFile({ name: f.name, size: formatFileSize(f.size), raw: f });
        setState("idle");
        setError(null);
        setResult(null);
    };

    const process = async () => {
        if (!file) return;
        setState("processing");
        setError(null);
        try {
            const data = await uploadFileGetJson<ExtractedResult>("/pdf-to-text", file.raw);
            setResult(data);
            setState("done");
        } catch (e: any) {
            setError(e.message || "Text extraction failed");
            setState("idle");
        }
    };

    const handleCopy = async () => {
        if (!result) return;
        await navigator.clipboard.writeText(result.text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleDownload = () => {
        if (!result) return;
        const blob = new Blob([result.text], { type: "text/plain" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "extracted_text.txt";
        document.body.appendChild(a);
        a.click();
        setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
    };

    const wordCount = result?.text ? result.text.split(/\s+/).filter(Boolean).length : 0;
    const charCount = result?.text ? result.text.length : 0;

    if (state === "done" && result) return (
        <div className="space-y-4">
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6">
                <div className="flex items-center gap-3 mb-4">
                    <CheckCircle2 size={22} className="text-emerald-400" strokeWidth={1.5} />
                    <h2 className="text-lg font-bold text-foreground">Text Extracted!</h2>
                </div>

                {/* Stats */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
                    <div className="rounded-xl border border-border bg-card p-3 text-center">
                        <Type size={14} className="mx-auto mb-1 text-muted-foreground" />
                        <p className="text-lg font-bold text-foreground">{wordCount.toLocaleString()}</p>
                        <p className="text-[11px] text-muted-foreground">Words</p>
                    </div>
                    <div className="rounded-xl border border-border bg-card p-3 text-center">
                        <Hash size={14} className="mx-auto mb-1 text-muted-foreground" />
                        <p className="text-lg font-bold text-foreground">{charCount.toLocaleString()}</p>
                        <p className="text-[11px] text-muted-foreground">Characters</p>
                    </div>
                    {result.pages && (
                        <div className="rounded-xl border border-border bg-card p-3 text-center">
                            <FileText size={14} className="mx-auto mb-1 text-muted-foreground" />
                            <p className="text-lg font-bold text-foreground">{result.pages}</p>
                            <p className="text-[11px] text-muted-foreground">Pages</p>
                        </div>
                    )}
                </div>

                {/* Text area */}
                <div className="rounded-xl border border-border bg-background overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-card">
                        <span className="text-xs font-medium text-muted-foreground">Extracted Text</span>
                        <button onClick={handleCopy}
                            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                            {copied ? <><CheckCircle2 size={12} className="text-emerald-400" /> Copied!</> : <><Copy size={12} /> Copy all</>}
                        </button>
                    </div>
                    <textarea
                        readOnly
                        value={result.text}
                        className="w-full h-64 px-4 py-3 text-sm text-foreground bg-transparent resize-y font-mono leading-relaxed focus:outline-none"
                    />
                </div>

                {/* Actions */}
                <div className="flex justify-center gap-3 flex-wrap mt-4">
                    <Button className="glow-primary" onClick={handleDownload}><Download size={15} />Download as .txt</Button>
                    <Button variant="outline" onClick={handleCopy}><Copy size={15} />{copied ? "Copied!" : "Copy to Clipboard"}</Button>
                    <Button variant="outline" className="border-border text-muted-foreground"
                        onClick={() => { setFile(null); setState("idle"); setResult(null); }}>Extract another</Button>
                </div>
            </div>
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
                    <p className="text-sm font-semibold text-foreground">Select a PDF to extract text from</p>
                    <p className="text-xs text-muted-foreground">All readable text will be extracted and displayed</p>
                </div>
            ) : (
                <>
                    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary"><FileText size={14} className="text-muted-foreground" /></div>
                        <div className="flex-1 min-w-0"><p className="text-sm font-medium text-foreground truncate">{file.name}</p><p className="text-xs text-muted-foreground">{file.size}</p></div>
                        <button onClick={() => setFile(null)} className="text-muted-foreground hover:text-foreground"><X size={15} /></button>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                            <AlertCircle size={15} className="shrink-0" />{error}
                        </div>
                    )}

                    <Button onClick={process} disabled={state === "processing"} className="glow-primary">
                        {state === "processing" ? <><Loader2 size={15} className="animate-spin" />Extracting…</> : "Extract Text"}
                    </Button>
                </>
            )}
        </div>
    );
}
