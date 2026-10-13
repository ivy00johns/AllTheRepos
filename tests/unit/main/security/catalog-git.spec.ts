import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { catalogGit } from "@main/security/catalog-git";

describe("passive catalog Git reads", () => {
  it("does not execute a repository fsmonitor hook or refresh its index", async () => {
    const root = mkdtempSync(join(tmpdir(), "atr-git-safety-"));
    try {
      execFileSync("git", ["init", "-q", root]);
      const marker = join(root, "executed");
      const hook = join(root, "monitor.sh");
      writeFileSync(hook, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
      execFileSync("git", ["-C", root, "config", "core.fsmonitor", hook]);
      const git = catalogGit(root);
      await git.status();
      expect(existsSync(marker)).toBe(false);
      expect(await git.raw(["config", "core.fsmonitor"])).toBe("false\n");
      expect(await git.raw(["config", "core.hooksPath"])).toBe("/dev/null\n");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
