/**
 * CONTRACT v1 — Shared types for the Electron migration.
 *
 * This file is the new source of truth for types shared between the
 * main process and the renderer. For Phase 0 we simply re-export the
 * existing `contracts/types.ts` (which currently mirrors `lib/types.ts`,
 * see memory observation 618) and add the few Phase 0 additions:
 *   - `ScanEvent` — discriminated-union streaming events for the scanner.
 *   - `PingResponse` — output of the trivial `system:ping` IPC.
 *
 * Future direction: once Phase 1 begins, `lib/types.ts` and the legacy
 * `contracts/types.ts` should re-export from THIS file instead of the
 * other way around. For Phase 0 we leave the legacy files untouched and
 * just import them here.
 *
 * Hard rule: this module must remain dependency-light. No Node APIs,
 * no DOM, no Electron — only TS types and Zod (via `./schemas.ts`).
 */

// Re-export the frozen v1 entity types from contracts/types.ts. These
// definitions remain the authoritative shape for Repo, Group, Tag, etc.
export type {
  ActionResult,
  ApiError,
  ApiOk,
  ApiResult,
  Group,
  LanguageBytes,
  Repo,
  RepoDetail,
  RepoListQuery,
  RepoListResult,
  ScanProgressEvent,
  SearchHit,
  SearchQuery,
  Settings,
  SmartFilter,
  Tag,
  TagSource,
} from "../../contracts/types";

// ---------------------------------------------------------------------------
// Phase 0 additions
// ---------------------------------------------------------------------------

/**
 * Streaming scan event emitted by the (future) scanner worker over IPC.
 *
 * Locked in Phase 0 so consumers in later phases can rely on the shape.
 * The legacy `ScanProgressEvent` in `contracts/types.ts` describes the
 * NDJSON wire format of the old Next.js scanner; `ScanEvent` is its
 * Electron-IPC successor and intentionally smaller / re-keyed on `kind`.
 */
export type ScanEvent =
  | { kind: "progress"; processed: number; total: number; currentPath: string }
  | { kind: "repo"; repo: import("../../contracts/types").Repo }
  | { kind: "done"; totalRepos: number; durationMs: number }
  | { kind: "error"; message: string; path: string | null };

/**
 * Response payload of the trivial `system:ping` IPC channel.
 * Used in Phase 0 to validate the preload + contextBridge wiring.
 */
export interface PingResponse {
  ok: true;
  pong: "pong";
  mainProcessPid: number;
  /** ISO-8601 timestamp captured in the main process. */
  receivedAt: string;
}

/** Input payload for `system:ping`. Phase 0 accepts an empty object. */
export interface PingInput {
  /** Optional client-side nonce, echoed nowhere — purely a smoke test. */
  nonce?: string;
}
