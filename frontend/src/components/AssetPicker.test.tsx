import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as db from "@/lib/localStore/db";
import * as assets from "@/lib/localStore/assets";
import { AssetPicker } from "./AssetPicker";

const png = (name: string, n = 64) =>
  new File([new Uint8Array(n)], name, { type: "image/png" });

beforeEach(async () => {
  await db.destroy();
});

describe("AssetPicker", () => {
  it("renders nothing when there is nothing saved and nothing to save", async () => {
    const { container } = render(<AssetPicker kind="watermark" onPick={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container).toBeEmptyDOMElement();
  });

  it("lists a saved asset", async () => {
    await assets.putAsset("watermark", "logo.png", png("logo.png"));
    render(<AssetPicker kind="watermark" onPick={vi.fn()} />);
    expect(await screen.findByText("logo.png")).toBeInTheDocument();
  });

  it("only shows its own kind", async () => {
    await assets.putAsset("signature", "sig.png", png("sig.png"));
    const { container } = render(<AssetPicker kind="watermark" onPick={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(container).toBeEmptyDOMElement();
  });

  it("hands back a File with the right name and type", async () => {
    await assets.putAsset("watermark", "logo.png", png("logo.png", 32));
    const onPick = vi.fn();
    render(<AssetPicker kind="watermark" onPick={onPick} />);
    await userEvent.click(await screen.findByText("logo.png"));
    await waitFor(() => expect(onPick).toHaveBeenCalled());
    const file: File = onPick.mock.calls[0][0];
    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe("logo.png");
    expect(file.type).toBe("image/png");
    expect(file.size).toBe(32);
  });

  it("offers to save the currently selected image", async () => {
    render(<AssetPicker kind="watermark" onPick={vi.fn()} saveable={png("brand.png")} />);
    await userEvent.click(await screen.findByText(/save this image/i));
    await waitFor(async () =>
      expect((await assets.listAssets("watermark")).map((a) => a.name)).toEqual(["brand.png"]),
    );
  });

  it("does not offer to save an image that is already saved", async () => {
    await assets.putAsset("watermark", "brand.png", png("brand.png", 64));
    render(<AssetPicker kind="watermark" onPick={vi.fn()} saveable={png("brand.png", 64)} />);
    expect(await screen.findByText("brand.png")).toBeInTheDocument();
    expect(screen.queryByText(/save this image/i)).not.toBeInTheDocument();
  });

  it("deletes a saved asset", async () => {
    await assets.putAsset("watermark", "logo.png", png("logo.png"));
    render(<AssetPicker kind="watermark" onPick={vi.fn()} />);
    await userEvent.click(await screen.findByLabelText(/delete logo\.png/i));
    await waitFor(async () => expect(await assets.listAssets("watermark")).toEqual([]));
  });

  it("surfaces a quota error instead of throwing", async () => {
    const huge = new File([new Uint8Array(assets.MAX_ASSET_BYTES + 1)], "huge.png", {
      type: "image/png",
    });
    render(<AssetPicker kind="watermark" onPick={vi.fn()} saveable={huge} />);
    await userEvent.click(await screen.findByText(/save this image/i));
    expect(await screen.findByText(/too large/i)).toBeInTheDocument();
  });
});
