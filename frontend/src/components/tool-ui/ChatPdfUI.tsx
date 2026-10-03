/**
 * ChatPdfUI — ask questions about a PDF, answered by the user's own AI key.
 *
 * The document never touches PrivaTools servers: pdf.js extracts the text in
 * this tab, and each question goes straight from the browser to the provider
 * the user configured (BYOK). There is deliberately no server fallback — a
 * conversational answer needs a real LLM, and we don't proxy documents.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Loader2, MessageSquareText, RotateCcw, Send, User, FileText } from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { formatFileSize, withErrorKind } from "@/lib/api";
import { emitToolRun } from "@/lib/toolRun";
import { FileUploadZone, ProcessingBar } from "./FileUploadZone";
import { AiTaskWorkspace } from "./AiTaskWorkspace";
import { ToolCopyButton } from "./SpecialistTools";
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
    const documentId = useRef(0);

    const extract = useCallback(async (f: File) => {
        const current = ++documentId.current;
        setExtracting(true); setExtractPct(0);
        let loadedPdf: Awaited<ReturnType<PdfjsLibType["getDocument"]>["promise"]> | undefined;
        setError(null);
        setMessages([]);
        setText("");
        try {
            const pdfjsLib = await loadPdfjs();
            const buf = await f.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: buf, isEvalSupported: false }).promise;
            loadedPdf = pdf;
            const pages: string[] = [];
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const content = await page.getTextContent();
                pages.push(content.items
                    .map((it: unknown) => (it as { str?: string }).str ?? "")
                    .join(" ")
                    .replace(/\s+/g, " ")
                    .trim());
                if (current !== documentId.current) return;
                setExtractPct(Math.round((i / pdf.numPages) * 100));
            }
            if (current !== documentId.current) return;
            const joined = pages.join("\n\n").trim();
            if (!joined) {
                setError("No selectable text found — if this is a scan, run OCR PDF first, then come back.");
                setFile(null);
                return;
            }
            setText(joined);
        } catch {
            if (current !== documentId.current) return;
            setError("Couldn't read that PDF. If it is password-protected, unlock it first.");
            setFile(null);
        } finally {
            void loadedPdf?.destroy();
            if (current === documentId.current) setExtracting(false);
        }
    }, []);

    const pick = useCallback((f: File) => { setFile(f); void extract(f); }, [extract]);

    useEffect(() => {
        let cancelled = false;
        consumeFileHandoff("chat-with-pdf").then(f => { if (!cancelled && f) pick(f); });
        return () => { cancelled = true; };
    }, [pick]);

    useEffect(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    }, [messages, busy]);

    useEffect(() => () => { documentId.current++; abortRef.current?.abort(); }, []);

    const ask = useCallback(async () => {
        const question = input.trim();
        if (!question || busy || !text || !byok.ready || !byok.provider) return;
        setBusy(true);
        setError(null);
        setInput("");
        const currentDocument = documentId.current;
        const history = messages;
        setMessages(m => [...m, { role: "user", content: question }]);
        const controller = new AbortController();
        abortRef.current = controller;
        try {
            const apiKey = await getKey(byok.provider);
            if (!apiKey) throw withErrorKind(new Error("No key saved for this provider yet."), "provider");
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
            if (currentDocument === documentId.current) setMessages(m => [...m, { role: "assistant", content: answer }]);
            emitToolRun({ outcome: "success" });
        } catch (e: unknown) {
            if (currentDocument !== documentId.current) return;
            if ((e as DOMException)?.name === "AbortError") { setMessages(history); setInput(question); return; }
            // A provider's refusal is already worded for the visitor, and
            // friendlyError would turn some wording into a server fault.
            setError(e instanceof ByokError ? e.userMessage
                : friendlyError(e instanceof Error ? e.message : "", "The request failed."));
            emitToolRun({ outcome: "error" }, e);
            // Put the question back so it isn't lost.
            setMessages(history);
            setInput(question);
        } finally {
            if (currentDocument === documentId.current) setBusy(false);
            if (abortRef.current === controller) abortRef.current = null;
        }
    }, [input, busy, text, byok.ready, byok.provider, messages, model]);

    const clear = () => { documentId.current++; abortRef.current?.abort(); setFile(null); setText(""); setMessages([]); setInput(""); setError(null); setBusy(false); setExtracting(false); };
    return <AiTaskWorkspace kind="chat" title="A conversation with your document" description="Read the PDF on your device, connect your provider, and ask questions in your own words." engine="byok" phase={extracting ? "extracting" : busy ? "answering" : "idle"}>
        <div className="pt-chat-workspace"><aside className="pt-chat-source"><div className="pt-lab-toolbar"><h3>Your reading material</h3><FileText size={20}/></div><FileUploadZone file={file} onFileSelect={pick} onClear={clear} accept=".pdf" label="Choose a PDF to explore" hint="Selectable text works best · extracted on your device"/>{extracting && <ProcessingBar progress={extractPct} label="Reading the PDF on your device…"/>}{text && <details className="pt-specialist-disclosure"><summary>Review extracted text · {text.length.toLocaleString()} characters</summary><pre className="pt-chat-extract" tabIndex={0}>{text}</pre></details>}<p className="pt-lab-caption">{file && `${formatFileSize(file.size)} · `}Each question sends the document text directly to your chosen AI provider. Its terms and retention policy apply. The document never passes through PrivaTools.</p></aside>
        <section className="pt-chat-conversation"><div className="pt-lab-toolbar"><h3>Ask, explore, understand</h3>{messages.length > 0 && <button className="pt-lab-button" disabled={busy} onClick={() => setMessages([])}><RotateCcw size={15}/>Start over</button>}</div><div ref={scrollRef} className="pt-chat-thread" role="log" aria-label="Document conversation" aria-live="polite">{messages.length === 0 && <div className="pt-specialist-empty"><MessageSquareText size={37}/><h3>{!file ? "Every question starts somewhere" : !byok.ready ? "Connect an AI provider below" : "What would you like to know?"}</h3><p>{!file ? "Add a PDF to start. Your conversation will live here for this session." : !byok.ready ? "Use your own key to ask questions about this document." : "Ask for an overview, find a detail or compare ideas in the document."}</p>{byok.ready && text && <div className="pt-chat-suggestions">{["Give me a short overview.","What are the key takeaways?","Which details should I double-check?"].map(prompt => <button key={prompt} onClick={() => setInput(prompt)}>{prompt}</button>)}</div>}</div>}{messages.map((message,index) => <article key={index} className={`pt-chat-message is-${message.role}`}><div>{message.role === "user" ? <User size={17}/> : <Bot size={17}/>}<strong>{message.role === "user" ? "You" : providerById(byok.provider)?.label ?? "Your provider"}</strong></div><p>{message.content}</p>{message.role === "assistant" && <ToolCopyButton value={message.content} label="Copy answer"/>}</article>)}{busy && <p className="pt-chat-thinking" role="status"><Loader2 size={17} className="animate-spin"/>Your provider is responding…</p>}</div><div className="pt-chat-compose"><textarea aria-label="Question about your PDF" value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void ask(); } }} rows={3} placeholder="Ask about this document…" disabled={!text || !byok.ready || extracting}/><button className="pt-lab-button is-primary" disabled={!busy && (!input.trim() || !text || !byok.ready || extracting)} onClick={() => busy ? abortRef.current?.abort() : void ask()}>{busy ? "Stop" : <><Send size={16}/>Ask</>}</button></div>{error && <p role="alert" className="pt-lab-issue is-error">{error}</p>}</section></div>
        <details className="pt-chat-provider" open={!byok.ready}><summary><span>AI connection</span><strong>{byok.ready ? providerById(byok.provider)?.label ?? "Provider configured" : "Choose your provider and key"}</strong></summary><ByokPanel byok={byok} purpose="Each question is sent, with the document text, straight from your browser to this provider using your key. It never passes through PrivaTools."/>{byok.ready && <label className="pt-lab-field pt-lab-spaced"><span>Model (optional)</span><input type="text" value={model} onChange={e => setModel(e.target.value)} placeholder={providerById(byok.provider)?.models[0] ?? "provider default"} className="pt-lab-version-input"/></label>}</details>
    </AiTaskWorkspace>;
}
