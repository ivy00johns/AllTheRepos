import { NextResponse } from "next/server";
import { z } from "zod";
import { getSettings } from "@/lib/db/queries";
import { scanPaths } from "@/lib/git/scanner";
import type { ApiError } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  paths: z.array(z.string()).optional(),
});

function errorResponse(error: ApiError["error"], status: number): Response {
  const body: ApiError = { ok: false, error };
  return NextResponse.json(body, { status });
}

export async function POST(req: Request): Promise<Response> {
  let payload: z.infer<typeof BodySchema>;
  try {
    const raw = await req.json().catch(() => ({}));
    payload = BodySchema.parse(raw);
  } catch (err) {
    return errorResponse(
      {
        code: "VALIDATION",
        message: "Invalid scan request",
        details: { issue: err instanceof Error ? err.message : String(err) },
      },
      400,
    );
  }

  let paths = payload.paths;
  if (!paths || paths.length === 0) {
    try {
      const settings = await getSettings();
      paths = settings.scanPaths;
    } catch (err) {
      return errorResponse(
        {
          code: "DB_ERROR",
          message:
            err instanceof Error ? err.message : "Failed to load settings",
        },
        500,
      );
    }
  }

  if (!paths || paths.length === 0) {
    return errorResponse(
      {
        code: "BAD_REQUEST",
        message: "No scan paths configured. Add one in settings or include `paths` in the request body.",
      },
      400,
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for await (const event of scanPaths(paths!)) {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        }
      } catch (err) {
        const event = {
          kind: "error" as const,
          fullPath: "(scan)",
          message: err instanceof Error ? err.message : String(err),
        };
        controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff",
    },
  });
}
