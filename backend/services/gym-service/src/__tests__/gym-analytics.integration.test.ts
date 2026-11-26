/**
 * REAL HTTP/API + DB test thật (BACKEND INTEGRATION, DB `*_test`) - dữ liệu biểu đồ cho chủ phòng tập.
 *
 *   GET /owner/gyms/:gymId/analytics?from&to
 *     heatmap   (thứ x giờ, giờ VN)               <- checkin.list
 *     sales     (theo ngày + theo gói, thẻ đã trả)  <- membership.full | membership.sales
 *     renewal   (tỷ lệ gia hạn + mới/quay lại)     <- membership.full | membership.sales
 *     netIncome (từ SỔ CÁI payment-service)        <- finance.wallet.view
 *
 * App Express THẬT với router /owner thật; auth-service giả (token -> user); payment-service giả (HTTP thật trên 127.0.0.1)
 * để kiểm gym-service CHỈ chuyển tiếp số của sổ cái (hợp đồng của payment-service được kiểm ở payment-service:
 * gym-membership-income.integration.test.ts). Mọi thứ còn lại là dữ liệu thật trong DB test.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import express from 'express';
import { localDateOf } from '../utils/local-day';

const SERVICE_SECRET = 'test_internal_service_secret_32_chars_minimum';
process.env.INTERNAL_SERVICE_SECRET = SERVICE_SECRET;
process.env.CHECKIN_TOKEN_SECRET = process.env.CHECKIN_TOKEN_SECRET || 'test_checkin_secret_32_chars_minimum_xx';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
const DAY = 864e5;

const id = {
  ownerA: randomUUID(), managerA1: randomUUID(), recepA1: randomUUID(), acctA: randomUUID(),
  ownerB: randomUUID(), customer: randomUUID(),
};
const TOKENS: Record<string, string> = {
  'tok-owner-a': id.ownerA, 'tok-manager-a1': id.managerA1, 'tok-recep-a1': id.recepA1, 'tok-acct-a': id.acctA, 'tok-owner-b': id.ownerB,
};
const USERS: Record<string, { id: string; role: string; email: string }> = Object.fromEntries(
  Object.entries(TOKENS).map(([tok, uid]) => [tok, { id: uid, role: 'GYM_OWNER', email: `${tok}@analytics.test` }]),
);
USERS['tok-customer'] = { id: id.customer, role: 'CUSTOMER', email: 'c@analytics.test' };

// a1: heatmap + sales + roles | a2: brand sibling | a3: renewal fixtures | a4: new/returning fixtures | b1: another partner's branch
const gym = { a1: randomUUID(), a2: randomUUID(), a3: randomUUID(), a4: randomUUID(), b1: randomUUID() };
const brand = { a: randomUUID(), b: randomUUID() };
const plan = { a1: randomUUID(), a2: randomUUID(), b: randomUUID() };
const partnerIds: string[] = [];

let authServer: http.Server;
let paymentServer: http.Server;
let appServer: http.Server;
let base = '';
let prisma: typeof import('../repositories/prisma').prisma;

// payment-service giả: ghi lại mọi lời gọi; trả đúng hình dạng của GET /internal/gyms/:gymId/membership-income
const paymentCalls: { url: string; secret: string | undefined }[] = [];
let paymentMode: 'ok' | 'down' = 'ok';
const LEDGER_DAILY = [
  { date: '2025-03-04', sales: 2, grossPrice: 1_400_000, gymShare: 1_260_000, feeAtSale: 140_000, referralCommission: 70_000, adjustments: 0, net: 1_190_000 },
  { date: '2025-03-07', sales: 0, grossPrice: 0, gymShare: 0, feeAtSale: 0, referralCommission: 0, adjustments: -315_000, net: -315_000 },
];
const LEDGER_TOTALS = { sales: 2, grossPrice: 1_400_000, gymShare: 1_260_000, feeAtSale: 140_000, referralCommission: 70_000, adjustments: -315_000, net: 875_000 };

test.before(async () => {
  if (!process.env.DATABASE_URL) return;

  authServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.method === 'POST' && req.url === '/auth/verify') {
        const user = USERS[String(req.headers.authorization || '').replace('Bearer ', '')];
        if (user) return res.end(JSON.stringify({ user }));
        res.writeHead(401);
        return res.end(JSON.stringify({ error: 'invalid' }));
      }
      if (req.method === 'POST' && req.url === '/auth/internal/users/batch') {
        const b = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        return res.end(JSON.stringify({ users: (b.userIds as string[]).map((uid) => ({ id: uid, email: 'x@y.test', firstName: 'Ten', lastName: uid.slice(0, 4) })) }));
      }
      return res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((r) => authServer.listen(0, '127.0.0.1', r));
  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${(authServer.address() as { port: number }).port}`;

  paymentServer = http.createServer((req, res) => {
    paymentCalls.push({ url: req.url || '', secret: req.headers['x-service-secret'] as string | undefined });
    res.setHeader('Content-Type', 'application/json');
    if (paymentMode === 'down') {
      res.writeHead(500);
      return res.end(JSON.stringify({ success: false }));
    }
    const m = /^\/internal\/gyms\/([^/]+)\/membership-income\?(.*)$/.exec(req.url || '');
    if (!m) {
      res.writeHead(404);
      return res.end('{}');
    }
    const q = new URLSearchParams(m[2]);
    return res.end(JSON.stringify({ success: true, data: { gymId: m[1], from: q.get('from'), to: q.get('to'), walletFound: true, daily: LEDGER_DAILY, totals: LEDGER_TOTALS } }));
  });
  await new Promise<void>((r) => paymentServer.listen(0, '127.0.0.1', r));
  process.env.PAYMENT_SERVICE_URL = `http://127.0.0.1:${(paymentServer.address() as { port: number }).port}`;
  delete process.env.PAYMENT_LAMBDA_NAME;

  prisma = (await import('../repositories/prisma')).prisma;

  const mkPartner = async (name: string) => {
    const p = await prisma.gymPartner.create({
      data: { legalName: `Analytics ${name} ${randomUUID().slice(0, 6)}`, contactEmail: `${randomUUID().slice(0, 8)}@analytics.test`, status: 'ACTIVE', verificationStatus: 'VERIFIED' },
    });
    partnerIds.push(p.id);
    return p.id;
  };
  const mkAcc = (partnerId: string, userId: string, role: any, scopedGymIds: string[]) =>
    prisma.gymPartnerAccount.create({
      data: { partnerId, userId, role, scopedGymIds, status: 'ACTIVE', activatedAt: new Date(), onboardingCompletedAt: new Date() },
    });

  await prisma.gymBrand.createMany({
    data: [
      { id: brand.a, ownerId: id.ownerA, name: 'Analytics Brand A' },
      { id: brand.b, ownerId: id.ownerB, name: 'Analytics Brand B' },
    ],
  });
  await prisma.gym.createMany({
    data: [
      { id: gym.a1, ownerId: id.ownerA, brandId: brand.a, name: 'An A1', address: '1 A St', status: 'APPROVED' },
      { id: gym.a2, ownerId: id.ownerA, brandId: brand.a, name: 'An A2', address: '2 A St', status: 'APPROVED' },
      { id: gym.a3, ownerId: id.ownerA, brandId: brand.a, name: 'An A3', address: '3 A St', status: 'APPROVED' },
      { id: gym.a4, ownerId: id.ownerA, brandId: brand.a, name: 'An A4', address: '4 A St', status: 'APPROVED' },
      { id: gym.b1, ownerId: id.ownerB, brandId: brand.b, name: 'An B1', address: '1 B St', status: 'APPROVED' },
    ],
  });
  const pA = await mkPartner('A');
  await mkAcc(pA, id.ownerA, 'OWNER', []);
  await mkAcc(pA, id.managerA1, 'MANAGER', [gym.a1]);
  await mkAcc(pA, id.recepA1, 'RECEPTIONIST', [gym.a1]);
  await mkAcc(pA, id.acctA, 'ACCOUNTANT', []);
  const pB = await mkPartner('B');
  await mkAcc(pB, id.ownerB, 'OWNER', []);

  await prisma.gymMembershipPlan.createMany({
    data: [
      { id: plan.a1, brandId: brand.a, name: 'Gói tháng', price: 700000, durationDays: 30, status: 'ACTIVE' },
      { id: plan.a2, brandId: brand.a, name: 'Gói quý', price: 1800000, durationDays: 90, status: 'ACTIVE' },
      { id: plan.b, brandId: brand.b, name: 'Gói B', price: 500000, durationDays: 30, status: 'ACTIVE' },
    ],
  });

  const ownerRoutes = (await import('../routes/owner.routes')).default;
  const app = express();
  app.use(express.json());
  app.use('/owner', ownerRoutes);
  appServer = http.createServer(app);
  await new Promise<void>((r) => appServer.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(appServer.address() as { port: number }).port}`;
});

test.after(async () => {
  if (!prisma) return;
  const gymIds = Object.values(gym);
  await prisma.gymCheckIn.deleteMany({ where: { gymId: { in: gymIds } } });
  await prisma.gymMembershipContract.deleteMany({ where: { gymId: { in: gymIds } } });
  await prisma.gymMembershipPlan.deleteMany({ where: { brandId: { in: Object.values(brand) } } });
  await prisma.gym.deleteMany({ where: { id: { in: gymIds } } });
  await prisma.gymBrand.deleteMany({ where: { id: { in: Object.values(brand) } } });
  await prisma.gymPartner.deleteMany({ where: { id: { in: partnerIds } } });
  await prisma.$disconnect();
  for (const s of [authServer, paymentServer, appServer]) await new Promise<void>((r) => s.close(() => r()));
});

async function get(token: string | null, path: string) {
  const res = await fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  let body: any = null;
  try { body = await res.json(); } catch { /* không phải JSON */ }
  return { status: res.status, body };
}

