/**
 * BACKEND INTEGRATION (DB test thật + app Express THẬT với router /owner) — D15c: lễ tân check-in HỘ hội viên không
 * dùng được QR.
 *
 * Giả lập: auth-service (token → user, tên/e-mail/SĐT "bí mật", nhận e-mail OTP) và user-service (ảnh hồ sơ + dữ liệu
 * sức khoẻ "bí mật"). Mọi thứ còn lại là thật: DB, quyền theo vai trò/chi nhánh, khoá FOR UPDATE, mã luật dùng chung với QR.
 *
 * Kiểm: tra cứu (trường tối thiểu), 3 phương thức xác minh + cấu hình, luật gói (hết hạn / tạm khoá / hết buổi / sai
 * chi nhánh / chi nhánh đóng / trùng / trừ buổi như QR), idempotency + song song, OTP sai/hết hạn/quá số lần, ngoại lệ
 * duyệt/từ chối/hết hạn/tự duyệt, PT không check-in được, nhật ký chỉ-thêm, không trường cấm trong bất kỳ payload nào.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'crypto';
import express from 'express';

const SERVICE_SECRET = 'test_internal_service_secret_32_chars_minimum';
process.env.INTERNAL_SERVICE_SECRET = SERVICE_SECRET;
process.env.CHECKIN_TOKEN_SECRET = process.env.CHECKIN_TOKEN_SECRET || 'test_checkin_secret_32_chars_minimum_xx';
process.env.ASSISTED_CHECKIN_SEARCH_PER_MINUTE = '1000';
delete process.env.ASSISTED_CHECKIN_METHODS; // mặc định PHOTO_MATCH,MEMBER_OTP

const integrationTest = process.env.DATABASE_URL ? test : test.skip;

const id = {
  ownerA: randomUUID(), managerA: randomUUID(), recepA1: randomUUID(), recepA2: randomUUID(), acctA: randomUUID(),
  ownerB: randomUUID(), recepB: randomUUID(), pt: randomUUID(),
};
const TOKENS: Record<string, string> = {
  'tok-owner-a': id.ownerA, 'tok-manager-a': id.managerA, 'tok-recep-a1': id.recepA1, 'tok-recep-a2': id.recepA2,
  'tok-acct-a': id.acctA, 'tok-owner-b': id.ownerB, 'tok-recep-b': id.recepB,
};
const O = 'tok-owner-a', M = 'tok-manager-a', R1 = 'tok-recep-a1', R2 = 'tok-recep-a2', ACCT = 'tok-acct-a', OB = 'tok-owner-b', RB = 'tok-recep-b';

const gym = { a1: randomUUID(), a2: randomUUID(), a3closed: randomUUID(), b1: randomUUID() };
const brand = { a: randomUUID(), b: randomUUID() };
const plan = { a: randomUUID(), aVisits: randomUUID(), b: randomUUID() };
const partnerIds: string[] = [];

// Hồ sơ giả của "người ngoài" (hội viên): tên, e-mail, SĐT, ảnh. Điền động trong từng test.
const people = new Map<string, { name: string; email: string; phone: string; photo: string | null }>();
const sentMails: Array<{ to: string; subject: string; text: string }> = [];
let mailDown = false;
const SECRET_PHONE = '0988777666';
const SECRET_HEALTH = 'secret-health-note';

let authServer: http.Server;
let userServer: http.Server;
let appServer: http.Server;
let base = '';
let prisma: typeof import('../repositories/prisma').prisma;
let svc: typeof import('../services/assisted-checkin.service');
let checkinService: typeof import('../services/checkin.service').checkinService;
let signToken: typeof import('../utils/checkinToken').signGymCheckinToken;
const seenBodies: string[] = []; // mọi phản hồi của route assisted/tra cứu, để quét trường cấm ở cuối

test.before(async () => {
  if (!process.env.DATABASE_URL) return;

  authServer = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.method === 'POST' && req.url === '/auth/verify') {
        const tok = String(req.headers.authorization || '').replace('Bearer ', '');
        const uid = TOKENS[tok];
        if (uid) return res.end(JSON.stringify({ user: { id: uid, role: 'GYM_OWNER', email: `${tok}@staff.test` } }));
        res.writeHead(401);
        return res.end(JSON.stringify({ error: 'invalid' }));
      }
      if (req.url === '/auth/internal/send-email') {
        const b = JSON.parse(Buffer.concat(chunks).toString() || '{}');
        if (mailDown) {
          res.writeHead(500);
          return res.end(JSON.stringify({ error: 'smtp down' }));
        }
        sentMails.push({ to: b.to, subject: b.subject, text: b.text });
        return res.end(JSON.stringify({ delivered: true }));
      }
      if (req.url?.startsWith('/auth/internal/users/')) {
        const uid = decodeURIComponent(req.url.split('/').pop() || '');
        const p = people.get(uid);
        const [first, ...rest] = (p?.name ?? 'Nhân Viên Quầy').split(' ');
        return res.end(JSON.stringify({ user: { id: uid, email: p ? p.email : `staff-${uid.slice(0, 6)}@staff.test`, phone: p?.phone ?? SECRET_PHONE, firstName: first, lastName: rest.join(' ') || null, role: 'CUSTOMER', isActive: true } }));
      }
      return res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((r) => authServer.listen(0, '127.0.0.1', r));
  process.env.AUTH_SERVICE_URL = `http://127.0.0.1:${(authServer.address() as { port: number }).port}`;

  userServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    const m = /^\/internal\/profile\/([^/]+)$/.exec(req.url || '');
    if (m) {
      const p = people.get(decodeURIComponent(m[1]));
      // Hồ sơ đầy đủ như user-service thật: gym-service chỉ được giữ photoUrl.
      return res.end(JSON.stringify({ profile: { userId: m[1], photoUrl: p?.photo ?? null, currentWeight: 81.5, healthNotes: SECRET_HEALTH, injuries: 'knee', email: p?.email ?? null, phone: p?.phone ?? null } }));
    }
    return res.end(JSON.stringify({ clients: [] }));
  });
  await new Promise<void>((r) => userServer.listen(0, '127.0.0.1', r));
  process.env.USER_SERVICE_URL = `http://127.0.0.1:${(userServer.address() as { port: number }).port}`;

  prisma = (await import('../repositories/prisma')).prisma;
  svc = await import('../services/assisted-checkin.service');
  checkinService = (await import('../services/checkin.service')).checkinService;
  signToken = (await import('../utils/checkinToken')).signGymCheckinToken;

  await prisma.gymBrand.createMany({
    data: [
      { id: brand.a, ownerId: id.ownerA, name: 'Assist Brand A' },
      { id: brand.b, ownerId: id.ownerB, name: 'Assist Brand B' },
    ],
  });
  await prisma.gym.createMany({
    data: [
      { id: gym.a1, ownerId: id.ownerA, brandId: brand.a, name: 'Assist A1', address: '1 A St', status: 'APPROVED' },
      { id: gym.a2, ownerId: id.ownerA, brandId: brand.a, name: 'Assist A2', address: '2 A St', status: 'APPROVED' },
      { id: gym.a3closed, ownerId: id.ownerA, brandId: brand.a, name: 'Assist A3', address: '3 A St', status: 'APPROVED', operationalStatus: 'TEMPORARILY_CLOSED' },
      { id: gym.b1, ownerId: id.ownerB, brandId: brand.b, name: 'Assist B1', address: '1 B St', status: 'APPROVED' },
    ],
  });
  const mkPartner = async (name: string) => {
    const p = await prisma.gymPartner.create({
      data: { legalName: `Assist ${name} ${randomUUID().slice(0, 6)}`, contactEmail: `${randomUUID().slice(0, 8)}@assist.test`, status: 'ACTIVE', verificationStatus: 'VERIFIED' },
    });
    partnerIds.push(p.id);
    return p.id;
  };
  const mkAcc = (partnerId: string, userId: string, role: any, scopedGymIds: string[]) =>
    prisma.gymPartnerAccount.create({
      data: { partnerId, userId, role, scopedGymIds, status: 'ACTIVE', activatedAt: new Date(), onboardingCompletedAt: new Date() },
    });
  const pA = await mkPartner('A');
  await mkAcc(pA, id.ownerA, 'OWNER', []);
  await mkAcc(pA, id.managerA, 'MANAGER', [gym.a1]);
  await mkAcc(pA, id.recepA1, 'RECEPTIONIST', [gym.a1]);
  await mkAcc(pA, id.recepA2, 'RECEPTIONIST', [gym.a2]);
  await mkAcc(pA, id.acctA, 'ACCOUNTANT', []);
  const pB = await mkPartner('B');
  await mkAcc(pB, id.ownerB, 'OWNER', []);
  await mkAcc(pB, id.recepB, 'RECEPTIONIST', [gym.b1]);

  await prisma.gymMembershipPlan.createMany({
    data: [
      { id: plan.a, brandId: brand.a, name: 'Gói tháng', price: 700000, durationDays: 30, status: 'ACTIVE' },
      { id: plan.aVisits, brandId: brand.a, name: 'Gói 5 buổi', price: 400000, durationDays: 60, visitLimit: 5, status: 'ACTIVE' },
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
  await prisma.gymAssistedCheckInChallenge.deleteMany({ where: { gymId: { in: gymIds } } });
  await prisma.gymAssistedCheckInException.deleteMany({ where: { gymId: { in: gymIds } } });
  // Nhật ký chỉ-thêm: trigger chặn xoá. Gỡ trigger CHỈ trong DB test để dọn (chính test này chứng minh trigger hoạt động).
  await prisma.$executeRawUnsafe('ALTER TABLE gym_assisted_checkin_events DISABLE TRIGGER gym_assisted_checkin_events_no_update');
  await prisma.gymAssistedCheckInEvent.deleteMany({ where: { gymId: { in: gymIds } } });
  await prisma.$executeRawUnsafe('ALTER TABLE gym_assisted_checkin_events ENABLE TRIGGER gym_assisted_checkin_events_no_update');
  await prisma.gymMembershipContract.deleteMany({ where: { gymId: { in: gymIds } } });
  await prisma.gymMembershipPlan.deleteMany({ where: { brandId: { in: Object.values(brand) } } });
  await prisma.gym.deleteMany({ where: { id: { in: gymIds } } });
  await prisma.gymBrand.deleteMany({ where: { id: { in: Object.values(brand) } } });
  await prisma.gymPartner.deleteMany({ where: { id: { in: partnerIds } } });
  await prisma.$disconnect();
  for (const s of [authServer, userServer, appServer]) await new Promise<void>((r) => s.close(() => r()));
});

async function call(token: string | null, method: string, p: string, body?: unknown) {
  const res = await fetch(`${base}${p}`, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (p.includes('/front-desk/')) seenBodies.push(text);
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* không phải JSON */ }
  return { status: res.status, body: json };
}

