/**
 * FH-5 follow-up - the client is told, in the app, that a LATE payment for an already-cancelled personalized order /
 * gym membership was refunded to their wallet, with the exact refunded amount.
 *
 * What is pinned here:
 *   - exactly one POST /internal/notifications to user-service per refunded transaction (recipient = the client, entity =
 *     the payment transaction, amount = the credited amount), however many times the callback / sweep / admin re-drives it
 *     and even when they race;
 *   - the notice is AFTER the refund and can never undo it: a user-service that answers 500 or drops the connection
 *     leaves the refund committed, activateOrRefund resolves 'REFUNDED', and the next re-drive sends the notice once;
 *   - a normal payment (activated) sends nothing.
 * The owning services (ai / gym / user) are one local HTTP server, so handleEvent -> settlePurchase -> callActivateEndpoint
 * -> refund -> notification all run for real against the isolated test database.
 *
 * BACKEND INTEGRATION. Run THIS FILE ALONE (it TRUNCATEs the shared ledger tables):
 *   DATABASE_URL="postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_payment_fhh_test?schema=public" \
 *   FITNESS_DISABLE_REDIS=true ./node_modules/.bin/tsx --test src/__tests__/fhh-auto-refund-notification.integration.test.ts
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import type { AddressInfo } from 'node:net';
import { isTestDatabaseUrl } from './support/test-db-guard';

const canUseIntegrationDb = isTestDatabaseUrl(process.env.DATABASE_URL || '');
const skipOpts = { skip: canUseIntegrationDb ? false : 'Requires DATABASE_URL pointing at a *_test database.' };

type Answer = { status: number; body: unknown } | 'DROP';
const calls: Array<{ path: string; body: any; secret: string | undefined }> = [];
let responder: (path: string, body: any) => Answer = () => ({ status: 200, body: { success: true } });

const NOT_ACTIVATABLE = (currentStatus: string): Answer => ({
  status: 409,
  body: { success: false, error: { code: 'NOT_ACTIVATABLE', message: `cannot be activated (status ${currentStatus})`, currentStatus } },
});
/** One answer for the activate endpoints, another for the notification endpoint. */
function answers(activate: Answer, notifications: Answer = { status: 200, body: { notification: { id: 'n1' } } }) {
  responder = (path) => (path === '/internal/notifications' ? notifications : activate);
}

const server = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    calls.push({ path: req.url ?? '', body, secret: req.headers['x-service-secret'] as string | undefined });
    const answer = responder(req.url ?? '', body);
    if (answer === 'DROP') return void req.socket.destroy();
    res.writeHead(answer.status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(answer.body));
  });
});
let serverReady: Promise<void> | undefined;
function startServer(): Promise<void> {
  serverReady ??= new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      process.env.AI_SERVICE_URL = url;
      process.env.GYM_SERVICE_URL = url;
      process.env.USER_SERVICE_URL = url;
      delete process.env.AI_LAMBDA_NAME;
      delete process.env.GYM_LAMBDA_NAME;
      delete process.env.USER_LAMBDA_NAME;
      resolve();
    });
  });
  return serverReady;
}

type Mods = {
  prisma: (typeof import('../repositories/prisma'))['prisma'];
  webhook: typeof import('../services/webhook.service');
  recon: typeof import('../services/reconciliation.service');
  notify: typeof import('../services/refund-notification.service');
  wallet: (typeof import('../services/wallet.service'))['walletService'];
};
let mods: Mods | undefined;
async function load(): Promise<Mods> {
  await startServer();
  if (!mods) {
    mods = {
      prisma: (await import('../repositories/prisma')).prisma,
      webhook: await import('../services/webhook.service'),
      recon: await import('../services/reconciliation.service'),
      notify: await import('../services/refund-notification.service'),
      wallet: (await import('../services/wallet.service')).walletService,
    };
  }
  return mods;
}

test.after(async () => {
  server.close();
  if (mods) await mods.prisma.$disconnect();
});

async function resetLedger(m: Mods) {
  await m.prisma.$executeRawUnsafe(
    'TRUNCATE wallet_ledger_entries, platform_commissions, partner_receivables, payment_transactions, wallets, ledger_operations RESTART IDENTITY CASCADE',
  );
  calls.length = 0;
  responder = () => ({ status: 200, body: { success: true } });
}

type Product = 'PERSONALIZED_SERVICE_PURCHASE' | 'GYM_MEMBERSHIP';
const PRODUCTS: Product[] = ['PERSONALIZED_SERVICE_PURCHASE', 'GYM_MEMBERSHIP'];

interface Checkout { product: Product; entityId: string; txnId: string; providerTxnId: string; price: number; client: string; partner: string }

