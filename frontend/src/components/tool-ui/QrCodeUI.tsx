/**
 * QrCodeUI — generate QR codes with workshop aesthetic.
 *
 * Workshop touches: mono URL input that previews like a code editor,
 * size slider with px counter, format pill toggle, prominent QR preview
 * placeholder with corner registration marks. Optional foreground/background
 * colours and embedded centre logo are forwarded to the backend renderer.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle, Download, QrCode, Link as LinkIcon, ImagePlus, X } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { downloadBlob, postFormData } from "@/lib/api";

export function QrCodeUI() {
    const [data, setData] = useState("");
    const [size, setSize] = useState(300);
    const [format, setFormat] = useState<"png" | "pdf">("png");
    const [fgColor, setFgColor] = useState("#000000");
    const [bgColor, setBgColor] = useState("#ffffff");
    const [logo, setLogo] = useState<File | null>(null);
    const [logoPreview, setLogoPreview] = useState<string | null>(null);
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const logoInputRef = useRef<HTMLInputElement>(null);

    // Build & revoke the logo thumbnail URL alongside selection.
    useEffect(() => {
        if (!logo) { setLogoPreview(null); return; }
        const url = URL.createObjectURL(logo);
        setLogoPreview(url);
        return () => URL.revokeObjectURL(url);
    }, [logo]);

    const canProcess = !!data.trim() && state !== "processing";

    const process = useCallback(async () => {
        if (!data.trim()) return;
        setState("processing");
        setError(null);
        try {
            const res = await postFormData("/qr-code", () => {
                const fd = new FormData();
                fd.append("data", data);
                fd.append("size", String(size));
                fd.append("format", format);
                fd.append("fg_color", fgColor);
                fd.append("bg_color", bgColor);
                if (logo) fd.append("logo", logo);
                return fd;
            });
            const blob = await res.blob();
            downloadBlob(blob, format === "pdf" ? "qr_code.pdf" : "qr_code.png");
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't generate that QR code."));
            setState("idle");
        }
    }, [data, size, format, fgColor, bgColor, logo]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    if (state === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks accent />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">QR generated</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">QR code</span> downloaded.
                        </h2>
                        <button
                            onClick={() => { setState("idle"); setData(""); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            Generate another
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-4 items-start">
                {/* Left: input + options */}
                <div className="space-y-4">
                    {/* URL / data input — code-editor styled */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-3 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span><span className="text-accent">§</span> Data</span>
                            {data && <span>{data.length} char{data.length !== 1 ? "s" : ""}</span>}
                        </div>
                        <div className="flex items-center gap-2 px-3 py-2">
                            <LinkIcon size={13} className="text-muted-foreground shrink-0" />
                            <input
                                value={data}
                                onChange={e => setData(e.target.value)}
                                placeholder="https://example.com  or  any text"
                                className="flex-1 bg-transparent outline-none font-mono text-[14px] text-foreground placeholder:text-muted-foreground/50"
                                spellCheck={false}
                            />
                        </div>
                    </div>

                    {/* Options panel */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span className="text-accent">§</span> Options
                        </div>
                        <div className="p-5 space-y-5">
                            {/* Size */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <label className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">Size</label>
                                    <span className="font-mono text-[12px] text-accent tabular-nums">{size}px</span>
                                </div>
                                <input
                                    type="range" min={100} max={1200} value={size}
                                    onChange={e => setSize(parseInt(e.target.value, 10))}
                                    aria-label={`QR code size: ${size} pixels`}
                                    className="w-full accent-[hsl(var(--accent))]"
                                />
                                <div className="mt-1 flex justify-between font-mono text-[9.5px] text-muted-foreground/85">
                                    <span>100</span><span>400</span><span>800</span><span>1200</span>
                                </div>
                            </div>

                            {/* Format */}
                            <div>
                                <label className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">Format</label>
                                <div role="tablist" aria-label="Format" className="inline-flex rounded-md border border-border bg-paper-2/40 p-0.5 mt-1.5 ml-3">
                                    {(["png", "pdf"] as const).map(f => {
                                        const active = format === f;
                                        return (
                                            <button
                                                key={f}
                                                role="tab"
                                                aria-selected={active}
                                                onClick={() => setFormat(f)}
                                                className={cn(
                                                    "inline-flex items-center h-8 px-3 font-mono text-[11px] tracking-[0.10em] uppercase font-medium rounded transition-colors",
                                                    active ? "bg-card text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground"
                                                )}
                                            >
                                                {f}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Colours */}
                            <div>
                                <label className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">Colours</label>
                                <div className="mt-1.5 grid grid-cols-2 gap-2">
                                    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-2">
                                        <input
                                            type="color" value={fgColor}
                                            onChange={e => setFgColor(e.target.value)}
                                            aria-label="QR foreground colour"
                                            className="h-7 w-9 rounded border border-border cursor-pointer"
                                        />
                                        <div className="min-w-0">
                                            <p className="font-mono text-[9.5px] tracking-[0.06em] uppercase text-muted-foreground">FG</p>
                                            <p className="font-mono text-[11px] text-foreground truncate">{fgColor.toUpperCase()}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-2">
                                        <input
                                            type="color" value={bgColor}
                                            onChange={e => setBgColor(e.target.value)}
                                            aria-label="QR background colour"
                                            className="h-7 w-9 rounded border border-border cursor-pointer"
                                        />
                                        <div className="min-w-0">
                                            <p className="font-mono text-[9.5px] tracking-[0.06em] uppercase text-muted-foreground">BG</p>
                                            <p className="font-mono text-[11px] text-foreground truncate">{bgColor.toUpperCase()}</p>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* Centre logo (optional) */}
                            <div>
                                <label className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">Centre logo (optional)</label>
                                <input
                                    ref={logoInputRef}
                                    type="file" accept=".png,.jpg,.jpeg,.svg,.webp"
                                    className="hidden"
                                    onChange={e => { if (e.target.files?.[0]) setLogo(e.target.files[0]); e.target.value = ""; }}
                                />
                                <div className="mt-1.5 flex items-center gap-2">
                                    <button
                                        onClick={() => logoInputRef.current?.click()}
                                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-[12.5px] font-medium text-foreground hover:bg-secondary/40 transition-colors"
                                    >
                                        <ImagePlus size={12} /> {logo ? "Replace" : "Add logo"}
                                    </button>
                                    {logo && logoPreview && (
                                        <div className="flex items-center gap-2 rounded-md border border-border bg-paper-2/40 px-2 py-1">
                                            <img src={logoPreview} alt="" className="h-7 w-7 rounded object-contain" />
                                            <span className="font-mono text-[10.5px] text-muted-foreground truncate max-w-[120px]">{logo.name}</span>
                                            <button
                                                onClick={() => setLogo(null)}
                                                aria-label="Remove logo"
                                                className="h-6 w-6 inline-flex items-center justify-center text-muted-foreground hover:text-destructive"
                                            >
                                                <X size={11} />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Preview placeholder */}
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="px-3 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                        <span className="text-accent">§</span> Preview
                    </div>
                    <div className="relative aspect-square flex items-center justify-center bg-paper-2/30">
                        <CornerMarks />
                        {data ? (
                            <div className="text-center">
                                <QrCode size={64} className="mx-auto text-foreground/40" strokeWidth={1.25} />
                                <p className="font-mono text-[10px] tracking-[0.08em] uppercase text-muted-foreground mt-3">
                                    {size}×{size}px · {format.toUpperCase()}
                                </p>
                                <p className="font-mono text-[9.5px] text-muted-foreground/70 mt-1 max-w-[180px] mx-auto truncate">
                                    {data}
                                </p>
                            </div>
                        ) : (
                            <div className="text-center">
                                <QrCode size={48} className="mx-auto text-muted-foreground/30" strokeWidth={1.25} />
                                <p className="font-mono text-[10px] tracking-[0.06em] uppercase text-muted-foreground/85 mt-3">
                                    Enter data to preview
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            <div className="flex items-center gap-3 flex-wrap">
                <button
                    onClick={process}
                    disabled={!canProcess}
                    className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    {state === "processing"
                        ? <><Loader2 size={13} className="animate-spin" /> Generating…</>
                        : <><Download size={13} /> Generate QR code</>}
                </button>
                {canProcess && (
                    <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                )}
            </div>
        </div>
    );
}

function CornerMarks({ accent }: { accent?: boolean }) {
    const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
    const color = accent ? "bg-accent" : "bg-accent/70";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}>
                <span className={`absolute top-0 left-0 h-px w-3 ${color}`} />
                <span className={`absolute top-0 left-0 w-px h-3 ${color}`} />
            </span>
            <span className={`${cls} -top-1 -right-1`}>
                <span className={`absolute top-0 right-0 h-px w-3 ${color}`} />
                <span className={`absolute top-0 right-0 w-px h-3 ${color}`} />
            </span>
            <span className={`${cls} -bottom-1 -left-1`}>
                <span className={`absolute bottom-0 left-0 h-px w-3 ${color}`} />
                <span className={`absolute bottom-0 left-0 w-px h-3 ${color}`} />
            </span>
            <span className={`${cls} -bottom-1 -right-1`}>
                <span className={`absolute bottom-0 right-0 h-px w-3 ${color}`} />
                <span className={`absolute bottom-0 right-0 w-px h-3 ${color}`} />
            </span>
        </>
    );
}