const DAY = 864e5;
interface MemberOpts { name?: string; photo?: string | null; email?: string; status?: any; endInDays?: number; total?: number | null; used?: number; planId?: string; gymId?: string; clientId?: string }
async function mkMember(o: MemberOpts = {}) {
  const clientId = o.clientId ?? randomUUID();
  people.set(clientId, { name: o.name ?? 'Nguyễn Văn An', email: o.email ?? `mem-${clientId.slice(0, 8)}@member.test`, phone: SECRET_PHONE, photo: o.photo === undefined ? `https://photos.test/p-${randomUUID()}.jpg` : o.photo });
  const m = await prisma.gymMembershipContract.create({
    data: {
      gymId: o.gymId ?? gym.a1, planId: o.planId ?? plan.a, clientId, status: o.status ?? 'ACTIVE', paymentTxnId: `TXN-${clientId.slice(0, 6)}`,
      startDate: new Date(Date.now() - DAY), endDate: new Date(Date.now() + (o.endInDays ?? 20) * DAY), priceAtPurchase: 700000, durationDaysSnapshot: 30,
      totalVisits: o.total ?? null, usedVisits: o.used ?? 0,
    },
  });
  return { clientId, m, code: String(m.memberCode) };
}
const fmtCode = (c: string) => `${c.slice(0, 4)}-${c.slice(4)}`;
const rid = () => `req-${randomUUID()}`;
const lastOtp = (to?: string) => {
  const mails = to ? sentMails.filter((m) => m.to === to) : sentMails;
  const m = mails[mails.length - 1];
  return /:\s(\d{6})\n/.exec(m.text)![1];
};
const FD = (g: string) => `/owner/gyms/${g}/front-desk`;
const photoBody = (mm: { m: { id: string }; code: string }, extra: Record<string, unknown> = {}) => ({
  requestId: rid(), membershipId: mm.m.id, method: 'PHOTO_MATCH', reason: 'Quên điện thoại', photoMatchAttested: true, statedMemberCode: fmtCode(mm.code), ...extra,
});

// ───────────────────────────── 0. Dữ liệu nền ─────────────────────────────
integrationTest('mã hội viên: sinh tự động, 8 hex IN HOA, ổn định theo người (mọi gói của một người cùng một mã), khác người khác mã', async () => {
  const a = await mkMember();
  const second = await prisma.gymMembershipContract.create({
    data: { gymId: gym.a1, planId: plan.a, clientId: a.clientId, status: 'EXPIRED', priceAtPurchase: 1, durationDaysSnapshot: 30 },
  });
  const b = await mkMember();
  assert.match(a.code, /^[0-9A-F]{8}$/);
  assert.equal(second.memberCode, a.code);
  assert.notEqual(b.code, a.code);
  assert.equal(a.code, createHash('md5').update(a.clientId).digest('hex').slice(0, 8).toUpperCase());
});

