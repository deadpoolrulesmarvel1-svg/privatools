/**
 * ProtectUI — apply password + permission flags to one or more PDFs.
 * Workshop: signal-green dropzone, vault-style password panel with strength meter,
 * 3 permission switches, multi-file queue.
 */
import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { Loader2, CheckCircle2, X, FileText, AlertCircle, Eye, EyeOff, Shield, LockKeyhole, RotateCcw, Sparkles } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { processFilesAndDownload, formatFileSize, buildOutputFilename, MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { VaultPasswordPicker } from "@/components/VaultPasswordPicker";
import { SavePasswordPrompt } from "@/components/SavePasswordPrompt";
import { useToolDefaults } from "@/hooks/useToolDefaults";

type ProtectFile = { id: string; name: string; size: string; raw: File };
let fileId = 0;

function getStrength(pw: string) {
    if (!pw) return { level: "—", pct: 0, tone: "muted", score: 0 } as const;
    let score = 0;
    if (pw.length >= 8) score++;
    if (pw.length >= 12) score++;
    if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
    if (/\d/.test(pw)) score++;
    if (/[^A-Za-z0-9]/.test(pw)) score++;
    if (score <= 2) return { level: "Weak", pct: 33, tone: "danger", score } as const;
    if (score <= 3) return { level: "Medium", pct: 66, tone: "warn", score } as const;
    return { level: "Strong", pct: 100, tone: "accent", score } as const;
}

/** Cryptographically random 18-char passphrase mixing ULSD + symbols. */
function generatePassword(): string {
    const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
    const lower = "abcdefghijkmnopqrstuvwxyz";
    const digit = "23456789";
    const symbol = "!@#$%^&*-_=+?";
    const all = upper + lower + digit + symbol;
    const len = 18;
    const out: string[] = [];
    const arr = new Uint32Array(len + 4);
    crypto.getRandomValues(arr);
    // Guarantee at least one from each class
    out.push(upper[arr[0] % upper.length]);
    out.push(lower[arr[1] % lower.length]);
    out.push(digit[arr[2] % digit.length]);
    out.push(symbol[arr[3] % symbol.length]);
    for (let i = 4; i < len; i++) out.push(all[arr[i] % all.length]);
    // Fisher-Yates shuffle with crypto entropy
    const shuf = new Uint32Array(len);
    crypto.getRandomValues(shuf);
    for (let i = out.length - 1; i > 0; i--) {
        const j = shuf[i] % (i + 1);
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out.join("");
}

function humanizeError(raw: string | undefined): string {
    if (!raw) return "Protection failed — please try again";
    const lower = raw.toLowerCase();
    if (lower.includes("size") || lower.includes("too large")) return "PDF is too large — try compressing it first";
    if (lower.includes("encrypted") || lower.includes("already")) return "PDF is already password-protected — unlock it first";
    if (lower.includes("network") || lower.includes("fetch")) return "Network hiccup — check your connection and retry";
    return raw;
}

const PROTECT_DEFAULTS: { allowPrint: boolean; allowExtract: boolean; allowModify: boolean } = {
    allowPrint: true,
    allowExtract: false,
    allowModify: false,
};

export function ProtectUI() {
    const [config, , { setField }] = useToolDefaults("protect-pdf", PROTECT_DEFAULTS);
    const { allowPrint, allowExtract, allowModify } = config;
    const setAllowPrint = useCallback((v: React.SetStateAction<typeof PROTECT_DEFAULTS["allowPrint"]>) => setField("allowPrint", v), [setField]);
    const setAllowExtract = useCallback((v: React.SetStateAction<typeof PROTECT_DEFAULTS["allowExtract"]>) => setField("allowExtract", v), [setField]);
    const setAllowModify = useCallback((v: React.SetStateAction<typeof PROTECT_DEFAULTS["allowModify"]>) => setField("allowModify", v), [setField]);
    const [files, setFiles] = useState<ProtectFile[]>([]);
    const [password, setPassword] = useState("");
    const [showPw, setShowPw] = useState(false);

    const [state, setState] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [drag, setDrag] = useState(false);
    const [justGenerated, setJustGenerated] = useState(false);
    const ref = useRef<HTMLInputElement>(null);
    const pwRef = useRef<HTMLInputElement>(null);

    const strength = useMemo(() => getStrength(password), [password]);

    // Auto-focus password field once a file is queued
    useEffect(() => {
        if (files.length > 0 && !password) pwRef.current?.focus();
    }, [files.length, password]);

    const addFiles = (fl: FileList) => {
        const next: ProtectFile[] = Array.from(fl)
            .filter(f => f.name.toLowerCase().endsWith(".pdf"))
            .map(f => ({ id: String(++fileId), name: f.name, size: formatFileSize(f.size), raw: f }));
        if (next.length) { setFiles(prev => [...prev, ...next]); setState("idle"); setError(null); }
    };
    const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));
    const canProcess = files.length > 0 && !!password && state !== "processing";

    const process = useCallback(async () => {
        if (!files.length || !password) return;
        setState("processing"); setError(null);
        try {
            const outExt = files.length === 1 ? "pdf" : "zip";
            const outName = buildOutputFilename(files[0]?.raw.name, "protected", outExt);
            await processFilesAndDownload("/protect", files.map(f => f.raw), outName, {
                password, allow_print: allowPrint, allow_extract: allowExtract, allow_modify: allowModify,
            });
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Protection failed";
            setError(friendlyError(msg, "Couldn't password-protect that PDF."));
            setState("idle");
        }
    }, [files, password, allowPrint, allowExtract, allowModify]);

    const handleGenerate = useCallback(() => {
        const pw = generatePassword();
        setPassword(pw);
        setShowPw(true);
        setJustGenerated(true);
        window.setTimeout(() => setJustGenerated(false), 1800);
    }, []);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);

    if (state === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Locked</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{files.length}</span> file{files.length !== 1 && "s"} protected
                        </h2>
                        {/* You just encrypted a document — this is the moment
                            you most want the password remembered. */}
                        {password && (
                            <div className="mt-5">
                                <SavePasswordPrompt
                                    password={password}
                                    suggestedLabel={files[0]?.name.replace(/\.pdf$/i, "") ?? ""}
                                />
                            </div>
                        )}
                        <button
                            onClick={() => { setFiles([]); setState("idle"); setPassword(""); }}
                            className="mt-5 inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                        >
                            <RotateCcw size={12} /> Protect more
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <div
                onDragOver={e => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button"
                tabIndex={0}
                aria-label="Upload PDFs"
                className={cn(
                    "relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept=".pdf" multiple className="hidden" onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    <LockKeyhole size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">{files.length ? "Add more PDFs" : "Select PDFs to protect"}</p>
                <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground">Multiple files · password + permissions · max {MAX_FILE_SIZE_LABEL}</p>
            </div>

            {files.length > 0 && (
                <>
                    <div className="space-y-2">
                        {files.map((f, i) => (
                            <div key={f.id} className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3">
                                <span className="font-mono text-[10px] tracking-wider text-muted-foreground/70 w-6 text-right shrink-0">{String(i + 1).padStart(2, "0")}</span>
                                <div className="h-10 w-10 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                                    <FileText size={15} className="text-accent" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="text-[14px] font-medium text-foreground truncate">{f.name}</p>
                                    <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-muted-foreground mt-0.5">{f.size}</p>
                                </div>
                                <button onClick={() => removeFile(f.id)} className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60" aria-label="Remove">
                                    <X size={13} />
                                </button>
                            </div>
                        ))}
                    </div>

                    {/* Password panel */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span><span className="text-accent">§</span> Password</span>
                            <span className={cn(
                                strength.tone === "danger" && "text-destructive",
                                strength.tone === "warn" && "text-copper",
                                strength.tone === "accent" && "text-accent",
                                strength.tone === "muted" && "text-muted-foreground/60",
                            )}>{strength.level}</span>
                        </div>
                        <div className="p-4 space-y-3">
                            <div className="relative">
                                <input
                                    ref={pwRef}
                                    type={showPw ? "text" : "password"}
                                    value={password} onChange={e => setPassword(e.target.value)}
                                    placeholder="Choose a strong password"
                                    autoComplete="new-password"
                                    className="w-full rounded-md border border-border bg-card px-3 py-2.5 pr-20 font-mono text-[14px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                />
                                <div className="absolute right-1.5 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
                                    <button
                                        type="button"
                                        onClick={handleGenerate}
                                        className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-accent hover:bg-secondary/60"
                                        aria-label="Generate a strong password"
                                        title="Generate strong password"
                                    >
                                        <Sparkles size={13} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => setShowPw(!showPw)}
                                        className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                                        aria-label={showPw ? "Hide password" : "Show password"}
                                        aria-pressed={showPw}
                                    >
                                        {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                                    </button>
                                </div>
                            </div>
                            {/* Reuse a password already in the vault. Protect SETS a
                                password rather than verifying one, so this is autofill,
                                not a trial. */}
                            <VaultPasswordPicker onPick={setPassword} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]" />

                            {/* Strength meter — 5 cells */}
                            <div
                                className="grid grid-cols-5 gap-1"
                                role="meter"
                                aria-label="Password strength"
                                aria-valuenow={strength.pct}
                                aria-valuemin={0}
                                aria-valuemax={100}
                                aria-valuetext={strength.level}
                            >
                                {[0, 1, 2, 3, 4].map(i => {
                                    const filled = strength.pct >= ((i + 1) * 20);
                                    return (
                                        <div
                                            key={i}
                                            className={cn(
                                                "h-1 rounded-full transition-colors",
                                                filled
                                                    ? strength.tone === "danger" ? "bg-destructive"
                                                    : strength.tone === "warn" ? "bg-copper"
                                                    : "bg-accent"
                                                    : "bg-border"
                                            )}
                                        />
                                    );
                                })}
                            </div>
                            {justGenerated && (
                                <p className="font-mono text-[10px] tracking-[0.04em] uppercase text-accent animate-fade-in">
                                    <span>§</span> Strong password generated · save it somewhere safe
                                </p>
                            )}
                            {!justGenerated && files.length > 1 && (
                                <p className="font-mono text-[10px] tracking-[0.04em] uppercase text-muted-foreground/85">
                                    <span className="text-accent">§</span> Same password applied to all {files.length} files
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Permissions */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span className="text-accent">§</span> Permissions
                        </div>
                        <div className="p-4 grid grid-cols-1 sm:grid-cols-3 gap-2">
                            {([
                                { id: "print", label: "Print", desc: "Recipients can print", checked: allowPrint, set: setAllowPrint },
                                { id: "extract", label: "Extract", desc: "Allow copy & extract", checked: allowExtract, set: setAllowExtract },
                                { id: "modify", label: "Modify", desc: "Allow editing", checked: allowModify, set: setAllowModify },
                            ] as const).map(p => (
                                <button
                                    key={p.id}
                                    onClick={() => p.set(!p.checked)}
                                    className={cn(
                                        "rounded-lg border p-3 text-left transition-colors",
                                        p.checked ? "border-accent bg-accent/[0.06]" : "border-border hover:border-border-strong hover:bg-secondary/40"
                                    )}
                                >
                                    <div className="flex items-center justify-between gap-2">
                                        <p className="font-display text-[13.5px] font-semibold text-foreground tracking-[-0.015em]">{p.label}</p>
                                        <span className={cn(
                                            "h-4 w-4 rounded border flex items-center justify-center shrink-0 transition-colors",
                                            p.checked ? "bg-accent border-accent text-background" : "border-border"
                                        )}>
                                            {p.checked && <Shield size={9} strokeWidth={2.5} />}
                                        </span>
                                    </div>
                                    <p className="font-mono text-[10px] tracking-[0.04em] uppercase text-muted-foreground/85 mt-1">{p.desc}</p>
                                </button>
                            ))}
                        </div>
                    </div>

                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                            <AlertCircle size={13} className="shrink-0" />{error}
                        </div>
                    )}

                    <div className="flex items-center gap-3">
                        <button onClick={process} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {state === "processing" ? <><Loader2 size={13} className="animate-spin" /> Protecting…</> : <><LockKeyhole size={13} /> Protect {files.length > 1 ? `${files.length} PDFs` : "PDF"}</>}
                        </button>
                        {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground/80 bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
                    </div>
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
