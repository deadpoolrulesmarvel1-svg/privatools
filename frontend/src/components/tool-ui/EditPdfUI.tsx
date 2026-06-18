/**
 * EditPdfUI — full-viewport PDF editor.
 *
 * Tools (all backend-supported):
 *   • Select       — click an edit to select; drag to move; resize handles
 *   • Text         — click to drop a text input
 *   • Highlight    — click-drag to size a translucent yellow band
 *   • Whiteout     — click-drag a solid white rectangle (cover content)
 *   • Rectangle    — click-drag a stroked rectangle
 *   • Line         — click-drag from one point to another
 *   • Circle       — click-drag from center outward
 *   • Image        — click to place; opens file picker, drops at click point
 *
 * Power-user features:
 *   • Full undo/redo stack (Cmd+Z / Cmd+Shift+Z), 100 frames cap
 *   • Move + 8-handle resize on rect/highlight/whiteout/circle/image
 *   • 2-endpoint resize on line
 *   • Keyboard: T/H/W/R/L/C/I to switch tool (V for Select),
 *               Delete/Backspace to remove, Esc to deselect,
 *               arrows to nudge (Shift = 10×), Cmd+D to duplicate
 *   • Click+Apply round-trips to the server for the actual flatten
 *   • Multi-page PDF with thumbnail sidebar
 */
import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import {
    Download, CheckCircle2, AlertCircle, Type, Eraser, Square, Circle as CircleIcon,
    Minus, Highlighter, Undo2, Redo2, Trash2, Copy, ChevronRight, ZoomIn,
    ZoomOut, X, ChevronLeft, MousePointer2, Image as ImageIcon, Layers,
} from "lucide-react";
import { cn, friendlyError } from "@/lib/utils";
import { downloadBlob, postFormData } from "@/lib/api";
import { FileUploadZone, ProcessingBar } from "./FileUploadZone";
import { createPortal } from "react-dom";
import { useEditHistory } from "@/hooks/useEditHistory";

// PDF.js is loaded dynamically the first time a user drops a file so the
// ~440 KB library is excluded from the EditPdfUI route chunk. The promise
// is memoised at module scope to avoid re-importing on every PDF open.
type PdfjsLibType = typeof import("pdfjs-dist");
let pdfjsLibPromise: Promise<PdfjsLibType> | null = null;
const loadPdfjs = (): Promise<PdfjsLibType> => {
    if (!pdfjsLibPromise) {
        pdfjsLibPromise = (async () => {
            const [lib, workerUrl] = await Promise.all([
                import("pdfjs-dist"),
                import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
            ]);
            lib.GlobalWorkerOptions.workerSrc = workerUrl.default;
            return lib;
        })();
    }
    return pdfjsLibPromise;
};

const FONTS = [
    { value: "Helvetica", label: "Helvetica" },
    { value: "Helvetica-Bold", label: "Helvetica Bold" },
    { value: "Times-Roman", label: "Times Roman" },
    { value: "Times-Bold", label: "Times Bold" },
    { value: "Courier", label: "Courier" },
    { value: "Courier-Bold", label: "Courier Bold" },
];

const PALETTE = [
    "#000000", "#ffffff", "#dc2626", "#2563eb", "#16a34a",
    "#9333ea", "#ea580c", "#0891b2", "#facc15", "#78716c",
];

/* ────────────── Edit Types ──────────────
   IDs are local-only and stripped before send. All other fields match
   the backend edit_pdf_service.py shape exactly. */
interface BaseEdit { id: string; page: number; }
interface TextEdit extends BaseEdit { type: "text"; x: number; y: number; text: string; font_size: number; color: string; font_family: string; }
interface RectEdit extends BaseEdit { type: "rectangle"; x: number; y: number; width: number; height: number; stroke_color: string; fill_color: string; stroke_width: number; }
interface HighlightEdit extends BaseEdit { type: "highlight"; x: number; y: number; width: number; height: number; color: string; opacity: number; }
interface LineEdit extends BaseEdit { type: "line"; x1: number; y1: number; x2: number; y2: number; color: string; stroke_width: number; }
interface CircleEdit extends BaseEdit { type: "circle"; x: number; y: number; radius: number; stroke_color: string; fill_color: string; stroke_width: number; }
interface ImageEdit extends BaseEdit { type: "image"; x: number; y: number; width: number; height: number; image_data: string; }

type Edit = TextEdit | RectEdit | HighlightEdit | LineEdit | CircleEdit | ImageEdit;
type ToolId = "select" | "text" | "highlight" | "whiteout" | "rect" | "line" | "circle" | "image";

const TOOLS: { id: ToolId; icon: typeof Type; label: string; shortcut: string; hint: string }[] = [
    { id: "select",    icon: MousePointer2, label: "Select",    shortcut: "V", hint: "Click an edit to select, drag to move" },
    { id: "text",      icon: Type,          label: "Text",      shortcut: "T", hint: "Click to drop a text box" },
    { id: "highlight", icon: Highlighter,   label: "Highlight", shortcut: "H", hint: "Click + drag to highlight a region" },
    { id: "whiteout",  icon: Eraser,        label: "Whiteout",  shortcut: "W", hint: "Click + drag to cover with white" },
    { id: "rect",      icon: Square,        label: "Rectangle", shortcut: "R", hint: "Click + drag a stroked rectangle" },
    { id: "line",      icon: Minus,         label: "Line",      shortcut: "L", hint: "Click + drag a line between two points" },
    { id: "circle",    icon: CircleIcon,    label: "Circle",    shortcut: "C", hint: "Click + drag from center outward" },
    { id: "image",     icon: ImageIcon,     label: "Image",     shortcut: "I", hint: "Click to insert an image at that point" },
];

type GestureKind =
    | { kind: "move"; id: string }
    | { kind: "resize"; id: string; handle: ResizeHandle }
    | { kind: "draw"; tool: Exclude<ToolId, "select" | "text" | "image">; id: string }
    | null;

type ResizeHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "p1" | "p2";

/* ────────────── Geometry helpers ────────────── */
function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function uid() { return Math.random().toString(36).slice(2); }

