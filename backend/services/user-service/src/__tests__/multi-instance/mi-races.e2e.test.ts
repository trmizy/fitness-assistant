/**
 * Audit D57-1 - groups 1-4: the F4 race family, contract endings, confirm/dispute/ruling and every sweep, fired ACROSS
 * three separate user-service OS processes against ONE database and the REAL payment-service ledger.
 *
 * Evidence label: BACKEND INTEGRATION (real ledger). See mi.harness.ts for what is real and what is a fixture.
 * Run alone:
 *   cd backend/services/user-service
 *   RUN_MULTI_INSTANCE=1 ./node_modules/.bin/tsx --test src/__tests__/multi-instance/mi-races.e2e.test.ts
 *
 * Money (price 5,000,000 / 10 sessions; one session = 500,000 = PT 450,000 + platform 50,000; no gym; holdback OFF).
 * Contract A: 2 delivered sessions (PT 900,000 + platform 100,000 AVAILABLE), 8 sessions of unused value.
 *   ending only (CLIENT_CANCELLED, 8 unused):  client 3,600,000   PT 1,260,000   platform 140,000
 *   late cancel won + ending (7 unused):       client 3,150,000   PT 1,665,000   platform 185,000
 *   no-show won + ending (1 compensated):      client 3,650,000   PT 1,215,000   platform 135,000
 */
import test from "node:test";
import assert from "node:assert/strict";
import { HOUR, DAY, skip, sleep, startMi, type Mi, type PaidContract } from "./mi.harness";

let M: Mi;
test.before(async () => {
  if (skip) return;
  M = await startMi({ instances: 3 });
});
test.after(async () => {
  if (M) await M.close();
});
const show = (label: string, o: Record<string, unknown>) => console.log(`[MI] ${label} ${JSON.stringify(o)}`);

async function scenario(fn: () => Promise<void>) {
  await M.resetAll();
  await fn();
  await M.invariant("end of scenario");
}

