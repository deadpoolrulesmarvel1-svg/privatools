/**
 * Batch and the Pipeline retry only what another attempt could fix, with the
 * same classification as the tool pages (isTransientFailure): a dropped
 * connection, a time limit, the rate limit or a server fault. A file or step
 * the server refused keeps its reason on its row and is never offered again;
 * before step 2b, Batch said "Retry 1 failure" and "Process 1 (1 retry)" for a
 * 400, and the Pipeline "Retry from 2" for any failed step.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import PipelinePage from "@/pages/PipelinePage";
import BatchPage from "@/pages/BatchPage";

const api = vi.hoisted(() => ({ postFormData: vi.fn(), downloadBlob: vi.fn() }));
vi.mock("@/lib/api", async (load) => ({ ...await load<typeof import("@/lib/api")>(), ...api }));

function ok() { return { blob: async () => new Blob(["output"], { type: "application/pdf" }), headers: new Headers() } as Response; }
/** The shape api.ts gives an HTTP error: the message the UI shows, plus the status. */
function httpError(status: number, message: string) { return Object.assign(new Error(message), { __status: status }); }

beforeEach(() => {
    localStorage.clear(); api.postFormData.mockReset(); api.downloadBlob.mockReset();
    URL.createObjectURL = vi.fn(() => "blob:synthetic"); URL.revokeObjectURL = vi.fn();
});
afterEach(cleanup);

