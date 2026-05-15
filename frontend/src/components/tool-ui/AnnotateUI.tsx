import { useState, useRef } from "react";
import { Upload, Download, Loader2, AlertCircle, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";

const ANN_TYPES = [
    { value: "highlight", label: "Highlight", defaultColor: "#ffff00" },
    { value: "underline", label: "Underline", defaultColor: "#00aaff" },
    { value: "strikethrough", label: "Strikethrough", defaultColor: "#ff0000" },
    { value: "note", label: "Sticky Note", defaultColor: "#ffcc00" },
];

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

export function AnnotateUI() {
    const [file, setFile] = useState<File | null>(null);
    const [annotations, setAnnotations] = useState<Annotation[]>([
        { id: makeId(), type: "highlight", page: 1, x: 72, y: 72, width: 200, height: 14, color: "#ffff00", text: "" },
    ]);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const addAnnotation = () => {
        setAnnotations(prev => [...prev, { id: makeId(), type: "highlight", page: 1, x: 72, y: 100 + prev.length * 20, width: 200, height: 14, color: "#ffff00", text: "" }]);
    };

    const removeAnnotation = (id: string) => {
        setAnnotations(prev => prev.filter(a => a.id !== id));
    };

    const update = (id: string, field: keyof Annotation, value: string | number) => {
        setAnnotations(prev => prev.map(a => a.id === id ? { ...a, [field]: value } : a));
    };

    const process = async () => {
        if (!file || annotations.length === 0) return;
        setStatus("processing");
        setError(null);
        try {
            const annList = annotations.map(({ id, ...rest }) => rest);
            const res = await uploadFile("/annotate-pdf", file, {
                annotations: JSON.stringify(annList),
            });
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
        } catch (e: any) {
            setError(e.message || "Annotation failed");
            setStatus("idle");
        }
    };

    const handleDownload = () => {
        if (resultBlob) {
            const name = file ? file.name.replace(/\.pdf$/i, "_annotated.pdf") : "annotated.pdf";
            downloadBlob(resultBlob, name);
        }
    };

    if (status === "done") {
        return (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
                <h2 className="text-lg font-bold text-foreground mb-1">Annotations Added!</h2>
                <p className="text-sm text-muted-foreground mb-6">{annotations.length} annotation(s) applied</p>
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
                        <label className="text-sm font-semibold text-foreground">Annotations</label>
                        <Button variant="ghost" size="sm" onClick={addAnnotation} className="text-primary text-xs">
                            <Plus size={13} /> Add
                        </Button>
                    </div>

                    <div className="space-y-3">
                        {annotations.map((ann, idx) => (
                            <div key={ann.id} className="rounded-xl border border-border bg-card p-3 space-y-2">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">Annotation {idx + 1}</span>
                                    <button onClick={() => removeAnnotation(ann.id)} className="text-muted-foreground hover:text-destructive"><Trash2 size={12} /></button>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                                    <div>
                                        <label className="text-[9px] text-muted-foreground uppercase">Type</label>
                                        <select value={ann.type} onChange={e => { update(ann.id, "type", e.target.value); update(ann.id, "color", ANN_TYPES.find(t => t.value === e.target.value)?.defaultColor || "#ffff00"); }}
                                            className="w-full rounded-lg border border-border bg-secondary/30 px-2 py-1.5 text-xs text-foreground focus:outline-none">
                                            {ANN_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="text-[9px] text-muted-foreground uppercase">Page</label>
                                        <input type="number" min={1} value={ann.page} onChange={e => update(ann.id, "page", +e.target.value)}
                                            className="w-full rounded-lg border border-border bg-secondary/30 px-2 py-1.5 text-xs text-foreground focus:outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-[9px] text-muted-foreground uppercase">Color</label>
                                        <input type="color" value={ann.color} onChange={e => update(ann.id, "color", e.target.value)}
                                            className="w-full h-7 rounded-lg border border-border cursor-pointer" />
                                    </div>
                                    <div>
                                        <label className="text-[9px] text-muted-foreground uppercase">X</label>
                                        <input type="number" min={0} value={ann.x} onChange={e => update(ann.id, "x", +e.target.value)}
                                            className="w-full rounded-lg border border-border bg-secondary/30 px-2 py-1.5 text-xs text-foreground focus:outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-[9px] text-muted-foreground uppercase">Y</label>
                                        <input type="number" min={0} value={ann.y} onChange={e => update(ann.id, "y", +e.target.value)}
                                            className="w-full rounded-lg border border-border bg-secondary/30 px-2 py-1.5 text-xs text-foreground focus:outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-[9px] text-muted-foreground uppercase">Width</label>
                                        <input type="number" min={10} value={ann.width} onChange={e => update(ann.id, "width", +e.target.value)}
                                            className="w-full rounded-lg border border-border bg-secondary/30 px-2 py-1.5 text-xs text-foreground focus:outline-none" />
                                    </div>
                                    <div>
                                        <label className="text-[9px] text-muted-foreground uppercase">Height</label>
                                        <input type="number" min={5} value={ann.height} onChange={e => update(ann.id, "height", +e.target.value)}
                                            className="w-full rounded-lg border border-border bg-secondary/30 px-2 py-1.5 text-xs text-foreground focus:outline-none" />
                                    </div>
                                </div>
                                {ann.type === "note" && (
                                    <input type="text" value={ann.text} onChange={e => update(ann.id, "text", e.target.value)}
                                        placeholder="Note text…"
                                        className="w-full rounded-lg border border-border bg-secondary/30 px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground/80 focus:outline-none" />
                                )}
                            </div>
                        ))}
                    </div>
                </>
            )}

            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle size={15} className="shrink-0" />{error}
                </div>
            )}

            {file && (
                <Button onClick={process} disabled={status === "processing" || annotations.length === 0} className="w-full glow-primary">
                    {status === "processing" ? <><Loader2 size={15} className="animate-spin" /> Annotating…</> : `Apply ${annotations.length} Annotation${annotations.length !== 1 ? "s" : ""}`}
                </Button>
            )}
        </div>
    );
}
