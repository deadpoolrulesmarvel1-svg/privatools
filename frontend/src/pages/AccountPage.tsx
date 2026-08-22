/**
 * Account and API keys — Signature.
 *
 * Uses the same accountLogic the ported themes drive, so the flow, the request
 * shapes and the error handling stay identical across every skin; only the
 * presentation differs.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Copy, Eye, EyeOff, KeyRound, LifeBuoy, LogOut, Plus, ShieldCheck, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
    accountApi, describeKey, defaultKeyLabel, initialAccountState, strengthOf,
    type AccountState,
} from "@/skins/accountLogic";

export default function AccountPage() {
    const [s, setS] = useState<AccountState>(initialAccountState);
    const patch = useCallback((p: Partial<AccountState>) => setS(prev => ({ ...prev, ...p })), []);

    const loadKeys = useCallback(() => {
        accountApi.listKeys()
            .then(({ keys }) => patch({ keys }))
            .catch(() => { /* best effort */ });
    }, [patch]);

    useEffect(() => {
        accountApi.me()
            .then(({ user }) => { patch({ user }); loadKeys(); })
            .catch(() => { /* signed out is the normal case */ });
    }, [patch, loadKeys]);

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        patch({ busy: true, error: "" });

        if (s.mode === "recover") {
            accountApi.recover(s.email, s.recoveryInput, s.password)
                .then(({ recovery_code }) => patch({
                    busy: false, password: "", recoveryInput: "",
                    mode: "signin", recoveryCode: recovery_code, recoverySaved: false,
                    error: "",
                }))
                .catch((err: Error) => patch({ busy: false, error: err.message }));
            return;
        }

        if (s.mode === "signup") {
            accountApi.register(s.email, s.password)
                .then(({ user, recovery_code }) => {
                    // Shown once. There is no email to resend it to, so the UI
                    // holds here until the user says they have saved it.
                    patch({ user, busy: false, password: "", error: "", recoveryCode: recovery_code });
                    loadKeys();
                })
                .catch((err: Error) => patch({
                    busy: false,
                    error: /already exists/i.test(err.message)
                        ? "That email already has an account — sign in instead."
                        : err.message,
                }));
            return;
        }

        accountApi.login(s.email, s.password)
            .then(({ user }) => { patch({ user, busy: false, password: "", error: "" }); loadKeys(); })
            .catch((err: Error) => patch({ busy: false, error: err.message }));
    };

    const newKey = () => {
        accountApi.createKey(defaultKeyLabel(s.keys))
            .then(({ key, record }) => patch({ freshKey: key, keys: [record, ...s.keys] }))
            .catch((err: Error) => patch({ error: err.message }));
    };

    const revoke = (id: string) => {
        accountApi.revokeKey(id).then(loadKeys).catch((err: Error) => patch({ error: err.message }));
    };

    const signOut = () => {
        accountApi.logout().finally(() => setS(initialAccountState));
    };

    const remove = () => {
        if (!s.confirmingDelete) { patch({ confirmingDelete: true }); return; }
        accountApi.deleteAccount()
            .then(() => setS(initialAccountState))
            .catch((err: Error) => patch({ error: err.message, confirmingDelete: false }));
    };

    const field = "w-full rounded-lg border border-border bg-card px-3 py-2.5 text-[13.5px] text-foreground " +
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

    return (
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
            <h1 className="font-display text-[30px] font-bold tracking-[-0.025em]">
                {s.user ? "Account" : s.mode === "signup" ? "Create an account" : "Sign in"}
            </h1>
            <p className="mt-1.5 text-[14px] text-muted-foreground">
                {s.user
                    ? "Manage the API keys issued to this account."
                    : "Only needed for the developer API. Every tool works without one."}
            </p>

            {s.recoveryCode && (
                <RecoveryPanel
                    code={s.recoveryCode}
                    saved={s.recoverySaved}
                    onSaved={() => patch({ recoveryCode: "", recoverySaved: true })}
                    onAck={() => patch({ recoverySaved: true })}
                />
            )}

            {!s.user && !s.recoveryCode && (
                <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-start">
                    <form onSubmit={submit} className="rounded-2xl border border-border bg-card p-5 grid gap-3">
                        <div className="flex gap-2" role="tablist" aria-label="Account action">
                            {([["signin", "Sign in"], ["signup", "Create account"]] as const).map(([m, label]) => (
                                <button
                                    key={m} type="button" role="tab" aria-selected={s.mode === m}
                                    onClick={() => patch({ mode: m, error: "" })}
                                    className={cn(
                                        "flex-1 h-9 rounded-lg text-[13px] font-medium border transition-colors",
                                        s.mode === m
                                            ? "border-primary bg-primary/10 text-primary"
                                            : "border-border text-muted-foreground hover:text-foreground",
                                    )}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>

                        <label className="grid gap-1.5 text-[12px] text-muted-foreground">
                            Email
                            <input type="email" required autoComplete="email" autoFocus className={field}
                                   value={s.email} onChange={e => patch({ email: e.target.value, error: "" })} />
                        </label>

                        {s.mode === "recover" && (
                            <label className="grid gap-1.5 text-[12px] text-muted-foreground">
                                Recovery code
                                <input
                                    type="text" required autoComplete="one-time-code"
                                    placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
                                    className={cn(field, "font-mono tracking-[0.08em]")}
                                    value={s.recoveryInput}
                                    onChange={e => patch({ recoveryInput: e.target.value, error: "" })}
                                />
                            </label>
                        )}

                        <label className="grid gap-1.5 text-[12px] text-muted-foreground">
                            {s.mode === "recover" ? "New password" : "Password"}
                            <span className="relative block">
                                <input
                                    type={s.showPassword ? "text" : "password"} required className={cn(field, "pr-10")}
                                    autoComplete={s.mode === "signin" ? "current-password" : "new-password"}
                                    value={s.password} onChange={e => patch({ password: e.target.value, error: "" })}
                                />
                                <button
                                    type="button"
                                    onClick={() => patch({ showPassword: !s.showPassword })}
                                    aria-label={s.showPassword ? "Hide password" : "Show password"}
                                    className="absolute right-1 top-1/2 -translate-y-1/2 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                                >
                                    {s.showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                                </button>
                            </span>
                        </label>

                        {s.mode !== "signin" && <StrengthMeter password={s.password} />}

                        {s.error && <p role="alert" className="text-[12.5px] text-destructive">{s.error}</p>}

                        <button type="submit" disabled={s.busy}
                                className="h-10 rounded-lg bg-primary text-primary-foreground text-[13.5px] font-semibold disabled:opacity-60">
                            {s.busy ? "Working…"
                                : s.mode === "signup" ? "Create account"
                                : s.mode === "recover" ? "Reset password"
                                : "Sign in"}
                        </button>

                        <button
                            type="button"
                            onClick={() => patch({ mode: s.mode === "recover" ? "signin" : "recover", error: "" })}
                            className="text-[12px] text-muted-foreground hover:text-foreground underline underline-offset-2 justify-self-start"
                        >
                            {s.mode === "recover" ? "Back to sign in" : "Forgotten your password?"}
                        </button>
                    </form>

                    <aside className="rounded-2xl border border-border bg-secondary/40 p-5">
                        <h2 className="font-display text-[15px] font-semibold flex items-center gap-2">
                            <ShieldCheck size={16} className="text-primary" aria-hidden="true" />
                            You do not need an account
                        </h2>
                        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
                            Every tool works without signing in, and nothing on a tool page asks you to.
                            An account exists for one thing: issuing API keys for the developer API.
                        </p>
                        <p className="mt-2.5 text-[13px] leading-relaxed text-muted-foreground">
                            We store your email address and a scrypt hash of your password — never the
                            password itself. Deleting your account removes both immediately, along with
                            every key.
                        </p>
                        <p className="mt-2.5 flex gap-2 text-[13px] leading-relaxed text-muted-foreground">
                            <LifeBuoy size={15} className="mt-0.5 shrink-0 text-primary" aria-hidden="true" />
                            <span>
                                We send no email — not even a reset link. Instead you get a recovery code
                                at signup. It is the only way back in, so keep it somewhere safe.
                            </span>
                        </p>
                    </aside>
                </div>
            )}

            {s.user && (
                <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)] items-start">
                    <section className="rounded-2xl border border-border bg-card p-5">
                        <div className="flex items-center justify-between gap-3">
                            <h2 className="font-display text-[15px] font-semibold">API keys</h2>
                            <button onClick={newKey}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-[12.5px] font-semibold text-primary-foreground">
                                <Plus size={13} aria-hidden="true" /> New key
                            </button>
                        </div>

                        {s.freshKey && (
                            <div className="mt-3 rounded-xl border border-primary/40 bg-primary/[0.07] p-3">
                                <p className="text-[12px] font-semibold text-primary">Copy this now — it is not shown again</p>
                                <code className="mt-1.5 block break-all font-mono text-[12.5px]">{s.freshKey}</code>
                            </div>
                        )}

                        {s.keys.length === 0 && (
                            <p className="mt-3 text-[13px] text-muted-foreground">
                                No keys yet. Create one to start using the API.
                            </p>
                        )}

                        <ul className="mt-1">
                            {s.keys.map(k => (
                                <li key={k.key_id} className="flex items-center gap-3 border-t border-border py-3">
                                    <KeyRound size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                                    <div className="min-w-0 flex-1">
                                        <p className={cn("text-[13.5px] font-medium", k.revoked && "text-muted-foreground")}>
                                            {k.label}
                                        </p>
                                        <p className="text-[11.5px] text-muted-foreground">{describeKey(k)}</p>
                                    </div>
                                    {!k.revoked && (
                                        <button onClick={() => revoke(k.key_id)} aria-label={`Revoke ${k.label}`}
                                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-[12px] text-destructive">
                                            <Trash2 size={12} aria-hidden="true" /> Revoke
                                        </button>
                                    )}
                                </li>
                            ))}
                        </ul>
                    </section>

                    <aside className="rounded-2xl border border-border bg-secondary/40 p-5">
                        <h2 className="font-display text-[15px] font-semibold">Signed in</h2>
                        <p className="mt-1.5 break-all text-[13px] text-muted-foreground">{s.user.email}</p>
                        <button onClick={signOut}
                                className="mt-4 inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-border text-[13px] font-medium">
                            <LogOut size={13} aria-hidden="true" /> Sign out
                        </button>
                        <button onClick={remove}
                                className="mt-2 h-9 w-full rounded-lg border border-destructive text-[13px] font-medium text-destructive">
                            {s.confirmingDelete ? "Press again to delete for good" : "Delete account"}
                        </button>
                        {s.error && <p role="alert" className="mt-2 text-[12.5px] text-destructive">{s.error}</p>}
                        <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
                            Deleting removes your email, your password hash and every key. It cannot be undone.
                        </p>
                    </aside>
                </div>
            )}
        </div>
    );
}


/** Length-led strength feedback. Colour is never the only signal — the label says it too. */
function StrengthMeter({ password }: { password: string }) {
    const { score, label, hint } = strengthOf(password);
    const tone = ["bg-destructive", "bg-destructive", "bg-copper", "bg-accent-bright", "bg-success"][score];
    return (
        <div aria-live="polite">
            <div className="flex gap-1" aria-hidden="true">
                {[0, 1, 2, 3].map(i => (
                    <span key={i}
                          className={cn("h-1 flex-1 rounded-full transition-colors",
                              password && i < score ? tone : "bg-border")} />
                ))}
            </div>
            <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                {label && <span className="font-medium text-foreground">{label}. </span>}{hint}
            </p>
        </div>
    );
}

/**
 * The recovery code, shown once.
 *
 * This blocks the way forward on purpose. There is no email to resend it to, so
 * a code the user scrolls past is an account they will eventually lose.
 */
function RecoveryPanel({
    code, saved, onSaved, onAck,
}: { code: string; saved: boolean; onSaved: () => void; onAck: () => void }) {
    const [copied, setCopied] = useState(false);
    const copy = () => {
        navigator.clipboard.writeText(code).then(() => { setCopied(true); onAck(); }).catch(() => {});
    };
    return (
        <section className="mt-6 rounded-2xl border border-primary/40 bg-primary/[0.06] p-5">
            <h2 className="font-display text-[16px] font-semibold">Save your recovery code</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
                This is shown once and is the only way back into your account. We send no email, so
                there is no reset link to fall back on.
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="rounded-lg border border-border bg-card px-3 py-2 font-mono text-[15px] tracking-[0.12em]">
                    {code}
                </code>
                <button onClick={copy}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium">
                    {copied ? <Check size={13} className="text-success" /> : <Copy size={13} />}
                    {copied ? "Copied" : "Copy"}
                </button>
            </div>
            <button onClick={onSaved}
                    className="mt-4 h-9 rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground">
                I have saved it
            </button>
            {!saved && (
                <p className="mt-2 text-[11.5px] text-muted-foreground">
                    Write it down or put it in a password manager before continuing.
                </p>
            )}
        </section>
    );
}