async function aNet(A: PaidContract) {
  return {
    client: (await M.wallet("CLIENT", A.clientUserId)).a,
    ptAvail: await M.net(A.txnId, "PT", "AVAILABLE"),
    ptPend: await M.net(A.txnId, "PT", "PENDING"),
    platAvail: await M.net(A.txnId, "PLATFORM", "AVAILABLE", "REVENUE"),
    platPend: await M.net(A.txnId, "PLATFORM", "PENDING", "REVENUE"),
  };
}
/** contract B (innocent, 1 delivered) and contract A (2 delivered) of one PT */
async function setUp() {
  const pt = await M.makePt();
  const A = await M.paidContract(pt, { packageName: "Gói A" });
  const B = await M.paidContract(pt, { packageName: "Gói B" });
  await M.deliver(B, 1);
  await M.deliver(A, 2);
  return { pt, A, B };
}
const ENDING_ONLY = { client: 3_600_000, ptAvail: 1_260_000, platAvail: 140_000 };
const CANCEL_THEN_ENDING = { client: 3_150_000, ptAvail: 1_665_000, platAvail: 185_000 };
const NOSHOW_THEN_ENDING = { client: 3_650_000, ptAvail: 1_215_000, platAvail: 135_000 };
const pick = (x: { client: number; ptAvail: number; platAvail: number }) => ({ client: x.client, ptAvail: x.ptAvail, platAvail: x.platAvail });
function localDay(d: Date) {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
const CODED = ["CONTRACT_ENDED", "CONTRACT_ENDING", "SESSION_STATE_NOT_ALLOWED", "SESSION_ALREADY_PROCESSED", "CONTRACT_LOCK_BUSY"];

type Op = {
  name: string;
  kind: "client-cancel" | "compensated";
  make: (A: PaidContract) => Promise<{ id: string; scheduledStartAt: Date }>;
  run: (A: PaidContract, s: { id: string; scheduledStartAt: Date }, inst: number, at: number) => Promise<{ status: number; body: any }>;
};
const OPS: Op[] = [
  {
    name: "client late cancel (<24h)",
    kind: "client-cancel",
    make: (A) => M.addSession(A, "CONFIRMED", new Date(Date.now() + 3 * HOUR)),
    run: (A, s, inst) => M.call(inst, "PATCH", `/sessions/${s.id}/cancel`, A.clientToken, { reason: "bận" }),
  },
  {
    name: "PT admits no-show (PATCH /no-show)",
    kind: "compensated",
    make: (A) => M.addSession(A, "CONFIRMED", new Date(Date.now() - 2 * HOUR)),
    run: (A, s, inst) => M.call(inst, "PATCH", `/sessions/${s.id}/no-show`, A.ptToken, { noShowBy: "PT" }),
  },
  {
    name: "PT late cancel (<24h)",
    kind: "compensated",
    make: (A) => M.addSession(A, "CONFIRMED", new Date(Date.now() + 3 * HOUR)),
    run: (A, s, inst) => M.call(inst, "PATCH", `/sessions/${s.id}/cancel`, A.ptToken, { reason: "bận" }),
  },
  {
    name: "PT blocks the day (POST /availability/me/exceptions)",
    kind: "compensated",
    make: (A) => M.addSession(A, "CONFIRMED", new Date(Date.now() + 3 * HOUR)),
    run: (A, s, inst) => M.call(inst, "POST", "/availability/me/exceptions", A.ptToken, { date: localDay(s.scheduledStartAt), reason: "bận" }),
  },
  {
    name: "room-close sweep (client in the room, PT never joined)",
    kind: "compensated",
    make: (A) => M.addSession(A, "CONFIRMED", new Date(Date.now() - 2 * HOUR), { sessionMode: "ONLINE", roomClientJoinedAt: new Date(Date.now() - 100 * 60 * 1000) }),
    run: async (_A, _s, inst, at) => {
      const r = await M.job(inst, "roomClose", at);
      return { status: r.error ? 500 : 200, body: r };
    },
  },
];

// ── group 1: each F4 action on instance X vs the client ending the contract on instance Y, simultaneously ─────────

// [instance of the action, instance of the ending, ending's start offset in ms (negative = the action starts later)]
const PAIRS: Array<[number, number, number]> = [
  [0, 1, -200],
  [1, 0, -80],
  [1, 2, 0],
  [2, 0, 80],
  [0, 2, 200],
  [2, 1, 350],
];
for (const op of OPS) {
  test(`MI-1 ${op.name} on one instance vs the ending on another, ${PAIRS.length} rounds with skewed starts: one outcome, exact money, B untouched`, { skip, timeout: 600_000 }, async () => {
    const summary: Array<Record<string, unknown>> = [];
    for (const [opInst, endInst, skew] of PAIRS) {
      await scenario(async () => {
        const { A, B } = await setUp();
        const s = await op.make(A);
        const bEntries = await M.entries(B.txnId);
        const at = Date.now() + 400;
        const endP = (async () => {
          await sleep(Math.max(0, at + skew - Date.now()));
          return M.call(endInst, "POST", `/contracts/${A.id}/terminate`, A.clientToken, { reason: "CLIENT_CANCELLED" });
        })();
        const opP = (async () => {
          if (op.name.startsWith("room-close")) return op.run(A, s, opInst, at);
          await sleep(Math.max(0, at - Date.now()));
          return op.run(A, s, opInst, at);
        })();
        const [e, o] = await Promise.all([endP, opP]);
        assert.equal(e.status, 200, `ending: ${e.status} ${JSON.stringify(e.body)}\n${M.paymentLog().slice(-600)}`);
        const sess = await M.sessionRow(s.id);
        const aRow = await M.contractRow(A.id);
        const after = await aNet(A);
        const wonCancel = sess.cancelledBy !== null && sess.cancelledBy !== "SYSTEM" && sess.status === "CANCELLED";
        const wonComp = sess.status === "NO_SHOW";
        const won = op.kind === "client-cancel" ? wonCancel : wonComp;
        if (won) {
          assert.deepEqual(pick(after), op.kind === "client-cancel" ? CANCEL_THEN_ENDING : NOSHOW_THEN_ENDING);
          assert.equal(aRow.usedSessions, op.kind === "client-cancel" ? 3 : 2);
          assert.equal(aRow.compensatedSessions, op.kind === "client-cancel" ? 0 : 1);
        } else {
          assert.deepEqual([sess.status, sess.cancelledBy], ["CANCELLED", "SYSTEM"], "called off by the ending");
          assert.deepEqual(pick(after), ENDING_ONLY);
          assert.deepEqual([aRow.usedSessions, aRow.compensatedSessions], [2, 0]);
          if (o.status >= 400) assert.ok(CODED.includes(o.body?.code), `coded refusal: ${o.status} ${JSON.stringify(o.body)}`);
        }
        assert.deepEqual([after.ptPend, after.platPend], [0, 0]);
        assert.equal(after.client + after.ptAvail + after.platAvail, 5_000_000, "no đồng created or lost");
        assert.deepEqual(await M.entries(B.txnId), bEntries, "the PT's other contract is untouched");
        assert.equal(await M.opCount(`CONTRACT_TERMINATE:${A.id}`), 1);
        assert.ok((await M.opCount(`PT_NO_SHOW:${s.id}`)) + (await M.opCount(`SESSION_RELEASE:${s.id}`)) <= 1, "at most one money operation for the session");
        summary.push({ opInst, endInst, skew, won, opStatus: o.status, code: o.body?.code ?? null });
      });
    }
    show(`MI-1 ${op.name}`, { rounds: summary });
  });
}

// ── group 2: endings against endings (client cancel + PT cancel + expiry sweep), three instances at once ──────────

test("MI-2 three endings of ONE contract at once on three instances (client cancel / PT cancel / expiry sweep): one reason wins, one money operation", { skip, timeout: 300_000 }, async () => {
  const rounds: Array<Record<string, unknown>> = [];
  for (let round = 0; round < 6; round++) {
    await scenario(async () => {
      const { A, B } = await setUp();
      await M.prisma.contract.update({ where: { id: A.id }, data: { endDate: new Date(Date.now() - HOUR) } });
      const bEntries = await M.entries(B.txnId);
      const at = Date.now() + 500;
      const lanes = [[0, 1, 2], [1, 2, 0], [2, 0, 1], [0, 2, 1], [1, 0, 2], [2, 1, 0]][round];
      // who starts first: the 6 permutations of start offsets 0 / 120 / 240 ms over (client cancel, PT cancel, expiry sweep)
      const off = [[0, 120, 240], [120, 0, 240], [240, 120, 0], [0, 240, 120], [120, 240, 0], [240, 0, 120]][round];
      const [c, p, x] = await Promise.all([
        (async () => (await sleep(at + off[0] - Date.now()), M.call(lanes[0], "POST", `/contracts/${A.id}/terminate`, A.clientToken, { reason: "CLIENT_CANCELLED" })))(),
        (async () => (await sleep(at + off[1] - Date.now()), M.call(lanes[1], "POST", `/contracts/${A.id}/terminate`, A.ptToken, { reason: "PT_CANCELLED" })))(),
        M.job(lanes[2], "expiry", at + off[2]),
      ]);
      const row = await M.contractRow(A.id);
      const after = await aNet(A);
      const expectedByReason: Record<string, { client: number; ptAvail: number; platAvail: number }> = {
        CLIENT_CANCELLED: ENDING_ONLY,
        PT_CANCELLED: { client: 4_000_000, ptAvail: 900_000, platAvail: 100_000 },
        EXPIRED: { client: 0, ptAvail: 4_500_000, platAvail: 500_000 },
      };
      show("MI-2", { round, clientCancel: c.status, ptCancel: p.status, expiry: x.result, reason: row.terminationReason, status: row.status, after });
      assert.ok(row.terminationReason && expectedByReason[row.terminationReason], `a known winning reason: ${row.terminationReason}`);
      assert.deepEqual(pick(after), expectedByReason[row.terminationReason!], "the ledger carries exactly the winner's terms");
      assert.deepEqual([after.ptPend, after.platPend], [0, 0]);
      assert.equal(after.client + after.ptAvail + after.platAvail, 5_000_000);
      assert.equal(await M.opCount(`CONTRACT_TERMINATE:${A.id}`), 1, "one termination in the ledger");
      assert.deepEqual(await M.entries(B.txnId), bEntries, "contract B untouched");
      rounds.push({ round, reason: row.terminationReason, status: row.status });
    });
  }
  show("MI-2 summary", { rounds });
});

// ── group 3: confirm / dispute / auto-confirm / ruling ────────────────────────────────────────────────────────────

test("MI-3 a pending session: client confirm (I0) vs client dispute (I1) vs auto-confirm sweep (I2) at once, then two admins rule on two instances: exactly one business outcome and one release", { skip, timeout: 400_000 }, async () => {
  const summary: Array<Record<string, unknown>> = [];
  for (let round = 0; round < 6; round++) {
    await scenario(async () => {
      const { A, B } = await setUp();
      const bEntries = await M.entries(B.txnId);
      const s = await M.addSession(A, "PENDING_CLIENT_CONFIRMATION", new Date(Date.now() - 3 * DAY), { clientConfirmDeadline: new Date(Date.now() - HOUR), ptNotes: "ok" });
      const at = Date.now() + 500;
      const rot = round % 3;
      const off = [[0, 120, 240], [120, 0, 240], [240, 120, 0], [0, 240, 120], [120, 240, 0], [240, 0, 120]][round];
      const [conf, disp, auto] = await Promise.all([
        (async () => (await sleep(at + off[0] - Date.now()), M.call(rot, "POST", `/sessions/${s.id}/confirm`, A.clientToken)))(),
        (async () => (await sleep(at + off[1] - Date.now()), M.call((rot + 1) % 3, "POST", `/sessions/${s.id}/dispute`, A.clientToken, { reason: "không đúng" })))(),
        M.job((rot + 2) % 3, "autoConfirm", at + off[2]),
      ]);
      let sess = await M.sessionRow(s.id);
      let outcome: string = sess.status;
      let aRow = await M.contractRow(A.id);
      if (sess.status === "DISPUTED") {
        const ruling = round % 2 === 0 ? "COMPLETED" : "CANCELLED";
        const adminA = M.tokenFor("admin-a", "ADMIN");
        const adminB = M.tokenFor("admin-b", "ADMIN");
        const [r1, r2] = await Promise.all([
          M.call(0, "POST", `/admin/sessions/${s.id}/resolve`, adminA, { resolution: ruling, note: "kiểm tra" }),
          M.call(1, "POST", `/admin/sessions/${s.id}/resolve`, adminB, { resolution: ruling === "COMPLETED" ? "CANCELLED" : "COMPLETED", note: "ý kiến khác" }),
        ]);
        assert.equal([r1, r2].filter((r) => r.status === 200).length, 1, `two admins, two instances, one ruling: ${r1.status}/${r2.status} ${JSON.stringify([r1.body, r2.body])}`);
        sess = await M.sessionRow(s.id);
        outcome = `DISPUTED->${sess.status}`;
        aRow = await M.contractRow(A.id);
      }
      const delivered = sess.status === "COMPLETED";
      const after = await aNet(A);
      show("MI-3", { round, confirm: conf.status, dispute: disp.status, auto: auto.result, outcome, used: aRow.usedSessions });
      assert.equal(aRow.usedSessions, delivered ? 3 : 2);
      assert.equal(sess.sessionDeducted, delivered);
      assert.equal(await M.opCount(`SESSION_RELEASE:${s.id}`), delivered ? 1 : 0, "the release exists iff the session was delivered, never twice");
      assert.equal(after.ptAvail, delivered ? 1_350_000 : 900_000);
      assert.deepEqual(await M.entries(B.txnId), bEntries);
      summary.push({ round, outcome });
    });
  }
  show("MI-3 summary", { rounds: summary });
});

// ── group 4: every sweep on three instances at the same instant ────────────────────────────────────────────────────

test("MI-4a auto-confirm sweep on 3 instances at once, 6 due sessions: each confirmed and paid exactly once", { skip, timeout: 300_000 }, async () => {
  await scenario(async () => {
    const pt = await M.makePt();
    const A = await M.paidContract(pt);
    const ids: string[] = [];
    for (let i = 0; i < 6; i++) ids.push((await M.addSession(A, "PENDING_CLIENT_CONFIRMATION", new Date(Date.now() - (3 + i) * DAY), { clientConfirmDeadline: new Date(Date.now() - HOUR) })).id);
    const at = Date.now() + 400;
    const res = await Promise.all([0, 1, 2].map((i) => M.job(i, "autoConfirm", at)));
    show("MI-4a", { results: res.map((r) => r.result), spreadMs: Math.max(...res.map((r) => r.startedAt)) - Math.min(...res.map((r) => r.startedAt)) });
    const rows = await Promise.all(ids.map((id) => M.sessionRow(id)));
    assert.ok(rows.every((r) => r.status === "COMPLETED" && r.sessionDeducted && r.autoConfirmed));
    assert.equal(res.reduce((s, r) => s + (r.result?.confirmed ?? 0), 0), 6, "the instances' `confirmed` counts add up to 6: nobody claimed a session twice");
    assert.equal((await M.contractRow(A.id)).usedSessions, 6);
    for (const id of ids) assert.equal(await M.opCount(`SESSION_RELEASE:${id}`), 1);
    assert.equal(await M.net(A.txnId, "PT", "AVAILABLE"), 6 * 450_000);
    const dup = await M.prisma.notification.groupBy({ by: ["entityId"], where: { entityId: { in: ids }, eventType: "SESSION_AUTO_CONFIRMED" }, _count: true });
    assert.ok(dup.every((d) => d._count === 1), `one notice per session: ${JSON.stringify(dup)}`);
  });
});

test("MI-4b contract-expiry sweep on 3 instances at once, 4 expired contracts: each terminated once", { skip, timeout: 300_000 }, async () => {
  await scenario(async () => {
    const pt = await M.makePt();
    const cs: PaidContract[] = [];
    for (let i = 0; i < 4; i++) {
      const c = await M.paidContract(pt, { packageName: `exp${i}` });
      await M.deliver(c, 1);
      await M.prisma.contract.update({ where: { id: c.id }, data: { endDate: new Date(Date.now() - HOUR) } });
      cs.push(c);
    }
    const at = Date.now() + 400;
    const res = await Promise.all([0, 1, 2].map((i) => M.job(i, "expiry", at)));
    const reported = res.reduce((s, r) => s + (r.result?.expired ?? 0), 0);
    show("MI-4b", { results: res.map((r) => r.result), sumReported: reported });
    for (const c of cs) {
      const row = await M.contractRow(c.id);
      assert.deepEqual([row.status, row.terminationReason], ["EXPIRED", "EXPIRED"]);
      assert.equal(await M.opCount(`CONTRACT_TERMINATE:${c.id}`), 1);
      assert.equal(await M.net(c.txnId, "PT", "PENDING"), 0);
    }
    const termCalls = M.instances.flatMap((i) => i.proxy.calls).filter((c) => c.path.includes("terminate"));
    show("MI-4b payment terminate calls", { calls: termCalls.length, byInstance: [0, 1, 2].map((i) => termCalls.filter((c) => c.inst === i).length) });
    const notices = await M.prisma.notification.groupBy({ by: ["entityId", "userId"], where: { entityId: { in: cs.map((c) => c.id) } }, _count: true });
    show("MI-4b notices per (contract,user)", { max: Math.max(0, ...notices.map((n) => n._count)) });
  });
});

test("MI-4c room-close sweep on 3 instances at once, 4 PT-absent online sessions: each compensated once", { skip, timeout: 300_000 }, async () => {
  await scenario(async () => {
    const pt = await M.makePt();
    const A = await M.paidContract(pt);
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) ids.push((await M.addSession(A, "CONFIRMED", new Date(Date.now() - (2 + i) * HOUR), { sessionMode: "ONLINE", roomClientJoinedAt: new Date(Date.now() - 100 * 60 * 1000) })).id);
    const at = Date.now() + 400;
    const res = await Promise.all([0, 1, 2].map((i) => M.job(i, "roomClose", at)));
    show("MI-4c", { results: res.map((r) => r.result) });
    const rows = await Promise.all(ids.map((id) => M.sessionRow(id)));
    assert.ok(rows.every((r) => r.status === "NO_SHOW"));
    assert.equal(res.reduce((s, r) => s + (r.result?.resolved ?? 0), 0), 4, "resolved counts add up to 4");
    for (const id of ids) assert.equal(await M.opCount(`PT_NO_SHOW:${id}`), 1);
    assert.equal((await M.contractRow(A.id)).compensatedSessions, 4, "compensatedSessions counted once per session");
    assert.equal((await M.wallet("CLIENT", A.clientUserId)).a, 4 * 500_000);
    const dup = await M.prisma.notification.groupBy({ by: ["entityId", "userId"], where: { entityId: { in: ids } }, _count: true });
    assert.ok(dup.every((d) => d._count === 1), `one notice per (session,user): ${JSON.stringify(dup)}`);
  });
});

