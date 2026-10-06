#!/usr/bin/env node
/**
 * Generate the macOS app icon (`resources/icon.icns`).
 *
 * Written as a generator rather than a checked-in binary so the icon
 * stays in lockstep with the app's design tokens — the same near-black
 * surface and accent green the UI uses. Change the palette in one place
 * and re-run.
 *
 * No image dependencies: it writes raw RGBA and encodes PNG with zlib,
 * which Node ships. `iconutil` (macOS) turns the iconset into `.icns`.
 *
 * Usage: node scripts/make-icons.mjs
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RESOURCES = path.join(ROOT, "resources");

// --- design tokens, mirroring src/renderer/styles/globals.css ---------------
const SURFACE_TOP = [0x1c, 0x26, 0x34];
const SURFACE_BOTTOM = [0x0b, 0x0f, 0x14];
const ACCENT = [0x22, 0xc5, 0x5e];
const BAR_MUTED = [0x56, 0x6b, 0x8c];
const BAR_DIM = [0x2d, 0x39, 0x45];

// --- tiny PNG encoder -------------------------------------------------------

function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

/** Encode RGBA pixel data (Uint8Array, size*size*4) as a PNG buffer. */
function encodePng(rgba, size) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  // 10..12: compression, filter, interlace — all 0.

  // Each scanline is prefixed with filter byte 0 (None).
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(
      raw,
      y * (stride + 1) + 1,
    );
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// --- drawing helpers --------------------------------------------------------

/** Coverage of a rounded rectangle at (x, y), antialiased via 3×3 sampling. */
function roundedRectCoverage(x, y, rect) {
  const { left, top, right, bottom, radius } = rect;
  let hits = 0;
  for (let sy = 0; sy < 3; sy++) {
    for (let sx = 0; sx < 3; sx++) {
      const px = x + (sx + 0.5) / 3;
      const py = y + (sy + 0.5) / 3;
      if (px < left || px > right || py < top || py > bottom) continue;
      // Distance to the nearest corner centre decides the rounded part.
      const cx =
        px < left + radius
          ? left + radius
          : px > right - radius
            ? right - radius
            : px;
      const cy =
        py < top + radius
          ? top + radius
          : py > bottom - radius
            ? bottom - radius
            : py;
      const dx = px - cx;
      const dy = py - cy;
      if (dx * dx + dy * dy <= radius * radius) hits++;
    }
  }
  return hits / 9;
}

function blend(dst, index, colour, alpha) {
  if (alpha <= 0) return;
  const inv = 1 - alpha;
  dst[index] = Math.round(colour[0] * alpha + dst[index] * inv);
  dst[index + 1] = Math.round(colour[1] * alpha + dst[index + 1] * inv);
  dst[index + 2] = Math.round(colour[2] * alpha + dst[index + 2] * inv);
  dst[index + 3] = Math.round(255 * alpha + dst[index + 3] * inv);
}

/**
 * Draw the icon at `size`.
 *
 * The mark is a stack of bars — a catalog of projects — with the top one
 * in the accent colour, reading as "the one you're on". It stays legible
 * at 16px because it's three shapes and nothing else.
 */
function drawIcon(size) {
  const rgba = new Uint8Array(size * size * 4);
  const s = (v) => (v * size) / 1024;

  // macOS Big Sur icon geometry: art fills a rounded square inset from
  // the canvas, not the full bleed.
  const inset = s(100);
  const plate = {
    left: inset,
    top: inset,
    right: size - inset,
    bottom: size - inset,
    radius: s(185),
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const coverage = roundedRectCoverage(x, y, plate);
      if (coverage <= 0) continue;
      const t = (y - plate.top) / (plate.bottom - plate.top);
      const colour = [
        SURFACE_TOP[0] + (SURFACE_BOTTOM[0] - SURFACE_TOP[0]) * t,
        SURFACE_TOP[1] + (SURFACE_BOTTOM[1] - SURFACE_TOP[1]) * t,
        SURFACE_TOP[2] + (SURFACE_BOTTOM[2] - SURFACE_TOP[2]) * t,
      ];
      blend(rgba, (y * size + x) * 4, colour, coverage);
    }
  }

  // Three stacked bars, indented like a tree.
  const bars = [
    { x: s(255), w: s(514), colour: ACCENT },
    { x: s(320), w: s(384), colour: BAR_MUTED },
    { x: s(320), w: s(300), colour: BAR_DIM },
  ];
  const barHeight = s(104);
  const gap = s(58);
  const totalHeight = bars.length * barHeight + (bars.length - 1) * gap;
  let barY = (size - totalHeight) / 2;

  for (const bar of bars) {
    const rect = {
      left: bar.x,
      top: barY,
      right: bar.x + bar.w,
      bottom: barY + barHeight,
      radius: barHeight / 2,
    };
    for (let y = Math.floor(rect.top); y < Math.ceil(rect.bottom); y++) {
      for (let x = Math.floor(rect.left); x < Math.ceil(rect.right); x++) {
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const coverage = roundedRectCoverage(x, y, rect);
        blend(rgba, (y * size + x) * 4, bar.colour, coverage);
      }
    }
    barY += barHeight + gap;
  }

  return rgba;
}

// --- build ------------------------------------------------------------------

// The sizes `iconutil` expects in an .iconset.
const ICONSET = [
  ["icon_16x16.png", 16],
  ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32],
  ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128],
  ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256],
  ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512],
  ["icon_512x512@2x.png", 1024],
];

const iconsetDir = path.join(RESOURCES, "icon.iconset");
fs.rmSync(iconsetDir, { recursive: true, force: true });
fs.mkdirSync(iconsetDir, { recursive: true });

const cache = new Map();
for (const [name, size] of ICONSET) {
  if (!cache.has(size)) cache.set(size, encodePng(drawIcon(size), size));
  fs.writeFileSync(path.join(iconsetDir, name), cache.get(size));
}

// A standalone 1024 PNG too — electron-builder uses it for non-mac
// targets, and it's handy for READMEs and store listings.
fs.writeFileSync(path.join(RESOURCES, "icon.png"), cache.get(1024));

execFileSync("iconutil", [
  "-c",
  "icns",
  iconsetDir,
  "-o",
  path.join(RESOURCES, "icon.icns"),
]);
fs.rmSync(iconsetDir, { recursive: true, force: true });

const icns = path.join(RESOURCES, "icon.icns");
console.log(
  `[icons] wrote ${path.relative(ROOT, icns)} (${(fs.statSync(icns).size / 1024).toFixed(0)} KB) and icon.png`,
);
