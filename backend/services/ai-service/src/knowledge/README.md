# `knowledge/` — deprecated research-automation pipeline

Status: **superseded, ingestion/chunking path deprecated** — see
`docs/ai-agent-system-feasibility-audit.md` section 1.3
("Two competing ingestion pipelines").

This directory and `../knowledge-pipeline/` used to be two separate,
both-real pipelines writing into the same Qdrant collection
(`fitness_evidence`):

| | `knowledge-pipeline/` | `knowledge/pipeline/` + `knowledge/connectors/` |
|---|---|---|
| Chunker | 1200 chars, 160 overlap, sentence/word-boundary snap | 1200-char hard slice, no overlap, no snap |
| Sources | PubMed, RSS, whitelisted web, curated JSONL | + Crossref, OpenAlex, PMC |
| Wired into running server | Yes — BullMQ worker (`knowledge-pipeline/worker.ts`) + HTTP endpoints (`routes/internal.routes.ts`) | No — CLI scripts only (`src/scripts/research*.ts`), gated by `ENABLE_RESEARCH_AUTOMATION` |
| Quality/safety gate | `knowledge-pipeline/scoring.ts` (trust/quality score) + `knowledge-pipeline/safety-judge.ts` (regex + optional LLM judge), Postgres bookkeeping via `knowledge-pipeline/repository.ts` | `pipeline/evidence_score.ts` (evidence heuristic) + a manual JSONL review queue (`pipeline/review_queue.ts`) — no LLM safety judge, no DB |

**Decision (Phase 10 of the AI-agent migration plan): `knowledge-pipeline/`
is authoritative for ingestion/chunking/embedding. This directory's
ingestion/chunking files are deprecated in place, not deleted:**

- `pipeline/chunk.ts` — deprecated. Cruder chunker (no overlap, no
  boundary snap). Replaced by `../knowledge-pipeline/chunking.ts`.
- `pipeline/index_to_qdrant.ts` — deprecated. Writes to Qdrant bypassing
  the production trust/safety gate. Replaced by
  `../knowledge-pipeline/qdrant-writer.ts` (reached via
  `knowledge-pipeline/service.ts`'s `run*Pipeline` functions).

Each has a header comment explaining the specific defect and pointing to
its replacement.

## What's kept, and why

The rest of this directory is **not duplicated** by `knowledge-pipeline/`
and is kept as a standalone, CLI-only *source-discovery and review*
toolkit — it answers "what new candidate evidence exists out there and
is it worth reviewing", not "how do we chunk/embed it":

- `connectors/crossref.connector.ts`, `connectors/openalex.connector.ts`,
  `connectors/pubmed.connector.ts`, `connectors/webpage.connector.ts` —
  fetch metadata/abstracts from sources `knowledge-pipeline/` does not
  cover today (Crossref, OpenAlex, PMC via the PubMed connector).
- `pipeline/normalize.ts`, `pipeline/deduplicate.ts`,
  `pipeline/evidence_score.ts`, `pipeline/review_queue.ts` — a
  normalize → dedupe → score → human-review-queue workflow over a local
  JSONL file (`data/research_review_queue.jsonl`), independent of the
  chunk/embed step.
- `source_registry.ts`, `research_topics.ts`, `types.ts` — the source
  allowlist and topic list driving the above.

These are invoked only via `src/scripts/researchFetch.ts`,
`researchEval.ts`, `researchDryRun.ts` and `researchScheduler.ts`
(external cron, gated by `ENABLE_RESEARCH_AUTOMATION=true`). They are
still functional and were not changed, beyond a pointer comment in
`researchIndex.ts` (the one script that calls the deprecated
chunk/index files) noting the replacement path.

## Gap: Crossref/OpenAlex source coverage not ported into `knowledge-pipeline/`

`knowledge-pipeline/` currently only has PubMed, RSS, whitelisted-web and
local-JSONL sources (`pubmed.ts`, `rss.ts`, `web.ts`,
`local-evidence.ts`, registered in `source-registry.ts`). Crossref and
OpenAlex are real, non-duplicated coverage this directory's connectors
provide that `knowledge-pipeline/` does not.

**Not ported in this pass.** Doing so cleanly would require duplicating
the full per-source plumbing pattern `knowledge-pipeline/` uses for
every source type — not just a fetch module, but also: a new
`*PipelineOptions`/`*PipelineResult` type pair in `types.ts`, a new
`run*Pipeline` function in `service.ts`, a new BullMQ job branch in
`worker.ts`, a new job name + `enqueue*`/schedule wiring in `queue.ts`,
and new sync+async HTTP routes in `routes/internal.routes.ts` — across
six files, times two sources. That is a real, scoped feature addition
(effectively doubling the number of supported live API sources), not a
drop-in port reusing an existing pattern, so per the migration plan's
own guidance it was deliberately not forced through in this pass.

If this coverage gap becomes a real priority, the correct shape for
that follow-up is: `knowledge-pipeline/crossref.ts` and
`knowledge-pipeline/openalex.ts` (mirroring `pubmed.ts`'s
`fetch*Documents(): Promise<RawKnowledgeDocument[]>` shape), wired
through the same six touch points listed above.

## Recommended replacement path for `researchIndex.ts`'s output

`researchIndex.ts` reads `data/research/normalized/latest.jsonl` +
approved review-queue records and calls the deprecated
`index_to_qdrant.ts` directly. Until/unless a dedicated adapter is
built, the safest way to get that same approved content into Qdrant
through the production path is to reshape it into the
`{title, content, source_url, ...}` JSONL shape
`knowledge-pipeline/local-evidence.ts` reads from
`data/processed/evidence/*.jsonl`, then run
`runLocalEvidencePipeline()` (`POST /internal/knowledge/local-evidence`)
instead of `researchIndex.ts`.
