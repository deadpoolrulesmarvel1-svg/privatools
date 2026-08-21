/**
 * MarkdownHtmlUI — convert Markdown to HTML with split-view editor + preview.
 * Workshop: 3-mode toggle (Split / HTML / Preview) + code-editor styled panels.
 */
import { useState, useCallback} from "react";
import { Copy, Download, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { downloadBlob } from "@/lib/api";
import { useToolDefaults } from "@/hooks/useToolDefaults";

type View = "split" | "html" | "preview";

function simpleMarkdownToHtml(md: string): string {
    return md
        .replace(/^### (.+)$/gm, "<h3>$1</h3>")
        .replace(/^## (.+)$/gm, "<h2>$1</h2>")
        .replace(/^# (.+)$/gm, "<h1>$1</h1>")
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/\*(.+?)\*/g, "<em>$1</em>")
        .replace(/`(.+?)`/g, "<code>$1</code>")
        .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>')
        .replace(/^- (.+)$/gm, "<li>$1</li>")
        .replace(/\n\n/g, "</p><p>")
        .trim();
}

const SAMPLE = "# Hello World\n\nThis is **bold** and *italic* text.\n\n## Section\n\n- Item one\n- Item two\n\n[Visit example](https://example.com)";

const MARKDOWN_HTML_DEFAULTS: { view: View } = {
    view: "split",
};

export function MarkdownHtmlUI() {
    const [config, , { setField }] = useToolDefaults("markdown-html", MARKDOWN_HTML_DEFAULTS);
    const { view } = config;
    const setView = useCallback((v: React.SetStateAction<typeof MARKDOWN_HTML_DEFAULTS["view"]>) => setField("view", v), [setField]);
    const [input, setInput] = useState(SAMPLE);

    const [copied, setCopied] = useState(false);

    const html = simpleMarkdownToHtml(input);

    const copy = () => {
        navigator.clipboard.writeText(html);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const download = () => {
        // downloadBlob revokes the URL after the click, so we don't leak.
        const blob = new Blob([`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Document</title></head><body>${html}</body></html>`], { type: "text/html" });
        downloadBlob(blob, "output.html");
    };

    return (
        <div className="space-y-4">
            <div className="grid grid-cols-3 gap-1 p-1 rounded-md border border-border bg-paper-2/40">
                {(["split", "html", "preview"] as View[]).map(v => {
                    const active = view === v;
                    return (
                        <button
                            key={v}
                            onClick={() => setView(v)}
                            className={cn(
                                "rounded h-9 text-[12.5px] font-medium transition-colors capitalize inline-flex items-center justify-center",
                                active ? "bg-card border border-accent text-accent" : "text-muted-foreground hover:text-foreground hover:bg-secondary/40"
                            )}
                        >
                            {v}
                        </button>
                    );
                })}
            </div>

            <div className={cn("grid gap-3", view === "split" ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1")}>
                {(view === "split" || view === "html") && (
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span className="text-accent">§</span> Markdown
                        </div>
                        <textarea
                            value={input} onChange={e => setInput(e.target.value)}
                            className="w-full h-72 bg-paper-2/30 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-foreground resize-y outline-none"
                        />
                    </div>
                )}

                {(view === "split" || view === "html") && (
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span><span className="text-accent">§</span> HTML output</span>
                            <button onClick={copy} className={cn("h-6 px-2 rounded inline-flex items-center gap-1 transition-colors text-muted-foreground hover:text-accent hover:bg-accent/[0.06]", copied && "animate-copy-flash")}>
                                {copied ? <><Check size={10} className="text-accent" /> Copied</> : <><Copy size={10} /> Copy</>}
                            </button>
                        </div>
                        <textarea
                            value={html} readOnly
                            className="w-full h-72 bg-paper-2/30 px-4 py-3 font-mono text-[12.5px] leading-relaxed text-foreground resize-y outline-none"
                        />
                    </div>
                )}

                {view === "preview" && (
                    <div className="rounded-xl border border-border bg-card overflow-hidden">
                        <div className="px-4 py-2 border-b border-border bg-paper-2/40 font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                            <span className="text-accent">§</span> Preview · sandboxed
                        </div>
                        {/*
                          Sandbox the preview in an iframe so user-supplied Markdown
                          can never inject scripts or scoop CSS from the host page.
                          srcDoc gives us a clean document; sandbox="" disables all
                          capabilities (no JS, no top navigation, no forms).
                        */}
                        <iframe
                            title="Markdown preview"
                            sandbox=""
                            srcDoc={`<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px/1.6 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1d1d1d;padding:16px;margin:0;background:transparent}h1{font-size:22px;margin:1em 0 .4em}h2{font-size:18px;margin:1em 0 .4em}h3{font-size:16px;margin:1em 0 .4em}code{background:#f1eee8;padding:1px 4px;border-radius:3px;font:12px/1.4 ui-monospace,Menlo,monospace}a{color:#0E8A56}li{margin:.2em 0}</style></head><body>${html}</body></html>`}
                            className="block w-full bg-card min-h-72 border-0"
                        />
                    </div>
                )}
            </div>

            <button onClick={download} className="btn-accent">
                <Download size={13} /> Download .html
            </button>
        </div>
    );
}
