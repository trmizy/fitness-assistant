import { createHash, randomUUID } from "node:crypto";
import { logger } from "@gym-coach/shared";
import { ApiError } from "../errors/api-error";
import { enqueueAiTask, type AiTaskName } from "../workers/queue-provider";
import { prisma, conversationRepository } from "../repositories/conversation.repository";
import { admitBillableGeneration } from "./generation-admission";
import { positiveIntEnv } from "../utils/env-int";
import { leaseStorage, registerFencedRunner, StaleLeaseError, type LeaseContext } from "./generation-lease-context";

/**
 * Durable idempotent coordination for paid AI generation (V-T012.2 / V-T012.2.1).
 *
 * Identity: one row per logical request (UNIQUE actor+key). `epoch` is the immutable identity of one CHARGED
 * execution of that request; reopening a FAILED row starts epoch+1 with a new target plan. Queue messages carry
 * {operationId, epoch, planId, kind, actorUserId}; the worker claim refuses any message that does not match the
 * stored canonical execution, so a delayed message from an older execution can never act on a newer one.
 * The user-visible reference is the operationId (stored as Plan.jobId at plan creation); it is NOT the transport
 * message id, so there is no job-id attachment step that can fail.
 *
 * Submit ordering (every step is re-runnable from the durable row):
 *   1 createReserving  unique (actor,key) + reservation token, BEFORE any charge
 *   2 admit quota      ai-expensive; refused => the reservation (matching token) is deleted, nothing is executable
 *   3 markAdmitted     CAS on (epoch, reservation token): stores target plan id + outbox payload
 *   4 ensure plan row  create-if-absent by pre-assigned id, jobId = operationId
 *   5 publish          message carries the execution binding; recordPublish stores the transport id (any status)
 * Quota (DynamoDB/memory) and Postgres cannot commit atomically: a crash between 2 and 3 can lose one allowance
 * unit per attempted admission (fail-closed). A retry of an ADMITTED-or-later execution never charges again.
 */

export type OperationKind = "WORKOUT_PLAN" | "NUTRITION_PLAN" | "PLAN_ADJUSTMENT";
export type OperationStatus = "RESERVING" | "ADMITTED" | "PUBLISHED" | "RUNNING" | "COMPLETED" | "FAILED";

