import { postFormData } from "@/lib/api";
import { MediaBatchStudio, MediaField, MediaChoices, MediaRange, MediaPreview, MediaBusy } from "./media/MediaStudio";
/**
 * RemoveExifUI — scrub EXIF / XMP metadata from a batch of images.
 * Workshop: signal-green dropzone, batch file list with per-file metadata
 * preview chips, privacy receipt.
 * Multi-file via useMultiFileProcessor — one request per image; several
 * results download as one ZIP.
 */
import { useCallback, useEffect, useState, useRef } from "react";
import { Loader2, AlertCircle, X, Image as ImageIcon, CheckCircle2, RotateCcw, DatabaseZap, MapPin, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadBlob, formatFileSize, buildOutputFilename } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";

type ExifProbe = { hasExif: boolean; hasXmp: boolean; hasGps: boolean; unavailable?: boolean };

const STRIPPED = ["GPS coordinates", "Camera model", "Lens info", "Timestamps", "Software fingerprint"];

const isImg = (f: File) => /\.(jpe?g|png|webp|tiff?)$/i.test(f.name);

/**
 * Cheap-and-cheerful sniff: scan the first 256 KB for the JPEG EXIF marker,
 * GPS IFD tag, and "<x:xmpmeta" string. Returns true/false flags only — we're
 * not parsing values, just answering "does this file carry any of that?"
 */
async function probeExif(file: File): Promise<ExifProbe> {
    const slice = file.slice(0, Math.min(file.size, 256 * 1024));
    const buffer = typeof slice.arrayBuffer === "function" ? await slice.arrayBuffer() : await new Promise<ArrayBuffer>((resolve,reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result as ArrayBuffer); reader.onerror = () => reject(reader.error); reader.readAsArrayBuffer(slice); });
    const buf = new Uint8Array(buffer);
    // Look for "Exif\0\0" sentinel (45 78 69 66 00 00) — present in JPEG/TIFF.
    let hasExif = false, hasXmp = false, hasGps = false;
    const target = [0x45, 0x78, 0x69, 0x66, 0x00, 0x00];
    outer: for (let i = 0; i + target.length < buf.length; i++) {
        for (let j = 0; j < target.length; j++) if (buf[i + j] !== target[j]) continue outer;
        hasExif = true; break;
    }
    // GPS IFD tag 0x8825 (little- and big-endian); not exact but a useful hint.
    for (let i = 0; i + 1 < buf.length; i++) {
        if ((buf[i] === 0x88 && buf[i + 1] === 0x25) || (buf[i] === 0x25 && buf[i + 1] === 0x88)) {
            hasGps = true; break;
        }
    }
    // XMP packet marker as ASCII.
    const xmpMarker = "<x:xmpmeta";
    const text = new TextDecoder("latin1").decode(buf);
    if (text.includes(xmpMarker) || text.includes("<?xpacket")) hasXmp = true;
    return { hasExif, hasXmp, hasGps };
}

export function RemoveExifUI() {
    const proc = useMultiFileProcessor();
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    // Probe each newly added file once. Results are cached by queue-entry id.
    const [probes, setProbes] = useState<Record<string, ExifProbe>>({});
    const probesRef = useRef<Record<string, ExifProbe>>({});
    probesRef.current = probes;
    useEffect(() => {
        let cancelled = false;
        (async () => {
            for (const e of proc.entries) {
                if (probesRef.current[e.id]) continue;
                const probe = await probeExif(e.file).catch(() => ({ hasExif: false, hasXmp: false, hasGps: false, unavailable: true }));
                if (cancelled) return;
                setProbes(prev => prev[e.id] ? prev : { ...prev, [e.id]: probe });
            }
        })();
        return () => { cancelled = true; };
    }, [proc.entries]);

    const canProcess = proc.entries.length > 0 && phase !== "processing";

    // Same naming as before: "clean_<original name>".
    const outNameFor = useCallback((name: string) => `clean_${name}`, []);

    const downloadResults = useCallback(() => {
        const done = proc.entries.filter(e => e.status === "done" && e.blob);
        if (done.length === 0) return;
        if (done.length === 1) {
            downloadBlob(done[0].blob!, outNameFor(done[0].name));
            return;
        }
        void (async () => {
            const items = await Promise.all(done.map(async e => ({
                name: outNameFor(e.name),
                data: new Uint8Array(await e.blob!.arrayBuffer()),
            })));
            downloadBlob(buildZip(items), buildOutputFilename(done[0].name, "clean", "zip"));
        })();
    }, [proc.entries, outNameFor]);

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/remove-exif",
            outputSuffix: "clean",
            outputExt: "jpg",
            localProcess: async (file: File) => { const response = await postFormData("/remove-exif", () => { const data = new FormData(); data.append("files", file); return data; }); return { blob: await response.blob(), outName: `clean_${file.name}` }; },
        }, retry);
        setPhase("done");
    }, [proc]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            downloadResults();
        }
    }, [phase, proc.doneCount, downloadResults]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); void process(false); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    return <MediaBatchStudio proc={proc} phase={phase} title="Keep the photo. Leave the traces." accepts=".jpg,.jpeg,.png,.webp,.tif,.tiff" kind="image"  action="Remove image metadata" canProcess={canProcess} onRun={retry=>{ downloadedRef.current=false; void process(retry); }} onDownload={downloadResults} onReset={()=>{ proc.reset(); setPhase("idle"); downloadedRef.current=false; }} filter={isImg} details={entry => { const found = probes[entry.id]; return <small>{!found ? "Scanning metadata…" : found.unavailable ? "Metadata scan unavailable" : [found.hasExif && "EXIF marker", found.hasXmp && "XMP marker", found.hasGps && "Possible GPS marker"].filter(Boolean).join(" · ") || "No common markers found"}</small>; }}  options={<><MediaField label="A cleaner copy" detail="The scan looks for common metadata markers. It is a quick hint, not a complete metadata report."><div className="ms-privacy-list">{STRIPPED.map(item=><p key={item}><CheckCircle2 size={14}/>{item}</p>)}</div></MediaField></>} />;
}
