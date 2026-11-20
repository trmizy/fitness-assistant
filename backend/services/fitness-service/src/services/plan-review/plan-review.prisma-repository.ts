import { Prisma } from "../../generated/prisma";
import { prisma } from "../../repositories/prisma";
import type { PlanReviewStatusValue } from "./plan-review.engine";
import {
  PlanReviewSubjectChanged,
  PlanReviewUniqueViolation,
  type NewPlanReviewEvent,
  type PlanReviewEventRecord,
  type PlanReviewRecord,
  type PlanReviewRepository,
  type TransitionInput,
} from "./plan-review.types";

/**
 * Prisma-backed PlanReviewRepository. Every write is a single $transaction; state changes are CONDITIONAL
 * (`updateMany ... where status in (...) and revision = N`, count === 0 => lost the race => null) so two concurrent PT/client
 * actions can never both win, and the audit event is written in the same transaction as the state it describes.
 *
 * NOT RUN in this change: it needs the isolated fitness test DB (see plan-review.integration.test.ts, which skips without one).
 */

const toRecord = (row: any): PlanReviewRecord => ({ ...row, status: row.status as PlanReviewStatusValue });
const toEvent = (row: any): PlanReviewEventRecord => ({ ...row });

function eventData(requestId: string, e: NewPlanReviewEvent) {
  return {
    requestId,
    type: e.type,
    actorUserId: e.actorUserId,
    actorRole: e.actorRole,
    fromStatus: e.fromStatus,
    toStatus: e.toStatus,
    contentHash: e.contentHash,
    note: e.note ?? null,
    metadata: (e.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
    notifyUserId: e.notifyUserId ?? null,
  };
}

function uniqueTarget(err: unknown): "OPEN_PER_SUBJECT" | "IDEMPOTENCY_KEY" | null {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== "P2002") return null;
  const target = JSON.stringify(err.meta?.target ?? "");
  return /idempotency/i.test(target) ? "IDEMPOTENCY_KEY" : "OPEN_PER_SUBJECT";
}

export const prismaPlanReviewRepository: PlanReviewRepository = {
  async findById(id) {
    const row = await prisma.planReviewRequest.findUnique({ where: { id } });
    return row ? toRecord(row) : null;
  },
  async findByIdempotencyKey(clientUserId, key) {
    const row = await prisma.planReviewRequest.findUnique({ where: { clientUserId_idempotencyKey: { clientUserId, idempotencyKey: key } } });
    return row ? toRecord(row) : null;
  },
  async findOpenForSubject(clientUserId, subjectType, subjectId) {
    const row = await prisma.planReviewRequest.findFirst({
      where: { clientUserId, subjectType, subjectId, status: { in: ["PENDING_REVIEW", "IN_REVIEW"] } },
    });
    return row ? toRecord(row) : null;
  },
  async listByClient(clientUserId, opts = {}) {
    const rows = await prisma.planReviewRequest.findMany({
      where: { clientUserId, ...(opts.subjectId ? { subjectId: opts.subjectId } : {}) },
      orderBy: { submittedAt: "desc" },
      take: 200,
    });
    return rows.map(toRecord);
  },
  async listByPt(ptUserId, opts = {}) {
    const rows = await prisma.planReviewRequest.findMany({
      where: { ptUserId, ...(opts.statuses ? { status: { in: [...opts.statuses] } } : {}) },
      orderBy: { submittedAt: "desc" },
      take: 500,
    });
    return rows.map(toRecord);
  },
  async listEvents(requestId) {
    const rows = await prisma.planReviewEvent.findMany({ where: { requestId }, orderBy: { createdAt: "asc" } });
    return rows.map(toEvent);
  },

  async createSubmission({ data, submittedEvent, supersede }) {
    try {
      return await prisma.$transaction(async (tx) => {
        if (supersede) {
          const res = await tx.planReviewRequest.updateMany({
            where: { id: supersede.id, status: { in: ["PENDING_REVIEW", "IN_REVIEW"] }, revision: supersede.expectedRevision },
            data: { status: "SUPERSEDED", revision: { increment: 1 } },
          });
          if (res.count === 0) throw new PlanReviewUniqueViolation("OPEN_PER_SUBJECT"); // older request moved: caller re-reads
          await tx.planReviewEvent.create({ data: eventData(supersede.id, supersede.event) });
        }
        const created = await tx.planReviewRequest.create({
          data: { ...data, snapshot: data.snapshot as Prisma.InputJsonValue },
        });
        await tx.planReviewEvent.create({ data: eventData(created.id, submittedEvent) });
        return toRecord(created);
      });
    } catch (err) {
      const target = uniqueTarget(err);
      if (target) throw new PlanReviewUniqueViolation(target);
      throw err;
    }
  },

  async transition(input: TransitionInput) {
    return prisma.$transaction(async (tx) => {
      if (input.subjectGuard) {
        // FOR SHARE conflicts with the row lock every plan mutation takes when it bumps workout_programs.version, so the check
        // and the status change below see one consistent version (no check-then-act window).
        const rows = await tx.$queryRaw<Array<{ version: number }>>`
          SELECT "version" FROM "workout_programs" WHERE "id" = ${input.subjectGuard.subjectId} FOR SHARE`;
        if (rows.length === 0 || rows[0].version !== input.subjectGuard.version) throw new PlanReviewSubjectChanged();
      }
      const res = await tx.planReviewRequest.updateMany({
        where: {
          id: input.id,
          status: { in: [...input.fromStatuses] },
          ...(input.expectedRevision !== undefined ? { revision: input.expectedRevision } : {}),
        },
        data: {
          status: input.toStatus,
          revision: { increment: 1 },
          ...(input.patch?.decisionNote !== undefined ? { decisionNote: input.patch.decisionNote } : {}),
          ...(input.patch?.decidedAt !== undefined ? { decidedAt: input.patch.decidedAt } : {}),
        },
      });
      if (res.count === 0) return null;
      await tx.planReviewEvent.create({ data: eventData(input.id, input.event) });
      const row = await tx.planReviewRequest.findUnique({ where: { id: input.id } });
      return row ? toRecord(row) : null;
    });
  },

  async pendingNotifications(limit) {
    const rows = await prisma.planReviewEvent.findMany({
      where: { notifyUserId: { not: null }, notifiedAt: null },
      orderBy: { createdAt: "asc" },
      take: limit,
    });
    return rows.map(toEvent);
  },
  async markNotified(eventId, at) {
    // Conditional: a concurrent sweeper that already marked it is fine (idempotent).
    await prisma.planReviewEvent.updateMany({ where: { id: eventId, notifiedAt: null }, data: { notifiedAt: at } });
  },
};
