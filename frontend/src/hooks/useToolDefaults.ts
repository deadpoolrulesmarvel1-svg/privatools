/**
 * useToolDefaults — remembered per-tool settings.
 *
 * Signature-identical to `useFormPersist`, so adopting it in a tool is a
 * one-line change. It adds one thing: registering the slug in the localStore
 * index so `/my-stuff` can show "6 tools customized" and clear them.
 *
 * Values stay in synchronous localStorage on purpose. `useFormPersist`
 * hydrates in a `useRef` initializer specifically so a tool never renders its
 * defaults and then flickers into the restored values; IndexedDB is async-only
 * and would reintroduce that flicker on every tool page. Only the index — which
 * nothing renders during first paint — is async. See the storage-split note in
 * docs/superpowers/specs/2026-08-21-local-first-personalization-design.md.
 *
 * The `slug` MUST be the tool's registry slug from `data/tools.ts`, so
 * `/my-stuff` can map a stored entry back to a tool name. A typo produces an
 * orphan entry that maps to nothing; `tool-defaults-slugs.test.ts` guards this.
 */
import { useCallback, useEffect, useRef } from "react";
import { useFormPersist, type UseFormPersistResult } from "./useFormPersist";
import { registerCustomized, unregisterCustomized } from "@/lib/localStore/defaults";
import { clearPersisted, loadPersisted, savePersisted, shallowEqual } from "@/lib/persistence";

export interface ToolDefaultsOptions {
  /**
   * Key this tool used before it moved to its registry slug. Migrated once, on
   * first render, then removed.
   *
   * The tools that already used `useFormPersist` keyed on short names
   * ("bates", "compress") rather than registry slugs. Renaming the key without
   * migrating would silently discard every existing user's saved settings.
   */
  legacyKey?: string;
}

export function useToolDefaults<T extends Record<string, unknown>>(
  slug: string,
  defaults: T,
  options: ToolDefaultsOptions = {},
): [T, React.Dispatch<React.SetStateAction<T>>, UseFormPersistResult<T>] {
  // Runs BEFORE useFormPersist reads, so the migrated value is picked up on the
  // very first render and the user never sees a flash of defaults.
  const { legacyKey } = options;
  const migrated = useRef(false);
  if (!migrated.current) {
    migrated.current = true;
    if (legacyKey && legacyKey !== slug) {
      const legacy = loadPersisted<T>(legacyKey);
      // An existing value under the new key wins — it is more recent by
      // definition, since the legacy key is only ever written by old code.
      if (legacy !== null && loadPersisted<T>(slug) === null) {
        savePersisted<T>(slug, legacy);
      }
      if (legacy !== null) clearPersisted(legacyKey);
    }
  }

  const [state, setState, api] = useFormPersist<T>(slug, defaults);

  // Mirror the persistence layer's own rule: a value equal to defaults isn't
  // "customized", so it shouldn't appear in /my-stuff either. Tracking the last
  // registered state avoids an IndexedDB write on every keystroke.
  const lastRegistered = useRef<boolean | null>(null);
  useEffect(() => {
    const customized = !shallowEqual(
      state as Record<string, unknown>,
      defaults as Record<string, unknown>,
    );
    if (lastRegistered.current === customized) return;
    lastRegistered.current = customized;
    void (customized ? registerCustomized(slug) : unregisterCustomized(slug));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, slug]);

  const reset = useCallback(() => {
    api.reset();
    lastRegistered.current = false;
    void unregisterCustomized(slug);
  }, [api, slug]);

  return [state, setState, { ...api, reset }];
}
