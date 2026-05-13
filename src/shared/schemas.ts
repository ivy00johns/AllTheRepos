/**
 * CONTRACT v1 — Zod schemas for entities and IPC payloads shared between
 * the Electron main process and the renderer.
 *
 * Every `ipcMain.handle` MUST `.parse()` its input through the schema
 * defined here, and (where useful) `.parse()` its output before returning.
 * This is the type-safe substitute for electron-trpc described in
 * NEW-PLAN.md §3.3.
 *
 * Phase 0 scope: entity schemas for Repo / Group / Tag / ScanEvent and
 * the trivial `system:ping` channel. Do not add Phase 1+ channels here.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

/** ISO-8601 UTC string. We don't try to be exhaustive — just a sanity check. */
const IsoDateString = z.string().min(1);

// ---------------------------------------------------------------------------
// Entity schemas
// ---------------------------------------------------------------------------

export const TagSourceSchema = z.enum(["user", "heuristic", "smart"]);

export const TagSchema = z.object({
  value: z.string().min(1),
  source: TagSourceSchema,
});

export const LanguageBytesSchema = z.object({
  name: z.string().min(1),
  bytes: z.number().int().nonnegative(),
  color: z.string().min(1),
});

export const RepoSchema = z.object({
  id: z.number().int(),
  slug: z.string().min(1),
  name: z.string().min(1),
  fullPath: z.string().min(1),
  remoteUrl: z.string().nullable(),
  defaultBranch: z.string().nullable(),
  currentBranch: z.string().nullable(),
  lastCommitHash: z.string().nullable(),
  lastCommitDate: IsoDateString.nullable(),
  lastCommitMsg: z.string().nullable(),
  isDirty: z.boolean(),
  primaryLanguage: z.string().nullable(),
  languages: z.array(LanguageBytesSchema),
  tags: z.array(TagSchema),
  description: z.string().nullable(),
  readmePreview: z.string().nullable(),
  readmeHash: z.string().nullable(),
  sizeBytes: z.number().int().nonnegative().nullable(),
  lastScannedAt: IsoDateString.nullable(),
  lastOpenedAt: IsoDateString.nullable(),
  createdAt: IsoDateString,
  updatedAt: IsoDateString,
  source: z.enum(["manual", "filesystem_scan"]),
});

export const SmartFilterSchema = z.object({
  language: z.string().optional(),
  tagsInclude: z.array(z.string()).optional(),
  tagsExclude: z.array(z.string()).optional(),
  dirtyOnly: z.boolean().optional(),
  sinceDays: z.number().int().nonnegative().optional(),
  hasRemote: z.boolean().optional(),
});

export const GroupSchema = z.object({
  id: z.number().int(),
  name: z.string().min(1),
  description: z.string().nullable(),
  isSmart: z.boolean(),
  smartFilter: SmartFilterSchema.nullable(),
  parentGroupId: z.number().int().nullable(),
  sortOrder: z.number().int(),
  repoCount: z.number().int().nonnegative(),
});

// ---------------------------------------------------------------------------
// Scan event (locked in Phase 0, consumed in later phases)
// ---------------------------------------------------------------------------

export const ScanEventSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("progress"),
    processed: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
    currentPath: z.string(),
  }),
  z.object({
    kind: z.literal("repo"),
    repo: RepoSchema,
  }),
  z.object({
    kind: z.literal("done"),
    totalRepos: z.number().int().nonnegative(),
    durationMs: z.number().nonnegative(),
  }),
  z.object({
    kind: z.literal("error"),
    message: z.string(),
    path: z.string().nullable(),
  }),
]);

// ---------------------------------------------------------------------------
// Phase 0 IPC: system:ping
// ---------------------------------------------------------------------------

export const PingInputSchema = z.object({
  nonce: z.string().optional(),
});

export const PingResponseSchema = z.object({
  ok: z.literal(true),
  pong: z.literal("pong"),
  mainProcessPid: z.number().int().nonnegative(),
  receivedAt: IsoDateString,
});

// ---------------------------------------------------------------------------
// Convenience inferred types (prefer the hand-written types in ./types.ts
// where they exist; these exist for handler-internal use).
// ---------------------------------------------------------------------------

export type RepoZ = z.infer<typeof RepoSchema>;
export type GroupZ = z.infer<typeof GroupSchema>;
export type TagZ = z.infer<typeof TagSchema>;
export type ScanEventZ = z.infer<typeof ScanEventSchema>;
export type PingInputZ = z.infer<typeof PingInputSchema>;
export type PingResponseZ = z.infer<typeof PingResponseSchema>;
