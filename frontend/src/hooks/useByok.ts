/**
 * React state for bring-your-own-key.
 *
 * Deliberately never holds key material in React state. It exposes which
 * providers are configured and which one is selected; the key itself is read
 * from the encrypted store at call time and handed straight to the client.
 * Anything in component state ends up in React DevTools, in error overlays,
 * and in any state-serialising debug tool a user might have installed.
 */

import { useCallback, useEffect, useState } from "react";

import {
    clearKey, isSessionOnly, listConfigured, saveKey, setSessionOnly,
} from "@/lib/byok/keyStore";

const SELECTED_KEY = "privatools.byok.provider";

export interface UseByok {
    loading: boolean;
    /** Provider ids that have a key stored. Never contains key material. */
    configured: string[];
    /** Currently selected provider id. */
    provider: string;
    /** True when the selected provider has a key ready to use. */
    ready: boolean;
    sessionOnly: boolean;
    selectProvider: (id: string) => void;
    save: (id: string, apiKey: string) => Promise<void>;
    forget: (id: string) => Promise<void>;
    setSession: (on: boolean) => Promise<void>;
}

function readSelected(): string {
    try {
        return localStorage.getItem(SELECTED_KEY) ?? "";
    } catch {
        return "";
    }
}

export function useByok(): UseByok {
    const [loading, setLoading] = useState(true);
    const [configured, setConfigured] = useState<string[]>([]);
    const [provider, setProvider] = useState<string>(readSelected);
    const [sessionOnly, setSessionOnlyState] = useState(isSessionOnly);

    const refresh = useCallback(async () => {
        setConfigured(await listConfigured());
    }, []);

    useEffect(() => {
        let alive = true;
        void (async () => {
            const list = await listConfigured();
            if (!alive) return;
            setConfigured(list);
            setLoading(false);
        })();
        return () => { alive = false; };
    }, []);

    const selectProvider = useCallback((id: string) => {
        setProvider(id);
        try {
            localStorage.setItem(SELECTED_KEY, id);
        } catch {
            /* storage disabled — the choice just won't survive a reload */
        }
    }, []);

    const save = useCallback(async (id: string, apiKey: string) => {
        await saveKey(id, apiKey);
        selectProvider(id);
        await refresh();
    }, [refresh, selectProvider]);

    const forget = useCallback(async (id: string) => {
        await clearKey(id);
        await refresh();
    }, [refresh]);

    const setSession = useCallback(async (on: boolean) => {
        await setSessionOnly(on);
        setSessionOnlyState(on);
        await refresh();
    }, [refresh]);

    return {
        loading,
        configured,
        provider,
        ready: Boolean(provider) && configured.includes(provider),
        sessionOnly,
        selectProvider,
        save,
        forget,
        setSession,
    };
}
