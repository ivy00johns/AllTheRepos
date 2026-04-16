import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: [
    "better-sqlite3",
    "@lancedb/lancedb",
    "simple-git",
    "find-git-repositories",
  ],
  experimental: {
    serverActions: { bodySizeLimit: "4mb" },
  },
};

export default config;