const OWNER = 'tok-owner-a', MANAGER = 'tok-manager-a1', RECEP = 'tok-recep-a1', ACCT = 'tok-acct-a';
// Tuần cố định trong quá khứ: thứ Hai 2025-03-03 .. Chủ nhật 2025-03-09 (giờ VN).
const WEEK = 'from=2025-03-03&to=2025-03-09';

async function mkMembership(gymId: string, planId: string, data: Record<string, unknown>) {
  return prisma.gymMembershipContract.create({
    data: { gymId, planId, clientId: randomUUID(), priceAtPurchase: 700000, durationDaysSnapshot: 30, ...data } as any,
  });
}

// ── 1. Phạm vi / quyền ────────────────────────────────────────────────────────────────────────────────────────
integrationTest('analytics · phạm vi: quản lý chỉ thấy chi nhánh được gán (403 GYM_OUT_OF_SCOPE); chi nhánh đối tác KHÁC → 403; id lạ → 404; không token → 401; khách → 403', async () => {
  assert.equal((await get(MANAGER, `/owner/gyms/${gym.a1}/analytics`)).status, 200);
  const out = await get(MANAGER, `/owner/gyms/${gym.a2}/analytics`);
  assert.equal(out.status, 403);
  assert.equal(out.body.error.code, 'GYM_OUT_OF_SCOPE');
  assert.equal(out.body.data, undefined, 'không lộ dữ liệu kèm lỗi');
  const other = await get(OWNER, `/owner/gyms/${gym.b1}/analytics`);
  assert.equal(other.status, 403);
  assert.equal(other.body.data, undefined);
  assert.equal((await get('tok-owner-b', `/owner/gyms/${gym.a1}/analytics`)).status, 403);
  assert.equal((await get(OWNER, `/owner/gyms/${randomUUID()}/analytics`)).status, 404);
  assert.equal((await get(null, `/owner/gyms/${gym.a1}/analytics`)).status, 401);
  assert.equal((await get('tok-customer', `/owner/gyms/${gym.a1}/analytics`)).status, 403);
});

