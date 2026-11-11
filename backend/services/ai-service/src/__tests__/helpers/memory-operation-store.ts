import { StaleLeaseError } from "../../services/generation-lease-context";
import type { ClaimResult, ExecutionBinding, OperationRow, OperationStore, RecoveryCutoffs } from "../../services/generation-operations";

/**
 * TEST FIXTURE ONLY. Mirrors prismaOperationStore's compare-and-set semantics. Every conditional write is a
 * synchronous (hence atomic) map mutation, and operations that in Postgres take the operation ROW LOCK
 * (claim/finish/release/completeOrphan/failOrphan and runFenced) serialize on a per-operation async mutex, which
 * is how `UPDATE ... WHERE` blocks behind a transaction that holds the row lock. Passing tests against this prove
 * the ALGORITHM; they say nothing about Postgres itself (unique-index races, lock behaviour, updateMany counts),
 * which is NOT_VERIFIED here (no isolated database).
 */
export function createMemoryOperationStore(opts: { db?: any } = {}) {
  const rows = new Map<string, OperationRow>();
  let seq = 0;
  const hooks = { failNextRecordPublish: false };
  const locks = new Map<string, Promise<void>>();

  async function withLock<T>(id: string, fn: () => Promise<T> | T): Promise<T> {
    const prev = locks.get(id) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    locks.set(id, prev.then(() => mine));
    await prev;
    try { return await fn(); } finally { release(); }
  }

  const ownerOk = (r: OperationRow | undefined, ctx: { operationId: string; epoch: number; token: string; targetId: string }, now: Date) =>
    !!r && r.epoch === ctx.epoch && r.leaseOwner === ctx.token && r.status === "RUNNING" && !!r.leaseExpiresAt && r.leaseExpiresAt > now;

  const store: OperationStore = {
    async createReserving({ actorUserId, subjectUserId, kind, idempotencyKey, fingerprint, reservationToken, now }) {
      for (const r of rows.values()) {
        if (r.actorUserId === actorUserId && r.idempotencyKey === idempotencyKey) return { row: { ...r }, created: false };
      }
      const row: OperationRow = {
        id: `op-${++seq}`, actorUserId, subjectUserId, kind, idempotencyKey, fingerprint, status: "RESERVING",
        epoch: 1, reservationToken, publishCount: 0,
        targetType: null, targetId: null, payload: null, messageId: null, attempt: 0, leaseOwner: null,
        leaseExpiresAt: null, lastError: null, createdAt: now, updatedAt: now,
      };
      rows.set(row.id, row);
      return { row: { ...row }, created: true };
    },
    async get(id) {
      const r = rows.get(id);
      return r ? { ...r } : null;
    },
    async deleteIfReserving(id, epoch, token) {
      const r = rows.get(id);
      if (!r || r.status !== "RESERVING" || r.epoch !== epoch || r.reservationToken !== token) return false;
      rows.delete(id);
      return true;
    },
    async takeOverReserving(id, seen, newToken, now) {
      const r = rows.get(id);
      if (!r || r.status !== "RESERVING" || r.updatedAt.getTime() !== seen.getTime()) return false;
      Object.assign(r, { reservationToken: newToken, updatedAt: now });
      return true;
    },
    async reopenFailed(id, newToken, fingerprint, now) {
      const r = rows.get(id);
      if (!r || r.status !== "FAILED") return null;
      Object.assign(r, { status: "RESERVING", epoch: r.epoch + 1, reservationToken: newToken, fingerprint, targetType: null, targetId: null, payload: null, messageId: null, attempt: 0, publishCount: 0, leaseOwner: null, leaseExpiresAt: null, lastError: null, updatedAt: now });
      return { ...r };
    },
    async markAdmitted(id, epoch, token, data, now) {
      const r = rows.get(id);
      if (!r || r.status !== "RESERVING" || r.epoch !== epoch || r.reservationToken !== token) return false;
      Object.assign(r, { status: "ADMITTED", targetType: data.targetType, targetId: data.targetId, payload: data.payload, updatedAt: now });
      return true;
    },
    async recordPublish(id, epoch, messageId, now) {
      if (hooks.failNextRecordPublish) {
        hooks.failNextRecordPublish = false;
        throw new Error("simulated acknowledgment failure after publish");
      }
      const r = rows.get(id);
      if (!r || r.epoch !== epoch || r.status === "RESERVING" || r.status === "FAILED") return;
      if (!r.messageId) r.messageId = messageId;
      if (r.status === "ADMITTED") Object.assign(r, { status: "PUBLISHED", updatedAt: now });
    },
    async claimPublish(id, epoch, expectedCount, max, now) {
      return withLock(id, () => {
        const r = rows.get(id);
        if (!r || r.epoch !== epoch || !(r.status === "ADMITTED" || r.status === "PUBLISHED" || r.status === "RUNNING") || r.publishCount !== expectedCount || r.publishCount >= max) return false;
        r.publishCount += 1;
        r.updatedAt = now;
        return true;
      });
    },
    async claim(b: ExecutionBinding, token, leaseMs, maxAttempts, now): Promise<ClaimResult> {
      return withLock(b.operationId, () => {
        const r = rows.get(b.operationId);
        if (!r) return { kind: "MISSING" } as ClaimResult;
        const matches = r.epoch === b.epoch && r.kind === b.kind && r.actorUserId === b.actorUserId && r.targetId === b.planId;
        const claimable = matches && r.attempt < maxAttempts && (r.status === "ADMITTED" || r.status === "PUBLISHED" || (r.status === "RUNNING" && !!r.leaseExpiresAt && r.leaseExpiresAt < now));
        if (claimable) {
          Object.assign(r, { status: "RUNNING", leaseOwner: token, leaseExpiresAt: new Date(now.getTime() + leaseMs), attempt: r.attempt + 1, updatedAt: now });
          return { kind: "CLAIMED", row: { ...r } } as ClaimResult;
        }
        if (r.epoch !== b.epoch) return { kind: "STALE_MESSAGE", row: { ...r } } as ClaimResult;
        if (r.kind !== b.kind || r.actorUserId !== b.actorUserId || r.targetId !== b.planId) return { kind: "MISMATCH", row: { ...r } } as ClaimResult;
        if (r.status === "COMPLETED" || r.status === "FAILED") return { kind: "TERMINAL", row: { ...r } } as ClaimResult;
        const expiredRunning = r.status === "RUNNING" && !!r.leaseExpiresAt && r.leaseExpiresAt < now;
        if (r.attempt >= maxAttempts && (r.status === "ADMITTED" || r.status === "PUBLISHED" || expiredRunning)) {
          return { kind: "EXHAUSTED", row: { ...r } } as ClaimResult;
        }
        return { kind: "IN_FLIGHT", row: { ...r } } as ClaimResult;
      });
    },
    async runFenced(ctx, planId, leaseMs, now, fn) {
      return withLock(ctx.operationId, async () => {
        const r = rows.get(ctx.operationId);
        if (!ownerOk(r, ctx, now) || r!.targetId !== planId) throw new StaleLeaseError(ctx.operationId);
        r!.leaseExpiresAt = new Date(now.getTime() + leaseMs);
        return fn(opts.db);
      });
    },
    async renew(ctx, leaseMs, now) {
      return withLock(ctx.operationId, () => {
        const r = rows.get(ctx.operationId);
        if (!ownerOk(r, ctx, now)) return false;
        r!.leaseExpiresAt = new Date(now.getTime() + leaseMs);
        return true;
      });
    },
    async finish(ctx, status, error, now) {
      return withLock(ctx.operationId, () => {
        const r = rows.get(ctx.operationId);
        if (!ownerOk(r, ctx, now)) return false;
        Object.assign(r!, { status, lastError: error, leaseExpiresAt: null, updatedAt: now });
        return true;
      });
    },
    async release(ctx, error, now) {
      return withLock(ctx.operationId, () => {
        const r = rows.get(ctx.operationId);
        if (!r || r.epoch !== ctx.epoch || r.leaseOwner !== ctx.token || r.status !== "RUNNING") return false;
        Object.assign(r, { status: "PUBLISHED", leaseOwner: null, leaseExpiresAt: null, lastError: error, updatedAt: now });
        return true;
      });
    },
    async settleStranded(id, epoch, reason, now) {
      return withLock(id, async () => {
        const r = rows.get(id);
        if (!r || r.epoch !== epoch) return null;
        const eligible = r.status === "ADMITTED" || r.status === "PUBLISHED" || (r.status === "RUNNING" && !!r.leaseExpiresAt && r.leaseExpiresAt < now);
        if (!eligible) return null;
        const table = r.targetType === "NUTRITION_PLAN" ? opts.db.nutritionPlan : opts.db.workoutPlan;
        const plan = r.targetId ? await table.findUnique({ where: { id: r.targetId } }) : null;
        const done = { leaseOwner: null, leaseExpiresAt: null, updatedAt: now };
        if (plan?.status === "COMPLETED") {
          Object.assign(r, { status: "COMPLETED", lastError: null, ...done });
          return "COMPLETED" as const;
        }
        if (plan) {
          // Plan write FIRST; if it throws, the operation row below is never touched (models transaction rollback).
          const res = await table.updateMany({ where: { id: r.targetId, status: { not: "COMPLETED" } }, data: { status: "FAILED", failReason: reason } });
          if (res.count !== 1) throw new Error("settleStranded: plan transition affected " + res.count + " rows");
        }
        Object.assign(r, { status: "FAILED", lastError: plan ? reason : "target plan missing", ...done });
        return "FAILED" as const;
      });
    },
    async repairFailedTarget(id, epoch) {
      return withLock(id, async () => {
        const r = rows.get(id);
        if (!r || r.epoch !== epoch || r.status !== "FAILED" || !r.targetId) return false;
        const table = r.targetType === "NUTRITION_PLAN" ? opts.db.nutritionPlan : opts.db.workoutPlan;
        const res = await table.updateMany({ where: { id: r.targetId, status: { in: ["QUEUED", "PROCESSING"] } }, data: { status: "FAILED", failReason: r.lastError ?? "generation failed" } });
        return res.count === 1;
      });
    },
    async listInconsistentTerminal(limit) {
      const out: Array<{ id: string; epoch: number }> = [];
      for (const r of rows.values()) {
        if (r.status !== "FAILED" || !r.targetId) continue;
        const table = r.targetType === "NUTRITION_PLAN" ? opts.db.nutritionPlan : opts.db.workoutPlan;
        const plan = await table.findUnique({ where: { id: r.targetId } });
        if (plan && (plan.status === "QUEUED" || plan.status === "PROCESSING")) out.push({ id: r.id, epoch: r.epoch });
        if (out.length >= limit) break;
      }
      return out;
    },
    async ackAutoSave(id, epoch) {
      return withLock(id, async () => {
        const r = rows.get(id);
        if (!r || r.epoch !== epoch || r.kind !== "NUTRITION_PLAN" || !["RUNNING", "COMPLETED"].includes(r.status) || r.payload?.autoSaveAckedAt) return false;
        r.payload = { ...(r.payload ?? {}), autoSaveAckedAt: new Date().toISOString() };
        return true;
      });
    },
    async claimAutoSaveAttempt(id, epoch, maxAttempts) {
      return withLock(id, async () => {
        const r = rows.get(id);
        const attempts = Number(r?.payload?.autoSaveAttempts ?? 0);
        if (!r || r.epoch !== epoch || r.status !== "COMPLETED" || r.kind !== "NUTRITION_PLAN" || r.payload?.job?.autoSaveOnComplete !== true || r.payload?.autoSaveAckedAt || attempts >= maxAttempts) return false;
        r.payload = { ...r.payload, autoSaveAttempts: attempts + 1 };
        return true;
      });
    },
    async listPendingAutoSave(since, maxAttempts, limit) {
      return [...rows.values()]
        .filter((r) => r.status === "COMPLETED" && r.kind === "NUTRITION_PLAN" && r.payload?.job?.autoSaveOnComplete === true && !r.payload?.autoSaveAckedAt
          && Number(r.payload?.autoSaveAttempts ?? 0) < maxAttempts && (((r as any).completedAt ?? r.updatedAt) as Date) > since)
        .slice(0, limit)
        .map((r) => ({ ...r }));
    },
    async listRecoverable(c: RecoveryCutoffs, now, limit) {
      return [...rows.values()]
        .filter((r) =>
          (r.status === "RESERVING" && r.updatedAt < c.reservingBefore) ||
          (r.status === "ADMITTED" && r.updatedAt < c.admittedBefore) ||
          (r.status === "PUBLISHED" && r.updatedAt < c.publishedBefore) ||
          (r.status === "RUNNING" && !!r.leaseExpiresAt && r.leaseExpiresAt < now))
        .slice(0, limit)
        .map((r) => ({ ...r }));
    },
  };
  return { store, rows, hooks, withLock };
}
