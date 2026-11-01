/** Read-only diagnostics of existing production functions; not a new agent. */
import { createHash } from "node:crypto";
import {
  buildInterpretationPrompt, classifyInterpretationQuestion,
  validateInterpretationNarration, knowledgeCoverage,
  type PersonalizedInterpretationContext,
} from "../../conversational-intelligence/global/personalized-interpretation";
import { classifyGlobal } from "../../conversational-intelligence/global/router";
import type { ProgressReviewV0 } from "../../conversational-intelligence/global/progress-review";
import type { KnowledgeContextItem } from "../../llm/knowledge-source";

export const QUESTIONS = [
  "Tại sao tôi tập đều nhưng không tiến bộ?",
  "Tôi tập đều nhưng cân chưa thay đổi nhiều, dữ liệu hiện tại nói lên điều gì?",
  "Với tình hình hiện tại của tôi thì volume này có ý nghĩa gì?",
  "Vi sao toi tap deu nhung khong tien bo?",
  "Why am I training consistently but not progressing?",
] as const;

/** All personal values are synthetic. No user/session or database is read. */
export function fixtureReview(): ProgressReviewV0 {
  return {
    asOf: "2026-10-27T00:00:00.000Z",
    domains: {
      BODY: { state: "NOT_REQUESTED", quality: null },
      GOAL: { state: "NOT_REQUESTED", quality: null },
      NUTRITION: { state: "NOT_REQUESTED", quality: null },
      TRAINING: { state: "OK", quality: "PARTIAL" },
    },
    goal: { type: null, onTrack: null },
    evidence: [{
      domain: "TRAINING", kind: "SCHEDULED_ADHERENCE", quality: "PARTIAL",
      provenance: "TRAINING_LOGS", window: { days: 28 }, claimBoundary: "DESCRIPTIVE_ONLY",
      value: { scheduled: 12, completed: 10, missed: 2, completionPct: 83 },
    }],
    limitations: [{ code: "NO_CAUSAL_CLAIMS" }], overallCoverage: "PARTIAL",
  };
}

/** Artificial reference, explicitly not scientific evidence. No fabricated URL. */
export function fixtureKnowledge(): KnowledgeContextItem {
  return {
    claimSupportText: "Ghi nhận số buổi hoàn thành mô tả mức thực hiện lịch. Dữ kiện này riêng lẻ không xác định nguyên nhân thay đổi kết quả tập luyện.",
    relevance: "PRIMARY", domain: "TRAINING",
    source: {
      sourceClass: "SYNTHETIC_KNOWLEDGE", sourceId: "synthetic-adherence-reference",
      title: "Synthetic evaluation reference", publisher: null, year: null,
      url: null, section: null, synthetic: true, evidenceLevel: null,
    },
  };
}

export function fixtureContext(items: KnowledgeContextItem[] = [fixtureKnowledge()]): PersonalizedInterpretationContext {
  const review = fixtureReview();
  return {
    questionTopics: ["CONSISTENCY"], personalEvidence: review.evidence,
    limitations: review.limitations, domains: review.domains,
    knowledge: { items, coverage: items.length ? "SYNTHETIC_ONLY" : "NO_RELEVANT_KNOWLEDGE", conflict: null },
  };
}

export function inspectCurrentPrompt() {
  const review = fixtureReview();
  const context = fixtureContext();
  const prompt = buildInterpretationPrompt(context, review);
  const changed = fixtureContext([{ ...fixtureKnowledge(), claimSupportText: "COUNTERFACTUAL_EVIDENCE_MARKER" }]);
  return {
    evidence: "CODE AUDIT + TEST FIXTURE",
    questionRoutes: QUESTIONS.map((question) => ({
      question, global: classifyGlobal(question),
      globalWithInterpretationEnabled: classifyGlobal(question, { trainingCoach: true, personalInterpretation: true }),
      interpretation: classifyInterpretationQuestion(question),
    })),
    routingScope: "Pure router diagnostics: global uses default context; globalWithInterpretationEnabled simulates its two capability booleans, without changing process flags. Neither is a full authenticated dispatch.",
    prompt: {
      sha256: createHash("sha256").update(prompt).digest("hex"), chars: prompt.length,
      originalQuestionIncluded: QUESTIONS.some((question) => prompt.includes(question)),
      evidenceChangesPrompt: prompt !== buildInterpretationPrompt(changed, review),
      emptyEvidenceChangesPrompt: prompt !== buildInterpretationPrompt(fixtureContext([]), review),
      note: "Current builder accepts context/review only, not the original question. This describes the bounded interpretation component, not every chat route.",
    },
    validatorProbes: [
      { id: "descriptive", text: "Bạn đã hoàn thành 10 buổi trong số 12 buổi theo lịch; dữ liệu này chỉ mô tả mức thực hiện." },
      { id: "unsupported-cause", text: "Bạn chưa tiến bộ vì bạn tập quá ít." },
      { id: "unsupported-number", text: "Bạn đã hoàn thành 999 buổi tập." },
      { id: "fabricated-authority", text: "Theo nghiên cứu WHO, mức thực hiện lịch của bạn đạt chuẩn." },
    ].map((probe) => ({ ...probe, validation: validateInterpretationNarration(probe.text, context, review) })),
    coverageHeuristic: {
      twoUnrelatedCuratedItems: knowledgeCoverage({ documents: [], isEmpty: false }, [
        { ...fixtureKnowledge(), source: { ...fixtureKnowledge().source, sourceClass: "CURATED_EVIDENCE", synthetic: false } },
        { ...fixtureKnowledge(), claimSupportText: "Unrelated controlled fixture", source: { ...fixtureKnowledge().source, sourceClass: "CURATED_EVIDENCE", synthetic: false } },
      ]),
      note: "Controlled probe: count-based coverage is not a measurement of claim entailment or sufficiency. No change to source authority is proposed here.",
    },
  };
}

export function auditCorpus(records: Array<{ file: string; value: Record<string, unknown> }>) {
  const counts: Record<string, number> = {};
  const flags: Array<{ file: string; id: unknown; issues: string[] }> = [];
  const seen = new Set<string>();
  for (const { file, value: row } of records) {
    const extraction = String(row.extraction_method ?? "UNKNOWN");
    counts[extraction] = (counts[extraction] ?? 0) + 1;
    const issues: string[] = [];
    const id = String(row.id ?? "");
    if (!id) issues.push("missing_id");
    else if (seen.has(id)) issues.push("duplicate_id");
    seen.add(id);
    if (typeof row.content !== "string" || !row.content.trim()) issues.push("missing_content");
    if (extraction === "knowledge_curated" && !row.original_excerpt && !row.source_excerpt) issues.push("curated_summary_without_original_excerpt_field");
    if (!row.source_url) issues.push("no_source_url");
    if (!row.review_status) issues.push("review_status_not_recorded_in_chunk");
    if (issues.length) flags.push({ file, id: row.id ?? null, issues });
  }
  return {
    evidence: "CODE AUDIT", chunks: records.length, extractionMethods: counts, flags,
    limitation: "Metadata presence only. Missing fields do not prove incorrect content or absence of review elsewhere. No scientific claim was fact-checked; no corpus/vector-store mutation.",
  };
}
