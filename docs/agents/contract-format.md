# Agent config — contract format

**Format:** Markdown contracts with embedded code blocks, under [`../../contracts/`](../../contracts/), versioned by filename suffix.

This matches what the project already does. The `contract-author` skill should honor this.

- **Location:** `contracts/`
- **Versioning:** suffix in the filename, bumped per phase — e.g. `ipc.v1.md` → `ipc.v3.md` → `ipc.v3b.md`. Keep older versions for history; the highest version is current.
- **Style:** human-readable Markdown with normative domain rules, a file-ownership table, channel/endpoint tables, and embedded TypeScript/Zod or JSON snippets. The canonical shared types/schemas live in code at `src/shared/schemas.ts` + `src/shared/types.ts`; the Markdown contracts document and explain them.
- **Source of truth for the IPC surface:** `src/shared/ipc.ts` (channel constants) + `src/shared/schemas.ts` (Zod). When a contract doc and the code disagree, **the code wins** and the doc is the bug (current drift tracked as ATR-023).

> Note: `contracts/README.md`, `contracts/api.md`, `contracts/schema.md`, and
> `contracts/types.ts` describe the **legacy Next.js** surface and are superseded by the
> `ipc.v3*` + `data-layer.v1` docs for the Electron app. Reconciling them is ATR-023.
