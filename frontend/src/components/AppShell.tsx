import { SkinAppHost } from "@/skins/SkinAppHost";

/**
 * AppShell — hands the screen to Daylight.
 *
 * The children are the app's React Router routes. Daylight owns the whole
 * surface and does its own routing (hash, bridged from real paths by
 * withPathRoutes), so the routes are never rendered — they remain declared in
 * App.tsx as the canonical list of site paths, which pathRoutes.test.ts checks
 * the bridge against.
 */
export function AppShell(_props: { children: React.ReactNode }) {
    return <SkinAppHost />;
}
