/**
 * FillFormUI — auto-detect fillable PDF fields and let the user fill them.
 * Workshop: detect → editor with grouped field rows, type chips, search filter.
 */
import { useCallback, useEffect, useState, useMemo } from "react";
import { Download, Loader2, CheckCircle2, AlertCircle, FormInput, RotateCcw, Search, Sparkles } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile, uploadFileGetJson, downloadBlob } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";

interface FormField {
    name: string;
    type: string;
    value?: string;
    options?: string[];
}

const isTruthyValue = (value: string | undefined) => {
    if (!value) return false;
    return ["yes", "true", "1", "on", "checked"].includes(value.toLowerCase());
};

const TYPE_CHIP_TONE: Record<string, string> = {
    text:      "bg-accent/12 text-accent",
    checkbox:  "bg-copper/15 text-copper",
    radio:     "bg-foreground/10 text-foreground",
    choice:    "bg-foreground/10 text-foreground",
    signature: "bg-destructive/15 text-destructive",
    button:    "bg-muted text-muted-foreground",
};

export function FillFormUI() {
    const [file, setFile] = useState<File | null>(null);
    const [state, setState] = useState<"idle" | "loading-fields" | "editing" | "submitting" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [fields, setFields] = useState<FormField[]>([]);
    const [values, setValues] = useState<Record<string, string>>({});
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [query, setQuery] = useState("");

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return fields;
        return fields.filter(f => f.name.toLowerCase().includes(q) || f.type.toLowerCase().includes(q));
    }, [fields, query]);

    const filledCount = useMemo(
        () => fields.filter(f => values[f.name] && values[f.name].length > 0 && values[f.name] !== "Off").length,
        [fields, values]
    );

    const loadFields = async () => {
        if (!file) return;
        setState("loading-fields"); setError(null);
        try {
            const data = await uploadFileGetJson<{ fields: FormField[] }>("/fill-form/fields", file);
            if (!data.fields || data.fields.length === 0) {
                setError("No fillable form fields detected. This PDF must contain interactive form fields.");
                setState("idle");
                return;
            }
            setFields(data.fields);
            const init: Record<string, string> = {};
            for (const f of data.fields) init[f.name] = f.value || "";
            setValues(init);
            setState("editing");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Failed to read form fields";
            setError(friendlyError(msg, "Couldn't read the form fields."));
            setState("idle");
        }
    };

    const submitForm = useCallback(async () => {
        if (!file) return;
        setState("submitting"); setError(null);
        try {
            const res = await uploadFile("/fill-form", file, { field_values: JSON.stringify(values) } as any);
            const blob = await res.blob();
            setResultBlob(blob);
            setState("done");
            downloadBlob(blob, `${file.name.replace(/\.pdf$/i, "")}_filled.pdf`);
        } catch (e: any) {
            const raw: string = e?.message || "";
            const lower = raw.toLowerCase();
            let msg = raw || "Could not fill form";
            if (lower.includes("network") || lower.includes("fetch")) msg = "Network hiccup — check your connection and retry";
            else if (lower.includes("encrypted") || lower.includes("password")) msg = "PDF is password-protected — unlock it before filling";
            setError(msg); setState("editing");
        }
    }, [file, values]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && (state === "editing") && file) {
                e.preventDefault();
                submitForm();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [state, file, submitForm]);

    const updateValue = (name: string, val: string) => setValues(prev => ({ ...prev, [name]: val }));

    if (state === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Form filled</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{filledCount || fields.length}</span> of {fields.length} field{fields.length !== 1 && "s"} filled
                        </h2>
                        <p className="font-medium text-[11.5px] text-muted-foreground/85 mt-1">
                            Open the downloaded PDF to confirm your entries
                        </p>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <button onClick={() => resultBlob && file && downloadBlob(resultBlob, `${file.name.replace(/\.pdf$/i, "")}_filled.pdf`)} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                <Download size={13} /> Download again
                            </button>
                            <button
                                onClick={() => { setFile(null); setState("idle"); setFields([]); setValues({}); setResultBlob(null); }}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                            >
                                <RotateCcw size={12} /> Fill another
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    if (state === "editing" || state === "submitting") return (
        <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3">
                <div className="h-10 w-10 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                    <FormInput size={16} className="text-accent" />
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-foreground truncate">{file?.name}</p>
                    <p className="font-medium text-[11.5px] text-muted-foreground mt-0.5">
                        {filledCount}/{fields.length} filled
                    </p>
                </div>
                <button
                    onClick={() => { setFile(null); setState("idle"); setFields([]); setValues({}); }}
                    className="h-8 px-3 inline-flex items-center gap-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 text-[12px]"
                >
                    Start over
                </button>
            </div>

            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                    <span>Fields ({fields.length})</span>
                    <div className="relative">
                        <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground/60" />
                        <input
                            value={query} onChange={e => setQuery(e.target.value)}
                            placeholder="Filter…"
                            className="h-6 pl-6 pr-2 rounded border border-border bg-paper-2 text-[11px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-accent w-32"
                        />
                    </div>
                </div>
                <div className="p-3 space-y-1.5 max-h-[60vh] overflow-y-auto">
                    {filtered.length === 0 && (
                        <p className="font-mono text-[11px] tracking-wider text-muted-foreground/70 text-center py-6">No matching fields</p>
                    )}
                    {filtered.map((field, i) => {
                        const tone = TYPE_CHIP_TONE[field.type] || TYPE_CHIP_TONE.text;
                        return (
                            <div key={field.name} className="grid grid-cols-1 sm:grid-cols-[24px_1fr_2fr] gap-2 items-center py-1.5">
                                <span className="font-mono text-[10px] tracking-wider text-muted-foreground/70 text-right hidden sm:inline">{String(i + 1).padStart(2, "0")}</span>
                                <div className="flex items-center gap-1.5 min-w-0">
                                    <p className="text-[13px] font-medium text-foreground truncate">{field.name}</p>
                                    <span className={cn("font-medium h-4 px-1.5 inline-flex items-center text-[9.5px] tracking-wider rounded shrink-0", tone)}>
                                        {field.type}
                                    </span>
                                </div>
                                <div>
                                    {field.type === "checkbox" ? (
                                        <button
                                            onClick={() => updateValue(field.name, isTruthyValue(values[field.name]) ? "Off" : (field.options?.[0] || "Yes"))}
                                            className={cn(
                                                "inline-flex items-center gap-2 h-9 px-3 rounded-md border text-[13px] transition-colors",
                                                isTruthyValue(values[field.name])
                                                    ? "border-accent bg-accent/[0.08] text-foreground"
                                                    : "border-border bg-card text-muted-foreground hover:border-border-strong"
                                            )}
                                        >
                                            <span className={cn(
                                                "h-4 w-4 rounded border flex items-center justify-center transition-colors",
                                                isTruthyValue(values[field.name]) ? "bg-accent border-accent text-background" : "border-border"
                                            )}>
                                                {isTruthyValue(values[field.name]) && <CheckCircle2 size={9} strokeWidth={3} />}
                                            </span>
                                            {isTruthyValue(values[field.name]) ? "Checked" : "Unchecked"}
                                        </button>
                                    ) : (field.type === "radio" || field.type === "choice") && field.options ? (
                                        <select
                                            value={values[field.name] || ""}
                                            onChange={e => updateValue(field.name, e.target.value)}
                                            className="w-full rounded-md border border-border bg-card px-3 py-2 text-[13px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                        >
                                            <option value="">Select…</option>
                                            {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                        </select>
                                    ) : field.type === "signature" || field.type === "button" ? (
                                        <div className="rounded-md border border-dashed border-border bg-paper-2/30 px-3 py-2 text-[12px] text-muted-foreground italic">
                                            Not editable in this UI
                                        </div>
                                    ) : (
                                        <input
                                            type="text"
                                            value={values[field.name] || ""}
                                            onChange={e => updateValue(field.name, e.target.value)}
                                            placeholder={`Enter ${field.name}`}
                                            className="w-full rounded-md border border-border bg-card px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                        />
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            <div className="flex items-center gap-3">
                <button onClick={submitForm} disabled={state === "submitting"} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                    {state === "submitting" ? <><Loader2 size={13} className="animate-spin" /> Filling…</> : <><Download size={13} /> Fill &amp; download</>}
                </button>
                {state !== "submitting" && (
                    <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/80 bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>
                )}
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
                label="Drop a fillable PDF form"
                hint="We'll detect every form field automatically"
            />

            {file && (
                <>
                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                            <AlertCircle size={13} className="shrink-0" />{error}
                        </div>
                    )}
                    <button onClick={loadFields} disabled={state === "loading-fields"} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                        {state === "loading-fields" ? <><Loader2 size={13} className="animate-spin" /> Detecting fields…</> : <><Sparkles size={13} /> Detect form fields</>}
                    </button>
                </>
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
