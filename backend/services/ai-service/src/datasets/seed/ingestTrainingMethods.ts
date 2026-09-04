/**
 * ingestTrainingMethods.ts
 * ────────────────────────
 * Ingests data/catalog/knowledge/training_methods.json — hand-curated
 * "coach public method" principle summaries (FST-7-inspired, Mountain Dog,
 * PHAT, RP mesocycle/deload) — into the SAME `fitness_evidence` Qdrant
 * collection the research-paper pipelines already write to
 * (ingestEvidence.ts / knowledge-pipeline / knowledge/pipeline), so these
 * records are retrievable from the exact same retriever.retrieveEvidence()
 * path cycle-assessment.service.ts already calls. This is a NEW, distinct
 * ingestion pathway (not a paper-metadata pipeline) since these records are
 * coach-principle summaries with their own shape (method/principle/
 * constraints/contraindications/wording_rule), not paper abstracts.
 *
 * Every record already carries citation metadata in the source JSON
 * (`citations: string[]`) — the first URL becomes the point's `source_url`,
 * which MUST be an http(s) URL for citations to actually surface downstream
 * (see src/llm/plan_evidence.ts's evidenceUsedFromDocs gate).
 *
 * IMPORTANT — this pipeline is evidence/explanation-only: nothing in this
 * file, or in what it feeds (retriever.ts -> cycle-assessment.service.ts),
 * ever computes or influences the Decision Engine's decision. The Decision
 * Engine (fitness-service/cycle-decision.engine.ts) is deterministic and
 * runs BEFORE any RAG call; the LLM only explains an already-final decision
 * and may cite this ingested content as supporting evidence.
 *
 * Never copies a paid/copyrighted program: each source record's own
 * `wording_rule` (paraphrase-only framing) is embedded directly into the
 * ingested content so the LLM's explanation naturally follows it.
 *
 * Usage:
 *   npm run ingest:training-methods
 *   npm run ingest:training-methods -- --force   # re-embed all, ignore existing points
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

const QDRANT_HOST = process.env.QDRANT_HOST || "localhost";
const QDRANT_PORT = process.env.QDRANT_PORT || "6333";
const LLM_BASE_URL = process.env.LLM_BASE_URL || "http://localhost:11434";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "nomic-embed-text";
const COLLECTION = "fitness_evidence";
const VECTOR_SIZE = 768;
const CREATED_FROM = "training_methods_manual_dataset";

const ROOT = path.resolve(process.cwd(), "..", "..", "..", "data");
const TRAINING_METHODS_PATH = path.join(ROOT, "catalog", "knowledge", "training_methods.json");

const FORCE = process.argv.includes("--force");

export interface TrainingMethodRecord {
  method_id: string;
  method: string;
  source_type: string;
  source_ref: string;
  target_level: string[];
  goal: string;
  principle: string;
  constraints: string[];
  contraindications: string[];
  evidence_strength: string;
  citations: string[];
  usage_in_app: string;
  copyright_safe: boolean;
  wording_rule: string;
  reviewed_by: string;
  reviewed_at: string;
}

export interface TrainingMethodPoint {
  id: string;
  textForEmbed: string;
  payload: Record<string, unknown>;
}

/** Stable deterministic ID from a string — same scheme as ingestEvidence.ts,
 * so re-running ingestion updates existing points instead of duplicating. */
