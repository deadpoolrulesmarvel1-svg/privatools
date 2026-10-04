import { fileFormatLabel } from "./file-format-label";
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { AlertTriangle, ArrowDownToLine, ArrowLeftRight, ArrowRight, Check, FileText, FolderOpen, Plus, RotateCcw, X } from "lucide-react";
import { formatFileSize } from "@/lib/api";
import type { RejectionAdvice } from "@/lib/file-acceptance";
import type { StudioOutcome } from "./studio-outcome";
import { focusIfIdle } from "./focus-result";
import { useFileAcceptance, type FileAcceptance } from "./useFileAcceptance";
import { LOCATION_ICONS, useToolLocation } from "./tool-location";
import { ToolWhere } from "./ToolWhere";
import { useActionBarClearance } from "./useActionBarClearance";
import "./tool-studio.css";

export type { StudioOutcome } from "./studio-outcome";

/** Files an intake refused: named, what this tool takes, and the tool that takes them. */
export function IntakeNotice({ advice, onDismiss }: { advice: RejectionAdvice | null; onDismiss?: () => void }) {
    const notice = useRef<HTMLDivElement>(null);
    // On a phone the intake fills the screen, so bring the notice into view.
    useEffect(() => { if (advice) notice.current?.scrollIntoView?.({ block: "nearest" }); }, [advice]);
    if (!advice) return null;
    const suggestion = advice.suggestion;
    return <div className="ts-intake-notice" role="alert" ref={notice}>
        <AlertTriangle size={18} aria-hidden="true" />
        <p><strong>{advice.headline}</strong> {advice.reason}{suggestion && <> {advice.suggestionLead}<a href={suggestion.href}>{suggestion.name}</a>{advice.suggestionTail}{suggestion.then && <><a href={suggestion.then.href}>{suggestion.then.name}</a>{advice.thenTail}</>}</>}</p>
        {onDismiss && <button type="button" className="ts-icon-button" aria-label="Dismiss this message" onClick={onDismiss}><X size={16} /></button>}
    </div>;
}

/**
 * The file drop and choose surface. The whole card takes a click or a drop;
 * the visible "Choose files" is the one real button, so keyboard, screen
 * reader and speech users meet the same control sighted users see. Its name
 * starts with that visible text (WCAG 2.5.3). A file outside `accepts` is
 * refused beside the card, by name, with the tool that takes it.
 *
 * On a tool page the card also says where the file goes, in full (ToolWhere).
 * Once files are chosen it shrinks to a quiet "Add files" row, so the run
 * action in the action bar is the obvious next step.
 */
