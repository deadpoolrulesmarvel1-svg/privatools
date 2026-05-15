import { useState, useRef } from "react";
import { Upload, Download, Loader2, AlertCircle, FileText, X, Highlighter, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";

type ColorOption = { id: string; label: string; swatch: string };

const COLORS: ColorOption[] = [
    { id: "yellow", label: "Yellow", swatch: "#ffea00" },
    { id: "green",  label: "Green",  swatch: "#8cee8c" },
    { id: "pink",   label: "Pink",   swatch: "#ffa1c7" },
    { id: "blue",   label: "Blue",   swatch: "#8cc7ff" },
    { id: "orange", label: "Orange", swatch: "#ffa800" },
];

export function HighlightUI() {
    const [file, setFile] = useState<File | null>(null);
    const [query, setQuery] = useState("");
    const [color, setColor] = useState<string>("yellow");
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [hits, setHits] = useState<number | null>(null);
    const [drag, setDrag] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);

    const canProcess = !!file && query.trim().length > 0 && state !== "processing";

    const onPick = (f: FileList | null) => {
        if (!f || !f[0]) return;
        setFile(f[0]);
        setState("idle");
        setError(null);
        setHits(null);
    };

    const process = async () => {
        if (!file || !query.trim()) return;
        setState("processing");
        setError(null);
        try {
            const res = await uploadFile("/highlight", file, {
                query: query.trim(),
                color,
                case_sensitive: caseSensitive,
            });
            const hitHeader = res.headers.get("X-Highlight-Hits");
            const blob = await res.blob();
            const baseName = file.name.replace(/\.pdf$/i, "");
            downloadBlob(blob, `${baseName}_highlighted.pdf`);
            setHits(hitHeader ? parseInt(hitHeader, 10) : null);
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Highlighting failed";
            setError(msg);
            setState("idle");
        }
    };

    if (state === "done") {
        return (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
                <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
                <h2 className="text-lg font-bold text-foreground mb-1">Done!</h2>
                <p className="text-sm text-muted-foreground mb-6">
                    {hits !== null ? <>Highlighted <span className="font-bold text-foreground">{hits}</span> match{hits === 1 ? "" : "es"} of <span className="font-mono">"{query}"</span>.</> : "Highlighted PDF downloaded."}
                </p>
                <div className="flex justify-center gap-2">
                    <Button variant="outline" className="border-border text-muted-foreground" onClick={() => { setState("idle"); setHits(null); }}>
                        Highlight again
                    </Button>
                    <Button variant="ghost" className="text-muted-foreground" onClick={() => { setFile(null); setQuery(""); setState("idle"); setHits(null); }}>
                        Start over
                    </Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* File */}
            {!file ? (
                <div
                    onDragOver={e => { e.preventDefault(); setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={e => { e.preventDefault(); setDrag(false); onPick(e.dataTransfer.files); }}
                    onClick={() => inputRef.current?.click()}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
                    role="button"
                    tabIndex={0}
                    aria-label="Upload PDF for highlighting"
                    className={cn(
                        "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-14 px-6 text-center",
                        drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 hover:bg-secondary/40 bg-secondary/20"
                    )}
                >
                    <input ref={inputRef} type="file" accept=".pdf" className="hidden" onChange={e => onPick(e.target.files)} />
                    <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", drag ? "bg-accent/20" : "bg-secondary")}>
                        <Upload size={22} className={drag ? "text-primary" : "text-muted-foreground"} strokeWidth={1.5} />
                    </div>
                    <p className="text-sm font-semibold text-foreground">Select a PDF to highlight</p>
                    <p className="text-xs text-muted-foreground">PDF · 100 MB max</p>
                </div>
            ) : (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-card/60 px-4 py-3">
                    <FileText size={18} className="text-primary shrink-0" />
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                    </div>
                    <button
                        onClick={() => { setFile(null); setHits(null); setError(null); }}
                        className="text-muted-foreground hover:text-foreground"
                        aria-label="Remove file"
                    >
                        <X size={16} />
                    </button>
                </div>
            )}

            {/* Query + options */}
            <div className="rounded-xl border border-border bg-card/40 p-5 space-y-4">
                <div>
                    <label htmlFor="highlight-query" className="text-sm font-semibold text-foreground block mb-2">
                        Word or phrase to highlight
                    </label>
                    <input
                        id="highlight-query"
                        type="text"
                        value={query}
                        onChange={e => setQuery(e.target.value)}
                        placeholder='e.g. "confidential" or "terms and conditions"'
                        className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/80 focus:outline-none focus:border-primary"
                        maxLength={500}
                    />
                </div>

                <div>
                    <p className="text-sm font-semibold text-foreground mb-2">Highlight color</p>
                    <div className="flex flex-wrap gap-2">
                        {COLORS.map(c => (
                            <button
                                key={c.id}
                                type="button"
                                onClick={() => setColor(c.id)}
                                aria-label={c.label}
                                aria-pressed={color === c.id}
                                title={c.label}
                                className={cn(
                                    "h-9 w-9 rounded-lg border-2 transition-all",
                                    color === c.id ? "border-foreground/60 ring-2 ring-accent/40" : "border-border hover:border-foreground/30"
                                )}
                                style={{ backgroundColor: c.swatch }}
                            />
                        ))}
                    </div>
                </div>

                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                    <input
                        type="checkbox"
                        checked={caseSensitive}
                        onChange={e => setCaseSensitive(e.target.checked)}
                        className="rounded border-border"
                    />
                    Case-sensitive match
                </label>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle size={15} className="shrink-0" />{error}
                </div>
            )}

            <div className="flex gap-3 pt-1">
                <Button onClick={process} disabled={!canProcess} className="glow-primary">
                    {state === "processing"
                        ? <><Loader2 size={15} className="animate-spin mr-1.5" />Highlighting…</>
                        : <><Highlighter size={15} className="mr-1.5" />Highlight every match</>}
                </Button>
                {file && (
                    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => { setFile(null); setQuery(""); setError(null); }}>
                        Clear
                    </Button>
                )}
            </div>
        </div>
    );
}
