import { useCallback, useEffect, useRef, useState } from "react";
import { Archive, Download, File, Loader2, Plus, X } from "lucide-react";
import { formatFileSize, downloadBlob, postFormData, MAX_FILE_SIZE, MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { emitToolRun } from "@/lib/toolRun";
import { friendlyError } from "@/lib/utils";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { consumeFileHandoffs } from "@/lib/file-handoff";
import { ProcessingBar } from "./FileUploadZone";
import { LabWorkspace } from "./SpecialistTools";

const DEFAULTS = { compression: 6 };
interface Item { id: string; file: File; }
interface Result { blob: Blob; count: number; originalBytes: number; }
export function CreateZipUI() {
    const [config, , {setField}] = useToolDefaults("create-zip", DEFAULTS);
    const [files, setFiles] = useState<Item[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null), [result, setResult] = useState<Result | null>(null), [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null), active = useRef(false), generation = useRef(0);
    const add = useCallback((incoming: File[]) => {
        if (active.current) return;
        const tooLarge = incoming.find(file => file.size > MAX_FILE_SIZE);
        if (tooLarge) { setError(`${tooLarge.name} exceeds ${MAX_FILE_SIZE_LABEL}. Choose smaller files.`); return; }
        setFiles(previous => [...previous, ...incoming.map(file => ({id: crypto.randomUUID(), file}))]); setResult(null); setError(null);
    }, []);
    const invalidatePending = useCallback(() => { generation.current++; }, []);
    useEffect(() => { let cancelled = false; void consumeFileHandoffs("create-zip").then(values => { if (!cancelled) add(values); }); return () => { cancelled = true; invalidatePending(); }; }, [add, invalidatePending]);
    const totalBytes = files.reduce((sum, item) => sum + item.file.size, 0);
    const label = config.compression === 0 ? "Store without compression" : config.compression < 4 ? "Fast" : config.compression < 7 ? "Balanced" : "Smallest size";
    const process = useCallback(async () => {
        if (!files.length || active.current) return;
        active.current = true; const current = ++generation.current; setBusy(true); setError(null); setResult(null);
        try {
            const response = await postFormData("/create-zip", () => { const form = new FormData(); files.forEach(item => form.append("files", item.file)); form.append("compression", String(config.compression)); return form; });
            const blob = await response.blob();
            if (generation.current === current) {
                setResult({blob, count: files.length, originalBytes: totalBytes});
                // The download policy: the finished ZIP downloads by itself, once; the result offers it again.
                downloadBlob(blob, "archive.zip");
            }
            emitToolRun({outcome: "success", files: files.length});
        } catch (e) { if (generation.current === current) setError(friendlyError(e instanceof Error ? e.message : "", "Couldn't create that archive.")); emitToolRun({outcome: "error", files: files.length}, e); }
        finally { if (generation.current === current) { active.current = false; setBusy(false); } }
    }, [files, config.compression, totalBytes]);
    useEffect(() => { const listener = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); void process(); } }; window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener); }, [process]);
    return <LabWorkspace kind="archive"><div className="pt-archive-workspace"><section className="pt-archive-intake"><div className="pt-lab-toolbar"><h2>Bring your files together</h2><span>{files.length} selected</span></div><input ref={ref} type="file" multiple disabled={busy} className="sr-only" tabIndex={-1} aria-label="Files to archive" onChange={e => { add(Array.from(e.target.files ?? [])); e.target.value = ""; }}/><button className={`pt-archive-drop ${drag ? "is-dragging" : ""}`} disabled={busy} onClick={() => ref.current?.click()} onDragOver={e => { e.preventDefault(); if (!busy) setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); add(Array.from(e.dataTransfer.files)); }}><Plus size={27}/><strong>{files.length ? "Add more files" : "Choose files to bundle"}</strong><span>Or drop them here · any file type</span></button>{files.length > 0 && <ul className="pt-archive-list">{files.map(({id, file}) => <li key={id}><File size={17}/><span title={file.name}>{file.name}</span><small>{formatFileSize(file.size)}</small><button className="pt-archive-remove" aria-label={`Remove ${file.name}`} disabled={busy} onClick={() => { setFiles(previous => previous.filter(item => item.id !== id)); setResult(null); }}><X size={16}/></button></li>)}</ul>}<p className="pt-lab-caption">{formatFileSize(totalBytes)} in total · Duplicate names are renamed in the ZIP so every file is kept.</p></section><section className="pt-archive-contents"><div className="pt-lab-toolbar"><h2>{result ? "Your bundle is ready" : "Make it a ZIP"}</h2><Archive size={26}/></div>{result ? <><div className="pt-archive-result" role="status"><strong>{formatFileSize(result.blob.size)}</strong><span>{result.count} files in one standard ZIP</span></div><p className="pt-lab-caption">Source files: {formatFileSize(result.originalBytes)}. Some formats are already compressed, so a ZIP may be slightly larger.</p><button className="pt-lab-button is-primary pt-lab-spaced" onClick={() => downloadBlob(result.blob, "archive.zip")}><Download size={16} aria-hidden="true"/>Download ZIP again</button><button className="pt-lab-button pt-lab-spaced" onClick={() => { setResult(null); setFiles([]); }}>Start another bundle</button></> : <><p className="pt-lab-caption">Files are uploaded to the server only when you create the archive.</p><label className="pt-lab-range"><strong>Compression</strong><span>{label} · {config.compression}/9</span><input type="range" min={0} max={9} step={1} value={config.compression} disabled={busy} aria-label="ZIP compression level" aria-valuetext={`Level ${config.compression}: ${label}`} onChange={e => setField("compression", Number(e.target.value))}/><span>Faster creation</span><span>Smaller archive</span></label><p className="pt-lab-caption">Standard ZIP, without password encryption.</p><button className="pt-lab-button is-primary pt-lab-spaced" disabled={!files.length || busy} onClick={() => void process()}>{busy ? <Loader2 size={16} className="animate-spin"/> : <Archive size={16}/>} {busy ? "Creating your ZIP…" : `Create ZIP${files.length ? ` · ${files.length} files` : ""}`}</button>{busy && <ProcessingBar label="Uploading and compressing the selected files…"/>}</>}{error && <p role="alert" className="pt-lab-issue is-error">{error}</p>}</section></div></LabWorkspace>;
}