export function FileIntake({ accepts, multiple, onFiles, label = "Choose files", title, detail, disabled = false, compact = false, autoFocus = false, acceptance }: {
    accepts?: string; multiple?: boolean; onFiles: (files: File[]) => void; label?: string;
    title?: string; detail?: string; disabled?: boolean; compact?: boolean;
    /** Focus the choose button when the intake appears, e.g. after "Choose a different file". */
    autoFocus?: boolean;
    /**
     * The screen's own useFileAcceptance, for a single-file screen whose chosen
     * file's row replaces the intake: the refusal of the rest of a mixed drop
     * then stays on the page, beside that row, where the screen shows its
     * IntakeNotice, instead of leaving with the intake. `onFiles` is unused.
     */
    acceptance?: FileAcceptance;
}) {
    const input = useRef<HTMLInputElement>(null);
    const button = useRef<HTMLButtonElement>(null);
    const [dragging, setDragging] = useState(false);
    const own = useFileAcceptance(accepts, onFiles);
    const { advice, receive, dismiss } = acceptance ?? own;
    const id = useId();
    const open = () => { if (!disabled) input.current?.click(); };
    const take = (files: FileList | null) => { if (!disabled && files?.length) receive(Array.from(files)); };
    const format = fileFormatLabel(accepts);
    const heading = compact ? "Add to your selection" : title || label;
    const action = compact ? "Add files" : multiple ? "Choose files" : "Choose a file";
    // Back from a result: the chooser that was used is gone, so focus is on the body; never take it from elsewhere.
    useEffect(() => { if (autoFocus) focusIfIdle(button.current); }, [autoFocus]);
    return <>
        <div className={`ts-intake${compact ? " ts-intake-compact" : ""}`} data-dragging={dragging} data-disabled={disabled}
            onClick={open}
            onDragOver={event => { event.preventDefault(); if (!disabled) setDragging(true); }}
            onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); take(event.dataTransfer.files); }}>
            <input ref={input} type="file" accept={accepts} multiple={multiple} disabled={disabled} className="ts-native-input" tabIndex={-1}
                onClick={event => event.stopPropagation()} onChange={event => { take(event.target.files); event.target.value = ""; }} />
            <div className="ts-intake-art" aria-hidden="true"><span className="ts-sheet ts-sheet-back" /><span className="ts-sheet ts-sheet-front"><FileText size={31} strokeWidth={1.35} /><span>{format?.slice(0, 6)}</span><i /><i /><i /></span><span className="ts-intake-plus"><Plus size={22} /></span></div>
            <div className="ts-intake-copy"><h2 className="ts-intake-title">{heading}</h2>{!compact && <p id={`${id}-detail`}>{detail || "Choose from your device, or bring your files into this space."}</p>}
                {/* A native button: Enter and Space click it, and the click reaches the card's onClick. */}
                <button ref={button} type="button" className="ts-intake-choose" disabled={disabled}
                    aria-label={compact ? undefined : `${action}: ${heading}`} aria-describedby={compact ? undefined : `${id}-detail`}>
                    {compact ? <Plus size={17} aria-hidden="true" /> : <FolderOpen size={18} aria-hidden="true" />}{action}
                </button>
                {!compact && <span className="ts-intake-drag">or drag {multiple ? "them" : "it"} here</span>}
                {!compact && <ToolWhere className="ts-intake-where" />}</div>
        </div>
        {!acceptance && <IntakeNotice advice={advice} onDismiss={dismiss} />}
    </>;
}

/** Opens the file chooser straight from a result, with the intake's checks. */
export function FileChooserButton({ accepts, multiple, onFiles, children, className = "ts-primary-button" }: {
    accepts?: string; multiple?: boolean; onFiles: (files: File[]) => void; children: ReactNode; className?: string;
}) {
    const input = useRef<HTMLInputElement>(null);
    // Choosing here leaves the result, so a refused part of a mixed choice is
    // said in a toast as well (useFileAcceptance).
    const { advice, receive, dismiss } = useFileAcceptance(accepts, onFiles);
    return <>
        <button type="button" className={className} onClick={() => input.current?.click()}>{children}</button>
        <input ref={input} type="file" accept={accepts} multiple={multiple} className="ts-native-input" tabIndex={-1}
            onChange={event => { if (event.target.files?.length) receive(Array.from(event.target.files)); event.target.value = ""; }} />
        <IntakeNotice advice={advice} onDismiss={dismiss} />
    </>;
}

/**
 * One order for every tool, in Air and Play: the intake and what was chosen
 * (`children`), then the options, then the action bar, then the result,
 * which replaces the layout when a run ends. Beside the canvas, the options
 * and the action bar share a column; in one column the bar sticks to the
 * bottom of the screen once there is something to run (tool-studio.css).
 */
export function StudioLayout({ children, options, action, summary, className = "" }: { children: ReactNode; options?: ReactNode; action?: ReactNode; summary?: ReactNode; className?: string }) {
    return <div className={`tool-studio ${options ? "tool-studio-with-options" : ""} ${action ? "tool-studio-with-action" : ""} ${className}`}>
        <div className="ts-canvas">{children}</div>
        {(options || action) && <div className="ts-side">
            {options && <aside className="ts-options">{options}</aside>}
            {action}
        </div>}
        {summary && <div className="ts-summary">{summary}</div>}
    </div>;
}

/**
 * The run action, and what running it does: how many files, and where they
 * go (the tool page's location, said by its label). `ready` once there is
 * something to run: from then on, in a one-column layout, the bar sticks to
 * the bottom of the screen and the page's scroll padding keeps focused
 * controls clear of it (useActionBarClearance).
 */
