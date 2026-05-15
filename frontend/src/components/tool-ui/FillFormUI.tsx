import { useState, useRef } from "react";
import { Upload, Download, Loader2, CheckCircle2, X, FileText, AlertCircle, FormInput } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { uploadFile, uploadFileGetJson, downloadBlob, formatFileSize } from "@/lib/api";

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

export function FillFormUI() {
    const [file, setFile] = useState<{ name: string; size: string; raw: File } | null>(null);
    const [state, setState] = useState<"idle" | "loading-fields" | "editing" | "submitting" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [fields, setFields] = useState<FormField[]>([]);
    const [values, setValues] = useState<Record<string, string>>({});
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);

    const pick = (fl: FileList) => {
        const f = fl[0];
        setFile({ name: f.name, size: formatFileSize(f.size), raw: f });
        setState("idle");
        setError(null);
        setFields([]);
        setValues({});
    };

    const loadFields = async () => {
        if (!file) return;
        setState("loading-fields");
        setError(null);
        try {
            const data = await uploadFileGetJson<{ fields: FormField[] }>("/fill-form/fields", file.raw);
            if (!data.fields || data.fields.length === 0) {
                setError("No fillable form fields found in this PDF. Make sure it contains interactive form fields.");
                setState("idle");
                return;
            }
            setFields(data.fields);
            const init: Record<string, string> = {};
            for (const f of data.fields) {
                init[f.name] = f.value || "";
            }
            setValues(init);
            setState("editing");
        } catch (e: any) {
            setError(e.message || "Failed to read form fields");
            setState("idle");
        }
    };

    const submitForm = async () => {
        if (!file) return;
        setState("submitting");
        setError(null);
        try {
            const res = await uploadFile("/fill-form", file.raw, { field_values: JSON.stringify(values) } as any);
            const blob = await res.blob();
            setResultBlob(blob);
            setState("done");
        } catch (e: any) {
            setError(e.message || "Failed to fill form");
            setState("editing");
        }
    };

    const handleDownload = () => {
        if (resultBlob) downloadBlob(resultBlob, file ? `${file.name.replace(/\.pdf$/i, "")}_filled.pdf` : "filled_form.pdf");
    };

    const updateValue = (name: string, val: string) => {
        setValues(prev => ({ ...prev, [name]: val }));
    };

    // Done state
    if (state === "done") return (
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-10 text-center">
            <CheckCircle2 size={40} className="mx-auto mb-4 text-emerald-400" strokeWidth={1.5} />
            <h2 className="text-lg font-bold text-foreground mb-1">Form Filled!</h2>
            <p className="text-sm text-muted-foreground mb-6">{fields.length} field{fields.length !== 1 ? "s" : ""} filled successfully.</p>
            <div className="flex justify-center gap-3 flex-wrap">
                <Button className="glow-primary" onClick={handleDownload}><Download size={15} />Download Filled PDF</Button>
                <Button variant="outline" className="border-border text-muted-foreground"
                    onClick={() => { setFile(null); setState("idle"); setFields([]); setValues({}); setResultBlob(null); }}>Fill another</Button>
            </div>
        </div>
    );

    // Editing state — show form fields
    if (state === "editing" || state === "submitting") return (
        <div className="space-y-4">
            {/* File info */}
            <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary"><FileText size={14} className="text-muted-foreground" /></div>
                <div className="flex-1 min-w-0"><p className="text-sm font-medium text-foreground truncate">{file?.name}</p><p className="text-xs text-muted-foreground">{file?.size}</p></div>
            </div>

            {/* Fields header */}
            <div className="rounded-xl border border-border bg-card p-5">
                <div className="flex items-center gap-2 mb-4">
                    <FormInput size={16} className="text-primary" />
                    <p className="text-sm font-semibold text-foreground">Form Fields ({fields.length})</p>
                </div>
                <div className="space-y-3">
                    {fields.map(field => (
                        <div key={field.name} className="space-y-1">
                            <label className="block text-xs font-medium text-muted-foreground">
                                {field.name}
                                <span className="ml-1.5 text-[10px] font-normal text-muted-foreground/80">({field.type})</span>
                            </label>
                            {field.type === "checkbox" ? (
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={isTruthyValue(values[field.name])}
                                        onChange={e => updateValue(field.name, e.target.checked ? (field.options?.[0] || "Yes") : "Off")}
                                        className="rounded border-border"
                                    />
                                    <span className="text-sm text-foreground">{isTruthyValue(values[field.name]) ? "Checked" : "Unchecked"}</span>
                                </label>
                            ) : field.type === "radio" && field.options ? (
                                <select
                                    value={values[field.name] || ""}
                                    onChange={e => updateValue(field.name, e.target.value)}
                                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                                >
                                    <option value="">Select…</option>
                                    {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                </select>
                            ) : field.type === "choice" && field.options ? (
                                <select
                                    value={values[field.name] || ""}
                                    onChange={e => updateValue(field.name, e.target.value)}
                                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                                >
                                    <option value="">Select…</option>
                                    {field.options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                </select>
                            ) : field.type === "signature" || field.type === "button" ? (
                                <div className="rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm text-muted-foreground">
                                    This field type is not editable in this UI yet.
                                </div>
                            ) : (
                                <input
                                    type="text"
                                    value={values[field.name] || ""}
                                    onChange={e => updateValue(field.name, e.target.value)}
                                    placeholder={`Enter ${field.name}`}
                                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/80 focus:outline-none focus:ring-1 focus:ring-accent"
                                />
                            )}
                        </div>
                    ))}
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle size={15} className="shrink-0" />{error}
                </div>
            )}

            <div className="flex gap-3">
                <Button onClick={submitForm} disabled={state === "submitting"} className="glow-primary">
                    {state === "submitting" ? <><Loader2 size={15} className="animate-spin" />Filling…</> : "Fill & Download"}
                </Button>
                <Button variant="ghost" size="sm" className="text-muted-foreground"
                    onClick={() => { setFile(null); setState("idle"); setFields([]); setValues({}); }}>Start Over</Button>
            </div>
        </div>
    );

    // Upload / idle state
    return (
        <div className="space-y-4">
            {!file ? (
                <div onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
                    onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) pick(e.dataTransfer.files); }}
                    onClick={() => ref.current?.click()}
          onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
          role="button"
          tabIndex={0}
          aria-label="Upload file"
                    className={cn("flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-14 px-6 text-center",
                        drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 hover:bg-secondary/40 bg-secondary/20")}>
                    <input ref={ref} type="file" accept=".pdf" className="hidden" onChange={e => e.target.files && pick(e.target.files)} />
                    <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl", drag ? "bg-accent/20" : "bg-secondary")}>
                        <Upload size={22} className={drag ? "text-primary" : "text-muted-foreground"} strokeWidth={1.5} />
                    </div>
                    <p className="text-sm font-semibold text-foreground">Select a fillable PDF form</p>
                    <p className="text-xs text-muted-foreground">We'll detect all form fields and let you fill them</p>
                </div>
            ) : (
                <>
                    <div className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary"><FileText size={14} className="text-muted-foreground" /></div>
                        <div className="flex-1 min-w-0"><p className="text-sm font-medium text-foreground truncate">{file.name}</p><p className="text-xs text-muted-foreground">{file.size}</p></div>
                        <button onClick={() => setFile(null)} className="text-muted-foreground hover:text-foreground"><X size={15} /></button>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                            <AlertCircle size={15} className="shrink-0" />{error}
                        </div>
                    )}

                    <Button onClick={loadFields} disabled={state === "loading-fields"} className="glow-primary">
                        {state === "loading-fields" ? <><Loader2 size={15} className="animate-spin" />Detecting Fields…</> : "Detect Form Fields"}
                    </Button>
                </>
            )}
        </div>
    );
}
