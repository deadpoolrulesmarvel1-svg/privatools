/**
 * CsvJsonUI — convert CSV ↔ JSON in-browser.
 * Workshop: mode toggle + code-editor styled input/output panels.
 */
import { useMemo, useState, useCallback} from "react";
import { ArrowLeftRight, Copy, Download, Check, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadBlob } from "@/lib/api";
import { useToolDefaults } from "@/hooks/useToolDefaults";

type Mode = "csv-to-json" | "json-to-csv";

/** Sniff a likely delimiter by counting candidate characters in the first non-empty line. */
function detectDelimiter(csv: string): "," | ";" | "\t" | "|" {
    const firstLine = csv.split(/\r?\n/).find(l => l.trim()) || "";
    const counts: Record<string, number> = {
        ",": (firstLine.match(/,/g) || []).length,
        ";": (firstLine.match(/;/g) || []).length,
        "\t": (firstLine.match(/\t/g) || []).length,
        "|": (firstLine.match(/\|/g) || []).length,
    };
    const winner = Object.entries(counts).reduce((a, b) => (b[1] > a[1] ? b : a), [",", 0])[0];
    return (winner as "," | ";" | "\t" | "|") || ",";
}

function csvToJson(csv: string, delim: string): string {
    const lines = csv.trim().split(/\r?\n/);
    if (lines.length < 2) return "[]";
    const split = (l: string) => l.split(delim).map(v => v.trim());
    const headers = split(lines[0]);
    const rows = lines.slice(1).map(line => {
        const vals = split(line);
        return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? ""]));
    });
    return JSON.stringify(rows, null, 2);
}

function jsonToCsv(json: string, delim: string): string {
    const data = JSON.parse(json);
    if (!Array.isArray(data) || data.length === 0) return "";
    const headers = Object.keys(data[0]);
    const rows = data.map((row: Record<string, unknown>) => headers.map(h => String(row[h] ?? "")).join(delim));
    return [headers.join(delim), ...rows].join("\n");
}

const DELIM_LABEL: Record<string, string> = { ",": "Comma (,)", ";": "Semicolon (;)", "\t": "Tab", "|": "Pipe (|)" };
const SAMPLE_CSV = "name,age,city\nAlice,30,Boston\nBob,28,Berlin\nCarol,42,Chennai";
const SAMPLE_JSON = '[\n  {"name":"Alice","age":30,"city":"Boston"},\n  {"name":"Bob","age":28,"city":"Berlin"}\n]';

const CSV_JSON_DEFAULTS: { mode: Mode } = {
    mode: "csv-to-json",
};

