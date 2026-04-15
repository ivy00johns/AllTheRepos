import { NextResponse } from "next/server";
import { z } from "zod";
import { hybridSearch } from "@/lib/search/query";
import type { ApiError, ApiOk, SearchHit } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SearchBodySchema = z.object({
  query: z.string().min(1),
  filters: z
    .object({
      language: z.string().nullable().optional(),
      tags: z.array(z.string()).optional(),
      groupIds: z.array(z.number().int()).optional(),
      dirtyOnly: z.boolean().optional(),
    })
    .optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

function errorResponse(error: ApiError["error"], status: number): Response {
  const body: ApiError = { ok: false, error };
  return NextResponse.json(body, { status });
}

export async function POST(req: Request): Promise<Response> {
  let parsed: z.infer<typeof SearchBodySchema>;
  try {
    const raw = await req.json().catch(() => ({}));
    parsed = SearchBodySchema.parse(raw);
  } catch (err) {
    return errorResponse(
      {
        code: "VALIDATION",
        message: "Invalid search request",
        details: { issue: err instanceof Error ? err.message : String(err) },
      },
      400,
    );
  }

  try {
    const hits = await hybridSearch(parsed);
    const body: ApiOk<SearchHit[]> = { ok: true, data: hits };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[backend] /api/search error", err);
    return errorResponse(
      {
        code: "INTERNAL",
        message: err instanceof Error ? err.message : "search failed",
      },
      500,
    );
  }
}
