/**
 * Dispute runtime gate (e2e-isolated mode) - pure logic, NO database, fail-closed for every misconfiguration.
 * Evidence label: CODE-LEVEL UNIT TEST of runtime-gate.ts / flags.ts / payment-peer.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { DISPUTE_CASE_FLAGS, E2E_PERMITTED_FLAGS, flagVerdict, __resetFlagWarnings } from "../services/dispute-case/flags";
import { evaluateRuntimeGate, MARKER_VALUE } from "../services/dispute-case/runtime-gate";
import { peerAgrees, __setPeerState, PEER_MAX_AGE_MS, type PeerState } from "../services/dispute-case/payment-peer";

const NOW = 1_000_000;
const e2eEnv = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv =>
  ({
    NODE_ENV: "development",
    DISPUTE_RUNTIME_MODE: "e2e-isolated",
    DISPUTE_E2E_COMPOSE_MARKER: MARKER_VALUE,
    DISPUTE_E2E_DB_ALLOWLIST: "gymini_user_e2e,gymini_gym_e2e",
    DATABASE_URL: "postgresql://u:pw@e2e-dispute-postgres:5432/gymini_user_e2e",
    ...over,
  }) as NodeJS.ProcessEnv;
const good: PeerState = { status: "checked", checkedAt: NOW, payment: { mode: "e2e-isolated", open: true } };

function quiet<T>(fn: () => T): T {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    return fn();
  } finally {
    console.warn = warn;
  }
}

test("e2e gate opens ONLY when mode + NODE_ENV + marker + allowlisted *_e2e DB all hold", () => {
  assert.equal(evaluateRuntimeGate(e2eEnv(), false).mode, "e2e-isolated");
  assert.equal(evaluateRuntimeGate(e2eEnv(), false).open, true);
  const closed: Array<[string, NodeJS.ProcessEnv, string]> = [
    ["production", e2eEnv({ NODE_ENV: "production" }), "E2E_NODE_ENV_NOT_ALLOWED"],
    ["NODE_ENV unset", e2eEnv({ NODE_ENV: undefined }), "E2E_NODE_ENV_NOT_ALLOWED"],
    ["mode missing", e2eEnv({ DISPUTE_RUNTIME_MODE: undefined }), "NOT_TEST_ENV"],
    ["mode typo", e2eEnv({ DISPUTE_RUNTIME_MODE: "E2E-isolated" }), "NOT_TEST_ENV"],
    ["marker missing", e2eEnv({ DISPUTE_E2E_COMPOSE_MARKER: undefined }), "E2E_MARKER_MISSING"],
    ["marker wrong", e2eEnv({ DISPUTE_E2E_COMPOSE_MARKER: "yes" }), "E2E_MARKER_MISSING"],
    ["db not allowlisted", e2eEnv({ DATABASE_URL: "postgresql://u:pw@h/other_e2e" }), "E2E_DB_NOT_ALLOWLISTED"],
    ["db allowlisted but not *_e2e", e2eEnv({ DISPUTE_E2E_DB_ALLOWLIST: "gymcoach_user", DATABASE_URL: "postgresql://u:pw@h/gymcoach_user" }), "E2E_DB_NOT_ALLOWLISTED"],
    ["allowlist empty", e2eEnv({ DISPUTE_E2E_DB_ALLOWLIST: "" }), "E2E_DB_NOT_ALLOWLISTED"],
    ["allowlist unset", e2eEnv({ DISPUTE_E2E_DB_ALLOWLIST: undefined }), "E2E_DB_NOT_ALLOWLISTED"],
    ["DATABASE_URL garbage", e2eEnv({ DATABASE_URL: "not a url" }), "E2E_DB_NOT_ALLOWLISTED"],
    ["dev DB name", e2eEnv({ DATABASE_URL: "postgresql://u:pw@postgres:5432/gymcoach_user" }), "E2E_DB_NOT_ALLOWLISTED"],
  ];
  for (const [label, env, why] of closed) {
    const v = evaluateRuntimeGate(env, false);
    assert.equal(v.open, false, label);
    assert.equal(v.refusedBecause, why, label);
  }
  // NODE_ENV=test is the test mode only: the e2e variables do not turn it into the e2e mode
  assert.equal(evaluateRuntimeGate(e2eEnv({ NODE_ENV: "test" }), false).mode, "test");
  assert.equal(evaluateRuntimeGate(e2eEnv({ NODE_ENV: "test" }), false).open, false);
});

test("flags in e2e mode: only the permitted subset, only with the right value, T0 and late-open never", () => {
  quiet(() => {
    __resetFlagWarnings();
    const F = DISPUTE_CASE_FLAGS;
    assert.equal(flagVerdict(F.EVIDENCE_STORAGE, e2eEnv({ [F.EVIDENCE_STORAGE]: "true" }), NOW).effective, true);
    for (const name of [F.EXECUTION, F.D65B_RESOLUTION]) {
      assert.equal(flagVerdict(name, e2eEnv({ [name]: "true" }), NOW).refusedBecause, "PEER_UNCONFIRMED", `${name} before payment answered`);
    }
    for (const name of [F.T0, F.LATE_OPEN_RECONCILIATION]) assert.equal(flagVerdict(name, e2eEnv({ [name]: "true" }), NOW).refusedBecause, "E2E_FLAG_NOT_PERMITTED", name);
    assert.ok(!E2E_PERMITTED_FLAGS.has(F.T0) && !E2E_PERMITTED_FLAGS.has(F.LATE_OPEN_RECONCILIATION));
    assert.equal(flagVerdict(F.EVIDENCE_STORAGE, e2eEnv({ [F.EVIDENCE_STORAGE]: "TRUE" }), NOW).effective, false);
    assert.equal(flagVerdict(F.EVIDENCE_STORAGE, e2eEnv({ [F.EVIDENCE_STORAGE]: "true", DISPUTE_E2E_COMPOSE_MARKER: undefined }), NOW).effective, false);
    assert.equal(flagVerdict(F.EVIDENCE_STORAGE, e2eEnv({ [F.EVIDENCE_STORAGE]: "true", NODE_ENV: "production" }), NOW).effective, false);
  });
});

test("peer (payment) verdict: unknown / unreachable / stale / different all mean OFF; only a fresh equal verdict agrees", () => {
  const ours = { mode: "e2e-isolated" as const, open: true };
  assert.equal(peerAgrees(ours, NOW, { status: "unknown" }).why, "PEER_UNCONFIRMED");
  assert.equal(peerAgrees(ours, NOW, { status: "unreachable", checkedAt: NOW, error: "x" }).why, "PEER_UNREACHABLE");
  assert.equal(peerAgrees(ours, NOW + PEER_MAX_AGE_MS + 1, good).why, "PEER_STALE");
  assert.equal(peerAgrees(ours, NOW, { ...good, payment: { mode: "locked", open: false } } as PeerState).why, "PEER_MISMATCH");
  assert.equal(peerAgrees(ours, NOW, { ...good, payment: { mode: "test", open: true } } as PeerState).why, "PEER_MISMATCH");
  assert.equal(peerAgrees(ours, NOW, good).agrees, true);
});

test("money flags switch ON in e2e mode only with a fresh agreeing payment verdict, and drop back OFF on mismatch", () => {
  quiet(() => {
    const now = Date.now();
    const F = DISPUTE_CASE_FLAGS;
    try {
      __setPeerState({ status: "checked", checkedAt: now, payment: { mode: "e2e-isolated", open: true } });
      for (const name of [F.EXECUTION, F.D65B_RESOLUTION]) assert.equal(flagVerdict(name, e2eEnv({ [name]: "true" })).effective, true, name);
      __setPeerState({ status: "checked", checkedAt: now, payment: { mode: "locked", open: false, refusedBecause: "E2E_MARKER_MISSING" } });
      for (const name of [F.EXECUTION, F.D65B_RESOLUTION]) assert.equal(flagVerdict(name, e2eEnv({ [name]: "true" })).refusedBecause, "PEER_MISMATCH", name);
      // evidence storage does not move money: not affected by the peer
      assert.equal(flagVerdict(F.EVIDENCE_STORAGE, e2eEnv({ [F.EVIDENCE_STORAGE]: "true" })).effective, true);
    } finally {
      __setPeerState({ status: "unknown" });
    }
  });
});

test("test mode is unchanged: NODE_ENV=test + DB_ISOLATION=accepted still works, with no peer", () => {
  const F = DISPUTE_CASE_FLAGS.EXECUTION;
  assert.equal(flagVerdict(F, { [F]: "true", NODE_ENV: "test", DB_ISOLATION: "accepted" } as any).effective, true);
  assert.equal(flagVerdict(DISPUTE_CASE_FLAGS.T0, { [DISPUTE_CASE_FLAGS.T0]: "true", NODE_ENV: "test", DB_ISOLATION: "accepted" } as any).effective, true);
});
