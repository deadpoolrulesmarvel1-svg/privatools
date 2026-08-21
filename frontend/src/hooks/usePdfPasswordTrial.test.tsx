import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import * as db from "@/lib/localStore/db";
import * as crypt from "@/lib/localStore/crypto";
import * as vault from "@/lib/localStore/vault";
import { usePdfPasswordTrial } from "./usePdfPasswordTrial";

beforeEach(async () => {
  await db.destroy();
  crypt._resetForTests();
});

const fileOf = (bytes = [1, 2, 3]) =>
  new File([new Uint8Array(bytes)], "doc.pdf", { type: "application/pdf" });

const passwordError = () =>
  Object.assign(new Error("password required"), { name: "PasswordException" });

describe("usePdfPasswordTrial", () => {
  it("starts idle", () => {
    const { result } = renderHook(() => usePdfPasswordTrial());
    expect(result.current.state.status).toBe("idle");
  });

  it("reports notNeeded for an unencrypted file", async () => {
    const open = vi.fn().mockResolvedValue("ok");
    const { result } = renderHook(() => usePdfPasswordTrial(async () => open));
    await act(async () => {
      await result.current.run(fileOf());
    });
    await waitFor(() => expect(result.current.state.status).toBe("notNeeded"));
  });

  it("reaches unlocked and exposes the matching password", async () => {
    await vault.addPassword("a", "pw");
    const open = vi.fn(async (_d: Uint8Array, password?: string) => {
      if (password !== "pw") throw passwordError();
      return "ok";
    });
    const { result } = renderHook(() => usePdfPasswordTrial(async () => open));
    await act(async () => {
      await result.current.run(fileOf());
    });
    await waitFor(() => expect(result.current.state.status).toBe("unlocked"));
    if (result.current.state.status === "unlocked") {
      expect(result.current.state.password).toBe("pw");
      expect(result.current.state.tried).toBe(1);
    }
  });

  it("passes through a visible trying state", async () => {
    await vault.addPassword("a", "pw");
    const seen: string[] = [];
    let release: (() => void) | null = null;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const open = vi.fn(async (_d: Uint8Array, password?: string) => {
      await gate;
      if (password !== "pw") throw passwordError();
      return "ok";
    });

    const { result } = renderHook(() => usePdfPasswordTrial(async () => open));
    let pending!: Promise<unknown>;
    act(() => {
      pending = result.current.run(fileOf());
    });
    await waitFor(() => seen.push(result.current.state.status));
    expect(result.current.state.status).toBe("trying");
    await act(async () => {
      release!();
      await pending;
    });
    expect(result.current.state.status).toBe("unlocked");
  });

  it("reports needed when nothing fits", async () => {
    await vault.addPassword("a", "nope");
    const open = vi.fn(async () => {
      throw passwordError();
    });
    const { result } = renderHook(() => usePdfPasswordTrial(async () => open));
    await act(async () => {
      await result.current.run(fileOf());
    });
    await waitFor(() => expect(result.current.state.status).toBe("needed"));
  });

  it("reports an error for a corrupt file rather than prompting", async () => {
    const open = vi.fn(async () => {
      throw Object.assign(new Error("bad xref"), { name: "InvalidPDFException" });
    });
    const { result } = renderHook(() => usePdfPasswordTrial(async () => open));
    await act(async () => {
      await result.current.run(fileOf());
    });
    await waitFor(() => expect(result.current.state.status).toBe("error"));
    if (result.current.state.status === "error") {
      expect(result.current.state.message).toMatch(/bad xref/);
    }
  });

  it("resets back to idle", async () => {
    const open = vi.fn().mockResolvedValue("ok");
    const { result } = renderHook(() => usePdfPasswordTrial(async () => open));
    await act(async () => {
      await result.current.run(fileOf());
    });
    act(() => result.current.reset());
    expect(result.current.state.status).toBe("idle");
  });
});
