/**
 * Reuse a saved image instead of re-uploading it.
 *
 * The asset store already holds the user's signature, logo, and watermark
 * images (see lib/localStore/assets). This surfaces them wherever a tool takes
 * an image upload, so a recurring brand asset is picked once and reused —
 * without a byte leaving the device until the tool actually runs.
 *
 * Renders nothing when the store is empty, so a tool that the user has never
 * saved an asset for shows no extra chrome.
 */
import { useCallback } from "react";
import { ImageIcon, Save, Trash2 } from "lucide-react";
import type { AssetKind } from "@/lib/localStore/assets";
import { useAsset } from "@/hooks/useAsset";

export function AssetPicker({
  kind,
  onPick,
  saveable,
  className,
}: {
  kind: AssetKind;
  /** Called with the chosen asset rebuilt as a File, ready to send. */
  onPick: (file: File) => void;
  /** The image currently selected in the tool, offered for saving. */
  saveable?: File | null;
  className?: string;
}) {
  const { items, save, remove, blobOf, error } = useAsset(kind);

  const pick = useCallback(
    async (id: string, name: string, mime: string) => {
      const blob = await blobOf(id);
      if (blob) onPick(new File([blob], name, { type: mime }));
    },
    [blobOf, onPick],
  );

  const alreadySaved =
    !!saveable && items.some((a) => a.name === saveable.name && a.bytes === saveable.size);

  if (items.length === 0 && !saveable) return null;

  return (
    <div className={className ?? "mt-2 space-y-1.5"}>
      {items.length > 0 && (
        <>
          <p className="font-medium text-[11px] text-muted-foreground">
            Saved on this device
          </p>
          <div className="flex flex-wrap gap-1.5">
            {items.map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-[12px]"
              >
                <button
                  type="button"
                  className="inline-flex items-center gap-1 hover:text-accent"
                  onClick={() => pick(a.id, a.name, a.mime)}
                >
                  <ImageIcon size={11} aria-hidden="true" />
                  <span className="max-w-[10rem] truncate">{a.name}</span>
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${a.name}`}
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => remove(a.id)}
                >
                  <Trash2 size={11} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        </>
      )}

      {saveable && !alreadySaved && (
        <button
          type="button"
          onClick={() => save(saveable.name, saveable)}
          className="font-medium inline-flex items-center gap-1 text-[11px] text-accent hover:opacity-80"
        >
          <Save size={11} aria-hidden="true" />
          Save this image for next time
        </button>
      )}

      {error && <p className="text-[12px] text-destructive">{error}</p>}
    </div>
  );
}