export function EditPdfUI() {
    const [file, setFile] = useState<File | null>(null);
    const history = useEditHistory<Edit[]>([]);
    const edits = history.present;
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [state, setState] = useState<"idle" | "editing" | "processing" | "done">("idle");
    const [error, setError] = useState<string | null>(null);
    const [resultBlob, setResultBlob] = useState<Blob | null>(null);
    const [activeTool, setActiveTool] = useState<ToolId>("select");
    const [zoom, setZoom] = useState(100);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(0);
    const [pdfDoc, setPdfDoc] = useState<any>(null);
    const [pageSize, setPageSize] = useState({ w: 595, h: 842 });
    const [showThumbs, setShowThumbs] = useState(true);
    const [gesture, setGesture] = useState<GestureKind>(null);
    const gestureRef = useRef<{ start: { x: number; y: number }; initial: Edit | null }>({ start: { x: 0, y: 0 }, initial: null });
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const overlayRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const pendingImagePosRef = useRef<{ x: number; y: number } | null>(null);

    /* ─── PDF load ─── */
    useEffect(() => {
        if (!file) return;
        let cancelled = false;
        (async () => {
            try {
                const pdfjsLib = await loadPdfjs();
                const buf = await file.arrayBuffer();
                const doc = await pdfjsLib.getDocument({ data: buf }).promise;
                if (cancelled) return;
                setPdfDoc(doc);
                setTotalPages(doc.numPages);
                setCurrentPage(1);
            } catch (e) {
                if (!cancelled) {
                    setError(friendlyError(String(e), "Couldn't read that PDF."));
                    setState("idle");
                }
            }
        })();
        return () => { cancelled = true; };
    }, [file]);

    /* ─── Render current page ─── */
    useEffect(() => {
        if (!pdfDoc || !canvasRef.current) return;
        let cancelled = false;
        (async () => {
            try {
                const page = await pdfDoc.getPage(currentPage);
                const scale = 1.5 * (zoom / 100);
                const vp = page.getViewport({ scale });
                if (cancelled) return;
                const cv = canvasRef.current!;
                cv.width = vp.width;
                cv.height = vp.height;
                setPageSize({ w: page.getViewport({ scale: 1 }).width, h: page.getViewport({ scale: 1 }).height });
                await page.render({ canvasContext: cv.getContext("2d")!, viewport: vp }).promise;
            } catch (e) { /* render aborted by page change — ignore */ }
        })();
        return () => { cancelled = true; };
    }, [pdfDoc, currentPage, zoom]);

    /* ─── File pick ─── */
    const pickFile = (f: File) => {
        setFile(f);
        setState("editing");
        setError(null);
        history.reset([]);
        setSelectedId(null);
    };

    /* ─── Coordinate transforms ─── */
    const pdfCoords = useCallback((clientX: number, clientY: number) => {
        if (!overlayRef.current) return { x: 0, y: 0 };
        const r = overlayRef.current.getBoundingClientRect();
        return {
            x: Math.round(((clientX - r.left) / r.width) * pageSize.w),
            y: Math.round((1 - (clientY - r.top) / r.height) * pageSize.h),
        };
    }, [pageSize]);

    /* ─── Image insert flow ─── */
    const startImageInsert = (pdfX: number, pdfY: number) => {
        pendingImagePosRef.current = { x: pdfX, y: pdfY };
        fileInputRef.current?.click();
    };
    const onImageFileChosen = (file: File) => {
        const pos = pendingImagePosRef.current;
        if (!pos) return;
        pendingImagePosRef.current = null;
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = String(reader.result || "");
            if (!dataUrl) return;
            // Default size 200×200, anchor at click point
            const img = new Image();
            img.onload = () => {
                const maxDim = 200;
                const r = Math.max(img.width, img.height);
                const w = (img.width / r) * maxDim;
                const h = (img.height / r) * maxDim;
                const newEdit: ImageEdit = {
                    id: uid(), type: "image", page: currentPage,
                    x: pos.x, y: pos.y - h, // anchor as bottom-left from click
                    width: w, height: h,
                    image_data: dataUrl,
                };
                history.set([...history.present, newEdit]);
                setSelectedId(newEdit.id);
                setActiveTool("select");
            };
            img.src = dataUrl;
        };
        reader.readAsDataURL(file);
    };

    /* ─── Click on empty canvas — Text places, Image opens picker, others wait for drag ─── */
    const onOverlayClick = (e: React.MouseEvent) => {
        if (gesture) return;
        // Deselect when clicking empty canvas in select mode
        if (activeTool === "select") {
            if ((e.target as HTMLElement).dataset.editSurface) setSelectedId(null);
            return;
        }
        const { x, y } = pdfCoords(e.clientX, e.clientY);
        if (activeTool === "text") {
            const newEdit: TextEdit = { id: uid(), type: "text", page: currentPage, x, y, text: "", font_size: 16, color: "#000000", font_family: "Helvetica" };
            history.set([...edits, newEdit]);
            setSelectedId(newEdit.id);
            return;
        }
        if (activeTool === "image") {
            startImageInsert(x, y);
            return;
        }
        // Other tools use drag (mousedown handler below); a pure click does nothing.
    };

    /* ─── Pointer gestures — start drag/draw/resize ─── */
    const onOverlayPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        const target = e.target as HTMLElement;
        e.currentTarget.setPointerCapture(e.pointerId);

        // Click on resize handle?
        if (target.dataset.resizeHandle) {
            const id = target.dataset.editId!;
            const handle = target.dataset.resizeHandle as ResizeHandle;
            const initial = edits.find(x => x.id === id);
            if (!initial) return;
            gestureRef.current = { start: { x: e.clientX, y: e.clientY }, initial };
            setGesture({ kind: "resize", id, handle });
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // Click on existing edit body in select mode → start move
        if (target.dataset.editBody && activeTool === "select") {
            const id = target.dataset.editId!;
            const initial = edits.find(x => x.id === id);
            if (!initial) return;
            setSelectedId(id);
            gestureRef.current = { start: { x: e.clientX, y: e.clientY }, initial };
            setGesture({ kind: "move", id });
            e.preventDefault();
            e.stopPropagation();
            return;
        }

        // Empty canvas in a drawing tool → start draw
        if (target.dataset.editSurface && activeTool !== "select" && activeTool !== "text" && activeTool !== "image") {
            const { x, y } = pdfCoords(e.clientX, e.clientY);
            let newEdit: Edit;
            const id = uid();
            switch (activeTool) {
                case "highlight":
                    newEdit = { id, type: "highlight", page: currentPage, x, y, width: 0, height: 0, color: "#facc15", opacity: 0.4 };
                    break;
                case "whiteout":
                    newEdit = { id, type: "rectangle", page: currentPage, x, y, width: 0, height: 0, stroke_color: "#ffffff", fill_color: "#ffffff", stroke_width: 0 };
                    break;
                case "rect":
                    newEdit = { id, type: "rectangle", page: currentPage, x, y, width: 0, height: 0, stroke_color: "#2563eb", fill_color: "", stroke_width: 2 };
                    break;
                case "line":
                    newEdit = { id, type: "line", page: currentPage, x1: x, y1: y, x2: x, y2: y, color: "#2563eb", stroke_width: 2 };
                    break;
                case "circle":
                    newEdit = { id, type: "circle", page: currentPage, x, y, radius: 0, stroke_color: "#2563eb", fill_color: "", stroke_width: 2 };
                    break;
                default: return;
            }
            history.set([...edits, newEdit]);
            setSelectedId(id);
            gestureRef.current = { start: { x: e.clientX, y: e.clientY }, initial: newEdit };
            setGesture({ kind: "draw", tool: activeTool, id });
            e.preventDefault();
            return;
        }
    };

    /* ─── Pointermove — update transient state ───
       Refs hold the live edit list + history callbacks so transient updates
       collapse into one undo frame while pointer capture keeps touch drags
       alive even if a finger leaves the overlay. */
    const editsRef = useRef(edits);
    editsRef.current = edits;
    const { set: historySet, setTransient: historySetTransient } = history;

    const onOverlayPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
        if (!gesture) return;
        const start = gestureRef.current.start;
        const initial = gestureRef.current.initial;
        if (!initial) return;
        e.preventDefault();
        const dxClient = e.clientX - start.x;
        const dyClient = e.clientY - start.y;
        const rect = overlayRef.current?.getBoundingClientRect();
        if (!rect) return;
        // Convert client delta to PDF delta (PDF y-axis is inverted vs screen)
        const dx = (dxClient / rect.width) * pageSize.w;
        const dy = -(dyClient / rect.height) * pageSize.h;

        const updated = updateForGesture(initial, gesture, dx, dy, pageSize, e.shiftKey);
        const nextEdits = editsRef.current.map(x => x.id === initial.id ? updated : x);
        historySetTransient(nextEdits);
    };

    const endOverlayPointerGesture = (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
        }
        if (!gesture) return;
        // Commit final position to history via .set (creates a new undo frame;
        // the in-flight transient updates collapse into one)
        historySet(editsRef.current);
        setGesture(null);
    };

    /* ─── Per-edit mutation helpers (each pushes to history) ─── */
    const updateEdit = (id: string, updates: Partial<Edit>) => {
        history.set(edits.map(e => e.id === id ? { ...e, ...updates } as Edit : e));
    };
    const removeEdit = useCallback((id: string) => {
        history.set(edits.filter(e => e.id !== id));
        if (selectedId === id) setSelectedId(null);
    }, [edits, history, selectedId]);
    const duplicateEdit = useCallback((id: string) => {
        const src = edits.find(e => e.id === id);
        if (!src) return;
        const dup = JSON.parse(JSON.stringify(src)) as Edit;
        dup.id = uid();
        // Nudge so the dupe is visible
        if ("x" in dup) (dup as any).x += 20;
        if ("y" in dup) (dup as any).y -= 20;
        if (dup.type === "line") { dup.x1 += 20; dup.y1 -= 20; dup.x2 += 20; dup.y2 -= 20; }
        history.set([...edits, dup]);
        setSelectedId(dup.id);
    }, [edits, history]);
    const nudge = useCallback((id: string, dx: number, dy: number) => {
        const e = edits.find(x => x.id === id);
        if (!e) return;
        const moved = applyTranslate(e, dx, dy);
        history.set(edits.map(x => x.id === id ? moved : x));
    }, [edits, history]);

    /* ─── Keyboard ─── */
    const canProcess = !!file && edits.length > 0 && state !== "processing" && !edits.some(e => e.type === "text" && !(e as TextEdit).text.trim());

    const process = useCallback(async () => {
        if (!file || edits.length === 0) return;
        setState("processing"); setError(null);
        try {
            const res = await postFormData("/edit-pdf", () => {
                const fd = new FormData();
                fd.append("file", file);
                fd.append("edits", JSON.stringify(edits.map(({ id, ...rest }) => rest)));
                return fd;
            }, { timeoutMs: 300_000 });
            setResultBlob(await res.blob());
            setState("done");
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : "Could not apply edits";
            setError(friendlyError(msg, "Couldn't edit that PDF."));
            setState("editing");
        }
    }, [file, edits]);

    useEffect(() => {
        const isText = (el: EventTarget | null) =>
            el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || (el as HTMLElement)?.isContentEditable;
        const onKey = (e: KeyboardEvent) => {
            if (state !== "editing") return;
            // Cmd/Ctrl+Enter — process
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canProcess) { e.preventDefault(); process(); return; }
            // Cmd/Ctrl+Z, Cmd/Ctrl+Shift+Z
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
                e.preventDefault();
                e.shiftKey ? history.redo() : history.undo();
                return;
            }
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "y") {
                e.preventDefault(); history.redo(); return;
            }
            // Cmd/Ctrl+D — duplicate
            if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d" && selectedId) {
                e.preventDefault(); duplicateEdit(selectedId); return;
            }
            // Don't intercept regular keys when typing
            if (isText(e.target)) return;
            // Single-letter tool switching
            const shortcuts: Record<string, ToolId> = { v: "select", t: "text", h: "highlight", w: "whiteout", r: "rect", l: "line", c: "circle", i: "image" };
            if (shortcuts[e.key.toLowerCase()] && !e.metaKey && !e.ctrlKey && !e.altKey) {
                e.preventDefault();
                setActiveTool(shortcuts[e.key.toLowerCase()]);
                return;
            }
            // Delete / Backspace
            if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
                e.preventDefault(); removeEdit(selectedId); return;
            }
            // Escape — deselect
            if (e.key === "Escape") {
                e.preventDefault();
                if (selectedId) setSelectedId(null);
                else if (gesture) setGesture(null);
                return;
            }
            // Arrows — nudge
            if (selectedId && ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
                e.preventDefault();
                const step = e.shiftKey ? 10 : 1;
                const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
                const dy = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
                nudge(selectedId, dx, dy);
                return;
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [state, canProcess, process, history, selectedId, gesture, duplicateEdit, removeEdit, nudge]);

    const handleDownload = () => {
        if (resultBlob) downloadBlob(resultBlob, file ? `${file.name.replace(/\.pdf$/i, "")}_edited.pdf` : "edited.pdf");
    };

    const pageEdits = useMemo(() => edits.filter(e => e.page === currentPage), [edits, currentPage]);

    /* ═══ Done state ═══ */
    if (state === "done") return (
        <div className="rounded-2xl border border-accent/30 bg-accent/[0.05] overflow-hidden animate-fade-up">
            <div className="relative p-7 sm:p-9 animate-corner-extend">
                <CornerMarks />
                <div className="flex items-start gap-5">
                    <div className="h-14 w-14 rounded-2xl bg-accent/15 border border-accent/35 flex items-center justify-center shrink-0 animate-success-pop">
                        <CheckCircle2 size={24} className="text-accent" strokeWidth={1.75} />
                    </div>
                    <div className="flex-1 min-w-0">
                        <p className="section-mark mb-2">Edits applied</p>
                        <h2 className="font-display text-[26px] font-bold text-foreground tracking-[-0.025em] leading-tight" style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}>
                            <span className="italic text-accent">{edits.length}</span> change{edits.length !== 1 && "s"} written
                        </h2>
                        <div className="mt-5 flex flex-wrap gap-2">
                            <button onClick={handleDownload} className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md bg-foreground text-background text-[13px] font-semibold hover:opacity-90">
                                <Download size={13} /> Download
                            </button>
                            <button
                                onClick={() => { setFile(null); setState("idle"); history.reset([]); setResultBlob(null); setSelectedId(null); setPdfDoc(null); }}
                                className="inline-flex items-center gap-1.5 h-9 px-4 rounded-md border border-border bg-card text-[13px] font-medium text-foreground hover:bg-secondary/60 transition-colors"
                            >
                                Edit another
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );

    /* ═══ Upload state ═══ */
    if (state === "idle") return (
        <FileUploadZone file={null} onFileSelect={pickFile} onClear={() => { }} accept=".pdf"
            label="Drop PDF to edit visually"
            hint="Add text, shapes, lines, highlights, images, whiteout · move, resize, undo · server-flattened on Apply" />
    );

    const scale = 1.5 * (zoom / 100);

    /* ═══ Full-viewport editor ═══ */
    const editor = (
        <div className="fixed inset-0 z-[100] flex flex-col" style={{ background: "hsl(224 20% 7%)" }}>

            {/* ─── Hidden file input for image insert ─── */}
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) onImageFileChosen(f); e.target.value = ""; }} />

            {/* ─── Header ─── */}
            <div className="flex items-center gap-3 px-4 h-12 shrink-0" style={{ background: "hsl(224 18% 10%)", borderBottom: "1px solid hsl(224 15% 16%)" }}>
                <button onClick={() => { setFile(null); setState("idle"); history.reset([]); setSelectedId(null); setPdfDoc(null); }}
                    className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/[0.06] transition-all" title="Close editor (no edits saved)">
                    <X size={16} />
                </button>
                <div className="w-px h-5" style={{ background: "hsl(224 15% 16%)" }} />
                <span className="text-sm font-medium text-white/80 truncate max-w-[180px]">{file?.name}</span>
                <div className="flex-1" />

                {/* Pages sidebar toggle */}
                {totalPages > 1 && (
                    <button onClick={() => setShowThumbs(s => !s)}
                        title={showThumbs ? "Hide page thumbnails" : "Show page thumbnails"}
                        aria-pressed={showThumbs}
                        className={cn("p-1.5 rounded-lg transition-colors",
                            showThumbs ? "text-white bg-white/[0.08]" : "text-white/40 hover:text-white hover:bg-white/[0.06]")}>
                        <Layers size={14} />
                    </button>
                )}

                {/* Undo / Redo */}
                <div className="flex items-center gap-0.5 rounded-lg px-1 py-0.5" style={{ background: "hsl(224 15% 14%)" }}>
                    <button onClick={history.undo} disabled={!history.canUndo}
                        title="Undo (⌘Z)"
                        className="p-1.5 text-white/40 hover:text-white disabled:opacity-20 transition-colors rounded"><Undo2 size={14} /></button>
                    <button onClick={history.redo} disabled={!history.canRedo}
                        title="Redo (⌘⇧Z)"
                        className="p-1.5 text-white/40 hover:text-white disabled:opacity-20 transition-colors rounded"><Redo2 size={14} /></button>
                </div>

                {/* Page nav */}
                {totalPages > 1 && (
                    <div className="flex items-center gap-0.5 rounded-lg px-1 py-0.5" style={{ background: "hsl(224 15% 14%)" }}>
                        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage <= 1}
                            className="p-1 text-white/40 hover:text-white disabled:opacity-20 transition-colors rounded"><ChevronLeft size={14} /></button>
                        <span className="text-[11px] text-white/50 font-medium min-w-[70px] text-center">Page {currentPage} / {totalPages}</span>
                        <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage >= totalPages}
                            className="p-1 text-white/40 hover:text-white disabled:opacity-20 transition-colors rounded"><ChevronRight size={14} /></button>
                    </div>
                )}

                {/* Zoom */}
                <div className="flex items-center gap-0.5 rounded-lg px-1 py-0.5" style={{ background: "hsl(224 15% 14%)" }}>
                    <button onClick={() => setZoom(z => Math.max(50, z - 10))} className="p-1 text-white/40 hover:text-white transition-colors rounded"><ZoomOut size={14} /></button>
                    <span className="text-[11px] text-white/50 font-medium min-w-[36px] text-center">{zoom}%</span>
                    <button onClick={() => setZoom(z => Math.min(200, z + 10))} className="p-1 text-white/40 hover:text-white transition-colors rounded"><ZoomIn size={14} /></button>
                </div>

                <div className="w-px h-5" style={{ background: "hsl(224 15% 16%)" }} />

                {/* Apply */}
                <div className="flex items-center gap-3 flex-wrap">
                    <button onClick={process} disabled={!canProcess}
                        className={cn("flex items-center gap-1.5 rounded-lg px-5 py-1.5 text-sm font-semibold transition-all",
                            canProcess ? "text-white shadow-lg" : "text-white/20 cursor-not-allowed")}
                        style={canProcess ? { background: "hsl(216 90% 60%)", boxShadow: "0 0 20px -4px hsl(216 90% 60% / 0.4)" } : { background: "hsl(224 15% 14%)" }}>
                        Apply changes <ChevronRight size={14} />
                    </button>
                    {canProcess && (
                        <kbd className="hidden sm:inline-flex items-center gap-0.5 font-mono text-[10px] text-white/60 bg-white/10 rounded px-1.5 py-0.5">⌘↵</kbd>
                    )}
                </div>
            </div>

            {/* ─── Toolbar ─── */}
            <div className="flex items-center justify-center gap-1 px-4 h-10 shrink-0" style={{ background: "hsl(224 15% 14%)", borderBottom: "1px solid hsl(224 15% 16%)" }}>
                {TOOLS.map(t => {
                    const Icon = t.icon;
                    const active = activeTool === t.id;
                    return (
                        <button key={t.id} onClick={() => setActiveTool(t.id)}
                            title={`${t.hint} (${t.shortcut})`}
                            aria-label={`${t.label} tool — ${t.hint}`}
                            aria-pressed={active}
                            className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
                                active ? "text-white" : "text-white/35 hover:text-white/60")}
                            style={active ? { background: "hsl(216 90% 60% / 0.15)", color: "hsl(216 90% 70%)" } : {}}>
                            <Icon size={14} />{t.label}
                            <kbd className="hidden md:inline font-mono text-[9px] opacity-50 ml-0.5">{t.shortcut}</kbd>
                        </button>
                    );
                })}
                <div className="flex-1" />
                <span className="text-[10px] text-white/25">
                    {edits.length ? `${edits.length} edit${edits.length !== 1 ? "s" : ""} queued · Apply when ready` : `${TOOLS.find(t => t.id === activeTool)?.hint}`}
                </span>
            </div>

            {/* ─── Body — thumbnails + canvas ─── */}
            <div className="flex-1 flex overflow-hidden">

                {/* Thumbnails sidebar */}
                {totalPages > 1 && showThumbs && (
                    <PageThumbs pdfDoc={pdfDoc} totalPages={totalPages} currentPage={currentPage} onJump={setCurrentPage} edits={edits} />
                )}

                {/* Canvas */}
                <div className="flex-1 overflow-auto" style={{ background: "hsl(224 20% 12%)" }}>
                    <div className="flex items-start justify-center min-h-full py-8 px-4">
                        <div className="relative" style={{ boxShadow: "0 8px 60px rgba(0,0,0,0.4)", lineHeight: 0 }}>
                            <canvas ref={canvasRef} className="block rounded-sm" />
                            <div
                                ref={overlayRef}
                                data-edit-surface="1"
                                className="absolute inset-0 rounded-sm select-none"
                                style={{ cursor: cursorForTool(activeTool), touchAction: "none" }}
                                onClick={onOverlayClick}
                                onPointerDown={onOverlayPointerDown}
                                onPointerMove={onOverlayPointerMove}
                                onPointerUp={endOverlayPointerGesture}
                                onPointerCancel={endOverlayPointerGesture}
                            >
                                <style>{`
                                    @media (pointer: coarse) {
                                        .edit-pdf-resize-handle {
                                            width: 24px !important;
                                            height: 24px !important;
                                        }
                                    }
                                `}</style>
                                {pageEdits.map(edit => (
                                    <EditRenderer
                                        key={edit.id}
                                        edit={edit}
                                        pageSize={pageSize}
                                        scale={scale}
                                        isSelected={edit.id === selectedId}
                                        activeTool={activeTool}
                                        onSelect={() => setSelectedId(edit.id)}
                                        onUpdate={updates => updateEdit(edit.id, updates as Partial<Edit>)}
                                        onDuplicate={() => duplicateEdit(edit.id)}
                                        onDelete={() => removeEdit(edit.id)}
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Error toast */}
            {error && (
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-xl px-5 py-3 text-sm shadow-2xl z-50"
                    style={{ background: "hsl(0 72% 20%)", border: "1px solid hsl(0 60% 30%)", color: "hsl(0 60% 80%)" }}>
                    <AlertCircle size={15} className="shrink-0" />{error}
                    <button onClick={() => setError(null)} className="ml-2 hover:text-white"><X size={14} /></button>
                </div>
            )}

            {/* Processing overlay */}
            {state === "processing" && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className="rounded-2xl p-8 w-[360px] shadow-2xl" style={{ background: "hsl(224 18% 10%)", border: "1px solid hsl(224 15% 16%)" }}>
                        <ProcessingBar label="Applying edits to your PDF…" />
                    </div>
                </div>
            )}
        </div>
    );

    return createPortal(editor, document.body);
}

