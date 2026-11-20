import test from "node:test";
import assert from "node:assert/strict";
import {
  OPEN_STATUSES,
  PLAN_REVIEW_STATUSES,
  PlanReviewTransitionError,
  buildProgramSnapshot,
  canonicalJson,
  computeEffectiveState,
  fingerprintMatches,
  hashSnapshot,
  resolveTransition,
  toLegacyPtReviewStatus,
  type PlanReviewAction,
  type PlanReviewStatusValue,
  type ProgramSnapshotSource,
} from "../services/plan-review/plan-review.engine";

/** TEST FIXTURE — pure functions, no DB, no network. */

function program(overrides: Partial<ProgramSnapshotSource> = {}): ProgramSnapshotSource {
  return {
    id: "prog-1",
    name: "Giảm mỡ tăng cơ",
    goal: "FAT_LOSS",
    durationWeeks: 8,
    daysPerWeek: 2,
    version: 1,
    sourcePlanId: "ai-plan-1",
    aiPlanVersion: 2,
    days: [
      {
        dayNumber: 1,
        title: "Ngực + Lưng",
        exercises: [
          { exerciseId: "e1", order: 1, sets: 3, reps: 10, exercise: { exerciseName: "Bench Press" }, setPrescriptions: [] },
          { exerciseId: "e2", order: 2, sets: 3, reps: 12, exercise: { exerciseName: "Row" }, setPrescriptions: [] },
        ],
      },
      { dayNumber: 2, title: "Chân", exercises: [{ exerciseId: "e3", order: 1, sets: 4, reps: 8, exercise: { exerciseName: "Squat" } }] },
    ],
    ...overrides,
  };
}

test("state machine: every legal edge works and every other edge is rejected", () => {
  const actions: PlanReviewAction[] = ["START", "APPROVE", "REQUEST_CHANGES", "REJECT", "CANCEL", "SUPERSEDE", "REVOKE_ACCESS"];
  const legalActor: Record<PlanReviewAction, "PT" | "CLIENT" | "SYSTEM"> = {
    START: "PT", APPROVE: "PT", REQUEST_CHANGES: "PT", REJECT: "PT", CANCEL: "CLIENT", SUPERSEDE: "SYSTEM", REVOKE_ACCESS: "SYSTEM",
  };
  for (const from of PLAN_REVIEW_STATUSES) {
    for (const action of actions) {
      const open = (OPEN_STATUSES as readonly string[]).includes(from);
      const legal = open && !(action === "START" && from !== "PENDING_REVIEW");
      if (legal) assert.doesNotThrow(() => resolveTransition(from, action, legalActor[action]), `${from} -${action}->`);
      else assert.throws(() => resolveTransition(from, action, legalActor[action]), PlanReviewTransitionError, `${from} -${action}-> must be illegal`);
    }
  }
});

test("state machine: terminal states have no outgoing edge", () => {
  const terminal: PlanReviewStatusValue[] = ["APPROVED", "CHANGES_REQUESTED", "REJECTED", "CANCELLED", "SUPERSEDED", "ACCESS_REVOKED"];
  for (const from of terminal) {
    for (const action of ["START", "APPROVE", "REQUEST_CHANGES", "REJECT", "CANCEL", "SUPERSEDE", "REVOKE_ACCESS"] as PlanReviewAction[]) {
      for (const actor of ["PT", "CLIENT", "SYSTEM"] as const) {
        assert.throws(() => resolveTransition(from, action, actor));
      }
    }
  }
});

test("state machine: actors are enforced (client cannot decide, PT cannot cancel, only SYSTEM revokes)", () => {
  assert.throws(() => resolveTransition("PENDING_REVIEW", "APPROVE", "CLIENT"), /may not perform/);
  assert.throws(() => resolveTransition("PENDING_REVIEW", "REJECT", "CLIENT"), /may not perform/);
  assert.throws(() => resolveTransition("PENDING_REVIEW", "CANCEL", "PT"), /may not perform/);
  assert.throws(() => resolveTransition("PENDING_REVIEW", "REVOKE_ACCESS", "PT"), /may not perform/);
  assert.throws(() => resolveTransition("PENDING_REVIEW", "REVOKE_ACCESS", "CLIENT"), /may not perform/);
});

test("canonicalJson: key order and undefined do not change the bytes; values do", () => {
  assert.equal(canonicalJson({ b: 1, a: { d: 2, c: [1, { z: 1, y: 2 }] } }), canonicalJson({ a: { c: [1, { y: 2, z: 1 }], d: 2 }, b: 1, x: undefined }));
  assert.notEqual(canonicalJson({ a: 1 }), canonicalJson({ a: 2 }));
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]), "array order is meaningful");
});

