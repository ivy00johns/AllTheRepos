import type { Config } from "drizzle-kit";
import os from "node:os";
import path from "node:path";

const dataDir = process.env.ATR_DATA_DIR ?? path.join(os.homedir(), ".alltherepos");

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "sqlite",
  dbCredentials: {
    url: path.join(dataDir, "alltherepos.db"),
  },
} satisfies Config;
