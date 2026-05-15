import { useState } from "react";
import { Download, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, downloadBlob } from "@/lib/api";
import { FileUploadZone, ProcessingBar } from "./FileUploadZone";

const STAMP_PRESETS = [
    { value: "confidential", label: "CONFIDENTIAL", color: "bg-red-500/20 text-red-400 border-red-500/30" },
    { value: "draft", label: "DRAFT", color: "bg-gray-500/20 text-gray-400 border-gray-500/30" },
    { value: "approved", label: "APPROVED", color: "bg-green-500/20 text-green-400 border-green-500/30" },
    { value: "final", label: "FINAL", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
    { value: "copy", label: "COPY", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
    { value: "void", label: "VOID", color: "bg-red-500/20 text-red-400 border-red-500/30" },
    { value: "sample", label: "SAMPLE", color: "bg-teal-500/20 text-teal-400 border-teal-500/30" },
    { value: "not_approved", label: "NOT APPROVED", color: "bg-red-500/20 text-red-400 border-red-500/30" },
    { value: "custom", label: "Custom…", color: "bg-accent/10 text-primary border-accent/30" },
];

const POSITIONS = [
    { value: "center", label: "Center" },
    { value: "diagonal", label: "Diagonal" },
    { value: "top", label: "Top" },
    { value: "bottom", label: "Bottom" },
];

export function StampUI() {
    const [file, setFile] = useState<File | null>(null);
    const [stampType, setStampType] = useState("confidential");
    const [customText, setCustomText] = useState("");
    const [opacity, setOpacity] = useState(30);
    const [position, setPosition] = useState("center");
    const [pages, setPages] = useState("all");
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);

    const process = async () => {
        if (!file) return;
        setStatus("processing");
        setError(null);
        try {
            const params: Record<string, string | number | boolean> = {
                stamp_type: stampType,
                opacity: opacity / 100,
                position,
                pages,
            };
            if (stampType === "custom" && customText.trim()) {
                params.custom_text = customText.trim();
            }
            const res = await uploadFile("/stamp-pdf", file, params);
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
        } catch (e: any) {
            setError(e.message || "Stamping failed");
            setStatus("idle");
        }
    };

    const handleDownload = () => {
        if (resultBlob) {
            const name = file ? file.name.replace(/\.pdf$/i, "_stamped.pdf") : "stamped.pdf";
            downloadBlob(resultBlob, name);
        }
    };

    if (status === "done") {
        return (
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
                <h2 className="text-lg font-bold text-foreground mb-1">Stamp Applied!</h2>
                <p className="text-sm text-muted-foreground mb-6">Your stamped PDF is ready</p>
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
            <FileUploadZone
                file={file}
                onFileSelect={setFile}
                onClear={() => setFile(null)}
                accept=".pdf"
                label="Drop PDF here"
                hint="Upload a PDF to stamp"
            />

            {file && (
                <>
                    {/* Stamp type */}
                    <div className="space-y-2">
                        <label className="text-sm font-semibold text-foreground">Stamp Type</label>
                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                            {STAMP_PRESETS.map(s => (
                                <button key={s.value} onClick={() => setStampType(s.value)}
                                    className={cn("rounded-lg border px-2 py-2 text-xs font-bold tracking-wide transition-all",
                                        stampType === s.value ? cn(s.color, "ring-1 ring-accent/30") : "border-border bg-card text-muted-foreground hover:border-accent/30"
                                    )}>
                                    {s.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Custom text */}
                    {stampType === "custom" && (
                        <div className="space-y-1">
                            <label className="text-xs font-medium text-muted-foreground">Custom Text</label>
                            <input type="text" value={customText} onChange={e => setCustomText(e.target.value)}
                                placeholder="Enter stamp text…" maxLength={30}
                                className="w-full rounded-xl border border-border bg-secondary/30 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/80 focus:border-accent/50 focus:outline-none" />
                        </div>
                    )}

                    {/* Opacity */}
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <label className="text-xs font-medium text-muted-foreground">Opacity</label>
                            <span className="text-xs text-muted-foreground">{opacity}%</span>
                        </div>
                        <input type="range" min={5} max={100} value={opacity} onChange={e => setOpacity(+e.target.value)}
                            className="w-full accent-foreground" />
                    </div>

                    {/* Position */}
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground">Position</label>
                        <div className="flex gap-2 flex-wrap">
                            {POSITIONS.map(p => (
                                <button key={p.value} onClick={() => setPosition(p.value)}
                                    className={cn("rounded-lg border px-3 py-1.5 text-xs font-medium transition-all",
                                        position === p.value ? "border-accent bg-accent/10 text-primary" : "border-border text-muted-foreground hover:border-accent/30")}>
                                    {p.label}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Pages */}
                    <div className="space-y-1">
                        <label className="text-xs font-medium text-muted-foreground">Apply to Pages</label>
                        <input type="text" value={pages} onChange={e => setPages(e.target.value)}
                            placeholder="all or 1,3,5"
                            className="w-full rounded-xl border border-border bg-secondary/30 px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/80 focus:border-accent/50 focus:outline-none" />
                        <p className="text-[10px] text-muted-foreground/80">Type "all" for every page, or comma-separated numbers like 1,3,5</p>
                    </div>
                </>
            )}

            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle size={15} className="shrink-0" />{error}
                </div>
            )}

            {status === "processing" && <ProcessingBar label="Applying stamp to your PDF…" />}

            {file && status !== "processing" && (
                <div className="flex items-center gap-3">
                    <Button onClick={process} disabled={stampType === "custom" && !customText.trim()} className="glow-primary">
                        Apply Stamp
                    </Button>
                    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setFile(null)}>Clear</Button>
                </div>
            )}
        </div>
    );
}