export function StudioActionBar({ ready, count, children, className = "" }: { ready: boolean; count?: string; children: ReactNode; className?: string }) {
    const where = useToolLocation();
    const bar = useRef<HTMLDivElement>(null);
    useActionBarClearance(bar, ready);
    const WhereIcon = where ? LOCATION_ICONS[where.kind] : null;
    return <div ref={bar} className={`ts-action-bar ${className}`} data-ready={ready}>
        {(count || where) && <p className="ts-action-status">
            {count && <span className="ts-action-count">{count}</span>}
            {where && WhereIcon && <span className="ts-action-where" data-where={where.kind}><WhereIcon size={15} strokeWidth={1.8} aria-hidden="true" />{where.label}</span>}
        </p>}
        <div className="ts-action-run">{children}</div>
    </div>;
}

export function StudioProgress({ label = "Working on your file", progress, detail, onCancel, cancelLabel = "Cancel" }: { label?: string; progress?: number; detail?: string; onCancel?: () => void; cancelLabel?: string }) {
    const value = progress === undefined ? undefined : Math.max(0, Math.min(100, progress));
    // The label is a status line, not a heading: it appears and goes with the run, so it never breaks the page's heading order.
    return <section className="ts-progress" role="status" aria-live="polite"><div className="ts-progress-heading"><span className="ts-orbit" aria-hidden="true"><i /><i /><i /></span><div><strong className="ts-progress-title">{label}</strong>{detail && <p>{detail}</p>}</div>{onCancel && <button type="button" onClick={onCancel} className="ts-text-button">{cancelLabel}</button>}</div><div className="ts-progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} data-indeterminate={value === undefined}><i style={value === undefined ? undefined : { transform: `scaleX(${value / 100})` }} /></div>{value !== undefined && <span className="ts-progress-value">{Math.round(value)}%</span>}</section>;
}

/**
 * The end of a run. A failure is never dressed as success: it carries a
 * warning mark and no "ready" line, and its caller shows no receipt, makes
 * "Choose a different file" the main action and offers a retry only for
 * failures that can pass. When it appears, focus moves to its heading, so
 * keyboard and screen reader users land on what happened.
 */
export function StudioResult({ title, detail, children, onReset, tone = "success" }: { title: string; detail?: string; children?: ReactNode; onReset?: () => void; tone?: StudioOutcome }) {
    const heading = useRef<HTMLHeadingElement>(null);
    // Only when nothing else holds focus: never out of a dialog or a field the visitor moved to.
    useEffect(() => { focusIfIdle(heading.current); }, []);
    return <section className="ts-result" data-tone={tone}>
        <header><div className="ts-result-art" aria-hidden="true"><span /><span />{tone === "failure" ? <AlertTriangle size={36} strokeWidth={1.6} /> : <Check size={38} strokeWidth={1.5} />}{tone === "partial" && <b className="ts-result-badge"><AlertTriangle size={15} strokeWidth={2.2} /></b>}</div>
            <div>{tone === "success" && <p className="ts-eyebrow">Ready for what’s next</p>}<h2 ref={heading} tabIndex={-1}>{title}</h2>{detail && <p className="ts-result-detail">{detail}</p>}</div></header>
        <div className="ts-result-content">{children}</div>
        {onReset && <button type="button" className="ts-text-button ts-result-reset" onClick={onReset}><RotateCcw size={15} aria-hidden="true" />Start with another file</button>}
    </section>;
}

/**
 * A result's actions in the shared order. A failure leads with a fresh file,
 * opened straight from the button; otherwise the caller's primary action
 * (usually the download) leads. "Try again" appears only when some failures
 * could pass on another attempt (connection, time limit, rate limit, server
 * fault), never for a file the tool refused.
 *
 * When what failed is not a file to choose again (an address, pasted HTML,
 * a pair of named files whose reason does not say which one), `back` leads
 * instead: it returns to that input, kept as it was, to change it.
 */
