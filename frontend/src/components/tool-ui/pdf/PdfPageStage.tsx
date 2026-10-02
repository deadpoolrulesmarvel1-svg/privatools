import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Hand, MousePointer2 } from "lucide-react";
import { openMergePreview, type MergePreviewDocument } from "../merge-preview";
import { pageFrame, shownRotation, shownToUnrotated, unrotatedToShown, type Box, type PageFrame } from "./page-coordinates";
import "./pdf-workspace.css";

export interface PdfRegion { id: string; page: number; x: number; y: number; width: number; height: number; color?: string; fill?: string; stroke_width?: number; label?: string; kind?: string; image?: string; }
export interface PdfPageDimensions { width: number; height: number; pages: number; }
/**
 * What the numbers in `regions` and `onDraw` measure, which must be what the
 * tool's route measures (src/test/page-contract.json, `frame`):
 * - "unrotated": points from the top-left corner of the page's visible area
 *   before its /Rotate, as the PyMuPDF routes take them. The stage converts
 *   to and from the page as shown, with pdf.js's own viewports.
 * - "shown-from-bottom": points from the bottom-left corner of the page as
 *   shown, as Sign PDF's route takes them.
 * - "shown": points from the top-left corner of the page as shown.
 */
export type PdfCoordinates = "unrotated" | "shown" | "shown-from-bottom";
const isLine = (kind?: string) => kind === "line" || kind === "arrow";
export function PdfPageStage({ file, page, onPageChange, regions = [], selectedId, onSelect, onDraw, drawLabel = "Draw a region", disabled = false, onDimensions, coordinates = "unrotated", overlay }: {
    overlay?: (dimensions: { width: number; height: number }) => ReactNode;
    file: File; page?: number; onPageChange?: (page: number) => void; regions?: PdfRegion[];
    selectedId?: string; onSelect?: (id: string) => void; onDraw?: (region: Omit<PdfRegion, "id">) => void;
    drawLabel?: string; disabled?: boolean; coordinates?: PdfCoordinates; onDimensions?: (info: PdfPageDimensions) => void;
}) {
    const [document, setDocument] = useState<MergePreviewDocument | null>(null);
    const [localPage, setLocalPage] = useState(1);
    const [dimensions, setDimensions] = useState({ width: 612, height: 792 });
    // The shown page's pdf.js viewports, and which page they belong to.
    const [frame, setFrame] = useState<{ page: number; frame: PageFrame } | null>(null);
    const [error, setError] = useState("");
    const [rendering, setRendering] = useState(true);
    const [drawing, setDrawing] = useState(false);
    const [draft, setDraft] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
    const start = useRef<{ x: number; y: number } | null>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const dimensionCallback = useRef(onDimensions); dimensionCallback.current = onDimensions;
    const activePage = Math.max(1, Math.min(page ?? localPage, document?.numPages || 1));
    const changePage = (next: number) => { setLocalPage(next); onPageChange?.(next); setDraft(null); };
    useEffect(() => {
        let cancelled = false;
        let loaded: MergePreviewDocument | undefined;
        setDocument(null); setLocalPage(1); setError(""); setRendering(true); setFrame(null);
        openMergePreview(file).then(doc => {
            loaded = doc;
            if (cancelled) { void doc.destroy(); return; }
            setDocument(doc);
        }).catch(cause => { if (!cancelled) { setError(cause instanceof Error ? cause.message : "This PDF could not be previewed."); setRendering(false); } });
        return () => { cancelled = true; if (loaded) void loaded.destroy(); };
    }, [file]);
    useEffect(() => {
        if (!document || !canvas.current) return;
        let cancelled = false;
        let task: { cancel: () => void } | undefined;
        setRendering(true);
        document.getPage(activePage).then(async pdfPage => {
            if (cancelled || !canvas.current) return;
            const pageFrameValue = pageFrame(pdfPage);
            const size = { width: pageFrameValue.shown.width, height: pageFrameValue.shown.height };
            setDimensions(size); setFrame({ page: activePage, frame: pageFrameValue });
            dimensionCallback.current?.({ ...size, pages: document.numPages });
            const viewport = pdfPage.getViewport({ scale: Math.min(1.5, 900 / size.width) });
            const target = canvas.current;
            target.width = viewport.width; target.height = viewport.height;
            const render = pdfPage.render({ canvas: target, canvasContext: target.getContext("2d")!, viewport });
            task = render;
            await render.promise;
            if (!cancelled) setRendering(false);
        }).catch(cause => { if (!cancelled) { setError(cause instanceof Error ? cause.message : "The page could not be rendered."); setRendering(false); } });
        return () => { cancelled = true; task?.cancel(); };
    }, [document, activePage]);
    // The shown page's frame, once pdf.js has opened it; null while it loads.
    const current = frame && frame.page === activePage ? frame.frame : null;
    /** A region in the tool's numbers, where it sits on the page as shown. */
    const toShown = (region: PdfRegion): PdfRegion | null => {
        if (coordinates === "shown") return region;
        if (coordinates === "shown-from-bottom") return { ...region, y: dimensions.height - region.y - region.height };
        return current ? { ...region, ...unrotatedToShown(current, region, { line: isLine(region.kind) }) } : null;
    };
    /** A box drawn on the page as shown, in the tool's numbers. */
    const fromShown = (box: Box): Box | null => {
        if (coordinates === "shown") return box;
        if (coordinates === "shown-from-bottom") return { ...box, y: dimensions.height - box.y - box.height };
        return current ? shownToUnrotated(current, box) : null;
    };
    const point = (event: PointerEvent<SVGSVGElement>) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        return { x: Math.max(0, Math.min(dimensions.width, (event.clientX - bounds.left) / bounds.width * dimensions.width)), y: Math.max(0, Math.min(dimensions.height, (event.clientY - bounds.top) / bounds.height * dimensions.height)) };
    };
    const finish = (event: PointerEvent<SVGSVGElement>) => {
        if (!start.current) return;
        const end = point(event), origin = start.current;
        start.current = null; setDraft(null);
        const box = { x: Math.min(origin.x, end.x), y: Math.min(origin.y, end.y), width: Math.abs(end.x - origin.x), height: Math.abs(end.y - origin.y) };
        const placed = box.width >= 2 && box.height >= 2 && !disabled ? fromShown(box) : null;
        if (placed) { onDraw?.({ ...placed, page: activePage }); setDrawing(false); }
    };
    const shownRegions = regions.filter(region => region.page === activePage).map(toShown).filter((region): region is PdfRegion => region !== null);
    // Typed X, Y, W and H are the route's numbers: on a turned page, say which way they run.
    const rotation = current ? shownRotation(current) : 0;
    const turnedNote = current && rotation && coordinates === "unrotated"
        ? ` · Turned ${rotation}°: X, Y, W and H measure the page unturned, ${Math.round(current.unrotated.width)} × ${Math.round(current.unrotated.height)} pt`
        : "";
    const visiblePages = document ? Array.from({ length: Math.min(7, document.numPages) }, (_, index) => Math.max(1, Math.min(activePage - 3, document.numPages - 6)) + index) : [];
    return <section className="pdf-stage" aria-label="Your PDF preview">
        <div className="pdf-stage-toolbar"><div className="pdf-page-navigation"><button type="button" aria-label="Previous PDF page" onClick={() => changePage(activePage - 1)} disabled={!document || activePage <= 1}><ChevronLeft size={17} /></button><label>Page <select aria-label="Preview page" value={activePage} disabled={!document} onChange={event => changePage(Number(event.target.value))}>{Array.from({ length: document?.numPages || 1 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}</select> of {document?.numPages || "…"}</label><button type="button" aria-label="Next PDF page" onClick={() => changePage(activePage + 1)} disabled={!document || activePage >= document.numPages}><ChevronRight size={17} /></button></div>{onDraw && <button type="button" className="pdf-draw-mode" aria-pressed={drawing} onClick={() => setDrawing(value => !value)} disabled={disabled || !document || !current}><MousePointer2 size={15} />{drawing ? "Drawing enabled" : drawLabel}</button>}</div>
        {error ? <div className="pdf-preview-error" role="alert"><strong>Preview unavailable</strong><p>{error}</p><p>Your source file is still selected. Unlock an encrypted PDF before editing it.</p></div> : <div className="pdf-stage-paper-area"><div className="pdf-stage-paper" style={{ aspectRatio: `${dimensions.width}/${dimensions.height}` }}>
            <canvas ref={canvas} aria-label={`Original PDF page ${activePage}`} />
            {rendering && <div className="pdf-preview-loading" role="status">Opening your page…</div>}
            <svg viewBox={`0 0 ${dimensions.width} ${dimensions.height}`} className="pdf-region-layer" aria-label="Placed regions" data-drawing={drawing}
                onPointerDown={event => { if (!drawing || disabled || !onDraw) return; event.preventDefault(); start.current = point(event); event.currentTarget.setPointerCapture(event.pointerId); }}
                onPointerMove={event => { if (!start.current) return; const end = point(event); setDraft({ x: Math.min(start.current.x, end.x), y: Math.min(start.current.y, end.y), width: Math.abs(end.x - start.current.x), height: Math.abs(end.y - start.current.y) }); }}
                onPointerUp={finish} onPointerCancel={() => { start.current = null; setDraft(null); }}>
                {shownRegions.map(region => <g key={region.id} tabIndex={onSelect ? 0 : undefined} role={onSelect ? "button" : "img"} aria-label={region.label || `Select region ${region.id}`} onClick={() => { if (!drawing) onSelect?.(region.id); }} onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect?.(region.id); } }}>
                    {region.image ? <image href={region.image} x={region.x} y={region.y} width={region.width} height={region.height} /> : region.kind === "circle" ? <ellipse cx={region.x + region.width / 2} cy={region.y + region.height / 2} rx={region.width / 2} ry={region.height / 2} fill="none" stroke={region.color || "#a32950"} strokeWidth={region.stroke_width || 2} /> : region.kind === "line" || region.kind === "arrow" ? <line x1={region.x} y1={region.y} x2={region.x + region.width} y2={region.y + region.height} stroke={region.color || "#a32950"} strokeWidth={region.stroke_width || 2} markerEnd={region.kind === "arrow" ? `url(#pdf-arrow-${region.id})` : undefined} /> : region.kind === "underline" || region.kind === "strikethrough" ? <line x1={region.x} x2={region.x + region.width} y1={region.y + region.height * (region.kind === "underline" ? .9 : .5)} y2={region.y + region.height * (region.kind === "underline" ? .9 : .5)} stroke={region.color || "#a32950"} strokeWidth={2} /> : <rect x={region.x} y={region.y} width={region.width} height={region.height} fill={region.kind === "rectangle" ? region.fill || "none" : region.color || "#a32950"} fillOpacity={region.kind === "rectangle" || region.kind === "whiteout" || region.kind === "redact" ? .95 : .25} stroke={region.color || "#a32950"} strokeWidth={selectedId === region.id ? 2 : 1} />}
                    {region.kind === "arrow" && <defs><marker id={`pdf-arrow-${region.id}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={region.color || "#a32950"} /></marker></defs>}
                    {selectedId === region.id && <rect x={Math.min(region.x, region.x + region.width)} y={Math.min(region.y, region.y + region.height)} width={Math.abs(region.width)} height={Math.abs(region.height)} fill="none" stroke="#397dec" strokeWidth={2} strokeDasharray="5 3" />}
                </g>)}
                {overlay?.(dimensions)}
                {draft && <rect {...draft} fill="#397dec" fillOpacity={.2} stroke="#397dec" strokeWidth={1.5} strokeDasharray="5 3" />}
            </svg>
        </div></div>}
        {document && document.numPages > 1 && <div className="pdf-page-filmstrip" aria-label="Document pages">{visiblePages.map(number => <PdfPageThumbnail key={number} document={document} page={number} active={number === activePage} onClick={() => changePage(number)} />)}</div>}
        <p className="pdf-stage-caption"><Hand size={14} />{drawing ? "Drag across the page to place a region. Exact coordinates remain editable." : `${Math.round(dimensions.width)} × ${Math.round(dimensions.height)} pt · Previewed on this device${turnedNote}`}</p>
    </section>;
}
function PdfPageThumbnail({ document, page, active, onClick }: { document: MergePreviewDocument; page: number; active: boolean; onClick: () => void }) {
    const canvas = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        let cancelled = false; let task: { cancel: () => void } | undefined;
        document.getPage(page).then(async pdfPage => {
            if (cancelled || !canvas.current) return;
            const native = pdfPage.getViewport({ scale: 1 }), viewport = pdfPage.getViewport({ scale: 70 / native.width });
            canvas.current.width = viewport.width; canvas.current.height = viewport.height;
            const render = pdfPage.render({ canvas: canvas.current, canvasContext: canvas.current.getContext("2d")!, viewport }); task = render; await render.promise;
        }).catch(() => {});
        return () => { cancelled = true; task?.cancel(); };
    }, [document, page]);
    return <button type="button" className="pdf-page-thumb" onClick={onClick} aria-label={`Go to PDF page ${page}`} aria-current={active ? "page" : undefined}><canvas ref={canvas} /><span>{page}</span></button>;
}
