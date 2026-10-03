/**
 * Cost from prices the visitor enters. There is no price table here on
 * purpose: providers change prices, and a stale built-in table would quietly
 * turn into a false claim.
 */

/** A price or count as typed: a finite, non-negative number, or null. */
export function parseAmount(value: string): number | null {
    const text = value.trim();
    if (!text || !/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(text)) return null;
    const number = Number(text);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

/** What `tokens` cost at `pricePerMillion` for each million tokens. */
export function costFor(tokens: number, pricePerMillion: number): number {
    return (tokens * pricePerMillion) / 1_000_000;
}

const dollars = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 4 });
const fractions = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumSignificantDigits: 3 });

/** US dollars, keeping small amounts visible: $0.00247 rather than $0.00. */
export function formatCost(value: number): string {
    if (value === 0) return dollars.format(0);
    if (value >= 1) return dollars.format(value);
    if (value >= 0.01) return cents.format(value);
    return fractions.format(value);
}
