/**
 * FormCreatorUI — build interactive form fields and inject them into a PDF.
 * Workshop: field cards with type-aware controls, position grid, comma-sep options.
 *
 * Fields are placed by hand (drawn on the page or typed in), or proposed by
 * "Detect fields" for a PDF drawn as a form: the server reads the lines,
 * boxes, table cells and checkboxes the PDF draws beside its labels
 * (form-detect.ts). Proposals are dashed on the page and listed for review;
 * nothing becomes a field until the visitor accepts it, and only accepted
 * fields are sent when the form is created.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, AlertCircle, Plus, Trash2, CheckCircle2, RotateCcw, FormInput, ScanSearch, Check, X } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { processAndDownload, buildOutputFilename, uploadFileGetJson } from "@/lib/api";
import { emitToolRun } from "@/lib/toolRun";
import { focusIfIdle } from "@/skins/experience/focus-result";
import { FileUploadZone } from "./FileUploadZone";
import { PdfPageStage } from "./pdf/PdfPageStage";
import {
    LIKELY, PROPOSAL_TYPES, detectFailure, detectNotes, detectSummary, fieldFromProposal, newCandidates,
    proposalKey, uniqueName, type DetectReport, type Proposal, type ProposalType,
} from "./form-detect";
import "./form-creator.css";

type FieldType = "text" | "checkbox" | "radio" | "combobox" | "listbox" | "signature";

type DraftField = {
    id: string;
    name: string;
    type: FieldType;
    page: string;
    x: string; y: string;
    width: string; height: string;
    required: boolean;
    multiline: boolean;
    value: string;
    checked: boolean;
    options: string;
};

const FIELD_TYPES: { value: FieldType; label: string }[] = [
    { value: "text",      label: "Text" },
    { value: "checkbox",  label: "Checkbox" },
    { value: "radio",     label: "Radio" },
    { value: "combobox",  label: "Dropdown" },
    { value: "listbox",   label: "List" },
    { value: "signature", label: "Signature" },
];

// Proposed fields are drawn dashed in this colour (5:1 on the white page), apart from placed ones.
const PROPOSED_COLOUR = "#b45309";

function newField(index: number): DraftField {
    return {
        id: `${Date.now()}_${Math.random().toString(36).slice(2)}`,
        name: `field_${index}`,
        type: "text",
        page: "1",
        x: "72",
        y: `${72 + index * 30}`,
        width: "220",
        height: "24",
        required: false,
        multiline: false,
        value: "",
        checked: false,
        options: "Option 1,Option 2",
    };
}

/** The field the editor starts with, as it was made: accepting proposals replaces it. */
function isUntouchedStarter(field: DraftField): boolean {
    const { id: _id, ...rest } = field;
    const { id: _starter, ...starter } = newField(1);
    return JSON.stringify(rest) === JSON.stringify(starter);
}

type Detection =
    | { phase: "idle" }
    | { phase: "running" }
    | { phase: "done"; report: DetectReport; proposed: number; pages: number; accepted: number }
    | { phase: "failed"; message: string };

