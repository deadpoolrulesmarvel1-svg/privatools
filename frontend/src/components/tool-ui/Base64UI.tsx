import { useState } from "react";
import { KeyRound, Copy, ArrowDownUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Mode = "encode" | "decode";

export function Base64UI() {
  const [mode, setMode] = useState<Mode>("encode");
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const run = () => {
    setError(null);
    try {
      if (mode === "encode") {
        setOutput(btoa(unescape(encodeURIComponent(input))));
      } else {
        setOutput(decodeURIComponent(escape(atob(input))));
      }
    } catch {
      setError("Invalid Base64 input. Please check your string.");
    }
  };

  const copy = () => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const swap = () => {
    setMode(m => m === "encode" ? "decode" : "encode");
    setInput(output);
    setOutput("");
    setError(null);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        {(["encode", "decode"] as Mode[]).map(m => (
          <button key={m} onClick={() => { setMode(m); setOutput(""); setError(null); }}
            className={cn("flex-1 py-2 rounded-lg text-sm font-medium border transition-colors capitalize",
              mode === m ? "border-accent bg-accent/10 text-primary" : "border-border bg-secondary/40 text-muted-foreground")}>
            {m}
          </button>
        ))}
      </div>

      <div className="space-y-1.5">
        <label className="text-sm font-medium text-muted-foreground">
          {mode === "encode" ? "Plain text input" : "Base64 input"}
        </label>
        <Textarea
          placeholder={mode === "encode" ? "Enter text to encode…" : "Enter Base64 string to decode…"}
          value={input}
          onChange={e => { setInput(e.target.value); setOutput(""); setError(null); }}
          className="font-mono text-xs h-36 resize-none bg-secondary/40"
        />
      </div>

      <Button className="w-full gap-2" onClick={run} disabled={!input.trim()}>
        <KeyRound size={14} /> {mode === "encode" ? "Encode to Base64" : "Decode from Base64"}
      </Button>

      {error && (
        <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-4 py-3">
          <p className="text-xs text-rose-400">{error}</p>
        </div>
      )}

      {output && !error && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-sm font-medium text-muted-foreground">
              {mode === "encode" ? "Base64 output" : "Decoded text"}
            </label>
            <div className="flex gap-2">
              <button onClick={swap} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <ArrowDownUp size={11} /> Swap
              </button>
              <button onClick={copy} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
                <Copy size={11} />{copied ? "Copied!" : "Copy"}
              </button>
            </div>
          </div>
          <Textarea value={output} readOnly className="font-mono text-xs h-36 resize-none bg-secondary/40" />
        </div>
      )}
    </div>
  );
}
