/**
 * Debug route ("/debug").
 *
 * A main-process round-trip you can look at: it pings through the preload
 * bridge and renders the response, which is the shortest way to tell whether
 * the renderer, the bridge and the main process are all up and talking.
 *
 * The handoff did not design this screen and says to use the standard page
 * header — so it opens like every other route (28 display title, `system.ping`
 * as its mono fact, the one action on the right) and the result is a
 * definition list on hairlines rather than a bordered card.
 *
 * It survives for two reasons: an end-to-end launch check asserts this
 * round-trip in the built app — "pong" in the document, a numeric
 * `mainProcessPid`, a reachable "Ping again" button — and with `/debug` out of
 * the navigation (ATR-074) the command palette's action is the way in.
 */

import { createRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import { PageHeader } from "@renderer/components/layout/page-header";
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
    <>
      <PageHeader
        title="Debug"
        meta="system.ping"
        actions={
          <button
            type="button"
            onClick={() => void runPing()}
            disabled={!bridgeAvailable || state.status === "loading"}
            className="flex h-7 cursor-pointer items-center gap-1.5 rounded border border-border px-2.5 text-label font-medium text-foreground transition-colors duration-150 hover:border-border-strong hover:bg-surface-raised disabled:cursor-wait disabled:opacity-60"
          >
            {state.status === "loading" ? "Pinging…" : "Ping again"}
          </button>
        }
      />

      <div className="px-6 py-6">
        <p className="max-w-[68ch] text-body text-muted-foreground">
          Pings the main process via{" "}
          <code className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-label text-foreground">
            window.atr.system.ping()
          </code>{" "}
          and renders the response. Live numbers below mean the renderer, the
          preload bridge and the main process are all talking to each other.
        </p>

        <section aria-live="polite" aria-atomic="true" className="mt-6">
          {!bridgeAvailable ? (
            <BridgeMissing />
          ) : state.status === "error" ? (
            <PingError message={state.error ?? "Unknown error"} />
          ) : (
            <PingResult state={state} />
          )}
        </section>

        {state.status === "ok" && state.latencyMs !== null ? (
          <p className="mt-4 font-mono atr-meta">
            last round-trip {state.latencyMs.toFixed(2)} ms
          </p>
        ) : null}
      </div>
    </>
  );
}

function BridgeMissing() {
  return (
    <div className="max-w-[68ch] border-t border-border pt-4">
      <p className="text-body font-medium text-foreground">
        Preload bridge unavailable
      </p>
      <p className="mt-1 text-body text-muted-foreground">
        Run via <code className="font-mono">pnpm electron:dev</code> so the
        Electron preload script can mount{" "}
        <code className="font-mono">window.atr</code>.
      </p>
    </div>
  );
}

function PingError({ message }: { message: string }) {
  return (
    <div className="max-w-[68ch] border-t border-border pt-4">
      <p className="text-body font-medium text-destructive">Ping failed</p>
      <pre className="mt-2 overflow-x-auto rounded border border-border bg-background p-3 font-mono atr-meta text-muted-foreground">
        {message}
      </pre>
    </div>
  );
}

function PingResult({ state }: { state: PingState }) {
  if (state.status === "loading" && !state.response) {
    return <p className="text-body text-muted-foreground">Pinging…</p>;
  }
  if (!state.response) {
    return <p className="text-body text-muted-foreground">No response yet.</p>;
  }
  const { mainProcessPid, receivedAt, pong } = state.response;
  const rows: Array<[string, string]> = [
    ["pong", pong],
    ["mainProcessPid", String(mainProcessPid)],
    ["receivedAt", receivedAt],
    [
      "latencyMs",
      state.latencyMs !== null ? state.latencyMs.toFixed(2) : "—",
    ],
  ];
  return (
    <dl className="grid grid-cols-[180px_minmax(0,1fr)] border-t border-border">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="border-b border-surface-raised py-2.5 text-label text-muted-foreground">
            {label}
          </dt>
          <dd className="border-b border-surface-raised py-2.5 font-mono text-body text-foreground">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
