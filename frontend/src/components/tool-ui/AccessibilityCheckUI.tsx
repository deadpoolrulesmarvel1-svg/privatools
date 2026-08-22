/**
 * AccessibilityCheckUI — PDF/UA + WCAG conformance report.
 * Workshop: score panel + per-category check rows, expandable to remediation.
 *
 * This is a report screen, not a converter: the summary has to be readable at a
 * glance and the detail has to be reachable without hunting. Status is encoded
 * in icon, colour AND text so it never depends on colour alone — which is one
 * of the things this tool checks other documents for.
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import {
    Loader2, AlertCircle, CheckCircle2, XCircle, AlertTriangle, Eye,
    RotateCcw, Accessibility, ChevronRight, Copy, Check,
} from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFileGetJson } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";

type Status = "pass" | "fail" | "warn" | "manual";
type Impact = "critical" | "serious" | "moderate" | "minor" | "info";

interface Check {
    id: string;
    title: string;
    category: string;
    status: Status;
    detail: string;
    impact: Impact;
    howToFix: string;
    standard: string;
}

interface Report {
    summary: {
        score: number;
        passed: number;
        failed: number;
        warnings: number;
        manual: number;
        criticalFailures: number;
        verdict: string;
    };
    document: {
        pages: number;
        tagged: boolean;
        title: string;
        language: string;
        encrypted: boolean;
        headings: number;
        figures: number;
        tables: number;
    };
    checks: Check[];
}

const STATUS_META: Record<Status, { label: string; icon: typeof CheckCircle2; tone: string; dot: string }> = {
    pass:   { label: "Pass",   icon: CheckCircle2,  tone: "text-accent",            dot: "bg-accent" },
    fail:   { label: "Fail",   icon: XCircle,       tone: "text-destructive",       dot: "bg-destructive" },
    warn:   { label: "Warning", icon: AlertTriangle, tone: "text-copper",           dot: "bg-copper" },
    manual: { label: "Manual", icon: Eye,           tone: "text-muted-foreground",  dot: "bg-muted-foreground" },
};

const FILTERS: { key: Status | "all"; label: string }[] = [
    { key: "all", label: "All" },
    { key: "fail", label: "Failed" },
    { key: "warn", label: "Warnings" },
    { key: "pass", label: "Passed" },
    { key: "manual", label: "Manual" },
];

/** Plain-text export — auditors need something to paste into a ticket or report. */
function reportToText(r: Report, filename: string): string {
    const lines = [
        `PDF accessibility report — ${filename}`,
        `Score: ${r.summary.score}/100 — ${r.summary.verdict}`,
        `${r.summary.passed} passed · ${r.summary.failed} failed · ${r.summary.warnings} warnings · ${r.summary.manual} manual`,
        "",
    ];
    for (const c of r.checks) {
        lines.push(`[${STATUS_META[c.status].label.toUpperCase()}] ${c.title}${c.standard ? ` (${c.standard})` : ""}`);
        lines.push(`  ${c.detail}`);
        if (c.howToFix) lines.push(`  Fix: ${c.howToFix}`);
        lines.push("");
    }
    return lines.join("\n");
}

