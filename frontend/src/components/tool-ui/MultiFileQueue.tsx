/**
 * MultiFileQueue — render the per-file row list used by every multi-file tool.
 *
 * Talks to a `useMultiFileProcessor()` result. Doesn't fetch anything itself;
 * just renders status, lets the user reorder/remove, and exposes a "Clear all"
 * and "Retry failed" affordance.
 *
 * Drag-reorder uses HTML5 DnD (no library) with a GripVertical handle. Falls
 * back to ChevronUp/Down buttons for keyboard / touch users.
 */
import type { FileEntry } from "@/hooks/useMultiFileProcessor";
import { cn } from "@/lib/utils";
import { formatFileSize } from "@/lib/api";
import {
    FileText, X, GripVertical, ChevronUp, ChevronDown, Loader2, CheckCircle2,
    AlertCircle, Clock, RotateCw,
} from "lucide-react";
import { useState } from "react";

interface Props {
    entries: FileEntry[];
    /** Allow drag reorder? Some tools (e.g. Compress) don't care. Default true. */
    reorderable?: boolean;
    onRemove: (id: string) => void;
    onReorder: (from: number, to: number) => void;
    onClearAll: () => void;
    onRetryFailed?: () => void;
    /** Whether processing is in flight — disables interactive controls. */
    busy?: boolean;
}

function StatusBadge({ status, error }: { status: FileEntry["status"]; error?: string }) {
    if (status === "queued") {
        return (
            <span className="inline-flex items-center gap-1 font-mono text-[9.5px] tracking-[0.08em] uppercase text-muted-foreground/85">
                <Clock size={10} /> Queued
            </span>
        );
    }
    if (status === "running") {
        return (
            <span className="inline-flex items-center gap-1 font-mono text-[9.5px] tracking-[0.08em] uppercase text-accent">
                <Loader2 size={10} className="animate-spin" /> Running
            </span>
        );
    }
    if (status === "done") {
        return (
            <span className="inline-flex items-center gap-1 font-mono text-[9.5px] tracking-[0.08em] uppercase text-accent">
                <CheckCircle2 size={10} /> Done
            </span>
        );
    }
    return (
        <span
            className="inline-flex items-center gap-1 font-mono text-[9.5px] tracking-[0.08em] uppercase text-destructive"
            title={error || ""}
        >
            <AlertCircle size={10} /> Failed
        </span>
    );
}

