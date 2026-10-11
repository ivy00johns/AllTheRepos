/**
 * Debug route ("/debug").
 *
 * A main-process round-trip you can look at: it pings through the preload
 * bridge and renders the response, which is the shortest way to tell whether
 * the renderer, the bridge and the main process are all up and talking.
 *
 * The renderer used to draw this on the index route; it moved here when `/`
 * became the catalog. It survives the move for two reasons: an end-to-end
 * launch check asserts this round-trip in the built app — "pong" in the
 * document, a numeric `mainProcessPid`, a reachable "Ping again" button — and
 * with `/debug` out of the navigation (ATR-074) the command palette's
 * "Open Debug Page" action is the way in.
 */

import { createRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@renderer/components/ui/button";
import { getAtr } from "@renderer/lib/atr";
import type { PingResponse } from "@shared/types";
import { Route as RootRoute } from "./__root";

export const Route = createRoute({
  getParentRoute: () => RootRoute,
  path: "/debug",
  component: DebugPage,
});

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

function DebugPage() {
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
      const response = await atr.system.ping({ nonce: crypto.randomUUID() });
      const latencyMs = performance.now() - start;
      setState({ status: "ok", response, latencyMs, error: null });
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
    <div className="mx-auto flex max-w-2xl flex-col gap-8 py-4">
      <header className="flex flex-col gap-2">
        <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
          Diagnostics · main-process round trip
        </p>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          /debug — system.ping
        </h1>
        <p className="text-sm text-muted-foreground">
          Pings the main process via{" "}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            window.atr.system.ping()
          </code>{" "}
          and renders the response. Live numbers below mean the renderer, the
          preload bridge and the main process are all talking to each other.
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
    </div>
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
    return <p className="font-mono text-sm text-muted-foreground">Pinging…</p>;
  }
  if (!state.response) {
    return (
      <p className="font-mono text-sm text-muted-foreground">
        No response yet.
      </p>
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
