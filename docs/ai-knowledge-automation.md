# AI Knowledge Automation

This project uses Ollama + Qdrant + RAG as the primary knowledge architecture.
Research automation is an evidence refresh pipeline. It is not fine-tuning and it
never trains model weights.

## What It Does

- Reads configured research topics.
- Uses allowlisted API connectors such as PubMed, Crossref, and OpenAlex.
- Normalizes metadata into a common schema.
- Deduplicates by DOI, PMID, normalized title, and content hash.
- Scores evidence with transparent reasons.
- Sends low-trust or web records to a local review queue.
- Indexes approved/high-confidence chunks into Qdrant `fitness_evidence`.

## What It Does Not Do

- It does not scrape random websites.
- It does not bypass robots.txt.
- It does not copy full text unless source/license allow it.
- It does not run continuously by default.
- It does not train or fine-tune a model.

## Allowed Sources

Configured in `backend/services/ai-service/src/knowledge/source_registry.ts`:

- PubMed metadata and abstracts.
- PubMed Central open access metadata when appropriate.
- Crossref metadata.
- OpenAlex metadata.
- Manual official guideline summaries.
- Webpage connector only when explicitly allowlisted and robots.txt permits.

## Commands

Dry-run, no writes:

```bash
cd backend/services/ai-service
pnpm run knowledge:research:dry-run
```

Fetch metadata and normalized records, no Qdrant write:

```bash
pnpm run knowledge:research:fetch
```

Review queue:

```text
data/research_review_queue.jsonl
```

Set `status` to `approved` or `rejected` for records needing review.

Index approved/high-confidence records into Qdrant:

```bash
pnpm run knowledge:research:index
```

Offline eval of normalized research metadata:

```bash
pnpm run knowledge:research:eval
```

Then run retrieval eval:

```bash
pnpm run ai:test:rag
pnpm run ai:eval:retrieval
```

## Automation

No background crawler runs by default. Scheduler only runs when:

```bash
ENABLE_RESEARCH_AUTOMATION=true
```

Optional env:

```bash
RESEARCH_AUTOMATION_CRON="0 3 * * 0"
RESEARCH_MAX_RESULTS_PER_TOPIC=5
RESEARCH_MIN_YEAR=2015
RESEARCH_REQUIRE_REVIEW_FOR_WEB=true
RESEARCH_CONTACT_EMAIL=you@example.com
PUBMED_API_KEY=
CROSSREF_MAILTO=you@example.com
RESEARCH_USER_AGENT="FitnessAssistantResearchBot/1.0"
RESEARCH_WEB_ALLOWLIST="example.org"
```

## Rollback

If a bad batch is indexed:

1. Stop automation.
2. Keep the normalized JSONL and review queue entry for audit.
3. Delete Qdrant points by `source_type=research_automation` and matching `retrieved_at`/`content_hash`, or restore the Qdrant volume snapshot.
4. Re-run `ai:test:rag` and `ai:eval:retrieval`.

## Data And License Safety

- Do not use unclear copyrighted full text for training/fine-tuning.
- Do not commit private user data.
- Do not present metadata-only or weak records as firm clinical citations.
- User-facing citations must come from metadata fields such as title, source,
  source_url, DOI, PMID, year/date, license/access, retrieved_at, and checksum.

## Docker Research Automation Tests

Research automation tests are offline by default. Docker fast mode runs dry-run and offline eval without fetching PubMed, Crossref, OpenAlex, or webpages:

```bash
pnpm docker:test:fast
```

Fixture records live under `data/research/fixtures`. They cover PubMed, Crossref, OpenAlex, and allowlisted webpage metadata so connector normalization, deduplication, scoring, chunk metadata, and review policy can be tested without external crawling.

External research fetch remains opt-in only. Keep `DISABLE_EXTERNAL_RESEARCH_FETCH=true` in Docker/CI unless a maintainer deliberately runs a fetch job.
