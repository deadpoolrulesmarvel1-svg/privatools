/**
 * PermissionsUI — set owner-password + per-action permission flags.
 * Workshop: owner password input + 4 permission cards with check/cross icons.
 * Multi-file via useMultiFileProcessor — the same policy is applied to every PDF.
 *
 * Downloads are named client-side ({stem}_permissions.pdf): the backend sends a
 * generic "permissions.pdf" Content-Disposition, which would collide across a
 * batch, so we bypass the hook's downloadAll and zip with our own names.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, AlertCircle, Shield, Eye, EyeOff, CheckCircle2, RotateCcw, Lock, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadBlob } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { useMultiFileProcessor, type FileEntry } from "@/hooks/useMultiFileProcessor";
import { MultiFileQueue } from "./MultiFileQueue";
import { VaultPasswordPicker } from "@/components/VaultPasswordPicker";

const PERMS = [
    { key: "allow_print",    label: "Printing",       desc: "Users can print the document" },
    { key: "allow_copy",     label: "Copy text",      desc: "Allow text selection & copy" },
    { key: "allow_modify",   label: "Modify",         desc: "Allow content edits" },
    { key: "allow_annotate", label: "Annotate",       desc: "Add notes & highlights" },
] as const;

const outName = (e: FileEntry) => e.name.replace(/\.pdf$/i, "_permissions.pdf");

export function PermissionsUI() {
    const proc = useMultiFileProcessor();
    const [ownerPassword, setOwnerPassword] = useState("");
    const [showPw, setShowPw] = useState(false);
    const [permissions, setPermissions] = useState({
        allow_print: true, allow_copy: true, allow_modify: false, allow_annotate: true,
    });
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [drag, setDrag] = useState(false);
    const ref = useRef<HTMLInputElement>(null);
    const pwRef = useRef<HTMLInputElement>(null);

    const hasFiles = proc.entries.length > 0;
    useEffect(() => {
        if (hasFiles) pwRef.current?.focus();
    }, [hasFiles]);

    const toggle = (key: string) => setPermissions(p => ({ ...p, [key]: !p[key as keyof typeof p] }));

    const canProcess = proc.entries.length > 0 && status !== "processing";
    const isPdfOnly = (f: File) => f.name.toLowerCase().endsWith(".pdf");

    const process = useCallback(async (retry = false) => {
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

    const downloadedRef = useRef(false);
    useEffect(() => {
        if (status === "done" && !downloadedRef.current && proc.doneCount > 0) {
            downloadedRef.current = true;
            downloadResults();
        }
    }, [status, proc.doneCount, downloadResults]);

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
        const isMulti = proc.entries.length > 1;
        return (
            <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
                <div className="relative p-7 sm:p-9 animate-corner-extend">
                    <CornerMarks />
                    <div className="flex items-start gap-5">
                        <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                            <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="section-mark mb-2">Permissions set</p>
                            <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                                {isMulti
                                    ? <><span className="italic text-accent">Document policy</span> applied to {proc.doneCount} file{proc.doneCount === 1 ? "" : "s"}{proc.failedCount > 0 ? <> · <span className="text-destructive italic">{proc.failedCount} failed</span></> : null}</>
                                    : <><span className="italic text-accent">Document policy</span> applied</>}
                            </h2>
                            {isMulti && proc.doneCount > 0 && (
                                <p className="font-medium mt-2 text-[12px] text-muted-foreground">
                                    {proc.doneCount > 1 ? "ZIP downloaded" : "PDF downloaded"}
                                </p>
                            )}
                            <div className="mt-5 flex flex-wrap gap-2">
                                {proc.doneCount > 0 && (
                                    <button onClick={downloadResults} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                        <Download size={13} /> Download again
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
                                    onClick={() => { proc.reset(); setStatus("idle"); downloadedRef.current = false; }}
                                    className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                                >
                                    <RotateCcw size={12} /> Set another
                                </button>
                            </div>
                            {proc.failedCount > 0 && (
                                <div className="mt-4 space-y-1.5">
                                    {proc.entries.filter(e => e.status === "failed").map(e => (
                                        <p key={e.id} className="flex items-center gap-2 text-[12px] text-destructive">
                                            <AlertCircle size={12} className="shrink-0" /> {e.name}: {e.error}
                                        </p>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        );
    }

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
                    drag ? "border-accent bg-accent/[0.06]" : "border-border-strong bg-paper-2/30 hover:border-accent/55 hover:bg-accent/[0.04]",
                )}
            >
                <CornerMarks />
                <input ref={ref} type="file" accept=".pdf" multiple className="hidden" onChange={e => { if (e.target.files?.length) proc.addFiles(e.target.files, isPdfOnly); e.target.value = ""; }} />
                <div className={cn("h-12 w-12 rounded-xl flex items-center justify-center transition-colors", drag ? "bg-accent/20 border border-accent/45" : "bg-accent/10 border border-accent/30 group-hover:bg-accent/15")}>
                    {proc.entries.length ? <Upload size={20} className="text-accent" strokeWidth={1.75} /> : <Lock size={20} className="text-accent" strokeWidth={1.75} />}
                </div>
                <p className="font-display text-[18px] font-semibold text-foreground tracking-[-0.02em]">
                    {proc.entries.length ? "Add more PDFs" : "Drop PDFs to set permissions"}
                </p>
                <p className="font-medium text-[11.5px] text-muted-foreground">
                    Owner password + action gates · same policy applied to all · several files become a ZIP
                </p>
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
                        busy={status === "processing"}
                    />

                    {/* Owner password */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                            Owner password
                        </div>
                        <div className="p-4 space-y-2">
                            <div className="relative">
                                <input
                                    ref={pwRef}
                                    type={showPw ? "text" : "password"}
                                    value={ownerPassword} onChange={e => setOwnerPassword(e.target.value)}
                                    placeholder="Required to change permissions later"
                                    autoComplete="new-password"
                                    className="w-full rounded-md border border-border bg-card px-3 py-2.5 pr-10 font-mono text-[14px] text-foreground placeholder:text-muted-foreground outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 transition-colors"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPw(!showPw)}
                                    className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                                    aria-label={showPw ? "Hide password" : "Show password"}
                                    aria-pressed={showPw}
                                >
                                    {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                                </button>
                            </div>
                            <p className="font-medium text-[11px] text-muted-foreground">
                                Blank = default owner password
                            </p>
                            {/* Owner passwords cannot be trialled — pdf.js opens an
                                owner-protected file with an empty user password, so it
                                can't verify one. Autofill only. */}
                            <VaultPasswordPicker onPick={setOwnerPassword} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]" />
                        </div>
                    </div>

                    {/* Permissions */}
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                            Allowed actions
                        </div>
                        <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-2" role="group" aria-label="PDF permissions">
                            {PERMS.map(p => {
                                const active = permissions[p.key as keyof typeof permissions];
                                return (
                                    <button
                                        key={p.key}
                                        type="button"
                                        onClick={() => toggle(p.key)}
                                        aria-pressed={active}
                                        aria-label={`${p.label}: ${p.desc}`}
                                        className={cn(
                                            "rounded-lg border p-3 text-left transition-colors",
                                            active ? "border-accent bg-accent/[0.06]" : "border-border hover:border-border-strong hover:bg-secondary/40"
                                        )}
                                    >
                                        <div className="flex items-center justify-between gap-2">
                                            <p className="font-display text-[14px] font-semibold text-foreground tracking-[-0.015em]">{p.label}</p>
                                            <span className={cn(
                                                "h-5 w-5 rounded border flex items-center justify-center shrink-0 transition-colors",
                                                active ? "bg-accent border-accent text-background" : "border-border bg-card"
                                            )}>
                                                {active && <Shield size={10} strokeWidth={2.75} />}
                                            </span>
                                        </div>
                                        <p className="font-medium text-[11px] text-muted-foreground mt-1">{p.desc}</p>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="flex items-center gap-3">
                        <button onClick={() => process(false)} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {status === "processing"
                                ? <><Loader2 size={13} className="animate-spin" /> Applying… ({proc.doneCount}/{proc.entries.length})</>
                                : <><Lock size={13} /> Set permissions{proc.entries.length > 1 ? ` — ${proc.entries.length} files` : ""}</>}
                        </button>
                        {status !== "processing" && (
                            <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] tracking-wider text-muted-foreground bg-secondary/40 border border-border rounded px-1.5 py-0.5">⌘ ↵</kbd>
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
