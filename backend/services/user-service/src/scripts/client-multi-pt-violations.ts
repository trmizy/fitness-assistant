/**
 * LEGACY DATA vs the 2026-11-05 client rules: inventory + guarded cleanup.
 *
 * The rules (enforced on every NEW write since then - contract.service.ts requestContract, booking.service.ts):
 *   R1  a client holds live (non-terminal, non-marketplace) contracts/requests with at most MAX_LIVE_PTS_PER_CLIENT PTs;
 *   R2  a client never has two REQUESTED/CONFIRMED sessions that overlap in time (whatever the PT).
 * Rows written before the rules can break them. This script
 *   1. INVENTORIES both (read-only), and
 *   2. with --apply, cancels ONLY the R2 sessions that are still REQUESTED (never confirmed by the PT): such a
 *      session holds no money and no quota (cancelSession's REQUESTED branch: sessionDeducted=false, no money step).
 *
 * R2 resolution, per client, over their upcoming REQUESTED/CONFIRMED sessions (scheduledEndAt > now):
 *   CONFIRMED sessions first, then REQUESTED, each group oldest booking (createdAt) first. A session that overlaps one
 *   already kept is: REQUESTED -> planned for cancellation; CONFIRMED -> reported only (two confirmed sessions at
 *   once need a human: cancelling a confirmed session moves quota/money through the cancellation matrix).
 * R1 is report-only: ending a contract is a money decision.
 *
 * What --apply writes, per planned session, in ONE transaction: a compare-and-swap UPDATE (REQUESTED -> CANCELLED,
 * cancelledBy SYSTEM, sessionDeducted false, reason "[CLIENT_SCHEDULE_CLEANUP] ..."), one AuditLog row and one
 * notification each for the client and the PT. A session that is no longer REQUESTED (the PT confirmed it, someone
 * cancelled it) is skipped and reported. Nothing is deleted; payment-service is never called.
 *
 * USAGE (from backend/services/user-service; DATABASE_URL is the user-service DB):
 *   DATABASE_URL=... ./node_modules/.bin/tsx src/scripts/client-multi-pt-violations.ts                       # dry-run (default)
 *   DATABASE_URL=... ./node_modules/.bin/tsx src/scripts/client-multi-pt-violations.ts --apply --confirm-db <db name>
 *   add --json <file> to also write the full report as JSON.
 */
import fs from "node:fs";
import { randomUUID } from "node:crypto";
import { AuditEntityType, ContractSource, ContractStatus, Prisma, PrismaClient, SessionStatus } from "../generated/prisma";

export const MAX_LIVE_PTS_PER_CLIENT = 2; // keep equal to contract.service.ts
export const SYSTEM_ACTOR = "SYSTEM";
export const CLEANUP_REASON =
  "[CLIENT_SCHEDULE_CLEANUP] Buổi này trùng giờ với một buổi khác của học viên (quy tắc mới: học viên không thể có hai buổi cùng giờ). Buổi chưa được huấn luyện viên xác nhận nên được hủy, không trừ buổi, không mất tiền.";
export const AUDIT_ACTION = "SESSION_CANCELLED_CLIENT_SCHEDULE_CLEANUP";
const LIVE_CONTRACT_STATUSES: ContractStatus[] = [
  ContractStatus.PENDING_REVIEW,
  ContractStatus.PENDING_SIGNATURE,
  ContractStatus.PENDING_PAYMENT,
  ContractStatus.ACTIVE,
];

// ── pure planning ────────────────────────────────────────────────────────────

export interface SessionRow {
  id: string;
  contractId: string;
  clientUserId: string;
  ptUserId: string;
  status: SessionStatus;
  scheduledStartAt: Date;
  scheduledEndAt: Date;
  createdAt: Date;
}

export interface OverlapFinding {
  clientUserId: string;
  session: SessionRow;
  /** The kept session it collides with. */
  conflictsWith: SessionRow;
  action: "CANCEL_REQUESTED" | "REPORT_ONLY_BOTH_CONFIRMED";
}

