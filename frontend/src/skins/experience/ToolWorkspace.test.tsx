import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toolSeo } from "@/lib/tool-seo";
import { ToolWorkspace } from "./ToolWorkspace";
import { FileIntake } from "./ToolStudio";

vi.mock("../daylight/consumer/ConsumerChrome", () => ({ FavoriteButton: () => null }));
vi.mock("./ToolGuide", () => ({ ToolGuide: ({ slug }: { slug: string }) => <div data-testid="guide">{slug}</div> }));
afterEach(cleanup);

const COMPRESS = { slug: "compress-pdf", name: "Compress PDF", seoTitle: "Compress PDF Online Free – Shrink Your File Size", description: "Reduce the file size of your PDF", category: "pdf" };

async function page(tool: Parameters<typeof ToolWorkspace>[0]["tool"], children: React.ReactNode = <div>File picker</div>) {
    await act(async () => { render(<ToolWorkspace tool={tool} categoryLabel="PDF" related={[]} onFindTool={() => undefined}>{children}</ToolWorkspace>); });
}

describe("tool page heading", () => {
    it("is the tool's name and its one-line promise; the search title stays in the tab", async () => {
        await page(COMPRESS);
        const h1 = screen.getByRole("heading", { level: 1 });
        expect(h1).toHaveTextContent(/^Compress PDF: Reduce the file size of your PDF$/);
        expect(h1).toHaveAccessibleName("Compress PDF: Reduce the file size of your PDF");
        expect(h1).not.toHaveTextContent("Online Free");
        // Two lines on screen: the name, then the promise.
        expect(h1.querySelector(".tw-name")).toHaveTextContent(/^Compress PDF:$/);
        expect(h1.querySelector(".tw-name .sr-only")).toHaveTextContent(/^:$/);
        expect(h1.querySelector(".tw-promise")).toHaveTextContent(/^Reduce the file size of your PDF$/);
        expect(screen.queryByText("Compress PDF Online Free – Shrink Your File Size")).toBeNull();
    });

    it("says what the crawler HTML says for every registered tool (backend _tool_page_body)", async () => {
        const manifest = JSON.parse(readFileSync(join(process.cwd(), "public/tool-content.json"), "utf8")) as { slug: string; name: string; description: string; seoTitle?: string; category: string }[];
        expect(manifest.length).toBeGreaterThan(200);
        for (const row of manifest) {
            const promise = row.description?.trim();
            expect(toolSeo(row).h1).toBe(promise ? `${row.name}: ${promise}` : row.name);
            if (row.seoTitle) expect(toolSeo(row).title).toBe(row.seoTitle);
        }
        for (const row of manifest.slice(0, 3)) {
            await page(row);
            expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(toolSeo(row).h1);
            cleanup();
        }
    });
});

describe("where the file goes", () => {
    it("gives Background Remover a browser/server choice and explains the default upload", async () => {
        await page({ slug: "remove-background", name: "Background Remover", description: "Make a cutout", category: "image" }, <div>Engine selector</div>);
        expect(screen.getByText(/^Browser or server · your choice\.$/)).toBeInTheDocument();
        expect(screen.queryByText(/Temporary server processing/)).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "How it works" }));
        expect(screen.getAllByText(/default server engine uploads images/).length).toBeGreaterThan(0);
        expect(screen.getAllByText(/Both options work without an account or an AI provider key/).length).toBeGreaterThan(0);
    });

    it("keeps an ordinary server tool's disclosure, as readable text with a way to read more", async () => {
        await page(COMPRESS);
        const where = document.querySelector(".tw-where-fallback")!;
        expect(where).toHaveTextContent("Temporary server processing. Files are uploaded only when you run the tool. PrivaTools processes them in temporary storage and removes the job’s files after the response.");
        expect(within(where as HTMLElement).getByRole("link", { name: "Read about file handling" })).toHaveAttribute("href", "/trust");
        expect(screen.getByTestId("guide")).toHaveTextContent("compress-pdf");
        expect(document.querySelector(".tw-task-shelf, .tw-processing")).toBeNull();
    });

    it("says it inside the intake of a tool built on the shared kit, and the page line steps aside for it", async () => {
        await page({ ...COMPRESS, slug: "json-xml-formatter", name: "JSON / XML Formatter", clientOnly: true }, <div className="tool-studio"><FileIntake accepts=".json" title="Your JSON" onFiles={() => undefined} /></div>);
        const intake = document.querySelector(".ts-intake")!;
        expect(intake).toHaveTextContent("Stays on your device. Processing happens in this browser. Your input stays on this device.");
        // Clicking the link reads about file handling; it does not open the file chooser.
        const input = intake.querySelector<HTMLInputElement>("input[type=file]")!;
        const choose = vi.spyOn(input, "click").mockImplementation(() => {});
        fireEvent.click(within(intake as HTMLElement).getByRole("link", { name: "Read about file handling" }));
        expect(choose).not.toHaveBeenCalled();
        const css = readFileSync(join(process.cwd(), "src/skins/experience/tool-workspace.css"), "utf8");
        expect(css).toMatch(/\.tw-workspace:has\(\.tw-working-area :is\(\.tool-studio,\.ts-result,\.ms-workspace,\.merge-workbench,[^)]*\)\) \.tw-where-fallback\{display:none\}/);
    });
});

describe("page utilities", () => {
    it("opens the tool search from a search control, not an external-link arrow", async () => {
        const onFindTool = vi.fn();
        await act(async () => { render(<ToolWorkspace tool={COMPRESS} categoryLabel="PDF" related={[]} onFindTool={onFindTool}><div /></ToolWorkspace>); });
        const find = screen.getByRole("button", { name: "Find another tool" });
        expect(find.querySelector(".lucide-search")).not.toBeNull();
        expect(find.querySelector(".lucide-arrow-up-right")).toBeNull();
        fireEvent.click(find);
        expect(onFindTool).toHaveBeenCalledTimes(1);
    });
});
