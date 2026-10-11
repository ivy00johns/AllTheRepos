#!/usr/bin/env node
/**
 * Re-instate the approved `<video>` elements that `assemble-index.mjs` hoists out
 * of the frame files and into `index.html`.
 *
 * Why this exists
 * ---------------
 * `assemble-index.mjs` scans each frame for `<video data-frame-video="approved">`,
 * moves it to the root of the assembled `index.html` and leaves a comment behind.
 * That is fine on a single pass — but the second pass reads frames that no longer
 * contain a video, hoists nothing, and rewrites `index.html` without a single
 * clip. The film then renders as ten empty window cards, and nothing in the
 * assemble summary says so: it only counts voices, bgm and captions.
 *
 * So the frame files are the source of truth and this script re-inserts the
 * element each time, immediately before every assemble. Run:
 *
 *   node tools/frame-videos.mjs && node <SKILL>/scripts/assemble-index.mjs …
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CARD = "data-frame-video-x=\"294\" data-frame-video-y=\"64\" data-frame-video-width=\"1332\" data-frame-video-height=\"832\" data-frame-video-fit=\"cover\"";
const MARKER = "<!-- approved frame video hoisted by assemble-index -->";

// frame id, clip, the frame-local second the clip starts at, the frame's duration.
// The clip's window is the REST of its frame (duration − start): the footage ends
// at its natural length and the browser holds its last frame, while the window
// stops at the frame's own end. A window equal to the frame's duration ran every
// clip 1.4s past its own frame — harmless mid-film, but the final one overran the
// root composition and lint reported `clip_ends_past_root_duration`.
const VIDEOS = [
  ["02-what-this-is", "02-catalog.webm", 1.4, 15.104],
  ["03-scan", "03-scan.webm", 2.0, 16.043],
  ["04-search", "04-search.webm", 1.2, 13.867],
  ["05-triage", "05-triage.webm", 2.0, 17.045],
  ["06-vocabulary", "06-vocabulary.webm", 1.2, 9.643],
  ["07-graph", "07-graph.webm", 2.0, 16.064],
  ["08-keeps-up", "08-live.webm", 1.4, 9.813],
  ["09-local-first", "09-local-first.webm", 1.4, 15.04],
  ["10-close", "10-close.webm", 1.4, 9.835],
];

const round3 = (n) => Math.round(n * 1000) / 1000;

let restored = 0;
let already = 0;

for (const [id, clip, start, duration] of VIDEOS) {
  const file = path.join(ROOT, "compositions", "frames", `${id}.html`);
  let html = fs.readFileSync(file, "utf8");

  if (html.includes(MARKER)) {
    // No `id`: the assembler mints `el-<compId>-video-<n>`, and an id that starts
    // with a digit (`#02-what-this-is-video`) is not a valid CSS selector.
    const element =
      `<video data-frame-video="approved" src="assets/captures/${clip}" ` +
      `data-start="${start}" data-duration="${round3(duration - start)}" data-track-index="0" ${CARD} muted playsinline></video>`;
    html = html.replace(MARKER, element);
    fs.writeFileSync(file, html);
    restored += 1;
  } else if (html.includes(`src="assets/captures/${clip}"`)) {
    already += 1;
  } else {
    console.error(`[frame-videos] ${id}: neither a hoisted video nor the hoist marker — check the frame`);
    process.exitCode = 1;
  }
}

console.log(`[frame-videos] restored ${restored} clip(s); ${already} already in place`);
