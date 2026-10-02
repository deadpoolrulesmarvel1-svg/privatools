import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { useDownloadOnce } from "./useDownloadOnce";
import { downloadAgainLabel, downloadStarted, partialLine } from "./studio-outcome";

afterEach(cleanup);

function Probe({ finished, results, download }: { finished: boolean; results: number; download: () => void }) {
    useDownloadOnce(finished, results, download);
    return null;
}

describe("the download policy", () => {
    it("downloads a finished run once, however often it renders", () => {
        const download = vi.fn();
        const view = render(<Probe finished={false} results={0} download={download} />);
        expect(download).not.toHaveBeenCalled();
        view.rerender(<Probe finished results={2} download={download} />);
        view.rerender(<Probe finished results={2} download={() => download()} />);
        view.rerender(<Probe finished results={3} download={download} />);
        expect(download).toHaveBeenCalledTimes(1);
    });

    it("downloads nothing when the run made nothing", () => {
        const download = vi.fn();
        render(<Probe finished results={0} download={download} />);
        expect(download).not.toHaveBeenCalled();
    });

    it("arms again once the result is left, so a retry's run downloads once too", () => {
        const download = vi.fn();
        const view = render(<Probe finished results={1} download={download} />);
        view.rerender(<Probe finished={false} results={1} download={download} />);
        view.rerender(<Probe finished results={2} download={download} />);
        expect(download).toHaveBeenCalledTimes(2);
    });

    it("names what it offers again: the file, or the ZIP of several", () => {
        expect(downloadAgainLabel(1)).toBe("Download again");
        expect(downloadAgainLabel(4)).toBe("Download ZIP again");
        expect(downloadStarted(1)).toBe("The download has started.");
        expect(downloadStarted(2)).toBe("The ZIP download has started.");
        expect(partialLine(1, "cropped")).toBe("One file couldn’t be cropped; the reason is below.");
        expect(partialLine(3)).toBe("3 files couldn’t be processed; the reasons are below.");
    });
});
