import { useState } from "react";
import { Code2, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

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
    .replace(/^(?!<[h|li|p])/gm, "")
    .trim();
}

export function MarkdownHtmlUI() {
  const [input, setInput] = useState("# Hello World\n\nThis is **bold** and *italic* text.\n\n## Section\n\n- Item one\n- Item two\n\n[Visit example](https://example.com)");
  const [view, setView] = useState<View>("split");
  const [copied, setCopied] = useState(false);

  const html = simpleMarkdownToHtml(input);

  const copy = () => {
    navigator.clipboard.writeText(html);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const download = () => {
    const blob = new Blob([`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Document</title></head><body>${html}</body></html>`], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "output.html";
    a.click();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        {(["split", "html", "preview"] as View[]).map(v => (
          <button key={v} onClick={() => setView(v)}
            className={cn("flex-1 py-2 rounded-lg text-sm font-medium border transition-colors capitalize",
              view === v ? "border-accent bg-accent/10 text-primary" : "border-border bg-secondary/40 text-muted-foreground")}>
            {v}
          </button>
        ))}
      </div>

      <div className={cn("grid gap-3", view === "split" ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1")}>
        {(view === "split" || view === "html") && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">Markdown</label>
            <Textarea value={input} onChange={e => setInput(e.target.value)}
              className="font-mono text-xs h-64 resize-none bg-secondary/40" />
          </div>
        )}

        {(view === "split" || view === "html") && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-muted-foreground">HTML Output</label>
              <div className="flex gap-2">
                <button onClick={copy} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                  <Copy size={11} />{copied ? "Copied!" : "Copy"}
                </button>
              </div>
            </div>
            <Textarea value={html} readOnly className="font-mono text-xs h-64 resize-none bg-secondary/40" />
          </div>
        )}

        {view === "preview" && (
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-muted-foreground">Preview</label>
            <div
              className="rounded-xl border border-border bg-card p-5 min-h-64 prose prose-sm prose-invert max-w-none text-foreground"
              dangerouslySetInnerHTML={{ __html: html }}
            />
          </div>
        )}
      </div>

      <Button className="w-full gap-2" onClick={download}>
        <Download size={14} /> Download .html file
      </Button>
    </div>
  );
}
