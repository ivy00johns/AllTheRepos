/**
 * IPC handlers — `graph:*` namespace.
 *
 * Four channels, separated by cost and by direction.
 *
 * Building the graph reads every repo's `package.json` and `.gitmodules`,
 * so it stays an explicit request rather than something the catalog does
 * on every render. Reading one repo's curated links is a single indexed
 * query, so the catalog is free to ask for those on every selection.
 *
 * The other two write `repo_links` — the only table this namespace
 * touches — so relationships can be curated from the catalog itself
 * rather than only from an MCP session. They are deliberate peers of the
 * MCP's `link`/`unlink` tools: same table, same upsert, same refusal to
 * link a repository to itself, and the same requirement that a human
 * supplied a reason.
 */

import { ipcMain, type IpcMainInvokeEvent } from "electron";

import { IPC } from "@shared/ipc";
import {
  AssertRepoLinkInputSchema,
  AssertRepoLinkResultSchema,
  GraphBuildInputSchema,
  GraphResultSchema,
  RemoveRepoLinkInputSchema,
  RemoveRepoLinkResultSchema,
  RepoRelationsInputSchema,
  RepoRelationsResultSchema,
} from "@shared/schemas";
import type {
  AssertRepoLinkResult,
  GraphResult,
  RemoveRepoLinkResult,
  RepoRelationsResult,
} from "@shared/types";

import { createLink, listRelations, removeLink } from "@main/db/links";
import { catalogService } from "@main/services/catalog";
import { graphService } from "@main/services/graph";

import { assertRendererFrame } from "./_frame";

export async function handleGraphBuild(raw: unknown): Promise<GraphResult> {
  GraphBuildInputSchema.parse(raw);
  return GraphResultSchema.parse(graphService.build());
}

/**
 * Curated links for one repo, by slug.
 *
 * An unknown slug is not an error: the row can be removed between the
 * catalog listing it and the click, and a stale panel should render
 * "nothing related" rather than an error.
 */
export async function handleRepoRelations(
  raw: unknown,
): Promise<RepoRelationsResult> {
  const { slug } = RepoRelationsInputSchema.parse(raw);
  const repoId = await catalogService.resolveRepoId(slug);
  if (repoId === null) return { relations: [] };
  return RepoRelationsResultSchema.parse({ relations: listRelations(repoId) });
}

const SELF_LINK = "A repository cannot link to itself.";

/**
 * Resolve one end of a write, or explain why it cannot proceed.
 *
 * Unlike the read path, a slug that matches nothing is an error here. A
 * write that cannot name its target must fail loudly: the panel would
 * otherwise report a relationship it never recorded.
 */
async function repoIdOrThrow(
  slug: string,
  end: "from" | "to",
): Promise<number> {
  const id = await catalogService.resolveRepoId(slug);
  if (id === null) {
    throw new Error(
      `No catalog entry matches the ${end} repository (${slug}). Rescan and try again.`,
    );
  }
  return id;
}

/**
 * Assert a curated link.
 *
 * Rows written here are stamped `source: "ui"` so provenance survives into
 * the graph — a human sitting in front of the catalog is a different kind
 * of witness from an agent session.
 */
export async function handleAssertRepoLink(
  raw: unknown,
): Promise<AssertRepoLinkResult> {
  const input = AssertRepoLinkInputSchema.parse(raw);
  if (input.fromSlug === input.toSlug) throw new Error(SELF_LINK);

  const fromId = await repoIdOrThrow(input.fromSlug, "from");
  const toId = await repoIdOrThrow(input.toSlug, "to");
  if (fromId === toId) throw new Error(SELF_LINK);

  const link = createLink({
    fromId,
    toId,
    kind: input.kind,
    why: input.why,
    source: "ui",
  });
  return AssertRepoLinkResultSchema.parse({ link });
}

/**
 * Remove a curated link.
 *
 * `removed: false` is a normal answer rather than an error. Removal is
 * addressed from the panel that is showing the link, so the one case that
 * reaches here with a dead slug is a repository deleted while the panel
 * was open — and its links cascaded away with it
 * (`db/schema.ts:120-125`). The link is already gone; saying so is the
 * whole answer.
 */
export async function handleRemoveRepoLink(
  raw: unknown,
): Promise<RemoveRepoLinkResult> {
  const input = RemoveRepoLinkInputSchema.parse(raw);
  const fromId = await catalogService.resolveRepoId(input.fromSlug);
  const toId = await catalogService.resolveRepoId(input.toSlug);
  if (fromId === null || toId === null) {
    return RemoveRepoLinkResultSchema.parse({ removed: false });
  }
  return RemoveRepoLinkResultSchema.parse({
    removed: removeLink(fromId, toId, input.kind),
  });
}

/** Register every `graph:*` handler. Idempotent. */
export function registerGraphHandlers(): void {
  ipcMain.removeHandler(IPC.GRAPH.BUILD);
  ipcMain.handle(
    IPC.GRAPH.BUILD,
    async (event: IpcMainInvokeEvent, raw): Promise<GraphResult> => {
      assertRendererFrame(event);
      return handleGraphBuild(raw);
    },
  );

  ipcMain.removeHandler(IPC.GRAPH.LINKS);
  ipcMain.handle(
    IPC.GRAPH.LINKS,
    async (event: IpcMainInvokeEvent, raw): Promise<RepoRelationsResult> => {
      assertRendererFrame(event);
      return handleRepoRelations(raw);
    },
  );

  ipcMain.removeHandler(IPC.GRAPH.LINK);
  ipcMain.handle(
    IPC.GRAPH.LINK,
    async (event: IpcMainInvokeEvent, raw): Promise<AssertRepoLinkResult> => {
      assertRendererFrame(event);
      return handleAssertRepoLink(raw);
    },
  );

  ipcMain.removeHandler(IPC.GRAPH.UNLINK);
  ipcMain.handle(
    IPC.GRAPH.UNLINK,
    async (event: IpcMainInvokeEvent, raw): Promise<RemoveRepoLinkResult> => {
      assertRendererFrame(event);
      return handleRemoveRepoLink(raw);
    },
  );
}
