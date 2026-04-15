import { NextResponse } from "next/server";
import { listGroups } from "@/lib/db/queries";
import type { ApiError, ApiOk, Group } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const groups = await listGroups();
    const body: ApiOk<Group[]> = { ok: true, data: groups };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[backend] /api/groups error", err);
    const body: ApiError = {
      ok: false,
      error: {
        code: "DB_ERROR",
        message: err instanceof Error ? err.message : "list groups failed",
      },
    };
    return NextResponse.json(body, { status: 500 });
  }
}
