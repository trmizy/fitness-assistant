/**
 * Adaptive Cycle Evaluation via chat (2026-09-07, docs/agentic-fitness/
 * 01_NUTRITION_AGENT_TOOLS_PLAN.md, phases C/D) — proves the new EVALUATE/
 * REVIEW branches of parseFitnessAgentIntent, including the same
 * Vietnamese-đ \b word-boundary issue found and fixed in
 * food-substitution-extractor.ts (sentence-initial "Đánh giá..." /
 * "Đồng ý" must still match).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseFitnessAgentIntent } from "../services/fitness-agent-intent";

test("EVALUATE: recognizes a direct evaluation request", () => {
  const r = parseFitnessAgentIntent("đánh giá chu kỳ tập của tôi thế nào rồi");
  assert.equal(r.kind, "EVALUATE");
});

test("EVALUATE: recognizes sentence-initial capitalized Đánh (the \\b-with-đ edge case)", () => {
  const r = parseFitnessAgentIntent("Đánh giá chu kỳ giúp tôi");
  assert.equal(r.kind, "EVALUATE");
});

test("EVALUATE: recognizes 'tiến độ tập luyện của tôi'", () => {
  const r = parseFitnessAgentIntent("tiến độ tập luyện của tôi đang thế nào");
  assert.equal(r.kind, "EVALUATE");
});

test("REVIEW: 'chấp nhận' with no target is ACCEPT, target undefined (caller must ask)", () => {
  const r = parseFitnessAgentIntent("tôi chấp nhận đề xuất đó");
  assert.equal(r.kind, "REVIEW");
  assert.equal(r.reviewDecision, "ACCEPT");
  assert.equal(r.reviewTarget, undefined);
});

test("REVIEW: 'từ chối đề xuất dinh dưỡng' is REJECT + NUTRITION target", () => {
  const r = parseFitnessAgentIntent("tôi từ chối đề xuất dinh dưỡng");
  assert.equal(r.kind, "REVIEW");
  assert.equal(r.reviewDecision, "REJECT");
  assert.equal(r.reviewTarget, "NUTRITION");
});

test("REVIEW: 'đồng ý với chương trình tập' is ACCEPT + TRAINING target", () => {
  const r = parseFitnessAgentIntent("tôi đồng ý với chương trình tập");
  assert.equal(r.kind, "REVIEW");
  assert.equal(r.reviewDecision, "ACCEPT");
  assert.equal(r.reviewTarget, "TRAINING");
});

test("REVIEW: sentence-initial 'Đồng ý' still matches (đ boundary edge case)", () => {
  const r = parseFitnessAgentIntent("Đồng ý, hãy áp dụng");
  assert.equal(r.kind, "REVIEW");
  assert.equal(r.reviewDecision, "ACCEPT");
});

test("an unrelated message matches neither EVALUATE nor REVIEW", () => {
  const r = parseFitnessAgentIntent("hôm nay tôi nên ăn gì để tăng cơ?");
  assert.notEqual(r.kind, "EVALUATE");
  assert.notEqual(r.kind, "REVIEW");
});

test("EVALUATE takes priority over PT/PROGRAM keywords when both could plausibly match", () => {
  // Mentions "tap" (training) but is clearly an evaluation request, not a
  // program search — must resolve to EVALUATE, not PROGRAM.
  const r = parseFitnessAgentIntent("đánh giá chu kỳ tập luyện của tôi");
  assert.equal(r.kind, "EVALUATE");
});
