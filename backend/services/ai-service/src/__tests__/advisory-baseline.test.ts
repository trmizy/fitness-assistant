import test from "node:test";
import assert from "node:assert/strict";
import { auditCorpus, fixtureContext, fixtureReview, inspectCurrentPrompt } from "../evaluation/advisory-baseline/baseline";
import { validateInterpretationNarration } from "../conversational-intelligence/global/personalized-interpretation";

test("baseline distinguishes prompt sensitivity from observed model reasoning", () => {
  const report = inspectCurrentPrompt();
  assert.equal(report.prompt.evidenceChangesPrompt, true);
  assert.equal(report.prompt.emptyEvidenceChangesPrompt, true);
  assert.equal(report.prompt.originalQuestionIncluded, false);
  assert.equal(report.questionRoutes.length, 5);
  const personal = report.questionRoutes.find((row) => row.question.includes("volume"));
  assert.equal(personal?.globalWithInterpretationEnabled.topic, "PERSONAL_INTERPRETATION");
});

test("baseline exercises real validator; stub success cannot imply model quality", () => {
  const rows = inspectCurrentPrompt().validatorProbes;
  assert.equal(rows.find((row) => row.id === "descriptive")?.validation.ok, true);
  for (const row of rows.filter((row) => row.id !== "descriptive")) assert.equal(row.validation.ok, false, row.id);
});

test("corpus audit flags missing provenance without claiming scientific error", () => {
  const audit = auditCorpus([
    { file: "a.jsonl", value: { id: "a", content: "Some summary", extraction_method: "knowledge_curated", source_url: "https://doi.org/example" } },
    { file: "b.jsonl", value: { id: "a", content: "Repeated identity" } },
  ]);
  assert.equal(audit.chunks, 2);
  assert.equal(audit.extractionMethods.knowledge_curated, 1);
  assert.ok(audit.flags[0].issues.includes("curated_summary_without_original_excerpt_field"));
  assert.ok(audit.flags[1].issues.includes("duplicate_id"));
  assert.match(audit.limitation, /No scientific claim was fact-checked/);
});

test("fixtures carry synthetic provenance and do not invent scientific citations", () => {
  const context = fixtureContext();
  assert.equal(context.knowledge.items[0].source.synthetic, true);
  assert.equal(context.knowledge.items[0].source.url, null);
  assert.equal(context.knowledge.items[0].source.sourceClass, "SYNTHETIC_KNOWLEDGE");
  assert.equal(validateInterpretationNarration("Bạn hoàn thành 10 buổi trong 12 buổi đã lên lịch.", context, fixtureReview()).ok, true);
});
