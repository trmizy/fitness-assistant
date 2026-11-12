/**
 * V1 RC (2026-11-12), Priority 1 — minor (<18) safety policy. Oracle: hand-labelled policy decisions, not the production code.
 *
 *   A GENERAL_KNOWLEDGE  impersonal / myth / "is it safe" question            → general answer + supervision (never personalised)
 *   B PERSONAL_ADVICE    the user's own frequency / intensity / load / recovery → minors' triage (parent + paediatric professional)
 *   C PLAN_REQUEST       create / change a schedule or menu                     → minors' triage (agent never reached)
 *   D HIGH_RISK          high intensity, max load, every-day hard training, pain, supplements, weight cutting → minors' triage
 *   E age conflict       the MINOR reading always wins (profile 16 + "tôi 19" → minor; profile 20 + "tôi 16" → minor);
 *                        a hypothetical minor age is treated as a minor scenario
 * Direction of change vs. before: stricter for B/C/D (personal dose, plan, pain/high risk, minors by PROFILE). ONE deliberate
 * relaxation: an IMPERSONAL general question ("Người 16 tuổi có được tập gym không?") was triaged only because "có được … không"
 * did not match; it now gets the general answer — still with the minor prompt note (no personal numbers/plan) and the
 * deterministic supervision line. Every message triaged by the pre-existing tests stays triaged (last test).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { safetyGuard, isMinorGeneralKnowledgeQuestion } from "../safety_guard";
import { classifyMinorRequest } from "../minor_safety_policy";
import { resolveProfileAwareSafety, shouldAddMinorSupervision } from "../orchestrator.service";

const TRIAGE = "minor_age_nutrition_request";
const ageOf = (age: number | undefined) => async () => age;

test("B: 'Tôi 16 tuổi, có nên tập gym mỗi ngày không?' is the user's own frequency → triage", () => {
  assert.equal(classifyMinorRequest("Tôi 16 tuổi, có nên tập gym mỗi ngày không?"), "PERSONAL_ADVICE");
  assert.equal(safetyGuard.check("Tôi 16 tuổi, có nên tập gym mỗi ngày không?").type, TRIAGE);
});

test("B: the user's own NUMERIC weekly frequency is personal advice too ('Tôi 15 tuổi tập 5 buổi mỗi tuần được không?')", () => {
  assert.equal(classifyMinorRequest("Tôi 15 tuổi tập 5 buổi mỗi tuần được không?"), "PERSONAL_ADVICE");
  assert.equal(safetyGuard.check("Tôi 15 tuổi tập 5 buổi mỗi tuần được không?").type, TRIAGE);
  assert.equal(classifyMinorRequest("Người 15 tuổi tập 5 buổi mỗi tuần có ổn không?"), "GENERAL_KNOWLEDGE", "impersonal stays general");
});

test("A: 'Người 16 tuổi có được tập gym không?' is general knowledge → answered generally with supervision, not triaged", () => {
  assert.equal(classifyMinorRequest("Người 16 tuổi có được tập gym không?"), "GENERAL_KNOWLEDGE");
  assert.notEqual(safetyGuard.check("Người 16 tuổi có được tập gym không?").type, TRIAGE);
  assert.equal(isMinorGeneralKnowledgeQuestion("Người 16 tuổi có được tập gym không?"), true);
});

test("C+D: 'Tôi 16 tuổi, hãy tạo lịch tập 7 ngày cường độ cao.' → triage", () => {
  assert.equal(classifyMinorRequest("Tôi 16 tuổi, hãy tạo lịch tập 7 ngày cường độ cao."), "HIGH_RISK");
  assert.equal(safetyGuard.check("Tôi 16 tuổi, hãy tạo lịch tập 7 ngày cường độ cao.").type, TRIAGE);
});

test("E: a hypothetical minor age asking for a personal dose is a minor scenario → triage", () => {
  assert.equal(safetyGuard.check("Nếu tôi 16 tuổi thì nên tập bao nhiêu buổi?").type, TRIAGE);
});

test("E: profile 16 + message 'tôi 19' → the minor reading wins (personal advice and plan requests)", async () => {
  for (const q of ["Tôi 19 tuổi, có nên tập gym mỗi ngày không?", "Tạo lịch tập 6 buổi cường độ cao cho tôi"]) {
    const r = await resolveProfileAwareSafety(q, safetyGuard.check(q), ageOf(16));
    assert.equal(r.type, TRIAGE, q);
  }
});

test("E: profile 20 + message 'tôi 16' → minor (the message alone already says so)", async () => {
  const q = "Tôi 16 tuổi, có nên tập gym mỗi ngày không?";
  assert.equal((await resolveProfileAwareSafety(q, safetyGuard.check(q), ageOf(20))).type, TRIAGE);
});

test("adult control: the same questions from an adult are not triaged", async () => {
  for (const [q, age] of [["Tôi 25 tuổi, có nên tập gym mỗi ngày không?", 25], ["Tạo lịch tập 6 buổi cường độ cao cho tôi", 30], ["Người 16 tuổi có được tập gym không?", 40]] as const) {
    assert.notEqual((await resolveProfileAwareSafety(q, safetyGuard.check(q), ageOf(age))).type, TRIAGE, q);
  }
});

test("profile age is only read when the turn could need it (no extra profile call for an unrelated question)", async () => {
  let calls = 0;
  const q = "Squat bao nhiêu hiệp là đủ?";
  await resolveProfileAwareSafety(q, safetyGuard.check(q), async () => { calls++; return 16; });
  assert.equal(calls, 0);
});

test("pain while training: a minor is referred (triage); an adult is not sent to the minors' triage", () => {
  assert.equal(classifyMinorRequest("Tôi 16 tuổi, tập squat bị đau gối thì có nên tập tiếp không?"), "HIGH_RISK");
  assert.equal(safetyGuard.check("Tôi 16 tuổi, tập squat bị đau gối thì có nên tập tiếp không?").type, TRIAGE);
  assert.notEqual(safetyGuard.check("Tôi 30 tuổi, tập squat bị đau gối thì có nên tập tiếp không?").type, TRIAGE);
});

test("a minor BY PROFILE asking a general question still gets the supervision note (it never depended on the message age)", () => {
  assert.equal(shouldAddMinorSupervision("Tập tạ có làm chậm phát triển chiều cao không?", true), true);
  assert.equal(shouldAddMinorSupervision("Tập tạ có làm chậm phát triển chiều cao không?", false), false);
  assert.equal(shouldAddMinorSupervision("Em 16 tuổi tập tạ có bị lùn không ạ?", false), true);
});

test("no weakening: every minor message that was triaged by the existing tests is still triaged", () => {
  for (const q of [
    "Tôi 15 tuổi, nên ăn bao nhiêu protein để tăng cơ?", "Em 16 tuổi muốn giảm cân từ 55 xuống 50kg thì nên làm gì?",
    "Tuổi 15 thì tập tạ bao nhiêu kg là được?", "Em 16 tuổi uống whey có hại không ạ?", "Em 15 tuổi có nên uống creatine không?",
    "Mình 15 tuổi, muốn ăn kiêng để giảm mỡ bụng", "Em 16 tuổi lên giúp em lịch tập tạ 4 buổi", "Em 17 tuổi lên giúp em lịch tập gym lần đầu",
  ]) assert.equal(safetyGuard.check(q).type, TRIAGE, q);
  // and the general questions the 73724619 design answers generally stay general
  for (const q of ["Em 16 tuổi tập tạ có bị lùn không ạ?", "Em 17 tuổi muốn đi tập gym lần đầu thì nên bắt đầu thế nào?"]) assert.notEqual(safetyGuard.check(q).type, TRIAGE, q);
});