// ───────────────────────────── 1. Quyền & phạm vi ─────────────────────────────
integrationTest('quyền: kế toán KHÔNG có đường nào; lễ tân tra cứu / check-in hộ / xin ngoại lệ được nhưng KHÔNG duyệt; quản lý & chủ duyệt được', async () => {
  const mm = await mkMember();
  const routes: Array<[string, string, unknown?]> = [
    ['GET', `${FD(gym.a1)}/members?code=${mm.code}`],
    ['GET', `${FD(gym.a1)}/assisted-checkin/config`],
    ['POST', `${FD(gym.a1)}/assisted-checkin/otp`, { membershipId: mm.m.id }],
    ['POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(mm)],
    ['POST', `${FD(gym.a1)}/exceptions`, { membershipId: mm.m.id, reason: 'không có gì cả' }],
    ['GET', `${FD(gym.a1)}/exceptions`],
    ['POST', `${FD(gym.a1)}/exceptions/${randomUUID()}/approve`, { reason: 'đồng ý nhé' }],
    ['POST', `${FD(gym.a1)}/exceptions/${randomUUID()}/reject`, { reason: 'không đồng ý' }],
  ];
  for (const [method, p, body] of routes) {
    const r = await call(ACCT, method, p, body);
    assert.equal(r.status, 403, `kế toán ${method} ${p} → ${r.status}`);
    assert.equal(r.body?.data, undefined);
    assert.equal((await call(null, method, p, body)).status, 401);
  }
  // Lễ tân KHÔNG duyệt ngoại lệ (cả approve lẫn reject) - bị chặn ở cổng quyền, trước cả khi tìm ngoại lệ.
  for (const verb of ['approve', 'reject']) {
    const r = await call(R1, 'POST', `${FD(gym.a1)}/exceptions/${randomUUID()}/${verb}`, { reason: 'tự duyệt thử' });
    assert.equal(r.status, 403);
    assert.ok(['PERMISSION_DENIED', 'OWNER_ROLE_REQUIRED'].includes(r.body.error.code));
  }
  assert.equal((await call(R1, 'GET', `${FD(gym.a1)}/members?code=${mm.code}`)).status, 200);
  assert.equal((await call(M, 'GET', `${FD(gym.a1)}/members?code=${mm.code}`)).status, 200);
  assert.equal((await call(O, 'GET', `${FD(gym.a1)}/members?code=${mm.code}`)).status, 200);
});

integrationTest('phạm vi chi nhánh & đối tác: lễ tân a1 không dùng được a2; lễ tân a2 không dùng được a1; đối tác B không chạm được A; hội viên của thương hiệu khác = không tồn tại', async () => {
  const mm = await mkMember();
  const mB = await mkMember({ planId: plan.b, gymId: gym.b1 });
  const paths: Array<[string, string, string, unknown?]> = [
    [R1, 'GET', `${FD(gym.a2)}/members?code=${mm.code}`],
    [R2, 'GET', `${FD(gym.a1)}/members?code=${mm.code}`],
    [R1, 'POST', `${FD(gym.a2)}/assisted-checkin`, photoBody(mm)],
    [R2, 'POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(mm)],
    [R1, 'POST', `${FD(gym.a2)}/assisted-checkin/otp`, { membershipId: mm.m.id }],
    [R1, 'POST', `${FD(gym.a2)}/exceptions`, { membershipId: mm.m.id, reason: 'sai chi nhánh' }],
    [RB, 'GET', `${FD(gym.a1)}/members?code=${mm.code}`],
    [RB, 'POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(mm)],
    [OB, 'GET', `${FD(gym.a1)}/members?code=${mm.code}`],
    [OB, 'POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(mm)],
  ];
  for (const [tok, method, p, body] of paths) {
    const r = await call(tok, method, p, body);
    assert.ok(r.status === 403 || r.status === 404, `${tok} ${method} ${p} → ${r.status}`);
    assert.equal(r.body?.data, undefined);
  }
  // Hội viên của thương hiệu B tra bằng mã ở chi nhánh A → không thấy; check-in hộ bằng membershipId của B → MEMBER_NOT_FOUND.
  const s = await call(R1, 'GET', `${FD(gym.a1)}/members?code=${mB.code}`);
  assert.equal(s.status, 200);
  assert.deepEqual(s.body.data.results, []);
  const c = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(mB));
  assert.equal(c.status, 404);
  assert.equal(c.body.error.code, 'MEMBER_NOT_FOUND');
  assert.equal(await prisma.gymCheckIn.count({ where: { membershipId: mB.m.id } }), 0);
});

integrationTest('tài khoản bị THU HỒI mất ngay mọi đường mới (tra cứu, OTP, check-in hộ, ngoại lệ)', async () => {
  const partner = await prisma.gymPartnerAccount.findFirstOrThrow({ where: { userId: id.ownerA } });
  const uid = randomUUID();
  TOKENS['tok-temp-recep'] = uid;
  const acc = await prisma.gymPartnerAccount.create({
    data: { partnerId: partner.partnerId, userId: uid, role: 'RECEPTIONIST', scopedGymIds: [gym.a1], status: 'ACTIVE', activatedAt: new Date(), onboardingCompletedAt: new Date() },
  });
  const mm = await mkMember();
  assert.equal((await call('tok-temp-recep', 'GET', `${FD(gym.a1)}/members?code=${mm.code}`)).status, 200);
  await prisma.gymPartnerAccount.update({ where: { id: acc.id }, data: { status: 'REVOKED', revokedAt: new Date() } });
  for (const [method, p, body] of [
    ['GET', `${FD(gym.a1)}/members?code=${mm.code}`], ['POST', `${FD(gym.a1)}/assisted-checkin/otp`, { membershipId: mm.m.id }],
    ['POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(mm)], ['POST', `${FD(gym.a1)}/exceptions`, { membershipId: mm.m.id, reason: 'đã bị thu hồi' }],
  ] as Array<[string, string, unknown?]>) {
    const r = await call('tok-temp-recep', method, p, body);
    assert.equal(r.status, 403, `${method} ${p} sau khi thu hồi → ${r.status}`);
  }
  assert.equal(await prisma.gymCheckIn.count({ where: { membershipId: mm.m.id } }), 0);
});

// ───────────────────────────── 2. Tra cứu ─────────────────────────────
integrationTest('tra cứu: theo mã đầy đủ (gõ thường/không gạch) HOẶC tiền tố tên + 4 ký tự cuối; tên đơn thuần / SĐT / e-mail bị từ chối', async () => {
  const mm = await mkMember({ name: 'Nguyễn Văn An' });
  // theo mã: nhiều dạng gõ
  for (const q of [mm.code, mm.code.toLowerCase(), fmtCode(mm.code), ` ${fmtCode(mm.code).toLowerCase()} `]) {
    const r = await call(R1, 'GET', `${FD(gym.a1)}/members?code=${encodeURIComponent(q)}`);
    assert.equal(r.status, 200, q);
    assert.equal(r.body.data.results.length, 1, q);
    assert.equal(r.body.data.results[0].membershipId, mm.m.id);
  }
  // theo tên + 4 cuối, không phân biệt dấu, tiền tố của một từ trong tên
  for (const name of ['Nguyen', 'nguyễn', 'van', 'An', 'Nguyễn Văn']) {
    const r = await call(R1, 'GET', `${FD(gym.a1)}/members?name=${encodeURIComponent(name)}&last4=${mm.code.slice(-4).toLowerCase()}`);
    assert.equal(r.status, 200, name);
    assert.ok(r.body.data.results.some((x: any) => x.membershipId === mm.m.id), `không thấy với tên "${name}"`);
  }
  // tên không khớp tiền tố → không thấy
  const none = await call(R1, 'GET', `${FD(gym.a1)}/members?name=Tran&last4=${mm.code.slice(-4)}`);
  assert.equal(none.body.data.results.some((x: any) => x.membershipId === mm.m.id), false);
  // KHÔNG đủ: tên đơn thuần, last4 đơn thuần, SĐT, e-mail, mã thiếu ký tự, rỗng
  for (const qs of [
    'name=Nguyen', `last4=${mm.code.slice(-4)}`, `name=${SECRET_PHONE}`, `code=${SECRET_PHONE}`, `phone=${SECRET_PHONE}`,
    'email=a%40b.c', `code=${mm.code.slice(0, 6)}`, '', 'name=N&last4=ABCD', `name=Nguyen&last4=${mm.code.slice(-3)}`,
  ]) {
    const r = await call(R1, 'GET', `${FD(gym.a1)}/members?${qs}`);
    assert.equal(r.status, 400, `"${qs}" → ${r.status}`);
    assert.equal(r.body.error.code, 'SEARCH_QUERY_INVALID');
  }
});

integrationTest('tra cứu: kết quả CHỈ gồm tên, mã, gói, trạng thái, hạn, phạm vi, buổi còn lại, ảnh - không tài chính / sức khoẻ / SĐT / e-mail / id người dùng', async () => {
  const mm = await mkMember({ name: 'Lê Thị Bích', total: 8, used: 3, planId: plan.aVisits });
  const r = await call(R1, 'GET', `${FD(gym.a1)}/members?code=${mm.code}`);
  const item = r.body.data.results[0];
  assert.deepEqual(Object.keys(item).sort(), [
    'blockedReason', 'branchScope', 'canCheckIn', 'coversThisBranch', 'displayName', 'expiresAt', 'hasPhoto', 'memberCode', 'membershipId',
    'photoUrl', 'planName', 'planType', 'remainingVisits', 'status',
  ]);
  assert.equal(item.displayName, 'Lê Thị Bích');
  assert.equal(item.memberCode, fmtCode(mm.code));
  assert.equal(item.planName, 'Gói 5 buổi');
  assert.equal(item.planType, 'VISIT_BASED');
  assert.equal(item.status, 'ACTIVE');
  assert.equal(item.remainingVisits, 5);
  assert.equal(item.branchScope, 'BRAND');
  assert.equal(item.coversThisBranch, true);
  assert.equal(item.hasPhoto, true);
  assert.equal(item.photoUrl, people.get(mm.clientId)!.photo);
  assert.equal(item.canCheckIn, true);
  const text = JSON.stringify(r.body);
  for (const leak of [mm.clientId, SECRET_PHONE, SECRET_HEALTH, 'knee', 'member.test', '@', 'TXN-', '700000', '400000', 'priceAtPurchase', 'paymentTxnId', 'currentWeight', 'inbody']) {
    assert.equal(text.includes(leak), false, `lộ "${leak}"`);
  }
  // Gói theo thời hạn: remainingVisits null, planType TIME_BASED; không ảnh → hasPhoto false + photoUrl null.
  const t = await mkMember({ photo: null });
  const tr = (await call(R1, 'GET', `${FD(gym.a1)}/members?code=${t.code}`)).body.data.results[0];
  assert.equal(tr.planType, 'TIME_BASED');
  assert.equal(tr.remainingVisits, null);
  assert.equal(tr.hasPhoto, false);
  assert.equal(tr.photoUrl, null);
});

integrationTest('tra cứu: trạng thái ACTIVE / EXPIRED / SUSPENDED và lý do không check-in được', async () => {
  const exp = await mkMember({ status: 'EXPIRED' });
  const passed = await mkMember({ endInDays: -2 });
  const susp = await mkMember({ status: 'PENDING_ISSUE' });
  const noLeft = await mkMember({ total: 3, used: 3, planId: plan.aVisits });
  const get = async (c: string) => (await call(R1, 'GET', `${FD(gym.a1)}/members?code=${c}`)).body.data.results[0];
  assert.deepEqual([(await get(exp.code)).status, (await get(exp.code)).blockedReason], ['EXPIRED', 'NOT_ACTIVE']);
  assert.deepEqual([(await get(passed.code)).status, (await get(passed.code)).canCheckIn], ['EXPIRED', false]);
  assert.deepEqual([(await get(susp.code)).status, (await get(susp.code)).blockedReason], ['SUSPENDED', 'NOT_ACTIVE']);
  assert.deepEqual([(await get(noLeft.code)).status, (await get(noLeft.code)).blockedReason, (await get(noLeft.code)).remainingVisits], ['EXPIRED', 'VISIT_LIMIT_REACHED', 0]);
  // Gói chưa thanh toán / đã huỷ KHÔNG hiện ra (không lộ thông tin thanh toán).
  const pending = await mkMember({ status: 'PENDING_PAYMENT' });
  assert.deepEqual((await call(R1, 'GET', `${FD(gym.a1)}/members?code=${pending.code}`)).body.data.results, []);
});

integrationTest('tra cứu: giới hạn tần suất chống dò hội viên hàng loạt', async () => {
  svc.__resetSearchLimiter();
  process.env.ASSISTED_CHECKIN_SEARCH_PER_MINUTE = '3';
  try {
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) statuses.push((await call(R2, 'GET', `${FD(gym.a2)}/members?code=AAAAAAAA`)).status);
    assert.deepEqual(statuses, [200, 200, 200, 429, 429]);
    // Người khác không bị ảnh hưởng.
    assert.equal((await call(M, 'GET', `${FD(gym.a1)}/members?code=AAAAAAAA`)).status, 200);
  } finally {
    process.env.ASSISTED_CHECKIN_SEARCH_PER_MINUTE = '1000';
    svc.__resetSearchLimiter();
  }
});

// ───────────────────────────── 3. PHOTO_MATCH ─────────────────────────────
integrationTest('PHOTO_MATCH thành công: check-in ASSISTED cùng bảng gym_check_ins, trừ buổi như QR, ghi nhật ký có nhân viên/phương thức/lý do/khoá', async () => {
  const mm = await mkMember({ total: 5, used: 0, planId: plan.aVisits });
  const body = photoBody(mm);
  const r = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, body);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const d = r.body.data;
  assert.equal(d.source, 'ASSISTED');
  assert.equal(d.method, 'PHOTO_MATCH');
  assert.equal(d.replayed, false);
  assert.equal(d.usedVisits, 1);
  assert.equal(d.remainingVisits, 4);
  assert.equal(d.displayName, 'Nguyễn Văn An');

  const row = await prisma.gymCheckIn.findUniqueOrThrow({ where: { id: d.checkinId } });
  assert.equal(row.source, 'ASSISTED');
  assert.equal(row.checkedInBy, id.recepA1, 'ghi nhân viên thật, không phải chủ');
  assert.equal(row.clientId, mm.clientId);
  assert.equal(row.gymId, gym.a1);
  assert.ok(row.assistedEventId);
  assert.equal((await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: mm.m.id } })).usedVisits, 1);

  const ev = await prisma.gymAssistedCheckInEvent.findUniqueOrThrow({ where: { id: row.assistedEventId! } });
  assert.equal(ev.eventType, 'CHECKIN_SUCCEEDED');
  assert.equal(ev.staffUserId, id.recepA1);
  assert.equal(ev.staffRole, 'RECEPTIONIST');
  assert.equal(ev.gymId, gym.a1);
  assert.equal(ev.membershipId, mm.m.id);
  assert.equal(ev.clientId, mm.clientId);
  assert.equal(ev.method, 'PHOTO_MATCH');
  assert.equal(ev.outcome, 'OK');
  assert.equal(ev.reason, 'Quên điện thoại');
  assert.equal(ev.idempotencyKey, body.requestId);
  assert.equal(ev.checkinId, row.id);
  const v = (ev.details as any).verification;
  assert.equal(v.photoMatchAttested, true);
  assert.equal(v.statedMemberCode, fmtCode(mm.code));
  // Lượt QR cũ vẫn là QR (cột mới mặc định QR).
  const { token } = signToken(gym.a1);
  const q = await checkinService.checkInByGymToken((await mkMember({ })).clientId, token);
  assert.equal((await prisma.gymCheckIn.findUniqueOrThrow({ where: { id: q.checkinId } })).source, 'QR');
});

