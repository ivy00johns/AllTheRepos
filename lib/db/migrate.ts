import { getDb } from "./client";

async function main() {
  // getDb() runs drizzle migrate + FTS setup + seed as a side effect.
  getDb();
  console.log("[backend] db migrated");
}

main().catch((err) => {
  console.error("[backend] db:migrate failed", err);
  process.exit(1);
});
