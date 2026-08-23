/**
 * RemoveExifUI — scrub EXIF / XMP metadata from a batch of images.
 * Workshop: signal-green dropzone, batch file list with per-file metadata
 * preview chips, privacy receipt.
 */
import { useCallback, useEffect, useState, useRef } from "react";
import { Loader2, AlertCircle, X, Image as ImageIcon, CheckCircle2, RotateCcw, DatabaseZap, MapPin } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { processAndDownload, processFilesAndDownload, formatFileSize, buildOutputFilename } from "@/lib/api";

type ExifProbe = { hasExif: boolean; hasXmp: boolean; hasGps: boolean };
type ExifFile = { id: string; name: string; size: string; raw: File; probe?: ExifProbe };
let fileId = 0;

const STRIPPED = ["GPS coordinates", "Camera model", "Lens info", "Timestamps", "Software fingerprint"];

/**
 * Cheap-and-cheerful sniff: scan the first 256 KB for the JPEG EXIF marker,
 * GPS IFD tag, and "<x:xmpmeta" string. Returns true/false flags only — we're
 * not parsing values, just answering "does this file carry any of that?"
 */
async function probeExif(file: File): Promise<ExifProbe> {
    const slice = file.slice(0, Math.min(file.size, 256 * 1024));
    const buf = new Uint8Array(await slice.arrayBuffer());
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
    const [files, setFiles] = useState<ExifFile[]>([]);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const addFiles = (fl: FileList) => {
        const next: ExifFile[] = Array.from(fl)
            .filter(f => /\.(jpe?g|png|webp|tiff?)$/i.test(f.name))
            .map(f => ({ id: String(++fileId), name: f.name, size: formatFileSize(f.size), raw: f }));
        if (next.length) { setFiles(prev => [...prev, ...next]); setStatus("idle"); setError(null); }
    };
    const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));

    // Probe each newly added file once. The result is cached on the row.
    useEffect(() => {
        let cancelled = false;
        (async () => {
            for (const f of files) {
                if (f.probe) continue;
                const probe = await probeExif(f.raw);
                if (cancelled) return;
                setFiles(prev => prev.map(x => x.id === f.id ? { ...x, probe } : x));
            }
        })();
        return () => { cancelled = true; };
    }, [files]);

    const canProcess = files.length > 0 && status !== "processing";

    const process = useCallback(async () => {
        if (!files.length) return;
        setStatus("processing"); setError(null);
        try {
            if (files.length === 1) {
                await processAndDownload("/remove-exif", files[0].raw, `clean_${files[0].name}`);
            } else {
                await processFilesAndDownload("/remove-exif", files.map(f => f.raw), buildOutputFilename(files[0]?.raw.name, "clean", "zip"));
            }
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't strip EXIF from those images."));
            setStatus("idle");
        }
    }, [files]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    if (status === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">EXIF stripped</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{files.length}</span> image{files.length !== 1 && "s"} cleaned
                        </h2>
                        <button
                            onClick={() => { setFiles([]); setStatus("idle"); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Clean more
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <div
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button" tabIndex={0} aria-label="Upload images"
                className={cn(
                    "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.webp,.tiff" multiple className="hidden" onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    <DatabaseZap size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">{files.length ? "Add more images" : "Select images to scrub"}</p>
                <p className="font-medium text-[11.5px] text-muted-foreground">JPEG · PNG · WebP · TIFF · multi-file batch</p>
            </div>

            {files.length > 0 && (
                <>
                    <div className="space-y-2">
                        {files.map((f, i) => {
                            const probed = f.probe;
                            const clean = probed && !probed.hasExif && !probed.hasXmp && !probed.hasGps;
                            return (
                                <div key={f.id} className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3">
                                    <span className="font-mono text-[10px] tracking-wider text-muted-foreground w-6 text-right shrink-0">{String(i + 1).padStart(2, "0")}</span>
                                    <div className="h-10 w-10 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                                        <ImageIcon size={15} className="text-accent" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[14px] font-medium text-foreground truncate">{f.name}</p>
                                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                            <span className="font-medium text-[11.5px] text-muted-foreground">{f.size}</span>
                                            {!probed && <span className="font-medium text-[11px] tracking-wider text-muted-foreground">scanning…</span>}
                                            {probed?.hasExif && (
                                                <span className="font-medium inline-flex items-center h-4 px-1.5 rounded text-[9.5px] tracking-wider bg-amber-500/15 text-amber-700 dark:text-amber-300">EXIF</span>
                                            )}
                                            {probed?.hasXmp && (
                                                <span className="font-medium inline-flex items-center h-4 px-1.5 rounded text-[9.5px] tracking-wider bg-amber-500/15 text-amber-700 dark:text-amber-300">XMP</span>
                                            )}
                                            {probed?.hasGps && (
                                                <span className="font-medium inline-flex items-center gap-0.5 h-4 px-1.5 rounded text-[9.5px] tracking-wider bg-destructive/15 text-destructive">
                                                    <MapPin size={9} /> GPS
                                                </span>
                                            )}
                                            {clean && (
                                                <span className="font-medium inline-flex items-center h-4 px-1.5 rounded text-[9.5px] tracking-wider bg-accent/15 text-accent">Clean</span>
                                            )}
                                        </div>
                                    </div>
                                    <button onClick={() => removeFile(f.id)} className="h-8 w-8 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60" aria-label={`Remove ${f.name}`}>
                                        <X size={13} />
                                    </button>
                                </div>
                            );
                        })}
                    </div>

                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                            Will be removed
                        </div>
                        <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
                            {STRIPPED.map(s => (
                                <div key={s} className="flex items-center gap-2 text-[12.5px] text-foreground">
                                    <span className="h-1 w-1 rounded-full bg-accent shrink-0" />
                                    {s}
                                </div>
                            ))}
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                            <AlertCircle size={13} className="shrink-0" />{error}
                        </div>
                    )}

                    <div className="flex items-center gap-3 flex-wrap">
                        <button onClick={process} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Stripping…</> : <><DatabaseZap size={13} /> Remove EXIF from {files.length > 1 ? `${files.length} images` : "image"}</>}
                        </button>
                        {canProcess && (
                            <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                        )}
                    </div>
                </>
            )}
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
