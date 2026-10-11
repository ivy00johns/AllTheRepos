# Asset inventory — no-capture path

There is no website to scrape. The visual source of truth is the app itself,
recorded on 2026-10-10 by `scripts/make-demo-video.mjs` against a throwaway
profile seeded with the invented demo library.

| Asset                        | What it shows                                                                        | Beat |
| ---------------------------- | ------------------------------------------------------------------------------------ | ---- |
| `assets/captures/02-catalog.webm` | The catalog settled, scrolled once — the app's whole surface in one frame        | 2    |
| `assets/captures/03-scan.webm`    | All four scan roots rescanned by the real scanner, filling an empty grid 0 → 35  | 3    |
| `assets/captures/04-search.webm`  | A half-remembered word typed into the search field, results narrowing            | 4    |
| `assets/captures/05-triage.webm`  | Hover across three cards — recency ramp, language bar, dirty/missing/ownership marks | 5 |
| `assets/captures/06-vocabulary.webm` | `lighthouse-ui` detail: 3 user tags, 3 inferred tags, 4 tasks, the Notes tab with its live preview | 6 |
| `assets/captures/07-graph.webm`   | The map, then back to the catalog and a repo's detail panel                      | 7    |
| `assets/captures/08-live.webm`    | The rail's scanned folders expanding — the live roots behind the catalog         | 8    |
| `assets/captures/09-local-first.webm` | Settings scrolled — scan paths, identities, updates                          | 9    |
| `assets/captures/10-close.webm`   | `⌘K` opened over the catalog for the close                                       | 10   |
| `assets/brand/icon.png`           | The app mark — the title card and the logo sting                                 | 1, 10 |
| `assets/brand/fonts/`             | IBM Plex Sans + JetBrains Mono, bundled in-repo (no network fetch at render)     | all  |

No photographic or third-party imagery is used anywhere: every pixel on screen
is either the app's own renderer or type set in the app's own fonts.