/* ────────────── Cursor by tool ────────────── */
function cursorForTool(tool: ToolId): string {
    if (tool === "select") return "default";
    if (tool === "text") return "text";
    return "crosshair";
}

/* ────────────── Apply a gesture delta to an edit ────────────── */
function updateForGesture(initial: Edit, gesture: NonNullable<GestureKind>, dx: number, dy: number, pageSize: { w: number; h: number }, _shift: boolean): Edit {
    if (gesture.kind === "move") {
        return applyTranslate(initial, dx, dy);
    }
    if (gesture.kind === "resize" || gesture.kind === "draw") {
        const handle: ResizeHandle | "draw" = gesture.kind === "resize" ? gesture.handle : "draw";
        return applyResize(initial, dx, dy, handle, pageSize);
    }
    return initial;
}

function applyTranslate(e: Edit, dx: number, dy: number): Edit {
    if (e.type === "line") return { ...e, x1: e.x1 + dx, y1: e.y1 + dy, x2: e.x2 + dx, y2: e.y2 + dy };
    if (e.type === "circle") return { ...e, x: e.x + dx, y: e.y + dy };
    return { ...e, x: (e as any).x + dx, y: (e as any).y + dy } as Edit;
}

function applyResize(initial: Edit, dx: number, dy: number, handle: ResizeHandle | "draw", pageSize: { w: number; h: number }): Edit {
    if (initial.type === "line") {
        if (handle === "p1") return { ...initial, x1: initial.x1 + dx, y1: initial.y1 + dy };
        if (handle === "p2" || handle === "draw") return { ...initial, x2: initial.x2 + dx, y2: initial.y2 + dy };
        return initial;
    }
    if (initial.type === "circle") {
        // Resize from center → radius = distance from initial center to current cursor.
        // For "draw", the radius is the distance from the click origin (initial.x/y) to (initial.x + dx, initial.y + dy).
        const r = Math.max(0, Math.hypot(dx, dy));
        return { ...initial, radius: clamp(r, 1, Math.min(pageSize.w, pageSize.h) / 2) };
    }
    // Rect / Highlight / Image — has x, y, width, height (y is the BOTTOM)
    let { x, y, width, height } = initial as RectEdit | HighlightEdit | ImageEdit;
    if (handle === "draw" || handle === "se") {
        width += dx; height -= dy; y += dy;
    } else if (handle === "nw") {
        x += dx; width -= dx; height += dy;
    } else if (handle === "ne") {
        width += dx; height += dy;
    } else if (handle === "sw") {
        x += dx; width -= dx; height -= dy; y += dy;
    } else if (handle === "n") {
        height += dy;
    } else if (handle === "s") {
        height -= dy; y += dy;
    } else if (handle === "e") {
        width += dx;
    } else if (handle === "w") {
        x += dx; width -= dx;
    }
    // Normalize negative width/height by flipping
    if (width < 0) { x += width; width = -width; }
    if (height < 0) { y += height; height = -height; }
    return { ...initial, x, y, width, height } as Edit;
}

