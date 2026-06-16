/**
 * BarcodeGeneratorUI — generate Code128 / 39 / EAN / UPC / ISBN / QR.
 * Workshop: type gallery + data input + preview with format-aware validation.
 */
import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, AlertCircle, Hash, QrCode, RotateCcw, Sparkles } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { postFormData } from "@/lib/api";

const BARCODE_TYPES = [
    { value: "code128", label: "Code 128", desc: "General purpose" },
    { value: "code39",  label: "Code 39",  desc: "Alphanumeric" },
    { value: "ean13",   label: "EAN-13",   desc: "Retail" },
    { value: "ean8",    label: "EAN-8",    desc: "Small items" },
    { value: "upca",    label: "UPC-A",    desc: "US/Canada" },
    { value: "isbn13",  label: "ISBN-13",  desc: "Books" },
    { value: "qr",      label: "QR Code",  desc: "Any text/URL" },
];

// Per-format validation. Returns null if the input is acceptable, or a
// human-readable error.
function validateBarcodeInput(type: string, raw: string): string | null {
    const value = raw.trim();
    if (!value) return "Please enter barcode data";
    const digitsOnly = (s: string) => /^\d+$/.test(s);
    switch (type) {
        case "ean13":  return digitsOnly(value) && value.length === 12 ? null : "EAN-13 needs exactly 12 digits (check digit auto-added).";
        case "ean8":   return digitsOnly(value) && value.length === 7  ? null : "EAN-8 needs exactly 7 digits (check digit auto-added).";
        case "upca":   return digitsOnly(value) && value.length === 11 ? null : "UPC-A needs exactly 11 digits (check digit auto-added).";
        case "isbn13": return digitsOnly(value) && value.length === 12 ? null : "ISBN-13 needs 12 digits (check digit auto-added).";
        case "code39": return /^[A-Z0-9\-. $/+%]+$/.test(value) ? null : "Code 39 allows uppercase A-Z, 0-9, and -.$/+% only.";
        case "code128":return value.length > 0 ? null : "Please enter barcode data";
        case "qr":     return value.length <= 4296 ? null : "QR text exceeds the 4,296 character limit.";
        default:       return null;
    }
}

