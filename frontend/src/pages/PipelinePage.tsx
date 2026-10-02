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
    FileText, ArrowRight, Search, Trash2,
    ChevronLeft, ChevronRight, Sparkles, RotateCw, GripVertical,
    BookmarkPlus, Bookmark, Square, RefreshCw, Share2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { emitToolRun } from "@/lib/toolRun";
import { adviseRejection, type RejectionAdvice } from "@/lib/file-acceptance";
import { IntakeNotice } from "@/skins/experience/ToolStudio";
import { navigateTo } from "@/lib/navigation";
import { tools } from "@/data/tools";
import { getToolEndpoint } from "@/lib/tool-endpoints";
import { uploadFieldFor } from "@/lib/upload-fields";
import { downloadBlob, formatErrorForClipboard, postFormData } from "@/lib/api";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import "@/skins/experience/workflows.css";

/**
 * Pipeline-safe tools — those that take a PDF and return a PDF without
 * requiring user-specific input (text, ranges, signatures). Grouped by
 * category in the palette below.
 */
/**
 * Steps `/api/pipeline` can run server-side in ONE request.
 *
 * When every selected step is in this set we send the document once and the
 * server chains them; otherwise we fall back to the per-step loop below, which
 * re-uploads the document for each step. A 50 MB PDF through 5 steps is 250 MB
 * up either way in the fallback, versus 50 MB on the fast path.
 *
 * `test_pipeline_frontend_contract.py` fails if this drifts from the backend
 * catalog — that drift is exactly why the API sat unused with 2 steps while
 * this page offered 25.
 */
const API_PIPELINE_STEPS = new Set([
    "compress-pdf", "repair-pdf", "deskew-pdf", "grayscale-pdf", "flatten-pdf",
    "rotate-pdf", "reverse-pdf", "nup", "booklet-pdf",
    "page-numbers", "bates-numbering", "header-footer", "watermark", "stamp-pdf",
    "strip-metadata", "delete-annotations", "pdf-to-pdfa",
]);

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

