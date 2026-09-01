import { useState, useRef, useCallback } from "react";
import { Upload, X, FileText, FileImage, File as FileIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatFileSize } from "@/lib/api";

interface FileUploadZoneProps {
    onFileSelect: (file: File) => void;
    file: File | null;
    onClear: () => void;
    accept?: string;
    label?: string;
    hint?: string;
    /** Accept many files at once; incoming batches go to onFilesSelect. */
    multiple?: boolean;
    onFilesSelect?: (files: File[]) => void;
    showPreview?: boolean;
    className?: string;
}

function getFileIcon(name: string) {
    const ext = name.split(".").pop()?.toLowerCase();
    if (["jpg", "jpeg", "png", "gif", "webp", "svg", "heic", "heif"].includes(ext || "")) return FileImage;
    if (["pdf"].includes(ext || "")) return FileText;
    return FileIcon;
}

export function FileUploadZone({ onFileSelect, file, onClear, accept, label, hint, showPreview, className, multiple, onFilesSelect }: FileUploadZoneProps) {
    const [drag, setDrag] = useState(false);
    const [previewSrc, setPreviewSrc] = useState<string | null>(null);
    const ref = useRef<HTMLInputElement>(null);

    const handleFile = useCallback((f: File) => {
        onFileSelect(f);
        if (showPreview && f.type.startsWith("image/")) {
            const reader = new FileReader();
            reader.onload = () => setPreviewSrc(reader.result as string);
            reader.readAsDataURL(f);
            return;
        }
        setPreviewSrc(null);
    }, [onFileSelect, showPreview]);

    const handleIncoming = useCallback((list: FileList) => {
        if (multiple && onFilesSelect) {
            const all = Array.from(list);
            if (all.length) onFilesSelect(all);
            return;
        }
        if (list[0]) handleFile(list[0]);
    }, [multiple, onFilesSelect, handleFile]);

    const IconComp = file ? getFileIcon(file.name) : Upload;

    if (file) {
        // Live region: when a file is picked, screen readers announce its name.
        // Apply the dropzone-landed flash on the just-rendered card so the
        // transition feels continuous (zone → card) instead of a hard swap.
        return (
            <div
                role="status"
                aria-live="polite"
                className={cn("rounded-xl border border-accent/30 bg-accent/[0.04] px-4 py-3 animate-queue-row-enter", className)}
            >
                <div className="flex items-center gap-3">
                    {previewSrc ? (
                        <img src={previewSrc} alt={`Preview of ${file.name}`} className="h-10 w-10 rounded-lg object-cover border border-border" />
                    ) : (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/12 border border-accent/30" aria-hidden="true">
                            <IconComp size={16} className="text-accent" />
                        </div>
                    )}
                    <div className="flex-1 min-w-0">
                        <p className="text-[14px] font-medium text-foreground truncate">{file.name}</p>
                        <p className="font-medium text-[11.5px] text-muted-foreground mt-0.5">{formatFileSize(file.size)}</p>
                    </div>
                    <button
                        type="button"
                        aria-label={`Remove ${file.name}`}
                        onClick={onClear}
                        className="h-7 w-7 inline-flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
                    >
                        <X size={13} aria-hidden="true" />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files.length) handleIncoming(e.dataTransfer.files); }}
            onClick={() => ref.current?.click()}
            onKeyDown={e => {
                if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    ref.current?.click();
                }
            }}
            role="button"
            tabIndex={0}
            aria-label={label || "Upload file"}
            className={cn(
                // The drop zone is the product on 219 pages, so it gets the room
                // and the colour. Lifts and saturates on hover/drag instead of
                // just changing a border colour.
                "dropzone-surface relative flex flex-col items-center justify-center gap-4 rounded-[28px] border-2 border-dashed cursor-pointer text-center group",
                "py-16 sm:py-20 px-6 overflow-hidden",
                "transition-[transform,background-color,border-color,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                "motion-reduce:transition-none",
                drag
                    ? "border-primary bg-primary/[0.07] scale-[1.01] shadow-[0_18px_50px_-20px_hsl(var(--primary)/0.55)]"
                    : "border-border-strong bg-paper-2/60 hover:border-primary/60 hover:bg-primary/[0.04] hover:-translate-y-0.5 hover:shadow-[0_14px_40px_-22px_hsl(var(--primary)/0.45)] motion-reduce:hover:translate-y-0",
                className,
            )}
        >
            <CornerMarks />
            <input ref={ref} type="file" accept={accept} multiple={multiple} className="hidden" onChange={e => { if (e.target.files?.length) handleIncoming(e.target.files); e.target.value = ""; }} />
            <div
                aria-hidden="true"
                className={cn(
                    "h-16 w-16 rounded-3xl flex items-center justify-center shrink-0",
                    "transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
                    "bg-primary text-primary-foreground shadow-[0_10px_24px_-10px_hsl(var(--primary)/0.7)]",
                    drag ? "scale-110 rotate-3" : "group-hover:scale-105 group-hover:-rotate-2",
                )}
            >
                <Upload size={26} strokeWidth={2.25} />
            </div>
            <p className="font-display text-[24px] sm:text-[27px] font-bold text-foreground tracking-[-0.03em] leading-tight text-balance">
                {label || "Drop your file here"}
            </p>
            <p className="text-[14.5px] text-muted-foreground max-w-sm">
                {hint || "Drag & drop, or click to browse"}
            </p>
        </div>
    );
}

