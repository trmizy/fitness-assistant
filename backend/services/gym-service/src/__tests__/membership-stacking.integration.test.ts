/**
 * Membership stacking ("Gia han", owner rule 19/11/2026).
 *
 * Evidence label: BACKEND INTEGRATION (real Prisma on the isolated `*_test` database, real membership.service /
 * membership.repository / checkin.service / membershipPayout.sweep; payment-service is a local FAKE HTTP server that records the
 * calls) + pure unit tests. Skipped (reason printed) unless the isolation preload accepted a `*_test` database.
 *
 * Covers: stacking start/end (no overlap, no lost day, gap -> starts now, brand-wide, concurrent activations chain), the buyer's
 * projection, "one unpaid order at a time", lookup (upcoming is never active), check-in only inside the active period
 * (NOT_STARTED, picks the current one), the payout sweep (a stacked membership is released only after ITS OWN end, never at purchase
 * and never when the previous one ends), upcoming self-cancel refused, refund quote of an unstarted membership, member counts.
 */
import nodeTest from 'node:test';
import { guardedTest as test, skip } from './test-db-guard';
import assert from 'node:assert/strict';
import http from 'node:http';
import { randomUUID } from 'node:crypto';

import { stackedPeriod, MEMBERSHIP_DAY_MS } from '../services/membership-stacking';
import { isMembershipActive, isMembershipUpcoming, hasStarted } from '../services/membership-eligibility.service';

const DAY = MEMBERSHIP_DAY_MS;

// ---------------------------------------------------------------- pure (no DB)
nodeTest('stackedPeriod: renewal starts exactly when the latest one ends; a gap or nothing starts now', () => {
  const now = new Date('2026-11-19T00:00:00Z');
  const end = new Date(now.getTime() + 20 * DAY);
  const r = stackedPeriod(now, end, 30);
  assert.equal(r.isRenewal, true);
  assert.equal(r.startDate.getTime(), end.getTime(), 'no overlap, no lost day');
  assert.equal(r.endDate.getTime(), end.getTime() + 30 * DAY);
  const none = stackedPeriod(now, null, 30);
  assert.equal(none.isRenewal, false);
  assert.equal(none.startDate.getTime(), now.getTime());
  assert.equal(none.endDate.getTime(), now.getTime() + 30 * DAY);
  const past = stackedPeriod(now, new Date(now.getTime() - DAY), 7);
  assert.equal(past.isRenewal, false);
  assert.equal(past.startDate.getTime(), now.getTime());
  const same = stackedPeriod(now, new Date(now.getTime()), 7);
  assert.equal(same.isRenewal, false, 'ending exactly now is not a queue');
});

nodeTest('isMembershipActive / isMembershipUpcoming: a future start is upcoming, never active', () => {
  const now = new Date('2026-11-19T00:00:00Z');
  const base = { status: 'ACTIVE', totalVisits: null as number | null, usedVisits: 0 };
  const cur = { ...base, startDate: new Date(now.getTime() - DAY), endDate: new Date(now.getTime() + DAY) };
  const up = { ...base, startDate: new Date(now.getTime() + DAY), endDate: new Date(now.getTime() + 31 * DAY) };
  assert.equal(isMembershipActive(cur, now), true);
  assert.equal(isMembershipUpcoming(cur, now), false);
  assert.equal(isMembershipActive(up, now), false);
  assert.equal(isMembershipUpcoming(up, now), true);
  assert.equal(isMembershipActive({ ...cur, startDate: null }, now), true, 'legacy row without a start date');
  assert.equal(hasStarted(new Date(now.getTime()), now), true, 'start == now has started');
  assert.equal(isMembershipUpcoming({ ...up, status: 'CANCELLED' }, now), false);
});

// ---------------------------------------------------------------- DB + fake payment-service
let fakePayment: http.Server;
const paymentCalls: Array<{ method?: string; url?: string; body: any }> = [];
let prismaRef: typeof import('../repositories/prisma').prisma;
let membershipService: typeof import('../services/membership.service').membershipService;
let membershipRepository: typeof import('../repositories/membership.repository').membershipRepository;
let checkinService: typeof import('../services/checkin.service').checkinService;
let signToken: typeof import('../utils/checkinToken').signGymCheckinToken;
let eligibility: typeof import('../services/membership-eligibility.service').membershipEligibilityService;
let runSweep: typeof import('../services/membershipPayout.sweep').runSweep;

const created = { memberships: [] as string[], plans: [] as string[], gyms: [] as string[], brands: [] as string[] };

