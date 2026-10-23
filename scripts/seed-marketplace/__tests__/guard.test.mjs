import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { assertSeedAllowed, readMarker, resolveTarget, SeedGuardError } from "../lib/guard.mjs";
import { assertEmptyBusinessTables, checkFreshTarget } from "../lib/preflight.mjs";

const dbs = (suffix) => ({ auth: `gymcoach_auth_${suffix}`, user: `gymcoach_user_${suffix}`, gym: `gymcoach_gym_${suffix}`, payment: `gymcoach_payment_${suffix}` });
const dev = (over = {}) => ({ host: "localhost", port: 5433, dbs: { auth: "gymcoach_auth", user: "gymcoach_user", gym: "gymcoach_gym", payment: "gymcoach_payment" }, ...over });
const test_ = (over = {}) => ({ host: "localhost", port: 55433, dbs: dbs("seed_test"), ...over });
const refuses = (fn, code) => assert.throws(fn, (e) => e instanceof SeedGuardError && e.code === code, `expected ${code}`);

test('fresh targets all seven seedrun DBs and refuses nonlocal or mismatched names', () => {
  const target = resolveTarget({ kind: 'fresh', env: {} });
  assert.equal(Object.keys(target.dbs).length, 7);
  assert.equal(assertSeedAllowed(target, { env: {} }).requiresEmptyCheck, true);
  refuses(() => assertSeedAllowed({ ...target, host: 'remote.example' }, { env: {} }), 'HOST_NOT_ALLOWED');
  refuses(() => assertSeedAllowed({ ...target, dbs: { ...target.dbs, user: 'gymcoach_user_e' } }, { env: {} }), 'DB_NOT_ALLOWLISTED');
});

test('fresh emptiness excludes only migration/reference rows; any business row refuses', () => {
  assertEmptyBusinessTables({ 'gym._prisma_migrations': 20, 'gym.amenities': 18, 'user.vietnam_provinces': 34, 'auth.users': 0 });
  refuses(() => assertEmptyBusinessTables({ 'auth.users': 1 }), 'FRESH_NOT_EMPTY');
  refuses(() => assertEmptyBusinessTables({ 'fitness.workouts': 1 }), 'FRESH_NOT_EMPTY');
  refuses(() => assertEmptyBusinessTables({ 'ai.chat_history': 1 }), 'FRESH_NOT_EMPTY');
});

test('fresh reseed requires a matching prior empty-check receipt', async () => {
  const target = resolveTarget({ kind: 'fresh', env: {} });
  const pools = Object.fromEntries(Object.keys(target.dbs).map(s => [s, { query: async sql => ({ rows: sql.includes('FROM wallets') ? [{ n: 0 }] : [] }) }]));
  const receiptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-receipt-'));
  try {
    await assert.rejects(checkFreshTarget(target, pools, { reseed: true, receiptDir }), e => e.code === 'FRESH_RECEIPT_REQUIRED');
    await checkFreshTarget(target, pools, { receiptDir });
    await checkFreshTarget(target, pools, { reseed: true, receiptDir });
    await assert.rejects(checkFreshTarget({ ...target, port: 9999 }, pools, { reseed: true, receiptDir }), e => e.code === 'FRESH_RECEIPT_REQUIRED');
  } finally { fs.rmSync(receiptDir, { recursive: true }); }
});

test('partner requires explicit confirmation and refuses production', () => {
  const target = resolveTarget({ kind: 'partner', env: {} });
  refuses(() => assertSeedAllowed(target, { env: {} }), 'CONFIRM_MISSING');
  assert.equal(assertSeedAllowed(target, { env: { SEED_MARKETPLACE_CONFIRM: 'partner' } }).kind, 'partner');
  refuses(() => assertSeedAllowed(target, { env: { NODE_ENV: 'production', SEED_MARKETPLACE_CONFIRM: 'partner' } }), 'PRODUCTION_REFUSED');
});

function marker(valid = true) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "marker-"));
  const p = path.join(dir, "verify-clean.ok");
  fs.writeFileSync(p, valid ? `confirmToken=${"a".repeat(64)}\nwrittenAt=2026-10-24T10:00:00Z\n` : "ok");
  return p;
}

