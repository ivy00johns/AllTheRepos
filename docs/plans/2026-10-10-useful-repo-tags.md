# Useful repo tags: scripts first, optional local cleanup

Status: approved 2026-10-10. Steps 1–2 are implemented in `src/main/services/tag.ts`, with
fixtures in `tests/unit/main/services/tag.spec.ts`. Steps 3–5 (cleanup preview, optional
Ollama cleanup, benchmark) are not started.
Tracked as ATR-076 in [Remaining Work](../REMAINING-WORK.md).

Deviations from the plan as written: purpose is one tag, not several, to avoid noise.
The primary programming language is still a tag (search relies on it), but only when it
is not format-only. The cap is six. Workspace-manifest inspection for monorepos is deferred
to step 3, so a monorepo is tagged from its root manifest only.

## Problem confirmed in the current code

[The tag service](../../src/main/services/tag.ts) adds the primary language as a tag
unconditionally. A repository dominated by configuration can therefore acquire `json`,
which says little about its purpose. The detectors already recognize some frameworks,
but ignore the supplied README and do not distinguish purpose from implementation.
The current 12-tag cap preserves insertion order rather than usefulness.

## Recommended sequence

1. **Deterministic classification, no model required.** Read bounded manifest/config
   files and recognize purpose (`desktop-app`, `web-app`, `api`, `cli`, `library`,
   `docs`, `infrastructure`), frameworks (`electron`, `react`, `next`, `fastapi`),
   and important tooling where there is direct evidence. Prefer manifest fields,
   dependencies, entrypoints and build scripts over directory names or README keywords.
   Never run repository scripts to classify a repository. Inspect selected workspace
   manifests for monorepos with explicit file-count and byte budgets.
2. **Keep languages as metadata.** Stop generating format-only tags such as `json`,
   `yaml`, `toml`, `markdown` and lockfile formats merely because those files exist.
   Do not infer `api` from a stray dependency or `ai` from a word in a README.
   Prefer 3–6 well-supported tags over filling a quota. Canonicalize case and aliases
   using one versioned vocabulary; preserve all manually entered tags verbatim.
3. **Preview the cleanup.** Produce an old/new tag diff, with the evidence for each
   generated tag. Offer per-repo and batch accept/reject, plus a session undo for a
   batch. Changes affect the catalog only; never write into repository files.
   Refresh FTS and group filters after accepting a change. Show generated vs manual
   source in the UI, and remember rejected suggestions across rescans.
4. **Optional Ollama cleanup after the rules work.** Use the existing local Ollama
   connection, with a separately selected *generation* model: `nomic-embed-text` is
   an embedding model, not a tag-writing model. Give the model bounded, secret-free
   evidence and candidate vocabulary. Request strict JSON suggestions, validate
   against a schema and vocabulary, and show the evidence/source. Treat repo content
   as untrusted text, not instructions. No tool calls, shell execution, or automatic
   acceptance of model output. No cloud fallback without explicit user opt-in.
5. **Make repeats cheap.** Cache by evidence hash, rule/vocabulary version and, when
   used, generation model identity. Start with one model request at a time, a 30s
   request deadline, cancellation, and a visible progress/error summary. A missing
   model or unavailable Ollama must leave deterministic tagging fully functional.

## Data contract to settle during implementation

Retain existing user/heuristic/smart provenance and avoid representing model output
as a user edit. Proposed suggestion record: repo identity, normalized value, category,
source, rule/model version, evidence references, status (pending/accepted/rejected),
and input hash. Store suggestions separately from accepted tags so a failed or
cancelled batch cannot partly replace the authoritative tag set. Version any SQLite
migration and keep old catalogs readable through the normal migration path.

## Acceptance criteria

- Fixtures cover Electron UI, API, CLI, library, docs-only, infrastructure, mixed
  monorepo, JSON-heavy config, missing manifests and hostile README instructions.
- JSON-heavy configuration alone never yields a generated `json` tag.
- Re-tagging preserves manual tags, honors rejected suggestions and is idempotent.
- A dry run explains every suggested addition/removal without mutating the catalog.
- Cancellation, malformed model JSON, model not installed and Ollama offline leave
  accepted/manual tags unchanged; classification still works without any model.
- In Electron, accepted tags survive restart and can be used to search/filter; a
  rescan does not restore a rejected noise tag. Test the browser demo separately.
- Benchmark at least 100 representative repos: publish deterministic time, model
  time, memory, cache hit rate and a human-reviewed usefulness/false-positive sample.
  Set a throughput budget from that baseline rather than promising an unmeasured speed.

## Why this approach

Rules provide a fast, explainable baseline. A local model can help merge synonyms and
summarize purpose where evidence is ambiguous, but it should propose cleanup instead
of owning the tag set. This avoids paying model cost for obvious manifests and keeps
local-first behavior useful when no model is installed.