integrationTest('PHOTO_MATCH: không có ảnh → không dùng được; thiếu cam kết → 400; sai/thiếu mã hội viên → 403; không check-in nào được tạo', async () => {
  const noPhoto = await mkMember({ photo: null });
  const r1 = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(noPhoto));
  assert.equal(r1.status, 409);
  assert.equal(r1.body.error.code, 'PHOTO_UNAVAILABLE');

  const mm = await mkMember();
  const r2 = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(mm, { photoMatchAttested: false }));
  assert.equal(r2.status, 400);
  assert.equal(r2.body.error.code, 'PHOTO_ATTESTATION_REQUIRED');
  const r3 = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(mm, { statedMemberCode: 'ZZZZ-ZZZZ' }));
  assert.equal(r3.status, 403);
  assert.equal(r3.body.error.code, 'MEMBER_CODE_MISMATCH');
  const r4 = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(mm, { statedMemberCode: '' }));
  assert.equal(r4.status, 403);
  // Thiếu hẳn photoMatchAttested.
  const b = photoBody(mm) as any;
  delete b.photoMatchAttested;
  assert.equal((await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, b)).body.error.code, 'PHOTO_ATTESTATION_REQUIRED');
  assert.equal(await prisma.gymCheckIn.count({ where: { membershipId: { in: [mm.m.id, noPhoto.m.id] } } }), 0);
  // Mọi lần từ chối đều có dòng nhật ký.
  const refused = await prisma.gymAssistedCheckInEvent.findMany({ where: { membershipId: { in: [mm.m.id, noPhoto.m.id] }, eventType: 'CHECKIN_REFUSED' } });
  assert.deepEqual(refused.map((e) => e.outcome).sort(), ['MEMBER_CODE_MISMATCH', 'MEMBER_CODE_MISMATCH', 'PHOTO_ATTESTATION_REQUIRED', 'PHOTO_ATTESTATION_REQUIRED', 'PHOTO_UNAVAILABLE']);
});

