/**
 * Phase 4.7 — evidence-grounded personalized interpretation
 * (docs/ai-product/phase4-7-evidence-grounded-coach.md).
 * Pure/stubbed sections = TEST FIXTURE; the `tryTurn` sections run the real orchestrator + workflow DB (isolated *_test).
 * No Qdrant, no embeddings, no model: retrieval is stubbed with V2-shaped documents, narration with a counting stub.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import axios from "axios";
import { llmService } from "../services/llm.service";
import { classifyGlobal } from "../conversational-intelligence/global/router";
import {
  answerPersonalizedInterpretation, buildInterpretationPrompt, classifyInterpretationQuestion, interpretationDeps,
  validateInterpretationNarration, type PersonalizedInterpretationContext,
} from "../conversational-intelligence/global/personalized-interpretation";
import { buildProgressReviewV0 } from "../conversational-intelligence/global/progress-review";
import { retriever } from "../llm/retriever";
import { buildKnowledgeContext } from "../llm/knowledge-source";
import { retrieveV2, type V2Io } from "../llm/retrieval-v2";
import { retrievalDocumentFromPayload } from "../llm/retriever";
import type { RetrievalResult } from "../llm/types";

const dbUrl = process.env.DATABASE_URL || "";
const canUseDb = /(_test|postgres-test)/i.test(dbUrl) && process.env.NODE_ENV === "test";
const skipDb = { skip: !canUseDb ? "needs isolated *_test Postgres + NODE_ENV=test" : false } as const;

// ── upstream fixtures (real endpoint shapes) ─────────────────────────────

const trendNA = { status: "INSUFFICIENT_HISTORY", dataPoints: 0 };
const bodyGoalUp = (over: { bodyFatTrend?: any; weightDirection?: string } = {}) => ({
  asOf: "2026-10-11T00:00:00.000Z", lookbackDays: 90,
  body: {
    dataQuality: "SUFFICIENT",
    observations: { totalOnRecord: 4, inLookback: 4, comparableInLookback: 4, firstAt: "2026-08-20T07:00:00.000Z", latestAt: "2026-10-05T07:00:00.000Z" },
    latest: { measuredAt: "2026-10-05T07:00:00.000Z", weightKg: 78, bodyFatPct: null, muscleMassKg: 33, source: "MANUAL", excludedFromTrend: false },
    previous: null, latestAgeDays: 5,
    trends: { weight: { status: "AVAILABLE", direction: over.weightDirection ?? "DOWN", changePerWeek: -0.6, dataPoints: 4 }, bodyFat: over.bodyFatTrend ?? trendNA, muscleMass: trendNA },
    quality: { outlierCount: 0, intervalWarningCount: 0, mixedSources: false, confidenceMultiplier: 1, flags: [] },
    muscleMassSemantics: "UNRESOLVED", muscleMassProvenance: { extracted: 0, manual: 4, unknown: 0 },
    profileReportedWeight: { kg: 78, matchesLatestMeasurement: true, differenceFromLatestKg: 0 },
  },
  goal: {
    type: "WEIGHT_LOSS",
    currentTarget: { state: "AVAILABLE", weightKg: 75, source: "PROFILE_TARGET_WEIGHT", history: "TARGET_HISTORY_UNAVAILABLE" },
    startingState: { state: "NOT_AVAILABLE", reason: "NO_ACTIVE_CYCLE" }, profileStartingWeightKg: 86,
    gap: { state: "AVAILABLE", currentKg: 78, targetKg: 75, differenceKg: 3, absoluteKg: 3, currentSource: "MEASURED_INBODY", currentAsOf: "2026-10-05T07:00:00.000Z", alternateCurrent: null },
    trajectory: {
      observed: { state: "AVAILABLE", timeSpanDays: 46, observationCount: 4, firstWeightKg: 82, latestWeightKg: 78, observedChangeKg: -4, observedRateKgPerWeek: -0.6, directionRelativeToGap: "TOWARD_TARGET" },
      onTrack: { status: "NOT_EVALUABLE", reasons: ["NO_TARGET_DATE", "NO_STARTING_STATE"], classification: "DEFERRED" },
    },
    roadmap: { state: "NONE" }, dataQuality: "PARTIAL",
  },
});
const trainingUp = () => ({
  period: { from: "2026-09-13T00:00:00.000Z", to: "2026-10-10T12:00:00.000Z", days: 28 },
  adherence: { state: "MEASURED", scheduledSessions: 9, completedSessions: 8, missedSessions: 1, completionRate: 0.89, dataQuality: "SUFFICIENT" },
  frequency: { completedPerWeek: 2.3, scheduledPerWeek: 2.3, trainingDaysLogged: 9, weeklyVolumeConsistency: 0.8, dataQuality: "SUFFICIENT" },
  volume: { totalVolumeLoadKg: 10440, byMuscleGroupKg: {}, byWeek: [], volumeTrendPercent: null, completedSetCount: 18, loadedSetCount: 18, dataQuality: "SUFFICIENT" },
  progression: { exercises: [{ exerciseId: "b", exerciseName: "Bench Press", baselineE1rmKg: 100, currentE1rmKg: 110, changePct: 10, weeksObserved: 4, dataQuality: "SUFFICIENT" }], dataQuality: "SUFFICIENT" },
  plateau: { status: "NOT_AVAILABLE", reason: "n/a" },
  effort: {
    rpe: { observedSets: 6, totalCompletedSets: 18, weeklyAvg: [8, 8, 9], trend: "stable", dataQuality: "PARTIAL" },
    rir: { observedSets: 0, totalCompletedSets: 18, weeklyAvg: [], trend: null, dataQuality: "NO_DATA" },
    sessionFeedback: { feedbackCount: 0, averageSessionRpe: 8, sessionRpeSource: "set_rpe_fallback", averagePainScore: null, recoveryScore: null, dataQuality: "NO_DATA" },
  },
  signals: [], dataQuality: "SUFFICIENT",
});
const nutritionUp = (over: any = {}) => ({
  period: { from: "2026-09-13T00:00:00.000Z", to: "2026-10-10T12:00:00.000Z", days: 28 },
  activeTarget: { state: "ACTIVE_TARGET", goalId: "g1", caloriesKcal: 2000, proteinG: 150, carbsG: 200, fatG: 65, validFrom: "2026-08-01T00:00:00.000Z", triggeredBy: "ONBOARDING" },
  targetChangedInWindow: false,
  actual: { days: [], summary: { daysInWindow: 28, loggedDays: over.loggedDays ?? 24, calories: { averageKcal: 2000, daysUsed: over.loggedDays ?? 24 }, protein: { averageG: 140, daysUsed: over.loggedDays ?? 20, partialDays: 0 }, carbs: { averageG: null, daysUsed: 0, partialDays: 0 }, fat: { averageG: null, daysUsed: 0, partialDays: 0 } } },
  adherence: { state: "MEASURED", calories: { comparedDays: 24, averageTarget: 2000, averageActual: 2000, averageDelta: 0, averageAbsoluteDelta: 100 }, protein: { comparedDays: 20, averageTarget: 150, averageActual: 140, averageDelta: -10, averageAbsoluteDelta: 10 }, carbs: null, fat: null },
  dataQuality: over.quality ?? "SUFFICIENT",
});

// ── knowledge fixtures: V2-shaped retrieval results built by the REAL retrieveV2 ─────

const ev = (o: Record<string, unknown> = {}) => ({
  title: "ISSN Position Stand: Protein and Exercise (2017)", source_type: "curated_summary", category: "nutrition", document_id: "issn-protein-2017", source_name: "ISSN",
  content: "ISSN position stand: a protein intake of 1.4-2.0 g/kg body weight per day is sufficient for exercising individuals to build and maintain muscle mass.",
  source_url: "https://doi.org/10.1186/s12970-017-0177-8", evidence_level: "expert_consensus", created_from: "external_evidence_dataset", chunk_id: "issn-protein-2017-chunk-0", source_file: "f", ...o,
});
const faq = (q: string, a: string) => ({ id: 1, faqId: "FAQ1", questionVi: q, answerVi: a, category: "nutrition", tags: "" });
type Hit = { id: string; similarity: number; payload: Record<string, unknown> };
async function v2(question: string, by: Record<string, Hit[]>): Promise<RetrievalResult> {
  const io: V2Io = { embed: async () => [1], search: async (c) => by[c] ?? [], toDoc: retrievalDocumentFromPayload };
  const { trace: _t, ...res } = await retrieveV2(question, io);
  return res;
}
const KNOW = {
  curated: () => v2("protein intake g/kg resistance training muscle", { fitness_evidence: [
    { id: "a", similarity: 0.75, payload: ev() },
    { id: "b", similarity: 0.72, payload: ev({ title: "Position stand: nutrient timing (2017)", document_id: "issn-timing-2017", chunk_id: "t-0", content: "Protein intake distributed evenly across the day over several meals supports muscle protein synthesis in resistance trained individuals." }) },
  ] }),
  conflict: () => v2("protein intake g/kg resistance training muscle", { fitness_evidence: [
    { id: "a", similarity: 0.75, payload: ev() },
    { id: "b", similarity: 0.74, payload: ev({ title: "ISSN Position Stand: Diets and Body Composition (2017)", document_id: "issn-diets-2017", chunk_id: "d-0", content: "A daily protein intake of 2.3-3.1 g/kg body weight per day may be warranted to preserve muscle mass in lean resistance trained athletes." }) },
  ] }),
  // Phase 4.7R: same two figures but different scope (fat-free mass during restriction) are NOT a conflict
  scopeDiffers: () => v2("protein intake g/kg resistance training muscle", { fitness_evidence: [
    { id: "a", similarity: 0.75, payload: ev() },
    { id: "b", similarity: 0.74, payload: ev({ title: "ISSN Position Stand: Diets and Body Composition (2017)", document_id: "issn-diets-2017", chunk_id: "d-0", content: "During energy restriction protein 2.3-3.1 g/kg of fat free mass may be warranted to preserve muscle mass in lean resistance trained athletes." }) },
  ] }),
  synthetic: () => v2("protein mỗi ngày nên ăn bao nhiêu", { fitness_faq: [{ id: "f", similarity: 0.8, payload: faq("Nên ăn bao nhiêu protein mỗi ngày?", "Phần lớn người tập nên ăn protein đều đặn mỗi bữa để hỗ trợ cơ bắp.") }] }),
  none: () => v2("protein intake g/kg resistance training muscle", {}),
};

// ── harness ──────────────────────────────────────────────────────────────

type Counters = { llm: number; narr: number; retrieval: number; urls: string[] };
async function withWorld(
  opts: { knowledge?: () => Promise<RetrievalResult>; narrate?: (c: PersonalizedInterpretationContext) => Promise<string | null>; failNutrition?: boolean; user?: (auth: string) => "A" | "B"; nutrition?: any },
  fn: (c: Counters) => Promise<void>,
) {
  const origGet = axios.get, origCall = llmService.callLLM, origNarr = interpretationDeps.narrate, origRet = retriever.retrieveForChat, origFlag = process.env.GYMINI_UNIFIED_AI_COACH;
  const c: Counters = { llm: 0, narr: 0, retrieval: 0, urls: [] };
  (llmService as any).callLLM = async () => { c.llm++; return { answer: "{}" }; };
  interpretationDeps.narrate = async (ctx) => { c.narr++; return opts.narrate ? opts.narrate(ctx) : null; };
  (retriever as any).retrieveForChat = async () => { c.retrieval++; return (opts.knowledge ?? KNOW.curated)(); };
  (axios as any).get = async (url: string, cfg: any) => {
    c.urls.push(url);
    const who = opts.user?.(cfg?.headers?.Authorization ?? "") ?? "A";
    if (url.includes("/stats/body-goal-state")) {
      if (who === "B") { const b: any = bodyGoalUp(); b.body = { ...b.body, dataQuality: "NO_DATA", latest: null, latestAgeDays: null, profileReportedWeight: null, observations: { totalOnRecord: 0, inLookback: 0, comparableInLookback: 0, firstAt: null, latestAt: null } }; b.goal = { ...b.goal, currentTarget: { state: "NO_TARGET" }, gap: { state: "NOT_AVAILABLE", reason: "NO_TARGET" }, type: null, profileStartingWeightKg: null, dataQuality: "NO_DATA" }; return { data: b }; }
      return { data: bodyGoalUp() };
    }
    if (url.includes("/stats/training-window")) return { data: trainingUp() };
    if (url.includes("/nutrition/analytics/window")) {
      if (opts.failNutrition) throw Object.assign(new Error("boom"), { response: { status: 500 } });
      return { data: nutritionUp(opts.nutrition ?? {}) };
    }
    throw new Error(`unexpected GET ${url}`);
  };
  process.env.GYMINI_UNIFIED_AI_COACH = "on";
  try { await fn(c); } finally {
    axios.get = origGet; llmService.callLLM = origCall; interpretationDeps.narrate = origNarr; (retriever as any).retrieveForChat = origRet;
    if (origFlag === undefined) delete process.env.GYMINI_UNIFIED_AI_COACH; else process.env.GYMINI_UNIFIED_AI_COACH = origFlag;
  }
}
const idn = (u = "u1") => ({ userId: u, authorizationHeader: `Bearer token-${u}` }) as any;
const Q_PROTEIN = "Protein logged của tôi thấp hơn target 10g, điều đó có ý nghĩa gì?";

// ── A. classification / routing ──────────────────────────────────────────

test("classification: personal metric + 'what does it mean' wording; readback/knowledge/holistic/safety/action are NOT claimed", () => {
  const yes: Array<[string, string]> = [
    [Q_PROTEIN, "PROTEIN"],
    ["Với protein hiện tại của tôi thì nên hiểu thế nào?", "PROTEIN"],
    ["RPE của tôi gần đây cao như vậy có đáng chú ý không?", "RPE_RIR"],
    ["Với tình hình hiện tại của tôi thì volume này có ý nghĩa gì?", "VOLUME"],
    ["Cân nặng đang giảm nhưng body fat chưa rõ, tôi nên hiểu tiến độ này ra sao?", "BODY_FAT"],
    ["Tôi tập đều nhưng cân chưa thay đổi nhiều, dữ liệu hiện tại nói lên điều gì?", "CONSISTENCY"],
  ];
  for (const [q, topic] of yes) assert.ok(classifyInterpretationQuestion(q)?.topics.includes(topic as never), q);
  const no = [
    "Protein trung bình của tôi bao nhiêu?",                // A: readback
    "Protein quan trọng thế nào?",                          // B: pure knowledge (no personal cue)
    "RPE là gì?",
    "Vậy giảm calo giúp tôi.",                               // D: action
    "Tôi nên giảm bao nhiêu calo?",                          // recommendation
    "Nhìn tổng thể dữ liệu của tôi thì có gì đáng chú ý?",  // holistic → Phase 4.5 (no specific metric)
    "Tôi đau lưng khi tập, điều đó có ý nghĩa gì?",          // safety → existing conservative path
    "Tôi đi đúng hướng, có phải đúng tiến độ không?",        // deadline question → Phase 4.5
  ];
  for (const q of no) assert.equal(classifyInterpretationQuestion(q), null, q);
});

test("routing: needs the personalInterpretation context flag; OFF → legacy route; pending workflow is interrupted not consumed", () => {
  const on = classifyGlobal(Q_PROTEIN, { trainingCoach: true, personalInterpretation: true });
  assert.equal(on.route, "READ_STATE");
  assert.equal(on.topic, "PERSONAL_INTERPRETATION");
  assert.notEqual(classifyGlobal(Q_PROTEIN, { trainingCoach: true }).topic, "PERSONAL_INTERPRETATION");
  assert.deepEqual(classifyGlobal(Q_PROTEIN, { trainingCoach: true, personalInterpretation: false }), classifyGlobal(Q_PROTEIN, { trainingCoach: true }));
  assert.deepEqual(classifyGlobal(Q_PROTEIN, {}), classifyGlobal(Q_PROTEIN, { personalInterpretation: false }));
  const ctx = { active: { wf: "FIND_PT", slot: "budgetVnd" }, trainingCoach: true, personalInterpretation: true };
  assert.equal(classifyGlobal("Với tiến độ tập của tôi thì consistency hiện tại có ý nghĩa gì?", ctx).topic, "PERSONAL_INTERPRETATION");
  assert.equal(classifyGlobal("2 triệu.", ctx).route, "SLOT_ANSWER");
  // phase 4.5 / 4.2 owners are unchanged
  assert.equal(classifyGlobal("Dạo này tình hình của tôi thế nào?", ctx).topic, "PROGRESS_REVIEW");
  assert.equal(classifyGlobal("28 ngày qua tôi tập đều không?", ctx).topic, "TRAINING_PROGRESS");
});

// ── B. grounding behaviour ───────────────────────────────────────────────

test("CURATED_SUFFICIENT: facts (code) + sourced knowledge (code) + interpretation; no causal/prescriptive text; sources exposed", async () => {
  await withWorld({ narrate: async () => "Mức protein ghi nhận gần mục tiêu hiện tại; hai điều này chỉ là mô tả số liệu trong các ngày có dữ liệu." }, async (c) => {
    const a = await answerPersonalizedInterpretation(idn(), Q_PROTEIN);
    assert.equal(a.facts.knowledgeCoverage, "CURATED_SUFFICIENT");
    assert.match(a.text, /140 g\/ngày/);
    assert.match(a.text, /ISSN Position Stand: Protein and Exercise \(2017\)/);
    assert.match(a.text, /doi\.org/);
    assert.match(a.text, /không chứng minh quan hệ nhân quả/);
    assert.doesNotMatch(a.text, /nên (giảm|tăng)|vì ăn|tối ưu/);
    assert.equal((a.facts.sources as any[]).length >= 1, true);
    assert.equal(c.narr, 1);
    assert.equal(c.retrieval, 1);
  });
});

test("DEMAND-DRIVEN: nutrition question fetches only nutrition + one retrieval; body question only body+goal", async () => {
  await withWorld({}, async (c) => {
    await answerPersonalizedInterpretation(idn(), Q_PROTEIN);
    assert.deepEqual(c.urls.map((u) => u.replace(/^.*(\/stats\/[a-z-]+|\/nutrition\/analytics\/window).*$/, "$1")), ["/nutrition/analytics/window"]);
    assert.equal(c.retrieval, 1);
  });
  await withWorld({}, async (c) => {
    await answerPersonalizedInterpretation(idn(), "Cân nặng đang giảm nhưng body fat chưa rõ, tôi nên hiểu tiến độ này ra sao?");
    assert.equal(c.urls.length, 1);
    assert.match(c.urls[0], /\/stats\/body-goal-state$/);
  });
});

test("BODY COMPOSITION: weight down + no body-fat trend ⇒ no fat-loss conclusion; limitation explained", async () => {
  const bia = () => v2("bioelectrical impedance body composition", { fitness_evidence: [
    { id: "a", similarity: 0.78, payload: ev({ title: "Validation of InBody 770 bioelectrical impedance analysis", document_id: "brewer-2021", category: "body_composition", content: "Bioelectrical impedance body composition estimates can differ from reference methods and vary with hydration and measurement conditions." }) },
    { id: "b", similarity: 0.76, payload: ev({ title: "ESPEN BIA Guidelines Part I (2019)", document_id: "espen-bia-1", source_name: "ESPEN", category: "bia_validation", content: "Bioelectrical impedance analysis body composition results depend on standardized measurement conditions and hydration status." }) },
  ] });
  await withWorld({ knowledge: bia, narrate: async () => null }, async () => {
    const a = await answerPersonalizedInterpretation(idn(), "Cân nặng đang giảm nhưng body fat chưa rõ, tôi nên hiểu tiến độ này ra sao?");
    assert.match(a.text, /82 → 78 kg/);
    assert.match(a.text, /chưa có xu hướng tỷ lệ mỡ đủ tin cậy/);
    assert.match(a.text, /ESPEN BIA Guidelines/);
    assert.doesNotMatch(a.text, /giảm mỡ thành công|đã giảm mỡ/);
  });
});

test("SYNTHETIC_ONLY: limited explanation labelled internal; never scientific-authority framing", async () => {
  await withWorld({ knowledge: KNOW.synthetic, narrate: async () => "Theo nghiên cứu, protein đều mỗi bữa luôn tốt." }, async (c) => {
    const a = await answerPersonalizedInterpretation(idn(), Q_PROTEIN);
    assert.equal(a.facts.knowledgeCoverage, "SYNTHETIC_ONLY");
    assert.match(a.text, /không phải nghiên cứu khoa học/);
    assert.doesNotMatch(a.text, /Theo các nguồn khoa học|Theo nghiên cứu/);
    assert.equal(a.facts.usedNarration, false, "authority framing without curated support is rejected");
    assert.equal(c.narr, 1);
  });
});

test("NO_RELEVANT_KNOWLEDGE: personal facts still returned, scientific part truthfully unavailable, 0 model calls", async () => {
  await withWorld({ knowledge: KNOW.none, narrate: async () => "x" }, async (c) => {
    const a = await answerPersonalizedInterpretation(idn(), Q_PROTEIN);
    assert.equal(a.facts.knowledgeCoverage, "NO_RELEVANT_KNOWLEDGE");
    assert.match(a.text, /140 g\/ngày/);
    assert.match(a.text, /chưa tìm thấy tài liệu phù hợp trong kho kiến thức hiện tại/);
    assert.equal(c.narr, 0);
    assert.equal(a.facts.llmCalls, 0);
  });
});

test("RPE (4.7R): a paper that merely mentions RPE as an outcome is NOT evidence for the RPE interpretation — no source, 0 model calls", async () => {
  const incidental = { title: "Cool in theory, not in practice: Effects of interset palm cooling on resistance exercise performance", source_type: "paper", category: "training",
    content: "Ratings of perceived exertion (RPE) were lower with palm cooling between sets.", source_url: "https://doi.org/10.1000/x", evidence_level: "peer_reviewed", document_id: "pc", chunk_id: "pc:0" };
  const knowledge = () => v2("rating of perceived exertion repetitions in reserve resistance training intensity", { fitness_evidence: [{ id: "p", similarity: 0.72, payload: incidental }] });
  await withWorld({ knowledge, narrate: async () => "x" }, async (c) => {
    const a = await answerPersonalizedInterpretation(idn(), "RPE của tôi gần đây cao như vậy có đáng chú ý không?");
    assert.equal(a.facts.knowledgeCoverage, "NO_RELEVANT_KNOWLEDGE");
    assert.match(a.text, /chưa tìm thấy tài liệu phù hợp/);
    assert.doesNotMatch(a.text, /palm cooling|Cool in theory/i);
    assert.equal(c.narr, 0);
    assert.equal(a.facts.llmCalls, 0);
  });
});

test("SOURCE CONFLICT: both ranges shown with sources, none selected; no new target proposed", async () => {
  await withWorld({ knowledge: KNOW.conflict, narrate: async () => null }, async () => {
    const a = await answerPersonalizedInterpretation(idn(), "Protein target của tôi có ý nghĩa gì với mức protein hiện tại của tôi?");
    assert.equal(a.facts.knowledgeCoverage, "CONFLICTING_EVIDENCE");
    assert.match(a.text, /1\.4–2/);
    assert.match(a.text, /2\.3–3\.1/);
    assert.match(a.text, /không chọn một con số/);
    assert.doesNotMatch(a.text, /target (nên|mới)|nên đặt/);
  });
});

test("SOURCE CONFLICT SCOPE (4.7R): figures with different scope (body weight vs fat-free mass, normal vs restriction) are NOT a conflict", async () => {
  await withWorld({ knowledge: KNOW.scopeDiffers, narrate: async () => null }, async () => {
    const a = await answerPersonalizedInterpretation(idn(), "Protein target của tôi có ý nghĩa gì với mức protein hiện tại của tôi?");
    assert.notEqual(a.facts.knowledgeCoverage, "CONFLICTING_EVIDENCE");
    assert.doesNotMatch(a.text, /không chọn một con số/);
  });
});

test("NUTRITION PARTIAL COVERAGE (10/28): interpretation keeps the coverage limitation", async () => {
  await withWorld({ nutrition: { loggedDays: 10, quality: "PARTIAL" }, narrate: async () => null }, async () => {
    const a = await answerPersonalizedInterpretation(idn(), Q_PROTEIN);
    assert.match(a.text, /Trong các ngày có dữ liệu \(10\/28 ngày\)/);
    assert.doesNotMatch(a.text, /mức ăn bình thường của bạn/);
  });
});

test("PARTIAL SERVICE ERROR: nutrition unavailable ≠ no data; other domains still interpreted", async () => {
  await withWorld({ failNutrition: true }, async () => {
    const a = await answerPersonalizedInterpretation(idn(), "Cân nặng và protein của tôi dạo này có ý nghĩa gì?");
    assert.match(a.text, /82 → 78 kg/);
    assert.match(a.text, /Ăn uống: hiện mình chưa đọc được dữ liệu này/);
    assert.doesNotMatch(a.text, /chưa có nhật ký/);
  });
});

test("CROSS-USER: B's interpretation contains none of A's personal values", async () => {
  await withWorld({ user: (auth) => (auth.endsWith("-a") ? "A" : "B") }, async () => {
    const a = await answerPersonalizedInterpretation(idn("a"), "Cân nặng của tôi dạo này có ý nghĩa gì?");
    const b = await answerPersonalizedInterpretation(idn("b"), "Cân nặng của tôi dạo này có ý nghĩa gì?");
    assert.match(a.text, /82 → 78 kg/);
    assert.doesNotMatch(b.text, /82|78 kg|75 kg|\b86\b/);
  });
});

// ── C. hallucination / claim validation ──────────────────────────────────

async function ctxFor(k: () => Promise<RetrievalResult>): Promise<{ ctx: PersonalizedInterpretationContext; review: ReturnType<typeof buildProgressReviewV0> }> {
  const res = await k();
  const items = buildKnowledgeContext(res.documents as never);
  const review = buildProgressReviewV0({
    asOf: new Date("2026-10-11T00:00:00.000Z"),
    bodyGoal: { status: "ok", state: { asOf: "x", body: bodyGoalUp().body, goal: bodyGoalUp().goal } as never },
    training: { status: "ok", state: { asOf: "x", training: trainingUp() } as never },
    nutrition: { status: "ok", state: { asOf: "x", nutrition: { period: nutritionUp().period, activeTarget: nutritionUp().activeTarget, targetChangedInWindow: false, actual: nutritionUp().actual.summary, adherence: nutritionUp().adherence, dataQuality: "SUFFICIENT" } } as never },
  });
  const coverage = items.some((i) => i.source.sourceClass === "CURATED_EVIDENCE") ? ("CURATED_SUFFICIENT" as const) : ("SYNTHETIC_ONLY" as const);
  return { ctx: { questionTopics: ["PROTEIN"], personalEvidence: review.evidence, limitations: review.limitations, domains: review.domains, knowledge: { items, coverage, conflict: null } }, review };
}

test("validator rejects: personal number, fake source, causal, prescriptive, optimality, numbered citation — accepts a grounded sentence", async () => {
  const { ctx, review } = await ctxFor(KNOW.curated);
  const bad: Array<[string, string]> = [
    ["Bạn đã giảm 6 kg trong giai đoạn này.", "number_not_in_evidence"],
    ["WHO khuyến nghị mức protein này cho mọi người.", "source_not_retrieved"],
    ["Theo ACSM thì mức protein của bạn là đủ.", "source_not_retrieved"],
    ["Protein thấp khiến bench của bạn chậm tiến bộ.", "causal_claim"],
    ["Bạn giảm cân vì ăn đủ calo.", "causal_claim"],
    ["Bạn nên tăng protein lên 180 g mỗi ngày.", "prescriptive_claim"],
    ["Hãy giảm thêm 300 kcal mỗi ngày.", "prescriptive_claim"],
    ["Volume hiện tại của bạn là tối ưu.", "optimality_claim"],
    ["Protein hỗ trợ cơ bắp [1].", "numbered_citation"],
    ["Khối lượng cơ xương của bạn đã tăng.", "muscle_mass_claim"],
  ];
  for (const [t, reason] of bad) {
    const v = validateInterpretationNarration(t, ctx, review);
    assert.equal(v.ok, false, t);
    assert.equal(v.reason, reason, t);
  }
  assert.equal(validateInterpretationNarration("Theo ISSN, khoảng 1.4-2.0 g/kg mỗi ngày là mức được nêu; mức ghi nhận của bạn thấp hơn mục tiêu 10 g trong các ngày có dữ liệu.", ctx, review).ok, true);
});

test("hallucinated narration at the answer level: rejected ⇒ deterministic answer keeps facts + sources; ≤1 model call", async () => {
  for (const bad of ["Bạn đã giảm 6 kg.", "WHO recommends higher protein.", "Protein thấp khiến bạn chậm tiến bộ.", "Tăng protein lên 180 g."]) {
    await withWorld({ narrate: async () => bad }, async (c) => {
      const a = await answerPersonalizedInterpretation(idn(), Q_PROTEIN);
      assert.equal(c.narr, 1);
      assert.equal(a.facts.usedNarration, false, bad);
      assert.equal(a.facts.fallbackUsed, true);
      assert.match(a.text, /140 g\/ngày/);
      assert.match(a.text, /ISSN Position Stand/);
      assert.doesNotMatch(a.text, /6 kg|WHO recommends|khiến|180 g/);
    });
  }
  await withWorld({ narrate: async () => { throw new Error("timeout"); } }, async () => {
    const a = await answerPersonalizedInterpretation(idn(), Q_PROTEIN);
    assert.equal(a.facts.usedNarration, false);
    assert.match(a.text, /ISSN Position Stand/);
  });
});

test("TOKEN BUDGET: combined narration prompt stays bounded across fixtures", async () => {
  const sizes: number[] = [];
  for (const k of [KNOW.curated, KNOW.conflict, KNOW.synthetic]) {
    const { ctx, review } = await ctxFor(k);
    sizes.push(Math.ceil(buildInterpretationPrompt(ctx, review).length / 3));
  }
  sizes.sort((a, b) => a - b);
  console.log("PROMPT_TOKENS_EST", JSON.stringify({ p50: sizes[1], p90: sizes[2], max: sizes[2] }));
  assert.ok(sizes[2] < 1600, `prompt too large: ${sizes[2]}`);
});

// ── D. end-to-end through the real orchestrator ──────────────────────────

async function world() {
  const { fitnessAgent, fitnessAgentDeps } = await import("../services/fitness-agent.service");
  const { readerDeps } = await import("../conversational-intelligence/global/readers");
  const { prisma } = await import("../repositories/conversation.repository");
  return { fitnessAgent, fitnessAgentDeps, readerDeps, prisma };
}

test("tryTurn: pending PT workflow survives an interpretation and resumes once; no business write; OFF flags legacy", skipDb, async () => {
  const { fitnessAgent, fitnessAgentDeps, readerDeps, prisma } = await world();
  const saved = { ctx: fitnessAgentDeps.tools.getUserFitnessContext, upd: fitnessAgentDeps.tools.updateProfileFields, pt: fitnessAgentDeps.tools.findPTCandidates, ex: fitnessAgentDeps.profileExtractor.extract, get: readerDeps.get, ax: axios.get, nr: interpretationDeps.narrate, rr: retriever.retrieveForChat, ci: process.env.CONVERSATIONAL_INTELLIGENCE_V2, uc: process.env.GYMINI_UNIFIED_AI_COACH, rag: process.env.RAG_RETRIEVAL_V2 };
  process.env.CONVERSATIONAL_INTELLIGENCE_V2 = "on"; process.env.GYMINI_UNIFIED_AI_COACH = "on"; process.env.RAG_RETRIEVAL_V2 = "on";
  const writes: unknown[] = []; const searches: unknown[] = [];
  fitnessAgentDeps.tools.getUserFitnessContext = async () => ({ profile: { goal: "WEIGHT_LOSS", age: 22, gender: "MALE", heightCm: 173, currentWeight: 80, days: [1, 3, 5], sessionMinutes: 60, budgetVnd: null, injuries: [], equipment: [], experience: "BEGINNER" }, coach: {} } as any);
  fitnessAgentDeps.tools.updateProfileFields = async (_i: any, f: any) => { writes.push(f); return {}; };
  fitnessAgentDeps.tools.findPTCandidates = async (_i: any, p: any) => { searches.push(p); return { candidates: [], truncated: false, historyAuditId: "h", preferences: p } as any; };
  fitnessAgentDeps.profileExtractor.extract = (async () => ({ profile: { goal: "WEIGHT_LOSS" } })) as any;
  readerDeps.get = async () => ({ status: 404, data: {} });
  interpretationDeps.narrate = async () => null;
  let retrievals = 0; let coach = 0;
  (retriever as any).retrieveForChat = async () => { retrievals++; return KNOW.curated(); };
  (axios as any).get = async (url: string) => {
    coach++;
    if (url.includes("/stats/training-window")) return { data: trainingUp() };
    if (url.includes("/stats/body-goal-state")) return { data: bodyGoalUp() };
    if (url.includes("/nutrition/analytics/window")) return { data: nutritionUp() };
    throw new Error(`unexpected ${url}`);
  };
  const userId = `t47-${randomUUID()}`;
  const s = await prisma.chatSession.create({ data: { userId, title: "t47" } });
  const ident = { userId, authorizationHeader: "Bearer x" } as any;
  try {
    await fitnessAgent.tryTurn("Tìm PT cho tôi.", ident, s.id);
    const before = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    assert.equal(before?.expectedSlot, "budgetVnd");
    const r = await fitnessAgent.tryTurn("Với tiến độ tập của tôi thì consistency hiện tại có ý nghĩa gì?", ident, s.id);
    assert.match(r!.answer, /8\/9 buổi/);
    assert.match(r!.answer, /ISSN/);
    assert.match(r!.answer, /Bạn vẫn đang tìm PT dở/);
    assert.equal(retrievals, 1);
    const after = await prisma.agentWorkflowSession.findFirst({ where: { userId } });
    assert.equal(after?.id, before?.id);
    assert.equal(after?.expectedSlot, "budgetVnd");
    assert.equal(writes.length, 0);
    assert.equal(searches.length, 0);
    await fitnessAgent.tryTurn("2 triệu.", ident, s.id);
    assert.equal(searches.length, 1, "workflow resumed exactly once");

    // RAG flag OFF ⇒ interpretation not claimed: no retrieval from this feature, legacy path
    process.env.RAG_RETRIEVAL_V2 = "off";
    const rBefore = retrievals;
    const off = await fitnessAgent.tryTurn("Protein logged của tôi thấp hơn target 10g, điều đó có ý nghĩa gì?", ident, s.id);
    assert.equal(retrievals, rBefore, "no V2 interpretation retrieval when RAG_RETRIEVAL_V2 is off");
    assert.ok(off === null || !/ISSN Position Stand/.test(off.answer));
    void coach;
  } finally {
    await prisma.fitnessAgentAction.deleteMany({ where: { userId } });
    await prisma.agentWorkflowSession.deleteMany({ where: { userId } });
    await prisma.chatSession.delete({ where: { id: s.id } });
    Object.assign(fitnessAgentDeps.tools, { getUserFitnessContext: saved.ctx, updateProfileFields: saved.upd, findPTCandidates: saved.pt });
    fitnessAgentDeps.profileExtractor.extract = saved.ex; readerDeps.get = saved.get; axios.get = saved.ax; interpretationDeps.narrate = saved.nr; (retriever as any).retrieveForChat = saved.rr;
    for (const [k, v] of [["CONVERSATIONAL_INTELLIGENCE_V2", saved.ci], ["GYMINI_UNIFIED_AI_COACH", saved.uc], ["RAG_RETRIEVAL_V2", saved.rag]] as const) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test.after(async () => {
  if (canUseDb) { const { prisma } = await import("../repositories/conversation.repository"); await prisma.$disconnect(); }
});
