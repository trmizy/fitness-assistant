import test from 'node:test';
import assert from 'node:assert/strict';
import axios from 'axios';
import { buildMomoOrderInfo, buildMomoRedirectUrl } from '../providers/momo-request-fields';
import { MoMoProvider } from '../providers/momo.provider';

/** B25 — MoMo order description (no internal ids) and the "Quay ve" redirect. TEST FIXTURE (axios stubbed). */

const UUID = '4c546e3f-4feb-404f-9a1b-0123456789ab';

test('the old "Goi hoi vien <uuid>" becomes a short Vietnamese description with no id', () => {
  const out = buildMomoOrderInfo(`Goi hoi vien ${UUID}`);
  assert.equal(out, 'Thanh toan goi hoi vien');
  assert.ok(!out.includes(UUID.slice(0, 8)));
});

test('a plan/gym name after the prefix is kept; diacritics are folded to ASCII', () => {
  assert.equal(buildMomoOrderInfo('Gói hội viên Đồng Vàng'), 'Thanh toan goi hoi vien Dong Vang');
});

test('purpose-style defaults ("GYM_MEMBERSHIP <uuid>") map to a label', () => {
  assert.equal(buildMomoOrderInfo(`GYM_MEMBERSHIP ${UUID}`), 'Thanh toan goi hoi vien');
  assert.equal(buildMomoOrderInfo(`PT_CONTRACT ${UUID}`), 'Thanh toan hop dong PT');
});

test('empty / id-only input falls back to a generic label; long input is truncated to 100', () => {
  assert.equal(buildMomoOrderInfo(UUID), 'Thanh toan Gymini');
  assert.equal(buildMomoOrderInfo(''), 'Thanh toan Gymini');
  assert.equal(buildMomoOrderInfo(`Goi hoi vien ${'x'.repeat(300)}`).length <= 100, true);
});

test('redirect: mobile -> app deep link; web -> payer origin; else static fallback; txnId always appended', () => {
  assert.equal(
    buildMomoRedirectUrl({ transactionId: 't1', platform: 'mobile', returnBaseUrl: 'https://x.trycloudflare.com', staticFallback: 'http://localhost:5173/client/payments/result' }),
    'fitnessassistant://client/payments/result?txnId=t1',
  );
  assert.equal(
    buildMomoRedirectUrl({ transactionId: 't1', platform: 'web', returnBaseUrl: 'https://x.trycloudflare.com/', staticFallback: 'http://localhost:5173/client/payments/result' }),
    'https://x.trycloudflare.com/client/payments/result?txnId=t1',
  );
  assert.equal(
    buildMomoRedirectUrl({ transactionId: 't1', staticFallback: 'http://localhost:5173/client/payments/result' }),
    'http://localhost:5173/client/payments/result?txnId=t1',
  );
});

test('createPaymentIntent sends the sanitized orderInfo and the per-request redirectUrl to MoMo', async () => {
  const original = axios.post;
  let sent: any;
  (axios as any).post = async (_url: string, body: unknown) => {
    sent = body;
    return { data: { resultCode: 0, message: 'ok', payUrl: 'https://test-payment.momo.vn/pay' } };
  };
  try {
    const r = await new MoMoProvider().createPaymentIntent({
      transactionId: 'txn-1',
      amount: 1000,
      orderInfo: `Goi hoi vien ${UUID}`,
      platform: 'mobile',
      returnBaseUrl: 'https://x.trycloudflare.com',
    });
    assert.equal(r.redirectUrl, 'https://test-payment.momo.vn/pay');
    assert.equal(sent.orderInfo, 'Thanh toan goi hoi vien');
    assert.equal(sent.redirectUrl, 'fitnessassistant://client/payments/result?txnId=txn-1');
    assert.ok(!JSON.stringify(sent).includes(UUID));
  } finally {
    (axios as any).post = original;
  }
});
