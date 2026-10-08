/**
 * Markdown — rendered markdown for a repo README or a CLAUDE.md.
 *
 * Two reasons this is its own component rather than the `react-markdown`
 * call inlined at each site:
 *
 *   1. Styling. `.atr-prose` (in `styles/globals.css`) owns what a
 *      README looks like, so the detail panel and the Claude tab cannot
 *      drift apart.
 *   2. Weight. `react-markdown` and its plugin chain (remark-gfm,
 *      rehype-raw, rehype-sanitize) are only ever needed once a repo is
 *      open, or once the Claude tab is chosen — never for the shell to
 *      paint. The dynamic import below is that split; the `Suspense` is
 *      local so a pending chunk leaves the surrounding panel in place
 *      instead of blanking the route.
 */

import * as React from "react";

const MarkdownRenderer = React.lazy(() => import("./markdown-renderer"));

export function Markdown({ children }: { children: string }) {
  return (
    <div className="atr-prose">
      <React.Suspense fallback={null}>
        <MarkdownRenderer>{children}</MarkdownRenderer>
      </React.Suspense>
    </div>
  );
}
