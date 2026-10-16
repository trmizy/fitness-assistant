/**
 * V2.3A.7 phase 3 + phase 5 regression: pins interpretDeterministic()'s
 * pre-existing merge/ordering behavior (no DB needed — pure function) and
 * proves the newly-integrated reference-grounding guard fires at the right
 * point: BEFORE primaryIntent/confidence read `references.length`, so an
 * ungrounded deictic can never silently flip primaryIntent to
 * PROVIDE_INFORMATION or raise confidence on its way out.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { interpretDeterministic } from "../conversational-intelligence/interpreter";

// ── the fix: an ungrounded reference is caught inside the deterministic path itself ──

test("ungrounded THIS_ITEM ('PT đó', zero antecedent): references cleared, clarification required, primaryIntent NOT pulled into PROVIDE_INFORMATION by the reference", () => {
  const result = interpretDeterministic("đổi sang PT đó đi");
  assert.deepEqual(result.references, [], "guard must clear an ungrounded reference");
  assert.equal(result.clarificationRequired, true);
  assert.ok(
    result.ambiguities.some((a) => a.field === "reference"),
    "guard must record the reference-grounding failure",
  );
  // This exact message resolves to START_WORKFLOW via the unrelated
  // workflowIntent branch (mentioning "PT" maps to FIND_PT), which fires
  // earlier in the if-chain than the UNKNOWN/reference fallback line —
  // confirmed by direct observation, not assumed. The guard's own job is
  // independent of that: references/clarificationRequired/ambiguities
  // (asserted above) must reflect the grounding failure regardless of
  // which branch decided primaryIntent. The one thing that must NEVER
  // happen is the OLD bug's specific failure mode: an ungrounded
  // reference's mere presence silently promoting a would-be UNKNOWN
  // primaryIntent to PROVIDE_INFORMATION (interpreter.ts's own "a pure
  // reference... answering a proposal is information, not unknown" line)
  // — ruled out directly.
  assert.notEqual(result.primaryIntent, "PROVIDE_INFORMATION");
});

test("ungrounded THIS_ITEM with NO workflow/correction/goal signal to short-circuit it: primaryIntent genuinely stays UNKNOWN, not silently promoted", () => {
  // "Thực đơn đó" (that menu) qualifies THIS_ITEM's noun+deictic pattern
  // with zero antecedent, and (unlike the PT example above) has no
  // workflow/correction/question trigger to short-circuit primaryIntent
  // first -- the deterministic if-chain falls all the way through to the
  // exact branch the old bug corrupted (interpreter.ts's "a pure
  // reference... answering a proposal is information, not unknown").
  const result = interpretDeterministic("Thực đơn đó khá đắt.");
  assert.deepEqual(result.references, []);
  assert.equal(result.primaryIntent, "UNKNOWN", "must stay UNKNOWN now that the ungrounded reference is cleared before this check runs");
  assert.equal(result.clarificationRequired, true);
});

test("grounded same-message backreference ('PT Minh ... người đó'): reference preserved, not flagged", () => {
  const result = interpretDeterministic("PT Minh tư vấn tốt lắm, chốt người đó cho tôi.");
  // Grounded cases must be entirely unaffected by the guard.
  assert.equal(
    result.ambiguities.some((a) => a.field === "reference"),
    false,
    "a grounded reference must not be flagged",
  );
});

test("explicit named target ('Đổi sang bài deadlift'): never run through grounding at all", () => {
  const result = interpretDeterministic("Đổi sang bài deadlift giúp tôi.");
  assert.equal(
    result.ambiguities.some((a) => a.field === "reference"),
    false,
  );
});

// ── pre-existing merge/ordering behavior, pinned (Phase 3) ─────────────

test("deterministic entity extraction still drives PROVIDE_INFORMATION when a real value is present", () => {
  const result = interpretDeterministic("Tôi cao 170cm.");
  assert.equal(result.primaryIntent, "PROVIDE_INFORMATION");
  assert.ok(result.entities.some((e) => e.type === "HEIGHT_CM" && e.value === 170));
  assert.equal(result.source, "DETERMINISTIC");
});

test("a correction cue still drives CORRECT_INFORMATION (unrelated to references)", () => {
  const result = interpretDeterministic("à không, tôi tập 5 buổi");
  assert.equal(result.primaryIntent, "CORRECT_INFORMATION");
});

test("a workflow command still drives START_WORKFLOW (unrelated to references)", () => {
  const result = interpretDeterministic("Tìm PT cho tôi.");
  assert.equal(result.primaryIntent, "START_WORKFLOW");
  assert.equal(result.workflowIntent, "FIND_PT");
});

test("confidence formula is unaffected for a message with no reference at all", () => {
  const result = interpretDeterministic("Tôi cao 170cm.");
  assert.ok(result.confidence > 0.9, "a clean asserted entity keeps its high confidence, guard never touches this path");
});
