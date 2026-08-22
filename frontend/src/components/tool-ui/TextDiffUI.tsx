/**
 * TextDiffUI — line-by-line diff with workshop aesthetic.
 *
 * Two code-editor panes side by side, then a unified diff view with
 * gutter line numbers (A col / B col), accent-coloured additions and
 * deletions, mono stats footer.
 */
import { useMemo, useState, useCallback} from "react";
import { GitCompare, Plus, Minus, ArrowRightLeft, RotateCcw, Columns2, Rows3, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToolDefaults } from "@/hooks/useToolDefaults";

interface DiffLine {
    type: "same" | "added" | "removed";
    text: string;
    lineA?: number;
    lineB?: number;
}

type DiffMode = "unified" | "split";

const SAMPLE_A = [
    'function greet(name) {',
    '    if (!name) return "Hello, world!";',
    '    console.log("Greeting " + name);',
    '    return "Hello, " + name + "!";',
    '}',
].join("\n");
const SAMPLE_B = [
    'function greet(name = "world") {',
    '    if (typeof name !== "string") throw new Error("Name must be a string");',
    '    console.log("Greeting " + name);',
    '    return `Hello, ${name}!`;',
    '}',
].join("\n");

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

const TEXT_DIFF_DEFAULTS: { view: DiffMode } = {
    view: "unified",
};