/* ════════════════════════════════════════════════════════════
   EditRenderer — renders one edit + selection chrome + handles
   ════════════════════════════════════════════════════════════ */
interface EditRendererProps {
    edit: Edit;
    pageSize: { w: number; h: number };
    scale: number;
    isSelected: boolean;
    activeTool: ToolId;
    onSelect: () => void;
    onUpdate: (updates: Partial<Edit>) => void;
    onDuplicate: () => void;
    onDelete: () => void;
}

function EditRenderer({ edit, pageSize, scale, isSelected, activeTool, onSelect, onUpdate, onDuplicate, onDelete }: EditRendererProps) {
    /* Common: map PDF-y to CSS-y by flipping. */
    const xPct = (px: number) => (px / pageSize.w) * 100;
    const yPctFromTop = (py: number) => (1 - py / pageSize.h) * 100;

    if (edit.type === "text") {
        const te = edit;
        const leftPct = xPct(te.x);
        const topPct = yPctFromTop(te.y);
        const sz = Math.max(8, te.font_size * scale);
        return (
            <div className="absolute" style={{ left: `${leftPct}%`, top: `${topPct}%`, zIndex: isSelected ? 20 : 10 }}>
                {isSelected && <TextToolbar edit={te} onUpdate={(f, v) => onUpdate({ [f]: v } as any)} onDuplicate={onDuplicate} onDelete={onDelete} />}
                {isSelected ? (
                    <input type="text" autoFocus value={te.text} onChange={e => onUpdate({ text: e.target.value })}
                        placeholder="Type your text" onClick={e => e.stopPropagation()}
                        className="outline-none px-1.5 py-0.5 rounded min-w-[120px]"
                        style={{
                            fontSize: sz, color: te.color, border: "2px solid hsl(216 90% 60%)", background: "hsl(216 90% 60% / 0.08)",
                            fontFamily: te.font_family.includes("Courier") ? "monospace" : te.font_family.includes("Times") ? "serif" : "sans-serif",
                            fontWeight: te.font_family.includes("Bold") ? 700 : 400,
                        }} />
                ) : (
                    <span
                        data-edit-body="1" data-edit-id={te.id}
                        onClick={e => { e.stopPropagation(); onSelect(); }}
                        className="cursor-pointer rounded px-1.5 py-0.5 transition-all hover:ring-2 hover:ring-blue-400/50"
                        style={{
                            fontSize: sz, color: te.color,
                            fontFamily: te.font_family.includes("Courier") ? "monospace" : te.font_family.includes("Times") ? "serif" : "sans-serif",
                            fontWeight: te.font_family.includes("Bold") ? 700 : 400,
                        }}>
                        {te.text || <span className="opacity-40">Type text</span>}
                    </span>
                )}
            </div>
        );
    }

    if (edit.type === "line") {
        // Lines render as SVG so we get crisp diagonals at any scale.
        const { x1, y1, x2, y2 } = edit;
        const left = `${xPct(Math.min(x1, x2))}%`;
        const top = `${yPctFromTop(Math.max(y1, y2))}%`;
        const w = `${xPct(Math.abs(x2 - x1))}%`;
        const h = `${yPctFromTop(Math.min(y1, y2)) - yPctFromTop(Math.max(y1, y2))}%`;
        const sx1 = x1 < x2 ? 0 : 1, sx2 = 1 - sx1;
        const sy1 = y1 > y2 ? 0 : 1, sy2 = 1 - sy1;
        const ringClass = isSelected ? "ring-2 ring-blue-400" : "";
        return (
            <div className={cn("absolute", ringClass)} style={{ left, top, width: w, height: h, zIndex: isSelected ? 20 : 5 }}>
                <svg width="100%" height="100%" viewBox="0 0 1 1" preserveAspectRatio="none" style={{ overflow: "visible", pointerEvents: "none" }}>
                    <line x1={sx1} y1={sy1} x2={sx2} y2={sy2} stroke={edit.color} strokeWidth={edit.stroke_width * scale} vectorEffect="non-scaling-stroke" />
                </svg>
                {/* Hit area for selection */}
                <div data-edit-body="1" data-edit-id={edit.id}
                    onClick={e => { e.stopPropagation(); onSelect(); }}
                    className="absolute inset-0 cursor-pointer" style={{ pointerEvents: "auto" }} />
                {isSelected && (
                    <>
                        <LineEndpointHandle editId={edit.id} which="p1" left={`${(sx1 * 100).toFixed(2)}%`} top={`${(sy1 * 100).toFixed(2)}%`} />
                        <LineEndpointHandle editId={edit.id} which="p2" left={`${(sx2 * 100).toFixed(2)}%`} top={`${(sy2 * 100).toFixed(2)}%`} />
                        <FloatingToolbar onDuplicate={onDuplicate} onDelete={onDelete}>
                            <ColorRow colors={PALETTE.slice(0, 6)} active={edit.color} onChange={c => onUpdate({ color: c } as any)} />
                            <Divider />
                            <StrokeWidthRow width={edit.stroke_width} onChange={w => onUpdate({ stroke_width: w } as any)} />
                        </FloatingToolbar>
                    </>
                )}
            </div>
        );
    }

    if (edit.type === "circle") {
        const left = `${xPct(edit.x - edit.radius)}%`;
        const top = `${yPctFromTop(edit.y + edit.radius)}%`;
        const size = `${xPct(edit.radius * 2)}%`;
        const ringClass = isSelected ? "ring-2 ring-blue-400" : "";
        const filled = edit.fill_color && edit.fill_color !== "";
        return (
            <div className={cn("absolute", ringClass)} style={{ left, top, width: size, height: size, zIndex: isSelected ? 20 : 5 }}>
                <div
                    data-edit-body="1" data-edit-id={edit.id}
                    onClick={e => { e.stopPropagation(); onSelect(); }}
                    className="absolute inset-0 rounded-full cursor-pointer"
                    style={{
                        backgroundColor: filled ? edit.fill_color : "transparent",
                        border: `${edit.stroke_width * scale}px solid ${edit.stroke_color}`,
                    }}
                />
                {isSelected && (
                    <>
                        <ResizeGripsForBox editId={edit.id} />
                        <FloatingToolbar onDuplicate={onDuplicate} onDelete={onDelete}>
                            <ColorRow label="Stroke" colors={PALETTE.slice(0, 6)} active={edit.stroke_color} onChange={c => onUpdate({ stroke_color: c } as any)} />
                            <Divider />
                            <StrokeWidthRow width={edit.stroke_width} onChange={w => onUpdate({ stroke_width: w } as any)} />
                            <Divider />
                            <FillToggle filled={!!filled} onToggle={v => onUpdate({ fill_color: v ? edit.stroke_color : "" } as any)} />
                        </FloatingToolbar>
                    </>
                )}
            </div>
        );
    }

    if (edit.type === "image") {
        const left = `${xPct(edit.x)}%`;
        const top = `${yPctFromTop(edit.y + edit.height)}%`;
        const w = `${xPct(edit.width)}%`;
        const h = `${(edit.height / pageSize.h) * 100}%`;
        const ringClass = isSelected ? "ring-2 ring-blue-400" : "";
        return (
            <div className={cn("absolute", ringClass)} style={{ left, top, width: w, height: h, zIndex: isSelected ? 20 : 5 }}>
                <img
                    src={edit.image_data}
                    alt=""
                    data-edit-body="1" data-edit-id={edit.id}
                    onClick={e => { e.stopPropagation(); onSelect(); }}
                    className="block w-full h-full cursor-pointer object-contain"
                    draggable={false}
                />
                {isSelected && (
                    <>
                        <ResizeGripsForBox editId={edit.id} />
                        <FloatingToolbar onDuplicate={onDuplicate} onDelete={onDelete}>
                            <span className="text-[11px] text-gray-500 px-2">Image · drag handles to resize</span>
                        </FloatingToolbar>
                    </>
                )}
            </div>
        );
    }

    // Rectangle / Whiteout / Highlight all share a box geometry.
    const re = edit;
    const left = `${xPct(re.x)}%`;
    const bottom = `${yPctFromTop(re.y)}%`;
    const top = `${yPctFromTop(re.y + re.height)}%`;
    const w = `${xPct(re.width)}%`;
    const h = `${(re.height / pageSize.h) * 100}%`;
    const isHighlight = re.type === "highlight";
    const isWhiteout = re.type === "rectangle" && re.fill_color === "#ffffff";
    const ringClass = isSelected ? "ring-2 ring-blue-400" : "";
    return (
        <div className={cn("absolute", ringClass)} style={{ left, top, width: w, height: h, zIndex: isSelected ? 20 : 5 }}>
            <div
                data-edit-body="1" data-edit-id={re.id}
                onClick={e => { e.stopPropagation(); onSelect(); }}
                className="absolute inset-0 cursor-pointer"
                style={{
                    backgroundColor: isHighlight ? re.color : (re.type === "rectangle" && re.fill_color ? re.fill_color : "transparent"),
                    opacity: isHighlight ? re.opacity : 1,
                    border: (!isHighlight && !isWhiteout && re.type === "rectangle") ? `${re.stroke_width * scale}px solid ${re.stroke_color}` : "none",
                }}
            />
            {isSelected && (
                <>
                    <ResizeGripsForBox editId={re.id} />
                    <FloatingToolbar onDuplicate={onDuplicate} onDelete={onDelete}>
                        {isHighlight && <ColorRow colors={PALETTE.slice(0, 6)} active={re.color} onChange={c => onUpdate({ color: c } as any)} />}
                        {isHighlight && <Divider />}
                        {isHighlight && <OpacitySlider value={re.opacity} onChange={v => onUpdate({ opacity: v } as any)} />}
                        {!isHighlight && !isWhiteout && (
                            <>
                                <ColorRow label="Stroke" colors={PALETTE.slice(0, 6)} active={re.stroke_color} onChange={c => onUpdate({ stroke_color: c } as any)} />
                                <Divider />
                                <StrokeWidthRow width={re.stroke_width} onChange={w => onUpdate({ stroke_width: w } as any)} />
                                <Divider />
                                <FillToggle filled={!!(re.fill_color)} onToggle={v => onUpdate({ fill_color: v ? re.stroke_color : "" } as any)} />
                            </>
                        )}
                        {isWhiteout && <span className="text-[11px] text-gray-500 px-2">Whiteout · drag handles to resize</span>}
                    </FloatingToolbar>
                </>
            )}
        </div>
    );
}

