/**
 * REAL HTTP/API + DB test thật (BACKEND INTEGRATION, DB `*_test`) — Item 4: KPI chính xác và mở rộng được.
 *
 *   GET /owner/gyms/:gymId/stats?from&to          (đếm check-in theo NGÀY VN trong SQL + hội viên đang chạy / sắp hết hạn)
 *   GET /owner/gyms/:gymId/memberships?limit&cursor&status&expiringBefore   (phân trang cursor, cộng thêm - gọi cũ vẫn chạy)
 *
 * Dựng app Express THẬT với router /owner thật; auth-service giả (token → user); mọi thứ còn lại là dữ liệu thật trong DB test.
 * Kiểm:
 *   • phạm vi: quản lý chỉ thấy chi nhánh được gán (403 GYM_OUT_OF_SCOPE), chi nhánh của đối tác KHÁC → 403, id lạ → 404;
 *     lễ tân / kế toán chỉ nhận khối dữ liệu mình có quyền đọc ở route láng giềng; khách hàng bị chặn ở tầng vai trò;
 *   • đối tác bị TẠM KHOÁ: chủ và kế toán bị chặn, quản lý vẫn xem được (đúng partner-access.policy);
 *   • ranh giới ngày VN (23:59:59.999 / 00:00:00.000 +07:00, và lệch với ngày UTC), đếm đúng khi > 50 lượt/ngày
 *     (danh sách check-in bị cắt ở 50 dòng - đây là lý do tồn tại của endpoint);
 *   • trần 92 ngày;
 *   • phân trang: không trùng/sót dòng, filter status / expiringBefore, gọi không tham số vẫn trả mảng.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'crypto';
import express from 'express';
import { localDayWindow, localDateOf } from '../utils/local-day';

const SERVICE_SECRET = 'test_internal_service_secret_32_chars_minimum';
process.env.INTERNAL_SERVICE_SECRET = SERVICE_SECRET;
process.env.CHECKIN_TOKEN_SECRET = process.env.CHECKIN_TOKEN_SECRET || 'test_checkin_secret_32_chars_minimum_xx';

const integrationTest = process.env.DATABASE_URL ? test : test.skip;
const DAY = 864e5;

const id = {
  ownerA: randomUUID(), managerA1: randomUUID(), recepA1: randomUUID(), acctA: randomUUID(),
  ownerB: randomUUID(),
  ownerS: randomUUID(), managerS: randomUUID(), acctS: randomUUID(), // đối tác bị tạm khoá
  customer: randomUUID(),
};
const TOKENS: Record<string, string> = {
  'tok-owner-a': id.ownerA, 'tok-manager-a1': id.managerA1, 'tok-recep-a1': id.recepA1, 'tok-acct-a': id.acctA,
  'tok-owner-b': id.ownerB,
  'tok-owner-s': id.ownerS, 'tok-manager-s': id.managerS, 'tok-acct-s': id.acctS,
};
const USERS: Record<string, { id: string; role: string; email: string }> = Object.fromEntries(
  Object.entries(TOKENS).map(([tok, uid]) => [tok, { id: uid, role: 'GYM_OWNER', email: `${tok}@stats.test` }]),
);
USERS['tok-customer'] = { id: id.customer, role: 'CUSTOMER', email: 'c@stats.test' };

const gym = { a1: randomUUID(), a2: randomUUID(), b1: randomUUID(), s1: randomUUID() };
const brand = { a: randomUUID(), b: randomUUID(), s: randomUUID() };
const plan = { a: randomUUID(), s: randomUUID() };
const partnerIds: string[] = [];

let authServer: http.Server;
let appServer: http.Server;
let base = '';
let prisma: typeof import('../repositories/prisma').prisma;

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

  prisma = (await import('../repositories/prisma')).prisma;

  const mkPartner = async (name: string, status: 'ACTIVE' | 'SUSPENDED' = 'ACTIVE') => {
    const p = await prisma.gymPartner.create({
      data: { legalName: `Stats ${name} ${randomUUID().slice(0, 6)}`, contactEmail: `${randomUUID().slice(0, 8)}@stats.test`, status, verificationStatus: 'VERIFIED' },
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
      { id: brand.a, ownerId: id.ownerA, name: 'Stats Brand A' },
      { id: brand.b, ownerId: id.ownerB, name: 'Stats Brand B' },
      { id: brand.s, ownerId: id.ownerS, name: 'Stats Brand S' },
    ],
  });
  await prisma.gym.createMany({
    data: [
      { id: gym.a1, ownerId: id.ownerA, brandId: brand.a, name: 'Stats A1', address: '1 A St', status: 'APPROVED' },
      { id: gym.a2, ownerId: id.ownerA, brandId: brand.a, name: 'Stats A2', address: '2 A St', status: 'APPROVED' },
      { id: gym.b1, ownerId: id.ownerB, brandId: brand.b, name: 'Stats B1', address: '1 B St', status: 'APPROVED' },
      { id: gym.s1, ownerId: id.ownerS, brandId: brand.s, name: 'Stats S1', address: '1 S St', status: 'APPROVED' },
    ],
  });
  const pA = await mkPartner('A');
  await mkAcc(pA, id.ownerA, 'OWNER', []);
  await mkAcc(pA, id.managerA1, 'MANAGER', [gym.a1]);
  await mkAcc(pA, id.recepA1, 'RECEPTIONIST', [gym.a1]);
  await mkAcc(pA, id.acctA, 'ACCOUNTANT', []);
  const pB = await mkPartner('B');
  await mkAcc(pB, id.ownerB, 'OWNER', []);
  const pS = await mkPartner('S', 'SUSPENDED');
  await mkAcc(pS, id.ownerS, 'OWNER', []);
  await mkAcc(pS, id.managerS, 'MANAGER', [gym.s1]);
  await mkAcc(pS, id.acctS, 'ACCOUNTANT', []);

  await prisma.gymMembershipPlan.createMany({
    data: [
      { id: plan.a, brandId: brand.a, name: 'Gói tháng', price: 700000, durationDays: 30, status: 'ACTIVE' },
      { id: plan.s, brandId: brand.s, name: 'Gói tháng S', price: 700000, durationDays: 30, status: 'ACTIVE' },
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
  for (const s of [authServer, appServer]) await new Promise<void>((r) => s.close(() => r()));
});

async function get(token: string | null, path: string) {
  const res = await fetch(`${base}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  let body: any = null;
  try { body = await res.json(); } catch { /* không phải JSON */ }
  return { status: res.status, body };
}

