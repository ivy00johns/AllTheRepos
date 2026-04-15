import { NextResponse } from "next/server";
import { z } from "zod";
import { listRepos } from "@/lib/db/queries";
import type { ApiError, ApiOk, RepoListResult } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RepoListQuerySchema = z.object({
  q: z.string().optional(),
  language: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  groupId: z.number().int().nullable().optional(),
  dirtyOnly: z.boolean().optional(),
  sort: z
    .enum(["lastCommit", "name", "lastScanned", "lastOpened"])
    .optional(),
  order: z.enum(["asc", "desc"]).optional(),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).optional(),
});

function errorResponse(error: ApiError["error"], status: number): Response {
  const body: ApiError = { ok: false, error };
  return NextResponse.json(body, { status });
}

export async function GET(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const sp = url.searchParams;
    const raw: Record<string, unknown> = {};
    const q = sp.get("q");
    if (q !== null) raw.q = q;
    const language = sp.get("language");
    if (language !== null) raw.language = language || null;
    const tags = sp.getAll("tags");
    if (tags.length > 0) raw.tags = tags;
    const groupId = sp.get("groupId");
    if (groupId !== null) {
      raw.groupId = groupId === "" ? null : Number(groupId);
    }
    const dirtyOnly = sp.get("dirtyOnly");
    if (dirtyOnly !== null) raw.dirtyOnly = dirtyOnly === "true";
    const sort = sp.get("sort");
    if (sort !== null) raw.sort = sort;
    const order = sp.get("order");
    if (order !== null) raw.order = order;
    const limit = sp.get("limit");
    if (limit !== null) raw.limit = Number(limit);
    const offset = sp.get("offset");
    if (offset !== null) raw.offset = Number(offset);

    const parsed = RepoListQuerySchema.parse(raw);
    const result = await listRepos(parsed);
    const body: ApiOk<RepoListResult> = { ok: true, data: result };
    return NextResponse.json(body);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return errorResponse(
        {
          code: "VALIDATION",
          message: "Invalid query params",
          details: { issues: err.issues },
        },
        400,
      );
    }
    console.error("[backend] /api/repos error", err);
    return errorResponse(
      {
        code: "DB_ERROR",
        message: err instanceof Error ? err.message : "list failed",
      },
      500,
    );
  }
}
