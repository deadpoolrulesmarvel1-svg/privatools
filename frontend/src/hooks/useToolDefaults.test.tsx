import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import * as db from "@/lib/localStore/db";
import * as defaults from "@/lib/localStore/defaults";
import { loadPersisted } from "@/lib/persistence";
import { useToolDefaults } from "./useToolDefaults";

const DEFAULTS = { level: "recommended", quality: 75 };

/** The hook debounces writes at 400ms; wait past that. */
const settle = () => new Promise((r) => setTimeout(r, 600));

beforeEach(async () => {
  await db.destroy();
  localStorage.clear();
});

describe("useToolDefaults", () => {
  it("starts at defaults with restored=false", () => {
    const { result } = renderHook(() => useToolDefaults("compress-pdf", DEFAULTS));
    expect(result.current[0]).toEqual(DEFAULTS);
    expect(result.current[2].restored).toBe(false);
  });

  it("registers the slug once a non-default value is written", async () => {
    const { result } = renderHook(() => useToolDefaults("compress-pdf", DEFAULTS));
    act(() => result.current[1]({ level: "extreme", quality: 40 }));
    await waitFor(async () => {
      expect(await defaults.customizedSlugs()).toEqual(["compress-pdf"]);
    });
  });

  it("does not register when the value equals defaults", async () => {
    const { result } = renderHook(() => useToolDefaults("compress-pdf", DEFAULTS));
    act(() => result.current[1]({ ...DEFAULTS }));
    await settle();
    expect(await defaults.customizedSlugs()).toEqual([]);
  });

  it("unregisters when the value returns to defaults", async () => {
    const { result } = renderHook(() => useToolDefaults("compress-pdf", DEFAULTS));
    act(() => result.current[1]({ level: "extreme", quality: 40 }));
    await waitFor(async () => {
      expect(await defaults.customizedSlugs()).toEqual(["compress-pdf"]);
    });
    act(() => result.current[1]({ ...DEFAULTS }));
    await waitFor(async () => {
      expect(await defaults.customizedSlugs()).toEqual([]);
    });
  });

  it("rehydrates synchronously on remount — no flicker through defaults", async () => {
    const first = renderHook(() => useToolDefaults("compress-pdf", DEFAULTS));
    act(() => first.result.current[1]({ level: "extreme", quality: 40 }));
    await settle();
    first.unmount();

    const second = renderHook(() => useToolDefaults("compress-pdf", DEFAULTS));
    // Value is correct on the FIRST render, not after an effect.
    expect(second.result.current[0]).toEqual({ level: "extreme", quality: 40 });
    expect(second.result.current[2].restored).toBe(true);
  });

  it("merges newly-added defaults into an old snapshot", async () => {
    const first = renderHook(() => useToolDefaults("compress-pdf", DEFAULTS));
    act(() => first.result.current[1]({ level: "extreme", quality: 40 }));
    await settle();
    first.unmount();

    const WITH_NEW_FIELD = { ...DEFAULTS, grayscale: false };
    const second = renderHook(() => useToolDefaults("compress-pdf", WITH_NEW_FIELD));
    expect(second.result.current[0]).toEqual({
      level: "extreme",
      quality: 40,
      grayscale: false,
    });
  });

  it("reset clears the value and the registration", async () => {
    const { result } = renderHook(() => useToolDefaults("compress-pdf", DEFAULTS));
    act(() => result.current[1]({ level: "extreme", quality: 40 }));
    await settle();
    expect(loadPersisted("compress-pdf")).not.toBeNull();

    await act(async () => {
      result.current[2].reset();
    });
    expect(result.current[0]).toEqual(DEFAULTS);
    await waitFor(async () => {
      expect(await defaults.customizedSlugs()).toEqual([]);
    });
  });

  it("keeps two tools independent", async () => {
    const a = renderHook(() => useToolDefaults("compress-pdf", DEFAULTS));
    const b = renderHook(() => useToolDefaults("bates-numbering", DEFAULTS));
    act(() => a.result.current[1]({ level: "extreme", quality: 40 }));
    await settle();
    expect(b.result.current[0]).toEqual(DEFAULTS);
    await waitFor(async () => {
      expect(await defaults.customizedSlugs()).toEqual(["compress-pdf"]);
    });
  });
});
