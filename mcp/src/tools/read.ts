/**
 * Read tools.
 *
 * Everything here is a query. The catalog is never modified.
 *
 * Repos are addressed by filesystem path, never by slug: a slug embeds a
 * hash of the repo's path, so it changes whenever the repo is moved.
 */

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { getSqlite } from "@main/db/client";
import { listLinks, resolveRepo } from "@main/db/links";
import { graphService } from "@main/services/graph";

function json(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

/** Turn a failed resolution into a message that tells the agent what to do. */
function resolveOrExplain(pathOrName: string) {
  const found = resolveRepo(pathOrName);
  if (found.ok) return { ok: true as const, repo: found };
  if (found.reason === "ambiguous") {
    return {
      ok: false as const,
      message: `"${pathOrName}" matches more than one repository. Pass a full path instead. Candidates:\n${found.candidates.join("\n")}`,
    };
  }
  return {
    ok: false as const,
    message: `No repository matches "${pathOrName}". Use find_repos to search the catalog.`,
  };
}

export function registerReadTools(server: McpServer): void {
  server.registerTool(
    "find_repos",
    {
      description:
        "Search the catalog by name, description, or path. Returns matching repositories with the path you need for the other tools.",
      inputSchema: {
        query: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional(),
      },
    },
    async ({ query, limit }) => {
      const like = `%${query.replace(/[\\%_]/g, "\\$&")}%`;
      const rows = getSqlite()
        .prepare(
          `SELECT name, full_path, description, primary_language, last_commit_date
             FROM repos
            WHERE name LIKE ? ESCAPE '\\' OR full_path LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\'
         ORDER BY last_commit_date DESC
            LIMIT ?`,
        )
        .all(like, like, like, limit ?? 25);
      return json(rows);
    },
  );

  server.registerTool(
    "get_repo",
    {
      description:
        "Full detail for one repository, including every relationship the map currently shows for it — both derived and curated.",
      inputSchema: { path: z.string().min(1) },
    },
    async ({ path: pathOrName }) => {
      const found = resolveOrExplain(pathOrName);
      if (!found.ok) return json({ error: found.message });

      const row = getSqlite()
        .prepare("SELECT * FROM repos WHERE id = ?")
        .get(found.repo.id);

      const graph = graphService.build();
      const edges = graph.edges.filter(
        (e) => e.source === found.repo.slug || e.target === found.repo.slug,
      );

      return json({
        repo: row,
        curatedLinks: listLinks(found.repo.id),
        edges,
      });
    },
  );

  server.registerTool(
    "get_map",
    {
      description:
        "The relationship map: clusters of related repositories, how far each cluster is scattered across folders, and which members sit outside their cluster's main home.",
      inputSchema: { cluster: z.number().int().optional() },
    },
    async ({ cluster }) => {
      const graph = graphService.build();
      if (cluster === undefined) {
        return json({
          builtAt: graph.builtAt,
          repoCount: graph.nodes.length,
          edgeCount: graph.edges.length,
          clusters: graph.clusters,
        });
      }
      const nodes = graph.nodes.filter((n) => n.cluster === cluster);
      const slugs = new Set(nodes.map((n) => n.slug));
      return json({
        cluster: graph.clusters.find((c) => c.id === cluster) ?? null,
        nodes,
        edges: graph.edges.filter(
          (e) => slugs.has(e.source) && slugs.has(e.target),
        ),
      });
    },
  );
}