export function StudioActions({ tone, retryCount = 0, onRetry, choose, back, primary, more }: {
    tone: StudioOutcome;
    retryCount?: number; onRetry?: () => void;
    choose?: { accepts?: string; multiple?: boolean; label?: string; onFiles: (files: File[]) => void };
    /** A failure's lead when there is no file to choose again: "Change the address". */
    back?: { label: string; onBack: () => void };
    primary?: ReactNode; more?: ReactNode;
}) {
    const retry = retryCount > 0 && onRetry
        ? <button type="button" className="ts-secondary-button" onClick={onRetry}>{retryCount > 1 ? `Try ${retryCount} again` : "Try again"}</button> : null;
    return <div className="ts-actions">
        {tone === "failure"
            ? choose ? <FileChooserButton accepts={choose.accepts} multiple={choose.multiple} onFiles={choose.onFiles}>{choose.label ?? "Choose a different file"}</FileChooserButton>
                : back && <button type="button" className="ts-primary-button" onClick={back.onBack}>{back.label}</button>
            : primary}
        {retry}{more}
    </div>;
}

/** One of two named inputs (PairedIntake): its role, what the role does, and the file chosen for it. */
export interface PairedSlot {
    /** The role, as the slot's heading whether or not a file is chosen: "Base PDF (A)". */
    role: string;
    /** What the role does, under the heading: "The main document. The result keeps its pages." */
    detail: string;
    file: File | null;
    onFile: (file: File | null) => void;
}

/**
 * Two named inputs side by side, for a tool that takes exactly two files in
 * different roles (Alternate & Mix, Overlay). Each slot keeps its role as its
 * heading, empty or chosen, and refuses a wrong file beside itself, by name
 * (FileIntake). Where the order matters, `swap` exchanges the two files, and
 * a screen reader hears what each slot then holds. Where the files go is
 * said once, under the pair.
 */
export function PairedIntake({ accepts, slots, swap, disabled = false, autoFocus = false }: {
    accepts: string;
    slots: readonly [PairedSlot, PairedSlot];
    /** Where the order matters, the button that exchanges the two files: "Swap A and B". */
    swap?: { label: string; onSwap: () => void };
    disabled?: boolean;
    /** Focus the first slot when the pair comes back, e.g. after "Change the files". */
    autoFocus?: boolean;
}) {
    const firstHeading = useRef<HTMLHeadingElement>(null);
    const [swapped, setSwapped] = useState("");
    // Back from a result: the first slot's heading when it holds a file, else its intake (FileIntake's autoFocus).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { if (autoFocus && slots[0].file) focusIfIdle(firstHeading.current); }, [autoFocus]);
    const [first, second] = slots;
    const exchange = () => {
        if (!swap) return;
        setSwapped(`${first.role}: ${second.file?.name ?? "no file"}. ${second.role}: ${first.file?.name ?? "no file"}.`);
        swap.onSwap();
    };
    return <div className="ts-pair">
        <div className="ts-paired-inputs">{slots.map((slot, index) => <IntakeSlot key={index} slot={slot} accepts={accepts} disabled={disabled}
            headingRef={index === 0 ? firstHeading : undefined} autoFocus={autoFocus && index === 0} />)}</div>
        {swap && (first.file || second.file) && <button type="button" className="ts-text-button ts-pair-swap" onClick={exchange} disabled={disabled}>
            <ArrowLeftRight size={16} aria-hidden="true" />{swap.label}
        </button>}
        <p className="sr-only" role="status">{swapped}</p>
        <ToolWhere className="ts-paired-where" />
    </div>;
}

/** One slot of a PairedIntake. Its refusal notice outlives the intake, so the rest of a mixed drop is still named beside the file it took. */
function IntakeSlot({ slot, accepts, disabled, headingRef, autoFocus }: {
    slot: PairedSlot; accepts: string; disabled: boolean; headingRef?: RefObject<HTMLHeadingElement>; autoFocus: boolean;
}) {
    const take = (files: File[]) => slot.onFile(files[0] ?? null);
    const acceptance = useFileAcceptance(accepts, take);
    return <section className="ts-slot">
        {slot.file
            ? <div className="ts-slot-filled">
                <h2 ref={headingRef} tabIndex={-1}>{slot.role}</h2>
                <p>{slot.detail}</p>
                <StudioFile name={slot.file.name} detail={formatFileSize(slot.file.size)} removeLabel={`Remove ${slot.file.name} from ${slot.role}`}
                    onRemove={disabled ? undefined : () => slot.onFile(null)} />
            </div>
            : <FileIntake accepts={accepts} acceptance={acceptance} title={slot.role} detail={slot.detail} disabled={disabled}
                autoFocus={autoFocus} onFiles={take} />}
        <IntakeNotice advice={acceptance.advice} onDismiss={acceptance.dismiss} />
    </section>;
}

