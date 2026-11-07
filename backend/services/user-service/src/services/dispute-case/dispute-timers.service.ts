import { logger } from "@gym-coach/shared";
import { SessionDisputeType, SessionStatus } from "../../generated/prisma";
import { prisma } from "../../repositories/profile.repository";
import { sessionRepository } from "../../repositories/session.repository";
import { authServiceClient } from "../../clients/auth-service.client";
import { notificationService } from "../notification.service";
import { isShuttingDown, trackJob } from "../../lifecycle";
import { withRunningContract } from "../contract-lock";
import { now as clockNow, DAY_MS } from "./clock";
import { caseError } from "./errors";
import { timersEnabled } from "./flags";
import { deadlineDueAt, recordPartyNotice } from "./party-notices";
import { noticesFor } from "./notices";
import { disputeCaseService, __internals, type Actor } from "./dispute-case.service";
import { isTerminal, type CaseStatus } from "./rules";

/**
 * DISPUTE V2.1 TIMERS (Ngai 05/11/2026). One sweep, behind the fail-closed flag DISPUTE_CASE_TIMERS_ENABLED, every rule driven by an INJECTABLE clock. NOTHING here rules, pays or writes a
 * settlement: a silent party is RECORDED (NO_RESPONSE_RECORDED), the step MOVES, and a person decides.
 *
 *   response clocks   48 h (PT answering a no-show report) / 72 h (first response of each party) / 48 h (each supplement round); continuous hours from the moment the in-app notice
 *                     to THAT party was validly recorded; paused while that party's account is locked in auth-service (unknown lock state = nothing happens this tick).
 *   S2.4              PT_NO_SHOW_REPORTED with the PT silent past 48 h -> the session becomes DISPUTED under the contract lock (a new transition, PT_NO_SHOW_CLAIM) and the Case goes to
 *                     ASSESSING. The system NEVER answers AGREE for the PT.
 *   SLA               calendar day 10 -> warning (event + notice, once); day 14 -> escalated flag + notice (once). No ruling.
 *   held money        a held (UNCONFIRMED) settlement row gets a review record: a mandatory decision every 7 days (process.service), owner escalation after 30 days.
 *                     No automatic payout, no write-off.
 */
export const SYSTEM_ACTOR: Actor = { id: "system:dispute-timers", role: "ADMIN" };
export const SLA_WARN_DAYS = 10;
export const SLA_OVERDUE_DAYS = 14;
export const HELD_REVIEW_DAYS = 7;
export const HELD_OWNER_ESCALATION_DAYS = 30;

/** true = the account is locked, false = usable, null = unknown (auth-service unreachable): an unknown state changes nothing. */
export type AccountLockLookup = (userId: string) => Promise<boolean | null>;
const httpLockLookup: AccountLockLookup = async (userId) => {
  try {
    const { data } = await authServiceClient.internalGet(`/auth/internal/users/${encodeURIComponent(userId)}`, { timeoutMs: 3000 });
    const u = data?.user;
    if (!u) return null;
    return u.isActive === false || u.isLocked === true || u.locked === true;
  } catch {
    return null;
  }
};
let lockLookup: AccountLockLookup = httpLockLookup;
/** TEST SEAM (pass nothing to restore the real lookup). */
export function setAccountLockLookupForTests(fn?: AccountLockLookup): void {
  lockLookup = fn ?? httpLockLookup;
}

export interface TimersSummary {
  skipped?: "FLAG_OFF";
  noShowDeadlinesStarted: number;
  paused: number;
  resumed: number;
  expired: number;
  noShowEscalated: number;
  slaWarnings: number;
  slaOverdue: number;
  heldReviewsOpened: number;
  heldOwnerEscalations: number;
  errors: number;
}
const empty = (): TimersSummary => ({ noShowDeadlinesStarted: 0, paused: 0, resumed: 0, expired: 0, noShowEscalated: 0, slaWarnings: 0, slaOverdue: 0, heldReviewsOpened: 0, heldOwnerEscalations: 0, errors: 0 });

let running = false;

