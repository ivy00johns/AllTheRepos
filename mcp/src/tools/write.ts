/**
 * Write tools.
 *
 * The entire write surface of this server: rows in `repo_links`. No
 * command execution, no filesystem mutation, no git. The app's move,
 * folder and task operations stay behind their preflight rails and are
 * deliberately unreachable from here.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { RepoLinkKindSchema } from "@shared/schemas";
import { createLink, listLinks, removeLink, resolveRepo } from "@main/db/links";

function json(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

/**
 * Resolve both ends, or explain why not.
 *
 * An ambiguous name is refused rather than guessed: a wrong assertion
 * outranks every derived signal on the map, so a silent mis-pick is
 * worse than an error.
 */
function resolvePair(from: string, to: string) {
  const a = resolveRepo(from);
  if (!a.ok) {
    return {
      ok: false as const,
      message:
        a.reason === "ambiguous"
          ? `"${from}" (from) matches more than one repository. Pass a full path. Candidates:\n${a.candidates.join("\n")}`
          : `No repository matches "${from}" (from). Use find_repos to search.`,
    };
  }

  const b = resolveRepo(to);
  if (!b.ok) {
    return {
      ok: false as const,
      message:
        b.reason === "ambiguous"
          ? `"${to}" (to) matches more than one repository. Pass a full path. Candidates:\n${b.candidates.join("\n")}`
          : `No repository matches "${to}" (to). Use find_repos to search.`,
    };
  }

  if (a.id === b.id) {
    return {
      ok: false as const,
      message: "A repository cannot link to itself.",
    };
  }
  return { ok: true as const, from: a, to: b };
}

export function registerWriteTools(server: McpServer): void {
  server.registerTool(
    "link",
    {
      description:
        "Assert that one repository relates to another. Use 'part-of' when the source belongs under the target — that is the link that makes the map actionable for reorganising folders. Re-asserting the same link updates its reason.",
      inputSchema: {
        from: z.string().min(1),
        to: z.string().min(1),
        kind: RepoLinkKindSchema,
        why: z.string().min(1),
      },
    },
    async ({ from, to, kind, why }) => {
      const pair = resolvePair(from, to);
      if (!pair.ok) return json({ error: pair.message });
      const link = createLink({
        fromId: pair.from.id,
        toId: pair.to.id,
        kind,
        why,
        source: "mcp",
      });
      return json({ created: link });
    },
  );

  server.registerTool(
    "unlink",
    {
      description:
        "Remove a curated relationship. Only affects asserted links — relationships the app derives from dependencies, READMEs and naming cannot be removed this way.",
      inputSchema: {
        from: z.string().min(1),
        to: z.string().min(1),
        kind: RepoLinkKindSchema,
      },
    },
    async ({ from, to, kind }) => {
      const pair = resolvePair(from, to);
      if (!pair.ok) return json({ error: pair.message });
      const removed = removeLink(pair.from.id, pair.to.id, kind);
      return json({ removed });
    },
  );

  server.registerTool(
    "list_links",
    {
      description:
        "Read back curated relationships — all of them, or just those touching one repository.",
      inputSchema: { path: z.string().optional() },
    },
    async ({ path: pathOrName }) => {
      if (!pathOrName) return json({ links: listLinks() });
      const found = resolveRepo(pathOrName);
      if (!found.ok) {
        return json({
          error:
            found.reason === "ambiguous"
              ? `"${pathOrName}" matches more than one repository. Candidates:\n${found.candidates.join("\n")}`
              : `No repository matches "${pathOrName}".`,
        });
      }
      return json({ links: listLinks(found.id) });
    },
  );
}