integrationTest('cấu hình ASSISTED_CHECKIN_METHODS: mặc định hai phương thức; tắt từng cái; rỗng = chỉ còn ngoại lệ; giá trị lạ bị bỏ', async () => {
  const mm = await mkMember();
  const cfg = async () => (await call(R1, 'GET', `${FD(gym.a1)}/assisted-checkin/config`)).body.data;
  assert.deepEqual((await cfg()).methods.sort(), ['MEMBER_OTP', 'PHOTO_MATCH']);
  try {
    process.env.ASSISTED_CHECKIN_METHODS = 'photo_match, BOGUS';
    assert.deepEqual((await cfg()).methods, ['PHOTO_MATCH']);
    const otp = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin/otp`, { membershipId: mm.m.id });
    assert.equal(otp.status, 403);
    assert.equal(otp.body.error.code, 'METHOD_DISABLED');
    process.env.ASSISTED_CHECKIN_METHODS = 'MEMBER_OTP';
    const ph = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(mm));
    assert.equal(ph.status, 403);
    assert.equal(ph.body.error.code, 'METHOD_DISABLED');
    process.env.ASSISTED_CHECKIN_METHODS = '';
    assert.deepEqual((await cfg()).methods, []);
    assert.equal((await cfg()).exceptionEnabled, true);
  } finally {
    delete process.env.ASSISTED_CHECKIN_METHODS;
  }
  assert.equal(await prisma.gymCheckIn.count({ where: { membershipId: mm.m.id } }), 0);
});

// ───────────────────────────── 4. Luật gói (cùng mã luật với QR) ─────────────────────────────
integrationTest('luật gói: hết hạn / tạm khoá / hết buổi → từ chối đúng mã như QR; không trừ buổi, không đổi trạng thái, có nhật ký từ chối', async () => {
  const cases: Array<[string, Awaited<ReturnType<typeof mkMember>>, string, number]> = [
    ['EXPIRED', await mkMember({ status: 'EXPIRED' }), 'NOT_ACTIVE', 409],
    ['qua endDate', await mkMember({ endInDays: -1 }), 'NOT_ACTIVE', 409],
    ['SUSPENDED', await mkMember({ status: 'PENDING_ISSUE' }), 'NOT_ACTIVE', 409],
    ['het buoi', await mkMember({ total: 3, used: 3, planId: plan.aVisits }), 'VISIT_LIMIT_REACHED', 409],
  ];
  for (const [label, mm, code, status] of cases) {
    const before = await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: mm.m.id } });
    const r = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(mm));
    assert.equal(r.status, status, label);
    assert.equal(r.body.error.code, code, label);
    const after = await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: mm.m.id } });
    assert.equal(after.usedVisits, before.usedVisits, `${label}: không trừ buổi`);
    assert.equal(after.status, before.status, `${label}: không đổi trạng thái`);
    assert.equal(after.endDate?.getTime(), before.endDate?.getTime(), `${label}: không gia hạn`);
    assert.equal(await prisma.gymCheckIn.count({ where: { membershipId: mm.m.id } }), 0);
    const ev = await prisma.gymAssistedCheckInEvent.findFirstOrThrow({ where: { membershipId: mm.m.id, eventType: 'CHECKIN_REFUSED' } });
    assert.equal(ev.outcome, code);
    assert.equal(ev.staffUserId, id.recepA1);
  }
});

integrationTest('luật gói: chi nhánh đang tạm đóng → GYM_NOT_ACTIVE (cùng luật với QR); gói thương hiệu phủ MỌI chi nhánh của thương hiệu (a2 dùng được)', async () => {
  const mm = await mkMember();
  const closed = await call(O, 'POST', `${FD(gym.a3closed)}/assisted-checkin`, photoBody(mm));
  assert.equal(closed.status, 409);
  assert.equal(closed.body.error.code, 'GYM_NOT_ACTIVE');
  const other = await call(R2, 'POST', `${FD(gym.a2)}/assisted-checkin`, photoBody(mm)); // mua ở a1, vào ở a2
  assert.equal(other.status, 201, JSON.stringify(other.body));
  assert.equal((await prisma.gymCheckIn.findUniqueOrThrow({ where: { id: other.body.data.checkinId } })).gymId, gym.a2);
});

integrationTest('trừ buổi đúng như QR: buổi CUỐI chuyển gói sang EXPIRED ngay; sau đó không check-in thêm được', async () => {
  const mm = await mkMember({ total: 2, used: 1, planId: plan.aVisits });
  const r = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(mm));
  assert.equal(r.status, 201);
  assert.equal(r.body.data.usedVisits, 2);
  assert.equal(r.body.data.remainingVisits, 0);
  assert.equal((await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: mm.m.id } })).status, 'EXPIRED');
  const again = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(mm));
  assert.equal(again.status, 409);
  assert.equal(again.body.error.code, 'NOT_ACTIVE');
});

integrationTest('trùng lặp: luật chống quét trùng 60 giây GIỐNG HỆT QR - kể cả chéo giữa hai đường (QR rồi hộ, hộ rồi QR)', async () => {
  const a = await mkMember();
  const first = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(a));
  assert.equal(first.status, 201);
  const dup = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(a)); // khoá mới, cùng người
  assert.equal(dup.status, 429);
  assert.equal(dup.body.error.code, 'TOO_SOON');
  // hộ rồi QR
  const { token } = signToken(gym.a1);
  await assert.rejects(() => checkinService.checkInByGymToken(a.clientId, token), /TOO_SOON/);
  // QR rồi hộ
  const b = await mkMember();
  await checkinService.checkInByGymToken(b.clientId, token);
  const afterQr = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(b));
  assert.equal(afterQr.status, 429);
  assert.equal(afterQr.body.error.code, 'TOO_SOON');
  assert.equal(await prisma.gymCheckIn.count({ where: { membershipId: a.m.id } }), 1);
  assert.equal(await prisma.gymCheckIn.count({ where: { membershipId: b.m.id } }), 1);
  // Qua cửa sổ 60 giây thì cho phép (đúng như QR): lùi lượt cũ về 2 phút trước.
  await prisma.gymCheckIn.updateMany({ where: { membershipId: a.m.id }, data: { createdAt: new Date(Date.now() - 120_000) } });
  assert.equal((await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(a))).status, 201);
});

// ───────────────────────────── 5. Idempotency & song song ─────────────────────────────
integrationTest('idempotency: cùng khoá + cùng nội dung = phát lại (200, cùng checkinId, KHÔNG trừ buổi thêm); khác nội dung = 409', async () => {
  const mm = await mkMember({ total: 5, used: 0, planId: plan.aVisits });
  const body = photoBody(mm);
  const first = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, body);
  assert.equal(first.status, 201);
  const replay = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, body);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.data.replayed, true);
  assert.equal(replay.body.data.checkinId, first.body.data.checkinId);
  assert.equal(replay.body.data.usedVisits, 1);
  assert.equal(await prisma.gymCheckIn.count({ where: { membershipId: mm.m.id } }), 1);
  assert.equal((await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: mm.m.id } })).usedVisits, 1);
  // cùng khoá, KHÁC nội dung (lý do khác) → 409
  const diff = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, { ...body, reason: 'Hết pin điện thoại' });
  assert.equal(diff.status, 409);
  assert.equal(diff.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
  // cùng khoá, KHÁC hội viên → 409
  const other = await mkMember();
  const diff2 = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, { ...photoBody(other), requestId: body.requestId });
  assert.equal(diff2.status, 409);
  assert.equal(diff2.body.error.code, 'IDEMPOTENCY_KEY_REUSED');
  assert.equal(await prisma.gymCheckIn.count({ where: { membershipId: other.m.id } }), 0);
  // khoá thiếu / quá ngắn → 400
  const noKey = photoBody(other) as any;
  delete noKey.requestId;
  assert.equal((await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, noKey)).body.error.code, 'IDEMPOTENCY_KEY_REQUIRED');
  assert.equal((await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, { ...photoBody(other), requestId: 'x' })).status, 400);
  // Khoá của nhân viên khác là không gian riêng: lễ tân khác dùng lại cùng chuỗi khoá không bị coi là trùng.
  const m2 = await mkMember();
  const k = rid();
  assert.equal((await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, { ...photoBody(m2), requestId: k })).status, 201);
  const m3 = await mkMember();
  assert.equal((await call(M, 'POST', `${FD(gym.a1)}/assisted-checkin`, { ...photoBody(m3), requestId: k })).status, 201);
});

integrationTest('song song (Promise.all): 8 request KHÁC khoá cho CÙNG hội viên → đúng 1 check-in, 1 buổi bị trừ, còn lại TOO_SOON', async () => {
  const mm = await mkMember({ total: 5, used: 0, planId: plan.aVisits });
  const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => call(i % 2 ? R1 : M, 'POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(mm))));
  const ok = rs.filter((r) => r.status === 201);
  assert.equal(ok.length, 1, rs.map((r) => r.status).join(','));
  for (const r of rs.filter((x) => x.status !== 201)) assert.equal(r.body.error.code, 'TOO_SOON');
  assert.equal(await prisma.gymCheckIn.count({ where: { membershipId: mm.m.id } }), 1);
  assert.equal((await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: mm.m.id } })).usedVisits, 1);
});

integrationTest('song song: 8 request CÙNG khoá + cùng nội dung → 1 check-in, tất cả còn lại phát lại cùng checkinId', async () => {
  const mm = await mkMember({ total: 5, used: 0, planId: plan.aVisits });
  const body = photoBody(mm);
  const rs = await Promise.all(Array.from({ length: 8 }, () => call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, body)));
  assert.equal(rs.filter((r) => r.status === 201).length, 1, rs.map((r) => r.status).join(','));
  assert.equal(rs.filter((r) => r.status === 200).length, 7);
  assert.equal(new Set(rs.map((r) => r.body.data.checkinId)).size, 1);
  assert.equal(await prisma.gymCheckIn.count({ where: { membershipId: mm.m.id } }), 1);
  assert.equal((await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: mm.m.id } })).usedVisits, 1);
});

integrationTest('song song: QR của hội viên và check-in hộ cùng lúc → đúng 1 lượt (chung khoá FOR UPDATE + chung cooldown)', async () => {
  const mm = await mkMember({ total: 5, used: 0, planId: plan.aVisits });
  const { token } = signToken(gym.a1);
  const outcomes = await Promise.allSettled([
    checkinService.checkInByGymToken(mm.clientId, token),
    call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(mm)),
    call(M, 'POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(mm)),
  ]);
  const created = outcomes.filter((o) => (o.status === 'fulfilled' && (o.value as any).status === undefined) || (o.status === 'fulfilled' && (o.value as any).status === 201));
  assert.equal(created.length, 1, JSON.stringify(outcomes.map((o) => (o.status === 'fulfilled' ? (o.value as any).status ?? 'qr-ok' : String((o as any).reason.message)))));
  assert.equal(await prisma.gymCheckIn.count({ where: { membershipId: mm.m.id } }), 1);
  assert.equal((await prisma.gymMembershipContract.findUniqueOrThrow({ where: { id: mm.m.id } })).usedVisits, 1);
});

// ───────────────────────────── 6. MEMBER_OTP ─────────────────────────────
async function sendOtp(tok: string, g: string, mm: Awaited<ReturnType<typeof mkMember>>) {
  const before = sentMails.length;
  const r = await call(tok, 'POST', `${FD(g)}/assisted-checkin/otp`, { membershipId: mm.m.id });
  return { r, mailed: sentMails.length - before };
}
const otpBody = (mm: Awaited<ReturnType<typeof mkMember>>, challengeId: string, otp: string, extra: Record<string, unknown> = {}) => ({
  requestId: rid(), membershipId: mm.m.id, method: 'MEMBER_OTP', reason: 'Hết pin điện thoại', challengeId, otp, ...extra,
});

integrationTest('MEMBER_OTP thành công: mã gửi tới e-mail ĐÃ ĐĂNG KÝ của hội viên; phản hồi KHÔNG chứa mã hay e-mail; DB chỉ lưu băm; check-in rồi mã hết tác dụng', async () => {
  const mm = await mkMember({ email: 'real.member@mail.test' });
  const { r, mailed } = await sendOtp(R1, gym.a1, mm);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(mailed, 1);
  const mail = sentMails[sentMails.length - 1];
  assert.equal(mail.to, 'real.member@mail.test');
  const otp = lastOtp();
  assert.deepEqual(Object.keys(r.body.data).sort(), ['challengeId', 'expiresAt', 'resendAfterSeconds', 'ttlSeconds']);
  assert.equal(JSON.stringify(r.body).includes(otp), false, 'phản hồi không được chứa mã');
  assert.equal(JSON.stringify(r.body).includes('real.member'), false, 'phản hồi không được chứa e-mail');
  const ch = await prisma.gymAssistedCheckInChallenge.findUniqueOrThrow({ where: { id: r.body.data.challengeId } });
  assert.notEqual(ch.otpHash, otp);
  assert.match(ch.otpHash, /^[0-9a-f]{64}$/);
  assert.equal(ch.staffUserId, id.recepA1);
  assert.equal(ch.gymId, gym.a1);
  assert.equal(ch.membershipId, mm.m.id);
  assert.ok(ch.expiresAt.getTime() - Date.now() <= 300_000 + 2000);

  const ci = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, otpBody(mm, ch.id, otp));
  assert.equal(ci.status, 201, JSON.stringify(ci.body));
  assert.equal(ci.body.data.method, 'MEMBER_OTP');
  assert.ok((await prisma.gymAssistedCheckInChallenge.findUniqueOrThrow({ where: { id: ch.id } })).consumedAt);
  // dùng lại mã với khoá mới → không tạo thêm check-in
  const reuse = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, otpBody(mm, ch.id, otp));
  assert.ok([409, 429].includes(reuse.status), String(reuse.status));
  assert.equal(await prisma.gymCheckIn.count({ where: { membershipId: mm.m.id } }), 1);
  // Nhật ký: OTP_SENT + CHECKIN_SUCCEEDED, và không dòng nào chứa mã / e-mail.
  const evs = await prisma.gymAssistedCheckInEvent.findMany({ where: { membershipId: mm.m.id } });
  assert.ok(evs.some((e) => e.eventType === 'OTP_SENT' && e.challengeId === ch.id));
  assert.ok(evs.some((e) => e.eventType === 'CHECKIN_SUCCEEDED' && e.method === 'MEMBER_OTP' && e.challengeId === ch.id));
  assert.equal(JSON.stringify(evs).includes(otp), false);
  assert.equal(JSON.stringify(evs).includes('real.member'), false);
});

integrationTest('OTP sai: 403 OTP_INVALID, đếm lần thử; quá số lần → khoá (kể cả mã đúng sau đó); mỗi lần có nhật ký OTP_FAILED', async () => {
  const mm = await mkMember();
  const { r } = await sendOtp(R1, gym.a1, mm);
  const otp = lastOtp();
  const wrong = otp === '000000' ? '111111' : '000000';
  const codes: string[] = [];
  for (let i = 0; i < 5; i++) {
    const x = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, otpBody(mm, r.body.data.challengeId, wrong));
    codes.push(`${x.status}:${x.body.error.code}`);
  }
  assert.deepEqual(codes, ['403:OTP_INVALID', '403:OTP_INVALID', '403:OTP_INVALID', '403:OTP_INVALID', '429:OTP_ATTEMPTS_EXCEEDED']);
  const good = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, otpBody(mm, r.body.data.challengeId, otp));
  assert.equal(good.status, 429, 'mã đúng sau khi bị khoá vẫn bị từ chối');
  assert.equal(good.body.error.code, 'OTP_ATTEMPTS_EXCEEDED');
  assert.equal(await prisma.gymCheckIn.count({ where: { membershipId: mm.m.id } }), 0);
  const failed = await prisma.gymAssistedCheckInEvent.findMany({ where: { membershipId: mm.m.id, eventType: 'OTP_FAILED', challengeId: r.body.data.challengeId } });
  assert.equal(failed.length, 6);
  assert.ok((await prisma.gymAssistedCheckInChallenge.findUniqueOrThrow({ where: { id: r.body.data.challengeId } })).lockedAt);
});

integrationTest('OTP hết hạn → 410; sau khi hết hạn xin mã mới (qua thời gian chờ gửi lại) dùng được', async () => {
  const mm = await mkMember();
  const { r } = await sendOtp(R1, gym.a1, mm);
  const otp = lastOtp();
  await prisma.gymAssistedCheckInChallenge.update({ where: { id: r.body.data.challengeId }, data: { expiresAt: new Date(Date.now() - 1000), createdAt: new Date(Date.now() - 120_000) } });
  const late = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, otpBody(mm, r.body.data.challengeId, otp));
  assert.equal(late.status, 410);
  assert.equal(late.body.error.code, 'OTP_EXPIRED');
  assert.equal(await prisma.gymCheckIn.count({ where: { membershipId: mm.m.id } }), 0);
  const again = await sendOtp(R1, gym.a1, mm);
  assert.equal(again.r.status, 201);
  const ok = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, otpBody(mm, again.r.body.data.challengeId, lastOtp()));
  assert.equal(ok.status, 201);
});

integrationTest('OTP gắn với (hội viên, chi nhánh, nhân viên): người khác / hội viên khác / chi nhánh khác không dùng được; không phân biệt "không tồn tại"', async () => {
  const a = await mkMember();
  const b = await mkMember();
  const { r } = await sendOtp(R1, gym.a1, a);
  const otp = lastOtp();
  const cid = r.body.data.challengeId;
  const byOther = await call(M, 'POST', `${FD(gym.a1)}/assisted-checkin`, otpBody(a, cid, otp)); // quản lý khác nhân viên đã xin mã
  assert.equal(byOther.status, 403);
  assert.equal(byOther.body.error.code, 'OTP_CHALLENGE_INVALID');
  const forOtherMember = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, otpBody(b, cid, otp));
  assert.equal(forOtherMember.body.error.code, 'OTP_CHALLENGE_INVALID');
  const otherGym = await call(O, 'POST', `${FD(gym.a2)}/assisted-checkin`, otpBody(a, cid, otp));
  assert.equal(otherGym.body.error.code, 'OTP_CHALLENGE_INVALID');
  const fake = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, otpBody(a, randomUUID(), otp));
  assert.equal(fake.body.error.code, 'OTP_CHALLENGE_INVALID');
  assert.equal(await prisma.gymCheckIn.count({ where: { membershipId: { in: [a.m.id, b.m.id] } } }), 0);
  // nhân viên đúng thì được
  assert.equal((await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, otpBody(a, cid, otp))).status, 201);
  // thiếu mã / mã sai định dạng
  const c = await mkMember();
  const { r: r2 } = await sendOtp(R1, gym.a1, c);
  assert.equal((await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, { ...otpBody(c, r2.body.data.challengeId, '123456'), otp: undefined })).body.error.code, 'OTP_REQUIRED');
  assert.equal((await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, otpBody(c, r2.body.data.challengeId, 'abcdef'))).status, 400);
});

integrationTest('OTP: không gửi cho gói hết hạn / tạm khoá; giới hạn gửi lại; giới hạn theo ngày; hội viên không có e-mail; gửi mail lỗi → không còn mã treo', async () => {
  const exp = await mkMember({ status: 'EXPIRED' });
  const e1 = await sendOtp(R1, gym.a1, exp);
  assert.equal(e1.r.status, 409);
  assert.equal(e1.r.body.error.code, 'NOT_ACTIVE');
  assert.equal(e1.mailed, 0, 'không gửi mã cho gói không dùng được');

  const mm = await mkMember();
  assert.equal((await sendOtp(R1, gym.a1, mm)).r.status, 201);
  const soon = await sendOtp(R1, gym.a1, mm);
  assert.equal(soon.r.status, 429);
  assert.equal(soon.r.body.error.code, 'OTP_RESEND_TOO_SOON');
  assert.equal(soon.mailed, 0);

  const noMail = await mkMember({ email: '' });
  const nm = await sendOtp(R1, gym.a1, noMail);
  assert.equal(nm.r.status, 409);
  assert.equal(nm.r.body.error.code, 'MEMBER_EMAIL_UNAVAILABLE');

  const daily = await mkMember();
  process.env.ASSISTED_CHECKIN_OTP_DAILY_LIMIT = '2';
  process.env.ASSISTED_CHECKIN_OTP_RESEND_SECONDS = '0.001';
  try {
    assert.equal((await sendOtp(R1, gym.a1, daily)).r.status, 201);
    await new Promise((r) => setTimeout(r, 20));
    assert.equal((await sendOtp(R1, gym.a1, daily)).r.status, 201);
    await new Promise((r) => setTimeout(r, 20));
    const third = await sendOtp(R1, gym.a1, daily);
    assert.equal(third.r.status, 429);
    assert.equal(third.r.body.error.code, 'OTP_DAILY_LIMIT');
  } finally {
    delete process.env.ASSISTED_CHECKIN_OTP_DAILY_LIMIT;
    delete process.env.ASSISTED_CHECKIN_OTP_RESEND_SECONDS;
  }

  const down = await mkMember();
  mailDown = true;
  try {
    const d = await sendOtp(R1, gym.a1, down);
    assert.equal(d.r.status, 502);
    assert.equal(d.r.body.error.code, 'OTP_DELIVERY_FAILED');
  } finally {
    mailDown = false;
  }
  const dead = await prisma.gymAssistedCheckInChallenge.findMany({ where: { membershipId: down.m.id } });
  assert.equal(dead.length, 1);
  assert.ok(dead[0].consumedAt, 'mã chưa tới được hội viên phải bị vô hiệu');
});

// ───────────────────────────── 7. Ngoại lệ do quản lý duyệt ─────────────────────────────
async function reqException(tok: string, g: string, mm: Awaited<ReturnType<typeof mkMember>>, reason = 'Hội viên không có ảnh và không nhận được e-mail') {
  return call(tok, 'POST', `${FD(g)}/exceptions`, { membershipId: mm.m.id, reason });
}
const exBody = (mm: Awaited<ReturnType<typeof mkMember>>, exceptionId: string) => ({ requestId: rid(), membershipId: mm.m.id, method: 'MANAGER_EXCEPTION', reason: 'Quản lý đã duyệt', exceptionId });

integrationTest('ngoại lệ: lễ tân xin → CHƯA check-in; chưa duyệt / bị từ chối thì không dùng được; quản lý duyệt (ghi lý do riêng) → lễ tân check-in một lần', async () => {
  const mm = await mkMember({ photo: null, email: '' });
  const rq = await reqException(R1, gym.a1, mm);
  assert.equal(rq.status, 201, JSON.stringify(rq.body));
  const exId = rq.body.data.id;
  assert.equal(rq.body.data.status, 'PENDING');
  assert.equal(await prisma.gymCheckIn.count({ where: { membershipId: mm.m.id } }), 0, 'xin ngoại lệ không tự check-in');
  // đang chờ → không dùng được
  const early = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, exBody(mm, exId));
  assert.equal(early.status, 409);
  assert.equal(early.body.error.code, 'EXCEPTION_NOT_APPROVED');
  // đã có ngoại lệ đang mở → không xin thêm
  assert.equal((await reqException(R1, gym.a1, mm)).body.error.code, 'EXCEPTION_ALREADY_OPEN');
  // lễ tân thấy ngoại lệ của mình, không nút duyệt; quản lý thấy
  const mine = (await call(R1, 'GET', `${FD(gym.a1)}/exceptions`)).body.data;
  assert.equal(mine.canApprove, false);
  assert.equal(mine.exceptions.length >= 1, true);
  assert.deepEqual(Object.keys(mine.exceptions[0]).sort(), ['createdAt', 'decidedAt', 'decidedByName', 'decisionReason', 'displayName', 'expiresAt', 'id', 'memberCode', 'membershipId', 'mine', 'planName', 'requestReason', 'requestedByName', 'status']);
  const mgr = (await call(M, 'GET', `${FD(gym.a1)}/exceptions`)).body.data;
  assert.equal(mgr.canApprove, true);
  assert.ok(mgr.exceptions.some((e: any) => e.id === exId));
  // người xin không thấy ngoại lệ của người khác
  assert.equal((await call(R2, 'GET', `${FD(gym.a2)}/exceptions`)).body.data.exceptions.some((e: any) => e.id === exId), false);
  // duyệt cần lý do
  assert.equal((await call(M, 'POST', `${FD(gym.a1)}/exceptions/${exId}/approve`, {})).body.error.code, 'REASON_REQUIRED');
  assert.equal((await call(M, 'POST', `${FD(gym.a1)}/exceptions/${exId}/approve`, { reason: 'ok' })).status, 400);
  const ap = await call(M, 'POST', `${FD(gym.a1)}/exceptions/${exId}/approve`, { reason: 'Đã gọi điện xác nhận với hội viên' });
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  const row = await prisma.gymAssistedCheckInException.findUniqueOrThrow({ where: { id: exId } });
  assert.equal(row.status, 'APPROVED');
  assert.equal(row.decidedBy, id.managerA);
  assert.equal(row.decidedByRole, 'MANAGER');
  assert.equal(row.decisionReason, 'Đã gọi điện xác nhận với hội viên');
  // duyệt lần hai → 409
  assert.equal((await call(O, 'POST', `${FD(gym.a1)}/exceptions/${exId}/reject`, { reason: 'đổi ý rồi nhé' })).body.error.code, 'EXCEPTION_ALREADY_DECIDED');
  // đúng ngoại lệ, đúng hội viên → check-in
  const ci = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, exBody(mm, exId));
  assert.equal(ci.status, 201, JSON.stringify(ci.body));
  assert.equal(ci.body.data.method, 'MANAGER_EXCEPTION');
  const used = await prisma.gymAssistedCheckInException.findUniqueOrThrow({ where: { id: exId } });
  assert.equal(used.status, 'USED');
  assert.equal(used.usedCheckinId, ci.body.data.checkinId);
  const succ = await prisma.gymAssistedCheckInEvent.findFirstOrThrow({ where: { checkinId: ci.body.data.checkinId, eventType: 'CHECKIN_SUCCEEDED' } });
  assert.equal((succ.details as any).verification.approvedBy, id.managerA);
  assert.equal(succ.staffUserId, id.recepA1);
  // dùng lại → bị chặn, không thêm check-in
  const again = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, exBody(mm, exId));
  assert.ok([409, 429].includes(again.status));
  assert.equal(await prisma.gymCheckIn.count({ where: { membershipId: mm.m.id } }), 1);
  // nhật ký đủ 3 sự kiện ngoại lệ
  const types = (await prisma.gymAssistedCheckInEvent.findMany({ where: { exceptionId: exId } })).map((e) => `${e.eventType}:${e.outcome}`);
  assert.ok(types.includes('EXCEPTION_REQUESTED:OK') && types.includes('EXCEPTION_APPROVED:OK'));
});

integrationTest('ngoại lệ: bị từ chối → không check-in; lễ tân KHÔNG tự duyệt; quản lý KHÔNG tự duyệt ngoại lệ của chính mình (bốn mắt); chủ duyệt ngoại lệ của quản lý', async () => {
  const mm = await mkMember({ photo: null });
  const exId = (await reqException(R1, gym.a1, mm)).body.data.id;
  const self = await call(R1, 'POST', `${FD(gym.a1)}/exceptions/${exId}/approve`, { reason: 'tự duyệt cho nhanh' });
  assert.equal(self.status, 403);
  const rj = await call(M, 'POST', `${FD(gym.a1)}/exceptions/${exId}/reject`, { reason: 'Không xác minh được danh tính' });
  assert.equal(rj.status, 200);
  const rejected = await prisma.gymAssistedCheckInException.findUniqueOrThrow({ where: { id: exId } });
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(rejected.decisionReason, 'Không xác minh được danh tính');
  const use = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, exBody(mm, exId));
  assert.equal(use.status, 409);
  assert.equal(use.body.error.code, 'EXCEPTION_NOT_APPROVED');
  assert.equal(await prisma.gymCheckIn.count({ where: { membershipId: mm.m.id } }), 0);

  // Quản lý tự xin rồi tự duyệt → 403 + dòng nhật ký; chủ duyệt được.
  const m2 = await mkMember({ photo: null });
  const ex2 = (await reqException(M, gym.a1, m2)).body.data.id;
  const selfMgr = await call(M, 'POST', `${FD(gym.a1)}/exceptions/${ex2}/approve`, { reason: 'tự duyệt của tôi' });
  assert.equal(selfMgr.status, 403);
  assert.equal(selfMgr.body.error.code, 'EXCEPTION_SELF_APPROVAL');
  assert.equal((await prisma.gymAssistedCheckInException.findUniqueOrThrow({ where: { id: ex2 } })).status, 'PENDING');
  assert.ok(await prisma.gymAssistedCheckInEvent.findFirst({ where: { exceptionId: ex2, outcome: 'EXCEPTION_SELF_APPROVAL' } }));
  assert.equal((await call(O, 'POST', `${FD(gym.a1)}/exceptions/${ex2}/approve`, { reason: 'Chủ xác nhận' })).status, 200);
  // Ràng buộc DB bốn mắt: dù có lỗi ở tầng ứng dụng, người quyết định = người xin bị CSDL từ chối.
  const m3 = await mkMember({ photo: null });
  const ex3 = (await reqException(R1, gym.a1, m3)).body.data.id;
  await assert.rejects(() => prisma.gymAssistedCheckInException.update({ where: { id: ex3 }, data: { decidedBy: id.recepA1, status: 'APPROVED' } }), /four_eyes|check/i);
});

integrationTest('ngoại lệ: hết hạn cuối ngày → không dùng được, tự chuyển EXPIRED + nhật ký; ngoại lệ chưa duyệt cũng hết hạn; không duyệt được ngoại lệ đã hết hạn', async () => {
  const mm = await mkMember({ photo: null });
  const exId = (await reqException(R1, gym.a1, mm)).body.data.id;
  const row = await prisma.gymAssistedCheckInException.findUniqueOrThrow({ where: { id: exId } });
  // hết hạn đúng cuối ngày địa phương (Asia/Ho_Chi_Minh)
  const { windowOfLocalDate, localDateOf } = await import('../utils/local-day');
  assert.equal(row.expiresAt.getTime(), windowOfLocalDate(localDateOf(new Date())).end.getTime());
  await call(M, 'POST', `${FD(gym.a1)}/exceptions/${exId}/approve`, { reason: 'Duyệt trước khi hết ngày' });
  await prisma.gymAssistedCheckInException.update({ where: { id: exId }, data: { expiresAt: new Date(Date.now() - 1000) } }); // "qua nửa đêm"
  const late = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, exBody(mm, exId));
  assert.equal(late.status, 410);
  assert.equal(late.body.error.code, 'EXCEPTION_EXPIRED');
  assert.equal((await prisma.gymAssistedCheckInException.findUniqueOrThrow({ where: { id: exId } })).status, 'EXPIRED');
  assert.ok(await prisma.gymAssistedCheckInEvent.findFirst({ where: { exceptionId: exId, eventType: 'EXCEPTION_EXPIRED' } }));
  assert.equal(await prisma.gymCheckIn.count({ where: { membershipId: mm.m.id } }), 0);

  const m2 = await mkMember({ photo: null });
  const ex2 = (await reqException(R1, gym.a1, m2)).body.data.id;
  await prisma.gymAssistedCheckInException.update({ where: { id: ex2 }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const ap = await call(M, 'POST', `${FD(gym.a1)}/exceptions/${ex2}/approve`, { reason: 'Duyệt muộn mất rồi' });
  assert.equal(ap.status, 410);
  assert.equal(ap.body.error.code, 'EXCEPTION_EXPIRED');
  // sau khi hết hạn, được xin ngoại lệ mới
  assert.equal((await reqException(R1, gym.a1, m2)).status, 201);
});

integrationTest('ngoại lệ KHÔNG phải đường vòng: gói hết hạn / tạm khoá / hết buổi không xin được; ngoại lệ chi nhánh khác / hội viên khác không dùng được', async () => {
  for (const o of [{ status: 'EXPIRED' }, { status: 'PENDING_ISSUE' }, { endInDays: -1 }, { total: 2, used: 2, planId: plan.aVisits }] as MemberOpts[]) {
    const mm = await mkMember({ ...o, photo: null });
    const r = await reqException(R1, gym.a1, mm);
    assert.equal(r.status, 409, JSON.stringify(o));
    assert.equal(r.body.error.code, o.total ? 'VISIT_LIMIT_REACHED' : 'NOT_ACTIVE');
  }
  // Ngoại lệ đã duyệt ở a1 nhưng bị dùng ở a2 (hoặc cho hội viên khác) → không tìm thấy.
  const a = await mkMember({ photo: null });
  const b = await mkMember({ photo: null });
  const exId = (await reqException(R1, gym.a1, a)).body.data.id;
  await call(M, 'POST', `${FD(gym.a1)}/exceptions/${exId}/approve`, { reason: 'Đã xác minh trực tiếp' });
  const wrongGym = await call(R2, 'POST', `${FD(gym.a2)}/assisted-checkin`, exBody(a, exId));
  assert.equal(wrongGym.body.error.code, 'EXCEPTION_NOT_FOUND');
  const wrongMember = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, exBody(b, exId));
  assert.equal(wrongMember.body.error.code, 'EXCEPTION_NOT_FOUND');
  // Không thể duyệt ngoại lệ của chi nhánh khác qua URL chi nhánh mình.
  assert.equal((await call(M, 'POST', `${FD(gym.a2)}/exceptions/${exId}/approve`, { reason: 'duyệt nhầm chi nhánh' })).status, 403);
  assert.equal(await prisma.gymCheckIn.count({ where: { membershipId: { in: [a.m.id, b.m.id] } } }), 0);
});

// ───────────────────────────── 8. PT, lịch sử, nhật ký ─────────────────────────────
integrationTest('lễ tân KHÔNG check-in PT / xác nhận buổi PT / sửa-xoá lịch sử check-in / gia hạn gói: không có đường, không dòng nào thay đổi', async () => {
  const ptBefore = await prisma.gymPtCheckIn.count({ where: { gymId: { in: Object.values(gym) } } });
  const memBefore = await prisma.gymMembershipContract.findMany({ where: { gymId: gym.a1 }, select: { id: true, usedVisits: true, endDate: true, status: true } });
  const some = await mkMember();
  const ci = (await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, photoBody(some))).body.data.checkinId;
  const attempts: Array<[string, string, unknown?]> = [
    ['POST', `/owner/gyms/${gym.a1}/pt-checkins`, { ptUserId: id.pt }],
    ['POST', `${FD(gym.a1)}/pt-checkin`, { ptUserId: id.pt }],
    ['POST', `${FD(gym.a1)}/assisted-checkin/pt`, { ptUserId: id.pt }],
    ['POST', `/owner/gyms/${gym.a1}/pt-sessions/confirm`, { sessionId: randomUUID() }],
    ['POST', '/me/pt-gym-checkins', { token: 'x' }],
    ['DELETE', `/owner/gyms/${gym.a1}/checkins/${ci}`],
    ['PATCH', `/owner/gyms/${gym.a1}/checkins/${ci}`, { gymId: gym.a2 }],
    ['PUT', `/owner/gyms/${gym.a1}/checkins/${ci}`, {}],
    ['PATCH', `/owner/gyms/${gym.a1}/memberships/${some.m.id}`, { endDate: '2099-01-01', totalVisits: 999 }],
    ['POST', `/owner/gyms/${gym.a1}/memberships/${some.m.id}/extend`, { days: 30 }],
    ['PATCH', `/owner/brands/${brand.a}/plans/${plan.a}`, { price: 1 }],
  ];
  for (const [method, p, body] of attempts) {
    for (const tok of [R1, ACCT]) {
      const r = await call(tok, method, p, body);
      assert.ok([403, 404, 405].includes(r.status), `${tok} ${method} ${p} → ${r.status}`);
    }
  }
  // Với một PT: membershipId của một PT/UUID bất kỳ không phải hội viên → không tìm thấy, không có check-in PT.
  const asPt = await call(R1, 'POST', `${FD(gym.a1)}/assisted-checkin`, { requestId: rid(), membershipId: id.pt, method: 'PHOTO_MATCH', reason: 'PT quên điện thoại', photoMatchAttested: true, statedMemberCode: 'AAAA-AAAA' });
  assert.equal(asPt.status, 404);
  assert.equal(asPt.body.error.code, 'MEMBER_NOT_FOUND');
  assert.equal(await prisma.gymPtCheckIn.count({ where: { gymId: { in: Object.values(gym) } } }), ptBefore);
  assert.equal(await prisma.gymCheckIn.count({ where: { id: ci } }), 1);
  const memAfter = await prisma.gymMembershipContract.findMany({ where: { id: { in: memBefore.map((m) => m.id) } }, select: { id: true, usedVisits: true, endDate: true, status: true } });
  assert.deepEqual(memAfter.sort((x, y) => x.id.localeCompare(y.id)), memBefore.sort((x, y) => x.id.localeCompare(y.id)));
  // Cấu trúc: mã check-in hộ không đụng tới bảng/ dịch vụ check-in PT.
  const src = ['assisted-checkin.service.ts', 'assisted-checkin.controller.ts', 'checkin-core.ts'].map((f) => fs.readFileSync(path.join(__dirname, '..', f.endsWith('controller.ts') ? 'controllers' : 'services', f), 'utf8')).join('\n');
  assert.equal(/gymPtCheckIn|pt-checkin|ptCheckin|getPtGymSessions/.test(src), false, 'luồng check-in hộ không được chạm check-in PT');
});

integrationTest('nhật ký kiểm toán: đủ các loại sự kiện, CHỈ-THÊM (UPDATE/DELETE/TRUNCATE bị CSDL chặn), không chứa mã OTP / e-mail / SĐT / từ khoá tìm kiếm', async () => {
  const types = new Set((await prisma.gymAssistedCheckInEvent.findMany({ where: { gymId: { in: Object.values(gym) } }, select: { eventType: true } })).map((e) => e.eventType));
  for (const t of ['MEMBER_SEARCH', 'OTP_SENT', 'OTP_FAILED', 'CHECKIN_SUCCEEDED', 'CHECKIN_REFUSED', 'EXCEPTION_REQUESTED', 'EXCEPTION_APPROVED', 'EXCEPTION_REJECTED', 'EXCEPTION_EXPIRED']) {
    assert.ok(types.has(t as any), `thiếu sự kiện ${t}`);
  }
  const any = await prisma.gymAssistedCheckInEvent.findFirstOrThrow({ where: { gymId: gym.a1 } });
  await assert.rejects(() => prisma.gymAssistedCheckInEvent.update({ where: { id: any.id }, data: { outcome: 'TAMPERED' } }), /chỉ-thêm|append|integrity/i);
  await assert.rejects(() => prisma.gymAssistedCheckInEvent.delete({ where: { id: any.id } }), /chỉ-thêm|append|integrity/i);
  await assert.rejects(() => prisma.$executeRawUnsafe('TRUNCATE gym_assisted_checkin_events'), /chỉ-thêm|append|integrity/i);
  const dump = JSON.stringify(await prisma.gymAssistedCheckInEvent.findMany({ where: { gymId: { in: Object.values(gym) } } }));
  for (const leak of [SECRET_PHONE, 'member.test', SECRET_HEALTH, 'Nguyen', 'Nguyễn']) assert.equal(dump.includes(leak), false, `nhật ký chứa "${leak}"`);
  // Sự kiện tra cứu chỉ có cách tra và số kết quả.
  const s = await prisma.gymAssistedCheckInEvent.findFirstOrThrow({ where: { eventType: 'MEMBER_SEARCH', gymId: gym.a1 } });
  assert.deepEqual(Object.keys(s.details as object).sort(), ['matchedBy', 'resultCount']);
});

integrationTest('KHÔNG trường cấm trong BẤT KỲ phản hồi nào của quầy: không clientId / e-mail / SĐT / giá / mã giao dịch / sức khoẻ / OTP', async () => {
  const text = seenBodies.join('\n');
  assert.ok(text.length > 1000, 'cần có dữ liệu phản hồi để quét');
  const clientIds = [...people.keys()];
  for (const cid of clientIds) assert.equal(text.includes(cid), false, `lộ clientId ${cid}`);
  for (const leak of [SECRET_PHONE, SECRET_HEALTH, 'member.test', 'staff.test', '@', 'TXN-', '700000', '400000', 'priceAtPurchase', 'paymentTxnId', 'currentWeight', 'injuries', 'payoutReleasedAt', 'otpHash', 'stack']) {
    assert.equal(text.includes(leak), false, `phản hồi chứa "${leak}"`);
  }
  for (const mail of sentMails) assert.equal(new RegExp(`(?<![0-9a-f-])${lastOtpOf(mail.text)}(?![0-9a-f-])`).test(text), false, 'phản hồi chứa mã OTP');
});
function lastOtpOf(text: string) {
  return /:\s(\d{6})\n/.exec(text)![1];
}
