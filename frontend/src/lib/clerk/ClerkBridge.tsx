/**
 * Parks the Clerk instance where non-React code can reach it.
 *
 * Renders nothing. Mounted inside <ClerkProvider> in main.tsx; see
 * ./instance.ts for why this indirection exists at all.
 */

import { useEffect } from "react";
import { useClerk } from "@clerk/react";
import { setClerkInstance } from "./instance";

export function ClerkBridge(): null {
    const clerk = useClerk();

    useEffect(() => {
        setClerkInstance(clerk);
        // Clearing on unmount matters in tests, where several trees mount in
        // one process and a stale instance from a torn-down tree would be
        // handed to the next one.
        return () => setClerkInstance(null);
    }, [clerk]);

    return null;
}
