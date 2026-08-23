/**
 * BatesRemoveUI — strip Bates stamps back off a production set.
 *
 * The counterpart to BatesUI. Adobe ships this and nobody else free does.
 *
 * Removal is redaction, not an overlay: the point of taking a production
 * number off a document is that it is no longer in the file, so covering it
 * would defeat the exercise. Matching is confined to the page margins and to
 * text shaped like a Bates number, which is why the prefix/suffix hints matter
 * — supplying them turns a shape match into an exact one.
 */
import { useState, useEffect, useCallback } from "react";
import { Loader2, AlertCircle, CheckCircle2, Eraser, RotateCcw, Info } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile, downloadBlob } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";

export function BatesRemoveUI() {
    const [file, setFile] = useState<File | null>(null);
    const [prefix, setPrefix] = useState("");
    const [suffix, setSuffix] = useState("");
    const [digits, setDigits] = useState(6);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [removed, setRemoved] = useState<number | null>(null);

    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const res = await uploadFile("/bates-remove", file, { prefix, suffix, digits });
            const count = Number(res.headers.get("X-Bates-Removed") ?? "0");
            setRemoved(Number.isFinite(count) ? count : 0);
            downloadBlob(await res.blob(), file.name.replace(/\.pdf$/i, "") + "_bates_removed.pdf");
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't remove the Bates numbers."));
            setStatus("idle");
        }
    }, [file, prefix, suffix, digits]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && file && status === "idle") {
                e.preventDefault(); void process();
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [file, status, process]);

    const reset = () => { setFile(null); setStatus("idle"); setRemoved(null); setError(null); };

    if (status === "done") {
        const nothingMatched = removed === 0;
        return (
            <div className={cn(
                "rounded-2xl border overflow-hidden animate-fade-up",
                nothingMatched ? "border-copper/40 bg-copper-soft/40" : "border-accent/30 bg-accent/[0.05]",
            )}>
                <div className="p-7">
                    <div className="flex items-start gap-5">
                        <div className={cn(
                            "h-14 w-14 rounded-2xl border flex items-center justify-center shrink-0 animate-success-pop",
                            nothingMatched ? "bg-copper/15 border-copper/35" : "bg-accent/15 border-accent/35",
                        )}>
                            {nothingMatched
                                ? <Info size={24} className="text-copper" strokeWidth={1.75} />
                                : <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">{nothingMatched ? "Nothing matched" : "Bates removed"}</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight">
                                {nothingMatched
                                    ? "No Bates numbers found"
                                    : <><span className="italic text-accent">{removed}</span> stamp{removed === 1 ? "" : "s"} removed</>}
                            </h2>
                            <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1.5">
                                {nothingMatched
                                    ? "Nothing in the page margins matched the pattern. Try giving the prefix or suffix the stamps actually use."
                                    : "Redacted, not covered — the text is gone from the file."}
                            </p>
                            <div className="mt-5">
                                <button onClick={reset} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors">
                                    <RotateCcw size={12} /> Remove from another
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <FileUploadZone
                file={file}
                onFileSelect={setFile}
                onClear={reset}
                accept=".pdf"
                label="Drop PDF to remove Bates numbers"
                hint="Only text in the page margins is touched · up to 500 MB"
            />

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive" role="alert">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                    What the stamps look like <span className="text-muted-foreground">— optional</span>
                </div>
                <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                        <label htmlFor="rm-prefix" className="font-medium text-[11px] text-muted-foreground">Prefix</label>
                        <input
                            id="rm-prefix" value={prefix} onChange={e => setPrefix(e.target.value)}
                            placeholder="DOC-" maxLength={32}
                            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground placeholder:text-muted-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                        />
                    </div>
                    <div>
                        <label htmlFor="rm-suffix" className="font-medium text-[11px] text-muted-foreground">Suffix</label>
                        <input
                            id="rm-suffix" value={suffix} onChange={e => setSuffix(e.target.value)}
                            placeholder="-CONF" maxLength={32}
                            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground placeholder:text-muted-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                        />
                    </div>
                    <div>
                        <label htmlFor="rm-digits" className="font-medium text-[11px] text-muted-foreground">Digits</label>
                        <input
                            id="rm-digits" type="number" inputMode="numeric" value={digits} min={1} max={10}
                            onChange={e => setDigits(Math.max(1, Math.min(10, parseInt(e.target.value) || 6)))}
                            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-[14px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                        />
                    </div>
                </div>
                <p className="px-4 pb-3 text-[12px] text-muted-foreground leading-relaxed">
                    Leave these blank and anything in the margins shaped like a Bates number is
                    removed. Filling them in makes the match exact, which is safer on documents
                    that carry other numbering in the header or footer.
                </p>
            </div>

            <div className="flex items-center gap-3">
                <button onClick={process} disabled={!file || status === "processing"} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                    {status === "processing"
                        ? <><Loader2 size={13} className="animate-spin" /> Removing…</>
                        : <><Eraser size={13} /> Remove Bates numbers</>}
                </button>
                {file && status === "idle" && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
            </div>
        </div>
    );
}
