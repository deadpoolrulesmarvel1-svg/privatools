/**
 * ErrorBoundary — class component, no external deps.
 *
 * Catches render-time errors in its subtree and renders a calm,
 * workshop-styled fallback instead of letting the whole app white-screen.
 *
 * Two scopes are supported via the `scope` prop:
 *   - "app"  — top-level boundary in App.tsx. Wraps the entire router.
 *              If we fall back to this UI the whole app is broken, so the
 *              language reflects that.
 *   - "tool" — per-tool boundary inside ToolPage/NonPdfToolPage. A single
 *              tool crashing should NOT take down the AppShell, sidebar,
 *              header, etc. The user can still navigate elsewhere.
 *
 * Reload performs a hard reload (window.location.reload). Go home navigates
 * to `/` via window.location.assign — we deliberately avoid useNavigate
 * because (a) class components can't use hooks, and (b) hard navigation
 * resets every piece of in-memory state, which is what you want after a
 * render crash. The optional `onReset` callback lets the parent bump a
 * `key` so the boundary remounts the subtree without a full reload.
 *
 * Error details (message + componentStack) are only exposed in dev — in
 * prod we keep the surface minimal so we don't leak internals.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertCircle, RotateCcw, Home } from "lucide-react";

type Scope = "app" | "tool";

interface Props {
  children: ReactNode;
  /** Override the rendered fallback entirely. */
  fallback?: ReactNode;
  /**
   * Called when the user clicks "Try again". Use this to bump a key on
   * the boundary so its subtree remounts. If omitted, the button still
   * resets internal state but won't force a remount of the children
   * (which usually isn't enough — React keeps the prior tree by default).
   */
  onReset?: () => void;
  /** Controls the headline + body copy in the fallback. Defaults to "tool". */
  scope?: Scope;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

function CornerMarks() {
  const cls = "absolute h-3 w-3 pointer-events-none";
  return (
    <>
      <span className={`${cls} -top-1 -left-1`}>
        <span className="absolute top-0 left-0 h-px w-3 bg-accent/70" />
        <span className="absolute top-0 left-0 w-px h-3 bg-accent/70" />
      </span>
      <span className={`${cls} -top-1 -right-1`}>
        <span className="absolute top-0 right-0 h-px w-3 bg-accent/70" />
        <span className="absolute top-0 right-0 w-px h-3 bg-accent/70" />
      </span>
      <span className={`${cls} -bottom-1 -left-1`}>
        <span className="absolute bottom-0 left-0 h-px w-3 bg-accent/70" />
        <span className="absolute bottom-0 left-0 w-px h-3 bg-accent/70" />
      </span>
      <span className={`${cls} -bottom-1 -right-1`}>
        <span className="absolute bottom-0 right-0 h-px w-3 bg-accent/70" />
        <span className="absolute bottom-0 right-0 w-px h-3 bg-accent/70" />
      </span>
    </>
  );
}

function RecoveryButton({
  children,
  onClick,
  variant = "default",
}: {
  children: ReactNode;
  onClick: () => void;
  variant?: "default" | "outline";
}) {
  const className = variant === "default"
    ? "inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground ring-offset-background transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    : "inline-flex h-10 items-center justify-center gap-2 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

  return (
    <button type="button" className={className} onClick={onClick}>
      {children}
    </button>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Always log to the console — useful in dev, harmless in prod.
    // The global handler in useGlobalErrorHandler.ts won't catch these
    // (React swallows render errors before they reach window.onerror),
    // so this log is the only signal in prod.
    console.error("[ErrorBoundary]", error, info.componentStack);
    this.setState({ info });
  }

  handleReset = () => {
    this.setState({ error: null, info: null });
    this.props.onReset?.();
  };

  handleReload = () => {
    window.location.reload();
  };

  handleGoHome = () => {
    // Hard nav — also clears any lingering bad in-memory state. We do
    // NOT use react-router's useNavigate here because class components
    // can't call hooks, and the recovery story is stronger when the
    // page fully reloads on the way home.
    window.location.assign("/");
  };

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback !== undefined) return this.props.fallback;

    const scope: Scope = this.props.scope ?? "tool";
    const headline =
      scope === "app"
        ? "Something went wrong"
        : "This tool crashed";
    const body =
      scope === "app"
        ? "The app hit an unexpected error. Reloading usually fixes it. Browser-only tools keep data local; if a server-side request already started, it follows the same isolated temporary-storage cleanup path."
        : "This tool stopped responding. Try again, or pick another tool from the sidebar. Browser-only tools keep data local; server-backed tools use isolated temporary storage and discard files after the response.";

    const isDev = import.meta.env.DEV;

    return (
      <div className="min-h-[40vh] w-full flex items-center justify-center bg-paper px-4 py-10 sm:py-14">
        <div className="relative w-full max-w-xl rounded-2xl border border-border bg-card p-7 sm:p-9">
          <CornerMarks />

          <div className="flex items-start gap-4">
            <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
              <AlertCircle size={20} strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] tracking-[0.12em] uppercase text-muted-foreground mb-2">
                <span className="text-accent">§</span> {scope === "app" ? "App error" : "Tool error"}
              </p>
              <h2
                className="font-display font-bold text-foreground text-[24px] sm:text-[28px] tracking-tight leading-tight"
                style={{ fontVariationSettings: '"opsz" 144, "SOFT" 50' }}
              >
                {headline}
              </h2>
              <p className="mt-2 text-[14px] text-muted-foreground leading-relaxed">
                {body}
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-col sm:flex-row gap-2.5">
            {scope === "tool" && this.props.onReset && (
              <RecoveryButton onClick={this.handleReset}>
                <RotateCcw size={14} strokeWidth={1.75} />
                Try again
              </RecoveryButton>
            )}
            <RecoveryButton
              variant={scope === "tool" && this.props.onReset ? "outline" : "default"}
              onClick={this.handleReload}
            >
              <RotateCcw size={14} strokeWidth={1.75} />
              Reload
            </RecoveryButton>
            <RecoveryButton variant="outline" onClick={this.handleGoHome}>
              <Home size={14} strokeWidth={1.75} />
              Go home
            </RecoveryButton>
          </div>

          {isDev && (
            <details className="mt-6 rounded-lg border border-border bg-paper-2/40 p-4 text-[12px] text-muted-foreground">
              <summary className="cursor-pointer font-mono text-[11px] tracking-[0.06em] uppercase text-foreground/80">
                Developer details
              </summary>
              <div className="mt-3 space-y-3">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground mb-1">
                    Message
                  </p>
                  <pre className="whitespace-pre-wrap break-words font-mono text-[12px] text-foreground">
                    {this.state.error.message || "(no message)"}
                  </pre>
                </div>
                {this.state.info?.componentStack && (
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-[0.08em] text-muted-foreground mb-1">
                      Component stack
                    </p>
                    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground/90 max-h-64 overflow-auto">
                      {this.state.info.componentStack}
                    </pre>
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
