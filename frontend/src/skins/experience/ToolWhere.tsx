import type { MouseEvent } from "react";
import { LOCATION_ICONS, useToolLocation } from "./tool-location";

/**
 * Where the file goes, in full, as readable text in an intake (or above a
 * tool UI without one). Nothing outside a tool page. A link inside a
 * clickable drop card must not also open the file chooser, so its click stops
 * at the link.
 */
export function ToolWhere({ className = "" }: { className?: string }) {
    const where = useToolLocation();
    if (!where) return null;
    const Icon = LOCATION_ICONS[where.kind];
    return <p className={`tool-where ${className}`} data-where={where.kind}>
        <Icon size={17} strokeWidth={1.8} aria-hidden="true" />
        <span><strong>{where.label}.</strong> {where.detail} <a href="/trust" onClick={(event: MouseEvent) => event.stopPropagation()}>Read about file handling</a></span>
    </p>;
}
