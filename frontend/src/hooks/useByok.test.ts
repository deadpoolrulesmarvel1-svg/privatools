import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import * as db from "@/lib/localStore/db";
import { _resetForTests } from "@/lib/localStore/crypto";
import { useByok } from "./useByok";

beforeEach(async () => {
  _resetForTests();
  await db.clear("secrets");
  localStorage.clear();
});

describe("useByok", () => {
  it("starts with no provider configured", async () => {
    const { result } = renderHook(() => useByok());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.configured).toEqual([]);
    expect(result.current.ready).toBe(false);
  });

  it("becomes ready once a key is saved", async () => {
    const { result } = renderHook(() => useByok());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.save("anthropic", "sk-ant-a-real-looking-key"); });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.configured).toContain("anthropic");
  });

  it("never exposes the key through the hook's state", async () => {
    const { result } = renderHook(() => useByok());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.save("openai", "sk-NEVER-IN-STATE-value"); });
    await waitFor(() => expect(result.current.ready).toBe(true));
    // The hook exposes which providers are configured, never the material.
    expect(JSON.stringify(result.current.configured)).not.toContain("NEVER-IN-STATE");
    expect(JSON.stringify(result.current.provider)).not.toContain("NEVER-IN-STATE");
  });

  it("forgetting a provider clears it", async () => {
    const { result } = renderHook(() => useByok());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.save("groq", "gsk_a_real_looking_key_x"); });
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => { await result.current.forget("groq"); });
    await waitFor(() => expect(result.current.configured).not.toContain("groq"));
  });

  it("remembers the selected provider across mounts", async () => {
    const first = renderHook(() => useByok());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    await act(async () => { first.result.current.selectProvider("gemini"); });
    await waitFor(() => expect(first.result.current.provider).toBe("gemini"));

    const second = renderHook(() => useByok());
    await waitFor(() => expect(second.result.current.loading).toBe(false));
    expect(second.result.current.provider).toBe("gemini");
  });

  it("session-only mode does not persist the key", async () => {
    const { result } = renderHook(() => useByok());
    await waitFor(() => expect(result.current.loading).toBe(false));
    await act(async () => { await result.current.setSession(true); });
    await act(async () => { await result.current.save("openai", "sk-session-scoped-value"); });
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(await db.keys("secrets")).toHaveLength(0);
  });
});