const overlaps = (a: SessionRow, b: SessionRow) => a.scheduledStartAt < b.scheduledEndAt && b.scheduledStartAt < a.scheduledEndAt;

/** R2 resolution for ONE client's sessions (see header). Deterministic. */
export function planClientOverlaps(sessions: SessionRow[]): OverlapFinding[] {
  const rank = (s: SessionRow) => (s.status === SessionStatus.CONFIRMED ? 0 : 1);
  const ordered = [...sessions].sort(
    (a, b) => rank(a) - rank(b) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id),
  );
  const kept: SessionRow[] = [];
  const findings: OverlapFinding[] = [];
  for (const s of ordered) {
    const hit = kept.find((k) => overlaps(k, s));
    if (!hit) {
      kept.push(s);
      continue;
    }
    if (s.status === SessionStatus.REQUESTED) {
      findings.push({ clientUserId: s.clientUserId, session: s, conflictsWith: hit, action: "CANCEL_REQUESTED" });
    } else {
      // Both confirmed: keep it (it still blocks later REQUESTED ones) and leave the decision to a human.
      kept.push(s);
      findings.push({ clientUserId: s.clientUserId, session: s, conflictsWith: hit, action: "REPORT_ONLY_BOTH_CONFIRMED" });
    }
  }
  return findings;
}

// ── inventory ────────────────────────────────────────────────────────────────

export interface PtLimitFinding {
  clientUserId: string;
  pts: { ptUserId: string; contracts: { id: string; status: ContractStatus }[] }[];
}

export interface Report {
  ptLimit: PtLimitFinding[];
  overlaps: OverlapFinding[];
}

export async function buildReport(db: PrismaClient | Prisma.TransactionClient, now: Date): Promise<Report> {
  const live = await db.contract.findMany({
    where: { status: { in: LIVE_CONTRACT_STATUSES }, source: { not: ContractSource.MARKETPLACE } },
    select: { id: true, clientUserId: true, ptUserId: true, status: true },
    orderBy: [{ clientUserId: "asc" }, { createdAt: "asc" }],
  });
  const byClient = new Map<string, Map<string, { id: string; status: ContractStatus }[]>>();
  for (const c of live) {
    const pts = byClient.get(c.clientUserId) ?? new Map();
    pts.set(c.ptUserId, [...(pts.get(c.ptUserId) ?? []), { id: c.id, status: c.status }]);
    byClient.set(c.clientUserId, pts);
  }
  const ptLimit: PtLimitFinding[] = [];
  for (const [clientUserId, pts] of byClient) {
    if (pts.size > MAX_LIVE_PTS_PER_CLIENT) {
      ptLimit.push({ clientUserId, pts: [...pts].map(([ptUserId, contracts]) => ({ ptUserId, contracts })) });
    }
  }

  const sessions = await db.session.findMany({
    where: { status: { in: [SessionStatus.REQUESTED, SessionStatus.CONFIRMED] }, scheduledEndAt: { gt: now } },
    select: {
      id: true, contractId: true, clientUserId: true, ptUserId: true, status: true,
      scheduledStartAt: true, scheduledEndAt: true, createdAt: true,
    },
  });
  const sessionsByClient = new Map<string, SessionRow[]>();
  for (const s of sessions) sessionsByClient.set(s.clientUserId, [...(sessionsByClient.get(s.clientUserId) ?? []), s]);
  const found: OverlapFinding[] = [];
  for (const list of sessionsByClient.values()) if (list.length > 1) found.push(...planClientOverlaps(list));
  return { ptLimit, overlaps: found };
}

// ── apply ────────────────────────────────────────────────────────────────────

export interface ApplyResult {
  cancelled: string[];
  /** No longer REQUESTED when we got to it - left alone. */
  skipped: string[];
}

