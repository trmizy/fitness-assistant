/**
 * M9.4-T3 Tasks B + C at engine level — the SAME scripted model text and the SAME synthetic world, through V1's real chain (controller → rag → orchestrator)
 * and V2's real bridge → Supervisor → Router → bounded agent. BACKEND INTEGRATION with fake model / fake services / in-memory store (no live model, no DB,
 * no network, no real user data). Evidence label: this is NOT an answer-quality evaluation (every model is a script).
 * Run: FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/weight-grounding-engines.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRunner } from "./m9-quality-eval/runner";
import { weightClaimIn, NO_VERIFIED_WEIGHT_NOTICE, STALE_OR_HISTORY_NOTICE } from "../llm/personal_weight_guard";

let runner: Awaited<ReturnType<typeof createRunner>>;
test.before(async () => { runner = await createRunner(); });
test.after(() => runner?.close());

const Q = "Cân nặng của tôi thay đổi thế nào so với mục tiêu?";
type World = "absent" | "stale" | "full";
const caseOf = (text: string, body: World, question = Q): any => ({
  id: "T3", group: "safety", capability: "SAFETY_ACCESS", question, world: { body }, noProfileWeight: body === "stale", expect: {},
  v1Llm: text, v2Script: { progress: { tools: ["progress.get_body_measurements"], say: text } },
});
async function both(text: string, body: World) {
  const c = caseOf(text, body);
  const v2 = await runner.runV2(c); const v1 = await runner.runV1(c);
  assert.equal(v2.handledBy, "V2", "served by V2"); assert.equal(v2.http, 200); assert.equal(v1.http, 200);
  return { v1: v1.answer, v2: v2.answer };
}
const each = (r: { v1: string; v2: string }, f: (a: string, engine: string) => void) => { f(r.v1, "V1"); f(r.v2, "V2"); };

test("EG-1 safety warning sharing the sentence with an invented weight survives on V1 and V2; a separate warning sentence is untouched", async () => {
  each(await both("Cân nặng của bạn hiện là 99 kg, bạn nên đi khám bác sĩ để kiểm tra sức khoẻ.", "absent"), (a, e) => {
    assert.doesNotMatch(a, /99/, `${e}: figure removed`); assert.match(a, /Bạn nên đi khám bác sĩ để kiểm tra sức khoẻ\./, `${e}: warning kept`);
  });
  each(await both("Cân nặng của bạn hiện là 99 kg. Nếu bạn thấy đau ngực khi tập, hãy dừng lại và đi khám.", "absent"), (a, e) => {
    assert.doesNotMatch(a, /99/, e); assert.match(a, /Nếu bạn thấy đau ngực khi tập, hãy dừng lại và đi khám\./, `${e}: warning sentence kept verbatim`);
  });
});

test("EG-2 negation is never turned into an affirmative; a consequence sentence of a removed premise goes with it; no fragment is left", async () => {
  each(await both("Cân nặng của bạn không phải 99 kg.", "absent"), (a, e) => { assert.doesNotMatch(a, /99/, e); assert.doesNotMatch(a, /Cân nặng của bạn (hiện )?là/, e); });
  each(await both("Cân nặng của bạn hiện là 99 kg. Vì vậy bạn nên giảm 31 kg để đạt mục tiêu. Hãy ngủ đủ 7-8 giờ mỗi đêm.", "absent"), (a, e) => {
    assert.doesNotMatch(a, /99|31 kg/, e); assert.match(a, /Hãy ngủ đủ 7-8 giờ mỗi đêm\./, `${e}: independent advice kept`);
    assert.doesNotMatch(a, /(^|\n)(vì vậy|do đó)/i, `${e}: no dangling connective`);
  });
});

test("EG-3 educational examples and HISTORICAL InBody figures are not damaged (V1 and V2, same data)", async () => {
  each(await both("Ví dụ nếu bạn nặng 99 kg thì mức protein khoảng 140 g mỗi ngày. Người nặng 70 kg thường cần 1,6 g protein mỗi kg.", "absent"), (a, e) => {
    assert.match(a, /nếu bạn nặng 99 kg/, e); assert.match(a, /Người nặng 70 kg/, e); assert.doesNotMatch(a, new RegExp(NO_VERIFIED_WEIGHT_NOTICE.slice(0, 25)), `${e}: nothing removed`);
  });
  each(await both("Ở lần đo trước đó, cân nặng của bạn là 73.6 kg, hiện là 72.4 kg, thấp hơn mục tiêu.", "full"), (a, e) => {
    assert.match(a, /73\.6 kg/, `${e}: historical InBody kept`); assert.match(a, /72\.4 kg/, e); assert.doesNotMatch(a, new RegExp(NO_VERIFIED_WEIGHT_NOTICE.slice(0, 25)), e);
  });
});

test("EG-4 stale record: an undated 'current' claim is removed with a TRUTHFUL notice (the record exists); the dated figure is kept — on both engines", async () => {
  each(await both("Cân nặng của bạn hiện là 72.4 kg.", "stale"), (a, e) => {
    assert.doesNotMatch(a, /72\.4/, e); assert.ok(a.includes(STALE_OR_HISTORY_NOTICE), `${e}: stale notice, not 'no weight on record'`); assert.ok(!a.includes(NO_VERIFIED_WEIGHT_NOTICE), e);
  });
  each(await both("Theo lần đo ngày 17/04, cân nặng của bạn là 72.4 kg, đã khá cũ.", "stale"), (a, e) => assert.match(a, /72\.4 kg/, `${e}: dated old measurement kept`));
});

test("EG-5 a figure the user did NOT state as a weight does not launder an invented one (age 25 in the question)", async () => {
  const c = caseOf("Cân nặng của bạn hiện là 25 kg.", "absent", "Tôi 25 tuổi, cân nặng của tôi thay đổi thế nào so với mục tiêu?");
  const v1 = await runner.runV1(c); const v2 = await runner.runV2(c);
  assert.doesNotMatch(v1.answer, /25 kg/); if (v2.handledBy === "V2") assert.doesNotMatch(v2.answer, /25 kg/);
});

// ── Task B: V1 paths that do not go through the model ──────────────────────────────────────────────────────────────────────
const DETERMINISTIC_Q = ["Con số calo của tôi được tính như thế nào?", "Tôi muốn giảm 3 kg trong 2 tháng, cần ăn bao nhiêu calo?", "Hôm nay tôi tập gì?", "Bữa trưa hôm nay tôi ăn gì?"];
test("EG-6 V1 DETERMINISTIC paths: no model call → every sentence contains NO personal-weight claim (so a boundary guard would be a no-op), the only weight is the user's own record, and with no record V1 does not invent one", async () => {
  const seen: string[] = [];
  for (const body of ["full", "stale", "absent"] as const) {
    for (const q of DETERMINISTIC_Q) {
      const r = await runner.runV1({ ...caseOf("không dùng", body, q) });
      assert.equal(r.http, 200);
      const sentences = r.answer.split(/\n|(?<=[.!?])\s+/);
      for (const s of sentences) assert.equal(weightClaimIn(s), null, `[${body}] "${q}": deterministic sentence reads as a personal weight claim: ${s}`);
      if (r.llmCalls === 0) {
        seen.push(`${body}|${q}`);
        const figs = [...r.answer.matchAll(/(?<![\d.,])(\d{2,3}(?:\.\d+)?)\s*kg\b(?!\s*\/)/g)].map((m) => m[1]);
        for (const f of figs) assert.ok(f === "72.4" && body !== "absent", `[${body}] "${q}": deterministic answer states ${f} kg that is not the user's own record`);
      }
    }
  }
  assert.ok(seen.includes("full|Con số calo của tôi được tính như thế nào?"), "the calculation explanation really is deterministic (llm=0) with a record");
  assert.ok(!seen.includes("absent|Con số calo của tôi được tính như thế nào?"), "with NO weight on record the explanation is not produced deterministically — it falls to the model, where the guard runs");
  const calc = await runner.runV1(caseOf("không dùng", "full", DETERMINISTIC_Q[0]));
  assert.match(calc.answer, /Mifflin-St Jeor từ 72\.4 kg/, "the correct deterministic answer is intact");
  assert.doesNotMatch(calc.answer, new RegExp(NO_VERIFIED_WEIGHT_NOTICE.slice(0, 25)));
});

test("EG-7 no double distortion: V1 deterministic answers are byte-identical on a second identical run (the guard is not applied to them, and the guarded path is idempotent)", async () => {
  const a = await runner.runV1(caseOf("không dùng", "full", DETERMINISTIC_Q[0])); const b = await runner.runV1(caseOf("không dùng", "full", DETERMINISTIC_Q[0]));
  assert.equal(a.answer, b.answer);
  const g1 = await runner.runV1(caseOf("Cân nặng của bạn hiện là 99 kg.", "absent")); const g2 = await runner.runV1(caseOf("Cân nặng của bạn hiện là 99 kg.", "absent"));
  assert.equal(g1.answer, g2.answer); assert.equal(g1.answer.split(NO_VERIFIED_WEIGHT_NOTICE).length - 1, 1, "exactly one notice");
});
