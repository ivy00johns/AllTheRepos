/**
 * Replace literal NUL bytes in source files with their escape sequence.
 *
 * Two files used a raw NUL character as a map-key separator between two
 * slugs. The separator choice is sound — NUL cannot occur in a slug — but
 * embedding the raw byte makes the file "binary" to `file`, `grep`, `git
 * diff` and code-review tooling. Worse, grep does not error: it exits 1
 * and prints nothing, so a search looks like "no matches" when it never
 * read the file at all.
 *
 * Writing the escape instead produces a byte-identical runtime string.
 */

import fs from "node:fs";

const TARGETS = [
  "src/main/services/graph.ts",
  "src/renderer/components/graph/graph-canvas.tsx",
];

const NUL = Buffer.from([0]);
const ESCAPE = Buffer.from("\\u0000", "utf8");

for (const file of TARGETS) {
  const raw = fs.readFileSync(file);
  let count = 0;
  for (const byte of raw) if (byte === 0) count++;
  if (count === 0) {
    console.log(`  ${file}: already clean`);
    continue;
  }
  const parts = [];
  let start = 0;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === 0) {
      parts.push(raw.subarray(start, i), ESCAPE);
      start = i + 1;
    }
  }
  parts.push(raw.subarray(start));
  fs.writeFileSync(file, Buffer.concat(parts));
  console.log(`  ${file}: replaced ${count} literal NUL byte(s)`);
}
void NUL;