const OWNER = 'tok-owner-a', MANAGER = 'tok-manager-a1', RECEP = 'tok-recep-a1', ACCT = 'tok-acct-a';

/** Một hội viên mỗi khách (ràng buộc: một khách chỉ có một thẻ mở ở một chi nhánh). */
async function mkMembership(gymId: string, planId: string, data: Record<string, unknown>) {
  return prisma.gymMembershipContract.create({
    data: { gymId, planId, clientId: randomUUID(), priceAtPurchase: 700000, durationDaysSnapshot: 30, ...data } as any,
  });
}

// ── 1. Phạm vi / quyền ────────────────────────────────────────────────────────────────────────────────────────
integrationTest('stats · phạm vi: quản lý chỉ thấy chi nhánh được gán; chi nhánh khác trong cùng đối tác → 403 GYM_OUT_OF_SCOPE', async () => {
  const ok = await get(MANAGER, `/owner/gyms/${gym.a1}/stats`);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const out = await get(MANAGER, `/owner/gyms/${gym.a2}/stats`);
  assert.equal(out.status, 403);
  assert.equal(out.body.error.code, 'GYM_OUT_OF_SCOPE');
  assert.equal(out.body.data, undefined, 'không lộ dữ liệu kèm lỗi');
});

integrationTest('stats · chi nhánh của đối tác KHÁC → 403; id không tồn tại → 404; không token → 401; khách hàng → 403', async () => {
  const other = await get(OWNER, `/owner/gyms/${gym.b1}/stats`);
  assert.equal(other.status, 403);
  assert.equal(other.body.data, undefined);
  const ghost = await get(OWNER, `/owner/gyms/${randomUUID()}/stats`);
  assert.equal(ghost.status, 404);
  assert.equal((await get(null, `/owner/gyms/${gym.a1}/stats`)).status, 401);
  assert.equal((await get('tok-customer', `/owner/gyms/${gym.a1}/stats`)).status, 403);
  // Chủ B không đọc được chi nhánh của A theo chiều ngược lại.
  assert.equal((await get('tok-owner-b', `/owner/gyms/${gym.a1}/stats`)).status, 403);
});