export function MultiFileQueue({
    entries, reorderable = true, onRemove, onReorder, onClearAll, onRetryFailed, busy = false,
}: Props) {
    const [dragId, setDragId] = useState<string | null>(null);
    const [overId, setOverId] = useState<string | null>(null);

    if (entries.length === 0) return null;

    const failedCount = entries.filter(e => e.status === "failed").length;
    const doneCount = entries.filter(e => e.status === "done").length;
    const totalSize = entries.reduce((s, e) => s + e.size, 0);

    const handleDragStart = (id: string) => (e: React.DragEvent) => {
        if (busy || !reorderable) return;
        setDragId(id);
        e.dataTransfer.effectAllowed = "move";
        // Some browsers need data on the transfer for the drag to "stick".
        e.dataTransfer.setData("text/plain", id);
    };
    const handleDragOver = (id: string) => (e: React.DragEvent) => {
        if (busy || !reorderable || !dragId) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (id !== overId) setOverId(id);
    };
    const handleDrop = (id: string) => (e: React.DragEvent) => {
        if (busy || !reorderable || !dragId) return;
        e.preventDefault();
        const from = entries.findIndex(x => x.id === dragId);
        const to = entries.findIndex(x => x.id === id);
        if (from >= 0 && to >= 0) onReorder(from, to);
        setDragId(null);
        setOverId(null);
    };
    const handleDragEnd = () => { setDragId(null); setOverId(null); };

    return (
        <div className="space-y-2">
            {/* Header row: count, total size, Clear all */}
            <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                <span className="font-mono text-[10.5px] tracking-[0.10em] uppercase text-muted-foreground">
                    <span className="text-accent">§</span> {entries.length} file{entries.length === 1 ? "" : "s"} ·{" "}
                    {formatFileSize(totalSize)}
                    {doneCount > 0 && <> · <span className="text-accent">{doneCount} done</span></>}
                    {failedCount > 0 && <> · <span className="text-destructive">{failedCount} failed</span></>}
                </span>
                <div className="flex items-center gap-2">
                    {!busy && entries.length > 0 && (
                        <button
                            type="button"
                            onClick={onClearAll}
                            className="font-mono text-[10px] tracking-[0.10em] uppercase text-muted-foreground hover:text-destructive transition-colors"
                        >
                            Clear all
                        </button>
                    )}
                </div>
            </div>

            {/* Partial-failure banner */}
            {!busy && failedCount > 0 && doneCount > 0 && onRetryFailed && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-copper/40 bg-copper-soft/40 px-3 py-2.5 text-[13px]">
                    <span className="text-foreground">
                        <span className="text-accent font-semibold">{doneCount}</span> of {entries.length} processed.{" "}
                        <span className="text-destructive font-semibold">{failedCount} failed</span> — retry?
                    </span>
                    <button
                        type="button"
                        onClick={onRetryFailed}
                        className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-foreground text-background text-[12px] font-semibold hover:opacity-90"
                    >
                        <RotateCw size={11} /> Retry {failedCount}
                    </button>
                </div>
            )}

            <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
                {entries.map((e, i) => {
                    const isOver = overId === e.id && dragId !== e.id;
                    return (
                        <div
                            key={e.id}
                            draggable={reorderable && !busy}
                            onDragStart={handleDragStart(e.id)}
                            onDragOver={handleDragOver(e.id)}
                            onDrop={handleDrop(e.id)}
                            onDragEnd={handleDragEnd}
                            className={cn(
                                "group flex items-center gap-2 sm:gap-3 px-3 py-2.5 transition-colors",
                                isOver && "bg-accent/[0.08]",
                                dragId === e.id && "opacity-50",
                                !isOver && "hover:bg-secondary/30",
                                e.status === "failed" && "bg-destructive/[0.04]",
                            )}
                        >
                            {reorderable && (
                                <span
                                    className={cn(
                                        "hidden sm:inline-flex items-center justify-center h-7 w-5 text-muted-foreground/60",
                                        busy ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing hover:text-foreground",
                                    )}
                                    aria-hidden="true"
                                >
                                    <GripVertical size={13} />
                                </span>
                            )}
                            <span className="font-mono text-[10.5px] tracking-wider text-muted-foreground/85 shrink-0 w-6 text-center">
                                {String(i + 1).padStart(2, "0")}
                            </span>
                            <div className="h-8 w-8 rounded-md bg-accent/10 border border-accent/25 flex items-center justify-center shrink-0">
                                <FileText size={14} className="text-accent" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-medium text-foreground">{e.name}</p>
                                <p className="font-mono text-[10.5px] tracking-wide text-muted-foreground mt-0.5 truncate">
                                    {formatFileSize(e.size)}
                                    {e.status === "failed" && e.error && <> · <span className="text-destructive">{e.error}</span></>}
                                </p>
                            </div>
                            <StatusBadge status={e.status} error={e.error} />
                            {reorderable && !busy && (
                                <div className="hidden md:flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        type="button"
                                        onClick={() => onReorder(i, i - 1)}
                                        disabled={i === 0}
                                        aria-label="Move up"
                                        className="h-7 w-7 coarse:h-11 coarse:w-11 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                                    >
                                        <ChevronUp size={13} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onReorder(i, i + 1)}
                                        disabled={i === entries.length - 1}
                                        aria-label="Move down"
                                        className="h-7 w-7 coarse:h-11 coarse:w-11 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-30 disabled:hover:bg-transparent transition-colors"
                                    >
                                        <ChevronDown size={13} />
                                    </button>
                                </div>
                            )}
                            <button
                                type="button"
                                onClick={() => onRemove(e.id)}
                                disabled={busy}
                                aria-label={`Remove ${e.name}`}
                                className="h-7 w-7 coarse:h-11 coarse:w-11 inline-flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-30 transition-colors"
                            >
                                <X size={13} />
                            </button>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
