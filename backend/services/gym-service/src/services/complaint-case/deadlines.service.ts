import { logger } from '@gym-coach/shared';
import { prisma } from '../../repositories/prisma';
import { userClient } from '../../clients/user.client';
import { gymCaseEnabled } from './flags';
import { notifyParty, lockCase, toJson, type Actor } from './case.service';
import { deadlineDueAt, slaOf, TERMINAL_STATUSES, type CaseStatus, type DeadlineKind } from './rules';

/**
 * A1 (Ngài approved) for gym cases - SLA and party response deadlines. NOTHING in here rules, refunds or releases money:
 *   SLA        calendar days from the complaint's first report: warning at day 10, overdue at day 14 -> the case is flagged (escalated), admins are told, once each.
 *   deadlines  72h for the first response, 48h for every supplement round, counted from a DELIVERED in-app notice (gym_case_notices.delivered). If the notice
 *              could not be delivered no clock starts and the investigator is told so (event DEADLINE_NOT_STARTED).
 *   expiry     records NO_RESPONSE_RECORDED (a NEUTRAL event: no fault, no evidence) and only moves the step AWAITING_PARTIES -> ASSESSING.
 * All writes need the fail-closed flag (the sweeps return at once while it is not effective).
 */

const SYSTEM: Actor = { id: 'system', role: 'SYSTEM' };

/** After a request-more to AWAITING_PARTIES: notify each asked party and start its clock from the delivered notice. */
export async function startResponseDeadlines(actor: Actor, caseId: string, parties: Array<'MEMBER' | 'GYM'>) {
  const c = await prisma.gymComplaintCase.findUnique({ where: { id: caseId }, select: { id: true, gymId: true, reporterUserId: true } });
  if (!c) return;
  const gym = await prisma.gym.findUnique({ where: { id: c.gymId }, select: { ownerId: true } });
  for (const party of new Set(parties)) {
    const recipient = party === 'MEMBER' ? c.reporterUserId : gym?.ownerId;
    if (!recipient) continue;
    const text =
      party === 'MEMBER'
        ? 'Gymini cần bạn bổ sung thêm thông tin cho báo cáo vấn đề của bạn. Vui lòng mở báo cáo để xem chi tiết.'
        : 'Gymini cần chi nhánh của bạn giải trình hoặc cung cấp thêm bằng chứng cho một báo cáo vấn đề. Vui lòng mở báo cáo để xem chi tiết.';
    const notice = await notifyParty(c, recipient, party, text, 'GYM_COMPLAINT_CASE_MORE_INFO', 'MORE_INFO');
    if (!notice || !notice.delivered) {
      await prisma.gymCaseEvent.create({
        data: { caseId, actorUserId: actor.id, actorRole: actor.role, action: 'DEADLINE_NOT_STARTED', note: `${party}: thông báo trong ứng dụng chưa được ghi nhận nên chưa bắt đầu tính hạn`, payload: toJson({ party, reason: 'NOTICE_NOT_DELIVERED' }) },
      });
      continue;
    }
    const prior = await prisma.gymCaseDeadline.count({ where: { caseId, partyRole: party } });
    const kind: DeadlineKind = prior === 0 ? 'FIRST_RESPONSE' : 'SUPPLEMENT_ROUND';
    // a still-OPEN deadline of this party is kept (the clock is not restarted by a second request)
    const open = await prisma.gymCaseDeadline.findFirst({ where: { caseId, partyRole: party, status: 'OPEN' } });
    if (open) continue;
    const row = await prisma.gymCaseDeadline.create({
      data: { caseId, kind, partyRole: party, recipientUserId: recipient, noticeId: notice.id, startsAt: notice.createdAt, dueAt: deadlineDueAt(notice.createdAt, kind) },
    });
    await prisma.gymCaseEvent.create({
      data: { caseId, actorUserId: actor.id, actorRole: actor.role, action: 'DEADLINE_STARTED', note: `${party} ${kind}`, payload: toJson({ party, kind, dueAt: row.dueAt, noticeId: notice.id }) },
    });
  }
}

