/**
 * testTrainingMethodsIntegration.ts
 * ──────────────────────────────────
 * Verifies ingestTrainingMethods.ts's ingestion actually worked, end-to-end
 * through the REAL retrieval path (retriever.retrieveEvidence ->
 * plan_evidence.evidenceUsedFromDocs), the same path
 * cycle-assessment.service.ts uses — not just a raw Qdrant point count.
 * Exits non-zero if any check fails, so this can be wired into a CI/manual
 * verification step (mirrors testEvidenceIntegration.ts's smoke-test style,
 * but with real pass/fail assertions rather than just printed output).
 *
 * Usage:
 *   npm run ingest:training-methods   # ingest first
 *   npm run ai:test:training-methods  # then verify
 *
 * Prerequisites: Qdrant running, Ollama/embedding service running.
 */
import { getQdrantClient } from "../../repositories/qdrant";
import { retriever } from "../../llm/retriever";
import { evidenceUsedFromDocs } from "../../llm/plan_evidence";
import { mapTrainingMethodToPoint, type TrainingMethodRecord } from "./ingestTrainingMethods";
import fs from "node:fs";
import path from "node:path";

const COLLECTION = "fitness_evidence";
const CREATED_FROM = "training_methods_manual_dataset";
const ROOT = path.resolve(process.cwd(), "..", "..", "..", "data");
const TRAINING_METHODS_PATH = path.join(ROOT, "catalog", "knowledge", "training_methods.json");

let failures = 0;

function check(label: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✅  ${label}`);
  } else {
    console.log(`  ❌  ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  training_methods.json Ingestion Verification");
  console.log("═══════════════════════════════════════════════════\n");

  if (!fs.existsSync(TRAINING_METHODS_PATH)) {
    console.error(`❌  Source file not found: ${TRAINING_METHODS_PATH}`);
    process.exit(1);
  }
  const records: TrainingMethodRecord[] = JSON.parse(fs.readFileSync(TRAINING_METHODS_PATH, "utf-8"));
  console.log(`Source has ${records.length} records.\n`);

  // 1. Every expected point exists in Qdrant, by its stable deterministic ID.
  console.log("1️⃣  Checking each record was ingested as a real Qdrant point...");
  const client = getQdrantClient();
  const expectedPoints = records.map(mapTrainingMethodToPoint);
  const retrieved = await client.retrieve(COLLECTION, { ids: expectedPoints.map((p) => p.id), with_payload: true });
  // Qdrant reformats a 32-hex-char point ID into dashed UUID form on
  // read-back (e.g. "51b5341b1b44..." -> "51b5341b-1b44-..."), so compare
  // with dashes stripped rather than a strict string match.
  const normalize = (id: string) => id.replace(/-/g, "");
  for (const point of expectedPoints) {
    const found = retrieved.find((r) => normalize(String(r.id)) === normalize(point.id));
    check(`${point.payload.method_id} present in '${COLLECTION}'`, !!found);
    if (found) {
      const payload = found.payload as any;
      check(`  → has a real title`, typeof payload.title === "string" && payload.title.length > 0);
      check(`  → has an http(s) source_url (citation)`, typeof payload.source_url === "string" && /^https?:\/\//i.test(payload.source_url), String(payload.source_url));
      check(`  → created_from marks it as this dataset`, payload.created_from === CREATED_FROM);
      check(`  → copyright_safe is true`, payload.copyright_safe === true);
    }
  }

  // 2. Real end-to-end retrieval: the SAME retriever.retrieveEvidence() call
  // cycle-assessment.service.ts makes, for a query one of these records
  // should plausibly match, then run the real citation-extraction gate.
  console.log("\n2️⃣  Real retrieval + citation extraction (retriever.retrieveEvidence + evidenceUsedFromDocs)...");
  const queries = [
    "kỹ thuật finisher tăng bơm máu cuối buổi tập cho nhóm cơ yếu",
    "lịch tập power hypertrophy kết hợp sức mạnh và tăng cơ 5 ngày",
  ];
  let sawAnyTrainingMethodHit = false;
  try {
    const docs = await retriever.retrieveEvidence(queries);
    const citations = evidenceUsedFromDocs(docs);
    check("retrieveEvidence returned at least one document", docs.length > 0);
    check("at least one citation survived evidenceUsedFromDocs's title+source_url gate", citations.length > 0);
    for (const doc of docs) {
      const meta = (doc as any).metadata ?? {};
      if (meta.created_from === CREATED_FROM) {
        sawAnyTrainingMethodHit = true;
        console.log(`     hit: "${meta.title}" (source_url=${meta.source_url})`);
      }
    }
    check("at least one training_methods.json record was actually retrieved for these queries", sawAnyTrainingMethodHit);
  } catch (err: any) {
    check("retrieveEvidence call succeeded", false, err.message);
  }

  console.log("");
  if (failures > 0) {
    console.error(`❌  ${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log("✅  All checks passed — training_methods.json is ingested and retrievable end-to-end.");
}

main().catch((err) => {
  console.error("❌  Fatal:", err.message);
  process.exit(1);
});