export function CsvJsonUI() {
    const [config, , { setField }] = useToolDefaults("csv-json", CSV_JSON_DEFAULTS);
    const { mode } = config;
    const setMode = useCallback((v: React.SetStateAction<typeof CSV_JSON_DEFAULTS["mode"]>) => setField("mode", v), [setField]);

    const [input, setInput] = useState("");
    const [output, setOutput] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [delimOverride, setDelimOverride] = useState<string | null>(null);

    // Detect delimiter on the fly; user can override.
    const detected = useMemo(() => (mode === "csv-to-json" && input ? detectDelimiter(input) : ","), [input, mode]);
    const delim = delimOverride ?? detected;

    const run = () => {
        setError(null);
        try { setOutput(mode === "csv-to-json" ? csvToJson(input, delim) : jsonToCsv(input, delim)); }
        catch (e: unknown) { setError((e as Error).message); }
    };

    const loadSample = () => {
        setInput(mode === "csv-to-json" ? SAMPLE_CSV : SAMPLE_JSON);
        setOutput("");
        setError(null);
        setDelimOverride(null);
    };

    // Cmd+Enter shortcut to run the conversion.
    const onKey = (e: React.KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); if (input.trim()) run(); }
    };

    const copy = () => {
        navigator.clipboard.writeText(output);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const download = () => {
        // downloadBlob revokes the URL after the click, so we don't leak.
        const ext = mode === "csv-to-json" ? "json" : "csv";
        const blob = new Blob([output], { type: "text/plain" });
        downloadBlob(blob, `converted.${ext}`);
    };

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-2 gap-1 p-1 rounded-md border border-border bg-paper-2/40">
                {(["csv-to-json", "json-to-csv"] as Mode[]).map(m => {
                    const active = mode === m;
                    return (
                        <button key={m}
                            onClick={() => { setMode(m); setOutput(""); setError(null); }}
                            className={cn(
                                "rounded h-9 text-[12.5px] font-medium transition-colors inline-flex items-center justify-center gap-1.5",
                                active ? "bg-card border border-accent text-accent" : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                            )}
                        >
                            {m === "csv-to-json" ? "CSV → JSON" : "JSON → CSV"}
                        </button>
                    );
                })}
            </div>

            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                    <span>{mode === "csv-to-json" ? "CSV input" : "JSON input"}</span>
                    <div className="flex items-center gap-2 normal-case tracking-normal">
                        {!input && (
                            <button
                                type="button"
                                onClick={loadSample}
                                className="font-medium inline-flex items-center gap-1 px-2 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 text-[11px] transition-colors"
                            >
                                <Sparkles size={10} /> Try sample
                            </button>
                        )}
                        {mode === "csv-to-json" && input && (
                            <span className="text-accent">
                                Delimiter: {DELIM_LABEL[delim] || delim}
                            </span>
                        )}
                    </div>
                </div>
                <textarea
                    value={input}
                    onChange={e => { setInput(e.target.value); setOutput(""); setError(null); }}
                    onKeyDown={onKey}
                    placeholder={mode === "csv-to-json"
                        ? "name,age,email\nAlice,30,alice@example.com"
                        : '[{"name":"Alice","age":30}]'}
                    spellCheck={false}
                    className="w-full h-44 bg-paper-2/30 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-foreground placeholder:text-muted-foreground/50 resize-y outline-none"
                />
                {mode === "csv-to-json" && input && (
                    <div className="px-3 py-2 border-t border-border bg-paper-2/30 flex items-center gap-1.5 flex-wrap">
                        <span className="font-medium text-[11px] text-muted-foreground mr-1">Delimiter</span>
                        {([",", ";", "\t", "|"] as const).map(d => {
                            const active = delim === d;
                            return (
                                <button
                                    key={d}
                                    type="button"
                                    onClick={() => setDelimOverride(d)}
                                    className={cn(
                                        "font-medium inline-flex items-center h-6 px-2 text-[11.5px] border rounded transition-colors",
                                        active ? "border-accent bg-accent/[0.08] text-accent" : "border-border text-muted-foreground hover:text-foreground"
                                    )}
                                >
                                    {DELIM_LABEL[d]}
                                </button>
                            );
                        })}
                    </div>
                )}
            </div>

            <button onClick={run} disabled={!input.trim()} title="Convert (Cmd/Ctrl + Enter)" className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                <ArrowLeftRight size={13} /> Convert
            </button>

            {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    {error}
                </div>
            )}

            {output && !error && (
                <div className="rounded-xl border border-accent/30 bg-card overflow-hidden animate-fade-in">
                    <div className="font-medium px-4 py-2 border-b border-accent/20 bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                        <span>{mode === "csv-to-json" ? "JSON output" : "CSV output"}</span>
                        <div className="flex items-center gap-1">
                            <button onClick={copy} className={cn("h-6 px-2 rounded inline-flex items-center gap-1 transition-colors text-muted-foreground hover:text-accent hover:bg-accent/[0.06]", copied && "animate-copy-flash")}>
                                {copied ? <><Check size={10} className="text-accent" /> Copied</> : <><Copy size={10} /> Copy</>}
                            </button>
                            <button onClick={download} className="h-6 px-2 rounded inline-flex items-center gap-1 transition-colors text-muted-foreground hover:text-accent hover:bg-accent/[0.06]">
                                <Download size={10} /> .{mode === "csv-to-json" ? "json" : "csv"}
                            </button>
                        </div>
                    </div>
                    <textarea
                        value={output}
                        readOnly
                        className="w-full h-44 bg-paper-2/30 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-foreground resize-y outline-none"
                    />
                </div>
            )}
        </div>
    );
}
