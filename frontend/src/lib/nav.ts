/**
 * Top-level navigation, kept out of SiteHeader so that file only exports a
 * component (React Fast Refresh needs that to hot-reload it).
 */
export interface NavItem {
    label: string;
    href: string;
    /** Decides the active tab, including query-string category views. */
    match: (pathname: string, search: string) => boolean;
}

const startsWith = (p: string) => (pathname: string) => pathname === p || pathname.startsWith(p + "/");

export const CATEGORY_NAV: NavItem[] = [
    { label: "All tools", href: "/", match: (p, s) => p === "/" && !s.includes("tab=") },
    { label: "PDF", href: "/?tab=pdf", match: (p, s) => p === "/" && s.includes("tab=pdf") },
    { label: "Image", href: "/?tab=image", match: (p, s) => p === "/" && s.includes("tab=image") },
    { label: "Video & audio", href: "/?tab=video-audio", match: (p, s) => p === "/" && s.includes("tab=video-audio") },
    { label: "Developer", href: "/?tab=developer", match: (p, s) => p === "/" && s.includes("tab=developer") },
    { label: "Pipeline", href: "/pipeline", match: startsWith("/pipeline") },
    { label: "Batch", href: "/batch", match: startsWith("/batch") },
    { label: "Compare", href: "/compare", match: startsWith("/compare") },
    { label: "Vault", href: "/my-stuff/vault", match: startsWith("/my-stuff/vault") },
    { label: "Account", href: "/account", match: startsWith("/account") },
];