test.before(async () => {
  fakePayment = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body: any = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { body = null; }
      paymentCalls.push({ method: req.method, url: req.url, body });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (req.url === '/internal/payments/checkout') {
        res.end(JSON.stringify({ data: { transactionId: 'fake-txn', status: 'PENDING', redirectUrl: 'http://127.0.0.1/fake', qrCodeUrl: null, provider: 'VNPAY' } }));
      } else if (req.url === '/internal/contracts/membership-release') {
        res.end(JSON.stringify({ data: { released: { gym: '0', platform: '0', ptReferral: '0' }, refundedToClient: '0', shortfall: '0' } }));
      } else {
        res.end(JSON.stringify({ data: {} }));
      }
    });
  });
  await new Promise<void>((r) => fakePayment.listen(0, '127.0.0.1', () => r()));
  process.env.PAYMENT_SERVICE_URL = `http://127.0.0.1:${(fakePayment.address() as { port: number }).port}`;
  prismaRef = (await import('../repositories/prisma')).prisma;
  membershipService = (await import('../services/membership.service')).membershipService;
  membershipRepository = (await import('../repositories/membership.repository')).membershipRepository;
  checkinService = (await import('../services/checkin.service')).checkinService;
  signToken = (await import('../utils/checkinToken')).signGymCheckinToken;
  eligibility = (await import('../services/membership-eligibility.service')).membershipEligibilityService;
  runSweep = (await import('../services/membershipPayout.sweep')).runSweep;
});

test.after(async () => {
  if (!skip) {
    await prismaRef.gymCheckIn.deleteMany({ where: { membershipId: { in: created.memberships } } });
    await prismaRef.gymMembershipContract.deleteMany({ where: { id: { in: created.memberships } } });
    await prismaRef.gymMembershipPlan.deleteMany({ where: { id: { in: created.plans } } });
    await prismaRef.gym.deleteMany({ where: { id: { in: created.gyms } } });
    await prismaRef.gymBrand.deleteMany({ where: { id: { in: created.brands } } });
    await prismaRef.$disconnect();
  }
  await new Promise<void>((r) => (fakePayment ? fakePayment.close(() => r()) : r()));
});

async function brandWithBranches(n = 2, o: { durationDays?: number; visitLimit?: number | null } = {}) {
  const brand = await prismaRef.gymBrand.create({ data: { id: randomUUID(), ownerId: randomUUID(), name: 'Stack Brand' } });
  created.brands.push(brand.id);
  const gyms: string[] = [];
  for (let i = 0; i < n; i++) {
    const g = await prismaRef.gym.create({
      data: { id: randomUUID(), ownerId: brand.ownerId, brandId: brand.id, name: `Stack Gym ${i}`, address: '1 Test St', status: 'APPROVED' },
    });
    created.gyms.push(g.id);
    gyms.push(g.id);
  }
  const plan = await prismaRef.gymMembershipPlan.create({
    data: { id: randomUUID(), brandId: brand.id, name: 'Stack Plan', price: 500_000, durationDays: o.durationDays ?? 30, visitLimit: o.visitLimit ?? null },
  });
  created.plans.push(plan.id);
  return { brandId: brand.id, gyms, planId: plan.id };
}

async function seedMembership(gymId: string, planId: string, clientId: string, o: { status?: any; startDate?: Date | null; endDate?: Date | null; paymentTxnId?: string | null; totalVisits?: number | null } = {}) {
  const m = await prismaRef.gymMembershipContract.create({
    data: {
      id: randomUUID(), gymId, planId, clientId,
      status: o.status ?? 'ACTIVE',
      priceAtPurchase: 500_000,
      durationDaysSnapshot: 30,
      startDate: o.startDate === undefined ? new Date() : o.startDate,
      endDate: o.endDate === undefined ? new Date(Date.now() + 30 * DAY) : o.endDate,
      paymentTxnId: o.paymentTxnId === undefined ? `txn-${randomUUID()}` : o.paymentTxnId,
      totalVisits: o.totalVisits ?? null,
    },
  });
  created.memberships.push(m.id);
  return m;
}

/** Buy through the real service, then land the payment through the real activation write. */
async function buyAndActivate(gymId: string, planId: string, clientId: string) {
  const bought: any = await membershipService.purchase(gymId, planId, clientId);
  created.memberships.push(bought.membership.id);
  const { affected, contract } = await membershipRepository.activateIfPending(bought.membership.id, `txn-${randomUUID()}`);
  assert.equal(affected, 1);
  return { bought, active: contract! };
}

