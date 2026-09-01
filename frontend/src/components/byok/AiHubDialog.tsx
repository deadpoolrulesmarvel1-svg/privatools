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
import { useCallback, useEffect, useState } from "react";
import { ArrowUpRight, Check, Cpu, Download, HardDrive, KeyRound, Loader2, Sparkles, Trash2 } from "lucide-react";

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ByokPanel } from "@/components/byok/ByokPanel";
import { useByok } from "@/hooks/useByok";
import {
    LOCAL_MODELS, TRANSLATE_HF_PREFIX, listCachedModels, removeCachedModel,
    formatBytes, type CachedModel,
} from "@/lib/localModels";
import { cn } from "@/lib/utils";

const AI_TOOLS: { label: string; href: string }[] = [
    { label: "Chat with PDF", href: "#/tool/chat-with-pdf" },
    { label: "Summarize PDF", href: "#/tool/summarize-pdf" },
    { label: "Translate PDF", href: "#/tool/translate-pdf" },
    { label: "Smart Redact", href: "#/tool/smart-redact" },
    { label: "Remove Background", href: "#/tools/remove-background" },
    { label: "Transcribe Audio", href: "#/tools/transcribe-audio" },
];

export function AiHubDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
    const byok = useByok();
    const [cached, setCached] = useState<CachedModel[]>([]);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [pct, setPct] = useState(0);
    const [err, setErr] = useState<string | null>(null);

    const refresh = useCallback(() => { void listCachedModels().then(setCached); }, []);
    useEffect(() => { if (open) refresh(); }, [open, refresh]);

    const cachedById = new Map(cached.map(c => [c.hfId, c]));
    const translateCached = cached.filter(c => c.hfId.startsWith(TRANSLATE_HF_PREFIX));
    const totalBytes = cached.reduce((n, c) => n + c.bytes, 0);

    const download = async (id: string) => {
        const m = LOCAL_MODELS.find(x => x.id === id);
        if (!m || busyId) return;
        setBusyId(id); setPct(0); setErr(null);
        try {
            await m.predownload(setPct);
        } catch (e) {
            setErr(e instanceof Error ? e.message : "Download failed — check your connection and try again.");
        } finally {
            setBusyId(null);
            refresh();
        }
    };

    const remove = async (hfId: string) => {
        await removeCachedModel(hfId);
        refresh();
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="sm:max-w-[560px] max-h-[85vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Sparkles size={16} className="text-accent" /> AI on PrivaTools
                    </DialogTitle>
                    <DialogDescription>
                        Two ways to run AI here — both keep your documents away from us.
                    </DialogDescription>
                </DialogHeader>

                <Tabs defaultValue="byok">
                    <TabsList className="grid w-full grid-cols-2">
                        <TabsTrigger value="byok"><KeyRound size={12} className="mr-1.5" /> Your own key</TabsTrigger>
                        <TabsTrigger value="models"><Cpu size={12} className="mr-1.5" /> On-device models</TabsTrigger>
                    </TabsList>

                    <TabsContent value="byok" className="space-y-4 pt-3">
                        <p className="text-[13px] text-muted-foreground leading-relaxed">
                            Paste an API key once and the AI tools use frontier models — the key is
                            encrypted on this device and every request goes straight from your
                            browser to the provider. <span className="text-foreground font-medium">PrivaTools
                            is never in the path.</span>
                        </p>
                        <ByokPanel byok={byok} purpose="Used by the AI tools below — a document's text is sent only when you run one, and only to the provider you picked." />
                        <div>
                            <p className="font-medium text-[11px] tracking-wider uppercase text-muted-foreground mb-2">Works in</p>
                            <div className="flex flex-wrap gap-1.5">
                                {AI_TOOLS.filter(t => t.label !== "Remove Background").map(t => (
                                    <a key={t.href} href={t.href} onClick={() => onOpenChange(false)}
                                        className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-3 py-1 text-[12px] font-medium text-foreground hover:border-accent/50 hover:text-accent transition-colors">
                                        {t.label} <ArrowUpRight size={10} />
                                    </a>
                                ))}
                            </div>
                        </div>
                    </TabsContent>

                    <TabsContent value="models" className="space-y-4 pt-3">
                        <p className="text-[13px] text-muted-foreground leading-relaxed">
                            Free models that run <span className="text-foreground font-medium">inside your browser</span> —
                            downloaded once into the browser cache, then they work on every visit,
                            even offline. No key, no account, nothing uploaded.
                        </p>
                        <div className="space-y-2">
                            {LOCAL_MODELS.map(m => {
                                const c = cachedById.get(m.hfId);
                                const isBusy = busyId === m.id;
                                return (
                                    <div key={m.id} className="flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                                        <div className={cn("h-9 w-9 rounded-lg border flex items-center justify-center shrink-0",
                                            c ? "bg-accent/12 border-accent/30" : "bg-secondary border-border")}>
                                            {c ? <Check size={14} className="text-accent" /> : <HardDrive size={14} className="text-muted-foreground" />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[13px] font-medium text-foreground truncate">{m.label}</p>
                                            <p className="text-[11.5px] text-muted-foreground truncate">
                                                {m.powers} · {c ? `installed · ${formatBytes(c.bytes)}` : m.approxLabel}
                                            </p>
                                        </div>
                                        {isBusy ? (
                                            <span className="inline-flex items-center gap-1.5 text-[11.5px] font-medium text-accent shrink-0">
                                                <Loader2 size={12} className="animate-spin" /> {pct}%
                                            </span>
                                        ) : c ? (
                                            <button onClick={() => void remove(m.hfId)} title="Remove from this browser"
                                                className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/[0.08] transition-colors shrink-0">
                                                <Trash2 size={13} />
                                            </button>
                                        ) : (
                                            <button onClick={() => void download(m.id)} disabled={!!busyId}
                                                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-accent/40 bg-accent/[0.06] text-[12px] font-semibold text-accent hover:bg-accent/[0.12] transition-colors disabled:opacity-50 shrink-0">
                                                <Download size={12} /> Download
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {translateCached.length > 0 && (
                            <div>
                                <p className="font-medium text-[11px] tracking-wider uppercase text-muted-foreground mb-2">Translation models (one per language pair)</p>
                                <div className="space-y-1.5">
                                    {translateCached.map(c => (
                                        <div key={c.hfId} className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2">
                                            <Check size={12} className="text-accent shrink-0" />
                                            <p className="flex-1 min-w-0 text-[12px] font-mono text-foreground truncate">{c.hfId.replace("Xenova/", "")}</p>
                                            <span className="text-[11px] text-muted-foreground shrink-0">{formatBytes(c.bytes)}</span>
                                            <button onClick={() => void remove(c.hfId)} title="Remove"
                                                className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive transition-colors shrink-0">
                                                <Trash2 size={12} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {err && <p className="text-[12.5px] text-destructive">{err}</p>}

                        <div className="flex items-center justify-between rounded-lg border border-border bg-paper-2/40 px-3 py-2">
                            <span className="text-[11.5px] text-muted-foreground">
                                {cached.length ? <>Total on this device: <span className="text-foreground font-medium">{formatBytes(totalBytes)}</span></> : "Nothing installed yet — models also download automatically the first time a tool needs them."}
                            </span>
                            <Badge variant="outline" className="shrink-0">stored by your browser</Badge>
                        </div>
                        <p className="text-[11.5px] text-muted-foreground leading-relaxed">
                            Translation pairs download on first use inside Translate PDF. Removing a model
                            only clears this browser's cache — the tool simply re-downloads it next time.
                        </p>
                    </TabsContent>
                </Tabs>
            </DialogContent>
        </Dialog>
    );
}
