import type { PlanReviewActorRole, PlanReviewStatusValue } from "./plan-review.engine";

export interface PlanReviewRecord {
  id: string;
  clientUserId: string;
  ptUserId: string;
  subjectType: string;
  subjectId: string;
  subjectVersion: number;
  contentHash: string;
  sourcePlanId: string | null;
  aiPlanVersion: number | null;
  snapshot: unknown;
  status: PlanReviewStatusValue;
  revision: number;
  idempotencyKey: string | null;
  clientNote: string | null;
  decisionNote: string | null;
  decidedAt: Date | null;
  submittedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewPlanReviewEvent {
  type: string;
  actorUserId: string | null;
  actorRole: PlanReviewActorRole;
  fromStatus: PlanReviewStatusValue | null;
  toStatus: PlanReviewStatusValue;
  contentHash: string;
  note?: string | null;
  metadata?: Record<string, unknown> | null;
  /** Set => a pending at-least-once notification (outbox) for this user. */
  notifyUserId?: string | null;
}

export interface PlanReviewEventRecord extends NewPlanReviewEvent {
  id: string;
  requestId: string;
  notifiedAt: Date | null;
  createdAt: Date;
}

export interface NewPlanReview {
  clientUserId: string;
  ptUserId: string;
  subjectId: string;
  subjectVersion: number;
  contentHash: string;
  sourcePlanId: string | null;
  aiPlanVersion: number | null;
  snapshot: unknown;
  idempotencyKey: string | null;
  clientNote: string | null;
}

/** Thrown by a repository when a uniqueness guarantee (one open request per plan / idempotency key) rejects a write. */
export class PlanReviewUniqueViolation extends Error {
  constructor(public readonly target: "OPEN_PER_SUBJECT" | "IDEMPOTENCY_KEY") {
    super(`plan review unique violation: ${target}`);
  }
}

/** Thrown by a repository when the reviewed subject's version moved while a decision was being committed. Nothing is written. */
export class PlanReviewSubjectChanged extends Error {
  constructor() {
    super("plan review subject changed since the request was submitted");
  }
}

export interface TransitionInput {
  id: string;
  /**
   * Atomic approval guard: inside the SAME transaction the subject row is locked (SELECT … FOR SHARE) and its version must still
   * equal `version`; otherwise PlanReviewSubjectChanged is thrown and nothing is written. A concurrent plan edit either commits
   * first (=> guard fails) or waits for this decision to commit (=> the approval is then correctly read as outdated).
   */
  subjectGuard?: { subjectId: string; version: number };
  /** The write only applies while the row is in one of these statuses… */
  fromStatuses: readonly PlanReviewStatusValue[];
  /** …and, when given, still at exactly this revision (optimistic concurrency). */
  expectedRevision?: number;
  toStatus: PlanReviewStatusValue;
  patch?: { decisionNote?: string | null; decidedAt?: Date | null };
  event: NewPlanReviewEvent;
}

/**
 * Persistence port. Every mutating method is ATOMIC (one DB transaction): the state change and its audit event are never
 * written separately, and a conditional write that loses a race returns null instead of overwriting the winner.
 */
export interface PlanReviewRepository {
  findById(id: string): Promise<PlanReviewRecord | null>;
  findByIdempotencyKey(clientUserId: string, key: string): Promise<PlanReviewRecord | null>;
  findOpenForSubject(clientUserId: string, subjectType: string, subjectId: string): Promise<PlanReviewRecord | null>;
  listByClient(clientUserId: string, opts?: { subjectId?: string }): Promise<PlanReviewRecord[]>;
  listByPt(ptUserId: string, opts?: { statuses?: readonly PlanReviewStatusValue[] }): Promise<PlanReviewRecord[]>;
  listEvents(requestId: string): Promise<PlanReviewEventRecord[]>;
  /** Creates the request + its SUBMITTED event; optionally supersedes an older open request in the SAME transaction. */
  createSubmission(input: {
    data: NewPlanReview;
    submittedEvent: NewPlanReviewEvent;
    supersede?: { id: string; expectedRevision: number; event: NewPlanReviewEvent };
  }): Promise<PlanReviewRecord>;
  /** Conditional state change + audit event. Returns null when the row is no longer in `fromStatuses` / at `expectedRevision`. */
  transition(input: TransitionInput): Promise<PlanReviewRecord | null>;
  pendingNotifications(limit: number): Promise<PlanReviewEventRecord[]>;
  markNotified(eventId: string, at: Date): Promise<void>;
}
