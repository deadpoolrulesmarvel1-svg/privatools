import { useState, useCallback, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Upload, FileText, ImageIcon, FileArchive, FileVideo, X, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { tools } from "@/data/tools";
import { nonPdfTools } from "@/data/non-pdf-tools";

// Map file extensions to compatible tools
const extensionMap: Record<string, { slug: string; name: string; path: string }[]> = {};

function addMapping(exts: string[], slug: string, name: string, prefix: string) {
    for (const ext of exts) {
        if (!extensionMap[ext]) extensionMap[ext] = [];
        extensionMap[ext].push({ slug, name, path: `${prefix}/${slug}` });
    }
}

// PDF tools
tools.forEach(t => {
    if (t.accepts) {
        t.accepts.split(",").forEach(ext => {
            addMapping([ext.trim().replace(".", "")], t.slug, t.name, "/tool");
        });
    }
});

// Non-PDF tools
nonPdfTools.forEach(t => {
    if (t.accepts) {
        t.accepts.split(",").forEach(ext => {
            addMapping([ext.trim().replace(".", "")], t.slug, t.name, "/tools");
        });
    }
});

export function SmartFileDetector() {
    const [detectedTools, setDetectedTools] = useState<{ slug: string; name: string; path: string }[]>([]);
    const [fileName, setFileName] = useState("");
    const [show, setShow] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const navigate = useNavigate();

    const handleFile = useCallback((file: File) => {
        const ext = file.name.split(".").pop()?.toLowerCase() || "";
        setFileName(file.name);
        const matching = extensionMap[ext] || [];

        // Also match by mime type
        const mimeTools: typeof matching = [];
        if (file.type.startsWith("image/")) {
            nonPdfTools.forEach(t => {
                if (t.accepts?.includes("image") && !matching.find(m => m.slug === t.slug)) {
                    mimeTools.push({ slug: t.slug, name: t.name, path: `/tools/${t.slug}` });
                }
            });
        }

        setDetectedTools([...matching, ...mimeTools].slice(0, 12));
        setShow(true);
    }, []);

    const getIcon = () => {
        const ext = fileName.split(".").pop()?.toLowerCase() || "";
        if (ext === "pdf") return FileText;
        if (["jpg", "jpeg", "png", "gif", "webp", "svg", "heic"].includes(ext)) return ImageIcon;
        if (["mp4", "mov", "avi", "webm", "mp3", "wav"].includes(ext)) return FileVideo;
        if (["zip", "tar", "gz", "rar", "7z"].includes(ext)) return FileArchive;
        return FileText;
    };

    if (!show) {
        return (
            <div
                onClick={() => inputRef.current?.click()}
                onDragOver={e => { e.preventDefault(); e.stopPropagation(); }}
                onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); }}
                className="relative group cursor-pointer rounded-2xl border-2 border-dashed border-border/40 hover:border-primary/40 bg-card/30 hover:bg-primary/5 transition-all p-8 text-center overflow-hidden"
            >
                {/* Subtle grid background pattern */}
                <div
                    className="absolute inset-0 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity pointer-events-none"
                    style={{
                        backgroundImage: "linear-gradient(to right, currentColor 1px, transparent 1px), linear-gradient(to bottom, currentColor 1px, transparent 1px)",
                        backgroundSize: "24px 24px",
                    }}
                />

                <input
                    ref={inputRef}
                    type="file"
                    className="hidden"
                    onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]); }}
                />
                <div className="relative">
                    <Upload size={28} className="mx-auto text-muted-foreground/25 group-hover:text-primary/50 mb-3 transition-all group-hover:-translate-y-0.5 duration-300" />
                    <p className="text-sm font-heading font-semibold text-foreground/80">Drop any file to find compatible tools</p>
                    <p className="text-xs text-muted-foreground/80 mt-1">PDF, images, video, archives, documents…</p>
                </div>
            </div>
        );
    }

    const Icon = getIcon();

    return (
        <div className="rounded-2xl border border-border/50 bg-card/40 overflow-hidden relative">
            {/* Subtle glow effect when file is detected */}
            <div className="absolute -inset-px rounded-2xl bg-primary/5 blur-sm pointer-events-none" />

            <div className="relative">
                <div className="flex items-center gap-3.5 px-5 py-4 border-b border-border/30">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                        <Icon size={18} className="text-primary/70" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="text-sm font-heading font-semibold text-foreground truncate">{fileName}</p>
                        <p className="text-[11px] text-muted-foreground/80">{detectedTools.length} compatible tool{detectedTools.length !== 1 ? "s" : ""} found</p>
                    </div>
                    <button onClick={() => { setShow(false); setDetectedTools([]); }} className="text-muted-foreground/85 hover:text-muted-foreground transition-colors">
                        <X size={15} />
                    </button>
                </div>

                {detectedTools.length > 0 ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 p-2.5">
                        {detectedTools.map(t => (
                            <Link
                                key={t.slug}
                                to={t.path}
                                className="group/item flex items-center gap-2 px-3 py-3 rounded-xl text-[12px] font-medium text-muted-foreground hover:bg-primary/8 hover:text-foreground transition-colors"
                            >
                                <span className="flex-1 truncate">{t.name}</span>
                                <ArrowRight size={11} className="shrink-0 opacity-0 group-hover/item:opacity-60 transition-opacity text-primary" />
                            </Link>
                        ))}
                    </div>
                ) : (
                    <div className="p-8 text-center">
                        <p className="text-[13px] text-muted-foreground/80">No compatible tools found for this file type</p>
                    </div>
                )}
            </div>
        </div>
    );
}
