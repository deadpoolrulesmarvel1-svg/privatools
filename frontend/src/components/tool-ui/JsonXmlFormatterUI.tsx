/**
 * JsonXmlFormatterUI — format & validate JSON or XML.
 *
 * Workshop aesthetic: tabbed mode picker, code-editor-style two-pane
 * layout (input above, output below), syntax line numbers in the gutter.
 */
import { useMemo, useState, useCallback} from "react";
import { Braces, CheckCircle2, XCircle, Copy, Check, Minimize2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { loadSampleJsonText } from "@/lib/sample-files";
import { emitToolSuccess } from "@/hooks/useFirstSuccess";
import { useToolDefaults } from "@/hooks/useToolDefaults";

type Mode = "json" | "xml";
type Action = "pretty" | "minify";

// Try to pluck a "line N column M" hint out of the raw JSON.parse error string.
function findLineCol(text: string, message: string): { line: number; col: number } | null {
    const posMatch = message.match(/position (\d+)/i);
    if (posMatch) {
        const pos = parseInt(posMatch[1], 10);
        const before = text.slice(0, pos);
        const line = (before.match(/\n/g) || []).length + 1;
        const col = pos - before.lastIndexOf("\n");
        return { line, col };
    }
    const lineMatch = message.match(/line (\d+) column (\d+)/i);
    if (lineMatch) return { line: parseInt(lineMatch[1], 10), col: parseInt(lineMatch[2], 10) };
    return null;
}

function prettyJson(text: string, action: Action): { result: string; error: string | null } {
    try {
        const parsed = JSON.parse(text);
        return { result: action === "minify" ? JSON.stringify(parsed) : JSON.stringify(parsed, null, 2), error: null };
    } catch (e: unknown) {
        const msg = (e as Error).message;
        const lc = findLineCol(text, msg);
        return { result: text, error: lc ? `${msg} (line ${lc.line}, col ${lc.col})` : msg };
    }
}

function prettyXml(text: string, action: Action): { result: string; error: string | null } {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(text, "application/xml");
        const err = doc.querySelector("parsererror");
        if (err) return { result: text, error: err.textContent ?? "Invalid XML" };
        const s = new XMLSerializer();
        let xml = s.serializeToString(doc);
        if (action === "pretty") {
            xml = xml.replace(/></g, ">\n<");
        } else {
            xml = xml.replace(/>\s+</g, "><");
        }
        return { result: xml, error: null };
    } catch (e: unknown) {
        return { result: text, error: (e as Error).message };
    }
}

const JSON_XML_FORMATTER_DEFAULTS: { mode: Mode } = {
    mode: "json",
};

