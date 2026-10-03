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

import { useId, useState } from "react";
import { ArrowRight, Check, ExternalLink, Eye, EyeOff, KeyRound, LockKeyhole, Trash2 } from "lucide-react";

import { PROVIDERS, type Provider } from "@/lib/byok/providers";
import { getBaseUrl, saveBaseUrl } from "@/lib/byok/keyStore";
import { cn } from "@/lib/utils";
import type { UseByok } from "@/hooks/useByok";

/** Shown before "Explore all", when the page offers them. */
const FAMILIAR = ["anthropic", "openai", "gemini", "openai-compatible"];

export interface ByokPanelProps {
    byok: UseByok;
    /** Shown above the picker, e.g. what the key will be used for here. */
    purpose?: string;
    /**
     * The providers this page can use, such as only those that transcribe on
     * Transcribe Audio. Every provider when absent. One chosen on another page
     * that this page cannot use is listed nowhere and gets no key form here.
     */
    offers?: (provider: Provider) => boolean;
}

export function ByokPanel({ byok, purpose, offers }: ByokPanelProps) {
    const headingId = useId();
    const [showAllProviders, setShowAllProviders] = useState(false);
    const [draft, setDraft] = useState("");
    const [reveal, setReveal] = useState(false);
    const [baseUrl, setBaseUrl] = useState(() => (byok.provider ? getBaseUrl(byok.provider) ?? "" : ""));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");

    const offered = offers ? PROVIDERS.filter(offers) : PROVIDERS;
    const selected = offered.find(p => p.id === byok.provider);
    const isConfigured = selected ? byok.configured.includes(selected.id) : false;

    async function onSave() {
        if (!byok.provider || !draft.trim()) return;
        setBusy(true); setError("");
        try {
            saveBaseUrl(byok.provider, baseUrl);
            await byok.save(byok.provider, draft.trim());
            // Drop the plaintext from component state the moment it is stored.
            setDraft("");
            setReveal(false);
        } catch {
            setError("That key could not be saved. Check browser storage permissions and try again, or use session-only mode.");
        } finally {
            setBusy(false);
        }
    }

    async function forget() {
        if (busy) return;
        setBusy(true); setError("");
        try { await byok.forget(byok.provider); setDraft(""); setReveal(false); }
        catch { setError("The saved key could not be removed. Try again."); }
        finally { setBusy(false); }
    }

    async function changeSession(on: boolean) {
        if (busy) return;
        setBusy(true); setError("");
        try { await byok.setSession(on); }
        catch { setError("The storage preference could not be changed. Your previous setting is still shown."); }
        finally { setBusy(false); }
    }

    return (
        <div className="pt-byok">
            <section className="pt-byok-picker" aria-labelledby={headingId}>
                <div className="pt-workspace-caption"><KeyRound size={17} /><span>Your connections</span></div>
                <h2 id={headingId}>Choose your AI company.</h2>
                <p>{purpose || "Connect a provider you already use. Your key stays under your control."}</p>
                <div className="pt-provider-grid">
                    {offered.filter(p => showAllProviders || FAMILIAR.includes(p.id) || byok.provider === p.id || byok.configured.includes(p.id)).map(p => <button key={p.id} type="button" disabled={busy} aria-pressed={byok.provider === p.id}
                        onClick={() => { byok.selectProvider(p.id); setBaseUrl(getBaseUrl(p.id) ?? ""); setDraft(""); setReveal(false); setError(""); }}
                        className={cn("pt-provider-choice", byok.provider === p.id && "is-selected")}>
                        <span className="pt-provider-letter" aria-hidden="true">{p.label.charAt(0)}</span>
                        <span className="pt-provider-name">{p.label}<small>{byok.configured.includes(p.id) ? "Key saved on this device" : "Connect with your key"}</small></span>
                        {byok.provider === p.id ? <Check size={15} aria-hidden="true" /> : <ArrowRight size={15} aria-hidden="true" />}
                    </button>)}
                </div>
                <button type="button" className="pt-studio-link pt-provider-expand" aria-expanded={showAllProviders} onClick={() => setShowAllProviders(v => !v)}>{showAllProviders ? "Fewer providers" : `Explore all ${offered.length} providers`}<ArrowRight size={15} /></button>
            </section>

            <section className="pt-byok-connection" aria-label="Provider connection settings">
                <span className="pt-connection-symbol" aria-hidden="true"><KeyRound size={29} strokeWidth={1.5} /></span>
                <h3>{selected ? selected.label : "A key opens the door."}</h3>
                <p>{selected ? "Add your provider key to use it in PrivaTools." : "Choose a company from the list to connect your account."}</p>
                {selected && <p className="pt-key-boundary">Requests go directly to your provider. Saved keys are encrypted on this device, but someone with access to this browser profile could recover them.</p>}
                {selected?.customBaseUrl && <label className="pt-input-label">Base URL
                    <input type="url" value={baseUrl} onChange={e => setBaseUrl(e.target.value)} disabled={busy}
                        onBlur={() => { try { if (byok.provider) saveBaseUrl(byok.provider, baseUrl); } catch { setError("The endpoint could not be saved. Try again."); } }}
                        placeholder="http://localhost:11434" className="pt-input" />
                    <small>Only loopback and the listed providers are reachable. The security policy blocks everything else, so an arbitrary host will not work.</small>
                </label>}
                {selected && <div className="pt-key-entry">
                    <label className="pt-input-label">API key
                        <span className="pt-secret-input"><input type={reveal ? "text" : "password"} aria-label={`${selected.label} API key`} value={draft} disabled={busy}
                            onChange={e => { setDraft(e.target.value); setError(""); }} placeholder={isConfigured ? "Replace saved key…" : "Paste your API key"}
                            autoComplete="off" spellCheck={false} className="pt-input" />
                            <button type="button" onClick={() => setReveal(v => !v)} aria-label={reveal ? "Hide key" : "Show key"}>{reveal ? <EyeOff size={17} /> : <Eye size={17} />}</button>
                        </span>
                    </label>
                    <div className="pt-inline-actions"><button type="button" onClick={onSave} disabled={busy || !draft.trim()} className="pt-studio-button">{busy ? "Saving…" : "Save"}<ArrowRight size={15} /></button>
                        {isConfigured && <button type="button" onClick={() => void forget()} disabled={busy} aria-label="Forget saved key" className="pt-studio-button is-secondary"><Trash2 size={16} />Remove</button>}
                    </div>
                    {selected.keysUrl && <a href={selected.keysUrl} target="_blank" rel="noreferrer noopener" className="pt-studio-link">Get a {selected.label} key <ExternalLink size={13} /></a>}
                </div>}
                <label className="pt-session-choice"><input type="checkbox" checked={byok.sessionOnly} disabled={busy} onChange={e => void changeSession(e.target.checked)} />
                    <span><strong>This session only</strong><small>Don’t keep the key after I close the tab. Use this on a shared or borrowed computer.</small></span>
                </label>
                {error && <p role="alert" className="pt-form-error">{error}</p>}
                {byok.ready && selected && <p className="pt-form-success"><Check size={16} /> Key configured for {selected.label}.</p>}
            </section>

            <details className="pt-byok-privacy"><summary><LockKeyhole size={15} /> Where your key and files go</summary>
                <div><p>Your key and your file go straight from this browser to {selected ? selected.label : "the provider you pick"}. They never pass through PrivaTools, and we never see either one.</p>
                <p>The key is encrypted on this device. Unlike saved PDF passwords, it has to be readable while a request is in flight. Anyone with access to this browser profile could recover it.</p></div>
            </details>
        </div>
    );
}
