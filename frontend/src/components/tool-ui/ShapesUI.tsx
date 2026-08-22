/**
 * ShapesUI — draw rectangle / circle / line / arrow on PDF pages.
 * Workshop: per-shape card editor + SVG page preview rendering each shape.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, AlertCircle, Plus, Trash2, CheckCircle2, Shapes, RotateCcw } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile, downloadBlob } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";

const SHAPE_TYPES = [
    { value: "rectangle", label: "Rectangle" },
    { value: "circle",    label: "Circle" },
    { value: "line",      label: "Line" },
    { value: "arrow",     label: "Arrow" },
];

const STROKE_PALETTE = ["#0E8A56", "#000000", "#dc2626", "#2563eb", "#9333ea", "#ea580c"];

interface Shape {
    id: string;
    type: string;
    page: number;
    x: number; y: number;
    width: number; height: number;
    x2: number; y2: number;
    color: string;
    fill: string;
    stroke_width: number;
}

const makeId = () => Math.random().toString(36).slice(2, 8);
const PAGE_W = 612;
const PAGE_H = 792;
const VB_W = 200;
const VB_H = (PAGE_H / PAGE_W) * VB_W;

export function ShapesUI() {
    const [file, setFile] = useState<File | null>(null);
    const [shapes, setShapes] = useState<Shape[]>([
        { id: makeId(), type: "rectangle", page: 1, x: 100, y: 100, width: 200, height: 100, x2: 300, y2: 100, color: "#0E8A56", fill: "", stroke_width: 2 },
    ]);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [selected, setSelected] = useState<string>(shapes[0]?.id || "");
    const focusOnNextAddRef = useRef<string | null>(null);
    const rowRefs = useRef<Map<string, HTMLInputElement>>(new Map());

    const addShape = () => {
        const s: Shape = { id: makeId(), type: "rectangle", page: 1, x: 100, y: 200 + shapes.length * 50, width: 150, height: 80, x2: 250, y2: 200, color: "#0E8A56", fill: "", stroke_width: 2 };
        setShapes(prev => [...prev, s]);
        setSelected(s.id);
        focusOnNextAddRef.current = s.id;
    };
    const removeShape = (id: string) => setShapes(prev => prev.filter(s => s.id !== id));
    const update = (id: string, field: keyof Shape, value: string | number) => {
        setShapes(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
    };

    useEffect(() => {
        if (!focusOnNextAddRef.current) return;
        const el = rowRefs.current.get(focusOnNextAddRef.current);
        if (el) { el.focus(); el.select(); focusOnNextAddRef.current = null; }
    }, [shapes.length]);

    const process = useCallback(async () => {
        if (!file || shapes.length === 0) return;
        setStatus("processing"); setError(null);
        try {
            const shapeList = shapes.map(({ id, ...rest }) => ({ ...rest, fill: rest.fill || undefined }));
            const res = await uploadFile("/add-shapes", file, { shapes: JSON.stringify(shapeList) });
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
            downloadBlob(blob, file.name.replace(/\.pdf$/i, "_shapes.pdf"));
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Could not draw shapes";
            setError(friendlyError(msg, "Couldn't apply those shapes."));
            setStatus("idle");
        }
    }, [file, shapes]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
            if ((tag === "input" || tag === "textarea" || tag === "select") && !((e.metaKey || e.ctrlKey) && e.key === "Enter")) return;
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && file && status !== "processing" && shapes.length > 0) {
                e.preventDefault();
                process();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [file, status, shapes.length, process]);

    // Render preview as SVG
    const renderShapePreview = (s: Shape, isSel: boolean) => {
        const sx = (n: number) => (n / PAGE_W) * VB_W;
        const sy = (n: number) => (n / PAGE_H) * VB_H;
        const stroke = isSel ? "hsl(var(--accent))" : s.color;
        const sw = Math.max(0.5, s.stroke_width * (VB_W / PAGE_W));
        const fill = s.fill || "none";
        switch (s.type) {
            case "rectangle":
                return <rect key={s.id} x={sx(s.x)} y={sy(s.y)} width={sx(s.width)} height={sy(s.height)} stroke={stroke} strokeWidth={sw} fill={fill === "none" ? "transparent" : fill} />;
            case "circle": {
                const rx = sx(s.width) / 2;
                const ry = sy(s.height) / 2;
                return <ellipse key={s.id} cx={sx(s.x) + rx} cy={sy(s.y) + ry} rx={rx} ry={ry} stroke={stroke} strokeWidth={sw} fill={fill === "none" ? "transparent" : fill} />;
            }
            case "line":
                return <line key={s.id} x1={sx(s.x)} y1={sy(s.y)} x2={sx(s.x2)} y2={sy(s.y2)} stroke={stroke} strokeWidth={sw} />;
            case "arrow":
                return (
                    <g key={s.id}>
                        <line x1={sx(s.x)} y1={sy(s.y)} x2={sx(s.x2)} y2={sy(s.y2)} stroke={stroke} strokeWidth={sw} markerEnd={`url(#arrow-${s.id})`} />
                        <defs>
                            <marker id={`arrow-${s.id}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                                <path d="M 0 0 L 10 5 L 0 10 z" fill={stroke} />
                            </marker>
                        </defs>
                    </g>
                );
            default:
                return null;
        }
    };

    if (status === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Shapes drawn</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{shapes.length}</span> shape{shapes.length !== 1 && "s"} added
                        </h2>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <button onClick={() => resultBlob && file && downloadBlob(resultBlob, file.name.replace(/\.pdf$/i, "_shapes.pdf"))} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                <Download size={13} /> Download again
                            </button>
                            <button
                                onClick={() => { setFile(null); setStatus("idle"); setResultBlob(null); }}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                            >
                                <RotateCcw size={12} /> Draw on another
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
                label="Drop PDF to draw on"
                hint="Add rectangles, circles, lines, or arrows"
            />

            {file && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                        <span>Shapes ({shapes.length})</span>
                        <button onClick={addShape} className="inline-flex items-center gap-1 text-accent hover:opacity-80 transition-opacity">
                            <Plus size={11} /> Add
                        </button>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-5 p-4 items-start">
                        <div className="space-y-2">
                            {shapes.map((s, idx) => {
                                const isSel = selected === s.id;
                                const isLineish = s.type === "line" || s.type === "arrow";
                                return (
                                    <div
                                        key={s.id}
                                        onClick={() => setSelected(s.id)}
                                        className={cn(
                                            "rounded-lg border p-3 cursor-pointer transition-colors",
                                            isSel ? "border-accent bg-accent/[0.06]" : "border-border bg-card hover:border-border-strong"
                                        )}
                                    >
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className={cn("font-medium text-[11px]", isSel ? "text-accent" : "text-muted-foreground")}>
                                                {String(idx + 1).padStart(2, "0")}
                                            </span>
                                            <span className="font-display text-[12.5px] font-medium text-foreground">{SHAPE_TYPES.find(t => t.value === s.type)?.label}</span>
                                            <span className="h-3 w-3 rounded-sm border border-border" style={{ background: s.color }} />
                                            <button onClick={(e) => { e.stopPropagation(); removeShape(s.id); }} className="ml-auto h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                            <div>
                                                <label className="font-medium text-[10.5px] text-muted-foreground">Type</label>
                                                <select
                                                    value={s.type}
                                                    onClick={e => e.stopPropagation()}
                                                    onChange={e => update(s.id, "type", e.target.value)}
                                                    className="mt-0.5 w-full rounded border border-border bg-paper-2/40 px-1.5 py-1 text-[12px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                                                >
                                                    {SHAPE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                                </select>
                                            </div>
                                            <div className="col-span-2">
                                                <label className="font-medium text-[10.5px] text-muted-foreground">Stroke</label>
                                                <div className="mt-0.5 flex items-center gap-1.5 flex-wrap" role="group" aria-label="Stroke color">
                                                    {STROKE_PALETTE.map(c => (
                                                        <button
                                                            key={c}
                                                            type="button"
                                                            onClick={(e) => { e.stopPropagation(); update(s.id, "color", c); }}
                                                            aria-label={`Stroke ${c}`}
                                                            aria-pressed={s.color.toLowerCase() === c.toLowerCase()}
                                                            className={cn(
                                                                "h-6 w-6 rounded border-2 transition-transform",
                                                                s.color.toLowerCase() === c.toLowerCase() ? "border-foreground/70 scale-110" : "border-border hover:scale-105"
                                                            )}
                                                            style={{ background: c }}
                                                        />
                                                    ))}
                                                    <input
                                                        type="color" value={s.color}
                                                        onClick={e => e.stopPropagation()}
                                                        onChange={e => update(s.id, "color", e.target.value)}
                                                        aria-label="Custom stroke color"
                                                        className="h-6 w-7 rounded border border-border cursor-pointer"
                                                    />
                                                </div>
                                            </div>
                                            {!isLineish && (
                                                <div>
                                                    <label className="font-medium text-[10.5px] text-muted-foreground">Fill</label>
                                                    <input
                                                        type="color" value={s.fill || "#ffffff"}
                                                        onClick={e => e.stopPropagation()}
                                                        onChange={e => update(s.id, "fill", e.target.value)}
                                                        className="mt-0.5 w-full h-7 rounded border border-border cursor-pointer"
                                                    />
                                                </div>
                                            )}
                                            <div>
                                                <label className="font-medium text-[10.5px] text-muted-foreground">Pg</label>
                                                <input
                                                    ref={(el) => { if (el) rowRefs.current.set(s.id, el); else rowRefs.current.delete(s.id); }}
                                                    type="number" inputMode="numeric" min={1} value={s.page}
                                                    onClick={e => e.stopPropagation()}
                                                    onChange={e => update(s.id, "page", +e.target.value)}
                                                    className="mt-0.5 w-full rounded border border-border bg-paper-2/40 px-1.5 py-1 font-mono text-[12px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 text-center"
                                                />
                                            </div>
                                            <div>
                                                <label className="font-medium text-[10.5px] text-muted-foreground">X</label>
                                                <input
                                                    type="number" inputMode="numeric" min={0} value={s.x}
                                                    onClick={e => e.stopPropagation()}
                                                    onChange={e => update(s.id, "x", +e.target.value)}
                                                    className="mt-0.5 w-full rounded border border-border bg-paper-2/40 px-1.5 py-1 font-mono text-[12px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 text-center"
                                                />
                                            </div>
                                            <div>
                                                <label className="font-medium text-[10.5px] text-muted-foreground">Y</label>
                                                <input
                                                    type="number" inputMode="numeric" min={0} value={s.y}
                                                    onClick={e => e.stopPropagation()}
                                                    onChange={e => update(s.id, "y", +e.target.value)}
                                                    className="mt-0.5 w-full rounded border border-border bg-paper-2/40 px-1.5 py-1 font-mono text-[12px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 text-center"
                                                />
                                            </div>
                                            {isLineish ? (
                                                <>
                                                    <div>
                                                        <label className="font-medium text-[10.5px] text-muted-foreground">X2</label>
                                                        <input
                                                            type="number" inputMode="numeric" min={0} value={s.x2}
                                                            onClick={e => e.stopPropagation()}
                                                            onChange={e => update(s.id, "x2", +e.target.value)}
                                                            className="mt-0.5 w-full rounded border border-border bg-paper-2/40 px-1.5 py-1 font-mono text-[12px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 text-center"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="font-medium text-[10.5px] text-muted-foreground">Y2</label>
                                                        <input
                                                            type="number" inputMode="numeric" min={0} value={s.y2}
                                                            onClick={e => e.stopPropagation()}
                                                            onChange={e => update(s.id, "y2", +e.target.value)}
                                                            className="mt-0.5 w-full rounded border border-border bg-paper-2/40 px-1.5 py-1 font-mono text-[12px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 text-center"
                                                        />
                                                    </div>
                                                </>
                                            ) : (
                                                <>
                                                    <div>
                                                        <label className="font-medium text-[10.5px] text-muted-foreground">W</label>
                                                        <input
                                                            type="number" inputMode="numeric" min={1} value={s.width}
                                                            onClick={e => e.stopPropagation()}
                                                            onChange={e => update(s.id, "width", +e.target.value)}
                                                            className="mt-0.5 w-full rounded border border-border bg-paper-2/40 px-1.5 py-1 font-mono text-[12px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 text-center"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="font-medium text-[10.5px] text-muted-foreground">H</label>
                                                        <input
                                                            type="number" inputMode="numeric" min={1} value={s.height}
                                                            onClick={e => e.stopPropagation()}
                                                            onChange={e => update(s.id, "height", +e.target.value)}
                                                            className="mt-0.5 w-full rounded border border-border bg-paper-2/40 px-1.5 py-1 font-mono text-[12px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 text-center"
                                                        />
                                                    </div>
                                                </>
                                            )}
                                            <div>
                                                <label className="font-medium text-[10.5px] text-muted-foreground">Stroke W</label>
                                                <input
                                                    type="number" inputMode="numeric" min={0.5} max={10} step={0.5} value={s.stroke_width}
                                                    onClick={e => e.stopPropagation()}
                                                    onChange={e => update(s.id, "stroke_width", +e.target.value)}
                                                    className="mt-0.5 w-full rounded border border-border bg-paper-2/40 px-1.5 py-1 font-mono text-[12px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 text-center"
                                                />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* SVG preview */}
                        <div>
                            <div className="relative aspect-[3/4] bg-card border border-border rounded-md mx-auto w-full max-w-[200px] overflow-hidden">
                                <svg viewBox={`0 0 ${VB_W} ${VB_H}`} className="absolute inset-0 w-full h-full">
                                    {shapes.map(s => renderShapePreview(s, selected === s.id))}
                                </svg>
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
                    <button onClick={process} disabled={status === "processing" || shapes.length === 0} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                        {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Drawing…</> : <><Shapes size={13} /> Add {shapes.length} shape{shapes.length !== 1 && "s"}</>}
                    </button>
                    {status !== "processing" && shapes.length > 0 && (
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
