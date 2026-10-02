import { useEffect, useRef } from "react";

/**
 * The download policy for a tool that makes files (DESIGN.md): a finished
 * run's result downloads by itself, once (one file, or one ZIP for several),
 * and the result then offers "Download again" (downloadAgainLabel). Editors,
 * where the visitor reviews or edits before saving, keep an explicit download
 * instead and do not use this.
 *
 * `finished` is true while a run's result is shown, and `results` counts what
 * it made: nothing downloads when nothing was made. Leaving the result (a new
 * run, "Try again", starting over) arms it for the next one, so every finished
 * run downloads exactly once, never twice.
 */
export function useDownloadOnce(finished: boolean, results: number, download: () => void): void {
    const done = useRef(false);
    const latest = useRef(download);
    latest.current = download;
    useEffect(() => {
        if (!finished) { done.current = false; return; }
        if (results <= 0 || done.current) return;
        done.current = true;
        latest.current();
    }, [finished, results]);
}
