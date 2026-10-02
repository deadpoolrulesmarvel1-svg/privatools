/**
 * Local JSON/XML formatter. Only mode and indentation are remembered; input
 * and output stay in this component's memory.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Braces, CheckCircle2, CircleAlert, Copy, Check, Download, Clipboard, Laptop, Loader2 } from "lucide-react";
import { downloadBlob } from "@/lib/api";
import { loadSampleJsonText } from "@/lib/sample-files";
import { emitToolRun } from "@/lib/toolRun";
import { emitToolSuccess } from "@/hooks/useFirstSuccess";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import "./JsonXmlFormatterUI.css";

type Mode = "json" | "xml";
type Action = "format" | "minify" | "validate";
type Indent = "2" | "4" | "tab";
type Issue = { message: string; line?: number; column?: number };
type Result = { text: string; action: Action; mode: Mode } | null;

const DEFAULTS: { mode: Mode; indent: Indent } = { mode: "json", indent: "2" };
const JSON_EXAMPLE = '{"project":"Weekend plans","items":["Book tickets","Pack a bag"],"ready":true}';
const XML_EXAMPLE = '<project><name>Weekend plans</name><items><item>Book tickets</item><item>Pack a bag</item></items><ready>true</ready></project>';

function locateJsonError(text: string, message: string): Issue {
    const position = message.match(/position (\d+)/i);
    if (position) {
        const offset = Number(position[1]);
        const before = text.slice(0, offset);
        return { message, line: before.split("\n").length, column: offset - before.lastIndexOf("\n") };
    }
    const location = message.match(/line (\d+)[,\s]+column (\d+)/i);
    return location ? { message, line: Number(location[1]), column: Number(location[2]) } : { message };
}

/** Validate with the native parser, but keep source number/string tokens:
 * JSON.stringify(JSON.parse(...)) silently rounds large integer values. */
function transformJson(text: string, action: Action, indent: string): string {
    JSON.parse(text);
    if (action === "validate") return text;
    const tokens = text.match(/"(?:\\[\s\S]|[^"\\])*"|[{}[\],:]|[^\s{}[\],:]+/g) || [];
    if (action === "minify") return tokens.join("");
    let depth = 0;
    let output = "";
    tokens.forEach((token, index) => {
        if (token === "{" || token === "[") {
            output += token;
            depth++;
            if (tokens[index + 1] !== (token === "{" ? "}" : "]")) output += "\n" + indent.repeat(depth);
        } else if (token === "}" || token === "]") {
            depth--;
            if (tokens[index - 1] !== (token === "}" ? "{" : "[")) output += "\n" + indent.repeat(depth);
            output += token;
        } else if (token === ",") output += ",\n" + indent.repeat(depth);
        else if (token === ":") output += ": ";
        else output += token;
    });
    return output;
}

/** Find the complete doctype, including a quoted/internal subset, so the
 * browser serializer cannot drop its entity declarations. */
function doctypeRange(text: string): [number, number] | null {
    let start = 0;
    // The declaration belongs to the prolog. Ignore lookalike text inside a
    // comment or processing instruction rather than replacing that content.
    while (true) {
        start = text.indexOf("<", start);
        if (start < 0) return null;
        if (text.startsWith("<!--", start) || text.startsWith("<?", start)) {
            const terminator = text.startsWith("<!--", start) ? "-->" : "?>";
            const end = text.indexOf(terminator, start + 2);
            if (end < 0) return null;
            start = end + terminator.length;
        } else if (text.startsWith("<!DOCTYPE", start)) break;
        else return null;
    }
    let quote = "";
    let subset = 0;
    for (let index = start + 9; index < text.length; index++) {
        const char = text[index];
        if (quote) { if (char === quote) quote = ""; continue; }
        if (text.startsWith("<!--", index)) {
            const end = text.indexOf("-->", index + 4);
            if (end < 0) return null;
            index = end + 2;
        } else if (char === '"' || char === "'") quote = char;
        else if (char === "[") subset++;
        else if (char === "]") subset--;
        else if (char === ">" && subset === 0) return [start, index + 1];
    }
    return null;
}

