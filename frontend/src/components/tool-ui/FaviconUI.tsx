import { useState, useRef } from "react";
import { Upload, Download, Loader2, AlertCircle, Image, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob, formatFileSize, buildOutputFilename } from "@/lib/api";

const SIZES = [
    { value: 16, label: "16×16", desc: "Classic favicon" },
    { value: 32, label: "32×32", desc: "Standard" },
    { value: 48, label: "48×48", desc: "Windows" },
    { value: 64, label: "64×64", desc: "High DPI" },
    { value: 128, label: "128×128", desc: "Touch icon" },
    { value: 180, label: "180×180", desc: "Apple Touch" },
    { value: 192, label: "192×192", desc: "Android" },
    { value: 512, label: "512×512", desc: "PWA" },
];

export function FaviconUI() {
    const [file, setFile] = useState<File | null>(null);
    const [previewSrc, setPreviewSrc] = useState<string | null>(null);
    const [selectedSizes, setSelectedSizes] = useState<number[]>([16, 32, 48, 180]);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const handleFile = (f: File) => {
        setFile(f);
        const reader = new FileReader();
        reader.onload = () => setPreviewSrc(reader.result as string);
        reader.readAsDataURL(f);
    };

    const toggleSize = (size: number) => {
        setSelectedSizes(prev =>
            prev.includes(size) ? prev.filter(s => s !== size) : [...prev, size].sort((a, b) => a - b)
        );
    };

    const process = async () => {
        if (!file || selectedSizes.length === 0) return;
        setStatus("processing"); setError(null);
        try {
            const res = await uploadFile("/generate-favicon", file, { sizes: selectedSizes.join(",") });
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
            downloadBlob(blob, buildOutputFilename(file?.name, "favicon", "ico"));
        } catch (e: any) { setError(e.message || "Generation failed"); setStatus("idle"); }
    };

    if (status === "done") return (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-8 text-center">
            <Image size={28} className="mx-auto mb-3 text-emerald-400" />
            <h2 className="text-lg font-bold text-foreground mb-1">Favicon Generated!</h2>
            <p className="text-sm text-muted-foreground mb-2">{selectedSizes.length} size(s): {selectedSizes.map(s => `${s}×${s}`).join(", ")}</p>
            <div className="flex justify-center gap-3 flex-wrap mt-4">
                <Button className="glow-primary" onClick={() => resultBlob && downloadBlob(resultBlob, buildOutputFilename(file?.name, "favicon", "ico"))}><Download size={15} /> Download</Button>
                <Button variant="outline" onClick={() => { setFile(null); setPreviewSrc(null); setStatus("idle"); setResultBlob(null); }}>Generate another</Button>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
                onClick={() => ref.current?.click()}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
          role="button"
          tabIndex={0}
          aria-label="Upload file"
                className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-10 px-6 text-center",
                    drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 bg-secondary/20")}>
                <input ref={ref} type="file" accept=".png,.jpg,.jpeg,.svg,.webp" className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
                <Upload size={22} className={drag ? "text-primary" : "text-muted-foreground"} />
                <p className="text-sm font-semibold text-foreground">{file ? file.name : "Drop image here"}</p>
                {file && <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>}
                <p className="text-[11px] text-muted-foreground/80">PNG, JPG, SVG or WebP · Square images work best</p>
            </div>

            {previewSrc && (
                <div className="flex items-center gap-4 rounded-xl border border-border bg-card p-3">
                    <img src={previewSrc} alt="Preview" className="h-16 w-16 rounded-lg object-contain border border-border" />
                    <div>
                        <p className="text-sm font-semibold text-foreground">Source Image</p>
                        <p className="text-xs text-muted-foreground">Will be resized to selected favicon sizes</p>
                    </div>
                </div>
            )}

            {file && (
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <label className="text-sm font-semibold text-foreground">Output Sizes</label>
                        <span className="text-xs text-muted-foreground">{selectedSizes.length} selected</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {SIZES.map(s => {
                            const active = selectedSizes.includes(s.value);
                            return (
                                <button key={s.value} onClick={() => toggleSize(s.value)}
                                    className={cn("relative rounded-xl border px-3 py-2.5 text-center transition-all",
                                        active ? "border-accent bg-accent/10 ring-1 ring-accent/20" : "border-border bg-card hover:border-accent/30")}>
                                    {active && <Check size={10} className="absolute top-1.5 right-1.5 text-primary" />}
                                    <div className={cn("text-sm font-bold", active ? "text-primary" : "text-foreground")}>{s.label}</div>
                                    <div className="text-[9px] text-muted-foreground">{s.desc}</div>
                                </button>
                            );
                        })}
                    </div>
                    <div className="flex gap-2 pt-1">
                        <button onClick={() => setSelectedSizes([16, 32, 48, 180])} className="text-[10px] text-primary hover:underline">Web essentials</button>
                        <span className="text-muted-foreground text-[10px]">·</span>
                        <button onClick={() => setSelectedSizes(SIZES.map(s => s.value))} className="text-[10px] text-primary hover:underline">Select all</button>
                        <span className="text-muted-foreground text-[10px]">·</span>
                        <button onClick={() => setSelectedSizes([])} className="text-[10px] text-muted-foreground hover:underline">Clear</button>
                    </div>
                </div>
            )}

            {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}

            {file && (
                <Button onClick={process} disabled={status === "processing" || selectedSizes.length === 0} className="w-full glow-primary">
                    {status === "processing" ? <><Loader2 size={15} className="animate-spin" /> Generating…</> : `Generate ${selectedSizes.length} Favicon${selectedSizes.length !== 1 ? "s" : ""}`}
                </Button>
            )}
        </div>
    );
}