test('stacking: a client with a running membership buys again - the new one starts exactly at the old end, then a third chains on the second', async () => {
  const { gyms, planId } = await brandWithBranches(1);
  const client = randomUUID();
  const m1 = await seedMembership(gyms[0], planId, client, { startDate: new Date(Date.now() - 10 * DAY), endDate: new Date(Date.now() + 20 * DAY) });

  const first = await buyAndActivate(gyms[0], planId, client);
  // The projection shown before payment says "Gia han" with the resulting end.
  assert.equal(first.bought.renewal.isRenewal, true);
  assert.equal(new Date(first.bought.renewal.startsAt).getTime(), m1.endDate!.getTime());
  assert.equal(new Date(first.bought.renewal.endsAt).getTime(), m1.endDate!.getTime() + 30 * DAY);
  // The binding dates (set when payment lands): no overlap, no lost day.
  assert.equal(first.active.status, 'ACTIVE');
  assert.equal(first.active.startDate!.getTime(), m1.endDate!.getTime());
  assert.equal(first.active.endDate!.getTime(), m1.endDate!.getTime() + 30 * DAY);

  const second = await buyAndActivate(gyms[0], planId, client);
  assert.equal(second.active.startDate!.getTime(), first.active.endDate!.getTime());
  assert.equal(second.active.endDate!.getTime(), first.active.endDate!.getTime() + 30 * DAY);
});

test('stacking: no running membership, or one that already ended -> the new one starts now (not a renewal)', async () => {
  const { gyms, planId } = await brandWithBranches(1);
  const fresh = randomUUID();
  const before = Date.now();
  const a = await buyAndActivate(gyms[0], planId, fresh);
  assert.equal(a.bought.renewal.isRenewal, false);
  assert.ok(a.active.startDate!.getTime() >= before && a.active.startDate!.getTime() <= Date.now());
  assert.equal(a.active.endDate!.getTime() - a.active.startDate!.getTime(), 30 * DAY);

  const lapsed = randomUUID();
  await seedMembership(gyms[0], planId, lapsed, { status: 'EXPIRED', startDate: new Date(Date.now() - 40 * DAY), endDate: new Date(Date.now() - 10 * DAY) });
  const b = await buyAndActivate(gyms[0], planId, lapsed);
  assert.equal(b.bought.renewal.isRenewal, false);
  assert.ok(Math.abs(b.active.startDate!.getTime() - Date.now()) < 60_000);
});

test('stacking is brand-wide: a membership at a sibling branch is where the renewal queues behind', async () => {
  const { gyms, planId } = await brandWithBranches(2);
  const client = randomUUID();
  const m1 = await seedMembership(gyms[0], planId, client, { endDate: new Date(Date.now() + 15 * DAY) });
  const r = await buyAndActivate(gyms[1], planId, client);
  assert.equal(r.active.startDate!.getTime(), m1.endDate!.getTime());
});

test('only an UNPAID order blocks a purchase: a second pending at the same gym -> 409 ALREADY_HAS_PENDING_MEMBERSHIP', async () => {
  const { gyms, planId } = await brandWithBranches(1);
  const client = randomUUID();
  await seedMembership(gyms[0], planId, client);
  const bought: any = await membershipService.purchase(gyms[0], planId, client);
  created.memberships.push(bought.membership.id);
  await assert.rejects(
    () => membershipService.purchase(gyms[0], planId, client),
    (e: any) => e.status === 409 && e.message === 'ALREADY_HAS_PENDING_MEMBERSHIP' && e.membershipId === bought.membership.id,
  );
});

test('concurrent activations of two orders (two branches, same brand) chain - they never overlap', async () => {
  const { gyms, planId } = await brandWithBranches(2);
  const client = randomUUID();
  const m1 = await seedMembership(gyms[0], planId, client, { endDate: new Date(Date.now() + 10 * DAY) });
  const pa: any = await membershipService.purchase(gyms[0], planId, client);
  const pb: any = await membershipService.purchase(gyms[1], planId, client);
  created.memberships.push(pa.membership.id, pb.membership.id);
  await Promise.all([
    membershipRepository.activateIfPending(pa.membership.id, 'txn-a'),
    membershipRepository.activateIfPending(pb.membership.id, 'txn-b'),
  ]);
  const rows = (await prismaRef.gymMembershipContract.findMany({ where: { id: { in: [pa.membership.id, pb.membership.id] } } }))
    .sort((x, y) => x.startDate!.getTime() - y.startDate!.getTime());
  assert.equal(rows[0].startDate!.getTime(), m1.endDate!.getTime());
  assert.equal(rows[1].startDate!.getTime(), rows[0].endDate!.getTime(), 'second starts exactly when the first ends');
});

