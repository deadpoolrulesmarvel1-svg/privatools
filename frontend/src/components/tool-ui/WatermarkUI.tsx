/**
 * WatermarkUI — overlay a text or image watermark on one or many PDFs.
 *
 * Multi-file design: the backend `/watermark` endpoint takes a single PDF plus
 * an optional `watermark_image` field. We loop client-side, one request per
 * PDF, with the same watermark applied to all. Three-at-a-time concurrency.
 * The queue keeps the shared FileEntry shape, so its result reads like every
 * other tool's and retries only the failures another attempt could fix.
 *
 * On N=1 we download the watermarked PDF directly. On N>1 we zip the outputs.
 */
import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { Droplets } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { formatFileSize, MAX_FILE_SIZE_LABEL, uploadFile, downloadBlob, buildOutputFilename, postFormData } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { emitToolRun, isTransientFailure, runOutcome, toolErrorKind } from "@/lib/toolRun";
import type { FileEntry } from "@/hooks/useMultiFileProcessor";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { PdfWatermarkPreview } from "./pdf/PdfWatermarkPreview";
import { AssetPicker } from "@/components/AssetPicker";
import { FileIntake, StudioActionBar, StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { downloadStarted } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

const WATERMARK_DEFAULTS = {
    mode: "text" as "text" | "image",
    text: "CONFIDENTIAL",
    opacity: 0.3,
    fontSize: 40,
    imageScale: 0.25,
    position: "center" as "center" | "top" | "bottom" | "top-left" | "top-right" | "bottom-left" | "bottom-right" | "diagonal" | "tile",
};

const positions = [
    { id: "center",       label: "Center" },
    { id: "top",          label: "Top" },
    { id: "bottom",       label: "Bottom" },
    { id: "top-left",     label: "Top Left" },
    { id: "top-right",    label: "Top Right" },
    { id: "bottom-left",  label: "Bottom Left" },
    { id: "bottom-right", label: "Bottom Right" },
    { id: "diagonal",     label: "Diagonal" },
    { id: "tile",         label: "Tile" },
] as const;

type WatermarkMode = "text" | "image";
let entryCounter = 0;

export function WatermarkUI() {
    const [files, setFiles] = useState<FileEntry[]>([]);
    const [config, setConfig, { restored, reset: resetConfig }] = useToolDefaults("watermark", WATERMARK_DEFAULTS);
    const { mode, text, opacity, fontSize, imageScale, position } = config;
    const setMode = (v: WatermarkMode) => setConfig(c => ({ ...c, mode: v }));
    const setText = (v: string) => setConfig(c => ({ ...c, text: v }));
    const setOpacity = (v: number) => setConfig(c => ({ ...c, opacity: v }));
    const setFontSize = (v: number) => setConfig(c => ({ ...c, fontSize: v }));
    const setImageScale = (v: number) => setConfig(c => ({ ...c, imageScale: v }));
    const setPosition = (v: typeof config.position) => setConfig(c => ({ ...c, position: v }));
    const [watermarkImage, setWatermarkImage] = useState<{ name: string; size: string; raw: File } | null>(null);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);
    const watermarkInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (restored) toast.message("Restored previous settings", { description: "Picked up where you left off.", duration: 3000 });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const addFiles = (incoming: File[]) => {
        // FileIntake has already refused (by name, with the tool that takes it) anything that isn't a PDF.
        const next: FileEntry[] = incoming.map(f => ({ id: `${Date.now().toString(36)}-${++entryCounter}`, file: f, name: f.name, size: f.size, status: "queued" }));
        if (!next.length) return;
        setFiles(prev => [...prev, ...next]);
        setState("idle");
    };

    const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));
    const clearAll = () => setFiles([]);

    const pickWatermarkImage = (fl: FileList) => {
        const f = fl[0];
        if (!f) return;
        setWatermarkImage({ name: f.name, size: formatFileSize(f.size), raw: f });
    };

    const doneFiles = files.filter(f => f.status === "done");
    const failedFiles = files.filter(f => f.status === "failed");
    const hasInput = files.length > 0
        && (mode === "text" ? text.trim().length > 0 : !!watermarkImage);
    const canProcess = hasInput && state !== "processing";

    /** Process one entry. Returns the resulting blob or throws. */
    const runOne = useCallback(async (file: File): Promise<Blob> => {
        if (mode === "text") {
            const res = await uploadFile("/watermark", file, {
                text: text.trim(), opacity, position, font_size: fontSize,
            });
            return res.blob();
        }
        // Image mode: backend takes a second file field, so use the shared
        // FormData helper instead of uploadFile's single-file wrapper.
        const res = await postFormData("/watermark", () => {
            const fd = new FormData();
            fd.append("file", file);
            fd.append("opacity", String(opacity));
            fd.append("position", position);
            if (watermarkImage) {
                fd.append("watermark_image", watermarkImage.raw);
                fd.append("image_scale", String(imageScale));
            }
            return fd;
        });
        return res.blob();
    }, [mode, text, opacity, position, fontSize, watermarkImage, imageScale]);

    /** Drive the queue. `true` re-runs only failed entries; "transient" only those another attempt could fix. */
    const runQueue = useCallback(async (retryOnly: boolean | "transient" = false) => {
        // Reset the targeted entries to "queued".
        const ids = files
            .filter(f => retryOnly === "transient" ? f.status === "failed" && f.retryable
                : retryOnly ? f.status === "failed" : (f.status === "queued" || f.status === "failed"))
            .map(f => f.id);
        if (!ids.length) return;
        setFiles(prev => prev.map(f => ids.includes(f.id) ? { ...f, status: "queued", error: undefined, errorKind: undefined, retryable: undefined } : f));
        setState("processing");

        const concurrency = 3;
        let cursor = 0;
        const targetIds = [...ids];
        let done = 0, failed = 0;
        let firstFailure: unknown = null;

        // Latest snapshot lookup — state is async so we use a local map.
        const fileMap = new Map(files.map(f => [f.id, f.file]));

        const worker = async () => {
            while (cursor < targetIds.length) {
                const idx = cursor++;
                const id = targetIds[idx];
                const f = fileMap.get(id);
                if (!f) continue;
                setFiles(prev => prev.map(x => x.id === id ? { ...x, status: "running" } : x));
                try {
                    const blob = await runOne(f);
                    setFiles(prev => prev.map(x => x.id === id ? { ...x, status: "done", blob, outName: buildOutputFilename(f.name, "watermarked", "pdf") } : x));
                    done++;
                } catch (e: unknown) {
                    const raw = e instanceof Error ? e.message : "Watermark failed";
                    const kind = toolErrorKind(e);
                    setFiles(prev => prev.map(x => x.id === id ? { ...x, status: "failed", error: friendlyError(raw, "Watermark failed"), errorKind: kind === "cancelled" ? undefined : kind, retryable: isTransientFailure(e) } : x));
                    failed++;
                    firstFailure ??= e;
                }
            }
        };

        const workers: Promise<void>[] = [];
        for (let i = 0; i < Math.min(concurrency, targetIds.length); i++) workers.push(worker());
        await Promise.all(workers);
        const outcome = runOutcome(done, failed);
        if (outcome) emitToolRun({ outcome, files: done + failed }, firstFailure);
        setState("done");
    }, [files, runOne]);

    /** Build a zip from successful entries and download it. */
    const downloadResults = useCallback(async () => {
        if (doneFiles.length === 0) return;
        // The download policy: one result is one file, several are one ZIP.
        if (doneFiles.length === 1) {
            const e = doneFiles[0];
            downloadBlob(e.blob!, buildOutputFilename(e.file.name, "watermarked", "pdf"));
            return;
        }
        const items = await Promise.all(doneFiles.map(async e => ({
            name: buildOutputFilename(e.file.name, "watermarked", "pdf"),
            data: new Uint8Array(await e.blob!.arrayBuffer()),
        })));
        const zip = buildZip(items);
        downloadBlob(zip, "archive_watermarked.zip");
    }, [doneFiles]);

    // On the first transition to "done" with any successes, kick off the download.
    useDownloadOnce(state === "done", doneFiles.length, () => void downloadResults());

    // Cmd+Enter to submit.
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                void runQueue(false);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, runQueue]);

    if (state === "done") {
        const retryableCount = failedFiles.filter(f => f.retryable).length;
        const startOver = (incoming?: File[]) => {
            setFiles([]);
            if (incoming) addFiles(incoming); else setWatermarkImage(null);
            setReturning(true); setState("idle");
        };
        return <ProcessorResult proc={{ entries: files, doneCount: doneFiles.length, failedCount: failedFiles.length, retryableCount }} verb="watermarked" accepts=".pdf"
            title={doneFiles.length > 1 ? `${doneFiles.length} PDFs watermarked.` : "Your watermarked PDF is ready."}
            detail={downloadStarted(doneFiles.length)}
            onDownload={() => void downloadResults()} onRetry={() => void runQueue("transient")}
            onStartOver={startOver} more="Watermark more" />;
    }

    const busy = state === "processing";
    return <StudioLayout options={<>
        <div>
            <h2>Watermark settings</h2>
            <div className="ts-mode-switch" role="group" aria-label="Watermark type">
                {(["text", "image"] as const).map(m => <button type="button" key={m} aria-pressed={mode === m} disabled={busy} onClick={() => setMode(m)}>{m === "text" ? "Text" : "Image"}</button>)}
            </div>
            {mode === "text" ? <>
                <div className="ts-setting"><label htmlFor="watermark-text">Watermark text</label><input id="watermark-text" value={text} disabled={busy} onChange={e => setText(e.target.value)} placeholder="e.g. CONFIDENTIAL" /></div>
                <div className="ts-setting"><label htmlFor="watermark-size">Font size · {fontSize}px</label><input id="watermark-size" type="range" min={8} max={200} value={fontSize} disabled={busy} onChange={e => setFontSize(parseInt(e.target.value, 10))} /></div>
            </> : <div className="ts-setting">
                <input ref={watermarkInputRef} type="file" accept=".png,.jpg,.jpeg,.webp" className="ts-native-input" tabIndex={-1}
                    onChange={e => { if (e.target.files) pickWatermarkImage(e.target.files); e.target.value = ""; }} />
                <button type="button" className="ts-secondary-button" disabled={busy} onClick={() => watermarkInputRef.current?.click()}>
                    {watermarkImage ? `${watermarkImage.name} (${watermarkImage.size})` : "Choose PNG/JPG/WebP file…"}
                </button>
                {/* Reuse a logo saved on this device instead of
                    re-uploading it every time. Nothing leaves the
                    browser until the tool actually runs. */}
                <AssetPicker kind="watermark" saveable={watermarkImage?.raw ?? null} onPick={(f) => setWatermarkImage({ name: f.name, size: formatFileSize(f.size), raw: f })} />
                {!watermarkImage && <p className="ts-caption">Pick a PNG/JPG/WebP first</p>}
                <label htmlFor="watermark-scale">Scale · {Math.round(imageScale * 100)}%</label>
                <input id="watermark-scale" type="range" min={5} max={100} value={Math.round(imageScale * 100)} disabled={busy} onChange={e => setImageScale(parseInt(e.target.value, 10) / 100)} />
            </div>}
            <div className="ts-setting"><label htmlFor="watermark-opacity">Opacity · {Math.round(opacity * 100)}%</label><input id="watermark-opacity" type="range" min={0} max={100} value={Math.round(opacity * 100)} disabled={busy} onChange={e => setOpacity(parseInt(e.target.value, 10) / 100)} /></div>
        </div>
        <div>
            <h2>Position</h2>
            <div className="grid grid-cols-3 gap-1.5">
                {positions.map(p => <button type="button" key={p.id} onClick={() => setPosition(p.id)} disabled={busy} aria-pressed={position === p.id} aria-label={`Watermark position ${p.label}`}
                    className={cn("min-h-[40px] rounded-md border py-1.5 px-2 text-[11px] font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--accent))]", position === p.id ? "border-accent bg-accent/[0.06] text-foreground" : "border-border text-muted-foreground hover:text-foreground hover:bg-paper-2/30")}>
                    {p.label}
                </button>)}
            </div>
        </div>
        <div><button type="button" className="ts-text-button" onClick={resetConfig} disabled={busy}>Reset to defaults</button></div>
    </>} action={<StudioActionBar ready={files.length > 0} count={files.length ? fileCount(files.length, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void runQueue(false)} disabled={!canProcess}><Droplets size={16} aria-hidden="true" /> Watermark {files.length > 1 ? `${files.length} PDFs` : "PDF"}</button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Select PDFs to watermark" detail={`Drag & drop · multi-file OK · max ${MAX_FILE_SIZE_LABEL} each`}
            compact={files.length > 0} disabled={busy} autoFocus={returning} onFiles={addFiles} />
        <ProcessorFiles proc={{ entries: files, removeFile, clearAll }} busy={busy} label="Selected PDFs" />
        {files.length > 0 && <PdfWatermarkPreview file={files[0].file} mode={mode} text={text} fontSize={fontSize} opacity={opacity} position={position} image={watermarkImage?.raw} imageScale={imageScale} />}
        {busy && <StudioProgress label="Adding the watermark" detail={`${doneFiles.length} of ${files.length} done`} />}
    </StudioLayout>;
}
