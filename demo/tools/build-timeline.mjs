// Resync the film to the narration.
//
// Inputs:  audio_request.json (the written script lines), assets/voice/NN.wav,
//          assets/voice/words/NN.json (word timings from `hyperframes transcribe`).
// Outputs: compositions/captions.html (GROUPS + DURATION), index.html (scene,
//          voice, clip, BGM and root timings), assets/bgm/track.loop.mp3.
//
// Captions show the WRITTEN script words, not whisper's spelling. Each script
// word is aligned to a transcript word by edit distance, so its timing comes
// from the spoken word while its text stays as written.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GAP = 0; // no gap: each shot starts the moment the previous line ends
const TAIL = 0.6; // hold after the last line
const round = (n) => Math.round(n * 1000) / 1000;

const req = JSON.parse(fs.readFileSync(path.join(root, "audio_request.json"), "utf8"));
const lines = req.lines;

function wavSeconds(file) {
  const b = fs.readFileSync(file);
  const rate = b.readUInt32LE(24);
  const ch = b.readUInt16LE(22);
  const bytes = b.readUInt16LE(34) / 8;
  let p = 12;
  while (p < b.length - 8) {
    const id = b.toString("ascii", p, p + 4);
    const size = b.readUInt32LE(p + 4);
    if (id === "data") return size / (rate * ch * bytes);
    p += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${file}`);
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Edit-distance alignment. Returns, per script token, the index of the
// transcript token it matches, or null when the script word has no counterpart.
function align(scriptTokens, tx) {
  const n = scriptTokens.length;
  const m = tx.length;
  const a = scriptTokens.map(norm);
  const b = tx.map((w) => norm(w.text));
  const D = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 0; i <= n; i++) D[i][0] = i;
  for (let j = 0; j <= m; j++) D[0][j] = j;
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      D[i][j] = Math.min(D[i - 1][j - 1] + cost, D[i - 1][j] + 1, D[i][j - 1] + 1);
    }
  }
  const out = new Array(n).fill(null);
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    if (D[i][j] === D[i - 1][j - 1] + cost) {
      out[i - 1] = j - 1;
      i--;
      j--;
    } else if (D[i][j] === D[i - 1][j] + 1) {
      i--;
    } else {
      j--;
    }
  }
  return out;
}

// Per-line word timings in line-local seconds, with the written text.
function wordsFor(line, duration) {
  const tokens = line.text.split(/\s+/).filter(Boolean);
  const tx = JSON.parse(fs.readFileSync(path.join(root, "assets/voice/words", `${line.id}.json`), "utf8"));
  const map = align(tokens, tx);
  const words = tokens.map((text, k) => {
    const t = map[k] === null ? null : tx[map[k]];
    return { text, start: t ? t.start : null, end: t ? t.end : null };
  });
  // Unmatched script words take the time between their neighbours.
  for (let k = 0; k < words.length; k++) {
    if (words[k].start !== null) continue;
    const prev = words.slice(0, k).reverse().find((w) => w.end !== null);
    const next = words.slice(k + 1).find((w) => w.start !== null);
    words[k].start = prev ? prev.end : 0;
    words[k].end = next ? next.start : duration;
  }
  for (let k = 0; k < words.length; k++) {
    const nextStart = k + 1 < words.length ? words[k + 1].start : duration;
    words[k].end = Math.max(words[k].start + 0.05, Math.min(words[k].end, nextStart));
    if (k > 0) words[k].start = Math.max(words[k].start, words[k - 1].end);
  }
  return words;
}

// Chunk words into caption groups: break on a pause, after punctuation, or at 4 words.
function groupWords(words, frame, offset, groupStartIndex) {
  const groups = [];
  let cur = [];
  const flush = () => {
    if (!cur.length) return;
    const g = groupStartIndex + groups.length;
    groups.push({
      id: `caption-group-${g}`,
      frame,
      start: round(cur[0].start + offset),
      end: round(cur.at(-1).end + offset),
      text: cur.map((w) => w.text).join(" "),
      words: cur.map((w, i) => ({
        id: `caption-word-${g}-${i}`,
        text: w.text,
        start: round(w.start + offset),
        end: round(w.end + offset),
      })),
    });
    cur = [];
  };
  words.forEach((w, k) => {
    const prev = cur.at(-1);
    if (prev && w.start - prev.end > 0.25) flush();
    cur.push(w);
    if (/[.?!,;:]$/.test(w.text) || cur.length >= 4) flush();
    void k;
  });
  flush();
  return groups;
}

// --- timing plan -----------------------------------------------------------
const durations = lines.map((l) => round(wavSeconds(path.join(root, "assets/voice", `${l.id}.wav`))));
const offsets = [];
let cursor = 0;
for (const d of durations) {
  offsets.push(round(cursor));
  cursor += d + GAP;
}
const total = round(offsets.at(-1) + durations.at(-1) + TAIL);

// Captions
let groups = [];
lines.forEach((line, i) => {
  const words = wordsFor(line, durations[i]);
  groups = groups.concat(groupWords(words, i + 1, offsets[i], groups.length));
});

const capPath = path.join(root, "compositions/captions.html");
let cap = fs.readFileSync(capPath, "utf8");
const groupsLine = `  var GROUPS = ${JSON.stringify(groups)};`;
if (!/^ {2}var GROUPS = .*;$/m.test(cap) || !/^ {2}var DURATION = .*;$/m.test(cap)) {
  throw new Error("captions.html: GROUPS/DURATION lines not found");
}
cap = cap.replace(/^ {2}var GROUPS = .*;$/m, () => groupsLine);
cap = cap.replace(/^ {2}var DURATION = .*;$/m, () => `  var DURATION = ${total};`);
cap = cap.replace(/data-duration="[^"]*"/, `data-duration="${total}"`);
fs.writeFileSync(capPath, cap);

// Timeline in index.html
const indexPath = path.join(root, "index.html");
let html = fs.readFileSync(indexPath, "utf8");

function setAttrs(id, attrs) {
  const re = new RegExp(`<[^>]*\\bid="${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>`);
  const m = html.match(re);
  if (!m) throw new Error(`index.html: no element id="${id}"`);
  let tag = m[0];
  for (const [k, v] of Object.entries(attrs)) {
    const attr = new RegExp(`${k}="[^"]*"`);
    if (!attr.test(tag)) throw new Error(`index.html: ${id} has no ${k}`);
    tag = tag.replace(attr, `${k}="${v}"`);
  }
  html = html.replace(m[0], tag);
}

function readAttr(id, name) {
  const m = html.match(new RegExp(`<[^>]*\\bid="${id}"[^>]*>`));
  const a = m && m[0].match(new RegExp(`${name}="([^"]*)"`));
  return a ? Number(a[1]) : null;
}

const frameNames = lines.map((_, i) => {
  const comp = [...html.matchAll(/data-composition-id="(\d{2}-[a-z-]+)" data-composition-src="compositions\/frames\/[^"]+"/g)].map((x) => x[1]);
  return comp[i];
});

lines.forEach((line, i) => {
  const name = frameNames[i];
  if (!name) throw new Error(`no frame composition for line ${line.id}`);
  const oldStart = readAttr(`el-${name}`, "data-start");
  const frameStart = offsets[i];
  const frameDur = round(durations[i] + GAP);
  setAttrs(`el-${name}`, { "data-start": frameStart, "data-duration": frameDur });
  setAttrs(`el-${name}-voice`, { "data-start": frameStart, "data-duration": durations[i] });
  // Clips keep their offset from the frame start and are trimmed to the new slot.
  const clipIds = [...html.matchAll(new RegExp(`id="(el-${name}-video-\\d+)"`, "g"))].map((x) => x[1]);
  for (const cid of clipIds) {
    // Stills start with their frame and hold for its full slot, so no blank panel shows before the image.
    if (new RegExp(`<img[^>]*\\bid="${cid}"`).test(html)) {
      setAttrs(cid, { "data-start": frameStart, "data-duration": frameDur });
      continue;
    }
    const cStart = readAttr(cid, "data-start");
    const offset = round(cStart - oldStart);
    const avail = round(frameDur - offset - 0.2);
    setAttrs(cid, { "data-start": round(frameStart + offset), "data-duration": round(avail) });
  }
});

// Scene fades: each scene fades in at its own start, and the previous scene fades out at the same moment.
lines.forEach((_, i) => {
  const name = frameNames[i];
  const start = offsets[i];
  html = html.replace(new RegExp(`(tl\\.fromTo\\("#el-${name}", \\{ opacity: 0 \\}, \\{[^\\n]*\\}, )[0-9.]+\\);`), (m, pre) => `${pre}${start});`);
  if (i > 0) {
    const prev = frameNames[i - 1];
    html = html.replace(new RegExp(`(tl\\.to\\("#el-${prev}", \\{ opacity: 0,[^\\n]*\\}, )[0-9.]+\\);`), (m, pre) => `${pre}${start});`);
  }
});

setAttrs("el-captions", { "data-duration": total });
setAttrs("el-bgm", { "data-duration": total });
setAttrs("root", { "data-duration": total });
fs.writeFileSync(indexPath, html);

// BGM: loop the source track to the film length.
const bgm = path.join(root, "assets/bgm/track.loop.mp3");
execFileSync("ffmpeg", [
  "-y", "-v", "error", "-stream_loop", "-1", "-i", path.join(root, "assets/bgm/track.mp3"),
  "-t", String(total), "-c:a", "libmp3lame", "-q:a", "3", bgm,
]);

// Report
console.log(`lines: ${lines.length}  groups: ${groups.length}  total: ${total}s`);
lines.forEach((l, i) => {
  console.log(`${l.id} frame@${offsets[i]} voice=${durations[i]} ends=${round(offsets[i] + durations[i])}`);
});
