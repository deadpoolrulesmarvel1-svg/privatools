/**
 * StampUI — rubber-stamp PDF pages with CONFIDENTIAL / DRAFT / APPROVED etc.
 * Stamp preset gallery showing the stamp's look, position picker, opacity slider.
 * Multi-file via useMultiFileProcessor — same stamp applied to every PDF.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Stamp } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { FileIntake, StudioActionBar, StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { downloadStarted } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

const STAMP_PRESETS = [
    { value: "confidential", label: "CONFIDENTIAL", tone: "destructive" },
    { value: "draft",         label: "DRAFT",         tone: "muted" },
    { value: "approved",      label: "APPROVED",      tone: "accent" },
    { value: "final",         label: "FINAL",         tone: "accent" },
    { value: "copy",          label: "COPY",          tone: "muted" },
    { value: "void",          label: "VOID",          tone: "destructive" },
    { value: "sample",        label: "SAMPLE",        tone: "muted" },
    { value: "not_approved",  label: "NOT APPROVED",  tone: "destructive" },
    { value: "custom",        label: "Custom",        tone: "accent" },
];

const POSITIONS = [
    { value: "center",   label: "Center" },
    { value: "diagonal", label: "Diagonal" },
    { value: "top",      label: "Top" },
    { value: "bottom",   label: "Bottom" },
];

const STAMP_DEFAULTS: { stampType: string; customText: string; opacity: number; position: string } = {
    stampType: "confidential",
    customText: "",
    opacity: 30,
    position: "center",
};

export function StampUI() {
    const [config, , { setField }] = useToolDefaults("stamp-pdf", STAMP_DEFAULTS);
    const { stampType, customText, opacity, position } = config;
    const setStampType = useCallback((v: React.SetStateAction<typeof STAMP_DEFAULTS["stampType"]>) => setField("stampType", v), [setField]);
    const setCustomText = useCallback((v: React.SetStateAction<typeof STAMP_DEFAULTS["customText"]>) => setField("customText", v), [setField]);
    const setOpacity = useCallback((v: React.SetStateAction<typeof STAMP_DEFAULTS["opacity"]>) => setField("opacity", v), [setField]);
    const setPosition = useCallback((v: React.SetStateAction<typeof STAMP_DEFAULTS["position"]>) => setField("position", v), [setField]);
    const proc = useMultiFileProcessor();
    const [pages, setPages] = useState("all");
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);

    const activePreset = STAMP_PRESETS.find(s => s.value === stampType);
    const displayText = stampType === "custom" ? (customText.trim().toUpperCase() || "CUSTOM") : (activePreset?.label || "");

    const toneClasses = (tone: string, active: boolean) => {
        if (!active) return "border-border bg-card text-muted-foreground hover:border-accent/55 hover:text-foreground";
        if (tone === "destructive") return "border-destructive/55 bg-destructive/[0.08] text-destructive";
        if (tone === "accent") return "border-accent bg-accent/[0.08] text-accent";
        return "border-foreground/45 bg-secondary/60 text-foreground";
    };

    const stampPreviewColor = activePreset?.tone === "destructive" ? "hsl(var(--destructive))" : activePreset?.tone === "accent" ? "hsl(var(--accent))" : "hsl(var(--muted-foreground))";

    const customMissing = stampType === "custom" && !customText.trim();
    const canProcess = proc.entries.length > 0 && phase !== "processing" && !customMissing;

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        const params: Record<string, string | number | boolean> = {
            stamp_type: stampType,
            opacity: opacity / 100,
            position,
            pages,
        };
        if (stampType === "custom" && customText.trim()) params.custom_text = customText.trim();
        setPhase("processing");
        await proc.run({
            endpoint: "/stamp-pdf",
            outputSuffix: "stamped",
            outputExt: "pdf",
            params,
        }, retry);
        setPhase("done");
    }, [proc, stampType, opacity, position, pages, customText]);

    useDownloadOnce(phase === "done", proc.doneCount, () => proc.downloadAll("archive_stamped"));

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
            if ((tag === "input" || tag === "textarea") && !((e.metaKey || e.ctrlKey) && e.key === "Enter")) return;
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                void process(false);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);

    if (phase === "done") {
        const startOver = (files?: File[]) => {
            proc.reset();
            if (files) proc.addFiles(files);
            setReturning(true); setPhase("idle");
        };
        return <ProcessorResult proc={proc} verb="stamped" accepts=".pdf"
            title={proc.doneCount > 1 ? `${proc.doneCount} PDFs marked ${displayText}.` : `Marked ${displayText}.`}
            detail={downloadStarted(proc.doneCount)}
            onDownload={() => proc.downloadAll("archive_stamped")} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Stamp another" />;
    }

    const busy = phase === "processing";
    return <StudioLayout options={<>
        <div>
            <h2>Stamp text</h2>
            <div className="grid grid-cols-2 gap-2" role="group" aria-label="Stamp text">
                {STAMP_PRESETS.map(s => <button type="button" key={s.value} onClick={() => setStampType(s.value)} disabled={busy} aria-pressed={stampType === s.value}
                    className={cn("rounded-lg border py-3 px-2 text-center font-display text-[12.5px] font-bold tracking-[0.04em] transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[hsl(var(--accent))]", toneClasses(s.tone, stampType === s.value))}>
                    {s.label}
                </button>)}
            </div>
            {stampType === "custom" && <div className="ts-setting">
                <label htmlFor="stamp-custom">Custom text</label>
                <input id="stamp-custom" type="text" value={customText} disabled={busy} onChange={e => setCustomText(e.target.value)} placeholder="e.g. REVIEW COPY" maxLength={30} />
                {proc.entries.length > 0 && customMissing && <p className="ts-caption">Enter the custom text first.</p>}
            </div>}
        </div>
        <div>
            <h2>Placement</h2>
            <div className="ts-choices">{POSITIONS.map(p => <button type="button" className="ts-choice" key={p.value} aria-pressed={position === p.value} disabled={busy} onClick={() => setPosition(p.value)}><strong>{p.label}</strong></button>)}</div>
            <div className="ts-setting"><label htmlFor="stamp-opacity">Opacity · {opacity}%</label><input id="stamp-opacity" type="range" min={5} max={100} value={opacity} disabled={busy} onChange={e => setOpacity(+e.target.value)} /></div>
            <div className="ts-setting"><label htmlFor="stamp-pages">Pages</label><input id="stamp-pages" value={pages} disabled={busy} onChange={e => setPages(e.target.value)} placeholder="all · 1,3,5-8" />
                {proc.entries.length > 1 && <p className="ts-caption">Same pages · same stamp across all {proc.entries.length} PDFs</p>}</div>
        </div>
        <div aria-hidden="true">
            {/* Mini preview */}
            <div className="relative aspect-[3/4] bg-card border border-border rounded-md mx-auto w-full max-w-[180px] overflow-hidden">
                <div className="absolute inset-0 grid grid-cols-1 grid-rows-6 gap-1 p-3 opacity-30">
                    {Array.from({ length: 12 }).map((_, i) => <div key={i} className="h-px bg-muted-foreground/40" />)}
                </div>
                <div className={cn("absolute inset-0 flex font-display font-extrabold pointer-events-none",
                    position === "top" && "items-start justify-center pt-3",
                    position === "bottom" && "items-end justify-center pb-3",
                    (position === "center" || position === "diagonal") && "items-center justify-center")}>
                    <StampMark text={displayText} color={stampPreviewColor} opacity={opacity / 100} diagonal={position === "diagonal"}
                        fontSize={Math.max(9, Math.min(displayText.length > 10 ? 11 : 14, 18))} />
                </div>
            </div>
        </div>
    </>} action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}><Stamp size={16} aria-hidden="true" /> Apply stamp{proc.entries.length > 1 ? ` — ${proc.entries.length} PDFs` : ""}</button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Drop PDFs to stamp" detail="Apply CONFIDENTIAL / DRAFT / APPROVED etc. · same stamp on every file"
            compact={proc.entries.length > 0} disabled={busy} autoFocus={returning} onFiles={files => proc.addFiles(files)} />
        <ProcessorFiles proc={proc} busy={busy} label="Selected PDFs" />
        {busy && <StudioProgress label="Applying the stamp" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}

