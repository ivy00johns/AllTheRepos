/**
 * ClaudeSkillCard — single skill row from `.claude/skills/<name>/SKILL.md`.
 *
 * Shape mirrors `ClaudeSkill`: name, description, path,
 * frontmatter. We surface name + description prominently and expose
 * a tiny "open file" affordance that copies the absolute path to the
 * clipboard (the renderer cannot drive an editor directly — that
 * goes through LauncherService).
 */

import { ExternalLink, Wand2 } from "lucide-react";

import type { ClaudeSkill } from "@shared/types";
import { Button } from "@renderer/components/ui/button";

interface ClaudeSkillCardProps {
  skill: ClaudeSkill;
}

export function ClaudeSkillCard({ skill }: ClaudeSkillCardProps) {
  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(skill.path);
    } catch {
      // Clipboard can fail in non-secure contexts; the silent
      // fallback is acceptable for an affordance, not a destructive
      // action.
    }
  };

  return (
    <article className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
      <div className="flex items-start gap-2">
        <Wand2
          className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent"
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm font-semibold text-foreground">
            {skill.name}
          </p>
          {skill.description ? (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {skill.description}
            </p>
          ) : (
            <p className="mt-0.5 text-xs italic text-muted-foreground">
              No description.
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0"
          aria-label={`Copy path for ${skill.name}`}
          title={skill.path}
          onClick={handleCopyPath}
        >
          <ExternalLink className="h-3 w-3" aria-hidden />
        </Button>
      </div>
    </article>
  );
}
