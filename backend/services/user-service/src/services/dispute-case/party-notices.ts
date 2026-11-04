import { prisma } from "../../repositories/profile.repository";
import type { Prisma } from "../../generated/prisma";
import { HOUR_MS } from "./clock";

/**
 * V2.1 (Ngai 05/11/2026) response clocks. LEAF module (imports no case service) so the notice sender and the case service can both use it.
 *
 *   start      the moment the in-app notification to THAT party was VALIDLY recorded (the stored notification row's createdAt) - never email / push, and no row = no clock.
 *   length     PT answering a no-show report 48 h; first response of each party 72 h; each supplement round 48 h. Continuous hours.
 *   pause      while the party's account is locked in auth-service (the sweep adds the locked time to `paused_seconds`; a clock never expires while paused).
 *   expiry     NO_RESPONSE_RECORDED + the step moves; it NEVER rules against the silent party and never pays.
 */
export type DeadlineKind = "PT_NO_SHOW_ANSWER" | "FIRST_RESPONSE" | "SUPPLEMENT_ROUND";
export const DEADLINE_HOURS: Readonly<Record<DeadlineKind, 48 | 72>> = { PT_NO_SHOW_ANSWER: 48, FIRST_RESPONSE: 72, SUPPLEMENT_ROUND: 48 };

type Db = Prisma.TransactionClient | typeof prisma;

/** When a clock runs out: start + hours + the seconds the party's account spent locked. A clock that is paused right now has no due time (it cannot expire). */
export function deadlineDueAt(d: { startedAt: Date; hours: number; pausedSeconds: number; pausedAt: Date | null }): Date | null {
  if (d.pausedAt) return null;
  return new Date(d.startedAt.getTime() + d.hours * HOUR_MS + d.pausedSeconds * 1000);
}

export async function recordPartyNotice(
  db: Db,
  n: { caseId: string | null; sessionId: string; userId: string; partyRole: "CLIENT" | "PT"; kind: "RESPONSE_REQUESTED" | "PT_NO_SHOW_ANSWER" | "CONCLUSION"; notificationId: string; recordedAt: Date },
) {
  const existing = await db.disputeCasePartyNotice.findUnique({ where: { notificationId: n.notificationId } });
  if (existing) return existing;
  return db.disputeCasePartyNotice.create({ data: n });
}

/** FIRST_RESPONSE until the party has submitted anything in this case, SUPPLEMENT_ROUND for every later request. */
async function kindFor(db: Db, caseId: string, userId: string): Promise<DeadlineKind> {
  const [st, ev] = await Promise.all([
    db.disputeCaseStatement.count({ where: { caseId, authorUserId: userId, source: "SUBMITTED" } }),
    db.disputeCaseEvidence.count({ where: { caseId, submittedBy: userId } }),
  ]);
  return st + ev > 0 ? "SUPPLEMENT_ROUND" : "FIRST_RESPONSE";
}

/** Starts the response clock of a party from a recorded notice. One OPEN clock per (case, user, kind): a second request while one runs does not restart it. */
export async function startResponseDeadline(db: Db, n: { caseId: string; sessionId: string; userId: string; partyRole: "CLIENT" | "PT"; startedAt: Date; noticeId?: string }) {
  const kind = await kindFor(db, n.caseId, n.userId);
  const open = await db.disputeCaseDeadline.findFirst({ where: { caseId: n.caseId, userId: n.userId, status: "OPEN" } });
  if (open) return open;
  return db.disputeCaseDeadline.create({
    data: { caseId: n.caseId, sessionId: n.sessionId, userId: n.userId, partyRole: n.partyRole, kind, hours: DEADLINE_HOURS[kind], startedAt: n.startedAt, noticeId: n.noticeId ?? null },
  });
}

/** The party answered (statement / evidence): every open clock of that party in the case is satisfied. */
export async function satisfyDeadlines(db: Db, caseId: string, userId: string, at: Date = new Date()): Promise<number> {
  const r = await db.disputeCaseDeadline.updateMany({ where: { caseId, userId, status: "OPEN" }, data: { status: "SATISFIED", satisfiedAt: at, pausedAt: null } });
  return r.count;
}
