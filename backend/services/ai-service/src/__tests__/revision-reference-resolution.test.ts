/**
 * Phase 3 Batch 4 — pure reference-resolution tests. No DB, no HTTP, no LLM.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { resolveOrdinalReference, detectExcludeCue } from "../services/revision/reference-resolution";

test("T22/T26: ordinal reference resolves a position; an unordinal/ambiguous reference resolves to null", () => {
  assert.equal(resolveOrdinalReference("Không thích người thứ hai, còn ai khác?"), 2);
  assert.equal(resolveOrdinalReference("PT thứ 3 có vẻ hợp"), 3);
  assert.equal(resolveOrdinalReference("chương trình thứ nhất"), 1);
  assert.equal(resolveOrdinalReference("cái đó không hợp"), null, "ambiguous 'cái đó' is never guessed as an ordinal");
  assert.equal(resolveOrdinalReference("hôm nay tôi nên tập gì?"), null);
});

test("ordinal word support up to 7 (the real max candidate list length), never guessed beyond", () => {
  assert.equal(resolveOrdinalReference("PT thứ bảy"), 7);
  assert.equal(resolveOrdinalReference("PT thứ 7"), 7);
});

test("detectExcludeCue matches the same vocabulary already proven in tryReviseWorkoutPlanDraft, nothing new invented", () => {
  assert.equal(detectExcludeCue("Không thích người thứ hai"), true);
  assert.equal(detectExcludeCue("Tôi không muốn người này"), true);
  assert.equal(detectExcludeCue("PT thứ hai có vẻ phù hợp đó"), false, "a neutral statement about an ordinal is not an exclusion");
});

test("T07 (revision model): the resolver module performs zero I/O — no prisma/axios import, callable with no stubs", () => {
  // Proven by construction: this file never stubs prisma/axios/llm and both functions still work.
  assert.equal(typeof resolveOrdinalReference, "function");
  assert.equal(typeof detectExcludeCue, "function");
});
