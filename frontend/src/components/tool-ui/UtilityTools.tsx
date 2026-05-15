/**
 * Six client-only utility tools — instant, no server roundtrip:
 *   - PasswordGeneratorUI
 *   - UuidGeneratorUI
 *   - LoremIpsumUI
 *   - WordCounterUI
 *   - ColorConverterUI    (hex / rgb / hsl)
 *   - UrlEncoderUI        (encode + decode + JWT decode)
 */
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Copy, RefreshCw, Check, AlertCircle } from "lucide-react";

// ─── shared bits ─────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-border rounded-full h-8 px-3"
            onClick={() => {
                if (!value) return;
                navigator.clipboard.writeText(value).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
            }}
        >
            {copied ? <Check size={13} className="mr-1.5 text-accent" /> : <Copy size={13} className="mr-1.5" />}
            {copied ? "Copied" : "Copy"}
        </Button>
    );
}

function ClientToolBanner({ label }: { label: string }) {
    return (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.04] px-4 py-3 flex items-start gap-3">
            <Check size={14} className="text-emerald-400 mt-0.5 shrink-0" />
            <p className="text-[13px] text-muted-foreground leading-snug">
                <span className="text-foreground font-medium">100% in your browser.</span> {label}
            </p>
        </div>
    );
}

// ─── 1. Password Generator ───────────────────────────────────────────────

