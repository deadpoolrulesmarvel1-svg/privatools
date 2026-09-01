/**
 * ChatPdfUI — ask questions about a PDF, answered by the user's own AI key.
 *
 * The document never touches PrivaTools servers: pdf.js extracts the text in
 * this tab, and each question goes straight from the browser to the provider
 * the user configured (BYOK). There is deliberately no server fallback — a
 * conversational answer needs a real LLM, and we don't proxy documents.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Bot, Copy, Loader2, MessageSquareText, RotateCcw, Send, User, X, FileText, CheckCircle2 } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { formatFileSize } from "@/lib/api";
import { FileUploadZone } from "./FileUploadZone";
import { consumeFileHandoff } from "@/lib/file-handoff";
import { useByok } from "@/hooks/useByok";
import { ByokPanel } from "@/components/byok/ByokPanel";
import { getBaseUrl, getKey } from "@/lib/byok/keyStore";
import { providerById } from "@/lib/byok/providers";
import { askPdfWithByok } from "@/lib/byok/tasks";
import { ByokError } from "@/lib/byok/errors";

type PdfjsLibType = typeof import("pdfjs-dist");
let pdfjsLibPromise: Promise<PdfjsLibType> | null = null;
const loadPdfjs = (): Promise<PdfjsLibType> => {
    if (!pdfjsLibPromise) {
        pdfjsLibPromise = (async () => {
            const [lib, workerUrl] = await Promise.all([
                import("pdfjs-dist"),
                import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
            ]);
            lib.GlobalWorkerOptions.workerSrc = workerUrl.default;
            return lib;
        })();
    }
    return pdfjsLibPromise;
};

interface ChatMsg { role: "user" | "assistant"; content: string; }

export function ChatPdfUI() {
    const byok = useByok();
    const [file, setFile] = useState<File | null>(null);
    const [text, setText] = useState("");
    const [extracting, setExtracting] = useState(false);
    const [extractPct, setExtractPct] = useState(0);
    const [messages, setMessages] = useState<ChatMsg[]>([]);
    const [input, setInput] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [model, setModel] = useState("");
    const abortRef = useRef<AbortController | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);

    const extract = useCallback(async (f: File) => {
        setExtracting(true);
        setError(null);
        setMessages([]);
        setText("");
        try {
            const pdfjsLib = await loadPdfjs();
            const buf = await f.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
            const pages: string[] = [];
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                pages.push(content.items
                    .map((it: unknown) => (it as { str?: string }).str ?? "")
                    .join(" ")
                    .replace(/\s+/g, " ")
                    .trim());
                setExtractPct(Math.round((i / pdf.numPages) * 100));
            }
            const joined = pages.join("\n\n").trim();
            if (!joined) {
                setError("No selectable text found — if this is a scan, run OCR PDF first, then come back.");
                setFile(null);
                return;
            }
            setText(joined);
        } catch {
            setError("Couldn't read that PDF. If it is password-protected, unlock it first.");
            setFile(null);
        } finally {
            setExtracting(false);
        }
    }, []);

    const pick = useCallback((f: File) => { setFile(f); void extract(f); }, [extract]);

    useEffect(() => {
        let cancelled = false;
        consumeFileHandoff("chat-with-pdf").then(f => { if (!cancelled && f) pick(f); });
        return () => { cancelled = true; };
    }, [pick]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }, [messages, busy]);

    useEffect(() => () => abortRef.current?.abort(), []);

    const ask = useCallback(async () => {
        const question = input.trim();
        if (!question || busy || !text || !byok.ready || !byok.provider) return;
        setBusy(true);
        setError(null);
        setInput("");
        const history = messages;
        setMessages(m => [...m, { role: "user", content: question }]);
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const apiKey = await getKey(byok.provider);
            if (!apiKey) throw new Error("No key saved for this provider yet.");
            const answer = await askPdfWithByok({
                providerId: byok.provider,
                apiKey,
                model: model.trim() || providerById(byok.provider)?.models[0] || "",
                baseUrl: getBaseUrl(byok.provider),
                text,
                question,
                history,
                signal: controller.signal,
            });
            setMessages(m => [...m, { role: "assistant", content: answer }]);
        } catch (e: unknown) {
            if ((e as DOMException)?.name === "AbortError") return;
            const msg = e instanceof ByokError ? e.userMessage : e instanceof Error ? e.message : "The request failed.";
            setError(friendlyError(msg, "The request failed."));
            // Put the question back so it isn't lost.
            setMessages(history);
            setInput(question);
        } finally {
            setBusy(false);
            if (abortRef.current === controller) abortRef.current = null;
        }
    }, [input, busy, text, byok.ready, byok.provider, messages, model]);

    if (!file) {
        return (
            <div className="space-y-4">
                <FileUploadZone
                    file={null}
                    onFileSelect={pick}
                    onClear={() => {}}
                    accept=".pdf"
                    label="Drop a PDF to chat with"
                    hint="Text is read in your browser · questions go only to the AI provider you choose, with your key"
                />
                {error && (
                    <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                        <AlertCircle size={13} className="shrink-0" /> {error}
                    </div>
                )}
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* File bar */}
            <div className="flex items-center gap-3 rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3">
                <div className="h-10 w-10 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                    {extracting ? <Loader2 size={16} className="text-accent animate-spin" /> : <FileText size={16} className="text-accent" />}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium text-foreground truncate">{file.name}</p>
                    <p className="font-medium text-[11.5px] text-muted-foreground mt-0.5">
                        {extracting
                            ? `Reading text in your browser… ${extractPct}%`
                            : <>{formatFileSize(file.size)} · {text.length.toLocaleString()} characters of text · never uploaded to us</>}
                    </p>
                </div>
                <button
                    onClick={() => { abortRef.current?.abort(); setFile(null); setText(""); setMessages([]); setError(null); }}
                    className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                    aria-label="Remove file"
                ><X size={13} /></button>
            </div>

            {/* Key setup */}
            <ByokPanel
                byok={byok}
                purpose="Each question is sent, with the document text, straight from your browser to this provider using your key. It never passes through PrivaTools."
            />
            {byok.ready && (
                <label className="block">
                    <span className="font-medium text-[11px] text-muted-foreground">Model (optional)</span>
                    <input
                        type="text"
                        value={model}
                        onChange={e => setModel(e.target.value)}
                        placeholder={providerById(byok.provider)?.models[0] ?? "provider default"}
                        className="mt-1 w-full rounded-md border border-border bg-background px-2.5 py-1.5 text-[13px] font-mono"
                    />
                </label>
            )}

            {/* Conversation */}
            {byok.ready && !extracting && text && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div ref={scrollRef} className="max-h-[420px] overflow-y-auto p-4 space-y-4">
                        {messages.length === 0 && (
                            <div className="text-center py-6">
                                <MessageSquareText size={22} className="mx-auto text-accent mb-2" strokeWidth={1.75} />
                                <p className="text-[13.5px] text-muted-foreground">
                                    Ask anything about the document — "What are the payment terms?",
                                    "Summarize section 3", "List every deadline".
                                </p>
                            </div>
                        )}
                        {messages.map((m, i) => (
                            <div key={i} className={cn("flex gap-2.5", m.role === "user" ? "justify-end" : "")}>
                                {m.role === "assistant" && (
                                    <div className="h-7 w-7 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0 mt-0.5">
                                        <Bot size={13} className="text-accent" />
                                    </div>
                                )}
                                <div className={cn(
                                    "group relative max-w-[85%] rounded-xl px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap",
                                    m.role === "user" ? "bg-accent/10 border border-accent/25 text-foreground" : "bg-secondary/50 border border-border text-foreground"
                                )}>
                                    {m.content}
                                    {m.role === "assistant" && (
                                        <button
                                            onClick={() => navigator.clipboard.writeText(m.content).catch(() => {})}
                                            className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 h-6 w-6 rounded-md bg-card border border-border inline-flex items-center justify-center text-muted-foreground hover:text-foreground transition-all"
                                            aria-label="Copy answer"
                                        ><Copy size={11} /></button>
                                    )}
                                </div>
                                {m.role === "user" && (
                                    <div className="h-7 w-7 rounded-lg bg-secondary border border-border flex items-center justify-center shrink-0 mt-0.5">
                                        <User size={13} className="text-muted-foreground" />
                                    </div>
                                )}
                            </div>
                        ))}
                        {busy && (
                            <div className="flex gap-2.5">
                                <div className="h-7 w-7 rounded-lg bg-accent/12 border border-accent/30 flex items-center justify-center shrink-0">
                                    <Bot size={13} className="text-accent" />
                                </div>
                                <div className="rounded-xl bg-secondary/50 border border-border px-3.5 py-2.5">
                                    <Loader2 size={14} className="animate-spin text-accent" />
                                </div>
                            </div>
                        )}
                    </div>
                    <div className="border-t border-border p-3 flex items-end gap-2">
                        <textarea
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(); } }}
                            placeholder="Ask about the document… (Enter to send, Shift+Enter for a new line)"
                            rows={Math.min(4, Math.max(1, input.split("\n").length))}
                            className="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13.5px] outline-none focus:border-accent/50"
                        />
                        {busy ? (
                            <button
                                onClick={() => abortRef.current?.abort()}
                                className="h-9 px-3 rounded-lg border border-border bg-card text-[12.5px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                            >Stop</button>
                        ) : (
                            <button
                                onClick={() => void ask()}
                                disabled={!input.trim()}
                                className="h-9 w-9 rounded-lg bg-accent text-accent-foreground inline-flex items-center justify-center disabled:opacity-40 transition-opacity"
                                aria-label="Send question"
                            ><Send size={14} /></button>
                        )}
                    </div>
                </div>
            )}

            {messages.length > 0 && !busy && (
                <button
                    onClick={() => setMessages([])}
                    className="inline-flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                ><RotateCcw size={11} /> New conversation (same document)</button>
            )}

            {error && (
                <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5 text-[13px] text-destructive">
                    <AlertCircle size={13} className="shrink-0" /> {error}
                </div>
            )}

            {!extracting && text && !byok.ready && (
                <p className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
                    <CheckCircle2 size={13} className="text-accent" />
                    Text extracted. Add a provider key above to start asking questions.
                </p>
            )}
        </div>
    );
}
