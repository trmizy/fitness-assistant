/**
 * Codex #1 / BR-27 across INSTANCES: one live PT-client contract per pair, with the requests spread over TWO separate user-service
 * OS processes (own Prisma pools, own memory) against ONE database - so neither an in-process lock nor a per-process flag can be
 * what holds the line. Only the Postgres advisory lock + the partial unique index can.
 *
 * Evidence label: BACKEND INTEGRATION (real HTTP into two real Express processes, real Postgres). See mi.harness.ts for what is a
 * fixture (token table instead of auth-service, which answers 404 to the account-status lookup = "no such account marked blocked").
 * Run alone:
 *   cd backend/services/user-service
 *   RUN_MULTI_INSTANCE=1 MI_USER_DATABASE_URL=postgresql://...@localhost:55433/gymcoach_user_g2_mi_test?schema=public \
 *   MI_PAYMENT_DATABASE_URL=postgresql://...@localhost:55433/gymcoach_payment_g2_mi_test?schema=public \
 *   ./node_modules/.bin/tsx --test src/__tests__/multi-instance/mi-contract-pair-race.e2e.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { skip, startMi, type Mi } from "./mi.harness";

let M: Mi;
test.before(async () => {
  if (skip) return;
  M = await startMi({ instances: 2 });
});
test.after(async () => {
  if (M) await M.close();
});

async function ptWithPackage() {
  const ptUserId = await M.makePt();
  const pkg = await M.prisma.pTServicePackage.create({
    data: { ptUserId, name: "Goi 10 buoi", sessionCount: 10, price: 5_000_000, sessionMode: "OFFLINE", sessionDurationMinutes: 60, validityDays: 90 },
  });
  return { ptUserId, packageId: pkg.id };
}
const request = (inst: number, clientId: string, body: object) => M.call(inst, "POST", "/contracts/request", M.tokenFor(clientId, "CUSTOMER"), body);
const liveCount = (pt: string, client: string) =>
  M.prisma.contract.count({ where: { ptUserId: pt, clientUserId: client, status: { in: ["PENDING_REVIEW", "PENDING_SIGNATURE", "PENDING_PAYMENT", "ACTIVE"] } } });

test("the index is installed on this database (the mi database is built by migrate deploy)", { skip }, async () => {
  const r: any[] = await M.prisma.$queryRawUnsafe("SELECT count(*)::int AS n FROM pg_indexes WHERE indexname = 'contracts_one_live_per_pair'");
  assert.equal(r[0].n, 1);
});

test("12 simultaneous POST /contracts/request for 3 pairs, alternating between 2 instances -> exactly ONE contract per pair", { skip }, async () => {
  await M.resetAll();
  const { ptUserId, packageId } = await ptWithPackage();
  const clients = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
  const calls: Promise<{ status: number; body: any; pair: number; inst: number }>[] = [];
  for (let i = 0; i < 12; i++) {
    const pair = i % 3;
    const inst = i % 2;
    calls.push(request(inst, clients[pair], { ptUserId, packageId, acknowledgedLowAvailability: true }).then((r) => ({ ...r, pair, inst })));
  }
  const results = await Promise.all(calls);
  for (let pair = 0; pair < 3; pair++) {
    const mine = results.filter((r) => r.pair === pair);
    assert.equal(mine.filter((r) => r.status === 201).length, 1, `pair ${pair}: exactly one 201 (${mine.map((r) => r.status)})`);
    for (const loser of mine.filter((r) => r.status !== 201)) assert.equal(loser.status, 409, `pair ${pair}: losers are 409, got ${loser.status} ${JSON.stringify(loser.body)}`);
    assert.equal(await liveCount(ptUserId, clients[pair]), 1, `pair ${pair}: one live row in the database`);
  }
  // the winners really came from both processes over the run (not a single-instance result)
  console.log("[MI] pair race winners by instance", JSON.stringify(results.filter((r) => r.status === 201).map((r) => r.inst)));
});

test("a PENDING_PAYMENT contract blocks a second request made on ANOTHER instance; after it is cancelled a new one is allowed", { skip }, async () => {
  await M.resetAll();
  const { ptUserId, packageId } = await ptWithPackage();
  const client = crypto.randomUUID();
  const existing = await M.prisma.contract.create({
    data: {
      id: crypto.randomUUID(), ptUserId, clientUserId: client, packageName: "Seed", totalSessions: 10, price: 5_000_000,
      status: "PENDING_PAYMENT", paymentDueAt: new Date(Date.now() + 6 * 3600_000),
    },
  });
  const blocked = await request(1, client, { ptUserId, packageId, acknowledgedLowAvailability: true });
  assert.equal(blocked.status, 409, JSON.stringify(blocked.body));
  assert.equal(await liveCount(ptUserId, client), 1);
  await M.prisma.contract.update({ where: { id: existing.id }, data: { status: "CANCELLED" } });
  const again = await request(0, client, { ptUserId, packageId, acknowledgedLowAvailability: true });
  assert.equal(again.status, 201, JSON.stringify(again.body));
  assert.equal(await liveCount(ptUserId, client), 1);
});

test("the database refuses a second live row even when a writer skips the application lock (raw INSERTs from the test process)", { skip }, async () => {
  await M.resetAll();
  const pt = crypto.randomUUID();
  const client = crypto.randomUUID();
  const mk = (status: string, source = "INDEPENDENT") =>
    M.prisma.contract.create({ data: { id: crypto.randomUUID(), ptUserId: pt, clientUserId: client, packageName: "Seed", totalSessions: 1, price: 1, status: status as any, source: source as any } });
  const settled = await Promise.allSettled([mk("PENDING_REVIEW"), mk("PENDING_PAYMENT"), mk("ACTIVE"), mk("PENDING_SIGNATURE")]);
  assert.equal(settled.filter((s) => s.status === "fulfilled").length, 1);
  assert.equal(settled.filter((s) => s.status === "rejected" && (s.reason as any)?.code === "P2002").length, 3);
  await mk("ACTIVE", "MARKETPLACE");
  await mk("ACTIVE", "MARKETPLACE");
});
