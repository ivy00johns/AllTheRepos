/**
 * Deploy targets: the Worker names and hosts a repo's Cloudflare config declares,
 * and how a URL maps back to those words in the search index.
 *
 * This is what connects a live site to the repo serving it when the two have
 * different names. The config never holds the account label in
 * `<name>.<account>.workers.dev`, so the index stores the name and a URL is
 * reduced to it at search time.
 *
 * Pure: no filesystem, no DB, no Electron. Runs in the scanner worker too.
 */

/** Strings are matched first so `//` and `,}` inside one are left alone. */
const JSONC_COMMENT = /"(?:\\.|[^"\\])*"|\/\/[^\n]*|\/\*[\s\S]*?\*\//g;
const JSONC_TRAILING_COMMA = /"(?:\\.|[^"\\])*"|,(?=\s*[}\]])/g;
const TOML_COMMENT = /"(?:\\.|[^"\\])*"|'[^']*'|#[^\n]*/g;

const keepStrings = (match: string): string =>
  match[0] === '"' || match[0] === "'" ? match : "";

/** `*.example.com/api/*` → `example.com`. */
function hostOf(pattern: string): string | null {
  const host = pattern
    .replace(/^https?:\/\//i, "")
    .split("/")[0]
    .replace(/^\*\.?/, "")
    .toLowerCase();
  return host.length > 0 ? host : null;
}

class Terms {
  private readonly terms = new Set<string>();

  add(term: unknown): void {
    if (typeof term !== "string") return;
    const trimmed = term.trim();
    if (trimmed && !/\s/.test(trimmed)) this.terms.add(trimmed);
  }

  addRoute(pattern: unknown): void {
    if (typeof pattern === "string") this.add(hostOf(pattern));
  }

  list(): string[] {
    return [...this.terms];
  }
}

function collectJsonScope(
  scope: Record<string, unknown>,
  name: unknown,
  terms: Terms,
): void {
  terms.add(name);
  const routes = Array.isArray(scope.routes) ? scope.routes : [];
  for (const route of [scope.route, ...routes]) {
    if (route && typeof route === "object") {
      terms.addRoute((route as { pattern?: unknown }).pattern);
    } else {
      terms.addRoute(route);
    }
  }
}

function parseJsonc(text: string): string[] {
  let config: unknown;
  try {
    config = JSON.parse(
      text
        .replace(JSONC_COMMENT, keepStrings)
        .replace(JSONC_TRAILING_COMMA, keepStrings),
    );
  } catch {
    return [];
  }
  if (!config || typeof config !== "object") return [];
  const root = config as Record<string, unknown>;
  const terms = new Terms();
  collectJsonScope(root, root.name, terms);
  const envs = root.env;
  if (envs && typeof envs === "object") {
    for (const [envName, env] of Object.entries(envs)) {
      if (!env || typeof env !== "object") continue;
      const scope = env as Record<string, unknown>;
      collectJsonScope(scope, envWorkerName(scope.name, root.name, envName), terms);
    }
  }
  return terms.list();
}

/** Wrangler names an environment's Worker `<name>-<env>` unless it says otherwise. */
function envWorkerName(
  ownName: unknown,
  rootName: unknown,
  envName: string,
): unknown {
  if (ownName !== undefined) return ownName;
  return typeof rootName === "string" ? `${rootName}-${envName}` : undefined;
}

const QUOTED = /"([^"]*)"|'([^']*)'/;
const quotedValue = (text: string): string | undefined => {
  const match = QUOTED.exec(text);
  return match ? (match[1] ?? match[2]) : undefined;
};

/** Every pattern in a TOML route value: a string, an inline table, or an array of either. */
function tomlRoutePatterns(value: string): string[] {
  const out: string[] = [];
  const withoutTables = value.replace(/\{[^}]*\}/g, (table) => {
    const pattern = /pattern\s*=\s*(.+?)(?:,|\}|$)/.exec(table);
    const quoted = pattern ? quotedValue(pattern[1]) : undefined;
    if (quoted) out.push(quoted);
    return "";
  });
  for (const match of withoutTables.matchAll(/"([^"]*)"|'([^']*)'/g)) {
    out.push(match[1] ?? match[2]);
  }
  return out;
}

