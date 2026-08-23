/**
 * Adds a nav item to a design's rail without duplicating one it already has.
 *
 * Carbon ships its own "Vault" entry pointing at its simulated vault. The real
 * vault replaces that surface, so appending a second item left the rail showing
 * Vault twice. Matching on the visible label and replacing in place keeps the
 * item where the design put it, which is also where a reader expects it.
 */
type NavItem = Record<string, unknown>;

const labelOf = (item: NavItem): string =>
    String(item.label ?? item.name ?? "").trim().toLowerCase();

export function mergeNavItem(list: NavItem[], item: NavItem): NavItem[] {
    const key = labelOf(item);
    const at = list.findIndex((existing) => labelOf(existing) === key);
    if (at === -1) return [...list, item];
    const next = list.slice();
    next[at] = item;
    return next;
}
