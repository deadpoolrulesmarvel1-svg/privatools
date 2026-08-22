/**
 * WhiteoutUI — cover rectangular PDF regions with white fill.
 * Workshop: numbered row editor with X/Y/W/H mono inputs + visual page-thumb preview.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, AlertCircle, Plus, Trash2, Eraser, CheckCircle2, RotateCcw } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile, downloadBlob } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";

interface Region {
    id: string;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
}

const makeId = () => Math.random().toString(36).slice(2, 8);

// page in points (Letter)
const PAGE_W = 612;
const PAGE_H = 792;

export function WhiteoutUI() {
    const [file, setFile] = useState<File | null>(null);
    const [regions, setRegions] = useState<Region[]>([
        { id: makeId(), page: 1, x: 100, y: 100, width: 200, height: 30 },
    ]);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [selected, setSelected] = useState<string>(regions[0]?.id || "");
    const focusOnNextAddRef = useRef<string | null>(null);
    const rowRefs = useRef<Map<string, HTMLInputElement>>(new Map());

    const addRegion = () => {
        const r = { id: makeId(), page: 1, x: 100, y: 150 + regions.length * 40, width: 200, height: 30 };
        setRegions(prev => [...prev, r]);
        setSelected(r.id);
        focusOnNextAddRef.current = r.id;
    };
    const removeRegion = (id: string) => setRegions(prev => prev.filter(r => r.id !== id));
    const update = (id: string, field: keyof Region, value: number) => {
        setRegions(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    };

    useEffect(() => {
        if (!focusOnNextAddRef.current) return;
        const el = rowRefs.current.get(focusOnNextAddRef.current);
        if (el) { el.focus(); el.select(); focusOnNextAddRef.current = null; }
    }, [regions.length]);

    const process = useCallback(async () => {
        if (!file || regions.length === 0) return;
        setStatus("processing"); setError(null);
        try {
            const regionList = regions.map(({ id, ...rest }) => rest);
            const res = await uploadFile("/whiteout-pdf", file, { regions: JSON.stringify(regionList) });
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
            downloadBlob(blob, file.name.replace(/\.pdf$/i, "_whiteout.pdf"));
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Could not apply white-out";
            setError(friendlyError(msg, "Couldn't apply whiteout."));
            setStatus("idle");
        }
    }, [file, regions]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
            if ((tag === "input" || tag === "textarea" || tag === "select") && !((e.metaKey || e.ctrlKey) && e.key === "Enter")) return;
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && file && status !== "processing" && regions.length > 0) {
                e.preventDefault();
                process();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [file, status, regions.length, process]);

    if (status === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">White-out applied</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{regions.length}</span> region{regions.length !== 1 && "s"} covered
                        </h2>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <button onClick={() => resultBlob && file && downloadBlob(resultBlob, file.name.replace(/\.pdf$/i, "_whiteout.pdf"))} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                <Download size={13} /> Download again
                            </button>
                            <button
                                onClick={() => { setFile(null); setStatus("idle"); setResultBlob(null); }}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                            >
                                <RotateCcw size={12} /> Erase another
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <FileUploadZone
                file={file}
                onFileSelect={setFile}
                onClear={() => setFile(null)}
                accept=".pdf"
                label="Drop PDF to white-out"
                hint="Cover sensitive regions with white fill"
            />

            {file && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                        <span>White-out regions ({regions.length})</span>
                        <button onClick={addRegion} className="inline-flex items-center gap-1 text-accent hover:opacity-80 transition-opacity">
                            <Plus size={11} /> Add
                        </button>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-5 p-4 items-start">
                        <div className="space-y-2">
                            {regions.map((r, idx) => {
                                const isSel = selected === r.id;
                                return (
                                    <div
                                        key={r.id}
                                        onClick={() => setSelected(r.id)}
                                        className={cn(
                                            "rounded-lg border p-3 cursor-pointer transition-colors",
                                            isSel ? "border-accent bg-accent/[0.06]" : "border-border bg-card hover:border-border-strong"
                                        )}
                                    >
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className={cn("font-medium text-[11px]", isSel ? "text-accent" : "text-muted-foreground")}>
                                                {String(idx + 1).padStart(2, "0")}
                                            </span>
                                            <span className="font-display text-[12.5px] font-medium text-foreground">Region {idx + 1}</span>
                                            <button onClick={(e) => { e.stopPropagation(); removeRegion(r.id); }} className="ml-auto h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                                            {([
                                                { f: "page", label: "Page", min: 1 },
                                                { f: "x", label: "X", min: 0 },
                                                { f: "y", label: "Y", min: 0 },
                                                { f: "width", label: "W", min: 1 },
                                                { f: "height", label: "H", min: 1 },
                                            ] as const).map((c, ci) => (
                                                <div key={c.f}>
                                                    <label className="font-medium text-[10.5px] text-muted-foreground">{c.label}</label>
                                                    <input
                                                        ref={ci === 0 ? (el) => { if (el) rowRefs.current.set(r.id, el); else rowRefs.current.delete(r.id); } : undefined}
                                                        type="number" inputMode="numeric" min={c.min}
                                                        value={r[c.f]}
                                                        onClick={e => e.stopPropagation()}
                                                        onChange={e => update(r.id, c.f, +e.target.value)}
                                                        className="mt-0.5 w-full rounded border border-border bg-paper-2/40 px-1.5 py-1 font-mono text-[12px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 text-center"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Page preview with all regions */}
                        <div>
                            <div className="relative aspect-[3/4] bg-card border border-border rounded-md mx-auto w-full max-w-[200px] overflow-hidden">
                                {regions.map(r => {
                                    const isSel = selected === r.id;
                                    return (
                                        <div
                                            key={r.id}
                                            className={cn(
                                                "absolute border transition-colors",
                                                isSel ? "border-accent bg-accent/35" : "border-foreground/45 bg-foreground/15"
                                            )}
                                            style={{
                                                left: `${(r.x / PAGE_W) * 100}%`,
                                                top: `${(r.y / PAGE_H) * 100}%`,
                                                width: `${(r.width / PAGE_W) * 100}%`,
                                                height: `${(r.height / PAGE_H) * 100}%`,
                                                minWidth: 2, minHeight: 2,
                                            }}
                                        />
                                    );
                                })}
                                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-wider text-muted-foreground">page</span>
                            </div>
                            <p className="font-medium text-[11px] text-muted-foreground mt-2 text-center">
                                Coords in points · top-left origin
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            {file && (
                <div className="flex items-center gap-3">
                    <button onClick={process} disabled={status === "processing" || regions.length === 0} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                        {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Erasing…</> : <><Eraser size={13} /> Apply {regions.length} white-out{regions.length !== 1 && "s"}</>}
                    </button>
                    {status !== "processing" && regions.length > 0 && (
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>
                    )}
                </div>
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
