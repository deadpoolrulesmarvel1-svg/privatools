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

import type { ReactNode } from "react";
import { ClerkProvider } from "@clerk/react";
import { ClerkBridge } from "./ClerkBridge";

export default function ClerkGate({
    publishableKey,
    children,
}: {
    publishableKey: string;
    children: ReactNode;
}) {
    return (
        <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
            <ClerkBridge />
            {children}
        </ClerkProvider>
    );
}