test("MI-4d payment-deadline sweep on 3 instances at once, 4 overdue PENDING_PAYMENT contracts: each cancelled once (one audit row, one notice)", { skip, timeout: 120_000 }, async () => {
  await scenario(async () => {
    const pt = await M.makePt();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const c = await M.prisma.contract.create({
        data: { id: crypto.randomUUID(), ptUserId: pt, clientUserId: crypto.randomUUID(), packageName: "x", totalSessions: 10, price: 1_000_000, status: "PENDING_PAYMENT", paymentDueAt: new Date(Date.now() - HOUR), startDate: new Date(), endDate: new Date(Date.now() + 30 * DAY) },
      });
      ids.push(c.id);
    }
    const at = Date.now() + 300;
    const res = await Promise.all([0, 1, 2].map((i) => M.job(i, "paymentDeadline", at)));
    show("MI-4d", { results: res.map((r) => r.result) });
    assert.equal(res.reduce((s, r) => s + (r.result?.cancelled ?? 0), 0), 4);
    const audits = await M.prisma.auditLog.groupBy({ by: ["entityId"], where: { entityId: { in: ids } }, _count: true });
    assert.ok(audits.length === 4 && audits.every((a) => a._count === 1), JSON.stringify(audits));
    const notes = await M.prisma.notification.groupBy({ by: ["entityId", "userId"], where: { entityId: { in: ids } }, _count: true });
    assert.ok(notes.every((n) => n._count === 1), JSON.stringify(notes));
  });
});