function stableId(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

const HTTP_URL_RE = /^https?:\/\//i;

/** This app's cycle-assessment RAG queries are Vietnamese-phrased
 * (cycle-assessment.service.ts's buildRagQueries) — the source records'
 * principle/constraints/usage_in_app text is written in English for the
 * curator/reviewer, which embeds too far from those queries to ever be
 * retrieved in practice. A short Vietnamese goal/level tag translation
 * (not a rewrite of the reviewed English content — additive only) closes
 * that gap without touching the compliance-sensitive wording_rule/
 * constraints text itself. */
const GOAL_VI: Record<string, string> = {
  hypertrophy: "tăng cơ",
  strength_and_hypertrophy: "sức mạnh và tăng cơ",
};
const LEVEL_VI: Record<string, string> = {
  beginner: "người mới",
  intermediate: "trung cấp",
  advanced: "nâng cao",
  professional: "chuyên nghiệp",
};

/**
 * Pure mapping function (no IO) — a training_methods.json record to the
 * exact Qdrant point this pipeline upserts. Kept separate from
 * embed/upsert IO so it's unit-testable without a live Qdrant/Ollama.
 */
export function mapTrainingMethodToPoint(record: TrainingMethodRecord): TrainingMethodPoint {
  if (!record.copyright_safe) {
    throw new Error(`Refusing to ingest ${record.method_id}: copyright_safe is not true`);
  }

  const firstHttpCitation = (record.citations || []).find((c) => HTTP_URL_RE.test(c)) ?? null;

  const content = [
    record.principle,
    record.constraints?.length ? `Ràng buộc/điều kiện áp dụng: ${record.constraints.join("; ")}.` : "",
    record.contraindications?.length ? `Chống chỉ định: ${record.contraindications.join("; ")}.` : "",
    record.usage_in_app ? `Cách dùng trong ứng dụng: ${record.usage_in_app}.` : "",
    record.wording_rule ? `Nguyên tắc diễn đạt: ${record.wording_rule}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  const goalVi = GOAL_VI[record.goal] ?? record.goal;
  const levelsVi = (record.target_level || []).map((l) => LEVEL_VI[l] ?? l);
  const tags = [...(record.target_level || []), record.goal, ...levelsVi, goalVi].filter(Boolean);

  const viFraming = `Mục tiêu: ${goalVi}. Phù hợp trình độ: ${levelsVi.join(", ")}. ${record.wording_rule ?? ""}`;

  const textForEmbed = [viFraming, record.method, record.goal, tags.join(" "), content].join(" ");

  return {
    id: stableId(record.method_id),
    textForEmbed,
    payload: {
      title: record.method,
      source_type: record.source_type || "coach_public_method",
      category: "training_method",
      content,
      source_url: firstHttpCitation,
      evidence_level: record.evidence_strength || "practitioner_synthesis",
      tags,
      chunk_index: 0,
      total_chunks: 1,
      extraction_method: "manual_curated",
      created_from: CREATED_FROM,
      source_file: "data/catalog/knowledge/training_methods.json",
      chunk_id: record.method_id,
      // Extra fields beyond the shared fitness_evidence schema, specific to
      // this dataset — harmless (Qdrant payloads are free-form JSON) and
      // useful for the verification script / audit trail.
      method_id: record.method_id,
      source_ref: record.source_ref,
      target_level: record.target_level,
      usage_in_app: record.usage_in_app,
      copyright_safe: record.copyright_safe,
      wording_rule: record.wording_rule,
      reviewed_by: record.reviewed_by,
      reviewed_at: record.reviewed_at,
      all_citations: record.citations,
    },
  };
}

// ── IO (embed + upsert) ─────────────────────────────────────────────────────

async function embed(text: string): Promise<number[]> {
  const r = await axios.post(
    `${LLM_BASE_URL}/api/embeddings`,
    { model: EMBEDDING_MODEL, prompt: text },
    { timeout: 30000 },
  );
  if (!Array.isArray(r.data?.embedding) || r.data.embedding.length === 0) {
    throw new Error("Empty embedding returned");
  }
  return r.data.embedding;
}

async function main() {
  const qdrant = new QdrantClient({ url: `http://${QDRANT_HOST}:${QDRANT_PORT}`, checkCompatibility: false });

  console.log("🔎  Checking Qdrant + embedding service...");
  await qdrant.getCollections();
  console.log("  ✅  Qdrant connection OK");
  await embed("test");
  console.log(`  ✅  Embedding service OK (${EMBEDDING_MODEL})`);

  try {
    await qdrant.getCollection(COLLECTION);
    console.log(`  ✓ Collection '${COLLECTION}' already exists`);
  } catch {
    await qdrant.createCollection(COLLECTION, { vectors: { size: VECTOR_SIZE, distance: "Cosine" } });
    console.log(`  ✓ Created collection '${COLLECTION}'`);
  }

  if (!fs.existsSync(TRAINING_METHODS_PATH)) {
    console.error(`❌  Not found: ${TRAINING_METHODS_PATH}`);
    process.exit(1);
  }
  const records: TrainingMethodRecord[] = JSON.parse(fs.readFileSync(TRAINING_METHODS_PATH, "utf-8"));
  console.log(`📄  ${records.length} training_methods.json records found`);

  let ok = 0;
  let failed = 0;
  let skipped = 0;

  for (const record of records) {
    let point: TrainingMethodPoint;
    try {
      point = mapTrainingMethodToPoint(record);
    } catch (err: any) {
      console.warn(`  ⚠  skipping ${record.method_id}: ${err.message}`);
      skipped++;
      continue;
    }
    if (!point.payload.source_url) {
      console.warn(`  ⚠  ${record.method_id} has no http(s) citation — will ingest but citation will never surface downstream`);
    }

    if (!FORCE) {
      const existing = await qdrant.retrieve(COLLECTION, { ids: [point.id] });
      if (existing.length > 0) {
        console.log(`  ⏭  ${record.method_id} already ingested (use --force to re-embed)`);
        skipped++;
        continue;
      }
    }

    try {
      const vector = await embed(point.textForEmbed);
      await qdrant.upsert(COLLECTION, { wait: true, points: [{ id: point.id, vector, payload: point.payload }] });
      console.log(`  ✅  ${record.method_id}`);
      ok++;
    } catch (err: any) {
      console.warn(`  ⚠  embed/upsert failed for ${record.method_id}: ${err.message}`);
      failed++;
    }
  }

  console.log("");
  console.log(`✅  Ingest complete: ${ok} ok / ${skipped} skipped / ${failed} failed`);
  console.log(`    Collection: ${COLLECTION}`);
  if (failed > 0) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("❌  Fatal:", err.message);
    process.exit(1);
  });
}
