/**
 * The eight media tools that kept their run button inside their settings now
 * run from the shared action bar, which counts the file and says where it
 * goes on a tool page: one structure with every other tool (step 2b).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactElement } from "react";
import { ToolLocationProvider, toolLocation } from "@/skins/experience/tool-location";
import { FaviconUI } from "../FaviconUI";
import { CollageUI } from "../CollageUI";
import { MergeImagesUI } from "../MergeImagesUI";
import { TrimMediaUI } from "../TrimMediaUI";
import { AddSubtitlesUI } from "../VideoToolVariants";
import { ImagePaletteUI } from "../Phase7Tools";
import { RemoveImageWatermarkUI, ViewExifUI } from "../MediaInspectors";

vi.mock("@/lib/localStore/defaults", () => ({ registerCustomized: vi.fn(), unregisterCustomized: vi.fn() }));
afterEach(() => { cleanup(); localStorage.clear(); });

const image = (name = "garden.jpg") => new File(["image bytes"], name, { type: "image/jpeg" });
const clip = new File(["video bytes"], "clip.mp4", { type: "video/mp4" });

const TOOLS: [string, () => ReactElement, string, File[], string][] = [
    ["Favicon", () => <FaviconUI />, "Create the favicon", [image()], "1 image"],
    ["Collage", () => <CollageUI />, "Make the collage", [image("a.jpg"), image("b.jpg")], "2 images"],
    ["Merge Images", () => <MergeImagesUI />, "Merge images", [image("a.jpg"), image("b.jpg")], "2 images"],
    ["Trim", () => <TrimMediaUI />, "Trim media", [clip], "1 video"],
    ["Add Subtitles", () => <AddSubtitlesUI />, "Add subtitles", [clip], "1 video"],
    ["Image Palette", () => <ImagePaletteUI />, "Find the colours", [image()], "1 image"],
    ["Remove Image Watermark", () => <RemoveImageWatermarkUI />, "Clean the selected areas", [image()], "1 image"],
    ["View EXIF", () => <ViewExifUI />, "Inspect metadata", [image()], "1 image"],
];

describe.each(TOOLS)("%s", (_name, ui, run, files, count) => {
    it("runs from the action bar, which counts the file and says where it goes", () => {
        const { container } = render(<ToolLocationProvider value={toolLocation({ slug: "a-server-tool" })}>{ui()}</ToolLocationProvider>);
        fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files } });
        const bar = container.querySelector(".ts-action-bar")!;
        expect(bar).not.toBeNull();
        expect(bar.querySelector("button")).toHaveTextContent(run);
        expect(bar).toHaveTextContent(count);
        expect(bar).toHaveTextContent("Temporary server processing");
        // The settings no longer hold a run button of their own.
        expect(container.querySelector(".ms-settings .ms-run")).toBeNull();
        expect(container.querySelectorAll(".ms-primary")).toHaveLength(1);
    });
});
