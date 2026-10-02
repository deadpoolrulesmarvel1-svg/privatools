import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AttachmentUI } from "./AttachmentUI";
import { CompareUI } from "./CompareUI";
import { postFormData, downloadBlob } from "@/lib/api";

vi.mock("@/lib/api", async original => ({
  ...await original<typeof import("@/lib/api")>(), postFormData: vi.fn(), downloadBlob: vi.fn(),
}));
vi.mock("@/lib/localStore/defaults", () => ({ registerCustomized: vi.fn(), unregisterCustomized: vi.fn() }));

// Each intake's one button is named by its visible call to action, then the
// heading that tells the pair apart (WCAG 2.5.3).
const surfaces = [
  { name: "PDF attachment", Component: AttachmentUI, pickers: ["Choose a file: Your main PDF", "Choose a file: The extra file"],
    action: "Embed attachment", endpoint: "/add-attachment", fields: ["file", "attachment"] },
  { name: "PDF comparison", Component: CompareUI, pickers: ["Choose a file: Original PDF", "Choose a file: Modified PDF"],
    action: "Compare PDFs", endpoint: "/compare", fields: ["file1", "file2"] },
];

/** The native input sits beside the intake's button, inside the same card. */
function fileInputOf(control: HTMLElement) {
  return control.closest(".ts-intake")!.querySelector<HTMLInputElement>('input[type="file"]')!;
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.mocked(postFormData).mockResolvedValue({ blob: async () => new Blob(["synthetic output"]) } as Response);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe.each(surfaces)("$name file pickers", ({ Component, pickers, action, endpoint, fields }) => {
  it.each(["click", "Enter", " "])("opens the correct native input using %s", gesture => {
    render(<Component />);
    for (const name of pickers) {
      const control = screen.getByRole("button", { name });
      const input = fileInputOf(control);
      expect(input).toBeTruthy();
      const click = vi.spyOn(input, "click").mockImplementation(() => {});
      if (gesture === "click") fireEvent.click(control);
      else fireEvent.keyDown(control, { key: gesture });
      expect(click).toHaveBeenCalledTimes(1);
    }
    expect(postFormData).not.toHaveBeenCalled();
  });

  it("retains both chosen files across rerenders and submits them in their own fields", async () => {
    render(<Component />);
    const files = [new File(["%PDF first"], "first.pdf", { type: "application/pdf" }),
      new File(["%PDF second"], "second.pdf", { type: "application/pdf" })];
    expect(screen.getByRole("button", { name: action })).toBeDisabled();
    for (let index = 0; index < pickers.length; index++) {
      const control = screen.getByRole("button", { name: pickers[index] });
      fireEvent.change(fileInputOf(control), { target: { files: [files[index]] } });
      expect(screen.getAllByText(files[index].name).length).toBeGreaterThan(0);
    }
    expect(postFormData).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: action })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: action }));
    await waitFor(() => expect(postFormData).toHaveBeenCalledTimes(1));
    const [sentEndpoint, form] = vi.mocked(postFormData).mock.calls[0];
    expect(sentEndpoint).toBe(endpoint);
    const body = typeof form === "function" ? form() : form;
    expect((body.get(fields[0]) as File).name).toBe("first.pdf");
    expect((body.get(fields[1]) as File).name).toBe("second.pdf");
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
  });

  it("restores a working input after removing the first selection", () => {
    render(<Component />);
    const control = screen.getByRole("button", { name: pickers[0] });
    fireEvent.change(fileInputOf(control), {
      target: { files: [new File(["%PDF sample"], "sample.pdf", { type: "application/pdf" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    const restored = screen.getByRole("button", { name: pickers[0] });
    const input = fileInputOf(restored);
    const click = vi.spyOn(input, "click").mockImplementation(() => {});
    fireEvent.click(restored);
    expect(click).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: action })).toBeDisabled();
  });
});
