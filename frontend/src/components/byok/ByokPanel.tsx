/**
 * Provider + key entry for bring-your-own-key.
 *
 * The copy here is doing security work, not marketing. Two things must be
 * true and legible to a user before they paste a credential in:
 *
 *   1. Where the key goes — straight to the provider, never to PrivaTools.
 *   2. How it is held — encrypted on this device, but readable in memory
 *      during a call, unlike the password vault whose keys the browser will
 *      not hand back even to us.
 *
 * Overstating (2) would be the more comfortable copy and the wrong one. A
 * privacy claim a user cannot check is worth less than a smaller true one.
 */

import { useState } from "react";
import { Check, ExternalLink, Eye, EyeOff, KeyRound, Trash2 } from "lucide-react";

import { PROVIDERS, providerById } from "@/lib/byok/providers";
import { getBaseUrl, saveBaseUrl } from "@/lib/byok/keyStore";
import { cn } from "@/lib/utils";
import type { UseByok } from "@/hooks/useByok";

export interface ByokPanelProps {
    byok: UseByok;
    /** Shown above the picker, e.g. what the key will be used for here. */
    purpose?: string;
}

export function ByokPanel({ byok, purpose }: ByokPanelProps) {
    const [draft, setDraft] = useState("");
    const [reveal, setReveal] = useState(false);
    const [baseUrl, setBaseUrl] = useState(() => (byok.provider ? getBaseUrl(byok.provider) ?? "" : ""));
    const [busy, setBusy] = useState(false);

    const selected = providerById(byok.provider);
    const isConfigured = byok.provider ? byok.configured.includes(byok.provider) : false;

    async function onSave() {
        if (!byok.provider || !draft.trim()) return;
        setBusy(true);
        try {
            saveBaseUrl(byok.provider, baseUrl);
            await byok.save(byok.provider, draft.trim());
            // Drop the plaintext from component state the moment it is stored.
            setDraft("");
            setReveal(false);
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="rounded-xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
                <KeyRound className="h-3.5 w-3.5 text-accent" />
                <span className="font-medium text-[11.5px] text-muted-foreground">
                    Use your own AI key
                </span>
            </div>

            {purpose && <p className="text-[12.5px] text-muted-foreground leading-snug">{purpose}</p>}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {PROVIDERS.map((p) => (
                    <button
                        key={p.id}
                        type="button"
                        onClick={() => { byok.selectProvider(p.id); setBaseUrl(getBaseUrl(p.id) ?? ""); }}
                        className={cn(
                            "rounded-md border px-2.5 py-1.5 text-[12px] text-left transition-colors",
                            byok.provider === p.id
                                ? "border-accent bg-accent/10 text-foreground"
                                : "border-border bg-background hover:border-accent/40",
                        )}
                    >
                        <span className="block truncate">{p.label}</span>
                        {byok.configured.includes(p.id) && (
                            <span className="font-medium text-[9.5px] tracking-wider text-accent">
                                key saved
                            </span>
                        )}
                    </button>
                ))}
            </div>

            {selected?.customBaseUrl && (
                <label className="block">
                    <span className="font-medium text-[11px] text-muted-foreground">
                        Base URL
                    </span>
                    <input
                        type="url"
                        value={baseUrl}
                        onChange={(e) => setBaseUrl(e.target.value)}
                        onBlur={() => byok.provider && saveBaseUrl(byok.provider, baseUrl)}
                        placeholder="http://localhost:11434"
                        className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] font-mono"
                    />
                    <span className="mt-1 block text-[11.5px] text-muted-foreground leading-snug">
                        Only loopback and the listed providers are reachable — the page's
                        security policy blocks everything else, so an arbitrary host will not work.
                    </span>
                </label>
            )}

            {selected && (
                <div className="space-y-2">
                    <div className="flex gap-1.5">
                        <div className="relative flex-1">
                            <input
                                type={reveal ? "text" : "password"}
                                value={draft}
                                onChange={(e) => setDraft(e.target.value)}
                                placeholder={isConfigured ? "Replace saved key…" : `${selected.label} API key`}
                                autoComplete="off"
                                spellCheck={false}
                                className="w-full rounded-md border border-border bg-background px-2.5 py-1.5 pr-8 text-[13px] font-mono"
                            />
                            <button
                                type="button"
                                onClick={() => setReveal((v) => !v)}
                                aria-label={reveal ? "Hide key" : "Show key"}
                                className="absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            >
                                {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={onSave}
                            disabled={busy || !draft.trim()}
                            className="btn-accent h-[34px] px-3 text-[12.5px] disabled:opacity-40"
                        >
                            {busy ? "Saving…" : "Save"}
                        </button>
                        {isConfigured && (
                            <button
                                type="button"
                                onClick={() => void byok.forget(byok.provider)}
                                aria-label="Forget saved key"
                                className="h-[34px] px-2.5 rounded-md border border-border text-muted-foreground hover:text-destructive"
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        )}
                    </div>

                    {selected.keysUrl && (
                        <a
                            href={selected.keysUrl}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex items-center gap-1 text-[11.5px] text-accent hover:underline"
                        >
                            Get a {selected.label} key <ExternalLink className="h-3 w-3" />
                        </a>
                    )}
                </div>
            )}

            <label className="flex items-start gap-2 cursor-pointer">
                <input
                    type="checkbox"
                    checked={byok.sessionOnly}
                    onChange={(e) => void byok.setSession(e.target.checked)}
                    className="mt-0.5"
                />
                <span className="text-[12px] text-muted-foreground leading-snug">
                    This session only — don't keep the key after I close the tab.
                    Use this on a shared or borrowed computer.
                </span>
            </label>

            <div className="rounded-lg border border-accent/30 bg-accent/[0.05] px-3 py-2 space-y-1">
                <span className="text-[11px] text-accent font-medium">
                    Where this goes
                </span>
                <p className="text-[12px] text-foreground leading-snug">
                    Your key and your file go straight from this browser to{" "}
                    {selected ? selected.label : "the provider you pick"}. They never pass
                    through PrivaTools, and we never see either one.
                </p>
                <p className="text-[11.5px] text-muted-foreground leading-snug">
                    The key is encrypted on this device. Unlike saved PDF passwords, it has
                    to be readable while a request is in flight — an API key can't be used
                    without being read. Anyone with access to this browser profile could
                    recover it.
                </p>
            </div>

            {byok.ready && (
                <p className="flex items-center gap-1.5 text-[12px] text-accent">
                    <Check className="h-3.5 w-3.5" /> Ready to use {selected?.label}.
                </p>
            )}
        </div>
    );
}
