/**
 * R4-01: ZaloPay's gateway page does not navigate to a custom scheme, so the mobile redirecturl must be an https bridge
 * on our API (GET /payments/zalopay/return) that 302s on to the deep link / web result page. The bridge never settles money.
 * No DB: transactionRepository.findById is stubbed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { transactionRepository } from '../repositories/transaction.repository';
import returnRoutes from '../routes/vnpay-return.routes';
import { buildRedirectUrl } from '../providers/zalopay.provider';

const TXNS: Record<string, { status: string; metadata: Record<string, unknown> }> = {
  'txn-mobile-paid': { status: 'PAID', metadata: { platform: 'mobile' } },
  'txn-mobile-pending': { status: 'PENDING', metadata: { platform: 'mobile' } },
  'txn-web-failed': { status: 'FAILED', metadata: { platform: 'web', returnBaseUrl: 'https://gymini.vn' } },
};
const repo = transactionRepository as unknown as { findById: (id: string) => Promise<unknown> };
const originalFindById = repo.findById;
let server: http.Server;
let base = '';

test.before(async () => {
  repo.findById = async (id: string) => TXNS[id] ?? null;
  const app = express();
  app.use('/payments', returnRoutes);
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
test.after(async () => {
  repo.findById = originalFindById;
  await new Promise<void>((r) => server.close(() => r()));
});

const hit = (qs: string) => fetch(`${base}/payments/zalopay/return?${qs}`, { redirect: 'manual' });

test('mobile redirecturl is an https bridge on the API (returnBaseUrl wins), not the custom scheme', () => {
  const url = buildRedirectUrl('abc-123', 'mobile', 'https://api.gymini.vn');
  assert.equal(url, 'https://api.gymini.vn/payments/zalopay/return?txnId=abc-123');
  assert.ok(!url.startsWith('fitnessassistant://'));
});

test('mobile redirecturl falls back to ZALOPAY_RETURN_URL, then to the VNPay return base', () => {
  const saved = { z: process.env.ZALOPAY_RETURN_URL, v: process.env.VNPAY_RETURN_URL };
  try {
    delete process.env.ZALOPAY_RETURN_URL;
    process.env.VNPAY_RETURN_URL = 'https://api.gymini.vn/payments/vnpay/return';
    assert.equal(buildRedirectUrl('t1', 'mobile'), 'https://api.gymini.vn/payments/zalopay/return?txnId=t1');
    process.env.ZALOPAY_RETURN_URL = 'https://other.example/payments/zalopay/return';
    assert.equal(buildRedirectUrl('t1', 'mobile'), 'https://other.example/payments/zalopay/return?txnId=t1');
  } finally {
    if (saved.z === undefined) delete process.env.ZALOPAY_RETURN_URL; else process.env.ZALOPAY_RETURN_URL = saved.z;
    if (saved.v === undefined) delete process.env.VNPAY_RETURN_URL; else process.env.VNPAY_RETURN_URL = saved.v;
  }
});

test('web redirecturl is unchanged: straight to the frontend result page', () => {
  assert.equal(buildRedirectUrl('t1', 'web', 'https://gymini.vn'), 'https://gymini.vn/client/payments/result?txnId=t1');
});

test('bridge 302s a mobile txn to the app deep link, status from OUR db (PAID -> success)', async () => {
  const res = await hit('txnId=txn-mobile-paid&status=1&apptransid=x');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'fitnessassistant://client/payments/result?txnId=txn-mobile-paid&status=success');
});

test('bridge ignores a forged gateway status: a PENDING txn stays pending', async () => {
  const res = await hit('txnId=txn-mobile-pending&status=1');
  assert.equal(res.headers.get('location'), 'fitnessassistant://client/payments/result?txnId=txn-mobile-pending&status=pending');
});

test('bridge 302s a web txn to the web base persisted on the txn', async () => {
  const res = await hit('txnId=txn-web-failed');
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), 'https://gymini.vn/client/payments/result?txnId=txn-web-failed&status=failed');
});

test('unknown / missing txnId still redirects (pending), never a 500', async () => {
  const res = await hit('txnId=does-not-exist');
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location') ?? '', /\/client\/payments\/result\?txnId=does-not-exist&status=pending$/);
  const none = await hit('');
  assert.equal(none.status, 302);
});
