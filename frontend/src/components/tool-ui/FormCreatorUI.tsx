/**
 * FormCreatorUI — build interactive form fields and inject them into a PDF.
 * Workshop: field cards with type-aware controls, position grid, comma-sep options.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, AlertCircle, Plus, Trash2, CheckCircle2, RotateCcw, FormInput } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { processAndDownload, buildOutputFilename } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";

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

export function FormCreatorUI() {
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [fields, setFields] = useState<DraftField[]>([newField(1)]);
    const [selected, setSelected] = useState<string>(fields[0].id);

    const canSubmit = useMemo(() => !!file && fields.length > 0 && status !== "processing", [file, fields.length, status]);

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
                { form_fields: JSON.stringify(payload) });
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Could not build the form";
            setError(friendlyError(msg, "Couldn't build that form."));
            setStatus("idle");
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
                            onClick={() => { setFile(null); setStatus("idle"); setFields([newField(1)]); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Create another
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
                onFileSelect={f => { setFile(f); setStatus("idle"); setError(null); }}
                onClear={() => setFile(null)}
                accept=".pdf"
                label="Drop PDF to make fillable"
                hint="Add text, checkbox, radio, dropdown, list, signature fields"
            />

            {file && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                        <span>Form fields ({fields.length})</span>
                        <button onClick={addField} className="inline-flex items-center gap-1 text-accent hover:opacity-80 transition-opacity">
                            <Plus size={11} /> Add
                        </button>
                    </div>
                    <div className="p-3 space-y-2">
                        {fields.map((f, idx) => {
                            const isSel = selected === f.id;
                            const hasOptions = f.type === "radio" || f.type === "combobox" || f.type === "listbox";
                            return (
                                <div
                                    key={f.id}
                                    onClick={() => setSelected(f.id)}
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
                                            className="flex-1 rounded border border-border bg-paper-2/40 px-2 py-1 font-mono text-[12.5px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                                        />
                                        <select
                                            value={f.type}
                                            onClick={e => e.stopPropagation()}
                                            onChange={e => updateField(f.id, { type: e.target.value as FieldType })}
                                            className="rounded border border-border bg-paper-2/40 px-2 py-1 text-[12px] text-foreground outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                                        >
                                            {FIELD_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                                        </select>
                                        <button onClick={(e) => { e.stopPropagation(); removeField(f.id); }} className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10">
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
