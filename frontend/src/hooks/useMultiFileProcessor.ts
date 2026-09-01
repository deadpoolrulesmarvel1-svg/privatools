/**
 * useMultiFileProcessor — queue-and-batch hook for tools that accept N PDFs.
 *
 * Design notes:
 *
 *   - Most PDF tool endpoints take a single `file=` field. So we don't try to
 *     coerce the backend; we just loop client-side, one request per file, and
 *     accumulate the result blobs.
 *
 *   - Concurrency is bounded (default 3). PDF endpoints are CPU-bound on the
 *     server (PyMuPDF rendering, image rasterisation). Three in flight lines
 *     up nicely with a typical 4-core worker without head-of-line blocking.
 *
 *   - Per-file status is tracked in a parallel array — UI components render
 *     "queued / running / done / failed" badges off it.
 *
 *   - Partial-failure retry: rerun only files whose status is "failed". The
 *     hook keeps the original blobs from successful runs intact.
 *
 *   - When N=1 the caller can opt to download the raw blob directly (no zip).
 *     We expose the blobs as `results`; the helper `downloadAll()` does the
 *     "N=1 → blob, N>1 → zip" branching so most call sites stay tiny.
 */
import { useCallback, useRef, useState } from "react";
import { uploadFile, downloadBlob, buildOutputFilename } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { friendlyError } from "@/lib/utils";

export type FileStatus = "queued" | "running" | "done" | "failed";

export interface FileEntry {
    id: string;
    file: File;
    name: string;
    size: number;
    status: FileStatus;
    error?: string;
    /** Server-provided filename from Content-Disposition, if any. */
    outName?: string;
    /** Set once the upload succeeds. */
    blob?: Blob;
    /** Custom response headers we surface so tools like Highlight can read
     *  per-file metadata (e.g. X-Highlight-Hits). */
    headers?: Record<string, string>;
}

export interface ProcessOptions {
    /** Backend endpoint. Will be prefixed with /api/. */
    endpoint: string;
    /** Form-data params sent with every file. */
    params?: Record<string, string | number | boolean>;
    /** Output extension for the per-file download name (e.g. "pdf", "docx"). */
    outputExt: string;
    /** Suffix added to the source filename stem (e.g. "compressed"). */
    outputSuffix: string | null;
    /** Concurrency cap. Default 3. */
    concurrency?: number;
}

export interface UseMultiFileProcessorResult {
    entries: FileEntry[];
    /** True while any file is still queued or running. */
    busy: boolean;
    /** True once all entries have a terminal status (done or failed). */
    finished: boolean;
    /** Count of entries with status === "done". */
    doneCount: number;
    /** Count of entries with status === "failed". */
    failedCount: number;
    addFiles: (files: FileList | File[], filter?: (f: File) => boolean) => void;
    removeFile: (id: string) => void;
    clearAll: () => void;
    /** Reorder by moving the entry at `from` to `to`. */
    reorder: (from: number, to: number) => void;
    /** Start processing all queued + failed files (or just failed if retryOnly). */
    run: (opts: ProcessOptions, retryOnly?: boolean) => Promise<void>;
    /** Trigger browser download. Zips if N>1, downloads single blob if N=1. */
    downloadAll: (archiveBaseName: string) => void;
    /** Reset everything back to empty. */
    reset: () => void;
}

let counter = 0;

function makeEntry(file: File): FileEntry {
    return {
        id: `${Date.now().toString(36)}-${++counter}`,
        file,
        name: file.name,
        size: file.size,
        status: "queued",
    };
}

