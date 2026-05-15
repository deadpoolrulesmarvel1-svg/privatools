import { useState, useRef } from "react";
import { Upload, Download, Loader2, CheckCircle2, X, FileText, AlertCircle, RotateCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize } from "@/lib/api";

type Angle = 90 | 180 | 270;

const angles: { value: Angle; label: string; desc: string; icon: typeof RotateCw }[] = [
    { value: 90, label: "90° Right", desc: "Quarter turn clockwise", icon: RotateCw },
    { value: 180, label: "180°", desc: "Half turn (upside down)", icon: RotateCw },
    { value: 270, label: "90° Left", desc: "Quarter turn counter-clockwise", icon: RotateCcw },
];

export function RotateUI() {
    const [file, setFile] = useState<{ name: string; size: string; raw: File } | null>(null);
    const [angle, setAngle] = useState<Angle>(90);
    const [pages, setPages] = useState("all");
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const pick = (fl: FileList) => {
        const f = fl[0];
        setFile({ name: f.name, size: formatFileSize(f.size), raw: f });
        setState("idle");
        setError(null);
    };

    const process = async () => {
        if (!file) return;
        setState("processing");
        setError(null);
        try {
            const res = await uploadFile("/rotate", file.raw, { angle, pages: pages.trim() || "all" });
            const blob = await res.blob();
            setResultBlob(blob);
            setState("done");
        } catch (e: any) {
            setError(e.message || "Rotation failed");
            setState("idle");
        }
    };

    const handleDownload = () => {
        if (resultBlob) downloadBlob(resultBlob, file ? `${file.name.replace(/\.pdf$/i, "")}_rotated.pdf` : "rotated.pdf");
    };

    if (state === "done") return (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
            <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
            <h2 className="text-lg font-bold text-foreground mb-1">Rotated!</h2>
            <p className="text-sm text-muted-foreground mb-6">Your PDF pages have been rotated {angle}°.</p>
            <div className="flex justify-center gap-3 flex-wrap">
                <Button className="glow-primary" onClick={handleDownload}><Download size={15} />Download Rotated PDF</Button>
                <Button variant="outline" className="border-border text-muted-foreground"
                    onClick={() => { setFile(null); setState("idle"); setResultBlob(null); }}>Rotate another</Button>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            {!file ? (
                <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                    onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) pick(e.dataTransfer.files); }}
                    onClick={() => ref.current?.click()}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
          role="button"
          tabIndex={0}
          aria-label="Upload file"
                    className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-14 px-6 text-center",
                        drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 hover:bg-secondary/40 bg-secondary/20")}>
                    <input ref={ref} type="file" accept=".pdf" className="hidden" onChange={e => e.target.files && pick(e.target.files)} />
                    <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", drag ? "bg-accent/20" : "bg-secondary")}>
                        <Upload size={22} className={drag ? "text-primary" : "text-muted-foreground"} strokeWidth={1.5} />
                    </div>
                    <p className="text-sm font-semibold text-foreground">Select a PDF to rotate</p>
                    <p className="text-xs text-muted-foreground">Rotate all or specific pages by any angle</p>
                </div>
            ) : (
                <>
                    {/* File */}
                    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary"><FileText size={14} className="text-muted-foreground" /></div>
                        <div className="flex-1 min-w-0"><p className="text-sm font-medium text-foreground truncate">{file.name}</p><p className="text-xs text-muted-foreground">{file.size}</p></div>
                        <button onClick={() => setFile(null)} className="text-muted-foreground hover:text-foreground"><X size={15} /></button>
                    </div>

                    {/* Rotation angle */}
                    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                        <p className="text-sm font-semibold text-foreground">Rotation Angle</p>
                        <div className="grid grid-cols-3 gap-2">
                            {angles.map(a => {
                                const Icon = a.icon;
                                return (
                                    <button key={a.value} onClick={() => setAngle(a.value)}
                                        className={cn("flex flex-col items-center gap-1 rounded-xl border p-3 transition-all",
                                            angle === a.value ? "border-accent bg-accent/5" : "border-border hover:border-border/70 hover:bg-secondary/40")}>
                                        <Icon size={20} className={angle === a.value ? "text-primary" : "text-muted-foreground"} />
                                        <p className={cn("text-sm font-medium", angle === a.value ? "text-primary" : "text-foreground")}>{a.label}</p>
                                        <p className="text-[11px] text-muted-foreground">{a.desc}</p>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Page range */}
                    <div className="rounded-xl border border-border bg-card p-5 space-y-3">
                        <p className="text-sm font-semibold text-foreground">Pages to Rotate</p>
                        <div className="flex gap-2">
                            <button onClick={() => setPages("all")}
                                className={cn("flex-1 rounded-xl border py-2.5 text-center text-sm transition-all",
                                    pages === "all" ? "border-accent bg-accent/5 text-primary font-semibold" : "border-border text-muted-foreground hover:bg-secondary/40")}>
                                All Pages
                            </button>
                            <button onClick={() => { if (pages === "all") setPages(""); }}
                                className={cn("flex-1 rounded-xl border py-2.5 text-center text-sm transition-all",
                                    pages !== "all" ? "border-accent bg-accent/5 text-primary font-semibold" : "border-border text-muted-foreground hover:bg-secondary/40")}>
                                Specific Pages
                            </button>
                        </div>
                        {pages !== "all" && (
                            <div className="space-y-1.5">
                                <input
                                    type="text"
                                    value={pages}
                                    onChange={e => setPages(e.target.value)}
                                    placeholder="e.g. 1,3,5-8"
                                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/80 focus:outline-none focus:ring-1 focus:ring-accent"
                                />
                                <p className="text-[11px] text-muted-foreground">Enter page numbers separated by commas, or ranges like 1-5</p>
                            </div>
                        )}
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                            <AlertCircle size={15} className="shrink-0" />{error}
                        </div>
                    )}

                    <Button onClick={process} disabled={state === "processing"} className="glow-primary">
                        {state === "processing" ? <><Loader2 size={15} className="animate-spin" />Rotating…</> : `Rotate ${angle}°`}
                    </Button>
                </>
            )}
        </div>
    );
}
