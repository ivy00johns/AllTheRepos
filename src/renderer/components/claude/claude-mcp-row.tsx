/**
 * ClaudeMcpRow — single MCP server entry merged from `.mcp.json`
 * (per-project) and `~/.claude/settings.json` (global).
 *
 * Compact one-line row with type badge + status pill + source.
 */

import { Plug } from "lucide-react";

import type { ClaudeMcpServer } from "@shared/types";
import { Badge } from "@renderer/components/ui/badge";

interface ClaudeMcpRowProps {
  server: ClaudeMcpServer;
}

const STATUS_VARIANT: Record<
  ClaudeMcpServer["status"],
  "default" | "secondary" | "destructive"
> = {
  running: "default",
  configured: "secondary",
  unavailable: "destructive",
};

const STATUS_LABEL: Record<ClaudeMcpServer["status"], string> = {
  running: "running",
  configured: "configured",
  unavailable: "unavailable",
};

export function ClaudeMcpRow({ server }: ClaudeMcpRowProps) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs">
      <Plug className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
      <span className="truncate font-mono font-semibold text-foreground">
        {server.name}
      </span>
      <Badge variant="outline" className="font-mono text-[10px] uppercase">
        {server.type}
      </Badge>
      <Badge
        variant={STATUS_VARIANT[server.status]}
        className="font-mono text-[10px]"
      >
        {STATUS_LABEL[server.status]}
      </Badge>
      <span className="ml-auto truncate font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {server.configuredIn}
      </span>
    </div>
  );
}
