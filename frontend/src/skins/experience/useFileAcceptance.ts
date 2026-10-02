import { useEffect, useRef, useState } from "react";
import { adviseRejection, partitionByAccept, type RejectionAdvice } from "@/lib/file-acceptance";
import { reportRejectedFiles } from "@/lib/report-rejected-files";

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
 * refused file goes unmentioned.
 */
export function useFileAcceptance(accepts: string | undefined, onFiles: (files: File[]) => void) {
    const [advice, setAdvice] = useState<RejectionAdvice | null>(null);
    const fresh = useRef<{ rejected: File[]; accepts?: string; at: number } | null>(null);
    useEffect(() => () => {
        const pending = fresh.current;
        if (pending && Date.now() - pending.at < FRESH_MS) reportRejectedFiles(pending.rejected, { accepts: pending.accepts });
    }, []);
    const receive = (files: File[]) => {
        const { accepted, rejected } = partitionByAccept(files, accepts);
        setAdvice(adviseRejection(rejected, { accepts }));
        fresh.current = rejected.length && accepted.length ? { rejected, accepts, at: Date.now() } : null;
        if (accepted.length) onFiles(accepted);
    };
    const dismiss = () => { fresh.current = null; setAdvice(null); };
    return { advice, receive, dismiss };
}