export async function runDisputeTimersSweep(opts: { now?: Date } = {}): Promise<TimersSummary> {
  const out = empty();
  if (!timersEnabled()) return { ...out, skipped: "FLAG_OFF" };
  if (running || isShuttingDown()) return out;
  running = true;
  const at = opts.now ?? clockNow();
  const guard = async (f: () => Promise<void>) => {
    try {
      await f();
    } catch (e) {
      out.errors += 1;
      logger.warn({ message: (e as Error)?.message?.slice(0, 300) }, "[DisputeTimers] step failed");
    }
  };
  try {
    await guard(() => startNoShowDeadlines(at, out));
    await guard(() => advanceDeadlines(at, out));
    await guard(() => slaSweep(at, out));
    await guard(() => heldMoneySweep(at, out));
    return out;
  } finally {
    running = false;
  }
}

// ── S2.4: the PT's 48 h clock starts from the PT's own in-app notice ─────────────────────────────────────────────────────────────────────

async function startNoShowDeadlines(at: Date, out: TimersSummary) {
  const sessions = await prisma.session.findMany({ where: { status: SessionStatus.PT_NO_SHOW_REPORTED }, select: { id: true, ptUserId: true }, take: 200 });
  for (const s of sessions) {
    const notice = await prisma.notification.findFirst({ where: { userId: s.ptUserId, eventType: "SESSION_PT_NO_SHOW_REPORTED", entityId: s.id }, orderBy: { createdAt: "desc" } });
    if (!notice) continue; // no validly recorded in-app notice, no clock
    const existing = await prisma.disputeCasePartyNotice.findUnique({ where: { notificationId: String(notice.id) } });
    if (existing) continue;
    const openCase = await prisma.disputeCase.findFirst({ where: { sessionId: s.id, status: { notIn: ["DECISION_APPROVED", "REJECTED_INTAKE", "CLOSED"] } }, select: { id: true } });
    const rec = await recordPartyNotice(prisma, { caseId: openCase?.id ?? null, sessionId: s.id, userId: s.ptUserId, partyRole: "PT", kind: "PT_NO_SHOW_ANSWER", notificationId: String(notice.id), recordedAt: new Date(notice.createdAt) });
    await prisma.disputeCaseDeadline.create({ data: { caseId: openCase?.id ?? null, sessionId: s.id, userId: s.ptUserId, partyRole: "PT", kind: "PT_NO_SHOW_ANSWER", hours: 48, startedAt: rec.recordedAt, noticeId: rec.id } });
    out.noShowDeadlinesStarted += 1;
  }
  void at;
}

// ── every OPEN clock: closed by the real state, paused while locked, expired when due ─────────────────────────────────────────────────────

async function advanceDeadlines(at: Date, out: TimersSummary) {
  const open = await prisma.disputeCaseDeadline.findMany({ where: { status: "OPEN" }, orderBy: [{ startedAt: "asc" }, { id: "asc" }], take: 500 });
  for (const d of open) {
    try {
      // the real state first
      if (d.kind === "PT_NO_SHOW_ANSWER") {
        const s = await prisma.session.findUnique({ where: { id: d.sessionId }, select: { status: true } });
        if (!s || s.status !== SessionStatus.PT_NO_SHOW_REPORTED) {
          await prisma.disputeCaseDeadline.updateMany({ where: { id: d.id, status: "OPEN" }, data: { status: "SATISFIED", satisfiedAt: at, pausedAt: null } });
          continue;
        }
      } else if (d.caseId) {
        const c = await prisma.disputeCase.findUnique({ where: { id: d.caseId }, select: { status: true } });
        if (!c || isTerminal(c.status as CaseStatus) || !["COLLECTING", "AWAITING_PARTIES", "ASSESSING", "POLICY_PENDING"].includes(c.status)) {
          await prisma.disputeCaseDeadline.updateMany({ where: { id: d.id, status: "OPEN" }, data: { status: "CANCELLED", pausedAt: null } });
          continue;
        }
      }
      // pause accounting
      const locked = await lockLookup(d.userId);
      if (locked === null) continue; // unknown: neither pause nor expire
      let cur = d;
      if (locked && !d.pausedAt) {
        cur = await prisma.disputeCaseDeadline.update({ where: { id: d.id }, data: { pausedAt: at } });
        out.paused += 1;
      } else if (!locked && d.pausedAt) {
        cur = await prisma.disputeCaseDeadline.update({ where: { id: d.id }, data: { pausedSeconds: d.pausedSeconds + Math.max(0, Math.floor((at.getTime() - d.pausedAt.getTime()) / 1000)), pausedAt: null } });
        out.resumed += 1;
      }
      const due = deadlineDueAt(cur);
      if (!due || at.getTime() < due.getTime()) continue;
      if (cur.kind === "PT_NO_SHOW_ANSWER") await expireNoShowAnswer(cur, at, out);
      else await expireResponse(cur, at, out);
    } catch (e) {
      out.errors += 1;
      logger.warn({ deadlineId: d.id, message: (e as Error)?.message?.slice(0, 200) }, "[DisputeTimers] deadline step failed");
    }
  }
}

