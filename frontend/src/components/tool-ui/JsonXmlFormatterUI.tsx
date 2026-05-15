import { useState } from "react";
import { Braces, CheckCircle2, XCircle, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Mode = "json" | "xml";

function prettyJson(text: string): { result: string; error: string | null } {
  try {
    return { result: JSON.stringify(JSON.parse(text), null, 2), error: null };
  } catch (e: unknown) {
    return { result: text, error: (e as Error).message };
  }
}

function prettyXml(text: string): { result: string; error: string | null } {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(text, "application/xml");
    const err = doc.querySelector("parsererror");
    if (err) return { result: text, error: err.textContent ?? "Invalid XML" };
    const s = new XMLSerializer();
    let xml = s.serializeToString(doc);
    // basic indent
    xml = xml.replace(/></g, ">\n<");
    return { result: xml, error: null };
  } catch (e: unknown) {
    return { result: text, error: (e as Error).message };
  }
}

export function JsonXmlFormatterUI() {
  const [mode, setMode] = useState<Mode>("json");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const format = () => {
    const { result, error } = mode === "json" ? prettyJson(input) : prettyXml(input);
    setOutput(result);
    setError(error);
  };

  const copy = () => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        {(["json", "xml"] as Mode[]).map(m => (
          <button key={m} onClick={() => { setMode(m); setOutput(""); setError(null); }}
            className={cn("flex-1 py-2 rounded-lg text-sm font-medium border transition-colors uppercase",
              mode === m ? "border-accent bg-accent/10 text-primary" : "border-border bg-secondary/40 text-muted-foreground")}>
            {m}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <label className="text-sm text-muted-foreground font-medium">Input</label>
        <Textarea
          placeholder={mode === "json" ? '{"key": "value"}' : "<root><item>value</item></root>"}
          value={input}
          onChange={e => setInput(e.target.value)}
          className="font-mono text-xs h-44 resize-none bg-secondary/40"
        />
      </div>

      <Button className="w-full gap-2" onClick={format} disabled={!input.trim()}>
        <Braces size={14} /> Format & Validate
      </Button>

      {(output || error) && (
        <div className="space-y-3">
          <div className={cn("flex items-center gap-2 rounded-lg px-3 py-2",
            error ? "bg-rose-500/10 border border-rose-500/20" : "bg-emerald-500/10 border border-emerald-500/20")}>
            {error
              ? <><XCircle size={14} className="text-rose-400 shrink-0" /><span className="text-xs text-rose-400">{error}</span></>
              : <><CheckCircle2 size={14} className="text-emerald-400 shrink-0" /><span className="text-xs text-emerald-400">Valid {mode.toUpperCase()} ✓</span></>
            }
          </div>
          {!error && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm text-muted-foreground font-medium">Output</label>
                <div className="flex gap-2">
                  <button onClick={copy} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <Copy size={11} />{copied ? "Copied!" : "Copy"}
                  </button>
                </div>
              </div>
              <Textarea value={output} readOnly className="font-mono text-xs h-44 resize-none bg-secondary/40" />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
