/**
 * FH-3c / D65-B across INSTANCES and CRASHES - several real user-service processes, one Postgres, the REAL payment-service ledger.
 * One unverified session release (session 4 of 10, 500,000 = PT 450,000 + platform 50,000, parked NEEDS_HUMAN) meets an ending.
 *
 * Evidence label: BACKEND INTEGRATION (real ledger). Kill = taskkill /F (SIGKILL semantics). TEST FIXTURE: the NEEDS_HUMAN status
 * (stands for 12 failed attempts), the proxy that drops a response / kills the instance once payment-service has answered.
 *
 *   RUN_MULTI_INSTANCE=1 MI_USER_DATABASE_URL="...gymcoach_user_fhe_mi_test?schema=public" \
 *   MI_PAYMENT_DATABASE_URL="...gymcoach_payment_fhe_mi_test?schema=public" \
 *     ./node_modules/.bin/tsx --test src/__tests__/multi-instance/mi-fh3c.e2e.test.ts
 *
 * Hand-computed (PT_CANCELLED, client made whole): refund 6 x 500,000 = 3,000,000.
 *   ledger never did the release -> HELD: PT available 1,350,000 / pending 450,000, platform available 150,000 / pending 50,000.
 *   ledger did it, answer lost   -> applied: PT available 1,800,000, platform 200,000, nothing held (a double pay would show 2,250,000).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { DAY, skip, sleep, startMi, type Mi, type PaidContract } from "./mi.harness";

let M: Mi;
test.before(async () => {
  if (skip) return;
  M = await startMi({ instances: 3, instanceEnv: { SESSION_SETTLEMENT_STALE_PROCESSING_MS: "3000" } });
});
test.after(async () => {
  if (M) await M.close();
});

async function scenario(fn: () => Promise<void>) {
  await M.resetAll();
  for (const i of M.instances) {
    i.proxy.clearArms();
    if (!i.alive()) await i.start();
  }
  await M.startPayment();
  await fn();
  await M.invariant("end of scenario");
}
async function until(fn: () => Promise<boolean>, ms = 15_000, step = 100) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return;
    await sleep(step);
  }
  throw new Error("until: timed out");
}
const aNet = async (A: PaidContract) => ({
  client: (await M.wallet("CLIENT", A.clientUserId)).a,
  ptAvail: await M.net(A.txnId, "PT", "AVAILABLE"),
  ptPend: await M.net(A.txnId, "PT", "PENDING"),
  platAvail: await M.net(A.txnId, "PLATFORM", "AVAILABLE", "REVENUE"),
  platPend: await M.net(A.txnId, "PLATFORM", "PENDING", "REVENUE"),
});
const HELD = { client: 3_000_000, ptAvail: 1_350_000, ptPend: 450_000, platAvail: 150_000, platPend: 50_000 };
const APPLIED = { client: 3_000_000, ptAvail: 1_800_000, ptPend: 0, platAvail: 200_000, platPend: 0 };
const endReq = (inst: number, A: PaidContract) => M.call(inst, "POST", `/contracts/${A.id}/terminate`, A.ptToken, { reason: "PT_CANCELLED" });

/** 3 sessions delivered; session 4's release is lost: never performed (payment down) or performed with the answer dropped. */
async function lostRelease(mode: "NEVER" | "PERFORMED") {
  const pt = await M.makePt();
  const A = await M.paidContract(pt);
  await M.deliver(A, 3);
  const S = await M.addSession(A, "CONFIRMED", new Date(Date.now() - 9 * DAY));
  assert.equal((await M.call(0, "PATCH", `/sessions/${S.id}/complete`, A.ptToken, { ptNotes: "ok" })).status, 200);
  if (mode === "NEVER") {
    await M.stopPayment();
    assert.equal((await M.call(0, "POST", `/sessions/${S.id}/confirm`, A.clientToken)).status, 200);
    await M.startPayment();
  } else {
    const fired = M.instances[0].proxy.arm({ when: (p) => p.includes("release-session"), dropResponse: true });
    assert.equal((await M.call(0, "POST", `/sessions/${S.id}/confirm`, A.clientToken)).status, 200);
    await fired;
  }
  const row = await M.prisma.sessionSettlement.findUniqueOrThrow({ where: { idempotencyKey: `SESSION_RELEASE:${S.id}` } });
  assert.equal(row.status, "FAILED");
  await M.prisma.sessionSettlement.update({ where: { id: row.id }, data: { status: "NEEDS_HUMAN", attempts: 12, lastError: "NEEDS_RECONCILIATION: 12 failed attempts (cap 12)" } });
  assert.equal(Number((await M.contractRow(A.id)).releasedToPt), 1_350_000);
  assert.equal(await M.opCount(`SESSION_RELEASE:${S.id}`), mode === "NEVER" ? 0 : 1);
  return { A, S, row };
}

