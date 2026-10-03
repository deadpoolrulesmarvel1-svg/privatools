/**
 * MarkdownToWordUI — Markdown, such as a ChatGPT or Claude answer, to an
 * editable Word document, made in this browser.
 *
 * The visitor pastes Markdown or opens a .md or .txt file into the same box,
 * where it can be edited. Converting loads the converter (and Temml, only
 * when there is math) and builds the .docx here: headings, lists, tables,
 * code and quotes in Word's built-in styles, and LaTeX as Word equations.
 * Nothing is uploaded, and no address in the text is ever requested.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FileText, Sparkles, X } from "lucide-react";
import { downloadBlob, formatFileSize } from "@/lib/api";
import { emitToolRun, isTransientFailure, toolErrorKind } from "@/lib/toolRun";
import { consumeFileHandoffs } from "@/lib/file-handoff";
import { adviseRejection, partitionByAccept, type RejectionAdvice } from "@/lib/file-acceptance";
import { useToolDefaults } from "@/hooks/useToolDefaults";
import { FileChooserButton, FileIntake, IntakeNotice, StudioActionBar, StudioActions, StudioFile, StudioLayout, StudioProgress, StudioResult } from "@/skins/experience/ToolStudio";
import { downloadAgainLabel, downloadStarted, retryLine } from "@/skins/experience/studio-outcome";
import { useDownloadOnce } from "@/skins/experience/useDownloadOnce";
import { focusIfIdle } from "@/skins/experience/focus-result";
import { decodeText, likelyPageSize, MAX_FILE_BYTES, wordCount } from "@/lib/markdown-to-word/text-file";
import type { ConversionReport, PageSize } from "@/lib/markdown-to-word/convert";
import "./markdown-to-word.css";

const SLUG = "markdown-to-word";
const ACCEPTS = ".md,.markdown,.txt";
/** The converter's own limit, said here without loading it. */
const MAX_TEXT = 10 * 1024 * 1024;
/** How many left-out equations or images the result lists before saying how many more. */
const LISTED = 40;

const SAMPLE = `# Projectile motion

A ball is thrown at speed $v_0$ and angle $\\theta$. Ignoring air resistance, it lands at a distance

$$
R = \\frac{v_0^2 \\sin(2\\theta)}{g}
$$

## Key results

| Quantity | Formula | Unit |
|:---------|:-------:|-----:|
| Time of flight | $t = \\frac{2 v_0 \\sin\\theta}{g}$ | s |
| Greatest height | $h = \\frac{v_0^2 \\sin^2\\theta}{2g}$ | m |

1. Split the velocity: $v_x = v_0 \\cos\\theta$ and $v_y = v_0 \\sin\\theta$.
2. Treat each direction on its own:
   - **horizontal**: no acceleration
   - **vertical**: $a = -g$

- [x] Find the range
- [ ] Add air resistance

> **Note:** the range is greatest at $\\theta = 45^\\circ$.

\`\`\`python
from math import radians, sin

def projectile_range(v0, angle_deg, g=9.81):
    return v0 ** 2 * sin(2 * radians(angle_deg)) / g
\`\`\`
`;

type Phase = "idle" | "converting" | "done" | "failed";

interface Done {
    blob: Blob;
    name: string;
    report: ConversionReport;
}

interface Failure {
    title: string;
    detail: string;
    /** Another attempt could work: the converter's code didn't arrive. */
    retryable: boolean;
}

function notice(headline: string, reason: string): RejectionAdvice {
    return { headline, reason, suggestion: null, suggestionLead: "", suggestionTail: "", text: `${headline} ${reason}` };
}

