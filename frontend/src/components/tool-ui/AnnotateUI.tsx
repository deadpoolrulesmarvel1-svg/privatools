/**
 * AnnotateUI — apply highlight / underline / strikethrough / sticky-note annotations.
 * Workshop: per-annotation card editor + page diagram preview.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, AlertCircle, Plus, Trash2, CheckCircle2, Highlighter, RotateCcw } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile, downloadBlob } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";

const ANN_TYPES = [
    { value: "highlight",     label: "Highlight",      defaultColor: "#ffe24a", icon: "▭" },
    { value: "underline",     label: "Underline",      defaultColor: "#28C886", icon: "—" },
    { value: "strikethrough", label: "Strikethrough",  defaultColor: "#e54a3c", icon: "—" },
    { value: "note",          label: "Sticky note",    defaultColor: "#ffcc4a", icon: "✎" },
];

const COLOR_PALETTE = ["#ffe24a", "#28C886", "#e54a3c", "#ffa1c7", "#8cc7ff", "#9333ea"];

interface Annotation {
    id: string;
    type: string;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;
    text: string;
}

const makeId = () => Math.random().toString(36).slice(2, 8);
const PAGE_W = 612;
const PAGE_H = 792;

export function AnnotateUI() {
    const [file, setFile] = useState<File | null>(null);
    const [annotations, setAnnotations] = useState<Annotation[]>([
        { id: makeId(), type: "highlight", page: 1, x: 72, y: 72, width: 200, height: 14, color: "#ffe24a", text: "" },
    ]);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [selected, setSelected] = useState<string>(annotations[0]?.id || "");
    const focusOnNextAddRef = useRef<string | null>(null);
    const rowRefs = useRef<Map<string, HTMLInputElement>>(new Map());

    const addAnnotation = () => {
        const a: Annotation = { id: makeId(), type: "highlight", page: 1, x: 72, y: 100 + annotations.length * 30, width: 200, height: 14, color: "#ffe24a", text: "" };
        setAnnotations(prev => [...prev, a]);
        setSelected(a.id);
        focusOnNextAddRef.current = a.id;
    };
    const removeAnnotation = (id: string) => setAnnotations(prev => prev.filter(a => a.id !== id));
    const update = (id: string, field: keyof Annotation, value: string | number) => {
        setAnnotations(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a));
    };

    // Focus the first numeric input of a newly-added row
    useEffect(() => {
        if (!focusOnNextAddRef.current) return;
        const el = rowRefs.current.get(focusOnNextAddRef.current);
        if (el) {
            el.focus();
            el.select();
            focusOnNextAddRef.current = null;
        }
    }, [annotations.length]);

    const process = useCallback(async () => {
        if (!file || annotations.length === 0) return;
        setStatus("processing"); setError(null);
        try {
            const annList = annotations.map(({ id, ...rest }) => rest);
            const res = await uploadFile("/annotate-pdf", file, { annotations: JSON.stringify(annList) });
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
            downloadBlob(blob, file.name.replace(/\.pdf$/i, "_annotated.pdf"));
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Could not apply annotations";
            setError(friendlyError(msg, "Couldn't annotate that PDF."));
            setStatus("idle");
        }
    }, [file, annotations]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
            if (tag === "input" || tag === "textarea" || tag === "select") {
                if (!((e.metaKey || e.ctrlKey) && e.key === "Enter")) return;
            }
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && file && status !== "processing" && annotations.length > 0) {
                e.preventDefault();
                process();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [file, status, annotations.length, process]);

    if (status === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Annotated</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{annotations.length}</span> annotation{annotations.length !== 1 && "s"} applied
                        </h2>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <button onClick={() => resultBlob && file && downloadBlob(resultBlob, file.name.replace(/\.pdf$/i, "_annotated.pdf"))} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                <Download size={13} /> Download again
                            </button>
                            <button
                                onClick={() => { setFile(null); setStatus("idle"); setResultBlob(null); }}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                            >
                                <RotateCcw size={12} /> Annotate another
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
                label="Drop PDF to annotate"
                hint="Highlight, underline, strike, or sticky-note regions"
            />

            {file && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                        <span>Annotations ({annotations.length})</span>
                        <button onClick={addAnnotation} className="inline-flex items-center gap-1 text-accent hover:opacity-80 transition-opacity">
                            <Plus size={11} /> Add
                        </button>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-5 p-4 items-start">
                        <div className="space-y-2">
                            {annotations.map((ann, idx) => {
                                const isSel = selected === ann.id;
                                const annType = ANN_TYPES.find(t => t.value === ann.type);
                                return (
                                    <div
                                        key={ann.id}
                                        onClick={() => setSelected(ann.id)}
                                        className={cn(
                                            "rounded-lg border p-3 cursor-pointer transition-colors",
                                            isSel ? "border-accent bg-accent/[0.06]" : "border-border bg-card hover:border-border-strong"
                                        )}
                                    >
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className={cn("font-medium text-[11px]", isSel ? "text-accent" : "text-muted-foreground")}>
                                                {String(idx + 1).padStart(2, "0")}
                                            </span>
                                            <span className="font-display text-[12.5px] font-medium text-foreground">{annType?.label}</span>
                                            <span className="h-3 w-3 rounded-sm border border-border" style={{ background: ann.color }} />
                                            <button onClick={(e) => { e.stopPropagation(); removeAnnotation(ann.id); }} className="ml-auto h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                            <div className="col-span-2 sm:col-span-1">
                                                <label className="font-medium text-[10.5px] text-muted-foreground">Type</label>
                                                <select
                                                    value={ann.type}
                                                    onClick={e => e.stopPropagation()}
                                                    onChange={e => {
                                                        const next = ANN_TYPES.find(t => t.value === e.target.value);
                                                        update(ann.id, "type", e.target.value);
                                                        if (next) update(ann.id, "color", next.defaultColor);
                                                    }}
                                                    className="mt-0.5 w-full rounded border border-border bg-paper-2/40 px-1.5 py-1 text-[12px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                                                >
                                                    {ANN_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                                </select>
                                            </div>
                                            <div className="col-span-2 sm:col-span-3">
                                                <label className="font-medium text-[10.5px] text-muted-foreground">Color</label>
                                                <div className="mt-0.5 flex items-center gap-1.5 flex-wrap" role="group" aria-label="Color">
                                                    {COLOR_PALETTE.map(c => (
                                                        <button
                                                            key={c}
                                                            type="button"
                                                            onClick={(e) => { e.stopPropagation(); update(ann.id, "color", c); }}
                                                            aria-label={`Set color ${c}`}
                                                            aria-pressed={ann.color.toLowerCase() === c.toLowerCase()}
                                                            className={cn(
                                                                "h-6 w-6 rounded border-2 transition-transform",
                                                                ann.color.toLowerCase() === c.toLowerCase() ? "border-foreground/70 scale-110" : "border-border hover:scale-105"
                                                            )}
                                                            style={{ background: c }}
                                                        />
                                                    ))}
                                                    <input
                                                        type="color" value={ann.color}
                                                        onClick={e => e.stopPropagation()}
                                                        onChange={e => update(ann.id, "color", e.target.value)}
                                                        aria-label="Custom color"
                                                        className="h-6 w-7 rounded border border-border cursor-pointer"
                                                    />
                                                </div>
                                            </div>
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
                                                        ref={ci === 0 ? (el) => { if (el) rowRefs.current.set(ann.id, el); else rowRefs.current.delete(ann.id); } : undefined}
                                                        type="number" inputMode="numeric" min={c.min}
                                                        value={ann[c.f]}
                                                        onClick={e => e.stopPropagation()}
                                                        onChange={e => update(ann.id, c.f, +e.target.value)}
                                                        className="mt-0.5 w-full rounded border border-border bg-paper-2/40 px-1.5 py-1 font-mono text-[12px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 text-center"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                        {ann.type === "note" && (
                                            <input
                                                type="text" value={ann.text}
                                                onClick={e => e.stopPropagation()}
                                                onChange={e => update(ann.id, "text", e.target.value)}
                                                placeholder="Note text…"
                                                className="mt-2 w-full rounded-md border border-border bg-card px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Page preview */}
                        <div>
                            <div className="relative aspect-[3/4] bg-card border border-border rounded-md mx-auto w-full max-w-[200px] overflow-hidden">
                                {annotations.map(a => {
                                    const isSel = selected === a.id;
                                    return (
                                        <div
                                            key={a.id}
                                            className={cn(
                                                "absolute border transition-colors",
                                                isSel ? "ring-1 ring-accent" : ""
                                            )}
                                            style={{
                                                left: `${(a.x / PAGE_W) * 100}%`,
                                                top: `${(a.y / PAGE_H) * 100}%`,
                                                width: `${(a.width / PAGE_W) * 100}%`,
                                                height: `${(a.height / PAGE_H) * 100}%`,
                                                minWidth: 2, minHeight: 2,
                                                background: a.color + "66",
                                                borderColor: a.color,
                                            }}
                                        />
                                    );
                                })}
                                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-wider text-muted-foreground/40">page</span>
                            </div>
                            <p className="font-medium text-[11px] text-muted-foreground/85 mt-2 text-center">
                                Coords in points
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
                    <button onClick={process} disabled={status === "processing" || annotations.length === 0} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                        {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Annotating…</> : <><Highlighter size={13} /> Apply {annotations.length} annotation{annotations.length !== 1 && "s"}</>}
                    </button>
                    {status !== "processing" && annotations.length > 0 && (
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/80 bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>
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