integrationTest('stats · từng vai trò chỉ nhận khối dữ liệu mình có quyền đọc: lễ tân chỉ check-in, kế toán chỉ hội viên', async () => {
  const owner = await get(OWNER, `/owner/gyms/${gym.a1}/stats`);
  assert.ok(owner.body.data.checkins && owner.body.data.memberships);
  const manager = await get(MANAGER, `/owner/gyms/${gym.a1}/stats`);
  assert.ok(manager.body.data.checkins && manager.body.data.memberships);
  const recep = await get(RECEP, `/owner/gyms/${gym.a1}/stats`);
  assert.equal(recep.status, 200);
  assert.ok(recep.body.data.checkins);
  assert.equal(recep.body.data.memberships, null);
  const acct = await get(ACCT, `/owner/gyms/${gym.a1}/stats`);
  assert.equal(acct.status, 200);
  assert.equal(acct.body.data.checkins, null);
  assert.ok(acct.body.data.memberships);
  // Lễ tân ở chi nhánh khác phạm vi bị chặn.
  assert.equal((await get(RECEP, `/owner/gyms/${gym.a2}/stats`)).status, 403);
});

integrationTest('stats · đối tác bị TẠM KHOÁ: chủ và kế toán bị chặn PARTNER_SUSPENDED, quản lý vẫn xem được', async () => {
  for (const tok of ['tok-owner-s', 'tok-acct-s']) {
    const r = await get(tok, `/owner/gyms/${gym.s1}/stats`);
    assert.equal(r.status, 403, tok);
    assert.equal(r.body.error.code, 'PARTNER_SUSPENDED', tok);
    const list = await get(tok, `/owner/gyms/${gym.s1}/memberships`);
    assert.equal(list.status, 403, `${tok} memberships`);
  }
  const m = await get('tok-manager-s', `/owner/gyms/${gym.s1}/stats`);
  assert.equal(m.status, 200, JSON.stringify(m.body));
});