function transformXml(text: string, action: Action, indent: string): { text?: string; issue?: Issue } {
    const document = new DOMParser().parseFromString(text, "application/xml");
    const parserError = Array.from(document.getElementsByTagName("parsererror")).find(element =>
        element.namespaceURI === "http://www.mozilla.org/newlayout/xml/parsererror.xml"
        || element.namespaceURI === "http://www.w3.org/1999/xhtml");
    if (parserError) {
        const message = (parserError.textContent?.trim() || "This XML is not well formed.")
            .replace(/^This page contains the following errors:\s*/i, "")
            .replace(/\s*Below is a rendering of the page up to the first error\.[\s\S]*$/i, "");
        const location = message.match(/(?:line\s+)?(\d+)(?::|[,\s]+(?:at\s+)?column\s+)(\d+)/i);
        return { issue: { message, ...(location ? { line: Number(location[1]), column: Number(location[2]) } : {}) } };
    }
    if (action === "validate") return { text };

    const visit = (element: Element, depth: number, preserve = false) => {
        const space = element.getAttribute("xml:space");
        const keepSpace = space === "preserve" || (preserve && space !== "default");
        const children = Array.from(element.childNodes);
        const hasMixedText = children.some(node => node.nodeType === Node.CDATA_SECTION_NODE
            || (node.nodeType === Node.TEXT_NODE && Boolean(node.textContent?.trim())));
        // Text between elements can be meaningful. Leave mixed content and
        // xml:space subtrees unchanged, including their descendant spacing.
        if (keepSpace || hasMixedText || !children.some(node => node.nodeType === Node.ELEMENT_NODE)) return;
        for (const child of children) {
            if (child.nodeType === Node.TEXT_NODE && !child.textContent?.trim()) element.removeChild(child);
            else if (child.nodeType === Node.ELEMENT_NODE) visit(child as Element, depth + 1, keepSpace);
        }
        if (action === "format") {
            for (const child of Array.from(element.childNodes)) {
                element.insertBefore(document.createTextNode("\n" + indent.repeat(depth + 1)), child);
            }
            element.appendChild(document.createTextNode("\n" + indent.repeat(depth)));
        }
    };
    visit(document.documentElement, 0);
    let output = new XMLSerializer().serializeToString(document);
    const originalDoctype = doctypeRange(text);
    const serializedDoctype = doctypeRange(output);
    if (originalDoctype && serializedDoctype) {
        output = output.slice(0, serializedDoctype[0]) + text.slice(...originalDoctype) + output.slice(serializedDoctype[1]);
    }
    // Downloads are UTF-8 blobs, so a retained encoding declaration must
    // describe those generated bytes rather than the source file's encoding.
    const declaration = text.match(/^\s*(<\?xml\s[\s\S]*?\?>)/i)?.[1]
        .replace(/\bencoding\s*=\s*(["'])[^"']+\1/i, 'encoding="UTF-8"');
    if (declaration) output = declaration + (action === "format" ? "\n" : "") + output;
    return { text: output };
}

function HighlightedCode({ text, mode }: { text: string; mode: Mode }) {
    if (text.length > 150_000) return <>{text}</>;
    const expression = mode === "json"
        ? /("(?:\\[\s\S]|[^"\\])*")(\s*:)?|\b(true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g
        : /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[^>]+>/g;
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    for (const match of text.matchAll(expression)) {
        const index = match.index || 0;
        parts.push(text.slice(cursor, index));
        const token = match[0];
        const type = mode === "xml" ? (token.startsWith("<!--") ? "comment" : "key")
            : match[2] ? "key" : token.startsWith('"') ? "string" : /^(true|false|null)$/.test(token) ? "literal" : "number";
        parts.push(<span className={"formatter-token-" + type} key={index}>{token}</span>);
        cursor = index + token.length;
    }
    parts.push(text.slice(cursor));
    return <>{parts}</>;
}

export function JsonXmlFormatterUI() {
    const [config, , { setField }] = useToolDefaults("json-xml-formatter", DEFAULTS);
    const mode: Mode = config.mode === "xml" ? "xml" : "json";
    const indent: Indent = ["2", "4", "tab"].includes(config.indent) ? config.indent : "2";
    const [action, setAction] = useState<Action>("format");
    const [input, setInput] = useState("");
    const [result, setResult] = useState<Result>(null);
    const [issue, setIssue] = useState<Issue | null>(null);
    const [notice, setNotice] = useState("");
    const [copied, setCopied] = useState(false);
    const [loadingExample, setLoadingExample] = useState(false);
    const [isExample, setIsExample] = useState(false);
    const revision = useRef(0);
    const copyTimer = useRef<ReturnType<typeof setTimeout>>();
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const inputGutterRef = useRef<HTMLPreElement>(null);

    useEffect(() => () => { revision.current++; clearTimeout(copyTimer.current); }, []);
    const invalidate = useCallback(() => {
        revision.current++;
        setResult(null);
        setIssue(null);
        setNotice("");
        setCopied(false);
        clearTimeout(copyTimer.current);
    }, []);
    const changeInput = useCallback((value: string) => { invalidate(); setIsExample(false); setInput(value); }, [invalidate]);
    const indentText = indent === "tab" ? "\t" : " ".repeat(Number(indent));
    const upperMode = mode.toUpperCase();
    const actionName = action === "format" ? "Format" : action === "minify" ? "Minify" : "Validate";

    const run = () => {
        if (!input.trim()) return;
        // Show the beginning of the source when the keyboard caret had
        // horizontally scrolled a long minified line while editing.
        if (inputRef.current) inputRef.current.scrollLeft = 0;
        setNotice("");
        setCopied(false);
        clearTimeout(copyTimer.current);
        try {
            if (mode === "json") {
                setResult({ text: transformJson(input, action, indentText), action, mode });
                setIssue(null);
            } else {
                const transformed = transformXml(input, action, indentText);
                if (transformed.issue) { setIssue(transformed.issue); setResult(null); emitToolRun({ outcome: "error", errorKind: "bad_input" }); return; }
                setResult({ text: transformed.text!, action, mode });
                setIssue(null);
            }
            emitToolSuccess("JSON / XML formatter");
            emitToolRun({ outcome: "success" });
        } catch (error) {
            const message = error instanceof Error ? error.message : "We couldn't read this input.";
            setIssue(mode === "json" ? locateJsonError(input, message) : { message });
            setResult(null);
            // Anything thrown here is shown as an issue in the input.
            emitToolRun({ outcome: "error", errorKind: "bad_input" }, error);
        }
    };

    const loadExample = async () => {
        const version = revision.current;
        setLoadingExample(true);
        let example = mode === "json" ? JSON_EXAMPLE : XML_EXAMPLE;
        if (mode === "json") {
            try { example = await loadSampleJsonText(); } catch { /* Inline example works offline. */ }
        }
        if (version === revision.current) { changeInput(example); setIsExample(true); }
        setLoadingExample(false);
    };

    const paste = async () => {
        const version = revision.current;
        try {
            const text = await navigator.clipboard.readText();
            if (version !== revision.current) return;
            changeInput(text);
            inputRef.current?.focus();
            if (!text) setNotice("Your clipboard is empty.");
        } catch {
            if (version === revision.current) setNotice("Clipboard access isn't available. Click the input and press Ctrl+V or ⌘V to paste.");
        }
    };

    const copy = async () => {
        if (!result) return;
        const version = revision.current;
        try {
            await navigator.clipboard.writeText(result.text);
            if (version !== revision.current) return;
            setNotice("");
            setCopied(true);
            clearTimeout(copyTimer.current);
            copyTimer.current = setTimeout(() => setCopied(false), 1800);
        } catch {
            if (version === revision.current) setNotice("Copy wasn't allowed. Select the output text and use Ctrl+C or ⌘C.");
        }
    };

    const download = () => {
        if (!result) return;
        const text = mode === "xml" ? result.text.replace(/^(\s*<\?xml\s[^?]*?\bencoding\s*=\s*)(["'])[^"']+\2/i, '$1"UTF-8"') : result.text;
        downloadBlob(new Blob([text], { type: mode === "json" ? "application/json;charset=utf-8" : "application/xml;charset=utf-8" }), result.action + "." + mode);
        if (text !== result.text) setNotice("The XML download uses UTF-8 encoding.");
    };
    const inputLineNumbers = useMemo(() => Array.from({ length: Math.max(1, input.split("\n").length) }, (_, i) => i + 1).join("\n"), [input]);
    const outputLineNumbers = useMemo(() => Array.from({ length: Math.max(1, result?.text.split("\n").length || 1) }, (_, i) => i + 1).join("\n"), [result]);
    const outputLabel = result ? (result.action === "format" ? "Formatted output" : result.action === "minify" ? "Minified output" : "Validated input") : "Output";

    return (
        <section className="consumer-formatter" aria-label="JSON and XML formatter">
            <div className="formatter-mode-row">
                <div className="formatter-segments formatter-modes" role="group" aria-label="Data format">
                    {(["json", "xml"] as const).map(value => (
                        <button type="button" key={value} aria-pressed={mode === value} onClick={() => { if (mode !== value) { invalidate(); setField("mode", value); } }}>
                            {value.toUpperCase()}
                        </button>
                    ))}
                </div>
                <span className="formatter-local-label"><Laptop size={15} aria-hidden="true" /> On your device</span>
            </div>

            <div className="formatter-toolbar">
                <div className="formatter-primary-controls">
                    <div className="formatter-segments" role="group" aria-label="Operation">
                        {(["format", "minify", "validate"] as const).map(value => (
                            <button type="button" key={value} aria-pressed={action === value} onClick={() => { if (action !== value) { invalidate(); setAction(value); } }}>
                                {value[0].toUpperCase() + value.slice(1)}
                            </button>
                        ))}
                    </div>
                    <label className="formatter-indent">
                        <span>Indent</span>
                        <select aria-label="Indentation" value={indent} disabled={action !== "format"} onChange={event => { invalidate(); setField("indent", event.target.value as Indent); }}>
                            <option value="2">2 spaces</option>
                            <option value="4">4 spaces</option>
                            <option value="tab">Tabs</option>
                        </select>
                    </label>
                    <button type="button" className="formatter-run" disabled={!input.trim()} onClick={run} title={actionName + " " + upperMode + " (Ctrl/⌘ + Enter)"}>
                        {actionName} {upperMode}
                    </button>
                </div>
                <div className="formatter-secondary-controls">
                    <button type="button" className="formatter-button" onClick={() => void loadExample()} disabled={loadingExample}>
                        {loadingExample && <Loader2 size={15} className="formatter-spinner" aria-hidden="true" />} Use example
                    </button>
                    <button type="button" className="formatter-button" disabled={!input && !result && !issue && !notice} onClick={() => { changeInput(""); inputRef.current?.focus(); }}>Clear</button>
                </div>
            </div>

            <div className="formatter-editors">
                <div className={"formatter-pane" + (issue ? " formatter-pane-error" : "")}>
                    <div className="formatter-pane-heading">
                        <div className="formatter-pane-label"><label htmlFor="formatter-input">Input</label>{isExample && <span id="formatter-example-marker" className="formatter-example-marker">Example data</span>}</div>
                        <button type="button" className="formatter-text-button" onClick={() => void paste()}><Clipboard size={16} aria-hidden="true" /> Paste</button>
                    </div>
                    <div className="formatter-input-body">
                        <pre ref={inputGutterRef} className="formatter-line-numbers" aria-hidden="true">{inputLineNumbers}</pre>
                        <textarea
                            id="formatter-input" ref={inputRef} value={input}
                            onChange={event => changeInput(event.target.value)}
                            onScroll={event => { if (inputGutterRef.current) inputGutterRef.current.scrollTop = event.currentTarget.scrollTop; }}
                            onKeyDown={event => { if ((event.metaKey || event.ctrlKey) && event.key === "Enter") { event.preventDefault(); run(); } }}
                            aria-invalid={Boolean(issue)} aria-describedby={(issue ? "formatter-input-error" : "formatter-keyboard-hint") + (isExample ? " formatter-example-marker" : "")}
                            placeholder={mode === "json" ? 'Paste your JSON here, or use an example.\n\n{"key": "value"}' : "Paste your XML here, or use an example.\n\n<root><item>value</item></root>"}
                            spellCheck={false} autoCapitalize="off" autoCorrect="off" wrap="off"
                        />
                    </div>
                    {issue ? (
                        <div id="formatter-input-error" className="formatter-error" role="alert">
                            <CircleAlert size={17} aria-hidden="true" />
                            <div><strong>{issue.line ? "Line " + issue.line + (issue.column ? ", column " + issue.column : "") : "Check your " + upperMode}</strong><p>{issue.message}</p></div>
                        </div>
                    ) : <div className="formatter-pane-footer" id="formatter-keyboard-hint"><span>{input.length.toLocaleString()} characters</span><span>Ctrl / ⌘ + Enter to {action}</span></div>}
                </div>

                <div className="formatter-pane formatter-output-pane">
                    <div className="formatter-pane-heading">
                        <h2 id="formatter-output-label">{outputLabel}</h2>
                        <button type="button" className="formatter-text-button" onClick={() => void copy()} disabled={!result}>
                            {copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}{copied ? "Copied" : "Copy"}
                        </button>
                    </div>
                    {result ? (
                        <div className="formatter-output-body" role="region" aria-labelledby="formatter-output-label" tabIndex={0} onKeyDown={event => {
                            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
                                const code = event.currentTarget.querySelector("code");
                                const selection = window.getSelection();
                                if (!code || !selection) return;
                                event.preventDefault();
                                const range = document.createRange();
                                range.selectNodeContents(code);
                                selection.removeAllRanges();
                                selection.addRange(range);
                            }
                        }}>
                            <pre className="formatter-line-numbers" aria-hidden="true">{outputLineNumbers}</pre>
                            <pre className="formatter-code"><code><HighlightedCode text={result.text} mode={mode} /></code></pre>
                        </div>
                    ) : (
                        <div className="formatter-empty">
                            <Braces size={30} strokeWidth={1.4} aria-hidden="true" />
                            <p>{issue ? "Fix the input, then try again." : "A clearer view of your data."}</p>
                            <span>{issue ? "Your original text is still here." : "Your " + upperMode + " output will appear here."}</span>
                        </div>
                    )}
                    <div className={"formatter-pane-footer formatter-result-status" + (result ? " is-valid" : "")} role="status" aria-live="polite">
                        {result ? <><CheckCircle2 size={17} aria-hidden="true" /><span>Valid {upperMode}</span></> : <span>{issue ? "No output created" : "Ready when you are"}</span>}
                    </div>
                </div>
            </div>
            <div className="formatter-bottom-row">
                <p><Laptop size={19} aria-hidden="true" /> Runs in your browser. No upload needed.</p>
                <button type="button" className="formatter-button formatter-download" onClick={download} disabled={!result}><Download size={17} aria-hidden="true" /> Download .{mode}</button>
            </div>
            {notice && <p className="formatter-notice" role="status">{notice}</p>}
        </section>
    );
}
