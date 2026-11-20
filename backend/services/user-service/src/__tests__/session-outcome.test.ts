import test from "node:test";
import assert from "node:assert/strict";
import { resolveSessionOutcome } from "../services/session-outcome";
import { SessionStatus } from "../generated/prisma";

/**
 * Money-flow plan 3.1 + OWNER DECISION 20/11/2026: the 24-hour grace for cancelling a CONFIRMED session is removed.
 * The outcome depends on WHO cancels only, never on how far away the session is. This pins the matrix
 * (actor x early/late), including notices well past the old 24 h threshold, the old boundary, and a negative notice.
 */

const EARLY = [48, 72, 999];
const LATE = [5, 3, 1];
const BOUNDARY = [24, 23.9, 24.1];
const PAST = [0, -1];
const ALL_NOTICES = [...EARLY, ...LATE, ...BOUNDARY, ...PAST];

const CLIENT_CANCEL = {
  sessionStatus: SessionStatus.CANCELLED,
  clientQuotaEffect: "DEDUCT",
  clientCompensation: false,
  ptPayout: true,
};
const PT_CANCEL = {
  sessionStatus: SessionStatus.NO_SHOW,
  clientQuotaEffect: "KEEP",
  clientCompensation: true,
  ptPayout: false,
};
const FORCE_MAJEURE = {
  sessionStatus: SessionStatus.CANCELLED,
  clientQuotaEffect: "KEEP",
  clientCompensation: false,
  ptPayout: false,
};

test("client cancels a confirmed session EARLY (>=24h): still loses the session, PT earns it (was: free)", () => {
  for (const h of EARLY) {
    assert.deepEqual(resolveSessionOutcome({ actor: "CLIENT", event: "CANCEL", hoursBeforeStart: h }), CLIENT_CANCEL, `${h}h`);
  }
});

test("client cancels a confirmed session LATE (<24h): lose the session, PT earns it (unchanged)", () => {
  for (const h of LATE) {
    assert.deepEqual(resolveSessionOutcome({ actor: "CLIENT", event: "CANCEL", hoursBeforeStart: h }), CLIENT_CANCEL, `${h}h`);
  }
});

test("PT cancels / blocks a day EARLY (>=24h): client compensated in cash, session consumed, PT not paid (was: free reschedule)", () => {
  for (const h of EARLY) {
    assert.deepEqual(resolveSessionOutcome({ actor: "PT", event: "CANCEL", hoursBeforeStart: h }), PT_CANCEL, `${h}h`);
  }
});

test("PT cancels / blocks a day LATE (<24h): client compensated, PT bears the cost (unchanged)", () => {
  for (const h of LATE) {
    assert.deepEqual(resolveSessionOutcome({ actor: "PT", event: "CANCEL", hoursBeforeStart: h }), PT_CANCEL, `${h}h`);
  }
});

test("PT no-show: always compensated, same as a PT cancel", () => {
  assert.deepEqual(resolveSessionOutcome({ actor: "PT", event: "NO_SHOW", hoursBeforeStart: -1 }), PT_CANCEL);
  assert.deepEqual(resolveSessionOutcome({ actor: "PT", event: "NO_SHOW" }), PT_CANCEL);
});

test("force majeure: nobody penalised, session returned, regardless of notice", () => {
  for (const h of ALL_NOTICES) {
    assert.deepEqual(resolveSessionOutcome({ actor: "FORCE_MAJEURE", event: "CANCEL", hoursBeforeStart: h }), FORCE_MAJEURE, `${h}h`);
  }
});

test("there is no 24h boundary any more: the outcome is identical at every notice, for every actor", () => {
  for (const actor of ["CLIENT", "PT", "FORCE_MAJEURE"] as const) {
    const base = resolveSessionOutcome({ actor, event: "CANCEL" });
    for (const h of ALL_NOTICES) {
      assert.deepEqual(resolveSessionOutcome({ actor, event: "CANCEL", hoursBeforeStart: h }), base, `${actor} ${h}h`);
    }
  }
});

test("a PT cancel never pays the PT and a client cancel never compensates the client", () => {
  for (const h of ALL_NOTICES) {
    const pt = resolveSessionOutcome({ actor: "PT", event: "CANCEL", hoursBeforeStart: h });
    assert.equal(pt.ptPayout, false);
    assert.equal(pt.clientCompensation, true);
    const client = resolveSessionOutcome({ actor: "CLIENT", event: "CANCEL", hoursBeforeStart: h });
    assert.equal(client.ptPayout, true);
    assert.equal(client.clientCompensation, false);
  }
});