test("M1 [REGRESSION] 'lost answer' + the SAME ending on 3 instances at once: the stored result is applied once, the client refunded once, the PT paid 1,800,000 (never 2,250,000)", { skip, timeout: 300_000 }, async () => {
  await scenario(async () => {
    const { A, S, row } = await lostRelease("PERFORMED");
    const results = await Promise.all([0, 1, 2].map((i) => endReq(i, A)));
    assert.ok(results.some((r) => r.status === 200), JSON.stringify(results.map((r) => [r.status, r.body])));
    for (const r of results) assert.ok([200, 409].includes(r.status), `${r.status} ${JSON.stringify(r.body)}`);
    // anything that answered 409 (CONTRACT_ENDING) is finished by a retry
    for (const r of results) if (r.status === 409) assert.ok(["CONTRACT_ENDING", "CONTRACT_ENDED", "SESSION_SETTLEMENT_PENDING"].includes(r.body.code ?? r.body.error?.code), JSON.stringify(r.body));
    await M.job(0, "settlement");
    assert.equal((await M.contractRow(A.id)).status, "CANCELLED");
    assert.deepEqual(await aNet(A), APPLIED);
    assert.equal(Number((await M.contractRow(A.id)).releasedToPt), 1_800_000, "applied exactly once");
    assert.equal((await M.prisma.sessionSettlement.findUniqueOrThrow({ where: { id: row.id } })).status, "SETTLED");
    assert.equal(await M.opCount(`SESSION_RELEASE:${S.id}`), 1);
    assert.equal(await M.opCount(`CONTRACT_TERMINATE:${A.id}`), 1);
  });
});

test("M2 [REGRESSION] release NEVER performed + the same ending on 3 instances at once: ONE hold of 500,000, the client refunded 3,000,000 once, the row UNCONFIRMED", { skip, timeout: 300_000 }, async () => {
  await scenario(async () => {
    const { A, row } = await lostRelease("NEVER");
    const results = await Promise.all([0, 1, 2].map((i) => endReq(i, A)));
    assert.ok(results.some((r) => r.status === 200), JSON.stringify(results.map((r) => [r.status, r.body])));
    await M.job(1, "settlement");
    assert.equal((await M.contractRow(A.id)).status, "CANCELLED");
    assert.deepEqual(await aNet(A), HELD);
    assert.equal((await M.prisma.sessionSettlement.findUniqueOrThrow({ where: { id: row.id } })).status, "UNCONFIRMED");
    assert.equal(await M.opCount(`CONTRACT_TERMINATE:${A.id}`), 1);
  });
});

test("M3 [REGRESSION] CRASH: the instance is killed after payment-service performed the ending WITH the hold but before it answered; another instance's sweep finishes it - same figures, nothing moved twice", { skip, timeout: 300_000 }, async () => {
  await scenario(async () => {
    const { A, row } = await lostRelease("NEVER");
    const victim = M.instances[2];
    const fired = victim.proxy.arm({ when: (p) => p.includes("contracts/terminate"), afterPayment: () => victim.kill(), dropResponse: true });
    const first = endReq(2, A);
    await fired;
    await until(async () => !victim.alive(), 10_000);
    assert.equal((await first).status, 0, "the client never got an answer");
    assert.equal((await M.contractRow(A.id)).status, "ACTIVE", "the final status was never written");
    assert.equal((await M.prisma.sessionSettlement.findUniqueOrThrow({ where: { id: row.id } })).status, "UNCONFIRMED", "the hold was committed WITH the intent");
    const moved = await aNet(A);
    assert.deepEqual(moved, HELD, "the ledger already performed the ending");
    const snap = await M.snapshot();
    await sleep(3300);
    const at = Date.now() + 300;
    await Promise.all([0, 1].map((i) => M.job(i, "settlement", at)));
    assert.equal((await M.contractRow(A.id)).status, "CANCELLED");
    assert.deepEqual(await aNet(A), HELD);
    assert.deepEqual(await M.snapshot(), snap, "the replay moved nothing");
    assert.equal(await M.opCount(`CONTRACT_TERMINATE:${A.id}`), 1);
  });
});

test("M4 [REGRESSION] CRASH between the hold and the money call (intent + UNCONFIRMED row durable, terminate NEVER reached payment-service): another instance's sweep sends it WITH the hold", { skip, timeout: 300_000 }, async () => {
  await scenario(async () => {
    const { A, row } = await lostRelease("NEVER");
    const victim = M.instances[2];
    // the terminate request is held at the proxy and never forwarded: payment-service does not see it before the instance dies
    victim.proxy.arm({ when: (p) => p.includes("contracts/terminate"), holdBefore: new Promise(() => {}) });
    const first = endReq(2, A);
    void first.catch(() => undefined);
    await until(async () => (await M.prisma.sessionSettlement.findUnique({ where: { id: row.id } }))?.status === "UNCONFIRMED", 15_000);
    await until(async () => (await M.prisma.sessionSettlement.findUnique({ where: { idempotencyKey: `CONTRACT_TERMINATE:${A.id}` } }))?.status === "PROCESSING", 15_000);
    await victim.kill();
    assert.equal(await M.opCount(`CONTRACT_TERMINATE:${A.id}`), 0, "payment-service never saw the ending");
    assert.equal((await M.contractRow(A.id)).status, "ACTIVE");
    await sleep(3300);
    const at = Date.now() + 300;
    await Promise.all([0, 1].map((i) => M.job(i, "settlement", at)));
    assert.equal((await M.contractRow(A.id)).status, "CANCELLED");
    assert.deepEqual(await aNet(A), HELD);
    assert.equal(await M.opCount(`CONTRACT_TERMINATE:${A.id}`), 1, "sent once");
  });
});