/**
 * The intake of a tool that takes no file (an address, pasted HTML): its own
 * fields in the intake's card, with where the input goes said in full. Its
 * heading is the field's label (`<h2><label>`), so the part and the field
 * carry one name.
 */
export function StudioSource({ children, className = "" }: { children: ReactNode; className?: string }) {
    return <section className={`ts-source ${className}`}>
        {children}
        <ToolWhere className="ts-source-where" />
    </section>;
}

export function StudioFile({ name, detail, status, onRemove, onDownload, children, removeLabel }: { name: string; detail?: string; status?: string; onRemove?: () => void; onDownload?: () => void; children?: ReactNode; removeLabel?: string }) {
    const failed = status === "error" || status === "failed";
    // A file's name is a label in a list, not a heading: rows sit under the intake, a result or nothing at all.
    return <article className="ts-file" data-status={failed ? "error" : status}><span className="ts-file-icon" aria-hidden="true">{status === "done" ? <Check size={22} /> : failed ? <AlertTriangle size={20} strokeWidth={1.8} /> : <FileText size={22} strokeWidth={1.5} />}</span><div className="ts-file-copy"><span className="ts-file-name">{name}</span>{detail && <p>{detail}</p>}{children}</div>{onDownload && <button type="button" className="ts-icon-button" aria-label={`Download ${name}`} onClick={onDownload}><ArrowDownToLine size={18} /></button>}{onRemove && <button type="button" className="ts-icon-button" aria-label={removeLabel || `Remove ${name}`} onClick={onRemove}><X size={17} /></button>}</article>;
}

/** Object URLs stay on this device and are released when their source changes. */
export function LocalFilePreview({ file, name, label = "Preview" }: { file: Blob; name: string; label?: string }) {
    const [url, setUrl] = useState("");
    const [failed, setFailed] = useState(false);
    const ext = name.split(".").pop()?.toLowerCase() || "";
    const kind = /^(png|jpe?g|webp|gif|bmp|svg|avif)$/.test(ext) ? "image"
        : /^(mp4|mov|webm|m4v|ogv)$/.test(ext) ? "video"
        : /^(mp3|wav|ogg|m4a|aac|flac|opus)$/.test(ext) ? "audio" : null;
    useEffect(() => {
        if (!kind) return;
        const next = URL.createObjectURL(file);
        setUrl(next); setFailed(false);
        return () => URL.revokeObjectURL(next);
    }, [file, kind]);
    if (!kind || !url) return null;
    return <figure className="ts-local-preview" data-kind={kind}>
        <figcaption><span>{label}</span><span>{name}</span></figcaption>
        {failed ? <p className="ts-caption">This browser cannot preview this format. Your file can still be processed or downloaded.</p>
            : kind === "image" ? <img src={url} alt={name} onError={() => setFailed(true)} />
            : kind === "video" ? <video src={url} controls preload="metadata" aria-label={`${label}: ${name}`} onError={() => setFailed(true)} />
            : <audio src={url} controls preload="metadata" aria-label={`${label}: ${name}`} onError={() => setFailed(true)} />}
    </figure>;
}

export function ConversionPath({ accepts, output }: { accepts: string; output: string }) {
    const target = output.includes(".") ? output.split(".").pop() : output;
    return <div className="ts-conversion-path" aria-label={`${fileFormatLabel(accepts)} to ${target?.toUpperCase()}`}><span>{fileFormatLabel(accepts)}</span><ArrowRight size={22} aria-hidden="true"/><span>{target?.toUpperCase()}</span></div>;
}
