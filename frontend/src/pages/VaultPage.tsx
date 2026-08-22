/**
 * Vault — Signature.
 *
 * The same device-local vault the ported themes use: AES-GCM under a key this
 * browser generated non-extractable, so it can never be read out or moved to
 * another device.
 */
import { useCallback, useEffect, useState } from "react";
import { Copy, Eye, EyeOff, Lock, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { vaultApi, describeEntry, initialVaultState, type VaultState } from "@/skins/vaultLogic";

export default function VaultPage() {
    const [s, setS] = useState<VaultState>(initialVaultState);
    const patch = useCallback((p: Partial<VaultState>) => setS(prev => ({ ...prev, ...p })), []);

    const load = useCallback(() => {
        vaultApi.load()
            .then(({ entries, unreadable }) => patch({ entries, unreadable }))
            .catch((err: Error) => patch({ error: err.message }));
    }, [patch]);

    useEffect(load, [load]);

    const add = (e: React.FormEvent) => {
        e.preventDefault();
        if (!s.label.trim()) { patch({ error: "Give it a name so you can find it again." }); return; }
        if (!s.password) { patch({ error: "Enter the password to store." }); return; }
        patch({ busy: true, error: "" });
        vaultApi.add(s.label.trim(), s.password)
            .then(() => { patch({ busy: false, label: "", password: "" }); load(); })
            .catch((err: Error) => patch({ busy: false, error: err.message }));
    };

    const reveal = (id: string) => {
        if (s.revealedId === id) { patch({ revealedId: "", revealedValue: "" }); return; }
        vaultApi.reveal(id)
            .then(value => patch({ revealedId: id, revealedValue: value }))
            .catch((err: Error) => patch({ error: err.message }));
    };

    const copy = (id: string) => {
        vaultApi.reveal(id)
            .then(v => navigator.clipboard.writeText(v))
            .catch((err: Error) => patch({ error: err.message }));
    };

    const remove = (id: string) => {
        vaultApi.remove(id).then(() => { patch({ revealedId: "", revealedValue: "" }); load(); })
            .catch((err: Error) => patch({ error: err.message }));
    };

    const clear = () => {
        if (!s.confirmingClear) { patch({ confirmingClear: true }); return; }
        vaultApi.clear().then(() => { setS(initialVaultState); load(); })
            .catch((err: Error) => patch({ error: err.message, confirmingClear: false }));
    };

    const field = "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-[13.5px] " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
    const iconBtn = "inline-flex shrink-0 h-8 w-8 coarse:h-11 coarse:w-11 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground";

    return (
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
            <h1 className="font-display text-[30px] font-bold tracking-[-0.025em]">Vault</h1>
            <p className="mt-1.5 text-[14px] text-muted-foreground">
                Passwords for locked documents, encrypted on this device. {s.entries.length} stored.
            </p>

            <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-start">
                <section className="rounded-2xl border border-border bg-card p-5">
                    <h2 className="font-display text-[15px] font-semibold">Stored passwords</h2>

                    {s.entries.length === 0 && (
                        <p className="mt-2.5 text-[13px] text-muted-foreground">
                            Nothing stored yet. Add a password and PrivaTools will try it automatically
                            when you open a locked file.
                        </p>
                    )}
                    {s.unreadable > 0 && (
                        <p role="status" className="mt-2.5 text-[12.5px] text-destructive">
                            {s.unreadable} entr{s.unreadable === 1 ? "y" : "ies"} cannot be read with this browser&rsquo;s key.
                        </p>
                    )}

                    <ul className="mt-1">
                        {s.entries.map(e => {
                            const shown = s.revealedId === e.id;
                            return (
                                <li key={e.id} className="flex items-center gap-2.5 border-t border-border py-3">
                                    <Lock size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[13.5px] font-medium">{e.label}</p>
                                        <p className={cn("font-mono text-[12.5px]", !shown && "text-muted-foreground")}>
                                            {shown ? s.revealedValue : "••••••••••••"}
                                        </p>
                                        <p className="text-[11px] text-muted-foreground">{describeEntry(e)}</p>
                                    </div>
                                    <button onClick={() => reveal(e.id)} className={iconBtn}
                                            aria-label={`${shown ? "Hide" : "Reveal"} password for ${e.label}`}>
                                        {shown ? <EyeOff size={13} /> : <Eye size={13} />}
                                    </button>
                                    <button onClick={() => copy(e.id)} className={iconBtn} aria-label={`Copy password for ${e.label}`}>
                                        <Copy size={13} />
                                    </button>
                                    <button onClick={() => remove(e.id)} aria-label={`Delete password for ${e.label}`}
                                            className={cn(iconBtn, "text-destructive")}>
                                        <Trash2 size={13} />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>

                    {s.entries.length > 0 && (
                        <button onClick={clear}
                                className="mt-4 h-8 rounded-lg border border-border px-3 text-[12px] text-destructive">
                            {s.confirmingClear ? "Press again to erase every entry" : "Erase the vault"}
                        </button>
                    )}
                </section>

                <form onSubmit={add} className="rounded-2xl border border-border bg-secondary/40 p-5">
                    <h2 className="font-display text-[15px] font-semibold">Add a password</h2>
                    <label className="mt-3 grid gap-1.5 text-[12px] text-muted-foreground">
                        Name
                        <input type="text" className={field} placeholder="e.g. Bank statements"
                               value={s.label} onChange={e => patch({ label: e.target.value, error: "" })} />
                    </label>
                    <label className="mt-2.5 grid gap-1.5 text-[12px] text-muted-foreground">
                        Password
                        <input type="password" autoComplete="off" className={field}
                               value={s.password} onChange={e => patch({ password: e.target.value, error: "" })} />
                    </label>
                    {s.error && <p role="alert" className="mt-2 text-[12.5px] text-destructive">{s.error}</p>}
                    <button type="submit" disabled={s.busy}
                            className="mt-3 h-10 w-full rounded-lg bg-primary text-[13.5px] font-semibold text-primary-foreground disabled:opacity-60">
                        {s.busy ? "Saving…" : "Save password"}
                    </button>
                    <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
                        Encrypted with a key this browser generated and cannot export. That means it never
                        leaves this device — and it cannot sync to another one. Clearing site data erases it.
                    </p>
                </form>
            </div>
        </div>
    );
}