export function PasswordGeneratorUI() {
    const [length, setLength] = useState(20);
    const [upper, setUpper] = useState(true);
    const [lower, setLower] = useState(true);
    const [digits, setDigits] = useState(true);
    const [symbols, setSymbols] = useState(true);
    const [excludeAmbig, setExcludeAmbig] = useState(false);
    const [pwd, setPwd] = useState("");

    const generate = () => {
        const sets = [
            upper && (excludeAmbig ? "ABCDEFGHJKLMNPQRSTUVWXYZ" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
            lower && (excludeAmbig ? "abcdefghijkmnpqrstuvwxyz" : "abcdefghijklmnopqrstuvwxyz"),
            digits && (excludeAmbig ? "23456789" : "0123456789"),
            symbols && "!@#$%^&*()-_=+[]{};:,.?/",
        ].filter(Boolean) as string[];
        if (sets.length === 0) { setPwd(""); return; }
        const all = sets.join("");
        const rand = (n: number) => crypto.getRandomValues(new Uint32Array(1))[0] % n;
        // Guarantee at least one char from each chosen set
        const out: string[] = sets.map(s => s[rand(s.length)]);
        for (let i = out.length; i < length; i++) out.push(all[rand(all.length)]);
        // Shuffle
        for (let i = out.length - 1; i > 0; i--) {
            const j = rand(i + 1);
            [out[i], out[j]] = [out[j], out[i]];
        }
        setPwd(out.join(""));
    };

    useEffect(() => { generate(); /* eslint-disable-next-line */ }, []);

    const strength = useMemo(() => {
        const sets = [upper, lower, digits, symbols].filter(Boolean).length;
        const entropy = pwd.length * Math.log2(sets * (excludeAmbig ? 22 : 26));
        if (entropy < 60)  return { label: "Weak",     color: "bg-red-500"     };
        if (entropy < 80)  return { label: "Decent",   color: "bg-amber-500"   };
        if (entropy < 100) return { label: "Strong",   color: "bg-lime-500"    };
        return            { label: "Very strong", color: "bg-emerald-500" };
    }, [pwd, upper, lower, digits, symbols, excludeAmbig]);

    return (
        <div className="space-y-4">
            <ClientToolBanner label="The password is generated client-side using crypto.getRandomValues — never sent to a server." />

            {/* Output */}
            <div className="rounded-xl border border-border bg-card p-4">
                <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-2">Generated password</p>
                <div className="flex items-center gap-2">
                    <input
                        readOnly
                        value={pwd}
                        className="flex-1 h-10 px-3 rounded-lg border border-border bg-background font-mono text-[14px] text-foreground"
                    />
                    <Button type="button" size="sm" variant="outline" className="border-border rounded-full h-10 w-10 p-0" onClick={generate} aria-label="Generate again">
                        <RefreshCw size={14} />
                    </Button>
                    <CopyButton value={pwd} />
                </div>
                <div className="mt-3 flex items-center gap-3">
                    <div className="flex-1 h-1.5 rounded-full bg-secondary overflow-hidden">
                        <div className={cn("h-full transition-all", strength.color)} style={{ width: `${Math.min(100, pwd.length * 4)}%` }} />
                    </div>
                    <span className="text-[11px] font-mono text-muted-foreground">{strength.label}</span>
                </div>
            </div>

            {/* Options */}
            <div className="rounded-xl border border-border bg-card/40 p-5 space-y-4">
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label htmlFor="pw-len" className="text-sm font-semibold text-foreground">Length</label>
                        <span className="text-xs font-mono text-accent">{length}</span>
                    </div>
                    <input
                        id="pw-len"
                        type="range" min={4} max={64} step={1}
                        value={length}
                        onChange={e => setLength(parseInt(e.target.value, 10))}
                        className="w-full"
                    />
                </div>
                <div className="grid grid-cols-2 gap-2">
                    {[
                        { label: "Uppercase A-Z", checked: upper, set: setUpper },
                        { label: "Lowercase a-z", checked: lower, set: setLower },
                        { label: "Digits 0-9",    checked: digits, set: setDigits },
                        { label: "Symbols !@#$",  checked: symbols, set: setSymbols },
                        { label: "Exclude ambiguous (l, 1, I, 0, O)", checked: excludeAmbig, set: setExcludeAmbig },
                    ].map(opt => (
                        <label key={opt.label} className="flex items-center gap-2 text-[13px] text-foreground cursor-pointer">
                            <input type="checkbox" checked={opt.checked} onChange={e => opt.set(e.target.checked)} />
                            {opt.label}
                        </label>
                    ))}
                </div>
                <Button type="button" onClick={generate} className="rounded-full bg-foreground text-background hover:bg-foreground/90">
                    Generate new password
                </Button>
            </div>
        </div>
    );
}

// ─── 2. UUID Generator ───────────────────────────────────────────────────

export function UuidGeneratorUI() {
    const [count, setCount] = useState(10);
    const [variant, setVariant] = useState<"v4" | "v7-like">("v4");
    const [list, setList] = useState<string[]>([]);

    const generate = () => {
        const out: string[] = [];
        for (let i = 0; i < count; i++) {
            if (variant === "v4") {
                out.push(crypto.randomUUID());
            } else {
                // RFC 9562 v7-style: timestamp prefix + random tail
                const ms = Date.now();
                const hex = ms.toString(16).padStart(12, "0");
                const buf = crypto.getRandomValues(new Uint8Array(10));
                const rand = Array.from(buf).map(b => b.toString(16).padStart(2, "0")).join("");
                out.push(
                    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-7${rand.slice(0, 3)}-${(8 + (buf[5] >> 6)).toString(16)}${rand.slice(3, 6)}-${rand.slice(6, 18)}`
                );
            }
        }
        setList(out);
    };

    useEffect(() => { generate(); /* eslint-disable-next-line */ }, []);

    return (
        <div className="space-y-4">
            <ClientToolBanner label="UUIDs are generated using crypto.randomUUID() in your browser." />

            <div className="rounded-xl border border-border bg-card/40 p-5 space-y-4">
                <div className="flex items-center gap-3">
                    <label htmlFor="uuid-count" className="text-sm font-semibold text-foreground">Count</label>
                    <input
                        id="uuid-count"
                        type="number" min={1} max={500} value={count}
                        onChange={e => setCount(Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 1)))}
                        className="w-24 h-9 px-3 rounded-md border border-border bg-background text-sm text-foreground"
                    />
                    <div className="flex items-center gap-2">
                        {(["v4", "v7-like"] as const).map(v => (
                            <button
                                key={v}
                                type="button"
                                onClick={() => setVariant(v)}
                                aria-pressed={variant === v}
                                className={cn(
                                    "h-9 px-3 rounded-full border text-[13px] font-medium transition-colors",
                                    variant === v ? "border-accent bg-accent/5 text-foreground" : "border-border text-muted-foreground hover:bg-secondary/40"
                                )}
                            >
                                {v.toUpperCase()}
                            </button>
                        ))}
                    </div>
                    <Button type="button" onClick={generate} className="rounded-full bg-foreground text-background hover:bg-foreground/90 ml-auto">
                        <RefreshCw size={13} className="mr-1.5" /> Regenerate
                    </Button>
                </div>
            </div>

            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-border bg-secondary/20">
                    <span className="text-xs text-muted-foreground">{list.length} UUIDs</span>
                    <CopyButton value={list.join("\n")} />
                </div>
                <pre className="font-mono text-[13px] text-foreground/90 p-4 max-h-[60vh] overflow-y-auto">
                    {list.join("\n")}
                </pre>
            </div>
        </div>
    );
}

// ─── 3. Lorem Ipsum ──────────────────────────────────────────────────────

const LOREM_WORDS = ("lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum").split(" ");

export function LoremIpsumUI() {
    const [units, setUnits] = useState<"paragraphs" | "sentences" | "words">("paragraphs");
    const [count, setCount] = useState(5);
    const [startWithLorem, setStartWithLorem] = useState(true);

    const text = useMemo(() => {
        const rnd = (n: number) => Math.floor(Math.random() * n);
        const word = () => LOREM_WORDS[rnd(LOREM_WORDS.length)];
        const sentence = () => {
            const len = 6 + rnd(12);
            const ws = Array.from({ length: len }, word);
            ws[0] = ws[0][0].toUpperCase() + ws[0].slice(1);
            return ws.join(" ") + ".";
        };
        const paragraph = () => Array.from({ length: 3 + rnd(4) }, sentence).join(" ");
        if (units === "words")     return Array.from({ length: count }, word).join(" ");
        if (units === "sentences") return Array.from({ length: count }, sentence).join(" ");
        const ps = Array.from({ length: count }, paragraph);
        if (startWithLorem && ps[0]) ps[0] = "Lorem ipsum " + ps[0].slice(ps[0].indexOf(" ") + 1);
        return ps.join("\n\n");
    }, [units, count, startWithLorem]);

    return (
        <div className="space-y-4">
            <ClientToolBanner label="Generated client-side. No external API." />
            <div className="rounded-xl border border-border bg-card/40 p-5 flex flex-wrap items-end gap-3">
                <div>
                    <label className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground block mb-1.5">Units</label>
                    <div className="flex gap-1.5">
                        {(["paragraphs", "sentences", "words"] as const).map(u => (
                            <button
                                key={u}
                                type="button"
                                onClick={() => setUnits(u)}
                                aria-pressed={units === u}
                                className={cn(
                                    "h-9 px-3 rounded-full border text-[13px] font-medium transition-colors",
                                    units === u ? "border-accent bg-accent/5 text-foreground" : "border-border text-muted-foreground hover:bg-secondary/40"
                                )}
                            >
                                {u}
                            </button>
                        ))}
                    </div>
                </div>
                <div>
                    <label htmlFor="lorem-count" className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground block mb-1.5">Count</label>
                    <input
                        id="lorem-count"
                        type="number" min={1} max={100} value={count}
                        onChange={e => setCount(Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)))}
                        className="w-24 h-9 px-3 rounded-md border border-border bg-background text-sm text-foreground"
                    />
                </div>
                {units === "paragraphs" && (
                    <label className="flex items-center gap-2 text-[13px] text-muted-foreground">
                        <input type="checkbox" checked={startWithLorem} onChange={e => setStartWithLorem(e.target.checked)} />
                        Start with "Lorem ipsum…"
                    </label>
                )}
                <CopyButton value={text} />
            </div>
            <textarea
                readOnly
                value={text}
                className="w-full h-[40vh] p-4 rounded-xl border border-border bg-card font-serif text-[15px] leading-relaxed text-foreground/90 resize-none focus:outline-none"
            />
        </div>
    );
}

// ─── 4. Word Counter ─────────────────────────────────────────────────────

export function WordCounterUI() {
    const [text, setText] = useState("");
    const stats = useMemo(() => {
        const t = text;
        const words = (t.match(/\S+/g) || []).length;
        const chars = t.length;
        const charsNoSpace = t.replace(/\s/g, "").length;
        const sentences = (t.match(/[^.!?\n]+[.!?]+/g) || []).length;
        const paragraphs = t.trim() ? t.trim().split(/\n\s*\n/).length : 0;
        const lines = t === "" ? 0 : t.split("\n").length;
        const readingMin = Math.max(1, Math.round(words / 220));  // 220 wpm avg
        return { words, chars, charsNoSpace, sentences, paragraphs, lines, readingMin };
    }, [text]);

    return (
        <div className="space-y-4">
            <ClientToolBanner label="All counting happens in your browser. Paste sensitive text without worry." />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {[
                    { label: "Words", value: stats.words },
                    { label: "Characters", value: stats.chars },
                    { label: "No spaces", value: stats.charsNoSpace },
                    { label: "Sentences", value: stats.sentences },
                    { label: "Paragraphs", value: stats.paragraphs },
                    { label: "Lines", value: stats.lines },
                    { label: "Reading time", value: `${stats.readingMin} min` },
                ].map(s => (
                    <div key={s.label} className="rounded-lg border border-border bg-card p-3">
                        <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{s.label}</p>
                        <p className="text-xl font-bold text-foreground tracking-tight mt-0.5">{s.value}</p>
                    </div>
                ))}
            </div>
            <textarea
                value={text}
                onChange={e => setText(e.target.value)}
                placeholder="Paste or type text here…"
                className="w-full h-[40vh] p-4 rounded-xl border border-border bg-card text-[15px] leading-relaxed text-foreground resize-none focus:outline-none focus:border-accent"
            />
        </div>
    );
}

// ─── 5. Color Converter ──────────────────────────────────────────────────

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
    const m = hex.replace(/^#/, "").match(/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
    if (!m) return null;
    let h = m[1];
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}
function rgbToHsl(r: number, g: number, b: number) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0; const l = (max + min) / 2;
    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
        else if (max === g) h = ((b - r) / d + 2);
        else h = ((r - g) / d + 4);
        h *= 60;
    }
    return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function ColorConverterUI() {
    const [hex, setHex] = useState("#5e6ad2");
    const rgb = hexToRgb(hex);
    const hsl = rgb && rgbToHsl(rgb.r, rgb.g, rgb.b);

    return (
        <div className="space-y-4">
            <ClientToolBanner label="Color math runs in your browser, instantly." />
            <div className="rounded-xl border border-border bg-card p-5 flex flex-wrap items-center gap-4">
                <input
                    type="color"
                    value={hex}
                    onChange={e => setHex(e.target.value)}
                    className="h-16 w-20 rounded-lg border border-border bg-transparent"
                    aria-label="Color picker"
                />
                <input
                    type="text"
                    value={hex}
                    onChange={e => setHex(e.target.value)}
                    className="font-mono w-32 h-10 px-3 rounded-lg border border-border bg-background text-foreground focus:outline-none focus:border-accent"
                    spellCheck={false}
                />
                <div className="h-16 w-16 rounded-lg border border-border" style={{ background: hex }} />
            </div>
            {rgb && hsl ? (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                        { label: "HEX",  value: hex.toUpperCase() },
                        { label: "RGB",  value: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` },
                        { label: "HSL",  value: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` },
                        { label: "RGBA", value: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)` },
                        { label: "Tailwind arbitrary", value: `bg-[${hex.toLowerCase()}]` },
                        { label: "CSS var", value: `--brand: ${hex.toLowerCase()};` },
                    ].map(item => (
                        <div key={item.label} className="rounded-lg border border-border bg-card p-3">
                            <div className="flex items-center justify-between mb-1.5">
                                <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">{item.label}</p>
                                <CopyButton value={item.value} />
                            </div>
                            <p className="font-mono text-[13px] text-foreground break-all">{item.value}</p>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                    <AlertCircle size={15} />Invalid hex color
                </div>
            )}
        </div>
    );
}

// ─── 6. URL / JWT decoder ────────────────────────────────────────────────

export function UrlEncoderUI() {
    const [input, setInput] = useState("");
    const [mode, setMode] = useState<"encode" | "decode" | "jwt">("encode");

    const output = useMemo(() => {
        if (!input) return "";
        try {
            if (mode === "encode") return encodeURIComponent(input);
            if (mode === "decode") return decodeURIComponent(input);
            // JWT: split on "."; base64url-decode the first two parts as JSON.
            const parts = input.split(".");
            if (parts.length < 2) return "Not a JWT (expected at least 2 dot-separated parts).";
            const b64url = (s: string) => s.replace(/-/g, "+").replace(/_/g, "/");
            const decode = (s: string) => {
                try {
                    const padded = b64url(s) + "=".repeat((4 - (s.length % 4)) % 4);
                    return JSON.stringify(JSON.parse(atob(padded)), null, 2);
                } catch { return "<invalid>"; }
            };
            return `Header:\n${decode(parts[0])}\n\nPayload:\n${decode(parts[1])}\n\nSignature:\n${parts[2] || "(none)"}`;
        } catch (err) {
            return `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
    }, [input, mode]);

    return (
        <div className="space-y-4">
            <ClientToolBanner label="URL/base64 conversion is pure JavaScript — your strings never leave your browser." />
            <div className="flex items-center gap-2">
                {(["encode", "decode", "jwt"] as const).map(m => (
                    <button
                        key={m}
                        type="button"
                        onClick={() => setMode(m)}
                        aria-pressed={mode === m}
                        className={cn(
                            "h-9 px-4 rounded-full border text-[13px] font-medium transition-colors",
                            mode === m ? "border-accent bg-accent/5 text-foreground" : "border-border text-muted-foreground hover:bg-secondary/40"
                        )}
                    >
                        {m === "encode" ? "URL encode" : m === "decode" ? "URL decode" : "JWT decode"}
                    </button>
                ))}
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div>
                    <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground mb-1.5">Input</p>
                    <textarea
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        placeholder={mode === "jwt" ? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." : "Paste text here…"}
                        className="w-full h-[40vh] p-4 rounded-xl border border-border bg-card font-mono text-[13px] text-foreground resize-none focus:outline-none focus:border-accent"
                    />
                </div>
                <div>
                    <div className="flex items-center justify-between mb-1.5">
                        <p className="text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">Output</p>
                        <CopyButton value={output} />
                    </div>
                    <pre className="w-full h-[40vh] p-4 rounded-xl border border-border bg-card font-mono text-[13px] text-foreground/90 overflow-auto whitespace-pre-wrap break-all">
                        {output}
                    </pre>
                </div>
            </div>
        </div>
    );
}