export interface OperationRow {
  id: string;
  actorUserId: string;
  subjectUserId: string | null;
  kind: string;
  idempotencyKey: string;
  fingerprint: string;
  status: OperationStatus;
  epoch: number;
  reservationToken: string | null;
  publishCount: number;
  targetType: string | null;
  targetId: string | null;
  payload: any;
  messageId: string | null;
  attempt: number;
  leaseOwner: string | null;
  leaseExpiresAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Binding carried by every queue message; validated against the stored canonical execution at claim time. */
export interface ExecutionBinding { operationId: string; epoch: number; planId: string; kind: string; actorUserId: string }

export type ClaimResult =
  | { kind: "CLAIMED"; row: OperationRow }
  | { kind: "TERMINAL"; row: OperationRow }
  | { kind: "IN_FLIGHT"; row: OperationRow }
  | { kind: "EXHAUSTED"; row: OperationRow }
  | { kind: "STALE_MESSAGE"; row: OperationRow }
  | { kind: "MISMATCH"; row: OperationRow }
  | { kind: "MISSING" };

export interface RecoveryCutoffs { reservingBefore: Date; admittedBefore: Date; publishedBefore: Date }

/**
 * Every method is ONE atomic conditional write (compare-and-set), or, for runFenced, one short transaction that
 * first takes the operation row lock under the ownership predicate. The Prisma store maps these to
 * create/updateMany/$transaction.
 */
export interface OperationStore {
  createReserving(input: { actorUserId: string; subjectUserId: string | null; kind: string; idempotencyKey: string; fingerprint: string; reservationToken: string; now: Date }): Promise<{ row: OperationRow; created: boolean }>;
  get(id: string): Promise<OperationRow | null>;
  deleteIfReserving(id: string, epoch: number, reservationToken: string): Promise<boolean>;
  /** CAS on (RESERVING, updatedAt unchanged): installs a new reservation token. */
  takeOverReserving(id: string, seenUpdatedAt: Date, newToken: string, now: Date): Promise<boolean>;
  /** FAILED -> RESERVING, epoch+1, clears target/payload/lease/attempt/publishCount. Returns the reopened row. */
  reopenFailed(id: string, newToken: string, fingerprint: string, now: Date): Promise<OperationRow | null>;
  markAdmitted(id: string, epoch: number, reservationToken: string, data: { targetType: string; targetId: string; payload: unknown }, now: Date): Promise<boolean>;
  /** Records the transport id (first writer wins) and moves ADMITTED->PUBLISHED; valid in any post-reservation status. Never counts. */
  recordPublish(id: string, epoch: number, messageId: string, now: Date): Promise<void>;
  /**
   * THE durable publication budget, one contract for every state (ADMITTED initial/retry, PUBLISHED and RUNNING recovery):
   * a compare-and-set on the publish_count the caller observed, valid only while it is below `max`, executed BEFORE the
   * message is sent. Exactly one of several concurrent claimants wins each increment, so the bound holds under
   * concurrency. A claimed attempt is never refunded (an ambiguous queue outcome still counts).
   */
  claimPublish(id: string, epoch: number, expectedCount: number, max: number, now: Date): Promise<boolean>;
  claim(binding: ExecutionBinding, token: string, leaseMs: number, maxAttempts: number, now: Date): Promise<ClaimResult>;
  /** Atomic: take the row lock under the ownership predicate (renewing the lease), then run `fn` in the same transaction. */
  runFenced<T>(ctx: LeaseContext, planId: string, leaseMs: number, now: Date, fn: (db: any) => Promise<T>): Promise<T>;
  renew(ctx: LeaseContext, leaseMs: number, now: Date): Promise<boolean>;
  finish(ctx: LeaseContext, status: "COMPLETED" | "FAILED", error: string | null, now: Date): Promise<boolean>;
  release(ctx: LeaseContext, error: string | null, now: Date): Promise<boolean>;
  /**
   * ATOMIC terminal transition of a stranded execution (ADMITTED/PUBLISHED, or RUNNING with an expired lease), under the
   * operation-row lock: plan COMPLETED -> operation COMPLETED; otherwise the target plan is set FAILED and the operation
   * FAILED in the SAME transaction (both or neither). A failing plan write rolls the operation back, so it stays
   * recoverable. Returns null when the execution is not (or no longer) eligible for this epoch.
   */
  settleStranded(id: string, epoch: number, reason: string, now: Date): Promise<"COMPLETED" | "FAILED" | null>;
  /**
   * Reconciliation of rows left inconsistent by a past partial write: operation FAILED but target plan still
   * QUEUED/PROCESSING. Re-checks under the row lock and fails the plan. Bounded: a repaired row never matches again.
   */
  repairFailedTarget(id: string, epoch: number): Promise<boolean>;
  listInconsistentTerminal(limit: number, since: Date): Promise<Array<{ id: string; epoch: number }>>;
  listRecoverable(cutoffs: RecoveryCutoffs, now: Date, limit: number): Promise<OperationRow[]>;
  /**
   * Durable auto-save intent (R222-04). The intent is derived, not duplicated: a COMPLETED NUTRITION_PLAN operation whose
   * job asked for autoSaveOnComplete and that has no acknowledgement yet. The acknowledgement and the attempt counter live in
   * the operation payload (no schema change).
   * ackAutoSave: idempotent; valid for this epoch while RUNNING (the executing worker) or COMPLETED (recovery).
   */
  ackAutoSave(id: string, epoch: number, now: Date): Promise<boolean>;
  /** Atomic bounded claim of one replay attempt: only while COMPLETED, unacknowledged and attempts < max. */
  claimAutoSaveAttempt(id: string, epoch: number, maxAttempts: number, now: Date): Promise<boolean>;
  listPendingAutoSave(since: Date, maxAttempts: number, limit: number): Promise<OperationRow[]>;
}

const isUniqueViolation = (e: unknown) => (e as { code?: string })?.code === "P2002";

/** NOT VERIFIED against a real database in this environment (no isolated Postgres). Mirrors the in-memory test store. */
export const prismaOperationStore: OperationStore = {
  async createReserving({ actorUserId, subjectUserId, kind, idempotencyKey, fingerprint, reservationToken, now }) {
    try {
      const row = await prisma.aiGenerationOperation.create({
        data: { actorUserId, subjectUserId, kind, idempotencyKey, fingerprint, status: "RESERVING", reservationToken, createdAt: now },
      });
      return { row: row as unknown as OperationRow, created: true };
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const row = await prisma.aiGenerationOperation.findUnique({ where: { actorUserId_idempotencyKey: { actorUserId, idempotencyKey } } });
      if (!row) throw e;
      return { row: row as unknown as OperationRow, created: false };
    }
  },
  async get(id) {
    return (await prisma.aiGenerationOperation.findUnique({ where: { id } })) as unknown as OperationRow | null;
  },
  async deleteIfReserving(id, epoch, reservationToken) {
    const r = await prisma.aiGenerationOperation.deleteMany({ where: { id, epoch, reservationToken, status: "RESERVING" } });
    return r.count === 1;
  },
  async takeOverReserving(id, seenUpdatedAt, newToken, now) {
    const r = await prisma.aiGenerationOperation.updateMany({ where: { id, status: "RESERVING", updatedAt: seenUpdatedAt }, data: { reservationToken: newToken, updatedAt: now } });
    return r.count === 1;
  },
  async reopenFailed(id, newToken, fingerprint, now) {
    const r = await prisma.aiGenerationOperation.updateMany({
      where: { id, status: "FAILED" },
      data: { status: "RESERVING", epoch: { increment: 1 }, reservationToken: newToken, fingerprint, targetType: null, targetId: null, messageId: null, attempt: 0, publishCount: 0, leaseOwner: null, leaseExpiresAt: null, lastError: null, completedAt: null, publishedAt: null, updatedAt: now },
    });
    if (r.count !== 1) return null;
    return (await prisma.aiGenerationOperation.findUnique({ where: { id } })) as unknown as OperationRow | null;
  },
  async markAdmitted(id, epoch, reservationToken, data, now) {
    const r = await prisma.aiGenerationOperation.updateMany({
      where: { id, epoch, reservationToken, status: "RESERVING" },
      data: { status: "ADMITTED", targetType: data.targetType, targetId: data.targetId, payload: data.payload as any, updatedAt: now },
    });
    return r.count === 1;
  },
  async recordPublish(id, epoch, messageId, now) {
    const live = ["ADMITTED", "PUBLISHED", "RUNNING", "COMPLETED"];
    await prisma.aiGenerationOperation.updateMany({ where: { id, epoch, messageId: null, status: { in: live } }, data: { messageId, publishedAt: now } });
    await prisma.aiGenerationOperation.updateMany({ where: { id, epoch, status: "ADMITTED" }, data: { status: "PUBLISHED", updatedAt: now } });
  },
  async claimPublish(id, epoch, expectedCount, max, now) {
    const r = await prisma.aiGenerationOperation.updateMany({
      where: { id, epoch, status: { in: ["ADMITTED", "PUBLISHED", "RUNNING"] }, publishCount: { equals: expectedCount, lt: max } },
      data: { publishCount: { increment: 1 }, updatedAt: now },
    });
    return r.count === 1;
  },
  async claim(b, token, leaseMs, maxAttempts, now) {
    const won = await prisma.aiGenerationOperation.updateMany({
      where: {
        id: b.operationId, epoch: b.epoch, kind: b.kind, actorUserId: b.actorUserId, targetId: b.planId,
        attempt: { lt: maxAttempts },
        OR: [{ status: { in: ["ADMITTED", "PUBLISHED"] } }, { status: "RUNNING", leaseExpiresAt: { lt: now } }],
      },
      data: { status: "RUNNING", leaseOwner: token, leaseExpiresAt: new Date(now.getTime() + leaseMs), attempt: { increment: 1 }, updatedAt: now },
    });
    const row = (await prisma.aiGenerationOperation.findUnique({ where: { id: b.operationId } })) as unknown as OperationRow | null;
    if (!row) return { kind: "MISSING" };
    if (won.count === 1) return { kind: "CLAIMED", row };
    if (row.epoch !== b.epoch) return { kind: "STALE_MESSAGE", row };
    if (row.kind !== b.kind || row.actorUserId !== b.actorUserId || row.targetId !== b.planId) return { kind: "MISMATCH", row };
    if (row.status === "COMPLETED" || row.status === "FAILED") return { kind: "TERMINAL", row };
    const expiredRunning = row.status === "RUNNING" && !!row.leaseExpiresAt && row.leaseExpiresAt < now;
    if (row.attempt >= maxAttempts && (row.status === "ADMITTED" || row.status === "PUBLISHED" || expiredRunning)) {
      return { kind: "EXHAUSTED", row }; // settled atomically with the plan by the caller (settleStranded)
    }
    return { kind: "IN_FLIGHT", row };
  },
  async runFenced(ctx, planId, leaseMs, now, fn) {
    // One short transaction: the UPDATE below takes the row lock under the ownership predicate (including that the plan
    // being written is THIS execution's target) and holds it until commit, so a concurrent claim/takeover/settle of
    // this operation blocks, then re-evaluates its predicate against the renewed lease and loses. Never wrap model
    // inference in `fn`.
    return prisma.$transaction(
      async (tx) => {
        const r = await tx.aiGenerationOperation.updateMany({
          where: { id: ctx.operationId, epoch: ctx.epoch, leaseOwner: ctx.token, status: "RUNNING", targetId: planId, leaseExpiresAt: { gt: now } },
          data: { leaseExpiresAt: new Date(now.getTime() + leaseMs) },
        });
        if (r.count !== 1) throw new StaleLeaseError(ctx.operationId);
        return fn(tx);
      },
      { timeout: 15_000, maxWait: 5_000 },
    );
  },
  async renew(ctx, leaseMs, now) {
    const r = await prisma.aiGenerationOperation.updateMany({
      where: { id: ctx.operationId, epoch: ctx.epoch, leaseOwner: ctx.token, status: "RUNNING", leaseExpiresAt: { gt: now } },
      data: { leaseExpiresAt: new Date(now.getTime() + leaseMs) },
    });
    return r.count === 1;
  },
  async finish(ctx, status, error, now) {
    const r = await prisma.aiGenerationOperation.updateMany({
      where: { id: ctx.operationId, epoch: ctx.epoch, leaseOwner: ctx.token, status: "RUNNING", leaseExpiresAt: { gt: now } },
      data: { status, lastError: error, leaseExpiresAt: null, completedAt: now, updatedAt: now },
    });
    return r.count === 1;
  },
  async release(ctx, error, now) {
    const r = await prisma.aiGenerationOperation.updateMany({
      where: { id: ctx.operationId, epoch: ctx.epoch, leaseOwner: ctx.token, status: "RUNNING" },
      data: { status: "PUBLISHED", leaseOwner: null, leaseExpiresAt: null, lastError: error, updatedAt: now },
    });
    return r.count === 1;
  },
  async settleStranded(id, epoch, reason, now) {
    return prisma.$transaction(
      async (tx) => {
        // SELECT ... FOR UPDATE: the same row lock every fenced worker write and every claim contends on.
        const locked = await tx.$queryRaw<Array<{ status: string; targetType: string | null; targetId: string | null; leaseExpiresAt: Date | null }>>`
          SELECT "status", "target_type" AS "targetType", "target_id" AS "targetId", "lease_expires_at" AS "leaseExpiresAt"
          FROM "ai_generation_operations" WHERE "id" = ${id} AND "epoch" = ${epoch} FOR UPDATE`;
        const op = locked[0];
        if (!op) return null;
        const eligible = op.status === "ADMITTED" || op.status === "PUBLISHED" || (op.status === "RUNNING" && !!op.leaseExpiresAt && op.leaseExpiresAt < now);
        if (!eligible) return null;
        const table = op.targetType === "NUTRITION_PLAN" ? tx.nutritionPlan : tx.workoutPlan;
        const plan = op.targetId ? await (table as any).findUnique({ where: { id: op.targetId }, select: { status: true } }) : null;
        const done = { leaseOwner: null, leaseExpiresAt: null, completedAt: now, updatedAt: now };
        if (plan?.status === "COMPLETED") {
          await tx.aiGenerationOperation.update({ where: { id }, data: { status: "COMPLETED", lastError: null, ...done } });
          return "COMPLETED" as const;
        }
        if (plan) {
          const r = await (table as any).updateMany({ where: { id: op.targetId, status: { not: "COMPLETED" } }, data: { status: "FAILED", failReason: reason } });
          if (r.count !== 1) throw new Error(`settleStranded: plan transition affected ${r.count} rows`); // rolls back the whole transaction
        }
        await tx.aiGenerationOperation.update({ where: { id }, data: { status: "FAILED", lastError: plan ? reason : "target plan missing", ...done } });
        return "FAILED" as const;
      },
      { timeout: 15_000, maxWait: 5_000 },
    );
  },
  async repairFailedTarget(id, epoch) {
    return prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ status: string; targetType: string | null; targetId: string | null; lastError: string | null }>>`
        SELECT "status", "target_type" AS "targetType", "target_id" AS "targetId", "last_error" AS "lastError"
        FROM "ai_generation_operations" WHERE "id" = ${id} AND "epoch" = ${epoch} FOR UPDATE`;
      const op = locked[0];
      if (!op || op.status !== "FAILED" || !op.targetId) return false;
      const table = op.targetType === "NUTRITION_PLAN" ? tx.nutritionPlan : tx.workoutPlan;
      const r = await (table as any).updateMany({ where: { id: op.targetId, status: { in: ["QUEUED", "PROCESSING"] } }, data: { status: "FAILED", failReason: op.lastError ?? "generation failed" } });
      return r.count === 1;
    });
  },
  async listInconsistentTerminal(limit, since) {
    return prisma.$queryRaw<Array<{ id: string; epoch: number }>>`
      SELECT o."id", o."epoch" FROM "ai_generation_operations" o
      LEFT JOIN "workout_plans" w ON o."target_type" = 'WORKOUT_PLAN' AND w."id" = o."target_id"
      LEFT JOIN "nutrition_plans" n ON o."target_type" = 'NUTRITION_PLAN' AND n."id" = o."target_id"
      WHERE o."status" = 'FAILED' AND o."completed_at" > ${since}
        AND (w."status" IN ('QUEUED','PROCESSING') OR n."status" IN ('QUEUED','PROCESSING'))
      ORDER BY o."completed_at" ASC LIMIT ${limit}`;
  },
  async ackAutoSave(id, epoch, now) {
    const n = await prisma.$executeRaw`
      UPDATE "ai_generation_operations"
      SET "payload" = jsonb_set(COALESCE("payload", '{}'::jsonb), '{autoSaveAckedAt}', to_jsonb(${now.toISOString()}::text))
      WHERE "id" = ${id} AND "epoch" = ${epoch} AND "status" IN ('RUNNING','COMPLETED')
        AND "kind" = 'NUTRITION_PLAN' AND "payload"->>'autoSaveAckedAt' IS NULL`;
    return n === 1;
  },
  async claimAutoSaveAttempt(id, epoch, maxAttempts, now) {
    const n = await prisma.$executeRaw`
      UPDATE "ai_generation_operations"
      SET "payload" = jsonb_set(COALESCE("payload", '{}'::jsonb), '{autoSaveAttempts}',
                                to_jsonb(COALESCE(("payload"->>'autoSaveAttempts')::int, 0) + 1)),
          "updated_at" = ${now}
      WHERE "id" = ${id} AND "epoch" = ${epoch} AND "status" = 'COMPLETED' AND "kind" = 'NUTRITION_PLAN'
        AND "payload"->'job'->>'autoSaveOnComplete' = 'true'
        AND "payload"->>'autoSaveAckedAt' IS NULL
        AND COALESCE(("payload"->>'autoSaveAttempts')::int, 0) < ${maxAttempts}`;
    return n === 1;
  },
  async listPendingAutoSave(since, maxAttempts, limit) {
    return prisma.$queryRaw<OperationRow[]>`
      SELECT "id", "actor_user_id" AS "actorUserId", "epoch", "target_id" AS "targetId",
             "completed_at" AS "completedAt", "updated_at" AS "updatedAt", "status", "kind"
      FROM "ai_generation_operations"
      WHERE "status" = 'COMPLETED' AND "kind" = 'NUTRITION_PLAN'
        AND "payload"->'job'->>'autoSaveOnComplete' = 'true'
        AND "payload"->>'autoSaveAckedAt' IS NULL
        AND COALESCE(("payload"->>'autoSaveAttempts')::int, 0) < ${maxAttempts}
        AND "completed_at" > ${since}
      ORDER BY "completed_at" ASC LIMIT ${limit}`;
  },
  async listRecoverable(c, now, limit) {
    return (await prisma.aiGenerationOperation.findMany({
      where: {
        OR: [
          { status: "RESERVING", updatedAt: { lt: c.reservingBefore } },
          { status: "ADMITTED", updatedAt: { lt: c.admittedBefore } },
          { status: "PUBLISHED", updatedAt: { lt: c.publishedBefore } },
          { status: "RUNNING", leaseExpiresAt: { lt: now } },
        ],
      },
      orderBy: { updatedAt: "asc" },
      take: limit,
    })) as unknown as OperationRow[];
  },
};