function CornerMarks() {
    const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}>
                <span className="absolute top-0 left-0 h-px w-3 bg-accent/70" />
                <span className="absolute top-0 left-0 w-px h-3 bg-accent/70" />
            </span>
            <span className={`${cls} -top-1 -right-1`}>
                <span className="absolute top-0 right-0 h-px w-3 bg-accent/70" />
                <span className="absolute top-0 right-0 w-px h-3 bg-accent/70" />
            </span>
            <span className={`${cls} -bottom-1 -left-1`}>
                <span className="absolute bottom-0 left-0 h-px w-3 bg-accent/70" />
                <span className="absolute bottom-0 left-0 w-px h-3 bg-accent/70" />
            </span>
            <span className={`${cls} -bottom-1 -right-1`}>
                <span className="absolute bottom-0 right-0 h-px w-3 bg-accent/70" />
                <span className="absolute bottom-0 right-0 w-px h-3 bg-accent/70" />
            </span>
        </>
    );
}

/* ── Processing Progress Bar ─────────────────────────────────────────────── */
interface ProgressBarProps {
    progress?: number; // 0-100, undefined = indeterminate
    label?: string;
    className?: string;
}

export function ProcessingBar({ progress, label, className }: ProgressBarProps) {
    const isIndeterminate = progress === undefined;
    const labelText = label || "Processing…";
    return (
        <div className={cn("space-y-1.5", className)}>
            <div className="font-medium flex justify-between items-center text-[11.5px]">
                <span className="text-muted-foreground">{labelText}</span>
                {!isIndeterminate && <span className="text-accent font-medium tabular-nums">{Math.round(progress)}%</span>}
            </div>
            {/* Native ARIA progressbar — screen readers announce the percentage
               on each render of a determinate bar, or "busy" on indeterminate. */}
            <div
                role="progressbar"
                aria-label={labelText}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={isIndeterminate ? undefined : Math.round(progress)}
                aria-busy={isIndeterminate ? true : undefined}
                className="h-1.5 w-full overflow-hidden rounded-full bg-paper-2 relative"
            >
                {isIndeterminate ? (
                    <div className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-accent progress-indeterminate" />
                ) : (
                    <div
                        className="h-full rounded-full bg-accent transition-all duration-500 ease-out"
                        style={{ width: `${Math.min(100, progress)}%` }}
                    />
                )}
            </div>
        </div>
    );
}
