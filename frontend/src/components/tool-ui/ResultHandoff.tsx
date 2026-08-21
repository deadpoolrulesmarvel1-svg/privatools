/**
 * ResultHandoff — "now send this result somewhere else".
 *
 * The file is already in the browser as a Blob, and the file-handoff mechanism
 * already moves a File into another tool. This just connects the two at the one
 * moment the user actually wants it: the result screen.
 *
 * Nothing is uploaded to make this work. The handoff is sessionStorage on the
 * user's own device, which is why we can offer chaining without accounts or
 * server-side storage — the thing every competitor charges for.
 */
import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowRight, Loader2 } from "lucide-react";
import { storeFileHandoff } from "@/lib/file-handoff";
import { nextStepsFor } from "@/lib/tool-chains";

interface Props {
    blob: Blob | null;
    filename: string;
    fromSlug: string;
}

export function ResultHandoff({ blob, filename, fromSlug }: Props) {
    const navigate = useNavigate();
    const [sending, setSending] = useState<string | null>(null);
    const steps = nextStepsFor(fromSlug, filename);

    const send = useCallback(async (slug: string, href: string) => {
        if (!blob) return;
        setSending(slug);
        try {
            const file = new File([blob], filename, {
                type: blob.type || "application/pdf",
            });
            await storeFileHandoff(file, slug);
        } catch {
            // Handoff is a convenience — a quota failure shouldn't strand the
            // user on the result screen. Send them to the tool anyway; they can
            // pick the file they already downloaded.
        } finally {
            setSending(null);
            navigate(href);
        }
    }, [blob, filename, navigate]);

    if (!blob || steps.length === 0) return null;

    return (
        <div className="mt-5 rounded-xl border border-border bg-card/60 overflow-hidden">
            <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                <span className="text-accent">§</span> Do more with this file
            </div>
            <div className="divide-y divide-border">
                {steps.map(step => (
                    <button
                        key={step.slug}
                        type="button"
                        onClick={() => void send(step.slug, step.href)}
                        disabled={sending !== null}
                        className="w-full px-4 py-2.5 flex items-center gap-3 text-left hover:bg-secondary/50 transition-colors disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60"
                    >
                        <span className="flex-1 min-w-0">
                            <span className="block text-[13px] font-medium text-foreground">{step.name}</span>
                            <span className="block text-[12px] text-muted-foreground leading-snug">{step.reason}</span>
                        </span>
                        {sending === step.slug
                            ? <Loader2 size={13} className="shrink-0 animate-spin text-accent" />
                            : <ArrowRight size={13} className="shrink-0 text-muted-foreground" />}
                    </button>
                ))}
            </div>
            <p className="px-4 py-1.5 border-t border-border font-mono text-[10px] tracking-[0.04em] text-muted-foreground/80">
                Carried over on your device — nothing is re-uploaded
            </p>
        </div>
    );
}