/* ────────────── Resize Grips ────────────── */
function ResizeGripsForBox({ editId }: { editId: string }) {
    const HANDLES: { h: ResizeHandle; style: React.CSSProperties }[] = [
        { h: "nw", style: { left: 0, top: 0, cursor: "nwse-resize" } },
        { h: "n",  style: { left: "50%", top: 0, cursor: "ns-resize" } },
        { h: "ne", style: { left: "100%", top: 0, cursor: "nesw-resize" } },
        { h: "e",  style: { left: "100%", top: "50%", cursor: "ew-resize" } },
        { h: "se", style: { left: "100%", top: "100%", cursor: "nwse-resize" } },
        { h: "s",  style: { left: "50%", top: "100%", cursor: "ns-resize" } },
        { h: "sw", style: { left: 0, top: "100%", cursor: "nesw-resize" } },
        { h: "w",  style: { left: 0, top: "50%", cursor: "ew-resize" } },
    ];
    return (
        <>
            {HANDLES.map(g => (
                <div key={g.h}
                    data-resize-handle={g.h}
                    data-edit-id={editId}
                    className="edit-pdf-resize-handle absolute w-2.5 h-2.5 rounded-sm bg-white border-2 border-blue-500"
                    style={{ ...g.style, transform: "translate(-50%, -50%)", zIndex: 30 }}
                />
            ))}
        </>
    );
}

