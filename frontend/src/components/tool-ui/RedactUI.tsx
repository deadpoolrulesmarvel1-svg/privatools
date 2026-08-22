/**
 * RedactUI — opaque-box redaction over specified rectangles.
 * Workshop: row editor with X/Y/W/H + page diagram preview, color picker.
 *
 * Each box can carry a statutory exemption code, which is stamped inside the
 * box and counted in a withholding log returned with the file. That is the
 * difference between "hide this" and a FOIA or Privacy Act production, where
 * every withholding has to cite the authority for it.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle, EyeOff, Plus, Trash2, RotateCcw } from "lucide-react";
import { EXEMPTION_CODE_SETS } from "@/data/redaction-codes";
import { cn, friendlyError } from "@/lib/utils";
import { processAndDownload, buildOutputFilename } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";
import { useToolDefaults } from "@/hooks/useToolDefaults";

interface Box {
    id: string;
    page: number;
    x: number; y: number;
    width: number; height: number;
    /** Statutory exemption citation, drawn inside the box. */
    code?: string;
}

interface RedactionReport {
    totalRedactions: number;
    uncoded: number;
    codes: Record<string, number>;
    pages: { page: number; count: number; codes: Record<string, number> }[];
}

const makeId = () => Math.random().toString(36).slice(2, 8);
const PAGE_W = 612;
const PAGE_H = 792;

const REDACT_DEFAULTS: { color: string; codeSet: string } = {
    color: "#000000",
    // "" = no exemption codes, which is the right default: most redaction
    // isn't a statutory production and an unexplained citation is worse than
    // none.
    codeSet: "",
};

