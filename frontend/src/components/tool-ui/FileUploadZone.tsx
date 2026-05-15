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
    multiple?: false;
    showPreview?: boolean;
    className?: string;
}

function getFileIcon(name: string) {
    const ext = name.split(".").pop()?.toLowerCase();
    if (["jpg", "jpeg", "png", "gif", "webp", "svg", "heic", "heif"].includes(ext || "")) return FileImage;
    if (["pdf"].includes(ext || "")) return FileText;
    return FileIcon;
}

export function FileUploadZone({ onFileSelect, file, onClear, accept, label, hint, showPreview, className }: FileUploadZoneProps) {
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

    const IconComp = file ? getFileIcon(file.name) : Upload;

    if (file) {
        return (
            <div className={cn("rounded-xl border border-border bg-card px-4 py-3", className)}>
                <div className="flex items-center gap-3">
                    {previewSrc ? (
                        <img src={previewSrc} alt="Preview" className="h-10 w-10 rounded-lg object-cover border border-border" />
                    ) : (
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-secondary">
                            <IconComp size={16} className="text-muted-foreground" />
                        </div>
                    )}
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
                        <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                    </div>
                    <button type="button" aria-label="Remove selected file" onClick={onClear} className="text-muted-foreground hover:text-foreground transition-colors">
                        <X size={15} />
                    </button>
                </div>
            </div>
        );
    }

    return (
        <div
            onDragOver={e => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={e => { e.preventDefault(); setDrag(false); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
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
                "flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed cursor-pointer transition-all py-12 px-6 text-center",
                drag ? "border-accent bg-accent/5" : "border-border hover:border-accent/40 hover:bg-secondary/40 bg-secondary/20",
                className,
            )}
        >
            <input ref={ref} type="file" accept={accept} className="hidden" onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
            <div className={cn("flex h-12 w-12 items-center justify-center rounded-2xl transition-colors", drag ? "bg-accent/20" : "bg-secondary")}>
                <Upload size={22} className={drag ? "text-primary" : "text-muted-foreground"} strokeWidth={1.5} />
            </div>
            <p className="text-sm font-semibold text-foreground">{label || "Drop file here"}</p>
            <p className="text-xs text-muted-foreground">{hint || "Drag & drop or click to browse"}</p>
        </div>
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
    return (
        <div className={cn("space-y-1.5", className)}>
            <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">{label || "Processing…"}</span>
                {!isIndeterminate && <span className="text-primary font-medium">{Math.round(progress)}%</span>}
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                {isIndeterminate ? (
                    <div className="h-full w-1/3 rounded-full bg-primary animate-[shimmer_1.5s_ease-in-out_infinite]"
                        style={{ animation: "shimmer 1.5s ease-in-out infinite" }} />
                ) : (
                    <div className="h-full rounded-full bg-primary transition-all duration-500 ease-out"
                        style={{ width: `${Math.min(100, progress)}%` }} />
                )}
            </div>
        </div>
    );
}
