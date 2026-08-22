/**
 * ToolSkeleton — calm workshop-styled placeholder shown while a lazy
 * tool chunk is being fetched.
 *
 * Sits inside the tool surface, NOT the full page. ~40vh tall so the
 * surrounding header/sidebar layout doesn't collapse and reflow when
 * the real tool UI swaps in. Three pulsing bars instead of a spinner —
 * spinners read as "something is wrong / waiting on the network", and
 * we want this to feel like normal page rendering.
 */
import React from "react";

export function ToolSkeleton() {
  return (
    <div
      className="min-h-[40vh] w-full bg-paper px-4 py-8 sm:px-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading tool"
    >
      <div className="mx-auto max-w-3xl space-y-5">
        <p className="font-medium text-[11px] text-muted-foreground">
          Loading tool…
        </p>

        <div className="space-y-3">
          <div className="h-9 w-1/2 rounded-md bg-secondary/40 animate-pulse" />
          <div className="h-32 w-full rounded-2xl border border-dashed border-border/60 bg-secondary/30 animate-pulse" />
          <div className="h-10 w-2/3 rounded-md bg-secondary/40 animate-pulse" />
        </div>
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}

export default ToolSkeleton;
