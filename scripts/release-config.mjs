#!/usr/bin/env node
/**
 * The release repo is published to, read from one place by the scripts.
 *
 * `electron-builder.yml`'s `publish` block is the source of truth for where
 * artifacts go, and it is the same value electron-builder writes into the
 * bundled `app-update.yml` — so scripts that need to talk to that repo read it
 * from there rather than being handed a second copy to keep in step.
 *
 * `tests/unit/main/services/updater-feed.spec.ts` pins this block against the
 * app's `FEED_OWNER`/`FEED_REPO` constants and the workflow's `RELEASES_REPO`,
 * which is what makes reading it dynamically safe.
 *
 * Plain text scanning rather than a YAML parser on purpose: this repository
 * has no YAML dependency, and the block is four lines of `key: value`.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * `owner/repo` from the `publish` block of electron-builder.yml.
 *
 * @param {string} [root] repository root, for tests.
 * @returns {string}
 */
export function readReleasesRepo(root = ROOT) {
  const configPath = path.join(root, "electron-builder.yml");
  const yaml = fs.readFileSync(configPath, "utf8");

  const start = yaml.indexOf("publish:");
  if (start === -1) {
    throw new Error(`${configPath} has no publish: block`);
  }

  // The block ends at the next line that starts in column zero.
  const lines = yaml.slice(start).split("\n");
  const block = [lines[0]];
  for (const line of lines.slice(1)) {
    if (/^\S/.test(line)) break;
    block.push(line);
  }
  const text = block.join("\n");

  const owner = /\n\s+owner:\s*(\S+)/.exec(text)?.[1];
  const repo = /\n\s+repo:\s*(\S+)/.exec(text)?.[1];
  if (!owner || !repo) {
    throw new Error(
      "the publish: block in electron-builder.yml is missing owner: or repo:",
    );
  }
  return `${owner}/${repo}`;
}
