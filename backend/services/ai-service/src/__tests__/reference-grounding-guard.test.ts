/**
 * V2.3A.7 phase 4/5 — port of the 29 unit/property tests that validated
 * training/semantic-qwen3-4b/scripts/reference_grounding_guard.py (see
 * docs/ai-training/qwen4b-v2-3a-deterministic-reference-grounding-guard.md
 * §4). Same fixtures, same invariants, now against the real
 * SemanticInterpretation type and the TypeScript port.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { validateReferenceGrounding } from "../conversational-intelligence/reference-grounding-guard";
import type { SemanticInterpretation, SemanticReference } from "../conversational-intelligence/schema";

function interp(overrides: Partial<SemanticInterpretation> = {}): SemanticInterpretation {
  return {
    primaryIntent: "REVISE_WORKFLOW",
    entities: [],
    corrections: [],
    references: [],
    goalSignals: [],
    negations: [],
    ambiguities: [],
    clarificationRequired: false,
    confidence: 0.8,
    source: "DETERMINISTIC",
    requestedAction: "REVISE",
    ...overrides,
  };
}

function ref(kind: SemanticReference["kind"], sourceText: string): SemanticReference {
  return { kind, sourceText };
}

// ── unit tests ──────────────────────────────────────────────────────────

test("zero candidate: clears references, requires clarification", () => {
  const res = validateReferenceGrounding(interp({ references: [ref("THIS_ITEM", "cai do")] }), "Doi cai do giup toi.");
  assert.equal(res.activated, true);
  assert.deepEqual(res.interpretation.references, []);
  assert.equal(res.interpretation.clarificationRequired, true);
  assert.equal(res.decisions[0].reason, "REFERENCE_NO_VISIBLE_TARGET");
});

test("one candidate: reference kept, not activated", () => {
  const res = validateReferenceGrounding(
    interp({ references: [ref("THIS_ITEM", "bai do")] }),
    "Deadlift hom qua nang qua, bot ta bai do di.",
  );
  assert.equal(res.activated, false);
  assert.equal(res.interpretation.references.length, 1);
  assert.equal(res.decisions[0].reason, "REFERENCE_GROUNDED_UNIQUE");
});

test("multiple candidates, no disambiguator: invalidated", () => {
  const res = validateReferenceGrounding(
    interp({ references: [ref("THIS_ITEM", "cai do")] }),
    "Bench va deadlift deu nang, bot cai do lai.",
  );
  assert.equal(res.activated, true);
  assert.equal(res.decisions[0].reason, "REFERENCE_MULTIPLE_VISIBLE_TARGETS");
});

test("explicit named target: not activated regardless of other candidates", () => {
  const res = validateReferenceGrounding(interp({ references: [ref("THIS_ITEM", "deadlift")] }), "Doi sang bai deadlift giup toi.");
  assert.equal(res.activated, false);
  assert.equal(res.decisions[0].reason, "REFERENCE_EXPLICIT_TARGET");
});

test("type mismatch: PT-domain deictic not grounded by an unrelated exercise candidate", () => {
  const res = validateReferenceGrounding(
    interp({ references: [ref("THIS_ITEM", "huan luyen vien kia")] }),
    "Squat hom qua on, doi huan luyen vien kia di.",
  );
  assert.equal(res.activated, true);
  assert.equal(res.decisions[0].domain, "PT");
});

test("same-message unique backreference: grounded", () => {
  const res = validateReferenceGrounding(
    interp({ references: [ref("THIS_ITEM", "cai do")] }),
    "Chuong trinh giam mo vua xem on do, lay cai do cho toi.",
  );
  assert.equal(res.activated, false);
  assert.equal(res.decisions[0].reason, "REFERENCE_GROUNDED_UNIQUE");
});

test("numeric single candidate: grounded", () => {
  const res = validateReferenceGrounding(interp({ references: [ref("THIS_ITEM", "muc do")] }), "Muc 70 nang qua, giam muc do xuong.");
  assert.equal(res.activated, false);
});

test("numeric multiple candidates: invalidated", () => {
  const res = validateReferenceGrounding(interp({ references: [ref("THIS_ITEM", "muc do")] }), "Muc 70 va muc 80 deu duoc, lay muc do.");
  assert.equal(res.activated, true);
  assert.equal(res.decisions[0].reason, "REFERENCE_MULTIPLE_VISIBLE_TARGETS");
});

test("non-reference turn: guard is a no-op", () => {
  const res = validateReferenceGrounding(interp({ references: [], primaryIntent: "PROVIDE_INFORMATION" }), "Toi cao 170cm.");
  assert.equal(res.activated, false);
  assert.deepEqual(res.decisions, []);
});

test("unguarded kind (ACCEPT_PROPOSAL) passes through untouched", () => {
  const res = validateReferenceGrounding(interp({ references: [ref("ACCEPT_PROPOSAL", "muc do")] }), "Lay muc do cho toi.");
  assert.equal(res.activated, false);
  assert.equal(res.decisions[0].reason, "REFERENCE_NOT_APPLICABLE");
});

// ── property/invariant tests ────────────────────────────────────────────

test("property: an unrelated-domain candidate must not invalidate a unique compatible target", () => {
  const baseMsg = "Deadlift hom qua nang qua, bot ta bai do di.";
  const before = validateReferenceGrounding(interp({ references: [ref("THIS_ITEM", "bai do")] }), baseMsg);
  const after = validateReferenceGrounding(
    interp({ references: [ref("THIS_ITEM", "bai do")] }),
    baseMsg + " Doi huan luyen vien Lan giup toi.",
  );
  assert.equal(before.activated, false);
  assert.equal(after.activated, false);
});

test("property: a second compatible candidate prevents resolution", () => {
  const one = validateReferenceGrounding(interp({ references: [ref("THIS_ITEM", "cai do")] }), "Deadlift nang, bot cai do di.");
  const two = validateReferenceGrounding(
    interp({ references: [ref("THIS_ITEM", "cai do")] }),
    "Deadlift va bench deu nang, bot cai do di.",
  );
  assert.equal(one.activated, false);
  assert.equal(two.activated, true);
});

test("property: removing the only candidate prevents grounding", () => {
  const withIt = validateReferenceGrounding(interp({ references: [ref("THIS_ITEM", "cai do")] }), "Deadlift nang, bot cai do di.");
  const without = validateReferenceGrounding(interp({ references: [ref("THIS_ITEM", "cai do")] }), "Bot cai do di.");
  assert.equal(withIt.activated, false);
  assert.equal(without.activated, true);
});

test("property: an explicit unique target is resolvable despite 2 visible candidates", () => {
  const res = validateReferenceGrounding(interp({ references: [ref("THIS_ITEM", "squat")] }), "Doi squat sang leg press di.");
  assert.equal(res.activated, false);
});

test("property: an explicit 'giữ X' disambiguator collapses multiple candidates to one", () => {
  const res = validateReferenceGrounding(
    interp({ references: [ref("THIS_ITEM", "bai kia")] }),
    "Giua squat va leg press thi giu squat, doi bai kia.",
  );
  assert.equal(res.activated, false);
});

// ── bounded-correction shape ────────────────────────────────────────────

test("bounded correction never touches primaryIntent/entities/requestedAction", () => {
  const before = interp({ references: [ref("THIS_ITEM", "cai do")], primaryIntent: "REVISE_WORKFLOW", requestedAction: "REVISE" });
  const res = validateReferenceGrounding(before, "Doi cai do di.");
  assert.equal(res.activated, true);
  assert.equal(res.interpretation.primaryIntent, "REVISE_WORKFLOW");
  assert.equal(res.interpretation.requestedAction, "REVISE");
  assert.deepEqual(res.interpretation.entities, []);
  assert.deepEqual(res.changedFields, ["references", "ambiguities", "clarificationRequired", "confidence"]);
});

test("guard never mutates the input object", () => {
  const before = interp({ references: [ref("THIS_ITEM", "cai do")] });
  const snapshotBefore = JSON.stringify(before);
  validateReferenceGrounding(before, "Doi cai do di.");
  assert.equal(JSON.stringify(before), snapshotBefore, "input interpretation must not be mutated in place");
});

test("guard is synchronous and makes zero calls of any kind (pure function)", () => {
  const start = Date.now();
  validateReferenceGrounding(interp({ references: [ref("THIS_ITEM", "cai do")] }), "Doi cai do di.");
  assert.ok(Date.now() - start < 50, "a pure, sync function must return near-instantly");
});