function plural(count: number, one: string, many = `${one}s`): string {
    return `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

/** What didn't convert, as words: "2 equations stayed as LaTeX and 1 image was left out". */
function shortfall(report: ConversionReport): string {
    const equations = report.equationsAsText.length;
    const images = report.imagesLeftOut.length;
    const parts: string[] = [];
    if (equations) parts.push(`${plural(equations, "equation")} stayed as LaTeX`);
    if (images) parts.push(`${plural(images, "image")} ${images === 1 ? "was" : "were"} left out`);
    return parts.join(" and ");
}

export function MarkdownToWordUI() {
    const [defaults] = useState(() => ({ page: likelyPageSize() as PageSize }));
    const [stored, , { setField }] = useToolDefaults(SLUG, defaults);
    // A remembered value from an older version is checked before it is used.
    const page: PageSize = stored.page === "a4" || stored.page === "letter" ? stored.page : defaults.page;
    const [text, setText] = useState("");
    const [source, setSource] = useState<string | null>(null);
    const [readProblem, setReadProblem] = useState<RejectionAdvice | null>(null);
    const [phase, setPhase] = useState<Phase>("idle");
    const [progress, setProgress] = useState<number | undefined>();
    const [equationCount, setEquationCount] = useState(0);
    const [done, setDone] = useState<Done | null>(null);
    const [failure, setFailure] = useState<Failure | null>(null);
    const [focusEditor, setFocusEditor] = useState(0);
    const editor = useRef<HTMLTextAreaElement>(null);
    const run = useRef(0);
    const reading = useRef(0);
    const busy = phase === "converting";
    const hasText = text.trim().length > 0;
    const words = useMemo(() => wordCount(text), [text]);

    // Leaving the page ends a run: its result would have nowhere to go.
    useEffect(() => () => { run.current++; reading.current++; }, []);

    // Back from a result, the Markdown box takes focus, unless the visitor has moved on.
    useEffect(() => { if (focusEditor) focusIfIdle(editor.current); }, [focusEditor]);

    const openFiles = useCallback(async (files: File[]) => {
        const [file, ...others] = files;
        if (!file) return;
        const id = ++reading.current;
        setReadProblem(null);
        if (file.size > MAX_FILE_BYTES) {
            setReadProblem(notice(`${file.name} wasn’t opened.`, `It is ${formatFileSize(file.size)}; this tool converts Markdown up to 10 MB.`));
            return;
        }
        let bytes: Uint8Array;
        try {
            bytes = new Uint8Array(await file.arrayBuffer());
        } catch {
            if (id === reading.current) setReadProblem(notice(`${file.name} couldn’t be read.`, "This browser couldn’t open it. Your text in the box is unchanged."));
            return;
        }
        if (id !== reading.current) return;
        const decoded = decodeText(bytes);
        if (decoded.ok === false) {
            setReadProblem(decoded.problem === "empty"
                ? notice(`${file.name} is empty.`, "It holds no text to convert.")
                : notice(`${file.name} isn’t a text file.`, "Markdown to Word reads .md, .markdown and .txt files saved as plain text."));
            return;
        }
        setText(decoded.text.replace(/^\u{feff}/u, ""));
        setSource(file.name);
        if (others.length) setReadProblem(notice(`Only ${file.name} was opened.`, "This tool converts one document at a time."));
    }, []);

    // A file handed over from another tool opens here.
    useEffect(() => {
        let cancelled = false;
        void consumeFileHandoffs(SLUG).then(files => { if (!cancelled && files.length) void openFiles(files); });
        return () => { cancelled = true; };
    }, [openFiles]);

    const convert = useCallback(async () => {
        if (!hasText || busy) return;
        const id = ++run.current;
        const current = () => id === run.current;
        setFailure(null);
        setDone(null);
        setProgress(undefined);
        setEquationCount(0);
        setPhase("converting");
        try {
            if (text.length > MAX_TEXT) throw Object.assign(new Error("Too large"), { __kind: "too_large" });
            const { convertMarkdownToDocx, docxFileName } = await import("@/lib/markdown-to-word/convert");
            if (!current()) return;
            const result = await convertMarkdownToDocx(text, {
                page,
                onStart: equations => { if (current()) setEquationCount(equations); },
                onProgress: fraction => { if (current()) setProgress(fraction * 100); },
            });
            if (!current()) return;
            const name = docxFileName(source ?? (result.title || "document"));
            const { report } = result;
            const partial = report.equationsAsText.length > 0 || report.imagesLeftOut.length > 0;
            emitToolRun(partial ? { outcome: "partial", files: 1, errorKind: "bad_input" } : { outcome: "success", files: 1 });
            setDone({ blob: result.blob, name, report });
            setPhase("done");
        } catch (error) {
            if (!current()) return;
            const kind = toolErrorKind(error);
            emitToolRun({ outcome: "error", files: 1 }, error);
            // The limit counts characters, so the detail does too.
            setFailure(kind === "too_large"
                ? { title: "This Markdown is too long to convert.", detail: `Nothing was created. It has ${plural(text.length, "character")}; this tool converts up to about ${Math.round(MAX_TEXT / 1e6)} million at a time. Split it, and convert each part.`, retryable: false }
                : isTransientFailure(error)
                    ? { title: "The Word document couldn’t be made.", detail: `Nothing was created. The converter didn’t finish loading. ${retryLine([kind === "cancelled" ? undefined : kind])}`, retryable: true }
                    : { title: "The Word document couldn’t be made.", detail: "Nothing was created. Something failed in this browser while the document was being made. Closing other tabs frees memory for a very long document.", retryable: false });
            setPhase("failed");
        }
    }, [hasText, busy, text, page, source]);

    const download = useCallback(() => { if (done) downloadBlob(done.blob, done.name); }, [done]);
    useDownloadOnce(phase === "done", done ? 1 : 0, download);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && phase === "idle" && hasText) {
                event.preventDefault();
                void convert();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [phase, hasText, convert]);

    const backToEditor = () => {
        run.current++;
        setDone(null);
        setFailure(null);
        setPhase("idle");
        setFocusEditor(n => n + 1);
    };
    const startOver = () => {
        setText("");
        setSource(null);
        setReadProblem(null);
        backToEditor();
    };
    const openFromResult = (files: File[]) => {
        backToEditor();
        void openFiles(files);
    };

    if (phase === "done" && done) return <MarkdownToWordResult done={done} onDownload={download} onEdit={backToEditor} onStartOver={startOver} />;

    if (phase === "failed" && failure) {
        return <StudioResult tone="failure" title={failure.title} detail={failure.detail}>
            {/* The Markdown is most often pasted, so going back to it leads; another file is the alternative. */}
            <StudioActions tone="failure" retryCount={failure.retryable ? 1 : 0} onRetry={() => void convert()}
                primary={<button type="button" className="ts-primary-button" onClick={backToEditor}>Back to the Markdown</button>}
                more={<FileChooserButton accepts={ACCEPTS} onFiles={openFromResult} className="ts-text-button">Open a different file</FileChooserButton>} />
        </StudioResult>;
    }

    const takeDrop = (event: React.DragEvent<HTMLTextAreaElement>) => {
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (!files.length || busy) return;
        // A file dropped on the box opens in it, checked and refused as one chosen with the button would be.
        event.preventDefault();
        const { accepted, rejected } = partitionByAccept(files, ACCEPTS);
        if (!accepted.length) {
            setReadProblem(adviseRejection(rejected, { accepts: ACCEPTS, fromSlug: SLUG }));
            return;
        }
        void openFiles(accepted);
    };

    return <StudioLayout className="mdw-studio" options={<div>
        <h2>Page size</h2>
        <div className="ts-choices">{(["letter", "a4"] as PageSize[]).map(size => <button type="button" className="ts-choice" key={size} aria-pressed={page === size} disabled={busy} onClick={() => setField("page", size)}>
            <strong>{size === "letter" ? "Letter" : "A4"}</strong>
            <span>{size === "letter" ? "8.5 × 11 in, used in the US and Canada" : "210 × 297 mm, used in most other countries"}</span>
        </button>)}</div>
        <p className="mdw-note">Text uses Word’s built-in styles, so a theme or style you choose in Word restyles the whole document.</p>
    </div>} action={<StudioActionBar ready={hasText} count={hasText ? plural(words, "word") : undefined}>
        <button type="button" className="ts-primary-button" onClick={() => void convert()} disabled={!hasText || busy}>
            <FileText size={16} aria-hidden="true" /> Convert to Word
        </button>
        {!hasText && <p className="ts-action-hint">Paste Markdown or open a file to convert it.</p>}
    </StudioActionBar>}>
        <section className="mdw-paste" aria-labelledby="mdw-paste-title">
            <div className="mdw-paste-head">
                <h2 id="mdw-paste-title">Paste Markdown</h2>
                {text
                    ? <button type="button" className="ts-text-button" onClick={startOver} disabled={busy}><X size={15} aria-hidden="true" /> Clear</button>
                    : <button type="button" className="ts-text-button" onClick={() => { setText(SAMPLE); setSource(null); setReadProblem(null); }}><Sparkles size={15} aria-hidden="true" /> Try a sample</button>}
            </div>
            <p className="mdw-hint" id="mdw-paste-hint">Use the copy button under a ChatGPT or Claude answer: it copies the Markdown, tables and equations included.</p>
            <div className="mdw-editor">
                <textarea ref={editor} id="mdw-input" value={text} readOnly={busy} spellCheck={false} aria-labelledby="mdw-paste-title" aria-describedby="mdw-paste-hint"
                    placeholder={"# A heading\n\nText with **bold**, a list, a table and an equation such as $E = mc^2$."}
                    onChange={event => setText(event.target.value)} onDragOver={event => { if (event.dataTransfer?.types?.includes("Files")) event.preventDefault(); }} onDrop={takeDrop} />
                <p className="mdw-editor-bar"><span>{source ? `From ${source}` : text ? "Pasted text" : "Nothing yet"}</span><span>{plural(text.length, "character")}</span></p>
            </div>
        </section>
        <FileIntake accepts={ACCEPTS} title="Or open a Markdown file" disabled={busy} onFiles={files => void openFiles(files)}
            detail=".md, .markdown or .txt, up to 10 MB. It opens in the box above, where you can edit it before converting." />
        <IntakeNotice advice={readProblem} onDismiss={() => setReadProblem(null)} />
        {busy && <StudioProgress label="Making your Word document" progress={progress}
            detail={equationCount ? `Turning ${plural(equationCount, "equation")} into Word equations, in this browser.` : "Building the document in this browser."} />}
    </StudioLayout>;
}

/** The end of a run: the document, what it holds, and anything that stayed as LaTeX or was left out. */
function MarkdownToWordResult({ done, onDownload, onEdit, onStartOver }: { done: Done; onDownload: () => void; onEdit: () => void; onStartOver: () => void }) {
    const { report } = done;
    const missing = shortfall(report);
    const toCheck = report.equationsAsText.length + report.imagesLeftOut.length;
    const stats = [
        ["Headings", report.headings], ["Lists", report.lists], ["Tables", report.tables], ["Code blocks", report.codeBlocks],
        ["Equations", report.equationsConverted], ["Images", report.imagesEmbedded],
    ].filter(([, count]) => Number(count) > 0) as [string, number][];
    // A partial run's heading stays short; the detail says what is to check, and the lists below say which.
    return <StudioResult tone={missing ? "partial" : "success"}
        title={missing ? `Ready, with ${plural(toCheck, "thing")} to check.` : "Your Word document is ready."}
        detail={missing ? `${downloadStarted(1)} ${missing}; each is listed below.` : downloadStarted(1)}>
        <StudioFile name={done.name} status="done" detail={`Word document · ${formatFileSize(done.blob.size)}`} />
        {stats.length > 0 && <dl className="ts-stats">{stats.map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count.toLocaleString()}</dd></div>)}</dl>}
        {report.equationsAsText.length > 0 && <section className="mdw-report" aria-labelledby="mdw-equations-title">
            <h3 id="mdw-equations-title">Equations left as LaTeX</h3>
            <p>Each is in the document as its LaTeX, in a code font, where it was. The rest became Word equations.</p>
            <ul>{report.equationsAsText.slice(0, LISTED).map((item, index) => <li key={index}>
                <code>{item.source.length > 240 ? `${item.source.slice(0, 239)}…` : item.source}</code>
                <span>Line {item.line}: {item.reason}.</span>
            </li>)}</ul>
            {report.equationsAsText.length > LISTED && <p>And {plural(report.equationsAsText.length - LISTED, "more")}.</p>}
        </section>}
        {report.imagesLeftOut.length > 0 && <section className="mdw-report" aria-labelledby="mdw-images-title">
            <h3 id="mdw-images-title">Images left out</h3>
            <p>Only images inside the Markdown itself (data: URIs) are added; images at web addresses are never downloaded. Each one’s alt text is in the document where the image was.</p>
            <ul>{report.imagesLeftOut.slice(0, LISTED).map((item, index) => <li key={index}>
                <strong>{item.name}</strong>
                <span>Line {item.line}: {item.reason}.</span>
            </li>)}</ul>
            {report.imagesLeftOut.length > LISTED && <p>And {plural(report.imagesLeftOut.length - LISTED, "more")}.</p>}
        </section>}
        <StudioActions tone={missing ? "partial" : "success"}
            primary={<button type="button" className="ts-primary-button" onClick={onDownload}><Download size={16} aria-hidden="true" /> {downloadAgainLabel(1)}</button>}
            more={<>
                <button type="button" className="ts-text-button" onClick={onEdit}>Edit the Markdown</button>
                <button type="button" className="ts-text-button" onClick={onStartOver}>Convert other Markdown</button>
            </>} />
        <p className="ts-caption mdw-next">Made in this browser; nothing was uploaded. Google Docs imports Word equations imperfectly, so check them if you open the file there.</p>
    </StudioResult>;
}
