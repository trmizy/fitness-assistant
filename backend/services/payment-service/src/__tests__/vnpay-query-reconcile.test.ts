/**
 * B8 (L3, VNPAY) - unit tests of services/vnpay-query-reconcile.ts.
 *   evidence label: TEST FIXTURE. The querydr client is a fake that returns answers signed by an independently written signer, the database is a
 *   recorder that exposes ONE method (paymentTransaction.findMany) and throws on anything else. No request leaves the process; the real VNPay
 *   is never called.
 * Run: ./node_modules/.bin/tsx --test src/__tests__/vnpay-query-reconcile.test.ts   (from backend/services/payment-service)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const TMN = 'L3TEST01';
const SECRET = 'test-only-vnpay-l3-secret';
process.env.VNPAY_TMN_CODE = TMN;
process.env.VNPAY_HASH_SECRET = SECRET;

type Mod = typeof import('../services/vnpay-query-reconcile');
let m: Mod;
let Decimal: typeof import('../generated/prisma').Prisma.Decimal;
let providerMod: typeof import('../providers/vnpay.provider');
test.before(async () => {
  m = await import('../services/vnpay-query-reconcile');
  Decimal = (await import('../generated/prisma')).Prisma.Decimal;
  providerMod = await import('../providers/vnpay.provider');
});
test.after(async () => {
  const { prisma } = await import('../repositories/prisma');
  await prisma.$disconnect();
});

const ORDER = ['vnp_ResponseId', 'vnp_Command', 'vnp_ResponseCode', 'vnp_Message', 'vnp_TmnCode', 'vnp_TxnRef', 'vnp_Amount', 'vnp_BankCode', 'vnp_PayDate', 'vnp_TransactionNo', 'vnp_TransactionType', 'vnp_TransactionStatus', 'vnp_OrderInfo', 'vnp_PromotionCode', 'vnp_PromotionAmount'];
/** Signs a querydr answer the way VNPay's guide says (written independently of the provider). */
function signed(fields: Record<string, string>, key = SECRET): Record<string, string> {
  const hash = crypto.createHmac('sha512', key).update(Buffer.from(ORDER.map((k) => fields[k] ?? '').join('|'), 'utf-8')).digest('hex');
  return { ...fields, vnp_SecureHash: hash };
}
const answer = (txnRef: string, o: { code?: string; status?: string; amountVnd?: number | null; tmn?: string; ref?: string } = {}) =>
  signed({
    vnp_ResponseId: 'r1', vnp_Command: 'querydr', vnp_ResponseCode: o.code ?? '00', vnp_Message: 'x', vnp_TmnCode: o.tmn ?? TMN, vnp_TxnRef: o.ref ?? txnRef,
    ...(o.amountVnd === null ? {} : { vnp_Amount: String(BigInt(o.amountVnd ?? 100000) * 100n) }),
    vnp_BankCode: 'NCB', vnp_PayDate: '20261110120000', vnp_TransactionNo: '14000001', vnp_TransactionType: '01', vnp_TransactionStatus: o.status ?? '00', vnp_OrderInfo: 'x',
  });

let seq = 0;
const txn = (over: Partial<{ id: string; status: string; amount: string; ref: string | null; createdAt: Date; metadata: unknown }> = {}) => {
  seq += 1;
  const id = over.id ?? `W9-txn-${String(seq).padStart(3, '0')}`;
  return {
    id,
    providerTransactionId: over.ref === undefined ? id : over.ref,
    status: over.status ?? 'PAID',
    amount: new Decimal(over.amount ?? '100000'),
    createdAt: over.createdAt ?? new Date(Date.UTC(2026, 10, 5, 3, 0, seq % 60)),
    metadata: over.metadata ?? null,
  };
};