export function FormCreatorUI() {
    const [previewPage, setPreviewPage] = useState(1);
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [fields, setFields] = useState<DraftField[]>([newField(1)]);
    const [selected, setSelected] = useState<string>(fields[0].id);
    const [detection, setDetection] = useState<Detection>({ phase: "idle" });
    const [proposals, setProposals] = useState<Proposal[]>([]);
    // What the last Accept or Reject did, for a screen reader.
    const [reviewNote, setReviewNote] = useState("");
    const detectRun = useRef(0);
    // Detect fields is disabled while it works, so a browser drops its focus:
    // when the answer comes, focus goes to the proposals, or to this panel.
    const focusAfterDetect = useRef(false);
    const proposalRows = useRef<Map<string, HTMLLIElement>>(new Map());

    const canSubmit = useMemo(() => !!file && fields.length > 0 && status !== "processing", [file, fields.length, status]);
    const detecting = detection.phase === "running";

    const focusOnNextAddRef = useRef<string | null>(null);
    const nameRefs = useRef<Map<string, HTMLInputElement>>(new Map());

    const updateField = (id: string, patch: Partial<DraftField>) => setFields(prev => prev.map(f => f.id === id ? { ...f, ...patch } : f));
    const removeField = (id: string) => setFields(prev => prev.filter(f => f.id !== id));
    const addField = () => {
        const f = newField(fields.length + 1);
        setFields(prev => [...prev, f]);
        setSelected(f.id);
        focusOnNextAddRef.current = f.id;
    };

    useEffect(() => {
        if (!focusOnNextAddRef.current) return;
        const el = nameRefs.current.get(focusOnNextAddRef.current);
        if (el) { el.focus(); el.select(); focusOnNextAddRef.current = null; }
    }, [fields.length]);

    const chooseFile = (f: File) => {
        setFile(f); setStatus("idle"); setError(null);
        // Proposals belong to the file they were found in.
        detectRun.current += 1;
        setDetection({ phase: "idle" }); setProposals([]); setReviewNote("");
    };

    const runDetection = async () => {
        if (!file || detecting) return;
        const run = ++detectRun.current;
        setDetection({ phase: "running" }); setReviewNote("");
        try {
            const report = await uploadFileGetJson<DetectReport>("/form-creator/detect", file);
            if (run !== detectRun.current) return;
            // Fields the visitor placed are not proposed again; the untouched starter is no one's choice.
            const placed = fields.filter(f => !isUntouchedStarter(f))
                .map(f => ({ page: Number(f.page), x: Number(f.x), y: Number(f.y), width: Number(f.width), height: Number(f.height) }));
            const found = newCandidates(report, placed).map(c => ({ ...c, key: proposalKey(c, run) }));
            setProposals(found);
            // The pages the proposals are on: not those of fields already placed.
            setDetection({ phase: "done", report, proposed: found.length, pages: new Set(found.map(c => c.page)).size, accepted: 0 });
            focusAfterDetect.current = true;
            if (found.length) { setSelected(found[0].key); setPreviewPage(found[0].page); }
        } catch (e: unknown) {
            if (run !== detectRun.current) return;
            setDetection({ phase: "failed", message: detectFailure(e) });
            focusAfterDetect.current = true;
        }
    };

    const updateProposal = (key: string, patch: Partial<Proposal>) => setProposals(prev => prev.map(p => p.key === key ? { ...p, ...patch } : p));
    // A reviewed proposal's row goes, and focus with it: move it to the next
    // proposal's name, or to this section's heading once none is left. A
    // screen reader is told what was done; once none is left, the summary
    // says so ("You reviewed all…").
    const refocus = useRef<string | null>(null);
    const reviewed = (keys: string[], done: string) => {
        const index = proposals.findIndex(p => keys.includes(p.key));
        const rest = proposals.filter(p => !keys.includes(p.key));
        refocus.current = rest.length ? rest[Math.min(Math.max(index, 0), rest.length - 1)].key : "";
        setReviewNote(rest.length ? `${done} ${rest.length} proposed field${rest.length === 1 ? "" : "s"} left to review.` : "");
    };
    useEffect(() => {
        const key = refocus.current;
        refocus.current = null;
        if (key === null) return;
        focusIfIdle(key ? proposalRows.current.get(key)?.querySelector<HTMLElement>("input") : document.getElementById("fc-detect-title"));
    }, [proposals]);
    useEffect(() => {
        if (!focusAfterDetect.current || (detection.phase !== "done" && detection.phase !== "failed")) return;
        focusAfterDetect.current = false;
        focusIfIdle(document.getElementById(proposals.length ? "fc-proposals-title" : "fc-detect-title"));
    }, [detection, proposals.length]);
    const accept = (keys: string[]) => {
        const chosen = proposals.filter(p => keys.includes(p.key));
        if (!chosen.length) return;
        // The untouched starter field is only a starting point: accepted proposals replace it.
        const base = fields.length === 1 && isUntouchedStarter(fields[0]) ? [] : fields;
        const taken = new Set(base.map(f => f.name.trim()));
        const made = chosen.map(p => ({ ...newField(base.length + 1), ...fieldFromProposal(p, uniqueName(p.name, taken)) }));
        reviewed(keys, made.length === 1 ? `Accepted ${made[0].name}.` : `Accepted ${made.length} fields.`);
        setFields([...base, ...made]);
        setProposals(prev => prev.filter(p => !keys.includes(p.key)));
        setDetection(prev => prev.phase === "done" ? { ...prev, accepted: prev.accepted + made.length } : prev);
        setSelected(made[made.length - 1].id);
    };
    const reject = (keys: string[]) => {
        const one = keys.length === 1 ? proposals.find(p => p.key === keys[0]) : undefined;
        reviewed(keys, one ? `Rejected ${one.name || "the proposed field"}.` : `Rejected ${keys.length} fields.`);
        setProposals(prev => prev.filter(p => !keys.includes(p.key)));
    };
    const selectRegion = (id: string) => {
        setSelected(id);
        const row = proposalRows.current.get(id);
        row?.scrollIntoView?.({ block: "nearest" });
    };

    const parseNumber = (v: string, label: string) => {
        const n = Number(v);
        if (!Number.isFinite(n)) throw new Error(`${label} must be a number`);
        return n;
    };

    const buildPayload = () => {
        if (fields.length === 0) throw new Error("Add at least one field");
        return fields.map((f, idx) => {
            const name = f.name.trim();
            if (!name) throw new Error(`Field #${idx + 1}: name is required`);
            const page = Math.trunc(parseNumber(f.page, `Field #${idx + 1} page`));
            const x = parseNumber(f.x, `Field #${idx + 1} x`);
            const y = parseNumber(f.y, `Field #${idx + 1} y`);
            const width = parseNumber(f.width, `Field #${idx + 1} width`);
            const height = parseNumber(f.height, `Field #${idx + 1} height`);
            if (page < 1) throw new Error(`Field #${idx + 1}: page must be >= 1`);
            if (width <= 0 || height <= 0) throw new Error(`Field #${idx + 1}: width and height must be > 0`);
            const base = { name, type: f.type, page, x, y, width, height, required: f.required } as Record<string, unknown>;
            if (f.type === "text") { base.value = f.value; base.multiline = f.multiline; }
            else if (f.type === "checkbox") { base.checked = f.checked; }
            else if (f.type === "radio" || f.type === "combobox" || f.type === "listbox") {
                const options = f.options.split(",").map(o => o.trim()).filter(Boolean);
                if (!options.length) throw new Error(`Field #${idx + 1}: options are required`);
                base.options = options;
                base.value = f.value || options[0];
            }
            return base;
        });
    };

    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const payload = buildPayload();
            await processAndDownload("/form-creator", file, buildOutputFilename(file.name, "form", "pdf"),
                { form_fields: JSON.stringify(payload), reading_order: "true" });
            setStatus("done");
            emitToolRun({ outcome: "success", files: 1 });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Could not build the form";
            setError(friendlyError(msg, "Couldn't build that form."));
            setStatus("idle");
            emitToolRun({ outcome: "error", files: 1 }, e);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [file, fields]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement | null)?.tagName?.toLowerCase();
            if ((tag === "input" || tag === "textarea" || tag === "select") && !((e.metaKey || e.ctrlKey) && e.key === "Enter")) return;
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
                e.preventDefault();
                process();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canSubmit, process]);

    if (status === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Fillable form built</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{fields.length}</span> field{fields.length !== 1 && "s"} injected
                        </h2>
                        <button
                            onClick={() => { setFile(null); setStatus("idle"); setFields([newField(1)]); setDetection({ phase: "idle" }); setProposals([]); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Create another
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    const done = detection.phase === "done" ? detection : null;
    const notes = done ? detectNotes(done.report) : [];
    const typeLabel = (type: ProposalType) => PROPOSAL_TYPES.find(t => t.value === type)?.label.toLowerCase() || type;

    return (
        <div className="space-y-4">
            <FileUploadZone
                file={file}
                onFileSelect={chooseFile}
                onClear={() => { setFile(null); detectRun.current += 1; setDetection({ phase: "idle" }); setProposals([]); }}
                accept=".pdf"
                label="Drop PDF to make fillable"
                hint="Add text, checkbox, radio, dropdown, list, signature fields"
            />

            {file && (
                <section className="fc-detect" aria-labelledby="fc-detect-title">
                    <div className="fc-detect-intro">
                        <div>
                            <h2 id="fc-detect-title" tabIndex={-1}>Find fields automatically</h2>
                            <p>Detect fields uploads this PDF to PrivaTools, which looks for what it draws as blanks (lines after labels, empty boxes and table cells, and checkboxes) and removes the file after answering. It follows fixed rules, it is not AI, so it can miss fields or propose wrong ones; you check each one before anything is added. A scanned form has no drawn lines to find.</p>
                        </div>
                        <button type="button" className="ts-secondary-button" onClick={runDetection} disabled={detecting || status === "processing"}>
                            {detecting ? <><Loader2 size={15} className="animate-spin" aria-hidden="true" /> Detecting fields…</> : <><ScanSearch size={15} aria-hidden="true" /> {done ? "Detect again" : "Detect fields"}</>}
                        </button>
                    </div>
                    <div role="status" aria-live="polite" className="fc-detect-status">
                        {detecting && <p>Uploading your PDF and reading its pages…</p>}
                        {done && <>
                            <p>{done.proposed > 0 && !proposals.length
                                ? `You reviewed all ${done.proposed} proposed field${done.proposed === 1 ? "" : "s"}: ${done.accepted || "none"} accepted. Edit the fields below, then generate the fillable PDF.`
                                : detectSummary(done.report, done.proposed, done.pages)}</p>
                            {done.report.existingFields > 0 && <p>This PDF already has {done.report.existingFields} fillable field{done.report.existingFields === 1 ? "" : "s"}; nothing is proposed over {done.report.existingFields === 1 ? "it" : "them"}. To fill {done.report.existingFields === 1 ? "it" : "them"} in, use <a href="/tool/fill-form">Fill Form</a>.</p>}
                        </>}
                    </div>
                    <p className="sr-only" role="status">{reviewNote}</p>
                    {notes.length > 0 && <ul className="fc-detect-notes">{notes.map(note => <li key={note}>{note}</li>)}</ul>}
                    {detection.phase === "failed" && <div className="ts-intake-notice fc-detect-failed" role="alert"><AlertCircle size={18} aria-hidden="true" /><p>{detection.message}</p></div>}
                </section>
            )}

            {file && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                        <span>Form fields ({fields.length})</span>
                        <button onClick={addField} className="inline-flex items-center gap-1 text-accent hover:opacity-80 transition-opacity">
                            <Plus size={11} /> Add
                        </button>
                    </div>
                    <div className="pdf-coordinate-workspace"><fieldset className="pdf-coordinate-controls fc-controls" disabled={status === "processing"}>
                        {proposals.length > 0 && (
                            <section className="fc-proposals" aria-labelledby="fc-proposals-title">
                                <div className="fc-proposals-head">
                                    <h3 id="fc-proposals-title" tabIndex={-1}>Proposed fields ({proposals.length})</h3>
                                    <div className="fc-proposals-all">
                                        <button type="button" onClick={() => accept(proposals.map(p => p.key))}><Check size={14} aria-hidden="true" /> Accept all</button>
                                        <button type="button" onClick={() => reject(proposals.map(p => p.key))}><X size={14} aria-hidden="true" /> Reject all</button>
                                    </div>
                                </div>
                                <p className="fc-proposals-legend"><span aria-hidden="true" /> Dashed on the page until accepted.</p>
                                <ul>
                                    {proposals.map((p, index) => (
                                        <li key={p.key} ref={el => { if (el) proposalRows.current.set(p.key, el); else proposalRows.current.delete(p.key); }}
                                            data-selected={selected === p.key} onClick={() => { setSelected(p.key); setPreviewPage(p.page); }}>
                                            <div className="fc-proposal-edit">
                                                <label>Name<input value={p.name} aria-label={`Name of proposed field ${index + 1}`} onClick={e => e.stopPropagation()}
                                                    onChange={e => updateProposal(p.key, { name: e.target.value })} /></label>
                                                <label>Type<select value={p.type} aria-label={`Type of proposed field ${index + 1}`} onClick={e => e.stopPropagation()}
                                                    onChange={e => updateProposal(p.key, { type: e.target.value as ProposalType })}>
                                                    {PROPOSAL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                                </select></label>
                                            </div>
                                            <p className="fc-proposal-meta">
                                                <span data-likely={p.confidence >= LIKELY}>{p.confidence >= LIKELY ? "Likely" : "Possible"}</span>
                                                {` ${typeLabel(p.type)} field · page ${p.page}`}{p.label ? ` · from “${p.label}”` : ""}
                                            </p>
                                            <div className="fc-proposal-actions">
                                                <button type="button" onClick={e => { e.stopPropagation(); accept([p.key]); }} aria-label={`Accept ${p.name || `proposed field ${index + 1}`}`}><Check size={14} aria-hidden="true" /> Accept</button>
                                                <button type="button" onClick={e => { e.stopPropagation(); reject([p.key]); }} aria-label={`Reject ${p.name || `proposed field ${index + 1}`}`}><X size={14} aria-hidden="true" /> Reject</button>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </section>
                        )}
                        {fields.map((f, idx) => {
                            const isSel = selected === f.id;
                            const hasOptions = f.type === "radio" || f.type === "combobox" || f.type === "listbox";
                            return (
                                <div
                                    key={f.id}
                                    onClick={() => { setSelected(f.id); setPreviewPage(Number(f.page) || 1); }}
                                    className={cn(
                                        "rounded-lg border p-3 cursor-pointer transition-colors space-y-3",
                                        isSel ? "border-accent bg-accent/[0.06]" : "border-border bg-card hover:border-border-strong"
                                    )}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className={cn("font-medium text-[11px]", isSel ? "text-accent" : "text-muted-foreground")}>
                                            {String(idx + 1).padStart(2, "0")}
                                        </span>
                                        <input
                                            ref={(el) => { if (el) nameRefs.current.set(f.id, el); else nameRefs.current.delete(f.id); }}
                                            value={f.name}
                                            onClick={e => e.stopPropagation()}
                                            onChange={e => updateField(f.id, { name: e.target.value })}
                                            placeholder="field_name"
                                            aria-label="Field name"
                                            className="min-w-0 flex-1 rounded border border-border bg-paper-2/40 px-2 py-1 font-mono text-[12.5px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                                        />
                                        <select
                                            value={f.type}
                                            onClick={e => e.stopPropagation()}
                                            onChange={e => updateField(f.id, { type: e.target.value as FieldType })}
                                            className="rounded border border-border bg-paper-2/40 px-2 py-1 text-[12px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                                        >
                                            {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                        </select>
                                        <button type="button" aria-label={`Remove form field ${idx + 1}`} onClick={(e) => { e.stopPropagation(); removeField(f.id); }} className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10">
                                            <Trash2 size={12} />
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-5 gap-2">
                                        {([
                                            { key: "page",   label: "Pg" },
                                            { key: "x",      label: "X" },
                                            { key: "y",      label: "Y" },
                                            { key: "width",  label: "W" },
                                            { key: "height", label: "H" },
                                        ] as const).map(c => (
                                            <div key={c.key}>
                                                <label className="font-medium text-[10.5px] text-muted-foreground">{c.label}</label>
                                                <input
                                                    value={f[c.key]}
                                                    onClick={e => e.stopPropagation()}
                                                    onChange={e => updateField(f.id, { [c.key]: e.target.value } as Partial<DraftField>)}
                                                    className="mt-0.5 w-full rounded border border-border bg-paper-2/40 px-1.5 py-1 font-mono text-[12px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 text-center"
                                                />
                                            </div>
                                        ))}
                                    </div>

                                    <div className="flex flex-wrap gap-3">
                                        <label className="inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.04em] text-muted-foreground cursor-pointer" onClick={e => e.stopPropagation()}>
                                            <input
                                                type="checkbox" checked={f.required}
                                                onChange={e => updateField(f.id, { required: e.target.checked })}
                                                className="accent-accent"
                                            />
                                            REQUIRED
                                        </label>
                                        {f.type === "text" && (
                                            <label className="inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.04em] text-muted-foreground cursor-pointer" onClick={e => e.stopPropagation()}>
                                                <input
                                                    type="checkbox" checked={f.multiline}
                                                    onChange={e => updateField(f.id, { multiline: e.target.checked })}
                                                    className="accent-accent"
                                                />
                                                MULTILINE
                                            </label>
                                        )}
                                        {f.type === "checkbox" && (
                                            <label className="inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.04em] text-muted-foreground cursor-pointer" onClick={e => e.stopPropagation()}>
                                                <input
                                                    type="checkbox" checked={f.checked}
                                                    onChange={e => updateField(f.id, { checked: e.target.checked })}
                                                    className="accent-accent"
                                                />
                                                CHECKED
                                            </label>
                                        )}
                                    </div>

                                    {(f.type === "text" || hasOptions) && (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                            <div>
                                                <label className="font-medium text-[9.5px] text-muted-foreground">Default value <span className="normal-case text-muted-foreground">(pre-fills)</span></label>
                                                <input
                                                    value={f.value}
                                                    onClick={e => e.stopPropagation()}
                                                    onChange={e => updateField(f.id, { value: e.target.value })}
                                                    placeholder={hasOptions ? "Match one of the options" : "Optional"}
                                                    className="mt-0.5 w-full rounded border border-border bg-paper-2/40 px-2 py-1 text-[12.5px] text-foreground placeholder:text-muted-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                                                />
                                            </div>
                                            {hasOptions && (
                                                <div>
                                                    <label className="font-medium text-[9.5px] text-muted-foreground">Options (comma)</label>
                                                    <input
                                                        value={f.options}
                                                        onClick={e => e.stopPropagation()}
                                                        onChange={e => updateField(f.id, { options: e.target.value })}
                                                        className="mt-0.5 w-full rounded border border-border bg-paper-2/40 px-2 py-1 font-mono text-[12px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </fieldset><PdfPageStage file={file} page={previewPage} onPageChange={setPreviewPage} selectedId={selected} onSelect={selectRegion} disabled={status === "processing"} drawLabel="Draw a field"
                        regions={[
                            ...fields.map(field => ({ id: field.id, page: Number(field.page), x: Number(field.x), y: Number(field.y), width: Number(field.width), height: Number(field.height), label: field.name })),
                            ...proposals.map(p => ({ id: p.key, page: p.page, x: p.x, y: p.y, width: p.width, height: p.height, kind: "proposed", color: PROPOSED_COLOUR, label: `Proposed ${typeLabel(p.type)} field ${p.name}` })),
                        ]}
                        onDraw={region => { const field = { ...newField(fields.length + 1), page: String(region.page), x: String(Math.round(region.x)), y: String(Math.round(region.y)), width: String(Math.round(region.width)), height: String(Math.round(region.height)) }; setFields(items => [...items, field]); setSelected(field.id); }} /></div>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            {file && proposals.length > 0 && (
                <p className="fc-pending">{proposals.length === 1 ? "1 proposed field is" : `${proposals.length} proposed fields are`} still to review: only accepted fields go into the form.</p>
            )}

            {file && (
                <div className="flex items-center gap-3">
                    <button onClick={process} disabled={!canSubmit} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                        {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Building form…</> : <><FormInput size={13} /> Generate fillable PDF</>}
                    </button>
                    {canSubmit && (
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>
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
