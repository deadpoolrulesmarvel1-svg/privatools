/**
 * MultiFileQueue — render the per-file row list used by every multi-file tool.
 *
 * Talks to a `useMultiFileProcessor()` result. Doesn't fetch anything itself;
 * just renders status, lets the user reorder/remove, and exposes a "Clear all"
 * and, after a partial run, a "Try again" for the failures another attempt
 * could fix (connection, time limit, rate limit, server fault). Each failed
 * file says its reason on its row; a file the tool refused gets no retry.
 *
 * Tool screens now show their chosen files with the shared kit's rows
 * (ProcessorFiles in skins/experience/ProcessorStudio.tsx) and end on
 * ProcessorResult; this queue stays for screens that still use it.
 *
 * Drag-reorder uses HTML5 DnD (no library) with a GripVertical handle. Falls
 * back to ChevronUp/Down buttons for keyboard / touch users.
 */
import type { FileEntry } from "@/hooks/useMultiFileProcessor";
import { cn } from "@/lib/utils";
import "./multi-file-queue.css";
import { formatFileSize } from "@/lib/api";
import {
    FileText, X, GripVertical, ChevronUp, ChevronDown, Loader2, CheckCircle2,
    AlertCircle, Clock, RotateCw,
} from "lucide-react";
import { useState } from "react";
import { retryKinds, retryLine } from "@/skins/experience/studio-outcome";

interface Props {
    entries: FileEntry[];
    /** Allow drag reorder? Some tools (e.g. Compress) don't care. Default true. */
    reorderable?: boolean;
    onRemove: (id: string) => void;
    onReorder: (from: number, to: number) => void;
    onClearAll: () => void;
    /** Run again only the failures another attempt could fix: `run(opts, "transient")`. */
    onRetryFailed?: () => void;
    /** Whether processing is in flight — disables interactive controls. */
    busy?: boolean;
}

function StatusBadge({ status, error }: { status: FileEntry["status"]; error?: string }) {
    if (status === "queued") {
        return (
            <span className="font-medium inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                <Clock size={10} /> Queued
            </span>
        );
    }
    if (status === "running") {
        return (
            <span className="font-medium inline-flex items-center gap-1 text-[11px] text-accent">
                <Loader2 size={10} className="animate-spin" /> Running
            </span>
        );
    }
    if (status === "done") {
        return (
            <span className="font-medium inline-flex items-center gap-1 text-[11px] text-accent">
                <CheckCircle2 size={10} /> Done
            </span>
        );
    }
    return (
        <span
            className="font-medium inline-flex items-center gap-1 text-[11px] text-destructive"
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
    const retryable = retryKinds(entries);
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
        <section className="mq-workspace" aria-label="File queue">
            {/* Header row: count, total size, Clear all */}
            <div className="mq-heading">
                <span className="mq-summary">
                    {entries.length} file{entries.length === 1 ? "" : "s"} ·{" "}
                    {formatFileSize(totalSize)}
                    {doneCount > 0 && <> · <span className="text-accent">{doneCount} done</span></>}
                    {failedCount > 0 && <> · <span className="text-destructive">{failedCount} failed</span></>}
                </span>
                <div className="flex items-center gap-2">
                    {!busy && entries.length > 0 && (
                        <button
                            type="button"
                            onClick={onClearAll}
                            className="font-medium text-[11px] text-muted-foreground hover:text-destructive transition-colors"
                        >
                            Clear all
                        </button>
                    )}
                </div>
            </div>

            {/* Partial run: a retry only for the failures another attempt could fix. */}
            {!busy && retryable.length > 0 && doneCount > 0 && onRetryFailed && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-copper/40 bg-copper-soft/40 px-3 py-2.5 text-[13px]">
                    <span className="text-foreground">
                        {doneCount} of {entries.length} processed. {retryLine(retryable)}
                    </span>
                    <button
                        type="button"
                        onClick={onRetryFailed}
                        className="inline-flex items-center gap-1.5 h-7 px-3 rounded-md bg-foreground text-background text-[12px] font-semibold hover:opacity-90"
                    >
                        <RotateCw size={11} /> {retryable.length > 1 ? `Try ${retryable.length} again` : "Try again"}
                    </button>
                </div>
            )}

            <div className="mq-list">
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
                                "mq-row",
                                isOver && "bg-accent/[0.08]",
                                dragId === e.id && "opacity-50",
                                !isOver && "hover:bg-secondary/30",
                                e.status === "failed" && "bg-destructive/[0.04]",
                            )}
                        >
                            {reorderable && (
                                <span
                                    className={cn(
                                        "hidden sm:inline-flex items-center justify-center h-7 w-5 text-muted-foreground",
                                        busy ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing hover:text-foreground",
                                    )}
                                    aria-hidden="true"
                                >
                                    <GripVertical size={13} />
                                </span>
                            )}
                            <span className="mq-number">
                                {String(i + 1).padStart(2, "0")}
                            </span>
                            <div className="h-8 w-8 rounded-md bg-accent/10 border border-accent/25 flex items-center justify-center shrink-0">
                                <FileText size={14} className="text-accent" />
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-medium text-foreground">{e.name}</p>
                                <p className="mq-file-detail">
                                    {formatFileSize(e.size)}
                                    {e.status === "failed" && e.error && <> · <span className="text-destructive">{e.error}</span></>}
                                </p>
                            </div>
                            <StatusBadge status={e.status} error={e.error} />
                            {reorderable && !busy && (
                                <div className="mq-order-controls">
                                    <button
                                        type="button"
                                        onClick={() => onReorder(i, i - 1)}
                                        disabled={i === 0}
                                        aria-label={`Move ${e.name} up`}
                                        className="mq-order-button"
                                    >
                                        <ChevronUp size={13} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => onReorder(i, i + 1)}
                                        disabled={i === entries.length - 1}
                                        aria-label={`Move ${e.name} down`}
                                        className="mq-order-button"
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
                                className="mq-remove-button"
                            >
                                <X size={13} />
                            </button>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
