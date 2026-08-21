import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import * as db from "@/lib/localStore/db";
import * as assets from "@/lib/localStore/assets";
import { useAsset } from "./useAsset";

const blobOf = (n: number, type = "image/png") => new Blob([new Uint8Array(n)], { type });

beforeEach(async () => {
  await db.destroy();
});

describe("useAsset", () => {
  it("starts empty", async () => {
    const { result } = renderHook(() => useAsset("logo"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
  });

  it("saves and lists an asset", async () => {
    const { result } = renderHook(() => useAsset("logo"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.save("l.png", blobOf(8));
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    expect(result.current.items[0].name).toBe("l.png");
  });

  it("returns true on a successful save", async () => {
    const { result } = renderHook(() => useAsset("logo"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.save("l.png", blobOf(8));
    });
    expect(ok).toBe(true);
  });

  it("surfaces a quota error instead of throwing", async () => {
    const { result } = renderHook(() => useAsset("logo"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.save("big.png", blobOf(assets.MAX_ASSET_BYTES + 1));
    });
    expect(ok).toBe(false);
    await waitFor(() => expect(result.current.error).toMatch(/too large/i));
    expect(result.current.items).toEqual([]);
  });

  it("clears a previous error on the next successful save", async () => {
    const { result } = renderHook(() => useAsset("logo"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.save("big.png", blobOf(assets.MAX_ASSET_BYTES + 1));
    });
    await waitFor(() => expect(result.current.error).not.toBeNull());
    await act(async () => {
      await result.current.save("ok.png", blobOf(8));
    });
    await waitFor(() => expect(result.current.error).toBeNull());
  });

  it("removes an asset", async () => {
    const { result } = renderHook(() => useAsset("logo"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.save("l.png", blobOf(8));
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    await act(async () => {
      await result.current.remove(result.current.items[0].id);
    });
    await waitFor(() => expect(result.current.items).toEqual([]));
  });

  it("only sees its own kind", async () => {
    await assets.putAsset("signature", "s.png", blobOf(4));
    const { result } = renderHook(() => useAsset("logo"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items).toEqual([]);
  });

  it("hands back a usable object URL", async () => {
    const { result } = renderHook(() => useAsset("logo"));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => {
      await result.current.save("l.png", blobOf(8));
    });
    await waitFor(() => expect(result.current.items).toHaveLength(1));
    let url: string | null = null;
    await act(async () => {
      url = await result.current.dataUrl(result.current.items[0].id);
    });
    expect(url).toMatch(/^blob:/);
  });
});
