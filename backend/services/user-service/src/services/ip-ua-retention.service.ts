/**
 * IP / user-agent retention (owner decision: 12 months, subject to privacy/legal review - this file does not claim compliance).
 *
 * Two tables keep the client's IP address and browser string: `pt_terms_acceptances` (the evidence that a PT confirmed the terms and a
 * fraud-prevention signal) and `audit_logs` (who did what). For a row OLDER than IP_UA_RETENTION_MONTHS both `ip_address` and
 * `user_agent` are set to NULL. Everything else on the row stays: the acceptance still proves WHO accepted WHICH version and WHEN, the
 * audit entry still says what happened. Nothing is deleted.
 *
 *  - Legal hold: a row whose `legal_hold_until` is in the future is skipped (its IP/UA are evidence in a dispute). The column is written
 *    by admin tooling only (scripts/ip-ua-legal-hold.ts); no HTTP route sets it. When the hold lapses the row is scrubbed by the next run.
 *  - Idempotent: a scrubbed row no longer matches the selection, so a second run (or two instances running at once) changes nothing.
 *    The UPDATE repeats the whole predicate, including the hold check, so a hold placed between the SELECT and the UPDATE still wins.
 *  - Batched: at most BATCH rows per statement and MAX_BATCHES statements per table per run; a backlog drains over several runs.
 *  - Clock: "now" is a parameter, so the 12-month boundary is testable with a fake clock.
 *  - Never logged: the log lines carry counts only, never an IP, a user agent or a row's content.
 */
import { logger } from "@gym-coach/shared";
import { Prisma } from "../generated/prisma";
import { prisma } from "../repositories/profile.repository";
import { trackJob } from "../lifecycle";

/** The owner's retention period for IP address and user agent. A constant on purpose: no env knob that could silently change it. */
export const IP_UA_RETENTION_MONTHS = 12;

const INTERVAL_MS = Number(process.env.IP_UA_RETENTION_SWEEP_INTERVAL_MS ?? 6 * 60 * 60 * 1000);
const BATCH = 500;
const MAX_BATCHES = 20;

let running = false;

/** Rows created/accepted strictly before this instant are past retention. Calendar months, UTC (12 months before 2026-10-21T10:00Z is 2025-10-21T10:00Z). */
export function ipUaRetentionCutoff(now: Date): Date {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - IP_UA_RETENTION_MONTHS);
  return d;
}

export interface IpUaRetentionResult {
  skipped: boolean;
  termsScrubbed: number;
  auditScrubbed: number;
}

/** Scrubs one table in batches; returns how many rows it changed. */
async function scrubTable(opts: {
  now: Date;
  cutoff: Date;
  batch: number;
  maxBatches: number;
  select: (where: Prisma.PtTermsAcceptanceWhereInput | Prisma.AuditLogWhereInput, take: number) => Promise<Array<{ id: string }>>;
  update: (ids: string[], where: Prisma.PtTermsAcceptanceWhereInput | Prisma.AuditLogWhereInput) => Promise<number>;
  dateField: "acceptedAt" | "createdAt";
}): Promise<number> {
  const pastRetention = { [opts.dateField]: { lt: opts.cutoff } };
  const stillHasPersonalData = { OR: [{ ipAddress: { not: null } }, { userAgent: { not: null } }] };
  const notOnHold = { OR: [{ legalHoldUntil: null }, { legalHoldUntil: { lte: opts.now } }] };
  const where = { AND: [pastRetention, stillHasPersonalData, notOnHold] };
  let changed = 0;
  for (let i = 0; i < opts.maxBatches; i++) {
    const rows = await opts.select(where, opts.batch);
    if (rows.length === 0) break;
    changed += await opts.update(
      rows.map((r) => r.id),
      where,
    );
    if (rows.length < opts.batch) break;
  }
  return changed;
}

export async function runIpUaRetentionSweep(
  now: Date = new Date(),
  limits: { batch?: number; maxBatches?: number } = {},
): Promise<IpUaRetentionResult> {
  if (running) {
    logger.info("[IpUaRetention] previous run still in progress - skipping tick");
    return { skipped: true, termsScrubbed: 0, auditScrubbed: 0 };
  }
  running = true;
  try {
    const cutoff = ipUaRetentionCutoff(now);
    const batch = limits.batch ?? BATCH;
    const maxBatches = limits.maxBatches ?? MAX_BATCHES;
    const scrub = { ipAddress: null, userAgent: null };

    const termsScrubbed = await scrubTable({
      now,
      cutoff,
      batch,
      maxBatches,
      dateField: "acceptedAt",
      select: (where, take) =>
        prisma.ptTermsAcceptance.findMany({
          where: where as Prisma.PtTermsAcceptanceWhereInput,
          select: { id: true },
          orderBy: { acceptedAt: "asc" },
          take,
        }),
      update: async (ids, where) =>
        (await prisma.ptTermsAcceptance.updateMany({ where: { AND: [{ id: { in: ids } }, where as Prisma.PtTermsAcceptanceWhereInput] }, data: scrub })).count,
    });

    const auditScrubbed = await scrubTable({
      now,
      cutoff,
      batch,
      maxBatches,
      dateField: "createdAt",
      select: (where, take) =>
        prisma.auditLog.findMany({
          where: where as Prisma.AuditLogWhereInput,
          select: { id: true },
          orderBy: { createdAt: "asc" },
          take,
        }),
      update: async (ids, where) =>
        (await prisma.auditLog.updateMany({ where: { AND: [{ id: { in: ids } }, where as Prisma.AuditLogWhereInput] }, data: scrub })).count,
    });

    if (termsScrubbed > 0 || auditScrubbed > 0) {
      logger.info(`[IpUaRetention] cleared IP/user agent on ${termsScrubbed} terms acceptance row(s) and ${auditScrubbed} audit row(s)`);
    }
    return { skipped: false, termsScrubbed, auditScrubbed };
  } finally {
    running = false;
  }
}

/** Starts the periodic sweep; returns the function that stops it (graceful shutdown). */
export function startIpUaRetentionSweepJob(): () => void {
  logger.info(`IP/UA retention sweep started (interval: ${Math.round(INTERVAL_MS / 60000)} min, retention: ${IP_UA_RETENTION_MONTHS} months)`);
  const timer = setInterval(() => {
    void trackJob(runIpUaRetentionSweep().catch((e) => logger.error({ message: (e as Error)?.message }, "[IpUaRetention] tick failed")));
  }, INTERVAL_MS);
  return () => clearInterval(timer);
}