test('lookup: a queued renewal is reported in `upcoming`, never as an active membership; with only a queued one the client has no active membership', async () => {
  const { gyms, planId } = await brandWithBranches(1);
  const client = randomUUID();
  const cur = await seedMembership(gyms[0], planId, client, { endDate: new Date(Date.now() + 10 * DAY) });
  const up = await seedMembership(gyms[0], planId, client, { startDate: cur.endDate, endDate: new Date(cur.endDate!.getTime() + 30 * DAY) });
  const l = await eligibility.lookup(client, { gymId: gyms[0] });
  assert.equal(l.hasActiveMembership, true);
  assert.deepEqual(l.memberships.map((m) => m.membershipId), [cur.id]);
  assert.deepEqual(l.upcoming.map((m) => m.membershipId), [up.id]);
  assert.equal(l.upcoming[0].startDate, cur.endDate!.toISOString());

  const onlyQueued = randomUUID();
  const q = await seedMembership(gyms[0], planId, onlyQueued, { startDate: new Date(Date.now() + 5 * DAY), endDate: new Date(Date.now() + 35 * DAY) });
  const l2 = await eligibility.lookup(onlyQueued, { gymId: gyms[0] });
  assert.equal(l2.hasActiveMembership, false);
  assert.equal(l2.membership, null);
  assert.deepEqual(l2.upcoming.map((m) => m.membershipId), [q.id]);
  assert.deepEqual(await eligibility.activeGymIds(onlyQueued), [], 'a queued membership opens no branch');
});

test('check-in: only inside the active period - uses the current membership, refuses a queued-only one (NOT_STARTED), works once its start has come', async () => {
  const { gyms, planId } = await brandWithBranches(1);
  const token = signToken(gyms[0]).token;

  // current + queued: the visit lands on the CURRENT one (the queued one is newer, but not started)
  const client = randomUUID();
  const cur = await seedMembership(gyms[0], planId, client, { startDate: new Date(Date.now() - 5 * DAY), endDate: new Date(Date.now() + 5 * DAY) });
  const up = await seedMembership(gyms[0], planId, client, { startDate: cur.endDate, endDate: new Date(cur.endDate!.getTime() + 30 * DAY) });
  await checkinService.checkInByGymToken(client, token);
  assert.equal((await prismaRef.gymMembershipContract.findUnique({ where: { id: cur.id } }))!.usedVisits, 1);
  assert.equal((await prismaRef.gymMembershipContract.findUnique({ where: { id: up.id } }))!.usedVisits, 0);

  // only a queued one: refused, nothing counted
  const queuedOnly = randomUUID();
  const q = await seedMembership(gyms[0], planId, queuedOnly, { startDate: new Date(Date.now() + 3 * DAY), endDate: new Date(Date.now() + 33 * DAY) });
  await assert.rejects(() => checkinService.checkInByGymToken(queuedOnly, token), (e: any) => e.message === 'NOT_STARTED' && e.status === 409);
  assert.equal((await prismaRef.gymMembershipContract.findUnique({ where: { id: q.id } }))!.usedVisits, 0);

  // the previous one ended (EXPIRED) and the queued one's start has come: the renewal is now the active period
  const rolled = randomUUID();
  await seedMembership(gyms[0], planId, rolled, { status: 'EXPIRED', startDate: new Date(Date.now() - 31 * DAY), endDate: new Date(Date.now() - 1 * DAY) });
  const now2 = await seedMembership(gyms[0], planId, rolled, { startDate: new Date(Date.now() - 1 * DAY), endDate: new Date(Date.now() + 29 * DAY) });
  await checkinService.checkInByGymToken(rolled, token);
  assert.equal((await prismaRef.gymMembershipContract.findUnique({ where: { id: now2.id } }))!.usedVisits, 1);
});