export function AccessibilityCheckUI() {
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [report, setReport] = useState<Report | null>(null);
    const [filter, setFilter] = useState<Status | "all">("all");
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [copied, setCopied] = useState(false);

    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const data = await uploadFileGetJson<Report>("/accessibility-check", file);
            setReport(data);
            // Open straight onto the problems — a clean run shows everything.
            setFilter(data.summary.failed > 0 ? "fail" : "all");
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed";
            setError(friendlyError(msg, "Couldn't check that PDF."));
            setStatus("idle");
        }
    }, [file]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && file && status === "idle") {
                e.preventDefault(); process();
            }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [file, status, process]);

    const visible = useMemo(
        () => (report ? report.checks.filter(c => filter === "all" || c.status === filter) : []),
        [report, filter],
    );

    const grouped = useMemo(() => {
        const map = new Map<string, Check[]>();
        for (const c of visible) {
            const list = map.get(c.category);
            if (list) list.push(c); else map.set(c.category, [c]);
        }
        return [...map.entries()];
    }, [visible]);

    const counts = useMemo(() => {
        const base: Record<string, number> = { all: report?.checks.length ?? 0 };
        for (const s of ["pass", "fail", "warn", "manual"] as Status[]) {
            base[s] = report?.checks.filter(c => c.status === s).length ?? 0;
        }
        return base;
    }, [report]);

    const copyReport = useCallback(async () => {
        if (!report || !file) return;
        try {
            await navigator.clipboard.writeText(reportToText(report, file.name));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setError("Couldn't copy to the clipboard.");
        }
    }, [report, file]);

    const toggle = (id: string) => setExpanded(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });

    const reset = () => { setFile(null); setReport(null); setStatus("idle"); setExpanded(new Set()); setFilter("all"); };

    const scoreTone = report
        ? report.summary.criticalFailures > 0 ? "destructive"
        : report.summary.failed > 0 ? "copper"
        : "accent"
        : "accent";

    return (
        <div className="space-y-4">
            <FileUploadZone
                file={file}
                onFileSelect={setFile}
                onClear={reset}
                accept=".pdf"
                label="Drop PDF to check"
                hint="PDF/UA + WCAG audit · read-only, nothing is changed · up to 500 MB"
            />

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive" role="alert">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            {status === "done" && report && (
                <div className="space-y-3 animate-fade-up">
                    {/* Verdict + score */}
                    <div className={cn(
                        "rounded-2xl border overflow-hidden",
                        scoreTone === "accent" ? "border-accent/30 bg-accent/[0.05]"
                            : scoreTone === "copper" ? "border-copper/40 bg-copper-soft/40"
                            : "border-destructive/30 bg-destructive/[0.05]",
                    )}>
                        <div className="p-6">
                            <div className="flex items-start gap-4">
                                <div className={cn(
                                    "h-12 w-12 rounded-xl border flex items-center justify-center shrink-0 animate-success-pop",
                                    scoreTone === "accent" ? "bg-accent/15 border-accent/35"
                                        : scoreTone === "copper" ? "bg-copper/15 border-copper/35"
                                        : "bg-destructive/15 border-destructive/35",
                                )}>
                                    <Accessibility size={22} strokeWidth={1.75} className={
                                        scoreTone === "accent" ? "text-accent"
                                            : scoreTone === "copper" ? "text-copper" : "text-destructive"
                                    } />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={cn(
                                        "font-mono text-[10.5px] tracking-[0.10em] uppercase mb-1.5",
                                        scoreTone === "accent" ? "text-accent" : scoreTone === "copper" ? "text-copper" : "text-destructive",
                                    )}>
                                        § Accessibility report
                                    </p>
                                    <h3 className="font-display text-[20px] font-bold text-foreground tracking-[-0.02em] leading-tight">
                                        {report.summary.verdict}
                                    </h3>
                                    <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1.5">
                                        {report.document.pages} page{report.document.pages === 1 ? "" : "s"} ·{" "}
                                        {report.document.tagged ? "tagged" : "untagged"}
                                        {report.document.language ? ` · ${report.document.language}` : ""}
                                    </p>
                                </div>
                                <div className="text-right shrink-0">
                                    <div className={cn(
                                        "font-display text-[34px] font-bold leading-none tabular-nums",
                                        scoreTone === "accent" ? "text-accent" : scoreTone === "copper" ? "text-copper" : "text-destructive",
                                    )}>
                                        {report.summary.score}
                                    </div>
                                    <div className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground mt-1">
                                        / 100
                                    </div>
                                </div>
                            </div>

                            <div
                                className="mt-4 h-1.5 rounded-full bg-border/60 overflow-hidden"
                                role="meter"
                                aria-valuenow={report.summary.score}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-label="Accessibility score"
                            >
                                <div
                                    className={cn(
                                        "h-full rounded-full transition-[width] duration-700",
                                        scoreTone === "accent" ? "bg-accent" : scoreTone === "copper" ? "bg-copper" : "bg-destructive",
                                    )}
                                    style={{ width: `${report.summary.score}%` }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Filters — counts double as the summary, so no separate stat row */}
                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter checks by result">
                        {FILTERS.map(f => {
                            const n = counts[f.key] ?? 0;
                            const active = filter === f.key;
                            return (
                                <button
                                    key={f.key}
                                    type="button"
                                    onClick={() => setFilter(f.key)}
                                    disabled={n === 0}
                                    aria-pressed={active}
                                    className={cn(
                                        "inline-flex items-center gap-1.5 h-8 px-3 rounded-md border font-mono text-[11px] tracking-[0.04em] uppercase transition-colors",
                                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                                        active ? "border-accent/40 bg-accent/10 text-foreground"
                                            : "border-border bg-card text-muted-foreground hover:bg-secondary/60",
                                        n === 0 && "opacity-40 cursor-not-allowed",
                                    )}
                                >
                                    {f.key !== "all" && <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_META[f.key as Status].dot)} />}
                                    {f.label}
                                    <span className="tabular-nums text-foreground/70">{n}</span>
                                </button>
                            );
                        })}
                    </div>

                    {/* Checks, grouped by category */}
                    <div className="space-y-3">
                        {grouped.map(([category, checks]) => (
                            <div key={category} className="rounded-xl border border-border bg-card overflow-hidden">
                                <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                                    <span><span className="text-accent">§</span> {category}</span>
                                    <span className="tabular-nums">{checks.length}</span>
                                </div>
                                <div className="divide-y divide-border">
                                    {checks.map(c => {
                                        const meta = STATUS_META[c.status];
                                        const Icon = meta.icon;
                                        const isOpen = expanded.has(c.id);
                                        const hasDetail = Boolean(c.howToFix || c.standard);
                                        return (
                                            <div key={c.id} className="px-4 py-2.5">
                                                <button
                                                    type="button"
                                                    onClick={() => hasDetail && toggle(c.id)}
                                                    disabled={!hasDetail}
                                                    aria-expanded={hasDetail ? isOpen : undefined}
                                                    className={cn(
                                                        "flex items-start gap-2.5 w-full text-left rounded",
                                                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60",
                                                        hasDetail ? "cursor-pointer hover:opacity-90" : "cursor-default",
                                                    )}
                                                >
                                                    <Icon size={13} className={cn("shrink-0 mt-0.5", meta.tone)} />
                                                    <span className="flex-1 min-w-0">
                                                        <span className="flex items-baseline gap-2 flex-wrap">
                                                            <span className="text-[13px] font-medium text-foreground">{c.title}</span>
                                                            <span className={cn("font-mono text-[10px] tracking-[0.08em] uppercase", meta.tone)}>
                                                                {meta.label}
                                                            </span>
                                                        </span>
                                                        <span className="block font-mono text-[12px] text-muted-foreground mt-0.5 leading-relaxed">
                                                            {c.detail}
                                                        </span>
                                                    </span>
                                                    {hasDetail && (
                                                        <ChevronRight
                                                            size={12}
                                                            className={cn(
                                                                "shrink-0 mt-1 transition-transform text-muted-foreground/60",
                                                                isOpen && "rotate-90 text-accent",
                                                            )}
                                                        />
                                                    )}
                                                </button>
                                                {isOpen && hasDetail && (
                                                    <div className="mt-2 ml-6 rounded-md border border-accent/20 bg-accent/[0.04] px-3 py-2 animate-fade-in">
                                                        {c.howToFix && (
                                                            <p className="text-[12px] text-foreground">
                                                                <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent mr-1.5">§ how to fix</span>
                                                                {c.howToFix}
                                                            </p>
                                                        )}
                                                        {c.standard && (
                                                            <p className="font-mono text-[10.5px] tracking-[0.04em] text-muted-foreground mt-1.5">
                                                                {c.standard}
                                                            </p>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>

                    <p className="font-mono text-[10px] tracking-[0.04em] uppercase text-muted-foreground/70">
                        <span className="text-accent">§</span> Automated checks only — the manual items need a human to confirm.
                    </p>

                    <div className="flex flex-wrap items-center gap-2">
                        <button onClick={reset} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors">
                            <RotateCcw size={12} /> Check another
                        </button>
                        <button onClick={copyReport} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors">
                            {copied ? <><Check size={12} className="text-accent" /> Copied</> : <><Copy size={12} /> Copy report</>}
                        </button>
                    </div>
                </div>
            )}

            {status !== "done" && (
                <div className="flex items-center gap-3">
                    <button onClick={process} disabled={!file || status === "processing"} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                        {status === "processing"
                            ? <><Loader2 size={13} className="animate-spin" /> Checking…</>
                            : <><Accessibility size={13} /> Check accessibility</>}
                    </button>
                    {file && status === "idle" && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/80 bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
                </div>
            )}
        </div>
    );
}