test("hash: identical content => identical hash regardless of row ids/timestamps/input order; any prescription edit changes it", () => {
  const base = hashSnapshot(buildProgramSnapshot(program()));
  // Same content, days/exercises supplied in a different order + extra volatile fields that must be ignored.
  const shuffled = program();
  shuffled.days = [...shuffled.days].reverse();
  shuffled.days[1].exercises = [...shuffled.days[1].exercises].reverse();
  (shuffled as any).updatedAt = new Date().toISOString();
  (shuffled.days[0] as any).id = "volatile-row-id";
  assert.equal(hashSnapshot(buildProgramSnapshot(shuffled)), base);

  const edited = program();
  edited.days[0].exercises[0].reps = 11; // one rep changed
  assert.notEqual(hashSnapshot(buildProgramSnapshot(edited)), base);
  const swapped = program();
  swapped.days[0].exercises[0].exerciseId = "e9";
  assert.notEqual(hashSnapshot(buildProgramSnapshot(swapped)), base);
});

test("snapshot contains only the prescription — no profile/InBody/health fields can leak through", () => {
  const src: any = program();
  src.inbody = { weight: 70 };
  src.userProfile = { injuries: ["knee"] };
  src.days[0].exercises[0].healthNotes = "knee surgery";
  const text = canonicalJson(buildProgramSnapshot(src));
  for (const forbidden of ["inbody", "userProfile", "injuries", "healthNotes", "knee", "weight\":70"]) {
    assert.ok(!text.includes(forbidden), `snapshot must not contain ${forbidden}`);
  }
  assert.ok(text.includes("Bench Press"));
});

test("effective approval is computed at read time: an approval never carries to different content", () => {
  const approved = { status: "APPROVED" as const, contentHash: "h1", subjectVersion: 3 };
  const at = (hash: string, version: number) => ({ hash, version });
  assert.equal(computeEffectiveState(approved, at("h1", 3)), "APPROVED_CURRENT");
  assert.equal(computeEffectiveState(approved, at("h2", 4)), "APPROVED_OUTDATED");
  assert.equal(computeEffectiveState(approved, null), "APPROVED_OUTDATED", "no current program => not in force");
  const same = { contentHash: "h1", subjectVersion: 3 };
  assert.equal(computeEffectiveState({ status: "PENDING_REVIEW", ...same }, at("h1", 3)), "OPEN");
  assert.equal(computeEffectiveState({ status: "IN_REVIEW", ...same }, at("h1", 3)), "OPEN");
  assert.equal(computeEffectiveState({ status: "CHANGES_REQUESTED", ...same }, at("h1", 3)), "CHANGES_REQUESTED");
  assert.equal(computeEffectiveState({ status: "REJECTED", ...same }, at("h1", 3)), "REJECTED");
  for (const s of ["CANCELLED", "SUPERSEDED", "ACCESS_REVOKED"] as const) assert.equal(computeEffectiveState({ status: s, ...same }, at("h1", 3)), "NONE");
});

test("A -> B -> A: identical content but a newer monotonic version does NOT revive the old approval (hash alone is not enough)", () => {
  const approvedAtA = { status: "APPROVED" as const, contentHash: "hashA", subjectVersion: 1 };
  assert.equal(computeEffectiveState(approvedAtA, { hash: "hashA", version: 1 }), "APPROVED_CURRENT");
  assert.equal(computeEffectiveState(approvedAtA, { hash: "hashB", version: 2 }), "APPROVED_OUTDATED"); // edited to B
  assert.equal(computeEffectiveState(approvedAtA, { hash: "hashA", version: 3 }), "APPROVED_OUTDATED"); // edited back to A
  assert.equal(fingerprintMatches(approvedAtA, { hash: "hashA", version: 3 }), false);
  assert.equal(fingerprintMatches(approvedAtA, { hash: "hashA", version: 1 }), true);
});

test("legacy ptReviewStatus mapping stays compatible (read-only mapping)", () => {
  assert.equal(toLegacyPtReviewStatus("PENDING_REVIEW"), "PENDING_PT_REVIEW");
  assert.equal(toLegacyPtReviewStatus("IN_REVIEW"), "PENDING_PT_REVIEW");
  assert.equal(toLegacyPtReviewStatus("APPROVED"), "PT_APPROVED");
  assert.equal(toLegacyPtReviewStatus("REJECTED"), "PT_REJECTED");
  assert.equal(toLegacyPtReviewStatus("CHANGES_REQUESTED"), null);
  assert.equal(toLegacyPtReviewStatus("CANCELLED"), null);
});
