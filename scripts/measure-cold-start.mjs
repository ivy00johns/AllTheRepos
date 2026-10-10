#!/usr/bin/env node
/**
 * measure-cold-start.mjs — how long a launch takes to put the app on screen.
 *
 * ATR-055 is the claim that the window waits for every service to boot, so the
 * number that matters is wall-clock from spawning the app to a window with the
 * shell rendered in it — measured from outside, the way a person experiences
 * it, rather than from a timestamp inside the code being measured.
 *
 * Three marks, in the order they happen:
 *   window     — Playwright resolved `firstWindow()`: a window exists
 *   dom        — the bundle parsed and the document loaded
 *   shell      — the top-bar brand link is on screen: the renderer is mounted
 *
 * Each run gets its own throwaway `--user-data-dir`, because the app holds a
 * single-instance lock: without it a launch collides with the copy a developer
 * already has open, quits, and the measurement reads as a crash. `ATR_E2E=1`
 * keeps the runs from stealing focus (it hides the dock icon, which happens
 * before anything that is measured).
 *
 * Usage:
 *   node scripts/measure-cold-start.mjs [--runs 3] [--json]
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { _electron as electron } from "@playwright/test";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAIN_ENTRY = path.join(repoRoot, "out", "main", "index.js");

const args = process.argv.slice(2);
const valueOf = (flag, fallback) => {
  const index = args.indexOf(flag);
  return index === -1 ? fallback : args[index + 1];
};
const RUNS = Number(valueOf("--runs", "3"));
const AS_JSON = args.includes("--json");

/** One timed launch. Returns the three marks in milliseconds from spawn. */
async function measureOnce() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "atr-cold-start-"));
  const startedAt = Date.now();
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${profile}`],
    cwd: repoRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      ATR_E2E: "1",
      ELECTRON_DISABLE_SECURITY_WARNINGS: "1",
    },
  });

  try {
    const win = await app.firstWindow();
    const window_ = Date.now() - startedAt;
    await win.waitForLoadState("domcontentloaded");
    const dom = Date.now() - startedAt;
    await win.getByRole("link", { name: /^AllTheRepos$/i }).waitFor({
      state: "visible",
      timeout: 60_000,
    });
    const shell = Date.now() - startedAt;
    return { window: window_, dom, shell };
  } finally {
    await app.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1] + sorted[middle]) / 2)
    : sorted[middle];
}

if (!fs.existsSync(MAIN_ENTRY)) {
  console.error(
    `[cold-start] ${MAIN_ENTRY} is missing — run \`pnpm electron:build\` first.`,
  );
  process.exit(2);
}

const runs = [];
for (let index = 0; index < RUNS; index += 1) {
  runs.push(await measureOnce());
}

const summary = {
  runs,
  median: {
    window: median(runs.map((run) => run.window)),
    dom: median(runs.map((run) => run.dom)),
    shell: median(runs.map((run) => run.shell)),
  },
};

if (AS_JSON) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  for (const [index, run] of runs.entries()) {
    console.log(
      `[cold-start] run ${index + 1}: window ${run.window}ms · dom ${run.dom}ms · shell ${run.shell}ms`,
    );
  }
  console.log(
    `[cold-start] median of ${RUNS}: window ${summary.median.window}ms · ` +
      `dom ${summary.median.dom}ms · shell ${summary.median.shell}ms`,
  );
}
