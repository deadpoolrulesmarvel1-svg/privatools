/**
 * Sign in with Google, GitHub or Apple.
 *
 * The reason moving identity to Clerk was worth doing. An account here exists
 * to issue API keys for the developer API, so the people creating one are
 * developers — and asking a developer to invent a fifteen-character password
 * for a key-management page, when they are already signed in to GitHub, is
 * asking for the wrong thing. It also removes the password entirely: no scrypt,
 * no per-account lockout, and no recovery code that used to be the only way
 * back in.
 *
 * The marks are inline SVG rather than images. The policy is `img-src 'self'
 * data: blob:` plus one Clerk host, so a remote logo would simply be blocked —
 * and inline means no extra request on a page that should be quick.
 *
 * Renders nothing when the deployment has no Clerk keys, because there is
 * nothing behind the buttons to authenticate against.
 */

import { useState } from "react";
import { SOCIAL_SIGN_IN, accountApi, type SocialProvider } from "@/skins/accountLogic";
import { cn } from "@/lib/utils";

function Mark({ id }: { id: SocialProvider }) {
    const common = { width: 17, height: 17, viewBox: "0 0 24 24", "aria-hidden": true as const };
    if (id === "google") {
        return (
            <svg {...common}>
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.76h3.57c2.08-1.92 3.28-4.74 3.28-8.09Z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.76c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z" />
                <path fill="#FBBC05" d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1a11 11 0 0 0-9.82 6.05l3.66 2.84c.87-2.6 3.3-4.51 6.16-4.51Z" />
            </svg>
        );
    }
    if (id === "github") {
        return (
            <svg {...common} fill="currentColor">
                <path d="M12 .5A11.5 11.5 0 0 0 .5 12a11.5 11.5 0 0 0 7.86 10.92c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.34-1.29-1.7-1.29-1.7-1.05-.72.08-.7.08-.7 1.16.08 1.77 1.2 1.77 1.2 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.7 0-1.26.45-2.29 1.19-3.1-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.18 1.18a11 11 0 0 1 5.79 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.24 2.76.12 3.05.74.81 1.19 1.84 1.19 3.1 0 4.43-2.7 5.4-5.27 5.69.42.36.79 1.06.79 2.14v3.17c0 .31.2.67.8.56A11.5 11.5 0 0 0 23.5 12 11.5 11.5 0 0 0 12 .5Z" />
            </svg>
        );
    }
    return (
        <svg {...common} fill="currentColor">
            <path d="M16.36 12.7c-.02-2.23 1.82-3.3 1.9-3.36-1.03-1.52-2.64-1.73-3.21-1.75-1.37-.14-2.67.8-3.36.8-.69 0-1.76-.78-2.9-.76-1.49.02-2.86.87-3.63 2.2-1.55 2.68-.4 6.65 1.11 8.83.74 1.06 1.62 2.26 2.78 2.21 1.11-.04 1.53-.72 2.88-.72 1.35 0 1.73.72 2.9.7 1.2-.02 1.96-1.08 2.69-2.15.85-1.23 1.2-2.42 1.22-2.48-.03-.01-2.34-.9-2.36-3.56ZM14.2 5.9c.61-.74 1.02-1.77.9-2.8-.88.04-1.94.59-2.57 1.32-.56.65-1.05 1.7-.92 2.7.98.08 1.98-.5 2.6-1.22Z" />
        </svg>
    );
}

export function SocialSignIn({ mode }: { mode: "signin" | "signup" }) {
    const [busy, setBusy] = useState<SocialProvider | null>(null);
    const [error, setError] = useState("");

    if (SOCIAL_SIGN_IN.length === 0) return null;

    const go = (provider: SocialProvider) => {
        setBusy(provider);
        setError("");
        // On success the browser leaves for the provider, so nothing after this
        // runs. Only a failure to *start* the handoff comes back here.
        accountApi.signInWithSocial(provider).catch((err: Error) => {
            setBusy(null);
            setError(err.message);
        });
    };

    return (
        <div className="grid gap-2.5">
            <div className="grid gap-2 sm:grid-cols-3">
                {SOCIAL_SIGN_IN.map(({ id, label }) => (
                    <button
                        key={id}
                        type="button"
                        onClick={() => go(id)}
                        disabled={busy !== null}
                        className={cn(
                            "inline-flex items-center justify-center gap-2 h-11 rounded-lg",
                            "border border-border bg-card text-[13.5px] font-medium text-foreground",
                            "transition-colors hover:bg-secondary/60 disabled:opacity-55",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                        )}
                    >
                        {busy === id ? (
                            <span className="text-muted-foreground">Redirecting…</span>
                        ) : (
                            <>
                                <Mark id={id} />
                                {label}
                            </>
                        )}
                    </button>
                ))}
            </div>

            {error && (
                <p role="alert" className="text-[12.5px] text-destructive">
                    {error}
                </p>
            )}

            <div className="flex items-center gap-3 pt-0.5" aria-hidden="true">
                <span className="h-px flex-1 bg-border" />
                <span className="text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
                    or {mode === "signup" ? "sign up" : "sign in"} with email
                </span>
                <span className="h-px flex-1 bg-border" />
            </div>
        </div>
    );
}
