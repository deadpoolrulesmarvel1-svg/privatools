/**
 * ProtectUI — apply password + permission flags to one or more PDFs.
 * Password panel with a strength meter, 3 permission switches, multi-file
 * queue via useMultiFileProcessor.
 * Batch semantic: every file in the queue gets the SAME password.
 */
import { useState, useRef, useMemo, useEffect, useCallback } from "react";
import { Eye, EyeOff, LockKeyhole, Sparkles } from "lucide-react";
import { MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { VaultPasswordPicker } from "@/components/VaultPasswordPicker";
import { SavePasswordPrompt } from "@/components/SavePasswordPrompt";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { useMultiFileProcessor } from "@/hooks/useMultiFileProcessor";
import { FileIntake, StudioActionBar, StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { downloadStarted } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

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

const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

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
    const [justGenerated, setJustGenerated] = useState(false);
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);
    const pwRef = useRef<HTMLInputElement>(null);

    const strength = useMemo(() => getStrength(password), [password]);

    // Auto-focus password field once a file is queued
    useEffect(() => {
        if (proc.entries.length > 0 && !password) pwRef.current?.focus();
    }, [proc.entries.length, password]);

    const canProcess = proc.entries.length > 0 && !!password && phase !== "processing";

    const process = useCallback(async (retry: boolean | "transient" = false) => {
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

    useDownloadOnce(phase === "done", proc.doneCount, () => proc.downloadAll("archive_protected"));

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

    if (phase === "done") {
        const startOver = (files?: File[]) => {
            proc.reset();
            // "Protect more" starts clean; a different file after a failure keeps the password.
            if (files) proc.addFiles(files, isPdfOnly); else setPassword("");
            setReturning(true); setPhase("idle");
        };
        return <ProcessorResult proc={proc} verb="protected" accepts=".pdf"
            title={proc.doneCount > 1 ? `${proc.doneCount} PDFs protected.` : "Your PDF is protected."}
            detail={proc.doneCount > 1 ? `${downloadStarted(proc.doneCount)} Every file opens with the same password.` : downloadStarted(proc.doneCount)}
            // You just encrypted a document — this is the moment you most want the password remembered.
            receipt={password && <SavePasswordPrompt password={password} suggestedLabel={proc.entries[0]?.name.replace(/\.pdf$/i, "") ?? ""} />}
            onDownload={() => proc.downloadAll("archive_protected")} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Protect more" />;
    }

    const busy = phase === "processing";
    const permissions = [
        { id: "print", label: "Print", desc: "Recipients can print", checked: allowPrint, set: setAllowPrint },
        { id: "extract", label: "Extract", desc: "Allow copy & extract", checked: allowExtract, set: setAllowExtract },
        { id: "modify", label: "Modify", desc: "Allow editing", checked: allowModify, set: setAllowModify },
    ] as const;
    return <StudioLayout options={<>
        <div className="ts-setting">
            <div className="ts-label-row"><label htmlFor="protect-password">Password</label><span className="ts-strength" data-tone={strength.tone}>{strength.level}</span></div>
            <div className="ts-password" style={{ "--ts-password-actions": 2 } as React.CSSProperties}>
                <input id="protect-password" ref={pwRef} type={showPw ? "text" : "password"} value={password} disabled={busy}
                    onChange={e => setPassword(e.target.value)} placeholder="Choose a strong password" autoComplete="new-password" />
                <div className="ts-password-actions">
                    <button type="button" className="ts-icon-button" onClick={handleGenerate} aria-label="Generate a strong password" title="Generate strong password"><Sparkles size={15} /></button>
                    <button type="button" className="ts-icon-button" onClick={() => setShowPw(!showPw)} aria-label={showPw ? "Hide password" : "Show password"} aria-pressed={showPw}>{showPw ? <EyeOff size={15} /> : <Eye size={15} />}</button>
                </div>
            </div>
            {/* Reuse a password already in the vault. Protect SETS a
                password rather than verifying one, so this is autofill,
                not a trial. */}
            <VaultPasswordPicker onPick={setPassword} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]" />
            {/* Strength meter — 5 cells */}
            <div className="ts-strength-meter" role="meter" aria-label="Password strength" aria-valuenow={strength.pct} aria-valuemin={0} aria-valuemax={100} aria-valuetext={strength.level} data-tone={strength.tone}>
                {[0, 1, 2, 3, 4].map(i => <i key={i} data-filled={strength.pct >= (i + 1) * 20} />)}
            </div>
            {justGenerated && <p className="ts-caption">Strong password generated · save it somewhere safe</p>}
            {!justGenerated && proc.entries.length > 1 && <p className="ts-caption">Every file gets this password.</p>}
            {proc.entries.length > 0 && !password && !busy && <p className="ts-caption">Set a password first.</p>}
        </div>
        <div>
            <h2>Permissions</h2>
            <div className="ts-choices">{permissions.map(p => <button type="button" className="ts-choice" key={p.id} aria-pressed={p.checked} disabled={busy} onClick={() => p.set(!p.checked)}>
                <strong>{p.label}</strong><span>{p.desc}</span>
            </button>)}</div>
        </div>
    </>} action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}><LockKeyhole size={16} aria-hidden="true" /> Protect {proc.entries.length > 1 ? `${proc.entries.length} PDFs` : "PDF"}</button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Select PDFs to protect" detail={`Multiple files · password + permissions · max ${MAX_FILE_SIZE_LABEL}`}
            compact={proc.entries.length > 0} disabled={busy} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdfOnly)} />
        <ProcessorFiles proc={proc} busy={busy} label="Selected PDFs" />
        {busy && <StudioProgress label="Locking your PDF" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}
