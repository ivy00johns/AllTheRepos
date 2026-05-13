# Protocol Contract v1 — `alltherepos://` URL scheme (Phase 2, frozen)

This document specifies the **`alltherepos://`** URL scheme registered
by the AllTheRepos desktop app in Phase 2. When the OS opens a URL
matching this scheme, main parses it into a canonical
`DeepLinkPayload` and pushes it to the renderer on the
`protocol:on:deep-link` IPC event channel.

The TypeScript shape lives in `src/shared/types.ts` as `DeepLinkPayload`.
The Zod schema lives in `src/shared/schemas.ts` as `DeepLinkPayloadSchema`.
The corresponding IPC channel is documented in `contracts/ipc.v1.md` under
"Protocol namespace".

## Registration

Main registers the scheme via:

- `app.setAsDefaultProtocolClient("alltherepos")` at boot.
- `electron-builder.yml`'s `mac.protocols` entry for packaged builds
  (Info.plist `CFBundleURLTypes`).

On macOS the OS dispatches incoming URLs through
`app.on('open-url', (event, url) => …)`. Main then:

1. Calls `event.preventDefault()`.
2. Parses the URL into a `DeepLinkPayload` per the grammar below.
3. Ensures the main window is visible (re-show if minimized, re-create
   if closed).
4. Validates the payload through `DeepLinkPayloadSchema.parse(...)`.
5. Pushes via `webContents.send(IPC.PROTOCOL.ON_DEEP_LINK, payload)`.

## URL grammar

```
alltherepos://<path>[?<query>]
```

- The scheme is exactly `alltherepos` (lower-case, no aliases).
- The authority portion is empty / ignored — there is no host. The
  `://` is followed directly by the path.
- `<path>` is one of the path patterns below. Path captures are
  surfaced in `params`.
- `<query>` is an optional standard URL query string. Every entry is
  surfaced in `params`. Both keys and values are URL-decoded once.

After parsing, `DeepLinkPayload.path` is the URL portion after
`alltherepos://` with any leading or trailing `/` stripped.
`DeepLinkPayload.params` is the merged `{ ...pathCaptures, ...queryParams }`
map (path captures take precedence on key collision).

### Path patterns

| Path          | Phase | Path captures       | Notes                                                |
| ------------- | ----- | ------------------- | ---------------------------------------------------- |
| `repo/<slug>` | 2     | `slug` ← `<slug>`   | Navigate to repo detail. Slug grammar matches the    |
|               |       |                     | repo `slug` column (alphanumeric + `-` + `_`).       |
| `settings`    | 2     | —                   | Navigate to `/settings`.                             |
| `action/<id>` | 2\*   | `actionId` ← `<id>` | Dispatch the action with the given id via the        |
|               |       |                     | renderer's `dispatchAction(actionId)`. Locked at v1, |
|               |       |                     | but Phase 2 implementers MAY treat this path as a    |
|               |       |                     | best-effort feature; missing actions log a dev warn  |
|               |       |                     | and otherwise no-op. (\* = "locked but optional".)   |

Any other path is **invalid** — main rejects with a dev-mode log and
does NOT push an event. Implementers MUST NOT silently re-interpret a
malformed path as one of the above.

### Examples

| URL                                           | `DeepLinkPayload`                                                                           |
| --------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `alltherepos://repo/all-the-repos`            | `{ path: "repo/all-the-repos", params: { slug: "all-the-repos" } }`                         |
| `alltherepos://repo/atr?focus=readme`         | `{ path: "repo/atr", params: { slug: "atr", focus: "readme" } }`                            |
| `alltherepos://settings`                      | `{ path: "settings", params: {} }`                                                          |
| `alltherepos://settings?tab=editor`           | `{ path: "settings", params: { tab: "editor" } }`                                           |
| `alltherepos://action/catalog.refresh`        | `{ path: "action/catalog.refresh", params: { actionId: "catalog.refresh" } }`               |
| `alltherepos://action/app.open-spotlight?x=1` | `{ path: "action/app.open-spotlight", params: { actionId: "app.open-spotlight", x: "1" } }` |

## Path-capture semantics

The captures emitted by each path pattern are normative:

- `repo/<slug>` → `{ slug }`
- `action/<id>` → `{ actionId }`
- `settings` → no captures

These captures live in the same `params` map as query-string entries.
If a query string also carries `slug` / `actionId`, the path capture
**wins**. Renderers MUST NOT rely on a query-string `slug` overriding
the path-segment slug — that's intentional, to make deep-link templates
unambiguous.

## Validation

`DeepLinkPayloadSchema` enforces:

- `path: string` — non-empty, ≤2048 chars, MUST NOT start with `/`
  (main strips the leading slash before parsing).
- `params: Record<string, string>` — all values stringified; if a
  caller passes `?n=42`, the renderer receives `params.n === "42"`.

The renderer is responsible for further validation of `slug` /
`actionId` shape (e.g. via `ActionIdSchema` from
`src/shared/schemas.ts` when handling the `action/<id>` path).

## Security

- Main MUST treat every incoming URL as untrusted user input. The
  scheme + path grammar above is the only validated surface; anything
  else is rejected.
- The renderer MUST NOT use `params.slug` to construct filesystem paths
  or shell commands directly. Lookups go through `catalog:get` and the
  existing slug-keyed query layer.
- No `action/<id>` payload may carry executable code — `actionId` is
  matched against the renderer's static dispatch table; unknown ids
  no-op.

## Phase 2 implementation requirements

Phase 2 implementers MUST handle:

- `repo/<slug>` → navigate to repo detail.
- `settings` → navigate to `/settings`.

Phase 2 implementers SHOULD handle:

- `action/<id>` → call `dispatchAction(actionId)`; unknown ids no-op
  with a dev-mode console warning.

The renderer's route handler for `protocol:on:deep-link` MAY display a
toast / focus the right tab / etc. — those are UX choices outside this
contract.

## File map

| File                        | Owner            | Purpose                                      |
| --------------------------- | ---------------- | -------------------------------------------- |
| `src/shared/types.ts`       | contract-author  | `DeepLinkPayload`.                           |
| `src/shared/schemas.ts`     | contract-author  | `DeepLinkPayloadSchema`.                     |
| `contracts/protocol.v1.md`  | contract-author  | This document.                               |
| `src/main/protocol/...`     | backend-system   | `app.on('open-url')` handler + parser.       |
| `src/renderer/protocol/...` | frontend-palette | `protocol:on:deep-link` subscriber + router. |

The right-hand `src/main/...` and `src/renderer/...` files are NOT
part of the contract-author deliverable — they're the consumers of
this contract, authored in Wave 2.
