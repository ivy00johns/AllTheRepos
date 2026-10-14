import { simpleGit, type SimpleGit } from "simple-git";

/** Fixed app-owned overrides only: never accept renderer/repository config here. */
export function catalogGit(baseDir: string): SimpleGit {
  return simpleGit({
    baseDir,
    config: ["core.fsmonitor=false", "core.hooksPath=/dev/null", "core.pager=cat"],
    // These flags permit only the hardcoded *disabling* overrides above.
    unsafe: { allowUnsafeFsMonitor: true, allowUnsafeHooksPath: true, allowUnsafePager: true },
    allowEnvironment: ["GIT_OPTIONAL_LOCKS"],
    timeout: { block: 15_000 },
  }).env("GIT_OPTIONAL_LOCKS", "0");
}