// ── 2. Ngày VN + đếm > 50 + trần 92 ngày ─────────────────────────────────────────────────────────────────────
integrationTest('stats · ranh giới ngày VN, 61 lượt trong một ngày (> 50 dòng của danh sách), hôm nay đúng, 7 ngày zero-fill', async () => {
  const mem = await mkMembership(gym.a1, plan.a, { status: 'ACTIVE', paymentTxnId: 'TXN-STAT-1', startDate: new Date(Date.now() - DAY), endDate: new Date(Date.now() + 40 * DAY) });
  const win = localDayWindow(); // [00:00 VN hôm nay, 00:00 VN ngày mai) tính bằng instant UTC
  const mk = (at: Date) => ({ membershipId: mem.id, gymId: gym.a1, clientId: mem.clientId, checkedInBy: mem.clientId, createdAt: at });
  const rows = [
    mk(new Date(win.start.getTime() - 1)),        // 23:59:59.999 VN hôm qua → hôm qua
    mk(new Date(win.start.getTime())),            // 00:00:00.000 VN hôm nay → hôm nay (ngày UTC của nó vẫn là HÔM QUA)
    mk(new Date(win.start.getTime() + 12 * 36e5)),// 12:00 VN hôm nay
    mk(new Date(win.end.getTime() - 1)),          // 23:59:59.999 VN hôm nay → hôm nay
    mk(new Date(win.start.getTime() - DAY - 1)),  // 23:59:59.999 VN hôm kia → hôm kia
  ];
  for (let i = 0; i < 58; i++) rows.push(mk(new Date(win.start.getTime() + (i + 1) * 60_000))); // + 58 lượt nữa trong ngày hôm nay
  await prisma.gymCheckIn.createMany({ data: rows });

  // Hợp đồng cũ: danh sách check-in chỉ trả 50 dòng, nên KPI cũ không thể đúng.
  const list = await get(OWNER, `/owner/gyms/${gym.a1}/checkins`);
  assert.equal(list.body.data.length, 50);

  const r = await get(OWNER, `/owner/gyms/${gym.a1}/stats`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const d = r.body.data;
  assert.equal(d.timeZone, 'Asia/Ho_Chi_Minh');
  assert.equal(d.today, win.localDate);
  assert.equal(d.to, win.localDate);
  assert.equal(d.checkins.daily.length, 7);
  const byDate = Object.fromEntries(d.checkins.daily.map((x: any) => [x.date, x.count]));
  assert.equal(byDate[win.localDate], 61, 'hôm nay: 3 mốc biên/giữa + 58 lượt');
  assert.equal(d.checkins.today, 61);
  assert.equal(byDate[localDateOf(new Date(win.start.getTime() - 1))], 1, 'hôm qua: đúng một lượt 23:59:59.999');
  assert.equal(byDate[localDateOf(new Date(win.start.getTime() - DAY - 1))], 1, 'hôm kia: đúng một lượt 23:59:59.999');
  assert.equal(d.checkins.total, 63);
  // Ngày không có lượt vẫn có mặt với 0 (biểu đồ không thủng).
  assert.equal(d.checkins.daily.filter((x: any) => x.count === 0).length, 4);
  // Thứ tự tăng dần, liên tục.
  assert.deepEqual([...d.checkins.daily.map((x: any) => x.date)].sort(), d.checkins.daily.map((x: any) => x.date));
});

integrationTest('stats · "hôm nay" vẫn đúng khi khoảng xin không chứa hôm nay; khoảng xa trong quá khứ không có lượt → toàn 0', async () => {
  const win = localDayWindow();
  const past = await get(OWNER, `/owner/gyms/${gym.a1}/stats?from=2020-01-01&to=2020-01-10`);
  assert.equal(past.status, 200);
  assert.equal(past.body.data.checkins.daily.length, 10);
  assert.equal(past.body.data.checkins.total, 0);
  assert.equal(past.body.data.checkins.today, 61, 'today độc lập với khoảng đã xin');
  assert.equal(past.body.data.today, win.localDate);
});

integrationTest('stats · trần 92 ngày: 92 → 200 với đúng 92 điểm; 93 → 400 RANGE_TOO_LARGE; from > to / sai định dạng → 400', async () => {
  const ok = await get(OWNER, `/owner/gyms/${gym.a1}/stats?from=2026-08-22&to=2026-11-21`);
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.data.checkins.daily.length, 92);
  const big = await get(OWNER, `/owner/gyms/${gym.a1}/stats?from=2026-08-21&to=2026-11-21`);
  assert.equal(big.status, 400);
  assert.equal(big.body.error.code, 'RANGE_TOO_LARGE');
  const huge = await get(OWNER, `/owner/gyms/${gym.a1}/stats?from=2000-01-01&to=2026-11-21`);
  assert.equal(huge.status, 400);
  assert.equal(huge.body.error.code, 'RANGE_TOO_LARGE');
  assert.equal((await get(OWNER, `/owner/gyms/${gym.a1}/stats?from=2026-11-22&to=2026-11-01`)).body.error.code, 'INVALID_RANGE');
  assert.equal((await get(OWNER, `/owner/gyms/${gym.a1}/stats?from=banana`)).body.error.code, 'INVALID_QUERY');
});

