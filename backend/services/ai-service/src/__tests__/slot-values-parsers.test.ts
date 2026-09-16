/**
 * Conversational AI Coach — Remediation #2 (Codex Independent Evaluation #2,
 * decision RETURN_TO_CLAUDE). Dedicated source-level unit coverage for
 * `parseTrainingDays`/`parseMinutes` (agent-workflow/slot-values.ts) — the
 * two P0 release-gate parser failures Codex found. No DB, no orchestrator;
 * pure-function coverage only, so this suite never depends on the DB-backed
 * `agent-workflow-remediation-1.test.ts` suite or the evaluator to prove the
 * fix (Codex's own evaluation notes it found these bugs against compiled
 * dist output — see the separate compiled-dist verification script for
 * that layer).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { parseTrainingDays, parseMinutes } from "../agent-workflow/slot-values";

test("parseTrainingDays: T-prefixed forms (pre-existing, must not regress)", () => {
  assert.deepEqual(parseTrainingDays("T2 T4 T6"), { ok: true, value: [1, 3, 5] });
  assert.deepEqual(parseTrainingDays("t2 t4 t6"), { ok: true, value: [1, 3, 5] });
});

test("parseTrainingDays: single 'thu' cue, multiple digits (pre-existing, must not regress)", () => {
  assert.deepEqual(parseTrainingDays("thứ 2 4 6"), { ok: true, value: [1, 3, 5] });
  assert.deepEqual(parseTrainingDays("thứ 2, 4, 6"), { ok: true, value: [1, 3, 5] });
});

test("parseTrainingDays: single 'thu' cue, hyphen-separated digits (Codex #2 P0)", () => {
  assert.deepEqual(parseTrainingDays("thứ 2 - 4 - 6"), { ok: true, value: [1, 3, 5] });
});

test("parseTrainingDays: 'thu' repeated before every day, hyphen-separated (Codex #2 P0 — the exact failing case)", () => {
  assert.deepEqual(parseTrainingDays("thứ 2 - thứ 4 - thứ 6"), { ok: true, value: [1, 3, 5] });
});

test("parseTrainingDays: 'thu' repeated before every day, comma-separated", () => {
  assert.deepEqual(parseTrainingDays("thứ 2, thứ 4, thứ 6"), { ok: true, value: [1, 3, 5] });
});

test("parseTrainingDays: spelled-out weekday names, each with its own 'thu' cue", () => {
  assert.deepEqual(parseTrainingDays("thứ hai, thứ tư, thứ sáu"), { ok: true, value: [1, 3, 5] });
});

test("parseTrainingDays: Sunday ('chủ nhật'/'CN') still maps to hardcoded 7, combined with other days", () => {
  assert.deepEqual(parseTrainingDays("thứ 2, chủ nhật"), { ok: true, value: [1, 7] });
});

test("parseTrainingDays: never extracts an unrelated number from the same sentence", () => {
  // Explicit anti-regression case: "tập thứ 2, khoảng 60 phút" must yield
  // ONLY day 2 — the "60" (minutes) must never be misread as a day number.
  const result = parseTrainingDays("tập thứ 2, khoảng 60 phút");
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.value, [1]);
});

test("parseTrainingDays: a bare count with no specific days falls back to a Monday-start spread", () => {
  assert.deepEqual(parseTrainingDays("3 buổi"), { ok: true, value: [1, 2, 3] });
});

test("parseTrainingDays: unrecognized input asks a clarifying question rather than guessing", () => {
  const result = parseTrainingDays("không biết nữa");
  assert.equal(result.ok, false);
});

test("parseMinutes: plain minutes (pre-existing, must not regress)", () => {
  assert.deepEqual(parseMinutes("60 phút"), { ok: true, value: 60 });
  assert.deepEqual(parseMinutes("90 phút"), { ok: true, value: 90 });
  assert.deepEqual(parseMinutes("45 phút"), { ok: true, value: 45 });
});

test("parseMinutes: whole-hour phrasing (pre-existing, must not regress)", () => {
  assert.deepEqual(parseMinutes("1 giờ"), { ok: true, value: 60 });
  assert.deepEqual(parseMinutes("1 tiếng"), { ok: true, value: 60 });
  assert.deepEqual(parseMinutes("2 giờ"), { ok: true, value: 120 });
  assert.deepEqual(parseMinutes("2 tiếng"), { ok: true, value: 120 });
});

test("parseMinutes: decimal-hour phrasing, dot separator (Codex #2 P0 — the exact failing case)", () => {
  assert.deepEqual(parseMinutes("1.5 giờ"), { ok: true, value: 90 });
  assert.deepEqual(parseMinutes("1.5 tiếng"), { ok: true, value: 90 });
});

test("parseMinutes: decimal-hour phrasing, comma separator (never confused with money's thousands-grouping comma)", () => {
  assert.deepEqual(parseMinutes("1,5 giờ"), { ok: true, value: 90 });
  assert.deepEqual(parseMinutes("1,5 tiếng"), { ok: true, value: 90 });
});

test("parseMinutes: sub-hour decimal", () => {
  assert.deepEqual(parseMinutes("0.5 giờ"), { ok: true, value: 30 });
});

test("parseMinutes: malformed multi-decimal input is rejected, never sliced into a plausible partial number", () => {
  // "1.2.3 giờ" must NOT become "2.3 giờ" (138 minutes) via a partial
  // regex match — no valid hour-phrase exists in this input at all.
  const result = parseMinutes("1.2.3 giờ");
  assert.equal(result.ok, false);
});

test("parseMinutes: a unary minus is never silently dropped", () => {
  // "-1 giờ" must NOT be read as "1 giờ" (60 minutes).
  const result = parseMinutes("-1 giờ");
  assert.equal(result.ok, false);
});

test("parseMinutes: non-numeric input is a clarifying failure, not a guess", () => {
  const result = parseMinutes("abc giờ");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "no_number_found");
});

test("parseMinutes: below the domain's minimum session length is a clarifying out_of_range failure, not clamped", () => {
  const result = parseMinutes("0 giờ");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "out_of_range");
});

test("parseMinutes: above the domain's maximum session length is a clarifying out_of_range failure, not clamped", () => {
  const result = parseMinutes("10 giờ");
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.reason, "out_of_range");
});
