import { useState, useCallback, useEffect } from "react";
import { formatFileSize } from "@/lib/api";
import { FileIntake, StudioFile, StudioProgress } from "@/skins/experience/ToolStudio";
import { useToolLocation } from "@/skins/experience/tool-location";

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

export function FileUploadZone({ onFileSelect, file, onClear, accept, label, hint, showPreview, className, multiple, onFilesSelect }: FileUploadZoneProps) {
    const [previewSrc, setPreviewSrc] = useState<string | null>(null);
    // On a tool page the chosen file's row says where it goes: the editors hide
    // the page's location line after a choice, and the upload comes at the run.
    const where = useToolLocation();

    useEffect(() => {
        if (!showPreview || !file?.type.startsWith("image/")) { setPreviewSrc(null); return; }
        const url = URL.createObjectURL(file);
        setPreviewSrc(url);
        return () => URL.revokeObjectURL(url);
    }, [file, showPreview]);

    const handleFile = useCallback((f: File) => { onFileSelect(f); }, [onFileSelect]);

    const handleIncoming = useCallback((list: FileList | File[]) => {
        if (multiple && onFilesSelect) {
            const all = Array.from(list);
            if (all.length) onFilesSelect(all);
            return;
        }
        if (list[0]) handleFile(list[0]);
    }, [multiple, onFilesSelect, handleFile]);

    if (file) return <div className={className} role="status" aria-live="polite">
        {previewSrc && <img src={previewSrc} alt={`Preview of ${file.name}`} className="ts-selected-preview" />}
        <StudioFile name={file.name} detail={`${formatFileSize(file.size)} · ${where ? where.label : "Ready on this device"}`} onRemove={onClear} />
    </div>;
    return <div className={className}><FileIntake accepts={accept} multiple={multiple}
        label={label || "Upload file"} detail={hint} onFiles={handleIncoming} /></div>;
}

/* ── Processing Progress Bar ─────────────────────────────────────────────── */
interface ProgressBarProps {
    progress?: number; // 0-100, undefined = indeterminate
    label?: string;
    className?: string;
}

export function ProcessingBar({ progress, label, className }: ProgressBarProps) {
    return <div className={className}><StudioProgress progress={progress} label={label} /></div>;
}