/** First/supplement response expired: NO_RESPONSE_RECORDED, and when nobody else is still expected the step MOVES (AWAITING_PARTIES -> ASSESSING). Never a ruling. */
async function expireResponse(d: { id: string; caseId: string | null; userId: string; partyRole: string; kind: string }, at: Date, out: TimersSummary) {
  if (!d.caseId) return;
  await __internals.mutate<Record<string, unknown>>({
    actor: SYSTEM_ACTOR,
    action: "NO_RESPONSE_RECORDED",
    scope: d.id,
    body: { deadlineId: d.id },
    run: async (ctx) => {
      const c = await __internals.lockCase(ctx.tx, d.caseId!);
      const flipped = await ctx.tx.disputeCaseDeadline.updateMany({ where: { id: d.id, status: "OPEN" }, data: { status: "EXPIRED", expiredAt: at, pausedAt: null } });
      if (flipped.count !== 1) return { caseId: c.id, result: { recorded: false } };
      const remaining = await ctx.tx.disputeCaseDeadline.count({ where: { caseId: c.id, status: "OPEN" } });
      let moved = false;
      if (c.status === "AWAITING_PARTIES" && remaining === 0) {
        await __internals.casStatus(ctx, c, "ASSESSING", "Hết thời hạn phản hồi: ghi nhận chưa phản hồi, chuyển sang đánh giá (không phán quyết)");
        moved = true;
      }
      ctx.notices.push(noticesFor("NO_RESPONSE", c));
      return { caseId: c.id, result: { recorded: true, partyRole: d.partyRole, kind: d.kind, moved, caseStatus: c.status }, note: `${d.partyRole} chưa phản hồi trong thời hạn`, detail: { deadlineId: d.id, partyRole: d.partyRole, kind: d.kind, moved } };
    },
  });
  out.expired += 1;
}

