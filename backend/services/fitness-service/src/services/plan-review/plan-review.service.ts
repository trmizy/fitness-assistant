import { logger } from "@gym-coach/shared";
import {
  OPEN_STATUSES,
  buildProgramSnapshot,
  computeEffectiveState,
  fingerprintMatches,
  hashSnapshot,
  isOpenStatus,
  resolveTransition,
  toLegacyPtReviewStatus,
  TRANSITIONS,
  type CurrentFingerprint,
  type PlanReviewAction,
  type PlanReviewActorRole,
  type PlanReviewStatusValue,
  type ProgramSnapshotSource,
} from "./plan-review.engine";
import {
  PlanReviewSubjectChanged,
  PlanReviewUniqueViolation,
  type NewPlanReviewEvent,
  type PlanReviewRecord,
  type PlanReviewRepository,
} from "./plan-review.types";

/**
 * Workout Plan Review & Approval — client submits their CURRENT WorkoutProgram to a PT; the PT approves / requests changes /
 * rejects. Fitness-service owns the program, so the review lives here: one DB, one transaction per state change — no cross-DB
 * transaction is assumed anywhere (ai-service's WorkoutPlan is provenance only, never written).
 *
 * Security stance: the caller's identity is ONLY ever taken from the verified session (never from the body); the PT↔client
 * relationship is re-derived from user-service's authoritative ACTIVE contracts on every submit / view / decide and FAILS
 * CLOSED (an unreadable roster is a 503, never "allowed" and never "revoked"); a request that is not yours is a 404, not a 403
 * (no IDOR enumeration); health/body data is never part of the snapshot.
 */

export interface PlanReviewError {
  status: number;
  code: string;
  message: string;
}
function fail(status: number, code: string, message: string): never {
  throw { status, code, message } satisfies PlanReviewError;
}

export interface PlanReviewDeps {
  repo: PlanReviewRepository;
  /** The client's current ACTIVE program, or null. */
  loadCurrentProgram(clientUserId: string): Promise<ProgramSnapshotSource | null>;
  /** STRICT: authoritative ACTIVE client ids of this PT. MUST throw on any failure (never return [] for an outage). */
  fetchActiveClientIds(ptUserId: string): Promise<string[]>;
  /**
   * At-least-once delivery: MUST throw on failure (the event then stays pending and is retried) and MUST be idempotent on
   * `dedupeKey` (a retry / crash between delivery and marking must not notify twice). null => no channel wired (events stay pending).
   */
  notify: ((n: PlanReviewNotification) => Promise<void>) | null;
  now(): Date;
}

/** Generic by construction: fixed sentences only — never plan contents, notes, or any body/health data. */
export interface PlanReviewNotification {
  userId: string;
  text: string;
  /** REQUESTED => addressed to the PT; DECIDED => addressed to the client. */
  kind: "REQUESTED" | "DECIDED";
  requestId: string;
  /** Stable per outbox event: user-service stores one notification per key. */
  dedupeKey: string;
  link: string;
}

export interface Actor {
  id: string;
  role?: string;
}

const NOTE_MAX = 1000;
const NOTE_MIN_FOR_NEGATIVE = 3;

function cleanNote(note: string | null | undefined, required: boolean): string | null {
  const trimmed = (note ?? "").trim();
  if (trimmed.length > NOTE_MAX) fail(400, "NOTE_TOO_LONG", `Ghi chú tối đa ${NOTE_MAX} ký tự`);
  if (required && trimmed.length < NOTE_MIN_FOR_NEGATIVE) fail(400, "NOTE_REQUIRED", "Cần ghi chú lý do/nội dung cần chỉnh sửa");
  return trimmed.length > 0 ? trimmed : null;
}

