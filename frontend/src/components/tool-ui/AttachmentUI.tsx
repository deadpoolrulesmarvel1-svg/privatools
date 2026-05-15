import { useState, useRef } from "react";
import { Upload, Download, Loader2, AlertCircle, Paperclip, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
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

    const process = async () => {
        if (!pdfFile || !attachFile) return;
        setStatus("processing");
        setError(null);
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
        } catch (e: any) {
            setError(e.message || "Attachment failed");
            setStatus("idle");
        }
    };

    const handleDownload = () => {
        if (resultBlob) {
            const name = pdfFile ? pdfFile.name.replace(/\.pdf$/i, "_with_attachment.pdf") : "with_attachment.pdf";
            downloadBlob(resultBlob, name);
        }
    };

    if (status === "done") {
        return (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
                <Paperclip size={32} className="mx-auto mb-3 text-emerald-400" />
                <h2 className="text-lg font-bold text-foreground mb-1">Attachment Embedded!</h2>
                <p className="text-sm text-muted-foreground mb-6">
                    <span className="text-foreground font-medium">{attachFile?.name}</span> has been embedded in your PDF
                </p>
                <div className="flex justify-center gap-3 flex-wrap">
                    <Button className="glow-primary" onClick={handleDownload}><Download size={15} /> Download</Button>
                    <Button variant="outline" className="border-border text-muted-foreground" onClick={() => { setPdfFile(null); setAttachFile(null); setStatus("idle"); setResultBlob(null); }}>Process another</Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* PDF file drop */}
                <div
                    onDragOver={e => { e.preventDefault(); setDragPdf(true); }}
                    onDragLeave={() => setDragPdf(false)}
                    onDrop={e => { e.preventDefault(); setDragPdf(false); const f = e.dataTransfer.files[0]; if (f?.name.toLowerCase().endsWith(".pdf")) setPdfFile(f); }}
                    onClick={() => pdfRef.current?.click()}
                    className={cn("flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-8 px-4 text-center",
                        dragPdf ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 bg-secondary/20")}
                >
                    <input ref={pdfRef} type="file" accept=".pdf" className="hidden" onChange={e => e.target.files?.[0] && setPdfFile(e.target.files[0])} />
                    <FileText size={20} className={cn(pdfFile ? "text-primary" : "text-muted-foreground")} />
                    <p className="text-xs font-semibold text-foreground">{pdfFile ? pdfFile.name : "Main PDF file"}</p>
                    {pdfFile && <p className="text-[10px] text-muted-foreground">{formatFileSize(pdfFile.size)}</p>}
                    <p className="text-[10px] text-muted-foreground/80">PDF document</p>
                </div>

                {/* Attachment file drop */}
                <div
                    onDragOver={e => { e.preventDefault(); setDragAtt(true); }}
                    onDragLeave={() => setDragAtt(false)}
                    onDrop={e => { e.preventDefault(); setDragAtt(false); if (e.dataTransfer.files[0]) setAttachFile(e.dataTransfer.files[0]); }}
                    onClick={() => attRef.current?.click()}
                    className={cn("flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-8 px-4 text-center",
                        dragAtt ? "border-violet-400 bg-violet-400/5" : "border-border hover:border-violet-400/40 bg-secondary/20")}
                >
                    <input ref={attRef} type="file" className="hidden" onChange={e => e.target.files?.[0] && setAttachFile(e.target.files[0])} />
                    <Paperclip size={20} className={cn(attachFile ? "text-violet-400" : "text-muted-foreground")} />
                    <p className="text-xs font-semibold text-foreground">{attachFile ? attachFile.name : "File to attach"}</p>
                    {attachFile && <p className="text-[10px] text-muted-foreground">{formatFileSize(attachFile.size)}</p>}
                    <p className="text-[10px] text-muted-foreground/80">Any file type</p>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle size={15} className="shrink-0" />{error}
                </div>
            )}

            <Button onClick={process} disabled={!pdfFile || !attachFile || status === "processing"} className="w-full glow-primary">
                {status === "processing" ? <><Loader2 size={15} className="animate-spin" /> Embedding…</> : "Embed Attachment"}
            </Button>
        </div>
    );
}