describe("Batch retries", () => {
    function setup(files: File[]) {
        const { container } = render(<BatchPage />);
        fireEvent.click(within(container.querySelector(".pt-batch-tool-picker") as HTMLElement).getByRole("button", { name: /Change tool/ }));
        fireEvent.change(screen.getByPlaceholderText(/Filter .* batchable tools/), { target: { value: "PNG to WebP" } });
        fireEvent.click(screen.getByRole("button", { name: "PNG to WebP" }));
        fireEvent.change(container.querySelector('input[type="file"]')!, { target: { files } });
        return container;
    }
    const png = (name: string) => new File(["png"], name, { type: "image/png" });
    const sent = () => api.postFormData.mock.calls.map(call => {
        const form = (typeof call[1] === "function" ? call[1]() : call[1]) as FormData;
        return (form.get("file") as File | null)?.name;
    });

    it("says a refused file's reason on its row and offers no retry for it", async () => {
        api.postFormData.mockImplementation(async (_endpoint: string, build: () => FormData) => {
            const name = (build().get("file") as File).name;
            if (name === "fake.png") throw httpError(400, "That file isn’t a readable image.");
            return ok();
        });
        const container = setup([png("photo.png"), png("fake.png")]);
        fireEvent.click(screen.getByRole("button", { name: "Process 2" }));
        await screen.findByText("That file isn’t a readable image.");
        const header = within(container.querySelector(".pt-workflow-header") as HTMLElement);
        // Nothing left to run: the refused file is not counted as one to process again.
        expect(header.getByRole("button", { name: /^Process/ })).toBeDisabled();
        expect(header.getByRole("button", { name: /^Process/ })).not.toHaveTextContent(/retry|try again/i);
        expect(screen.queryByRole("button", { name: /Retry|Try .*again/ })).toBeNull();
        expect(sent()).toEqual(["photo.png", "fake.png"]);
    });

    it.each([
        ["one file is done and the other was refused", ["photo.png", "fake.png"]],
        ["every file is done", ["photo.png", "holiday.png"]],
    ])("counts no files in its run button once %s", async (_case, names) => {
        api.postFormData.mockImplementation(async (_endpoint: string, build: () => FormData) => {
            if ((build().get("file") as File).name === "fake.png") throw httpError(400, "That file isn’t a readable image.");
            return ok();
        });
        const container = setup(names.map(png));
        fireEvent.click(screen.getByRole("button", { name: "Process 2" }));
        await waitFor(() => expect(sent()).toEqual(names));
        const header = within(container.querySelector(".pt-workflow-header") as HTMLElement);
        // Two files are still listed, but nothing is left to run: it used to say "Process 2".
        await waitFor(() => expect(header.getByRole("button", { name: /^Process/ })).toBeDisabled());
        expect(header.getByRole("button", { name: /^Process/ })).toHaveAccessibleName("Process");
    });

    it("offers \"Try again\" for a server fault and sends only that file again", async () => {
        let busy = true;
        api.postFormData.mockImplementation(async (_endpoint: string, build: () => FormData) => {
            const name = (build().get("file") as File).name;
            if (name === "fake.png") throw httpError(400, "That file isn’t a readable image.");
            if (name === "busy.png" && busy) throw httpError(503, "The server is busy. Please try again.");
            return ok();
        });
        const container = setup([png("busy.png"), png("fake.png")]);
        fireEvent.click(screen.getByRole("button", { name: "Process 2" }));
        await screen.findByText("The server is busy. Please try again.");
        const header = within(container.querySelector(".pt-workflow-header") as HTMLElement);
        expect(header.getByRole("button", { name: /^Process 1/ })).toHaveTextContent("(1 to try again)");
        expect(screen.getByRole("button", { name: "Try busy.png again" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Try fake.png again" })).toBeNull();
        busy = false;
        fireEvent.click(screen.getByRole("button", { name: "Try again" }));
        await waitFor(() => expect(sent()).toEqual(["busy.png", "fake.png", "busy.png"]));
        await waitFor(() => expect(screen.queryByText("The server is busy. Please try again.")).toBeNull());
        expect(screen.getByText("That file isn’t a readable image.")).toBeInTheDocument();
    });
});

describe("Pipeline retries", () => {
    const original = new File(["%PDF-1.4\noriginal"], "Report.pdf", { type: "application/pdf" });
    function run(container: HTMLElement) {
        const header = within(container.querySelector(".pt-workflow-header") as HTMLElement);
        fireEvent.click(container.querySelector(".pt-pipeline-recipe") as HTMLButtonElement);
        fireEvent.change(container.querySelector('input[type="file"]') as HTMLInputElement, { target: { files: [original] } });
        fireEvent.click(header.getByRole("button", { name: "Run pipeline" }));
    }

    it("offers no retry for a step the server refused, and says why on the step", async () => {
        // The whole-chain call fails, step 1 succeeds, step 2 is refused.
        api.postFormData.mockRejectedValueOnce(new Error("chain unavailable")).mockResolvedValueOnce(ok()).mockRejectedValueOnce(httpError(400, "This step can't read that PDF."));
        const { container } = render(<PipelinePage />);
        run(container);
        const notice = await screen.findByRole("alert");
        expect(notice).toHaveTextContent(/Step 2 .* failed: This step can't read that PDF\./);
        expect(screen.queryByRole("button", { name: /Retry|Try again from step/ })).toBeNull();
        expect(notice).not.toHaveTextContent(/Continue from step/);
        expect(container.querySelector("[data-step-state=error]")).toHaveTextContent("This step can't read that PDF.");
    });

    it("offers \"Try again from step 2\" after a time limit, and resumes there", async () => {
        api.postFormData.mockRejectedValueOnce(new Error("chain unavailable")).mockResolvedValueOnce(ok()).mockRejectedValueOnce(httpError(504, "It took too long."));
        const { container } = render(<PipelinePage />);
        run(container);
        const notice = await screen.findByRole("alert");
        expect(notice).toHaveTextContent(/It ran out of time\./);
        expect(notice).toHaveTextContent(/Earlier steps are kept\. Continue from step 2\./);
        // In the notice, and on the step itself.
        expect(screen.getAllByRole("button", { name: "Try again from step 2" })).toHaveLength(2);
        api.postFormData.mockResolvedValue(ok());
        const calls = api.postFormData.mock.calls.length;
        fireEvent.click(within(notice).getByRole("button", { name: /Try again from step 2/ }));
        await waitFor(() => expect(api.downloadBlob).toHaveBeenCalledOnce());
        // Step 1's output is reused: the resumed run starts at step 2.
        expect(api.postFormData.mock.calls.length - calls).toBe(JSON.parse(localStorage.getItem("privatools_pipeline_draft") || "[]").length - 1);
    });
});
