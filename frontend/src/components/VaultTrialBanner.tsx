/**
 * Shows what the vault is doing while it tries saved passwords.
 *
 * The "trying" state is deliberately visible. A password manager would unlock
 * silently and it would feel smoother — but stored credentials being used with
 * no visible trace sits badly next to a privacy-first product. The user always
 * sees it happen.
 */
import { KeyRound, Loader2, LockOpen, AlertCircle } from "lucide-react";
import type { TrialState } from "@/hooks/usePdfPasswordTrial";

export function VaultTrialBanner({ state }: { state: TrialState }) {
  if (state.status === "idle" || state.status === "notNeeded") return null;

  const base =
    "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-[13px]";

  if (state.status === "trying") {
    return (
      <div className={`${base} border-border bg-paper-2/40 text-muted-foreground`}>
        <Loader2 size={13} className="shrink-0 animate-spin" aria-hidden="true" />
        Encrypted PDF — trying your saved passwords…
      </div>
    );
  }

  if (state.status === "unlocked") {
    return (
      <div className={`${base} border-accent/30 bg-accent/[0.06] text-accent`}>
        <LockOpen size={13} className="shrink-0" aria-hidden="true" />
        Unlocked with a saved password.
      </div>
    );
  }

  if (state.status === "needed") {
    return (
      <div className={`${base} border-border bg-paper-2/40 text-muted-foreground`}>
        <KeyRound size={13} className="shrink-0" aria-hidden="true" />
        {state.tried === 0
          ? "This PDF is password-protected. Enter its password below."
          : `None of your ${state.tried} saved password${state.tried === 1 ? "" : "s"} fit — enter the password below.`}
      </div>
    );
  }

  return (
    <div className={`${base} border-destructive/30 bg-destructive/[0.06] text-destructive`}>
      <AlertCircle size={13} className="shrink-0" aria-hidden="true" />
      {state.message}
    </div>
  );
}