test('MONEY - payout of a stacked membership is scheduled at ITS OWN end: not at purchase, not when the previous one ends; the sweep releases each exactly once', async () => {
  const { gyms, planId } = await brandWithBranches(1);
  const client = randomUUID();
  // m1 is about to end; the renewal m2 (bought + paid) queues behind it.
  const m1 = await seedMembership(gyms[0], planId, client, { startDate: new Date(Date.now() - 29 * DAY), endDate: new Date(Date.now() + 1 * DAY) });
  const { active: m2 } = await buyAndActivate(gyms[0], planId, client);
  const releasesFor = (id: string) => paymentCalls.filter((c) => c.url === '/internal/contracts/membership-release' && c.body?.idempotencyKey === `MEMBERSHIP_RELEASE:${id}`);

  // 1) purchase + activation of the renewal released nothing (money stays in escrow / pending).
  assert.equal(releasesFor(m2.id).length, 0, 'no release at purchase/activation');
  await runSweep();
  assert.equal(releasesFor(m1.id).length, 0, 'm1 still running -> nothing released');
  assert.equal(releasesFor(m2.id).length, 0, 'm2 not started -> nothing released');

  // 2) m1's period ends: the sweep expires + releases m1 ONLY; m2's money stays pending (its own period has not even begun).
  await prismaRef.gymMembershipContract.update({ where: { id: m1.id }, data: { endDate: new Date(Date.now() - 1000) } });
  await prismaRef.gymMembershipContract.update({ where: { id: m2.id }, data: { startDate: new Date(Date.now() - 1000), endDate: new Date(Date.now() + 30 * DAY - 1000) } });
  await runSweep();
  assert.equal(releasesFor(m1.id).length, 1, 'm1 released once at its own end');
  assert.equal(releasesFor(m2.id).length, 0, 'm2 is now running: still not released');
  assert.equal((await prismaRef.gymMembershipContract.findUnique({ where: { id: m2.id } }))!.status, 'ACTIVE');
  assert.equal((await prismaRef.gymMembershipContract.findUnique({ where: { id: m2.id } }))!.payoutReleasedAt, null);

  // 3) m2's own period ends: released then, once; a second sweep does not release again (idempotent).
  await prismaRef.gymMembershipContract.update({ where: { id: m2.id }, data: { endDate: new Date(Date.now() - 1000) } });
  await runSweep();
  await runSweep();
  assert.equal(releasesFor(m2.id).length, 1, 'm2 released exactly once, at its own end');
  assert.equal(releasesFor(m1.id).length, 1, 'm1 not released again');
  assert.notEqual((await prismaRef.gymMembershipContract.findUnique({ where: { id: m2.id } }))!.payoutReleasedAt, null);
});

test('self-cancel of a queued (not started) membership is refused with its own code, even when the cancel flag is on', async () => {
  const { gyms, planId } = await brandWithBranches(1);
  const client = randomUUID();
  const up = await seedMembership(gyms[0], planId, client, { startDate: new Date(Date.now() + 5 * DAY), endDate: new Date(Date.now() + 35 * DAY) });
  const prev = process.env.GYM_CLIENT_CANCEL_ACTIVE_ENABLED;
  process.env.GYM_CLIENT_CANCEL_ACTIVE_ENABLED = 'true';
  try {
    await assert.rejects(() => membershipService.cancelByClient(up.id, client), (e: any) => e.status === 409 && e.code === 'MEMBERSHIP_UPCOMING_CANCEL_DISABLED');
  } finally {
    if (prev === undefined) delete process.env.GYM_CLIENT_CANCEL_ACTIVE_ENABLED;
    else process.env.GYM_CLIENT_CANCEL_ACTIVE_ENABLED = prev;
  }
  assert.equal((await prismaRef.gymMembershipContract.findUnique({ where: { id: up.id } }))!.status, 'ACTIVE', 'untouched');
});

test('refund quote of a queued membership: the whole term is unused -> full price back, remaining days = the plan length (not term + wait)', async () => {
  const start = new Date(Date.now() + 20 * DAY);
  const q = membershipService.quoteRefund({ priceAtPurchase: 500_000, durationDaysSnapshot: 30, startDate: start, endDate: new Date(start.getTime() + 30 * DAY) });
  assert.equal(q.refundAmount, 500_000);
  assert.equal(q.remainingDays, 30);
  assert.equal(q.fraction, 1);
});

test('listForClient flags a queued membership with isUpcoming; the owner member count excludes it', async () => {
  const { gyms, planId } = await brandWithBranches(1);
  const client = randomUUID();
  const cur = await seedMembership(gyms[0], planId, client, { startDate: new Date(Date.now() - 1 * DAY), endDate: new Date(Date.now() + 5 * DAY) });
  const up = await seedMembership(gyms[0], planId, client, { startDate: cur.endDate, endDate: new Date(cur.endDate!.getTime() + 30 * DAY) });
  const list = await membershipService.listForClient(client);
  assert.equal(list.find((m) => m.id === cur.id)!.isUpcoming, false);
  assert.equal(list.find((m) => m.id === up.id)!.isUpcoming, true);
  const counts = await membershipRepository.countActiveByGyms([gyms[0]]);
  assert.equal(counts.get(gyms[0]), 1, 'only the running membership counts as a current member');
});