function recorderDb(rows: ReturnType<typeof txn>[]) {
  const calls: Array<{ method: string; args: unknown }> = [];
  const db = new Proxy({}, {
    get(_t, prop) {
      if (prop !== 'paymentTransaction') throw new Error(`L3 touched db.${String(prop)}`);
      return new Proxy({}, {
        get(_t2, method) {
          if (method !== 'findMany') throw new Error(`L3 called a non-read db method: ${String(method)}`);
          return async (args: { take: number }) => {
            calls.push({ method: 'findMany', args });
            return rows.slice(0, args.take);
          };
        },
      });
    },
  });
  return { db: db as unknown as import('../services/vnpay-query-reconcile').L3Db, calls };
}

const fakeClient = (fn: (input: { txnRef: string; transactionDate: string }) => Record<string, unknown> | Error) => {
  const inputs: Array<{ txnRef: string; transactionDate: string }> = [];
  return {
    inputs,
    client: {
      async query(input: { txnRef: string; transactionDate: string }) {
        inputs.push(input);
        const r = fn(input);
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
};
const NOW = new Date('2026-11-11T05:00:00Z');
const noSleep = async () => {};

async function runOne(t: ReturnType<typeof txn>, reply: (ref: string) => Record<string, unknown> | Error) {
  const { db } = recorderDb([t]);
  const { client } = fakeClient((i) => reply(i.txnRef));
  const r = await m.vnpayQueryReconcileService.run({}, NOW, { db, client, sleep: noSleep });
  assert.equal(r.items.length, 1);
  return r.items[0];
}

test('MATCHED: Gymini PAID, VNPay 00 with the same amount; money is a decimal string', async () => {
  const t = txn();
  const item = await runOne(t, (ref) => answer(ref));
  assert.equal(item.result, 'MATCHED');
  assert.equal(item.gyminiAmount, '100000.00');
  assert.equal(item.vnpayAmount, '100000.00');
  assert.equal(item.vnpayStatusCode, '00');
  assert.equal(item.transactionId, t.id);
});

test('MATCHED: a PENDING / FAILED Gymini row against a not-completed VNPay status (01 / 02) is a match, REFUNDED against 04 / 00 too', async () => {
  assert.equal((await runOne(txn({ status: 'PENDING' }), (r) => answer(r, { status: '01' }))).result, 'MATCHED');
  assert.equal((await runOne(txn({ status: 'FAILED' }), (r) => answer(r, { status: '02' }))).result, 'MATCHED');
  assert.equal((await runOne(txn({ status: 'REFUNDED' }), (r) => answer(r, { status: '04' }))).result, 'MATCHED');
  assert.equal((await runOne(txn({ status: 'REFUNDED' }), (r) => answer(r, { status: '00' }))).result, 'MATCHED');
});

test('NOT_FOUND_AT_VNPAY: response code 91 (signed); the note differs for PAID vs a never-paid checkout', async () => {
  const paid = await runOne(txn({ status: 'PAID' }), (r) => answer(r, { code: '91', status: '', amountVnd: null }));
  assert.equal(paid.result, 'NOT_FOUND_AT_VNPAY');
  assert.equal(paid.vnpayStatusCode, null);
  assert.equal(paid.vnpayAmount, null);
  assert.match(paid.note, /Cần kiểm tra thủ công/);
  const pending = await runOne(txn({ status: 'PENDING' }), (r) => answer(r, { code: '91', status: '', amountVnd: null }));
  assert.equal(pending.result, 'NOT_FOUND_AT_VNPAY');
  assert.match(pending.note, /Thường gặp/);
});

test('STATUS_MISMATCH: Gymini PAID but VNPay not success; VNPay success but Gymini PENDING / PROCESSING / FAILED; REFUNDED with an unpaid VNPay', async () => {
  const a = await runOne(txn({ status: 'PAID' }), (r) => answer(r, { status: '02' }));
  assert.equal(a.result, 'STATUS_MISMATCH');
  assert.equal(a.vnpayStatusCode, '02');
  for (const s of ['PENDING', 'PROCESSING', 'FAILED']) {
    assert.equal((await runOne(txn({ status: s }), (r) => answer(r, { status: '00' }))).result, 'STATUS_MISMATCH', s);
  }
  assert.equal((await runOne(txn({ status: 'REFUNDED' }), (r) => answer(r, { status: '01' }))).result, 'STATUS_MISMATCH');
});

test('AMOUNT_MISMATCH: VNPay amount / 100 differs from the stored amount (also for a decimal stored amount)', async () => {
  const a = await runOne(txn({ amount: '100000' }), (r) => answer(r, { amountVnd: 90000 }));
  assert.equal(a.result, 'AMOUNT_MISMATCH');
  assert.equal(a.vnpayAmount, '90000.00');
  assert.equal(a.gyminiAmount, '100000.00');
  assert.equal((await runOne(txn({ amount: '100000.50' }), (r) => answer(r, { amountVnd: 100000 }))).result, 'AMOUNT_MISMATCH');
  assert.equal((await runOne(txn({ amount: '100000.00' }), (r) => answer(r, { amountVnd: 100000 }))).result, 'MATCHED');
});

test('a paid status with an unreadable amount is QUERY_FAILED (not a mismatch)', async () => {
  assert.equal((await runOne(txn(), (r) => answer(r, { amountVnd: null }))).result, 'QUERY_FAILED');
});

test('QUERY_FAILED: signature failure (missing, wrong key, tampered field, forged 91) - nothing in the answer is trusted', async () => {
  const t = () => txn({ status: 'PAID' });
  const unsigned = await runOne(t(), (r) => {
    const a = answer(r) as Record<string, string>;
    delete a.vnp_SecureHash;
    return a;
  });
  assert.equal(unsigned.result, 'QUERY_FAILED');
  assert.match(unsigned.note, /chữ ký/);
  const wrongKey = await runOne(t(), (r) => {
    const { vnp_SecureHash, ...f } = answer(r);
    void vnp_SecureHash;
    return signed(f, 'another-key');
  });
  assert.equal(wrongKey.result, 'QUERY_FAILED');
  const tampered = await runOne(t(), (r) => ({ ...answer(r), vnp_Amount: '1' }));
  assert.equal(tampered.result, 'QUERY_FAILED');
  assert.equal(tampered.vnpayAmount, null);
  const forged91 = await runOne(t(), (r) => ({ ...answer(r, { code: '91' }), vnp_SecureHash: 'ab'.repeat(64) }));
  assert.equal(forged91.result, 'QUERY_FAILED');
});

test('unsigned error reply (real sandbox: 99 "Unexpected error", no vnp_SecureHash) -> QUERY_FAILED explained by its code and message', async () => {
  const sandbox = await runOne(txn(), () => ({ vnp_ResponseCode: '99', vnp_Message: 'Unexpected error' }));
  assert.equal(sandbox.result, 'QUERY_FAILED');
  assert.equal(sandbox.vnpayStatusCode, null);
  assert.equal(sandbox.vnpayAmount, null);
  assert.equal(sandbox.note, 'VNPay trả về mã lỗi 99 (Unexpected error) nên chưa đối chiếu được.');
  assert.doesNotMatch(sandbox.note, /chữ ký/);
  // without a message: no empty parentheses
  assert.equal((await runOne(txn(), () => ({ vnp_ResponseCode: '94' }))).note, 'VNPay trả về mã lỗi 94 nên chưa đối chiếu được.');
  // the message is plain, single-line and at most 100 characters; a non-string message is ignored
  const long = await runOne(txn(), () => ({ vnp_ResponseCode: '99', vnp_Message: `x\ny${'z'.repeat(300)}` }));
  assert.ok(long.note.length < 200);
  assert.doesNotMatch(long.note, /\n/);
  assert.equal((await runOne(txn(), () => ({ vnp_ResponseCode: '99', vnp_Message: { a: 1 } }))).note, 'VNPay trả về mã lỗi 99 nên chưa đối chiếu được.');
  // never a match / mismatch decision, whatever the row status
  for (const s of ['PAID', 'PENDING', 'REFUNDED']) {
    assert.equal((await runOne(txn({ status: s }), () => ({ vnp_ResponseCode: '99', vnp_Message: 'Unexpected error', vnp_TransactionStatus: '00', vnp_Amount: '1' }))).result, 'QUERY_FAILED', s);
  }
});

test('unsigned 91 and unsigned 00 still need a valid signature (signature note, no decision)', async () => {
  for (const code of ['91', '00']) {
    const item = await runOne(txn({ status: 'PAID' }), (r) => {
      const a = answer(r, { code }) as Record<string, string>;
      delete a.vnp_SecureHash;
      return a;
    });
    assert.equal(item.result, 'QUERY_FAILED', code);
    assert.match(item.note, /chữ ký/, code);
  }
  // an answer with no response code at all and no signature is also a signature failure
  const none = await runOne(txn(), () => ({ vnp_Message: 'hello' }));
  assert.equal(none.result, 'QUERY_FAILED');
  assert.match(none.note, /chữ ký/);
});

test('QUERY_FAILED: network error / timeout, unexpected response code, wrong merchant or reference', async () => {
  assert.equal((await runOne(txn(), () => new Error('ECONNABORTED timeout of 8000ms exceeded'))).result, 'QUERY_FAILED');
  const c99 = await runOne(txn(), (r) => answer(r, { code: '99' }));
  assert.equal(c99.result, 'QUERY_FAILED');
  assert.match(c99.note, /99/);
  assert.equal((await runOne(txn(), (r) => answer(r, { code: '94' }))).result, 'QUERY_FAILED');
  assert.equal((await runOne(txn(), (r) => answer(r, { tmn: 'OTHERTMN' }))).result, 'QUERY_FAILED');
  assert.equal((await runOne(txn(), (r) => answer(r, { ref: `${r}-x` }))).result, 'QUERY_FAILED');
});

test('counts: a mixed run adds up, QUERY_FAILED is never counted as a mismatch', async () => {
  const rows = [txn(), txn({ status: 'PENDING' }), txn(), txn({ status: 'PAID' }), txn({ status: 'PAID' }), txn()];
  const plan = ['ok', 'notfound', 'amount', 'status', 'fail', 'badsig'];
  const { db } = recorderDb(rows);
  const { client } = fakeClient((i) => {
    const idx = rows.findIndex((r) => r.id === i.txnRef);
    switch (plan[idx]) {
      case 'ok': return answer(i.txnRef);
      case 'notfound': return answer(i.txnRef, { code: '91', status: '', amountVnd: null });
      case 'amount': return answer(i.txnRef, { amountVnd: 5 });
      case 'status': return answer(i.txnRef, { status: '02' });
      case 'fail': return new Error('boom');
      default: return { ...answer(i.txnRef), vnp_SecureHash: '00' };
    }
  });
  const r = await m.vnpayQueryReconcileService.run({}, NOW, { db, client, sleep: noSleep });
  assert.deepEqual(r.counts, { checked: 6, matched: 1, notFoundAtVnpay: 1, statusMismatch: 1, amountMismatch: 1, queryFailed: 2 });
  assert.equal(r.scope, 'L3');
  assert.equal(r.provider, 'VNPAY');
  assert.equal(r.configured, true);
  assert.equal(r.truncated, false);
  assert.equal(r.items.length, 6);
  assert.deepEqual(r.items.map((i) => i.result), ['MATCHED', 'NOT_FOUND_AT_VNPAY', 'AMOUNT_MISMATCH', 'STATUS_MISMATCH', 'QUERY_FAILED', 'QUERY_FAILED']);
});

test('cap + truncated: 60 rows -> 50 asked, oldest first, truncated true; exactly 50 -> truncated false', async () => {
  const rows = Array.from({ length: 60 }, () => txn());
  const { db, calls } = recorderDb(rows);
  const { client, inputs } = fakeClient((i) => answer(i.txnRef));
  const r = await m.vnpayQueryReconcileService.run({}, NOW, { db, client, sleep: noSleep });
  assert.equal(r.truncated, true);
  assert.equal(r.items.length, 50);
  assert.equal(inputs.length, 50);
  assert.equal(r.counts.checked, 50);
  assert.deepEqual(inputs.map((i) => i.txnRef), rows.slice(0, 50).map((x) => x.id));
  const args = calls[0].args as { take: number; orderBy: unknown; where: { provider: string; status: { in: string[] }; createdAt: { gte: Date; lt: Date } } };
  assert.equal(args.take, 51);
  assert.deepEqual(args.orderBy, [{ createdAt: 'asc' }, { id: 'asc' }]);
  assert.equal(args.where.provider, 'VNPAY');
  assert.deepEqual(args.where.status.in, ['PAID', 'REFUNDED', 'PENDING', 'PROCESSING', 'FAILED']);
  assert.equal(args.where.createdAt.lt.toISOString(), NOW.toISOString());
  assert.equal(args.where.createdAt.gte.toISOString(), '2026-11-04T05:00:00.000Z'); // default 7 days

  const exactly = recorderDb(Array.from({ length: 50 }, () => txn()));
  const r2 = await m.vnpayQueryReconcileService.run({}, NOW, { db: exactly.db, client: fakeClient((i) => answer(i.txnRef)).client, sleep: noSleep });
  assert.equal(r2.truncated, false);
  assert.equal(r2.items.length, 50);
});

test('calls are sequential with a pause between them (never concurrent) and use the stored vnp_TxnRef / vnp_CreateDate', async () => {
  const rows = [
    txn({ ref: 'REF-A', metadata: { vnp_TxnRef: 'META-REF', vnp_CreateDate: '20261105090000' } }),
    txn({ ref: null }),
    txn({ ref: 'REF-C', createdAt: new Date('2026-11-05T03:00:00Z') }),
  ];
  const { db } = recorderDb(rows);
  let inFlight = 0;
  let maxInFlight = 0;
  const events: string[] = [];
  const inputs: Array<{ txnRef: string; transactionDate: string }> = [];
  const client = {
    async query(i: { txnRef: string; transactionDate: string }) {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      inputs.push(i);
      events.push('call');
      await new Promise((r) => setTimeout(r, 5));
      inFlight -= 1;
      return answer(i.txnRef);
    },
  };
  const sleeps: number[] = [];
  await m.vnpayQueryReconcileService.run({}, NOW, { db, client, sleep: async (ms) => { sleeps.push(ms); events.push('sleep'); } });
  assert.equal(maxInFlight, 1);
  assert.deepEqual(events, ['call', 'sleep', 'call', 'sleep', 'call']);
  assert.deepEqual(sleeps, [300, 300]);
  assert.equal(inputs[0].txnRef, 'META-REF');
  assert.equal(inputs[0].transactionDate, '20261105090000');
  assert.equal(inputs[1].txnRef, rows[1].id); // no reference stored -> the transaction id, like the provider
  assert.equal(inputs[2].txnRef, 'REF-C');
  assert.equal(inputs[2].transactionDate, '20261105100000'); // createdAt fallback: 03:00Z = 10:00 GMT+7
});

test('5 failed lookups in a row stop the run: the rest is QUERY_FAILED without any further call', async () => {
  const rows = Array.from({ length: 8 }, () => txn());
  const { client, inputs } = fakeClient(() => new Error('429 Too Many Requests'));
  const r = await m.vnpayQueryReconcileService.run({}, NOW, { db: recorderDb(rows).db, client, sleep: noSleep });
  assert.equal(inputs.length, 5);
  assert.equal(r.counts.queryFailed, 8);
  assert.equal(r.counts.statusMismatch + r.counts.amountMismatch + r.counts.notFoundAtVnpay, 0);
  assert.match(r.items[7].note, /dừng hỏi VNPay/);
});

test('the total time budget stops asking the same way', async () => {
  const rows = Array.from({ length: 4 }, () => txn());
  let t = 0;
  const { client, inputs } = fakeClient((i) => answer(i.txnRef));
  const r = await m.vnpayQueryReconcileService.run({}, NOW, { db: recorderDb(rows).db, client, sleep: noSleep, budgetMs: 1000, nowMs: () => { t += 600; return t; } });
  assert.ok(inputs.length < 4);
  assert.equal(r.counts.checked, 4);
  assert.equal(r.items[3].result, 'QUERY_FAILED');
  assert.match(r.items[3].note, /hết thời gian/);
});

test('configured:false -> no database read and no call to VNPay', async () => {
  const { db, calls } = recorderDb([txn()]);
  const { client, inputs } = fakeClient((i) => answer(i.txnRef));
  const r = await m.vnpayQueryReconcileService.run({}, NOW, { db, client, sleep: noSleep, configured: false });
  assert.equal(r.configured, false);
  assert.equal(r.items.length, 0);
  assert.equal(r.truncated, false);
  assert.deepEqual(r.counts, { checked: 0, matched: 0, notFoundAtVnpay: 0, statusMismatch: 0, amountMismatch: 0, queryFailed: 0 });
  assert.equal(calls.length, 0);
  assert.equal(inputs.length, 0);
});

test('read only: the recorder exposes findMany only (any other db call would throw) and the source has no write path', async () => {
  const rows = [txn(), txn({ status: 'PENDING' })];
  const { db, calls } = recorderDb(rows);
  await m.vnpayQueryReconcileService.run({}, NOW, { db, client: fakeClient((i) => answer(i.txnRef)).client, sleep: noSleep });
  assert.deepEqual(calls.map((c) => c.method), ['findMany']);
  const src = readFileSync(join(__dirname, '..', 'services', 'vnpay-query-reconcile.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /\.(create|createMany|updateMany|upsert|delete|deleteMany)\(|\.update\((?!Buffer)|\$executeRaw|\$queryRaw|\$transaction|queryGatewayResult|pollAndSettle|handleEvent/);
  const dbCalls = [...src.matchAll(/db\.(\w+)\.(\w+)\(/g)].map((x) => `${x[1]}.${x[2]}`);
  assert.deepEqual(dbCalls, ['paymentTransaction.findMany']);
});

test('the querydr request is signed like the provider signs it (same fields, same recipe)', async () => {
  const body = m.buildQuerydrBody({ txnRef: 'REF-1', transactionDate: '20261105100000' }, new Date('2026-11-11T05:00:00Z'));
  assert.equal(body.vnp_Command, 'querydr');
  assert.equal(body.vnp_TmnCode, TMN);
  assert.equal(body.vnp_CreateDate, '20261111120000'); // GMT+7
  const hashData = [body.vnp_RequestId, '2.1.0', 'querydr', TMN, 'REF-1', '20261105100000', body.vnp_CreateDate, '127.0.0.1', 'querydr REF-1'].join('|');
  assert.equal(body.vnp_SecureHash, crypto.createHmac('sha512', SECRET).update(hashData).digest('hex'));

  // compare with what the provider's own querydr sends (axios.post is captured, nothing leaves the process)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const axios = require('axios') as { post: unknown };
  const original = axios.post;
  let sent: Record<string, string> | null = null;
  (axios as unknown as { post: unknown }).post = async (_url: string, b: Record<string, string>) => {
    sent = b;
    return { data: { vnp_ResponseCode: '91' } };
  };
  try {
    await new providerMod.VNPayProvider().queryGatewayResult({ id: 'REF-1', providerTransactionId: 'REF-1', amount: 1, createdAt: new Date(), metadata: { vnp_CreateDate: '20261105100000' } });
  } finally {
    (axios as unknown as { post: unknown }).post = original;
  }
  assert.ok(sent);
  assert.deepEqual(Object.keys(body).sort(), Object.keys(sent as Record<string, string>).sort());
});

test('resolveL3Window: default last 7 days, max 31 days, from must precede to', () => {
  const d = m.resolveL3Window({}, NOW);
  assert.equal(d.to.toISOString(), NOW.toISOString());
  assert.equal(d.from.toISOString(), '2026-11-04T05:00:00.000Z');
  assert.doesNotThrow(() => m.resolveL3Window({ from: new Date('2026-10-11T05:00:00Z'), to: NOW }, NOW)); // exactly 31 days
  assert.throws(() => m.resolveL3Window({ from: new Date('2026-10-11T04:59:00Z'), to: NOW }, NOW));
  assert.throws(() => m.resolveL3Window({ from: NOW, to: NOW }, NOW));
});
