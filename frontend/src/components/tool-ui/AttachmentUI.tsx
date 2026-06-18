/**
 * AttachmentUI — embed any file into a PDF as a binary attachment.
 * Workshop: dual-slot pickup (PDF + payload) + outcome panel.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { Download, Loader2, AlertCircle, Paperclip, FileText, X, CheckCircle2, RotateCcw } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { downloadBlob, formatFileSize } from "@/lib/api";

const API_BASE = "/api";

export function AttachmentUI() {
    const [pdfFile, setPdfFile] = useState<File | null>(null);
    const [attachFile, setAttachFile] = useState<File | null>(null);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [dragPdf, setDragPdf] = useState(false);
    const [dragAtt, setDragAtt] = useState(false);
    const pdfRef = useRef<HTMLInputElement>(null);
    const attRef = useRef<HTMLInputElement>(null);

    const process = useCallback(async () => {
        if (!pdfFile || !attachFile) return;
        setStatus("processing"); setError(null);
        try {
            const fd = new FormData();
            fd.append("file", pdfFile);
            fd.append("attachment", attachFile);
            const res = await fetch(`${API_BASE}/add-attachment`, { method: "POST", body: fd });
            if (!res.ok) {
                const body = await res.json().catch(() => ({ detail: "Failed" }));
                throw new Error(body.detail || `Request failed (${res.status})`);
            }
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
            downloadBlob(blob, pdfFile.name.replace(/\.pdf$/i, "_with_attachment.pdf"));
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Attachment failed";
            setError(friendlyError(msg, "Couldn't attach that file to the PDF."));
            setStatus("idle");
        }
    }, [pdfFile, attachFile]);

    // Cmd+Enter to submit
    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && pdfFile && attachFile && status !== "processing") {
                e.preventDefault(); process();
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [pdfFile, attachFile, status, process]);

    if (status === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <Paperclip size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Embedded</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{attachFile?.name}</span> attached
                        </h2>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <button onClick={() => resultBlob && pdfFile && downloadBlob(resultBlob, pdfFile.name.replace(/\.pdf$/i, "_with_attachment.pdf"))} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                <Download size={13} /> Download again
                            </button>
                            <button
                                onClick={() => { setPdfFile(null); setAttachFile(null); setStatus("idle"); setResultBlob(null); }}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                            >
                                <RotateCcw size={12} /> Attach to another
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    const Slot = ({
        label, hint, icon: Icon, file, setFile, ref, drag, setDrag, accept, idx,
    }: {
        label: string; hint: string; icon: typeof FileText; file: File | null; setFile: (f: File | null) => void;
        ref: React.RefObject<HTMLInputElement>; drag: boolean; setDrag: (b: boolean) => void; accept: string; idx: 1 | 2;
    }) => (
        <div>
            <div className="flex items-center justify-between mb-1.5 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                <span><span className="text-accent">§{String(idx).padStart(2, "0")}</span> {label}</span>
                <span className="text-muted-foreground/60">{hint}</span>
            </div>
            {!file ? (
                <div
                    onDragOver={e => { e.preventDefault(); setDrag(true); }}
                    onDragLeave={() => setDrag(false)}
                    onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); }}
                    onClick={() => ref.current?.click()}
                    role="button" tabIndex={0}
                    onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                    className={cn(
                        "relative flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed cursor-pointer transition-colors py-8 text-center group",
                        drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                    )}
                >
                    <input ref={ref} type="file" accept={accept} className="hidden" onChange={e => { e.target.files?.[0] && setFile(e.target.files[0]); e.target.value = ""; }} />
                    <div className={cn("h-10 w-10 rounded-lg flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                        <Icon size={16} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <p className="font-display text-[14px] font-semibold text-foreground">Drop file</p>
                </div>
            ) : (
                <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3">
                    <div className="h-9 w-9 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                        <Icon size={14} className="text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-medium text-foreground truncate">{file.name}</p>
                        <p className="font-mono text-[10px] tracking-[0.06em] uppercase text-muted-foreground mt-0.5">{formatFileSize(file.size)}</p>
                    </div>
                    <button onClick={() => setFile(null)} className="h-7 w-7 coarse:h-11 coarse:w-11 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60" aria-label="Remove">
                        <X size={13} />
                    </button>
                </div>
            )}
        </div>
    );

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Slot label="Main PDF" hint="document" icon={FileText} file={pdfFile} setFile={setPdfFile} ref={pdfRef} drag={dragPdf} setDrag={setDragPdf} accept=".pdf" idx={1} />
                <Slot label="Attachment" hint="any file" icon={Paperclip} file={attachFile} setFile={setAttachFile} ref={attRef} drag={dragAtt} setDrag={setDragAtt} accept="*" idx={2} />
            </div>

            {/* Pre-embed preview — shown once both files are picked */}
            {pdfFile && attachFile && (
                <div className="rounded-xl border border-border bg-card overflow-hidden animate-fade-in">
                    <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                        <span><span className="text-accent">§</span> Attachment manifest</span>
                        <span>{formatFileSize(pdfFile.size + attachFile.size)} total</span>
                    </div>
                    <div className="p-3 space-y-1.5">
                        <div className="flex items-center gap-2 text-[12.5px] text-foreground">
                            <Paperclip size={11} className="text-accent shrink-0" />
                            <span className="font-mono text-[11px] text-muted-foreground/85 truncate flex-1">{attachFile.name}</span>
                            <span className="font-mono text-[10.5px] text-muted-foreground shrink-0">{formatFileSize(attachFile.size)}</span>
                        </div>
                        <p className="font-mono text-[10px] tracking-[0.04em] uppercase text-muted-foreground/75 pl-5">
                            Will embed inside <span className="text-accent">{pdfFile.name}</span> as a downloadable annex
                        </p>
                    </div>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            <div className="flex items-center gap-3">
                <button onClick={process} disabled={!pdfFile || !attachFile || status === "processing"} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                    {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Embedding…</> : <><Paperclip size={13} /> Embed attachment</>}
                </button>
                {pdfFile && attachFile && status === "idle" && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/80 bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
            </div>
        </div>
    );
}

function CornerMarks() {
    const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}><span className="absolute top-0 left-0 h-px w-3 bg-accent/70" /><span className="absolute top-0 left-0 w-px h-3 bg-accent/70" /></span>
            <span className={`${cls} -top-1 -right-1`}><span className="absolute top-0 right-0 h-px w-3 bg-accent/70" /><span className="absolute top-0 right-0 w-px h-3 bg-accent/70" /></span>
            <span className={`${cls} -bottom-1 -left-1`}><span className="absolute bottom-0 left-0 h-px w-3 bg-accent/70" /><span className="absolute bottom-0 left-0 w-px h-3 bg-accent/70" /></span>
            <span className={`${cls} -bottom-1 -right-1`}><span className="absolute bottom-0 right-0 h-px w-3 bg-accent/70" /><span className="absolute bottom-0 right-0 w-px h-3 bg-accent/70" /></span>
        </>
    );
}
