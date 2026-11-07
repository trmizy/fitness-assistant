/**
 * Gym complaint CASE -> REAL refundByAdmin -> REAL payment-service ledger (cross-service acceptance).
 *
 * Evidence label: BACKEND INTEGRATION (cross-service). REAL: gym-service's Express app + services run in THIS process; payment-service runs as its own OS
 * process (real Express app, real ledger code) on the isolated gymcoach_payment_*_test database; every gym -> payment call is a real HTTP request with the
 * internal secret; payment -> gym (activate-after-payment) is a real HTTP request too; the membership is really bought through membershipService.purchase.
 * The Case workflow (open -> assess -> finding -> proposal -> four-eyes -> execute) is the real code over real HTTP. TEST FIXTURE: gym / partner / brand /
 * plan rows, the auth-service token table, the VNPay gateway IPN (signed with the same HMAC secret the payment child is configured with: the gateway is the
 * one party that cannot run here), the referral row of the pt-referral scenario, the crash seams of the executor. No product money rule is changed or
 * asserted from the code under test: expectations are EQUALITY with what the payment ledger itself says (wallet rows, ledger entries, escrow invariant).
 *
 * Opt-in; run ALONE (spawns payment-service, TRUNCATEs its ledger tables):
 *   RUN_CROSS_SERVICE_MONEY=1 TEST_DATABASE_URL="...gymcoach_gym_<x>_test?schema=public" E2E_PAYMENT_DATABASE_URL="...gymcoach_payment_<x>_test?schema=public" \
 *   FITNESS_DISABLE_REDIS=true ./node_modules/.bin/tsx --import ./src/__tests__/setup/db-isolation.ts --test --test-concurrency=1 src/__tests__/complaint-case-money.e2e.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto, { randomUUID } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { Client } from 'pg';
import { isTestDatabaseUrl } from './test-db-guard';
import { registerTestService } from './setup/outbound-guard';

const PAYMENT_DB_URL = process.env.E2E_PAYMENT_DATABASE_URL ?? '';
const usable =
  process.env.RUN_CROSS_SERVICE_MONEY === '1' &&
  process.env.DB_ISOLATION === 'accepted' &&
  isTestDatabaseUrl(process.env.DATABASE_URL) &&
  isTestDatabaseUrl(PAYMENT_DB_URL) &&
  (process.env.DATABASE_URL ?? '').split('?')[0] !== PAYMENT_DB_URL.split('?')[0];
const skip: string | false = usable ? false : 'Opt-in suite: set RUN_CROSS_SERVICE_MONEY=1, TEST_DATABASE_URL (gym) and E2E_PAYMENT_DATABASE_URL pointing at DIFFERENT *_test databases. It spawns payment-service and TRUNCATEs its ledger tables.';

const SECRET = `e2e-internal-secret-${crypto.randomBytes(8).toString('hex')}`;
const VNPAY_TMN = 'E2ETEST';
const VNPAY_HASH_SECRET = `e2e-vnpay-hash-${crypto.randomBytes(8).toString('hex')}`;
const DEAD = 'http://127.0.0.1:9';
const PAYMENT_DIR = path.resolve(__dirname, '../../../payment-service');
const PRICE = 300_000;
const DAYS = 30;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}
function killTree(child: ChildProcess | null) {
  if (!child || child.pid == null || child.exitCode !== null) return;
  try {
    if (process.platform === 'win32') execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else child.kill('SIGKILL');
  } catch {
    /* already gone */
  }
}

let payUrl = '';
let gymUrl = '';
let child: ChildProcess | null = null;
let payDb: Client;
let H: Awaited<typeof import('./complaint-case.test-helpers')>;
let svc: {
  prisma: typeof import('../repositories/prisma').prisma;
  membershipService: typeof import('../services/membership.service').membershipService;
  paymentClient: typeof import('../clients/payment.client').paymentClient;
  exec: typeof import('../services/complaint-case/execution.service').complaintCaseExecutionService;
  defaultExecDeps: typeof import('../services/complaint-case/execution.service').defaultExecDeps;
};
const log: string[] = [];

