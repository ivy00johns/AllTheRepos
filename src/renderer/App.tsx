/**
 * Phase 1 application shell.
 *
 * Wraps the TanStack Router with:
 *   - the scan event bus (so push events from the main process land in
 *     the global scan store regardless of which route is mounted),
 *   - a top-level ErrorBoundary so a renderer crash shows a recovery
 *     UI instead of a blank screen.
 *
 * Provider wrappers (QueryClientProvider, RouterProvider) live in
 * `main.tsx` — this component is rendered INSIDE them and assumes
 * both are available.
 *
 * The Phase 0 ping/pong card moved to `routes/debug.tsx` so the
 * existing Playwright E2E still passes against the `/debug` URL.
 */

import { RouterProvider } from "@tanstack/react-router";
import { Component, type ErrorInfo, type ReactNode } from "react";

import { useProcessEventBus } from "@renderer/hooks/use-processes";
import { useScanEventBus } from "@renderer/hooks/use-scan";
import { router } from "@renderer/router";

// Phase 2 action lifecycle hooks + <CommandPalette /> live in
// `routes/__root.tsx` so they sit INSIDE RouterProvider's tree —
// `useNavigate`/`useLocation` null-crash from a sibling subtree.
export function App() {
  return (
    <ErrorBoundary>
      <ScanEventBusMount />
      <ProcessEventBusMount />
      <RouterProvider router={router} />
    </ErrorBoundary>
  );
}

/** Side-effect-only component: subscribes to scan events for the lifetime of the app. */
function ScanEventBusMount() {
  useScanEventBus();
  return null;
}

/**
 * Side-effect-only component: subscribes to push-style process
 * snapshot events for the lifetime of the app. Must live OUTSIDE
 * RouterProvider so the subscription survives route transitions,
 * but INSIDE QueryClientProvider so it can call
 * `queryClient.setQueryData`.
 */
function ProcessEventBusMount() {
  useProcessEventBus();
  return null;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<
  { children: ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("Renderer crashed:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 px-6 py-12">
          <h1 className="text-2xl font-semibold tracking-tight text-destructive">
            Renderer crashed
          </h1>
          <p className="text-sm text-muted-foreground">
            The renderer threw an uncaught error. Reload the window (
            <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
              Cmd+R
            </code>
            ) to recover.
          </p>
          <pre className="overflow-x-auto rounded bg-muted p-3 font-mono text-xs text-muted-foreground">
            {this.state.error.message}
          </pre>
        </main>
      );
    }
    return this.props.children;
  }
}
