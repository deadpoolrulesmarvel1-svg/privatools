import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as db from "@/lib/localStore/db";
import { _resetForTests } from "@/lib/localStore/crypto";
import { supportsTranscription } from "@/lib/byok/providers";
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
    const field = screen.getAllByLabelText("Anthropic (Claude) API key")[0] as HTMLInputElement;
    expect(field.type).toBe("password");
    expect(field.autocomplete).toBe("off");
  });

  it("offers familiar providers first and discloses the rest without changing the selection", async () => {
    await mountWithHook();
    expect(screen.getByText("Anthropic (Claude)")).toBeInTheDocument();
    expect(screen.getByText("OpenAI")).toBeInTheDocument();
    expect(screen.getByText("Google Gemini")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /DeepSeek/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Explore all 9 providers" }));
    expect(screen.getByRole("button", { name: /DeepSeek/ })).toBeVisible();
    expect(screen.getByRole("button", { name: "Fewer providers" })).toHaveAttribute("aria-expanded", "true");
  });

  it("offers only the providers a page allows, the familiar ones first", async () => {
    const hook = renderHook(() => useByok());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    render(<ByokPanel byok={hook.result.current} offers={supportsTranscription} />);
    expect(screen.getByRole("button", { name: /^OpenAI/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Local or self-hosted/ })).toBeInTheDocument();
    for (const name of [/^Anthropic/, /^Google Gemini/, /^DeepSeek/]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
    await userEvent.click(screen.getByRole("button", { name: "Explore all 6 providers" }));
    for (const name of [/^OpenRouter/, /^Groq/, /^Together AI/, /^Mistral/]) {
      expect(screen.getByRole("button", { name })).toBeVisible();
    }
    for (const name of [/^Anthropic/, /^Google Gemini/, /^DeepSeek/]) {
      expect(screen.queryByRole("button", { name })).not.toBeInTheDocument();
    }
  });

  it("asks for no key for a provider the page does not allow, even one chosen on another page", async () => {
    const hook = renderHook(() => useByok());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    hook.result.current.selectProvider("anthropic");
    await waitFor(() => expect(hook.result.current.provider).toBe("anthropic"));
    render(<ByokPanel byok={hook.result.current} offers={supportsTranscription} />);
    expect(screen.queryByLabelText("Anthropic (Claude) API key")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "A key opens the door." })).toBeInTheDocument();
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
    const field = screen.getAllByLabelText("Anthropic (Claude) API key")[0];
    await user.type(field, "sk-ant-TYPED-SECRET-VALUE");
    await user.click(screen.getAllByRole("button", { name: /save/i })[0]);
    await waitFor(() => expect(container.innerHTML).not.toContain("TYPED-SECRET-VALUE"));
  });

  it("retains an unsaved key and explains a storage failure without echoing the exception", async () => {
    const user = userEvent.setup();
    const hook = renderHook(() => useByok());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const save = vi.fn().mockRejectedValue(new Error("Rejected sk-PRIVATE-UNSAVED"));
    render(<ByokPanel byok={{ ...hook.result.current, provider: "openai", save }} />);
    const field = screen.getByLabelText("OpenAI API key");
    await user.type(field, "sk-PRIVATE-UNSAVED");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be saved");
    expect(field).toHaveValue("sk-PRIVATE-UNSAVED");
    expect(screen.queryByText("Rejected sk-PRIVATE-UNSAVED")).not.toBeInTheDocument();
  });
});
