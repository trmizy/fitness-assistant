/**
 * scripts/client-multi-pt-violations.ts - legacy rows written before the client rules of 2026-11-05.
 *
 * Pure planning (no DB) + BACKEND INTEGRATION on a `*_test` database: legacy rows are inserted directly (the service
 * itself now refuses to create them), then buildReport / applyPlan run for real.
 */
import { guardedTest as dbTest } from "./test-db-guard";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ContractSource, ContractStatus, SessionStatus } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { MAX_LIVE_PTS_PER_CLIENT as SERVICE_MAX } from "../services/contract.service";
import {
  AUDIT_ACTION,
  MAX_LIVE_PTS_PER_CLIENT,
  applyPlan,
  buildReport,
  planClientOverlaps,
  type SessionRow,
} from "../scripts/client-multi-pt-violations";

const H = 3600_000;
const base = new Date("2030-03-02T07:00:00.000Z");
const row = (id: string, status: SessionStatus, startH: number, createdMin: number, ptUserId = `pt-${id}`): SessionRow => ({
  id, contractId: `c-${id}`, clientUserId: "client", ptUserId, status,
  scheduledStartAt: new Date(base.getTime() + startH * H),
  scheduledEndAt: new Date(base.getTime() + (startH + 1) * H),
  createdAt: new Date(Date.UTC(2030, 0, 1, 0, createdMin)),
});

test("script limit matches the service limit", () => {
  assert.equal(MAX_LIVE_PTS_PER_CLIENT, SERVICE_MAX);
});

test("plan: two REQUESTED at the same time -> the later booking is cancelled", () => {
  const f = planClientOverlaps([row("b", SessionStatus.REQUESTED, 0, 5), row("a", SessionStatus.REQUESTED, 0, 1)]);
  assert.deepEqual(f.map((x) => [x.session.id, x.conflictsWith.id, x.action]), [["b", "a", "CANCEL_REQUESTED"]]);
});

test("plan: a CONFIRMED session always wins over an earlier REQUESTED one", () => {
  const f = planClientOverlaps([row("req", SessionStatus.REQUESTED, 0, 1), row("conf", SessionStatus.CONFIRMED, 0.5, 9)]);
  assert.deepEqual(f.map((x) => [x.session.id, x.action]), [["req", "CANCEL_REQUESTED"]]);
});

test("plan: two CONFIRMED -> report only; back-to-back sessions are not a conflict", () => {
  const f = planClientOverlaps([
    row("c1", SessionStatus.CONFIRMED, 0, 1),
    row("c2", SessionStatus.CONFIRMED, 0, 2),
    row("next", SessionStatus.REQUESTED, 1, 3), // 08:00 after a 07:00-08:00 session
  ]);
  assert.deepEqual(f.map((x) => [x.session.id, x.action]), [["c2", "REPORT_ONLY_BOTH_CONFIRMED"]]);
});

// ── DB ────────────────────────────────────────────────────────────────────────

const contractIds: string[] = [];
dbTest.after(async () => {
  const sessions = await prisma.session.findMany({ where: { contractId: { in: contractIds } }, select: { id: true } });
  const ids = sessions.map((s) => s.id);
  await prisma.notification.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.auditLog.deleteMany({ where: { entityId: { in: ids } } });
  await prisma.session.deleteMany({ where: { id: { in: ids } } });
  await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
  await prisma.$disconnect();
});

async function contract(clientUserId: string, status: ContractStatus = ContractStatus.ACTIVE, source: ContractSource = ContractSource.INDEPENDENT) {
  const c = await prisma.contract.create({
    data: { id: randomUUID(), ptUserId: randomUUID(), clientUserId, packageName: "Legacy", totalSessions: 10, price: 1_000_000, status, source },
  });
  contractIds.push(c.id);
  return c;
}
async function session(c: { id: string; ptUserId: string; clientUserId: string }, status: SessionStatus, start: Date) {
  return prisma.session.create({
    data: { contractId: c.id, clientUserId: c.clientUserId, ptUserId: c.ptUserId, status, scheduledStartAt: start, scheduledEndAt: new Date(start.getTime() + H) },
  });
}

dbTest("report + apply on legacy rows: 3-PT client reported only; overlapping REQUESTED cancelled with audit + notices; CONFIRMED untouched", async () => {
  const now = new Date();
  const start = new Date(now.getTime() + 10 * 24 * H);
  const client = randomUUID();
  const [c1, c2, c3] = [await contract(client), await contract(client), await contract(client, ContractStatus.PENDING_PAYMENT)];
  await contract(client, ContractStatus.ACTIVE, ContractSource.MARKETPLACE); // never counted
  const confirmed = await session(c1, SessionStatus.CONFIRMED, start);
  const requested = await session(c2, SessionStatus.REQUESTED, new Date(start.getTime() + 0.5 * H));
  const otherClient = randomUUID(); // a client with only 2 PTs and no overlap is not reported
  await contract(otherClient);
  await contract(otherClient);

  const report = await buildReport(prisma, now);
  const mine = report.ptLimit.filter((f) => f.clientUserId === client);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].pts.length, 3);
  assert.ok(mine[0].pts.some((p) => p.ptUserId === c3.ptUserId));
  assert.equal(report.ptLimit.some((f) => f.clientUserId === otherClient), false);
  const overlap = report.overlaps.filter((f) => f.clientUserId === client);
  assert.deepEqual(overlap.map((f) => [f.session.id, f.conflictsWith.id, f.action]), [[requested.id, confirmed.id, "CANCEL_REQUESTED"]]);

  // Only this client's findings are applied, so other tests' rows in a shared test DB are never touched.
  const result = await applyPlan(prisma, { ptLimit: [], overlaps: overlap }, "run-test");
  assert.deepEqual(result, { cancelled: [requested.id], skipped: [] });

  const after = await prisma.session.findUniqueOrThrow({ where: { id: requested.id } });
  assert.equal(after.status, SessionStatus.CANCELLED);
  assert.equal(after.sessionDeducted, false);
  assert.equal(after.cancelledBy, "SYSTEM");
  assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: confirmed.id } })).status, SessionStatus.CONFIRMED);
  assert.equal(await prisma.auditLog.count({ where: { entityId: requested.id, action: AUDIT_ACTION } }), 1);
  const notified = await prisma.notification.findMany({ where: { entityId: requested.id }, select: { userId: true } });
  assert.deepEqual(notified.map((n) => n.userId).sort(), [c2.clientUserId, c2.ptUserId].sort());
  const contractAfter = await prisma.contract.findUniqueOrThrow({ where: { id: c2.id } });
  assert.equal(contractAfter.usedSessions, 0, "no quota moved");

  // Re-running is a no-op: the session is no longer REQUESTED.
  const again = await applyPlan(prisma, { ptLimit: [], overlaps: overlap }, "run-test-2");
  assert.deepEqual(again, { cancelled: [], skipped: [requested.id] });
  assert.equal(await prisma.auditLog.count({ where: { entityId: requested.id } }), 1);
});