const num = (v: unknown) => Number(v ?? 0);
async function q<T = any>(sql: string, params: unknown[] = []): Promise<T[]> {
  return (await payDb.query(sql, params)).rows as T[];
}
async function wallet(ownerType: string, ownerId: string) {
  const r = await q(`SELECT available_balance::text AS a, pending_balance::text AS p FROM wallets WHERE owner_type = $1::"WalletOwnerType" AND owner_id = $2`, [ownerType, ownerId]);
  return r[0] ? { a: num(r[0].a), p: num(r[0].p) } : { a: 0, p: 0 };
}
async function invariant(context: string) {
  const rows = await q(
    `SELECT owner_type::text AS owner_type, CASE WHEN owner_type = 'PLATFORM' THEN owner_id ELSE '' END AS owner_id,
            SUM(pending_balance)::text AS p, SUM(available_balance)::text AS a, SUM(locked_balance)::text AS l, SUM(holdback_balance)::text AS h
       FROM wallets GROUP BY 1, 2`,
  );
  let claims = 0;
  let escrow = 0;
  for (const r of rows) {
    if (r.owner_type === 'PLATFORM' && r.owner_id === 'ESCROW') escrow = num(r.a);
    else claims += num(r.a) + num(r.p) + num(r.l) + num(r.h);
  }
  const negative = await q(`SELECT owner_type::text, owner_id FROM wallets WHERE available_balance < 0 OR pending_balance < 0 OR locked_balance < 0 OR holdback_balance < 0`);
  const drift = Math.round((escrow - claims) * 100) / 100;
  assert.ok(drift === 0 && negative.length === 0, `Money invariant violated (${context}): escrow=${escrow} claims=${claims} drift=${drift} negative=${JSON.stringify(negative)}`);
}
async function ledgerOps(like: string) {
  return (await q(`SELECT key FROM ledger_operations WHERE key LIKE $1 ORDER BY key`, [like])).map((r) => r.key as string);
}

function signedVnpayQuery(txnRef: string, amountVnd: number): string {
  const params: Record<string, string> = {
    vnp_Amount: String(Math.round(amountVnd) * 100),
    vnp_BankCode: 'NCB',
    vnp_ResponseCode: '00',
    vnp_TmnCode: VNPAY_TMN,
    vnp_TransactionNo: String(Math.floor(10_000_000 + Math.random() * 89_999_999)),
    vnp_TransactionStatus: '00',
    vnp_TxnRef: txnRef,
  };
  const enc = (s: string) => encodeURIComponent(s).replace(/%20/g, '+');
  const query = Object.keys(params)
    .sort()
    .map((k) => `${enc(k)}=${enc(params[k])}`)
    .join('&');
  const sig = crypto.createHmac('sha512', VNPAY_HASH_SECRET).update(Buffer.from(query, 'utf-8')).digest('hex');
  return `${query}&vnp_SecureHash=${sig}`;
}

