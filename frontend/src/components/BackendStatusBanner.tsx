/**
 * Backend status banner. Shows a slim copper warning at the top of the
 * workspace when the FastAPI backend is unreachable. Dismissible — the
 * user can stash it.
 *
 * Three banner states:
 *   - "offline"  ← browser is offline (navigator.onLine === false). Server
 *                  is irrelevant; nothing networked works. Lists a handful
 *                  of client-only tools the user can still run.
 *   - "backend"  ← browser online but FastAPI healthcheck fails. Same copy
 *                  as before — "Backend offline · file tools can't run".
 *   - "slow"     ← healthcheck succeeded but took > SLOW_THRESHOLD ms. Warns
 *                  the user uploads will be sluggish but functional.
 *
 * The "offline" banner takes precedence over the others; we only ever render
 * one strip so the workspace chrome doesn't drift downward by two rows.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCcw, WifiOff, X, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { useOnline } from "@/hooks/useOnline";
import { apiUrl } from "@/lib/api";

type HealthState = "unknown" | "online" | "offline";

const DISMISS_KEY = "privatools_backend_warning_dismissed";
const SLOW_DISMISS_KEY = "privatools_slow_warning_dismissed";
const OFFLINE_DISMISS_KEY = "privatools_offline_warning_dismissed";
const SLOW_THRESHOLD_MS = 5_000;

/** Tools that work entirely in the browser — no network needed. Surfaced
 *  in the offline banner so the user knows they're not completely stuck. */
const CLIENT_ONLY_TOOLS = [
  { slug: "base64", label: "Base64" },
  { slug: "hash-generator", label: "Hash gen" },
  { slug: "json-xml-formatter", label: "JSON/XML formatter" },
  { slug: "regex-tester", label: "Regex tester" },
  { slug: "uuid-generator", label: "UUID" },
];

export function BackendStatusBanner() {
  const online = useOnline();
  const [status, setStatus] = useState<HealthState>("unknown");
  const [slow, setSlow] = useState(false);
  const [checking, setChecking] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return sessionStorage.getItem(DISMISS_KEY) === "1"; } catch { return false; }
  });
  const [slowDismissed, setSlowDismissed] = useState(() => {
    try { return sessionStorage.getItem(SLOW_DISMISS_KEY) === "1"; } catch { return false; }
  });
  const [offlineDismissed, setOfflineDismissed] = useState(() => {
    try { return sessionStorage.getItem(OFFLINE_DISMISS_KEY) === "1"; } catch { return false; }
  });
  const abortRef = useRef<AbortController | null>(null);

  const checkHealth = useCallback(async () => {
    // Cancel any in-flight check before starting a new one.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setChecking(true);
    const startedAt = performance.now();
    try {
      const response = await fetch(apiUrl("/health"), {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
      });
      const elapsed = performance.now() - startedAt;
      setSlow(response.ok && elapsed > SLOW_THRESHOLD_MS);
      setStatus(response.ok ? "online" : "offline");
    } catch (err) {
      if (controller.signal.aborted) return;  // superseded by a later check
      setStatus("offline");
      setSlow(false);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    checkHealth();
    const pollId = window.setInterval(checkHealth, 45000);
    const handleOnline = () => checkHealth();
    const handleOffline = () => { setStatus("offline"); setSlow(false); };
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.clearInterval(pollId);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      abortRef.current?.abort();
    };
  }, [checkHealth]);

  const dismiss = () => {
    setDismissed(true);
    try { sessionStorage.setItem(DISMISS_KEY, "1"); } catch {}
  };
  const dismissSlow = () => {
    setSlowDismissed(true);
    try { sessionStorage.setItem(SLOW_DISMISS_KEY, "1"); } catch {}
  };
  const dismissOffline = () => {
    setOfflineDismissed(true);
    try { sessionStorage.setItem(OFFLINE_DISMISS_KEY, "1"); } catch {}
  };

  // ── Render ────────────────────────────────────────────────────────────
  // Priority: full-on offline (browser-level) → backend unreachable → slow.

  if (!online && !offlineDismissed) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2 border-b border-copper/30 bg-copper-soft/40 text-[12.5px] text-foreground"
      >
        <span className="inline-flex items-center justify-center h-6 w-6 rounded shrink-0">
          <WifiOff size={12} className="text-copper" />
        </span>
        <span className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-copper font-medium shrink-0">
          You're offline
        </span>
        <span className="opacity-50 hidden sm:inline">—</span>
        <span className="hidden sm:inline opacity-90">
          Client-only tools still work:
        </span>
        <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 ml-1">
          {CLIENT_ONLY_TOOLS.map(t => (
            <Link
              key={t.slug}
              to={`/tools/${t.slug}`}
              className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-accent hover:underline"
            >
              {t.label}
            </Link>
          ))}
        </span>
        <button
          onClick={dismissOffline}
          className="ml-auto h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          aria-label="Dismiss offline notice"
          title="Hide for this session"
        >
          <X size={11} />
        </button>
      </div>
    );
  }

  if (status === "offline" && !dismissed) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 px-4 py-2 border-b border-copper/30 bg-copper-soft/40 text-[12.5px] text-foreground"
      >
        <span className="inline-flex items-center justify-center h-6 w-6 rounded shrink-0">
          <AlertTriangle size={12} className="text-copper" />
        </span>
        <span className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-copper font-medium shrink-0">
          Backend offline
        </span>
        <span className="opacity-50 hidden sm:inline">—</span>
        <span className="hidden sm:inline opacity-90">
          File tools can't run. Server-side processing needs the FastAPI backend.
        </span>
        <button
          onClick={checkHealth}
          disabled={checking}
          className="ml-auto inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.08em] uppercase text-foreground hover:text-accent transition-colors disabled:opacity-50"
          aria-label={checking ? "Checking backend status" : "Retry backend connection"}
        >
          <RefreshCcw size={10} className={checking ? "animate-spin" : ""} />
          {checking ? "Checking…" : "Retry"}
        </button>
        <button
          onClick={dismiss}
          className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          aria-label="Dismiss backend offline notice"
          title="Hide this banner for this session"
        >
          <X size={11} />
        </button>
      </div>
    );
  }

  if (slow && !slowDismissed && status === "online") {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 px-4 py-2 border-b border-copper/30 bg-copper-soft/30 text-[12.5px] text-foreground"
      >
        <span className="inline-flex items-center justify-center h-6 w-6 rounded shrink-0">
          <Zap size={12} className="text-copper" />
        </span>
        <span className="font-mono text-[10.5px] tracking-[0.06em] uppercase text-copper font-medium shrink-0">
          Server slow
        </span>
        <span className="opacity-50 hidden sm:inline">—</span>
        <span className="hidden sm:inline opacity-90">
          Your uploads may take longer than usual.
        </span>
        <button
          onClick={dismissSlow}
          className="ml-auto h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
          aria-label="Dismiss slow-server notice"
          title="Hide for this session"
        >
          <X size={11} />
        </button>
      </div>
    );
  }

  return null;
}
