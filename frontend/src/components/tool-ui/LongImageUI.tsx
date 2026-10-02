import { useEffect, useState } from "react";
import { ArrowDownToLine } from "lucide-react";
import { FileIntake, StudioActionBar, StudioFile, StudioLayout, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { fileCount } from "@/skins/experience/file-format-label";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";
import { friendlyError } from "@/lib/utils";
import { consumeFileHandoffs } from "@/lib/file-handoff";
import { emitToolRun } from "@/lib/toolRun";
import { PdfPageStage } from "./pdf/PdfPageStage";

export function LongImageUI() {
    const [file, setFile] = useState<File | null>(null);
    const [format, setFormat] = useState("png");
    const [dpi, setDpi] = useState(100);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [result, setResult] = useState<{ blob: Blob; name: string } | null>(null);
    const [preview, setPreview] = useState("");
    useEffect(() => { if (!result) { setPreview(""); return; } const url = URL.createObjectURL(result.blob); setPreview(url); return () => URL.revokeObjectURL(url); }, [result]);
    useEffect(() => { let cancelled = false; queueMicrotask(() => { if (cancelled) return; void consumeFileHandoffs("pdf-to-long-image").then(files => { if (!cancelled && files[0]) setFile(files[0]); }); }); return () => { cancelled = true; }; }, []);
    async function process() {
        if (!file || busy) return;
        setBusy(true); setError("");
        try {
            const response = await uploadFile("/pdf-to-long-image", file, { format, dpi });
            const blob = await response.blob();
            const name = file.name.replace(/\.pdf$/i, "") + `_long.${format}`;
            setResult({ blob, name }); downloadBlob(blob, name); emitToolRun({ outcome: "success", files: 1 });
        } catch (cause) { setError(friendlyError(cause instanceof Error ? cause.message : "Conversion failed", "The long image could not be created.")); emitToolRun({ outcome: "error", files: 1 }, cause); }
        finally { setBusy(false); }
    }
    if (result) return <StudioResult title="One continuous image." detail="Every page appears from top to bottom in its original order." onReset={() => { setResult(null); setFile(null); }}>
        <StudioFile name={result.name} detail={formatFileSize(result.blob.size)} status="done" />
        {preview && <div className="pdf-long-result"><img src={preview} alt="The finished image with all PDF pages stacked vertically" /></div>}
        <button className="ts-primary-button" onClick={() => downloadBlob(result.blob, result.name)}><ArrowDownToLine size={17} /> Download again</button>
    </StudioResult>;
    return <StudioLayout options={<>
        <div><p className="ts-eyebrow">Made for a longer view</p><h2>Export settings</h2><p>Pages join vertically, ready to save or share as one image.</p></div>
        <div className="ts-setting"><label htmlFor="long-image-format">Image format</label><select id="long-image-format" value={format} disabled={busy} onChange={event => setFormat(event.target.value)}><option value="png">PNG · lossless</option><option value="jpg">JPG · smaller file</option></select></div>
        <div className="ts-setting"><label htmlFor="long-image-dpi">Resolution</label><select id="long-image-dpi" value={dpi} disabled={busy} onChange={event => setDpi(Number(event.target.value))}>{[36, 72, 100, 150, 200].map(value => <option value={value} key={value}>{value} dpi{value === 100 ? " · recommended" : ""}</option>)}</select><p>Higher resolution creates a larger image. Very long documents may need a lower setting.</p></div>
    </>} action={<StudioActionBar ready={!!file} count={file ? fileCount(1, "PDF") : undefined}>
        <button className="ts-primary-button" disabled={!file || busy} onClick={process}>Create long image</button>
    </StudioActionBar>}>
        {!file ? <FileIntake accepts=".pdf" label="Choose PDF for a long image" title="Your whole document. One image." onFiles={files => { setFile(files[0] || null); setError(""); }} /> : <><StudioFile name={file.name} detail={formatFileSize(file.size)} onRemove={busy ? undefined : () => setFile(null)} /><PdfPageStage file={file} /></>}
        {busy && <StudioProgress label="Joining your pages" detail={`${format.toUpperCase()} · ${dpi} dpi`} />}{error && <p className="ts-error" role="alert">{error}</p>}
    </StudioLayout>;
}
