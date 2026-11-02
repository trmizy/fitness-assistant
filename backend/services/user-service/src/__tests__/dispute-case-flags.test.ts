/**
 * DISPUTE CASE slice 2 - the fail-closed feature flags (pure logic, NO database: runs in both modes of npm test).
 * Evidence label: CODE-LEVEL UNIT TEST of src/services/dispute-case/flags.ts.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { __resetFlagWarnings, flagVerdict, DISPUTE_CASE_FLAGS } from "../services/dispute-case/flags";

test("flag: effective ONLY with value 'true' AND NODE_ENV=test AND DB_ISOLATION=accepted; every other combination is OFF (and the mistake is warned about once)", () => {
  const F = DISPUTE_CASE_FLAGS.EXECUTION;
  const ok = { [F]: "true", NODE_ENV: "test", DB_ISOLATION: "accepted" } as NodeJS.ProcessEnv;
  assert.equal(flagVerdict(F, ok).effective, true);
  const warnings: string[] = [];
  const realWarn = console.warn;
  console.warn = (m: unknown) => warnings.push(String(m));
  try {
    __resetFlagWarnings();
    for (const [label, env] of [
      ["value unset", { ...ok, [F]: undefined }],
      ["value TRUE", { ...ok, [F]: "TRUE" }],
      ["value 1", { ...ok, [F]: "1" }],
      ["value 'true '", { ...ok, [F]: "true " }],
      ["NODE_ENV production", { ...ok, NODE_ENV: "production" }],
      ["NODE_ENV unset", { ...ok, NODE_ENV: undefined }],
      ["NODE_ENV development", { ...ok, NODE_ENV: "development" }],
      ["DB_ISOLATION refused", { ...ok, DB_ISOLATION: "refused" }],
      ["DB_ISOLATION unset", { ...ok, DB_ISOLATION: undefined }],
    ] as Array<[string, NodeJS.ProcessEnv]>) {
      assert.equal(flagVerdict(F, env).effective, false, label);
    }
    assert.equal(flagVerdict(F, { ...ok, NODE_ENV: "production" }).refusedBecause, "NOT_TEST_ENV");
    assert.equal(flagVerdict(F, { ...ok, DB_ISOLATION: "refused" }).refusedBecause, "DB_ISOLATION_NOT_ACCEPTED");
  } finally {
    console.warn = realWarn;
  }
  assert.ok(warnings.length >= 2 && warnings.every((w) => /IGNORED/.test(w)), warnings.join("|"));
  assert.equal(warnings.filter((w) => /NODE_ENV is not/.test(w)).length, 1, "warned once per flag and reason, not on every call");
  // the other two flags use the very same rule
  for (const name of [DISPUTE_CASE_FLAGS.T0, DISPUTE_CASE_FLAGS.EVIDENCE_STORAGE, DISPUTE_CASE_FLAGS.LATE_OPEN_RECONCILIATION, DISPUTE_CASE_FLAGS.D65B_RESOLUTION]) {
    assert.equal(flagVerdict(name, { [name]: "true", NODE_ENV: "test", DB_ISOLATION: "accepted" } as any).effective, true);
    assert.equal(flagVerdict(name, { [name]: "true", NODE_ENV: "production", DB_ISOLATION: "accepted" } as any).effective, false);
    assert.equal(flagVerdict(name, { [name]: "true", NODE_ENV: "test" } as any).effective, false);
  }
});
