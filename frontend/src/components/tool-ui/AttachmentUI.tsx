/**
 * AttachmentUI — embed any file into a PDF as a binary attachment.
 * Two file sheets feed one embedded-file result.
 */
import { useState, useEffect, useCallback } from "react";
import { Download, Paperclip } from "lucide-react";
import { friendlyError } from "@/lib/utils";
import { downloadBlob, formatFileSize, postFormData } from "@/lib/api";
import { emitToolRun } from "@/lib/toolRun";
import { FileIntake, StudioActionBar, StudioLayout, StudioFile, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { ToolWhere } from "@/skins/experience/ToolWhere";

export function AttachmentUI() {
    const [pdfFile, setPdfFile] = useState<File | null>(null);
    const [attachFile, setAttachFile] = useState<File | null>(null);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);

    const process = useCallback(async () => {
        if (!pdfFile || !attachFile) return;
        setStatus("processing"); setError(null);
        try {
            const res = await postFormData("/add-attachment", () => {
                const fd = new FormData();
                fd.append("file", pdfFile);
                fd.append("attachment", attachFile);
                return fd;
            });
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
            downloadBlob(blob, pdfFile.name.replace(/\.pdf$/i, "_with_attachment.pdf"));
            emitToolRun({ outcome: "success", files: 1 });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Attachment failed";
            setError(friendlyError(msg, "Couldn't attach that file to the PDF."));
            setStatus("idle");
            emitToolRun({ outcome: "error", files: 1 }, e);
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

    if (status === "done") return <StudioResult title="A little extra, included." detail={`${attachFile?.name} is attached to your PDF.`}>
        <StudioFile name={pdfFile?.name.replace(/\.pdf$/i, "_with_attachment.pdf") || "Your PDF"} status="done" detail={resultBlob ? formatFileSize(resultBlob.size) : undefined} />
        <div className="ts-actions"><button className="ts-primary-button" onClick={() => resultBlob && pdfFile && downloadBlob(resultBlob, pdfFile.name.replace(/\.pdf$/i, "_with_attachment.pdf"))}><Download size={16} /> Download again</button><button className="ts-text-button" onClick={() => { setPdfFile(null); setAttachFile(null); setStatus("idle"); setResultBlob(null); }}>Attach to another</button></div>
    </StudioResult>;
    return <StudioLayout options={<><div><p className="ts-eyebrow">Keep the whole story together</p><h2>Add an attachment</h2><p>The attachment becomes a file inside your PDF. It can be opened in a PDF reader that supports attachments.</p></div></>} action={<StudioActionBar ready={!!pdfFile && !!attachFile} count={pdfFile && attachFile ? "1 PDF and 1 attachment" : undefined}><button className="ts-primary-button" onClick={process} disabled={!pdfFile || !attachFile || status === "processing"}><Paperclip size={16} /> Embed attachment</button></StudioActionBar>}>
        <div className="ts-paired-inputs"><section><p className="ts-eyebrow">The document</p>{pdfFile ? <StudioFile name={pdfFile.name} detail={formatFileSize(pdfFile.size)} onRemove={status !== "processing" ? () => setPdfFile(null) : undefined} removeLabel="Remove" /> : <FileIntake accepts=".pdf" label="Choose Main PDF" title="Your main PDF" detail="The document that will hold the attachment." disabled={status === "processing"} onFiles={files => setPdfFile(files[0] || null)} />}</section><section><p className="ts-eyebrow">Something to go with it</p>{attachFile ? <StudioFile name={attachFile.name} detail={formatFileSize(attachFile.size)} onRemove={status !== "processing" ? () => setAttachFile(null) : undefined} removeLabel="Remove" /> : <FileIntake accepts="*" label="Choose Attachment" title="The extra file" detail="An image, document, or any supporting file." disabled={status === "processing"} onFiles={files => setAttachFile(files[0] || null)} />}</section></div>
        <ToolWhere className="ts-paired-where" />
        {status === "processing" && <StudioProgress label="Adding the finishing touch" detail="Embedding your attachment inside the PDF." />}{error && <div className="ts-error" role="alert">{error}</div>}
    </StudioLayout>;
}
