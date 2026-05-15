import { useState } from "react";
import { GitCompare, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

interface DiffLine {
  type: "same" | "added" | "removed";
  text: string;
  lineA?: number;
  lineB?: number;
}

function computeDiff(a: string, b: string): DiffLine[] {
  const linesA = a.split("\n");
  const linesB = b.split("\n");
  const result: DiffLine[] = [];
  const maxLen = Math.max(linesA.length, linesB.length);
  let ai = 0, bi = 0;
  for (let i = 0; i < maxLen; i++) {
    const la = linesA[ai];
    const lb = linesB[bi];
    if (la === lb) {
      result.push({ type: "same", text: la ?? "", lineA: ai + 1, lineB: bi + 1 });
      ai++; bi++;
    } else {
      if (la !== undefined) {
        result.push({ type: "removed", text: la, lineA: ai + 1 });
        ai++;
      }
      if (lb !== undefined) {
        result.push({ type: "added", text: lb, lineB: bi + 1 });
        bi++;
      }
    }
  }
  return result;
}

export function TextDiffUI() {
  const [textA, setTextA] = useState("");
  const [textB, setTextB] = useState("");
  const [diff, setDiff] = useState<DiffLine[] | null>(null);

  const compare = () => setDiff(computeDiff(textA, textB));
  const clear = () => { setTextA(""); setTextB(""); setDiff(null); };

  const added = diff?.filter(d => d.type === "added").length ?? 0;
  const removed = diff?.filter(d => d.type === "removed").length ?? 0;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-muted-foreground">Original</label>
          <Textarea placeholder="Paste original text here…" value={textA} onChange={e => setTextA(e.target.value)}
            className="font-mono text-xs h-44 resize-none bg-secondary/40" />
        </div>
        <div className="space-y-1.5">
          <label className="text-sm font-medium text-muted-foreground">Modified</label>
          <Textarea placeholder="Paste modified text here…" value={textB} onChange={e => setTextB(e.target.value)}
            className="font-mono text-xs h-44 resize-none bg-secondary/40" />
        </div>
      </div>

      <div className="flex gap-2">
        <Button className="flex-1 gap-2" onClick={compare} disabled={!textA && !textB}>
          <GitCompare size={14} /> Compare
        </Button>
        {diff && (
          <Button variant="outline" onClick={clear}>Clear</Button>
        )}
      </div>

      {diff && (
        <div className="space-y-3">
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1 text-emerald-400 font-medium"><Plus size={12} />{added} addition{added !== 1 ? "s" : ""}</span>
            <span className="flex items-center gap-1 text-rose-400 font-medium"><Minus size={12} />{removed} deletion{removed !== 1 ? "s" : ""}</span>
          </div>
          <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="overflow-x-auto">
              {diff.map((line, i) => (
                <div key={i} className={cn("flex items-start font-mono text-xs",
                  line.type === "added" ? "bg-emerald-500/10" : line.type === "removed" ? "bg-rose-500/10" : "")}>
                  <div className="w-8 shrink-0 px-2 py-1.5 text-muted-foreground/80 text-right select-none border-r border-border">
                    {line.lineA ?? ""}
                  </div>
                  <div className="w-8 shrink-0 px-2 py-1.5 text-muted-foreground/80 text-right select-none border-r border-border">
                    {line.lineB ?? ""}
                  </div>
                  <div className={cn("w-4 shrink-0 px-1 py-1.5 select-none text-center font-bold",
                    line.type === "added" ? "text-emerald-400" : line.type === "removed" ? "text-rose-400" : "text-muted-foreground/85")}>
                    {line.type === "added" ? "+" : line.type === "removed" ? "−" : " "}
                  </div>
                  <div className={cn("flex-1 px-3 py-1.5 whitespace-pre-wrap break-all",
                    line.type === "added" ? "text-emerald-300" : line.type === "removed" ? "text-rose-300" : "text-foreground/80")}>
                    {line.text || " "}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
