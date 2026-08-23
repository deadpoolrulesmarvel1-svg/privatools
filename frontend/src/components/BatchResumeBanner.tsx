/**
 * BatchResumeBanner — surfaces when a batch run was interrupted by a tab
 * close / reload / navigation. Reads the persistence-layer marker; if one
 * exists, renders a slim banner offering to jump back to /batch with the
 * tool pre-selected.
 *
 * Why a separate banner instead of inlining into BackendStatusBanner?
 * They show in different conditions (network / queue), and combining them
 * would mean either suppressing one when the other fires, or letting the
 * banner area grow taller. Both feel worse than two independent strips.
 *
 * The marker itself doesn't include the actual files (they aren't
 * serialisable) — only the count and names. So "resume" really means
 * "go back to /batch with the tool reselected and a hint about what
 * was running".
 */
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { History, X } from "lucide-react";
import { clearBatchActive, getBatchActive, type BatchActiveMarker } from "@/lib/persistence";

export function BatchResumeBanner() {
  const [marker, setMarker] = useState<BatchActiveMarker | null>(null);
  const location = useLocation();

  useEffect(() => {
    // Only check on mount and on route changes — no need to poll.
    const m = getBatchActive();
    setMarker(m);
  }, [location.pathname]);

  // Suppress the banner while the user is actively on /batch — they'll see
  // the queue state there directly and don't need a second prompt.
  if (!marker || location.pathname === "/batch") return null;

  const dismiss = () => {
    clearBatchActive();
    setMarker(null);
  };

  const minutesAgo = Math.max(1, Math.round((Date.now() - marker.startedAt) / 60000));

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 px-4 py-2 border-b border-accent/30 bg-accent/[0.04] text-[12.5px] text-foreground"
    >
      <span className="inline-flex items-center justify-center h-6 w-6 rounded shrink-0">
        <History size={12} className="text-accent" />
      </span>
      <span className="text-[11.5px] text-accent font-medium shrink-0">
        Batch interrupted
      </span>
      <span className="opacity-50 hidden sm:inline">—</span>
      <span className="hidden sm:inline opacity-90 truncate">
        <strong>{marker.toolName}</strong> on {marker.fileCount} file{marker.fileCount === 1 ? "" : "s"}, started {minutesAgo}m ago.
      </span>
      <Link
        to="/batch"
        onClick={dismiss}
        className="font-medium ml-auto inline-flex items-center gap-1 text-[11px] text-accent hover:underline shrink-0"
      >
        Resume
      </Link>
      <button
        onClick={dismiss}
        className="h-6 w-6 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
        aria-label="Dismiss batch-resume notice"
        title="Discard the marker"
      >
        <X size={11} />
      </button>
    </div>
  );
}
