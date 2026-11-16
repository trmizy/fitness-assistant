/**
 * M9.4-T2 Task B — bridge capability PREFLIGHT (N04 meal-log history, T06 workout history over a period). TEST FIXTURE: labelled synthetic questions.
 * Reports false positives (a V2-supported question wrongly kept on V1) and false negatives (a missing-capability question still sent to V2).
 * Run: FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/coach-capability-preflight.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isMealLogQuestion, isWorkoutHistoryPeriodQuestion } from "../services/coach-capability-preflight";
import { classifyCoachCapability } from "../services/coach-bridge.middleware";
import { decideCoachRoute, runCoachBridge, type CoachRequestFacts } from "../services/coach-v2-bridge";
import { runCoachTurn, type CoachTurnInput } from "../services/coach-v2-continuity";
import { fakeStore, fakeHistory } from "./coach-continuity-fakes";
import { CASES } from "./m9-quality-eval/cases";

const MEAL_POS = [
  "Hôm qua tôi đã ăn những gì?", "Hôm qua tôi ăn gì?", "Nhật ký ăn uống của tôi hôm nay thế nào?", "Lịch sử bữa ăn của tôi tuần này", "Tuần này tôi ăn bao nhiêu calo rồi?",
  "Tôi vừa ăn gì hôm qua?", "Hôm qua ăn gì?", "Tôi đã nạp bao nhiêu protein hôm nay?", "Tuần trước tôi ăn những gì?", "Hom qua toi da an nhung gi?",
  "Hôm qua tôi đã ăn gì, hôm nay nên tập gì?", // multi-domain containing a meal-log clause
];
const WORKOUT_POS = [
  "Tuần này tôi tập mấy buổi rồi?", "Tháng này tôi đã tập bao nhiêu buổi?", "Tuần trước tôi tập những gì?", "Lịch sử tập luyện của tôi", "Nhật ký tập của tôi tuần này",
  "Hôm qua tôi tập gì?", "7 ngày qua tôi tập bao nhiêu buổi?", "Tuan nay toi tap may buoi roi?",
  "Tuần này tôi tập mấy buổi và nên ăn gì?", // multi-domain containing a history clause
];
const NEGATIVE = [ // V2-supported or plainly different: must NOT be kept off V2 by the preflight
  "Tôi nên ăn gì trước buổi tập?", "Hôm nay tôi nên ăn gì?", "Mục tiêu calo của tôi là bao nhiêu?", "Protein có vai trò gì trong việc xây cơ?",
  "Tôi tập chân hôm qua, nghỉ ngơi thế nào cho hợp lý?", "Tôi tập chân hôm qua, hôm nay nên tập gì?", "Hôm nay tôi tập gì?", "Tập bao nhiêu buổi một tuần là đủ?",
  "Người mới nên tập mấy buổi mỗi tuần?", "Ăn bao nhiêu calo để giảm cân?", "Mỗi ngày tôi cần ăn bao nhiêu protein?", "Tuần này nên tập gì?",
  "Hôm qua tôi tập chân, nay đau cơ, nên nghỉ mấy ngày?", "Cân nặng của tôi thay đổi thế nào so với mục tiêu?", "Chương trình tập hiện tại của tôi là gì?",
  "Dạo này tôi mệt, tải tập của tôi thế nào?", "Tôi muốn ăn ít tinh bột thì ăn gì?", "Squat sâu quá có hại khớp gối không?", "Tôi nên ăn gì?", "Gợi ý bài tập cho ngực khi tập ở nhà?",
  "Sức mạnh deadlift của tôi có tăng không?", "Hôm nay tôi tập buổi nào, và trước đó nên ăn gì?", "Tôi tập chân hôm qua và hơi mệt, hôm nay nên tập gì và ăn gì?",
];

test("PF-1 meal-log and workout-history questions (incl. near-synonyms, unaccented, multi-domain) are recognised: false negatives = 0", () => {
  const missedMeal = MEAL_POS.filter((q) => !isMealLogQuestion(q));
  const missedWork = WORKOUT_POS.filter((q) => !isWorkoutHistoryPeriodQuestion(q));
  assert.deepEqual(missedMeal, [], "meal-log false negatives");
  assert.deepEqual(missedWork, [], "workout-history false negatives");
});

test("PF-2 advice / planning / general / V2-supported questions are NOT recognised: false positives = 0 over the labelled negatives AND every V2-routed eval case", () => {
  const fpLabelled = NEGATIVE.filter((q) => isMealLogQuestion(q) || isWorkoutHistoryPeriodQuestion(q));
  assert.deepEqual(fpLabelled, [], "labelled negatives");
  const evalV2 = CASES.filter((c) => c.expect.route === "V2" && !["N04", "T06"].includes(c.id)).map((c) => c.question);
  const fpEval = evalV2.filter((q) => isMealLogQuestion(q) || isWorkoutHistoryPeriodQuestion(q));
  assert.deepEqual(fpEval, [], `eval cases still on V2 (${evalV2.length} questions)`);
  console.log(`PREFLIGHT_RATES positives meal=${MEAL_POS.length} workout=${WORKOUT_POS.length} FN=0 | negatives labelled=${NEGATIVE.length} + eval V2=${evalV2.length} FP=0`);
});

test("PF-3 one rule, one cue is never enough: single words and bare periods do not match", () => {
  for (const q of ["ăn", "tập", "hôm qua", "tuần này", "Hôm qua trời mưa", "Tôi ăn chay", "Tuần này tôi bận", "Tôi tập yoga", "Tôi thích ăn cơm", "Bữa ăn nhẹ gồm những gì?", "Nhật ký là gì?"]) {
    assert.equal(isMealLogQuestion(q) || isWorkoutHistoryPeriodQuestion(q), false, q);
  }
});

test("PF-4 the classifier maps them to the unsupported capabilities, everything else keeps its previous capability (V1-only commands first, then V2-eligible Q&A)", () => {
  assert.equal(classifyCoachCapability("Hôm qua tôi đã ăn những gì?"), "MEAL_HISTORY");
  assert.equal(classifyCoachCapability("Tuần này tôi tập mấy buổi rồi?"), "WORKOUT_HISTORY_PERIOD");
  assert.equal(classifyCoachCapability("Hôm nay tôi tập gì?"), "CHAT_READONLY_QA");
  assert.equal(classifyCoachCapability("Tôi nên ăn gì trước buổi tập?"), "CHAT_READONLY_QA");
  assert.equal(classifyCoachCapability("Tạo lịch tập 5 buổi cho tôi"), "AGENT_WRITE_WORKFLOW");
  assert.equal(classifyCoachCapability("Xác nhận"), "AGENT_WRITE_WORKFLOW");
  assert.equal(classifyCoachCapability("Hôm qua tôi đã ăn gì? Tạo lịch tập 5 buổi cho tôi"), "AGENT_WRITE_WORKFLOW", "a write intent still wins");
});

const facts = (o: Partial<CoachRequestFacts> = {}): CoachRequestFacts => ({
  capability: "CHAT_READONLY_QA", transport: "json", userId: "u1", callerKind: "gateway_user", hasUserBearer: true, question: "q", clientRequestId: "pf-00000001", sessionAffinity: "none", ...o,
});
const deps = { enabled: () => true, userAllowed: () => true };

test("PF-5 the bridge decision: the preflight reason applies only AFTER the earlier gates (flag, end-user, allowlist), V2-supported capability still goes to V2", () => {
  for (const capability of ["MEAL_HISTORY", "WORKOUT_HISTORY_PERIOD"] as const) {
    assert.deepEqual(decideCoachRoute(facts({ capability }), deps), { route: "v1", reason: "V2_CAPABILITY_UNSUPPORTED" });
    assert.equal(decideCoachRoute(facts({ capability }), { enabled: () => false }).reason, "BRIDGE_OFF");
    assert.equal(decideCoachRoute(facts({ capability, callerKind: "service" }), deps).reason, "NOT_VERIFIED_END_USER");
    assert.equal(decideCoachRoute(facts({ capability }), { enabled: () => true, userAllowed: () => false }).reason, "USER_NOT_ALLOWLISTED");
  }
  assert.deepEqual(decideCoachRoute(facts(), deps), { route: "v2", reason: "ELIGIBLE_READ_ONLY" });
});

test("PF-6 no V2 work before the decision: the executor is never called, nothing is claimed or written, no V1 fallback after V2 (it never started); idempotency / session affinity unchanged", async () => {
  let asked = 0;
  const executor = { ask: async () => { asked++; return { status: "ANSWERED", answer: "x" }; } };
  const s = fakeStore(), h = fakeHistory();
  const input = (o: Partial<CoachTurnInput> = {}): CoachTurnInput => ({ capability: "MEAL_HISTORY", transport: "json", userId: "u1", callerKind: "gateway_user", hasUserBearer: true, question: "Hôm qua tôi đã ăn gì?", clientRequestId: "pf-00000002", ...o });
  const trace: unknown[] = [];
  for (const capability of ["MEAL_HISTORY", "WORKOUT_HISTORY_PERIOD"] as const) {
    const r = await runCoachTurn(input({ capability }), { ...deps, executor, idempotency: s.store, history: h.history, trace: (e) => trace.push(e) });
    assert.deepEqual(r, { handler: "v1", reason: "V2_CAPABILITY_UNSUPPORTED", v2Attempted: false });
    const b = await runCoachBridge(facts({ capability }), { ...deps, executor });
    assert.deepEqual(b, { handler: "v1", reason: "V2_CAPABILITY_UNSUPPORTED", v2Attempted: false });
  }
  assert.equal(asked, 0); assert.equal(s.recs.size, 0); assert.equal(h.sessions.size + h.turns.length, 0);
  // an existing V1 conversation / missing key still produce THEIR OWN reasons on a V2-eligible capability (unchanged behaviour)
  assert.equal((await runCoachTurn({ ...input({ capability: "CHAT_READONLY_QA" }), clientRequestId: undefined }, { ...deps, executor, idempotency: s.store, history: h.history })).handler, "v1");
});
