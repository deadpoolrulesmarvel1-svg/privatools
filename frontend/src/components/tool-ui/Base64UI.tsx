/**
 * Base64UI — text ↔ Base64 with workshop aesthetic.
 *
 * Tabbed encode/decode, code-editor I/O panels, live conversion,
 * swap action to flip input/output, mono everything.
 */
import { useEffect, useMemo, useState, useCallback} from "react";
import { KeyRound, Copy, ArrowDownUp, Check, AlertCircle, Sparkles, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToolDefaults } from "@/hooks/useToolDefaults";

type Mode = "encode" | "decode";

// A reasonably tight test for whether a blob of text "looks like" Base64.
function looksLikeBase64(s: string): boolean {
    const trimmed = s.trim();
    if (trimmed.length < 8) return false;
    if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed) && trimmed.replace(/\s+/g, "").length % 4 === 0) {
        // Avoid matching plain words (e.g. "Hello") that happen to be base64-charset only.
        const compact = trimmed.replace(/\s+/g, "");
        if (!/[A-Z]/.test(compact) || !/[a-z]/.test(compact) || !/[0-9+/]/.test(compact)) {
            return compact.length >= 16; // longer strings of mixed chars likely real base64
        }
        return true;
    }
    return false;
}

const BASE64_DEFAULTS: { mode: Mode } = {
    mode: "encode",
};

export function Base64UI() {
    const [config, , { setField }] = useToolDefaults("base64", BASE64_DEFAULTS);
    const { mode } = config;
    const setMode = useCallback((v: React.SetStateAction<typeof BASE64_DEFAULTS["mode"]>) => setField("mode", v), [setField]);

    const [input, setInput] = useState("");
    const [output, setOutput] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    const autoHint = useMemo(() => {
        return mode === "encode" && looksLikeBase64(input);
    }, [mode, input]);

    // Live convert when input changes
    useEffect(() => {
        if (!input.trim()) { setOutput(""); setError(null); return; }
        try {
            if (mode === "encode") {
                setOutput(btoa(unescape(encodeURIComponent(input))));
            } else {
                setOutput(decodeURIComponent(escape(atob(input.replace(/\s+/g, "")))));
            }
            setError(null);
        } catch {
            setError(mode === "decode" ? "Invalid Base64 input." : "Could not encode.");
            setOutput("");
        }
    }, [input, mode]);

    const copy = () => {
        navigator.clipboard.writeText(output);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const swap = () => {
        setMode(m => m === "encode" ? "decode" : "encode");
        setInput(output);
    };

    const loadSample = () => {
        if (mode === "encode") setInput("Hello, PrivaTools! Encode me 1, 2, 3.");
        else setInput("SGVsbG8sIFByaXZhVG9vbHMhIERlY29kZSBtZSAxLCAyLCAzLg==");
    };

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-accent/30 bg-accent/[0.05] px-4 py-3 flex items-center gap-3">
                <ShieldCheck size={16} className="text-accent shrink-0" />
                <p className="text-[13px] text-muted-foreground leading-snug">
                    <span className="text-foreground font-medium">100% in-browser.</span> btoa / atob run locally — your text never touches a server.
                </p>
            </div>

            {/* Mode tabs + swap */}
            <div className="flex items-center gap-3 flex-wrap">
                <div role="tablist" aria-label="Mode" className="inline-flex rounded-lg border border-border bg-paper-2/40 p-0.5">
                    {(["encode", "decode"] as Mode[]).map(m => {
                        const active = mode === m;
                        return (
                            <button
                                key={m}
                                role="tab"
                                aria-selected={active}
                                onClick={() => setMode(m)}
                                className={cn(
                                    "inline-flex items-center h-8 px-3.5 text-[13px] font-medium rounded transition-colors capitalize",
                                    active ? "bg-card text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {m === "encode" ? "Encode" : "Decode"}
                            </button>
                        );
                    })}
                </div>
                {output && (
                    <button
                        onClick={swap}
                        aria-label="Swap input and output"
                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                    >
                        <ArrowDownUp size={12} /> Swap
                    </button>
                )}
                {!input && (
                    <button
                        type="button"
                        onClick={loadSample}
                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                    >
                        <Sparkles size={12} /> Try sample
                    </button>
                )}
                <span className="font-medium ml-auto text-[11.5px] text-muted-foreground">
                    <KeyRound size={10} className="inline -mt-0.5 mr-1" />
                    {mode === "encode" ? "Text → Base64" : "Base64 → Text"}
                </span>
            </div>

            {/* Auto-detect hint */}
            {autoHint && (
                <button
                    type="button"
                    onClick={() => setMode("decode")}
                    className="w-full text-left rounded-lg border border-accent/30 bg-accent/[0.05] px-3 py-2 flex items-center gap-2.5 hover:bg-accent/[0.08] transition-colors"
                >
                    <Sparkles size={13} className="text-accent" />
                    <span className="text-[12.5px] text-foreground">That looks like Base64 — switch to decode mode?</span>
                    <span className="font-medium ml-auto text-[11px] text-accent">Switch</span>
                </button>
            )}

            {/* Input + Output as code-editor panels */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-3 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                        <span>{mode === "encode" ? "Plain text" : "Base64"}</span>
                        <div className="flex items-center gap-2 normal-case tracking-normal">
                            {input && <span className="font-medium text-[11.5px]">{input.length} char{input.length !== 1 ? "s" : ""}</span>}
                            {input && (
                                <button
                                    type="button"
                                    onClick={() => setInput("")}
                                    aria-label="Clear input"
                                    className="font-medium text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 h-6 rounded hover:bg-secondary/60"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                    </div>
                    <textarea
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        placeholder={mode === "encode" ? "Enter text to encode…" : "Paste a Base64 string…"}
                        spellCheck={false}
                        className="block w-full h-44 px-3 py-3 bg-transparent font-mono text-[13px] text-foreground placeholder:text-muted-foreground resize-none outline-none"
                    />
                </div>

                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="px-3 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between">
                        <span className="font-medium text-[11.5px] text-muted-foreground">
                            {mode === "encode" ? "Base64" : "Plain text"}
                        </span>
                        {output && (
                            <button
                                onClick={copy}
                                className={cn(
                                    "font-medium inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors",
                                    copied && "animate-copy-flash"
                                )}
                            >
                                {copied ? <><Check size={10} className="text-accent" /> Copied</> : <><Copy size={10} /> Copy</>}
                            </button>
                        )}
                    </div>
                    <pre className="w-full h-44 px-3 py-3 bg-transparent font-mono text-[13px] text-foreground overflow-auto break-all whitespace-pre-wrap">
                        {output || <span className="text-muted-foreground italic font-display">Output appears here…</span>}
                    </pre>
                </div>
            </div>

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}
        </div>
    );
}
