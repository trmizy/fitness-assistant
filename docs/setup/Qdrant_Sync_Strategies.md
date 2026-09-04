# Qdrant Sync Strategies — Detailed (English)

This document provides detailed, practical guidance for keeping Qdrant (the project's vector store) synchronized with the canonical relational database (Postgres via Prisma) for a personalized gym application (exercises, meal plans, schedules, etc.). It describes multiple approaches, trade-offs, implementation notes, testing, monitoring, and recommended next steps.

## Who is this for

- Backend engineers implementing persistence + RAG retrieval.
- Platform/DevOps engineers operating the ingestion/worker infrastructure.

## Objectives

- Ensure RAG retrieval returns current and traceable domain content.
- Keep vector payloads linked to canonical DB rows using stable point IDs and metadata.
- Offer approaches that scale from simple batch ingestion to production-grade real-time sync.

---

## Current code references

- Qdrant client: `backend/services/ai-service/src/repositories/qdrant.ts`
- CSV ingestion script: `backend/services/ai-service/src/ingest.ts`
- Retriever: `backend/services/ai-service/src/llm/retriever.ts`

Notes: the repository contains a CSV-based ingest utility used to populate Qdrant. There is no out-of-the-box replication between Prisma/Postgres and Qdrant — synchronization today is via manual scripts or ad-hoc jobs.

---

## Overview of approaches

The following strategies are listed from simplest to most robust. Choose based on required freshness, team capacity, and operational constraints.

- Immediate app-level upsert (synchronous)
- Background job / async worker (recommended)
- Periodic batch / ETL (cron)
- Change Data Capture (CDC) stream (Debezium/Kafka)

Each approach below contains: when to use, pros/cons, implementation notes, and code sketches where helpful.

---

### 1) Immediate app-level upsert (synchronous)

Summary

- The web/app request that creates or updates a DB row also generates the embedding and calls Qdrant.upsert before returning success.

When to choose

- Prototyping or low-frequency updates (e.g., admin-managed exercise content).

Pros / Cons

- Pros: immediate consistency — the vector is available to RAG as soon as the API call returns.
- Cons: increases API latency and couples user requests to embedding/Qdrant availability. Not recommended for high-volume writes.

Implementation details

- Use deterministic, stable point IDs: e.g. `exercises_<dbId>` or `meal_<dbId>`.
- Only regenerate embeddings when relevant text fields change. Store `embedding_model` and `embedding_version` in metadata.
- Consider timeouts and fallbacks for embedding provider; consider returning a success with `syncPending=true` if the embedding times out.

Example (pseudo-code)

```ts
// inside repository after prisma.upsert(...)
const pointId = `exercises_${exercise.id}`;
const text = `${exercise.name} ${exercise.instructions}`;
const vector = await llmService.generateEmbedding(text);
await qdrantClient.upsert("exercises", {
  points: [
    {
      id: pointId,
      vector,
      payload: { db_id: exercise.id, updatedAt: exercise.updatedAt },
    },
  ],
});
```

Operational notes

- Add monitoring around embedding latency. If embedding service is slow, switch to background-worker pattern.

---

### 2) Background job / async worker (recommended)

Summary

- The application writes to Postgres synchronously, then emits a small event to a queue. A separate worker consumes events, generates embeddings, and upserts Qdrant.

When to choose

- Production systems with moderate-to-high write throughput, or when embedding latency must not block user requests.

Pros / Cons

- Pros: decoupling, retries, batching, resilience, observability.
- Cons: eventual consistency (small delay), requires queue/worker infra (Redis/BullMQ recommended — BullMQ is already a dependency in `ai-service`).

Design components

- Publisher: repository-level hook sends event after DB write/delete:
  - Example event: `{ type: 'exercise.upsert', db_id: 123, updatedAt: '...' }`.

- Worker: consumes events; responsibilities:
  1. Fetch the latest DB row via Prisma.
  2. Skip if the DB row's `updatedAt` <= lastSyncedAt (persisted or in Qdrant payload).
  3. Generate embedding and call Qdrant `upsert` with stable `pointId` and metadata.
  4. On delete event, call Qdrant `delete` for that `pointId`.

Idempotency and deduplication

- Use stable `pointId` and `upsert` semantics. Worker retries are safe.

Suggested queue infrastructure

- `BullMQ` + Redis (already available). Configure job retries, timeouts, backoff, and concurrency.

Worker example (sketch)

```ts
// ai-service/src/workers/sync.worker.ts
import { Worker } from "bullmq";
import { prisma } from "@gym-coach/ai-service/src/repositories/conversation.repository";
import { llmService } from "../services/llm.service";
import { getQdrantClient } from "../repositories/qdrant";

const q = getQdrantClient();
const worker = new Worker("sync-queue", async (job) => {
  const { type, db_id, entity } = job.data;
  if (type === "exercise.delete") {
    await q.delete("exercises", { points: [{ id: `exercises_${db_id}` }] });
    return;
  }
  const record = await prisma.exercise.findUnique({ where: { id: db_id } });
  if (!record) return;
  const text = `${record.name} ${record.instructions}`;
  const vector = await llmService.generateEmbedding(text);
  await q.upsert("exercises", {
    points: [
      {
        id: `exercises_${db_id}`,
        vector,
        payload: { db_id, updatedAt: record.updatedAt },
      },
    ],
  });
});
```

Publisher example

```ts
// backend/services/fitness-service/src/repositories/exercise.repository.ts
await prisma.exercise.upsert(...);
await queue.add('sync-queue', { type: 'exercise.upsert', db_id: exercise.id, entity: 'exercise' });
```

Operational suggestions

- Store a `lastSyncedAt` column or write `synced_at` into the Qdrant payload to avoid unnecessary re-embeds.
- Add a dead-letter queue for failed jobs and instrument metrics (job success, retries, latency).

---

### 3) Periodic batch / ETL (cron)

Summary

- Run the existing `ingest.ts` script on a schedule to upsert collections from CSV or a DB export.

When to choose

- Low-frequency data changes, or when you prefer simpler operational burden.

Pros / Cons

- Pros: low engineering complexity and easy to reason about.
- Cons: not real-time; rebuilds may be heavy.

Commands

```bash
# Full rebuild
pnpm --filter @gym-coach/ai-service run ingest -- --collection=all

# Rebuild exercises only
pnpm --filter @gym-coach/ai-service run ingest -- --collection=exercises
```

Notes

- `ingest.ts` already includes CSV parsing, embedding calls, and Qdrant upsert logic. It can be adapted to read from DB instead of CSV for more precise sync.

---

### 4) Change Data Capture (CDC) pipeline

Summary

- Use CDC (Debezium) to stream DB changes into Kafka or a message bus; consumers transform events to embedding/Qdrant operations.

When to choose

- High scale, multiple services that require consistent streams, or when you need replayability and strong operational guarantees.

Pros / Cons

- Pros: very robust, replayable, and minimally invasive to application code.
- Cons: significant infra and operational complexity (Kafka, Debezium, connectors).

Implementation sketch

- Debezium captures `insert/update/delete` and writes topics like `db.public.exercise`.
- A consumer service subscribes, debounces rapid updates, batches embeds where possible, and upserts points to Qdrant.

Operational notes

- Consumers must handle schema evolution and be idempotent. Use stable `pointId` and include `lsn`/`
binlog` offsets for replayability.

---

## Common implementation best practices

- Stable point IDs: e.g., `exercises_<dbId>`, `meal_<dbId>`. This makes deletes/updates straightforward.
- Payload metadata: include `{ source: 'postgres', db_id, updatedAt, embedding_model, tags }`.
- Embedding policy: only re-embed when text fields changed or embedding model/version changed.
- Delete handling: issue Qdrant delete for removed DB rows to prevent stale vectors.
- Idempotency: rely on upsert semantics and deterministic IDs for safe retries.
- Observability: track queue length, job age, worker errors, Qdrant health, and per-collection `points_count`.

## Testing & validation

- Unit tests: add mocks for `QdrantClient` and `llmService.generateEmbedding` for repository and worker tests.
- Integration: run a staging worker, perform a DB write, and assert via Qdrant HTTP API that points appear and retriever returns results.
- E2E smoke: create/update exercise via API → verify sync → call AI endpoint to confirm RAG used Qdrant documents.

## Observability & monitoring (recommendations)

- Metrics to export:
  - `sync_jobs_pending`, `sync_job_duration_seconds`, `sync_job_errors_total`
  - `qdrant_collection_points_count{collection}`
  - `embedding_latency_seconds`
- Logs should include `db_id`, `point_id`, `action`, `worker_job_id` and be emitted as structured JSON.

## Rollout plan (recommended)

1. Backfill: run `ingest.ts` to ensure Qdrant collections are populated and validated.
2. Implement background worker in `ai-service` and deploy to staging with monitoring enabled.
3. Add repository-level publisher for a single entity (e.g., `exercises`) and validate sync in staging.
4. Expand publishers to meal plans and schedules, monitor and iterate.

## Security, cost, and operational considerations

- Do not embed or store sensitive PII. Redact or anonymize before embedding.
- Embeddings and vector storage cost scale with document volume and model; monitor and batch embeddings to reduce cost.
- Use internal network + `QDRANT_API_KEY` (if supported) for production security.

## Recommendation

- Implement the Background job / async worker approach (BullMQ + Redis) as the primary sync mechanism, and keep `ingest.ts` as an administrative backfill tool.

---

## Next steps I can implement for you

Pick one and I will create the changes and tests:

1. Add repository publisher hooks for `exercises` and `meal_plans` (small patch).
2. Add a BullMQ worker to `ai-service` with example job processing logic, metrics, and retries.
3. Run a one-time `ingest` to backfill Qdrant now and report results.

Tell me which option you want and I'll proceed.
