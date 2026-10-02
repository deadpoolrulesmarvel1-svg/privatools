/**
 * Say which files an intake refused, for intakes that cannot show it in
 * place (drop zones that hand files straight to useMultiFileProcessor, and
 * files handed over from another tool). FileIntake and MediaUpload show the
 * same words beside the intake instead.
 */
import { toast } from "sonner";
import { adviseRejection, partitionByAccept, type RejectionAdvice } from "./file-acceptance";
import { navigateTo } from "./navigation";

/** The files an `accept` list takes; the others are reported. For files
 *  that arrive without an intake, such as a handoff from another tool. */
export function takeAccepted<T extends File>(files: readonly T[], accepts?: string): T[] {
    const { accepted, rejected } = partitionByAccept(files, accepts);
    if (rejected.length) reportRejectedFiles(rejected, { accepts });
    return accepted;
}

export function reportRejectedFiles(rejected: readonly Pick<File, "name" | "type">[], options?: Parameters<typeof adviseRejection>[1]): void {
    const advice = adviseRejection(rejected, options);
    if (advice) toastRejection(advice);
}

/** Say advice built earlier, such as when the files arrived: advice built
 *  later reads whatever tool page the visitor is on by then. */
export function toastRejection(advice: RejectionAdvice): void {
    const suggestion = advice.suggestion;
    toast.error(advice.headline, {
        description: [advice.reason, suggestion ? `${advice.suggestionLead}${suggestion.name}${advice.suggestionTail}` : ""].filter(Boolean).join(" "),
        // Long enough to read two sentences and reach the action.
        duration: 12_000,
        action: suggestion ? { label: `Open ${suggestion.name}`, onClick: () => navigateTo(suggestion.href) } : undefined,
    });
}
