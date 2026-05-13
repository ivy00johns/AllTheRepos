# AllTheRepos

A local-first hub for the dozens-to-thousands of git repositories on a developer's machine. Currently shipping as a Next.js app at `localhost:3939`; migrating to a native macOS Electron desktop app.

## Web app (Next.js, localhost)

```bash
pnpm install
pnpm dev          # http://localhost:3939
pnpm typecheck
pnpm test
pnpm test:e2e
```

Code layout:

- `app/` — Next.js App Router pages and route handlers
- `components/` — React components (shadcn/ui + custom)
- `lib/` — services, db, business logic
- `contracts/` — shared schemas
- `drizzle/` — SQLite migrations

## Electron app (Phase 0)

The Next.js app continues to work unchanged. The Electron migration is **additive** — Phase 0 lays down the build tooling so we can start porting features into `src/main`, `src/preload`, and `src/renderer` without touching the running web app.

### Prerequisites

- **Node 22+ is required** for the Electron dev server. Vite 7 uses `crypto.hash()`, which doesn't exist in Node 21.0–21.6 and bombs with `TypeError: crypto.hash is not a function`. An `.nvmrc` is checked in — run `nvm use` from the repo root to pick up Node 22 automatically. `engines.node` in `package.json` enforces this at install time.
- pnpm 9+ (pinned via `packageManager` field)
- macOS for `pnpm electron:dist` (DMG output)

If `pnpm electron:dev` fails with `crypto.hash is not a function`, your shell is using Node ≤21.6. Run `nvm use` (or `nvm use 22`) and retry.

### Quickstart

```bash
pnpm install
pnpm electron:dev      # launches electron-vite dev with HMR (requires src/main/index.ts)
pnpm electron:build    # type-check + bundle main / preload / renderer into out/
pnpm electron:pack     # build + package an unsigned .app under release/
pnpm electron:dist     # build + produce an unsigned .dmg under release/
```

The `electron:dev`, `electron:pack`, and `electron:dist` scripts each chain `pnpm electron:rebuild` first, which runs `electron-builder install-app-deps` and rebuilds `better-sqlite3` (and any other native module) against the bundled Electron ABI. If you ever see a `NODE_MODULE_VERSION` mismatch when launching Electron, run `pnpm electron:rebuild` (or `node scripts/rebuild-natives.mjs`).

### Known Issues (Phase 0)

- **Native modules require dual rebuilds.** `better-sqlite3` and `find-git-repositories` ship a single set of `.node` binaries. Tests run under host Node (`pnpm test`); Electron runs under Electron's bundled Node. Switching between them requires a rebuild:
  - For tests: `pnpm rebuild better-sqlite3 find-git-repositories`
  - For Electron: `pnpm electron:rebuild` (chained into `electron:dev` / `electron:dist`)

  Resolving this properly (dual binaries, ABI auto-targeting) is a Phase 1 task.

- **Carried-over WIP error in `lib/github/client.ts:224`** — implicit `any` on `edge` callback param. This is from the prior `feature/github-api-integration` WIP commit, not Phase 0 scope. Resolution is owned by the GitHub integration feature.

### Code layout

- `src/main/` — Electron main process (services, IPC handlers, workers, native shell)
- `src/preload/` — `contextBridge` API exposed to the renderer as `window.atr.*`
- `src/renderer/` — React UI (Vite root: `src/renderer/index.html`)
- `src/shared/` — types, Zod schemas, constants imported by both main and renderer
- `resources/` — entitlements, icons, DMG background
- `scripts/` — build / rebuild / notarize utilities

Path aliases (configured across `tsconfig.json`, `tsconfig.node.json`, `tsconfig.web.json`, and `electron.vite.config.ts`):

| alias        | resolves to       | used by                  |
|--------------|-------------------|--------------------------|
| `@/*`        | repo root         | Next.js app (legacy)     |
| `@shared/*`  | `src/shared/*`    | main + preload + renderer |
| `@main/*`    | `src/main/*`      | main process             |
| `@renderer/*`| `src/renderer/*`  | renderer                 |

### Phase 0 status

This README section is updated as Phase 0 lands its pieces. Today: build tooling, tsconfig split, electron-builder config, and entitlements skeleton are in place. The IPC ping, Tailwind/shadcn renderer wiring, and Vitest/Playwright Electron tests land via the backend, frontend, and QE agents respectively.

See `NEW-PLAN.md` for the full architecture and migration plan (§3.2 folder structure, §3.4 security baseline, §7 packaging, §8 stack, §9 phased build plan).