integrationTest('analytics · từng vai trò chỉ nhận phần mình có quyền (fail-closed → null); lễ tân/quản lý KHÔNG làm gym-service gọi payment-service', async () => {
  paymentCalls.length = 0;
  const owner = (await get(OWNER, `/owner/gyms/${gym.a1}/analytics?${WEEK}`)).body.data;
  assert.ok(owner.heatmap && owner.sales && owner.renewal && owner.netIncome, 'chủ thấy cả bốn phần');
  assert.deepEqual(owner.unavailable, []);
  assert.equal(paymentCalls.length, 1);

  paymentCalls.length = 0;
  const mgr = (await get(MANAGER, `/owner/gyms/${gym.a1}/analytics?${WEEK}`)).body.data;
  assert.ok(mgr.heatmap && mgr.sales && mgr.renewal);
  assert.equal(mgr.netIncome, null, 'quản lý không có finance.wallet.view');

  const recep = (await get(RECEP, `/owner/gyms/${gym.a1}/analytics?${WEEK}`));
  assert.equal(recep.status, 200);
  assert.ok(recep.body.data.heatmap);
  assert.equal(recep.body.data.sales, null);
  assert.equal(recep.body.data.renewal, null);
  assert.equal(recep.body.data.netIncome, null);
  assert.equal(paymentCalls.length, 0, 'không có quyền tài chính thì không hỏi sổ cái');

  const acct = (await get(ACCT, `/owner/gyms/${gym.a1}/analytics?${WEEK}`)).body.data;
  assert.equal(acct.heatmap, null, 'kế toán không có checkin.list');
  assert.ok(acct.sales && acct.renewal && acct.netIncome);
  assert.equal(paymentCalls.length, 1);

  // Lễ tân ở chi nhánh ngoài phạm vi bị chặn.
  assert.equal((await get(RECEP, `/owner/gyms/${gym.a2}/analytics`)).status, 403);
  // Không phần nào mang danh tính hội viên.
  const text = JSON.stringify(owner);
  assert.ok(!/clientId|clientName|email/i.test(text), 'không lộ danh tính');
});

// ── 2. Khoảng ngày ───────────────────────────────────────────────────────────────────────────────────────────
integrationTest('analytics · khoảng ngày như /stats: mặc định 7 ngày; 92 → 92 điểm; 93 → 400 RANGE_TOO_LARGE; from > to / định dạng / ngày không có thật → 400', async () => {
  const def = (await get(OWNER, `/owner/gyms/${gym.a1}/analytics`)).body.data;
  assert.equal(def.sales.daily.length, 7);
  assert.equal(def.timeZone, 'Asia/Ho_Chi_Minh');
  assert.equal(def.to, def.today);
  const ok = await get(OWNER, `/owner/gyms/${gym.a1}/analytics?from=2025-01-01&to=2025-04-02`);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.sales.daily.length, 92);
  assert.equal(ok.body.data.renewal.newVsReturning.daily.length, 92);
  assert.equal(ok.body.data.netIncome.daily.length, 92);
  const big = await get(OWNER, `/owner/gyms/${gym.a1}/analytics?from=2025-01-01&to=2025-04-03`);
  assert.equal(big.status, 400);
  assert.equal(big.body.error.code, 'RANGE_TOO_LARGE');
  assert.equal((await get(OWNER, `/owner/gyms/${gym.a1}/analytics?from=2025-03-09&to=2025-03-01`)).body.error.code, 'INVALID_RANGE');
  assert.equal((await get(OWNER, `/owner/gyms/${gym.a1}/analytics?from=banana`)).body.error.code, 'INVALID_QUERY');
  assert.equal((await get(OWNER, `/owner/gyms/${gym.a1}/analytics?from=2025-02-31&to=2025-03-05`)).body.error.code, 'INVALID_QUERY');
});