test("MI-4e reschedule-expiry sweep on 3 instances at once, 3 stale requests: audit rows per request", { skip, timeout: 120_000 }, async () => {
  await scenario(async () => {
    const pt = await M.makePt();
    const A = await M.paidContract(pt);
    const reqs: string[] = [];
    for (let i = 0; i < 3; i++) {
      const s = await M.addSession(A, "CONFIRMED", new Date(Date.now() - (i + 1) * HOUR));
      const r = await M.prisma.sessionRescheduleRequest.create({
        data: { sessionId: s.id, requestedBy: "CLIENT", reason: "dời", originalStartAt: new Date(Date.now() - HOUR), originalEndAt: new Date(Date.now()), proposedStartAt: new Date(Date.now() + DAY), proposedEndAt: new Date(Date.now() + DAY + HOUR), status: "PENDING" } as any,
      });
      reqs.push(r.id);
    }
    const at = Date.now() + 300;
    const res = await Promise.all([0, 1, 2].map((i) => M.job(i, "reschedule", at)));
    const audits = await M.prisma.auditLog.findMany({ where: { action: "SESSION_RESCHEDULE_EXPIRED" } });
    const per = new Map<string, number>();
    for (const a of audits) per.set(String((a.metadata as any)?.requestId), (per.get(String((a.metadata as any)?.requestId)) ?? 0) + 1);
    show("MI-4e", { results: res.map((r) => r.result), auditRowsPerRequest: [...per.values()], requests: reqs.length });
    assert.equal(res.reduce((s, r) => s + (r.result?.expired ?? 0), 0), 3, "each request flipped by exactly one instance");
    // The comment in reschedule-expiry.service.ts says audit only the rows THIS sweep flipped. Report what really happens.
    show("MI-4e duplicates", { totalAuditRows: audits.length });
  });
});