const bracketDepth = (text: string): number =>
  text.replace(/"[^"]*"|'[^']*'/g, "").replace(/[^[\]]/g, "").split("")
    .reduce((depth, ch) => depth + (ch === "[" ? 1 : -1), 0);

interface TomlScope {
  name?: string;
  routes: string[];
}

/**
 * Enough TOML for the keys read here. Wrangler's `name` and routes are plain
 * assignments, and a table header says whose they are: a `name` under `[vars]`
 * or `[[d1_databases]]` belongs to something else.
 */
function parseToml(text: string): string[] {
  const lines = text.replace(TOML_COMMENT, keepStrings).split(/\r?\n/);
  const root: TomlScope = { routes: [] };
  const envs = new Map<string, TomlScope>();
  let section = "";

  const envScope = (env: string): TomlScope => {
    let scope = envs.get(env);
    if (!scope) {
      scope = { routes: [] };
      envs.set(env, scope);
    }
    return scope;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(line);
    if (header) {
      section = header[1];
      const env = /^env\.([^.]+)/.exec(section)?.[1];
      if (env) envScope(env);
      continue;
    }
    const assignment = /^([A-Za-z_]+)\s*=\s*(.*)$/.exec(line);
    if (!assignment) continue;
    const key = assignment[1];
    let value = assignment[2];

    const env = /^env\.([^.]+)/.exec(section)?.[1];
    const scope = env ? envScope(env) : root;
    const isWorkerScope = section === "" || section === `env.${env}`;
    const isRouteTable = /^(env\.[^.]+\.)?routes?$/.test(section);

    if (isRouteTable && key === "pattern") {
      const pattern = quotedValue(value);
      if (pattern) scope.routes.push(pattern);
    } else if (isWorkerScope && key === "name") {
      scope.name = quotedValue(value);
    } else if (isWorkerScope && (key === "route" || key === "routes")) {
      while (bracketDepth(value) > 0 && i + 1 < lines.length) {
        i += 1;
        value += ` ${lines[i]}`;
      }
      scope.routes.push(...tomlRoutePatterns(value));
    }
  }

  const terms = new Terms();
  terms.add(root.name);
  root.routes.forEach((route) => terms.addRoute(route));
  for (const [env, scope] of envs) {
    terms.add(envWorkerName(scope.name, root.name, env));
    scope.routes.forEach((route) => terms.addRoute(route));
  }
  return terms.list();
}

/**
 * The Worker names and hosts a wrangler config declares, in file order. A file
 * that does not parse yields nothing: a scan must not fail over one bad config.
 */
export function parseWranglerConfig(filename: string, text: string): string[] {
  return filename.endsWith(".toml") ? parseToml(text) : parseJsonc(text);
}

const HOST_LIKE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

function hostFromQuery(query: string): string | null {
  const trimmed = query.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(trimmed)?.[1]?.toLowerCase();
  if (scheme && scheme !== "http" && scheme !== "https") return null;
  try {
    const host = new URL(scheme ? trimmed : `https://${trimmed}`).hostname;
    return HOST_LIKE.test(host) ? host : null;
  } catch {
    return null;
  }
}

/**
 * The FTS expression that finds repos deploying to a URL or bare hostname, or
 * null when the query is not shaped like one. A plain host (`node.js` looks like
 * one too) only ever adds a lookup; the caller falls back to ordinary search when
 * nothing declares it.
 */
export function deployLookupExpr(query: string): string | null {
  const host = hostFromQuery(query);
  if (!host) return null;
  const labels = host.split(".");

  // <name>.<account>.workers.dev, and <preview>.<name>.pages.dev or <name>.pages.dev.
  if (host.endsWith(".workers.dev") && labels.length >= 4) {
    return `deploy_text : "${labels[labels.length - 4]}"`;
  }
  if (host.endsWith(".pages.dev") && labels.length >= 3) {
    return `deploy_text : "${labels[labels.length - 3]}"`;
  }
  if (host.startsWith("www.")) {
    return `deploy_text : ("${host}" OR "${host.slice(4)}")`;
  }
  return `deploy_text : "${host}"`;
}
