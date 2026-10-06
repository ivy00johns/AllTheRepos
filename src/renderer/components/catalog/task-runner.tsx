/**
 * Task runner — the project's own commands, one click away.
 *
 * Shows what a repo declares it can do (npm scripts, Makefile targets,
 * compose services, …) and runs one with its output streamed inline.
 * The value isn't that it beats a terminal — it's that you don't have to
 * remember which of 150 projects used `pnpm dev` versus `make serve`,
 * or go find the folder first.
 *
 * Output is a plain scroll region pinned to the bottom while running.
 * A real terminal emulator would be the wrong trade here: these are
 * build and dev logs, not interactive sessions, and shipping xterm.js
 * would cost more than it returns.
 */

import * as React from "react";
import {
  ChevronRight,
  Loader2,
  Play,
  Square,
  Terminal,
  Trash2,
} from "lucide-react";

import type { RepoTask } from "@shared/types";

import { cn } from "@renderer/lib/cn";
import {
  useRepoTasks,
  useStartTask,
  useStopTask,
  type TaskRunState,
} from "@renderer/hooks/use-actions";

interface TaskRunnerProps {
  slug: string;
  /** Live output for every run, keyed by run id. */
  runs: Record<string, TaskRunState>;
  onClearRun: (runId: string) => void;
}

/** Colour the source badge so the origin of a task is scannable. */
const SOURCE_TONE: Record<string, string> = {
  "package.json": "text-activity-warm",
  Makefile: "text-own-local",
  justfile: "text-own-local",
  "docker-compose": "text-activity-active",
  Procfile: "text-activity-active",
};

function TaskRow({
  task,
  running,
  onStart,
  onStop,
}: {
  task: RepoTask;
  running: TaskRunState | null;
  onStart: () => void;
  onStop: () => void;
}) {
  const isRunning = running?.running ?? false;
  return (
    <div className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-surface-raised">
      <button
        type="button"
        onClick={isRunning ? onStop : onStart}
        aria-label={isRunning ? `Stop ${task.name}` : `Run ${task.name}`}
        className={cn(
          "flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded transition-colors duration-150",
          isRunning
            ? "bg-warning/20 text-warning hover:bg-warning/30"
            : "bg-accent/15 text-accent hover:bg-accent/25",
        )}
      >
        {isRunning ? (
          <Square className="h-3 w-3 fill-current" aria-hidden />
        ) : (
          <Play className="h-3 w-3 fill-current" aria-hidden />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="atr-truncate font-mono text-xs text-foreground">
            {task.name}
          </span>
          <span
            className={cn(
              "shrink-0 font-mono text-[9px] uppercase tracking-wide",
              SOURCE_TONE[task.source] ?? "text-muted-foreground/60",
            )}
          >
            {task.source}
          </span>
        </div>
        <p className="atr-truncate font-mono text-[10px] text-muted-foreground">
          {task.detail || task.command}
        </p>
      </div>

      {isRunning ? (
        <Loader2
          className="h-3 w-3 shrink-0 animate-spin text-warning"
          aria-hidden
        />
      ) : null}
    </div>
  );
}

function OutputPane({
  run,
  onClear,
}: {
  run: TaskRunState;
  onClear: () => void;
}) {
  const scrollRef = React.useRef<HTMLPreElement>(null);

  // Follow the tail while running. Once it exits, stop hijacking the
  // scroll so the user can read back through what happened.
  React.useEffect(() => {
    if (!run.running) return;
    const node = scrollRef.current;
    if (node) node.scrollTop = node.scrollHeight;
  }, [run.lines, run.running]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-t border-border px-3 py-1.5">
        <Terminal
          className="h-3 w-3 shrink-0 text-muted-foreground"
          aria-hidden
        />
        <span className="atr-meta">
          {run.running
            ? "running"
            : run.exitCode === 0
              ? "finished"
              : `exited ${run.exitCode}`}
        </span>
        <button
          type="button"
          onClick={onClear}
          aria-label="Clear output"
          className="ml-auto cursor-pointer rounded p-0.5 text-muted-foreground transition-colors duration-150 hover:text-foreground"
        >
          <Trash2 className="h-3 w-3" aria-hidden />
        </button>
      </div>
      <pre
        ref={scrollRef}
        className="min-h-0 flex-1 overflow-auto bg-background px-3 py-2 font-mono text-[11px] leading-relaxed text-muted-foreground"
      >
        {run.lines.join("\n")}
      </pre>
    </div>
  );
}

export function TaskRunner({ slug, runs, onClearRun }: TaskRunnerProps) {
  const [expanded, setExpanded] = React.useState(true);
  const tasksQuery = useRepoTasks(slug);
  const startTask = useStartTask();
  const stopTask = useStopTask();
  const [notice, setNotice] = React.useState<string | null>(null);

  const tasks = tasksQuery.data?.tasks ?? [];

  /** Runs belonging to this repo, newest last. */
  const repoRuns = React.useMemo(
    () => Object.values(runs).filter((run) => run.slug === slug),
    [runs, slug],
  );
  const latestRun = repoRuns[repoRuns.length - 1] ?? null;

  const runByTaskId = React.useMemo(() => {
    const map = new Map<string, TaskRunState>();
    // A task's button reflects its own run, so a `dev` that's up doesn't
    // make `build` look like it's running too.
    for (const run of repoRuns) {
      if (run.running) map.set(runTaskId(run), run);
    }
    return map;
  }, [repoRuns]);

  const handleStart = async (task: RepoTask) => {
    setNotice(null);
    const result = await startTask.mutateAsync({ slug, taskId: task.id });
    if (!result.started) setNotice(result.reason);
    else if (result.runId) taskIdByRun.set(result.runId, task.id);
  };

  // A project with nothing to run gets no section at all. "No tasks
  // found" is not actionable, and the detail panel is already dense.
  if (tasks.length === 0) return null;

  return (
    <section className="flex min-h-0 flex-col">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        aria-expanded={expanded}
        className="flex cursor-pointer items-center gap-1.5 px-4 py-2 text-left transition-colors duration-150 hover:bg-surface-raised"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-150",
            expanded && "rotate-90",
          )}
          aria-hidden
        />
        <span className="font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Tasks
        </span>
        <span className="atr-meta">{tasks.length}</span>
      </button>

      {expanded ? (
        <>
          <div className="flex flex-col px-2 pb-2">
            {tasks.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                running={runByTaskId.get(task.id) ?? null}
                onStart={() => void handleStart(task)}
                onStop={() => {
                  const run = runByTaskId.get(task.id);
                  if (run) stopTask.mutate(run.runId);
                }}
              />
            ))}
          </div>

          {notice ? (
            <p role="alert" className="px-4 pb-2 text-[11px] text-warning">
              {notice}
            </p>
          ) : null}

          {latestRun ? (
            <div className="h-56 min-h-0">
              <OutputPane
                run={latestRun}
                onClear={() => onClearRun(latestRun.runId)}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

/**
 * Run → task mapping.
 *
 * The output stream carries a run id, not a task id, so the mapping is
 * recorded when a run starts. Module-level because it must survive the
 * component unmounting when you click away and back — a `dev` server
 * left running should still show as running.
 */
const taskIdByRun = new Map<string, string>();

function runTaskId(run: TaskRunState): string {
  return taskIdByRun.get(run.runId) ?? "";
}