test("test DB (*_test): runs without any marker", () => {
  assert.equal(assertSeedAllowed(test_(), { env: {}, markerPath: null }).kind, "test");
});
test("test DB: the repo's shared gymcoach_<svc>_test DBs are refused unless explicitly allowed", () => {
  const shared = test_({ dbs: dbs("test") });
  refuses(() => assertSeedAllowed(shared, { env: {} }), "SHARED_TEST_DB");
  assert.equal(assertSeedAllowed(shared, { env: {}, allowSharedTestDb: true }).kind, "test");
});
test("dev DB without the marker: refused", () => {
  refuses(() => assertSeedAllowed(dev(), { env: { SEED_MARKETPLACE_CONFIRM: "dev" }, markerPath: null }), "MARKER_MISSING");
});
test("dev DB with an invalid marker (no token/time): refused", () => {
  refuses(() => assertSeedAllowed(dev(), { env: { SEED_MARKETPLACE_CONFIRM: "dev" }, markerPath: marker(false) }), "MARKER_MISSING");
});
test("dev DB with marker but without SEED_MARKETPLACE_CONFIRM=dev: refused", () => {
  refuses(() => assertSeedAllowed(dev(), { env: {}, markerPath: marker() }), "CONFIRM_MISSING");
  refuses(() => assertSeedAllowed(dev(), { env: { SEED_MARKETPLACE_CONFIRM: "yes" }, markerPath: marker() }), "CONFIRM_MISSING");
});
test("dev DB with marker + confirm: runs; already seeded needs --reseed", () => {
  const env = { SEED_MARKETPLACE_CONFIRM: "dev" };
  const m = marker();
  assert.equal(assertSeedAllowed(dev(), { env, markerPath: m }).kind, "dev");
  refuses(() => assertSeedAllowed(dev(), { env, markerPath: m, seedDataPresent: true }), "RESEED_REQUIRED");
  assert.equal(assertSeedAllowed(dev(), { env, markerPath: m, seedDataPresent: true, reseed: true }).kind, "dev");
});
test("NODE_ENV=production is refused for every target", () => {
  refuses(() => assertSeedAllowed(test_(), { env: { NODE_ENV: "production" } }), "PRODUCTION_REFUSED");
  refuses(() => assertSeedAllowed(dev(), { env: { NODE_ENV: "Production", SEED_MARKETPLACE_CONFIRM: "dev" }, markerPath: marker() }), "PRODUCTION_REFUSED");
});
test("database names outside the allowlist or containing prod/staging/live are refused", () => {
  refuses(() => assertSeedAllowed(test_({ dbs: { ...dbs("seed_test"), user: "gymcoach_user_prod_test" } }), { env: {} }), "FORBIDDEN_DB_NAME");
  refuses(() => assertSeedAllowed(test_({ dbs: { ...dbs("seed_test"), gym: "gymcoach_gym_staging" } }), { env: {} }), "FORBIDDEN_DB_NAME");
  refuses(() => assertSeedAllowed(test_({ dbs: { ...dbs("seed_test"), auth: "gymcoach_auth_live_test" } }), { env: {} }), "FORBIDDEN_DB_NAME");
  refuses(() => assertSeedAllowed(test_({ dbs: { ...dbs("seed_test"), auth: "postgres" } }), { env: {} }), "DB_NOT_ALLOWLISTED");
  refuses(() => assertSeedAllowed(test_({ dbs: { ...dbs("seed_test"), payment: "gymcoach_payment_dev_backup" } }), { env: {} }), "DB_NOT_ALLOWLISTED");
  refuses(() => assertSeedAllowed(test_({ dbs: { ...dbs("seed_test"), user: "gymcoach_gym_seed_test" } }), { env: {} }), "DB_SERVICE_MISMATCH");
});
test("mixing test and dev databases is refused", () => {
  refuses(() => assertSeedAllowed(test_({ dbs: { ...dbs("seed_test"), auth: "gymcoach_auth" } }), { env: {}, markerPath: marker() }), "DB_NOT_ALLOWLISTED");
});
test("non-local hosts are refused", () => {
  refuses(() => assertSeedAllowed(test_({ host: "db.example.com" }), { env: {} }), "HOST_NOT_ALLOWED");
  refuses(() => assertSeedAllowed(dev({ host: "10.0.0.5" }), { env: { SEED_MARKETPLACE_CONFIRM: "dev" }, markerPath: marker() }), "HOST_NOT_ALLOWED");
});
test("dev port must be 5433 on localhost (5432 inside the compose network)", () => {
  refuses(() => assertSeedAllowed(dev({ port: 5432 }), { env: { SEED_MARKETPLACE_CONFIRM: "dev" }, markerPath: marker() }), "HOST_NOT_ALLOWED");
  assert.equal(assertSeedAllowed(dev({ host: "gymcoach-postgres", port: 5432 }), { env: { SEED_MARKETPLACE_CONFIRM: "dev" }, markerPath: marker() }).kind, "dev");
});
test("readMarker accepts only a file with a 64-hex token and a timestamp", () => {
  assert.equal(readMarker(marker()).valid, true);
  assert.equal(readMarker(marker(false)).valid, false);
  assert.equal(readMarker("D:\\does\\not\\exist.ok"), null);
});
test("resolveTarget builds the dedicated seed_test names on the test container by default", () => {
  const t = resolveTarget({ kind: "test", env: {} });
  assert.equal(t.port, 55433);
  assert.deepEqual(Object.values(t.dbs), ["gymcoach_auth_seed_test", "gymcoach_user_seed_test", "gymcoach_gym_seed_test", "gymcoach_payment_seed_test"]);
});