// ── 3. Giờ cao điểm: ranh giới ngày/giờ VN ─────────────────────────────────────────────────────────────────────
integrationTest('analytics · heatmap: ngày/giờ theo giờ VN (23:59:59.999 và 00:00:00.000 +07:00, lệch ngày UTC), chặn đầu/cuối khoảng, tổng = /stats', async () => {
  const mem = await mkMembership(gym.a1, plan.a1, { status: 'EXPIRED', paymentTxnId: 'TXN-HEAT', startDate: new Date('2025-02-01T00:00:00Z'), endDate: new Date('2025-03-01T00:00:00Z'), createdAt: new Date('2025-02-01T00:00:00Z') });
  const at = (iso: string) => ({ membershipId: mem.id, gymId: gym.a1, clientId: mem.clientId, checkedInBy: mem.clientId, createdAt: new Date(iso) });
  await prisma.gymCheckIn.createMany({
    data: [
      at('2025-03-02T16:59:59.999Z'), // Chủ nhật 2025-03-02 23:59:59.999 VN: NGOÀI khoảng (trước thứ Hai)
      at('2025-03-02T17:00:00.000Z'), // Thứ Hai 2025-03-03 00:00:00.000 VN -> weekday 1, giờ 0 (ngày UTC của nó vẫn là Chủ nhật)
      at('2025-03-03T16:59:59.999Z'), // Thứ Hai 23:59:59.999 VN -> weekday 1, giờ 23
      at('2025-03-03T17:00:00.000Z'), // Thứ Ba 00:00:00.000 VN -> weekday 2, giờ 0
      at('2025-03-05T05:30:00.000Z'), // Thứ Tư 12:30 VN -> weekday 3, giờ 12
      at('2025-03-05T05:45:00.000Z'), // Thứ Tư 12:45 VN
      at('2025-03-12T05:10:00.000Z'), // Thứ Tư tuần sau, nhưng NGOÀI khoảng
      at('2025-03-09T16:59:59.999Z'), // Chủ nhật 2025-03-09 23:59:59.999 VN -> weekday 7, giờ 23
      at('2025-03-09T17:00:00.000Z'), // Thứ Hai 2025-03-10 00:00:00.000 VN: NGOÀI khoảng (sau Chủ nhật)
    ],
  });
  await prisma.gymCheckIn.createMany({ data: [at('2025-03-05T05:59:59.999Z'), at('2025-03-05T06:00:00.000Z')] }); // 12:59:59.999 -> giờ 12; 13:00:00.000 -> giờ 13

  const r = await get(OWNER, `/owner/gyms/${gym.a1}/analytics?${WEEK}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const h = r.body.data.heatmap;
  assert.equal(h.matrix.length, 7);
  assert.ok(h.matrix.every((row: number[]) => row.length === 24));
  assert.equal(h.total, 8);
  assert.equal(h.matrix[0][0], 1, 'Thứ Hai 00:00 VN');
  assert.equal(h.matrix[0][23], 1, 'Thứ Hai 23:59:59.999 VN');
  assert.equal(h.matrix[1][0], 1, 'Thứ Ba 00:00 VN');
  assert.equal(h.matrix[2][12], 3, 'Thứ Tư giờ 12 (12:30, 12:45, 12:59:59.999)');
  assert.equal(h.matrix[2][13], 1, 'Thứ Tư 13:00:00.000 -> giờ 13');
  assert.equal(h.matrix[6][23], 1, 'Chủ nhật 23:59:59.999 VN');
  assert.deepEqual(h.byWeekday, [2, 1, 4, 0, 0, 0, 1]);
  assert.equal(h.byHour[12], 3);
  assert.equal(h.byHour[0], 2);
  assert.equal(h.byHour[23], 2);
  assert.equal(h.byHour.reduce((a: number, b: number) => a + b, 0), 8);
  assert.deepEqual(h.peak, { weekday: 3, hour: 12, count: 3 });
  // Cùng một dãy dòng với /stats: hai con số phải bằng nhau.
  const stats = await get(OWNER, `/owner/gyms/${gym.a1}/stats?${WEEK}`);
  assert.equal(stats.body.data.checkins.total, h.total);
  // Khoảng không có lượt nào: ma trận toàn 0, không có đỉnh.
  const empty = (await get(OWNER, `/owner/gyms/${gym.a1}/analytics?from=2020-01-01&to=2020-01-07`)).body.data.heatmap;
  assert.equal(empty.total, 0);
  assert.equal(empty.peak, null);
  assert.ok(empty.matrix.every((row: number[]) => row.every((n) => n === 0)));
  // Chi nhánh khác của cùng đối tác không lẫn số.
  assert.equal((await get(OWNER, `/owner/gyms/${gym.a2}/analytics?${WEEK}`)).body.data.heatmap.total, 0);
});

// ── 4. Doanh số: đúng định nghĩa của trang Tài chính ────────────────────────────────────────────────────────────
integrationTest('analytics · sales: chỉ ACTIVE + EXPIRED, REAL, theo ngày VN của lúc mua; tổng và số thẻ KHỚP định nghĩa "doanh số" của trang Tài chính trên /memberships', async () => {
  const mk = (status: string, planId: string, price: number, createdAt: string, extra: Record<string, unknown> = {}) =>
    mkMembership(gym.a1, planId, { status, priceAtPurchase: price, createdAt: new Date(createdAt), paymentTxnId: `T-${randomUUID().slice(0, 6)}`, startDate: new Date(createdAt), endDate: new Date(new Date(createdAt).getTime() + 30 * DAY), ...extra });
  // Tính vào doanh số
  await mk('ACTIVE', plan.a1, 700000, '2025-03-03T00:00:00.000Z');   // 07:00 VN thứ Hai 03/03
  await mk('EXPIRED', plan.a1, 700000, '2025-03-03T16:59:59.999Z');  // 23:59:59.999 VN thứ Hai 03/03 (còn ngày 03)
  await mk('ACTIVE', plan.a2, 1800000, '2025-03-03T17:00:00.000Z');  // 00:00:00.000 VN thứ Ba 04/03 (ngày UTC vẫn là 03)
  await mk('EXPIRED', plan.a2, 1800000, '2025-03-09T16:59:59.999Z'); // 23:59:59.999 VN Chủ nhật 09/03 (ngày cuối, còn trong khoảng)
  // Không tính: trạng thái chưa trả / huỷ / có vấn đề, thẻ mẫu, ngoài khoảng (trước và sau)
  await mk('PENDING_PAYMENT', plan.a1, 700000, '2025-03-05T05:00:00.000Z');
  await mk('PENDING_ISSUE', plan.a1, 700000, '2025-03-05T05:00:00.000Z');
  await mk('CANCELLED', plan.a1, 700000, '2025-03-05T05:00:00.000Z');
  await mk('ACTIVE', plan.a1, 700000, '2025-03-05T05:00:00.000Z', { dataOrigin: 'SYNTHETIC' });
  await mk('ACTIVE', plan.a1, 700000, '2025-03-02T16:59:59.999Z');   // 23:59:59.999 VN Chủ nhật 02/03: trước khoảng
  await mk('ACTIVE', plan.a1, 700000, '2025-03-09T17:00:00.000Z');   // 00:00:00.000 VN thứ Hai 10/03: sau khoảng
  await mkMembership(gym.a2, plan.a1, { status: 'ACTIVE', priceAtPurchase: 999999, createdAt: new Date('2025-03-05T05:00:00.000Z'), paymentTxnId: 'T-A2' }); // chi nhánh khác

  const r = await get(OWNER, `/owner/gyms/${gym.a1}/analytics?${WEEK}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = r.body.data.sales;
  assert.deepEqual(s.statusesCounted, ['ACTIVE', 'EXPIRED']);
  assert.equal(s.dateBasis, 'PURCHASE_DATE');
  assert.equal(s.daily.length, 7);
  const byDate = Object.fromEntries(s.daily.map((d: any) => [d.date, d]));
  assert.deepEqual(byDate['2025-03-03'], { date: '2025-03-03', count: 2, gross: 1400000 });
  assert.deepEqual(byDate['2025-03-04'], { date: '2025-03-04', count: 1, gross: 1800000 });
  assert.deepEqual(byDate['2025-03-09'], { date: '2025-03-09', count: 1, gross: 1800000 });
  assert.equal(byDate['2025-03-05'].count, 0, 'ngày chỉ có thẻ chưa trả / mẫu: 0');
  assert.deepEqual(s.total, { count: 4, gross: 5000000 });
  assert.deepEqual(s.byPlan, [
    { planId: plan.a2, name: 'Gói quý', count: 2, gross: 3600000 },
    { planId: plan.a1, name: 'Gói tháng', count: 2, gross: 1400000 },
  ]);
  assert.equal(s.byPlan.reduce((a: number, p: any) => a + p.gross, 0), s.total.gross);

  // ĐỐI CHIẾU với trang Tài chính: recognizedSales(listOwnedMemberships) = ACTIVE|EXPIRED, cộng Number(priceAtPurchase).
  // Trang đó không có ngày, nên lọc cùng khoảng theo createdAt; điểm khác DUY NHẤT là nó không loại dòng SYNTHETIC (chi nhánh thật không có).
  const list = (await get(OWNER, `/owner/gyms/${gym.a1}/memberships`)).body.data as any[];
  const inRange = list.filter((m) => m.createdAt >= '2025-03-02T17:00:00.000Z' && m.createdAt < '2025-03-09T17:00:00.000Z');
  const financeRecognized = (rows: any[]) => {
    const paid = rows.filter((x) => x.status === 'ACTIVE' || x.status === 'EXPIRED');
    return { total: paid.reduce((sum, x) => sum + Number(x.priceAtPurchase || 0), 0), count: paid.length };
  };
  const finance = financeRecognized(inRange);
  const financeWithoutSynthetic = financeRecognized(inRange.filter((m) => m.dataOrigin !== 'SYNTHETIC'));
  assert.equal(finance.count, 5, 'trang Tài chính đếm cả thẻ mẫu');
  assert.deepEqual({ total: s.total.gross, count: s.total.count }, financeWithoutSynthetic);
  assert.equal(finance.total - financeWithoutSynthetic.total, 700000, 'chênh lệch đúng bằng thẻ SYNTHETIC');

  // Kế toán (membership.sales) nhận cùng số, không có danh tính.
  const acct = (await get(ACCT, `/owner/gyms/${gym.a1}/analytics?${WEEK}`)).body.data.sales;
  assert.deepEqual(acct.total, s.total);
  // Chi nhánh a2 không lẫn số của a1 và ngược lại.
  assert.equal((await get(OWNER, `/owner/gyms/${gym.a2}/analytics?${WEEK}`)).body.data.sales.total.gross, 999999);
});

// ── 5. Thu nhập ròng: chỉ chuyển tiếp sổ cái ──────────────────────────────────────────────────────────────────
integrationTest('analytics · netIncome: hỏi payment-service với service-secret và mốc 00:00 VN của from / 00:00 VN sau to; zero-fill; gym-service không tự tính lại', async () => {
  paymentCalls.length = 0;
  paymentMode = 'ok';
  const r = await get(OWNER, `/owner/gyms/${gym.a1}/analytics?${WEEK}`);
  const n = r.body.data.netIncome;
  assert.equal(paymentCalls.length, 1);
  assert.equal(paymentCalls[0].secret, SERVICE_SECRET);
  const u = new URL(paymentCalls[0].url, 'http://x');
  assert.equal(u.pathname, `/internal/gyms/${gym.a1}/membership-income`);
  assert.equal(u.searchParams.get('from'), '2025-03-02T17:00:00.000Z', '00:00 +07:00 của from, đúng instant UTC');
  assert.equal(u.searchParams.get('to'), '2025-03-09T17:00:00.000Z', '00:00 +07:00 của ngày sau to');
  assert.equal(n.source, 'PAYMENT_LEDGER');
  assert.equal(n.dateBasis, 'LEDGER_ENTRY_DATE');
  assert.equal(n.walletFound, true);
  assert.deepEqual(n.totals, LEDGER_TOTALS, 'tổng đi nguyên từ sổ cái');
  assert.equal(n.daily.length, 7);
  const byDate = Object.fromEntries(n.daily.map((d: any) => [d.date, d]));
  assert.deepEqual(byDate['2025-03-04'], LEDGER_DAILY[0]);
  assert.deepEqual(byDate['2025-03-07'], LEDGER_DAILY[1]);
  assert.deepEqual(byDate['2025-03-05'], { date: '2025-03-05', sales: 0, grossPrice: 0, gymShare: 0, feeAtSale: 0, referralCommission: 0, adjustments: 0, net: 0 });
  assert.equal(n.daily.reduce((s: number, d: any) => s + d.net, 0), LEDGER_TOTALS.net, 'chuỗi theo ngày cộng lại bằng tổng');
});

integrationTest('analytics · payment-service lỗi: netIncome = null kèm unavailable ["netIncome"], các phần khác vẫn trả (không bao giờ vẽ thành 0)', async () => {
  paymentMode = 'down';
  try {
    const r = await get(OWNER, `/owner/gyms/${gym.a1}/analytics?${WEEK}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.data.netIncome, null);
    assert.deepEqual(r.body.data.unavailable, ['netIncome']);
    assert.ok(r.body.data.heatmap && r.body.data.sales && r.body.data.renewal);
    // Vai trò không có quyền: null nhưng KHÔNG nằm trong unavailable.
    const mgr = (await get(MANAGER, `/owner/gyms/${gym.a1}/analytics?${WEEK}`)).body.data;
    assert.equal(mgr.netIncome, null);
    assert.deepEqual(mgr.unavailable, []);
  } finally {
    paymentMode = 'ok';
  }
});

// ── 6. Gia hạn: định nghĩa và các biên ─────────────────────────────────────────────────────────────────────────
integrationTest('analytics · renewal: thẻ kết thúc trong khoảng, "mua lại" cùng thương hiệu trong 30 ngày (biên, chồng lấn, huỷ, mẫu, thương hiệu khác, thẻ chưa hết)', async () => {
  const now = Date.now();
  const END60 = new Date(now - 60 * DAY);
  const END10 = new Date(now - 10 * DAY);
  const FAR = new Date(now + 300 * DAY);
  // M1 của một khách: thẻ đã hết hạn (EXPIRED) kết thúc tại `end`.
  const m1 = (clientId: string, end: Date, extra: Record<string, unknown> = {}) =>
    mkMembership(gym.a3, plan.a1, { clientId, status: 'EXPIRED', paymentTxnId: `T-${randomUUID().slice(0, 6)}`, startDate: new Date(end.getTime() - 30 * DAY), endDate: end, createdAt: new Date(end.getTime() - 30 * DAY), ...extra });
  // Thẻ kế tiếp bắt đầu tại `start`, kéo dài tới tương lai (nên không phải là thẻ "đã kết thúc").
  const next = (gymId: string, planId: string, clientId: string, start: Date, extra: Record<string, unknown> = {}) =>
    mkMembership(gymId, planId, { clientId, status: 'ACTIVE', paymentTxnId: `T-${randomUUID().slice(0, 6)}`, startDate: start, endDate: FAR, createdAt: new Date(Math.min(start.getTime(), now - DAY)), ...extra });
  const c = Array.from({ length: 12 }, () => randomUUID());

  await m1(c[0], END60); await next(gym.a3, plan.a1, c[0], END60);                                                         // c0: xếp chồng đúng lúc hết hạn, cùng chi nhánh -> gia hạn
  await m1(c[1], END60); await next(gym.a2, plan.a1, c[1], new Date(END60.getTime() + 30 * DAY));                         // c1: đúng BIÊN 30 ngày (bao gồm), chi nhánh khác cùng thương hiệu -> gia hạn (không cùng chi nhánh)
  await m1(c[2], END60); await next(gym.a3, plan.a1, c[2], new Date(END60.getTime() + 30 * DAY + 1000));                  // c2: trễ 1 giây ngoài biên -> KHÔNG
  await m1(c[3], END60); await next(gym.a3, plan.a1, c[3], new Date(END60.getTime() - DAY));                              // c3: thẻ mới bắt đầu trước khi thẻ cũ hết (chồng lấn kiểu cũ) -> KHÔNG
  await m1(c[4], END60); await next(gym.a3, plan.a1, c[4], END60, { status: 'CANCELLED' });                              // c4: thẻ kế tiếp bị huỷ/hoàn tiền -> KHÔNG
  await m1(c[5], END60); await next(gym.a3, plan.a1, c[5], END60, { dataOrigin: 'SYNTHETIC' });                           // c5: thẻ kế tiếp là dữ liệu mẫu -> KHÔNG
  await m1(c[6], END10);                                                                                                  // c6: mới hết 10 ngày, chưa gia hạn, cửa sổ còn mở -> "open"
  await m1(c[7], END10); await next(gym.a3, plan.a1, c[7], END10);                                                        // c7: hết 10 ngày trước nhưng đã xếp chồng -> gia hạn (chưa "settled")
  await mkMembership(gym.a3, plan.a1, { clientId: c[8], status: 'ACTIVE', paymentTxnId: 'T-RUN', startDate: new Date(now - 25 * DAY), endDate: new Date(now + 5 * DAY), createdAt: new Date(now - 25 * DAY) }); // c8: còn chạy -> không tính
  await m1(c[9], new Date(now - 40 * DAY), { status: 'CANCELLED' });                                                     // c9: thẻ đã huỷ -> không tính là "đã kết thúc"
  await m1(c[10], END60); await mkMembership(gym.b1, plan.b, { clientId: c[10], status: 'ACTIVE', paymentTxnId: 'T-B', startDate: END60, endDate: FAR, createdAt: new Date(now - DAY) }); // c10: mua ở thương hiệu KHÁC -> KHÔNG
  await m1(c[11], new Date(now + 2 * DAY), { status: 'ACTIVE' });                                                         // c11: sẽ hết trong tương lai (trong khoảng xin nhưng chưa xảy ra) -> không tính

  const from = localDateOf(new Date(now - 91 * DAY));
  const to = localDateOf(new Date(now + 3 * DAY));
  const r = await get(OWNER, `/owner/gyms/${gym.a3}/analytics?from=${from}&to=${to}`);
  assert.equal(r.status, 400, 'khoảng kéo dài sang tương lai vẫn phải tuân trần 92 ngày (95 ngày ở đây)');
  const r2 = await get(OWNER, `/owner/gyms/${gym.a3}/analytics?from=${localDateOf(new Date(now - 88 * DAY))}&to=${localDateOf(new Date(now + 3 * DAY))}`);
  assert.equal(r2.status, 200, JSON.stringify(r2.body));
  const rn = r2.body.data.renewal;
  assert.equal(rn.windowDays, 30);
  assert.equal(rn.scope, 'BRAND');
  // Đã kết thúc: c0..c7 và c10 = 9 thẻ (c8 còn chạy, c9 huỷ, c11 chưa hết, các thẻ "kế tiếp" kéo dài tới tương lai).
  assert.equal(rn.ended, 9);
  assert.equal(rn.renewed, 3, 'c0, c1, c7');
  assert.equal(rn.renewedSameBranch, 2, 'c0, c7 (c1 gia hạn ở chi nhánh khác của thương hiệu)');
  assert.equal(rn.settled, 7, 'c0..c5 + c10: cửa sổ 30 ngày đã đóng');
  assert.equal(rn.settledRenewed, 2, 'c0, c1');
  assert.equal(rn.open, 1, 'c6: chưa gia hạn, cửa sổ còn mở');
  assert.equal(rn.rate, 0.3333);
  assert.equal(rn.settledRate, 0.2857);
  // Chi nhánh khác của thương hiệu không thấy thẻ của a3 như thẻ "đã kết thúc" của mình.
  assert.equal((await get(OWNER, `/owner/gyms/${gym.a2}/analytics?from=${from}&to=${to}`)).status, 400);
  assert.equal((await get(OWNER, `/owner/gyms/${gym.a2}/analytics?from=${localDateOf(new Date(now - 88 * DAY))}&to=${localDateOf(new Date(now))}`)).body.data.renewal.ended, 0);
  // Kế toán nhận đúng cùng số.
  const acct = (await get(ACCT, `/owner/gyms/${gym.a3}/analytics?from=${localDateOf(new Date(now - 88 * DAY))}&to=${localDateOf(new Date(now + 3 * DAY))}`)).body.data.renewal;
  assert.equal(acct.ended, 9);
  assert.equal(acct.renewed, 3);
  // Không có thẻ nào kết thúc -> tỷ lệ null (không phải 0).
  const none = (await get(OWNER, `/owner/gyms/${gym.a4}/analytics?from=${localDateOf(new Date(now - 88 * DAY))}&to=${localDateOf(new Date(now))}`)).body.data.renewal;
  assert.equal(none.ended, 0);
  assert.equal(none.rate, null);
  assert.equal(none.settledRate, null);
});

integrationTest('analytics · renewal: khách mới và quay lại theo ngày VN (cùng thương hiệu, thẻ huỷ/mẫu/thương hiệu khác không tính là "trước đó", hoà thời điểm chỉ một thẻ là mới)', async () => {
  const now = Date.now();
  const at = (d: number) => new Date(now - d * DAY);
  const FAR = new Date(now + 300 * DAY);
  const mk = (gymId: string, clientId: string, createdAt: Date, extra: Record<string, unknown> = {}) =>
    mkMembership(gymId, gymId === gym.b1 ? plan.b : plan.a1, { clientId, status: 'EXPIRED', paymentTxnId: `T-${randomUUID().slice(0, 6)}`, startDate: createdAt, endDate: FAR, createdAt, ...extra });
  const [n1, n2, n3, n4, n5, n6, n7] = Array.from({ length: 7 }, () => randomUUID());

  await mk(gym.a4, n1, at(20));                                   // n1: lần đầu -> mới
  await mk(gym.a4, n1, at(5));                                    // n1: lần hai -> quay lại
  await mk(gym.a2, n2, at(30));                                   // n2: trước đó ở chi nhánh KHÁC cùng thương hiệu
  await mk(gym.a4, n2, at(3));                                    // n2: -> quay lại (phạm vi thương hiệu)
  await mk(gym.a4, n3, at(40), { status: 'CANCELLED' });          // n3: thẻ trước đó đã huỷ (không phải lần mua đã trả)
  await mk(gym.a4, n3, at(2));                                    // n3: -> mới
  await mk(gym.a4, n4, at(40), { dataOrigin: 'SYNTHETIC' });      // n4: thẻ trước đó là mẫu
  await mk(gym.a4, n4, at(2));                                    // n4: -> mới
  await mk(gym.b1, n5, at(40));                                   // n5: trước đó ở thương hiệu KHÁC
  await mk(gym.a4, n5, at(2));                                    // n5: -> mới
  const tie = at(1);
  await mkMembership(gym.a4, plan.a1, { id: '00000000-0000-4000-8000-0000000000a1', clientId: n6, status: 'EXPIRED', paymentTxnId: 'T-TIE1', startDate: tie, endDate: FAR, createdAt: tie });
  await mkMembership(gym.a4, plan.a1, { id: '00000000-0000-4000-8000-0000000000b2', clientId: n6, status: 'EXPIRED', paymentTxnId: 'T-TIE2', startDate: tie, endDate: FAR, createdAt: tie });
  await mk(gym.a4, n7, at(120));                                  // n7: lần đầu NGOÀI khoảng xin vẫn là "trước đó"
  await mk(gym.a4, n7, at(1));                                    // n7: -> quay lại

  const from = localDateOf(at(91));
  const to = localDateOf(new Date(now));
  const r = await get(OWNER, `/owner/gyms/${gym.a4}/analytics?from=${from}&to=${to}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const nvr = r.body.data.renewal.newVsReturning;
  assert.equal(nvr.daily.length, 92);
  const byDate = Object.fromEntries(nvr.daily.map((d: any) => [d.date, d]));
  assert.deepEqual(byDate[localDateOf(at(20))], { date: localDateOf(at(20)), new: 1, returning: 0 });
  assert.deepEqual(byDate[localDateOf(at(5))], { date: localDateOf(at(5)), new: 0, returning: 1 });
  assert.deepEqual(byDate[localDateOf(at(3))], { date: localDateOf(at(3)), new: 0, returning: 1 });
  assert.deepEqual(byDate[localDateOf(at(2))], { date: localDateOf(at(2)), new: 3, returning: 0 }, 'n3, n4, n5 đều là khách mới');
  assert.deepEqual(byDate[localDateOf(at(1))], { date: localDateOf(at(1)), new: 1, returning: 2 }, 'n6: một mới một quay lại; n7 quay lại');
  assert.equal(nvr.newMembers, 5);
  assert.equal(nvr.returningMembers, 4);
  // Tổng thẻ đã trả bán ra trong khoảng của chi nhánh = mới + quay lại (cùng một tập dòng với sales).
  assert.equal(r.body.data.sales.total.count, nvr.newMembers + nvr.returningMembers);
  assert.equal(r.body.data.renewal.ended, 0, 'mọi thẻ ở a4 còn chạy tới tương lai');
});