/** Expires every OPEN deadline whose time has passed. Neutral: it records the fact and moves the step, nothing else. */
export async function runCaseDeadlineSweep(now: Date = new Date()): Promise<{ expired: number; stepMoved: number }> {
  if (!gymCaseEnabled()) return { expired: 0, stepMoved: 0 };
  let expired = 0;
  let stepMoved = 0;
  const due = await prisma.gymCaseDeadline.findMany({ where: { status: 'OPEN', dueAt: { lte: now } }, select: { id: true, caseId: true }, take: 100 });
  for (const d of due) {
    try {
      await prisma.$transaction(
        async (tx) => {
          const c = await lockCase(tx, d.caseId);
          const r = await tx.gymCaseDeadline.updateMany({ where: { id: d.id, status: 'OPEN' }, data: { status: 'EXPIRED', resolvedAt: now } });
          if (r.count !== 1) return; // met or expired by someone else in the meantime
          expired++;
          const dl = await tx.gymCaseDeadline.findUniqueOrThrow({ where: { id: d.id } });
          await tx.gymCaseEvent.create({
            data: {
              caseId: c.id,
              actorUserId: SYSTEM.id,
              actorRole: SYSTEM.role,
              action: 'NO_RESPONSE_RECORDED',
              note: `${dl.partyRole} ${dl.kind}: hết hạn, ghi nhận trung tính (không suy ra lỗi của bên nào)`,
              payload: toJson({ party: dl.partyRole, kind: dl.kind, dueAt: dl.dueAt }),
            },
          });
          const stillOpen = await tx.gymCaseDeadline.count({ where: { caseId: c.id, status: 'OPEN' } });
          if (c.status === 'AWAITING_PARTIES' && stillOpen === 0) {
            const m = await tx.gymComplaintCase.updateMany({ where: { id: c.id, version: c.version, status: 'AWAITING_PARTIES' }, data: { status: 'ASSESSING', version: { increment: 1 } } });
            if (m.count === 1) {
              stepMoved++;
              await tx.gymCaseEvent.create({ data: { caseId: c.id, actorUserId: SYSTEM.id, actorRole: SYSTEM.role, action: 'TRANSITION', fromStatus: 'AWAITING_PARTIES', toStatus: 'ASSESSING', note: 'hết hạn phản hồi: chỉ chuyển bước, không kết luận' } });
            }
          }
        },
        { timeout: 20_000 },
      );
    } catch (e) {
      logger.error({ err: (e as Error).message, deadlineId: d.id }, '[GymCase] deadline sweep failed for one deadline');
    }
  }
  return { expired, stepMoved };
}

/** SLA: flags and tells the admins, once per threshold. It never rules, refunds or releases anything. */
export async function runCaseSlaSweep(now: Date = new Date()): Promise<{ warned: number; escalated: number }> {
  if (!gymCaseEnabled()) return { warned: 0, escalated: 0 };
  let warned = 0;
  let escalated = 0;
  const open = await prisma.gymComplaintCase.findMany({
    where: { status: { notIn: TERMINAL_STATUSES as CaseStatus[] }, OR: [{ slaWarnedAt: null }, { slaOverdueAt: null }] },
    select: { id: true, complaint: { select: { createdAt: true } } },
    take: 200,
  });
  for (const row of open) {
    const sla = slaOf(row.complaint.createdAt, now);
    if (sla.state === 'OK') continue;
    try {
      const flag = await prisma.$transaction(async (tx) => {
        const c = await lockCase(tx, row.id);
        if (TERMINAL_STATUSES.includes(c.status as CaseStatus)) return null;
        let out: 'WARNING' | 'OVERDUE' | null = null;
        if (sla.state === 'OVERDUE' && !c.slaOverdueAt) {
          await tx.gymComplaintCase.update({ where: { id: c.id }, data: { slaOverdueAt: now, slaWarnedAt: c.slaWarnedAt ?? now, escalated: true, version: { increment: 1 } } });
          await tx.gymCaseEvent.create({ data: { caseId: c.id, actorUserId: SYSTEM.id, actorRole: SYSTEM.role, action: 'SLA_OVERDUE_ESCALATED', note: `quá hạn ${sla.ageDays} ngày lịch: chuyển cấp, không tự kết luận`, payload: toJson({ ageDays: sla.ageDays }) } });
          out = 'OVERDUE';
        } else if (sla.state === 'WARNING' && !c.slaWarnedAt) {
          await tx.gymComplaintCase.update({ where: { id: c.id }, data: { slaWarnedAt: now, version: { increment: 1 } } });
          await tx.gymCaseEvent.create({ data: { caseId: c.id, actorUserId: SYSTEM.id, actorRole: SYSTEM.role, action: 'SLA_WARNING', note: `đã ${sla.ageDays} ngày lịch`, payload: toJson({ ageDays: sla.ageDays }) } });
          out = 'WARNING';
        }
        return out;
      });
      if (!flag) continue;
      if (flag === 'OVERDUE') escalated++;
      else warned++;
      await userClient.notifyAdmins({
        id: `gym-case-sla-${flag.toLowerCase()}:${row.id}`,
        text: flag === 'OVERDUE' ? 'Một hồ sơ khiếu nại phòng gym đã quá hạn xử lý (14 ngày) và được chuyển cấp.' : 'Một hồ sơ khiếu nại phòng gym sắp quá hạn xử lý (đã 10 ngày).',
        eventType: flag === 'OVERDUE' ? 'GYM_COMPLAINT_CASE_SLA_OVERDUE' : 'GYM_COMPLAINT_CASE_SLA_WARNING',
        entityType: 'GYM_COMPLAINT_CASE',
        entityId: row.id,
      });
    } catch (e) {
      logger.error({ err: (e as Error).message, caseId: row.id }, '[GymCase] SLA sweep failed for one case');
    }
  }
  return { warned, escalated };
}

/** Periodic runner (server.ts). Every tick is a no-op while the flag is not effective. */
export function startCaseSweeps(intervalMs = 10 * 60 * 1000): () => void {
  const timer = setInterval(() => {
    void runCaseDeadlineSweep().catch((e) => logger.error({ err: (e as Error).message }, '[GymCase] deadline sweep'));
    void runCaseSlaSweep().catch((e) => logger.error({ err: (e as Error).message }, '[GymCase] sla sweep'));
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}
