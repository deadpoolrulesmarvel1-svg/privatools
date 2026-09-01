/**
 * ProtectUI — apply password + permission flags to one or more PDFs.
 * Workshop: signal-green dropzone, vault-style password panel with strength meter,
 * 3 permission switches, multi-file queue via useMultiFileProcessor.
 * Batch semantic: every file in the queue gets the SAME password.
 */
import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { Loader2, CheckCircle2, AlertCircle, Eye, EyeOff, Shield, LockKeyhole, RotateCcw, Sparkles, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { VaultPasswordPicker } from "@/components/VaultPasswordPicker";
import { SavePasswordPrompt } from "@/components/SavePasswordPrompt";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";

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
    const proc = useMultiFileProcessor();
    const [password, setPassword] = useState("");
    const [showPw, setShowPw] = useState(false);

    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const [justGenerated, setJustGenerated] = useState(false);
    const ref = useRef<HTMLInputElement>(null);
    const pwRef = useRef<HTMLInputElement>(null);

    const strength = useMemo(() => getStrength(password), [password]);
    const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

    // Auto-focus password field once a file is queued
    useEffect(() => {
        if (proc.entries.length > 0 && !password) pwRef.current?.focus();
    }, [proc.entries.length, password]);

    const canProcess = proc.entries.length > 0 && !!password && phase !== "processing";

    const process = useCallback(async (retry = false) => {
        if (!password) return;
        setPhase("processing");
        await proc.run({
            endpoint: "/protect",
            outputSuffix: "protected",
            outputExt: "pdf",
            params: { password, allow_print: allowPrint, allow_extract: allowExtract, allow_modify: allowModify },
        }, retry);
        setPhase("done");
    }, [proc, password, allowPrint, allowExtract, allowModify]);

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (phase === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            proc.downloadAll("archive_protected");
        }
    }, [phase, proc]);

    const handleGenerate = useCallback(() => {
        const pw = generatePassword();
        setPassword(pw);
        setShowPw(true);
        setJustGenerated(true);
        window.setTimeout(() => setJustGenerated(false), 1800);
    }, []);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); void process(false); }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);

    if (phase === "done") return (
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
                            <span className="italic text-accent">{proc.doneCount}</span> file{proc.doneCount !== 1 && "s"} protected{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}
                        </h2>
                        {proc.doneCount > 0 && (
                            <p className="font-mono text-[11px] tracking-[0.04em] text-muted-foreground mt-1">
                                {proc.doneCount > 1 ? "ZIP downloaded · every file opens with the same password" : "PDF downloaded"}
                            </p>
                        )}
                        {/* You just encrypted a document — this is the moment
                            you most want the password remembered. */}
                        {password && proc.doneCount > 0 && (
                            <div className="mt-5">
                                <SavePasswordPrompt
                                    password={password}
                                    suggestedLabel={proc.entries[0]?.name.replace(/\.pdf$/i, "") ?? ""}
                                />
                            </div>
                        )}
                        <div className="mt-5 flex flex-wrap gap-2">
                            {proc.doneCount > 0 && (
                                <button
                                    onClick={() => proc.downloadAll("archive_protected")}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90"
                                >
                                    <Download size={13} /> Download {proc.doneCount > 1 ? "ZIP" : "again"}
                                </button>
                            )}
                            {proc.failedCount > 0 && (
                                <button
                                    onClick={() => { downloadedRef.current = false; void process(true); }}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-copper bg-copper-soft/40 text-[13px] font-medium text-foreground hover:bg-copper-soft/60 transition-colors"
                                >
                                    Retry {proc.failedCount} failed
                                </button>
                            )}
                            <button
                                onClick={() => { proc.reset(); setPhase("idle"); setPassword(""); downloadedRef.current = false; }}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                            >
                                <RotateCcw size={12} /> Protect more
                            </button>
                        </div>
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
                onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) proc.addFiles(e.dataTransfer.files, isPdfOnly); }}
                onClick={() => ref.current?.click()}
                onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ref.current?.click(); } }}
                role="button"
                tabIndex={0}
                aria-label="Upload PDFs"
                className={cn(
                    "dropzone-surface relative flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-colors py-12 sm:py-14 px-6 text-center group",
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]"
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept=".pdf" multiple className="hidden" onChange={e => { if (e.target.files) proc.addFiles(e.target.files, isPdfOnly); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    <LockKeyhole size={20} className="text-accent" strokeWidth={1.75} />
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">{proc.entries.length ? "Add more files" : "Select PDFs to protect"}</p>
                <p className="font-medium text-[11.5px] text-muted-foreground">Multiple files · password + permissions · max {MAX_FILE_SIZE_LABEL}</p>
            </div>

            {proc.entries.length > 0 && (
                <>
                    <MultiFileQueue
                        entries={proc.entries}
                        reorderable={false}
                        onRemove={proc.removeFile}
                        onReorder={proc.reorder}
                        onClearAll={proc.clearAll}
                        onRetryFailed={() => { downloadedRef.current = false; void process(true); }}
                        busy={phase === "processing"}
                    />

                    {/* Password panel */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                            <span>Password</span>
                            <span className={cn(
                                strength.tone === "danger" && "text-destructive",
                                strength.tone === "warn" && "text-copper",
                                strength.tone === "accent" && "text-accent",
                                strength.tone === "muted" && "text-muted-foreground",
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
                                    className="w-full rounded-md border border-border bg-card px-3 py-2.5 pr-20 font-mono text-[14px] text-foreground placeholder:text-muted-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
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
                                <p className="font-medium text-[11px] text-accent animate-fade-in">
                                    Strong password generated · save it somewhere safe
                                </p>
                            )}
                            {!justGenerated && proc.entries.length > 1 && (
                                <p className="font-medium text-[11px] text-muted-foreground">
                                    Every file gets this password.
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Permissions */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                            Permissions
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
                                    <p className="font-medium text-[11px] text-muted-foreground mt-1">{p.desc}</p>
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button onClick={() => void process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {phase === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Protecting… ({proc.doneCount}/{proc.entries.length})</>
                                : <><LockKeyhole size={13} /> Protect {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "PDF"}</>}
                        </button>
                        {canProcess && <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>}
                        {proc.entries.length > 0 && !password && phase !== "processing" && (
                            <span className="font-medium text-[11.5px] text-muted-foreground inline-flex items-center gap-1">
                                <AlertCircle size={11} /> Set a password first
                            </span>
                        )}
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
