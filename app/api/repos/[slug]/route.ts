import { NextResponse } from "next/server";
import { getRepoBySlug } from "@/lib/db/queries";
import type { ApiError, ApiOk, RepoDetail } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function errorResponse(error: ApiError["error"], status: number): Response {
  const body: ApiError = { ok: false, error };
  return NextResponse.json(body, { status });
}

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ slug: string }> },
): Promise<Response> {
  try {
    const { slug } = await ctx.params;
    if (!slug) {
      return errorResponse(
        { code: "BAD_REQUEST", message: "slug is required" },
        400,
      );
    }
    const detail = await getRepoBySlug(slug);
    if (!detail) {
      return errorResponse(
        { code: "NOT_FOUND", message: `repo '${slug}' not found` },
        404,
      );
    }
    const body: ApiOk<RepoDetail> = { ok: true, data: detail };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[backend] /api/repos/[slug] error", err);
    return errorResponse(
      {
        code: "DB_ERROR",
        message: err instanceof Error ? err.message : "lookup failed",
      },
      500,
    );
  }
}
