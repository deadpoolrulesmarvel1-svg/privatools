/**
 * Strictly-increasing timestamps.
 *
 * `Date.now()` has millisecond resolution, so two records written in the same
 * tick tie — and a sort on a tied key falls back to whatever order the store
 * happened to return, which is not "newest first". That made the vault's
 * candidate ordering and the counter list order depend on timing luck.
 *
 * `monotonicNow()` never returns the same value twice within a page session,
 * so "newest first" is deterministic. Values remain ordinary epoch
 * milliseconds, and after a reload `Date.now()` immediately dominates again.
 */
let last = 0;

export function monotonicNow(): number {
  const t = Date.now();
  last = t > last ? t : last + 1;
  return last;
}

/** Test hook — resets the monotonic floor between test cases. */
export function _resetClockForTests(): void {
  last = 0;
}
