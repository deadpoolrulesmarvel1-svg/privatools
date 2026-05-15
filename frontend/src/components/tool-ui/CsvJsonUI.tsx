import { useState } from "react";
import { ArrowLeftRight, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Mode = "csv-to-json" | "json-to-csv";

function csvToJson(csv: string): string {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return "[]";
  const headers = lines[0].split(",").map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const vals = line.split(",").map(v => v.trim());
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
  });
  return JSON.stringify(rows, null, 2);
}

function jsonToCsv(json: string): string {
  const data = JSON.parse(json);
  if (!Array.isArray(data) || data.length === 0) return "";
  const headers = Object.keys(data[0]);
  const rows = data.map((row: Record<string, unknown>) => headers.map(h => String(row[h] ?? "")).join(","));
  return [headers.join(","), ...rows].join("\n");
}

export function CsvJsonUI() {
  const [mode, setMode] = useState<Mode>("csv-to-json");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = () => {
    setError(null);
    try {
      setOutput(mode === "csv-to-json" ? csvToJson(input) : jsonToCsv(input));
    } catch (e: unknown) {
      setError((e as Error).message);
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    const ext = mode === "csv-to-json" ? "json" : "csv";
    const blob = new Blob([output], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `converted.${ext}`;
    a.click();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        {(["csv-to-json", "json-to-csv"] as Mode[]).map(m => (
          <button key={m} onClick={() => { setMode(m); setOutput(""); setError(null); }}
            className={cn("flex-1 py-2 rounded-lg text-sm font-medium border transition-colors",
              mode === m ? "border-accent bg-accent/10 text-primary" : "border-border bg-secondary/40 text-muted-foreground")}>
            {m === "csv-to-json" ? "CSV → JSON" : "JSON → CSV"}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-muted-foreground">
          {mode === "csv-to-json" ? "CSV input" : "JSON input"}
        </label>
        <Textarea
          placeholder={mode === "csv-to-json"
            ? "name,age,email\nAlice,30,alice@example.com"
            : '[{"name":"Alice","age":30}]'}
          value={input}
          onChange={e => { setInput(e.target.value); setOutput(""); setError(null); }}
          className="font-mono text-xs h-40 resize-none bg-secondary/40"
        />
      </div>

      <Button className="w-full gap-2" onClick={run} disabled={!input.trim()}>
        <ArrowLeftRight size={14} /> Convert
      </Button>

      {error && (
        <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-4 py-3">
          <p className="text-xs text-rose-400">{error}</p>
        </div>
      )}

      {output && !error && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-muted-foreground">
              {mode === "csv-to-json" ? "JSON output" : "CSV output"}
            </label>
            <div className="flex gap-2">
              <button onClick={copy} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <Copy size={11} />{copied ? "Copied!" : "Copy"}
              </button>
              <button onClick={download} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <Download size={11} /> Download
              </button>
            </div>
          </div>
          <Textarea value={output} readOnly className="font-mono text-xs h-40 resize-none bg-secondary/40" />
        </div>
      )}
    </div>
  );
}
