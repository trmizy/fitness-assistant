/**
 * M9.4-T3 — grounding CONTRACT for the user's own body weight (llm/personal_weight_guard.ts). TEST FIXTURE: synthetic data, no model, no DB.
 * Task A: the seven source classes of the brief, one row each (what is kept / removed and WHY).
 * Task C (unit level): the guard must not damage the meaning of what it keeps. Engine-level (V1 real chain / V2 bounded agent): weight-grounding-engines.test.ts.
 * Run: FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/personal-weight-contract.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  groundPersonalWeightClaims, NO_VERIFIED_WEIGHT_NOTICE, STALE_OR_HISTORY_NOTICE, GENERIC_SAFETY_REFERRAL, type SourcedWeight,
} from "../llm/personal_weight_guard";

const LATEST = (kg: number, ageDays: number | null = 3): SourcedWeight => ({ kg, role: "LATEST_MEASURED", ageDays });
const PREV = (kg: number): SourcedWeight => ({ kg, role: "PREVIOUS_MEASURED" });
const PROFILE = (kg: number): SourcedWeight => ({ kg, role: "PROFILE_REPORTED" });
const run = (answer: string, sourced: SourcedWeight[] = [], question = "Cân nặng của tôi thế nào?", session: string[] = []) =>
  groundPersonalWeightClaims(answer, { sourced, question, sessionUserMessages: session });
const CLAIM = (kg: string) => `Cân nặng của bạn hiện là ${kg} kg.`;

test("WC-1 the seven source classes: retrieved record / user-stated / historical / another user's / hypothetical / model-invented / conflicting", () => {
  // 1. retrieved + authenticated (profile / InBody of THIS user)
  assert.equal(run(CLAIM("72.4"), [LATEST(72.4)]).removed.length, 0, "1a InBody latest");
  assert.equal(run(CLAIM("70"), [PROFILE(70)]).removed.length, 0, "1b profile-reported (no measurement exists)");
  // 2. user-reported: accepted as 'not invented by the model' — NOT verified, wording untouched
  assert.equal(run(CLAIM("99"), [], "Tôi nặng 99 kg, nên tập gì?").removed.length, 0, "2a stated with a kg unit");
  assert.equal(run(CLAIM("99"), [], "Mình cân nặng 99 nên tập gì?").removed.length, 0, "2b stated after 'cân nặng'");
  assert.equal(run(CLAIM("99"), [], "Tôi nên tập gì?", ["Hôm qua mình nặng 99kg"]).removed.length, 0, "2c earlier message of this session");
  // 3. historical: kept as past, never as current; an old latest measurement is NOT worthless when dated / framed as past
  const e3 = [LATEST(72.4, 20), PREV(73.6)];
  assert.equal(run("Ở lần đo trước đó, cân nặng của bạn là 73.6 kg.", e3).removed.length, 0, "3a previous as past");
  assert.deepEqual(run(CLAIM("73.6"), e3).reasons, ["history_as_current"], "3b previous as current");
  const old = [LATEST(72.4, 210)];
  assert.equal(run("Theo lần đo ngày 17/04, cân nặng của bạn là 72.4 kg.", old).removed.length, 0, "3c >90 days but dated: kept");
  assert.equal(run("Số đo cân nặng gần nhất của bạn đã cũ (hơn 6 tháng) là 72.4 kg.", old).removed.length, 0, "3d >90 days labelled old: kept");
  assert.deepEqual(run(CLAIM("72.4"), old).reasons, ["stale_as_current"], "3e >90 days undated 'current': removed");
  // 4. another user's figure never counts (evidence is per call; only the authenticated user's own data is passed in)
  assert.equal(run(CLAIM("88.8"), [LATEST(72.4)]).removed.length, 1, "4 B's figure stated to A");
  // 5. hypothetical / educational / target / forecast: never a claim
  for (const t of ["Ví dụ nếu bạn nặng 99 kg thì cần 140 g protein.", "Người nặng 70 kg thường cần 1,6 g protein mỗi kg.", "Cân nặng mục tiêu của bạn là 68 kg.", "Dự báo cân nặng của bạn sau 8 tuần là 70.4 kg."])
    assert.equal(run(t).answer, t, t);
  // 6. model-invented: removed, no default value, notice carries no number
  const r6 = run(CLAIM("99"));
  assert.equal(r6.answer, NO_VERIFIED_WEIGHT_NOTICE); assert.doesNotMatch(r6.answer, /\d/);
  // 7. conflicting sources: the guard does not arbitrate (either RECORDED figure is accepted as current); a third figure goes
  const e7 = [LATEST(72.4), PROFILE(70)];
  assert.equal(run(CLAIM("72.4"), e7).removed.length + run(CLAIM("70"), e7).removed.length, 0);
  assert.equal(run(CLAIM("75"), e7).removed.length, 1);
});

test("WC-2 user-reported is not 'any number': an age, a calorie target or a rep count in the session is NOT a stated weight (M9.4-T2 accepted them)", () => {
  assert.equal(run(CLAIM("25"), [], "Tôi 25 tuổi, cân nặng của tôi thế nào?").removed.length, 1, "age 25");
  assert.equal(run(CLAIM("140"), [], "Tôi ăn 140 g protein mỗi ngày, cân nặng của tôi thế nào?").removed.length, 1, "140 g protein");
  assert.equal(run(CLAIM("5"), [], "Tôi tập 5 buổi một tuần", ["Tôi muốn ăn 2400 kcal"]).removed.length, 1, "5 sessions");
  assert.equal(run(CLAIM("72"), [], "Tôi nặng 72 ký rồi").removed.length, 0, "'ký' is a weight unit");
});

test("WC-3 stale / previous removal uses a truthful notice (the figure IS on record), unsourced removal keeps the 'no record' notice, mixed → 'no record'", () => {
  const r = run(CLAIM("72.4"), [LATEST(72.4, 210)]);
  assert.equal(r.answer, STALE_OR_HISTORY_NOTICE); assert.doesNotMatch(r.answer, /\d/);
  assert.equal(run(CLAIM("73.6"), [LATEST(72.4), PREV(73.6)]).answer, STALE_OR_HISTORY_NOTICE);
  assert.equal(run(CLAIM("99"), [LATEST(72.4, 210)]).answer, NO_VERIFIED_WEIGHT_NOTICE);
  assert.equal(run(`${CLAIM("99")} ${CLAIM("72.4")}`, [LATEST(72.4, 210)]).answer, NO_VERIFIED_WEIGHT_NOTICE, "one unsourced figure → the 'no record' notice");
});

test("WC-4 a SAFETY warning in the same sentence is not lost with the figure", () => {
  const r1 = run("Cân nặng của bạn hiện là 99 kg, bạn nên đi khám bác sĩ để kiểm tra sức khoẻ.");
  assert.doesNotMatch(r1.answer, /99/); assert.match(r1.answer, /^Bạn nên đi khám bác sĩ để kiểm tra sức khoẻ\./, "the warning clause is kept standalone");
  const r1b = run("Cân nặng của bạn hiện là 99 kg nên bạn cần đi khám bác sĩ.");
  assert.doesNotMatch(r1b.answer, /99/); assert.match(r1b.answer, /bác sĩ/, "a warning in the same clause is kept via the fixed referral (never lost)");
  const r2 = run("Cân nặng của bạn hiện là 99 kg, thấp hơn mục tiêu. Nếu bạn thấy đau ngực khi tập, hãy dừng lại và đi khám.");
  assert.match(r2.answer, /Nếu bạn thấy đau ngực khi tập, hãy dừng lại và đi khám\./, "a separate warning sentence is untouched");
  // a sentence whose safety cue cannot stand alone → the fixed referral is added (never a number)
  const r3 = run("Cân nặng của bạn hiện là 99 kg nên rất nguy hiểm.");
  assert.doesNotMatch(r3.answer, /99/); assert.match(r3.answer, new RegExp(GENERIC_SAFETY_REFERRAL.slice(0, 30)));
  assert.doesNotMatch(run(CLAIM("99")).answer, /bác sĩ/, "no cue → no referral added");
});

test("WC-5 a negated or corrective claim is removed, never turned into an affirmative; a negated TRUE statement that is not a claim is untouched", () => {
  const r = run("Cân nặng của bạn không phải 99 kg.");
  assert.doesNotMatch(r.answer, /99/); assert.doesNotMatch(r.answer, /Cân nặng của bạn (hiện )?là/);
  assert.equal(r.answer, NO_VERIFIED_WEIGHT_NOTICE);
  const t = "Bạn không nặng 99 kg theo hồ sơ.";
  assert.equal(run(t, [LATEST(72.4)]).answer, t, "not a pattern the guard reads (documented limit): left as is, never rewritten");
});

test("WC-6 a consequence sentence hanging on a removed premise goes with it; an independent sentence stays; no lowercase / connective fragment is left", () => {
  const r = run("Cân nặng của bạn hiện là 99 kg. Vì vậy bạn nên giảm 31 kg để đạt mục tiêu. Hãy ngủ đủ 7-8 giờ mỗi đêm.");
  assert.doesNotMatch(r.answer, /99|31/); assert.match(r.answer, /Hãy ngủ đủ 7-8 giờ mỗi đêm\./);
  assert.deepEqual(r.reasons, ["unsourced", "dependent_on_removed"]);
  for (const line of r.answer.split("\n").filter((l) => l.trim())) assert.match(line, /^[\p{Lu}*_\-\d]/u, `fragment: ${line}`);
  // a dependent sentence is NOT removed when nothing was removed before it
  const keep = "Bạn tập đều. Vì vậy bạn nên tiếp tục.";
  assert.equal(run(keep).answer, keep);
});

test("WC-7 idempotent and stable: running the guard on its own output changes nothing; unflagged text is returned byte-identical", () => {
  for (const t of [CLAIM("99"), "Cân nặng của bạn hiện là 99 kg, bạn nên đi khám bác sĩ.", `${CLAIM("72.4")} Bạn nên ăn đủ đạm.`, "**Tóm tắt**\n- Cân nặng của bạn hiện là 99 kg.\n- Hãy ngủ đủ giấc."]) {
    const once = run(t, [LATEST(72.4, 210)]); const twice = run(once.answer, [LATEST(72.4, 210)]);
    assert.equal(twice.answer, once.answer, t); assert.deepEqual(twice.removed, [], t);
  }
  const untouched = "**Gợi ý**\n- Ăn đủ đạm.\n- Ngủ 7-8 giờ.\nNgười nặng 70 kg cần khoảng 140 g protein.";
  assert.equal(run(untouched).answer, untouched);
});