const intEnv = (name: string, fallback: number, opts: { allowZero?: boolean } = {}) => positiveIntEnv(name, fallback, opts);

/** Dependency seam: tests inject an in-memory OperationStore, a fake clock and a fake publisher. */
export const generationOpsDeps = {
  store: prismaOperationStore as OperationStore,
  now: () => new Date(),
  enqueue: enqueueAiTask as (name: AiTaskName, data: Record<string, unknown>, opts?: { jobId?: string }) => Promise<{ id?: string }>,
  admit: admitBillableGeneration as (verifiedUserId: string) => Promise<void>,
  leaseMs: () => intEnv("AI_GENERATION_LEASE_SECONDS", 900) * 1000,
  maxAttempts: () => intEnv("AI_GENERATION_MAX_ATTEMPTS", 3),
  maxPublishes: () => intEnv("AI_GENERATION_MAX_PUBLISHES", 3),
  reservingTimeoutMs: () => intEnv("AI_GENERATION_RESERVING_TIMEOUT_SECONDS", 60) * 1000,
  admittedStaleMs: () => intEnv("AI_GENERATION_ADMITTED_STALE_SECONDS", 60) * 1000,
  publishedStaleMs: () => intEnv("AI_GENERATION_PUBLISHED_STALE_SECONDS", 900) * 1000,
  /** Replays a missed auto-save of a COMPLETED nutrition execution; true = saved/acknowledged downstream (idempotent). */
  autoSave: (async (op: OperationRow) => {
    const { replayCompletedNutritionAutoSave } = await import("./nutrition.processor"); // lazy: the processor imports this module
    return replayCompletedNutritionAutoSave(op);
  }) as (op: OperationRow) => Promise<boolean>,
  autoSaveMaxAttempts: () => intEnv("AI_AUTOSAVE_MAX_ATTEMPTS", 5, { allowZero: true }),
  autoSaveWindowMs: () => intEnv("AI_AUTOSAVE_REPLAY_WINDOW_HOURS", 72) * 3600_000,
  /** Minimum wait since the previous claimed attempt before another publication attempt (exponential, capped at 5 min). */
  publishBackoffMs: (attemptsSoFar: number) => (attemptsSoFar <= 0 ? 0 : Math.min(5_000 * 2 ** (attemptsSoFar - 1), 300_000)),
};

