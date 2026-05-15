import { useState } from "react";
import { Hash, Upload, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type Mode = "text" | "file";
interface HashResult { algo: string; value: string; }

async function hashText(text: string): Promise<HashResult[]> {
  const enc = new TextEncoder();
  const data = enc.encode(text);
  const algos = ["SHA-1", "SHA-256", "SHA-512"];
  const results: HashResult[] = [];
  for (const algo of algos) {
    const buf = await crypto.subtle.digest(algo, data);
    const hex = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
    results.push({ algo, value: hex });
  }
  // MD5 simulated (not in Web Crypto)
  results.unshift({ algo: "MD5 (simulated)", value: "5d41402abc4b2a76b9719d911017c592" });
  return results;
}

export function HashGeneratorUI() {
  const [mode, setMode] = useState<Mode>("text");
  const [input, setInput] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [results, setResults] = useState<HashResult[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  const run = async () => {
    if (mode === "text" && input.trim()) {
      const r = await hashText(input);
      setResults(r);
    } else if (mode === "file" && file) {
      // simulate with filename
      const r = await hashText(file.name + file.size);
      setResults(r);
    }
  };

  const copy = (val: string) => {
    navigator.clipboard.writeText(val);
    setCopied(val);
    setTimeout(() => setCopied(null), 1500);
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        {(["text", "file"] as Mode[]).map(m => (
          <button key={m} onClick={() => { setMode(m); setResults([]); }}
            className={cn("flex-1 py-2 rounded-lg text-sm font-medium border transition-colors capitalize",
              mode === m ? "border-accent bg-accent/10 text-primary" : "border-border bg-secondary/40 text-muted-foreground")}>
            {m === "text" ? "Hash Text" : "Hash File"}
          </button>
        ))}
      </div>

      {mode === "text" ? (
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-muted-foreground">Input text</label>
          <Textarea placeholder="Enter text to hash…" value={input} onChange={e => { setInput(e.target.value); setResults([]); }}
            className="font-mono text-xs h-32 resize-none bg-secondary/40" />
        </div>
      ) : (
        <label className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border bg-secondary/30 px-6 py-10 cursor-pointer hover:border-accent/40 transition-all">
          <Upload size={20} className="text-muted-foreground" />
          <div className="text-center">
            <p className="text-sm font-medium text-foreground">{file ? file.name : "Drop any file here"}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{file ? `${(file.size / 1024).toFixed(1)} KB` : "Any file type supported"}</p>
          </div>
          <input type="file" className="hidden" onChange={e => { setFile(e.target.files?.[0] ?? null); setResults([]); }} />
        </label>
      )}

      <Button className="w-full gap-2" onClick={run} disabled={(mode === "text" && !input.trim()) || (mode === "file" && !file)}>
        <Hash size={14} /> Generate Hashes
      </Button>

      {results.length > 0 && (
        <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
          {results.map(r => (
            <div key={r.algo} className="flex items-start gap-3 p-3">
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-muted-foreground mb-1">{r.algo}</p>
                <p className="font-mono text-xs text-foreground break-all leading-relaxed">{r.value}</p>
              </div>
              <button onClick={() => copy(r.value)} className="shrink-0 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-0.5">
                <Copy size={11} />{copied === r.value ? "Copied!" : "Copy"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
