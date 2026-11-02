/**
 * DISPUTE CASE slice 2 / S2.2 - the T0 mechanism (built, flag OFF by default, switched on here only through the fail-closed rule) and the legacy
 * migration script. BACKEND INTEGRATION against the isolated *_test user database; payment-service is a MOCKED DEPENDENCY (ledger lookup stub,
 * payment writes refused). The HTTP behaviour of the old route is proved cross-service in cross-service-money-dispute-execution.e2e.test.ts.
 * The entry-point inventory test is a CODE AUDIT turned into an assertion: it fails when a new caller of the ruling core appears.
 *
 * Run ALONE (truncates the dispute_case* tables).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { guardedTest as test } from "./test-db-guard";
import { paymentClient } from "../clients/payment.client";
import { prisma } from "../repositories/profile.repository";
import { addSession, makeContract } from "./pt-restriction.test-helpers";
import { executionService } from "../services/dispute-case/execution.service";
import { bookingService, resolveDisputeCore } from "../services/booking.service";
import { runLegacyMigration, applyAllowed, MIGRATION_ACTOR } from "../scripts/dispute-case-migrate-legacy";
import { admin, approvedCaseFor, disableExecutionFlags, enableExecutionFlags, FINDING_FOR } from "./dispute-case-exec.test-helpers";

const restores: Array<() => void> = [];
const contracts: string[] = [];
const pts: string[] = [];

test.before(async () => {
  for (const name of Object.keys(paymentClient)) {
    const original = (paymentClient as any)[name];
    (paymentClient as any)[name] = name === "lookupLedgerOperation" ? async () => null : async () => Promise.reject(new Error(`payment write refused by the test stub: ${name}`));
    restores.push(() => ((paymentClient as any)[name] = original));
  }
  await prisma.$executeRawUnsafe(
    `TRUNCATE dispute_case_executions, dispute_case_access_logs, dispute_case_events, dispute_case_approvals, dispute_case_proposals, dispute_case_findings, dispute_case_assessments, dispute_case_shares, dispute_case_statements, dispute_case_evidence, dispute_case_claims, dispute_case_issues, dispute_cases CASCADE`,
  );
});
test.after(async () => {
  disableExecutionFlags();
  for (const r of restores) r();
  await prisma.sessionSettlement.deleteMany({ where: { contractId: { in: contracts } } }).catch(() => {});
  await prisma.auditLog.deleteMany({ where: { entityId: { in: contracts } } }).catch(() => {});
  await prisma.notification.deleteMany({ where: { userId: { in: pts } } }).catch(() => {});
  await prisma.session.deleteMany({ where: { contractId: { in: contracts } } }).catch(() => {});
  await prisma.contract.deleteMany({ where: { id: { in: contracts } } }).catch(() => {});
  await prisma.userProfile.deleteMany({ where: { userId: { in: pts } } }).catch(() => {});
  await prisma.$disconnect();
});
test.beforeEach(() => disableExecutionFlags());

async function mk(over: { status?: string; disputeType?: string | null; ptNotes?: string | null; disputeReason?: string | null } = {}) {
  const ptUserId = randomUUID();
  const contract = await makeContract(ptUserId, { sessionMode: "ONLINE" });
  contracts.push(contract.id);
  pts.push(ptUserId);
  const session = await addSession(contract, over.status ?? "DISPUTED", new Date(Date.now() - 3 * 3600_000), {
    sessionMode: "ONLINE",
    disputeType: over.disputeType === undefined ? "DELIVERY_DISPUTE" : over.disputeType,
    disputedAt: new Date(Date.now() - 3600_000),
    disputeReason: over.disputeReason === undefined ? "Buổi tập không diễn ra như đã hẹn" : over.disputeReason,
    ptNotes: over.ptNotes === undefined ? "PT báo đã dạy đủ giờ" : over.ptNotes,
  });
  return { contract, session };
}
const refuses = (p: Promise<unknown>, status: number, code: string) =>
  assert.rejects(p, (e: any) => {
    assert.equal([e.status, e.code].join(), [status, code].join());
    return true;
  });

// ═══ T0 ═════════════════════════════════════════════════════════════════════════════════════════════════════════════

test("T0 ON: the old exit (service level) and the core without a decision are refused 409 CASE_REQUIRED for all three outcomes; nothing changes", async () => {
  enableExecutionFlags({ execution: true, t0: true });
  for (const outcome of ["COMPLETED", "CANCELLED", "PT_NO_SHOW_CONFIRMED"] as const) {
    const s = await mk();
    await refuses(bookingService.resolveDispute(s.session.id, "admin", outcome, "ghi chú"), 409, "CASE_REQUIRED");
    await refuses(resolveDisputeCore(s.session.id, "admin", outcome, "ghi chú"), 409, "CASE_REQUIRED");
    const row = await prisma.session.findUniqueOrThrow({ where: { id: s.session.id } });
    assert.deepEqual([row.status, row.sessionDeducted, row.resolvedBy], ["DISPUTED", false, null]);
    assert.equal(await prisma.sessionSettlement.count({ where: { sessionId: s.session.id } }), 0);
  }
});

test("T0 ON: a FORGED decision context is refused by the core (CASE_CONTEXT_INVALID) - the entry point checks the decision, not the caller's word", async () => {
  enableExecutionFlags({ execution: true, t0: true });
  const s = await mk();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.CANCELLED);
  for (const ctx of [{ caseDecisionId: randomUUID() }, { caseDecisionId: a.approvalId }]) {
    await refuses(resolveDisputeCore(s.session.id, "admin", "CANCELLED", "ghi chú", ctx), 409, "CASE_CONTEXT_INVALID"); // approvalId: the case is not EXECUTING
  }
  assert.equal((await prisma.session.findUniqueOrThrow({ where: { id: s.session.id } })).status, "DISPUTED");
});

test("T0 ON: the executor (the one entry point with a verified decision) still rules the session", async () => {
  enableExecutionFlags({ execution: true, t0: true });
  const s = await mk();
  const a = await approvedCaseFor(s.session.id, FINDING_FOR.CANCELLED);
  const r = await executionService.executeDecision(admin(), a.caseId, {});
  assert.equal(r.executionState, "BUSINESS_DONE");
  const row = await prisma.session.findUniqueOrThrow({ where: { id: s.session.id } });
  assert.deepEqual([row.status, row.resolvedByCaseDecisionId], ["CANCELLED", a.approvalId]);
});

test("T0 OFF (default; and ON in the environment but not in a test process): the old exit works exactly as before", async () => {
  const s = await mk();
  const r: any = await bookingService.resolveDispute(s.session.id, "admin", "CANCELLED", "ghi chú");
  assert.equal(r.status, "CANCELLED");
  // the env var alone is not enough: NODE_ENV is not "test" -> still OFF
  enableExecutionFlags({ t0: true });
  process.env.NODE_ENV = "production";
  const warn = console.warn;
  console.warn = () => {};
  try {
    const s2 = await mk();
    const r2: any = await bookingService.resolveDispute(s2.session.id, "admin", "CANCELLED", "ghi chú");
    assert.equal(r2.status, "CANCELLED", "fail-closed: T0=true outside a test environment is ignored");
  } finally {
    console.warn = warn;
    process.env.NODE_ENV = "test";
  }
});

test("CODE AUDIT as an assertion: the ruling core has exactly these callers in user-service (src, scripts, routes) - a new caller must be reviewed for T0 first", () => {
  const root = path.resolve(__dirname, "..");
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === "generated" || e.name === "__tests__" || e.name === "node_modules") continue;
        walk(p);
      } else if (/\.(ts|js|mjs)$/.test(e.name)) {
        const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
        lines.forEach((l, i) => {
          if (/\bresolveDisputeCore\s*\(|\bresolveDispute\s*\(|bookingService\.resolveDispute\b|resolveCore\s*\(/.test(l) && !/^\s*(\/\/|\*|\/\*)/.test(l)) hits.push(`${path.relative(root, p).replace(/\\/g, "/")}:${i + 1}`);
        });
      }
    }
  };
  walk(root);
  walk(path.resolve(root, "..", "scripts")); // the service's scripts folder, if any
  const files = [...new Set(hits.map((h) => h.split(":")[0]))].sort();
  assert.deepEqual(files, ["controllers/booking.controller.ts", "services/booking.service.ts", "services/dispute-case/execution.service.ts"], hits.join("\n"));
});

// ═══ the legacy migration script ═══════════════════════════════════════════════════════════════════════════════════

test("migration script: DRY-RUN lists the sessions without a Case and writes NOTHING", async () => {
  const a = await mk({ disputeType: "DELIVERY_DISPUTE" });
  const b = await mk({ disputeType: null });
  const c = await mk({ status: "PT_NO_SHOW_REPORTED", disputeType: null });
  const before = await prisma.disputeCase.count();
  const r = await runLegacyMigration({ apply: false });
  assert.equal(r.mode, "DRY_RUN");
  const mine = r.candidates.filter((x) => [a.session.id, b.session.id, c.session.id].includes(x.sessionId));
  assert.deepEqual(
    Object.fromEntries(mine.map((x) => [x.sessionId, x.willBeType])),
    { [a.session.id]: "PT_DELIVERY", [b.session.id]: "LEGACY_UNCLASSIFIED", [c.session.id]: "PT_NO_SHOW_CLAIM" },
  );
  assert.equal(r.created.length, 0);
  assert.equal(await prisma.disputeCase.count(), before, "no case written");
});

test("migration script: --apply is REFUSED unless the preload accepted an isolated test database", async () => {
  assert.equal(applyAllowed({ DB_ISOLATION: "accepted" } as any), true);
  for (const env of [{}, { DB_ISOLATION: "refused" }, { DB_ISOLATION: "ACCEPTED" }]) assert.equal(applyAllowed(env as any), false);
  const before = await prisma.disputeCase.count();
  await assert.rejects(runLegacyMigration({ apply: true, env: { DB_ISOLATION: "refused" } as any }), (e: any) => e.code === "APPLY_REFUSED");
  assert.equal(await prisma.disputeCase.count(), before);
});

test("migration script: --apply creates one Case per session (statement v1 LEGACY_FIELD, original disputed_at kept, session untouched) and a second run creates nothing", async () => {
  const a = await mk({ disputeType: "DELIVERY_DISPUTE", ptNotes: "PT ghi chú cũ", disputeReason: "Khách khiếu nại cũ" });
  const b = await mk({ disputeType: null });
  const c = await mk({ status: "PT_NO_SHOW_REPORTED", disputeType: null });
  const mine = [a.session.id, b.session.id, c.session.id];
  const sessionsBefore = await prisma.session.findMany({ where: { id: { in: mine } }, orderBy: { id: "asc" } });
  const first = await runLegacyMigration({ apply: true });
  assert.equal(first.mode, "APPLY");
  assert.deepEqual(first.created.map((x) => x.sessionId).filter((id) => mine.includes(id)).sort(), [...mine].sort());
  const cases = await prisma.disputeCase.findMany({ where: { sessionId: { in: mine } }, include: { statements: true } });
  assert.equal(cases.length, 3);
  const byS = new Map(cases.map((x) => [x.sessionId, x]));
  assert.deepEqual([byS.get(a.session.id)!.type, byS.get(b.session.id)!.type, byS.get(c.session.id)!.type], ["PT_DELIVERY", "LEGACY_UNCLASSIFIED", "PT_NO_SHOW_CLAIM"]);
  assert.equal(byS.get(a.session.id)!.createdBy, MIGRATION_ACTOR.id);
  const stm = byS.get(a.session.id)!.statements;
  assert.ok(stm.length >= 1 && stm.every((x) => x.source === "LEGACY_FIELD" && x.version === 1), JSON.stringify(stm.map((x) => [x.partyRole, x.source, x.version])));
  const sessionsAfter = await prisma.session.findMany({ where: { id: { in: mine } }, orderBy: { id: "asc" } });
  assert.deepEqual(sessionsAfter, sessionsBefore, "not one session column changed (disputed_at included)");
  assert.equal(await prisma.sessionSettlement.count({ where: { sessionId: { in: mine } } }), 0, "no money row");

  const second = await runLegacyMigration({ apply: true });
  assert.equal(second.created.filter((x) => mine.includes(x.sessionId)).length, 0);
  assert.equal(await prisma.disputeCase.count({ where: { sessionId: { in: mine } } }), 3);
  assert.ok(second.skippedAlreadyHaveCase >= 3);
});
