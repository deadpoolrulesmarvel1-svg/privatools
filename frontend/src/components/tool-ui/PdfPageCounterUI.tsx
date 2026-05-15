/**
 * PDF Page Counter — uploads N PDFs, displays per-file count + total.
 * Backend returns JSON; nothing is downloaded.
 */
import { useState, useRef } from "react";
import { FileText, Upload, Loader2, AlertCircle, RotateCcw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFiles, formatFileSize } from "@/lib/api";

interface FileItem { id: string; name: string; size: string; file: File }
interface CountResult { filename: string; pages: number }

export function PdfPageCounterUI() {
    const [items, setItems] = useState<FileItem[]>([]);
    const [results, setResults] = useState<CountResult[] | null>(null);
    const [total, setTotal] = useState<number>(0);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const add = (fl: FileList) => {
        setItems(prev => [
            ...prev,
            ...Array.from(fl).map(f => ({
                id: Math.random().toString(36).slice(2),
                name: f.name,
                size: formatFileSize(f.size),
                file: f,
            })),
        ]);
        setResults(null);
        setState("idle");
        setError(null);
    };

    const remove = (id: string) => setItems(p => p.filter(f => f.id !== id));

    const process = async () => {
        if (!items.length) return;
        setState("processing");
        setError(null);
        try {
            const res = await uploadFiles("/api/pdf-page-counter", items.map(i => i.file));
            const data = await res.json();
            setResults(data.files || []);
            setTotal(data.total_pages ?? 0);
            setState("done");
        } catch (e) {
            setError(e instanceof Error ? e.message : "Failed to read PDFs");
            setState("idle");
        }
    };

    const reset = () => { setItems([]); setResults(null); setTotal(0); setState("idle"); setError(null); };

    return (
        <div className="space-y-4">
            <button
                type="button"
                onClick={() => ref.current?.click()}
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) add(e.dataTransfer.files); }}
                className={cn(
                    "w-full rounded-2xl border-2 border-dashed p-8 sm:p-12 text-center transition-colors",
                    drag ? "border-accent bg-accent/5" : "border-border/60 hover:border-accent/40 bg-card/40"
                )}
            >
                <Upload className="mx-auto mb-3 text-muted-foreground" size={28} strokeWidth={1.6} />
                <p className="text-sm font-semibold text-foreground">
                    {items.length ? "Add more PDFs" : "Choose PDFs to count"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">Drag & drop, or click. Up to 100 files.</p>
                <input
                    ref={ref}
                    type="file"
                    accept=".pdf,application/pdf"
                    multiple
                    className="hidden"
                    onChange={e => e.target.files && add(e.target.files)}
                />
            </button>

            {items.length > 0 && (
                <ul className="space-y-2">
                    {items.map(it => (
                        <li key={it.id} className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
                            <FileText size={16} className="text-muted-foreground shrink-0" />
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-medium text-foreground">{it.name}</p>
                                <p className="text-[11px] text-muted-foreground">{it.size}</p>
                            </div>
                            <button
                                type="button"
                                onClick={() => remove(it.id)}
                                aria-label="Remove file"
                                className="rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground"
                            >
                                <X size={14} />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            {error && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/5 p-3 text-[13px] text-rose-700 dark:text-rose-300">
                    <AlertCircle size={14} className="mt-0.5 shrink-0" />
                    <span>{error}</span>
                </div>
            )}

            {results && (
                <div className="rounded-2xl border border-accent/30 bg-accent/[0.04] overflow-hidden">
                    <div className="px-5 pt-5 pb-3 flex items-baseline justify-between">
                        <p className="text-[11px] font-semibold uppercase tracking-widest text-accent">Total pages</p>
                        <p className="text-3xl font-bold tracking-tight text-foreground tabular-nums">{total.toLocaleString()}</p>
                    </div>
                    <div className="border-t border-accent/15">
                        <table className="w-full text-[13px]">
                            <thead className="bg-card/40">
                                <tr>
                                    <th className="text-left px-5 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">File</th>
                                    <th className="text-right px-5 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Pages</th>
                                </tr>
                            </thead>
                            <tbody>
                                {results.map((r, i) => (
                                    <tr key={i} className="border-t border-accent/10">
                                        <td className="px-5 py-2.5 truncate max-w-[1px] text-foreground/80">{r.filename}</td>
                                        <td className="px-5 py-2.5 text-right tabular-nums font-medium text-foreground">
                                            {r.pages < 0 ? <span className="text-rose-500">invalid</span> : r.pages.toLocaleString()}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            <div className="flex items-center justify-between gap-3">
                {results ? (
                    <Button onClick={reset} variant="outline" className="gap-1.5">
                        <RotateCcw size={14} /> Start over
                    </Button>
                ) : <span />}
                <Button
                    onClick={process}
                    disabled={!items.length || state === "processing"}
                    className="gap-1.5"
                >
                    {state === "processing" ? <><Loader2 size={14} className="animate-spin" /> Counting…</> : "Count pages"}
                </Button>
            </div>
        </div>
    );
}
