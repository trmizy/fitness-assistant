/**
 * M9.4-T2 Task A — personal body-weight grounding guard (llm/personal_weight_guard.ts). Pure unit tests (TEST FIXTURE: synthetic data, no model).
 * The engine-level behaviour (V1 real chain and V2 bounded agent) is covered by the S06 / S09–S14 cases of m9-quality-eval.
 * Run: FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/personal-weight-guard.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  groundPersonalWeightClaims, weightClaimIn, weightEvidenceFromV1Context, weightEvidenceFromV2ToolData, NO_VERIFIED_WEIGHT_NOTICE, STALE_AFTER_DAYS,
  type SourcedWeight,
} from "../llm/personal_weight_guard";

const ev = (sourced: SourcedWeight[], question = "Cân nặng của tôi thay đổi thế nào?", sessionUserMessages: string[] = []) => ({ sourced, question, sessionUserMessages });
const LATEST = (kg: number, ageDays: number | null = 3): SourcedWeight => ({ kg, role: "LATEST_MEASURED", ageDays });
const PREV = (kg: number): SourcedWeight => ({ kg, role: "PREVIOUS_MEASURED" });
const PROFILE = (kg: number): SourcedWeight => ({ kg, role: "PROFILE_REPORTED" });
const run = (answer: string, e = ev([])) => groundPersonalWeightClaims(answer, e);

test("WG-1 missing weight (the S06 reproducer): an invented personal weight is removed, nothing replaces it, the notice carries no number", () => {
  const r = run("Cân nặng của bạn hiện là 99 kg, thấp hơn mục tiêu.");
  assert.equal(r.answer, NO_VERIFIED_WEIGHT_NOTICE);
  assert.deepEqual(r.reasons, ["unsourced"]);
  assert.doesNotMatch(r.answer, /\d/, "no default value is ever substituted");
  // accented / unaccented / spacing variants of the same claim
  for (const t of ["Can nang cua ban hien la 99kg.", "Bạn đang nặng 99 kg.", "Bạn hiện nặng khoảng 99 ký.", "Your weight is 99 kg.", "Số đo cân nặng gần nhất là 99 kg.", "Cân nặng 99 kg của bạn là ổn định."])
    assert.equal(run(t).answer, NO_VERIFIED_WEIGHT_NOTICE, t);
});

test("WG-2 valid sourced weight is kept byte-identical (latest measured, profile-reported, rounding)", () => {
  for (const [sourced, text] of [
    [[LATEST(72.4)], "Cân nặng của bạn hiện là 72.4 kg, thấp hơn lần đo trước."],
    [[LATEST(72.4)], "Cân nặng của bạn hiện là 72,4 kg."],
    [[LATEST(72.4)], "Bạn đang nặng 72 kg."], // whole-number rounding of 72.4
    [[PROFILE(70)], "Theo hồ sơ, cân nặng của bạn hiện là 70 kg."],
  ] as Array<[SourcedWeight[], string]>) { const r = run(text, ev(sourced)); assert.equal(r.answer, text, text); assert.deepEqual(r.removed, []); }
  assert.equal(run("Bạn đang nặng 75 kg.", ev([LATEST(72.4)])).answer, NO_VERIFIED_WEIGHT_NOTICE, "3 kg off is not rounding");
});

test("WG-3 stale weight: an undated 'current' claim from a measurement older than the threshold is removed; a dated or labelled-old one is kept", () => {
  const stale = ev([LATEST(72.4, STALE_AFTER_DAYS + 120)]);
  const r = run("Cân nặng của bạn hiện là 72.4 kg.", stale);
  assert.equal(r.answer, NO_VERIFIED_WEIGHT_NOTICE); assert.deepEqual(r.reasons, ["stale_as_current"]);
  assert.equal(run("Theo lần đo ngày 17/04, cân nặng của bạn là 72.4 kg.", stale).removed.length, 0);
  assert.equal(run("Số đo cân nặng gần nhất của bạn đã cũ (hơn 6 tháng) là 72.4 kg.", stale).removed.length, 0);
  assert.equal(run("Cân nặng của bạn hiện là 72.4 kg.", ev([LATEST(72.4, STALE_AFTER_DAYS)])).removed.length, 0, "at the threshold it is still fresh");
  assert.equal(run("Cân nặng của bạn hiện là 72.4 kg.", ev([LATEST(72.4, 400), PROFILE(72.4)])).removed.length, 0, "a profile-reported figure is not 'stale'");
});

test("WG-4 history is not current: a previous measurement stated as the current weight is removed; stated as past it is kept", () => {
  const e = ev([LATEST(72.4), PREV(73.6)]);
  assert.deepEqual(run("Cân nặng của bạn hiện là 73.6 kg.", e).reasons, ["history_as_current"]);
  assert.equal(run("Ở lần đo trước đó, cân nặng của bạn là 73.6 kg.", e).removed.length, 0);
  assert.equal(run("Lúc ban đầu bạn nặng 73.6 kg, giờ là 72.4 kg.", e).removed.length, 0, "both figures are sourced; the second clause is not a separate claim here");
});

test("WG-5 conflicting data: any one of the conflicting RECORDED figures may be stated (the guard does not arbitrate); a third figure is removed", () => {
  const e = ev([LATEST(72.4), PROFILE(70)]);
  assert.equal(run("Cân nặng của bạn hiện là 72.4 kg.", e).removed.length, 0);
  assert.equal(run("Cân nặng của bạn hiện là 70 kg.", e).removed.length, 0);
  assert.equal(run("Cân nặng của bạn hiện là 75 kg.", e).removed.length, 1);
});

test("WG-6 hypothetical examples, generic/educational numbers, targets, ideals, forecasts and questions are NOT claims and are never touched", () => {
  const keep = [
    "Ví dụ nếu bạn nặng 99 kg thì mức protein khoảng 140 g mỗi ngày.",
    "Giả sử bạn nặng 99 kg, bạn sẽ cần khoảng 2400 kcal.",
    "Nếu cân nặng của bạn là 99 kg thì nên chia nhỏ bữa ăn.",
    "Người nặng 70 kg thường cần khoảng 1,6 g protein mỗi kg cân nặng.",
    "1 kg mỡ cơ thể tương đương khoảng 7700 kcal.",
    "Cân nặng mục tiêu của bạn là 68 kg.",
    "Cân nặng lý tưởng thường nằm trong khoảng 60-70 kg.",
    "Dự báo cân nặng của bạn sau 8 tuần là 70.4 kg.",
    "Có phải cân nặng của bạn hiện là 99 kg?",
    "Bạn nên tăng thêm 2 kg cơ trong 3 tháng.",
    "Mỗi tuần bạn nên giảm tối đa 0,5 kg.",
    "Bạn hiện tập 3 buổi mỗi tuần.",
    "Theo số đo, cân nặng của bạn đi từ 74 kg xuống 72.4 kg trong 56 ngày.", // a trajectory is not a statement of the current weight
    "Bạn cần khoảng 140 g protein mỗi ngày.",
  ];
  for (const t of keep) { assert.equal(weightClaimIn(t), null, t); assert.equal(run(t).answer, t, t); }
});

test("WG-7 a figure the USER stated in this conversation is supported (provenance = the user); one from nowhere is not", () => {
  const r = run("Bạn đang nặng 99 kg nên nên ưu tiên đi bộ.", ev([], "Tôi nặng 99 kg, nên tập gì?"));
  assert.equal(r.removed.length, 0);
  assert.equal(run("Bạn đang nặng 99 kg nên nên ưu tiên đi bộ.", ev([], "Tôi nên tập gì?")).removed.length, 1);
  assert.equal(run("Bạn đang nặng 99 kg.", ev([], "Tôi nên tập gì?", ["Mình nặng 99 kg hôm qua"])).removed.length, 0, "earlier message of THIS session");
});

test("WG-8 cross-user isolation: evidence is per call (no shared state); another user's figure is removed from this user's answer", () => {
  const A = ev([LATEST(72.4)]); const B = ev([LATEST(88.8)]);
  assert.equal(run("Cân nặng của bạn hiện là 88.8 kg.", A).removed.length, 1, "B's weight stated to A");
  assert.equal(run("Cân nặng của bạn hiện là 88.8 kg.", B).removed.length, 0, "…is fine for B");
  assert.equal(run("Cân nặng của bạn hiện là 72.4 kg.", B).removed.length, 1, "and A's weight stated to B");
  assert.equal(run("Cân nặng của bạn hiện là 88.8 kg.", A).removed.length, 1, "no residue after serving B");
});

test("WG-9 only the unsupported sentence goes: surrounding advice, bullets and formatting stay; one notice is appended; the original is never returned when something was removed", () => {
  const text = "**Tóm tắt**\n- Cân nặng của bạn hiện là 99 kg.\n- Hãy ngủ đủ 7-8 giờ mỗi đêm.\nBạn nên ăn đủ đạm. Bạn đang nặng 99 kg nên cần theo dõi.";
  const r = run(text);
  assert.equal(r.removed.length, 2);
  assert.match(r.answer, /\*\*Tóm tắt\*\*/); assert.match(r.answer, /- Hãy ngủ đủ 7-8 giờ mỗi đêm\./); assert.match(r.answer, /Bạn nên ăn đủ đạm\./);
  assert.doesNotMatch(r.answer, /99/); assert.equal(r.answer.split(NO_VERIFIED_WEIGHT_NOTICE).length - 1, 1);
  assert.equal(run("Hãy ngủ đủ giấc.").answer, "Hãy ngủ đủ giấc.", "untouched when nothing is flagged");
});

