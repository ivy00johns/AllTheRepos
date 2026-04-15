import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * Contract conformance:
 *   (1) contracts/types.ts text == lib/types.ts text (normalized)
 *   (2) Each documented route in contracts/api.md responds with the expected
 *       envelope shape. Only runs when E2E_BASE_URL is set — keeps the unit
 *       run fast and offline.
 */

const BASE_URL = process.env.E2E_BASE_URL;
const RUN_LIVE = !!BASE_URL;

describe("contract/conformance — text parity", () => {
  it("contracts/types.ts and lib/types.ts are identical (whitespace-normalized)", () => {
    const a = fs.readFileSync(
      path.join(process.cwd(), "contracts/types.ts"),
      "utf8",
    );
    const b = fs.readFileSync(
      path.join(process.cwd(), "lib/types.ts"),
      "utf8",
    );
    const norm = (s: string) =>
      s.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
    expect(norm(a)).toBe(norm(b));
  });
});

const live = RUN_LIVE ? describe : describe.skip;

live("contract/conformance — live API envelope shape", () => {
  it("GET /api/settings returns ApiOk<Settings>", async () => {
    const res = await fetch(`${BASE_URL}/api/settings`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data?: Record<string, unknown>;
    };
    expect(body.ok).toBe(true);
    expect(body.data).toBeDefined();
    expect(Array.isArray((body.data as { scanPaths: unknown }).scanPaths)).toBe(
      true,
    );
  });

  it("GET /api/repos returns ApiOk<RepoListResult>", async () => {
    const res = await fetch(`${BASE_URL}/api/repos`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      data?: { items: unknown[]; total: number; limit: number; offset: number };
    };
    expect(body.ok).toBe(true);
    expect(body.data).toBeDefined();
    expect(Array.isArray(body.data!.items)).toBe(true);
    expect(typeof body.data!.total).toBe("number");
  });

  it("GET /api/groups returns ApiOk<Group[]>", async () => {
    const res = await fetch(`${BASE_URL}/api/groups`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });

  it("GET /api/repos/[slug] returns 404 ApiError for missing", async () => {
    const res = await fetch(`${BASE_URL}/api/repos/does-not-exist`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as {
      ok: boolean;
      error?: { code: string; message: string };
    };
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe("NOT_FOUND");
  });

  it("POST /api/search returns ApiOk<SearchHit[]>", async () => {
    const res = await fetch(`${BASE_URL}/api/search`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "test", limit: 5 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data?: unknown[] };
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
  });
});
