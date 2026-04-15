import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Create a unique temp directory under the OS tmpdir.
 * Caller is responsible for cleanup via `cleanupTmp()`.
 */
export function makeTmpDir(prefix = "atr-test"): string {
  const rand = crypto.randomBytes(6).toString("hex");
  const dir = path.join(os.tmpdir(), `${prefix}-${rand}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

export function cleanupTmp(dir: string | null | undefined): void {
  if (!dir) return;
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}