/** S2.4: the PT stayed silent for 48 h. The session goes PT_NO_SHOW_REPORTED -> DISPUTED under the contract lock; the Case (opened here if needed) goes to ASSESSING. */
async function expireNoShowAnswer(d: { id: string; sessionId: string; userId: string }, at: Date, out: TimersSummary) {
  const session = await prisma.session.findUnique({ where: { id: d.sessionId }, select: { id: true, contractId: true, status: true, clientUserId: true, ptUserId: true } });
  if (!session || session.status !== SessionStatus.PT_NO_SHOW_REPORTED) {
    await prisma.disputeCaseDeadline.updateMany({ where: { id: d.id, status: "OPEN" }, data: { status: "SATISFIED", satisfiedAt: at } });
    return;
  }
  try {
    await withRunningContract(session.contractId, async (tx) => {
      const moved = await sessionRepository.transitionStatus(
        session.id,
        [SessionStatus.PT_NO_SHOW_REPORTED],
        SessionStatus.DISPUTED,
        { ptNotes: "PT không phản hồi báo vắng mặt trong 48 giờ (hệ thống ghi nhận, không phán quyết)", disputeType: SessionDisputeType.PT_NO_SHOW_CLAIM },
        tx,
      );
      if (!moved) throw caseError(409, "SESSION_STATE_CHANGED", "Buổi tập đã đổi trạng thái");
    });
  } catch (e: any) {
    // the contract is no longer running / the session moved under us: nothing to escalate any more
    await prisma.disputeCaseDeadline.updateMany({ where: { id: d.id, status: "OPEN" }, data: { status: "CANCELLED", pausedAt: null } });
    logger.info({ sessionId: session.id, code: e?.code }, "[DisputeTimers] no-show answer expiry left alone");
    return;
  }
  await prisma.disputeCaseDeadline.updateMany({ where: { id: d.id, status: "OPEN" }, data: { status: "EXPIRED", expiredAt: at, pausedAt: null } });
  let c = await prisma.disputeCase.findFirst({ where: { sessionId: session.id, status: { notIn: ["DECISION_APPROVED", "REJECTED_INTAKE", "CLOSED"] } }, select: { id: true } });
  if (!c) {
    const opened = await disputeCaseService.openCase(SYSTEM_ACTOR, session.id);
    c = { id: opened.result.case.id };
  }
  await __internals.mutate<Record<string, unknown>>({
    actor: SYSTEM_ACTOR,
    action: "NO_RESPONSE_RECORDED",
    scope: `${d.id}:noshow`,
    body: { deadlineId: d.id },
    run: async (ctx) => {
      const row = await __internals.lockCase(ctx.tx, c!.id);
      let moved = false;
      if (row.status === "INTAKE") {
        await __internals.casStatus(ctx, row, "COLLECTING", "PT không phản hồi báo vắng mặt trong 48 giờ");
        moved = true;
      }
      if (["COLLECTING", "AWAITING_PARTIES", "TECH_RECONCILIATION"].includes(row.status)) {
        await __internals.casStatus(ctx, row, "ASSESSING", "PT không phản hồi báo vắng mặt trong 48 giờ: chuyển sang đánh giá, hệ thống không thay PT trả lời");
        moved = true;
      }
      ctx.notices.push(noticesFor("NO_SHOW_UNANSWERED", row));
      return { caseId: row.id, result: { recorded: true, kind: "PT_NO_SHOW_ANSWER", sessionStatus: "DISPUTED", moved, caseStatus: row.status }, note: "PT chưa phản hồi báo vắng mặt trong 48 giờ", detail: { deadlineId: d.id, sessionId: session.id } };
    },
  });
  // the case is linked to the clock for the record
  await prisma.disputeCaseDeadline.updateMany({ where: { id: d.id, caseId: null }, data: { caseId: c.id } });
  out.noShowEscalated += 1;
  out.expired += 1;
}

// ── SLA: calendar day 10 / 14 ────────────────────────────────────────────────────────────────────────────────────────────────────────────

async function slaSweep(at: Date, out: TimersSummary) {
  const cases = await prisma.disputeCase.findMany({ where: { status: { notIn: ["DECISION_APPROVED", "REJECTED_INTAKE", "CLOSED"] } }, select: { id: true, sessionId: true, escalated: true, createdAt: true }, take: 500 });
  if (cases.length === 0) return;
  const sessions = await prisma.session.findMany({ where: { id: { in: cases.map((c) => c.sessionId) } }, select: { id: true, disputedAt: true } });
  const disputedAt = new Map(sessions.map((s) => [s.id, s.disputedAt]));
  for (const c of cases) {
    const start = disputedAt.get(c.sessionId) ?? c.createdAt;
    const days = Math.floor((at.getTime() - start.getTime()) / DAY_MS);
    try {
      if (days >= SLA_OVERDUE_DAYS && !c.escalated) {
        await __internals.mutate<Record<string, unknown>>({
          actor: SYSTEM_ACTOR,
          action: "SLA_OVERDUE",
          scope: c.id,
          body: { day: SLA_OVERDUE_DAYS },
          run: async (ctx) => {
            const row = await __internals.lockCase(ctx.tx, c.id);
            if (row.escalated || isTerminal(row.status as CaseStatus)) return { caseId: row.id, result: { escalated: row.escalated, changed: false } };
            await __internals.casData(ctx, row, { escalated: true });
            ctx.notices.push(noticesFor("SLA_OVERDUE", row));
            return { caseId: row.id, result: { escalated: true, changed: true, ageDays: days }, note: `Quá hạn xử lý (ngày ${SLA_OVERDUE_DAYS}): chuyển cấp, không phán quyết`, detail: { ageDays: days } };
          },
        });
        out.slaOverdue += 1;
      } else if (days >= SLA_WARN_DAYS && days < SLA_OVERDUE_DAYS) {
        const warned = await prisma.disputeCaseEvent.findFirst({ where: { caseId: c.id, action: "SLA_WARNING" }, select: { id: true } });
        if (warned) continue;
        await __internals.mutate<Record<string, unknown>>({
          actor: SYSTEM_ACTOR,
          action: "SLA_WARNING",
          scope: c.id,
          body: { day: SLA_WARN_DAYS },
          run: async (ctx) => {
            const row = await __internals.lockCase(ctx.tx, c.id);
            ctx.notices.push(noticesFor("SLA_WARNING", row));
            return { caseId: row.id, result: { warned: true, ageDays: days }, note: `Sắp quá hạn xử lý (ngày ${SLA_WARN_DAYS})`, detail: { ageDays: days } };
          },
        });
        out.slaWarnings += 1;
      }
    } catch (e) {
      out.errors += 1;
      logger.warn({ caseId: c.id, message: (e as Error)?.message?.slice(0, 200) }, "[DisputeTimers] SLA step failed");
    }
  }
}