function LineEndpointHandle({ editId, which, left, top }: { editId: string; which: "p1" | "p2"; left: string; top: string; }) {
    return (
        <div
            data-resize-handle={which}
            data-edit-id={editId}
            className="edit-pdf-resize-handle absolute w-3 h-3 rounded-full bg-white border-2 border-blue-500"
            style={{ left, top, transform: "translate(-50%, -50%)", zIndex: 30, cursor: "move" }}
        />
    );
}

/* ────────────── Floating prop toolbars ────────────── */
function FloatingToolbar({ children, onDuplicate, onDelete }: { children: React.ReactNode; onDuplicate: () => void; onDelete: () => void; }) {
    return (
        <div className="absolute -top-11 left-1/2 -translate-x-1/2 flex items-center gap-0.5 rounded-xl border border-gray-200 bg-white shadow-xl px-1.5 py-1 z-40 whitespace-nowrap"
            onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
            {children}
            <Divider />
            <button onClick={onDuplicate} title="Duplicate (⌘D)" className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-600"><Copy size={12} /></button>
            <button onClick={onDelete} title="Delete (⌫)" className="w-7 h-7 flex items-center justify-center rounded text-gray-400 hover:bg-red-50 hover:text-red-500"><Trash2 size={12} /></button>
        </div>
    );
}