export function JsonXmlFormatterUI() {
    const [config, , { setField }] = useToolDefaults("json-xml-formatter", JSON_XML_FORMATTER_DEFAULTS);
    const { mode } = config;
    const setMode = useCallback((v: React.SetStateAction<typeof JSON_XML_FORMATTER_DEFAULTS["mode"]>) => setField("mode", v), [setField]);

    const [input, setInput] = useState("");
    const [output, setOutput] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const run = (action: Action) => {
        const { result, error } = mode === "json" ? prettyJson(input, action) : prettyXml(input, action);
        setOutput(result);
        setError(error);
        if (!error) emitToolSuccess("JSON / XML formatter");
    };
    const format = () => run("pretty");
    const minify = () => run("minify");

    const loadSample = async () => {
        // For JSON we prefer the bundled `/samples/sample.json` (richer + the
        // same file shared with the rest of the onboarding). For XML we keep
        // an inline string — there's no shared XML sample today.
        if (mode === "json") {
            try {
                const text = await loadSampleJsonText();
                setInput(text);
                return;
            } catch {
                // Fall through to the inline fallback if the static asset is
                // missing (dev server quirk, offline build, etc.).
            }
            setInput('{"name":"PrivaTools","version":"1.4.0","tools":["pdf","image","video"],"meta":{"open":true,"count":179}}');
        } else {
            setInput('<root><name>PrivaTools</name><version>1.4.0</version><tools><tool>pdf</tool><tool>image</tool></tools></root>');
        }
    };

    const copy = () => {
        navigator.clipboard.writeText(output);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const inputLines = useMemo(() => Math.max(1, input.split("\n").length), [input]);
    const outputLines = useMemo(() => Math.max(1, output.split("\n").length), [output]);

    return (
        <div className="space-y-4">
            {/* Mode tabs + status */}
            <div className="flex items-center gap-3 flex-wrap">
                <div role="tablist" aria-label="Format mode" className="inline-flex rounded-lg border border-border bg-paper-2/40 p-0.5">
                    {(["json", "xml"] as Mode[]).map(m => {
                        const active = mode === m;
                        return (
                            <button
                                key={m}
                                role="tab"
                                aria-selected={active}
                                onClick={() => { setMode(m); setOutput(""); setError(null); }}
                                className={cn(
                                    "inline-flex items-center h-8 px-3.5 text-[12px] font-medium rounded transition-colors",
                                    active
                                        ? "bg-card text-foreground shadow-sm border border-border"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {m}
                            </button>
                        );
                    })}
                </div>
                {/* Status pill */}
                {(error || output) && (
                    <span
                        className={cn(
                            "font-medium inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md border text-[11.5px]",
                            error
                                ? "border-destructive/30 bg-destructive/[0.06] text-destructive"
                                : "border-accent/30 bg-accent/[0.06] text-accent"
                        )}
                    >
                        {error ? <><XCircle size={11} /> Invalid</> : <><CheckCircle2 size={11} /> Valid</>}
                    </span>
                )}
                {/* Spacer + sample + minify + format buttons */}
                <div className="ml-auto flex items-center gap-2">
                    {!input.trim() && (
                        <button
                            type="button"
                            onClick={loadSample}
                            className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <Sparkles size={12} /> Try sample
                        </button>
                    )}
                    <button
                        type="button"
                        onClick={minify}
                        disabled={!input.trim()}
                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50"
                    >
                        <Minimize2 size={12} /> Minify
                    </button>
                    <button
                        onClick={format}
                        disabled={!input.trim()}
                        title="Format and validate (Cmd/Ctrl + Enter)"
                        className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                        <Braces size={13} /> Format &amp; validate
                    </button>
                    {input.trim() && (
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                    )}
                </div>
            </div>

            {/* Input editor */}
            <CodeEditor
                label="Input"
                value={input}
                onChange={setInput}
                onSubmit={format}
                placeholder={mode === "json" ? '{ "key": "value", "items": [1, 2, 3] }' : "<root>\n  <item>value</item>\n</root>"}
                lines={inputLines}
                readOnly={false}
            />

            {/* Error inline */}
            {error && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 flex items-start gap-2 font-mono text-[12.5px] text-destructive">
                    <XCircle size={13} className="mt-px shrink-0" />
                    <span className="break-words">{error}</span>
                </div>
            )}

            {/* Output editor (only when there's a valid output) */}
            {!error && output && (
                <CodeEditor
                    label="Output"
                    value={output}
                    onChange={() => {}}
                    placeholder=""
                    lines={outputLines}
                    readOnly
                    rightAction={
                        <button
                            onClick={copy}
                            className={cn(
                                "font-medium inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors",
                                copied && "animate-copy-flash"
                            )}
                        >
                            {copied ? <><Check size={10} className="text-accent" /> Copied</> : <><Copy size={10} /> Copy</>}
                        </button>
                    }
                />
            )}
        </div>
    );
}

function CodeEditor({
    label, value, onChange, placeholder, lines, readOnly, rightAction, onSubmit,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
    lines: number;
    readOnly: boolean;
    rightAction?: React.ReactNode;
    onSubmit?: () => void;
}) {
    const lineNos = Array.from({ length: Math.max(lines, 6) }, (_, i) => i + 1);
    return (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="px-3 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between">
                <span className="font-medium text-[11.5px] text-muted-foreground">
                    {label}
                </span>
                {rightAction || (value && <span className="font-mono text-[10.5px] text-muted-foreground/85">{lines} line{lines !== 1 ? "s" : ""}</span>)}
            </div>
            <div className="flex font-mono text-[13px]">
                {/* Gutter */}
                <div className="select-none bg-paper-2/30 border-r border-border py-3 px-2 text-right text-muted-foreground/60 leading-relaxed">
                    {lineNos.map(n => (
                        <div key={n} className="w-7 tabular-nums">{n}</div>
                    ))}
                </div>
                <textarea
                    value={value}
                    onChange={e => onChange(e.target.value)}
                    onKeyDown={e => {
                        if (onSubmit && (e.metaKey || e.ctrlKey) && e.key === "Enter") {
                            e.preventDefault();
                            onSubmit();
                        }
                    }}
                    placeholder={placeholder}
                    readOnly={readOnly}
                    spellCheck={false}
                    className={cn(
                        "flex-1 py-3 px-3 bg-transparent outline-none text-foreground placeholder:text-muted-foreground/40 leading-relaxed resize-none min-h-[170px]",
                        readOnly && "cursor-default"
                    )}
                    style={{ overflow: "auto" }}
                />
            </div>
        </div>
    );
}
