/**
 * ClaudeAgentCard — single agent row from `.claude/agents/<slug>.md`.
 *
 * Mirrors `ClaudeSkillCard` — same shape, different icon. Kept as a
 * separate component (rather than a shared "claude-thing-card") so
 * a future divergence (e.g. an agent-only field) doesn't require
 * unwinding a union prop type.
 */

import { ExternalLink } from "lucide-react";

import type { ClaudeAgent } from "@shared/types";
import { Button } from "@renderer/components/ui/button";

interface ClaudeAgentCardProps {
  agent: ClaudeAgent;
}

export function ClaudeAgentCard({ agent }: ClaudeAgentCardProps) {
  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(agent.path);
    } catch {
      // ignore — see ClaudeSkillCard rationale
    }
  };

  return (
    <article className="flex flex-col gap-1 border-t border-border/60 py-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-body font-medium text-foreground">
            {agent.name}
          </p>
          {agent.description ? (
            <p className="mt-0.5 text-label leading-relaxed text-muted-foreground">
              {agent.description}
            </p>
          ) : (
            <p className="mt-0.5 text-label italic text-muted-foreground">
              No description.
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          aria-label={`Copy path for ${agent.name}`}
          title={agent.path}
          onClick={handleCopyPath}
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
        </Button>
      </div>
    </article>
  );
}
