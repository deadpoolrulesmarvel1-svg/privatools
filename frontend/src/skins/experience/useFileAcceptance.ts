import { useEffect, useRef, useState } from "react";
import { adviseRejection, partitionByAccept, type RejectionAdvice } from "@/lib/file-acceptance";
import { toastRejection } from "@/lib/report-rejected-files";

/** How long a refusal notice counts as just shown. */
const FRESH_MS = 1500;

/**
 * Take files by an `accept` list; anything else becomes a notice beside the
 * intake that refused it.
 *
 * Taking the accepted part of a mixed selection often replaces the intake: a
 * chosen file takes its place, or a result screen gives way to the form. The
 * notice would then disappear in the same update, unread. If the intake goes
 * away while its notice is fresh, the refusal is said again in a toast, so no
 * refused file goes unmentioned. The toast says the advice built when the
 * files arrived, and only on the page they arrived on: built later, it would
 * name whatever tool the visitor had moved to.
 */
export function useFileAcceptance(accepts: string | undefined, onFiles: (files: File[]) => void) {
    const [advice, setAdvice] = useState<RejectionAdvice | null>(null);
    const fresh = useRef<{ advice: RejectionAdvice; path: string; at: number } | null>(null);
    useEffect(() => () => {
        const pending = fresh.current;
        if (pending && Date.now() - pending.at < FRESH_MS && window.location.pathname === pending.path) toastRejection(pending.advice);
    }, []);
    const receive = (files: File[]) => {
        const { accepted, rejected } = partitionByAccept(files, accepts);
        const next = adviseRejection(rejected, { accepts });
        setAdvice(next);
        fresh.current = next && accepted.length ? { advice: next, path: window.location.pathname, at: Date.now() } : null;
        if (accepted.length) onFiles(accepted);
    };
    const dismiss = () => { fresh.current = null; setAdvice(null); };
    return { advice, receive, dismiss };
}
