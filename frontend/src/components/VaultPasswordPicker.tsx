/**
 * Pick a saved password by label.
 *
 * Used by tools that take an OWNER password. pdf.js cannot verify an owner
 * password — it opens such files with an empty user password — so these tools
 * offer autofill rather than the automatic trial UnlockUI gets. The UI says so
 * instead of silently behaving differently from the tool next door.
 *
 * Renders nothing when the vault is empty, so a tool page gets no empty-state
 * noise for a feature the user has never used.
 */
import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import * as vault from "@/lib/localStore/vault";

export function VaultPasswordPicker({
  onPick,
  className,
}: {
  onPick: (password: string) => void;
  className?: string;
}) {
  const [entries, setEntries] = useState<vault.VaultEntryMeta[]>([]);

  useEffect(() => {
    let alive = true;
    void vault
      .listEntries()
      .then((e) => {
        if (alive) setEntries(e);
      })
      .catch(() => {
        /* vault unavailable (no IndexedDB / no WebCrypto) — render nothing */
      });
    return () => {
      alive = false;
    };
  }, []);

  if (entries.length === 0) return null;

  return (
    <div className={className ?? "mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"}>
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />
        Use a saved password:
      </span>
      {entries.map((e) => (
        <button
          key={e.id}
          type="button"
          className="underline underline-offset-2 hover:text-accent"
          onClick={async () => {
            try {
              onPick(await vault.revealPassword(e.id));
            } catch {
              /* entry unreadable — /my-stuff surfaces and offers to purge it */
            }
          }}
        >
          {e.label}
        </button>
      ))}
    </div>
  );
}
