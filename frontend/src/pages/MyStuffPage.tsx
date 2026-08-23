/**
 * MyStuffPage — everything PrivaTools has stored on this device.
 *
 * The point of this page is not convenience, it's accountability. The site's
 * pitch is "no account, nothing retained", and this feature set starts storing
 * real things locally — passwords, signatures, company logos, defaults. Users
 * need to see that inventory and be able to destroy it in one action.
 *
 * Two rules the copy here follows:
 *   1. Never overclaim. The vault is encrypted under a non-extractable key,
 *      which stops casual access — a shared machine, a synced profile, a
 *      pasted console snippet. It does NOT stop script running on this origin.
 *      Say so.
 *   2. Never render a stored password. Labels only; revealing is a deliberate
 *      per-entry action.
 */
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  Download,
  Eye,
  EyeOff,
  HardDrive,
  KeyRound,
  Trash2,
} from "lucide-react";
import * as vault from "@/lib/localStore/vault";
import * as counters from "@/lib/localStore/counters";
import * as assets from "@/lib/localStore/assets";
import * as toolDefaults from "@/lib/localStore/defaults";
import { eraseEverything, exportSetup, inventory, type Inventory } from "@/lib/localStore/inventory";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function Row({
  label,
  detail,
  children,
}: {
  label: string;
  detail: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 border-b border-border py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold text-accent">
          {label}
        </div>
        <div className="mt-0.5 text-sm text-foreground">{detail}</div>
      </div>
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  );
}

