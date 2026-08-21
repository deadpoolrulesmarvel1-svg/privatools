/**
 * Read/write assets of one kind from a tool UI.
 *
 * Quota failures surface as `error` text rather than a thrown exception —
 * running out of storage should tell the user what happened, not blow up the
 * tool page mid-interaction.
 *
 * `dataUrl` is provided because most consumers (image previews, canvas
 * stamping) want a src string rather than a Blob; object URLs are revoked on
 * unmount so a tool that re-renders often doesn't leak them.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import * as assets from "@/lib/localStore/assets";

export function useAsset(kind: assets.AssetKind) {
  const [items, setItems] = useState<assets.AssetMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const urls = useRef<string[]>([]);

  const refresh = useCallback(async () => {
    setItems(await assets.listAssets(kind));
    setLoading(false);
  }, [kind]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Revoke every object URL this hook handed out.
  useEffect(
    () => () => {
      for (const u of urls.current) URL.revokeObjectURL(u);
      urls.current = [];
    },
    [],
  );

  const save = useCallback(
    async (name: string, blob: Blob) => {
      setError(null);
      try {
        await assets.putAsset(kind, name, blob);
        await refresh();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not save that file.");
        return false;
      }
    },
    [kind, refresh],
  );

  const remove = useCallback(
    async (id: string) => {
      await assets.deleteAsset(id);
      await refresh();
    },
    [refresh],
  );

  const blobOf = useCallback((id: string) => assets.getAssetBlob(id), []);

  const dataUrl = useCallback(async (id: string): Promise<string | null> => {
    const blob = await assets.getAssetBlob(id);
    if (!blob) return null;
    const url = URL.createObjectURL(blob);
    urls.current.push(url);
    return url;
  }, []);

  return { items, loading, error, save, remove, blobOf, dataUrl, refresh };
}
