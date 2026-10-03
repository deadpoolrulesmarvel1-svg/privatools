/**
 * AiHubDialog — the one place for everything AI on PrivaTools.
 *
 * Two ideas share it deliberately, because they are the same promise from
 * two directions:
 *   · Bring your own key — frontier models, your credential, straight from
 *     this browser to the provider. We never see the key or the document.
 *   · On-device models  — free local models that download once into the
 *     browser cache and then run offline. No key, no upload, no account.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Cpu, Download, HardDrive, KeyRound, Loader2, Sparkles, Trash2 } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ByokPanel } from "@/components/byok/ByokPanel";
import { useByok } from "@/hooks/useByok";
import {
    LOCAL_MODELS, TRANSLATE_HF_PREFIX, listCachedModels, removeCachedModel,
    formatBytes, type CachedModel,
} from "@/lib/localModels";

const AI_TOOLS: { label: string; href: string }[] = [
    { label: "Chat with PDF", href: "/tool/chat-with-pdf" },
    { label: "Summarize PDF", href: "/tool/summarize-pdf" },
    { label: "Translate PDF", href: "/tool/translate-pdf" },
    { label: "Smart Redact", href: "/tool/smart-redact" },
    { label: "Remove Background", href: "/tools/remove-background" },
    { label: "Transcribe Audio", href: "/tools/transcribe-audio" },
];

export function AiHubContent({ active = true, onNavigate, studio = false }: { active?: boolean; onNavigate?: () => void; studio?: boolean }) {
    const [tab, setTab] = useState("byok");
    const byok = useByok();
    const [cached, setCached] = useState<CachedModel[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [pct, setPct] = useState(0);
    const [err, setErr] = useState<string | null>(null);

    const alive = useRef(false);
    const operation = useRef(false);
    useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
    const refresh = useCallback(async () => {
        try { const next = await listCachedModels(); if (alive.current) setCached(next); }
        catch { if (alive.current) setErr("Could not read this browser’s model cache. Try again."); }
    }, []);
    useEffect(() => { if (active) void refresh(); }, [active, refresh]);

    const cachedById = new Map(cached.map(c => [c.hfId, c]));
    const translateCached = cached.filter(c => c.hfId.startsWith(TRANSLATE_HF_PREFIX));
    const totalBytes = cached.reduce((n, c) => n + c.bytes, 0);

    const download = async (id: string) => {
        const m = LOCAL_MODELS.find(x => x.id === id);
        if (!m || operation.current) return;
        operation.current = true;
        setBusyId(id); setPct(0); setErr(null);
        try {
            await m.predownload(value => { if (alive.current) setPct(Math.max(0, Math.min(100, value))); });
        } catch (e) {
            // The weights may have cached fine and only the WebAssembly
            // instantiation failed — that happens when the hub is opened from a
            // page whose CSP does not grant wasm-unsafe-eval. The model is
            // installed and the tool page will run it, so only report
            // a failure when nothing actually landed in the cache.
            const nowCached = await listCachedModels().catch(() => []);
            const landed = nowCached.some((c) => c.hfId === m.hfId && c.bytes > 1_000_000);
            if (!landed && alive.current) {
                setErr(e instanceof Error ? e.message : "Download failed — check your connection and try again.");
            }
        } finally {
            operation.current = false;
            if (alive.current) setBusyId(null);
            void refresh();
        }
    };

    const remove = async (hfId: string) => {
        if (operation.current) return;
        operation.current = true;
        setBusyId(hfId); setErr(null);
        try { await removeCachedModel(hfId); await refresh(); }
        catch { if (alive.current) setErr("Could not remove that model. Try again."); }
        finally { operation.current = false; if (alive.current) setBusyId(null); }
    };

    return (
        <Tabs value={tab} onValueChange={setTab} className={`pt-ai-hub ${studio ? "is-studio" : "is-dialog"}`}>
            <div className="pt-ai-hub-nav">
                <div className="pt-ai-hub-heading"><span className="pt-workspace-caption">Make it yours</span><h2>Choose how <br />your AI works.</h2></div>
                <TabsList className="pt-ai-modes" aria-label="AI processing options">
                    <TabsTrigger value="byok" aria-label="Your own key"><KeyRound size={21} /><span>Your own key<small>Connect your provider</small></span></TabsTrigger>
                    <TabsTrigger value="models" aria-label="On-device models"><Cpu size={21} /><span>On-device models<small>Make room for offline</small></span></TabsTrigger>
                </TabsList>
                <div className="pt-ai-device-note"><HardDrive size={19} /><span><strong>{cached.length ? formatBytes(totalBytes) : "Your device, your choice"}</strong><small>{cached.length ? `${cached.length} cached models in this browser` : "Local models stay in this browser."}</small></span></div>
            </div>
            <TabsContent value="byok" forceMount hidden={tab !== "byok"} className="pt-ai-config-stage">
                <ByokPanel byok={byok} purpose="Choose where your document goes. It is sent only when you run a tool, to the provider you pick." />
            </TabsContent>
            <TabsContent value="models" forceMount hidden={tab !== "models"} className="pt-ai-model-stage">
                <header className="pt-model-header"><div><span className="pt-workspace-caption"><Cpu size={16} />Your model shelf</span><h2>A little space. <br />A lot of possibility.</h2><p>Download a model once. Supported tools can then work on this device without uploading your file.</p></div><span className="pt-model-total"><strong>{formatBytes(totalBytes)}</strong>cached in this browser</span></header>
                <div className="pt-model-shelf">{LOCAL_MODELS.map((m, i) => {
                    const cachedModel = cachedById.get(m.hfId); const isBusy = busyId === m.id;
                    return <article className={`pt-model-card pt-model-tone-${i % 3}`} key={m.id}>
                        <div className="pt-model-card-top"><span className="pt-model-symbol"><Cpu size={26} strokeWidth={1.5} /></span><span>{cachedModel ? "On your device" : m.approxLabel}</span></div>
                        <h3>{m.label.replace(/\s+[—–]\s+/g, " · ")}</h3><p>{m.powers}</p>
                        <div className="pt-model-card-action">{isBusy ? <div className="pt-model-download" role="status"><span><Loader2 size={14} className="animate-spin" />{Math.round(pct)}% downloaded</span><progress value={pct} max={100} aria-label={`Downloading ${m.label}`} /></div>
                            : cachedModel ? <><span className="pt-model-installed"><Check size={15} />{formatBytes(cachedModel.bytes)}</span><button onClick={() => void remove(m.hfId)} disabled={!!busyId} aria-label={`Remove ${m.label} from this browser`} className="pt-studio-button is-secondary"><Trash2 size={14} />Remove</button></>
                            : <button onClick={() => void download(m.id)} disabled={!!busyId} className="pt-studio-button is-secondary"><Download size={15} />Download</button>}
                        </div>
                    </article>;
                })}</div>
                {translateCached.length > 0 && <section className="pt-translation-cache"><h3>Your translation pairs</h3>{translateCached.map(c => <div key={c.hfId}><Check size={16} /><span>{c.hfId.replace("Xenova/", "")}</span><small>{formatBytes(c.bytes)}</small><button onClick={() => void remove(c.hfId)} disabled={!!busyId} aria-label={`Remove ${c.hfId}`} className="pt-studio-button is-secondary"><Trash2 size={14} /></button></div>)}</section>}
                {err && <p role="alert" className="pt-form-error">{err}</p>}
                <p className="pt-model-footnote">Translation pairs download inside Translate PDF and Subtitle Translator. A download can continue after you leave this page. Removing a model clears this browser’s copy; the tool can download it again.</p>
            </TabsContent>
            {!studio && <div className="pt-ai-quick-links">{AI_TOOLS.map(tool => <a key={tool.href} href={tool.href} onClick={onNavigate}>{tool.label}<ArrowUpRight size={13} /></a>)}</div>}
        </Tabs>
    );
}

export function AiHubDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-[calc(100vw-24px)] rounded-xl sm:max-w-[560px] max-h-[88dvh] overflow-y-auto overflow-x-hidden">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2"><Sparkles size={16} className="text-accent" /> AI on PrivaTools</DialogTitle>
                    <DialogDescription>Your provider keys and on-device models, in one place.</DialogDescription>
                </DialogHeader>
                <AiHubContent active={open} onNavigate={() => onOpenChange(false)} />
            </DialogContent>
        </Dialog>
    );
}