export default function MyStuffPage() {
  const [inv, setInv] = useState<Inventory | null>(null);
  const [entries, setEntries] = useState<vault.VaultEntryMeta[]>([]);
  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [next, list] = await Promise.all([inventory(), vault.listEntries()]);
    setInv(next);
    setEntries(list);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reveal = async (id: string) => {
    if (revealed[id]) {
      setRevealed((r) => {
        const next = { ...r };
        delete next[id];
        return next;
      });
      return;
    }
    try {
      const password = await vault.revealPassword(id);
      setRevealed((r) => ({ ...r, [id]: password }));
    } catch {
      /* unreadable — the warning row already covers this */
    }
  };

  const doExport = async () => {
    const blob = await exportSetup();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "privatools-setup.json";
    a.click();
    URL.revokeObjectURL(url);
  };

  const doErase = async () => {
    setBusy(true);
    await eraseEverything();
    setRevealed({});
    setConfirming(false);
    await refresh();
    setBusy(false);
  };

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        Back
      </Link>

      <header className="mt-6 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">
          <HardDrive className="h-6 w-6 text-accent" aria-hidden="true" />
          My Stuff
        </h1>
        <p className="font-medium text-[12px] text-muted-foreground">
          Stored on this device only
        </p>
      </header>

      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
        PrivaTools needs no account and never uploads any of this. Everything below lives in
        this browser, on this device, and goes away if you clear your browsing data.
      </p>

      {inv && !inv.available.indexedDb && (
        <p className="mt-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
          This browser is blocking local storage (private mode, or storage disabled), so nothing
          will be remembered between visits. Every tool still works.
        </p>
      )}
      {inv && inv.available.indexedDb && !inv.available.webCrypto && (
        <p className="mt-4 rounded-lg border border-border bg-card p-3 text-sm text-muted-foreground">
          This browser doesn&apos;t support WebCrypto, so the password vault is unavailable.
          Everything else works.
        </p>
      )}

      {inv && inv.vault.unreadable > 0 && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
          <div>
            {plural(inv.vault.unreadable, "saved password")} can&apos;t be read any more — the
            encryption key for them is gone (usually because browsing data was partly cleared).
            <button
              type="button"
              className="ml-1 underline underline-offset-2"
              onClick={async () => {
                await vault.clearVault();
                await refresh();
              }}
            >
              Remove them
            </button>
          </div>
        </div>
      )}

      <section className="mt-6 rounded-xl border border-border bg-card px-4 py-1 sm:px-5">
        {inv?.isEmpty ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            Nothing stored on this device yet. Save a password, a signature, or your settings in
            any tool and it will show up here.
          </p>
        ) : (
          <>
            {inv && inv.vault.count > 0 && (
              <Row label="Vault" detail={`${plural(inv.vault.count, "password")} · encrypted`}>
                <button
                  type="button"
                  className="text-sm underline underline-offset-2 hover:text-accent"
                  onClick={async () => {
                    await vault.clearVault();
                    setRevealed({});
                    await refresh();
                  }}
                >
                  Clear
                </button>
              </Row>
            )}

            {entries.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between gap-3 border-b border-border/60 py-2 pl-4 text-sm last:border-b-0"
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{e.label}</span>
                  {revealed[e.id] && (
                    <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {revealed[e.id]}
                    </code>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => reveal(e.id)}
                    aria-label={revealed[e.id] ? `Hide ${e.label}` : `Show ${e.label}`}
                    className="inline-flex shrink-0 items-center justify-center h-6 w-6 coarse:h-11 coarse:w-11 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
                  >
                    {revealed[e.id] ? (
                      <EyeOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Eye className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                  <button
                    type="button"
                    aria-label={`Delete ${e.label}`}
                    className="inline-flex shrink-0 items-center justify-center h-6 w-6 coarse:h-11 coarse:w-11 rounded-md text-muted-foreground hover:text-destructive hover:bg-secondary transition-colors"
                    onClick={async () => {
                      await vault.deleteEntry(e.id);
                      await refresh();
                    }}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                  </button>
                </span>
              </div>
            ))}

            {inv && inv.assets.count > 0 && (
              <Row
                label="Assets"
                detail={`${plural(inv.assets.count, "file")} · ${formatBytes(inv.assets.bytes)}`}
              >
                <button
                  type="button"
                  className="text-sm underline underline-offset-2 hover:text-accent"
                  onClick={async () => {
                    await assets.clearAssets();
                    await refresh();
                  }}
                >
                  Clear
                </button>
              </Row>
            )}

            {inv && inv.counters.count > 0 && (
              <Row
                label="Bates"
                detail={`${plural(inv.counters.count, "matter")} · next ${inv.counters.activeLabel ?? "—"}`}
              >
                <span className="font-mono text-sm">{inv.counters.activeLabel}</span>
              </Row>
            )}

            {inv && inv.defaults.count > 0 && (
              <Row
                label="Defaults"
                detail={`${plural(inv.defaults.count, "tool")} customized`}
              >
                <button
                  type="button"
                  className="text-sm underline underline-offset-2 hover:text-accent"
                  onClick={async () => {
                    await toolDefaults.clearAll();
                    await refresh();
                  }}
                >
                  Clear
                </button>
              </Row>
            )}
          </>
        )}
      </section>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={doExport}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:border-accent/40"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          Export my setup
        </button>

        {confirming ? (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={doErase}
              className="inline-flex items-center gap-2 rounded-lg border border-destructive bg-destructive/10 px-3 py-2 text-sm text-destructive disabled:opacity-60"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Yes, erase it all
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="text-sm text-muted-foreground underline underline-offset-2"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm text-destructive hover:border-destructive/40"
          >
            <Trash2 className="h-4 w-4" aria-hidden="true" />
            Erase everything
          </button>
        )}
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
        The export excludes your password vault. Its encryption key is deliberately
        non-extractable, so it cannot be copied off this device — not by us, and not by anything
        else.
      </p>

      <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
        <strong className="font-medium text-foreground">About the encryption.</strong> Saved
        passwords are encrypted with a key that can never be exported from this browser. That
        protects against casual access — a shared computer, a synced browser profile, a pasted
        console snippet. It does not protect against malicious code running on this page itself;
        our{" "}
        <Link to="/security" className="underline underline-offset-2">
          content-security policy
        </Link>{" "}
        is what guards that. If a document is highly sensitive, don&apos;t save its password.
      </p>
    </main>
  );
}