// ── 3. Hội viên: đang chạy / sắp hết hạn / theo trạng thái ────────────────────────────────────────────────────
integrationTest('stats · hội viên: đang chạy, sắp hết hạn (≤ 7 ngày), thẻ đã quá hạn và thẻ xếp hàng chưa bắt đầu KHÔNG tính là đang chạy', async () => {
  const now = Date.now();
  const before = (await get(OWNER, `/owner/gyms/${gym.a1}/stats`)).body.data.memberships; // đã có 1 thẻ ACTIVE (+40 ngày) ở test trước
  await mkMembership(gym.a1, plan.a, { status: 'ACTIVE', paymentTxnId: 'T-EXP', startDate: new Date(now - 20 * DAY), endDate: new Date(now + 3 * DAY) });        // sắp hết hạn
  await mkMembership(gym.a1, plan.a, { status: 'ACTIVE', paymentTxnId: 'T-LAPSED', startDate: new Date(now - 40 * DAY), endDate: new Date(now - DAY) });        // đã quá hạn nhưng chưa quét
  await mkMembership(gym.a1, plan.a, { status: 'ACTIVE', paymentTxnId: 'T-QUEUED', startDate: new Date(now + 10 * DAY), endDate: new Date(now + 40 * DAY) });    // xếp hàng
  await mkMembership(gym.a1, plan.a, { status: 'PENDING_PAYMENT' });
  await mkMembership(gym.a1, plan.a, { status: 'EXPIRED', paymentTxnId: 'T-OLD', startDate: new Date(now - 60 * DAY), endDate: new Date(now - 30 * DAY) });
  await mkMembership(gym.a1, plan.a, { status: 'ACTIVE', dataOrigin: 'SYNTHETIC', paymentTxnId: 'T-SYN', startDate: new Date(now - DAY), endDate: new Date(now + 2 * DAY) }); // mẫu: không tính
  const after = (await get(OWNER, `/owner/gyms/${gym.a1}/stats`)).body.data.memberships;
  assert.equal(after.active - before.active, 1, 'chỉ thẻ sắp hết hạn là thêm một thẻ đang chạy');
  assert.equal(after.expiringSoon - before.expiringSoon, 1);
  assert.equal(after.expiringSoonDays, 7);
  assert.equal(after.byStatus.PENDING_PAYMENT, 1);
  assert.equal(after.byStatus.EXPIRED, 1);
  assert.equal(after.byStatus.ACTIVE - before.byStatus.ACTIVE, 3, 'ACTIVE theo trạng thái thô: sắp hết hạn + quá hạn + xếp hàng (SYNTHETIC không tính)');
  assert.equal(after.byStatus.CANCELLED, 0);
  assert.equal(after.byStatus.PENDING_ISSUE, 0);
  // Chi nhánh khác của cùng đối tác không lẫn số.
  const a2 = (await get(OWNER, `/owner/gyms/${gym.a2}/stats`)).body.data.memberships;
  assert.equal(a2.active, 0);
});

// ── 4. Phân trang danh sách hội viên ──────────────────────────────────────────────────────────────────────────
integrationTest('memberships · gọi cũ không limit/cursor vẫn trả MẢNG đầy đủ không giới hạn (+ meta cộng thêm); limit/cursor mới bật phân trang 200/500', async () => {
  const r = await get(OWNER, `/owner/gyms/${gym.a1}/memberships`);
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.data));
  assert.ok(r.body.data.length >= 7);
  assert.equal(r.body.meta.limit, null);
  assert.equal(r.body.meta.hasMore, false);
  assert.equal(r.body.meta.nextCursor, null);
  // Lọc mà không limit: vẫn không phân trang.
  assert.equal((await get(OWNER, `/owner/gyms/${gym.a1}/memberships?status=ACTIVE`)).body.meta.limit, null);
  // Chỉ cần có limit là bật phân trang với trần 500; mặc định 200 khi chỉ có cursor.
  assert.equal((await get(OWNER, `/owner/gyms/${gym.a1}/memberships?limit=3`)).body.data.length, 3);
  const cur = (await get(OWNER, `/owner/gyms/${gym.a1}/memberships?limit=3`)).body.meta.nextCursor;
  assert.equal((await get(OWNER, `/owner/gyms/${gym.a1}/memberships?cursor=${encodeURIComponent(cur)}`)).body.meta.limit, 200);
});