test("MI-4f idle-holdback sweep on 3 instances at once (holdback is OFF in production: a contract row with a 10% rate is a FIXTURE here): released to the PT once", { skip, timeout: 200_000 }, async () => {
  await scenario(async () => {
    const pt = await M.makePt();
    const A = await M.paidContract(pt);
    await M.prisma.contract.update({ where: { id: A.id }, data: { ptHoldbackRate: "0.10" } });
    await M.deliver(A, 2);
    // the contract has been idle for ages
    await M.prisma.$executeRawUnsafe(`UPDATE sessions SET scheduled_start_at = now() - interval '200 days', scheduled_end_at = now() - interval '200 days' + interval '1 hour' WHERE contract_id = '${A.id}'`);
    await M.prisma.$executeRawUnsafe(`UPDATE contracts SET start_date = now() - interval '300 days' WHERE id = '${A.id}'`);
    const before = await M.contractRow(A.id);
    const ptBefore = await M.net(A.txnId, "PT", "AVAILABLE");
    const at = Date.now() + 400;
    const res = await Promise.all([0, 1, 2].map((i) => M.job(i, "holdback", at)));
    const after = await M.contractRow(A.id);
    const ptAfter = await M.net(A.txnId, "PT", "AVAILABLE");
    show("MI-4f", { results: res.map((r) => r.result), ptAvailBefore: ptBefore, ptAvailAfter: ptAfter, releasedToPtDelta: Number(after.releasedToPt) - Number(before.releasedToPt), holdbackReleasedAt: !!after.holdbackReleasedAt, ledgerOps: await M.opCount(`HOLDBACK_RELEASE:${A.id}`) });
    assert.equal(await M.opCount(`HOLDBACK_RELEASE:${A.id}`), 1);
    assert.ok(after.holdbackReleasedAt);
    assert.equal(res.reduce((s, r) => s + (r.result?.released ?? 0), 0), 1, "exactly one instance recorded the release");
    assert.equal(Number(after.releasedToPt) - Number(before.releasedToPt), ptAfter - ptBefore, "bookkeeping == what the ledger moved, counted once");
  });
});
