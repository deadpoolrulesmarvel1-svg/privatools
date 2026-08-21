/**
 * Context providers every part of the app can rely on.
 *
 * Exists because Radix `Tooltip` throws at render time without a
 * `TooltipProvider` above it, and there was none anywhere in the tree. Any tool
 * that rendered a tooltip therefore crashed straight into the ErrorBoundary —
 * CompressUI and BatesUI both did, the moment a file was added.
 *
 * Keep this component tiny and free of app logic: it wraps the whole tree, so
 * anything expensive here is paid on first paint by every route.
 */
import { TooltipProvider } from "@/components/ui/tooltip";

export function AppProviders({ children }: { children: React.ReactNode }) {
  // delayDuration 200ms: fast enough to feel responsive on the compression
  // preset labels, slow enough not to flash while the pointer crosses them.
  return <TooltipProvider delayDuration={200}>{children}</TooltipProvider>;
}