async function checkout(m: Mods, product: Product, o: { id: string; partner: string; price?: number; client?: string }): Promise<Checkout> {
  const price = o.price ?? 500_000;
  const client = o.client ?? `client-${o.id}`;
  const providerTxnId = `vnpay_${randomUUID()}`;
  const isGym = product === 'GYM_MEMBERSHIP';
  const rates = isGym
    ? { platformRate: '0.1000', ptRate: '0', gymRate: '0.9000' }
    : { platformRate: '0.1000', ptRate: '0.9000', gymRate: '0' };
  const parties = isGym
    ? { ptUserId: o.partner, gymId: o.partner, clientUserId: client }
    : { ptUserId: o.partner, gymId: null, clientUserId: client };
  const txn = await m.prisma.paymentTransaction.create({
    data: {
      payerId: client,
      purpose: product,
      amount: price,
      currency: 'VND',
      status: 'PENDING',
      provider: 'VNPAY',
      providerTransactionId: providerTxnId,
      idempotencyKey: `checkout-${o.id}-${randomUUID()}`,
      relatedEntityType: product,
      relatedEntityId: o.id,
      activationStatus: 'PENDING',
      sourceService: 'integration-test',
      metadata: { rates, parties },
    },
  });
  return { product, entityId: o.id, txnId: txn.id, providerTxnId, price, client, partner: o.partner };
}

async function gatewayConfirms(m: Mods, c: Checkout) {
  await m.webhook.handleEvent({
    provider: 'VNPAY',
    providerEventId: `evt_${randomUUID()}`,
    providerTransactionId: c.providerTxnId,
    payload: {},
    status: 'PAID',
    paidAmountVnd: String(c.price),
  });
}

const txnRow = (m: Mods, c: Checkout) => m.prisma.paymentTransaction.findUniqueOrThrow({ where: { id: c.txnId } });
const notices = () => calls.filter((x) => x.path === '/internal/notifications');
async function clientAvailable(m: Mods, c: Checkout) {
  const w = await m.wallet.getOrCreateWallet('CLIENT', c.client);
  return (await m.prisma.wallet.findUniqueOrThrow({ where: { id: w.id } })).availableBalance.toFixed(2);
}

