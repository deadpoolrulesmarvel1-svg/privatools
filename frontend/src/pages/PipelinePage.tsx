/**
 * Pipeline — the signature feature, reimagined as a workflow editor.
 *
 * Layout (desktop):
 *   ┌─────────────────────────────────────────────┬─────────────────┐
 *   │ Header — name · step count · run button     │                 │
 *   ├─────────────────────────────────────────────┤  Tool palette   │
 *   │                                             │  · search       │
 *   │   Visual chain editor                       │  · recipes      │
 *   │   [file] → 01 → 02 → 03 → [out]             │  · all tools    │
 *   │                                             │                 │
 *   └─────────────────────────────────────────────┴─────────────────┘
 *
 * The chain is a real editor: nodes show progress live, a moving
 * accent spark traverses the connector lines when running, the
 * file/output endpoints stay pinned at the start and end.
 *
 * Persistence: pipelines auto-save to localStorage so a refresh
 * doesn't wipe carefully assembled chains. Users can also save
 * named pipelines and reload them later.
 */
import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
    Plus, X, Play, Download, Loader2, CheckCircle, AlertCircle,
    FileText, Layers, ArrowRight, Search, Trash2,
    ChevronLeft, ChevronRight, Sparkles, RotateCw, GripVertical,
    BookmarkPlus, Bookmark, Square, RefreshCw, ArrowDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { tools } from "@/data/tools";
import { getToolEndpoint } from "@/lib/tool-endpoints";
import { downloadBlob, formatErrorForClipboard, postFormData } from "@/lib/api";
import { useFocusTrap } from "@/hooks/useFocusTrap";

/**
 * Pipeline-safe tools — those that take a PDF and return a PDF without
 * requiring user-specific input (text, ranges, signatures). Grouped by
 * category in the palette below.
 */
const PIPELINE_TOOL_SLUGS = new Set([
    // Optimize
    "compress-pdf", "flatten-pdf", "deskew-pdf", "repair-pdf", "grayscale-pdf",
    "crop-pdf", "auto-crop", "rotate-pdf", "resize-pdf", "invert-colors",
    "remove-blank-pages", "transparent-background",
    // Edit (defaults are safe)
    "stamp-pdf", "page-numbers", "bates-numbering", "add-hyperlinks", "watermark",
    "header-footer",
    // Organize (defaults are safe)
    "reverse-pdf", "booklet-pdf", "nup",
    // Security
    "strip-metadata", "delete-annotations", "sanitize-pdf",
    // Convert
    "pdf-to-pdfa",
]);

const pipelineTools = tools
    .filter((t) => PIPELINE_TOOL_SLUGS.has(t.slug))
    .map((t) => ({
        slug: t.slug, endpoint: getToolEndpoint(t.slug),
        name: t.name, icon: t.icon, category: t.category,
    }));

const CATEGORY_ORDER: { id: string; label: string; cats: Set<string> }[] = [
    { id: "optimize", label: "Optimize", cats: new Set(["optimize"]) },
    { id: "edit",     label: "Edit",     cats: new Set(["edit"]) },
    { id: "organize", label: "Organize", cats: new Set(["organize"]) },
    { id: "security", label: "Security", cats: new Set(["security"]) },
    { id: "convert",  label: "Convert",  cats: new Set(["to-pdf", "from-pdf", "advanced"]) },
];

const RECIPES: { name: string; description: string; slugs: string[] }[] = [
    {
        name: "Email-ready",
        description: "Shrink and strip identifying metadata before sending.",
        slugs: ["compress-pdf", "strip-metadata"],
    },
    {
        name: "Scan cleanup",
        description: "Straighten, crop borders, and remove blank pages from a scan.",
        slugs: ["deskew-pdf", "auto-crop", "remove-blank-pages"],
    },
    {
        name: "Brand & ship",
        description: "Stamp logo and number every page before sending out.",
        slugs: ["stamp-pdf", "page-numbers", "compress-pdf"],
    },
    {
        name: "Archival",
        description: "Convert to PDF/A and sanitize for long-term storage.",
        slugs: ["sanitize-pdf", "pdf-to-pdfa"],
    },
];

interface PipelineStep {
    tool: (typeof pipelineTools)[0];
}

interface SavedPipeline {
    name: string;
    slugs: string[];
    savedAt: number;
}

const STORAGE_DRAFT_KEY = "privatools_pipeline_draft";
const STORAGE_SAVED_KEY = "privatools_pipeline_saved";

