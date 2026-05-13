# IPC Contract v1 — Phase 0 (frozen)

This document is the authoritative registry of IPC channels exposed by
the Electron main process to the renderer via the preload `contextBridge`.
It is **frozen at v1 / Phase 0**. New channels are added by incrementing
the document version when later phases ship.

Consumers (main, preload, renderer, qe-agent) MUST import channel names
from `src/shared/ipc.ts` and schemas from `src/shared/schemas.ts`. Do
not hard-code channel strings.

## Conventions

- **Namespace pattern:** `<namespace>:<verb>` (e.g. `system:ping`,
  `catalog:list`). Push-style streams use `<namespace>:on:<event>`
  (e.g. `scan:on:event`). Phase 0 has no streams.
- **Validation:** every `ipcMain.handle` MUST call `.parse()` on the
  incoming payload using the corresponding `*InputSchema` before doing
  any work. Output is typed via the matching `*ResponseSchema`.
- **Preload surface:** all channels are reached from the renderer via
  `window.atr.<namespace>.<verb>(input)`. The bridge key (`atr`) is
  exported as `PRELOAD_BRIDGE_KEY` from `src/shared/ipc.ts`.
- **Security:** every handler must validate `event.senderFrame.url`
  against the renderer origin (see NEW-PLAN.md §3.4). This is a main
  process concern and not encoded in this contract.

## Reserved namespaces

| Namespace   | Phase | Notes                                        |
| ----------- | ----- | -------------------------------------------- |
| `system`    | 0     | Health, ping, app lifecycle, version info.   |
| `catalog`   | 1     | Repo list / detail / search.                 |
| `scan`      | 1     | Scanner trigger + progress stream.           |
| `git`       | 1+    | Per-repo git status / branches / log.        |
| `settings`  | 1     | User preferences read/write.                 |
| `launcher`  | 2     | "Open in VSCode / Cursor / Finder / Term".   |
| `process`   | 3     | Port / running-server detection.             |
| `claude`    | 3     | Claude Code projects + MCP scan.             |

Only the `system` namespace is implemented in Phase 0. Other rows are
listed so later agents know which prefixes are pre-allocated.

## Phase 0 channels

### `system:ping`

Round-trip smoke test. Validates that preload exposed the bridge, that
the main-process handler is registered, and that Zod parsing is wired.

- **Constant:** `IPC.SYSTEM.PING` (`src/shared/ipc.ts`)
- **Input schema:** `PingInputSchema` (`src/shared/schemas.ts`)
- **Output schema:** `PingResponseSchema` (`src/shared/schemas.ts`)
- **Renderer call:** `window.atr.system.ping(input?)`

**Input shape**

```ts
{ nonce?: string }
```

**Output shape**

```ts
{
  ok: true;
  pong: "pong";
  mainProcessPid: number;       // process.pid in the main process
  receivedAt: string;           // ISO-8601 timestamp at handler entry
}
```

Handlers MUST set `receivedAt` from `new Date().toISOString()` at the
top of the handler and `mainProcessPid` from `process.pid`. The `nonce`
field is accepted but intentionally ignored by Phase 0 — it exists so
the renderer can keep ping calls cache-busted during dev.

## Required deps

- `zod` — already on the dependency tree at `^3.25.67`. No new deps
  are required for Phase 0. The infra agent does not need to install
  anything to satisfy this contract.

## File map

| File                       | Owner             | Purpose                                  |
| -------------------------- | ----------------- | ---------------------------------------- |
| `src/shared/types.ts`      | contract-author   | Re-exports + Phase 0 type additions.     |
| `src/shared/schemas.ts`    | contract-author   | Zod schemas for entities + IPC payloads. |
| `src/shared/ipc.ts`        | contract-author   | Channel name constants (`as const`).     |
| `contracts/ipc.v1.md`      | contract-author   | This document.                           |
| `src/main/ipc/system.ts`   | backend / infra   | `ipcMain.handle(IPC.SYSTEM.PING, ...)`.  |
| `src/preload/api.ts`       | backend / infra   | `window.atr.system.ping` wrapper.        |

The right-hand `src/main/...` and `src/preload/...` files are NOT part
of Phase 0's contract-author deliverable — they are the consumers of
this contract authored in Wave 2.
