/**
 * Parses a CSS declaration string into a React style object.
 *
 * The imported designs carry their pixel detail in inline `style` attributes
 * — roughly 220 KB per design. Converting each of those to a hand-written
 * style object is where fidelity gets lost, so ported markup keeps the
 * original declaration text and this turns it into what React wants.
 *
 *   style={css(`padding:var(--px) var(--py);font-size:${size}px`)}
 *
 * Custom properties (--x) are passed through untouched; React accepts them on
 * the style object as-is.
 */
export type Style = React.CSSProperties & Record<`--${string}`, string | number>;

const cache = new Map<string, Style>();

function camel(prop: string): string {
    if (prop.startsWith("--")) return prop;
    return prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

export function css(decl: string): Style {
    const hit = cache.get(decl);
    if (hit) return hit;

    const out = {} as Style;
    let depth = 0, start = 0;
    const parts: string[] = [];
    // Split on top-level semicolons only — `url(data:...;base64,...)` and
    // nested var() fallbacks both contain characters that break a naive split.
    for (let i = 0; i < decl.length; i++) {
        const ch = decl[i];
        if (ch === "(") depth++;
        else if (ch === ")") depth--;
        else if (ch === ";" && depth === 0) { parts.push(decl.slice(start, i)); start = i + 1; }
    }
    parts.push(decl.slice(start));

    for (const part of parts) {
        const colon = part.indexOf(":");
        if (colon === -1) continue;
        const prop = part.slice(0, colon).trim();
        const value = part.slice(colon + 1).trim();
        if (!prop || !value) continue;
        (out as Record<string, string>)[camel(prop)] = value;
    }

    // These strings are static per call site, so the cache is bounded by the
    // number of ported elements rather than by render count.
    cache.set(decl, out);
    return out;
}
