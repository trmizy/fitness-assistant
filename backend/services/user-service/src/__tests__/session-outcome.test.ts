import test from "node:test";
import assert from "node:assert/strict";
import { resolveSessionOutcome, SESSION_LATE_CANCEL_HOURS } from "../services/session-outcome";
import { SessionStatus } from "../generated/prisma";

/**
 * Money-flow redesign plan item 3.1 — full coverage of matrix 0.1's six rows, the exact
 * requirement the plan calls out ("Hàm này phải có kiểm thử đơn vị phủ đủ sáu dòng của
 * ma trận").
 */

test("row 1 — client cancels ≥24h: quota kept, nobody paid", () => {
  const out = resolveSessionOutcome({ actor: "CLIENT", event: "CANCEL", hoursBeforeStart: 48 });
  assert.deepEqual(out, {
    sessionStatus: SessionStatus.CANCELLED,
    clientQuotaEffect: "KEEP",
    clientCompensation: false,
    ptPayout: false,
  });
});

test("row 2 — client cancels <24h: quota deducted, PT earns the full session", () => {
  const out = resolveSessionOutcome({ actor: "CLIENT", event: "CANCEL", hoursBeforeStart: 5 });
  assert.deepEqual(out, {
    sessionStatus: SessionStatus.CANCELLED,
    clientQuotaEffect: "DEDUCT",
    clientCompensation: false,
    ptPayout: true,
  });
});

test("row 3 — PT cancels/blocks ≥24h: reschedule only, NO compensation — the exact case the plan says is currently wrong", () => {
  const out = resolveSessionOutcome({ actor: "PT", event: "CANCEL", hoursBeforeStart: 72 });
  assert.deepEqual(out, {
    sessionStatus: SessionStatus.CANCELLED,
    clientQuotaEffect: "KEEP",
    clientCompensation: false,
    ptPayout: false,
  });
});

test("row 4 — PT cancels/blocks <24h: client compensated, PT bears the cost", () => {
  const out = resolveSessionOutcome({ actor: "PT", event: "CANCEL", hoursBeforeStart: 3 });
  assert.deepEqual(out, {
    sessionStatus: SessionStatus.NO_SHOW,
    clientQuotaEffect: "KEEP",
    clientCompensation: true,
    ptPayout: false,
  });
});

test("row 5 — PT no-show: always compensated regardless of notice", () => {
  const out = resolveSessionOutcome({ actor: "PT", event: "NO_SHOW", hoursBeforeStart: -1 });
  assert.deepEqual(out, {
    sessionStatus: SessionStatus.NO_SHOW,
    clientQuotaEffect: "KEEP",
    clientCompensation: true,
    ptPayout: false,
  });
});

test("row 6 — force majeure: reschedule, nobody penalized, regardless of notice", () => {
  const soon = resolveSessionOutcome({ actor: "FORCE_MAJEURE", event: "CANCEL", hoursBeforeStart: 1 });
  const far = resolveSessionOutcome({ actor: "FORCE_MAJEURE", event: "CANCEL", hoursBeforeStart: 999 });
  for (const out of [soon, far]) {
    assert.deepEqual(out, {
      sessionStatus: SessionStatus.CANCELLED,
      clientQuotaEffect: "KEEP",
      clientCompensation: false,
      ptPayout: false,
    });
  }
});

test("the 24h boundary itself counts as ON TIME (not late) — exactly SESSION_LATE_CANCEL_HOURS out is not late", () => {
  assert.equal(SESSION_LATE_CANCEL_HOURS, 24);
  const atBoundary = resolveSessionOutcome({ actor: "CLIENT", event: "CANCEL", hoursBeforeStart: 24 });
  assert.equal(atBoundary.clientQuotaEffect, "KEEP", "exactly 24h out must not be treated as late");

  const justUnder = resolveSessionOutcome({ actor: "CLIENT", event: "CANCEL", hoursBeforeStart: 23.9 });
  assert.equal(justUnder.clientQuotaEffect, "DEDUCT", "23.9h out must be treated as late");
});
