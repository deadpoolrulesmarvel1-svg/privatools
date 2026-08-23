/**
 * Service status — Signature.
 *
 * Every row is something this browser can actually verify right now: a live
 * health request, navigator.onLine, and whether the service worker is active.
 * There is no uptime history, because nothing records one — inventing a "99.9%"
 * figure would be the easy thing and the dishonest one.
 */
import { useCallback, useEffect, useState } from "react";
import { Cloud, CloudOff, Download, Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useOnline } from "@/hooks/useOnline";
import { apiUrl } from "@/lib/api";

type Probe = "checking" | "up" | "down";

export default function StatusPage() {
    const online = useOnline();
    const [server, setServer] = useState<Probe>("checking");
    const [latency, setLatency] = useState<number | null>(null);
    const [swReady, setSwReady] = useState(false);
    const [checkedAt, setCheckedAt] = useState<Date | null>(null);

    const probe = useCallback(() => {
        setServer("checking");
        const started = performance.now();
        const ctl = new AbortController();
        const timer = window.setTimeout(() => ctl.abort(), 8000);
        fetch(apiUrl("/health"), { signal: ctl.signal, cache: "no-store" })
            .then(res => { setServer(res.ok ? "up" : "down"); setLatency(Math.round(performance.now() - started)); })
            .catch(() => { setServer("down"); setLatency(null); })
            .finally(() => { window.clearTimeout(timer); setCheckedAt(new Date()); });
    }, []);

    useEffect(() => { probe(); }, [probe, online]);

    useEffect(() => {
        if (!("serviceWorker" in navigator)) return;
        let alive = true;
        navigator.serviceWorker.getRegistration()
            .then(r => { if (alive) setSwReady(Boolean(r?.active)); })
            .catch(() => { /* unsupported or blocked */ });
        return () => { alive = false; };
    }, []);

    const rows = [
        {
            icon: online ? Wifi : WifiOff, label: "Your connection",
            value: online ? "Online" : "Offline",
            detail: online ? "This browser reports a network connection." : "No network. Browser-only tools still work.",
            tone: online ? "ok" : "bad",
        },
        {
            icon: server === "up" ? Cloud : server === "down" ? CloudOff : Loader2,
            label: "Server tools",
            value: server === "up" ? "Reachable" : server === "down" ? "Unreachable" : "Checking…",
            detail: server === "up"
                ? `Responded${latency !== null ? ` in ${latency} ms` : ""}. Mumbai, India — best effort, no failover.`
                : server === "down"
                    ? "Tools that need the server will fail. Browser-only tools are unaffected."
                    : "Asking the server whether it is up.",
            tone: server === "up" ? "ok" : server === "down" ? "bad" : "idle",
        },
        {
            icon: Download, label: "Offline mode",
            value: swReady ? "Ready" : "Not cached",
            detail: swReady
                ? "The app is cached, so it opens without a network."
                : "Install the app or revisit once online to cache it.",
            tone: swReady ? "ok" : "idle",
        },
    ] as const;

    const dot = { ok: "bg-success", bad: "bg-destructive", idle: "bg-muted-foreground/50" };

    return (
        <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
            <h1 className="font-display text-[30px] font-bold tracking-[-0.025em]">Service status</h1>
            <p className="mt-1.5 text-[14px] text-muted-foreground">
                Checked from this browser, right now. Nothing here is a stored uptime figure.
            </p>

            <ul className="mt-6 grid gap-3">
                {rows.map(r => (
                    <li key={r.label} className="flex items-start gap-3 rounded-2xl border border-border bg-card p-4">
                        <r.icon size={17} aria-hidden="true"
                                className={cn("mt-0.5 shrink-0 text-muted-foreground", r.value === "Checking…" && "animate-spin")} />
                        <div className="min-w-0 flex-1">
                            <p className="text-[14px] font-semibold">{r.label}</p>
                            <p className="mt-0.5 text-[13px] text-muted-foreground">{r.detail}</p>
                        </div>
                        <span className="flex items-center gap-2 text-[12.5px] font-medium">
                            {r.value}
                            <span className={cn("h-2 w-2 rounded-full", dot[r.tone])} aria-hidden="true" />
                        </span>
                    </li>
                ))}
            </ul>

            <div className="mt-5 flex items-center gap-3">
                <button onClick={probe}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border px-3 text-[13px] font-medium">
                    <RefreshCw size={13} aria-hidden="true" /> Check again
                </button>
                {checkedAt && (
                    <span className="text-[12px] text-muted-foreground">
                        Last checked {checkedAt.toLocaleTimeString()}
                    </span>
                )}
            </div>
        </div>
    );
}