export async function applyPlan(db: PrismaClient, report: Report, runId: string): Promise<ApplyResult> {
  const result: ApplyResult = { cancelled: [], skipped: [] };
  for (const f of report.overlaps.filter((x) => x.action === "CANCEL_REQUESTED")) {
    const done = await db.$transaction(async (tx) => {
      const won = await tx.session.updateMany({
        where: { id: f.session.id, status: SessionStatus.REQUESTED },
        data: {
          status: SessionStatus.CANCELLED,
          cancelledBy: SYSTEM_ACTOR,
          cancellationReason: CLEANUP_REASON,
          sessionDeducted: false,
        },
      });
      if (won.count !== 1) return false;
      await tx.auditLog.create({
        data: {
          actorUserId: SYSTEM_ACTOR,
          action: AUDIT_ACTION,
          entityType: AuditEntityType.SESSION,
          entityId: f.session.id,
          metadata: {
            runId,
            contractId: f.session.contractId,
            statusBefore: SessionStatus.REQUESTED,
            conflictsWithSessionId: f.conflictsWith.id,
            conflictsWithStatus: f.conflictsWith.status,
          } as Prisma.InputJsonValue,
        },
      });
      await tx.notification.createMany({
        data: [
          {
            userId: f.session.clientUserId,
            text: "Một buổi tập chưa được xác nhận của bạn đã được hệ thống hủy vì trùng giờ với buổi khác của bạn. Không trừ buổi, không mất tiền — bạn có thể đặt lại giờ khác.",
            eventType: "SESSION_CANCELLED",
            entityType: "SESSION",
            entityId: f.session.id,
            link: "/client/booking",
          },
          {
            userId: f.session.ptUserId,
            text: "Một yêu cầu đặt buổi chưa xác nhận đã được hệ thống hủy vì học viên có buổi khác trùng giờ.",
            eventType: "SESSION_CANCELLED",
            entityType: "SESSION",
            entityId: f.session.id,
            link: "/pt/contracts",
          },
        ],
      });
      return true;
    });
    (done ? result.cancelled : result.skipped).push(f.session.id);
  }
  return result;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function printReport(report: Report) {
  console.log(`\nR1 - clients with more than ${MAX_LIVE_PTS_PER_CLIENT} live PTs (report only): ${report.ptLimit.length}`);
  for (const f of report.ptLimit) {
    console.log(`  client ${f.clientUserId}: ${f.pts.length} PTs`);
    for (const p of f.pts) console.log(`    PT ${p.ptUserId}: ${p.contracts.map((c) => `${c.id} (${c.status})`).join(", ")}`);
  }
  const cancel = report.overlaps.filter((f) => f.action === "CANCEL_REQUESTED");
  const manual = report.overlaps.filter((f) => f.action === "REPORT_ONLY_BOTH_CONFIRMED");
  console.log(`\nR2 - overlapping upcoming sessions of one client: ${report.overlaps.length}`);
  console.log(`  REQUESTED, to cancel with --apply: ${cancel.length}`);
  console.log(`  both CONFIRMED, needs a human: ${manual.length}`);
  for (const f of report.overlaps) {
    console.log(
      `  [${f.action}] client ${f.clientUserId} session ${f.session.id} (${f.session.status}, PT ${f.session.ptUserId}, ${f.session.scheduledStartAt.toISOString()})` +
        ` x ${f.conflictsWith.id} (${f.conflictsWith.status}, PT ${f.conflictsWith.ptUserId})`,
    );
  }
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required");
  const dbName = decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  const apply = process.argv.includes("--apply");
  if (apply && arg("--confirm-db") !== dbName) {
    throw new Error(`--apply needs --confirm-db ${dbName} (the database this run would write to)`);
  }
  const db = new PrismaClient({ datasourceUrl: url, log: [] });
  try {
    console.log(`database: ${dbName}  mode: ${apply ? "APPLY" : "dry-run"}`);
    const report = await db.$transaction(async (tx) => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return buildReport(tx, new Date());
    });
    printReport(report);
    const jsonOut = arg("--json");
    if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
    if (apply) {
      const runId = randomUUID();
      const r = await applyPlan(db, report, runId);
      console.log(`\nAPPLIED run ${runId}: cancelled ${r.cancelled.length}, skipped (no longer REQUESTED) ${r.skipped.length}`);
      if (r.skipped.length) console.log(`  skipped: ${r.skipped.join(", ")}`);
    }
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
