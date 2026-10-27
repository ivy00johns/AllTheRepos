/**
 * ClaudeMcpRow — single MCP server entry merged from `.mcp.json`
 * (per-project) and `~/.claude/settings.json` (global).
 *
 * A hairline row rather than a bordered card: name at 13/500, the transport
 * and the source in mono meta, and the status as a dot + word, so three
 * servers read as a list instead of three boxes. The accent stays out of it —
 * `running` is the live green, `unavailable` is destructive, `configured` is
 * the quiet muted state it actually is.
 */

import type { ClaudeMcpServer } from "@shared/types";

interface ClaudeMcpRowProps {
  server: ClaudeMcpServer;
}

const STATUS_DOT: Record<ClaudeMcpServer["status"], string> = {
  running: "bg-status-live",
  configured: "bg-muted-foreground/50",
  unavailable: "bg-destructive",
};

const STATUS_LABEL: Record<ClaudeMcpServer["status"], string> = {
  running: "running",
  configured: "configured",
  unavailable: "unavailable",
};

export function ClaudeMcpRow({ server }: ClaudeMcpRowProps) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/60 py-2">
      <span className="truncate text-body font-medium text-foreground">
        {server.name}
      </span>
      <span className="font-mono atr-micro text-muted-foreground">
        {server.type}
      </span>
      <span className="flex items-center gap-1.5 font-mono atr-micro">
        <span
          aria-hidden
          className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[server.status]}`}
        />
        <span
          className={
            server.status === "unavailable"
              ? "text-destructive"
              : "text-muted-foreground"
          }
        >
          {STATUS_LABEL[server.status]}
        </span>
      </span>
      <span className="ml-auto font-mono atr-micro text-muted-foreground">
        {server.configuredIn}
      </span>
    </div>
  );
}
