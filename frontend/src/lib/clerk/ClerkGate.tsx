/**
 * The Clerk provider, in a chunk of its own.
 *
 * `@clerk/react` is 124K in the entry bundle — it more than doubled it, from
 * 108K to 232K — and on a deployment with no Clerk key it does precisely
 * nothing. Importing it statically meant every visitor to every one of the 219
 * tool pages paid for an identity provider that was switched off, on a site
 * whose whole pitch is that you can use it without an account.
 *
 * So it is loaded only where it is configured. Production has no key today, and
 * takes the plain `<App />` path with none of this fetched at all.
 */

import { useEffect, type ReactNode } from "react";
import { ClerkProvider } from "@clerk/react";
import { ClerkBridge } from "./ClerkBridge";
import { markClerkLoadFailed } from "./instance";

/** clerk-js failing to arrive, as reported by the provider. */
const LOAD_FAILURE = /failed to load clerk/i;

export default function ClerkGate({
    publishableKey,
    children,
}: {
    publishableKey: string;
    children: ReactNode;
}) {
    // The provider reports a blocked script as an unhandled rejection and
    // nothing else; catching it here is what lets the account page say
    // something true rather than "still starting up".
    useEffect(() => {
        const seen = (text: string) => {
            if (!LOAD_FAILURE.test(text)) return;
            markClerkLoadFailed();
            window.dispatchEvent(new CustomEvent("privatools:clerk-blocked"));
        };
        const onRejection = (e: PromiseRejectionEvent) => {
            const r = e.reason as { message?: string } | string | undefined;
            seen(typeof r === "string" ? r : r?.message ?? "");
        };
        const onError = (e: ErrorEvent) => seen(e.message ?? "");
        window.addEventListener("unhandledrejection", onRejection);
        window.addEventListener("error", onError);
        return () => {
            window.removeEventListener("unhandledrejection", onRejection);
            window.removeEventListener("error", onError);
        };
    }, []);

    return (
        <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
            <ClerkBridge />
            {children}
        </ClerkProvider>
    );
}
