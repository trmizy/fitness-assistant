/**
 * Unit tests for the PURE mapping function in ingestTrainingMethods.ts —
 * no live Qdrant/Ollama needed (see that file's IO vs. pure-function split).
 * Covers the concrete requirements from docs/CLOUDCODE_IMPLEMENTATION_AUDIT.md
 * Phase 10: every ingested record carries citation/source metadata, and
 * copyright-unsafe records are refused rather than silently ingested.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mapTrainingMethodToPoint, type TrainingMethodRecord } from "../datasets/seed/ingestTrainingMethods";

function baseRecord(overrides: Partial<TrainingMethodRecord> = {}): TrainingMethodRecord {
  return {
    method_id: "fst7_inspired_finisher",
    method: "FST-7 inspired finisher",
    source_type: "coach_public_method",
    source_ref: "Hany Rambod — FST-7 (Fascia Stretch Training)",
    target_level: ["intermediate", "advanced", "professional"],
    goal: "hypertrophy",
    principle: "High-rep pump sets performed at the end of a target-muscle session.",
    constraints: ["Avoid for complete beginners", "Avoid when recoveryScore is low"],
    contraindications: ["acute joint pain in the target muscle/joint"],
    evidence_strength: "practitioner_synthesis",
    citations: ["https://barbend.com/fst7/", "https://www.evogennutrition.com/pages/fst-7"],
    usage_in_app: "Optional finisher suggestion, gated by experienceLevel === ADVANCED",
    copyright_safe: true,
    wording_rule: "Present as 'kỹ thuật finisher lấy cảm hứng từ nguyên tắc FST-7 công khai'",
    reviewed_by: "manual review",
    reviewed_at: "2026-07-31",
    ...overrides,
  };
}

test("maps title/source_type/evidence_level/tags from the source record", () => {
  const point = mapTrainingMethodToPoint(baseRecord());
  assert.equal(point.payload.title, "FST-7 inspired finisher");
  assert.equal(point.payload.source_type, "coach_public_method");
  assert.equal(point.payload.evidence_level, "practitioner_synthesis");
  assert.deepEqual(point.payload.tags, [
    "intermediate",
    "advanced",
    "professional",
    "hypertrophy",
    "trung cấp",
    "nâng cao",
    "chuyên nghiệp",
    "tăng cơ",
  ]);
});

test("textForEmbed leads with a Vietnamese goal/level framing so it's actually retrievable by this app's Vietnamese-phrased RAG queries", () => {
  const point = mapTrainingMethodToPoint(baseRecord());
  assert.match(point.textForEmbed, /Mục tiêu: tăng cơ/);
  assert.match(point.textForEmbed, /Phù hợp trình độ: trung cấp, nâng cao, chuyên nghiệp/);
});

test("SECURITY/CITATION: source_url is always the first http(s) citation — this is what evidenceUsedFromDocs requires to ever surface a citation downstream", () => {
  const point = mapTrainingMethodToPoint(baseRecord());
  assert.equal(point.payload.source_url, "https://barbend.com/fst7/");
  assert.match(point.payload.source_url as string, /^https?:\/\//);
});

test("falls back to null source_url (never a non-http string) when no citation is a real URL", () => {
  const point = mapTrainingMethodToPoint(baseRecord({ citations: ["see internal notes"] }));
  assert.equal(point.payload.source_url, null);
});

test("content includes the principle, constraints, contraindications, and the wording_rule guidance", () => {
  const point = mapTrainingMethodToPoint(baseRecord());
  const content = point.payload.content as string;
  assert.match(content, /High-rep pump sets/);
  assert.match(content, /Avoid for complete beginners/);
  assert.match(content, /acute joint pain/);
  assert.match(content, /kỹ thuật finisher lấy cảm hứng/);
});

test("refuses to map a record whose copyright_safe flag is not true — never silently ingests a possibly-unsafe record", () => {
  assert.throws(() => mapTrainingMethodToPoint(baseRecord({ copyright_safe: false })), /copyright_safe/);
});

test("point id is stable/deterministic for the same method_id — re-ingesting updates rather than duplicates", () => {
  const a = mapTrainingMethodToPoint(baseRecord());
  const b = mapTrainingMethodToPoint(baseRecord());
  assert.equal(a.id, b.id);
  const different = mapTrainingMethodToPoint(baseRecord({ method_id: "mountain_dog_phase_structure" }));
  assert.notEqual(a.id, different.id);
});

test("every extra audit field required for a manual/curated dataset is present on the payload", () => {
  const point = mapTrainingMethodToPoint(baseRecord());
  assert.equal(point.payload.method_id, "fst7_inspired_finisher");
  assert.equal(point.payload.created_from, "training_methods_manual_dataset");
  assert.equal(point.payload.source_file, "data/catalog/knowledge/training_methods.json");
  assert.equal(point.payload.copyright_safe, true);
  assert.equal(point.payload.reviewed_by, "manual review");
  assert.deepEqual(point.payload.all_citations, baseRecord().citations);
});

test("textForEmbed includes the method name and goal so semantic retrieval can actually match relevant queries", () => {
  const point = mapTrainingMethodToPoint(baseRecord());
  assert.match(point.textForEmbed, /FST-7 inspired finisher/);
  assert.match(point.textForEmbed, /hypertrophy/);
});