function encodePipelineSlugs(slugs: string[]): string {
    const json = JSON.stringify({ version: 1, steps: slugs });
    return window.btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodePipelineSlugs(raw: string): string[] {
    try {
        const base64 = raw.replace(/-/g, "+").replace(/_/g, "/");
        const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
        const parsed = JSON.parse(window.atob(padded));
        const steps = Array.isArray(parsed) ? parsed : parsed?.steps;
        if (!Array.isArray(steps)) return [];
        return steps.filter((s): s is string => typeof s === "string");
    } catch {
        return [];
    }
}

function loadSharedSlugs(): string[] {
    try {
        const raw = new URLSearchParams(window.location.search).get("p");
        return raw ? decodePipelineSlugs(raw) : [];
    } catch {
        return [];
    }
}

function shareUrlForSlugs(slugs: string[]): string {
    const url = new URL("/pipeline", window.location.origin);
    url.searchParams.set("p", encodePipelineSlugs(slugs));
    return url.toString();
}

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
        const sharedSlugs = loadSharedSlugs();
        const slugs = sharedSlugs.length > 0 ? sharedSlugs : loadDraftSlugs();
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
    const [compactPalette, setCompactPalette] = useState(() => typeof window !== "undefined" && window.innerWidth <= 800);
    const paletteRef = useRef<HTMLElement>(null);
    const closePalette = useCallback(() => setPaletteOpen(false), []);
    useFocusTrap(paletteRef, paletteOpen && compactPalette, { onEscape: closePalette });
    useEffect(() => {
        const update = () => setCompactPalette(window.innerWidth <= 800);
        window.addEventListener("resize", update);
        return () => window.removeEventListener("resize", update);
    }, []);
    const [savedPipelines, setSavedPipelines] = useState<SavedPipeline[]>(loadSavedPipelines);
    const [shareCopied, setShareCopied] = useState(false);
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
        setShareCopied(false);
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
        if (processing) return;
        setFile(nextFile);
        resetRunState();
    }, [resetRunState, processing]);

    // Neither a drop nor "All files" in the chooser filters to PDFs. A file
    // that isn't a PDF is named in the shared intake notice, with the
    // converter that takes it, instead of becoming the input.
    const [refusal, setRefusal] = useState<RejectionAdvice | null>(null);
    const takeInputFile = useCallback((picked: File | null) => {
        if (processing) return;
        if (picked && !picked.name.toLowerCase().endsWith(".pdf")) {
            setRefusal(adviseRejection([picked], { accepts: ".pdf", prefer: "convert", name: "A pipeline" }));
            return;
        }
        setRefusal(null);
        setInputFile(picked);
    }, [processing, setInputFile]);

    const addStep = (tool: (typeof pipelineTools)[0]) => {
        if (processing) return;
        setSteps((prev) => [...prev, { tool }]);
        // Structural edits invalidate cached step output and final results.
        resetRunState();
        // Auto-close palette on mobile after adding a step.
        if (window.innerWidth < 1024) setPaletteOpen(false);
    };

    const loadRecipe = (slugs: string[]) => {
        if (processing) return;
        if (slugs.length === 1 && slugs[0] === "merge-pdf") {
            navigateTo("/tool/merge-pdf");
            return;
        }
        const stepObjs: PipelineStep[] = slugs
            .map(s => pipelineTools.find(t => t.slug === s))
            .filter((t): t is (typeof pipelineTools)[0] => Boolean(t))
            .map(t => ({ tool: t }));
        setSteps(stepObjs);
        resetRunState();
    };

    const removeStep = (idx: number) => {
        if (processing) return;
        setSteps(p => p.filter((_, i) => i !== idx));
        resetRunState();
    };

    const moveStep = (idx: number, dir: -1 | 1) => {
        if (processing) return;
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
        if (processing) return;
        if (from === to) return;
        setSteps(prev => {
            const arr = [...prev];
            const [item] = arr.splice(from, 1);
            // Dropping onto a card moves the dragged step to that position.
            arr.splice(to, 0, item);
            return arr;
        });
        resetRunState();
    };

    const clearAll = () => {
        if (processing) return;
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

    const shareCurrentPipeline = async () => {
        if (steps.length === 0) return;
        const url = shareUrlForSlugs(steps.map(s => s.tool.slug));
        try {
            await navigator.clipboard.writeText(url);
            setShareCopied(true);
        } catch {
            setError(`Share URL: ${url}`);
        }
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

        // ── Fast path: one upload, N steps, one download ──────────────
        // Only for a full run (a retry-from-step needs the intermediate blobs
        // the per-step loop produces) where every step is server-chainable.
        const canUseApi =
            startFromStep === 0 && steps.every(s => API_PIPELINE_STEPS.has(s.tool.slug));

        if (canUseApi) {
            const all = Object.fromEntries(steps.map((_, i) => [i, "running" as const]));
            setStepStatuses(all);
            try {
                const resp = await postFormData("/pipeline", () => {
                    const fd = new FormData();
                    fd.append("file", resumeBlob, file.name);
                    fd.append("steps", JSON.stringify(steps.map(s => s.tool.slug)));
                    return fd;
                }, { signal: controller.signal });

                const out = await resp.blob();
                if (!controller.signal.aborted) {
                    setStepStatuses(Object.fromEntries(steps.map((_, i) => [i, "done" as const])));
                    for (const step of steps) emitToolRun({ slug: step.tool.slug, mode: "pipeline", outcome: "success", files: 1 });
                    const url = URL.createObjectURL(out);
                    setResultBlob(out);
                    setResultUrl(url);
                    downloadBlob(out, `${file.name.replace(/\.pdf$/i, "")}_pipeline.pdf`);
                }
                setProcessing(false);
                setCurrentStep(-1);
                abortRef.current = null;
                return;
            } catch (e: unknown) {
                if (controller.signal.aborted) {
                    setStepStatuses({});
                    setProcessing(false);
                    setCurrentStep(-1);
                    abortRef.current = null;
                    return;
                }
                // Server-side chaining failed — fall through to the per-step
                // loop, which reports WHICH step broke.
                setStepStatuses({});
            }
        }

        let currentBlob: Blob = resumeBlob;

        for (let i = startFromStep; i < steps.length; i++) {
            if (controller.signal.aborted) break;
            setCurrentStep(i);
            setStepStatuses(prev => ({ ...prev, [i]: "running" }));
            try {
                const resp = await postFormData(steps[i].tool.endpoint, () => {
                    const formData = new FormData();
                    formData.append(uploadFieldFor(steps[i].tool.endpoint), currentBlob, file.name);
                    return formData;
                }, {
                    signal: controller.signal,
                });
                currentBlob = await resp.blob();
                intermediateBlobsRef.current[i] = currentBlob;
                setStepStatuses(prev => ({ ...prev, [i]: "done" }));
                emitToolRun({ slug: steps[i].tool.slug, mode: "pipeline", outcome: "success", files: 1 });
            } catch (e: unknown) {
                if (controller.signal.aborted) {
                    // User-initiated cancel — quiet exit.
                    setStepStatuses(prev => ({ ...prev, [i]: "queued" }));
                    break;
                }
                emitToolRun({ slug: steps[i].tool.slug, mode: "pipeline", outcome: "error", files: 1 }, e);
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
        <div className="pt-studio-page pt-workflow-page pt-pipeline-page" data-running={processing}>
            <header className="pt-workflow-header pt-studio-header">
                <div className="pt-workflow-heading">
                    <p className="pt-studio-kicker">PIPELINE / YOUR PDF ROUTINE</p>
                    <h1><span className="wf-air-copy">Good work, on repeat.</span><span className="wf-play-copy">Put your tools in a row.</span></h1>
                    <p>One PDF. A few thoughtful steps. Build a routine you can come back to.</p>
                </div>
                <div className="wf-header-actions">
                    <button className="wf-button" onClick={clearAll} disabled={processing || (!steps.length && !file)}><Trash2 size={15} /> Clear</button>
                    {processing ? <button className="wf-button wf-button-danger" onClick={cancelRun}><Square size={14} /> Cancel <span>{currentStep + 1}/{steps.length}</span></button>
                        : <button className="wf-button wf-button-primary" onClick={() => runPipeline(0)} disabled={!canRun}><Play size={15} /> Run pipeline</button>}
                </div>
            </header>

            <section className="wf-recipe-shelf" aria-label="Quick recipes">
                <div className="wf-shelf-label"><Sparkles size={18} /><div><h2>A good place to start</h2><p>Pick a recipe, then make it yours.</p></div></div>
                <div className="wf-recipes">
                    {RECIPES.map((recipe, index) => <button key={recipe.name} className="pt-pipeline-recipe" data-recipe-tone={index} disabled={processing} onClick={() => loadRecipe(recipe.slugs)}>
                        <span className="wf-recipe-top"><span className="wf-recipe-number">0{index + 1}</span><ArrowRight size={16} /></span>
                        <strong>{recipe.name}</strong><p>{recipe.description}</p><span className="wf-recipe-count">{recipe.slugs.length} steps</span>
                    </button>)}
                </div>
            </section>

            <div className="wf-pipeline-layout">
                <section className="pt-pipeline-main wf-work-sheet" aria-label="Workflow canvas">
                    <div className="wf-sheet-heading"><div><p className="wf-section-label">THE CANVAS</p><h2>Your workflow</h2></div><span className="wf-status-pill"><span />{processing ? "Working through your steps" : steps.length ? `${steps.length} steps · saved on this device` : "Ready when you are"}</span></div>
                    {error && <div className="wf-notice wf-notice-error" role="alert"><AlertCircle size={18} /><div><strong>{error}</strong>{failedIdx > 0 && <p>Earlier steps are kept. Continue from step {failedIdx + 1}.</p>}<div className="wf-inline-actions">{failedIdx >= 0 && file && <button onClick={() => runPipeline(failedIdx)}><RotateCw size={14} /> Retry from {failedIdx + 1}</button>}{errorReport && <button onClick={() => navigator.clipboard.writeText(errorReport).catch(() => {})}>Copy report</button>}</div></div><button aria-label="Dismiss" onClick={() => { setError(null); setErrorReport(null); }}><X size={16} /></button></div>}
                    <div className="pt-pipeline-builder">
                        <div className="wf-input-stage"><span className="wf-stage-label">START WITH A FILE</span>
                            <FlowNode kind="endpoint" title={file ? file.name : "Choose your PDF"} subtitle={file ? `${(file.size / 1024).toFixed(0)} KB · ready to work` : "Drop it here, or browse your device"} onClick={() => inputRef.current?.click()} onDrop={takeInputFile} onClear={file ? () => setInputFile(null) : undefined} disabled={processing} state={file ? "ready" : "empty"} />
                            <input ref={inputRef} disabled={processing} type="file" accept=".pdf" className="hidden" onChange={event => { takeInputFile(event.target.files?.[0] || null); event.target.value = ""; }} />
                            <IntakeNotice advice={refusal} onDismiss={() => setRefusal(null)} />
                        </div>
                        <div className="pt-pipeline-chain">
                            {steps.length > 0 && <Connector active={processing && currentStep === 0} done={stepStatuses[0] === "done"} />}
                            {steps.map((step, index) => {
                                const Icon = step.tool.icon;
                                const status = stepStatuses[index] || "queued";
                                return <div key={`${step.tool.slug}-${index}`} className="wf-chain-item">
                                    <article className={cn("pt-pipeline-step", draggingIdx === index && "wf-step-dragging", dragOverIdx === index && draggingIdx !== index && "wf-step-drop-target")} data-step-state={status} data-node-tone={index % 3} draggable={!processing}
                                        onDragStart={event => { if (processing) return; setDraggingIdx(index); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", String(index)); }}
                                        onDragOver={event => { if (draggingIdx === null || processing) return; event.preventDefault(); setDragOverIdx(index); }}
                                        onDragLeave={() => setDragOverIdx(null)}
                                        onDrop={event => { event.preventDefault(); if (draggingIdx !== null) reorderStep(draggingIdx, index); setDraggingIdx(null); setDragOverIdx(null); }}
                                        onDragEnd={() => { setDraggingIdx(null); setDragOverIdx(null); }}>
                                        <div className="pt-step-number">{status === "done" ? <CheckCircle size={22} /> : String(index + 1).padStart(2, "0")}</div>
                                        <div className="wf-step-copy"><span className="wf-step-category"><Icon size={14} /> {step.tool.category}</span><h3>{step.tool.name}</h3><p>{status === "running" ? "Working on this step…" : status === "done" ? "Finished and passed to the next step" : status === "error" ? (stepErrors[index] || "This step needs another try") : "Uses the output from the previous step"}</p></div>
                                        {status === "running" && <Loader2 size={20} className="animate-spin" />}
                                        {!processing && <div className="pt-step-controls">
                                            <GripVertical className="wf-drag-handle" size={16} aria-hidden="true" />
                                            {status === "error" && file && <button onClick={() => runPipeline(index)} aria-label={`Retry from step ${index + 1}`}><RotateCw size={16} /></button>}
                                            <button disabled={index === 0} onClick={() => moveStep(index, -1)} aria-label="Move step up"><ChevronLeft size={16} className="rotate-90" /></button>
                                            <button disabled={index === steps.length - 1} onClick={() => moveStep(index, 1)} aria-label="Move step down"><ChevronRight size={16} className="rotate-90" /></button>
                                            <button onClick={() => removeStep(index)} aria-label="Remove step"><X size={16} /></button>
                                        </div>}
                                    </article>
                                    <Connector active={processing && currentStep === index + 1} done={index === steps.length - 1 ? !!resultUrl : stepStatuses[index + 1] === "done"} />
                                </div>;
                            })}
                            {steps.length === 0 && <div className="pt-pipeline-empty"><div className="wf-empty-flow" aria-hidden="true"><span>01</span><i /><span>02</span><i /><span><CheckCircle size={22} /></span></div><h3>Give your PDF a clear path.</h3><p>Start with a recipe above, or choose your first tool. You can change the order at any time.</p><button className="wf-button" onClick={() => { setPaletteOpen(true); document.getElementById("pipeline-tool-search")?.focus(); }}><Plus size={16} /> Choose a step</button></div>}
                            {steps.length > 0 && <button className="wf-add-step" disabled={processing} onClick={() => { setPaletteOpen(true); document.getElementById("pipeline-tool-search")?.focus(); }}><Plus size={17} /> Add another step</button>}
                        </div>
                        <div className={cn("wf-output-stage", resultUrl && "wf-output-ready")}>
                            <div className="wf-output-icon">{resultUrl ? <CheckCircle size={23} /> : <Download size={23} />}</div><div><span className="wf-stage-label">THE FINISH LINE</span><h3>{resultUrl ? "Your PDF is ready." : "One finished PDF"}</h3><p>{resultBlob ? `${(resultBlob.size / 1024).toFixed(0)} KB · ${outputName}` : "Every step comes together in one download."}</p></div>
                            {resultUrl && <div className="wf-output-actions"><a className="wf-button wf-button-primary" href={resultUrl} download={outputName}><Download size={15} /> Download</a><button className="wf-text-button" onClick={() => runPipeline(0)}><RefreshCw size={14} /> Run again</button></div>}
                        </div>
                    </div>
                </section>

                {paletteOpen && compactPalette && <div className="wf-palette-backdrop" aria-hidden="true" onClick={closePalette} />}
                <aside ref={paletteRef} role={paletteOpen && compactPalette ? "dialog" : undefined} aria-modal={paletteOpen && compactPalette ? true : undefined} className={cn("pt-pipeline-palette wf-setup-rail", paletteOpen && "wf-palette-open")} aria-label="Tool palette">
                    <div className="wf-rail-heading"><div><p className="wf-section-label">MAKE IT YOURS</p><h2>Add a step</h2></div><button className="wf-palette-close" aria-label="Close palette" onClick={() => setPaletteOpen(false)}><X size={19} /></button></div>
                    <p className="wf-rail-description">Choose a tool to add it to the end of your workflow.</p>
                    <div className="wf-search"><Search size={17} /><input id="pipeline-tool-search" aria-label="Search pipeline tools" placeholder={`Filter ${pipelineTools.length} tools…`} value={paletteSearch} onChange={event => setPaletteSearch(event.target.value)} />{paletteSearch && <button aria-label="Clear search" onClick={() => setPaletteSearch("")}><X size={15} /></button>}</div>
                    <div className="wf-palette-tools">
                        {paletteSearch.trim() ? <div>{filteredPalette.map(tool => <PaletteToolButton key={tool.slug} tool={tool} onAdd={addStep} disabled={processing} />)}{!filteredPalette.length && <p className="wf-rail-description">No matching tools. Try another search.</p>}</div>
                            : CATEGORY_ORDER.map((group, index) => { const items = pipelineTools.filter(tool => group.cats.has(tool.category)); return items.length > 0 && <details className="wf-tool-group" key={group.id} open={index === 0}><summary>{group.label}<span>{items.length}</span></summary>{items.map(tool => <PaletteToolButton key={tool.slug} tool={tool} onAdd={addStep} disabled={processing} />)}</details>; })}
                    </div>
                    <div className="wf-saved-section"><div className="wf-subheading"><Bookmark size={17} /><h3>Your saved routines</h3></div>
                        {savedPipelines.length ? savedPipelines.map(saved => <div className="wf-saved-routine" key={saved.name}><button disabled={processing} onClick={() => loadRecipe(saved.slugs)}><strong>{saved.name}</strong><span>{saved.slugs.length} steps · {timeAgo(saved.savedAt)}</span></button><button disabled={processing} aria-label={`Delete ${saved.name}`} onClick={() => deleteSavedPipeline(saved.name)}><X size={15} /></button></div>) : <p>Save a workflow and it will be waiting here next time.</p>}
                        <div className="wf-inline-actions"><button disabled={processing || !steps.length} onClick={saveCurrentPipeline}><BookmarkPlus size={15} /> Save</button><button disabled={processing || !steps.length} onClick={shareCurrentPipeline}><Share2 size={15} /> {shareCopied ? "Copied" : "Share"}</button></div>
                    </div>
                    <p className="wf-device-note">The recipe stays in this browser. Your PDF is uploaded only when you run it.</p>
                </aside>
            </div>
            {nameDialog && <NameDialog title={nameDialog.title} label={nameDialog.label} initial={nameDialog.initial} onCancel={() => setNameDialog(null)} onConfirm={value => { nameDialog.onConfirm(value); setNameDialog(null); }} />}
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
                        <span className="font-medium text-[11.5px] text-muted-foreground">
                            {label}
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
                            className="mt-1.5 w-full rounded-md border border-border bg-card px-3 py-2.5 text-[15px] text-foreground placeholder:text-muted-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
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

                    <p className="font-medium mt-3 text-[11px] text-muted-foreground">
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
    onClick, onClear, onDrop, href, downloadName, disabled = false,
}: {
    kind: "endpoint";
    disabled?: boolean;
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
                <p className="font-medium text-[11.5px] text-muted-foreground mt-0.5 truncate">{subtitle}</p>
            </div>
        </>
    );

    const baseClass = cn(
        "pt-pipeline-endpoint relative flex items-center gap-3 px-4 py-3 rounded-xl transition-colors w-full text-left",
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
            disabled={disabled}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                if (disabled) return;
                const f = e.dataTransfer.files?.[0];
                if (f && onDrop) onDrop(f);
            }}
            className={baseClass}
        >
            {inner}
            {onClear && !disabled && (
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
    tool, onAdd, disabled = false,
}: {
    tool: (typeof pipelineTools)[0];
    onAdd: (t: (typeof pipelineTools)[0]) => void;
    disabled?: boolean;
}) {
    const Ic = tool.icon;
    return (
        <button
            disabled={disabled}
            onClick={() => onAdd(tool)}
            className={cn(
                "pt-palette-tool group flex items-center gap-2 w-full px-2 h-8 rounded-md text-[12.5px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 active:bg-secondary transition-colors duration-150",
                `cat-${tool.category}`
            )}
        >
            <Ic size={12} strokeWidth={1.75} style={{ color: "hsl(var(--tile, var(--accent)))" }} className="shrink-0 transition-transform group-hover:scale-110" />
            <span className="flex-1 text-left truncate">{tool.name}</span>
            <Plus
                size={11}
                className="text-muted-foreground group-hover:text-accent transition-all group-hover:rotate-90 duration-200"
            />
        </button>
    );
}

/** Vertical connector between flow nodes. Animated when active. */
function Connector({ active, done }: { active: boolean; done?: boolean }) {
    return (
        <div className="pt-pipeline-connector relative h-10 flex items-center justify-center" data-active={active} data-done={done} aria-hidden="true">
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
