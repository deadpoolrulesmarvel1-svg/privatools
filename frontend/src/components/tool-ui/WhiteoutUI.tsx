import { useState, useRef } from "react";
import { Upload, Download, Loader2, AlertCircle, Plus, Trash2, Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";

interface Region {
    id: string;
    page: number;
    x: number;
    y: number;
    width: number;
    height: number;
}

const makeId = () => Math.random().toString(36).slice(2, 8);

export function WhiteoutUI() {
    const [file, setFile] = useState<File | null>(null);
    const [regions, setRegions] = useState<Region[]>([
        { id: makeId(), page: 1, x: 100, y: 100, width: 200, height: 30 },
    ]);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const addRegion = () => {
        setRegions(prev => [...prev, { id: makeId(), page: 1, x: 100, y: 150 + prev.length * 40, width: 200, height: 30 }]);
    };

    const removeRegion = (id: string) => setRegions(prev => prev.filter(r => r.id !== id));

    const update = (id: string, field: keyof Region, value: number) => {
        setRegions(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    };

    const process = async () => {
        if (!file || regions.length === 0) return;
        setStatus("processing");
        setError(null);
        try {
            const regionList = regions.map(({ id, ...rest }) => rest);
            const res = await uploadFile("/whiteout-pdf", file, {
                regions: JSON.stringify(regionList),
            });
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
        } catch (e: any) {
            setError(e.message || "White-out failed");
            setStatus("idle");
        }
    };

    const handleDownload = () => {
        if (resultBlob) {
            const name = file ? file.name.replace(/\.pdf$/i, "_whiteout.pdf") : "whiteout.pdf";
            downloadBlob(resultBlob, name);
        }
    };

    if (status === "done") {
        return (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
                <Eraser size={32} className="mx-auto mb-3 text-emerald-400" />
                <h2 className="text-lg font-bold text-foreground mb-1">Content Erased!</h2>
                <p className="text-sm text-muted-foreground mb-6">{regions.length} region(s) covered with white</p>
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
                        <label className="text-sm font-semibold text-foreground">White-Out Regions</label>
                        <Button variant="ghost" size="sm" onClick={addRegion} className="text-primary text-xs">
                            <Plus size={13} /> Add Region
                        </Button>
                    </div>

                    <div className="rounded-xl border border-border bg-card/50 p-3">
                        <p className="text-[10px] text-muted-foreground mb-2">Define rectangular areas to cover with white. Coordinates are in PDF points from the top-left corner.</p>
                        <div className="space-y-2">
                            {regions.map((r, idx) => (
                                <div key={r.id} className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[10px] text-muted-foreground w-5 shrink-0 font-medium">{idx + 1}.</span>
                                    <div className="flex items-center gap-1">
                                        <label className="text-[9px] text-muted-foreground">Pg</label>
                                        <input type="number" min={1} value={r.page} onChange={e => update(r.id, "page", +e.target.value)}
                                            className="w-12 rounded border border-border bg-secondary/30 px-1.5 py-1 text-[11px] text-foreground focus:outline-none text-center" />
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <label className="text-[9px] text-muted-foreground">X</label>
                                        <input type="number" min={0} value={r.x} onChange={e => update(r.id, "x", +e.target.value)}
                                            className="w-14 rounded border border-border bg-secondary/30 px-1.5 py-1 text-[11px] text-foreground focus:outline-none text-center" />
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <label className="text-[9px] text-muted-foreground">Y</label>
                                        <input type="number" min={0} value={r.y} onChange={e => update(r.id, "y", +e.target.value)}
                                            className="w-14 rounded border border-border bg-secondary/30 px-1.5 py-1 text-[11px] text-foreground focus:outline-none text-center" />
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <label className="text-[9px] text-muted-foreground">W</label>
                                        <input type="number" min={10} value={r.width} onChange={e => update(r.id, "width", +e.target.value)}
                                            className="w-14 rounded border border-border bg-secondary/30 px-1.5 py-1 text-[11px] text-foreground focus:outline-none text-center" />
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <label className="text-[9px] text-muted-foreground">H</label>
                                        <input type="number" min={5} value={r.height} onChange={e => update(r.id, "height", +e.target.value)}
                                            className="w-14 rounded border border-border bg-secondary/30 px-1.5 py-1 text-[11px] text-foreground focus:outline-none text-center" />
                                    </div>
                                    <button onClick={() => removeRegion(r.id)} className="text-muted-foreground hover:text-destructive ml-auto"><Trash2 size={12} /></button>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}

            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle size={15} className="shrink-0" />{error}
                </div>
            )}

            {file && (
                <Button onClick={process} disabled={status === "processing" || regions.length === 0} className="w-full glow-primary">
                    {status === "processing" ? <><Loader2 size={15} className="animate-spin" /> Erasing…</> : `Apply ${regions.length} White-Out${regions.length !== 1 ? "s" : ""}`}
                </Button>
            )}
        </div>
    );
}
