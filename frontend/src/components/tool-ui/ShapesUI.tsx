import { useState, useRef } from "react";
import { Upload, Download, Loader2, AlertCircle, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";

const SHAPE_TYPES = [
    { value: "rectangle", label: "Rectangle" },
    { value: "circle", label: "Circle" },
    { value: "line", label: "Line" },
    { value: "arrow", label: "Arrow" },
];

interface Shape {
    id: string;
    type: string;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
    x2: number;
    y2: number;
    color: string;
    fill: string;
    stroke_width: number;
}

const makeId = () => Math.random().toString(36).slice(2, 8);

export function ShapesUI() {
    const [file, setFile] = useState<File | null>(null);
    const [shapes, setShapes] = useState<Shape[]>([
        { id: makeId(), type: "rectangle", page: 1, x: 100, y: 100, width: 200, height: 100, x2: 300, y2: 100, color: "#ff0000", fill: "", stroke_width: 2 },
    ]);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const addShape = () => {
        setShapes(prev => [...prev, { id: makeId(), type: "rectangle", page: 1, x: 100, y: 200 + prev.length * 50, width: 150, height: 80, x2: 250, y2: 200, color: "#0000ff", fill: "", stroke_width: 2 }]);
    };

    const removeShape = (id: string) => setShapes(prev => prev.filter(s => s.id !== id));

    const update = (id: string, field: keyof Shape, value: string | number) => {
        setShapes(prev => prev.map(s => s.id === id ? { ...s, [field]: value } : s));
    };

    const process = async () => {
        if (!file || shapes.length === 0) return;
        setStatus("processing");
        setError(null);
        try {
            const shapeList = shapes.map(({ id, ...rest }) => ({
                ...rest,
                fill: rest.fill || undefined,
            }));
            const res = await uploadFile("/add-shapes", file, {
                shapes: JSON.stringify(shapeList),
            });
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
        } catch (e: any) {
            setError(e.message || "Failed");
            setStatus("idle");
        }
    };

    const handleDownload = () => {
        if (resultBlob) {
            const name = file ? file.name.replace(/\.pdf$/i, "_shapes.pdf") : "shapes.pdf";
            downloadBlob(resultBlob, name);
        }
    };

    if (status === "done") {
        return (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
                <h2 className="text-lg font-bold text-foreground mb-1">Shapes Added!</h2>
                <p className="text-sm text-muted-foreground mb-6">{shapes.length} shape(s) drawn on your PDF</p>
                <div className="flex justify-center gap-3 flex-wrap">
                    <Button className="glow-primary" onClick={handleDownload}><Download size={15} /> Download</Button>
                    <Button variant="outline" className="border-border text-muted-foreground" onClick={() => { setFile(null); setStatus("idle"); setResultBlob(null); }}>Process another</Button>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            {/* File drop */}
            <div
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); }}
                onClick={() => ref.current?.click()}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
          role="button"
          tabIndex={0}
          aria-label="Upload file"
                className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-10 px-6 text-center",
                    drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 hover:bg-secondary/40 bg-secondary/20")}
            >
                <input ref={ref} type="file" accept=".pdf" className="hidden" onChange={e => e.target.files?.[0] && setFile(e.target.files[0])} />
                <Upload size={22} className={drag ? "text-primary" : "text-muted-foreground"} />
                <p className="text-sm font-semibold text-foreground">{file ? file.name : "Drop PDF here"}</p>
                {file && <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>}
            </div>

            {file && (
                <>
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-semibold text-foreground">Shapes</label>
                        <Button variant="ghost" size="sm" onClick={addShape} className="text-primary text-xs">
                            <Plus size={13} /> Add Shape
                        </Button>
                    </div>

                    <div className="space-y-3">
                        {shapes.map((s, idx) => {
                            const isLineOrArrow = s.type === "line" || s.type === "arrow";
                            return (
                                <div key={s.id} className="rounded-xl border border-border bg-card p-3 space-y-2">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Shape {idx + 1}</span>
                                        <button onClick={() => removeShape(s.id)} className="text-muted-foreground hover:text-destructive"><Trash2 size={12} /></button>
                                    </div>
                                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                        <div>
                                            <label className="text-[9px] text-muted-foreground uppercase">Type</label>
                                            <select value={s.type} onChange={e => update(s.id, "type", e.target.value)}
                                                className="w-full rounded-lg border border-border bg-secondary/30 px-2 py-1.5 text-xs text-foreground focus:outline-none">
                                                {SHAPE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-[9px] text-muted-foreground uppercase">Page</label>
                                            <input type="number" min={1} value={s.page} onChange={e => update(s.id, "page", +e.target.value)}
                                                className="w-full rounded-lg border border-border bg-secondary/30 px-2 py-1.5 text-xs text-foreground focus:outline-none" />
                                        </div>
                                        <div>
                                            <label className="text-[9px] text-muted-foreground uppercase">Stroke Color</label>
                                            <input type="color" value={s.color} onChange={e => update(s.id, "color", e.target.value)}
                                                className="w-full h-7 rounded-lg border border-border cursor-pointer" />
                                        </div>
                                        {!isLineOrArrow && (
                                            <div>
                                                <label className="text-[9px] text-muted-foreground uppercase">Fill Color</label>
                                                <input type="color" value={s.fill || "#ffffff"} onChange={e => update(s.id, "fill", e.target.value)}
                                                    className="w-full h-7 rounded-lg border border-border cursor-pointer" />
                                            </div>
                                        )}
                                        <div>
                                            <label className="text-[9px] text-muted-foreground uppercase">X</label>
                                            <input type="number" min={0} value={s.x} onChange={e => update(s.id, "x", +e.target.value)}
                                                className="w-full rounded-lg border border-border bg-secondary/30 px-2 py-1.5 text-xs text-foreground focus:outline-none" />
                                        </div>
                                        <div>
                                            <label className="text-[9px] text-muted-foreground uppercase">Y</label>
                                            <input type="number" min={0} value={s.y} onChange={e => update(s.id, "y", +e.target.value)}
                                                className="w-full rounded-lg border border-border bg-secondary/30 px-2 py-1.5 text-xs text-foreground focus:outline-none" />
                                        </div>
                                        {isLineOrArrow ? (
                                            <>
                                                <div>
                                                    <label className="text-[9px] text-muted-foreground uppercase">End X</label>
                                                    <input type="number" min={0} value={s.x2} onChange={e => update(s.id, "x2", +e.target.value)}
                                                        className="w-full rounded-lg border border-border bg-secondary/30 px-2 py-1.5 text-xs text-foreground focus:outline-none" />
                                                </div>
                                                <div>
                                                    <label className="text-[9px] text-muted-foreground uppercase">End Y</label>
                                                    <input type="number" min={0} value={s.y2} onChange={e => update(s.id, "y2", +e.target.value)}
                                                        className="w-full rounded-lg border border-border bg-secondary/30 px-2 py-1.5 text-xs text-foreground focus:outline-none" />
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div>
                                                    <label className="text-[9px] text-muted-foreground uppercase">Width</label>
                                                    <input type="number" min={10} value={s.width} onChange={e => update(s.id, "width", +e.target.value)}
                                                        className="w-full rounded-lg border border-border bg-secondary/30 px-2 py-1.5 text-xs text-foreground focus:outline-none" />
                                                </div>
                                                <div>
                                                    <label className="text-[9px] text-muted-foreground uppercase">Height</label>
                                                    <input type="number" min={10} value={s.height} onChange={e => update(s.id, "height", +e.target.value)}
                                                        className="w-full rounded-lg border border-border bg-secondary/30 px-2 py-1.5 text-xs text-foreground focus:outline-none" />
                                                </div>
                                            </>
                                        )}
                                        <div>
                                            <label className="text-[9px] text-muted-foreground uppercase">Stroke Width</label>
                                            <input type="number" min={0.5} max={10} step={0.5} value={s.stroke_width} onChange={e => update(s.id, "stroke_width", +e.target.value)}
                                                className="w-full rounded-lg border border-border bg-secondary/30 px-2 py-1.5 text-xs text-foreground focus:outline-none" />
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </>
            )}

            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle size={15} className="shrink-0" />{error}
                </div>
            )}

            {file && (
                <Button onClick={process} disabled={status === "processing" || shapes.length === 0} className="w-full glow-primary">
                    {status === "processing" ? <><Loader2 size={15} className="animate-spin" /> Drawing…</> : `Add ${shapes.length} Shape${shapes.length !== 1 ? "s" : ""}`}
                </Button>
            )}
        </div>
    );
}
