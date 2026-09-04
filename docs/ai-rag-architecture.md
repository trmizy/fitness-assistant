# AI Fitness Assistant: RAG Architecture

The running product uses a RAG-based AI architecture. Model training is an
optional, separate workflow under `training/`; normal application startup and
knowledge ingestion do not train or modify model weights.

## Runtime Architecture

- LLM runtime: Ollama
- Base chat model: `LLM_MODEL`, default `fitness-coach-qwen2.5-1.5b:q4_K_M`
- Embedding model: `EMBEDDING_MODEL`, default `nomic-embed-text`
- Vector database: Qdrant
- AI service: `backend/services/ai-service`
- Gateway route: `backend/gateway`

Primary Qdrant collections:

- `exercises`: semantic exercise catalog for AI Coach chat only
- `fitness_knowledge`: general gym, nutrition, and workout knowledge chunks
- `fitness_faq`: FAQ-style question/answer chunks
- `fitness_evidence`: evidence metadata for body composition and plan reasoning

AI Plan generation does not select exercises from Qdrant. It uses the fitness
service DB/catalog for real exercise IDs and retrieves only `fitness_evidence`
when evidence-based body-composition reasoning is needed.

AI Coach chat may retrieve from all chat-scoped collections, including
`exercises`.

## AI Training vs RAG Ingestion

The application runtime does not train or fine-tune a model. The repository also
contains optional QLoRA research tooling, but it is a separate, manually run
pipeline and is not part of Docker application startup.

What happens today:

- Knowledge ingestion loads curated gym/evidence data into Qdrant.
- RAG indexing creates embeddings with `nomic-embed-text`.
- Prompt policy and deterministic rules shape responses.
- Safety validators and evaluation scripts check behavior.
- Personalization uses user profile, InBody/body metrics, workout logs, and
  nutrition logs.

Some datasets contain instruction-style examples used by evaluation and the
optional training pipeline. Ingestion and reindex commands in this document
only update Qdrant; see `training/README.md` for the distinct QLoRA workflow.

## Knowledge Ingestion And Reindexing

Run from `backend/services/ai-service`:

```powershell
pnpm run ingest -- --collection=all
pnpm run ai:reindex
pnpm run data:validate
pnpm run data:ingest
```

Docker examples:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec ai-service pnpm run ingest -- --collection=all
docker compose -f infra/compose/docker-compose.dev.yml exec ai-service pnpm run ai:reindex
```

`ai:reindex` validates evidence data and ingests evidence chunks into Qdrant.
It is RAG indexing, not model training.

## RAG And Evaluation Commands

Run from `backend/services/ai-service`:

```powershell
pnpm run ai:test:rag
pnpm run ai:eval:retrieval
pnpm run ai:test:evidence
pnpm run ai:test:plan-evidence
pnpm run test:evaluation
pnpm run test:policy
```

Retrieval evaluation options:

```powershell
$env:RAG_RETRIEVAL_EVAL_DATASET="data/eval/retrieval/ground-truth-retrieval.csv"
$env:RAG_RETRIEVAL_EVAL_COLLECTION="exercises"
$env:RAG_RETRIEVAL_EVAL_K="5"
$env:RAG_RETRIEVAL_EVAL_LIMIT="100"
pnpm run ai:eval:retrieval
```

The retrieval eval reports:

- `hitAtK`
- `recallAtK`
- `mrr`
- `averageRetrievalScore`
- failed queries with expected and retrieved document IDs

## Evidence And Citation Policy

Evidence citations must come from retrieved metadata, not from model-generated
text.

For `fitness_evidence`, useful metadata includes:

- `title`
- `source_url`
- `source_type`
- `source_name` or `source`
- `published_at`, `date`, or `year`
- `category` or `topic`
- `evidence_level`

If a retrieved item has no clear title or URL, the AI service should not present
it as a firm citation. It may still use the content internally as context if the
retrieval path allows it, but user-facing `evidence_used` should prefer metadata
that can be verified.

## RAG Debug Logging

Set:

```powershell
$env:DEBUG_RAG="true"
```

Debug logging includes:

- query preview after light scrubbing
- selected retrieval scope and collections
- number of documents retrieved
- top score
- top document IDs and source metadata

It should not log tokens, API keys, emails, or full user health profiles.

## Safety Boundaries

The assistant is not a medical diagnosis system. It may provide educational
fitness guidance, but should avoid diagnosing disease, inventing citations, or
recommending unsafe rapid weight loss or training through injury.

## Research Automation And Evidence Refresh

Research automation lives in `backend/services/ai-service/src/knowledge`. It is a
controlled evidence refresh pipeline, not model training.

Flow:

1. Source registry allowlists PubMed, PMC metadata, Crossref, OpenAlex, manual
   official guideline summaries, and disabled-by-default allowlisted webpages.
2. Connectors fetch metadata/abstracts with timeout, user-agent, optional contact
   email/API key, and rate-limit-aware source config.
3. Pipeline normalizes records, deduplicates DOI/PMID/title/content hash, scores
   evidence, chunks safe text, and preserves citation metadata.
4. Review queue stores pending/approved/rejected/indexed records in
   `data/research_review_queue.jsonl`.
5. Index script writes approved/high-confidence chunks into Qdrant
   `fitness_evidence`.

Commands:

```powershell
cd backend/services/ai-service
pnpm run knowledge:research:dry-run
pnpm run knowledge:research:fetch
pnpm run knowledge:research:eval
pnpm run knowledge:research:index
```

No crawler runs continuously unless `ENABLE_RESEARCH_AUTOMATION=true`. Webpage
sources require explicit allowlist and robots.txt approval. Metadata-only or weak
records must not be presented as firm citations.