async function waitHealthy(timeoutMs = 60_000) {
  const t0 = Date.now();
  for (;;) {
    if (child && child.exitCode !== null) throw new Error(`payment-service exited early (${child.exitCode}):\n${log.slice(-30).join('')}`);
    try {
      if ((await fetch(`${payUrl}/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`payment-service not healthy after ${timeoutMs}ms:\n${log.slice(-30).join('')}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

test.before(async () => {
  if (skip) return;
  const payPort = await freePort();
  payUrl = `http://127.0.0.1:${payPort}`;
  // configuration BEFORE any gym-service module is loaded (payment.client captures PAYMENT_SERVICE_URL / the secret at import time)
  process.env.NODE_ENV = 'test';
  process.env.GYM_COMPLAINT_CASE_ENABLED = 'true';
  process.env.PAYMENT_SERVICE_URL = payUrl;
  process.env.INTERNAL_SERVICE_SECRET = SECRET;
  process.env.INTERNAL_API_SECRET = SECRET;
  process.env.FITNESS_DISABLE_REDIS = 'true';
  delete process.env.PAYMENT_LAMBDA_NAME;
  registerTestService(payUrl);
  registerTestService(DEAD);

  H = await import('./complaint-case.test-helpers');
  H.installStubs();
  const base = await H.startApp(); // real gym app in this process; the payment child calls it back to activate memberships
  gymUrl = base;
  svc = {
    prisma: (await import('../repositories/prisma')).prisma,
    membershipService: (await import('../services/membership.service')).membershipService,
    paymentClient: (await import('../clients/payment.client')).paymentClient,
    exec: (await import('../services/complaint-case/execution.service')).complaintCaseExecutionService,
    defaultExecDeps: (await import('../services/complaint-case/execution.service')).defaultExecDeps,
  };

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    PORT: String(payPort),
    DATABASE_URL: PAYMENT_DB_URL,
    INTERNAL_SERVICE_SECRET: SECRET,
    INTERNAL_API_SECRET: SECRET,
    USER_SERVICE_URL: DEAD,
    GYM_SERVICE_URL: gymUrl,
    AI_SERVICE_URL: DEAD,
    AUTH_SERVICE_URL: DEAD,
    USER_LAMBDA_NAME: '',
    GYM_LAMBDA_NAME: '',
    AI_LAMBDA_NAME: '',
    PAYMENT_PROVIDER: 'VNPAY',
    VNPAY_TMN_CODE: VNPAY_TMN,
    VNPAY_HASH_SECRET: VNPAY_HASH_SECRET,
    VNPAY_SIMULATE: 'false',
    FITNESS_DISABLE_REDIS: 'true',
  };
  child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], { cwd: PAYMENT_DIR, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const keep = (b: Buffer) => {
    log.push(b.toString());
    if (log.length > 400) log.shift();
  };
  child.stdout!.on('data', keep);
  child.stderr!.on('data', keep);
  process.on('exit', () => killTree(child));
  await waitHealthy();
  payDb = new Client({ connectionString: PAYMENT_DB_URL.split('?')[0] });
  await payDb.connect();
});
test.after(async () => {
  if (skip) return;
  delete process.env.GYM_COMPLAINT_CASE_ENABLED;
  killTree(child);
  await payDb?.end().catch(() => {});
  H.removeStubs();
  await H.cleanup().catch(() => {});
  await H.stopApp();
  await svc.prisma.$disconnect();
});
test.beforeEach(async () => {
  if (skip) return;
  await payDb.query('TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations RESTART IDENTITY CASCADE');
});
test.afterEach(async () => {
  if (skip) return;
  await H.cleanup();
});

/** A membership the client really PAYS for: purchase -> real checkout in payment-service -> signed gateway IPN (fixture) -> real activation callback. */
async function paidMembership(o: { referral?: { ptUserId: string }; sameGymAs?: { gym: any; ownerId: string } } = {}) {
  const { gym, ownerId } = o.sameGymAs ?? (await H.makeGym());
  const clientId = `member-${randomUUID().slice(0, 8)}`;
  const brandId = gym.brandId!;
  const plan = await svc.prisma.gymMembershipPlan.create({ data: { brandId, name: 'E2E Plan', price: PRICE, durationDays: DAYS } });
  const purchase: any = await svc.membershipService.purchase(gym.id, plan.id, clientId, 'VNPAY');
  const membershipId = purchase.membership.id as string;
  const txnId = purchase.payment.transactionId as string;
  if (o.referral) {
    await svc.prisma.gymMembershipReferral.create({ data: { membershipContractId: membershipId, gymId: gym.id, referrerPtUserId: o.referral.ptUserId, rate: 0.1, amount: 30000 } });
  }
  const res = await fetch(`${payUrl}/payments/webhook/vnpay?${signedVnpayQuery(txnId, PRICE)}`);
  const ipn: any = await res.json();
  assert.equal(ipn.RspCode, '00', JSON.stringify(ipn));
  const m = await svc.prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: membershipId } });
  assert.equal(m.status, 'ACTIVE', 'the membership was activated by the real callback');
  assert.equal(m.paymentTxnId, txnId);
  await invariant('after purchase');
  return { gym, ownerId, clientId, membershipId, txnId, plan };
}

/** Drives a case for a really-paid membership up to an APPROVED decision over the real HTTP endpoints. */
async function approvedCase(pm: Awaited<ReturnType<typeof paidMembership>>, caseClass: string, finding: 'ESTABLISHED' | 'NOT_ESTABLISHED') {
  const reporter = { id: pm.clientId, tok: H.token(pm.clientId, 'CUSTOMER') };
  const complaint = await H.makeComplaint(pm.gym.id, pm.clientId);
  const inv = H.newAdmin();
  const appr = H.newAdmin();
  const caseId = H.ok(await H.call('POST', `/admin/complaints/${complaint.id}/case`, inv.tok, { caseClass, membershipId: pm.membershipId }), 201, 'open').id as string;
  H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/assign`, inv.tok, {}), 200, 'assign');
  H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/transition`, inv.tok, { to: 'ASSESSING' }), 200, 'assessing');
  const claim = H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/claims`, inv.tok, { claimantRole: 'MEMBER', text: 'Có vấn đề với gói' }), 201, 'claim');
  H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/assessments`, inv.tok, { claimId: claim.id, relevanceNote: 'a', verifiabilityNote: 'b', consistencyNote: 'c', result: finding, reasoning: 'r' }), 201, 'assess');
  H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/finding`, inv.tok, { finding, reasoning: 'r' }), 201, 'finding');
  const proposal = H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/proposal`, inv.tok, {}), 201, 'proposal');
  H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/decision`, appr.tok, { result: 'APPROVED', reason: 'Đồng ý', conflictOfInterestDeclaredNone: true }), 200, 'approve');
  return { caseId, complaintId: complaint.id, inv, appr, reporter, proposal };
}
const actorOf = (c: { appr: { id: string } }) => ({ id: c.appr.id, role: 'ADMIN' });

test('REAL ledger: an approved MEM_CLOSED case refunds through the real refundByAdmin exactly once; the member wallet is credited by what payment itself returned; replay and a second execute move nothing', { skip }, async () => {
  const pm = await paidMembership();
  const before = await wallet('CLIENT', pm.clientId);
  assert.equal(before.a, 0);
  const c = await approvedCase(pm, 'MEM_CLOSED', 'ESTABLISHED');
  assert.equal(c.proposal.outcome, 'REFUND_GYM_CLOSED');
  // approval alone moved nothing
  assert.equal((await wallet('CLIENT', pm.clientId)).a, 0);
  assert.deepEqual(await ledgerOps(`MEMBERSHIP_RELEASE:${pm.membershipId}`), []);

  // the HTTP route is the real executor too (default deps: real refundByAdmin -> real payment-service)
  const r = await H.call('POST', `/admin/complaint-cases/${c.caseId}/execute`, c.appr.tok, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const credited = (await wallet('CLIENT', pm.clientId)).a;
  assert.ok(credited > 0 && credited <= PRICE, `client credited ${credited}`);
  assert.equal(r.body.data.money.state, 'LEDGER_POSTED_FULL');
  assert.equal(r.body.data.money.group, 'F1');
  assert.equal(num(r.body.data.money.postedToMemberWallet), credited, 'the case reports exactly what the ledger credited');
  assert.equal(r.body.data.closure, 'CLOSED');
  const m = await svc.prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: pm.membershipId } });
  assert.equal(m.status, 'CANCELLED');
  assert.deepEqual(await ledgerOps(`MEMBERSHIP_RELEASE:${pm.membershipId}`), [`MEMBERSHIP_RELEASE:${pm.membershipId}`]);
  const complaint = await svc.prisma.gymComplaint.findUniqueOrThrow({ where: { id: c.complaintId } });
  assert.equal(complaint.status, 'RESOLVED');
  assert.match(complaint.adminResponse ?? '', new RegExp(`${credited.toFixed(2).replace('.', '\\.')} đã được ghi vào ví Gymini`));

  // a second execute (HTTP) is a replay; the ledger and the wallet are untouched
  const again = await H.call('POST', `/admin/complaint-cases/${c.caseId}/execute`, c.appr.tok, {});
  assert.equal(again.status, 200);
  assert.equal(again.body.data.replayed, true);
  assert.equal((await wallet('CLIENT', pm.clientId)).a, credited);
  assert.equal((await ledgerOps(`MEMBERSHIP_RELEASE:%`)).length, 1);
  // the member-facing view says "ghi vào ví" with the confirmed amount, nothing about banks
  const mv = H.ok(await H.call('GET', `/me/complaint-cases/${c.caseId}`, c.reporter.tok), 200, 'member');
  assert.match(mv.money.label, /đã được ghi vào ví Gymini của bạn/);
  assert.doesNotMatch(mv.money.label, /ngân hàng/i);
  await invariant('end');
});

test('REAL ledger: not established / MEM_ACCESS never touch money; the membership stays ACTIVE and the payment ledger is byte-for-byte unchanged', { skip }, async () => {
  const pm = await paidMembership();
  const snap = async () => ({ w: await q(`SELECT owner_type::text, owner_id, available_balance::text, pending_balance::text FROM wallets ORDER BY 1, 2`), e: num((await q(`SELECT count(*)::text AS n FROM wallet_ledger_entries`))[0].n), o: num((await q(`SELECT count(*)::text AS n FROM ledger_operations`))[0].n) });
  const before = await snap();
  const c = await approvedCase(pm, 'MEM_TXN', 'NOT_ESTABLISHED');
  assert.equal(c.proposal.outcome, 'RESOLVE_INSUFFICIENT_EVIDENCE');
  const r = await H.call('POST', `/admin/complaint-cases/${c.caseId}/execute`, c.appr.tok, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.data.money.state, 'NO_MONEY_EFFECT');
  assert.deepEqual(await snap(), before);
  assert.equal((await svc.prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: pm.membershipId } })).status, 'ACTIVE');
  assert.match((await svc.prisma.gymComplaint.findUniqueOrThrow({ where: { id: c.complaintId } })).adminResponse ?? '', /chưa đủ căn cứ/);
});

test('REAL ledger: a crash BEFORE the money step is reconciled by a safe re-run; a crash AFTER the refund committed is reconciled by replaying the payment release; the wallet is credited once either way', { skip }, async () => {
  // (a) before
  const a = await paidMembership();
  const ca = await approvedCase(a, 'MEM_TXN', 'ESTABLISHED');
  await assert.rejects(() => svc.exec.executeDecision(actorOf(ca), ca.caseId, {}, { ...svc.defaultExecDeps(), afterExecutingCas: async () => { throw new Error('CRASH A'); } }), /CRASH A/);
  assert.equal((await wallet('CLIENT', a.clientId)).a, 0);
  assert.equal((await svc.prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: ca.caseId } })).execStatus, 'EXECUTING');
  const ra: any = await svc.exec.reconcileExecution(actorOf(ca), ca.caseId);
  assert.equal(ra.action, 'RERAN_REFUND');
  const creditedA = (await wallet('CLIENT', a.clientId)).a;
  assert.ok(creditedA > 0);
  assert.equal(num(ra.money.postedToMemberWallet), creditedA);

  // (b) after: the refund really happened (membership CANCELLED, wallet credited) but BUSINESS_DONE was never recorded
  const b = await paidMembership();
  const cb = await approvedCase(b, 'MEM_VIOLATION', 'ESTABLISHED');
  await assert.rejects(() => svc.exec.executeDecision(actorOf(cb), cb.caseId, {}, { ...svc.defaultExecDeps(), afterRefund: async () => { throw new Error('CRASH B'); } }), /CRASH B/);
  const creditedB = (await wallet('CLIENT', b.clientId)).a;
  assert.ok(creditedB > 0, 'the money step had committed');
  assert.equal((await svc.prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: b.membershipId } })).status, 'CANCELLED');
  assert.equal((await svc.prisma.gymComplaintCase.findUniqueOrThrow({ where: { id: cb.caseId } })).execStatus, 'EXECUTING');
  assert.equal((await svc.prisma.gymComplaint.findUniqueOrThrow({ where: { id: cb.complaintId } })).status, 'IN_PROGRESS', 'not resolved before the end is recorded');
  await assert.rejects(() => svc.exec.executeDecision(actorOf(cb), cb.caseId), (e: any) => e.code === 'EXECUTION_IN_PROGRESS');
  const rb: any = await svc.exec.reconcileExecution(actorOf(cb), cb.caseId);
  assert.equal(rb.action, 'BUSINESS_DONE');
  assert.equal(num(rb.money.postedToMemberWallet), creditedB, 'the replay of the payment release reports the amount that was really credited');
  assert.equal((await wallet('CLIENT', b.clientId)).a, creditedB, 'credited once');
  assert.equal((await ledgerOps(`MEMBERSHIP_RELEASE:${b.membershipId}`)).length, 1);

  // (c) a membership the CLIENT cancelled (forfeit, no refund) is never mistaken for this decision's refund
  const c = await paidMembership();
  const cc = await approvedCase(c, 'MEM_CLOSED', 'ESTABLISHED');
  await assert.rejects(() => svc.exec.executeDecision(actorOf(cc), cc.caseId, {}, { ...svc.defaultExecDeps(), afterExecutingCas: async () => { throw new Error('CRASH C'); } }), /CRASH C/);
  process.env.GYM_CLIENT_CANCEL_ACTIVE_ENABLED = 'true';
  try {
    await svc.membershipService.cancelByClient(c.membershipId, c.clientId);
  } finally {
    delete process.env.GYM_CLIENT_CANCEL_ACTIVE_ENABLED;
  }
  assert.equal((await wallet('CLIENT', c.clientId)).a, 0, 'forfeit: the client got nothing');
  const rc: any = await svc.exec.reconcileExecution(actorOf(cc), cc.caseId);
  assert.equal(rc.action, 'NEEDS_HUMAN', JSON.stringify(rc));
  assert.equal((await wallet('CLIENT', c.clientId)).a, 0, 'nothing was paid by the reconcile');
  assert.equal(num((await q(`SELECT count(*)::text AS n FROM wallet_ledger_entries WHERE description LIKE '%case replay%'`))[0].n), 0);
  await invariant('after crashes');
});

test('REAL ledger: two simultaneous executes credit the member once', { skip }, async () => {
  const pm = await paidMembership();
  const c = await approvedCase(pm, 'MEM_CLOSED', 'ESTABLISHED');
  const results = await Promise.all([H.call('POST', `/admin/complaint-cases/${c.caseId}/execute`, c.appr.tok, {}), H.call('POST', `/admin/complaint-cases/${c.caseId}/execute`, c.appr.tok, {}), H.call('POST', `/admin/complaint-cases/${c.caseId}/execute`, c.appr.tok, {})]);
  const statuses = results.map((r) => r.status).sort();
  assert.ok(statuses.includes(200), JSON.stringify(results.map((r) => r.body)));
  for (const r of results) if (r.status !== 200) assert.equal(r.body.error.code, 'EXECUTION_IN_PROGRESS');
  assert.equal((await ledgerOps(`MEMBERSHIP_RELEASE:${pm.membershipId}`)).length, 1);
  const credited = (await wallet('CLIENT', pm.clientId)).a;
  const entries = await q(`SELECT amount::text AS amount FROM wallet_ledger_entries e JOIN wallets w ON w.id = e.wallet_id WHERE w.owner_type = 'CLIENT'::"WalletOwnerType" AND w.owner_id = $1`, [pm.clientId]);
  assert.equal(entries.length, 1, 'one credit entry');
  assert.equal(num(entries[0].amount), credited);
  await invariant('after concurrent executes');
});

test('REAL ledger: a membership with a PT referral claws the commission back through the same exit; the case reports it; the invariant holds', { skip }, async () => {
  const ptUserId = `pt-${randomUUID().slice(0, 8)}`;
  const pm = await paidMembership({ referral: { ptUserId } });
  const ptBefore = await wallet('PT', ptUserId);
  assert.equal(ptBefore.p, 30000, 'the referral commission was really settled to the PT (pending) by the activation');
  const c = await approvedCase(pm, 'MEM_VIOLATION', 'ESTABLISHED');
  const r = await H.call('POST', `/admin/complaint-cases/${c.caseId}/execute`, c.appr.tok, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ptAfter = await wallet('PT', ptUserId);
  assert.ok(ptAfter.p < ptBefore.p, 'part of the commission was clawed back');
  assert.equal(r.body.data.money.referralClawbackShortfall, null, 'fully recovered -> no shortfall to show');
  assert.equal(r.body.data.money.group, 'F1');
  assert.equal(num(r.body.data.money.postedToMemberWallet), (await wallet('CLIENT', pm.clientId)).a);
  assert.deepEqual(await ledgerOps(`REFERRAL_CLAWBACK:${pm.membershipId}`), [`REFERRAL_CLAWBACK:${pm.membershipId}`]);
  await invariant('after referral refund');
});

test('REAL ledger B1: the expiry sweep holds ONLY the pending money of the membership with an unfinished case (same gym, other membership is released); it is released through the existing path once the case closes; a second sweep adds nothing', { skip }, async () => {
  const { runSweep } = await import('../services/membershipPayout.sweep');
  const A = await paidMembership(); // will have a case
  const B = await paidMembership({ sameGymAs: { gym: A.gym, ownerId: A.ownerId } }); // same gym, no case
  const inv = H.newAdmin();
  const appr = H.newAdmin();
  const complaint = await H.makeComplaint(A.gym.id, A.clientId);
  const caseId = H.ok(await H.call('POST', `/admin/complaints/${complaint.id}/case`, inv.tok, { caseClass: 'MEM_TXN', membershipId: A.membershipId }), 201, 'open').id as string;
  // both terms are over (fixture): the sweep flips them to EXPIRED and then decides release / hold per membership
  await svc.prisma.gymMembershipContract.updateMany({ where: { id: { in: [A.membershipId, B.membershipId] } }, data: { endDate: new Date(Date.now() - 86_400_000) } });
  const gymBefore = await wallet('GYM', A.gym.id);
  assert.ok(gymBefore.p > 0 && gymBefore.a === 0, 'all of it is pending before the sweep: ' + JSON.stringify(gymBefore));
  const r1 = await runSweep();
  assert.equal(r1.failed, 0);
  assert.deepEqual(await ledgerOps(`MEMBERSHIP_RELEASE:${A.membershipId}`), [], "A's money was NOT released");
  assert.equal((await ledgerOps(`MEMBERSHIP_RELEASE:${B.membershipId}`)).length, 1, "B's money WAS released");
  const mid = await wallet('GYM', A.gym.id);
  assert.ok(mid.a > 0 && mid.p > 0, "the gym has B's share available and A's still pending: " + JSON.stringify(mid));
  assert.equal(Math.round((mid.a + mid.p) * 100), Math.round(gymBefore.p * 100), 'nothing created or lost');
  assert.equal((await svc.prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: A.membershipId } })).payoutReleasedAt, null);
  assert.ok((await svc.prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: B.membershipId } })).payoutReleasedAt);
  await invariant('after the holding sweep');
  const opsBefore = (await ledgerOps('MEMBERSHIP_RELEASE:%')).length;
  await runSweep();
  assert.equal((await ledgerOps('MEMBERSHIP_RELEASE:%')).length, opsBefore, 'a second sweep releases nothing more while the case is open');

  // the case closes with NO refund (not established) -> the next sweep releases A through the same path
  H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/assign`, inv.tok, {}), 200, 'assign');
  H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/transition`, inv.tok, { to: 'ASSESSING' }), 200, 'assessing');
  const claim = H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/claims`, inv.tok, { claimantRole: 'MEMBER', text: 'x' }), 201, 'claim');
  H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/assessments`, inv.tok, { claimId: claim.id, relevanceNote: 'a', verifiabilityNote: 'b', consistencyNote: 'c', result: 'NOT_ESTABLISHED', reasoning: 'r' }), 201, 'assess');
  H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/finding`, inv.tok, { finding: 'NOT_ESTABLISHED', reasoning: 'r' }), 201, 'finding');
  H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/recollect`, inv.tok, {}), 200, 'recollect');
  H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/proposal`, inv.tok, {}), 201, 'proposal');
  H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/decision`, appr.tok, { result: 'APPROVED', reason: 'ok', conflictOfInterestDeclaredNone: true }), 200, 'approve');
  const ex = await H.call('POST', `/admin/complaint-cases/${caseId}/execute`, appr.tok, {});
  assert.equal(ex.status, 200, JSON.stringify(ex.body));
  assert.equal(ex.body.data.money.state, 'NO_MONEY_EFFECT');
  assert.deepEqual(await ledgerOps(`MEMBERSHIP_RELEASE:${A.membershipId}`), [], 'closing the case did not move money by itself');
  const r3 = await runSweep();
  assert.equal(r3.failed, 0);
  assert.equal((await ledgerOps(`MEMBERSHIP_RELEASE:${A.membershipId}`)).length, 1, "A's money is released once the case is closed");
  const after = await wallet('GYM', A.gym.id);
  assert.equal(after.p, 0);
  assert.equal(Math.round(after.a * 100), Math.round(gymBefore.p * 100));
  const opsAfter = (await ledgerOps('MEMBERSHIP_RELEASE:%')).length;
  await runSweep();
  assert.equal((await ledgerOps('MEMBERSHIP_RELEASE:%')).length, opsAfter, 'idempotent');
  assert.equal((await wallet('CLIENT', A.clientId)).a, 0, 'no refund was paid');
  await invariant('end');
});

test('REAL ledger E1: complaint filed with 20 of 30 days left (300,000 x 20/30 = 200,000.00 fixed at the complaint date); the membership EXPIRES during the case (the sweep holds its money); the approved refund then executes ONCE with the fixed amount from that membership\'s held money; replay moves nothing; the escrow invariant holds', { skip }, async () => {
  const { runSweep } = await import('../services/membershipPayout.sweep');
  const DAY_MS = 24 * 3600 * 1000;
  const A = await paidMembership();
  const other = await paidMembership({ sameGymAs: { gym: A.gym, ownerId: A.ownerId } }); // same gym, no case: must be untouched
  const C = new Date(Math.floor(Date.now() / 1000) * 1000);
  // exact dates around the complaint date C: 10 days used, 20 days left
  await svc.prisma.gymMembershipContract.update({ where: { id: A.membershipId }, data: { startDate: new Date(C.getTime() - 10 * DAY_MS), endDate: new Date(C.getTime() + 20 * DAY_MS) } });
  const complaint = await H.makeComplaint(A.gym.id, A.clientId);
  await svc.prisma.gymComplaint.update({ where: { id: complaint.id }, data: { createdAt: C } });
  const inv = H.newAdmin();
  const appr = H.newAdmin();
  const caseId = H.ok(await H.call('POST', `/admin/complaints/${complaint.id}/case`, inv.tok, { caseClass: 'MEM_CLOSED', membershipId: A.membershipId }), 201, 'open').id as string;
  const quote = await svc.prisma.gymCaseRefundQuote.findUniqueOrThrow({ where: { caseId } });
  assert.equal(quote.amount.toString(), '200000', 'hand-computed: 300,000 x 20/30');
  H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/assign`, inv.tok, {}), 200, 'assign');
  H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/transition`, inv.tok, { to: 'ASSESSING' }), 200, 'assessing');
  const claim = H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/claims`, inv.tok, { claimantRole: 'MEMBER', text: 'Phòng tập đóng cửa' }), 201, 'claim');
  H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/assessments`, inv.tok, { claimId: claim.id, relevanceNote: 'a', verifiabilityNote: 'b', consistencyNote: 'c', result: 'ESTABLISHED', reasoning: 'r' }), 201, 'assess');
  H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/finding`, inv.tok, { finding: 'ESTABLISHED', reasoning: 'r' }), 201, 'finding');
  H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/proposal`, inv.tok, {}), 201, 'proposal');
  H.ok(await H.call('POST', `/admin/complaint-cases/${caseId}/decision`, appr.tok, { result: 'APPROVED', reason: 'ok', conflictOfInterestDeclaredNone: true }), 200, 'approve');

  // the term ends while the case is pending: both memberships are past their end date; the sweep expires both and releases ONLY the one without a case
  await svc.prisma.gymMembershipContract.updateMany({ where: { id: { in: [A.membershipId, other.membershipId] } }, data: { endDate: new Date(Date.now() - DAY_MS) } });
  const gymBefore = await wallet('GYM', A.gym.id);
  const r1 = await runSweep();
  assert.equal(r1.failed, 0);
  assert.equal((await svc.prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: A.membershipId } })).status, 'EXPIRED');
  assert.deepEqual(await ledgerOps(`MEMBERSHIP_RELEASE:${A.membershipId}`), [], "A's money is held");
  assert.equal((await ledgerOps(`MEMBERSHIP_RELEASE:${other.membershipId}`)).length, 1, 'the other membership is released');
  const gymMid = await wallet('GYM', A.gym.id);
  assert.ok(gymMid.p > 0 && gymMid.a > gymBefore.a, 'only the other membership moved to available: ' + JSON.stringify([gymBefore, gymMid]));
  const clientBefore = await wallet('CLIENT', A.clientId);
  assert.equal(clientBefore.a, 0);

  // the executor (default deps = REAL refundByAdmin -> REAL payment-service) refunds the FIXED amount although the term is over
  const ex = await H.call('POST', `/admin/complaint-cases/${caseId}/execute`, appr.tok, {});
  assert.equal(ex.status, 200, JSON.stringify(ex.body));
  assert.equal(ex.body.data.money.state, 'LEDGER_POSTED_FULL');
  assert.equal(ex.body.data.money.postedToMemberWallet, '200000.00');
  const client = await wallet('CLIENT', A.clientId);
  assert.equal(client.a, 200_000, "the member's wallet got exactly the fixed amount");
  assert.equal((await ledgerOps(`MEMBERSHIP_RELEASE:${A.membershipId}`)).length, 1);
  const entries = await q(`SELECT amount::text AS amount FROM wallet_ledger_entries e JOIN wallets w ON w.id = e.wallet_id WHERE w.owner_type = 'CLIENT'::"WalletOwnerType" AND w.owner_id = $1`, [A.clientId]);
  assert.deepEqual(entries.map((e) => num(e.amount)), [200_000], 'one credit entry');
  assert.equal((await svc.prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: A.membershipId } })).status, 'CANCELLED');
  // the rest of A's price (100,000) went to the gym / platform; the other membership and the gym's other money are exactly as before
  const gymAfter = await wallet('GYM', A.gym.id);
  assert.equal(gymAfter.p, 0, 'no pending left: A refunded 200,000 and released the other 100,000, other membership released earlier');
  assert.equal((await wallet('CLIENT', other.clientId)).a, 0, 'the other member got no refund');
  await invariant('after the fixed-amount refund');
  // replay (execute again, sweep again) moves nothing
  const ops = (await ledgerOps('%')).length;
  assert.equal((await H.call('POST', `/admin/complaint-cases/${caseId}/execute`, appr.tok, {})).body.data.replayed, true);
  await runSweep();
  assert.equal((await ledgerOps('%')).length, ops);
  assert.equal((await wallet('CLIENT', A.clientId)).a, 200_000);
  await invariant('end');
});
