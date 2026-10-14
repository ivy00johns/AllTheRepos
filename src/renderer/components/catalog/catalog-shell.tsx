/**
 * The catalog shell.
 *
 * Owns the three-pane layout (directory rail · repo views · detail
 * panel) and the derivations every pane depends on: ownership, folder
 * labels, which tags are too common to be worth showing, and the sorted
 * + filtered repo list.
 *
 * Those derivations live HERE, once, rather than inside each card. With
 * a few hundred repos and three view modes that difference is the
 * difference between a catalog that scrolls smoothly and one that
 * recomputes the same string a thousand times per frame.
 *
 * Search is driven by the `q` URL param, which the global top-bar search
 * writes. There is exactly one search input in the app now — the shell
 * previously rendered a second one directly beneath the first.
 */

import * as React from "react";
import { Link, useNavigate, useSearch } from "@tanstack/react-router";
import { RefreshCw, X } from "lucide-react";

import type { Group, Repo, RepoDetail } from "@shared/types";

import { KeyboardShortcuts } from "@renderer/components/layout/keyboard-shortcuts";
import { useGroupMemberSlugs } from "@renderer/hooks/use-groups";
import {
  useFetchRepos,
  usePullRepos,
  useTaskOutput,
} from "@renderer/hooks/use-actions";
import { useCatalogLive } from "@renderer/hooks/use-catalog-live";
import { useCovers } from "@renderer/hooks/use-cover";
import {
  useAddScanPath,
  usePickScanPath,
  useRescanPath,
} from "@renderer/hooks/use-scan-roots";
import { useLauncher } from "@renderer/hooks/use-launcher";
import { useSearch as useCatalogSearch } from "@renderer/hooks/use-search";
import { useSettings } from "@renderer/hooks/use-settings";
import { activityOf, lastTouched } from "@renderer/lib/activity";
import {
  HIDDEN_REASONS_ID,
  emptyStateCopy,
  hiddenReasons,
  type HiddenReasonKey,
} from "@renderer/lib/hidden-repos";
import {
  inferIdentities,
  ownershipOf,
  type OwnershipInfo,
} from "@renderer/lib/ownership";
import { nearMisses } from "@renderer/lib/near-miss";
import {
  isArchivedPath,
  isDirectlyIn,
  isUnder,
  owningRoot,
  tildify,
} from "@renderer/lib/repo-tree";
import { useCatalogView } from "@renderer/stores/catalog-view";
import { useUiStore } from "@renderer/stores/ui";

import { CatalogToolbar } from "./catalog-toolbar";
import { DetailPanel } from "./detail-panel";
import { DirRail } from "./dir-rail";
import { ScanRootDialog } from "./scan-root-dialog";
import { RepoGrid } from "./repo-grid";

interface CatalogShellProps {
  initialRepos: Repo[];
  groups: Group[];
  totalCount: number;
  loadRepoDetail: (slug: string) => Promise<RepoDetail | null>;
}

interface CatalogSearch {
  repo?: string;
  q?: string;
  lang?: string;
  tag?: string[];
  groupId?: string;
  dirty?: string;
}

/**
 * A tag on more than this share of the catalog tells you nothing about
 * any individual repo. `node`, `docker` and `ci` are all in this bucket
 * on a typical machine, and between them they were eating most of the
 * old card's body.
 */
const UBIQUITOUS_TAG_SHARE = 0.25;

/** A failed git sync, phrased the way the notice strip reads. */
function syncFailed(verb: "Fetch" | "Pull", error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `${verb} failed — ${detail}`;
}

