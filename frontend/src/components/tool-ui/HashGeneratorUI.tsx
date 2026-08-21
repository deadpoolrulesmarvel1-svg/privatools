/**
 * HashGeneratorUI — computes MD5/SHA-1/SHA-256/SHA-512 over text or file.
 *
 * Workshop aesthetic: tabbed text/file modes, mono output rows with copy
 * affordance, algorithm label in mono uppercase.
 */
import { useState, useCallback} from "react";
import { Hash, Upload, Copy, Check, FileText, X, Sparkles, ShieldCheck, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToolDefaults } from "@/hooks/useToolDefaults";

type Mode = "text" | "file";
interface HashResult { algo: string; value: string; }

/** Compute a hash of the given ArrayBuffer using the named Web Crypto algorithm. */
async function digest(algo: string, buf: ArrayBuffer): Promise<string> {
    const hash = await crypto.subtle.digest(algo, buf);
    return Array.from(new Uint8Array(hash))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
}

async function hashText(text: string): Promise<HashResult[]> {
    const data = new TextEncoder().encode(text).buffer;
    const sha1   = await digest("SHA-1",   data);
    const sha256 = await digest("SHA-256", data);
    const sha512 = await digest("SHA-512", data);
    return [
        { algo: "SHA-1",   value: sha1   },
        { algo: "SHA-256", value: sha256 },
        { algo: "SHA-512", value: sha512 },
    ];
}

async function hashFile(file: File): Promise<HashResult[]> {
    const buf = await file.arrayBuffer();
    const sha1   = await digest("SHA-1",   buf);
    const sha256 = await digest("SHA-256", buf);
    const sha512 = await digest("SHA-512", buf);
    return [
        { algo: "SHA-1",   value: sha1   },
        { algo: "SHA-256", value: sha256 },
        { algo: "SHA-512", value: sha512 },
    ];
}

const HASH_GENERATOR_DEFAULTS: { mode: Mode } = {
    mode: "text",
};