export function TextDiffUI() {
    const [config, , { setField }] = useToolDefaults("text-diff", TEXT_DIFF_DEFAULTS);
    const { view } = config;
    const setView = useCallback((v: React.SetStateAction<typeof TEXT_DIFF_DEFAULTS["view"]>) => setField("view", v), [setField]);
    const [textA, setTextA] = useState("");
    const [textB, setTextB] = useState("");
    const [diff, setDiff] = useState<DiffLine[] | null>(null);

    const compare = () => setDiff(computeDiff(textA, textB));
    const clear = () => { setTextA(""); setTextB(""); setDiff(null); };
    const swap = () => { setTextA(textB); setTextB(textA); setDiff(null); };
    const loadSample = () => { setTextA(SAMPLE_A); setTextB(SAMPLE_B); setDiff(null); };

    const stats = useMemo(() => {
        if (!diff) return { added: 0, removed: 0, same: 0 };
        return {
            added:   diff.filter(d => d.type === "added").length,
            removed: diff.filter(d => d.type === "removed").length,
            same:    diff.filter(d => d.type === "same").length,
        };
    }, [diff]);

    // Cmd/Ctrl + Enter inside either textarea triggers Compare.
    const onKeyDownSubmit = (e: React.KeyboardEvent) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            if (textA || textB) compare();
        }
    };

    return (
        <div className="space-y-4">
            {/* Inputs */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <DiffEditor label="A · Original" value={textA} onChange={setTextA} placeholder="Paste the original text…" onSubmit={onKeyDownSubmit} />
                <DiffEditor label="B · Modified" value={textB} onChange={setTextB} placeholder="Paste the modified text…" onSubmit={onKeyDownSubmit} />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-wrap">
                <button
                    onClick={compare}
                    disabled={!textA && !textB}
                    title="Compare (Cmd/Ctrl + Enter)"
                    className="btn-accent disabled:opacity-60 disabled:cursor-not-allowed"
                >
                    <GitCompare size={13} /> Compare
                </button>
                {(textA || textB) && (
                    <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-muted-foreground/80 bg-secondary/30 rounded px-1.5 py-0.5">⌘↵</kbd>
                )}
                <button
                    onClick={swap}
                    disabled={!textA && !textB}
                    aria-label="Swap A and B"
                    className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50"
                    title="Swap A ↔ B"
                >
                    <ArrowRightLeft size={12} /> Swap
                </button>
                {!textA && !textB && (
                    <button
                        onClick={loadSample}
                        className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                    >
                        <Sparkles size={12} /> Try sample
                    </button>
                )}
                {/* View mode toggle, only useful once a diff exists */}
                {diff && (
                    <div role="tablist" aria-label="Diff view" className="inline-flex rounded-md border border-border bg-paper-2/40 p-0.5">
                        <button
                            role="tab" type="button" aria-selected={view === "unified"}
                            onClick={() => setView("unified")}
                            className={cn(
                                "font-medium inline-flex items-center gap-1 h-7 px-2.5 text-[11.5px] rounded transition-colors",
                                view === "unified" ? "bg-card text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Rows3 size={11} /> Unified
                        </button>
                        <button
                            role="tab" type="button" aria-selected={view === "split"}
                            onClick={() => setView("split")}
                            className={cn(
                                "font-medium inline-flex items-center gap-1 h-7 px-2.5 text-[11.5px] rounded transition-colors",
                                view === "split" ? "bg-card text-foreground shadow-sm border border-border" : "text-muted-foreground hover:text-foreground"
                            )}
                        >
                            <Columns2 size={11} /> Split
                        </button>
                    </div>
                )}
                {diff && (
                    <button
                        onClick={clear}
                        aria-label="Clear diff"
                        className="font-medium ml-auto inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground hover:text-foreground transition-colors"
                    >
                        <RotateCcw size={11} /> Clear
                    </button>
                )}
            </div>

            {/* Diff result */}
            {diff && (
                <div className="rounded-xl border border-border bg-card overflow-hidden">
                    <div className="font-medium px-4 py-2 border-b border-border bg-paper-2/40 flex items-center gap-4 text-[11.5px]">
                        <span className="text-muted-foreground">Diff</span>
                        <span className="text-accent inline-flex items-center gap-1">
                            <Plus size={11} /> {stats.added}
                        </span>
                        <span className="text-destructive inline-flex items-center gap-1">
                            <Minus size={11} /> {stats.removed}
                        </span>
                        <span className="text-muted-foreground ml-auto">{stats.same} unchanged</span>
                    </div>
                    {view === "unified" ? (
                        <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
                            {diff.map((line, i) => (
                                <div
                                    key={i}
                                    className={cn(
                                        "flex items-start font-mono text-[12px] leading-relaxed border-l-2",
                                        line.type === "added"   && "bg-accent/[0.06] border-accent",
                                        line.type === "removed" && "bg-destructive/[0.06] border-destructive",
                                        line.type === "same"    && "border-transparent",
                                    )}
                                >
                                    <div className="w-9 shrink-0 px-1 py-1 text-muted-foreground/70 text-right select-none border-r border-border tabular-nums">
                                        {line.lineA ?? ""}
                                    </div>
                                    <div className="w-9 shrink-0 px-1 py-1 text-muted-foreground/70 text-right select-none border-r border-border tabular-nums">
                                        {line.lineB ?? ""}
                                    </div>
                                    <div className={cn(
                                        "w-5 shrink-0 py-1 select-none text-center font-bold",
                                        line.type === "added"   ? "text-accent" :
                                        line.type === "removed" ? "text-destructive" : "text-muted-foreground/50"
                                    )}>
                                        {line.type === "added" ? "+" : line.type === "removed" ? "−" : "·"}
                                    </div>
                                    <div className={cn(
                                        "flex-1 px-3 py-1 whitespace-pre-wrap break-all",
                                        line.type === "added"   ? "text-foreground" :
                                        line.type === "removed" ? "text-foreground" : "text-muted-foreground"
                                    )}>
                                        {line.text || " "}
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        // Split / side-by-side view: a removed line lines up next to the
                        // added line that replaced it; "same" lines appear in both columns.
                        <div className="grid grid-cols-2 max-h-[60vh] overflow-y-auto overflow-x-auto">
                            <div className="border-r border-border">
                                {diff.map((line, i) => (
                                    <div
                                        key={`a-${i}`}
                                        className={cn(
                                            "flex items-start font-mono text-[12px] leading-relaxed border-l-2",
                                            line.type === "removed" && "bg-destructive/[0.06] border-destructive",
                                            line.type === "added" && "bg-paper-2/30 border-transparent",
                                            line.type === "same" && "border-transparent",
                                        )}
                                    >
                                        <div className="w-9 shrink-0 px-1 py-1 text-muted-foreground/70 text-right select-none border-r border-border tabular-nums">
                                            {line.lineA ?? ""}
                                        </div>
                                        <div className="flex-1 px-2 py-1 whitespace-pre-wrap break-all text-foreground">
                                            {line.type !== "added" ? (line.text || " ") : ""}
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div>
                                {diff.map((line, i) => (
                                    <div
                                        key={`b-${i}`}
                                        className={cn(
                                            "flex items-start font-mono text-[12px] leading-relaxed border-l-2",
                                            line.type === "added" && "bg-accent/[0.06] border-accent",
                                            line.type === "removed" && "bg-paper-2/30 border-transparent",
                                            line.type === "same" && "border-transparent",
                                        )}
                                    >
                                        <div className="w-9 shrink-0 px-1 py-1 text-muted-foreground/70 text-right select-none border-r border-border tabular-nums">
                                            {line.lineB ?? ""}
                                        </div>
                                        <div className="flex-1 px-2 py-1 whitespace-pre-wrap break-all text-foreground">
                                            {line.type !== "removed" ? (line.text || " ") : ""}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

function DiffEditor({
    label, value, onChange, placeholder, onSubmit,
}: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    placeholder: string;
    onSubmit?: (e: React.KeyboardEvent) => void;
}) {
    const lines = value.split("\n").length;
    return (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
            <div className="font-medium px-3 py-2 border-b border-border bg-paper-2/40 flex items-center justify-between text-[11.5px] text-muted-foreground">
                <span>{label}</span>
                {value && <span>{lines} line{lines !== 1 ? "s" : ""}</span>}
            </div>
            <textarea
                value={value}
                onChange={e => onChange(e.target.value)}
                onKeyDown={onSubmit}
                placeholder={placeholder}
                spellCheck={false}
                className="block w-full font-mono text-[13px] leading-relaxed h-44 resize-none bg-transparent px-3 py-3 outline-none placeholder:text-muted-foreground/50"
            />
        </div>
    );
}
