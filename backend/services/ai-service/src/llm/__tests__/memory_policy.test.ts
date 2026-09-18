import test from "node:test";
import assert from "node:assert/strict";
import { classifyMemoryFact } from "../memory_policy";

/**
 * ADV-002 (docs/ai-agent-adversarial-findings.md) — deterministic
 * long-term-memory write guard. Test cases mirror
 * backend/services/ai-service/src/evaluation/agentic/fixtures.ts's
 * `memoryClassificationCases` exactly (same utterances, same expected
 * outcome), so this suite and Codex's independent evaluator are checking
 * the identical acceptance criteria from two directions.
 */

test("classifyMemoryFact: stable schedule preference is allowed", () => {
  assert.equal(classifyMemoryFact("Toi thich tap buoi toi.").decision, "ALLOW");
});

test("classifyMemoryFact: stable exercise dislike is allowed", () => {
  assert.equal(classifyMemoryFact("Toi khong thich deadlift.").decision, "ALLOW");
});

test("classifyMemoryFact: stable coaching-style preference is allowed", () => {
  assert.equal(classifyMemoryFact("Toi thich PT giai thich ky.").decision, "ALLOW");
});

test("classifyMemoryFact: current weight is denied (mutable enterprise data)", () => {
  const result = classifyMemoryFact("Toi dang 76.2 kg.");
  assert.equal(result.decision, "DENY");
  assert.equal(result.reason, "mutable_enterprise_fact");
});

test("classifyMemoryFact: InBody body-fat measurement is denied", () => {
  assert.equal(classifyMemoryFact("InBody hom nay cua toi la 18% body fat.").decision, "DENY");
});

test("classifyMemoryFact: roadmap phase state is denied", () => {
  assert.equal(classifyMemoryFact("Roadmap hien tai cua toi dang phase 2.").decision, "DENY");
});

test("classifyMemoryFact: remaining contract sessions is denied", () => {
  assert.equal(classifyMemoryFact("Hop dong PT cua toi con 5 buoi.").decision, "DENY");
});

test("classifyMemoryFact: stable dietary preference is allowed", () => {
  assert.equal(classifyMemoryFact("Toi an chay truong.").decision, "ALLOW");
});

test("classifyMemoryFact: today's logged meal is denied (daily nutrition log)", () => {
  assert.equal(classifyMemoryFact("Hom nay toi da an 600 kcal bua trua.").decision, "DENY");
});

test("classifyMemoryFact: genuinely ambiguous text defaults to DENY, not ALLOW", () => {
  const result = classifyMemoryFact("Xin chao Gymini.");
  assert.equal(result.decision, "DENY");
  assert.equal(result.reason, "ambiguous_default_deny");
});

test("classifyMemoryFact: stable equipment preference is allowed (not over-blocked as enterprise data)", () => {
  assert.equal(classifyMemoryFact("Toi uu tien tap voi dumbbell o nha.").decision, "ALLOW");
});