function loadDraftSlugs(): string[] {
    try {
        const raw = localStorage.getItem(STORAGE_DRAFT_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        return arr.filter((s): s is string => typeof s === "string");
    } catch { return []; }
}

function loadSavedPipelines(): SavedPipeline[] {
    try {
        const raw = localStorage.getItem(STORAGE_SAVED_KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        if (!Array.isArray(arr)) return [];
        return arr.filter((p): p is SavedPipeline =>
            p && typeof p.name === "string" && Array.isArray(p.slugs) && typeof p.savedAt === "number"
        );
    } catch { return []; }
}

export default function PipelinePage() {
    // Hydrate draft from localStorage on first mount.
    const [steps, setSteps] = useState<PipelineStep[]>(() => {
        const slugs = loadDraftSlugs();
        return slugs
            .map(s => pipelineTools.find(t => t.slug === s))
            .filter((t): t is (typeof pipelineTools)[0] => Boolean(t))
            .map(t => ({ tool: t }));
    });
    const [file, setFile] = useState<File | null>(null);
    const [processing, setProcessing] = useState(false);
    const [currentStep, setCurrentStep] = useState(-1);
    const [stepStatuses, setStepStatuses] = useState<Record<number, "queued" | "running" | "done" | "error">>({});
    const [stepErrors, setStepErrors] = useState<Record<number, string>>({});
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [resultUrl, setResultUrl] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [errorReport, setErrorReport] = useState<string | null>(null);
    const [paletteSearch, setPaletteSearch] = useState("");
    const [paletteOpen, setPaletteOpen] = useState(false);  // mobile only
    const [savedPipelines, setSavedPipelines] = useState<SavedPipeline[]>(loadSavedPipelines);
    const [draggingIdx, setDraggingIdx] = useState<number | null>(null);
    const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);
    // Name dialog (replaces window.prompt) — open with a suggested name
    // and a confirm callback. One reusable dialog covers "save as" and
    // any future "rename" flow.
    const [nameDialog, setNameDialog] = useState<{
        title: string;
        label: string;
        initial: string;
        onConfirm: (value: string) => void;
    } | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const intermediateBlobsRef = useRef<Record<number, Blob>>({});

    const filteredPalette = useMemo(
        () =>
            paletteSearch.trim()
                ? pipelineTools.filter((t) => t.name.toLowerCase().includes(paletteSearch.toLowerCase()))
                : pipelineTools,
        [paletteSearch],
    );

    // Persist draft whenever steps change (unless empty — let users start fresh).
    useEffect(() => {
        try {
            if (steps.length === 0) {
                localStorage.removeItem(STORAGE_DRAFT_KEY);
            } else {
                localStorage.setItem(STORAGE_DRAFT_KEY, JSON.stringify(steps.map(s => s.tool.slug)));
            }
        } catch { /* localStorage may be full or disabled */ }
    }, [steps]);

    useEffect(() => {
        return () => {
            if (resultUrl) URL.revokeObjectURL(resultUrl);
        };
    }, [resultUrl]);

    // Abort any in-flight pipeline run when the page unmounts so the fetch
    // doesn't keep the controller (and its tied closures) alive.
    useEffect(() => () => { abortRef.current?.abort(); }, []);

    const resetRunState = useCallback(() => {
        setStepStatuses({});
        setStepErrors({});
        intermediateBlobsRef.current = {};
        setResultBlob(null);
        if (resultUrl) { URL.revokeObjectURL(resultUrl); setResultUrl(null); }
        setError(null);
        setErrorReport(null);
        setCurrentStep(-1);
    }, [resultUrl]);

    const setInputFile = useCallback((nextFile: File | null) => {
        setFile(nextFile);
        resetRunState();
    }, [resetRunState]);

    const addStep = (tool: (typeof pipelineTools)[0]) => {
        setSteps((prev) => [...prev, { tool }]);
        // Structural edits invalidate cached step output and final results.
        resetRunState();
        // Auto-close palette on mobile after adding a step.
        if (window.innerWidth < 1024) setPaletteOpen(false);
    };

    const loadRecipe = (slugs: string[]) => {
        const stepObjs: PipelineStep[] = slugs
            .map(s => pipelineTools.find(t => t.slug === s))
            .filter((t): t is (typeof pipelineTools)[0] => Boolean(t))
            .map(t => ({ tool: t }));
        setSteps(stepObjs);
        resetRunState();
    };

    const removeStep = (idx: number) => {
        setSteps(p => p.filter((_, i) => i !== idx));
        resetRunState();
    };

    const moveStep = (idx: number, dir: -1 | 1) => {
        setSteps(prev => {
            const arr = [...prev];
            const newIdx = idx + dir;
            if (newIdx < 0 || newIdx >= arr.length) return arr;
            [arr[idx], arr[newIdx]] = [arr[newIdx], arr[idx]];
            return arr;
        });
        resetRunState();
    };

    const reorderStep = (from: number, to: number) => {
        if (from === to) return;
        setSteps(prev => {
            const arr = [...prev];
            const [item] = arr.splice(from, 1);
            // Adjust insertion index after splice removal.
            const dest = from < to ? to - 1 : to;
            arr.splice(dest, 0, item);
            return arr;
        });
        resetRunState();
    };

    const clearAll = () => {
        setSteps([]);
        setFile(null);
        resetRunState();
    };

    const cancelRun = () => {
        abortRef.current?.abort();
    };

    // Save the current pipeline as a named bookmark. Opens the workshop
    // name dialog (portal-rendered) instead of window.prompt so we keep
    // the editorial typography and ⌘+Enter / Esc keyboard behaviour.
    const saveCurrentPipeline = () => {
        if (steps.length === 0) return;
        const suggested = steps.map(s => s.tool.name.split(" ")[0]).slice(0, 3).join(" + ");
        setNameDialog({
            title: "Save pipeline as",
            label: "Pipeline name",
            initial: suggested,
            onConfirm: (value) => {
                const trimmed = value.trim();
                if (!trimmed) return;
                const entry: SavedPipeline = { name: trimmed, slugs: steps.map(s => s.tool.slug), savedAt: Date.now() };
                setSavedPipelines(prev => {
                    const next = [entry, ...prev.filter(p => p.name !== trimmed)].slice(0, 10);
                    try { localStorage.setItem(STORAGE_SAVED_KEY, JSON.stringify(next)); } catch {}
                    return next;
                });
            },
        });
    };

    const deleteSavedPipeline = (name: string) => {
        setSavedPipelines(prev => {
            const next = prev.filter(p => p.name !== name);
            try { localStorage.setItem(STORAGE_SAVED_KEY, JSON.stringify(next)); } catch {}
            return next;
        });
    };

    /**
     * Run the pipeline. If `startFromStep` is provided, resumes from that
     * step using the previous successful blob as input. The previous run's
     * stale "done" markers are preserved up to that point so the user sees
     * progress accumulating rather than restarting from zero on retry.
     */
    const runPipeline = async (startFromStep = 0, startingBlob?: Blob) => {
        if (!file || steps.length === 0 || processing) return;

        const controller = new AbortController();
        abortRef.current = controller;
        setProcessing(true);
        setError(null);
        setErrorReport(null);

        if (startFromStep === 0) {
            // Fresh run — clear all status.
            setStepStatuses({});
            setStepErrors({});
            intermediateBlobsRef.current = {};
            if (resultUrl) { URL.revokeObjectURL(resultUrl); setResultUrl(null); }
            setResultBlob(null);
        } else {
            // Retry from a specific step — clear only that step + onward.
            setStepStatuses(prev => {
                const next = { ...prev };
                for (let i = startFromStep; i < steps.length; i++) delete next[i];
                return next;
            });
            setStepErrors(prev => {
                const next = { ...prev };
                for (let i = startFromStep; i < steps.length; i++) delete next[i];
                return next;
            });
            for (const key of Object.keys(intermediateBlobsRef.current)) {
                if (Number(key) >= startFromStep) delete intermediateBlobsRef.current[Number(key)];
            }
        }

        const resumeBlob = startingBlob ?? (startFromStep > 0 ? intermediateBlobsRef.current[startFromStep - 1] : file);
        if (!resumeBlob) {
            const msg = `Step ${startFromStep + 1} cannot resume because the previous step output is no longer available. Run the pipeline from the beginning.`;
            setError(msg);
            setStepStatuses(prev => ({ ...prev, [startFromStep]: "error" }));
            setStepErrors(prev => ({ ...prev, [startFromStep]: "Missing previous output" }));
            setProcessing(false);
            setCurrentStep(-1);
            abortRef.current = null;
            return;
        }

        let currentBlob: Blob = resumeBlob;

        for (let i = startFromStep; i < steps.length; i++) {
            if (controller.signal.aborted) break;
            setCurrentStep(i);
            setStepStatuses(prev => ({ ...prev, [i]: "running" }));
            try {
                const resp = await postFormData(steps[i].tool.endpoint, () => {
                    const formData = new FormData();
                    formData.append("file", currentBlob, file.name);
                    formData.append("files", currentBlob, file.name);
                    return formData;
                }, {
                    signal: controller.signal,
                    timeoutMs: 300_000,
                });
                currentBlob = await resp.blob();
                intermediateBlobsRef.current[i] = currentBlob;
                setStepStatuses(prev => ({ ...prev, [i]: "done" }));
            } catch (e: unknown) {
                if (controller.signal.aborted) {
                    // User-initiated cancel — quiet exit.
                    setStepStatuses(prev => ({ ...prev, [i]: "queued" }));
                    break;
                }
                const msg = e instanceof Error ? e.message : "Pipeline failed";
                setError(`Step ${i + 1} (${steps[i].tool.name}) failed: ${msg}`);
                setErrorReport(formatErrorForClipboard(e, `Pipeline step ${i + 1}: ${steps[i].tool.name} (${steps[i].tool.slug})`));
                setStepStatuses(prev => ({ ...prev, [i]: "error" }));
                setStepErrors(prev => ({ ...prev, [i]: msg }));
                setProcessing(false);
                setCurrentStep(-1);
                abortRef.current = null;
                return;
            }
        }

        if (!controller.signal.aborted) {
            const url = URL.createObjectURL(currentBlob);
            setResultBlob(currentBlob);
            setResultUrl(url);
            const outName = `${file.name.replace(/\.pdf$/i, "")}_pipeline.pdf`;
            downloadBlob(currentBlob, outName);
        }
        setProcessing(false);
        setCurrentStep(-1);
        abortRef.current = null;
    };

    const outputName = file ? `${file.name.replace(/\.pdf$/i, "")}_pipeline.pdf` : "output.pdf";
    const canRun = !!file && steps.length > 0 && !processing;
    const failedIdx = useMemo(() => {
        for (let i = 0; i < steps.length; i++) {
            if (stepStatuses[i] === "error") return i;
        }
        return -1;
    }, [stepStatuses, steps.length]);

    return (
        <div className="h-full flex flex-col lg:flex-row">
            {/* ─── Main editor ─────────────────────────────────────────── */}
            <div className="flex-1 min-w-0 flex flex-col">

                {/* Workspace header — file name, controls */}
                <header className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border bg-paper-2/30">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="font-mono text-[10px] tracking-[0.12em] uppercase text-accent">§ Pipeline</span>
                            <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground">{steps.length} step{steps.length !== 1 ? "s" : ""}</span>
                            {/* Auto-saved indicator — quiet confidence cue */}
                            {steps.length > 0 && !processing && (
                                <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground/70" title="Saved locally, restored on reload">
                                    · auto-saved
                                </span>
                            )}
                        </div>
                        <h1 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight truncate" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            {steps.length > 0
                                ? steps.map(s => s.tool.name).join(" → ")
                                : <span className="text-muted-foreground italic font-medium">Untitled pipeline</span>}
                        </h1>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button
                            onClick={() => setPaletteOpen(true)}
                            className="lg:hidden inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-[13px] font-medium text-foreground hover:bg-secondary/60"
                        >
                            <Plus size={13} /> Add step
                        </button>
                        {/* Save pipeline */}
                        {steps.length > 0 && !processing && (
                            <button
                                onClick={saveCurrentPipeline}
                                className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                                title="Save this pipeline for later"
                            >
                                <BookmarkPlus size={12} /> Save
                            </button>
                        )}
                        <button
                            onClick={clearAll}
                            disabled={steps.length === 0 && !file}
                            className="hidden sm:inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title="Clear pipeline"
                        >
                            <Trash2 size={12} /> Clear
                        </button>
                        {/* Cancel during run, otherwise Run */}
                        {processing ? (
                            <button
                                onClick={cancelRun}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md text-[13px] font-semibold bg-destructive/10 text-destructive border border-destructive/30 hover:bg-destructive/15 transition-colors"
                                title="Cancel pipeline"
                            >
                                <Square size={11} className="fill-current" />
                                <span className="hidden sm:inline">Cancel</span>
                                <span className="font-mono text-[11px] opacity-80">{currentStep + 1}/{steps.length}</span>
                            </button>
                        ) : (
                            <button
                                onClick={() => runPipeline(0)}
                                disabled={!canRun}
                                className={cn(
                                    "inline-flex items-center gap-1.5 h-9 px-4 rounded-md text-[13px] font-semibold transition-colors",
                                    canRun
                                        ? "bg-accent text-accent-foreground hover:brightness-105 shadow-sm"
                                        : "bg-secondary text-muted-foreground cursor-not-allowed"
                                )}
                            >
                                <Play size={13} /> Run pipeline
                            </button>
                        )}
                    </div>
                </header>

                {/* Canvas */}
                <div className="flex-1 bg-paper-2/20 relative">
                    {/* Grid pattern */}
                    <div
                        aria-hidden="true"
                        className="absolute inset-0 pointer-events-none opacity-50"
                        style={{
                            backgroundImage: "radial-gradient(circle at 1px 1px, hsl(var(--foreground) / 0.06) 1px, transparent 0)",
                            backgroundSize: "22px 22px",
                        }}
                    />

                    <div className="relative px-5 py-10 min-h-full flex flex-col items-center">
                        {/* Error banner — with retry CTA when we know which step failed */}
                        {error && (
                            <div className="w-full max-w-3xl flex items-start gap-3 px-4 py-3 rounded-lg border border-destructive/30 bg-destructive/10 mb-6 animate-fade-up">
                                <AlertCircle size={14} className="text-destructive shrink-0 mt-0.5" />
                                <div className="flex-1 min-w-0">
                                    <p className="text-[13px] text-destructive font-medium">{error}</p>
                                    {failedIdx >= 0 && (
                                        <p className="text-[11.5px] text-muted-foreground mt-1">
                                            Earlier steps stay completed. Hit retry to resume from step {failedIdx + 1}.
                                        </p>
                                    )}
                                </div>
                                {failedIdx >= 0 && file && (
                                    <button
                                        onClick={() => runPipeline(failedIdx)}
                                        className="shrink-0 inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-destructive/15 text-destructive border border-destructive/30 text-[12px] font-semibold hover:bg-destructive/20 transition-colors"
                                    >
                                        <RotateCw size={11} /> Retry from {failedIdx + 1}
                                    </button>
                                )}
                                {errorReport && (
                                    <button
                                        onClick={() => navigator.clipboard.writeText(errorReport).catch(() => {})}
                                        className="hidden sm:inline-flex shrink-0 items-center h-8 px-3 rounded-md border border-border bg-card text-[12px] font-semibold text-muted-foreground hover:text-destructive hover:bg-secondary/60 transition-colors"
                                    >
                                        Copy report
                                    </button>
                                )}
                                <button
                                    onClick={() => { setError(null); setErrorReport(null); }}
                                    className="shrink-0 h-7 w-7 inline-flex items-center justify-center rounded text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                                    aria-label="Dismiss"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        )}

                        {/* Result banner */}
                        {resultUrl && resultBlob && (
                            <div className="w-full max-w-3xl flex items-center gap-3 px-4 py-3 rounded-lg border border-accent/30 bg-accent/10 mb-6 animate-fade-up">
                                <CheckCircle size={15} className="text-accent shrink-0 animate-success-pop" />
                                <span className="text-[13.5px] font-medium text-foreground flex-1">
                                    Pipeline complete. <span className="font-mono text-[12px] text-muted-foreground ml-1">{(resultBlob.size / 1024).toFixed(0)} KB</span>
                                </span>
                                <a
                                    href={resultUrl}
                                    download={outputName}
                                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-accent text-accent-foreground text-[12.5px] font-semibold hover:brightness-105 transition-all"
                                >
                                    <Download size={11} /> Download
                                </a>
                                <button
                                    onClick={() => runPipeline(0)}
                                    className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border text-[12.5px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                                    title="Run again with same input"
                                >
                                    <RefreshCw size={11} /> Run again
                                </button>
                            </div>
                        )}

                        {/* Chain — horizontal flow when wide, vertical when narrow */}
                        <div className="w-full max-w-3xl">
                            {/* Track 1: input node */}
                            <FlowNode
                                kind="endpoint"
                                title={file ? file.name : "Drop a PDF"}
                                subtitle={file ? `${(file.size / 1024).toFixed(0)} KB · input` : "Click or drop a file here"}
                                onClick={() => inputRef.current?.click()}
                                onDrop={setInputFile}
                                onClear={file ? () => setInputFile(null) : undefined}
                                state={file ? "ready" : "empty"}
                            />
                            <input ref={inputRef} type="file" accept=".pdf" className="hidden" onChange={(e) => setInputFile(e.target.files?.[0] || null)} />

                            {steps.length > 0 && <Connector active={processing && currentStep === 0} done={stepStatuses[0] === "done"} />}

                            {/* Steps */}
                            {steps.map((step, i) => {
                                const Icon = step.tool.icon;
                                const status = stepStatuses[i];
                                const isRunning = status === "running";
                                const isDone = status === "done";
                                const hasError = status === "error";
                                const isDragOver = dragOverIdx === i && draggingIdx !== null && draggingIdx !== i;
                                return (
                                    <div key={`${step.tool.slug}-${i}`}>
                                        {/* Drop indicator above this row */}
                                        {isDragOver && draggingIdx !== null && draggingIdx > i && (
                                            <div className="h-0.5 bg-accent rounded-full mb-1 mx-2 animate-fade-in" aria-hidden="true" />
                                        )}
                                        <div
                                            draggable={!processing}
                                            onDragStart={(e) => {
                                                if (processing) return;
                                                setDraggingIdx(i);
                                                e.dataTransfer.effectAllowed = "move";
                                                // Required for Firefox to start the drag.
                                                try { e.dataTransfer.setData("text/plain", String(i)); } catch {}
                                            }}
                                            onDragOver={(e) => {
                                                if (draggingIdx === null) return;
                                                e.preventDefault();
                                                e.dataTransfer.dropEffect = "move";
                                                setDragOverIdx(i);
                                            }}
                                            onDragLeave={() => {
                                                if (dragOverIdx === i) setDragOverIdx(null);
                                            }}
                                            onDrop={(e) => {
                                                e.preventDefault();
                                                if (draggingIdx === null || draggingIdx === i) return;
                                                reorderStep(draggingIdx, i);
                                                setDraggingIdx(null);
                                                setDragOverIdx(null);
                                            }}
                                            onDragEnd={() => {
                                                setDraggingIdx(null);
                                                setDragOverIdx(null);
                                            }}
                                            className={cn(
                                                "group relative flex items-center gap-3 px-4 py-3 rounded-xl border bg-card transition-all",
                                                `cat-${step.tool.category}`,
                                                draggingIdx === i && "opacity-40 scale-[0.98]",
                                                isRunning && "border-accent/60 bg-accent/[0.04] shadow-[0_0_0_3px_hsl(var(--accent)/0.18),0_8px_24px_-8px_hsl(var(--accent)/0.30)]",
                                                isDone && "border-accent/30",
                                                hasError && "border-destructive/40 bg-destructive/[0.04]",
                                                !isRunning && !isDone && !hasError && "border-border hover:border-border-strong",
                                                !processing && "cursor-grab active:cursor-grabbing"
                                            )}
                                        >
                                            {/* Drag handle — desktop only, visible cue for reorder */}
                                            {!processing && (
                                                <GripVertical
                                                    size={13}
                                                    className="hidden lg:block text-muted-foreground/40 group-hover:text-muted-foreground shrink-0 -ml-1.5 transition-colors"
                                                    aria-hidden="true"
                                                />
                                            )}
                                            {/* Step number */}
                                            <div className={cn(
                                                "flex h-9 w-9 items-center justify-center rounded-lg font-mono text-[12px] font-semibold shrink-0",
                                                isRunning ? "bg-accent text-accent-foreground" :
                                                isDone    ? "bg-accent/20 text-accent" :
                                                hasError  ? "bg-destructive/15 text-destructive" :
                                                            "bg-paper-2 text-muted-foreground border border-border"
                                            )}>
                                                {String(i + 1).padStart(2, "0")}
                                            </div>

                                            <span className="icon-tile icon-tile-sm shrink-0">
                                                <Icon size={14} strokeWidth={1.75} />
                                            </span>

                                            <div className="flex-1 min-w-0">
                                                <p className="font-display text-[15px] font-semibold text-foreground tracking-[-0.015em] truncate leading-tight">
                                                    {step.tool.name}
                                                </p>
                                                <p className={cn(
                                                    "font-mono text-[10.5px] tracking-[0.06em] uppercase truncate",
                                                    hasError ? "text-destructive" : "text-muted-foreground"
                                                )}>
                                                    {isRunning ? "Running…" :
                                                     isDone    ? "Done" :
                                                     hasError  ? (stepErrors[i] || "Failed") :
                                                                 "Queued"}
                                                </p>
                                            </div>

                                            {isRunning && <Loader2 size={15} className="shrink-0 text-accent animate-spin" />}
                                            {isDone && !isRunning && <CheckCircle size={15} className="shrink-0 text-accent animate-success-pop" />}
                                            {hasError && <AlertCircle size={15} className="shrink-0 text-destructive" />}

                                            {!processing && (
                                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    {hasError && file && (
                                                        <button
                                                            onClick={() => runPipeline(i)}
                                                            className="h-7 px-2 inline-flex items-center gap-1 rounded text-[10.5px] font-semibold uppercase tracking-wider text-destructive hover:bg-destructive/10"
                                                            title={`Retry from step ${i + 1}`}
                                                        >
                                                            <RotateCw size={10} /> Retry
                                                        </button>
                                                    )}
                                                    {i > 0 && (
                                                        <button onClick={() => moveStep(i, -1)} className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/70" title="Move up" aria-label="Move step up">
                                                            <ChevronLeft size={12} className="rotate-90" />
                                                        </button>
                                                    )}
                                                    {i < steps.length - 1 && (
                                                        <button onClick={() => moveStep(i, 1)} className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/70" title="Move down" aria-label="Move step down">
                                                            <ChevronRight size={12} className="rotate-90" />
                                                        </button>
                                                    )}
                                                    <button onClick={() => removeStep(i)} className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10" title="Remove" aria-label="Remove step">
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        {/* Drop indicator below this row */}
                                        {isDragOver && draggingIdx !== null && draggingIdx < i && (
                                            <div className="h-0.5 bg-accent rounded-full mt-1 mx-2 animate-fade-in" aria-hidden="true" />
                                        )}
                                        {i < steps.length - 1 && (
                                            <Connector
                                                active={processing && currentStep === i + 1}
                                                done={stepStatuses[i + 1] === "done"}
                                            />
                                        )}
                                    </div>
                                );
                            })}

                            {steps.length > 0 && (
                                <Connector
                                    active={processing && currentStep === steps.length - 1 && stepStatuses[steps.length - 1] === "running"}
                                    done={!!resultUrl}
                                />
                            )}

                            {/* Output node */}
                            <FlowNode
                                kind="endpoint"
                                title={resultUrl ? outputName : "Final output"}
                                subtitle={resultBlob ? `${(resultBlob.size / 1024).toFixed(0)} KB · output` : steps.length === 0 ? "Add steps to define the output" : "Run pipeline to generate"}
                                state={resultUrl ? "ready" : "empty"}
                                outputIcon={!!resultUrl}
                                href={resultUrl || undefined}
                                downloadName={outputName}
                            />

                            {/* Inline "Add step" — mobile only since desktop has palette rail */}
                            {!processing && steps.length > 0 && (
                                <button
                                    onClick={() => setPaletteOpen(true)}
                                    className="lg:hidden mt-4 w-full inline-flex items-center justify-center gap-2 h-11 rounded-xl border border-dashed border-border-strong text-[13px] font-medium text-muted-foreground hover:border-accent hover:text-accent hover:bg-accent/[0.04] transition-colors"
                                >
                                    <Plus size={13} /> Add step
                                </button>
                            )}

                            {/* Empty state — onboarding flow with sample pipelines */}
                            {steps.length === 0 && (
                                <div className="mt-6 animate-fade-up">
                                    <div className="text-center px-5 py-8 rounded-xl border border-dashed border-border-strong bg-paper-2/30 mb-5 relative">
                                        <CornerMarks />
                                        <div className="h-12 w-12 mx-auto mb-3 rounded-xl bg-accent/10 border border-accent/30 flex items-center justify-center">
                                            <Layers size={20} className="text-accent" />
                                        </div>
                                        <p className="font-display text-[18px] font-semibold text-foreground mb-1 tracking-[-0.015em]">
                                            Build a workflow, run many tools in sequence
                                        </p>
                                        <p className="text-[13px] text-muted-foreground max-w-md mx-auto leading-relaxed">
                                            Each step processes the output of the previous one. Drop a PDF above, pick a sample to get started, or build your own from the palette.
                                        </p>
                                    </div>

                                    {/* Sample pipelines — quick-start chips */}
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        {RECIPES.map((r, idx) => (
                                            <button
                                                key={r.name}
                                                onClick={() => loadRecipe(r.slugs)}
                                                className={cn(
                                                    "group text-left rounded-xl border border-border bg-card hover:border-accent/50 hover:bg-accent/[0.03] transition-all p-3.5",
                                                    "animate-fade-up",
                                                    `stagger-${idx + 1}`
                                                )}
                                            >
                                                <div className="flex items-center gap-1.5 mb-1.5">
                                                    <Sparkles size={11} className="text-accent" />
                                                    <p className="font-display text-[14px] font-semibold text-foreground tracking-[-0.015em]">{r.name}</p>
                                                    <ArrowRight size={11} className="text-muted-foreground/40 ml-auto group-hover:text-accent group-hover:translate-x-0.5 transition-all" />
                                                </div>
                                                <p className="text-[12px] text-muted-foreground leading-snug mb-2">{r.description}</p>
                                                <div className="flex items-center gap-1 flex-wrap">
                                                    {r.slugs.map((s, sidx) => {
                                                        const t = pipelineTools.find(p => p.slug === s);
                                                        if (!t) return null;
                                                        return (
                                                            <span key={s} className="inline-flex items-center">
                                                                <span className="font-mono text-[10px] text-muted-foreground/85 bg-paper-2 px-1.5 py-0.5 rounded">
                                                                    {t.name}
                                                                </span>
                                                                {sidx < r.slugs.length - 1 && <ArrowRight size={9} className="text-muted-foreground/50 mx-1" />}
                                                            </span>
                                                        );
                                                    })}
                                                </div>
                                            </button>
                                        ))}
                                    </div>

                                    {/* Saved pipelines — only shown if user has any */}
                                    {savedPipelines.length > 0 && (
                                        <div className="mt-6">
                                            <div className="flex items-center gap-2 mb-2 px-1">
                                                <Bookmark size={11} className="text-accent" />
                                                <span className="font-mono text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">Your saved pipelines</span>
                                            </div>
                                            <div className="space-y-1.5">
                                                {savedPipelines.map(sp => (
                                                    <div
                                                        key={sp.name}
                                                        className="group flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-card hover:border-accent/40 transition-colors"
                                                    >
                                                        <button
                                                            onClick={() => loadRecipe(sp.slugs)}
                                                            className="flex-1 flex items-center gap-2 min-w-0 text-left"
                                                        >
                                                            <Bookmark size={11} className="text-accent shrink-0" fill="currentColor" />
                                                            <div className="flex-1 min-w-0">
                                                                <p className="font-display text-[13px] font-semibold text-foreground tracking-[-0.015em] truncate">{sp.name}</p>
                                                                <p className="font-mono text-[10px] text-muted-foreground truncate">
                                                                    {sp.slugs.length} step{sp.slugs.length !== 1 ? "s" : ""} · saved {timeAgo(sp.savedAt)}
                                                                </p>
                                                            </div>
                                                            <ArrowDown size={11} className="text-muted-foreground/40 group-hover:text-accent rotate-[-90deg] transition-colors shrink-0" />
                                                        </button>
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); deleteSavedPipeline(sp.name); }}
                                                            className="opacity-0 group-hover:opacity-100 h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all"
                                                            title="Delete saved pipeline"
                                                            aria-label={`Delete ${sp.name}`}
                                                        >
                                                            <X size={11} />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* ─── Tool palette (right rail on desktop, drawer on mobile) ── */}
            <aside
                className={cn(
                    "border-l border-border bg-paper-2/40 flex flex-col",
                    "lg:w-80 lg:flex",
                    paletteOpen ? "fixed inset-y-11 right-0 z-50 w-[88vw] max-w-sm flex animate-slide-in-right" : "hidden lg:flex",
                )}
                aria-label="Tool palette"
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-border">
                    <div className="flex items-center gap-2">
                        <p className="section-mark">Palette</p>
                    </div>
                    <button
                        onClick={() => setPaletteOpen(false)}
                        className="lg:hidden h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                        aria-label="Close palette"
                    >
                        <X size={14} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto">
                    {/* Saved pipelines section in palette — recall affordance for repeat users */}
                    {savedPipelines.length > 0 && (
                        <div className="px-4 pt-4 pb-2 border-b border-border/60">
                            <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                    <Bookmark size={11} className="text-accent" fill="currentColor" />
                                    <span className="font-mono text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">Saved · {savedPipelines.length}</span>
                                </div>
                                {steps.length > 0 && (
                                    <button
                                        onClick={saveCurrentPipeline}
                                        className="font-mono text-[9.5px] tracking-[0.10em] uppercase text-accent hover:underline"
                                        title="Save current pipeline"
                                    >
                                        + Save
                                    </button>
                                )}
                            </div>
                            <div className="space-y-1 mb-3">
                                {savedPipelines.slice(0, 4).map(sp => (
                                    <div key={sp.name} className="group flex items-center gap-1.5">
                                        <button
                                            onClick={() => loadRecipe(sp.slugs)}
                                            className="flex-1 text-left px-2 py-1.5 rounded text-[12px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 truncate transition-colors"
                                            title={`${sp.slugs.length} steps`}
                                        >
                                            <span className="text-accent mr-1.5">§</span>{sp.name}
                                        </button>
                                        <button
                                            onClick={() => deleteSavedPipeline(sp.name)}
                                            className="opacity-0 group-hover:opacity-100 h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-all shrink-0"
                                            aria-label={`Delete ${sp.name}`}
                                        >
                                            <X size={10} />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Recipes */}
                    <div className="px-4 pt-4 pb-2">
                        <div className="flex items-center gap-2 mb-3">
                            <Sparkles size={11} className="text-accent" />
                            <span className="font-mono text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">Quick recipes</span>
                        </div>
                        <div className="space-y-1.5">
                            {RECIPES.map(r => (
                                <button
                                    key={r.name}
                                    onClick={() => loadRecipe(r.slugs)}
                                    className="group block w-full text-left rounded-lg border border-border bg-card hover:border-accent/40 hover:bg-card transition-colors p-3"
                                >
                                    <p className="font-display text-[13.5px] font-semibold text-foreground tracking-[-0.015em] mb-0.5">{r.name}</p>
                                    <p className="text-[12px] text-muted-foreground leading-snug mb-2">{r.description}</p>
                                    <div className="flex items-center gap-1 flex-wrap">
                                        {r.slugs.map((s, idx) => {
                                            const t = pipelineTools.find(p => p.slug === s);
                                            if (!t) return null;
                                            return (
                                                <span key={s} className="inline-flex items-center">
                                                    <span className="font-mono text-[10px] text-muted-foreground/85 bg-paper-2 px-1.5 py-0.5 rounded">
                                                        {t.name}
                                                    </span>
                                                    {idx < r.slugs.length - 1 && <ArrowRight size={9} className="text-muted-foreground/50 mx-1" />}
                                                </span>
                                            );
                                        })}
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* All tools — grouped by category */}
                    <div className="px-4 pt-4 pb-4">
                        <div className="flex items-center gap-2 mb-2">
                            <Layers size={11} className="text-accent" />
                            <span className="font-mono text-[10px] font-semibold tracking-[0.12em] uppercase text-muted-foreground">All tools · {pipelineTools.length}</span>
                        </div>
                        <div className="relative mb-3">
                            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                            <input
                                className="w-full h-8 pl-7 pr-7 rounded-md border border-border bg-card text-[12.5px] text-foreground placeholder:text-muted-foreground/80 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                placeholder={`Filter ${pipelineTools.length}…`}
                                value={paletteSearch}
                                onChange={e => setPaletteSearch(e.target.value)}
                            />
                            {paletteSearch && (
                                <button
                                    onClick={() => setPaletteSearch("")}
                                    className="absolute right-1.5 top-1/2 -translate-y-1/2 h-5 w-5 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                                    aria-label="Clear search"
                                >
                                    <X size={10} />
                                </button>
                            )}
                        </div>
                        {paletteSearch.trim() ? (
                            // Flat results when searching
                            <div className="space-y-px">
                                {filteredPalette.map(t => (
                                    <PaletteToolButton key={t.slug} tool={t} onAdd={addStep} />
                                ))}
                                {filteredPalette.length === 0 && (
                                    <p className="text-[11px] text-muted-foreground px-2 py-2">No tools match "{paletteSearch}".</p>
                                )}
                            </div>
                        ) : (
                            // Grouped by category when idle
                            <div className="space-y-3">
                                {CATEGORY_ORDER.map(group => {
                                    const groupTools = pipelineTools.filter(t => group.cats.has(t.category));
                                    if (groupTools.length === 0) return null;
                                    return (
                                        <div key={group.id}>
                                            <p className="px-2 mb-1 font-mono text-[9.5px] font-medium tracking-[0.10em] uppercase text-muted-foreground/85">
                                                <span className="text-accent">§</span> {group.label} · {groupTools.length}
                                            </p>
                                            <div className="space-y-px">
                                                {groupTools.map(t => (
                                                    <PaletteToolButton key={t.slug} tool={t} onAdd={addStep} />
                                                ))}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </aside>

            {/* Workshop name dialog — replaces window.prompt */}
            {nameDialog && (
                <NameDialog
                    title={nameDialog.title}
                    label={nameDialog.label}
                    initial={nameDialog.initial}
                    onCancel={() => setNameDialog(null)}
                    onConfirm={(value) => {
                        nameDialog.onConfirm(value);
                        setNameDialog(null);
                    }}
                />
            )}
        </div>
    );
}

/**
 * NameDialog — workshop replacement for window.prompt.
 *
 * Portal-rendered to document.body so it overlays correctly even when
 * the page is wrapped in transformed containers. Enter confirms,
 * Escape cancels, the named input autofocuses on mount.
 */
function NameDialog({
    title, label, initial, onConfirm, onCancel,
}: {
    title: string;
    label: string;
    initial: string;
    onConfirm: (value: string) => void;
    onCancel: () => void;
}) {
    const [value, setValue] = useState(initial);
    const inputRef = useRef<HTMLInputElement>(null);
    const dialogRef = useRef<HTMLDivElement>(null);

    // Autofocus + select on open. Wrapped in a microtask so the portal's
    // mount has settled before we grab focus.
    useEffect(() => {
        const t = window.setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        }, 10);
        return () => window.clearTimeout(t);
    }, []);

    // Focus trap (Tab cycling + Escape + restore-focus-on-close). We pass
    // skipInitialFocus because the manual setTimeout above handles initial
    // focus with a select() that the hook doesn't replicate.
    useFocusTrap(dialogRef, true, { onEscape: onCancel, skipInitialFocus: true });

    const submit = () => {
        const trimmed = value.trim();
        if (trimmed) onConfirm(trimmed);
    };

    return createPortal(
        <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="fixed inset-0 z-[110] flex items-center justify-center p-4 animate-fade-in"
        >
            {/* Backdrop */}
            <div
                aria-hidden="true"
                className="absolute inset-0 bg-foreground/35 backdrop-blur-md"
                onClick={onCancel}
            />

            {/* Card */}
            <div className="relative w-full max-w-md rounded-2xl border border-accent/40 bg-paper shadow-[0_30px_60px_-20px_rgba(20,15,5,0.4)] dark:shadow-[0_30px_60px_-20px_rgba(0,0,0,0.7)] animate-corner-extend">
                <CornerMarks />
                <div className="p-6 sm:p-7">
                    <p className="section-mark mb-2">Pipeline</p>
                    <h2
                        className="font-display text-[24px] sm:text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight"
                        style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}
                    >
                        {title.split(" ").map((w, i, arr) =>
                            i === arr.length - 1
                                ? <span key={i} className="italic text-accent">{w}</span>
                                : <span key={i}>{w} </span>
                        )}
                    </h2>

                    <label className="block mt-5">
                        <span className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span className="text-accent">§</span> {label}
                        </span>
                        <input
                            ref={inputRef}
                            name="pipelineName"
                            type="text"
                            value={value}
                            maxLength={80}
                            onChange={(e) => setValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault();
                                    submit();
                                }
                            }}
                            className="mt-1.5 w-full rounded-md border border-border bg-card px-3 py-2.5 text-[15px] text-foreground placeholder:text-muted-foreground/60 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                            placeholder="Untitled pipeline"
                            aria-label={label}
                        />
                    </label>

                    <div className="mt-5 flex items-center justify-end gap-2">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="inline-flex items-center h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={submit}
                            disabled={!value.trim()}
                            className="btn-accent h-9 px-5 text-[13px] disabled:opacity-60 disabled:cursor-not-allowed"
                        >
                            Save
                        </button>
                    </div>

                    <p className="mt-3 font-mono text-[10px] tracking-[0.08em] uppercase text-muted-foreground/70">
                        ↵ Save · esc Cancel
                    </p>
                </div>
            </div>
        </div>,
        document.body
    );
}

/** Corner registration marks — workshop motif, used on the empty state. */
function CornerMarks() {
    const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}>
                <span className="absolute top-0 left-0 h-px w-3 bg-accent/70" />
                <span className="absolute top-0 left-0 w-px h-3 bg-accent/70" />
            </span>
            <span className={`${cls} -top-1 -right-1`}>
                <span className="absolute top-0 right-0 h-px w-3 bg-accent/70" />
                <span className="absolute top-0 right-0 w-px h-3 bg-accent/70" />
            </span>
            <span className={`${cls} -bottom-1 -left-1`}>
                <span className="absolute bottom-0 left-0 h-px w-3 bg-accent/70" />
                <span className="absolute bottom-0 left-0 w-px h-3 bg-accent/70" />
            </span>
            <span className={`${cls} -bottom-1 -right-1`}>
                <span className="absolute bottom-0 right-0 h-px w-3 bg-accent/70" />
                <span className="absolute bottom-0 right-0 w-px h-3 bg-accent/70" />
            </span>
        </>
    );
}

/** Small helper — "5m ago", "2h ago", "3d ago". */
function timeAgo(ts: number) {
    const seconds = Math.floor((Date.now() - ts) / 1000);
    if (seconds < 60)        return "just now";
    if (seconds < 3600)      return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400)     return `${Math.floor(seconds / 3600)}h ago`;
    if (seconds < 86400 * 7) return `${Math.floor(seconds / 86400)}d ago`;
    return new Date(ts).toLocaleDateString();
}

/** Endpoint node — file input / final output card. */
function FlowNode({
    kind, title, subtitle, state, outputIcon,
    onClick, onClear, onDrop, href, downloadName,
}: {
    kind: "endpoint";
    title: string;
    subtitle: string;
    state: "empty" | "ready";
    outputIcon?: boolean;
    onClick?: () => void;
    onClear?: () => void;
    onDrop?: (f: File) => void;
    href?: string;
    downloadName?: string;
}) {
    const [dragOver, setDragOver] = useState(false);
    const empty = state === "empty";

    const inner = (
        <>
            <div className={cn(
                "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
                empty ? "bg-secondary border border-border" : "bg-accent/15 border border-accent/35 text-accent"
            )}>
                {outputIcon ? <Download size={16} /> : <FileText size={16} className={empty ? "text-muted-foreground" : "text-accent"} />}
            </div>
            <div className="flex-1 min-w-0">
                <p className={cn("font-display text-[15px] font-semibold tracking-[-0.015em] truncate leading-tight", empty ? "text-muted-foreground italic font-medium" : "text-foreground")}>
                    {title}
                </p>
                <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground mt-0.5 truncate">{subtitle}</p>
            </div>
        </>
    );

    const baseClass = cn(
        "relative flex items-center gap-3 px-4 py-3 rounded-xl transition-colors w-full text-left",
        empty
            ? "border-2 border-dashed border-border-strong bg-paper-2/30 hover:border-accent/50 hover:bg-accent/[0.04] cursor-pointer"
            : "border border-accent/40 bg-card",
        dragOver && "border-accent bg-accent/[0.06]"
    );

    if (href && downloadName) {
        return (
            <a href={href} download={downloadName} className={baseClass}>
                {inner}
                <ArrowRight size={14} className="text-accent shrink-0" />
            </a>
        );
    }
    return (
        <button
            type="button"
            onClick={onClick}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f && onDrop) onDrop(f);
            }}
            className={baseClass}
        >
            {inner}
            {onClear && (
                <span
                    role="button"
                    tabIndex={0}
                    aria-label="Remove file"
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onClear(); }}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); e.stopPropagation(); onClear(); } }}
                    className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 cursor-pointer"
                >
                    <X size={12} />
                </span>
            )}
        </button>
    );
}

/** Palette tool button — extracted for reuse between grouped + filtered views. */
function PaletteToolButton({
    tool, onAdd,
}: {
    tool: (typeof pipelineTools)[0];
    onAdd: (t: (typeof pipelineTools)[0]) => void;
}) {
    const Ic = tool.icon;
    return (
        <button
            onClick={() => onAdd(tool)}
            className={cn(
                "group flex items-center gap-2 w-full px-2 h-8 rounded-md text-[12.5px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:bg-secondary transition-colors duration-150",
                `cat-${tool.category}`
            )}
        >
            <Ic size={12} strokeWidth={1.75} style={{ color: "hsl(var(--tile, var(--accent)))" }} className="shrink-0 transition-transform group-hover:scale-110" />
            <span className="flex-1 text-left truncate">{tool.name}</span>
            <Plus
                size={11}
                className="text-muted-foreground/40 group-hover:text-accent transition-all group-hover:rotate-90 duration-200"
            />
        </button>
    );
}

/** Vertical connector between flow nodes. Animated when active. */
function Connector({ active, done }: { active: boolean; done?: boolean }) {
    return (
        <div className="relative h-10 flex items-center justify-center" aria-hidden="true">
            {/* Vertical connector line */}
            <svg
                width="2"
                height="40"
                viewBox="0 0 2 40"
                fill="none"
                className="absolute inset-0 m-auto"
            >
                <line
                    x1="1" y1="0" x2="1" y2="36"
                    stroke={done ? "hsl(var(--accent))" : active ? "hsl(var(--accent) / 0.7)" : "hsl(var(--border-strong))"}
                    strokeWidth="2"
                    strokeDasharray={done || active ? undefined : "4 4"}
                />
            </svg>
            {/* Arrowhead at the bottom */}
            <span className={cn(
                "absolute bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 w-2 h-2 rotate-45 border-r-2 border-b-2 transition-colors",
                done ? "border-accent" : active ? "border-accent/70" : "border-border-strong"
            )} />
            {/* Moving spark */}
            {active && (
                <span
                    className="absolute w-2 h-2 rounded-full bg-accent shadow-[0_0_10px_3px_hsl(var(--accent)/0.7)] pipeline-spark-down"
                />
            )}
        </div>
    );
}