test("WG-10 evidence builders: V2 reads only the progress measurement tool; V1 reads only the user's own context; nothing is invented", () => {
  const tool = new Map<string, unknown>([["progress.get_body_measurements", {
    available: true, observations: { latestAgeDays: 4 }, latest: { weightKg: 72.4 }, previous: { weightKg: 73.6 }, gap: { state: "AVAILABLE", currentKg: 72.4, currentSource: "MEASURED_INBODY" },
  }], ["nutrition.get_target", { calories: 2400, weightKg: 99 }]]);
  assert.deepEqual(weightEvidenceFromV2ToolData(tool), [{ kg: 72.4, role: "LATEST_MEASURED", ageDays: 4 }, { kg: 73.6, role: "PREVIOUS_MEASURED" }]);
  const withTrajectory = new Map<string, unknown>([["progress.get_body_measurements", { available: true, observations: { latestAgeDays: 3 }, latest: { weightKg: 72.4 }, previous: null, observedTrajectory: { state: "AVAILABLE", observedChangeKg: -1.6 } }]]);
  assert.deepEqual(weightEvidenceFromV2ToolData(withTrajectory), [{ kg: 72.4, role: "LATEST_MEASURED", ageDays: 3 }, { kg: 74, role: "PREVIOUS_MEASURED" }], "start of the observed trajectory = latest − change"); 
  assert.deepEqual(weightEvidenceFromV2ToolData(new Map([["progress.get_body_measurements", { available: false }]])), []);
  assert.deepEqual(weightEvidenceFromV2ToolData(new Map()), []);
  const prof = new Map([["progress.get_body_measurements", { available: true, observations: { latestAgeDays: null }, latest: null, previous: null, gap: { state: "AVAILABLE", currentKg: 70, currentSource: "PROFILE_REPORTED" } }]]);
  assert.deepEqual(weightEvidenceFromV2ToolData(prof), [{ kg: 70, role: "PROFILE_REPORTED" }]);
  const now = Date.parse("2026-11-16T00:00:00Z");
  const v1 = weightEvidenceFromV1Context({ profile: { currentWeightKg: 70 }, inBodyHistory: [{ weight: 72.4, date: "2026-11-10T07:00:00Z" }, { weight: 73.6, date: "2026-10-20T07:00:00Z" }] }, now);
  assert.deepEqual(v1, [{ kg: 72.4, role: "LATEST_MEASURED", ageDays: 5 }, { kg: 73.6, role: "PREVIOUS_MEASURED" }], "with a measurement, V1's currentWeightKg IS that measurement (derived), not a separate fresh source");
  assert.deepEqual(weightEvidenceFromV1Context({ profile: { currentWeightKg: 70 }, inBodyHistory: [] }, now), [{ kg: 70, role: "PROFILE_REPORTED" }], "no measurement → the profile-reported weight");
  assert.deepEqual(weightEvidenceFromV1Context({ profile: {}, inBodyHistory: [] }, now), []);
  assert.deepEqual(weightEvidenceFromV1Context(null, now), []);
  assert.deepEqual(weightEvidenceFromV1Context({ profile: { currentWeightKg: 0 }, inBodyHistory: [{ weight: -5 }, { weight: 9999 }] }, now), [], "implausible values are not evidence");
});
