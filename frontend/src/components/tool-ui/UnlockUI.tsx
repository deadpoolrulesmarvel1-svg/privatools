/**
 * UnlockUI — remove password protection from one or more PDFs, on the shared
 * kit: the intake and the chosen files, the password in the options, the run
 * button in the action bar, and the kit's result. Every file goes in one
 * request with one password, so a run unlocks the whole set or nothing, and
 * its one result (a PDF, or a ZIP for several) downloads by itself once.
 */
import { useState, useRef, useEffect, useCallback } from "react";
import { Download, Eye, EyeOff, LockOpen } from "lucide-react";
import { friendlyError } from "@/lib/utils";
import { processFilesAndDownload, downloadBlob, formatFileSize, buildOutputFilename, MAX_FILE_SIZE_LABEL } from "@/lib/api";
import { emitToolRun } from "@/lib/toolRun";
import { usePdfPasswordTrial } from "@/hooks/usePdfPasswordTrial";
import { VaultTrialBanner } from "@/components/VaultTrialBanner";
import { SavePasswordPrompt } from "@/components/SavePasswordPrompt";
import { FileIntake, StudioActionBar, StudioActions, StudioFile, StudioLayout, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { downloadAgainLabel, downloadStarted, runFailure, runFailureDetail, type RunFailure } from "@/skins/experience/studio-outcome";
import { focusIfIdle } from "@/skins/experience/focus-result";
import { fileCount } from "@/skins/experience/file-format-label";

type UnlockFile = { id: string; raw: File };
let fileId = 0;

export function UnlockUI() {
    const [files, setFiles] = useState<UnlockFile[]>([]);
    const [password, setPassword] = useState("");
    const [showPw, setShowPw] = useState(false);
    const [phase, setPhase] = useState<"idle" | "processing" | "done">("idle");
    const [failure, setFailure] = useState<RunFailure | null>(null);
    // What the run downloaded, for "Download again" (the download policy).
    const [downloaded, setDownloaded] = useState<{ blob: Blob; filename: string } | null>(null);
    // Back from a result: to the intake, to the password, or, with different files, to the run button.
    const [returning, setReturning] = useState<"intake" | "password" | "run" | null>(null);
    const pwRef = useRef<HTMLInputElement>(null);
    const runButton = useRef<HTMLButtonElement>(null);

    // Try saved passwords locally (pdf.js) before asking the user. Only a
    // password that actually works is ever sent to /unlock — wrong candidates
    // never leave the browser.
    const { state: trial, run: runTrial, reset: resetTrial } = usePdfPasswordTrial();
    // Password the user typed themselves, so we only offer to save a password
    // that wasn't already in the vault.
    const [typedPassword, setTypedPassword] = useState("");

    // Trial against the first file only: this tool applies one password to
    // the whole batch, so that's the one that matters.
    const trySaved = (first: File) => {
        void runTrial(first).then(result => {
            if (result.status === "unlocked") {
                setPassword(result.password);
                setTypedPassword("");
            }
        });
    };
    const addFiles = (accepted: File[]) => {
        // The intake has named any file that isn't a PDF, with the tool that takes it.
        const next: UnlockFile[] = accepted.map(f => ({ id: String(++fileId), raw: f }));
        if (!next.length) return;
        setFiles(prev => [...prev, ...next]);
        setPhase("idle");
        setFailure(null);
        if (files.length === 0) trySaved(next[0].raw);
    };
    const removeFile = (id: string) => setFiles(prev => prev.filter(f => f.id !== id));
    const canProcess = files.length > 0 && !!password && phase !== "processing";

    // Once the first file is chosen, the password is what the tool needs next.
    const hasFiles = files.length > 0;
    useEffect(() => {
        if (hasFiles && !password && phase === "idle") pwRef.current?.focus();
        // Only when the first files arrive, not on every keystroke.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [hasFiles]);

    const process = useCallback(async () => {
        if (!files.length || !password) return;
        setPhase("processing"); setFailure(null);
        try {
            const outExt = files.length === 1 ? "pdf" : "zip";
            const outName = buildOutputFilename(files[0]?.raw.name, "unlocked", outExt);
            // The download policy: the result downloads by itself, once per run.
            const out = await processFilesAndDownload("/unlock", files.map(f => f.raw), outName, { password });
            setDownloaded(out ?? null);
            setPhase("done");
            emitToolRun({ outcome: "success", files: files.length });
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Unlock failed";
            setDownloaded(null);
            setFailure(runFailure(e, friendlyError(msg, "Couldn't unlock that PDF. The password may be wrong.")));
            setPhase("done");
            emitToolRun({ outcome: "error", files: files.length }, e);
        }
    }, [files, password]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);

    // Back with the files: focus the password that may need changing, or the run button.
    useEffect(() => {
        if (phase !== "idle") return;
        if (returning === "password") {
            focusIfIdle(pwRef.current);
            if (document.activeElement === pwRef.current) pwRef.current?.select();
        }
        if (returning === "run") focusIfIdle(runButton.current);
    }, [phase, returning]);

    const startOver = (chosen?: File[]) => {
        setDownloaded(null); setFailure(null);
        resetTrial();
        if (chosen?.length) {
            // A different file after a failure keeps the password typed for it,
            // unless a saved password opens it.
            setFiles(chosen.map(f => ({ id: String(++fileId), raw: f })));
            trySaved(chosen[0]);
            setReturning("run");
        } else {
            setFiles([]); setPassword(""); setTypedPassword("");
            setReturning("intake");
        }
        setPhase("idle");
    };
    const backToPassword = () => { setDownloaded(null); setFailure(null); setReturning("password"); setPhase("idle"); };

    const several = files.length > 1;
    if (phase === "done" && failure) {
        // One request unlocks the whole set or nothing, so its failure is the set's.
        return <StudioResult tone="failure" title={several ? "None of these PDFs could be unlocked." : "This PDF couldn’t be unlocked."} detail={runFailureDetail(failure)}>
            <StudioFile name={several ? `${files.length} PDFs, uploaded together` : files[0]?.raw.name ?? "Your PDF"} status="error" detail={failure.message} />
            <StudioActions tone="failure" retryCount={failure.retryable ? 1 : 0} onRetry={() => void process()}
                choose={{ accepts: ".pdf", multiple: true, label: several ? "Choose different files" : "Choose a different file", onFiles: chosen => startOver(chosen) }}
                more={<button type="button" className="ts-text-button" onClick={backToPassword}>Try another password</button>} />
        </StudioResult>;
    }

    if (phase === "done" && downloaded) {
        return <StudioResult title={several ? `${files.length} PDFs unlocked.` : "Your PDF is unlocked."} detail={downloadStarted(files.length)}>
            {/* Offer to save only a password the user typed AND that we just
                proved works. A password that came from the vault is already saved. */}
            {typedPassword && <SavePasswordPrompt password={typedPassword} suggestedLabel={files[0]?.raw.name.replace(/\.pdf$/i, "") ?? ""} />}
            <StudioFile name={downloaded.filename} status="done" detail={formatFileSize(downloaded.blob.size)} />
            <StudioActions tone="success"
                primary={<button type="button" className="ts-primary-button" onClick={() => downloadBlob(downloaded.blob, downloaded.filename)}><Download size={16} aria-hidden="true" /> {downloadAgainLabel(files.length)}</button>}
                more={<button type="button" className="ts-text-button" onClick={() => startOver()}>Unlock more</button>} />
        </StudioResult>;
    }

    const busy = phase === "processing";
    return <StudioLayout options={<>
        {/* What the saved passwords did for the chosen PDFs; nothing once none is chosen. */}
        {files.length > 0 && <VaultTrialBanner state={trial} />}
        <div className="ts-setting">
            <label htmlFor="unlock-password">Document password</label>
            <div className="ts-password">
                <input id="unlock-password" ref={pwRef} type={showPw ? "text" : "password"} value={password} disabled={busy}
                    onChange={e => { setPassword(e.target.value); setTypedPassword(e.target.value); }}
                    placeholder="Enter the existing password" autoComplete="current-password" />
                <div className="ts-password-actions">
                    <button type="button" className="ts-icon-button" onClick={() => setShowPw(!showPw)} aria-label={showPw ? "Hide password" : "Show password"} aria-pressed={showPw}>
                        {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                </div>
            </div>
            <p className="ts-caption">{several ? `Same password applied to all ${files.length} files.` : "Sent with the PDF when you unlock it, and used only to unlock it."}</p>
        </div>
    </>} action={<StudioActionBar ready={files.length > 0} count={files.length ? fileCount(files.length, "PDF") : undefined}>
        <button type="button" ref={runButton} className="ts-primary-button" onClick={process} disabled={!canProcess}><LockOpen size={16} aria-hidden="true" /> Unlock {several ? `${files.length} PDFs` : "PDF"}</button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Select protected PDFs" detail={`Multiple files · single password · max ${MAX_FILE_SIZE_LABEL} in total`}
            compact={files.length > 0} disabled={busy} autoFocus={returning === "intake"} onFiles={addFiles} />
        {files.length > 0 && <section aria-label="Selected PDFs">
            {files.map(f => <StudioFile key={f.id} name={f.raw.name} detail={formatFileSize(f.raw.size)} onRemove={busy ? undefined : () => removeFile(f.id)} />)}
            {several && !busy && <button type="button" className="ts-text-button" onClick={() => setFiles([])}>Clear selection</button>}
        </section>}
        {busy && <StudioProgress label={several ? `Unlocking ${files.length} PDFs` : "Unlocking your PDF"} />}
    </StudioLayout>;
}
