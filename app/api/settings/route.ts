import { NextResponse } from "next/server";
import { getSettings } from "@/lib/db/queries";
import type { ApiError, ApiOk, Settings } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const settings = await getSettings();
    const body: ApiOk<Settings> = { ok: true, data: settings };
    return NextResponse.json(body);
  } catch (err) {
    console.error("[backend] /api/settings error", err);
    const body: ApiError = {
      ok: false,
      error: {
        code: "DB_ERROR",
        message: err instanceof Error ? err.message : "settings load failed",
      },
    };
    return NextResponse.json(body, { status: 500 });
  }
}
