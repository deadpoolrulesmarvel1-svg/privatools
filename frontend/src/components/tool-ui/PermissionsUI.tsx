/**
 * PermissionsUI — set owner-password + per-action permission flags.
 * Owner password input + 4 permission toggles.
 * Multi-file via useMultiFileProcessor — the same policy is applied to every PDF.
 *
 * Downloads are named client-side ({stem}_permissions.pdf): the backend sends a
 * generic "permissions.pdf" Content-Disposition, which would collide across a
 * batch, so we bypass the hook's downloadAll and zip with our own names.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, EyeOff, Lock } from "lucide-react";
import { downloadBlob } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { useMultiFileProcessor, type FileEntry } from "@/hooks/useMultiFileProcessor";
import { VaultPasswordPicker } from "@/components/VaultPasswordPicker";
import { FileIntake, StudioActionBar, StudioLayout, StudioProgress } from "@/skins/experience/ToolStudio";
import { ProcessorFiles, ProcessorResult } from "@/skins/experience/ProcessorStudio";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { downloadStarted } from "@/skins/experience/studio-outcome";
import { fileCount } from "@/skins/experience/file-format-label";

const PERMS = [
    { key: "allow_print",    label: "Printing",       desc: "Users can print the document" },
    { key: "allow_copy",     label: "Copy text",      desc: "Allow text selection & copy" },
    { key: "allow_modify",   label: "Modify",         desc: "Allow content edits" },
    { key: "allow_annotate", label: "Annotate",       desc: "Add notes & highlights" },
] as const;

const outName = (e: FileEntry) => e.name.replace(/\.pdf$/i, "_permissions.pdf");
const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

export function PermissionsUI() {
    const proc = useMultiFileProcessor();
    const [ownerPassword, setOwnerPassword] = useState("");
    const [showPw, setShowPw] = useState(false);
    const [permissions, setPermissions] = useState({
        allow_print: true, allow_copy: true, allow_modify: false, allow_annotate: true,
    });
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    // Back from a result, focus returns to the intake rather than the page top.
    const [returning, setReturning] = useState(false);
    const pwRef = useRef<HTMLInputElement>(null);

    const hasFiles = proc.entries.length > 0;
    useEffect(() => {
        if (hasFiles) pwRef.current?.focus();
    }, [hasFiles]);

    const toggle = (key: string) => setPermissions(p => ({ ...p, [key]: !p[key as keyof typeof p] }));
    const canProcess = proc.entries.length > 0 && status !== "processing";

    const process = useCallback(async (retry: boolean | "transient" = false) => {
        setStatus("processing");
        await proc.run({
            endpoint: "/set-permissions",
            outputSuffix: "permissions",
            outputExt: "pdf",
            params: { owner_password: ownerPassword || "", ...permissions },
        }, retry);
        setStatus("done");
    }, [proc, ownerPassword, permissions]);

    // The server names every result "permissions.pdf", so build the download
    // (single blob or ZIP) ourselves from the original filenames.
    const downloadResults = useCallback(() => {
        const done = proc.entries.filter(e => e.status === "done" && e.blob);
        if (done.length === 0) return;
        if (done.length === 1) {
            downloadBlob(done[0].blob!, outName(done[0]));
            return;
        }
        void (async () => {
            const items = await Promise.all(done.map(async e => ({
                name: outName(e),
                data: new Uint8Array(await e.blob!.arrayBuffer()),
            })));
            downloadBlob(buildZip(items), "archive_permissions.zip");
        })();
    }, [proc.entries]);

    useDownloadOnce(status === "done", proc.doneCount, downloadResults);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) {
                e.preventDefault();
                void process(false);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [canProcess, process]);

    if (status === "done") {
        const startOver = (files?: File[]) => {
            proc.reset();
            if (files) proc.addFiles(files, isPdfOnly);
            setReturning(true); setStatus("idle");
        };
        return <ProcessorResult proc={proc} verb="updated" accepts=".pdf"
            title={proc.doneCount > 1 ? `Document policy applied to ${proc.doneCount} PDFs.` : "Document policy applied."}
            detail={downloadStarted(proc.doneCount)}
            onDownload={downloadResults} onRetry={() => void process("transient")}
            onStartOver={startOver} more="Set another" />;
    }

    const busy = status === "processing";
    return <StudioLayout options={<>
        <div className="ts-setting">
            <label htmlFor="permissions-owner">Owner password</label>
            <div className="ts-password">
                <input id="permissions-owner" ref={pwRef} type={showPw ? "text" : "password"} value={ownerPassword} disabled={busy}
                    onChange={e => setOwnerPassword(e.target.value)} placeholder="Required to change permissions later" autoComplete="new-password" aria-describedby="permissions-owner-hint" />
                <div className="ts-password-actions">
                    <button type="button" className="ts-icon-button" onClick={() => setShowPw(!showPw)} aria-label={showPw ? "Hide password" : "Show password"} aria-pressed={showPw}>
                        {showPw ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                </div>
            </div>
            <p className="ts-caption" id="permissions-owner-hint">Blank = default owner password</p>
            {/* Owner passwords cannot be trialled — pdf.js opens an
                owner-protected file with an empty user password, so it
                can't verify one. Autofill only. */}
            <VaultPasswordPicker onPick={setOwnerPassword} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]" />
        </div>
        <div>
            <h2>Allowed actions</h2>
            <div className="ts-choices" role="group" aria-label="PDF permissions">
                {PERMS.map(p => <button type="button" className="ts-choice" key={p.key} aria-pressed={permissions[p.key]} disabled={busy} onClick={() => toggle(p.key)}>
                    <strong>{p.label}</strong><span>{p.desc}</span>
                </button>)}
            </div>
        </div>
    </>} action={<StudioActionBar ready={proc.entries.length > 0} count={proc.entries.length ? fileCount(proc.entries.length, "PDF") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void process(false)} disabled={!canProcess}><Lock size={16} aria-hidden="true" /> Set permissions{proc.entries.length > 1 ? ` — ${proc.entries.length} files` : ""}</button>
    </StudioActionBar>}>
        <FileIntake accepts=".pdf" multiple title="Drop PDFs to set permissions" detail="Owner password + action gates · same policy applied to all · several files become a ZIP"
            compact={proc.entries.length > 0} disabled={busy} autoFocus={returning} onFiles={files => proc.addFiles(files, isPdfOnly)} />
        <ProcessorFiles proc={proc} busy={busy} label="Selected PDFs" />
        {busy && <StudioProgress label="Setting the permissions" detail={`${proc.doneCount} of ${proc.entries.length} files completed`} />}
    </StudioLayout>;
}
