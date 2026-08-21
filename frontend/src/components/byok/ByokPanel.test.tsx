import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import * as db from "@/lib/localStore/db";
import { _resetForTests } from "@/lib/localStore/crypto";
import { useByok } from "@/hooks/useByok";
import { ByokPanel } from "./ByokPanel";

beforeEach(async () => {
  _resetForTests();
  await db.clear("secrets");
  localStorage.clear();
});

async function mountWithHook() {
  const hook = renderHook(() => useByok());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  const view = render(<ByokPanel byok={hook.result.current} />);
  return { hook, view };
}

describe("ByokPanel", () => {
  it("states where the key and file actually go", async () => {
    await mountWithHook();
    expect(screen.getByText(/never pass through PrivaTools/i)).toBeInTheDocument();
  });

  it("states the honest storage limit rather than implying vault-grade safety", async () => {
    // This copy is load-bearing. A user deciding whether to paste a credential
    // needs to know this is NOT the same guarantee as a saved PDF password.
    await mountWithHook();
    expect(screen.getByText(/has\s+to be readable while a request is in flight/i)).toBeInTheDocument();
    expect(screen.getByText(/could recover it/i)).toBeInTheDocument();
  });

  it("offers a session-only choice for shared machines", async () => {
    await mountWithHook();
    expect(screen.getByRole("checkbox")).toBeInTheDocument();
    expect(screen.getByText(/shared or borrowed computer/i)).toBeInTheDocument();
  });

  it("masks the key field by default", async () => {
    const { hook } = await mountWithHook();
    hook.result.current.selectProvider("anthropic");
    await waitFor(() => expect(hook.result.current.provider).toBe("anthropic"));
    render(<ByokPanel byok={hook.result.current} />);
    const field = screen.getAllByPlaceholderText(/API key/i)[0] as HTMLInputElement;
    expect(field.type).toBe("password");
    expect(field.autocomplete).toBe("off");
  });

  it("lists every provider from the registry", async () => {
    await mountWithHook();
    expect(screen.getByText("Anthropic (Claude)")).toBeInTheDocument();
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("Google Gemini")).toBeInTheDocument();
  });

  it("explains the CSP limit on custom endpoints instead of letting it fail silently", async () => {
    const hook = renderHook(() => useByok());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    hook.result.current.selectProvider("openai-compatible");
    await waitFor(() => expect(hook.result.current.provider).toBe("openai-compatible"));
    render(<ByokPanel byok={hook.result.current} />);
    expect(screen.getByText(/security policy blocks everything else/i)).toBeInTheDocument();
  });

  it("does not leave the typed key in the DOM after saving", async () => {
    const user = userEvent.setup();
    const hook = renderHook(() => useByok());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    hook.result.current.selectProvider("anthropic");
    await waitFor(() => expect(hook.result.current.provider).toBe("anthropic"));
    const { container } = render(<ByokPanel byok={hook.result.current} />);
    const field = screen.getAllByPlaceholderText(/API key/i)[0];
    await user.type(field, "sk-ant-TYPED-SECRET-VALUE");
    await user.click(screen.getAllByRole("button", { name: /save/i })[0]);
    await waitFor(() => expect(container.innerHTML).not.toContain("TYPED-SECRET-VALUE"));
  });
});