// ── held money: a review record per held row, owner escalation after 30 days. Decisions are made by a person (process.service) ────────────

async function heldMoneySweep(at: Date, out: TimersSummary) {
  const held = await prisma.sessionSettlement.findMany({ where: { status: "UNCONFIRMED" }, select: { id: true, sessionId: true, contractId: true }, take: 500 });
  const heldIds = new Set(held.map((h) => h.id));
  for (const h of held) {
    if (!h.sessionId) continue;
    const exists = await prisma.disputeHeldMoneyReview.findUnique({ where: { settlementRowId: h.id } });
    if (exists) continue;
    await prisma.disputeHeldMoneyReview.create({ data: { settlementRowId: h.id, sessionId: h.sessionId, contractId: h.contractId, firstSeenAt: at, nextReviewDueAt: new Date(at.getTime() + HELD_REVIEW_DAYS * DAY_MS) } });
    out.heldReviewsOpened += 1;
  }
  const reviews = await prisma.disputeHeldMoneyReview.findMany({ where: { closedAt: null }, take: 500 });
  for (const r of reviews) {
    if (!heldIds.has(r.settlementRowId)) {
      await prisma.disputeHeldMoneyReview.updateMany({ where: { id: r.id, closedAt: null }, data: { closedAt: at } });
      continue;
    }
    if (!r.ownerEscalatedAt && at.getTime() - r.firstSeenAt.getTime() >= HELD_OWNER_ESCALATION_DAYS * DAY_MS) {
      const flipped = await prisma.disputeHeldMoneyReview.updateMany({ where: { id: r.id, ownerEscalatedAt: null }, data: { ownerEscalatedAt: at } });
      if (flipped.count === 1) {
        notificationService.broadcastToAdmins({ id: `held-money-${r.id}`, text: "Có khoản tiền đang giữ quá 30 ngày chưa được giải quyết; cần chủ hệ thống quyết định. Hệ thống không tự chi trả hay xoá.", eventType: "DISPUTE_CASE_UPDATED", entityType: "DISPUTE_CASE", entityId: r.sessionId, link: "/admin/disputes" });
        out.heldOwnerEscalations += 1;
      }
    }
  }
}

// ── scheduling ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

const INTERVAL_MS = Number(process.env.DISPUTE_TIMERS_SWEEP_INTERVAL_MS ?? 60_000);
export function startDisputeTimersSweepJob(): () => void {
  logger.info(`Dispute timers sweep job started (interval: ${Math.round(INTERVAL_MS / 1000)} s; a no-op unless DISPUTE_CASE_TIMERS_ENABLED is effective)`);
  const timer = setInterval(() => {
    void trackJob(runDisputeTimersSweep());
  }, INTERVAL_MS);
  return () => clearInterval(timer);
}