export function BarcodeGeneratorUI() {
    const [data, setData] = useState("");
    const [barcodeType, setBarcodeType] = useState("code128");
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);

    // Revoke an outstanding preview blob URL on unmount or when a new one
    // replaces it.
    useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

    // Live validation that informs the CTA, not the error banner. The banner
    // only appears on submit failure so users can experiment without noise.
    const validationError = validateBarcodeInput(barcodeType, data);

    const canProcess = !validationError && status !== "processing";

    const generate = useCallback(async () => {
        const v = validateBarcodeInput(barcodeType, data);
        if (v) { setError(v); return; }
        setStatus("processing"); setError(null);
        try {
            const res = await postFormData("/generate-barcode", () => {
                const fd = new FormData();
                fd.append("data", data.trim());
                fd.append("barcode_type", barcodeType);
                return fd;
            });
            const blob = await res.blob();
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            setPreviewUrl(URL.createObjectURL(blob));
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Generation failed";
            setError(friendlyError(msg, "Couldn't generate that barcode."));
            setStatus("idle");
        }
    }, [barcodeType, data, previewUrl]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); generate(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, generate]);

    const download = () => {
        if (!previewUrl) return;
        const a = document.createElement("a");
        a.href = previewUrl;
        a.download = `barcode_${barcodeType}.png`;
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
    };

    const reset = () => {
        setData(""); setBarcodeType("code128"); setStatus("idle"); setError(null);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(null);
    };

    const hint = (t: string) =>
        t === "ean13"  ? "12 digits · check digit auto"
      : t === "ean8"   ? "7 digits"
      : t === "upca"   ? "11 digits"
      : t === "isbn13" ? "12 digits"
      : t === "qr"     ? "Any text / URL up to 4296 chars"
      : "Alphanumeric text supported";

    if (status === "done" && previewUrl) {
        return (
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
                <div className="relative p-7 sm:p-9 animate-corner-extend">
                    <CornerMarks />
                    <div className="flex items-start gap-5">
                        <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                            {barcodeType === "qr"
                                ? <QrCode size={24} className="text-accent" strokeWidth={1.75} />
                                : <Hash size={24} className="text-accent" strokeWidth={1.75} />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">Barcode rendered</p>
                            <h2 className="font-display text-[22px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                <span className="italic text-accent">{BARCODE_TYPES.find(t => t.value === barcodeType)?.label}</span>
                            </h2>
                            <div className="mt-3 rounded-lg border border-border bg-white p-3 inline-block max-w-full">
                                <img src={previewUrl} alt="Generated barcode" className="max-h-44 max-w-full object-contain" />
                            </div>
                            <p className="font-mono text-[10.5px] tracking-[0.04em] text-muted-foreground mt-2 break-all">
                                <span className="text-accent">§</span> {data}
                            </p>
                            <div className="mt-5 flex flex-wrap gap-2">
                                <button onClick={download} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                    <Download size={13} /> Download PNG
                                </button>
                                <button onClick={reset} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors">
                                    <RotateCcw size={12} /> Generate another
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                    <span className="text-accent">§</span> Format
                </div>
                <div className="p-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {BARCODE_TYPES.map(t => {
                        const active = barcodeType === t.value;
                        return (
                            <button
                                key={t.value}
                                onClick={() => setBarcodeType(t.value)}
                                aria-pressed={active}
                                aria-label={`Barcode format ${t.label}`}
                                className={cn(
                                    "min-h-[60px] rounded-lg border p-3 text-left transition-colors",
                                    active ? "border-accent bg-accent/[0.06]" : "border-border hover:border-border-strong hover:bg-secondary/40"
                                )}
                            >
                                <div className="flex items-center gap-1.5">
                                    {t.value === "qr" ? <QrCode size={11} className="text-accent" /> : <Hash size={11} className="text-muted-foreground" />}
                                    <p className={cn("font-display text-[13px] font-semibold tracking-[-0.015em]", active ? "text-accent" : "text-foreground")}>{t.label}</p>
                                </div>
                                <p className="font-mono text-[9.5px] tracking-[0.04em] uppercase text-muted-foreground/85 mt-1">{t.desc}</p>
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                    <span className="text-accent">§</span> Data
                </div>
                <div className="p-4 space-y-2">
                    <input
                        type="text" value={data} onChange={e => setData(e.target.value)}
                        placeholder={barcodeType === "qr" ? "https://example.com" : "Barcode value"}
                        aria-label={`Barcode data for ${BARCODE_TYPES.find(t => t.value === barcodeType)?.label}`}
                        aria-invalid={!!validationError && data.length > 0}
                        className={cn(
                            "w-full rounded-md border bg-card px-3 py-2.5 font-mono text-[14px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 transition-colors",
                            validationError && data.length > 0
                                ? "border-destructive/60 focus:border-destructive focus:ring-destructive/20"
                                : "border-border focus:border-accent focus:ring-accent/20"
                        )}
                    />
                    <p className={cn(
                        "font-mono text-[10px] tracking-[0.04em] uppercase",
                        validationError && data.length > 0 ? "text-destructive" : "text-muted-foreground/85"
                    )}>
                        <span className={validationError && data.length > 0 ? "text-destructive" : "text-accent"}>§</span>{" "}
                        {validationError && data.length > 0 ? validationError : hint(barcodeType)}
                    </p>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            <div className="flex items-center gap-3 flex-wrap">
                <button
                    onClick={generate}
                    disabled={!canProcess}
                    className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Rendering…</> : <><Sparkles size={13} /> Generate {BARCODE_TYPES.find(t => t.value === barcodeType)?.label}</>}
                </button>
                {canProcess && (
                    <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                )}
            </div>
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
