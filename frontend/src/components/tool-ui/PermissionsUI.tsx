/**
 * PermissionsUI — set owner-password + per-action permission flags.
 * Workshop: owner password input + 4 permission cards with check/cross icons.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Loader2, AlertCircle, Shield, Eye, EyeOff, CheckCircle2, RotateCcw, Lock } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile, downloadBlob } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";
import { VaultPasswordPicker } from "@/components/VaultPasswordPicker";

const PERMS = [
    { key: "allow_print",    label: "Printing",       desc: "Users can print the document" },
    { key: "allow_copy",     label: "Copy text",      desc: "Allow text selection & copy" },
    { key: "allow_modify",   label: "Modify",         desc: "Allow content edits" },
    { key: "allow_annotate", label: "Annotate",       desc: "Add notes & highlights" },
] as const;

export function PermissionsUI() {
    const [file, setFile] = useState<File | null>(null);
    const [ownerPassword, setOwnerPassword] = useState("");
    const [showPw, setShowPw] = useState(false);
    const [permissions, setPermissions] = useState({
        allow_print: true, allow_copy: true, allow_modify: false, allow_annotate: true,
    });
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);

    const pwRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (file) pwRef.current?.focus();
    }, [file]);

    const toggle = (key: string) => setPermissions(p => ({ ...p, [key]: !p[key as keyof typeof p] }));

    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const res = await uploadFile("/set-permissions", file, { owner_password: ownerPassword || "", ...permissions });
            const blob = await res.blob();
            setResultBlob(blob);
            setStatus("done");
            downloadBlob(blob, file.name.replace(/\.pdf$/i, "_permissions.pdf"));
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Could not set permissions";
            setError(friendlyError(msg, "Couldn't update permissions on that PDF."));
            setStatus("idle");
        }
    }, [file, ownerPassword, permissions]);

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && file && status !== "processing") {
                e.preventDefault();
                process();
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, [file, status, process]);

    if (status === "done") return (
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
                            <span className="italic text-accent">Document policy</span> applied
                        </h2>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <button onClick={() => resultBlob && file && downloadBlob(resultBlob, file.name.replace(/\.pdf$/i, "_permissions.pdf"))} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                <Download size={13} /> Download again
                            </button>
                            <button
                                onClick={() => { setFile(null); setStatus("idle"); setResultBlob(null); }}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                            >
                                <RotateCcw size={12} /> Set another
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <div className="space-y-4">
            <FileUploadZone
                file={file}
                onFileSelect={setFile}
                onClear={() => setFile(null)}
                accept=".pdf"
                label="Drop PDF to set permissions"
                hint="Owner password + action gates"
            />

            {file && (
                <>
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

                    {error && (
                        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                            <AlertCircle size={13} className="shrink-0" />{error}
                        </div>
                    )}

                    <div className="flex items-center gap-3">
                        <button onClick={process} disabled={status === "processing"} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                            {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Applying…</> : <><Lock size={13} /> Set permissions</>}
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