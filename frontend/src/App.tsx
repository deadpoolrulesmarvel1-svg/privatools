import { Suspense, lazy, useEffect, useState } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { DynamicHead } from "./components/DynamicHead";
import { OnboardingTour } from "./components/OnboardingTour";
import { BackendStatusBanner } from "./components/BackendStatusBanner";
import { BatchResumeBanner } from "./components/BatchResumeBanner";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { AppShell } from "./components/AppShell";
import { FirstSuccessListener } from "./components/FirstSuccessListener";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useGlobalErrorHandler } from "./hooks/useGlobalErrorHandler";
import {
  prefetchRoute,
  loadToolPage,
  loadCompressUI,
  loadMergeUI,
  loadSplitUI,
  loadCommandPalette,
} from "./lib/prefetch";

// @tanstack/react-query is in package.json but no component in the app uses
// useQuery / useMutation. The QueryClientProvider wrapper here used to be
// scaffolding from the project template. Removing the provider drops the
// 25 KB / 7.8 KB gz vendor-query chunk from every first-paint without
// changing behavior. If you later add server-state caching, re-add the
// provider locally inside the route that needs it (don't promote it back
// to the App root unless many components share queries).

const Index = lazy(() => import("./pages/Index"));
const ToolPage = lazy(() => import("./pages/ToolPage"));
const NonPdfToolPage = lazy(() => import("./pages/NonPdfToolPage"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const AboutPage = lazy(() => import("./pages/AboutPage"));
const ComparePage = lazy(() => import("./pages/ComparePage"));
const NotFound = lazy(() => import("./pages/NotFound"));
const BatchPage = lazy(() => import("./pages/BatchPage"));
const PipelinePage = lazy(() => import("./pages/PipelinePage"));
const BlogPage = lazy(() => import("./pages/BlogPage"));
const BlogPostPage = lazy(() => import("./pages/BlogPostPage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const SecurityPage = lazy(() => import("./pages/SecurityPage"));
const CommandPalette = lazy(loadCommandPalette);

const RouteLoader = () => (
  <div className="min-h-[40vh] animate-pulse px-4 py-10 sm:px-6">
    <div className="mx-auto max-w-7xl space-y-4">
      <div className="h-6 w-52 rounded-md bg-secondary/70" />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl border border-border bg-card/70" />
        ))}
      </div>
    </div>
  </div>
);

const withRouteFallback = (element: JSX.Element) => (
  <Suspense fallback={<RouteLoader />}>{element}</Suspense>
);

/**
 * Warm the next-likely route chunks once the user lands on the home page.
 * Top-3 by traffic: Compress, Merge, Split. Runs only on `/` and only when
 * the browser is idle so it doesn't compete with first-paint resources.
 *
 * The actual `import()` calls are deduped inside prefetch.ts (WeakSet), so
 * subsequent hover/focus events on these tools resolve from the chunk
 * cache instead of issuing a new request.
 */
function RoutePrefetcher() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (pathname !== "/") return;
    const idle: typeof window.requestIdleCallback | undefined =
      typeof window !== "undefined" ? window.requestIdleCallback : undefined;
    const run = () => {
      // ToolPage shell first — needed before any /tool/* chunk renders.
      prefetchRoute(loadToolPage);
      prefetchRoute(loadCompressUI);
      prefetchRoute(loadMergeUI);
      prefetchRoute(loadSplitUI);
    };
    if (idle) {
      const id = idle(run, { timeout: 3000 });
      return () => window.cancelIdleCallback?.(id);
    }
    // Browsers without rIC — fire after a short delay.
    const t = window.setTimeout(run, 1500);
    return () => window.clearTimeout(t);
  }, [pathname]);

  return null;
}

function CommandPaletteGate() {
  const [shouldMount, setShouldMount] = useState(false);

  useEffect(() => {
    if (shouldMount) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setShouldMount(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [shouldMount]);

  if (!shouldMount) return null;
  return (
    <Suspense fallback={null}>
      <CommandPalette defaultOpen />
    </Suspense>
  );
}

/** Wire global JS error handler into the root once. Lives inside the
 *  router so it can use hooks, but renders nothing. */
function GlobalErrorWire() {
  useGlobalErrorHandler();
  return null;
}

const App = () => (
  <ErrorBoundary scope="app">
    <Sonner />
    <BrowserRouter>
      <GlobalErrorWire />
      <DynamicHead />
      <CommandPaletteGate />
      <ShortcutsHelp />
      <OnboardingTour />
      <FirstSuccessListener />
      <RoutePrefetcher />
      <AppShell>
        <BackendStatusBanner />
        <BatchResumeBanner />
        <Routes>
          <Route path="/" element={withRouteFallback(<Index />)} />
          <Route path="/about" element={withRouteFallback(<AboutPage />)} />
          <Route path="/compare" element={withRouteFallback(<ComparePage />)} />
          <Route path="/compare/:competitor" element={withRouteFallback(<ComparePage />)} />
          <Route path="/tool/:slug" element={withRouteFallback(<ToolPage />)} />
          <Route path="/tools/:slug" element={withRouteFallback(<NonPdfToolPage />)} />
          <Route path="/batch" element={withRouteFallback(<BatchPage />)} />
          <Route path="/pipeline" element={withRouteFallback(<PipelinePage />)} />
          <Route path="/blog" element={withRouteFallback(<BlogPage />)} />
          <Route path="/blog/:slug" element={withRouteFallback(<BlogPostPage />)} />
          <Route path="/privacy" element={withRouteFallback(<PrivacyPage />)} />
          <Route path="/security" element={withRouteFallback(<SecurityPage />)} />
          <Route path="/terms" element={withRouteFallback(<TermsPage />)} />
          <Route path="*" element={withRouteFallback(<NotFound />)} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  </ErrorBoundary>
);

export default App;
