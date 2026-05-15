import { useState, useRef } from "react";
import { Upload, Download, Loader2, AlertCircle, FileText, X, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { downloadBlob, formatFileSize, buildOutputFilename } from "@/lib/api";

const API_BASE = "/api";

const MODES = [
    { value: "overlay", label: "Overlay", desc: "Place second PDF on top of the first" },
    { value: "stamp", label: "Stamp", desc: "Place second PDF as background" },
];

export function OverlayUI() {
    const [file1, setFile1] = useState<{ name: string; size: string; raw: File } | null>(null);
    const [file2, setFile2] = useState<{ name: string; size: string; raw: File } | null>(null);
    const [mode, setMode] = useState<"overlay" | "stamp">("overlay");
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const ref1 = useRef<HTMLInputElement>(null);
    const ref2 = useRef<HTMLInputElement>(null);

    const process = async () => {
        if (!file1 || !file2) return;
        setState("processing"); setError(null);
        try {
            const fd = new FormData();
            fd.append("base_file", file1.raw);
            fd.append("overlay_file", file2.raw);
            fd.append("mode", mode);
            const res = await fetch(`${API_BASE}/overlay`, { method: "POST", body: fd });
            if (!res.ok) { const b = await res.json().catch(() => ({ detail: "Failed" })); throw new Error(b.detail); }
            const blob = await res.blob();
            setResultBlob(blob);
            downloadBlob(blob, buildOutputFilename(file1?.name, "overlay", "pdf"));
            setState("done");
        } catch (e: any) { setError(e.message || "Overlay failed"); setState("idle"); }
    };

    const FileBox = ({ label, file, setFile, inputRef, description }: {
        label: string; file: typeof file1; setFile: (f: typeof file1) => void;
        inputRef: React.RefObject<HTMLInputElement>; description: string;
    }) => (
        <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
            <p className="text-[10px] text-muted-foreground/80 mb-2">{description}</p>
            {!file ? (
                <div onClick={() => inputRef.current?.click()}
                    className="flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border hover:border-accent/40 cursor-pointer py-8 transition-all bg-secondary/20 hover:bg-secondary/40">
                    <input ref={inputRef as any} type="file" accept=".pdf" className="hidden" onChange={e => { if (e.target.files?.[0]) { const f = e.target.files[0]; setFile({ name: f.name, size: formatFileSize(f.size), raw: f }); } }} />
                    <Upload size={18} className="text-muted-foreground" /><span className="text-sm text-muted-foreground">Select PDF</span>
                </div>
            ) : (
                <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-secondary"><FileText size={13} className="text-muted-foreground" /></div>
                    <div className="flex-1 min-w-0"><p className="text-sm font-medium text-foreground truncate">{file.name}</p><p className="text-xs text-muted-foreground">{file.size}</p></div>
                    <button onClick={() => setFile(null)} className="text-muted-foreground hover:text-foreground"><X size={14} /></button>
                </div>
            )}
        </div>
    );

    if (state === "done") return (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
            <Layers size={32} className="mx-auto mb-3 text-emerald-400" />
            <h2 className="text-lg font-bold text-foreground mb-1">Overlay Complete!</h2>
            <p className="text-sm text-muted-foreground mb-6">Your combined PDF has been downloaded</p>
            <div className="flex justify-center gap-3 flex-wrap">
                <Button className="glow-primary" onClick={() => resultBlob && downloadBlob(resultBlob, buildOutputFilename(file1?.name, "overlay", "pdf"))}><Download size={15} /> Download Again</Button>
                <Button variant="outline" onClick={() => { setFile1(null); setFile2(null); setState("idle"); setResultBlob(null); }}>Overlay more</Button>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <FileBox label="Base PDF" description="The main document (bottom layer)" file={file1} setFile={setFile1} inputRef={ref1} />
                <FileBox label="Overlay PDF" description="Placed on top of the base" file={file2} setFile={setFile2} inputRef={ref2} />
            </div>

            {(file1 || file2) && (
                <div className="rounded-xl border border-border bg-card p-4 space-y-4">
                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-foreground">Overlay Mode</label>
                        <div className="grid grid-cols-2 gap-2">
                            {MODES.map(m => (
                                <button key={m.value} onClick={() => setMode(m.value as "overlay" | "stamp")}
                                    className={cn("rounded-xl border px-3 py-2.5 text-center transition-all",
                                        mode === m.value ? "border-accent bg-accent/10 ring-1 ring-accent/20" : "border-border hover:border-accent/30")}>
                                    <div className={cn("text-xs font-bold", mode === m.value ? "text-primary" : "text-foreground")}>{m.label}</div>
                                    <div className="text-[9px] text-muted-foreground">{m.desc}</div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}
            <Button onClick={process} disabled={state === "processing" || !file1 || !file2} className="glow-primary">
                {state === "processing" ? <><Loader2 size={15} className="animate-spin" />Processing…</> : "Overlay PDFs"}
            </Button>
        </div>
    );
}
