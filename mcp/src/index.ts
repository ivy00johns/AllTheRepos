/**
 * AllTheRepos MCP server.
 *
 * Read the catalog; assert curated relationships. That is the entire
 * surface — no command execution, no filesystem mutation, no git. See
 * `docs/COMMAND-DISCLOSURE.md`.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { openCatalog } from "./catalog.js";
import { registerReadTools } from "./tools/read.js";
import { registerWriteTools } from "./tools/write.js";

const server = new McpServer({
  name: "alltherepos",
  version: "0.1.0",
});

openCatalog();
registerReadTools(server);
registerWriteTools(server);

await server.connect(new StdioServerTransport());
