import { randomUUID } from "node:crypto";
import { isOpenStatus, type PlanReviewStatusValue } from "./plan-review.engine";
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
 * In-memory PlanReviewRepository with the SAME guarantees the Prisma one gets from the database:
 *  - one open request per (client, subject)  — partial unique index
 *  - unique (client, idempotencyKey)         — unique index
 *  - conditional transitions (status + revision) that return null instead of overwriting the winner.
 * Each method runs to completion synchronously between awaits, so Promise.all races have exactly one winner, like a row lock.
 * TEST FIXTURE only — never wired into the running service.
 */
export class InMemoryPlanReviewRepository implements PlanReviewRepository {
  readonly requests = new Map<string, PlanReviewRecord>();
  readonly events: PlanReviewEventRecord[] = [];
  /** Test hook: make the next createSubmission/transition fail after partial work to prove atomicity. */
  failNextWriteWith: Error | null = null;
  private tick = 0;
  private clock = () => new Date(Date.UTC(2026, 10, 19, 0, 0, 0) + this.tick++ * 1000);

  private event(requestId: string, e: NewPlanReviewEvent): PlanReviewEventRecord {
    return {
      ...e,
      note: e.note ?? null,
      metadata: e.metadata ?? null,
      notifyUserId: e.notifyUserId ?? null,
      id: randomUUID(),
      requestId,
      notifiedAt: null,
      createdAt: this.clock(),
    };
  }

  async findById(id: string) {
    const r = this.requests.get(id);
    return r ? { ...r } : null;
  }
  async findByIdempotencyKey(clientUserId: string, key: string) {
    for (const r of this.requests.values()) if (r.clientUserId === clientUserId && r.idempotencyKey === key) return { ...r };
    return null;
  }
  async findOpenForSubject(clientUserId: string, subjectType: string, subjectId: string) {
    for (const r of this.requests.values()) {
      if (r.clientUserId === clientUserId && r.subjectType === subjectType && r.subjectId === subjectId && isOpenStatus(r.status)) return { ...r };
    }
    return null;
  }
  async listByClient(clientUserId: string, opts: { subjectId?: string } = {}) {
    return [...this.requests.values()]
      .filter((r) => r.clientUserId === clientUserId && (!opts.subjectId || r.subjectId === opts.subjectId))
      .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())
      .map((r) => ({ ...r }));
  }
  async listByPt(ptUserId: string, opts: { statuses?: readonly PlanReviewStatusValue[] } = {}) {
    return [...this.requests.values()]
      .filter((r) => r.ptUserId === ptUserId && (!opts.statuses || opts.statuses.includes(r.status)))
      .sort((a, b) => b.submittedAt.getTime() - a.submittedAt.getTime())
      .map((r) => ({ ...r }));
  }
  async listEvents(requestId: string) {
    return this.events.filter((e) => e.requestId === requestId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  }

  async createSubmission(input: Parameters<PlanReviewRepository["createSubmission"]>[0]) {
    // Validate every constraint BEFORE mutating anything => all-or-nothing, like a rolled-back transaction.
    const { data } = input;
    if (data.idempotencyKey && (await this.findByIdempotencyKey(data.clientUserId, data.idempotencyKey))) {
      throw new PlanReviewUniqueViolation("IDEMPOTENCY_KEY");
    }
    const open = await this.findOpenForSubject(data.clientUserId, "WORKOUT_PROGRAM", data.subjectId);
    if (open && open.id !== input.supersede?.id) throw new PlanReviewUniqueViolation("OPEN_PER_SUBJECT");
    if (input.supersede) {
      const target = this.requests.get(input.supersede.id);
      if (!target || !isOpenStatus(target.status) || target.revision !== input.supersede.expectedRevision) {
        throw new PlanReviewUniqueViolation("OPEN_PER_SUBJECT"); // the older request moved under us: caller re-reads
      }
    }
    if (this.failNextWriteWith) {
      const err = this.failNextWriteWith;
      this.failNextWriteWith = null;
      throw err; // simulated DB failure: nothing below ran, so nothing was written
    }
    const now = this.clock();
    if (input.supersede) {
      const target = this.requests.get(input.supersede.id)!;
      this.requests.set(target.id, { ...target, status: "SUPERSEDED", revision: target.revision + 1, updatedAt: now });
      this.events.push(this.event(target.id, input.supersede.event));
    }
    const record: PlanReviewRecord = {
      id: randomUUID(),
      subjectType: "WORKOUT_PROGRAM",
      ...data,
      status: "PENDING_REVIEW",
      revision: 1,
      decisionNote: null,
      decidedAt: null,
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    };
    this.requests.set(record.id, record);
    this.events.push(this.event(record.id, input.submittedEvent));
    return { ...record };
  }

  /** Test hook standing in for the locked `workout_programs.version` read of the Prisma repository. */
  subjectVersionOf: (subjectId: string) => number | null = () => null;

  async transition(input: TransitionInput) {
    const cur = this.requests.get(input.id);
    if (input.subjectGuard) {
      const v = this.subjectVersionOf(input.subjectGuard.subjectId);
      if (v === null || v !== input.subjectGuard.version) throw new PlanReviewSubjectChanged();
    }
    if (!cur || !input.fromStatuses.includes(cur.status)) return null;
    if (input.expectedRevision !== undefined && cur.revision !== input.expectedRevision) return null;
    if (this.failNextWriteWith) {
      const err = this.failNextWriteWith;
      this.failNextWriteWith = null;
      throw err;
    }
    const now = this.clock();
    const next: PlanReviewRecord = {
      ...cur,
      status: input.toStatus,
      revision: cur.revision + 1,
      decisionNote: input.patch?.decisionNote !== undefined ? input.patch.decisionNote : cur.decisionNote,
      decidedAt: input.patch?.decidedAt !== undefined ? input.patch.decidedAt : cur.decidedAt,
      updatedAt: now,
    };
    this.requests.set(cur.id, next);
    this.events.push(this.event(cur.id, input.event));
    return { ...next };
  }

  async pendingNotifications(limit: number) {
    return this.events.filter((e) => e.notifyUserId && !e.notifiedAt).slice(0, limit);
  }
  async markNotified(eventId: string, at: Date) {
    const e = this.events.find((x) => x.id === eventId);
    if (e && !e.notifiedAt) e.notifiedAt = at;
  }
}