for (const product of PRODUCTS) {
  const what = product === 'GYM_MEMBERSHIP' ? 'gói hội viên' : 'đơn dịch vụ cá nhân hóa';

  test(`${product}: cancelled then paid -> the client gets ONE notice with the exact refunded amount`, skipOpts, async () => {
    const m = await load();
    await resetLedger(m);
    const c = await checkout(m, product, { id: 'target-1', partner: 'partner-1', price: 500_000 });
    answers(NOT_ACTIVATABLE('CANCELLED'));

    await gatewayConfirms(m, c);
    await m.notify.drainRefundNotifications();

    assert.equal(await clientAvailable(m, c), '500000.00', 'refund committed');
    assert.equal(notices().length, 1, 'exactly one notification');
    const n = notices()[0];
    assert.equal(n.secret, process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production');
    assert.equal(n.body.userId, c.client);
    assert.equal(n.body.eventType, 'PAYMENT_AUTO_REFUNDED');
    assert.equal(n.body.entityType, 'PAYMENT');
    assert.equal(n.body.entityId, c.txnId);
    assert.equal(n.body.link, '/client/wallet');
    assert.match(n.body.text.replace(/\s/g, ' '), /hoàn 500\.000đ vào ví/);
    assert.ok(n.body.text.includes(what), `names what was bought: ${n.body.text}`);
    assert.doesNotMatch(n.body.text, /[0-9a-f]{8}-[0-9a-f]{4}-|[A-Z]{3,}_[A-Z]/, 'no ids or enums in the text');

    const t = await txnRow(m, c);
    const note = (t.metadata as any).unactivatedRefund;
    assert.ok(note.notifiedAt, 'sent is recorded on the refund marker');
    assert.equal(note.amount, '500000.00', 'the marker the ledger wrote is untouched');
    assert.ok((t.metadata as any).parties && (t.metadata as any).rates, 'frozen snapshot preserved');
    assert.equal(t.activationStatus, 'ACTIVATION_FAILED');
  });

  test(`${product}: duplicate callbacks, admin re-drives and a race still send ONE notice`, skipOpts, async () => {
    const m = await load();
    await resetLedger(m);
    const c = await checkout(m, product, { id: 'target-dup', partner: 'partner-dup', price: 750_000 });
    answers(NOT_ACTIVATABLE('CANCELLED'));
    const stale = await txnRow(m, c); // PAID/PENDING row as a racing caller would still see it

    await gatewayConfirms(m, c);
    await m.notify.drainRefundNotifications();
    assert.equal(notices().length, 1);

    // a late duplicate of the SAME gateway callback, and three re-drives (some from the stale pre-refund row)
    await gatewayConfirms(m, c);
    assert.equal(await m.recon.activateOrRefund(await txnRow(m, c)), 'REFUNDED');
    await Promise.all([m.recon.activateOrRefund(stale), m.recon.activateOrRefund(stale), m.recon.activateOrRefund(stale)]);
    await m.notify.drainRefundNotifications();

    assert.equal(notices().length, 1, 'still exactly one notification');
    assert.equal(await clientAvailable(m, c), '750000.00', 'and the client was refunded once');
  });

  test(`${product}: user-service failing never blocks or rolls back the refund; the next re-drive sends the notice once`, skipOpts, async () => {
    const m = await load();
    await resetLedger(m);
    const c = await checkout(m, product, { id: 'target-fail', partner: 'partner-fail', price: 500_000 });

    for (const down of [{ status: 500, body: { error: 'boom' } } as Answer, 'DROP' as Answer]) {
      await resetLedger(m);
      const cc = await checkout(m, product, { id: `target-fail-${typeof down === 'string' ? 'drop' : down.status}`, partner: 'partner-fail', price: 500_000 });
      answers(NOT_ACTIVATABLE('CANCELLED'), down);

      await gatewayConfirms(m, cc); // must not throw
      await m.notify.drainRefundNotifications();

      assert.equal(await clientAvailable(m, cc), '500000.00', 'refund committed despite the notification failing');
      const t = await txnRow(m, cc);
      assert.equal(t.activationStatus, 'ACTIVATION_FAILED', 'the refund marker committed');
      assert.equal((t.metadata as any).unactivatedRefund.notifiedAt, undefined, 'not recorded as sent');
      assert.equal((t.metadata as any).unactivatedRefund.notificationClaimedAt, undefined, 'the claim was released for the retry');
      assert.equal(await m.recon.activateOrRefund(await txnRow(m, cc)), 'REFUNDED', 'a failed notice does not fail activateOrRefund');

      // user-service is back: the next pass over this transaction sends it, once.
      calls.length = 0;
      answers(NOT_ACTIVATABLE('CANCELLED'));
      await m.recon.activateOrRefund(await txnRow(m, cc));
      await m.recon.activateOrRefund(await txnRow(m, cc));
      await m.notify.drainRefundNotifications();
      assert.equal(notices().length, 1);
      assert.equal(notices()[0].body.entityId, cc.txnId);
      assert.ok(((await txnRow(m, cc)).metadata as any).unactivatedRefund.notifiedAt);
      assert.equal(await clientAvailable(m, cc), '500000.00', 'still refunded exactly once');
    }
    void c;
  });

  test(`${product}: a normal payment (activated) sends no refund notice`, skipOpts, async () => {
    const m = await load();
    await resetLedger(m);
    const c = await checkout(m, product, { id: 'target-ok', partner: 'partner-ok', price: 1_000_000 });
    answers({ status: 200, body: { success: true } });

    await gatewayConfirms(m, c);
    await m.notify.drainRefundNotifications();

    assert.equal(notices().length, 0);
    assert.equal(await clientAvailable(m, c), '0.00');
    assert.equal((await txnRow(m, c)).activationStatus, 'ACTIVATED');
  });
}

test('notice text: exact amount, what it was for, and an honest open remainder on a partial refund', () => {
  return import('../services/refund-notification.service').then(({ autoRefundNoticeText }) => {
    const norm = (s: string) => s.replace(/\s/g, ' ');
    assert.equal(
      norm(autoRefundNoticeText({ relatedEntityType: 'GYM_MEMBERSHIP', refunded: '500000.00' })),
      'Thanh toán của bạn đến sau khi gói hội viên đã bị hủy nên hệ thống đã hoàn 500.000đ vào ví của bạn.',
    );
    assert.match(norm(autoRefundNoticeText({ relatedEntityType: 'PERSONALIZED_SERVICE_PURCHASE', refunded: '1234567.00' })), /đơn dịch vụ cá nhân hóa .* hoàn 1\.234\.567đ/);
    assert.match(norm(autoRefundNoticeText({ relatedEntityType: 'PT_CONTRACT', refunded: '300000.00', unpaid: '200000.00' })), /hoàn 300\.000đ.*Phần còn lại 200\.000đ đang được bộ phận hỗ trợ xử lý/);
    assert.match(autoRefundNoticeText({ relatedEntityType: null, refunded: '10.00' }), /đơn hàng/);
  });
});