export function CatalogShell({
  initialRepos,
  groups,
  totalCount,
  loadRepoDetail,
}: CatalogShellProps) {
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as CatalogSearch;

  const querySlug = search.repo ?? null;
  const queryQ = search.q ?? "";
  const dirtyOnly = search.dirty === "true";
  const sidebarCollapsed = useUiStore((s) => s.sidebarCollapsed);
  const queryGroupId = search.groupId ? Number(search.groupId) : null;

  const [detail, setDetail] = React.useState<RepoDetail | null>(null);
  /**
   * Whether the count's "what is hidden" strip is open. Collapsed by default —
   * the count states the difference, and the explanation is one click away
   * rather than a row that appears above the catalog uninvited.
   */
  const [explainHidden, setExplainHidden] = React.useState(false);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [removingRoot, setRemovingRoot] = React.useState<string | null>(null);
  const [rootNotice, setRootNotice] = React.useState<string | null>(null);

  const selectedDir = useCatalogView((s) => s.selectedDir);
  const selectedDirExact = useCatalogView((s) => s.selectedDirExact);
  const setSelectedDir = useCatalogView((s) => s.setSelectedDir);
  const ownershipFilter = useCatalogView((s) => s.ownershipFilter);
  const includeArchived = useCatalogView((s) => s.includeArchived);
  const favoritesOnly = useCatalogView((s) => s.favoritesOnly);
  const sort = useCatalogView((s) => s.sort);
  const order = useCatalogView((s) => s.order);
  const selection = useCatalogView((s) => s.selection);
  const toggleSelected = useCatalogView((s) => s.toggleSelected);
  // The setters the count's "clear this filter" chips need. Each belongs to a
  // control that already exists elsewhere in the UI.
  const clearOwnership = useCatalogView((s) => s.clearOwnership);
  const setFavoritesOnly = useCatalogView((s) => s.setFavoritesOnly);
  const setIncludeArchived = useCatalogView((s) => s.setIncludeArchived);

  const settingsQuery = useSettings();
  const catalogLive = useCatalogLive();
  const taskOutput = useTaskOutput();
  const fetchRepos = useFetchRepos();
  const pullRepos = usePullRepos();
  const [syncNotice, setSyncNotice] = React.useState<string | null>(null);
  const pickScanPath = usePickScanPath();
  const addScanPath = useAddScanPath();
  const rescanPath = useRescanPath();

  // ---------------------------------------------------------------------
  // Derivations
  // ---------------------------------------------------------------------

  /**
   * Configured identities win; otherwise infer from the catalog so
   * "Mine" works on first launch without a trip to Settings.
   */
  const identities = React.useMemo(() => {
    const configured = settingsQuery.data?.identities ?? [];
    if (configured.length > 0) return configured;
    return inferIdentities(initialRepos);
  }, [settingsQuery.data?.identities, initialRepos]);

  const ownershipBySlug = React.useMemo(() => {
    const map = new Map<string, OwnershipInfo>();
    for (const repo of initialRepos) {
      map.set(repo.slug, ownershipOf(repo, identities));
    }
    return map;
  }, [initialRepos, identities]);

  const ownershipKindBySlug = React.useMemo(() => {
    const map = new Map<string, OwnershipInfo["kind"]>();
    for (const [slug, info] of ownershipBySlug) map.set(slug, info.kind);
    return map;
  }, [ownershipBySlug]);

  const ownershipFor = React.useCallback(
    (repo: Repo): OwnershipInfo =>
      ownershipBySlug.get(repo.slug) ?? ownershipOf(repo, identities),
    [ownershipBySlug, identities],
  );

  /**
   * Configured scan roots. Everything positional in the catalog — the
   * rail tree, folder labels — is anchored on these rather than on the
   * common ancestor of whatever
   * repos happen to be catalogued, so the structure doesn't shift as the
   * catalog grows.
   */
  const scanPaths = React.useMemo(
    () => settingsQuery.data?.scanPaths ?? [],
    [settingsQuery.data?.scanPaths],
  );

  /**
   * Folder shown on cards: the path below the repo's own scan root.
   *
   * Deliberately does NOT include the scan root. Prefixing every card
   * with `~/Repos/` cost most of the line to text that is identical on
   * every row, and the rail plus the section header already establish
   * which tree you're in. The absolute path is a hover away.
   */
  const folderLabelFor = React.useCallback(
    (repo: Repo): string => {
      const dir = repo.fullPath.slice(0, repo.fullPath.lastIndexOf("/"));
      const owner = owningRoot(repo.fullPath, scanPaths);
      if (!owner) return tildify(dir);
      return dir.slice(owner.length).replace(/^\//, "") || "(root)";
    },
    [scanPaths],
  );

  /**
   * Grouping key for folder sections. The absolute directory, NOT the
   * display label: two scan roots can each contain an `agent-frameworks`,
   * and keying on the shortened label would silently merge them into one
   * section.
   */
  const folderKeyFor = React.useCallback(
    (repo: Repo): string =>
      repo.fullPath.slice(0, repo.fullPath.lastIndexOf("/")),
    [],
  );

  const commonTags = React.useMemo(() => {
    if (initialRepos.length === 0) return new Set<string>();
    const counts = new Map<string, number>();
    for (const repo of initialRepos) {
      for (const tag of repo.tags) {
        counts.set(tag.value, (counts.get(tag.value) ?? 0) + 1);
      }
    }
    const threshold = initialRepos.length * UBIQUITOUS_TAG_SHARE;
    return new Set(
      [...counts.entries()]
        .filter(([, count]) => count >= threshold)
        .map(([value]) => value),
    );
  }, [initialRepos]);

  // ---------------------------------------------------------------------
  // Filtering
  // ---------------------------------------------------------------------

  const trimmedQuery = queryQ.trim();
  const isSearching = trimmedQuery.length > 0;

  const searchQuery = useCatalogSearch(queryQ, {
    mode: "hybrid",
    limit: 200,
    filters: {
      groupIds: queryGroupId !== null ? [queryGroupId] : undefined,
    },
  });

  /**
   * Why these results are keyword-only, when they are.
   *
   * The backend reports this on every search, because the alternative — which
   * is what shipped first — was a search that quietly stopped using embeddings
   * and returned a smaller, differently-ranked set that looked exactly like a
   * successful one. `reason: "requested"` is excluded: a caller that asked for
   * FTS-only does not need telling it got what it asked for.
   */
  const semanticNotice = React.useMemo(() => {
    const semantic = searchQuery.data?.semantic;
    if (!isSearching || !semantic || semantic.state !== "off") return null;
    if (semantic.reason === "requested") return null;
    return semantic.reason === "no-embedding-provider"
      ? "Keyword matches only — semantic search is off. No embedding provider is reachable (Ollama or an OpenAI key)."
      : "Keyword matches only — semantic search is off. The vector store is unavailable on this machine.";
  }, [isSearching, searchQuery.data]);

  const activeGroup = React.useMemo(
    () => groups.find((g) => g.id === queryGroupId) ?? null,
    [groups, queryGroupId],
  );
  const isManualGroupActive = activeGroup !== null && !activeGroup.isSmart;
  const manualMembersQuery = useGroupMemberSlugs(
    isManualGroupActive ? queryGroupId : null,
  );
  const manualMemberSlugs = isManualGroupActive
    ? (manualMembersQuery.data ?? null)
    : null;

  /** Repos hidden purely because archived folders are excluded. */
  const archivedCount = React.useMemo(
    () => initialRepos.filter((r) => isArchivedPath(r.fullPath)).length,
    [initialRepos],
  );

  /**
   * Selecting an archived folder is an explicit request to look inside it, so
   * the archived filter must not then hide everything in it — that would make
   * `_archive` a row you can click into and find empty.
   */
  const scopeIsArchived = selectedDir ? isArchivedPath(selectedDir) : false;

  /**
   * Apply every filter, tallying which one is keeping each excluded repo out.
   *
   * The pass rejects on the first filter that objects, so the tally is
   * disjoint: every repo missing from the grid is counted exactly once, under
   * the filter actually responsible, and the chips that explain the count add
   * up to the difference it states. Re-deriving a count per filter instead
   * would double-count a repo that two filters both exclude.
   */
  const filtered = React.useMemo(() => {
    const base = isSearching
      ? (searchQuery.data?.hits ?? []).map((hit) => hit.repo)
      : initialRepos;

    const hiddenBy: Partial<Record<HiddenReasonKey, number>> = {};
    const reject = (key: HiddenReasonKey): false => {
      hiddenBy[key] = (hiddenBy[key] ?? 0) + 1;
      return false;
    };

    const repos = base.filter((repo) => {
      if (dirtyOnly && !repo.isDirty) return reject("dirty");
      if (favoritesOnly && !repo.isFavorite) return reject("favorites");
      if (
        !includeArchived &&
        !scopeIsArchived &&
        isArchivedPath(repo.fullPath)
      ) {
        return reject("archived");
      }
      if (selectedDir) {
        // "directly in this folder" narrows to the folder's own repos;
        // selecting the folder itself takes the whole subtree.
        const inScope = selectedDirExact
          ? isDirectlyIn(repo.fullPath, selectedDir)
          : isUnder(repo.fullPath, selectedDir);
        if (!inScope) return reject("scope");
      }
      if (ownershipFilter.length > 0) {
        const kind = ownershipKindBySlug.get(repo.slug);
        if (!kind || !ownershipFilter.includes(kind)) return reject("ownership");
      }
      if (activeGroup) {
        if (activeGroup.isSmart) {
          const f = activeGroup.smartFilter;
          if (f) {
            if (f.language && repo.primaryLanguage !== f.language) {
              return reject("group");
            }
            if (
              f.tagsInclude?.some(
                (tag) => !repo.tags.some((t) => t.value === tag),
              )
            ) {
              return reject("group");
            }
            if (
              f.tagsExclude?.some((tag) =>
                repo.tags.some((t) => t.value === tag),
              )
            ) {
              return reject("group");
            }
            if (
              f.sinceDays !== undefined &&
              (activityOf(lastTouched(repo)).days ?? Infinity) > f.sinceDays
            ) {
              return reject("group");
            }
            if (f.dirtyOnly && !repo.isDirty) return reject("group");
            if (f.hasRemote !== undefined && !!repo.remoteUrl !== f.hasRemote) {
              return reject("group");
            }
          }
        } else if (!manualMemberSlugs?.has(repo.slug)) {
          return reject("group");
        }
      }
      return true;
    });

    // Repos the search itself excluded never reach the pass above, so the search
    // is attributed here rather than being silently missing from the total.
    if (isSearching) hiddenBy.search = initialRepos.length - base.length;

    return { repos, hiddenBy };
  }, [
    isSearching,
    searchQuery.data,
    initialRepos,
    includeArchived,
    favoritesOnly,
    dirtyOnly,
    selectedDir,
    selectedDirExact,
    ownershipFilter,
    ownershipKindBySlug,
    activeGroup,
    manualMemberSlugs,
    scopeIsArchived,
  ]);

  /**
   * Sort.
   *
   * Search results keep their relevance order — re-sorting a ranked
   * result set by name throws away the only thing that made it a result
   * set. Every other view is sorted by the chosen key.
   */
  const displayedRepos = React.useMemo(() => {
    if (isSearching) return filtered.repos;
    const direction = order === "asc" ? 1 : -1;
    const compare = (a: Repo, b: Repo): number => {
      // Pinning is a statement about importance, so it outranks whatever
      // column you happen to be sorting by.
      if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
      switch (sort) {
        case "favorite": {
          const at = a.favoritedAt ?? "";
          const bt = b.favoritedAt ?? "";
          return bt.localeCompare(at) * -direction;
        }
        case "name":
          return a.name.localeCompare(b.name) * direction;
        case "size":
          return ((a.sizeBytes ?? 0) - (b.sizeBytes ?? 0)) * direction;
        case "language":
          return (
            (a.primaryLanguage ?? "").localeCompare(b.primaryLanguage ?? "") *
            direction
          );
        case "folder":
          return folderLabelFor(a).localeCompare(folderLabelFor(b)) * direction;
        case "owner":
          return (
            ownershipFor(a).label.localeCompare(ownershipFor(b).label) *
            direction
          );
        case "touched":
        default: {
          // Repos with no timestamp sort last regardless of direction —
          // "unknown" isn't "oldest", and burying them under a hundred
          // dated repos when sorting ascending would be wrong.
          const aDays = activityOf(lastTouched(a)).days;
          const bDays = activityOf(lastTouched(b)).days;
          if (aDays === null && bDays === null) return 0;
          if (aDays === null) return 1;
          if (bDays === null) return -1;
          return (bDays - aDays) * -direction;
        }
      }
    };
    return [...filtered.repos].sort(compare);
  }, [isSearching, filtered, sort, order, folderLabelFor, ownershipFor]);

  /**
   * What is hidden, and why. `hiddenReasons` names the filters; the *actions*
   * that clear them stay here, where the route params and the store live.
   */
  const hidden = React.useMemo(
    () =>
      hiddenReasons({
        counts: filtered.hiddenBy,
        query: trimmedQuery,
        selectedDir,
        selectedDirExact,
        ownershipFilter,
        groupName: activeGroup?.name ?? null,
        dirtyOnly,
      }),
    [
      filtered,
      trimmedQuery,
      selectedDir,
      selectedDirExact,
      ownershipFilter,
      activeGroup,
      dirtyOnly,
    ],
  );

  /** The catalog's own size — what the count's "of N" and "Show all N" quote. */
  const catalogTotal = totalCount || initialRepos.length;

  /**
   * The empty grid's words come from the same ranked reasons as the strip, so
   * the two can never name different filters for the same blank screen.
   */
  const emptyState = React.useMemo(
    () =>
      emptyStateCopy(hidden, {
        query: trimmedQuery,
        totalCount: catalogTotal,
      }),
    [hidden, trimmedQuery, catalogTotal],
  );

  /**
   * The repos closest to a search that matched nothing.
   *
   * Offered only when the search is what emptied the grid. Zero hits means the
   * query missed the catalog; that is the case where the repo behind a mistyped
   * word is more use than the advice to retype it. When the search *did* match
   * and a filter hid the results, the culprit above already names the filter,
   * and a list of "closest" repos would be a second, contradictory account of
   * the same blank screen.
   */
  const nearMiss = React.useMemo(() => {
    if (!isSearching) return [];
    const hits = searchQuery.data?.hits;
    if (!hits || hits.length > 0) return [];
    return nearMisses(trimmedQuery, initialRepos, { limit: 3 });
  }, [isSearching, searchQuery.data, trimmedQuery, initialRepos]);

  const coverFor = useCovers(displayedRepos);

  // ---------------------------------------------------------------------
  // Interactions
  // ---------------------------------------------------------------------

  const updateParams = React.useCallback(
    (patch: Record<string, string | null>) => {
      const updater = (prev: CatalogSearch): CatalogSearch => {
        const next: CatalogSearch = { ...prev };
        for (const [key, value] of Object.entries(patch)) {
          if (value === null || value === "") {
            delete (next as Record<string, unknown>)[key];
          } else {
            (next as Record<string, unknown>)[key] = value;
          }
        }
        return next;
      };
      navigate({ search: updater as unknown as never, replace: true });
    },
    [navigate],
  );

  const selectRepo = React.useCallback(
    (slug: string | null) => updateParams({ repo: slug }),
    [updateParams],
  );

  /**
   * Clear one hiding filter. Each reason maps to a control that is already
   * elsewhere in the UI — the count just names it and saves the trip to find it.
   */
  const clearHiddenReason = React.useCallback(
    (key: HiddenReasonKey) => {
      switch (key) {
        case "search":
          updateParams({ q: null });
          break;
        case "favorites":
          setFavoritesOnly(false);
          break;
        case "archived":
          setIncludeArchived(true);
          break;
        case "scope":
          setSelectedDir(null);
          break;
        case "ownership":
          clearOwnership();
          break;
        case "group":
          updateParams({ groupId: null });
          break;
        case "dirty":
          updateParams({ dirty: null });
          break;
      }
    },
    [
      updateParams,
      setFavoritesOnly,
      setIncludeArchived,
      setSelectedDir,
      clearOwnership,
    ],
  );

  /** Every hidden repo at once, which is what "Show all N" promises. */
  const showAllRepos = React.useCallback(() => {
    updateParams({ q: null, groupId: null, dirty: null });
    setFavoritesOnly(false);
    setIncludeArchived(true);
    setSelectedDir(null);
    clearOwnership();
  }, [
    updateParams,
    setFavoritesOnly,
    setIncludeArchived,
    setSelectedDir,
    clearOwnership,
  ]);

  // A strip that outlived the filters it describes would reopen, already empty,
  // the next time anything is hidden.
  React.useEffect(() => {
    if (hidden.length === 0) setExplainHidden(false);
  }, [hidden.length]);

  React.useEffect(() => {
    let cancelled = false;
    if (!querySlug) {
      setDetail(null);
      setDetailLoading(false);
      return;
    }
    setDetailLoading(true);
    setDetail(null);
    void loadRepoDetail(querySlug).then((loaded) => {
      if (cancelled) return;
      setDetail(loaded);
      setDetailLoading(false);
    }).catch((error: unknown) => {
      if (cancelled) return;
      setDetailLoading(false);
      useUiStore.getState().pushNotice(`Could not load repository: ${error instanceof Error ? error.message : String(error)}`);
    });
    return () => {
      cancelled = true;
    };
  }, [querySlug, loadRepoDetail]);

  /**
   * Clear whichever filter the empty grid is naming.
   *
   * The guard lives here rather than as a non-null assertion at the call site:
   * the button is only rendered when there is a culprit, but the click handler
   * is a closure over state that a re-render can have emptied.
   */
  const clearEmptyCulprit = React.useCallback(() => {
    if (emptyState.culprit) clearHiddenReason(emptyState.culprit.key);
  }, [emptyState.culprit, clearHiddenReason]);

  /**
   * Take a suggestion: search for that repo by the name a search can find, and
   * open it. Both halves matter — rewriting the query is what puts the repo
   * back in the grid, and the panel is what says it is the one you meant.
   */
  const pickNearMiss = React.useCallback(
    (repo: Repo) => updateParams({ q: repo.name, repo: repo.slug }),
    [updateParams],
  );

  const { openInEditor: launchInEditor } = useLauncher();

  const openInEditor = React.useCallback(
    (slug: string) => {
      // The launcher decides what opens — it consults the user's saved
      // default editor, falls back when that editor is gone, and copes with
      // editors that ship no URL scheme (Xcode). The old hardcoded
      // `vscode://` fallback ignored all of that, and only ever ran in a
      // run with no preload bridge, where there is nothing to launch.
      void launchInEditor(slug);
    },
    [launchInEditor],
  );

  /**
   * Pick a folder and start watching it.
   *
   * Two steps behind one click: the native picker, then add-and-scan.
   * A rejection (already covered, not a directory) surfaces as a notice
   * strip rather than a dialog — it's information, not a decision.
   */
  const handleAddScanPath = React.useCallback(async () => {
    setRootNotice(null);
    const picked = await pickScanPath.mutateAsync();
    if (!picked) return;
    const result = await addScanPath.mutateAsync(picked);
    if (!result.added) setRootNotice(result.reason);
  }, [pickScanPath, addScanPath]);

  const handleRescan = React.useCallback(
    (path: string) => {
      setRootNotice(null);
      rescanPath.mutate(path, {
        onError: () =>
          setRootNotice("A scan is already running — try again once it ends."),
      });
    },
    [rescanPath],
  );

  /**
   * The set a sync acts on: the explicit selection when there is one,
   * otherwise everything currently visible. That makes "pull all my work
   * repos" a filter followed by one click, with no select-all step.
   */
  const syncTargets = React.useCallback((): string[] => {
    if (selection.length > 0) return selection;
    return displayedRepos.filter((r) => !r.missing).map((r) => r.slug);
  }, [selection, displayedRepos]);

  const summarise = React.useCallback(
    (result: { entries: Array<{ outcome: string }>; updated: number }) => {
      const counts = new Map<string, number>();
      for (const entry of result.entries) {
        counts.set(entry.outcome, (counts.get(entry.outcome) ?? 0) + 1);
      }
      const parts: string[] = [];
      const say = (key: string, label: string) => {
        const n = counts.get(key);
        if (n) parts.push(`${n} ${label}`);
      };
      say("updated", "updated");
      say("already-current", "already current");
      say("fetched", "fetched");
      say("dirty", "blocked by uncommitted changes");
      say("diverged", "diverged");
      say("no-upstream", "without an upstream");
      say("no-remote", "without a remote");
      say("failed", "failed");
      say("missing", "missing");
      return parts.join(" · ") || "Nothing to do";
    },
    [],
  );

  /**
   * Both sync handlers replace the notice whatever happens.
   *
   * The strip is the only feedback either button gives and it is set before the
   * work starts, so a rejection that is not caught leaves it counting forever
   * ("Fetching 5…") while the error goes to the console. A refusal is an answer
   * too, and the strip is where an answer belongs.
   */
  const handleFetch = React.useCallback(async () => {
    const slugs = syncTargets();
    if (slugs.length === 0) return;
    setSyncNotice(`Fetching ${slugs.length}…`);
    try {
      setSyncNotice(summarise(await fetchRepos.mutateAsync(slugs)));
    } catch (error) {
      setSyncNotice(syncFailed("Fetch", error));
    }
  }, [syncTargets, fetchRepos, summarise]);

  const handlePull = React.useCallback(async () => {
    const slugs = syncTargets();
    if (slugs.length === 0) return;
    setSyncNotice(`Pulling ${slugs.length}…`);
    try {
      setSyncNotice(summarise(await pullRepos.mutateAsync(slugs)));
    } catch (error) {
      setSyncNotice(syncFailed("Pull", error));
    }
  }, [syncTargets, pullRepos, summarise]);

  const checkedSlugs = React.useMemo(() => new Set(selection), [selection]);
  const slugs = React.useMemo(
    () => displayedRepos.map((r) => r.slug),
    [displayedRepos],
  );

  const scopeLabel = selectedDir
    ? selectedDirExact
      ? `${tildify(selectedDir)} (top level)`
      : tildify(selectedDir)
    : null;

  /*
   * `h-full`, not `h-[100dvh]`: this shell sits inside `main`, which the root
   * layout has already sized to the window minus the top bar. Asking for a
   * second full viewport stacked 48px of catalog past the bottom of the
   * window, and `overflow-hidden` here turned that overflow into an
   * unreachable tail of the grid rather than a scroll (ATR-061).
   *
   * Above the `return`, not inside it. JSX children are verbatim text, so a
   * comment written without braces is how code-looking prose ends up on screen
   * — and, as a text child of this flex column, it is also an anonymous flex
   * item that takes its own height out of the catalog's box. Two guards hold
   * this: `tests/unit/renderer/jsx-text.spec.ts` fails on the comment forms
   * that render, and `layout-overflow.spec.ts` asserts the shell holds only
   * elements before it measures a height.
   */
  return (
    <div className="flex h-full w-full overflow-hidden bg-background">
      {!sidebarCollapsed ? <DirRail
        repos={initialRepos}
        groups={groups}
        ownershipBySlug={ownershipKindBySlug}
        scanPaths={scanPaths}
        activeGroupId={queryGroupId}
        onSelectGroup={(id) => {
          setSelectedDir(null);
          useCatalogView.getState().clearOwnership();
          useCatalogView.getState().setFavoritesOnly(false);
          updateParams({ groupId: id === null ? null : String(id), dirty: null, q: null, repo: null });
        }}
        dirtyOnly={dirtyOnly}
        onToggleDirty={() => updateParams({ dirty: dirtyOnly ? null : "true" })}
        revealSlug={querySlug}
        onRescan={handleRescan}
        onStopScanning={setRemovingRoot}
        onAddScanPath={() => void handleAddScanPath()}
        addingScanPath={pickScanPath.isPending || addScanPath.isPending}
      /> : null}

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/*
         * The route's `h1` (ATR-070). The visible captions on this screen are
         * mono labels, not headings, so the name a screen reader hears first
         * is carried here rather than invented as a banner above the grid.
         */}
        <h1 className="sr-only">
          {scopeLabel ? `Catalog — ${scopeLabel}` : "Catalog"}
        </h1>

        {activeGroup ? <div role="status" className="flex items-center gap-2 border-b border-border bg-accent/10 px-4 py-2 text-xs">
          <span>Group: <strong>{activeGroup.name}</strong> · {displayedRepos.length} repos</span>
          <button type="button" className="ml-auto text-accent hover:underline" onClick={() => updateParams({ groupId: null })}>Clear group</button>
        </div> : null}

        <CatalogToolbar
          shownCount={displayedRepos.length}
          totalCount={catalogTotal}
          archivedCount={archivedCount}
          scopeLabel={scopeLabel}
          onClearScope={() => setSelectedDir(null)}
          onPull={() => void handlePull()}
          onFetch={() => void handleFetch()}
          syncing={fetchRepos.isPending || pullRepos.isPending}
          explainingHidden={explainHidden}
          onToggleHidden={() => setExplainHidden((prev) => !prev)}
        />

        {hidden.length > 0 && explainHidden ? (
          <div
            id={HIDDEN_REASONS_ID}
            aria-label="Repos hidden by filters"
            className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-surface px-4 py-1.5"
          >
            <span className="atr-label text-muted-foreground">Hidden by</span>
            {hidden.map((reason) => (
              <button
                key={reason.key}
                type="button"
                data-hidden-reason={reason.key}
                data-hidden-count={reason.count}
                onClick={() => clearHiddenReason(reason.key)}
                aria-label={`Clear ${reason.label} — currently hiding ${reason.count} repo${reason.count === 1 ? "" : "s"}`}
                title={`Clear ${reason.label} — currently hiding ${reason.count} repo${reason.count === 1 ? "" : "s"}`}
                className="flex cursor-pointer items-center gap-1 rounded bg-secondary px-2 py-0.5 font-mono atr-label text-foreground transition-colors duration-150 hover:bg-surface-raised"
              >
                <span className="max-w-[240px] truncate">{reason.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {reason.count}
                </span>
                <X className="h-3 w-3 shrink-0" aria-hidden />
              </button>
            ))}
            <button
              type="button"
              onClick={showAllRepos}
              className="ml-auto cursor-pointer rounded px-1.5 py-0.5 font-mono atr-label text-accent transition-colors duration-150 hover:bg-surface-raised"
            >
              Show all {catalogTotal}
            </button>
          </div>
        ) : null}

        {syncNotice ? (
          <div
            role="status"
            aria-live="polite"
            className="flex shrink-0 items-center gap-2 border-b border-border bg-surface px-4 py-1.5"
          >
            <span className="atr-meta">{syncNotice}</span>
            <button
              type="button"
              onClick={() => setSyncNotice(null)}
              className="ml-auto cursor-pointer rounded px-1.5 py-0.5 font-mono atr-label text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {catalogLive.notice ? (
          <div
            role="status"
            aria-live="polite"
            className="flex shrink-0 items-center gap-2 border-b border-border bg-accent/10 px-4 py-1.5"
          >
            <RefreshCw className="h-3 w-3 shrink-0 text-accent" aria-hidden />
            <span className="atr-label text-accent">
              {catalogLive.notice}
            </span>
            <button
              type="button"
              onClick={catalogLive.dismiss}
              className="ml-auto cursor-pointer rounded px-1.5 py-0.5 font-mono atr-label text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        {semanticNotice ? (
          <div
            role="status"
            aria-live="polite"
            className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-border bg-warning/10 px-4 py-1.5"
          >
            <span
              className="atr-label text-warning"
              title={
                searchQuery.data?.semantic.state === "off"
                  ? (searchQuery.data.semantic.detail ?? undefined)
                  : undefined
              }
            >
              {semanticNotice}
            </span>
            <Link
              to="/settings"
              className="cursor-pointer font-mono atr-label text-accent underline-offset-2 hover:underline"
            >
              Set up
            </Link>
          </div>
        ) : null}

        {rootNotice ? (
          <div
            role="status"
            className="flex shrink-0 items-center gap-2 border-b border-border bg-warning/10 px-4 py-1.5"
          >
            <span className="atr-label text-warning">{rootNotice}</span>
            <button
              type="button"
              onClick={() => setRootNotice(null)}
              className="ml-auto cursor-pointer rounded px-1.5 py-0.5 font-mono atr-label text-muted-foreground transition-colors duration-150 hover:text-foreground"
            >
              Dismiss
            </button>
          </div>
        ) : null}

        <div className="flex-1 overflow-y-auto px-4 py-3">
          <RepoGrid
            repos={displayedRepos}
            ownershipFor={ownershipFor}
            folderLabelFor={folderLabelFor}
            folderKeyFor={folderKeyFor}
            coverFor={coverFor}
            commonTags={commonTags}
            selectedSlug={querySlug}
            checkedSlugs={checkedSlugs}
            onSelect={selectRepo}
            onToggleChecked={toggleSelected}
            onOpenEditor={openInEditor}
            loading={isSearching && searchQuery.isPending}
            emptyTitle={emptyState.title}
            emptyHint={emptyState.hint}
            emptySuggestion={
              nearMiss.length > 0 ? (
                <div
                  data-near-miss-list
                  className="mt-1 flex flex-col items-center gap-1.5"
                >
                  <p className="atr-label text-muted-foreground">
                    Did you mean
                  </p>
                  <ul className="flex flex-wrap items-center justify-center gap-2">
                    {nearMiss.map(({ repo, field, matchedOn }) => (
                      <li key={repo.slug}>
                        <button
                          type="button"
                          data-near-miss={repo.slug}
                          onClick={() => pickNearMiss(repo)}
                          title={`Search for ${repo.name} — closest to “${trimmedQuery}” on its ${field} “${matchedOn}”`}
                          className="flex cursor-pointer items-center gap-1.5 rounded border border-border bg-card px-2 py-1 transition-colors duration-150 hover:bg-surface-raised"
                        >
                          <span className="font-mono text-xs text-foreground">
                            {repo.name}
                          </span>
                          <span className="atr-meta max-w-[160px] truncate">
                            {folderLabelFor(repo)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null
            }
            emptyAction={
              emptyState.culprit ? (
                <>
                  <button
                    type="button"
                    data-empty-culprit={emptyState.culprit.key}
                    onClick={clearEmptyCulprit}
                    className="cursor-pointer rounded border border-border px-2 py-1 font-mono atr-label text-foreground transition-colors duration-150 hover:bg-surface-raised"
                  >
                    Clear {emptyState.culprit.label}
                  </button>
                  <button
                    type="button"
                    onClick={showAllRepos}
                    className="cursor-pointer rounded px-2 py-1 font-mono atr-label text-accent transition-colors duration-150 hover:bg-surface-raised"
                  >
                    Show all {catalogTotal}
                  </button>
                </>
              ) : null
            }
          />
        </div>
      </main>

      <DetailPanel
        repo={detail}
        loading={detailLoading && !detail}
        onClose={() => selectRepo(null)}
        onOpenRepo={selectRepo}
        taskRuns={taskOutput.runs}
        onClearRun={taskOutput.clear}
      />

      <ScanRootDialog
        path={removingRoot}
        onOpenChange={(open) => {
          if (!open) setRemovingRoot(null);
        }}
      />

      <KeyboardShortcuts
        slugs={slugs}
        selectedSlug={querySlug}
        onSelectSlug={selectRepo}
        onOpenSelected={() => querySlug && openInEditor(querySlug)}
        onCloseDetail={() => selectRepo(null)}
      />
    </div>
  );
}
