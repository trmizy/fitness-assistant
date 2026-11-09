/**
 * Dispute runtime gate (e2e-isolated mode) - pure logic, NO database, fail-closed for every misconfiguration.
 * Evidence label: CODE-LEVEL UNIT TEST of runtime-gate.ts / flags.ts / payment-peer.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { DISPUTE_CASE_FLAGS, E2E_PERMITTED_FLAGS, DEV_SHARED_PERMITTED_FLAGS, flagVerdict, gateVerdict, __resetFlagWarnings } from "../services/dispute-case/flags";
import { evaluateRuntimeGate, MARKER_VALUE, DEV_MARKER_VALUE, DEV_DB_ALLOWLIST } from "../services/dispute-case/runtime-gate";
import { peerAgrees, startPeerVerdictMonitor, __setPeerState, PEER_MAX_AGE_MS, type PeerState } from "../services/dispute-case/payment-peer";

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
    // A1 appeal and A4 replacement (owner decision 04/11): allowed in the isolated E2E env, never with NODE_ENV=production.
    for (const name of [F.APPEALS, F.DECISION_REPLACEMENT]) {
      assert.equal(flagVerdict(name, e2eEnv({ [name]: "true" }), NOW).effective, true, `${name} in e2e`);
      assert.equal(flagVerdict(name, e2eEnv({ [name]: "true", NODE_ENV: "production" }), NOW).effective, false, `${name} in production`);
    }
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

// ───────────────────────── dev-shared mode (docker-compose.dispute-dev.yml, owner approval 09/11/2026) ─────────────────────────
const devEnv = (over: Record<string, string | undefined> = {}): NodeJS.ProcessEnv =>
  ({
    NODE_ENV: "development",
    DISPUTE_RUNTIME_MODE: "dev-shared",
    DISPUTE_DEV_COMPOSE_MARKER: DEV_MARKER_VALUE,
    DATABASE_URL: "postgresql://u:pw@postgres:5432/gymcoach_user",
    ...over,
  }) as NodeJS.ProcessEnv;
const devGood: PeerState = { status: "checked", checkedAt: NOW, payment: { mode: "dev-shared", open: true } };

test("dev-shared gate opens ONLY when mode + NODE_ENV + dev marker + hard-coded DB allowlist all hold", () => {
  const ok = evaluateRuntimeGate(devEnv(), false);
  assert.equal(ok.mode, "dev-shared");
  assert.equal(ok.open, true);
  assert.equal(ok.refusedBecause, undefined);
  for (const db of ["gymcoach_user", "gymcoach_payment", "gymcoach_gym"]) assert.equal(evaluateRuntimeGate(devEnv({ DATABASE_URL: `postgresql://u:pw@h/${db}` }), false).open, true, db);
  assert.deepEqual([...DEV_DB_ALLOWLIST], ["gymcoach_user", "gymcoach_payment", "gymcoach_gym"]);
  assert.notEqual(DEV_MARKER_VALUE, MARKER_VALUE, "the dev marker must not equal the e2e marker");
  const closed: Array<[string, NodeJS.ProcessEnv, string]> = [
    ["mode missing", devEnv({ DISPUTE_RUNTIME_MODE: undefined }), "NOT_TEST_ENV"],
    ["mode typo", devEnv({ DISPUTE_RUNTIME_MODE: "Dev-shared" }), "NOT_TEST_ENV"],
    ["mode is something else", devEnv({ DISPUTE_RUNTIME_MODE: "dev" }), "NOT_TEST_ENV"],
    ["marker missing", devEnv({ DISPUTE_DEV_COMPOSE_MARKER: undefined }), "DEV_MARKER_MISSING"],
    ["marker wrong", devEnv({ DISPUTE_DEV_COMPOSE_MARKER: "yes" }), "DEV_MARKER_MISSING"],
    ["e2e marker used instead of the dev marker", devEnv({ DISPUTE_DEV_COMPOSE_MARKER: MARKER_VALUE }), "DEV_MARKER_MISSING"],
    ["e2e marker variable set, dev marker missing", devEnv({ DISPUTE_DEV_COMPOSE_MARKER: undefined, DISPUTE_E2E_COMPOSE_MARKER: MARKER_VALUE }), "DEV_MARKER_MISSING"],
    ["production", devEnv({ NODE_ENV: "production" }), "DEV_NODE_ENV_NOT_ALLOWED"],
    ["NODE_ENV unset", devEnv({ NODE_ENV: undefined }), "DEV_NODE_ENV_NOT_ALLOWED"],
    ["NODE_ENV empty", devEnv({ NODE_ENV: "" }), "DEV_NODE_ENV_NOT_ALLOWED"],
    ["db gymcoach_user_prod", devEnv({ DATABASE_URL: "postgresql://u:pw@h/gymcoach_user_prod" }), "DEV_DB_NOT_ALLOWLISTED"],
    ["db gymcoach_user_e2e", devEnv({ DATABASE_URL: "postgresql://u:pw@h/gymcoach_user_e2e" }), "DEV_DB_NOT_ALLOWLISTED"],
    ["db gymini_user_e2e", devEnv({ DATABASE_URL: "postgresql://u:pw@h/gymini_user_e2e" }), "DEV_DB_NOT_ALLOWLISTED"],
    ["db of another dev service (auth)", devEnv({ DATABASE_URL: "postgresql://u:pw@h/gymcoach_auth" }), "DEV_DB_NOT_ALLOWLISTED"],
    ["db name in another case", devEnv({ DATABASE_URL: "postgresql://u:pw@h/GYMCOACH_USER" }), "DEV_DB_NOT_ALLOWLISTED"],
    ["db unset", devEnv({ DATABASE_URL: undefined }), "DEV_DB_NOT_ALLOWLISTED"],
    ["DATABASE_URL garbage", devEnv({ DATABASE_URL: "not a url" }), "DEV_DB_NOT_ALLOWLISTED"],
    // an allowlist taken from the environment must be ignored: the dev list is hard-coded in the code
    ["env-provided allowlist (dev var) ignored", devEnv({ DATABASE_URL: "postgresql://u:pw@h/other_db", DISPUTE_DEV_DB_ALLOWLIST: "other_db" }), "DEV_DB_NOT_ALLOWLISTED"],
    ["env-provided allowlist (e2e var) ignored", devEnv({ DATABASE_URL: "postgresql://u:pw@h/other_db", DISPUTE_E2E_DB_ALLOWLIST: "other_db" }), "DEV_DB_NOT_ALLOWLISTED"],
  ];
  for (const [label, env, why] of closed) {
    const v = evaluateRuntimeGate(env, false);
    assert.equal(v.open, false, label);
    assert.equal(v.mode, "locked", label);
    assert.equal(v.refusedBecause, why, label);
  }
  // NODE_ENV=test is the test mode only: the dev-shared variables do not turn it into the dev mode
  const t = evaluateRuntimeGate(devEnv({ NODE_ENV: "test" }), false);
  assert.equal(t.mode, "test");
  assert.equal(t.open, false);
  assert.equal(evaluateRuntimeGate(devEnv({ NODE_ENV: "test" }), true).mode, "test");
  // the dev marker alone does not open the e2e mode, and the e2e variables alone do not open the dev mode
  assert.equal(evaluateRuntimeGate(e2eEnv({ DISPUTE_DEV_COMPOSE_MARKER: DEV_MARKER_VALUE, DATABASE_URL: "postgresql://u:pw@h/gymcoach_user", DISPUTE_E2E_DB_ALLOWLIST: "gymcoach_user" }), false).open, false);
  assert.equal(evaluateRuntimeGate(e2eEnv({ DISPUTE_RUNTIME_MODE: "dev-shared" }), false).open, false);
});

test("flags in dev-shared mode: the permitted list only; T0 and late-open stay OFF even when set to true", () => {
  quiet(() => {
    __resetFlagWarnings();
    const F = DISPUTE_CASE_FLAGS;
    assert.deepEqual([...DEV_SHARED_PERMITTED_FLAGS].sort(), [...E2E_PERMITTED_FLAGS].sort());
    assert.ok(!DEV_SHARED_PERMITTED_FLAGS.has(F.T0) && !DEV_SHARED_PERMITTED_FLAGS.has(F.LATE_OPEN_RECONCILIATION));
    const now = Date.now();
    __setPeerState({ status: "checked", checkedAt: now, payment: { mode: "dev-shared", open: true } });
    try {
      for (const name of [F.EXECUTION, F.EVIDENCE_STORAGE, F.D65B_RESOLUTION, F.TIMERS, F.APPEALS, F.DECISION_REPLACEMENT]) {
        assert.equal(flagVerdict(name, devEnv({ [name]: "true" }), now).effective, true, `${name} in dev-shared`);
        assert.equal(flagVerdict(name, devEnv({ [name]: "true", NODE_ENV: "production" }), now).effective, false, `${name} in production`);
        assert.equal(flagVerdict(name, devEnv({ [name]: "true", DISPUTE_DEV_COMPOSE_MARKER: undefined }), now).effective, false, `${name} without marker`);
        assert.equal(flagVerdict(name, devEnv({ [name]: "TRUE" }), now).effective, false, `${name} value TRUE`);
        assert.equal(flagVerdict(name, devEnv({ [name]: "true", DATABASE_URL: "postgresql://u:pw@h/gymcoach_user_prod" }), now).effective, false, `${name} wrong DB`);
      }
      for (const name of [F.T0, F.LATE_OPEN_RECONCILIATION]) {
        const v = flagVerdict(name, devEnv({ [name]: "true" }), now);
        assert.equal(v.effective, false, name);
        assert.equal(v.refusedBecause, "DEV_FLAG_NOT_PERMITTED", name);
      }
    } finally {
      __setPeerState({ status: "unknown" });
    }
  });
});

test("dev-shared: money flags need a fresh agreeing payment verdict; mismatch / unknown / stale / unreachable lock them, evidence storage is not peer-gated", () => {
  quiet(() => {
    const F = DISPUTE_CASE_FLAGS;
    const now = Date.now();
    try {
      __setPeerState({ status: "unknown" });
      for (const name of [F.EXECUTION, F.D65B_RESOLUTION]) assert.equal(flagVerdict(name, devEnv({ [name]: "true" }), now).refusedBecause, "PEER_UNCONFIRMED", name);
      __setPeerState({ status: "checked", checkedAt: now, payment: { mode: "dev-shared", open: true } });
      for (const name of [F.EXECUTION, F.D65B_RESOLUTION]) assert.equal(flagVerdict(name, devEnv({ [name]: "true" }), now).effective, true, name);
      // payment-service locked, or in another mode (e2e / test): everything that moves money locks
      for (const payment of [{ mode: "locked", open: false, refusedBecause: "DEV_MARKER_MISSING" }, { mode: "e2e-isolated", open: true }, { mode: "test", open: true }]) {
        __setPeerState({ status: "checked", checkedAt: now, payment });
        for (const name of [F.EXECUTION, F.D65B_RESOLUTION]) assert.equal(flagVerdict(name, devEnv({ [name]: "true" }), now).refusedBecause, "PEER_MISMATCH", `${name} vs ${payment.mode}`);
        assert.equal(flagVerdict(F.EVIDENCE_STORAGE, devEnv({ [F.EVIDENCE_STORAGE]: "true" }), now).effective, true);
      }
      __setPeerState({ status: "checked", checkedAt: now - PEER_MAX_AGE_MS - 1, payment: { mode: "dev-shared", open: true } });
      assert.equal(flagVerdict(F.EXECUTION, devEnv({ [F.EXECUTION]: "true" }), now).refusedBecause, "PEER_STALE");
      __setPeerState({ status: "unreachable", checkedAt: now, error: "x" });
      assert.equal(flagVerdict(F.EXECUTION, devEnv({ [F.EXECUTION]: "true" }), now).refusedBecause, "PEER_UNREACHABLE");
    } finally {
      __setPeerState({ status: "unknown" });
    }
    assert.equal(peerAgrees({ mode: "dev-shared", open: true }, NOW, devGood).agrees, true);
    assert.equal(peerAgrees({ mode: "dev-shared", open: true }, NOW, good).why, "PEER_MISMATCH");
    assert.equal(peerAgrees({ mode: "e2e-isolated", open: true }, NOW, devGood).why, "PEER_MISMATCH");
  });
});

test("dev-shared: the capabilities runtime block (gateVerdict) reports dev-shared; the peer monitor does nothing while the gate is closed", () => {
  assert.equal(gateVerdict(devEnv()).mode, "dev-shared");
  assert.equal(gateVerdict(devEnv()).open, true);
  assert.equal(gateVerdict(devEnv({ NODE_ENV: "production" })).mode, "locked");
  // closed gate: no timer, no outbound call
  startPeerVerdictMonitor(devEnv({ DISPUTE_DEV_COMPOSE_MARKER: undefined }))();
});
