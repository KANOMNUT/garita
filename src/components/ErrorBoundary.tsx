import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  failed: boolean;
  /** The error's `name` only (for example "TypeError"), never its message, stack or any object data. */
  name: string | null;
}

/** Only a plain identifier-shaped name reaches the screen; anything else is dropped. */
function safeName(error: unknown): string | null {
  const name = error instanceof Error ? error.name : null;
  return name !== null && /^[A-Za-z][A-Za-z0-9_]{0,39}$/.test(name) ? name : null;
}

const RING = "outline-hidden focus-visible:ring-2 focus-visible:ring-accent/70";

/**
 * Top-level error boundary, wrapped around `<App />` in `main.tsx`.
 *
 * A render error used to unmount the whole tree and leave a blank window. The fallback is a
 * plain full-window card with a Reload button. It shows no message, stack, props or object
 * data, because a render error can carry any value that was on screen (a revealed Secret
 * included); the details go to the webview console only. Components never call `invoke`, so
 * nothing is sent to the app log from here.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, name: null };

  static getDerivedStateFromError(error: unknown): State {
    return { failed: true, name: safeName(error) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("Garita render error", error, info.componentStack);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div
        role="alert"
        className="w-full h-full flex flex-col items-center justify-center gap-3 px-6 text-center bg-surface-base text-ink"
      >
        <h1 className="text-[16px] font-semibold tracking-tight">Something went wrong</h1>
        <p className="text-[12.5px] text-mute max-w-md">
          The window hit an error and cannot continue. Reload it to start again.
        </p>
        {this.state.name && <p className="mono text-[11.5px] text-mute">{this.state.name}</p>}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={`h-8 px-4 rounded-md bg-accent/15 ring-1 ring-accent/30 text-accent text-[12.5px] font-medium hover:bg-accent/25 ${RING}`}
        >
          Reload
        </button>
      </div>
    );
  }
}