export function RedactUI() {
    const [config, , { setField }] = useToolDefaults("redact-pdf", REDACT_DEFAULTS);
    const { color, codeSet } = config;
    const setColor = useCallback((v: React.SetStateAction<typeof REDACT_DEFAULTS["color"]>) => setField("color", v), [setField]);
    const setCodeSet = useCallback((v: string) => setField("codeSet", v), [setField]);
    const activeSet = EXEMPTION_CODE_SETS.find(s => s.id === codeSet) ?? null;
    const [file, setFile] = useState<File | null>(null);
    const [boxes, setBoxes] = useState<Box[]>([
        { id: makeId(), page: 1, x: 100, y: 700, width: 200, height: 20 },
    ]);

    const [selected, setSelected] = useState(boxes[0]?.id || "");
    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [report, setReport] = useState<RedactionReport | null>(null);

    const focusOnNextAddRef = useRef<string | null>(null);
    const rowRefs = useRef<Map<string, HTMLInputElement>>(new Map());

    const add = () => {
        const b: Box = { id: makeId(), page: 1, x: 100, y: 600 + boxes.length * 30, width: 200, height: 20 };
        setBoxes(prev => [...prev, b]);
        setSelected(b.id);
        focusOnNextAddRef.current = b.id;
    };
    const remove = (id: string) => setBoxes(prev => prev.filter(b => b.id !== id));
    const update = (id: string, f: keyof Box, v: number) => setBoxes(prev => prev.map(b => b.id === id ? { ...b, [f]: v } : b));
    const setBoxCode = (id: string, v: string) => setBoxes(prev => prev.map(b => b.id === id ? { ...b, code: v || undefined } : b));

    useEffect(() => {
        if (!focusOnNextAddRef.current) return;
        const el = rowRefs.current.get(focusOnNextAddRef.current);
        if (el) { el.focus(); el.select(); focusOnNextAddRef.current = null; }
    }, [boxes.length]);

    const process = useCallback(async () => {
        if (!file || boxes.length === 0) return;
        setState("processing"); setError(null);
        try {
            const payload = boxes.map(({ id, ...rest }) => rest);
            const headers = await processAndDownload("/redact", file, buildOutputFilename(file.name, "redacted", "pdf"),
                { redactions: JSON.stringify(payload), color });
            const raw = headers["x-redaction-report"];
            if (raw) {
                try { setReport(JSON.parse(raw) as RedactionReport); }
                catch { /* the log is a bonus; the redacted file is the deliverable */ }
            }
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Could not redact PDF";
            setError(friendlyError(msg, "Couldn't redact that PDF."));
            setState("idle");
        }
    }, [file, boxes, color]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
            if ((tag === "input" || tag === "textarea" || tag === "select") && !((e.metaKey || e.ctrlKey) && e.key === "Enter")) return;
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && file && state !== "processing" && boxes.length > 0) {
                e.preventDefault();
                process();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [file, state, boxes.length, process]);

    if (state === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Redacted</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{boxes.length}</span> region{boxes.length !== 1 && "s"} sealed
                        </h2>

                        {report && Object.keys(report.codes).length > 0 && (
                            <div className="mt-4 rounded-lg border border-border bg-card/60 overflow-hidden">
                                <div className="font-medium px-3 py-1.5 border-b border-border bg-paper-2/40 text-[11px] text-muted-foreground">
                                    Withholding log
                                </div>
                                <div className="divide-y divide-border">
                                    {Object.entries(report.codes).map(([code, count]) => (
                                        <div key={code} className="px-3 py-1.5 flex items-baseline justify-between gap-3 font-mono text-[11.5px]">
                                            <span className="text-foreground">{code}</span>
                                            <span className="shrink-0 tabular-nums text-muted-foreground">
                                                {count} redaction{count === 1 ? "" : "s"}
                                            </span>
                                        </div>
                                    ))}
                                    {report.uncoded > 0 && (
                                        <div className="px-3 py-1.5 flex items-baseline justify-between gap-3 font-mono text-[11.5px]">
                                            <span className="text-copper">No code</span>
                                            <span className="shrink-0 tabular-nums text-muted-foreground">
                                                {report.uncoded} redaction{report.uncoded === 1 ? "" : "s"}
                                            </span>
                                        </div>
                                    )}
                                </div>
                                <p className="px-3 py-1.5 border-t border-border font-mono text-[10px] tracking-[0.04em] text-muted-foreground/80">
                                    Across {report.pages.length} page{report.pages.length === 1 ? "" : "s"} · not saved anywhere — copy it now if you need it
                                </p>
                            </div>
                        )}

                        <button
                            onClick={() => { setFile(null); setState("idle"); setReport(null); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Redact another
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <FileUploadZone
                file={file}
                onFileSelect={setFile}
                onClear={() => setFile(null)}
                accept=".pdf"
                label="Drop PDF to redact"
                hint="Opaque-box redaction — permanently removes content"
            />

            {file && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                        <span>Redaction boxes ({boxes.length})</span>
                        <div className="flex items-center gap-2">
                            <label htmlFor="redact-codeset" className="sr-only">Exemption code set</label>
                            <select
                                id="redact-codeset"
                                value={codeSet}
                                onChange={e => setCodeSet(e.target.value)}
                                className="font-medium h-6 rounded border border-border bg-card px-1.5 text-[11.5px] text-foreground outline-none focus:border-accent"
                            >
                                <option value="">No codes</option>
                                {EXEMPTION_CODE_SETS.map(set => (
                                    <option key={set.id} value={set.id}>{set.name}</option>
                                ))}
                            </select>
                            <span>Fill</span>
                            <input
                                type="color" value={color} onChange={e => setColor(e.target.value)}
                                aria-label="Redaction box colour"
                                className="h-5 w-7 rounded border border-border cursor-pointer"
                            />
                            <button onClick={add} className="inline-flex items-center gap-1 text-accent hover:opacity-80 transition-opacity">
                                <Plus size={11} /> Add
                            </button>
                        </div>
                    </div>
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-5 p-4 items-start">
                        <div className="space-y-2">
                            {boxes.map((b, idx) => {
                                const isSel = selected === b.id;
                                return (
                                    <div
                                        key={b.id}
                                        onClick={() => setSelected(b.id)}
                                        className={cn(
                                            "rounded-lg border p-3 cursor-pointer transition-colors",
                                            isSel ? "border-accent bg-accent/[0.06]" : "border-border bg-card hover:border-border-strong"
                                        )}
                                    >
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className={cn("font-medium text-[11px]", isSel ? "text-accent" : "text-muted-foreground")}>
                                                {String(idx + 1).padStart(2, "0")}
                                            </span>
                                            <span className="font-display text-[12.5px] font-medium text-foreground">Box {idx + 1}</span>
                                            <button onClick={(e) => { e.stopPropagation(); remove(b.id); }} className="ml-auto h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
                                            {([
                                                { f: "page", label: "Pg", min: 1 },
                                                { f: "x", label: "X", min: 0 },
                                                { f: "y", label: "Y", min: 0 },
                                                { f: "width", label: "W", min: 1 },
                                                { f: "height", label: "H", min: 1 },
                                            ] as const).map((c, ci) => (
                                                <div key={c.f}>
                                                    <label className="font-medium text-[10.5px] text-muted-foreground">{c.label}</label>
                                                    <input
                                                        ref={ci === 0 ? (el) => { if (el) rowRefs.current.set(b.id, el); else rowRefs.current.delete(b.id); } : undefined}
                                                        type="number" inputMode="numeric" min={c.min}
                                                        value={b[c.f]}
                                                        onClick={e => e.stopPropagation()}
                                                        onChange={e => update(b.id, c.f, +e.target.value)}
                                                        className="mt-0.5 w-full rounded border border-border bg-paper-2/40 px-1.5 py-1 font-mono text-[12px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 text-center"
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                        {activeSet && (
                                            <div className="mt-2">
                                                <label htmlFor={`code-${b.id}`} className="font-medium text-[10.5px] text-muted-foreground">
                                                    Exemption
                                                </label>
                                                <select
                                                    id={`code-${b.id}`}
                                                    value={b.code ?? ""}
                                                    onClick={e => e.stopPropagation()}
                                                    onChange={e => setBoxCode(b.id, e.target.value)}
                                                    className="mt-0.5 w-full rounded border border-border bg-paper-2/40 px-1.5 py-1 font-mono text-[11.5px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                                                >
                                                    <option value="">None</option>
                                                    {activeSet.codes.map(c => (
                                                        <option key={c.code} value={c.code}>
                                                            {c.code} — {c.label}
                                                        </option>
                                                    ))}
                                                </select>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                            {activeSet && (
                                <p className="font-mono text-[10px] tracking-[0.04em] text-muted-foreground/80 pt-1">
                                    {activeSet.citation} — the code is stamped inside each box
                                </p>
                            )}
                        </div>

                        {/* Page preview */}
                        <div>
                            <div className="relative aspect-[3/4] bg-card border border-border rounded-md mx-auto w-full max-w-[200px] overflow-hidden">
                                {boxes.map(b => {
                                    const isSel = selected === b.id;
                                    return (
                                        <div
                                            key={b.id}
                                            className={cn(
                                                "absolute transition-colors",
                                                isSel ? "ring-1 ring-accent" : ""
                                            )}
                                            style={{
                                                left: `${(b.x / PAGE_W) * 100}%`,
                                                top: `${(b.y / PAGE_H) * 100}%`,
                                                width: `${(b.width / PAGE_W) * 100}%`,
                                                height: `${(b.height / PAGE_H) * 100}%`,
                                                minWidth: 2, minHeight: 2,
                                                background: color,
                                                opacity: 0.85,
                                            }}
                                        />
                                    );
                                })}
                                <span className="absolute bottom-1 left-1/2 -translate-x-1/2 font-mono text-[9px] tracking-wider text-muted-foreground/40">page</span>
                            </div>
                            <p className="font-medium text-[11px] text-muted-foreground/85 mt-2 text-center">
                                Permanent · not reversible
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            {file && (
                <div className="flex items-center gap-3">
                    <button onClick={process} disabled={state === "processing" || boxes.length === 0} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                        {state === "processing" ? <><Loader2 size={13} className="animate-spin" /> Redacting…</> : <><EyeOff size={13} /> Redact {boxes.length} region{boxes.length !== 1 && "s"}</>}
                    </button>
                    {state !== "processing" && boxes.length > 0 && (
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/80 bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>
                    )}
                </div>
            )}
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