export function useMultiFileProcessor(): UseMultiFileProcessorResult {
    const [entries, setEntries] = useState<FileEntry[]>([]);
    // React defers state-updater callbacks, so code that "reads" state by
    // passing through an updater sees nothing until the next render — which
    // silently emptied run()'s work list. The ref mirror is written
    // synchronously on every mutation and is the source of truth for all
    // imperative reads; setEntries only feeds the render.
    const entriesRef = useRef<FileEntry[]>([]);
    const mutate = useCallback((updater: (prev: FileEntry[]) => FileEntry[]) => {
        entriesRef.current = updater(entriesRef.current);
        setEntries(entriesRef.current);
    }, []);
    // The `inFlight` ref lets the caller call `run()` again without races —
    // we just refuse to start a second pass while one is going.
    const inFlight = useRef(false);

    const addFiles = useCallback((fl: FileList | File[], filter?: (f: File) => boolean) => {
        const arr = Array.from(fl);
        const accepted = filter ? arr.filter(filter) : arr;
        if (!accepted.length) return;
        mutate(prev => [...prev, ...accepted.map(makeEntry)]);
    }, [mutate]);

    const removeFile = useCallback((id: string) => {
        mutate(prev => prev.filter(e => e.id !== id));
    }, [mutate]);

    const clearAll = useCallback(() => mutate(() => []), [mutate]);

    const reorder = useCallback((from: number, to: number) => {
        mutate(prev => {
            if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
            const next = [...prev];
            const [moved] = next.splice(from, 1);
            next.splice(to, 0, moved);
            return next;
        });
    }, [mutate]);

    const reset = useCallback(() => {
        inFlight.current = false;
        mutate(() => []);
    }, [mutate]);

    const run = useCallback(async (opts: ProcessOptions, retryOnly = false) => {
        if (inFlight.current) return;
        inFlight.current = true;

        // Snapshot from the ref — synchronous and stale-closure-free.
        const targetIds = entriesRef.current
            .filter(e => retryOnly ? e.status === "failed" : (e.status === "queued" || e.status === "failed"))
            .map(e => e.id);
        // Mark them as queued (clears prior error states for retry path).
        mutate(prev => prev.map(e => targetIds.includes(e.id) ? { ...e, status: "queued", error: undefined } : e));

        // Tiny semaphore — N workers pull from a shared cursor.
        const concurrency = Math.max(1, opts.concurrency ?? 3);
        let cursor = 0;
        const ids = targetIds; // captured

        const worker = async () => {
            while (true) {
                const idx = cursor++;
                if (idx >= ids.length) return;
                const id = ids[idx];

                // Grab the file from the ref (it might have been removed since)
                const entry = entriesRef.current.find(x => x.id === id);
                const file: File | null = entry?.file ?? null;
                if (!file) continue;
                mutate(prev => prev.map(x => x.id === id ? { ...x, status: "running" } : x));

                try {
                    const res = await uploadFile(opts.endpoint, file as File, opts.params);
                    const blob = await res.blob();
                    // Pull server-supplied filename if present; otherwise build one.
                    const cd = res.headers.get("Content-Disposition") || "";
                    let serverName: string | null = null;
                    const utf8 = cd.match(/filename\*=UTF-8''([^;]+)/i);
                    if (utf8?.[1]) {
                        try { serverName = decodeURIComponent(utf8[1].trim()); } catch { serverName = utf8[1].trim(); }
                    } else {
                        const ascii = cd.match(/filename=(["']?)([^"';]+)\1/i);
                        if (ascii?.[2]) serverName = ascii[2].trim();
                    }
                    const outName = serverName || buildOutputFilename((file as File).name, opts.outputSuffix, opts.outputExt);

                    // Capture all response headers — small cost, lets callers
                    // read tool-specific metadata (e.g. X-Highlight-Hits) without
                    // a second round trip.
                    const headers: Record<string, string> = {};
                    res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });

                    mutate(prev => prev.map(x => x.id === id
                        ? { ...x, status: "done", blob, outName, headers }
                        : x,
                    ));
                } catch (e: unknown) {
                    const raw = e instanceof Error ? e.message : "Failed";
                    const msg = friendlyError(raw, "Processing failed");
                    mutate(prev => prev.map(x => x.id === id
                        ? { ...x, status: "failed", error: msg }
                        : x,
                    ));
                }
            }
        };

        const workers: Promise<void>[] = [];
        for (let i = 0; i < Math.min(concurrency, ids.length); i++) workers.push(worker());
        await Promise.all(workers);

        inFlight.current = false;
    }, [mutate]);

    const downloadAll = useCallback((archiveBaseName: string) => {
        const done = entriesRef.current.filter(e => e.status === "done" && e.blob);
        if (done.length === 0) return;
        if (done.length === 1) {
            const e = done[0];
            downloadBlob(e.blob!, e.outName || e.name);
            return;
        }
        // N>1 → zip them
        const buildAndDownload = async () => {
            const items = await Promise.all(done.map(async e => ({
                name: e.outName || e.name,
                data: new Uint8Array(await e.blob!.arrayBuffer()),
            })));
            const zipBlob = buildZip(items);
            downloadBlob(zipBlob, archiveBaseName.endsWith(".zip") ? archiveBaseName : `${archiveBaseName}.zip`);
        };
        void buildAndDownload();
    }, []);

    // Derive aggregate counts. Cheap to recompute every render.
    const doneCount = entries.filter(e => e.status === "done").length;
    const failedCount = entries.filter(e => e.status === "failed").length;
    const busy = entries.some(e => e.status === "queued" || e.status === "running") && inFlight.current;
    const finished = entries.length > 0 && entries.every(e => e.status === "done" || e.status === "failed");

    return {
        entries,
        busy,
        finished,
        doneCount,
        failedCount,
        addFiles,
        removeFile,
        clearAll,
        reorder,
        run,
        downloadAll,
        reset,
    };
}