export function createPlanReviewService(deps: PlanReviewDeps) {

  async function roster(ptUserId: string): Promise<string[]> {
    try {
      return await deps.fetchActiveClientIds(ptUserId);
    } catch (err) {
      logger.warn({ err: (err as Error).message }, "[plan-review] contract roster unavailable — failing closed");
      fail(503, "AUTH_DEPENDENCY_UNAVAILABLE", "Không xác minh được hợp đồng PT lúc này. Vui lòng thử lại.");
    }
  }

  /** Runs a state change as SYSTEM, ignoring a lost race (someone else already moved it, which is fine). */
  async function systemTransition(req: PlanReviewRecord, action: PlanReviewAction, note: string | null, notifyUserId: string | null) {
    const t = resolveTransition(req.status, action, "SYSTEM");
    return deps.repo.transition({
      id: req.id,
      fromStatuses: OPEN_STATUSES,
      expectedRevision: req.revision,
      toStatus: t.to,
      event: {
        type: t.event,
        actorUserId: null,
        actorRole: "SYSTEM",
        fromStatus: req.status,
        toStatus: t.to,
        contentHash: req.contentHash,
        note,
        notifyUserId,
      },
    });
  }

  /** PT-side access: 404 for someone else's request; revalidated ACTIVE contract; revokes an open request if the contract ended. */
  async function authorizePt(requestId: string, actor: Actor): Promise<PlanReviewRecord> {
    const req = await deps.repo.findById(requestId);
    if (!req || req.ptUserId !== actor.id) fail(404, "NOT_FOUND", "Không tìm thấy yêu cầu duyệt kế hoạch");
    const clients = await roster(actor.id);
    if (!clients.includes(req.clientUserId)) {
      if (isOpenStatus(req.status)) await systemTransition(req, "REVOKE_ACCESS", "Hợp đồng PT không còn hiệu lực", req.clientUserId);
      fail(403, "NO_ACTIVE_CONTRACT", "Bạn không còn hợp đồng hiệu lực với học viên này");
    }
    return req;
  }

  function authorizeClient(req: PlanReviewRecord | null, actor: Actor): PlanReviewRecord {
    if (!req || req.clientUserId !== actor.id) fail(404, "NOT_FOUND", "Không tìm thấy yêu cầu duyệt kế hoạch");
    return req;
  }

  function fingerprintOf(program: ProgramSnapshotSource): CurrentFingerprint {
    return { hash: hashSnapshot(buildProgramSnapshot(program)), version: program.version };
  }

  /** The plan as it is NOW (monotonic version + content hash), or null when `subjectId` is no longer the client's current plan. */
  async function currentFor(clientUserId: string, subjectId: string): Promise<CurrentFingerprint | null> {
    const program = await deps.loadCurrentProgram(clientUserId);
    if (!program || program.id !== subjectId) return null;
    return fingerprintOf(program);
  }

  /** For a request that was JUST read/written (so by definition it is what it is): used where no live comparison is wanted. */
  const selfFingerprint = (req: PlanReviewRecord): CurrentFingerprint => ({ hash: req.contentHash, version: req.subjectVersion });

  function toView(req: PlanReviewRecord, current: CurrentFingerprint | null, opts: { includeSnapshot: boolean }) {
    const { snapshot, idempotencyKey: _ik, ...rest } = req;
    const effective = computeEffectiveState(req, current);
    return {
      ...rest,
      ...(opts.includeSnapshot ? { snapshot } : {}),
      effectiveState: effective,
      // F: "revision mismatch warning" — the plan changed after this request was submitted (version OR content).
      isOutdated: !fingerprintMatches(req, current),
      legacyPtReviewStatus: toLegacyPtReviewStatus(req.status),
    };
  }

  async function applyDecision(
    actor: Actor,
    id: string,
    action: Extract<PlanReviewAction, "APPROVE" | "REQUEST_CHANGES" | "REJECT">,
    input: { note?: string | null; expectedRevision?: number; expectedContentHash?: string },
  ) {
    if (actor.role !== "PT") fail(403, "ROLE_NOT_ALLOWED", "Chỉ PT mới được duyệt kế hoạch");
    const req = await authorizePt(id, actor);
    const note = cleanNote(input.note, action !== "APPROVE");

    // Idempotent replay: the same PT repeating the same decision (retry / double click) is not an error.
    if (req.status === TRANSITIONS[action].to) {
      return { request: toView(req, await currentFor(req.clientUserId, req.subjectId), { includeSnapshot: true }), replayed: true };
    }
    const t = resolveTransitionOrFail(req.status, action, "PT", req);
    if (input.expectedContentHash && input.expectedContentHash !== req.contentHash) {
      fail(409, "STALE_REVISION", "Bạn đang xem một phiên bản kế hoạch đã cũ");
    }
    if (input.expectedRevision !== undefined && input.expectedRevision !== req.revision) {
      fail(409, "CONCURRENT_MODIFICATION", "Yêu cầu vừa được cập nhật, hãy tải lại");
    }

    // The client may have edited the plan after submitting: a decision on content that is no longer the plan must not stand.
    // Fast pre-check (nice error + clean supersede). It is NOT the guarantee — the repository re-checks the version under a row
    // lock in the same transaction as the status change (subjectGuard below), which closes the check-then-act window.
    const current = await currentFor(req.clientUserId, req.subjectId);
    const supersedeAsOutdated = async (): Promise<never> => {
      await systemTransition(req, "SUPERSEDE", "Kế hoạch đã thay đổi sau khi gửi", req.ptUserId);
      return fail(409, "REVISION_OUTDATED", "Học viên đã chỉnh sửa kế hoạch sau khi gửi. Yêu cầu này đã được thay thế.");
    };
    if (!fingerprintMatches(req, current)) await supersedeAsOutdated();

    const decidedAt = deps.now();
    let updated: PlanReviewRecord | null;
    try {
      updated = await deps.repo.transition({
        id: req.id,
        fromStatuses: OPEN_STATUSES,
        expectedRevision: req.revision,
        toStatus: t.to,
        subjectGuard: { subjectId: req.subjectId, version: req.subjectVersion },
        patch: { decisionNote: note, decidedAt },
        event: {
          type: t.event,
          actorUserId: actor.id,
          actorRole: "PT",
          fromStatus: req.status,
          toStatus: t.to,
          contentHash: req.contentHash,
          note,
          notifyUserId: req.clientUserId,
        },
      });
    } catch (err) {
      // The plan moved between the pre-check and the commit: the atomic guard refused the decision and wrote nothing.
      if (err instanceof PlanReviewSubjectChanged) return supersedeAsOutdated();
      throw err;
    }
    if (!updated) {
      const latest = await deps.repo.findById(req.id);
      if (latest && latest.status === t.to) return { request: toView(latest, current, { includeSnapshot: true }), replayed: true };
      fail(409, "CONCURRENT_MODIFICATION", "Yêu cầu đã được xử lý bởi một thao tác khác");
    }
    return { request: toView(updated, current, { includeSnapshot: true }), replayed: false };
  }

  function resolveTransitionOrFail(from: PlanReviewStatusValue, action: PlanReviewAction, role: PlanReviewActorRole, req: PlanReviewRecord) {
    // Replays of an already-applied decision are handled by the caller; a terminal (or otherwise illegal) state is a 409.
    try {
      return resolveTransition(from, action, role);
    } catch {
      fail(409, "ILLEGAL_TRANSITION", `Không thể thực hiện thao tác này (trạng thái: ${req.status})`);
    }
  }

  return {
    /** Client submits their CURRENT program to a PT with whom they hold an ACTIVE contract. */
    async submit(
      actor: Actor,
      input: { ptUserId: string; programId?: string; expectedVersion?: number; expectedContentHash?: string; idempotencyKey?: string; clientNote?: string | null },
    ) {
      if (input.ptUserId === actor.id) fail(400, "SELF_REVIEW", "Không thể tự gửi kế hoạch cho chính mình");
      const clients = await roster(input.ptUserId);
      if (!clients.includes(actor.id)) fail(403, "NO_ACTIVE_CONTRACT", "Bạn chưa có hợp đồng hiệu lực với PT này");
      const clientNote = cleanNote(input.clientNote, false);

      if (input.idempotencyKey) {
        const prior = await deps.repo.findByIdempotencyKey(actor.id, input.idempotencyKey);
        if (prior) {
          if (prior.ptUserId !== input.ptUserId || (input.programId && prior.subjectId !== input.programId)) {
            fail(409, "IDEMPOTENCY_KEY_REUSED", "Khóa idempotency đã được dùng cho một yêu cầu khác");
          }
          return { request: toView(prior, selfFingerprint(prior), { includeSnapshot: true }), replayed: true };
        }
      }

      const program = await deps.loadCurrentProgram(actor.id);
      if (!program) fail(404, "NO_CURRENT_PROGRAM", "Bạn chưa có kế hoạch tập luyện hiện tại để gửi");
      if (input.programId && input.programId !== program.id) fail(409, "PROGRAM_NOT_CURRENT", "Kế hoạch này không còn là kế hoạch hiện tại");
      if (input.expectedVersion !== undefined && input.expectedVersion !== program.version) {
        fail(409, "STALE_REVISION", "Kế hoạch đã thay đổi so với bản bạn đã xem để xác nhận");
      }

      const snapshot = buildProgramSnapshot(program);
      const contentHash = hashSnapshot(snapshot);
      const fp: CurrentFingerprint = { hash: contentHash, version: program.version };
      if (input.expectedContentHash && input.expectedContentHash !== contentHash) {
        fail(409, "STALE_REVISION", "Kế hoạch đã thay đổi so với bản bạn đang xem");
      }

      const subjectType = "WORKOUT_PROGRAM";
      const submittedEvent: NewPlanReviewEvent = {
        type: "SUBMITTED",
        actorUserId: actor.id,
        actorRole: "CLIENT",
        fromStatus: null,
        toStatus: "PENDING_REVIEW",
        contentHash,
        note: clientNote,
        notifyUserId: input.ptUserId,
      };
      const data = {
        clientUserId: actor.id,
        ptUserId: input.ptUserId,
        subjectId: program.id,
        subjectVersion: program.version,
        contentHash,
        sourcePlanId: program.sourcePlanId ?? null,
        aiPlanVersion: program.aiPlanVersion ?? null,
        snapshot,
        idempotencyKey: input.idempotencyKey ?? null,
        clientNote,
      };

      const attempt = async () => {
        const open = await deps.repo.findOpenForSubject(actor.id, subjectType, program.id);
        if (open) {
          if (open.ptUserId !== input.ptUserId) {
            fail(409, "OPEN_REQUEST_WITH_OTHER_PT", "Bạn đang có yêu cầu chờ duyệt với PT khác. Hãy huỷ yêu cầu đó trước.");
          }
          // Replay only if it is the SAME plan state (version AND content). A -> B -> A has the same hash but a newer version:
          // that is a new submission (the older request is superseded below), never a silent reuse of the old one.
          if (fingerprintMatches(open, fp)) return { request: toView(open, fp, { includeSnapshot: true }), replayed: true };
          // Same PT, edited plan: the older request is superseded in the same transaction as the new one is created.
          const created = await deps.repo.createSubmission({
            data,
            submittedEvent,
            supersede: {
              id: open.id,
              expectedRevision: open.revision,
              event: {
                type: "SUPERSEDED",
                actorUserId: actor.id,
                actorRole: "CLIENT",
                fromStatus: open.status,
                toStatus: "SUPERSEDED",
                contentHash: open.contentHash,
                note: "Học viên đã gửi phiên bản kế hoạch mới",
                notifyUserId: null,
              },
            },
          });
          return { request: toView(created, fp, { includeSnapshot: true }), replayed: false };
        }
        const created = await deps.repo.createSubmission({ data, submittedEvent });
        return { request: toView(created, fp, { includeSnapshot: true }), replayed: false };
      };

      try {
        return await attempt();
      } catch (err) {
        if (err instanceof PlanReviewUniqueViolation) {
          // Lost a race with a concurrent submit (double click / two devices). Re-read; the winner decides what is correct.
          if (err.target === "IDEMPOTENCY_KEY" && input.idempotencyKey) {
            const prior = await deps.repo.findByIdempotencyKey(actor.id, input.idempotencyKey);
            if (prior && prior.ptUserId === input.ptUserId) return { request: toView(prior, selfFingerprint(prior), { includeSnapshot: true }), replayed: true };
          }
          const open = await deps.repo.findOpenForSubject(actor.id, subjectType, program.id);
          if (open && open.ptUserId === input.ptUserId && fingerprintMatches(open, fp)) {
            return { request: toView(open, fp, { includeSnapshot: true }), replayed: true };
          }
          fail(409, "CONCURRENT_SUBMISSION", "Có một yêu cầu gửi khác đang được xử lý. Hãy tải lại.");
        }
        throw err;
      }
    },

    /** Client: my requests (newest first). No snapshot in lists. */
    async listMine(actor: Actor, opts: { subjectId?: string } = {}) {
      const rows = await deps.repo.listByClient(actor.id, opts);
      const program = await deps.loadCurrentProgram(actor.id);
      const fp = program ? fingerprintOf(program) : null;
      return rows.map((r) => toView(r, program && program.id === r.subjectId ? fp : null, { includeSnapshot: false }));
    },

    /** PT inbox. Rows from clients whose contract is no longer ACTIVE are hidden (and their open requests revoked). */
    async listInbox(actor: Actor, opts: { statuses?: readonly PlanReviewStatusValue[] } = {}) {
      if (actor.role !== "PT") fail(403, "ROLE_NOT_ALLOWED", "Chỉ PT mới có hộp thư duyệt kế hoạch");
      const clients = new Set(await roster(actor.id));
      const rows = await deps.repo.listByPt(actor.id, { statuses: opts.statuses ?? OPEN_STATUSES });
      const visible: PlanReviewRecord[] = [];
      for (const r of rows) {
        if (clients.has(r.clientUserId)) visible.push(r);
        else if (isOpenStatus(r.status)) await systemTransition(r, "REVOKE_ACCESS", "Hợp đồng PT không còn hiệu lực", r.clientUserId);
      }
      return visible.map((r) => toView(r, selfFingerprint(r), { includeSnapshot: false }));
    },

    async get(actor: Actor, id: string) {
      const req = actor.role === "PT" ? await authorizePt(id, actor) : authorizeClient(await deps.repo.findById(id), actor);
      return toView(req, await currentFor(req.clientUserId, req.subjectId), { includeSnapshot: true });
    },

    /** PT opens a PENDING request → IN_REVIEW. Idempotent when already IN_REVIEW. */
    async start(actor: Actor, id: string) {
      if (actor.role !== "PT") fail(403, "ROLE_NOT_ALLOWED", "Chỉ PT mới được mở yêu cầu duyệt");
      const req = await authorizePt(id, actor);
      if (req.status === "IN_REVIEW") return toView(req, selfFingerprint(req), { includeSnapshot: true });
      const t = resolveTransitionOrFail(req.status, "START", "PT", req);
      const updated = await deps.repo.transition({
        id: req.id,
        fromStatuses: ["PENDING_REVIEW"],
        expectedRevision: req.revision,
        toStatus: t.to,
        event: { type: t.event, actorUserId: actor.id, actorRole: "PT", fromStatus: req.status, toStatus: t.to, contentHash: req.contentHash },
      });
      if (!updated) {
        const latest = await deps.repo.findById(req.id);
        if (latest && latest.status === "IN_REVIEW") return toView(latest, selfFingerprint(latest), { includeSnapshot: true });
        fail(409, "CONCURRENT_MODIFICATION", "Yêu cầu đã được xử lý bởi một thao tác khác");
      }
      return toView(updated, selfFingerprint(updated), { includeSnapshot: true });
    },

    approve: (actor: Actor, id: string, input: { note?: string | null; expectedRevision?: number; expectedContentHash?: string } = {}) =>
      applyDecision(actor, id, "APPROVE", input),
    requestChanges: (actor: Actor, id: string, input: { note?: string | null; expectedRevision?: number; expectedContentHash?: string }) =>
      applyDecision(actor, id, "REQUEST_CHANGES", input),
    reject: (actor: Actor, id: string, input: { note?: string | null; expectedRevision?: number; expectedContentHash?: string }) =>
      applyDecision(actor, id, "REJECT", input),

    /** Client cancels their own pending request. Idempotent when already CANCELLED. */
    async cancel(actor: Actor, id: string) {
      const req = authorizeClient(await deps.repo.findById(id), actor);
      if (req.status === "CANCELLED") return { request: toView(req, null, { includeSnapshot: false }), replayed: true };
      const t = resolveTransitionOrFail(req.status, "CANCEL", "CLIENT", req);
      const updated = await deps.repo.transition({
        id: req.id,
        fromStatuses: OPEN_STATUSES,
        expectedRevision: req.revision,
        toStatus: t.to,
        event: {
          type: t.event, actorUserId: actor.id, actorRole: "CLIENT", fromStatus: req.status, toStatus: t.to,
          contentHash: req.contentHash, notifyUserId: req.ptUserId,
        },
      });
      if (!updated) {
        const latest = await deps.repo.findById(req.id);
        if (latest && latest.status === "CANCELLED") return { request: toView(latest, null, { includeSnapshot: false }), replayed: true };
        fail(409, "CONCURRENT_MODIFICATION", "Yêu cầu đã được PT xử lý, không thể huỷ");
      }
      return { request: toView(updated, null, { includeSnapshot: false }), replayed: false };
    },

    /** Audit trail. Same access rules as get(): a PT whose contract ended gets 403 and no data. */
    async events(actor: Actor, id: string) {
      if (actor.role === "PT") await authorizePt(id, actor);
      else authorizeClient(await deps.repo.findById(id), actor);
      const events = await deps.repo.listEvents(id);
      return events.map(({ notifyUserId: _n, ...e }) => e);
    },

    /** Counts for badges. Client: own requests + current-plan review state. PT: open inbox size (verified clients only). */
    async summary(actor: Actor) {
      if (actor.role === "PT") {
        const clients = new Set(await roster(actor.id));
        const rows = (await deps.repo.listByPt(actor.id, { statuses: OPEN_STATUSES })).filter((r) => clients.has(r.clientUserId));
        return {
          role: "PT" as const,
          pending: rows.filter((r) => r.status === "PENDING_REVIEW").length,
          inReview: rows.filter((r) => r.status === "IN_REVIEW").length,
        };
      }
      const rows = await deps.repo.listByClient(actor.id);
      const program = await deps.loadCurrentProgram(actor.id);
      const hash = program ? fingerprintOf(program) : null;
      const forCurrent = program ? rows.filter((r) => r.subjectId === program.id) : [];
      const latest = forCurrent[0] ?? null; // repo returns newest first
      const byStatus: Record<string, number> = {};
      for (const r of rows) byStatus[r.status] = (byStatus[r.status] ?? 0) + 1;
      return {
        role: "CLIENT" as const,
        byStatus,
        currentPlan: program
          ? { programId: program.id, latestReview: latest ? toView(latest, hash, { includeSnapshot: false }) : null }
          : null,
      };
    },

    /** Outbox sweeper: at-least-once, idempotent per event (notifiedAt). A no-op until a delivery channel is wired. */
    async dispatchPendingNotifications(limit = 50) {
      if (!deps.notify) return { delivered: 0, skipped: 0, wired: false as const };
      const pending = await deps.repo.pendingNotifications(limit);
      let delivered = 0;
      for (const ev of pending) {
        if (!ev.notifyUserId) continue;
        try {
          // Generic text only: never plan contents, notes or body data in a notification.
          const toPt = PT_BOUND_EVENTS.has(ev.type);
          await deps.notify({
            userId: ev.notifyUserId,
            text: notificationText(ev.type),
            kind: toPt ? "REQUESTED" : "DECIDED",
            requestId: ev.requestId,
            dedupeKey: `plan-review-event:${ev.id}`,
            link: toPt ? "/pt/plan-reviews" : "/client/training",
          });
          await deps.repo.markNotified(ev.id, deps.now());
          delivered += 1;
        } catch (err) {
          logger.warn({ err: (err as Error).message, eventId: ev.id }, "[plan-review] notification delivery failed — will retry");
        }
      }
      return { delivered, skipped: pending.length - delivered, wired: true as const };
    },
  };
}

/** Events whose recipient is the PT (new/cancelled/superseded work); every other event is addressed to the client. */
const PT_BOUND_EVENTS = new Set(["SUBMITTED", "CANCELLED", "SUPERSEDED"]);

function notificationText(type: string): string {
  switch (type) {
    case "SUBMITTED": return "Có một kế hoạch tập luyện mới đang chờ bạn duyệt.";
    case "APPROVED": return "PT đã duyệt kế hoạch tập luyện của bạn.";
    case "CHANGES_REQUESTED": return "PT yêu cầu chỉnh sửa kế hoạch tập luyện của bạn.";
    case "REJECTED": return "PT đã từ chối kế hoạch tập luyện của bạn.";
    case "CANCELLED": return "Học viên đã huỷ yêu cầu duyệt kế hoạch.";
    case "ACCESS_REVOKED": return "Yêu cầu duyệt kế hoạch đã bị đóng vì hợp đồng PT không còn hiệu lực.";
    case "SUPERSEDED": return "Một yêu cầu duyệt kế hoạch đã được thay bằng phiên bản mới hơn.";
    default: return "Yêu cầu duyệt kế hoạch có cập nhật mới.";
  }
}

export type PlanReviewService = ReturnType<typeof createPlanReviewService>;
