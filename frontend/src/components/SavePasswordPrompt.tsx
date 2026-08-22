/**
 * "Save this password?" — offered after a password the user typed has been
 * proven to work.
 *
 * Only ever shown for a password that actually succeeded, so we never store a
 * wrong guess. The label field warns against putting the password in it,
 * because the label is the one part of an entry stored in the clear.
 */
import { useState } from "react";
import { Check, KeyRound } from "lucide-react";
import * as vault from "@/lib/localStore/vault";

export function SavePasswordPrompt({
  password,
  suggestedLabel,
  onDone,
}: {
  password: string;
  suggestedLabel?: string;
  onDone?: () => void;
}) {
  const [label, setLabel] = useState(suggestedLabel ?? "");
  const [saved, setSaved] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (dismissed || !password) return null;

  if (saved) {
    return (
      <p className="font-medium flex items-center gap-1.5 text-[11px] text-accent">
        <Check size={12} aria-hidden="true" />
        Saved to this device —{" "}
        <a href="/my-stuff" className="underline underline-offset-2">
          manage
        </a>
      </p>
    );
  }

  const save = async () => {
    try {
      await vault.addPassword(label.trim() || "Untitled", password);
      setSaved(true);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save that password.");
    }
  };

  return (
    <div className="rounded-lg border border-border bg-paper-2/40 p-3">
      <p className="font-medium flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <KeyRound size={12} className="text-accent" aria-hidden="true" />
        Save this password for next time?
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder="Name it — e.g. work docs"
          aria-label="Password label"
          className="min-w-0 flex-1 rounded-md border border-border bg-card px-3 py-2 text-[13px] outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <button
          type="button"
          onClick={save}
          className="h-9 shrink-0 rounded-md border border-accent/40 bg-accent/10 px-3 text-[13px] font-medium text-accent hover:bg-accent/15"
        >
          Save
        </button>
        <button
          type="button"
          onClick={() => setDismissed(true)}
          className="h-9 shrink-0 px-2 text-[13px] text-muted-foreground hover:text-foreground"
        >
          No thanks
        </button>
      </div>
      {error && <p className="mt-1.5 text-[12px] text-destructive">{error}</p>}
      <p className="font-medium mt-1.5 text-[11px] text-muted-foreground">
        Encrypted, stored on this device only. Don&apos;t
        put the password in the name.
      </p>
    </div>
  );
}