function Divider() {
    return <div className="w-px h-5 bg-gray-200" />;
}

function ColorRow({ colors, active, onChange, label }: { colors: string[]; active: string; onChange: (c: string) => void; label?: string }) {
    return (
        <div className="flex items-center gap-1 px-1">
            {label && <span className="text-[10px] text-gray-500 mr-0.5">{label}</span>}
            {colors.map(c => (
                <button key={c} onClick={() => onChange(c)}
                    aria-label={`Color ${c}`}
                    className={cn("w-5 h-5 rounded-full border-2 transition-all", active === c ? "border-blue-500 scale-110" : "border-gray-200 hover:scale-110")}
                    style={{ backgroundColor: c }} />
            ))}
        </div>
    );
}

function StrokeWidthRow({ width, onChange }: { width: number; onChange: (w: number) => void }) {
    return (
        <select value={width} onChange={e => onChange(+e.target.value)}
            className="h-7 rounded bg-transparent text-[11px] text-gray-700 focus:ring-0 cursor-pointer hover:bg-gray-50 px-1">
            {[1, 2, 3, 4, 6, 8, 12].map(w => <option key={w} value={w}>{w}px</option>)}
        </select>
    );
}

function FillToggle({ filled, onToggle }: { filled: boolean; onToggle: (v: boolean) => void }) {
    return (
        <button onClick={() => onToggle(!filled)}
            className={cn("text-[11px] font-medium px-2 h-7 rounded transition-all", filled ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-100")}>
            {filled ? "Filled" : "Outline"}
        </button>
    );
}

function OpacitySlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
    return (
        <div className="flex items-center gap-1.5 px-1">
            <span className="text-[10px] text-gray-500">{Math.round(value * 100)}%</span>
            <input type="range" min={0.1} max={1} step={0.05} value={value} onChange={e => onChange(+e.target.value)} className="w-16 accent-blue-500" />
        </div>
    );
}

/* ────────────── Page thumbnails sidebar ────────────── */
function PageThumbs({ pdfDoc, totalPages, currentPage, onJump, edits }: { pdfDoc: any; totalPages: number; currentPage: number; onJump: (p: number) => void; edits: Edit[] }) {
    return (
        <div className="w-[120px] shrink-0 overflow-y-auto p-2 space-y-2" style={{ background: "hsl(224 18% 9%)", borderRight: "1px solid hsl(224 15% 16%)" }}>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                <Thumb key={p} pdfDoc={pdfDoc} pageNum={p} active={p === currentPage} editCount={edits.filter(e => e.page === p).length} onClick={() => onJump(p)} />
            ))}
        </div>
    );
}

