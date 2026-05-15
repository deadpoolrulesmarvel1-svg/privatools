import { useState, useRef } from "react";
import { Loader2, AlertCircle, QrCode, Copy, Check, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFileGetJson } from "@/lib/api";

interface QrResult { data: string; type: string; rect: { left: number; top: number; width: number; height: number } }

export function QrReaderUI() {
    const [file, setFile] = useState<File | null>(null);
    const [preview, setPreview] = useState<string | null>(null);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [codes, setCodes] = useState<QrResult[]>([]);
    const [copied, setCopied] = useState<number | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const pick = (fl: FileList) => {
        const f = fl[0];
        if (!f) return;
        setFile(f);
        setPreview(URL.createObjectURL(f));
        setState("idle");
        setError(null);
        setCodes([]);
    };

    const process = async () => {
        if (!file) return;
        setState("processing"); setError(null);
        try {
            const res = await uploadFileGetJson<{ codes: QrResult[] }>("/read-qr", file);
            setCodes(res.codes);
            if (res.codes.length === 0) setError("No QR codes or barcodes found in this image.");
            setState("done");
        } catch (e: any) { setError(e.message || "Failed to read QR code"); setState("idle"); }
    };

    const copyToClipboard = async (text: string, idx: number) => {
        await navigator.clipboard.writeText(text);
        setCopied(idx);
        setTimeout(() => setCopied(null), 2000);
    };

    return (
        <div className="space-y-4">
            <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) pick(e.dataTransfer.files); }}
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button" tabIndex={0} aria-label="Upload image"
                className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-14 px-6 text-center",
                    drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 hover:bg-secondary/40 bg-secondary/20")}>
                <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.webp,.bmp" className="hidden" onChange={e => { if (e.target.files) pick(e.target.files); e.target.value = ""; }} />
                <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", drag ? "bg-accent/20" : "bg-secondary")}>
                    <QrCode size={22} className={drag ? "text-primary" : "text-muted-foreground"} strokeWidth={1.5} />
                </div>
                <p className="text-sm font-semibold text-foreground">{file ? "Change image" : "Upload an image with a QR code"}</p>
                <p className="text-xs text-muted-foreground">JPG, PNG, WebP, BMP</p>
            </div>

            {preview && (
                <div className="rounded-xl border border-border bg-card p-3 flex justify-center">
                    <img src={preview} alt="Preview" className="max-h-48 rounded-lg object-contain" />
                </div>
            )}

            {file && state !== "done" && (
                <Button onClick={process} disabled={state === "processing"} className="glow-primary">
                    {state === "processing" ? <><Loader2 size={15} className="animate-spin" />Scanning…</> : "Scan for QR Codes"}
                </Button>
            )}

            {error && <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"><AlertCircle size={15} className="shrink-0" />{error}</div>}

            {codes.length > 0 && (
                <div className="space-y-2">
                    <p className="text-sm font-semibold text-foreground">Found {codes.length} code{codes.length > 1 ? "s" : ""}:</p>
                    {codes.map((c, i) => (
                        <div key={i} className="flex items-start gap-3 rounded-xl border border-border bg-card px-4 py-3">
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-muted-foreground uppercase">{c.type}</p>
                                <p className="text-sm text-foreground break-all mt-0.5">{c.data}</p>
                            </div>
                            <button onClick={() => copyToClipboard(c.data, i)} className="shrink-0 text-muted-foreground hover:text-foreground mt-1">
                                {copied === i ? <Check size={15} className="text-emerald-400" /> : <Copy size={15} />}
                            </button>
                        </div>
                    ))}
                    <Button variant="outline" className="border-border text-muted-foreground" onClick={() => { setFile(null); setPreview(null); setState("idle"); setCodes([]); setError(null); }}>Scan another</Button>
                </div>
            )}
        </div>
    );
}
