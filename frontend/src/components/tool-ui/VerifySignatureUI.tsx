/**
 * VerifySignatureUI — inspect existing PDF signature fields.
 * Workshop: lab-report style result panel with signer rows + status chips.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, AlertCircle, CheckCircle2, XCircle, ShieldCheck, ShieldAlert, RotateCcw, Search, ShieldQuestion } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { uploadFile } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";

interface SigResult {
    valid: boolean;
    signatures: { signer: string; date: string; valid: boolean }[];
}

type Verdict = "none" | "valid" | "untrusted" | "tampered";

export function VerifySignatureUI() {
    const [file, setFile] = useState<File | null>(null);
    const [status, setStatus] = useState<"idle" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<SigResult | null>(null);

    const canProcess = !!file && status !== "processing";

    const process = useCallback(async () => {
        if (!file) return;
        setStatus("processing"); setError(null);
        try {
            const res = await uploadFile("/verify-signature", file);
            const data = await res.json();
            setResult(data);
            setStatus("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Could not verify signatures";
            setError(friendlyError(msg, "Couldn't verify that signature."));
            setStatus("idle");
        }
    }, [file]);

    useEffect(() => {
        const h = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); }
        };
        window.addEventListener("keydown", h);
        return () => window.removeEventListener("keydown", h);
    }, [canProcess, process]);

    // Compute the high-level verdict: none / valid / untrusted / tampered.
    // We can only distinguish field-detected vs. cryptographically-broken with our backend today,
    // so "untrusted" is shown when fields exist but PKI trust is not asserted, and "tampered"
    // when any signature comes back valid:false.
    const verdict = useMemo<Verdict>(() => {
        if (!result || !result.signatures || result.signatures.length === 0) return "none";
        const anyInvalid = result.signatures.some(s => s.valid === false);
        if (anyInvalid) return "tampered";
        if (result.valid === false) return "tampered";
        return result.valid ? "untrusted" : "tampered";
    }, [result]);

    const verdictMeta: Record<Verdict, { tone: "accent" | "copper" | "danger" | "muted"; title: string; sub: string; icon: typeof ShieldCheck }> = {
        none:      { tone: "muted",  title: "No signatures found",        sub: "This PDF doesn't contain any signature fields",                icon: ShieldQuestion },
        valid:     { tone: "accent", title: "Signatures look intact",     sub: "Signature fields detected — document hasn't been altered",     icon: ShieldCheck },
        untrusted: { tone: "copper", title: "Signed, trust not verified", sub: "Fields detected. Full PKI trust-chain validation not yet — verify the signer through your viewer of record", icon: ShieldAlert },
        tampered:  { tone: "danger", title: "Signature broken or tampered", sub: "At least one signature failed validation — the document may have been altered after signing", icon: ShieldAlert },
    };

    const toneStyles = (tone: "accent" | "copper" | "danger" | "muted") => {
        if (tone === "accent") return { border: "border-accent/30 bg-accent/[0.05]", icon: "bg-accent/15 border-accent/35", iconColor: "text-accent", label: "text-accent" };
        if (tone === "copper") return { border: "border-copper/40 bg-copper-soft/40", icon: "bg-copper/15 border-copper/35", iconColor: "text-copper", label: "text-copper" };
        if (tone === "danger") return { border: "border-destructive/40 bg-destructive/[0.05]", icon: "bg-destructive/15 border-destructive/35", iconColor: "text-destructive", label: "text-destructive" };
        return { border: "border-border bg-card", icon: "bg-secondary border-border", iconColor: "text-muted-foreground", label: "text-muted-foreground" };
    };

    return (
        <div className="space-y-4">
            <FileUploadZone
                file={file}
                onFileSelect={setFile}
                onClear={() => { setFile(null); setResult(null); setStatus("idle"); }}
                accept=".pdf"
                label="Drop signed PDF"
                hint="Inspect signature fields & widgets"
            />

            {status === "done" && result && (
                <div className="space-y-3 animate-fade-up">
                    {/* Verdict panel — distinct visuals for none / untrusted / tampered */}
                    {(() => {
                        const meta = verdictMeta[verdict];
                        const t = toneStyles(meta.tone);
                        const Icon = meta.icon;
                        const cornerTone: "accent" | "copper" | "danger" = meta.tone === "danger" ? "danger" : meta.tone === "copper" ? "copper" : "accent";
                        return (
                            <div className={cn("relative rounded-2xl border overflow-hidden", t.border)} role="status" aria-live="polite">
                                <div className="relative p-6 animate-corner-extend">
                                    <CornerMarks tone={cornerTone} />
                                    <div className="flex items-start gap-4">
                                        <div className={cn("h-12 w-12 rounded-xl border flex items-center justify-center shrink-0 animate-success-pop", t.icon)}>
                                            <Icon size={22} className={t.iconColor} strokeWidth={1.75} />
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className={cn("font-medium text-[11.5px] mb-1.5", t.label)}>
                                                Verification result
                                            </p>
                                            <h3 className="font-display text-[20px] font-bold text-foreground tracking-[-0.02em] leading-tight">
                                                {meta.title}
                                            </h3>
                                            <p className="text-[13px] text-muted-foreground mt-1">{meta.sub}</p>
                                            <p className="font-medium text-[11.5px] text-muted-foreground mt-2">
                                                <span className={t.label}></span> {result.signatures?.length || 0} signature field{(result.signatures?.length || 0) !== 1 && "s"} inspected
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        );
                    })()}

                    {/* Signer rows */}
                    {result.signatures?.length > 0 && (
                        <div className="rounded-xl border border-border bg-card overflow-hidden">
                            <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 text-[11.5px] text-muted-foreground">
                                Signers
                            </div>
                            <div className="divide-y divide-border">
                                {result.signatures.map((s, i) => (
                                    <div key={i} className="px-4 py-3 flex items-center gap-3">
                                        <span className="font-mono text-[10px] tracking-wider text-muted-foreground w-6 text-right shrink-0">{String(i + 1).padStart(2, "0")}</span>
                                        <div className={cn(
                                            "h-8 w-8 rounded-lg flex items-center justify-center shrink-0",
                                            s.valid ? "bg-accent/12 border border-accent/30" : "bg-copper/15 border border-copper/35"
                                        )}>
                                            {s.valid ? <CheckCircle2 size={14} className="text-accent" /> : <XCircle size={14} className="text-copper" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[13.5px] font-medium text-foreground truncate">{s.signer || "Unknown signer"}</p>
                                            <p className="font-mono text-[10.5px] tracking-[0.04em] text-muted-foreground mt-0.5">{s.date || "Date unknown"}</p>
                                        </div>
                                        <span className={cn(
                                            "font-medium text-[9.5px] px-2 py-0.5 rounded",
                                            s.valid ? "bg-accent/15 text-accent" : "bg-copper/15 text-copper"
                                        )}>
                                            {s.valid ? "Valid" : "Invalid"}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <p className="font-medium text-[11px] text-muted-foreground">
                        Field-level inspection. Full PKI trust-chain validation not yet — verify high-stakes signatures through your viewer of record.
                    </p>

                    <button
                        onClick={() => { setFile(null); setStatus("idle"); setResult(null); }}
                        className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                    >
                        <RotateCcw size={12} /> Verify another
                    </button>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" />{error}
                </div>
            )}

            {status !== "done" && (
                <div className="flex items-center gap-3 flex-wrap">
                    <button onClick={process} disabled={!canProcess} className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed">
                        {status === "processing" ? <><Loader2 size={13} className="animate-spin" /> Inspecting…</> : <><Search size={13} /> Verify signatures</>}
                    </button>
                    {canProcess && (
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                    )}
                </div>
            )}
        </div>
    );
}

function CornerMarks({ tone = "accent" }: { tone?: "accent" | "copper" | "danger" }) {
    const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
    const c = tone === "danger" ? "bg-destructive" : tone === "copper" ? "bg-copper" : "bg-accent";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}><span className={`absolute top-0 left-0 h-px w-3 ${c}/70`} /><span className={`absolute top-0 left-0 w-px h-3 ${c}/70`} /></span>
            <span className={`${cls} -top-1 -right-1`}><span className={`absolute top-0 right-0 h-px w-3 ${c}/70`} /><span className={`absolute top-0 right-0 w-px h-3 ${c}/70`} /></span>
            <span className={`${cls} -bottom-1 -left-1`}><span className={`absolute bottom-0 left-0 h-px w-3 ${c}/70`} /><span className={`absolute bottom-0 left-0 w-px h-3 ${c}/70`} /></span>
            <span className={`${cls} -bottom-1 -right-1`}><span className={`absolute bottom-0 right-0 h-px w-3 ${c}/70`} /><span className={`absolute bottom-0 right-0 w-px h-3 ${c}/70`} /></span>
        </>
    );
}
