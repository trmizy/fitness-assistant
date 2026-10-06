/**
 * Phase 3 Batch 5 defect regression (docs/ai-product/phase3-batch5-rollout-readiness.md §19): the AI-unavailable fallback
 * claimed "Tôi đã ghi nhận yêu cầu phân tích InBody của bạn" for EVERY unavailable turn. That is a false statement for any
 * other question (e.g. a general fitness question). The fallback must only state what is true: no answer, nothing recorded or changed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildAiUnavailableFallback } from "../llm/orchestrator.service";
import type { LanguageDecision } from "../llm/types";

const vi = { responseLanguage: "vi" } as unknown as LanguageDecision;
const en = { responseLanguage: "en" } as unknown as LanguageDecision;

test("Vietnamese fallback never claims an InBody request was recorded (it was a false statement for general questions)", () => {
  const text = buildAiUnavailableFallback(vi);
  assert.doesNotMatch(text, /InBody/i);
  assert.doesNotMatch(text, /đã ghi nhận yêu cầu/i);
  assert.match(text, /chưa ghi nhận hay thay đổi gì/i, "must state truthfully that nothing was recorded or changed");
});

test("English fallback is truthful and makes no record claim", () => {
  const text = buildAiUnavailableFallback(en);
  assert.doesNotMatch(text, /InBody/i);
  assert.match(text, /Nothing was recorded or changed/);
});
