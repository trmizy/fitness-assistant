/**
 * db-clean N13F-01 tests - a wallet that holds money is never deleted, and a cleanup must leave the reconciliation drift exactly as it found it.
 * Evidence label: BACKEND INTEGRATION (+ TEST FIXTURE for the data) on the ISOLATED TEST container gymcoach-test-postgres-test-1 (localhost:55433),
 * databases gymcoach_<svc>_dbclean_test (the ones db-clean.test.mjs uses: run the files one after the other, `--test-concurrency=1`).
 *
 *   node --test --test-concurrency=1 scripts/db-clean/__tests__/db-clean-wallet-money.test.mjs
 *
 * W1-W3 only AUDIT (read only, no pg_hba fence): they are safe to run next to other test suites that use the same container.
 * W4 runs the real freeze -> backup -> clean pipeline, which puts the pg_hba fence up on the WHOLE test container (every other suite on it is locked out
 * for the duration): it is skipped unless DBCLEAN_RUN_FENCED_TESTS=1, to be run when nothing else uses the container.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as F from './fixtures.mjs';
import { TcpDb } from '../lib/db.mjs';
import { computeScriptVersion, staticChecks } from '../lib/manifest.mjs';
import { DRIFT_SQL, readDrift, driftProblem, walletsWithMoneyAmong, describeWalletsWithMoney } from '../lib/drift.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'db-clean.mjs');
const PW = 'Zq8mK2vLp9xT4nRw7sYc3HbG';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dbclean-wallet-'));
const CONTAINER = F.TEST_CONTAINER;
const HBA = '/var/lib/postgresql/data/pg_hba.conf';
const ALLOW = ['admin@example.com', 'john.doe@example.com'];

const cli = (args, env = {}) => {
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env: { ...process.env, DBCLEAN_MAINT_PASSWORD: PW, DBCLEAN_QUIET: '0', ...env }, maxBuffer: 1 << 28 });
  return { code: r.status, text: `${r.stdout}\n${r.stderr}` };
};
const sh = (cmd, user) => spawnSync('docker', ['exec', ...(user ? ['-u', user] : []), CONTAINER, 'sh', '-c', cmd], { encoding: 'utf8' });
const readJ = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const dir = (n) => {
  const d = path.join(TMP, `${n}-${crypto.randomBytes(3).toString('hex')}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

async function restoreHba() {
  const orig = process.env.DBCLEAN_ORIG_HBA_B64 ? Buffer.from(process.env.DBCLEAN_ORIG_HBA_B64, 'base64').toString('utf8') : null;
  if (orig) {
    spawnSync('docker', ['exec', '-i', '-u', 'postgres', CONTAINER, 'sh', '-c', `cat > ${HBA}.tmp && chmod 600 ${HBA}.tmp && mv -f ${HBA}.tmp ${HBA} && pg_ctl reload -D "$PGDATA"`], { input: orig, encoding: 'utf8' });
    await new Promise((r) => setTimeout(r, 800));
  }
  const adm = await F.client('postgres').catch(() => null);
  if (adm) {
    await adm.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename='gymini_maintenance'`).catch(() => {});
    await adm.query(`DROP ROLE IF EXISTS gymini_maintenance`).catch(() => {});
    await adm.end();
  }
}
let ORIG_HBA_SHA;
const hbaSha = () => sh(`sha256sum ${HBA}`, 'postgres').stdout.split(/\s+/)[0];
test.before(async () => {
  const r = sh(`cat ${HBA}`, 'postgres');
  assert.equal(r.status, 0, 'test container must be running');
  process.env.DBCLEAN_ORIG_HBA_B64 = Buffer.from(r.stdout).toString('base64');
  ORIG_HBA_SHA = hbaSha();
  await restoreHba();
});
test.after(async () => {
  await restoreHba();
  await F.dropDatabases();
  fs.rmSync(TMP, { recursive: true, force: true });
  assert.equal(hbaSha(), ORIG_HBA_SHA, 'pg_hba.conf back to the original');
});

async function build(extra) {
  await restoreHba();
  await F.createDatabases();
  const c = await F.seedData();
  if (extra) await extra(c);
  await F.closeAll(c);
}

function audited(name, extraArgs = []) {
  const d = dir(name);
  const al = path.join(d, 'allow.json');
  fs.writeFileSync(al, JSON.stringify({ emails: ALLOW }));
  const a = cli(['audit', '--env', 'test', '--out', d, '--allowlist', al, '--fixtures', 'scripts/partner-application-e2e', ...extraArgs]);
  return { d, a, manifest: () => readJ(path.join(d, 'cleanup-manifest.candidate.json')), metadata: () => readJ(path.join(d, 'cleanup-manifest.candidate.metadata.json')) };
}

const upd = (c, id, set) => c.payment.query(`UPDATE wallets SET ${set} WHERE id = '${id}'`);

// =====================================================================================================================
test('W1 audit: every deleted non-PLATFORM wallet that holds money in ANY bucket is a blocker naming wallet id + amounts; kept wallets, PLATFORM wallets and empty wallets are not', async () => {
  await build(async (c) => {
    await upd(c, 'w-del1', 'pending_balance = 100'); // CLIENT of a deleted account, pending only
    await upd(c, 'w-gym-del', 'locked_balance = 5'); // GYM wallet of a gym that does not survive, locked only
    await F.ins(c.payment, 'wallets', { id: 'w-pt-del', owner_type: 'PT', owner_id: F.ID.del2, holdback_balance: 7 }); // PT of a deleted account, holdback only
    await F.ins(c.payment, 'wallets', { id: 'w-pt-del0', owner_type: 'PT', owner_id: F.ID.del3 }); // empty: fine to delete
    await upd(c, 'w-keepA', 'available_balance = 999'); // kept account: stays, no blocker
    await upd(c, 'w-plat', 'available_balance = 12345'); // PLATFORM: always kept
  });
  const s = audited('w1');
  assert.equal(s.a.code, 0, s.a.text);
  const m = s.manifest();
  const money = m.blockers.deletedWalletsWithMoney;
  assert.deepEqual(money.map((w) => w.walletId), ['w-del1', 'w-gym-del', 'w-pt-del']);
  assert.deepEqual(
    money.map((w) => [w.ownerType, w.available, w.pending, w.locked, w.holdback]),
    [['CLIENT', '0.00', '100.00', '0.00', '0.00'], ['GYM', '0.00', '0.00', '5.00', '0.00'], ['PT', '0.00', '0.00', '0.00', '7.00']],
  );
  // the wallet rows themselves are still selected for deletion by the policy (the manifest says what WOULD go) - the blocker is what stops the run
  const walletKeys = m.tables.find((t) => t.db === F.db('payment') && t.table === 'wallets').keys.map((k) => k[0]);
  assert.ok(walletKeys.includes('w-del1') && walletKeys.includes('w-pt-del0') && !walletKeys.includes('w-keepA') && !walletKeys.includes('w-plat'));
  // the audit says so out loud, and the static check that freeze / clean run lists every wallet id with its amounts
  assert.match(s.a.text, /REFUSED \(N13F-01\)[^]*w-del1[^]*w-gym-del[^]*w-pt-del/);
  const problems = staticChecks(m, computeScriptVersion());
  const text = problems.join('\n');
  assert.match(text, /refusing to delete 3 wallet\(s\) that still hold money/);
  assert.match(text, /w-del1 \(CLIENT u-del-1\): available 0\.00, pending 100\.00, locked 0\.00, holdback 0\.00/);
  assert.match(text, /w-gym-del \(GYM gy-del1\)[^]*locked 5\.00/);
  assert.match(text, /w-pt-del \(PT u-del-2\)[^]*holdback 7\.00/);
  // the audit also records the reconciliation reading it saw
  assert.deepEqual(Object.keys(s.metadata().deny.guardInfo.reconciliationDriftAtAudit).sort(), ['claims', 'drift', 'escrow']);
  assert.match(s.a.text, /reconciliation at audit: escrow .* claims .* drift /);
});

test('W2 audit: no money in any deleted wallet (kept wallets and PLATFORM may hold money) -> no wallet blocker and no refusal message', async () => {
  await build(async (c) => {
    await upd(c, 'w-keepA', 'available_balance = 999');
    await upd(c, 'w-plat', 'available_balance = 12345');
    await upd(c, 'w-gym-keep', 'pending_balance = 50');
  });
  const s = audited('w2');
  assert.equal(s.a.code, 0, s.a.text);
  // (the dev schema has tables the policy does not classify yet - `unclassified` - which is a different, older blocker; only the wallet blockers matter here)
  const walletBlockers = Object.keys(s.manifest().blockers).filter((k) => k === 'deletedWalletsWithMoney' || k === 'deniedGymLiveRefs');
  assert.deepEqual(walletBlockers, [], JSON.stringify(s.manifest().blockers.deletedWalletsWithMoney));
  assert.doesNotMatch(s.a.text, /REFUSED \(N13F-01\)/);
  assert.deepEqual(staticChecks(s.manifest(), computeScriptVersion()).filter((p) => /refusing to delete/.test(p)), []);
});

test('W3 drift: the SQL is the payment-service reconciliation invariant (escrow - claims); driftProblem is exact; walletsWithMoneyAmong names balances', async () => {
  await build(async (c) => {
    await F.ins(c.payment, 'wallets', { id: 'w-escrow', owner_type: 'PLATFORM', owner_id: 'ESCROW', available_balance: 10000 });
    await F.ins(c.payment, 'wallets', { id: 'w-revenue', owner_type: 'PLATFORM', owner_id: 'REVENUE', pending_balance: 1000 });
    await upd(c, 'w-keepA', 'available_balance = 2000, pending_balance = 300, locked_balance = 40, holdback_balance = 5'); // CLIENT
    await upd(c, 'w-gym-keep', 'available_balance = 6000'); // GYM
    await F.ins(c.payment, 'wallets', { id: 'w-pt', owner_type: 'PT', owner_id: F.ID.keepB, holdback_balance: 100 });
    await upd(c, 'w-plat', 'available_balance = 777'); // a PLATFORM wallet that is neither ESCROW nor REVENUE is in neither side of the invariant
  });
  const db = await new TcpDb({ ...F.TEST, database: F.db('payment') }).connect();
  try {
    const d = await readDrift(db);
    // claims = 2000+300+40+5 (client) + 6000 (gym) + 100 (pt) + 1000 (revenue) = 9445 ; escrow = 10000 ; drift = 555
    assert.deepEqual(d, { escrow: '10000.00', claims: '9445.00', drift: '555.00' });
    assert.match(DRIFT_SQL, /'ESCROW'/);
    assert.equal(driftProblem(d, { ...d }), null);
    for (const changed of [{ escrow: '10001.00', drift: '556.00' }, { claims: '9444.00', drift: '556.00' }, { drift: '0.00' }]) {
      assert.match(driftProblem(d, { ...d, ...changed }), /reconciliation drift changed: before escrow 10000\.00 \/ claims 9445\.00 \/ drift 555\.00, after /);
    }
    assert.match(driftProblem(d, null), /could not be read/);
    // wallets with money among a set of ids: PLATFORM and empty wallets are not reported; amounts are exact text
    const hit = await walletsWithMoneyAmong(db, ['w-keepA', 'w-plat', 'w-del1', 'w-pt', 'w-escrow']);
    assert.deepEqual(hit.map((w) => [w.walletId, w.ownerType, w.available, w.pending, w.locked, w.holdback]), [
      ['w-keepA', 'CLIENT', '2000.00', '300.00', '40.00', '5.00'],
      ['w-pt', 'PT', '0.00', '0.00', '0.00', '100.00'],
    ]);
    assert.deepEqual(await walletsWithMoneyAmong(db, []), []);
    assert.match(describeWalletsWithMoney(hit), /refusing to delete 2 wallet\(s\)[^]*w-keepA \(CLIENT u-keep-admin\): available 2000\.00, pending 300\.00, locked 40\.00, holdback 5\.00[^]*w-pt \(PT u-keep-john\)/);
  } finally {
    await db.close();
  }
});

// =====================================================================================================================
// W4: the real pipeline. Fences the whole test container -> opt-in.
const FENCED = process.env.DBCLEAN_RUN_FENCED_TESTS === '1';
const seedMoneyless = async (c) => {
  await F.ins(c.payment, 'wallets', { id: 'w-escrow', owner_type: 'PLATFORM', owner_id: 'ESCROW', available_balance: 1000 });
  await upd(c, 'w-keepA', 'available_balance = 1000'); // claims 1000 = escrow 1000: drift 0, but the check is "unchanged", not "zero"
};
function approved(name) {
  const s = audited(name);
  assert.equal(s.a.code, 0, s.a.text);
  const T = fs.readFileSync(path.join(s.d, 'confirm-token.candidate.txt'), 'utf8').trim();
  const runDir = path.join(s.d, 'run');
  const ap = cli(['approve', '--env', 'test', '--manifest', path.join(s.d, 'cleanup-manifest.candidate.json'), '--confirm-token', T, '--out', runDir]);
  assert.equal(ap.code, 0, ap.text);
  const A = path.join(runDir, 'approved', 'cleanup-manifest.approved.json');
  return { ...s, T, runDir, R: ['--env', 'test', '--run-dir', runDir], M: ['--manifest', A, '--confirm-token', T] };
}
const walletCount = () => Number(sh(`PGPASSWORD=${PW} psql -At -h /var/run/postgresql -U gymini_maintenance -d ${F.db('payment')} -c "select count(*) from wallets"`).stdout.trim());

test('W4a pipeline: the reconciliation changes between the first DELETE and COMMIT -> DRIFT_CHANGED, the payment database is rolled back, the run stops', { skip: !FENCED && 'fences the whole test container: set DBCLEAN_RUN_FENCED_TESTS=1' }, async () => {
  await build(seedMoneyless);
  const s = approved('w4a');
  const run = (name, extra = [], env = {}) => cli([name, ...s.R, ...s.M, ...extra], env);
  assert.equal(run('freeze').code, 0);
  assert.equal(run('backup').code, 0);
  const walletsBefore = walletCount();
  const hook = JSON.stringify({ svc: 'payment', when: 'before-commit', sql: `UPDATE wallets SET available_balance = available_balance + 1 WHERE owner_type::text = 'PLATFORM' AND owner_id = 'ESCROW'` });
  const bad = run('clean', ['--apply'], { DBCLEAN_TEST_HOOK: hook });
  assert.equal(bad.code, 1, bad.text);
  const progress = readJ(path.join(s.runDir, 'cleanup-progress.json'));
  assert.equal(progress.dbs.payment.state, 'FAILED');
  assert.match(progress.dbs.payment.error, /reconciliation drift changed: before escrow 1000\.00 \/ claims 1000\.00 \/ drift 0\.00, after escrow 1001\.00/);
  assert.deepEqual(progress.dbs.payment.driftBefore, { escrow: '1000.00', claims: '1000.00', drift: '0.00' });
  assert.equal(walletCount(), walletsBefore, 'payment rolled back: no wallet deleted');
  assert.equal(progress.dbs.gym.state, 'PENDING', 'never continues on its own');
  assert.equal(cli(['restore', ...s.R]).code, 0);
  assert.equal(cli(['unfreeze', ...s.R]).code, 0);
  assert.equal(hbaSha(), ORIG_HBA_SHA);
});

test('W4b pipeline: a deleted wallet that receives money after the audit is refused INSIDE the payment transaction (WALLET_WITH_MONEY), nothing is deleted', { skip: !FENCED && 'fences the whole test container: set DBCLEAN_RUN_FENCED_TESTS=1' }, async () => {
  await build(seedMoneyless);
  const s = approved('w4b');
  const run = (name, extra = [], env = {}) => cli([name, ...s.R, ...s.M, ...extra], env);
  assert.equal(run('freeze').code, 0);
  assert.equal(run('backup').code, 0);
  const walletsBefore = walletCount();
  const hook = JSON.stringify({ svc: 'payment', when: 'after-verify', sql: `UPDATE wallets SET pending_balance = 5 WHERE id = 'w-del1'` });
  const bad = run('clean', ['--apply'], { DBCLEAN_TEST_HOOK: hook });
  assert.equal(bad.code, 1, bad.text);
  const progress = readJ(path.join(s.runDir, 'cleanup-progress.json'));
  assert.equal(progress.dbs.payment.state, 'FAILED');
  assert.match(progress.dbs.payment.error, /refusing to delete 1 wallet\(s\) that still hold money[^]*w-del1 \(CLIENT u-del-1\): available 0\.00, pending 5\.00/);
  assert.equal(walletCount(), walletsBefore, 'nothing deleted');
  assert.equal(cli(['restore', ...s.R]).code, 0);
  assert.equal(cli(['unfreeze', ...s.R]).code, 0);
  assert.equal(hbaSha(), ORIG_HBA_SHA);
});