export function HashGeneratorUI() {
    const [config, , { setField }] = useToolDefaults("hash-generator", HASH_GENERATOR_DEFAULTS);
    const { mode } = config;
    const setMode = useCallback((v: React.SetStateAction<typeof HASH_GENERATOR_DEFAULTS["mode"]>) => setField("mode", v), [setField]);

    const [input, setInput] = useState("");
    const [file, setFile] = useState<File | null>(null);
    const [results, setResults] = useState<HashResult[]>([]);
    const [copied, setCopied] = useState<string | null>(null);
    const [computing, setComputing] = useState(false);

    const run = async () => {
        setComputing(true);
        try {
            if (mode === "text" && input.trim()) {
                setResults(await hashText(input));
            } else if (mode === "file" && file) {
                setResults(await hashFile(file));
            }
        } finally {
            setComputing(false);
        }
    };

    const copy = (val: string) => {
        navigator.clipboard.writeText(val);
        setCopied(val);
        setTimeout(() => setCopied(null), 1500);
    };

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-accent/30 bg-accent/[0.05] px-4 py-3 flex items-center gap-3">
                <ShieldCheck size={16} className="text-accent shrink-0" />
                <p className="text-[13px] text-muted-foreground leading-snug flex-1">
                    <span className="text-foreground font-medium">100% in-browser.</span> Hashes computed via Web Crypto — your data never leaves the browser.
                </p>
            </div>
            {/* Mode tabs */}
            <div className="flex items-center gap-3 flex-wrap">
                <div role="tablist" aria-label="Hash input mode" className="inline-flex rounded-lg border border-border bg-paper-2/40 p-0.5">
                    {(["text", "file"] as Mode[]).map(m => {
                        const active = mode === m;
                        return (
                            <button
                                key={m}
                                role="tab"
                                aria-selected={active}
                                onClick={() => { setMode(m); setResults([]); }}
                                className={cn(
                                    "inline-flex items-center gap-1.5 h-8 px-3.5 text-[13px] font-medium rounded transition-colors",
                                    active
                                        ? "bg-card text-foreground shadow-sm border border-border"
                                        : "text-muted-foreground hover:text-foreground"
                                )}
                            >
                                {m === "text" ? "Hash text" : "Hash file"}
                            </button>
                        );
                    })}
                </div>
                {mode === "text" && !input.trim() && (
                    <button
                        type="button"
                        onClick={() => { setInput("The quick brown fox jumps over the lazy dog."); setResults([]); }}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                    >
                        <Sparkles size={12} /> Try sample
                    </button>
                )}
            </div>

            {/* Input */}
            {mode === "text" ? (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="px-3 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between">
                        <span className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">Input text</span>
                        {input && (
                            <span className="font-mono text-[10.5px] tracking-wider text-muted-foreground/85">{input.length} char{input.length !== 1 ? "s" : ""}</span>
                        )}
                    </div>
                    <textarea
                        placeholder="Type or paste any text…"
                        value={input}
                        onChange={e => { setInput(e.target.value); setResults([]); }}
                        onKeyDown={e => {
                            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                                e.preventDefault();
                                if (input.trim()) run();
                            }
                        }}
                        spellCheck={false}
                        className="block w-full font-mono text-[13px] leading-relaxed h-36 resize-none bg-transparent px-3 py-3 outline-none placeholder:text-muted-foreground/60"
                    />
                </div>
            ) : file ? (
                <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3">
                    <div className="h-10 w-10 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                        <FileText size={16} className="text-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium text-foreground truncate">{file.name}</p>
                        <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground mt-0.5">
                            {(file.size / 1024).toFixed(1)} KB
                        </p>
                    </div>
                    <button
                        onClick={() => { setFile(null); setResults([]); }}
                        className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                        aria-label="Remove file"
                    >
                        <X size={13} />
                    </button>
                </div>
            ) : (
                <label className="relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04] px-6 py-10 cursor-pointer transition-colors group">
                    <CornerMarks />
                    <div className="h-12 w-12 rounded-xl bg-accent/10 border border-accent/30 group-hover:bg-accent/15 flex items-center justify-center transition-colors">
                        <Upload size={20} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">Drop any file</p>
                    <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">Computed entirely in your browser</p>
                    <input
                        type="file"
                        className="hidden"
                        onChange={e => { setFile(e.target.files?.[0] ?? null); setResults([]); e.target.value = ""; }}
                    />
                </label>
            )}

            <div className="flex items-center gap-3 flex-wrap">
                <button
                    onClick={run}
                    disabled={computing || (mode === "text" && !input.trim()) || (mode === "file" && !file)}
                    title="Generate hashes (Cmd/Ctrl + Enter in text mode)"
                    className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    <Hash size={13} /> {computing ? <><Loader2 size={13} className="animate-spin" /> Hashing…</> : "Generate hashes"}
                </button>
                {((mode === "text" && input.trim()) || (mode === "file" && file)) && !computing && (
                    <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                )}
            </div>

            {/* Results */}
            {results.length > 0 && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center gap-2 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                        <span className="text-accent">§</span> Digests · all computed in browser
                    </div>
                    <div className="divide-y divide-border">
                        {results.map(r => (
                            <div key={r.algo} className="flex items-start gap-3 p-4">
                                <span className="font-mono text-[10px] tracking-[0.10em] uppercase text-accent w-16 shrink-0 mt-0.5">{r.algo}</span>
                                <p className="flex-1 font-mono text-[12px] text-foreground break-all leading-relaxed select-all">{r.value}</p>
                                <button
                                    onClick={() => copy(r.value)}
                                    className={cn(
                                        "shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 font-mono text-[10.5px] tracking-[0.06em] uppercase transition-colors",
                                        copied === r.value && "animate-copy-flash"
                                    )}
                                >
                                    {copied === r.value ? (<><Check size={10} className="text-accent" /> Copied</>) : (<><Copy size={10} /> Copy</>)}
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

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