integrationTest('memberships · cursor: duyệt từng trang 2 dòng, không trùng, không sót, giữ thứ tự mới → cũ', async () => {
  const all = (await get(OWNER, `/owner/gyms/${gym.a1}/memberships`)).body.data as any[];
  const seen: string[] = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const r: any = await get(OWNER, `/owner/gyms/${gym.a1}/memberships?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.data.length <= 2);
    seen.push(...r.body.data.map((m: any) => m.id));
    cursor = r.body.meta.nextCursor;
    assert.equal(r.body.meta.hasMore, cursor !== null);
    pages++;
    assert.ok(pages < 50, 'phải kết thúc');
  } while (cursor);
  assert.equal(new Set(seen).size, seen.length, 'không trùng dòng giữa các trang');
  assert.deepEqual(seen, all.map((m) => m.id), 'cùng tập và cùng thứ tự với danh sách một lần');
  assert.ok(pages >= 4);
});

integrationTest('memberships · filter status và expiringBefore (chỉ thẻ còn hạn, hết trước mốc); tên khách chỉ cho chủ/quản lý', async () => {
  const active = await get(OWNER, `/owner/gyms/${gym.a1}/memberships?status=ACTIVE`);
  assert.ok(active.body.data.length >= 4 && active.body.data.every((m: any) => m.status === 'ACTIVE'));
  const pending = await get(OWNER, `/owner/gyms/${gym.a1}/memberships?status=PENDING_PAYMENT`);
  assert.equal(pending.body.data.length, 1);

  const soon = new Date(Date.now() + 7 * DAY).toISOString();
  const expiring = await get(OWNER, `/owner/gyms/${gym.a1}/memberships?status=ACTIVE&expiringBefore=${encodeURIComponent(soon)}`);
  assert.equal(expiring.status, 200);
  const ids = expiring.body.data.map((m: any) => m.paymentTxnId);
  assert.ok(ids.includes('T-EXP') && ids.includes('T-SYN'), JSON.stringify(ids)); // SYNTHETIC vẫn nằm trong danh sách thô (như trước đây), chỉ KPI mới loại
  assert.ok(!ids.includes('T-LAPSED'), 'thẻ đã quá hạn không phải "sắp hết hạn"');
  assert.ok(!ids.includes('T-QUEUED'));
  assert.ok(expiring.body.data.every((m: any) => new Date(m.endDate).getTime() > Date.now() && new Date(m.endDate).getTime() <= Date.parse(soon)));
  // FULL view có clientName; kế toán (SALES) không có clientId/clientName.
  assert.ok('clientName' in expiring.body.data[0]);
  const sales = await get(ACCT, `/owner/gyms/${gym.a1}/memberships?status=EXPIRED`);
  assert.equal(sales.status, 200);
  assert.ok(sales.body.data.length >= 1);
  assert.ok(sales.body.data.every((m: any) => !('clientId' in m) && !('clientName' in m)));
});

integrationTest('memberships · limit bị kẹp 500; tham số sai → 400; phạm vi/ranh giới đối tác giữ nguyên', async () => {
  assert.equal((await get(OWNER, `/owner/gyms/${gym.a1}/memberships?limit=100000`)).body.meta.limit, 500);
  for (const q of ['limit=0', 'limit=abc', 'status=NOPE', 'cursor=xxx', 'expiringBefore=soon']) {
    const r = await get(OWNER, `/owner/gyms/${gym.a1}/memberships?${q}`);
    assert.equal(r.status, 400, q);
    assert.equal(r.body.error.code, 'INVALID_QUERY', q);
  }
  assert.equal((await get(MANAGER, `/owner/gyms/${gym.a2}/memberships?limit=5`)).status, 403);
  assert.equal((await get(OWNER, `/owner/gyms/${gym.b1}/memberships?limit=5`)).status, 403);
  assert.equal((await get(RECEP, `/owner/gyms/${gym.a1}/memberships`)).status, 403);
});
