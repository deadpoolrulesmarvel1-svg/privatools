import { useMemo, useState } from "react";
import { Loader2, AlertCircle, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { processAndDownload, buildOutputFilename } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";
import { cn } from "@/lib/utils";

type FieldType = "text" | "checkbox" | "radio" | "combobox" | "listbox" | "signature";

type DraftField = {
  id: string;
  name: string;
  type: FieldType;
  page: string;
  x: string;
  y: string;
  width: string;
  height: string;
  required: boolean;
  multiline: boolean;
  value: string;
  checked: boolean;
  options: string;
};

const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: "text", label: "Text input" },
  { value: "checkbox", label: "Checkbox" },
  { value: "radio", label: "Radio button" },
  { value: "combobox", label: "Dropdown (combo box)" },
  { value: "listbox", label: "List box" },
  { value: "signature", label: "Signature field" },
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

  const canSubmit = useMemo(() => {
    return !!file && fields.length > 0 && status !== "processing";
  }, [file, fields.length, status]);

  const updateField = (id: string, patch: Partial<DraftField>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const removeField = (id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
  };

  const parseNumber = (v: string, label: string): number => {
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

      const base = {
        name,
        type: f.type,
        page,
        x,
        y,
        width,
        height,
        required: f.required,
      } as Record<string, unknown>;

      if (f.type === "text") {
        base.value = f.value;
        base.multiline = f.multiline;
      } else if (f.type === "checkbox") {
        base.checked = f.checked;
      } else if (f.type === "radio" || f.type === "combobox" || f.type === "listbox") {
        const options = f.options.split(",").map((o) => o.trim()).filter(Boolean);
        if (!options.length) throw new Error(`Field #${idx + 1}: options are required`);
        base.options = options;
        base.value = f.value || options[0];
      }

      return base;
    });
  };

  const process = async () => {
    if (!file) return;
    setStatus("processing");
    setError(null);
    try {
      const payload = buildPayload();
      await processAndDownload("/form-creator", file, buildOutputFilename(file.name, "form", "pdf"), {
        form_fields: JSON.stringify(payload),
      });
      setStatus("done");
    } catch (e: any) {
      setError(e.message || "Failed");
      setStatus("idle");
    }
  };

  return (
    <div className="space-y-5">
      {!file ? (
        <FileUploadZone
          file={null}
          onFileSelect={(f) => {
            setFile(f);
            setStatus("idle");
            setError(null);
          }}
          onClear={() => setFile(null)}
          accept=".pdf"
          label="Drop PDF here"
          hint="Add fillable fields to your PDF"
        />
      ) : (
        <FileUploadZone
          file={file}
          onFileSelect={setFile}
          onClear={() => {
            setFile(null);
            setStatus("idle");
            setError(null);
          }}
          accept=".pdf"
        />
      )}

      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-foreground">Form Fields</p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setFields((prev) => [...prev, newField(prev.length + 1)])}
          >
            <Plus size={14} className="mr-1" />
            Add field
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Coordinates are in PDF points from top-left. Common start values: x=72, y=72.
        </p>

        <div className="space-y-3">
          {fields.map((field, idx) => (
            <div key={field.id} className="rounded-lg border border-border p-3 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Field {idx + 1}</p>
                <button
                  type="button"
                  onClick={() => removeField(field.id)}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label="Remove field"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-muted-foreground">Name</label>
                  <input
                    value={field.name}
                    onChange={(e) => updateField(field.id, { name: e.target.value })}
                    className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-xs text-foreground outline-none focus:border-accent/50"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Type</label>
                  <select
                    value={field.type}
                    onChange={(e) => updateField(field.id, { type: e.target.value as FieldType })}
                    className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-xs text-foreground outline-none focus:border-accent/50"
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                {[
                  { key: "page", label: "Page" },
                  { key: "x", label: "X" },
                  { key: "y", label: "Y" },
                  { key: "width", label: "Width" },
                  { key: "height", label: "Height" },
                ].map((item) => (
                  <div key={item.key}>
                    <label className="text-xs text-muted-foreground">{item.label}</label>
                    <input
                      value={field[item.key as keyof DraftField] as string}
                      onChange={(e) => updateField(field.id, { [item.key]: e.target.value } as Partial<DraftField>)}
                      className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-xs text-foreground outline-none focus:border-accent/50"
                    />
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-4">
                <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={field.required}
                    onChange={(e) => updateField(field.id, { required: e.target.checked })}
                    className="accent-foreground"
                  />
                  Required
                </label>
                {field.type === "text" && (
                  <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={field.multiline}
                      onChange={(e) => updateField(field.id, { multiline: e.target.checked })}
                      className="accent-foreground"
                    />
                    Multiline
                  </label>
                )}
                {field.type === "checkbox" && (
                  <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={field.checked}
                      onChange={(e) => updateField(field.id, { checked: e.target.checked })}
                      className="accent-foreground"
                    />
                    Checked by default
                  </label>
                )}
              </div>

              {(field.type === "text" || field.type === "radio" || field.type === "combobox" || field.type === "listbox") && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <div>
                    <label className="text-xs text-muted-foreground">
                      Default value
                    </label>
                    <input
                      value={field.value}
                      onChange={(e) => updateField(field.id, { value: e.target.value })}
                      className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-xs text-foreground outline-none focus:border-accent/50"
                    />
                  </div>
                  {(field.type === "radio" || field.type === "combobox" || field.type === "listbox") && (
                    <div>
                      <label className="text-xs text-muted-foreground">
                        Options (comma separated)
                      </label>
                      <input
                        value={field.options}
                        onChange={(e) => updateField(field.id, { options: e.target.value })}
                        className="mt-1 w-full rounded-lg border border-border bg-secondary/20 px-3 py-2 text-xs text-foreground outline-none focus:border-accent/50"
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          <AlertCircle size={15} />
          {error}
        </div>
      )}

      {status === "done" ? (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-5 text-center">
          <p className="text-sm font-semibold text-emerald-400 mb-3">Form fields added</p>
          <Button
            variant="outline"
            onClick={() => {
              setFile(null);
              setStatus("idle");
              setFields([newField(1)]);
            }}
          >
            Create another
          </Button>
        </div>
      ) : (
        <Button className={cn("w-full", !canSubmit && "opacity-80")} disabled={!canSubmit} onClick={process}>
          {status === "processing" ? (
            <>
              <Loader2 size={14} className="animate-spin mr-2" />
              Building form fields...
            </>
          ) : (
            "Generate Fillable PDF"
          )}
        </Button>
      )}
    </div>
  );
}
