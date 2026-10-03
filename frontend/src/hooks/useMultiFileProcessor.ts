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
 *   - Partial-failure retry: rerun only files whose status is "failed", or
 *     with `run(opts, "transient")` only those that failed for a reason that
 *     can pass (connection, time limit, rate limit, server fault). A file the
 *     tool refused would fail the same way again. Successful blobs stay intact.
 *
 *   - A file the caller's filter refuses is never dropped silently: addFiles
 *     returns it and, unless told otherwise, says so in a toast that names the
 *     file and the tool that takes it.
 *
 *   - When N=1 the caller can opt to download the raw blob directly (no zip).
 *     We expose the blobs as `results`; the helper `downloadAll()` does the
 *     "N=1 → blob, N>1 → zip" branching so most call sites stay tiny.
 */
import { useCallback, useRef, useState } from "react";
import { uploadFile, downloadBlob, buildOutputFilename, chooseDownloadFilename, hasUserMessage, type UploadOptions } from "@/lib/api";
import { buildZip } from "@/lib/zip";
import { friendlyError } from "@/lib/utils";
import { emitToolRun, isTransientFailure, runOutcome, toolErrorKind, type ToolErrorKind } from "@/lib/toolRun";
import { reportRejectedFiles } from "@/lib/report-rejected-files";

export type FileStatus = "queued" | "running" | "done" | "failed";

export interface FileEntry {
    id: string;
    file: File;
    name: string;
    size: number;
    status: FileStatus;
    error?: string;
    /** Why the file failed, in the fixed categories of lib/toolRun.ts. */
    errorKind?: ToolErrorKind;
    /** A failure trying again could fix: connection, time limit, rate limit
     *  or a server fault. False when the tool refused the file itself. */
    retryable?: boolean;
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
    /** Per-upload options (timeout, retries) passed through to uploadFile. */
    uploadOptions?: UploadOptions;
    /** Client-side processor — when set, files never leave the browser:
     *  the worker calls this instead of POSTing to `endpoint`. */
    localProcess?: (file: File) => Promise<LocalResult>;
}

export interface LocalResult {
    blob: Blob;
    outName?: string;
    /** Set when the processor handled the file but could not do its job on it
     *  (an image with no watermark to remove, say) and returned it unchanged.
     *  The file still counts as done on the page; the run's usage signal
     *  counts it as a failure of this kind, so such misses stay visible. */
    unchanged?: ToolErrorKind;
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
    /** Count of failed entries that trying again could fix. */
    retryableCount: number;
    /** Queue the files the filter accepts and return the ones it refused.
     *  Refused files are reported in a toast unless `report` is false, for
     *  callers that show them beside their own intake. */
    addFiles: (files: FileList | File[], filter?: (f: File) => boolean, options?: { report?: boolean }) => File[];
    removeFile: (id: string) => void;
    clearAll: () => void;
    /** Reorder by moving the entry at `from` to `to`. */
    reorder: (from: number, to: number) => void;
    /** Start processing all queued + failed files; `true` retries only the
     *  failed ones, `"transient"` only those that trying again could fix.
     *  Resolves with the entries this run took, as it left them. Read the
     *  outcome from that, not from `entries` or the counts: a callback made in
     *  an earlier render still holds that render's values after the await. */
    run: (opts: ProcessOptions, retryOnly?: boolean | "transient") => Promise<FileEntry[]>;
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