export class OperationInFlightError extends Error {
  constructor(operationId: string) {
    super(`Generation operation ${operationId} is being processed by another attempt`);
    this.name = "OperationInFlightError";
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
export const fingerprintOf = (input: unknown) => createHash("sha256").update(canonical(input)).digest("hex");

const TASK_BY_KIND: Record<OperationKind, AiTaskName> = {
  WORKOUT_PLAN: "generate-plan",
  PLAN_ADJUSTMENT: "generate-plan",
  NUTRITION_PLAN: "generate-nutrition-plan",
};

export interface SubmitGenerationInput {
  /** Verified authenticated actor (quota owner). Never taken from a request body. */
  actorUserId: string;
  /** Resource owner when different from the actor (e.g. a PT acting for a client); fingerprinted and stored. */
  subjectUserId?: string | null;
  kind: OperationKind;
  /** Stable identity of the logical request; the same key by the same actor is the same operation. */
  idempotencyKey: string;
  /** Plan-row creation arguments (kind-specific, JSON-serialisable; stored for crash recovery). */
  planCreate: Record<string, unknown>;
  /** Job data WITHOUT planId/operationId/epoch (added at publication). */
  job: Record<string, unknown>;
}
/** `jobId` is the stable operation reference (== Plan.jobId), never a transport message id. */
export interface SubmitGenerationResult { operationId: string; planId: string; jobId: string; epoch: number; reused: boolean }

async function ensurePlanRow(row: OperationRow): Promise<void> {
  const planId = row.targetId!;
  const create = row.payload?.planCreate ?? {};
  if (row.kind === "NUTRITION_PLAN") {
    const existing = await conversationRepository.findNutritionPlanById(planId);
    if (existing) {
      if (!(existing as any).jobId) await conversationRepository.updateNutritionPlanJob(planId, row.id);
      return;
    }
    try { await conversationRepository.createNutritionPlan({ ...(create as any), id: planId, jobId: row.id }); } catch (e) { if (!isUniqueViolation(e)) throw e; }
    return;
  }
  const existing = await conversationRepository.findPlanById(planId);
  if (existing) {
    if (!(existing as any).jobId) await conversationRepository.updatePlanJob(planId, row.id);
    return;
  }
  try {
    if (row.kind === "PLAN_ADJUSTMENT") await conversationRepository.createAdjustedPlan({ ...(create as any), id: planId, jobId: row.id });
    else await conversationRepository.createWorkoutPlan({ ...(create as any), id: planId, jobId: row.id });
  } catch (e) { if (!isUniqueViolation(e)) throw e; }
}

function bindingOf(row: OperationRow): ExecutionBinding {
  return { operationId: row.id, epoch: row.epoch, planId: row.targetId!, kind: row.kind, actorUserId: row.actorUserId };
}

/**
 * BullMQ custom job id for one execution. BullMQ 5.66.5 rejects ':' (and pure integers) in custom ids; a UUID operation
 * id plus "-e<epoch>" is accepted, deterministic across retries, distinct per epoch and unambiguous (a UUID has a fixed
 * length, so "<uuid>-e<n>" cannot collide with another operation). Only a transport detail: status never parses it.
 */
export const transportJobId = (operationId: string, epoch: number) => `${operationId}-e${epoch}`;

async function publish(row: OperationRow): Promise<string> {
  const d = generationOpsDeps;
  try {
    const msg = await d.enqueue(
      TASK_BY_KIND[row.kind as OperationKind],
      { ...(row.payload?.job ?? {}), ...bindingOf(row) },
      { jobId: transportJobId(row.id, row.epoch) },
    );
    return String(msg.id);
  } catch (err) {
    logger.error({ err: (err as Error).message, operationId: row.id, epoch: row.epoch }, "[generation] publish failed; operation stays recoverable");
    throw new ApiError("SERVICE_UNAVAILABLE", "Plan generation could not be queued right now. Retry the same request shortly.", 503);
  }
}

/** Runs the remaining steps for an execution, or reports an already-advanced one. Safe to call repeatedly. */
async function advance(row: OperationRow, reused: boolean): Promise<SubmitGenerationResult> {
  const d = generationOpsDeps;
  const result = (): SubmitGenerationResult => ({ operationId: row.id, planId: row.targetId!, jobId: row.id, epoch: row.epoch, reused });
  if (row.status === "RESERVING" || row.status === "FAILED") return result();
  // Plan row + stable reference are (re)asserted in every advanced state: idempotent and cheap.
  await ensurePlanRow(row).catch((err) => { if (row.status === "ADMITTED") throw err; logger.warn({ err: (err as Error).message, operationId: row.id }, "[generation] plan reference repair failed"); });
  if (row.status !== "ADMITTED") return result();
  // Budget first, then send: every attempt (initial, retry after a failed or ambiguous send, recovery) is counted durably
  // BEFORE the external call and never refunded.
  const attempt = await claimAndPublish(row, "ADMITTED");
  if (attempt === "ADVANCED") {
    const fresh = await d.store.get(row.id);
    if (fresh) return { operationId: fresh.id, planId: fresh.targetId!, jobId: fresh.id, epoch: fresh.epoch, reused };
  }
  return result();
}

/**
 * Claims one publication attempt atomically, then publishes. Returns "PUBLISHED" after a send, "ADVANCED" when another
 * runner won the claim or the row moved on, or throws 503 when the attempt is backed off or the budget is exhausted
 * (an exhausted ADMITTED/PUBLISHED execution is settled FAILED together with its plan: recoverable by retrying the same
 * request, which starts a new charged epoch, or by an explicit new request).
 */
async function claimAndPublish(row: OperationRow, from: "ADMITTED" | "PUBLISHED" | "RUNNING"): Promise<"PUBLISHED" | "ADVANCED"> {
  const d = generationOpsDeps;
  const now = d.now();
  if (row.publishCount >= d.maxPublishes()) {
    await d.store.settleStranded(row.id, row.epoch, "publication budget exhausted", now);
    throw new ApiError("SERVICE_UNAVAILABLE", "Plan generation could not be queued. Please send the request again.", 503);
  }
  if (row.publishCount > 0 && now.getTime() - row.updatedAt.getTime() < d.publishBackoffMs(row.publishCount)) {
    throw new ApiError("SERVICE_UNAVAILABLE", "Plan generation could not be queued right now. Retry the same request shortly.", 503);
  }
  if (!(await d.store.claimPublish(row.id, row.epoch, row.publishCount, d.maxPublishes(), now))) return "ADVANCED";
  const messageId = await publish(row);
  try { await d.store.recordPublish(row.id, row.epoch, messageId, d.now()); } catch (err) { logger.warn({ err: (err as Error).message, operationId: row.id, from }, "[generation] recordPublish failed; a duplicate publish is absorbed by the worker claim"); }
  return "PUBLISHED";
}

async function resolveExisting(id: string, fingerprint: string): Promise<SubmitGenerationResult> {
  const row = await generationOpsDeps.store.get(id);
  if (!row) throw new ApiError("OPERATION_IN_PROGRESS", "The same request is already being processed.", 409);
  if (row.fingerprint !== fingerprint) throw new ApiError("IDEMPOTENCY_KEY_CONFLICT", "This idempotency key was already used with different input.", 409);
  if (row.status === "RESERVING" || row.status === "FAILED") throw new ApiError("OPERATION_IN_PROGRESS", "The same request is already being processed.", 409);
  return advance(row, true);
}

export async function submitGeneration(input: SubmitGenerationInput): Promise<SubmitGenerationResult> {
  const d = generationOpsDeps;
  const fingerprint = fingerprintOf({ kind: input.kind, subject: input.subjectUserId ?? null, planCreate: input.planCreate, job: input.job });
  let token = randomUUID();
  const created0 = await d.store.createReserving({
    actorUserId: input.actorUserId, subjectUserId: input.subjectUserId ?? null, kind: input.kind,
    idempotencyKey: input.idempotencyKey, fingerprint, reservationToken: token, now: d.now(),
  });
  let row = created0.row;

  if (!created0.created) {
    // The key is bound immutably to the ORIGINAL actor (row lookup is per actor), kind, subject and payload fingerprint, and
    // that is checked in EVERY state, FAILED included, before any reopen decision. A changed intent needs a new key.
    if (row.fingerprint !== fingerprint || row.kind !== input.kind || (row.subjectUserId ?? null) !== (input.subjectUserId ?? null)) {
      throw new ApiError("IDEMPOTENCY_KEY_CONFLICT", "This idempotency key was already used with different input.", 409);
    }
    if (row.status === "FAILED") {
      // A failed execution retried under the SAME key AND SAME payload is a NEW charged execution (documented policy, not
      // exactly-once billing): epoch+1 and a fresh target; kind/subject/ownership stay as originally bound. Any delayed
      // message of the old epoch is refused at claim time.
      const reopened = await d.store.reopenFailed(row.id, token, fingerprint, d.now());
      if (!reopened) return resolveExisting(row.id, fingerprint);
      row = reopened;
    } else if (row.status === "RESERVING") {
      const age = d.now().getTime() - row.updatedAt.getTime();
      if (age < d.reservingTimeoutMs()) throw new ApiError("OPERATION_IN_PROGRESS", "The same request is already being processed.", 409);
      if (!(await d.store.takeOverReserving(row.id, row.updatedAt, token, d.now()))) return resolveExisting(row.id, fingerprint);
    } else {
      return advance(row, true);
    }
  }

  try {
    await d.admit(input.actorUserId);
  } catch (err) {
    await d.store.deleteIfReserving(row.id, row.epoch, token).catch(() => undefined);
    throw err;
  }
  const planId = randomUUID();
  const ok = await d.store.markAdmitted(
    row.id, row.epoch, token,
    { targetType: input.kind === "NUTRITION_PLAN" ? "NUTRITION_PLAN" : "WORKOUT_PLAN", targetId: planId, payload: { planCreate: input.planCreate, job: input.job } },
    d.now(),
  );
  if (!ok) return resolveExisting(row.id, fingerprint); // lost the reservation to a takeover: never act on a successor's row
  return advance((await d.store.get(row.id))!, false);
}

// ── Recovery ───────────────────────────────────────────────────────────────

async function planStatusOf(row: OperationRow): Promise<string | null> {
  if (!row.targetId) return null;
  const plan = row.targetType === "NUTRITION_PLAN"
    ? await conversationRepository.findNutritionPlanById(row.targetId)
    : await conversationRepository.findPlanById(row.targetId);
  return plan ? String((plan as any).status) : null;
}

export interface RecoverySummary { reservationsCleared: number; republished: number; completedOrphans: number; failed: number; reconciled: number; autoSaved: number; errors: number }

/**
 * Bounded, idempotent recovery of stranded executions. Safe to run concurrently with live traffic and with itself:
 * every action is a compare-and-set on (operation, epoch, status/lease). Rules:
 *   RESERVING stale          -> delete (token CAS); never charged past this point, nothing executable existed
 *   ADMITTED stale           -> ensure plan + republish the SAME execution
 *   PUBLISHED stale / RUNNING lease expired:
 *       plan COMPLETED       -> finalize operation COMPLETED without any model call
 *       publishes < max      -> republish the SAME execution (the claim dedupes duplicates)
 *       otherwise            -> operation FAILED and the plan marked FAILED (observable)
 * Wire it to a scheduler (jobs-lambda "ai-generation-recovery"); no schedule is created by this change.
 */
export async function recoverPendingGenerations(opts: { limit?: number } = {}): Promise<RecoverySummary> {
  const d = generationOpsDeps;
  const now = d.now();
  const rows = await d.store.listRecoverable(
    { reservingBefore: new Date(now.getTime() - d.reservingTimeoutMs() * 5), admittedBefore: new Date(now.getTime() - d.admittedStaleMs()), publishedBefore: new Date(now.getTime() - d.publishedStaleMs()) },
    now,
    opts.limit ?? 25,
  );
  const s: RecoverySummary = { reservationsCleared: 0, republished: 0, completedOrphans: 0, failed: 0, reconciled: 0, autoSaved: 0, errors: 0 };
  for (const row of rows) {
    try {
      if (row.status === "RESERVING") {
        if (row.reservationToken && (await d.store.deleteIfReserving(row.id, row.epoch, row.reservationToken))) s.reservationsCleared++;
      } else if (row.status === "ADMITTED") {
        await advance(row, true);
        // count only a publication THIS runner actually made (a lost claim publishes nothing)
        if (((await d.store.get(row.id))?.publishCount ?? row.publishCount) > row.publishCount) s.republished++;
      } else if (row.status === "PUBLISHED" || row.status === "RUNNING") {
        const finished = (await planStatusOf(row)) === "COMPLETED";
        if (!finished && row.attempt < d.maxAttempts() && row.publishCount < d.maxPublishes()) {
          // Strict bound: the publication budget is claimed atomically BEFORE sending, so concurrent runners cannot exceed it.
          if ((await claimAndPublish(row, row.status)) === "PUBLISHED") s.republished++;
        } else {
          const outcome = await d.store.settleStranded(row.id, row.epoch, finished ? "finalized" : "recovery exhausted", now);
          if (outcome === "COMPLETED") s.completedOrphans++;
          else if (outcome === "FAILED") s.failed++;
        }
      }
    } catch (err) {
      // An exhausted publication budget settles the row FAILED and then raises 503: that is a terminal outcome, not a step error.
      if ((err as { statusCode?: number })?.statusCode === 503 && (await d.store.get(row.id).catch(() => null))?.status === "FAILED") {
        s.failed++;
        continue;
      }
      s.errors++;
      logger.warn({ err: (err as Error).message, operationId: row.id }, "[generation] recovery step failed; will be retried on the next run");
    }
  }
  // Durable auto-save intent (R222-04): COMPLETED nutrition executions whose bootstrap save was never acknowledged (worker died or
  // lost its lease between plan completion and the save, or fitness-service was unavailable). Bounded by an attempt counter
  // claimed atomically before the call, a replay window and the batch limit; the downstream save is idempotent.
  try {
    const pending = await d.store.listPendingAutoSave(new Date(now.getTime() - d.autoSaveWindowMs()), d.autoSaveMaxAttempts(), opts.limit ?? 25);
    for (const row of pending) {
      try {
        if (!(await d.store.claimAutoSaveAttempt(row.id, row.epoch, d.autoSaveMaxAttempts(), d.now()))) continue;
        if (await d.autoSave(row)) {
          await d.store.ackAutoSave(row.id, row.epoch, d.now());
          s.autoSaved++;
        }
      } catch (err) {
        s.errors++;
        logger.warn({ err: (err as Error).message, operationId: row.id }, "[generation] auto-save replay failed; retried on a later run (bounded)");
      }
    }
  } catch (err) {
    s.errors++;
    logger.warn({ err: (err as Error).message }, "[generation] auto-save replay scan failed");
  }
  // Reconcile terminal rows a past partial write left inconsistent (operation FAILED, plan still active). Bounded by a
  // 30-day window and by construction: a repaired row no longer matches.
  try {
    const bad = await d.store.listInconsistentTerminal(opts.limit ?? 25, new Date(now.getTime() - 30 * 24 * 3600_000));
    for (const b of bad) {
      try { if (await d.store.repairFailedTarget(b.id, b.epoch)) s.reconciled++; } catch (err) { s.errors++; logger.warn({ err: (err as Error).message, operationId: b.id }, "[generation] terminal reconciliation failed; retried next run"); }
    }
  } catch (err) {
    s.errors++;
    logger.warn({ err: (err as Error).message }, "[generation] terminal reconciliation scan failed");
  }
  return s;
}

// ── Worker side ─────────────────────────────────────────────────────────────

registerFencedRunner(
  (ctx, planId, fn) => generationOpsDeps.store.runFenced(ctx, planId, generationOpsDeps.leaseMs(), generationOpsDeps.now(), fn),
  (ctx: LeaseContext) => generationOpsDeps.store.renew(ctx, generationOpsDeps.leaseMs(), generationOpsDeps.now()),
);

function bindingFromJob(data: any): ExecutionBinding | null {
  if (!data?.operationId || typeof data.epoch !== "number" || !data.planId || !data.kind || !data.actorUserId) return null;
  return { operationId: data.operationId, epoch: data.epoch, planId: data.planId, kind: data.kind, actorUserId: data.actorUserId };
}

/**
 * Wraps a queue processor.
 *  - Messages with no operationId are pre-change (legacy) messages: they run unwrapped, which is safe because their
 *    plan rows are never targets of an operation. Set AI_GENERATION_REQUIRE_OPERATION=true once the queue is
 *    drained to reject them instead (cutoff).
 *  - Messages with an operationId must carry the full execution binding and match the stored canonical execution.
 *  - Atomic claim before any model call; finished executions are acknowledged without work; a live lease is a
 *    retryable error; a plan already COMPLETED short-circuits to finalization (crash-after-complete recovery).
 *  - Plan writes made inside `run` are fenced atomically (generation-lease-context.runFenced).
 */
export async function withGenerationOperation(job: { id?: string; data: any }, run: () => Promise<void>): Promise<void> {
  const operationId: string | undefined = job.data?.operationId;
  if (!operationId) {
    if (process.env.AI_GENERATION_REQUIRE_OPERATION === "true") throw new Error("Generation message without operationId rejected (AI_GENERATION_REQUIRE_OPERATION=true)");
    return run();
  }
  // processAiTaskJob delegates nutrition jobs to processNutritionPlanJob; both are wrapped, only the outer claims.
  if (leaseStorage.getStore()?.operationId === operationId) return run();
  const binding = bindingFromJob(job.data);
  if (!binding) {
    logger.error({ operationId }, "[generation] message has an operationId but an incomplete execution binding; refused");
    return;
  }
  const d = generationOpsDeps;
  const token = randomUUID();
  const claim = await d.store.claim(binding, token, d.leaseMs(), d.maxAttempts(), d.now());
  switch (claim.kind) {
    case "MISSING":
      throw new Error(`Unknown generation operation ${operationId}`);
    case "STALE_MESSAGE":
      logger.warn({ operationId, messageEpoch: binding.epoch, currentEpoch: claim.row.epoch }, "[generation] message of an older execution acknowledged without effect");
      return;
    case "MISMATCH":
      logger.error({ operationId }, "[generation] message does not match the stored execution (actor/kind/target); refused");
      return;
    case "TERMINAL":
      logger.info({ operationId, status: claim.row.status }, "[generation] redelivery of a finished execution acknowledged without regenerating");
      return;
    case "IN_FLIGHT":
      throw new OperationInFlightError(operationId);
    case "EXHAUSTED":
      {
        const outcome = await d.store.settleStranded(claim.row.id, claim.row.epoch, "max attempts exhausted", d.now());
        logger.error({ operationId, outcome }, "[generation] attempts exhausted; execution settled atomically with its plan");
      }
      return;
    case "CLAIMED":
      break;
  }
  const row = claim.row;
  const ctx: LeaseContext = { operationId, epoch: row.epoch, token, targetId: row.targetId! };
  await leaseStorage.run(ctx, async () => {
    try {
      if ((await planStatusOf(row)) !== "COMPLETED") await run();
    } catch (err) {
      if (err instanceof StaleLeaseError) {
        logger.warn({ operationId }, "[generation] stale attempt abandoned; a newer claim owns this execution");
        return;
      }
      await d.store.release(ctx, (err as Error).message?.slice(0, 500) ?? "error", d.now()).catch(() => undefined);
      throw err;
    }
    const status = await planStatusOf(row);
    const outcome = status === "COMPLETED" ? "COMPLETED" : "FAILED";
    const finished = await d.store.finish(ctx, outcome, outcome === "FAILED" ? "plan finished FAILED" : null, d.now());
    if (!finished) logger.warn({ operationId }, "[generation] finish refused; lease no longer held");
  });
}

/** Records, for the execution the current worker holds, that its bootstrap auto-save reached fitness-service. Best effort. */
export async function acknowledgeAutoSave(): Promise<void> {
  const ctx = leaseStorage.getStore();
  if (!ctx) return; // legacy/unwrapped execution: no operation to record against
  const d = generationOpsDeps;
  await d.store.ackAutoSave(ctx.operationId, ctx.epoch, d.now()).catch((err) => {
    logger.warn({ err: (err as Error).message, operationId: ctx.operationId }, "[generation] auto-save acknowledgement not recorded; recovery will replay idempotently");
  });
}

// ── Canonical job status (public polling) ────────────────────────────────────

/** Seam: live BullMQ state for a transport job id (never touched when QUEUE_PROVIDER=sqs). */
export const jobStatusDeps = {
  bullState: async (transportId: string): Promise<{ state: string; failedReason?: string } | null> => {
    const { aiQueue } = await import("../workers/ai.queue");
    const job = await aiQueue.getJob(transportId);
    if (!job) return null;
    return { state: await job.getState(), failedReason: job.failedReason };
  },
};

export type JobStatusResult = { kind: "NOT_OPERATION" } | { kind: "FORBIDDEN" } | { kind: "OK"; body: Record<string, unknown> };

/**
 * Resolves a public job reference as an OPERATION id (the value returned as `jobId` by every generation command, also stored
 * as Plan.jobId). Identity comes from the verified caller + the stored operation: ownership is the operation's verified
 * actor, the target comes from the operation's own (targetType, targetId) for its CURRENT epoch (never guessed from plan
 * timestamps), and BullMQ enrichment uses the deterministic transport id derived from (operationId, epoch), never the
 * other way round. Works for workout and nutrition. Returns NOT_OPERATION for ids that are not operations so the legacy
 * Plan.jobId / BullMQ lookup keeps serving pre-operation jobs unchanged.
 */
export async function describeOperationJob(userId: string, jobId: string): Promise<JobStatusResult> {
  const d = generationOpsDeps;
  const op = await d.store.get(jobId).catch(() => null);
  if (!op) return { kind: "NOT_OPERATION" };
  if (op.actorUserId !== userId) return { kind: "FORBIDDEN" };

  const plan: any = op.targetId
    ? await (op.targetType === "NUTRITION_PLAN" ? conversationRepository.findNutritionPlanById(op.targetId) : conversationRepository.findPlanById(op.targetId))
    : null;
  let status: string;
  let failReason: string | null = null;
  if (!plan) {
    const terminal = op.status === "COMPLETED" || op.status === "FAILED";
    status = terminal ? "FAILED" : "QUEUED";
    failReason = terminal ? "plan record missing" : null;
  } else {
    status = String(plan.status);
    failReason = plan.failReason ?? null;
    // operation terminal FAILED while the plan row still reads active: report the truth (reconciliation will repair the row)
    if (op.status === "FAILED" && (status === "QUEUED" || status === "PROCESSING")) {
      status = "FAILED";
      failReason = op.lastError ?? "generation failed";
    }
  }
  if ((status === "QUEUED" || status === "PROCESSING") && process.env.QUEUE_PROVIDER !== "sqs" && op.status !== "RESERVING") {
    const bull = await jobStatusDeps.bullState(transportJobId(op.id, op.epoch)).catch(() => null);
    if (bull?.state === "failed") {
      status = "FAILED";
      failReason = bull.failedReason || failReason || "AI plan generation job failed before completion";
    }
  }
  return {
    kind: "OK",
    body: {
      jobId: op.id,
      planId: plan?.id ?? op.targetId ?? null,
      status,
      plan: plan && plan.status === "COMPLETED" ? plan.plan : null,
      failReason,
      createdAt: plan?.createdAt ?? op.createdAt ?? null,
      updatedAt: plan?.updatedAt ?? op.updatedAt ?? null,
      operationId: op.id,
      epoch: op.epoch,
      kind: op.targetType === "NUTRITION_PLAN" ? "NUTRITION_PLAN" : "WORKOUT_PLAN",
    },
  };
}