/**
 * The stamp in the preview, at the opacity it will have on the page. It is drawn as part of
 * the picture of the page (an SVG inside the aria-hidden preview), not as page text: a faint
 * stamp is the point of the picture, and WCAG's contrast minimum exempts text that is part of
 * a picture. The box hugs the measured text, as the HTML version's padding and border did.
 */
function StampMark({ text, color, opacity, diagonal, fontSize }: { text: string; color: string; opacity: number; diagonal: boolean; fontSize: number }) {
    const ref = useRef<SVGTextElement>(null);
    const [textWidth, setTextWidth] = useState(() => text.length * fontSize * 0.72);
    useLayoutEffect(() => {
        let live = true;
        const measure = () => {
            const el = ref.current;
            if (!live || !el || typeof el.getBBox !== "function") return;
            const width = el.getBBox().width;
            if (width > 0) setTextWidth(width);
        };
        measure();
        document.fonts?.ready.then(measure).catch(() => {});
        return () => { live = false; };
    }, [text, fontSize]);
    const width = textWidth + 20, height = fontSize * 1.25 + 8;
    return <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} focusable="false" className="font-display font-extrabold overflow-visible"
        style={{ opacity, transform: diagonal ? "rotate(-25deg)" : undefined }}>
        <rect x={1} y={1} width={width - 2} height={height - 2} rx={4} fill="none" strokeWidth={2} style={{ stroke: color }} />
        <text ref={ref} x={width / 2} y={height / 2} textAnchor="middle" dominantBaseline="central" fontSize={fontSize} style={{ fill: color }}>{text}</text>
    </svg>;
}