    const addFiles = useCallback((fl: FileList | File[], filter?: (f: File) => boolean, options?: { report?: boolean }) => {
        const arr = Array.from(fl);
        const accepted = filter ? arr.filter(filter) : arr;
        const rejected = filter ? arr.filter(file => !accepted.includes(file)) : [];
        if (rejected.length && options?.report !== false) reportRejectedFiles(rejected);
        if (accepted.length) mutate(prev => [...prev, ...accepted.map(makeEntry)]);
        return rejected;
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

    const run = useCallback(async (opts: ProcessOptions, retryOnly: boolean | "transient" = false): Promise<FileEntry[]> => {
        if (inFlight.current) return [];
        inFlight.current = true;

        // Snapshot from the ref — synchronous and stale-closure-free.
        const targetIds = entriesRef.current
            .filter(e => retryOnly === "transient" ? e.status === "failed" && e.retryable
                : retryOnly ? e.status === "failed" : (e.status === "queued" || e.status === "failed"))
            .map(e => e.id);
        // Mark them as queued (clears prior error states for retry path).
        mutate(prev => prev.map(e => targetIds.includes(e.id) ? { ...e, status: "queued", error: undefined, errorKind: undefined, retryable: undefined } : e));

        // Tiny semaphore — N workers pull from a shared cursor.
        const concurrency = Math.max(1, opts.concurrency ?? 3);
        let cursor = 0;
        // The first failure names the run's error category in the usage signal.
        let firstFailure: unknown = null;
        // Files a local processor returned unchanged, with why (LocalResult.unchanged).
        const unchanged = new Map<string, ToolErrorKind>();
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
                    if (opts.localProcess) {
                        const out = await opts.localProcess(file as File);
                        if (out.unchanged) unchanged.set(id, out.unchanged);
                        const outName = out.outName || buildOutputFilename((file as File).name, opts.outputSuffix, opts.outputExt);
                        mutate(prev => prev.map(x => x.id === id
                            ? { ...x, status: "done", blob: out.blob, outName, headers: {} }
                            : x,
                        ));
                        continue;
                    }
                    const res = await uploadFile(opts.endpoint, file as File, opts.params, opts.uploadOptions);
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
                    // As every other download: a generic server name such as
                    // "converted.docx" does not replace the file's own.
                    const outName = chooseDownloadFilename(
                        buildOutputFilename((file as File).name, opts.outputSuffix, opts.outputExt), serverName);

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
                    firstFailure ??= e;
                    const raw = e instanceof Error ? e.message : "Failed";
                    const msg = hasUserMessage(e) ? raw : friendlyError(raw, "Processing failed");
                    const kind = toolErrorKind(e);
                    // A cancelled file can simply run again.
                    const retryable = kind === "cancelled" || isTransientFailure(e);
                    mutate(prev => prev.map(x => x.id === id
                        ? { ...x, status: "failed", error: msg, errorKind: kind === "cancelled" ? undefined : kind, retryable }
                        : x,
                    ));
                }
            }
        };

        const workers: Promise<void>[] = [];
        for (let i = 0; i < Math.min(concurrency, ids.length); i++) workers.push(worker());
        await Promise.all(workers);

        // One usage signal per run, counting only the files this run touched.
        // A file returned unchanged counts as a failure there, never as a success.
        const touched = entriesRef.current.filter(e => ids.includes(e.id));
        const done = touched.filter(e => e.status === "done").length;
        const failed = touched.filter(e => e.status === "failed").length;
        const missed = touched.filter(e => e.status === "done" && unchanged.has(e.id));
        const outcome = runOutcome(done - missed.length, failed + missed.length);
        const missKind = firstFailure === null && missed.length ? unchanged.get(missed[0].id) : undefined;
        if (outcome) emitToolRun({ mode: "single", outcome, files: done + failed, ...(missKind ? { errorKind: missKind } : {}) }, firstFailure);

        inFlight.current = false;
        return touched;
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
    const retryableCount = entries.filter(e => e.status === "failed" && e.retryable).length;
    const busy = entries.some(e => e.status === "queued" || e.status === "running") && inFlight.current;
    const finished = entries.length > 0 && entries.every(e => e.status === "done" || e.status === "failed");

    return {
        entries,
        busy,
        finished,
        doneCount,
        failedCount,
        retryableCount,
        addFiles,
        removeFile,
        clearAll,
        reorder,
        run,
        downloadAll,
        reset,
    };
}
