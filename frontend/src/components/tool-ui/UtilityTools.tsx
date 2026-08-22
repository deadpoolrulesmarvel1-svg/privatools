/**
 * Six client-only utility tools — instant, no server roundtrip:
 *   - PasswordGeneratorUI
 *   - UuidGeneratorUI
 *   - LoremIpsumUI
 *   - WordCounterUI
 *   - ColorConverterUI    (hex / rgb / hsl)
 *   - UrlEncoderUI        (encode + decode + JWT decode)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { randomInt } from "@/lib/randomInt";
import { Copy, RefreshCw, Check, AlertCircle, Sparkles, ListPlus } from "lucide-react";

// ─── shared bits ─────────────────────────────────────────────────────────

function CopyButton({ value }: { value: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <button
            type="button"
            className={cn(
                "inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50",
                copied && "animate-copy-flash"
            )}
            disabled={!value}
            onClick={() => {
                if (!value) return;
                navigator.clipboard.writeText(value).catch(() => {});
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
            }}
        >
            {copied ? <Check size={13} className="text-accent" /> : <Copy size={13} />}
            {copied ? "Copied" : "Copy"}
        </button>
    );
}

function ClientToolBanner({ label }: { label: string }) {
    return (
        <div className="rounded-lg border border-accent/30 bg-accent/[0.05] px-3 py-2 flex items-center gap-2.5">
            <span className="text-[11px] text-accent font-medium">Browser-only</span>
            <span className="opacity-50 hidden sm:inline">—</span>
            <p className="text-[12.5px] text-foreground leading-snug">{label}</p>
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
    const [bulk, setBulk] = useState<string[]>([]);

    const buildOne = useCallback((): string => {
        const sets = [
            upper && (excludeAmbig ? "ABCDEFGHJKLMNPQRSTUVWXYZ" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ"),
            lower && (excludeAmbig ? "abcdefghijkmnpqrstuvwxyz" : "abcdefghijklmnopqrstuvwxyz"),
            digits && (excludeAmbig ? "23456789" : "0123456789"),
            symbols && "!@#$%^&*()-_=+[]{};:,.?/",
        ].filter(Boolean) as string[];
        if (sets.length === 0) return "";
        const all = sets.join("");
        // Guarantee at least one char from each chosen set
        const out: string[] = sets.map(s => s[randomInt(s.length)]);
        for (let i = out.length; i < length; i++) out.push(all[randomInt(all.length)]);
        // Shuffle
        for (let i = out.length - 1; i > 0; i--) {
            const j = randomInt(i + 1);
            [out[i], out[j]] = [out[j], out[i]];
        }
        return out.join("");
    }, [length, upper, lower, digits, symbols, excludeAmbig]);

    const generate = useCallback(() => {
        setPwd(buildOne());
        setBulk([]);
    }, [buildOne]);

    const generateBatch = useCallback(() => {
        setBulk(Array.from({ length: 5 }, () => buildOne()).filter(Boolean));
    }, [buildOne]);

    useEffect(() => { generate(); }, [generate]);

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
            <ClientToolBanner label="Generated client-side with crypto.getRandomValues — never sent to a server." />

            {/* Output console — big, mono, prominent */}
            <div className="relative rounded-2xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/50 flex items-center justify-between text-[11.5px] text-muted-foreground">
                    <span>Password — {pwd.length} char{pwd.length !== 1 ? "s" : ""}</span>
                    <span className="text-accent">{strength.label}</span>
                </div>
                <div className="px-4 py-5">
                    <p
                        className="font-mono text-[18px] sm:text-[22px] text-foreground break-all leading-snug select-all"
                        style={{ fontVariationSettings: '"opsz" 14' }}
                    >
                        {pwd || <span className="text-muted-foreground italic">Click generate</span>}
                    </p>
                </div>
                {/* Strength meter */}
                <div className="h-1 bg-paper-2 relative">
                    <div className={cn("h-full transition-all", strength.color)} style={{ width: `${Math.min(100, pwd.length * 4)}%` }} />
                </div>
                <div className="px-4 py-2 flex items-center gap-2 bg-paper-2/30 flex-wrap">
                    <button
                        type="button"
                        onClick={generate}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-foreground text-background text-[12.5px] font-semibold hover:opacity-90 transition-opacity"
                        aria-label="Generate a new password"
                    >
                        <RefreshCw size={12} /> Regenerate
                    </button>
                    <CopyButton value={pwd} />
                    <button
                        type="button"
                        onClick={generateBatch}
                        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-card text-[12.5px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        aria-label="Generate five passwords at once"
                    >
                        <ListPlus size={12} /> Batch x5
                    </button>
                </div>
            </div>

            {bulk.length > 0 && (
                <div className="rounded-2xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                        <span>Batch · {bulk.length}</span>
                        <CopyButton value={bulk.join("\n")} />
                    </div>
                    <div className="divide-y divide-border">
                        {bulk.map((p, i) => (
                            <div key={i} className="flex items-center gap-3 px-4 py-2">
                                <span className="font-medium text-[11px] text-muted-foreground/60 w-5">{i + 1}</span>
                                <p className="font-mono text-[13px] text-foreground flex-1 break-all select-all">{p}</p>
                                <CopyButton value={p} />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Options panel */}
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                    Options
                </div>
                <div className="p-5 space-y-5">
                    {/* Length slider */}
                    <div>
                        <div className="flex items-center justify-between mb-2">
                            <label htmlFor="pw-len" className="font-medium text-[11.5px] text-muted-foreground">Length</label>
                            <span className="font-mono text-[13px] text-accent tabular-nums">{String(length).padStart(2, "0")}</span>
                        </div>
                        <input
                            id="pw-len"
                            type="range" min={4} max={64} step={1}
                            value={length}
                            onChange={e => setLength(parseInt(e.target.value, 10))}
                            className="w-full accent-[hsl(var(--accent))]"
                        />
                        <div className="mt-1 flex justify-between font-mono text-[9.5px] text-muted-foreground/85">
                            <span>04</span><span>16</span><span>32</span><span>64</span>
                        </div>
                    </div>

                    {/* Character sets */}
                    <div>
                        <p className="font-medium text-[11.5px] text-muted-foreground mb-2">Character sets</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {[
                                { label: "Uppercase A–Z", checked: upper, set: setUpper, hint: "ABC…" },
                                { label: "Lowercase a–z", checked: lower, set: setLower, hint: "abc…" },
                                { label: "Digits 0–9",    checked: digits, set: setDigits, hint: "0–9" },
                                { label: "Symbols",       checked: symbols, set: setSymbols, hint: "!@#$" },
                                { label: "Exclude ambiguous", checked: excludeAmbig, set: setExcludeAmbig, hint: "no l 1 I 0 O" },
                            ].map(opt => (
                                <label
                                    key={opt.label}
                                    className={cn(
                                        "group flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer transition-colors",
                                        opt.checked
                                            ? "border-accent/40 bg-accent/[0.06]"
                                            : "border-border hover:border-border-strong hover:bg-paper-2/30"
                                    )}
                                >
                                    <span className={cn(
                                        "h-4 w-4 rounded border flex items-center justify-center shrink-0",
                                        opt.checked
                                            ? "border-accent bg-accent"
                                            : "border-border-strong bg-card"
                                    )}>
                                        {opt.checked && <Check size={10} className="text-accent-foreground" strokeWidth={3} />}
                                    </span>
                                    <input
                                        type="checkbox"
                                        checked={opt.checked}
                                        onChange={e => opt.set(e.target.checked)}
                                        className="sr-only"
                                    />
                                    <span className="flex-1 text-[13px] text-foreground">{opt.label}</span>
                                    <span className="font-mono text-[10.5px] text-muted-foreground/85">{opt.hint}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── 2. UUID Generator ───────────────────────────────────────────────────

export function UuidGeneratorUI() {
    const [count, setCount] = useState(10);
    const [variant, setVariant] = useState<"v4" | "v7-like">("v4");
    const [list, setList] = useState<string[]>([]);

    const generate = useCallback(() => {
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
    }, [count, variant]);

    useEffect(() => { generate(); }, [generate]);

    return (
        <div className="space-y-4">
            <ClientToolBanner label="UUIDs are generated with crypto.randomUUID() in your browser." />

            {/* Options bar */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                    Options
                </div>
                <div className="p-4 flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                        <label htmlFor="uuid-count" className="font-medium text-[11.5px] text-muted-foreground">Count</label>
                        <input
                            id="uuid-count"
                            type="number" inputMode="numeric" min={1} max={500} value={count}
                            onChange={e => setCount(Math.max(1, Math.min(500, parseInt(e.target.value, 10) || 1)))}
                            className="w-20 h-8 px-2 rounded-md border border-border bg-card font-mono text-[13px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        <span className="font-medium text-[11.5px] text-muted-foreground">Variant</span>
                        <div role="tablist" aria-label="Variant" className="inline-flex rounded-md border border-border bg-paper-2/40 p-0.5">
                            {(["v4", "v7-like"] as const).map(v => {
                                const active = variant === v;
                                return (
                                    <button
                                        key={v}
                                        type="button"
                                        role="tab"
                                        aria-selected={active}
                                        onClick={() => setVariant(v)}
                                        className={cn(
                                            "inline-flex items-center h-7 px-2.5 text-[12px] font-medium rounded transition-colors",
                                            active ? "bg-card text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        {v}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={generate}
                        className="ml-auto inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-foreground text-background text-[12.5px] font-semibold hover:opacity-90 transition-opacity"
                    >
                        <RefreshCw size={12} /> Regenerate
                    </button>
                </div>
            </div>

            {/* Output console */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium flex items-center justify-between px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                    <span>Output · {list.length} UUID{list.length !== 1 ? "s" : ""}</span>
                    <CopyButton value={list.join("\n")} />
                </div>
                <pre className="font-mono text-[13px] text-foreground p-4 max-h-[60vh] overflow-y-auto leading-relaxed select-all">
                    {list.join("\n")}
                </pre>
            </div>
        </div>
    );
}

// ─── 3. Lorem Ipsum ──────────────────────────────────────────────────────

const LOREM_VARIANTS = {
    classic: {
        label: "Lorem",
        opener: "Lorem ipsum",
        words: "lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua enim ad minim veniam quis nostrud exercitation ullamco laboris nisi aliquip ex ea commodo consequat duis aute irure in reprehenderit voluptate velit esse cillum eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt culpa qui officia deserunt mollit anim id est laborum",
    },
    cyberpunk: {
        label: "Cyberpunk",
        opener: "Neon rain",
        words: "neon chrome circuit rain corp synth wire static glitch override mainframe ghost terminal data flux node burn jackin uplink ICE neural shard implant render augment grid blackmarket protocol firewall ROM RAM cyberdeck hacker megacorp dystopian hovercar holo skyline runner shadow nebula bio mod xenon kernel breach orbital matrix simulator construct corpotown wetware netrunner offline cipher scanner pulse driver console wave dataspike avatar siliconval rooftop bladerunner overdrive analog binary",
    },
    pirate: {
        label: "Pirate",
        opener: "Yarr matey",
        words: "ahoy matey scallywag treasure plunder doubloon parrot cutlass anchor rum mast scurvy yo ho ho captain quartermaster keelhaul broadside crow nest galleon brig schooner bilge swab jolly roger landlubber buccaneer corsair frigate cannon mutiny sail port starboard fathom seafarin chest gold silver coin reef wave horizon shore island compass map skull crossbones tankard yarr arr lass lubber salt spray storm thunder",
    },
    hacker: {
        label: "Hacker",
        opener: "Wake up",
        words: "kernel exploit zero day buffer overflow root shell pwn payload botnet phish recon nmap exfiltrate pivot lateral movement xss csrf injection sandbox jailbreak crypto hash collision rainbow rootkit malware ransomware backdoor honeypot tarpit fuzzer reverse engineer disassemble debug gdb segfault corefile heap stack canary aslr nopsled shellcode privilege escalation escalate elevate token forge stuxnet trojan worm signature heuristic ids ips siem soc analyst red team blue team purple",
    },
};

type LoremVariant = keyof typeof LOREM_VARIANTS;

export function LoremIpsumUI() {
    const [units, setUnits] = useState<"paragraphs" | "sentences" | "words">("paragraphs");
    const [count, setCount] = useState(5);
    const [startWithLorem, setStartWithLorem] = useState(true);
    const [variant, setVariant] = useState<LoremVariant>("classic");
    // tickle re-roll; bumping bumps useMemo deps to regenerate text
    const [reroll, setReroll] = useState(0);

    const text = useMemo(() => {
        // reroll is read so this regenerates on bump
        void reroll;
        const vocab = LOREM_VARIANTS[variant].words.split(" ");
        const opener = LOREM_VARIANTS[variant].opener;
        const rnd = (n: number) => Math.floor(Math.random() * n);
        const word = () => vocab[rnd(vocab.length)];
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
        if (startWithLorem && ps[0]) ps[0] = opener + " " + ps[0].slice(ps[0].indexOf(" ") + 1);
        return ps.join("\n\n");
    }, [units, count, startWithLorem, variant, reroll]);

    return (
        <div className="space-y-4">
            <ClientToolBanner label="Generated client-side — no external API." />

            {/* Options bar */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                    Options
                </div>
                <div className="p-4 flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                        <span className="font-medium text-[11.5px] text-muted-foreground">Units</span>
                        <div role="tablist" aria-label="Units" className="inline-flex rounded-md border border-border bg-paper-2/40 p-0.5">
                            {(["paragraphs", "sentences", "words"] as const).map(u => {
                                const active = units === u;
                                return (
                                    <button
                                        key={u}
                                        type="button"
                                        role="tab"
                                        aria-selected={active}
                                        onClick={() => setUnits(u)}
                                        className={cn(
                                            "inline-flex items-center h-7 px-2.5 text-[12px] font-medium rounded transition-colors capitalize",
                                            active ? "bg-card text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground"
                                        )}
                                    >
                                        {u}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <label htmlFor="lorem-count" className="font-medium text-[11.5px] text-muted-foreground">Count</label>
                        <input
                            id="lorem-count"
                            type="number" inputMode="numeric" min={1} max={100} value={count}
                            onChange={e => setCount(Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)))}
                            className="w-20 h-8 px-2 rounded-md border border-border bg-card font-mono text-[13px] text-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                        />
                    </div>
                    {units === "paragraphs" && (
                        <label className="flex items-center gap-2 text-[12.5px] text-foreground cursor-pointer">
                            <input type="checkbox" checked={startWithLorem} onChange={e => setStartWithLorem(e.target.checked)} className="accent-[hsl(var(--accent))]" />
                            Start with "{LOREM_VARIANTS[variant].opener}…"
                        </label>
                    )}
                    <div className="ml-auto flex items-center gap-1.5">
                        <button
                            type="button"
                            onClick={() => setReroll(r => r + 1)}
                            className="font-medium inline-flex items-center gap-1 px-2 h-7 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                            aria-label="Generate new text"
                        >
                            <RefreshCw size={11} /> Reroll
                        </button>
                        <CopyButton value={text} />
                    </div>
                </div>
                <div className="px-4 pb-3 -mt-1 flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-[11.5px] text-muted-foreground mr-1">Variant</span>
                    {(Object.keys(LOREM_VARIANTS) as LoremVariant[]).map(v => {
                        const active = variant === v;
                        return (
                            <button
                                key={v}
                                type="button"
                                onClick={() => setVariant(v)}
                                className={cn(
                                    "font-medium inline-flex items-center h-6 px-2 rounded-md text-[11.5px] border transition-colors",
                                    active ? "border-accent bg-accent/[0.08] text-accent" : "border-border text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                                )}
                            >
                                {LOREM_VARIANTS[v].label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Output */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                    Generated · {count} {units}
                </div>
                <textarea
                    readOnly
                    value={text}
                    className="block w-full h-[40vh] p-4 bg-transparent font-display text-[16px] leading-[1.7] text-foreground resize-none outline-none"
                    style={{ fontVariationSettings: '"opsz" 14' }}
                />
            </div>
        </div>
    );
}

// ─── 4. Word Counter ─────────────────────────────────────────────────────

// Common passive-voice marker words (English).
const PASSIVE_AUX = new Set(["am","is","are","was","were","be","been","being"]);
const PAST_PARTICIPLE_RE = /\w+(?:ed|en|ied|ought|aught|own|orn|ought)\b/i;

export function WordCounterUI() {
    const [text, setText] = useState("");
    const stats = useMemo(() => {
        const t = text;
        const words = (t.match(/\S+/g) || []).length;
        const chars = t.length;
        const charsNoSpace = t.replace(/\s/g, "").length;
        const sentenceMatches = t.match(/[^.!?\n]+[.!?]+/g) || [];
        const sentences = sentenceMatches.length;
        const paragraphs = t.trim() ? t.trim().split(/\n\s*\n/).length : 0;
        const lines = t === "" ? 0 : t.split("\n").length;
        const readingMin = Math.max(1, Math.round(words / 220));  // 220 wpm avg
        // Longest sentence (by words)
        let longestSentenceLen = 0;
        let passiveCount = 0;
        for (const s of sentenceMatches) {
            const ws = s.match(/\S+/g) || [];
            if (ws.length > longestSentenceLen) longestSentenceLen = ws.length;
            // crude passive detector: "be" verb followed within 3 words by a past participle
            for (let i = 0; i < ws.length - 1; i++) {
                const w = ws[i].toLowerCase().replace(/[^a-z]/g, "");
                if (PASSIVE_AUX.has(w)) {
                    for (let j = i + 1; j <= Math.min(i + 3, ws.length - 1); j++) {
                        if (PAST_PARTICIPLE_RE.test(ws[j])) { passiveCount++; break; }
                    }
                }
            }
        }
        const avgWordLen = words ? Math.round((charsNoSpace / words) * 10) / 10 : 0;
        return { words, chars, charsNoSpace, sentences, paragraphs, lines, readingMin, longestSentenceLen, passiveCount, avgWordLen };
    }, [text]);

    const loadSample = () => setText(
        "The quick brown fox jumps over the lazy dog. This is a sample paragraph for testing the word counter — paste your own text to see real numbers.\n\nA second paragraph follows. The proposal was reviewed by the committee, and several changes were suggested. Active sentences read more cleanly than passive ones."
    );

    return (
        <div className="space-y-4">
            <ClientToolBanner label="All counting happens in your browser — paste sensitive text without worry." />

            {/* Stats grid */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                    Stats
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 divide-x divide-border">
                    {[
                        { label: "Words",        value: stats.words.toLocaleString(),         unit: "" },
                        { label: "Characters",   value: stats.chars.toLocaleString(),         unit: "" },
                        { label: "No spaces",    value: stats.charsNoSpace.toLocaleString(),  unit: "" },
                        { label: "Sentences",    value: stats.sentences.toLocaleString(),     unit: "" },
                        { label: "Paragraphs",   value: stats.paragraphs.toLocaleString(),    unit: "" },
                        { label: "Lines",        value: stats.lines.toLocaleString(),         unit: "" },
                        { label: "Reading",      value: String(stats.readingMin),             unit: "min" },
                    ].map(s => (
                        <div key={s.label} className="p-4">
                            <p className="font-medium text-[9.5px] text-muted-foreground">{s.label}</p>
                            <p className="font-display text-[26px] text-foreground tracking-[-0.025em] mt-1 tabular-nums leading-none" style={{ fontVariationSettings: '"opsz" 144' }}>
                                {s.value}
                                {s.unit && <span className="font-mono text-[12px] text-muted-foreground ml-1">{s.unit}</span>}
                            </p>
                        </div>
                    ))}
                </div>
            </div>

            {/* Writing quality strip */}
            {text && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                        Writing quality
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
                        <div className="p-3">
                            <p className="font-medium text-[9.5px] text-muted-foreground">Avg word length</p>
                            <p className="font-mono text-[16px] text-foreground mt-1 tabular-nums">{stats.avgWordLen}</p>
                        </div>
                        <div className="p-3">
                            <p className="font-medium text-[9.5px] text-muted-foreground">Longest sentence</p>
                            <p className={cn(
                                "font-mono text-[16px] mt-1 tabular-nums",
                                stats.longestSentenceLen > 30 ? "text-copper" : "text-foreground"
                            )}>
                                {stats.longestSentenceLen} <span className="text-[11px] text-muted-foreground">words{stats.longestSentenceLen > 30 ? " — consider splitting" : ""}</span>
                            </p>
                        </div>
                        <div className="p-3">
                            <p className="font-medium text-[9.5px] text-muted-foreground">Passive voice (approx.)</p>
                            <p className={cn(
                                "font-mono text-[16px] mt-1 tabular-nums",
                                stats.passiveCount > 0 ? "text-copper" : "text-foreground"
                            )}>
                                {stats.passiveCount} <span className="text-[11px] text-muted-foreground">{stats.passiveCount === 1 ? "match" : "matches"}</span>
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* Text editor */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-3 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                    <span>Input</span>
                    <div className="flex items-center gap-2 normal-case tracking-normal">
                        {!text && (
                            <button
                                type="button"
                                onClick={loadSample}
                                className="font-medium inline-flex items-center gap-1 px-2 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 text-[11px] transition-colors"
                            >
                                <Sparkles size={10} /> Try sample
                            </button>
                        )}
                        {text && (
                            <>
                                <span className="font-medium text-[11.5px]">{stats.chars.toLocaleString()} char{stats.chars !== 1 ? "s" : ""}</span>
                                <button
                                    type="button"
                                    onClick={() => setText("")}
                                    className="font-medium inline-flex items-center gap-1 px-2 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 text-[11px] transition-colors"
                                    aria-label="Clear input"
                                >
                                    Clear
                                </button>
                            </>
                        )}
                    </div>
                </div>
                <textarea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    placeholder="Paste or type text here…"
                    className="block w-full h-[40vh] px-4 py-3 bg-transparent text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/50 resize-none outline-none"
                />
            </div>
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

/** Compute luminance for contrast ratio (WCAG). */
function luminance(r: number, g: number, b: number): number {
    const a = [r, g, b].map(v => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return a[0] * 0.2126 + a[1] * 0.7152 + a[2] * 0.0722;
}

export function ColorConverterUI() {
    const [hex, setHex] = useState("#0E8A56");
    const rgb = hexToRgb(hex);
    const hsl = rgb && rgbToHsl(rgb.r, rgb.g, rgb.b);

    // Compute contrast vs. white and black for WCAG hint
    const contrastWhite = rgb ? (1 + 0.05) / (luminance(rgb.r, rgb.g, rgb.b) + 0.05) : 1;
    const contrastBlack = rgb ? (luminance(rgb.r, rgb.g, rgb.b) + 0.05) / 0.05 : 1;
    const bestContrast = Math.max(contrastWhite, contrastBlack);
    const contrastLabel = bestContrast >= 7 ? "AAA" : bestContrast >= 4.5 ? "AA" : bestContrast >= 3 ? "AA Large" : "Fail";

    return (
        <div className="space-y-4">
            <ClientToolBanner label="Color math runs in your browser, instantly." />

            {/* Big swatch + input */}
            <div className="rounded-2xl border border-border bg-card overflow-hidden">
                <div className="grid grid-cols-1 sm:grid-cols-[200px_1fr]">
                    {/* Swatch */}
                    <div className="relative h-40 sm:h-auto sm:min-h-[180px]" style={{ background: hex }}>
                        <input
                            type="color"
                            value={hex}
                            onChange={e => setHex(e.target.value)}
                            className="absolute inset-0 opacity-0 cursor-pointer"
                            aria-label="Color picker"
                        />
                        <span className="font-medium absolute bottom-2 left-2 inline-flex items-center gap-1.5 px-2 py-1 rounded bg-background/80 backdrop-blur text-[11px] text-foreground">
                            Click to edit
                        </span>
                        {/* Contrast badge */}
                        <span
                            className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 h-6 rounded text-[11.5px] font-medium"
                            style={{
                                background: contrastWhite > contrastBlack ? "#fff" : "#000",
                                color: contrastWhite > contrastBlack ? "#000" : "#fff",
                            }}
                        >
                            {contrastLabel} · {bestContrast.toFixed(1)}:1
                        </span>
                    </div>
                    {/* Inputs */}
                    <div className="p-5 space-y-3">
                        <div>
                            <label className="font-medium text-[11.5px] text-muted-foreground">Hex</label>
                            <input
                                type="text"
                                value={hex}
                                onChange={e => setHex(e.target.value)}
                                className="mt-1 block w-full font-mono text-[16px] px-3 py-2 rounded-md border border-border bg-card text-foreground focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                spellCheck={false}
                                placeholder="#5E6AD2"
                            />
                        </div>
                        {rgb && (
                            <div className="grid grid-cols-3 gap-2">
                                {[
                                    { label: "R", value: rgb.r },
                                    { label: "G", value: rgb.g },
                                    { label: "B", value: rgb.b },
                                ].map(c => (
                                    <div key={c.label}>
                                        <p className="font-medium text-[11px] text-muted-foreground/85">{c.label}</p>
                                        <p className="font-mono text-[14px] text-foreground mt-0.5 tabular-nums">{c.value}</p>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {rgb && hsl ? (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                        All formats
                    </div>
                    <div className="divide-y divide-border">
                        {[
                            { label: "HEX",     value: hex.toUpperCase() },
                            { label: "RGB",     value: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` },
                            { label: "RGBA",    value: `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, 1)` },
                            { label: "HSL",     value: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` },
                            { label: "TAILWIND", value: `bg-[${hex.toLowerCase()}]` },
                            { label: "CSS VAR", value: `--brand: ${hex.toLowerCase()};` },
                        ].map(item => (
                            <div key={item.label} className="flex items-center gap-3 px-4 py-2.5">
                                <span className="font-medium text-[11px] text-accent w-16 shrink-0">{item.label}</span>
                                <p className="flex-1 font-mono text-[13px] text-foreground break-all select-all">{item.value}</p>
                                <CopyButton value={item.value} />
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />Invalid hex color
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

    // When the user is decoding and pastes a URL with query params, split them
    // into key/value pairs for a readable table.
    const queryPairs = useMemo<Array<[string, string]> | null>(() => {
        if (mode !== "decode" || !input.trim()) return null;
        const i = input.indexOf("?");
        const tail = i >= 0 ? input.slice(i + 1) : input;
        if (!tail.includes("=") && !tail.includes("&")) return null;
        const pairs: Array<[string, string]> = [];
        for (const piece of tail.split("&")) {
            if (!piece) continue;
            const eq = piece.indexOf("=");
            const k = eq >= 0 ? piece.slice(0, eq) : piece;
            const v = eq >= 0 ? piece.slice(eq + 1) : "";
            try { pairs.push([decodeURIComponent(k), decodeURIComponent(v)]); }
            catch { pairs.push([k, v]); }
        }
        return pairs.length > 0 ? pairs : null;
    }, [input, mode]);

    return (
        <div className="space-y-4">
            <ClientToolBanner label="URL/base64 conversion is pure JavaScript — your strings never leave your browser." />
            {/* Mode tabs */}
            <div role="tablist" aria-label="Encoder mode" className="inline-flex rounded-lg border border-border bg-paper-2/40 p-0.5">
                {(["encode", "decode", "jwt"] as const).map(m => {
                    const active = mode === m;
                    return (
                        <button
                            key={m}
                            role="tab"
                            type="button"
                            onClick={() => setMode(m)}
                            aria-selected={active}
                            className={cn(
                                "inline-flex items-center h-8 px-3.5 text-[13px] font-medium rounded transition-colors",
                                active ? "bg-card text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            {m === "encode" ? "URL encode" : m === "decode" ? "URL decode" : "JWT decode"}
                        </button>
                    );
                })}
            </div>
            {/* I/O panels */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-3 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                        <span>Input</span>
                        {input && <span>{input.length} char{input.length !== 1 ? "s" : ""}</span>}
                    </div>
                    <textarea
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        placeholder={mode === "jwt" ? "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature…" : "Paste text here…"}
                        spellCheck={false}
                        className="block w-full h-[40vh] p-4 bg-transparent font-mono text-[13px] text-foreground placeholder:text-muted-foreground/50 resize-none outline-none"
                    />
                </div>
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="px-3 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between">
                        <span className="font-medium text-[11.5px] text-muted-foreground">Output</span>
                        <CopyButton value={output} />
                    </div>
                    <pre className="w-full h-[40vh] p-4 bg-transparent font-mono text-[13px] text-foreground/90 overflow-auto whitespace-pre-wrap break-all">
                        {output || <span className="text-muted-foreground/50 italic">Output appears here…</span>}
                    </pre>
                </div>
            </div>
            {/* Query string table */}
            {queryPairs && queryPairs.length > 0 && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                        Query params · {queryPairs.length}
                    </div>
                    <div className="divide-y divide-border max-h-72 overflow-auto">
                        {queryPairs.map(([k, v], i) => (
                            <div key={i} className="grid grid-cols-[1fr_2fr_auto] items-center gap-3 px-4 py-2">
                                <span className="font-mono text-[12px] text-accent break-all">{k}</span>
                                <span className="font-mono text-[12px] text-foreground break-all">{v || <span className="italic text-muted-foreground">empty</span>}</span>
                                <CopyButton value={v} />
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

// ─── 7. JWT Decoder ──────────────────────────────────────────────────────

function b64urlDecode(input: string): string {
    const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
    return decodeURIComponent(
        atob(padded)
            .split("")
            .map(c => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
            .join("")
    );
}

export function JwtDecoderUI() {
    const [token, setToken] = useState("");
    const decoded = useMemo(() => {
        if (!token.trim()) return null;
        const parts = token.trim().split(".");
        if (parts.length !== 3) {
            return { error: "A JWT has three dot-separated parts (header.payload.signature)." };
        }
        try {
            const header = JSON.parse(b64urlDecode(parts[0]));
            const payload = JSON.parse(b64urlDecode(parts[1]));
            return { header, payload, signature: parts[2] };
        } catch (e: any) {
            return { error: `Could not parse: ${e.message || e}` };
        }
    }, [token]);

    const fmt = (v: unknown) => JSON.stringify(v, null, 2);
    const now = Math.floor(Date.now() / 1000);
    const claims = decoded && !("error" in decoded) ? decoded.payload as Record<string, unknown> : null;
    const exp = claims && typeof claims.exp === "number" ? (claims.exp as number) : null;
    const iat = claims && typeof claims.iat === "number" ? (claims.iat as number) : null;

    return (
        <div className="space-y-4">
            <ClientToolBanner label="JWT tokens never leave the browser — decoded locally with atob()." />
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-3 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                    <span>Token</span>
                    {token && <span>{token.length} char{token.length !== 1 ? "s" : ""}</span>}
                </div>
                <textarea
                    value={token}
                    onChange={e => setToken(e.target.value)}
                    placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.signature…"
                    spellCheck={false}
                    className="block w-full h-28 p-3 bg-transparent font-mono text-[13px] text-foreground placeholder:text-muted-foreground/50 resize-none outline-none break-all"
                />
            </div>
            {decoded && "error" in decoded && (
                <div className="rounded-lg border border-copper/30 bg-copper-soft/40 px-3 py-2.5 flex items-start gap-2 text-[13px] text-foreground">
                    <AlertCircle size={13} className="text-copper mt-px shrink-0" />
                    <p>{decoded.error}</p>
                </div>
            )}
            {decoded && !("error" in decoded) && (
                <>
                    {/* Metadata strip */}
                    {(exp !== null || iat !== null) && (
                        <div className="rounded-xl border border-border bg-card overflow-hidden">
                            <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                                Claims
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-border">
                                {iat !== null && (
                                    <div className="p-4">
                                        <p className="font-medium text-[11px] text-muted-foreground">Issued</p>
                                        <p className="font-mono text-[13px] text-foreground mt-1">{new Date(iat * 1000).toISOString()}</p>
                                    </div>
                                )}
                                {exp !== null && (
                                    <div className="p-4">
                                        <p className="font-medium text-[11px] text-muted-foreground">Expires</p>
                                        <p className="font-mono text-[13px] text-foreground mt-1">{new Date(exp * 1000).toISOString()}</p>
                                    </div>
                                )}
                                {exp !== null && (
                                    <div className="p-4">
                                        <p className="font-medium text-[11px] text-muted-foreground">Status</p>
                                        <p className={cn(
                                            "font-mono text-[13px] mt-1 font-medium",
                                            exp > now ? "text-accent" : "text-destructive"
                                        )}>
                                            {exp > now
                                                ? `Valid · expires in ${formatRelative(exp - now)}`
                                                : `Expired · ${formatRelative(now - exp)} ago`}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    {/* Header + Payload panels */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                        <JwtPanel label="Header" value={fmt(decoded.header)} />
                        <JwtPanel label="Payload" value={fmt(decoded.payload)} />
                    </div>
                    {/* Signature */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-paper-2/40">
                            <span className="font-medium text-[11.5px] text-muted-foreground">Signature · not verified</span>
                            <CopyButton value={decoded.signature} />
                        </div>
                        <pre className="px-3 py-3 font-mono text-[12px] text-muted-foreground overflow-auto break-all whitespace-pre-wrap">{decoded.signature}</pre>
                    </div>
                </>
            )}
        </div>
    );
}

// ─── 8. Regex Tester ─────────────────────────────────────────────────────

export function RegexTesterUI() {
    const [pattern, setPattern] = useState("");
    const [flags, setFlags] = useState("g");
    const [text, setText] = useState("");
    const result = useMemo(() => {
        if (!pattern) return { kind: "idle" as const };
        try {
            const re = new RegExp(pattern, flags);
            const matches: { match: string; index: number; groups: string[] }[] = [];
            if (flags.includes("g")) {
                for (const m of text.matchAll(re)) {
                    matches.push({ match: m[0], index: m.index ?? 0, groups: m.slice(1) });
                }
            } else {
                const m = re.exec(text);
                if (m) matches.push({ match: m[0], index: m.index, groups: m.slice(1) });
            }
            return { kind: "ok" as const, matches };
        } catch (e: any) {
            return { kind: "err" as const, error: e.message || String(e) };
        }
    }, [pattern, flags, text]);

    const highlighted = useMemo(() => {
        if (result.kind !== "ok" || result.matches.length === 0) return text;
        const parts: (string | { match: string })[] = [];
        let cursor = 0;
        for (const m of result.matches) {
            if (m.index > cursor) parts.push(text.slice(cursor, m.index));
            parts.push({ match: m.match });
            cursor = m.index + m.match.length;
        }
        if (cursor < text.length) parts.push(text.slice(cursor));
        return parts;
    }, [result, text]);

    return (
        <div className="space-y-4">
            <ClientToolBanner label="JavaScript RegExp running in your browser — patterns and text never leave." />

            {/* Pattern + flags — code-editor feel */}
            <div className="rounded-xl border border-border bg-card overflow-hidden font-mono">
                <div className="px-3 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[10.5px] text-muted-foreground">
                    <span>Pattern</span>
                    <span>{result.kind === "ok" ? `${result.matches.length} match${result.matches.length !== 1 ? "es" : ""}` : result.kind === "err" ? "invalid" : ""}</span>
                </div>
                <div className="flex items-center px-3 py-2 gap-1 text-[14px] text-foreground">
                    <span className="text-muted-foreground select-none">/</span>
                    <input
                        value={pattern}
                        onChange={e => setPattern(e.target.value)}
                        placeholder={String.raw`\d{3}-\d{3}-\d{4}`}
                        className="flex-1 bg-transparent outline-none text-foreground placeholder:text-muted-foreground/50"
                        spellCheck={false}
                    />
                    <span className="text-muted-foreground select-none">/</span>
                    <input
                        value={flags}
                        onChange={e => setFlags(e.target.value.toLowerCase().replace(/[^gimsuy]/g, ""))}
                        placeholder="gim"
                        className="w-16 bg-transparent outline-none text-accent placeholder:text-muted-foreground/40"
                        spellCheck={false}
                        aria-label="Flags"
                    />
                </div>
            </div>

            {/* Test string */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-3 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                    <span>Test string</span>
                    <div className="flex items-center gap-2 normal-case tracking-normal">
                        {!pattern && !text && (
                            <button
                                type="button"
                                onClick={() => {
                                    setPattern(String.raw`\b(\w+)@(\w+\.\w+)\b`);
                                    setFlags("g");
                                    setText("Contact alice@example.com or bob@test.io for details. Internal: ops@privatools.app.");
                                }}
                                className="font-medium inline-flex items-center gap-1 px-2 h-6 rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 text-[11px] transition-colors"
                            >
                                <Sparkles size={10} /> Try sample
                            </button>
                        )}
                        {text && <span className="font-medium text-[11.5px]">{text.length} char{text.length !== 1 ? "s" : ""}</span>}
                    </div>
                </div>
                <textarea
                    value={text}
                    onChange={e => setText(e.target.value)}
                    placeholder="Paste the text to test against…"
                    className="block w-full h-40 px-3 py-3 font-mono text-[13px] text-foreground placeholder:text-muted-foreground/50 bg-transparent outline-none resize-none"
                    spellCheck={false}
                />
            </div>

            {/* Result */}
            {result.kind === "err" && (
                <div className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 flex items-start gap-2">
                    <AlertCircle size={13} className="text-destructive mt-px shrink-0" />
                    <p className="font-mono text-[12.5px] text-destructive">{result.error}</p>
                </div>
            )}
            {result.kind === "ok" && (
                <>
                    {/* Highlighted matches */}
                    <div className="rounded-xl border border-accent/30 bg-card overflow-hidden">
                        <div className="font-medium px-3 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-accent">
                            {result.matches.length} match{result.matches.length === 1 ? "" : "es"}
                        </div>
                        <div className="px-3 py-3 font-mono text-[13px] text-foreground whitespace-pre-wrap break-words leading-relaxed">
                            {typeof highlighted === "string" ? (
                                highlighted || <span className="italic text-muted-foreground">Type a pattern and a test string</span>
                            ) : (
                                highlighted.map((p, i) =>
                                    typeof p === "string"
                                        ? <span key={i}>{p}</span>
                                        : <mark key={i} className="bg-accent/30 rounded px-0.5 text-foreground">{p.match}</mark>
                                )
                            )}
                        </div>
                    </div>

                    {/* Match details */}
                    {result.matches.length > 0 && (
                        <div className="rounded-xl border border-border bg-card overflow-hidden">
                            <div className="font-medium px-3 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                                Match details
                            </div>
                            <div className="divide-y divide-border max-h-60 overflow-auto">
                                {result.matches.map((m, i) => (
                                    <div key={i} className="flex items-baseline gap-3 px-3 py-2 font-mono text-[12px]">
                                        <span className="text-accent tracking-wider shrink-0 w-10">[{String(i).padStart(2, "0")}]</span>
                                        <span className="text-muted-foreground shrink-0">@{m.index}</span>
                                        <span className="text-foreground break-all">"{m.match}"</span>
                                        {m.groups.length > 0 && (
                                            <span className="text-muted-foreground/85 break-all"> · groups: [{m.groups.map(g => JSON.stringify(g)).join(", ")}]</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

// ─── 9. Timestamp Converter ──────────────────────────────────────────────

export function TimestampConverterUI() {
    const [input, setInput] = useState(String(Math.floor(Date.now() / 1000)));
    const parsed = useMemo(() => {
        const s = input.trim();
        if (!s) return null;
        // Numeric: detect seconds vs milliseconds heuristically
        if (/^-?\d+$/.test(s)) {
            const n = Number(s);
            // If 10 digits or fewer → seconds; 13 → ms
            const ms = Math.abs(n) > 1e12 ? n : n * 1000;
            const d = new Date(ms);
            if (isNaN(d.getTime())) return { error: "Number out of range for a date" };
            return { d, source: Math.abs(n) > 1e12 ? "ms" : "seconds" };
        }
        // Otherwise treat as ISO 8601 / parseable string
        const d = new Date(s);
        if (isNaN(d.getTime())) return { error: "Could not parse as a date" };
        return { d, source: "iso" };
    }, [input]);

    const setNow = () => setInput(String(Math.floor(Date.now() / 1000)));

    return (
        <div className="space-y-4">
            <ClientToolBanner label="Parsing happens in your browser. No data is transmitted." />

            {/* Input */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-3 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                    <span>Epoch (s/ms) or ISO 8601</span>
                    <button
                        type="button"
                        onClick={setNow}
                        className="font-medium inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                    >
                        <RefreshCw size={10} /> Now
                    </button>
                </div>
                <input
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    placeholder="1704067200 or 2024-01-01T00:00:00Z"
                    spellCheck={false}
                    className="block w-full px-3 py-3 bg-transparent font-mono text-[15px] text-foreground placeholder:text-muted-foreground/50 outline-none"
                />
            </div>

            {parsed && "error" in parsed && (
                <div className="flex items-center gap-2 rounded-lg border border-copper/30 bg-copper-soft/40 px-3 py-2.5 text-[13px] text-foreground">
                    <AlertCircle size={13} className="text-copper shrink-0" />{parsed.error}
                </div>
            )}

            {parsed && !("error" in parsed) && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                        <span>Conversions</span>
                        <span>Detected: <span className="text-accent">{parsed.source}</span></span>
                    </div>
                    <div className="divide-y divide-border">
                        {[
                            ["Unix seconds",      String(Math.floor(parsed.d.getTime() / 1000))],
                            ["Unix milliseconds", String(parsed.d.getTime())],
                            ["ISO 8601 (UTC)",    parsed.d.toISOString()],
                            ["UTC string",        parsed.d.toUTCString()],
                            ["Local string",      parsed.d.toString()],
                            ["Relative",          relTime(parsed.d.getTime() - Date.now())],
                        ].map(([k, v]) => (
                            <div key={k} className="flex items-center gap-3 px-4 py-2.5">
                                <span className="font-medium text-[11px] text-accent w-36 shrink-0">{k}</span>
                                <span className="font-mono text-[13px] text-foreground flex-1 truncate select-all">{v}</span>
                                <CopyButton value={String(v)} />
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

function relTime(ms: number): string {
    const abs = Math.abs(ms);
    const future = ms >= 0;
    const units: [number, string][] = [
        [60_000, "second"],
        [3_600_000, "minute"],
        [86_400_000, "hour"],
        [86_400_000 * 30, "day"],
        [86_400_000 * 365, "month"],
        [Infinity, "year"],
    ];
    let value = 0, unit = "second";
    let last = 1000;
    for (const [limit, name] of units) {
        if (abs < limit) {
            value = Math.round(abs / last);
            unit = name;
            break;
        }
        last = limit;
    }
    return `${future ? "in " : ""}${value} ${unit}${value === 1 ? "" : "s"}${future ? "" : " ago"}`;
}

// ─── 10. YAML ↔ JSON Converter ───────────────────────────────────────────

// Minimal YAML ⇄ JSON converter — handles the common subset of YAML used in
// configs (scalars, lists, nested objects, quoted strings, comments). It is
// NOT a full YAML 1.2 parser (no anchors, tags, multi-doc streams) — those
// are rare in practice and the UI banner is honest about the scope.
function jsonToYaml(value: unknown, indent = 0): string {
    const pad = "  ".repeat(indent);
    if (value === null || value === undefined) return "null";
    if (typeof value === "string") {
        if (value === "" || /^[\s"'#&*!|>%@`,[\]{}:?-]/.test(value) || /[:#\n]/.test(value)) {
            return JSON.stringify(value);
        }
        return value;
    }
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    if (Array.isArray(value)) {
        if (value.length === 0) return "[]";
        return value.map(item => {
            const rendered = jsonToYaml(item, indent + 1);
            if (rendered.includes("\n")) {
                return `${pad}-\n${rendered}`;
            }
            return `${pad}- ${rendered}`;
        }).join("\n");
    }
    if (typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>);
        if (entries.length === 0) return "{}";
        return entries.map(([k, v]) => {
            const key = /^[A-Za-z_][\w-]*$/.test(k) ? k : JSON.stringify(k);
            const rendered = jsonToYaml(v, indent + 1);
            if (typeof v === "object" && v !== null && Object.keys(v as object).length > 0) {
                return `${pad}${key}:\n${rendered}`;
            }
            return `${pad}${key}: ${rendered}`;
        }).join("\n");
    }
    return String(value);
}

function yamlToJsonObject(text: string): unknown {
    // Strip BOM + trailing whitespace
    const lines = text.replace(/^\ufeff/, "").split(/\r?\n/);
    // Remove document marker and trailing markers
    const cleaned: { indent: number; raw: string }[] = [];
    for (const raw of lines) {
        if (raw.trim() === "" || raw.trim().startsWith("#")) continue;
        if (raw.trim() === "---" || raw.trim() === "...") continue;
        const noComment = raw.replace(/(\s+#.*)$/, "");
        const indent = noComment.match(/^ */)![0].length;
        cleaned.push({ indent, raw: noComment.slice(indent) });
    }
    if (cleaned.length === 0) return null;

    let i = 0;
    function parseScalar(s: string): unknown {
        const v = s.trim();
        if (v === "" || v === "~" || v === "null") return null;
        if (v === "true") return true;
        if (v === "false") return false;
        if (/^-?\d+$/.test(v)) return Number(v);
        if (/^-?\d+\.\d+$/.test(v)) return Number(v);
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
            try { return JSON.parse(v.replace(/^'(.*)'$/s, '"$1"')); } catch { return v.slice(1, -1); }
        }
        if (v.startsWith("[") && v.endsWith("]")) {
            try { return JSON.parse(v); } catch { /* fall through */ }
        }
        if (v.startsWith("{") && v.endsWith("}")) {
            try { return JSON.parse(v); } catch { /* fall through */ }
        }
        return v;
    }
    function parseNode(baseIndent: number): unknown {
        if (i >= cleaned.length) return null;
        const first = cleaned[i];
        if (first.indent < baseIndent) return null;
        // List
        if (first.raw.startsWith("- ") || first.raw === "-") {
            const arr: unknown[] = [];
            while (i < cleaned.length && cleaned[i].indent === first.indent && (cleaned[i].raw === "-" || cleaned[i].raw.startsWith("- "))) {
                const r = cleaned[i].raw;
                if (r === "-") {
                    i++;
                    arr.push(parseNode(first.indent + 2));
                } else {
                    const after = r.slice(2);
                    if (after.includes(": ") || after.endsWith(":")) {
                        // inline map item — rewrite as nested map starting here
                        cleaned[i] = { indent: first.indent + 2, raw: after };
                        arr.push(parseNode(first.indent + 2));
                    } else {
                        arr.push(parseScalar(after));
                        i++;
                    }
                }
            }
            return arr;
        }
        // Map
        const obj: Record<string, unknown> = {};
        while (i < cleaned.length && cleaned[i].indent === first.indent) {
            const r = cleaned[i].raw;
            const colon = r.indexOf(":");
            if (colon === -1) break;
            const key = r.slice(0, colon).trim().replace(/^["'](.*)["']$/, "$1");
            const rest = r.slice(colon + 1).trim();
            i++;
            if (rest === "") {
                obj[key] = parseNode(first.indent + 2);
            } else {
                obj[key] = parseScalar(rest);
            }
        }
        return obj;
    }
    return parseNode(0);
}

export function YamlToJsonConverterUI() {
    return <YamlJsonConverterUI reverse={false} />;
}
export function JsonToYamlConverterUI() {
    return <YamlJsonConverterUI reverse={true} />;
}
function YamlJsonConverterUI({ reverse = false }: { reverse?: boolean } = {}) {
    const initial = reverse
        ? '{\n  "name": "privatools",\n  "version": "1.4.0",\n  "tools": ["pdf", "image", "video"]\n}'
        : "name: privatools\nversion: 1.4.0\ntools:\n  - pdf\n  - image\n  - video\n";
    const [input, setInput] = useState(initial);
    const result = useMemo(() => {
        const text = input.trim();
        if (!text) return { ok: true as const, out: "" };
        try {
            if (reverse) {
                const obj = JSON.parse(text);
                return { ok: true as const, out: jsonToYaml(obj) };
            }
            const obj = yamlToJsonObject(text);
            return { ok: true as const, out: JSON.stringify(obj, null, 2) };
        } catch (e) {
            return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
        }
    }, [input, reverse]);

    const fromLabel = reverse ? "JSON input" : "YAML input";
    const toLabel = reverse ? "YAML output" : "JSON output";

    return (
        <div className="space-y-5">
            <ClientToolBanner label="Parsing happens entirely in your browser — no upload, no server." />
            <div className="grid md:grid-cols-2 gap-4">
                <div>
                    <label className="text-[11px] font-semibold text-muted-foreground" htmlFor="yamljson-input">{fromLabel}</label>
                    <textarea
                        id="yamljson-input"
                        aria-label={fromLabel}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        spellCheck={false}
                        className="mt-1.5 w-full h-72 px-4 py-3 rounded-xl border border-border bg-card font-mono text-[12.5px] text-foreground focus:outline-none focus:border-accent resize-none"
                    />
                </div>
                <div>
                    <div className="flex items-center justify-between">
                        <label className="text-[11px] font-semibold text-muted-foreground">{toLabel}</label>
                        {result.ok && result.out && <CopyButton value={result.out} />}
                    </div>
                    {result.ok ? (
                        <pre className="mt-1.5 w-full h-72 px-4 py-3 rounded-xl border border-border bg-card font-mono text-[12.5px] text-foreground overflow-auto whitespace-pre">{result.out}</pre>
                    ) : (
                        <div className="mt-1.5 rounded-xl border border-copper/30 bg-amber-500/[0.06] px-4 py-3 flex items-start gap-3 h-72">
                            <AlertCircle size={14} className="text-copper mt-0.5 shrink-0" />
                            <p className="text-[13px] text-foreground font-mono">{result.error}</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── 11. Case Converter ──────────────────────────────────────────────────

function caseTransforms(text: string) {
    const words = text
        .replace(/[_-]+/g, " ")
        .replace(/([a-z])([A-Z])/g, "$1 $2")
        .replace(/\s+/g, " ")
        .trim()
        .split(" ")
        .filter(Boolean);
    const lower = words.map(w => w.toLowerCase());
    return {
        lower: text.toLowerCase(),
        upper: text.toUpperCase(),
        title: text.replace(/\w\S*/g, t => t[0].toUpperCase() + t.slice(1).toLowerCase()),
        sentence: text.charAt(0).toUpperCase() + text.slice(1).toLowerCase(),
        camel: lower.map((w, i) => i === 0 ? w : w[0].toUpperCase() + w.slice(1)).join(""),
        pascal: lower.map(w => w[0].toUpperCase() + w.slice(1)).join(""),
        snake: lower.join("_"),
        kebab: lower.join("-"),
        constant: lower.join("_").toUpperCase(),
        dot: lower.join("."),
        path: lower.join("/"),
        inverse: text.split("").map(c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join(""),
    };
}

export function CaseConverterUI() {
    const [input, setInput] = useState("PrivaTools File Converter");
    const [preserveLines, setPreserveLines] = useState(true);

    // For multi-line input we transform each line independently and rejoin so
    // structure is preserved.
    const cases = useMemo(() => {
        if (!preserveLines || !input.includes("\n")) return caseTransforms(input);
        const lines = input.split("\n");
        const perLine = lines.map(l => caseTransforms(l));
        const join = (key: keyof ReturnType<typeof caseTransforms>) =>
            perLine.map(p => p[key]).join("\n");
        return {
            lower: join("lower"),
            upper: join("upper"),
            title: join("title"),
            sentence: join("sentence"),
            camel: join("camel"),
            pascal: join("pascal"),
            snake: join("snake"),
            kebab: join("kebab"),
            constant: join("constant"),
            dot: join("dot"),
            path: join("path"),
            inverse: join("inverse"),
        };
    }, [input, preserveLines]);
    const rows: [string, string][] = [
        ["lower case", cases.lower],
        ["UPPER CASE", cases.upper],
        ["Title Case", cases.title],
        ["Sentence case", cases.sentence],
        ["camelCase", cases.camel],
        ["PascalCase", cases.pascal],
        ["snake_case", cases.snake],
        ["kebab-case", cases.kebab],
        ["CONSTANT_CASE", cases.constant],
        ["dot.case", cases.dot],
        ["path/case", cases.path],
        ["iNVERSE", cases.inverse],
    ];
    const hasMultiline = input.includes("\n");
    return (
        <div className="space-y-4">
            <ClientToolBanner label="Conversion runs locally — your text never leaves the browser." />

            {/* Input */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-3 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                    <span>Input</span>
                    {hasMultiline && (
                        <label className="inline-flex items-center gap-1.5 cursor-pointer normal-case tracking-normal">
                            <input
                                type="checkbox"
                                checked={preserveLines}
                                onChange={e => setPreserveLines(e.target.checked)}
                                className="accent-[hsl(var(--accent))]"
                            />
                            <span className="text-foreground">Preserve line breaks</span>
                        </label>
                    )}
                </div>
                <textarea
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    spellCheck={false}
                    placeholder="Type or paste any string…"
                    className="block w-full h-24 px-3 py-3 bg-transparent font-mono text-[14px] text-foreground placeholder:text-muted-foreground/50 resize-none outline-none"
                />
            </div>

            {/* All variants as a list */}
            <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                    Variants · {rows.length}
                </div>
                <div className="divide-y divide-border">
                    {rows.map(([label, value]) => (
                        <div key={label} className="flex items-start gap-3 px-4 py-2.5">
                            <span className="font-medium text-[11px] text-accent w-32 shrink-0 mt-0.5">{label}</span>
                            <pre className={cn(
                                "font-mono text-[13px] text-foreground flex-1 select-all break-all",
                                value.includes("\n") ? "whitespace-pre-wrap" : "truncate"
                            )}>{value || <span className="italic text-muted-foreground">empty</span>}</pre>
                            <CopyButton value={value} />
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

// ─── Shared helpers used by multiple tools ────────────────────────────

function JwtPanel({ label, value }: { label: string; value: string }) {
    return (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-paper-2/40">
                <span className="font-medium text-[11.5px] text-muted-foreground">{label}</span>
                <CopyButton value={value} />
            </div>
            <pre className="px-3 py-3 font-mono text-[12px] text-foreground/90 overflow-auto max-h-72 leading-relaxed">{value}</pre>
        </div>
    );
}

function formatRelative(seconds: number): string {
    const abs = Math.abs(seconds);
    if (abs < 60)      return `${Math.round(abs)}s`;
    if (abs < 3600)    return `${Math.round(abs / 60)}m`;
    if (abs < 86400)   return `${Math.round(abs / 3600)}h`;
    if (abs < 604800)  return `${Math.round(abs / 86400)}d`;
    return `${Math.round(abs / 604800)}w`;
}
