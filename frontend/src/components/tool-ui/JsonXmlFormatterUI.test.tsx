import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { JsonXmlFormatterUI } from "./JsonXmlFormatterUI";
import { downloadBlob } from "@/lib/api";
import { loadSampleJsonText } from "@/lib/sample-files";

vi.mock("@/lib/api", () => ({ downloadBlob: vi.fn() }));
vi.mock("@/lib/sample-files", () => ({ loadSampleJsonText: vi.fn() }));
vi.mock("@/hooks/useFirstSuccess", () => ({ emitToolSuccess: vi.fn() }));
vi.mock("@/lib/localStore/defaults", () => ({ registerCustomized: vi.fn(), unregisterCustomized: vi.fn() }));

const input = () => screen.getByRole("textbox", { name: "Input" });
const replaceInput = (value: string) => fireEvent.change(input(), { target: { value } });
const choose = (operation: string) => fireEvent.click(screen.getByRole("button", { name: operation }));
const output = (name = "Formatted output") => screen.getByRole("region", { name }).querySelector("code")!.textContent!;
const readBlob = (blob: Blob) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(blob);
});

describe("JSON/XML consumer formatter", () => {
    beforeEach(() => {
        localStorage.clear();
        vi.mocked(downloadBlob).mockClear();
        vi.mocked(loadSampleJsonText).mockReset();
        vi.mocked(loadSampleJsonText).mockResolvedValue('{"example":"bundled"}');
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
            readText: vi.fn().mockResolvedValue('{"clipboard":true}'),
            writeText: vi.fn().mockResolvedValue(undefined),
        } });
    });
    afterEach(() => { cleanup(); vi.restoreAllMocks(); });

    it("keeps both panes present, with actions disabled until input exists", () => {
        render(<JsonXmlFormatterUI />);
        expect(input()).toHaveValue("");
        expect(screen.getByRole("heading", { name: "Output" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Format JSON" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
        expect(screen.getByRole("button", { name: "Download .json" })).toBeDisabled();
    });

    it("formats all JSON values without rounding large numbers or dropping duplicate keys", () => {
        render(<JsonXmlFormatterUI />);
        replaceInput('{"id":9007199254740993,"id":1e+20,"value":"a \\"quote\\"","empty":{},"list":[true,false,null]}');
        choose("Format JSON");
        expect(output()).toBe('{\n  "id": 9007199254740993,\n  "id": 1e+20,\n  "value": "a \\"quote\\"",\n  "empty": {},\n  "list": [\n    true,\n    false,\n    null\n  ]\n}');
        expect(screen.getByText("Valid JSON")).toBeInTheDocument();
    });

    it("moves focus to the output when it starts below the fold, as it does under the input on a phone", () => {
        const top = { value: 980 };
        vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
            const y = this.classList.contains("formatter-output-body") ? top.value : 0;
            return { x: 0, y, top: y, left: 0, right: 390, bottom: y + 60, width: 390, height: 60, toJSON: () => ({}) } as DOMRect;
        });
        const height = window.innerHeight;
        Object.defineProperty(window, "innerHeight", { configurable: true, value: 844 });
        onTestFinished(() => { Object.defineProperty(window, "innerHeight", { configurable: true, value: height }); });
        render(<JsonXmlFormatterUI />);
        replaceInput('{"b":1}');
        choose("Format JSON");
        expect(screen.getByRole("region", { name: "Formatted output" })).toHaveFocus();
        // The keyboard shortcut leaves the caret where the visitor is typing.
        input().focus();
        replaceInput('{"b":2}');
        fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true });
        expect(input()).toHaveFocus();
        // Beside the input, the output is already in view: focus stays on the button.
        top.value = 320;
        replaceInput('{"b":3}');
        const run = screen.getByRole("button", { name: "Format JSON" });
        run.focus();
        fireEvent.click(run);
        expect(run).toHaveFocus();
    });

    it("supports 4-space and tab indentation plus the existing keyboard shortcut", () => {
        render(<JsonXmlFormatterUI />);
        replaceInput('{"nested":{"value":1}}');
        fireEvent.change(screen.getByRole("combobox", { name: "Indentation" }), { target: { value: "4" } });
        fireEvent.keyDown(input(), { key: "Enter", ctrlKey: true });
        expect(output()).toContain('\n        "value": 1\n');
        fireEvent.change(screen.getByRole("combobox", { name: "Indentation" }), { target: { value: "tab" } });
        expect(screen.queryByText("Valid JSON")).not.toBeInTheDocument();
        fireEvent.keyDown(input(), { key: "Enter", metaKey: true });
        expect(output()).toContain('\n\t\t"value": 1\n');
    });

    it("minifies only insignificant JSON whitespace", () => {
        render(<JsonXmlFormatterUI />);
        replaceInput(' { "message": "keep  these spaces", "items": [ 1, 2 ] } ');
        choose("Minify");
        expect(screen.getByRole("combobox", { name: "Indentation" })).toBeDisabled();
        choose("Minify JSON");
        expect(output("Minified output")).toBe('{"message":"keep  these spaces","items":[1,2]}');
    });

    it("validates without rewriting the source", () => {
        render(<JsonXmlFormatterUI />);
        const text = ' \n { "value" : 123 } \n';
        replaceInput(text);
        choose("Validate");
        choose("Validate JSON");
        expect(output("Validated input")).toBe(text);
        expect(input()).toHaveValue(text);
    });

    it("clears stale output and success immediately on edits and reports syntax location", () => {
        render(<JsonXmlFormatterUI />);
        replaceInput('{"valid":true}');
        choose("Format JSON");
        replaceInput('{\n "valid": true,\n}');
        expect(screen.queryByText("Valid JSON")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
        choose("Format JSON");
        expect(screen.getByRole("alert")).toHaveTextContent(/Line 3/);
        expect(input()).toHaveAttribute("aria-invalid", "true");
        expect(screen.getByRole("button", { name: "Download .json" })).toBeDisabled();
        expect(screen.queryByRole("region", { name: "Formatted output" })).not.toBeInTheDocument();
        replaceInput('{"fixed":true}');
        expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("preserves XML mode and applies genuine nested indentation", () => {
        render(<JsonXmlFormatterUI />);
        choose("XML");
        replaceInput('<root><items><item id="1">hello</item><item id="2"/></items></root>');
        choose("Format XML");
        expect(output()).toBe('<root>\n  <items>\n    <item id="1">hello</item>\n    <item id="2"/>\n  </items>\n</root>');
        expect(screen.getByText("Valid XML")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Download .xml" })).toBeEnabled();
    });

    it.each(["Format", "Minify"])("preserves meaningful mixed-content and xml:space text during XML %s", operation => {
        render(<JsonXmlFormatterUI />);
        choose("XML");
        const text = '<root><p>Hello <b>friend</b> !</p><keep xml:space="preserve"> <a/> <b/> </keep><leaf>   </leaf></root>';
        replaceInput(text);
        if (operation === "Minify") choose("Minify");
        choose(operation + " XML");
        const formatted = output(operation === "Format" ? "Formatted output" : "Minified output");
        expect(formatted).toContain('<p>Hello <b>friend</b> !</p>');
        expect(formatted).toContain('<keep xml:space="preserve"> <a/> <b/> </keep>');
        expect(formatted).toContain("<leaf>   </leaf>");
    });

    it("retains XML declaration, internal doctype, comments and CDATA", () => {
        render(<JsonXmlFormatterUI />);
        choose("XML");
        replaceInput('<?xml version="1.0" encoding="UTF-16"?><!-- <!DOCTYPE example> --><!DOCTYPE root [<!ENTITY item "value">]><root><!-- note --><data><![CDATA[a < b]]></data><item>&item;</item></root>');
        choose("Format XML");
        const formatted = output();
        expect(formatted).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
        expect(formatted).toContain('<!-- <!DOCTYPE example> -->');
        expect(formatted).toContain('<!DOCTYPE root [<!ENTITY item "value">]>');
        expect(formatted).toContain("<!-- note -->");
        expect(formatted).toContain("<![CDATA[a < b]]>");
        expect(new DOMParser().parseFromString(formatted, "application/xml").getElementsByTagName("parsererror")).toHaveLength(0);
    });

    it("treats an ordinary element called parsererror as valid XML", () => {
        render(<JsonXmlFormatterUI />);
        choose("XML");
        replaceInput("<root><parsererror>user data</parsererror></root>");
        choose("Format XML");
        expect(screen.getByText("Valid XML")).toBeInTheDocument();
    });

    it("rejects malformed XML and invalidates output on mode changes", () => {
        render(<JsonXmlFormatterUI />);
        replaceInput("{}");
        choose("Format JSON");
        choose("XML");
        expect(screen.queryByText("Valid JSON")).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Copy" })).toBeDisabled();
        replaceInput("<root><item></root>");
        choose("Format XML");
        expect(screen.getByRole("alert")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Download .xml" })).toBeDisabled();
    });

    it("loads the bundled JSON example, clears safely, and supplies an XML example", async () => {
        render(<JsonXmlFormatterUI />);
        choose("Use example");
        await waitFor(() => expect(input()).toHaveValue('{"example":"bundled"}'));
        expect(screen.getByText("Example data")).toBeInTheDocument();
        choose("Format JSON");
        choose("Clear");
        expect(input()).toHaveValue("");
        expect(screen.queryByText("Example data")).not.toBeInTheDocument();
        expect(screen.queryByText("Valid JSON")).not.toBeInTheDocument();
        expect(input()).toHaveFocus();
        choose("XML");
        choose("Use example");
        await waitFor(() => expect((input() as HTMLTextAreaElement).value).toContain("<project>"));
        expect(screen.getByText("Example data")).toBeInTheDocument();
        replaceInput('<my>document</my>');
        expect(screen.queryByText("Example data")).not.toBeInTheDocument();
    });

    it("does not overwrite edits when a previously requested example finishes loading", async () => {
        let resolveExample!: (value: string) => void;
        vi.mocked(loadSampleJsonText).mockReturnValue(new Promise(resolve => { resolveExample = resolve; }));
        render(<JsonXmlFormatterUI />);
        choose("Use example");
        replaceInput('{"my":"changes"}');
        await act(async () => resolveExample('{"old":"example"}'));
        expect(input()).toHaveValue('{"my":"changes"}');
        expect(screen.queryByText("Example data")).not.toBeInTheDocument();
    });

    it("pastes, copies and downloads the actual output", async () => {
        render(<JsonXmlFormatterUI />);
        choose("Paste");
        await waitFor(() => expect(input()).toHaveValue('{"clipboard":true}'));
        choose("Format JSON");
        choose("Copy");
        await waitFor(() => expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument());
        expect(navigator.clipboard.writeText).toHaveBeenCalledWith('{\n  "clipboard": true\n}');
        choose("Download .json");
        const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0];
        expect(filename).toBe("format.json");
        expect(blob.type).toContain("application/json");
        expect(await readBlob(blob)).toBe('{\n  "clipboard": true\n}');
    });

    it("handles clipboard denial without claiming a successful copy", async () => {
        vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error("denied"));
        vi.mocked(navigator.clipboard.readText).mockRejectedValue(new Error("denied"));
        render(<JsonXmlFormatterUI />);
        choose("Paste");
        await screen.findByText(/Clipboard access isn't available/);
        replaceInput("{}");
        choose("Format JSON");
        choose("Copy");
        await screen.findByText(/Copy wasn't allowed/);
        expect(screen.queryByRole("button", { name: "Copied" })).not.toBeInTheDocument();
    });

    it("labels a validated XML download with its actual UTF-8 byte encoding", async () => {
        render(<JsonXmlFormatterUI />);
        choose("XML");
        const text = '<?xml version="1.0" encoding="UTF-16"?><root>café</root>';
        replaceInput(text);
        choose("Validate");
        choose("Validate XML");
        expect(output("Validated input")).toBe(text);
        choose("Download .xml");
        const [blob, filename] = vi.mocked(downloadBlob).mock.calls[0];
        expect(filename).toBe("validate.xml");
        expect(await readBlob(blob)).toBe('<?xml version="1.0" encoding="UTF-8"?><root>café</root>');
        expect(screen.getByText("The XML download uses UTF-8 encoding.")).toBeInTheDocument();
    });

    it("selects only output text with Ctrl+A, excluding decorative line numbers", () => {
        render(<JsonXmlFormatterUI />);
        replaceInput('{"select":"me"}');
        choose("Format JSON");
        fireEvent.keyDown(screen.getByRole("region", { name: "Formatted output" }), { key: "a", ctrlKey: true });
        expect(window.getSelection()?.toString()).toBe('{\n  "select": "me"\n}');
    });

    it("restores the existing mode preference while keeping document content ephemeral", async () => {
        localStorage.setItem("privatools_form_json-xml-formatter", JSON.stringify({ v: 1, ts: Date.now(), data: { mode: "xml" } }));
        const view = render(<JsonXmlFormatterUI />);
        expect(screen.getByRole("button", { name: "XML" })).toHaveAttribute("aria-pressed", "true");
        expect(screen.getByRole("combobox", { name: "Indentation" })).toHaveValue("2");
        replaceInput("<private>do not remember</private>");
        choose("Format XML");
        view.unmount();
        render(<JsonXmlFormatterUI />);
        expect(input()).toHaveValue("");
        expect(screen.queryByText("Valid XML")).not.toBeInTheDocument();
        expect(localStorage.getItem("privatools_form_json-xml-formatter")).not.toContain("private");
    });
});
