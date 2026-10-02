import { fileFormatLabel } from "./file-format-label";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowDownToLine, ArrowUpRight, Check, FileText, Plus, X } from "lucide-react";
import type { RejectionAdvice } from "@/lib/file-acceptance";
import type { StudioOutcome } from "./studio-outcome";
import { focusIfIdle } from "./focus-result";
import { useFileAcceptance } from "./useFileAcceptance";
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
        <p><strong>{advice.headline}</strong> {advice.reason}{suggestion && <> {advice.suggestionLead}<a href={suggestion.href}>{suggestion.name}</a>{advice.suggestionTail}</>}</p>
        {onDismiss && <button type="button" className="ts-icon-button" aria-label="Dismiss this message" onClick={onDismiss}><X size={16} /></button>}
    </div>;
}

/**
 * The file drop and choose surface. The whole card takes a click or a drop;
 * the visible "Choose files" is the one real button, so keyboard, screen
 * reader and speech users meet the same control sighted users see. Its name
 * starts with that visible text (WCAG 2.5.3). A file outside `accepts` is
 * refused beside the card, by name, with the tool that takes it.
 */
export function FileIntake({ accepts, multiple, onFiles, label = "Choose files", title, detail, disabled = false, compact = false, autoFocus = false }: {
    accepts?: string; multiple?: boolean; onFiles: (files: File[]) => void; label?: string;
    title?: string; detail?: string; disabled?: boolean; compact?: boolean;
    /** Focus the choose button when the intake appears, e.g. after "Choose a different file". */
    autoFocus?: boolean;
}) {
    const input = useRef<HTMLInputElement>(null);
    const button = useRef<HTMLButtonElement>(null);
    const [dragging, setDragging] = useState(false);
    const { advice, receive, dismiss } = useFileAcceptance(accepts, onFiles);
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
            <div className="ts-intake-copy"><span className="ts-intake-overline">{compact ? "Your selection" : "Start with your file"}</span><h3>{heading}</h3><p id={`${id}-detail`}>{detail || "Choose from your device, or bring your files into this space."}</p>
                {/* A native button: Enter and Space click it, and the click reaches the card's onClick. */}
                <button ref={button} type="button" className="ts-intake-choose" disabled={disabled}
                    aria-label={compact ? undefined : `${action}: ${heading}`} aria-describedby={compact ? undefined : `${id}-detail`}>
                    {action}<ArrowUpRight size={18} aria-hidden="true" />
                </button>
                <span className="ts-intake-drag">or drag {multiple ? "them" : "it"} here</span></div>
        </div>
        <IntakeNotice advice={advice} onDismiss={dismiss} />
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

export function StudioLayout({ children, options, summary, className = "" }: { children: ReactNode; options?: ReactNode; summary?: ReactNode; className?: string }) {
    return <div className={`tool-studio ${options ? "tool-studio-with-options" : ""} ${className}`}>
        <div className="ts-canvas">{children}</div>
        {options && <aside className="ts-options">{options}</aside>}
        {summary && <div className="ts-summary">{summary}</div>}
    </div>;
}

export function StudioProgress({ label = "Working on your file", progress, detail, onCancel }: { label?: string; progress?: number; detail?: string; onCancel?: () => void }) {
    const value = progress === undefined ? undefined : Math.max(0, Math.min(100, progress));
    return <section className="ts-progress" role="status" aria-live="polite"><div className="ts-progress-heading"><span className="ts-orbit" aria-hidden="true"><i /><i /><i /></span><div><h3>{label}</h3>{detail && <p>{detail}</p>}</div>{onCancel && <button type="button" onClick={onCancel} className="ts-text-button">Cancel</button>}</div><div className="ts-progress-track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value} data-indeterminate={value === undefined}><i style={value === undefined ? undefined : { transform: `scaleX(${value / 100})` }} /></div>{value !== undefined && <span className="ts-progress-value">{Math.round(value)}%</span>}</section>;
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
        {onReset && <button type="button" className="ts-text-button ts-result-reset" onClick={onReset}>Start with another file <ArrowUpRight size={16} /></button>}
    </section>;
}

/**
 * A result's actions in the shared order. A failure leads with a fresh file,
 * opened straight from the button; otherwise the caller's primary action
 * (usually the download) leads. "Try again" appears only when some failures
 * could pass on another attempt (connection, time limit, rate limit, server
 * fault), never for a file the tool refused.
 */
export function StudioActions({ tone, retryCount = 0, onRetry, choose, primary, more }: {
    tone: StudioOutcome;
    retryCount?: number; onRetry?: () => void;
    choose?: { accepts?: string; multiple?: boolean; label?: string; onFiles: (files: File[]) => void };
    primary?: ReactNode; more?: ReactNode;
}) {
    const retry = retryCount > 0 && onRetry
        ? <button type="button" className="ts-secondary-button" onClick={onRetry}>{retryCount > 1 ? `Try ${retryCount} again` : "Try again"}</button> : null;
    return <div className="ts-actions">
        {tone === "failure"
            ? choose && <FileChooserButton accepts={choose.accepts} multiple={choose.multiple} onFiles={choose.onFiles}>{choose.label ?? "Choose a different file"}</FileChooserButton>
            : primary}
        {retry}{more}
    </div>;
}

export function StudioFile({ name, detail, status, onRemove, onDownload, children, removeLabel }: { name: string; detail?: string; status?: string; onRemove?: () => void; onDownload?: () => void; children?: ReactNode; removeLabel?: string }) {
    const failed = status === "error" || status === "failed";
    return <article className="ts-file" data-status={failed ? "error" : status}><span className="ts-file-icon" aria-hidden="true">{status === "done" ? <Check size={22} /> : failed ? <AlertTriangle size={20} strokeWidth={1.8} /> : <FileText size={22} strokeWidth={1.5} />}</span><div className="ts-file-copy"><h4>{name}</h4>{detail && <p>{detail}</p>}{children}</div>{onDownload && <button type="button" className="ts-icon-button" aria-label={`Download ${name}`} onClick={onDownload}><ArrowDownToLine size={18} /></button>}{onRemove && <button type="button" className="ts-icon-button" aria-label={removeLabel || `Remove ${name}`} onClick={onRemove}><X size={17} /></button>}</article>;
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
    return <div className="ts-conversion-path" aria-label={`${fileFormatLabel(accepts)} to ${target?.toUpperCase()}`}><span>{fileFormatLabel(accepts)}</span><ArrowUpRight size={22} aria-hidden="true"/><span>{target?.toUpperCase()}</span></div>;
}