function Thumb({ pdfDoc, pageNum, active, editCount, onClick }: { pdfDoc: any; pageNum: number; active: boolean; editCount: number; onClick: () => void }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        if (!pdfDoc || !canvasRef.current) return;
        let cancelled = false;
        (async () => {
            try {
                const page = await pdfDoc.getPage(pageNum);
                const vp = page.getViewport({ scale: 0.2 });
                if (cancelled) return;
                const cv = canvasRef.current!;
                cv.width = vp.width;
                cv.height = vp.height;
                await page.render({ canvasContext: cv.getContext("2d")!, viewport: vp }).promise;
            } catch { /* page changed, ignore */ }
        })();
        return () => { cancelled = true; };
    }, [pdfDoc, pageNum]);
    return (
        <button onClick={onClick}
            className={cn("relative block w-full rounded overflow-hidden border-2 transition-all",
                active ? "border-blue-500 shadow-lg" : "border-transparent hover:border-white/20")}>
            <canvas ref={canvasRef} className="block w-full" />
            <div className="flex items-center justify-between px-1.5 py-1 text-[10px] font-medium" style={{ background: active ? "hsl(216 90% 60%)" : "hsl(224 15% 14%)", color: active ? "white" : "rgba(255,255,255,0.5)" }}>
                <span>{pageNum}</span>
                {editCount > 0 && <span className="rounded-full bg-blue-500 text-white text-[9px] w-4 h-4 flex items-center justify-center">{editCount}</span>}
            </div>
        </button>
    );
}

function CornerMarks() {
    const cls = "corner-mark absolute h-3 w-3 pointer-events-none";
    return (
        <>
            <span className={`${cls} -top-1 -left-1`}><span className="absolute top-0 left-0 h-px w-3 bg-accent/70" /><span className="absolute top-0 left-0 w-px h-3 bg-accent/70" /></span>
            <span className={`${cls} -top-1 -right-1`}><span className="absolute top-0 right-0 h-px w-3 bg-accent/70" /><span className="absolute top-0 right-0 w-px h-3 bg-accent/70" /></span>
            <span className={`${cls} -bottom-1 -left-1`}><span className="absolute bottom-0 left-0 h-px w-3 bg-accent/70" /><span className="absolute bottom-0 left-0 w-px h-3 bg-accent/70" /></span>
            <span className={`${cls} -bottom-1 -right-1`}><span className="absolute bottom-0 right-0 h-px w-3 bg-accent/70" /><span className="absolute bottom-0 right-0 w-px h-3 bg-accent/70" /></span>
        </>
    );
}

/* ════════════ Floating text toolbar (legacy from original — used for TextEdit) ════════════ */
function TextToolbar({ edit, onUpdate, onDuplicate, onDelete }: {
    edit: TextEdit; onUpdate: (field: string, value: any) => void; onDuplicate: () => void; onDelete: () => void;
}) {
    return (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 flex items-center gap-0.5 rounded-xl border border-gray-200 bg-white shadow-xl px-1.5 py-1 z-30 whitespace-nowrap"
            onClick={e => e.stopPropagation()} onPointerDown={e => e.stopPropagation()}>
            <button onClick={() => {
                const base = edit.font_family.replace("-Bold", "");
                onUpdate("font_family", edit.font_family.includes("Bold") ? base : `${base}-Bold`);
            }} className={cn("w-8 h-8 flex items-center justify-center rounded-lg text-sm font-bold transition-all",
                edit.font_family.includes("Bold") ? "bg-blue-100 text-blue-700" : "text-gray-500 hover:bg-gray-100")}>B</button>
            <Divider />
            <select value={edit.font_size} onChange={e => onUpdate("font_size", +e.target.value)}
                className="h-8 rounded-lg border-0 bg-transparent text-sm text-gray-700 focus:ring-0 px-1.5 cursor-pointer font-medium hover:bg-gray-50">
                {[8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64].map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <Divider />
            <select value={edit.font_family} onChange={e => onUpdate("font_family", e.target.value)}
                className="h-8 rounded-lg border-0 bg-transparent text-sm text-gray-700 focus:ring-0 cursor-pointer max-w-[100px] hover:bg-gray-50">
                {FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
            <Divider />
            <div className="flex items-center gap-1 px-1">
                {PALETTE.slice(0, 6).map(c => (
                    <button key={c} onClick={() => onUpdate("color", c)}
                        className={cn("w-6 h-6 rounded-full border-2 transition-all",
                            edit.color === c ? "border-blue-500 scale-110 ring-2 ring-blue-200" : "border-gray-200 hover:scale-110")}
                        style={{ backgroundColor: c }} />
                ))}
                <input type="color" value={edit.color} onChange={e => onUpdate("color", e.target.value)}
                    className="w-6 h-6 rounded-full border-2 border-gray-200 cursor-pointer" />
            </div>
            <Divider />
            <button onClick={onDuplicate} title="Duplicate (⌘D)" className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-all"><Copy size={14} /></button>
            <button onClick={onDelete} title="Delete (⌫)" className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-400 hover:bg-red-50 hover:text-red-500 transition-all"><Trash2 size={14} /></button>
        </div>
    );
}
