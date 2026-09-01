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

type ExifProbe = { hasExif: boolean; hasXmp: boolean; hasGps: boolean };

const STRIPPED = ["GPS coordinates", "Camera model", "Lens info", "Timestamps", "Software fingerprint"];

const isImg = (f: File) => /\.(jpe?g|png|webp|tiff?)$/i.test(f.name);

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
                const probe = await probeExif(e.file);
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

    const process = useCallback(async (retry = false) => {
        setPhase("processing");
        await proc.run({
            endpoint: "/remove-exif",
            outputSuffix: "clean",
            outputExt: "jpg",
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

    if (phase === "done") return (
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
                            <span className="italic text-accent">{proc.doneCount}</span> image{proc.doneCount !== 1 && "s"} cleaned{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}
                        </h2>
                        {proc.doneCount > 0 && (
                            <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                {proc.doneCount > 1 ? "ZIP downloaded" : "Downloaded"}
                            </p>
                        )}
                        <div className="mt-5 flex flex-wrap gap-2">
                            {proc.doneCount > 0 && (
                                <button onClick={downloadResults} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                    <Download size={13} /> Download {proc.doneCount > 1 ? "ZIP" : "again"}
                                </button>
                            )}
                            {proc.failedCount > 0 && (
                                <button
                                    onClick={() => { downloadedRef.current = false; void process(true); }}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-copper bg-copper-soft/40 text-[13px] font-medium text-foreground hover:bg-copper-soft/60 transition-colors"
                                >
                                    Retry {proc.failedCount} failed
                                </button>
                            )}
                            <button
                                onClick={() => { proc.reset(); setPhase("idle"); downloadedRef.current = false; }}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                            >
                                <RotateCcw size={12} /> Clean more
                            </button>
                        </div>
                        {proc.failedCount > 0 && (
                            <div className="mt-4 space-y-1.5">
                                {proc.entries.filter(e => e.status === "failed").map(e => (
                                    <p key={e.id} className="flex items-center gap-2 text-[12px] text-destructive">
                                        <AlertCircle size={12} className="shrink-0" /> {e.name}: {e.error}
                                    </p>
                                ))}
                            </div>
                        )}
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
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) proc.addFiles(e.dataTransfer.files, isImg); }}
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button" tabIndex={0} aria-label="Upload images"
                className={cn(
                    "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.webp,.tiff" multiple className="hidden" onChange={e => { if (e.target.files) proc.addFiles(e.target.files, isImg); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    <DatabaseZap size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">{proc.entries.length ? "Add more images" : "Select images to scrub"}</p>
                <p className="font-medium text-[11.5px] text-muted-foreground">JPEG · PNG · WebP · TIFF · multi-file batch</p>
            </div>

            {proc.entries.length > 0 && (
                <>
                    <div className="space-y-2">
                        {proc.entries.map((e, i) => {
                            const probed = probes[e.id];
                            const clean = probed && !probed.hasExif && !probed.hasXmp && !probed.hasGps;
                            return (
                                <div key={e.id} className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3">
                                    <span className="font-mono text-[10px] tracking-wider text-muted-foreground w-6 text-right shrink-0">{String(i + 1).padStart(2, "0")}</span>
                                    <div className="h-10 w-10 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                                        <ImageIcon size={15} className="text-accent" />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-[14px] font-medium text-foreground truncate">{e.name}</p>
                                        <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
                                            <span className="font-medium text-[11.5px] text-muted-foreground">{formatFileSize(e.size)}</span>
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
                                            {e.status === "running" && (
                                                <span className="font-medium inline-flex items-center gap-1 text-[9.5px] tracking-wider text-accent"><Loader2 size={10} className="animate-spin" /> Running</span>
                                            )}
                                            {e.status === "done" && (
                                                <span className="font-medium inline-flex items-center gap-1 text-[9.5px] tracking-wider text-accent"><CheckCircle2 size={10} /> Done</span>
                                            )}
                                            {e.status === "failed" && (
                                                <span className="font-medium inline-flex items-center gap-1 text-[9.5px] tracking-wider text-destructive" title={e.error || ""}><AlertCircle size={10} /> Failed{e.error ? ` · ${e.error}` : ""}</span>
                                            )}
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => proc.removeFile(e.id)}
                                        disabled={phase === "processing"}
                                        className="h-8 w-8 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-30"
                                        aria-label={`Remove ${e.name}`}
                                    >
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

                    <div className="flex items-center gap-3 flex-wrap">
                        <button onClick={() => void process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {phase === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Stripping… ({proc.doneCount}/{proc.entries.length})</>
                                : <><DatabaseZap size={13} /> Remove EXIF from {proc.entries.length > 1 ? `${proc.entries.length} images` : "image"}</>}
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
