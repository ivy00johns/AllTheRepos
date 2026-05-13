import { useCallback, useEffect, useState } from "react";

import { Button } from "@renderer/components/ui/button";
import { getAtr } from "@renderer/lib/atr";
import type { PingResponse } from "@shared/types";

/**
 * Phase 0 single-page renderer.
 *
 * Renders a minimal smoke test of the preload bridge:
 *   1. On mount, invoke `window.atr.system.ping()`.
 *   2. Display `mainProcessPid`, `receivedAt`, and the round-trip
 *      latency measured with `performance.now()` in the renderer.
 *   3. Provide a "Ping again" button that re-runs the call.
 *
 * If the preload bridge is unavailable (renderer loaded in a plain
 * browser, or preload script crashed) the UI degrades to an
 * informational message rather than crashing — this matters for QE.
 */

interface PingState {
  status: "idle" | "loading" | "ok" | "error";
  response: PingResponse | null;
  latencyMs: number | null;
  error: string | null;
}

const INITIAL_STATE: PingState = {
  status: "idle",
  response: null,
  latencyMs: null,
  error: null,
};

export function App() {
  const [state, setState] = useState<PingState>(INITIAL_STATE);
  const bridge = getAtr();
  const bridgeAvailable = bridge !== null;

  const runPing = useCallback(async () => {
    const atr = getAtr();
    if (!atr) {
      setState({
        status: "error",
        response: null,
        latencyMs: null,
        error: "Preload bridge unavailable.",
      });
      return;
    }
    setState((prev) => ({ ...prev, status: "loading", error: null }));
    const start = performance.now();
    try {
      const response = await atr.system.ping({
        nonce: crypto.randomUUID(),
      });
      const latencyMs = performance.now() - start;
      setState({
        status: "ok",
        response,
        latencyMs,
        error: null,
      });
    } catch (err) {
      setState({
        status: "error",
        response: null,
        latencyMs: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  useEffect(() => {
    if (bridgeAvailable) void runPing();
  }, [bridgeAvailable, runPing]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-8 px-6 py-12">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Phase 0 · electron-vite scaffold
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          AllTheRepos Desktop — Phase 0
        </h1>
        <p className="text-sm text-muted-foreground">
          Preload bridge smoke test. Pings the main process via{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            window.atr.system.ping()
          </code>{" "}
          and renders the response.
        </p>
      </header>

      <section
        aria-live="polite"
        className="rounded-lg border border-border bg-card p-6 shadow-sm"
      >
        {!bridgeAvailable ? (
          <BridgeMissing />
        ) : state.status === "error" ? (
          <PingError message={state.error ?? "Unknown error"} />
        ) : (
          <PingResult state={state} />
        )}
      </section>

      <footer className="flex items-center gap-3">
        <Button
          onClick={() => void runPing()}
          disabled={!bridgeAvailable || state.status === "loading"}
        >
          {state.status === "loading" ? "Pinging…" : "Ping again"}
        </Button>
        {state.status === "ok" && state.latencyMs !== null ? (
          <span className="font-mono text-xs text-muted-foreground">
            last round-trip {state.latencyMs.toFixed(2)} ms
          </span>
        ) : null}
      </footer>
    </main>
  );
}

function BridgeMissing() {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-base font-medium text-foreground">
        Preload bridge unavailable
      </p>
      <p className="text-sm text-muted-foreground">
        Run via{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          pnpm electron:dev
        </code>{" "}
        so the Electron preload script can mount{" "}
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          window.atr
        </code>
        .
      </p>
    </div>
  );
}

function PingError({ message }: { message: string }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-base font-medium text-destructive">Ping failed</p>
      <pre className="overflow-x-auto rounded bg-muted p-3 font-mono text-xs text-muted-foreground">
        {message}
      </pre>
    </div>
  );
}

function PingResult({ state }: { state: PingState }) {
  if (state.status === "loading" && !state.response) {
    return (
      <p className="font-mono text-sm text-muted-foreground">Pinging…</p>
    );
  }
  if (!state.response) {
    return (
      <p className="font-mono text-sm text-muted-foreground">No response yet.</p>
    );
  }
  const { mainProcessPid, receivedAt, pong } = state.response;
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-3 font-mono text-sm">
      <dt className="text-muted-foreground">pong</dt>
      <dd className="text-foreground">{pong}</dd>
      <dt className="text-muted-foreground">mainProcessPid</dt>
      <dd className="text-foreground">{mainProcessPid}</dd>
      <dt className="text-muted-foreground">receivedAt</dt>
      <dd className="text-foreground">{receivedAt}</dd>
      <dt className="text-muted-foreground">latencyMs</dt>
      <dd className="text-foreground">
        {state.latencyMs !== null ? state.latencyMs.toFixed(2) : "—"}
      </dd>
    </dl>
  );
}
