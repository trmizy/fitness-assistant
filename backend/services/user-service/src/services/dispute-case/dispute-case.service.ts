import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma";
import { prisma } from "../../repositories/profile.repository";
import { canonicalJson, contentHashOf, sha256Hex } from "./canonical";
import { collectSources, draftHash, type Db, type EvidenceDraft } from "./collector";
import { buildFinancialView, hasLateArrivalStep, partyFinancialView } from "./financial";
import { caseError, forbiddenRole, notFoundCase, notInvestigator, versionConflict } from "./errors";
import { CANCELLED_BLOCKED_BY_D77 } from "./execution-guard";
import { evidenceStorageEnabled } from "./flags";
import { ALLOWED_MIME, MAX_EVIDENCE_BYTES, readVerified, removeFile, sniffMime, storeFile } from "./evidence-storage";
import {
  D77_BLOCK_REASON,
  EXECUTION_BLOCKED_SLICE1,
  CLASSIFIABLE_TYPES,
  INVESTIGATION_STATUSES,
  PARTY_SUBMIT_STATUSES,
  effectiveVerificationStatus,
  provenanceLabelVi,
  isPartySubmitted,
  shareRefusalReason,
  canTransition,
  canTransitionManually,
  changeAcknowledged,
  checkApprover,
  deriveCaseType,
  diffAgainstSnapshot,
  evidenceVisibleToParty,
  isTerminal,
  outcomeForFinding,
  partyRoleOf,
  statementVisibleToParty,
  TERMINAL_STATUSES,
  type CaseStatus,
  type CaseType,
  type FindingKind,
  type PartyRole,
  type SnapshotEntry,
} from "./rules";

/**
 * DISPUTE CASE slice 1 - case management core (docs/DISPUTE_CASE_DESIGN_V2_1.md). RECORDS and DECIDES; EXECUTES NOTHING.
 *
 * What this file never does, on purpose: call resolveDispute / claimRuling or any payment-service WRITE, touch a session, a contract's
 * quota or a settlement row. The only payment-service calls are the read-only ledger lookups of financial.ts. An approved decision stays
 * `DECISION_APPROVED` with execution = "BLOCKED: SLICE_2_NOT_ENABLED" until Slice 2 exists.
 *
 * Concurrency: every mutation takes `SELECT ... FOR UPDATE` on the case row, then still changes status through a compare-and-swap on
 * (id, version, status), and writes its DisputeCaseEvent in the SAME transaction. Identity is a parameter (`Actor`, from the gateway's
 * verified x-user-id / x-user-role) - nothing here reads a user id from a request body.
 */
export interface Actor {
  id: string;
  role: string;
}

type Tx = Prisma.TransactionClient;
type CaseRow = Prisma.DisputeCaseGetPayload<{}>;

const toJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v ?? null));
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const requireUuid = (id: string) => {
  if (!UUID_RE.test(id)) throw notFoundCase();
};
const assertAdmin = (a: Actor) => {
  if (a.role !== "ADMIN") throw forbiddenRole();
};
const assertInvestigator = (a: Actor, c: CaseRow) => {
  assertAdmin(a);
  if (!c.investigatorId || c.investigatorId !== a.id) throw notInvestigator();
};
const classificationRequired = () =>
  caseError(409, "CLASSIFICATION_REQUIRED", "Hồ sơ còn ở phân loại tạm (LEGACY_UNCLASSIFIED). Điều tra viên cần phân loại trước khi ghi kết luận hoặc lập đề xuất");
const stateNotAllowed = (c: CaseRow, allowed: readonly string[]) =>
  caseError(409, "CASE_STATE_NOT_ALLOWED", "Trạng thái hiện tại của hồ sơ không cho phép thao tác này", { status: c.status, allowed });

function summary(c: CaseRow) {
  return {
    id: c.id,
    sessionId: c.sessionId,
    contractId: c.contractId,
    type: c.type,
    status: c.status,
    escalated: c.escalated,
    investigatorId: c.investigatorId,
    version: c.version,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

// ── Mutation wrapper: lock, CAS, event, idempotency ──────────────────────────────────────────────────────────────────

interface Ctx {
  tx: Tx;
  actor: Actor;
  transitions: Array<{ from: CaseStatus; to: CaseStatus; note?: string }>;
}
interface Outcome<T> {
  caseId: string;
  result: T;
  note?: string;
  detail?: unknown;
}

async function lockCase(tx: Tx, caseId: string): Promise<CaseRow> {
  requireUuid(caseId);
  await tx.$queryRaw`SELECT id FROM dispute_cases WHERE id = ${caseId}::uuid FOR UPDATE`;
  const c = await tx.disputeCase.findUnique({ where: { id: caseId } });
  if (!c) throw notFoundCase();
  return c;
}

/** Compare-and-swap on (id, version, status). Writes nothing else; the transition is recorded in the ctx and its event written by `mutate`. */
async function casStatus(ctx: Ctx, c: CaseRow, to: CaseStatus, note?: string): Promise<void> {
  if (!canTransition(c.status as CaseStatus, to)) throw stateNotAllowed(c, []);
  const r = await ctx.tx.disputeCase.updateMany({
    where: { id: c.id, version: c.version, status: c.status },
    data: { status: to, version: { increment: 1 } },
  });
  if (r.count !== 1) throw versionConflict();
  ctx.transitions.push({ from: c.status as CaseStatus, to, note });
  c.status = to;
  c.version += 1;
}

async function casData(ctx: Ctx, c: CaseRow, data: Prisma.DisputeCaseUpdateManyMutationInput): Promise<void> {
  const r = await ctx.tx.disputeCase.updateMany({ where: { id: c.id, version: c.version, status: c.status }, data: { ...data, version: { increment: 1 } } });
  if (r.count !== 1) throw versionConflict();
  c.version += 1;
}

const fullKey = (actor: Actor, action: string, scope: string, key?: string) => (key ? `${actor.id}:${action}:${scope}:${key}` : null);

async function findReplay<T>(key: string | null, requestHash: string): Promise<{ result: T; replayed: true } | null> {
  if (!key) return null;
  const prior = await prisma.disputeCaseEvent.findUnique({ where: { idempotencyKey: key } });
  if (!prior) return null;
  const p = (prior.payload ?? {}) as { requestHash?: string; result?: T };
  if (p.requestHash !== requestHash) {
    throw caseError(409, "IDEMPOTENCY_KEY_REUSED", "Khoá Idempotency-Key này đã được dùng cho một yêu cầu khác nội dung");
  }
  return { result: p.result as T, replayed: true };
}

const isUniqueViolation = (e: unknown, target?: string) =>
  e instanceof Prisma.PrismaClientKnownRequestError &&
  e.code === "P2002" &&
  (!target || JSON.stringify(e.meta ?? {}).includes(target));

async function mutate<T>(o: {
  actor: Actor;
  action: string;
  scope: string;
  idempotencyKey?: string;
  body: unknown;
  run: (ctx: Ctx) => Promise<Outcome<T>>;
}): Promise<{ result: T; replayed: boolean }> {
  const key = fullKey(o.actor, o.action, o.scope, o.idempotencyKey);
  const requestHash = contentHashOf(o.body ?? {});
  const prior = await findReplay<T>(key, requestHash);
  if (prior) return prior;
  try {
    return await prisma.$transaction(
      async (tx) => {
        const ctx: Ctx = { tx, actor: o.actor, transitions: [] };
        const out = await o.run(ctx);
        if (ctx.transitions.length > 1) {
          for (const t of ctx.transitions) {
            await tx.disputeCaseEvent.create({
              data: { caseId: out.caseId, actorUserId: o.actor.id, actorRole: o.actor.role, action: "TRANSITION", fromStatus: t.from, toStatus: t.to, note: t.note ?? null },
            });
          }
        }
        const first = ctx.transitions[0];
        const last = ctx.transitions[ctx.transitions.length - 1];
        await tx.disputeCaseEvent.create({
          data: {
            caseId: out.caseId,
            actorUserId: o.actor.id,
            actorRole: o.actor.role,
            action: o.action,
            fromStatus: first?.from ?? null,
            toStatus: last?.to ?? null,
            note: out.note ?? null,
            idempotencyKey: key,
            payload: toJson({ requestHash, result: out.result, detail: out.detail ?? null }),
          },
        });
        return { result: out.result, replayed: false };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
  } catch (e) {
    if (key && isUniqueViolation(e, "idempotency_key")) {
      const again = await findReplay<T>(key, requestHash);
      if (again) return again;
    }
    throw e;
  }
}

// ── Evidence helpers ─────────────────────────────────────────────────────────────────────────────────────────────────

async function insertEvidence(
  tx: Tx,
  c: { id: string; sessionId: string; contractId: string },
  d: EvidenceDraft,
  o: { snapshotVersion?: number; supersedesId?: string | null; submittedBy?: string | null; submittedRole?: string | null; provenanceType?: any; verificationStatus?: "CLIENT_CLAIMED_UNVERIFIED" | "SERVER_VERIFIED" | "NOT_APPLICABLE" } = {},
) {
  const payload = toJson(d.payload);
  return tx.disputeCaseEvidence.create({
    data: {
      caseId: c.id,
      provenanceType: o.provenanceType ?? d.provenanceType,
      source: d.source,
      subject: d.subject,
      scopeSessionId: c.sessionId,
      scopeContractId: c.contractId,
      eventAt: d.eventAt,
      submittedBy: o.submittedBy ?? null,
      submittedRole: o.submittedRole ?? null,
      captureStatus: d.captureStatus,
      snapshotVersion: o.snapshotVersion ?? 1,
      contentHash: contentHashOf(payload),
      payload,
      sensitivity: d.sensitivity,
      verificationStatus: o.verificationStatus ?? d.verificationStatus ?? "NOT_APPLICABLE",
      supersedesId: o.supersedesId ?? null,
    },
  });
}

async function buildSnapshot(db: Db, caseId: string): Promise<SnapshotEntry[]> {
  const [ev, st] = await Promise.all([
    db.disputeCaseEvidence.findMany({ where: { caseId }, select: { id: true, contentHash: true, snapshotVersion: true } }),
    db.disputeCaseStatement.findMany({ where: { caseId }, select: { id: true, contentHash: true, version: true } }),
  ]);
  return [
    ...ev.map((e) => ({ id: e.id, hash: e.contentHash, version: e.snapshotVersion })),
    ...st.map((s) => ({ id: s.id, hash: s.contentHash, version: s.version })),
  ].sort((a, b) => a.id.localeCompare(b.id));
}

const statementHash = (s: { partyRole: string; version: number; text: string; supplementReason?: string | null }) =>
  contentHashOf({ partyRole: s.partyRole, version: s.version, text: s.text, supplementReason: s.supplementReason ?? null });

const slotKey = (source: string, subject: string) => `${source}\u0000${subject}`;

/** Heads (latest version) of the SYSTEM-collected evidence slots of a case. Party documents have unique subjects and are not slots. */
async function systemHeads(db: Db, caseId: string) {
  const rows = await db.disputeCaseEvidence.findMany({
    where: { caseId, submittedBy: null },
    select: { id: true, source: true, subject: true, contentHash: true, snapshotVersion: true },
  });
  const heads = new Map<string, { id: string; hash: string; version: number }>();
  for (const r of rows) {
    const k = slotKey(r.source, r.subject);
    const cur = heads.get(k);
    if (!cur || r.snapshotVersion > cur.version) heads.set(k, { id: r.id, hash: r.contentHash, version: r.snapshotVersion });
  }
  return heads;
}

// ── The service ──────────────────────────────────────────────────────────────────────────────────────────────────────

export const disputeCaseService = {
  // ── Intake ────────────────────────────────────────────────────────────────────────────────────────────────────────

  /**
   * Admin opens the case of a session that is DISPUTED or PT_NO_SHOW_REPORTED. Idempotent: an open case of the session is returned, not
   * duplicated (and the database enforces it with a partial unique index). Reads every source read-only; writes only dispute_case* rows.
   */
  async openCase(actor: Actor, sessionId: string, idempotencyKey?: string) {
    assertAdmin(actor);
    const key = fullKey(actor, "INTAKE", `INTAKE:${sessionId}`, idempotencyKey);
    const prior = await findReplay<{ created: boolean; case: ReturnType<typeof summary> }>(key, contentHashOf({ sessionId }));
    if (prior) return prior;

    const session = await prisma.session.findUnique({ where: { id: sessionId }, select: { id: true, status: true, disputeType: true, clientUserId: true, ptUserId: true } });
    if (!session) throw caseError(404, "SESSION_NOT_FOUND", "Không tìm thấy buổi tập");
    if (session.status !== "DISPUTED" && session.status !== "PT_NO_SHOW_REPORTED") {
      throw caseError(409, "SESSION_NOT_DISPUTED", "Chỉ mở hồ sơ cho buổi tập đang bị khiếu nại hoặc đang chờ PT phản hồi báo vắng mặt", { status: session.status });
    }
    if (actor.id === session.clientUserId || actor.id === session.ptUserId) {
      throw caseError(403, "CONFLICT_OF_INTEREST", "Quản trị viên là một bên của buổi tập này nên không được mở hồ sơ");
    }
    const open = await prisma.disputeCase.findFirst({ where: { sessionId, status: { notIn: [...TERMINAL_STATUSES] as any } } });
    if (open) return { result: { created: false, case: summary(open) }, replayed: false };
    const decided = await prisma.disputeCase.findFirst({ where: { sessionId, status: "DECISION_APPROVED" }, select: { id: true } });
    if (decided) {
      throw caseError(409, "CASE_DECISION_PENDING_EXECUTION", "Buổi tập này đã có hồ sơ được duyệt nhưng chưa được thực thi (Slice 2). Chưa mở hồ sơ mới", { caseId: decided.id });
    }
    const type = deriveCaseType(session.status, session.disputeType);
    if (!type) {
      throw caseError(409, "DISPUTE_TYPE_UNKNOWN", "Không xác định được loại hồ sơ cho buổi tập này");
    }
    const provisional = type === "LEGACY_UNCLASSIFIED";

    try {
      return await mutate({
        actor,
        action: "INTAKE",
        scope: `INTAKE:${sessionId}`,
        idempotencyKey,
        body: { sessionId },
        run: async (ctx) => {
          const collected = await collectSources(ctx.tx, sessionId);
          if (!collected) throw caseError(404, "SESSION_NOT_FOUND", "Không tìm thấy buổi tập");
          if (collected.session.status !== "DISPUTED" && collected.session.status !== "PT_NO_SHOW_REPORTED") {
            throw caseError(409, "SESSION_NOT_DISPUTED", "Buổi tập không còn ở trạng thái khiếu nại", { status: collected.session.status });
          }
          const created = await ctx.tx.disputeCase.create({
            data: {
              sessionId,
              contractId: collected.session.contractId,
              clientUserId: collected.session.clientUserId,
              ptUserId: collected.session.ptUserId,
              type,
              status: "INTAKE",
              createdBy: actor.id,
            },
          });
          for (const d of collected.evidence) await insertEvidence(ctx.tx, created, d);
          for (const s of collected.statements) {
            await ctx.tx.disputeCaseStatement.create({
              data: {
                caseId: created.id,
                partyRole: s.partyRole,
                authorUserId: s.authorUserId,
                version: 1,
                source: "LEGACY_FIELD",
                text: s.text,
                contentHash: statementHash({ partyRole: s.partyRole, version: 1, text: s.text }),
              },
            });
          }
          return {
            caseId: created.id,
            result: { created: true, case: summary(created) },
            // A session whose dispute_type is NULL is taken in as a PROVISIONAL classification; sessions.dispute_type is not written.
            ...(provisional ? { note: "Phân loại tạm: buổi tập chưa có loại khiếu nại (dispute_type rỗng). Điều tra viên cần phân loại trước khi ghi kết luận" } : {}),
            detail: { evidenceRows: collected.evidence.length, legacyStatements: collected.statements.length, ...(provisional ? { provisionalClassification: "LEGACY_UNCLASSIFIED" } : {}) },
          };
        },
      });
    } catch (e) {
      if (isUniqueViolation(e, "dispute_cases_one_open_per_session") || isUniqueViolation(e, "session_id")) {
        const existing = await prisma.disputeCase.findFirst({ where: { sessionId, status: { notIn: [...TERMINAL_STATUSES] as any } } });
        if (existing) return { result: { created: false, case: summary(existing) }, replayed: false };
      }
      throw e;
    }
  },

  /** Re-reads the same sources; appends a new version (snapshotVersion + 1, supersedesId) only for a slot whose hash changed. */
  async recollect(actor: Actor, caseId: string, idempotencyKey?: string) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: "RECOLLECT",
      scope: caseId,
      idempotencyKey,
      body: {},
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        if (isTerminal(c.status as CaseStatus)) throw stateNotAllowed(c, []);
        const collected = await collectSources(ctx.tx, c.sessionId);
        if (!collected) throw caseError(404, "SESSION_NOT_FOUND", "Không tìm thấy buổi tập");
        const heads = await systemHeads(ctx.tx, c.id);
        let added = 0;
        let unchanged = 0;
        for (const d of collected.evidence) {
          const head = heads.get(slotKey(d.source, d.subject));
          const hash = draftHash(d);
          if (head && head.hash === hash) {
            unchanged += 1;
            continue;
          }
          await insertEvidence(ctx.tx, c, d, { snapshotVersion: head ? head.version + 1 : 1, supersedesId: head?.id ?? null });
          added += 1;
        }
        return { caseId: c.id, result: { added, unchanged }, detail: { added, unchanged } };
      },
    });
  },

  // ── Assignment & status ───────────────────────────────────────────────────────────────────────────────────────────

  async assign(actor: Actor, caseId: string, investigatorId: string | undefined, idempotencyKey?: string) {
    assertAdmin(actor);
    const target = investigatorId ?? actor.id;
    return mutate({
      actor,
      action: "ASSIGN",
      scope: caseId,
      idempotencyKey,
      body: { investigatorId: target },
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        if (isTerminal(c.status as CaseStatus)) throw stateNotAllowed(c, []);
        if (target === c.clientUserId || target === c.ptUserId) {
          throw caseError(403, "CONFLICT_OF_INTEREST", "Một bên của vụ việc không được làm điều tra viên");
        }
        await casData(ctx, c, { investigatorId: target });
        return { caseId: c.id, result: { investigatorId: target, version: c.version }, detail: { investigatorId: target } };
      },
    });
  },

  /**
   * The generic status move (COLLECTING / AWAITING_PARTIES / ASSESSING / TECH_RECONCILIATION / REJECTED_INTAKE). Before an investigator is
   * assigned (INTAKE) any admin may move the case; afterwards only the assigned investigator.
   */
  async transition(actor: Actor, caseId: string, to: CaseStatus, o: { reason?: string; note?: string }, idempotencyKey?: string) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: "TRANSITION",
      scope: caseId,
      idempotencyKey,
      body: { to, reason: o.reason ?? null, note: o.note ?? null },
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        if (isTerminal(c.status as CaseStatus)) throw stateNotAllowed(c, []);
        if (c.status !== "INTAKE") assertInvestigator(actor, c);
        if (!canTransitionManually(c.status as CaseStatus, to)) throw stateNotAllowed(c, []);
        if (to === "REJECTED_INTAKE" && !o.reason) throw caseError(400, "REASON_REQUIRED", "Cần nhập lý do từ chối hồ sơ");
        const from = c.status;
        await casStatus(ctx, c, to, o.reason ?? o.note);
        return { caseId: c.id, result: { from, to, version: c.version }, note: o.reason ?? o.note };
      },
    });
  },

  /** Investigator asks for more material: back to COLLECTING / AWAITING_PARTIES with the note recorded. */
  async requestMore(actor: Actor, caseId: string, to: "COLLECTING" | "AWAITING_PARTIES", note: string, idempotencyKey?: string) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: "REQUEST_MORE",
      scope: caseId,
      idempotencyKey,
      body: { to, note },
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        assertInvestigator(actor, c);
        if (!["ASSESSING", "TECH_RECONCILIATION", "POLICY_PENDING"].includes(c.status)) throw stateNotAllowed(c, ["ASSESSING", "TECH_RECONCILIATION", "POLICY_PENDING"]);
        const from = c.status;
        // POLICY_PENDING / TECH_RECONCILIATION cannot go straight to AWAITING_PARTIES: step through COLLECTING first.
        if (!canTransition(c.status as CaseStatus, to)) {
          await casStatus(ctx, c, "COLLECTING", note);
          if (to === "AWAITING_PARTIES") await casStatus(ctx, c, "AWAITING_PARTIES", note);
        } else {
          await casStatus(ctx, c, to, note);
        }
        return { caseId: c.id, result: { from, to: c.status, version: c.version }, note };
      },
    });
  },

  // ── Investigation records (investigator only) ─────────────────────────────────────────────────────────────────────

  /**
   * Investigator classifies a provisional LEGACY_UNCLASSIFIED case into one of the three real types (event CLASSIFIED). It writes the case row
   * only: sessions.dispute_type is never touched.
   */
  async classify(actor: Actor, caseId: string, type: CaseType, idempotencyKey?: string) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: "CLASSIFIED",
      scope: caseId,
      idempotencyKey,
      body: { type },
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        assertInvestigator(actor, c);
        if (isTerminal(c.status as CaseStatus)) throw stateNotAllowed(c, []);
        if (!CLASSIFIABLE_TYPES.includes(type)) throw caseError(400, "TYPE_NOT_ALLOWED", "Loại hồ sơ không hợp lệ");
        if (c.type !== "LEGACY_UNCLASSIFIED") {
          throw caseError(409, "ALREADY_CLASSIFIED", "Hồ sơ này đã có loại, không phân loại lại", { type: c.type });
        }
        const from = c.type;
        await casData(ctx, c, { type: type as any });
        return { caseId: c.id, result: { from, to: type, version: c.version }, note: `Phân loại: ${from} -> ${type}`, detail: { from, to: type } };
      },
    });
  },

  async addClaim(actor: Actor, caseId: string, b: { claimantRole: string; text: string; moves: string[] }, idempotencyKey?: string) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: "CLAIM_ADDED",
      scope: caseId,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        assertInvestigator(actor, c);
        if (!INVESTIGATION_STATUSES.includes(c.status as CaseStatus)) throw stateNotAllowed(c, INVESTIGATION_STATUSES);
        const row = await ctx.tx.disputeCaseClaim.create({
          data: { caseId: c.id, claimantRole: b.claimantRole as any, text: b.text, moves: [...new Set(b.moves)], createdBy: actor.id },
        });
        return { caseId: c.id, result: { id: row.id } };
      },
    });
  },

  async addIssue(actor: Actor, caseId: string, b: { kind: string; finding: string; note?: string }, idempotencyKey?: string) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: "ISSUE_RECORDED",
      scope: caseId,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        assertInvestigator(actor, c);
        if (!INVESTIGATION_STATUSES.includes(c.status as CaseStatus)) throw stateNotAllowed(c, INVESTIGATION_STATUSES);
        // Record only: a PT_LATE finding is a note on the case. It starts nothing (no D77 step, no money).
        const row = await ctx.tx.disputeCaseIssue.create({
          data: { caseId: c.id, kind: b.kind as any, finding: b.finding as any, note: b.note ?? "", recordedBy: actor.id },
        });
        return { caseId: c.id, result: { id: row.id } };
      },
    });
  },

  async addAssessment(
    actor: Actor,
    caseId: string,
    b: {
      claimId: string;
      directEvidenceIds: string[];
      indirectEvidenceIds: string[];
      rebuttalEvidenceIds: string[];
      relevanceNote: string;
      verifiabilityNote: string;
      consistencyNote: string;
      result: string;
      reasoning: string;
    },
    idempotencyKey?: string,
  ) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: "ASSESSMENT_RECORDED",
      scope: caseId,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        assertInvestigator(actor, c);
        if (c.status !== "ASSESSING") throw stateNotAllowed(c, ["ASSESSING"]);
        const claim = await ctx.tx.disputeCaseClaim.findFirst({ where: { id: b.claimId, caseId: c.id }, select: { id: true } });
        if (!claim) throw caseError(404, "CLAIM_NOT_FOUND", "Không tìm thấy khẳng định trong hồ sơ này");
        const all = [...b.directEvidenceIds, ...b.indirectEvidenceIds, ...b.rebuttalEvidenceIds];
        if (new Set(all).size !== all.length) {
          throw caseError(400, "EVIDENCE_LISTED_TWICE", "Một bằng chứng chỉ được xếp vào một nhóm (trực tiếp, gián tiếp hoặc phản bác)");
        }
        if (all.length) {
          const [ev, st] = await Promise.all([
            ctx.tx.disputeCaseEvidence.findMany({ where: { caseId: c.id, id: { in: all } }, select: { id: true } }),
            ctx.tx.disputeCaseStatement.findMany({ where: { caseId: c.id, id: { in: all } }, select: { id: true } }),
          ]);
          if (ev.length + st.length !== all.length) throw caseError(404, "EVIDENCE_NOT_FOUND", "Có bằng chứng không thuộc hồ sơ này");
        }
        const row = await ctx.tx.disputeCaseAssessment.create({
          data: {
            caseId: c.id,
            claimId: b.claimId,
            assessorId: actor.id,
            directEvidenceIds: b.directEvidenceIds,
            indirectEvidenceIds: b.indirectEvidenceIds,
            rebuttalEvidenceIds: b.rebuttalEvidenceIds,
            relevanceNote: b.relevanceNote,
            verifiabilityNote: b.verifiabilityNote,
            consistencyNote: b.consistencyNote,
            result: b.result as any,
            reasoning: b.reasoning,
            evidenceSnapshot: toJson(await buildSnapshot(ctx.tx, c.id)),
          },
        });
        return { caseId: c.id, result: { id: row.id } };
      },
    });
  },

  /**
   * Records the finding (investigation completed = FINDING_RECORDED). INSUFFICIENT_EVIDENCE continues to POLICY_PENDING in the same
   * transaction (it decides nothing). NOT_A_DISPUTE is recorded and the case stays FINDING_RECORDED: no proposal exists for it (DESIGN_REQUIRED).
   */
  async recordFinding(actor: Actor, caseId: string, b: { finding: FindingKind; reasoning: string }, idempotencyKey?: string) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: "FINDING_RECORDED",
      scope: caseId,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        assertInvestigator(actor, c);
        if (c.status !== "ASSESSING") throw stateNotAllowed(c, ["ASSESSING"]);
        if (c.type === "LEGACY_UNCLASSIFIED") throw classificationRequired();
        if (b.finding !== "NOT_A_DISPUTE") {
          const claims = await ctx.tx.disputeCaseClaim.findMany({ where: { caseId: c.id }, select: { id: true } });
          const assessed = new Set((await ctx.tx.disputeCaseAssessment.findMany({ where: { caseId: c.id }, select: { claimId: true } })).map((a) => a.claimId));
          if (claims.length === 0 || claims.some((cl) => !assessed.has(cl.id))) {
            throw caseError(409, "ASSESSMENT_REQUIRED", "Cần có ít nhất một khẳng định và mỗi khẳng định phải được đánh giá trước khi ghi kết luận");
          }
        }
        const previous = await ctx.tx.disputeCaseFinding.findFirst({ where: { caseId: c.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
        const row = await ctx.tx.disputeCaseFinding.create({
          data: { caseId: c.id, finding: b.finding, reasoning: b.reasoning, recordedBy: actor.id, supersedesId: previous?.id ?? null },
        });
        await casStatus(ctx, c, "FINDING_RECORDED", b.reasoning);
        if (b.finding === "INSUFFICIENT_EVIDENCE") await casStatus(ctx, c, "POLICY_PENDING", "INSUFFICIENT_EVIDENCE: chờ chính sách, không tự quy kết quả");
        return {
          caseId: c.id,
          result: {
            id: row.id,
            finding: b.finding,
            caseStatus: c.status,
            proposalPossible: outcomeForFinding(b.finding) !== null,
            ...(b.finding === "NOT_A_DISPUTE" ? { blocked: "DESIGN_REQUIRED" } : {}),
          },
          note: b.reasoning,
        };
      },
    });
  },

  /**
   * Builds the proposal. The outcome is computed here from the latest finding (never read from the request). B-1: a session with any trace
   * of PT_LATE_ARRIVAL:<sessionId> gets executionBlockedReason = D77_COMBINATION_UNRESOLVED for ALL three outcomes; the case still goes on.
   */
  async propose(actor: Actor, caseId: string, note: string | undefined, idempotencyKey?: string) {
    assertAdmin(actor);
    requireUuid(caseId);
    const pre = await prisma.disputeCase.findUnique({ where: { id: caseId }, select: { sessionId: true, status: true, investigatorId: true } });
    if (!pre) throw notFoundCase();
    // The ledger is asked BEFORE the transaction opens (a network call must not hold the case lock); the settlement row is re-read inside it.
    // Only worth asking when the caller could actually propose; if the case reaches that state under us, run() asks for a retry.
    const askLedger = pre.status === "FINDING_RECORDED" && pre.investigatorId === actor.id;
    let late: { exists: boolean } = { exists: false };
    if (askLedger) {
      const r = await hasLateArrivalStep(prisma, pre.sessionId);
      if ("unknown" in r) {
        throw caseError(503, "PAYMENT_UNAVAILABLE", "Chưa đọc được sổ cái để kiểm tra khoản đền đến muộn của buổi này. Vui lòng thử lại sau");
      }
      late = r;
    }
    return mutate<Record<string, any>>({
      actor,
      action: "PROPOSAL_CREATED",
      scope: caseId,
      idempotencyKey,
      body: { note: note ?? null },
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        assertInvestigator(actor, c);
        if (c.status !== "FINDING_RECORDED") throw stateNotAllowed(c, ["FINDING_RECORDED"]);
        if (c.type === "LEGACY_UNCLASSIFIED") throw classificationRequired();
        if (!askLedger) throw versionConflict(); // reached FINDING_RECORDED after the ledger check was skipped: ask again
        const finding = await ctx.tx.disputeCaseFinding.findFirst({ where: { caseId: c.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
        if (!finding) throw caseError(409, "FINDING_REQUIRED", "Chưa có kết luận để đề xuất");
        const outcome = outcomeForFinding(finding.finding as FindingKind);
        if (!outcome) {
          if (finding.finding === "NOT_A_DISPUTE") {
            throw caseError(409, "DESIGN_REQUIRED", "Kết luận 'không phải khiếu nại' chưa có thiết kế xử lý (DESIGN_REQUIRED), nên chưa tạo đề xuất");
          }
          throw caseError(409, "NO_PROPOSAL_FOR_FINDING", "Kết luận này không tạo đề xuất");
        }
        const lateNow = late.exists || !!(await ctx.tx.sessionSettlement.findUnique({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${c.sessionId}` }, select: { id: true } }));
        if (outcome === "CANCELLED" && lateNow) {
          // I6 = A (Ngai, 31/10): a session with a D77 late-arrival compensation cannot be ruled CANCELLED. No proposal is created (so nothing can be
          // approved or executed); the case waits for policy / a verification of the late arrival. Nothing is written to the session, quota or money.
          const reason = "I6: buổi có khoản đền đến muộn (D77) không thể phán quyết HUỶ. Chờ xác minh khoản đền đến muộn / chính sách, chưa tạo đề xuất";
          await casStatus(ctx, c, "POLICY_PENDING", reason);
          return {
            caseId: c.id,
            result: { policyPending: true, blocked: CANCELLED_BLOCKED_BY_D77, caseStatus: c.status, reason, nextStep: "Xác minh khoản đền đến muộn của buổi rồi ghi kết luận khác, hoặc chờ quyết định chính sách" },
            note: reason,
          };
        }
        const proposal = await ctx.tx.disputeCaseProposal.create({
          data: {
            caseId: c.id,
            findingId: finding.id,
            outcome,
            proposerId: actor.id,
            executionBlockedReason: lateNow ? D77_BLOCK_REASON : null,
            evidenceSnapshot: toJson(await buildSnapshot(ctx.tx, c.id)),
          },
        });
        await casStatus(ctx, c, "PROPOSED", note);
        await casStatus(ctx, c, "AWAITING_APPROVAL", note);
        return {
          caseId: c.id,
          result: { id: proposal.id, outcome, executionBlockedReason: proposal.executionBlockedReason, caseStatus: c.status, execution: EXECUTION_BLOCKED_SLICE1 },
          note,
        };
      },
    });
  },

  /**
   * D-NEW-12: the assigned investigator PROPOSES whether the case's contract falls under the current policy. ONE contract (the case's own), at least one evidence row of THIS case,
   * reasoning required. Nothing is approved by this call. A new review may name the one it supersedes (it must be of the same contract).
   */
  async proposePolicyEligibility(
    actor: Actor,
    caseId: string,
    b: { result: "ELIGIBLE_CURRENT_POLICY" | "EXCEPTION_APPLIES"; evidenceIds: string[]; reasoning: string; supersedesId?: string },
    idempotencyKey?: string,
  ) {
    assertAdmin(actor);
    return mutate<Record<string, any>>({
      actor,
      action: "POLICY_ELIGIBILITY_PROPOSED",
      scope: caseId,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        assertInvestigator(actor, c);
        if (c.type === "LEGACY_UNCLASSIFIED") throw classificationRequired();
        if (c.status === "INTAKE" || c.status === "REJECTED_INTAKE") throw stateNotAllowed(c, ["COLLECTING", "ASSESSING", "FINDING_RECORDED", "POLICY_PENDING", "PROPOSED", "AWAITING_APPROVAL", "DECISION_APPROVED"]);
        const ids = [...new Set(b.evidenceIds)];
        if (ids.length === 0) throw caseError(422, "EVIDENCE_REQUIRED", "Cần ít nhất một bằng chứng của hồ sơ này");
        const found = await ctx.tx.disputeCaseEvidence.count({ where: { caseId: c.id, id: { in: ids } } });
        if (found !== ids.length) throw caseError(422, "EVIDENCE_NOT_IN_CASE", "Có bằng chứng không thuộc hồ sơ này");
        if (b.supersedesId) {
          const prev = await ctx.tx.disputeCasePolicyEligibilityReview.findUnique({ where: { id: b.supersedesId } });
          if (!prev || prev.contractId !== c.contractId) throw caseError(422, "SUPERSEDES_INVALID", "Kết luận được thay thế phải là của cùng hợp đồng");
        }
        const row = await ctx.tx.disputeCasePolicyEligibilityReview.create({
          data: { caseId: c.id, contractId: c.contractId, result: b.result, evidenceIds: ids, reasoning: b.reasoning, proposedBy: actor.id, supersedesId: b.supersedesId ?? null },
        });
        // Q4: the append-only DisputeCaseEvent written by mutate() in THIS transaction is the audit of the proposal (who, which result, which evidence, what it supersedes).
        return { caseId: c.id, result: { reviewId: row.id, result: row.result, contractId: c.contractId, approved: false }, note: b.reasoning, detail: { reviewId: row.id, contractId: c.contractId, result: row.result, evidenceIds: ids, supersedesId: b.supersedesId ?? null } };
      },
    });
  },

  /**
   * D-NEW-12: an INDEPENDENT admin approves the proposal (same four-eyes and conflict-of-interest rules as the decision: not the proposer, not the case's investigator, not a party,
   * must declare no conflict). One call approves ONE review. The approval is the one-time stamp of the append-only row.
   */
  async approvePolicyEligibility(actor: Actor, caseId: string, reviewId: string, b: { reason: string; conflictOfInterestDeclaredNone: boolean }, idempotencyKey?: string) {
    assertAdmin(actor);
    requireUuid(reviewId);
    return mutate<Record<string, any>>({
      actor,
      action: "POLICY_ELIGIBILITY_APPROVED",
      scope: `${caseId}:${reviewId}`,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        const row = await ctx.tx.disputeCasePolicyEligibilityReview.findUnique({ where: { id: reviewId } });
        if (!row || row.caseId !== c.id) throw caseError(404, "POLICY_REVIEW_NOT_FOUND", "Không tìm thấy kết luận chính sách của hồ sơ này");
        const verdict = checkApprover({
          approverId: actor.id,
          approverRole: actor.role,
          proposerId: row.proposedBy,
          investigatorId: c.investigatorId,
          clientUserId: c.clientUserId,
          ptUserId: c.ptUserId,
          conflictOfInterestDeclaredNone: b.conflictOfInterestDeclaredNone,
        });
        if (!verdict.ok) throw caseError(verdict.status, verdict.code, verdict.message);
        if (row.approvedAt) throw caseError(409, "POLICY_REVIEW_ALREADY_APPROVED", "Kết luận chính sách này đã được duyệt");
        const stamped = await ctx.tx.disputeCasePolicyEligibilityReview.updateMany({ where: { id: row.id, approvedAt: null }, data: { approvedBy: actor.id, approvedAt: new Date() } });
        if (stamped.count !== 1) throw versionConflict();
        // Q4: the append-only event of THIS transaction is the audit of the one-time approval: the approver is the authenticated actor (event.actor_user_id), the proposer is recorded next to it.
        return { caseId: c.id, result: { reviewId: row.id, result: row.result, contractId: row.contractId, approved: true }, note: b.reason, detail: { reviewId: row.id, contractId: row.contractId, result: row.result, proposedBy: row.proposedBy, approvedBy: actor.id, conflictOfInterestDeclaredNone: b.conflictOfInterestDeclaredNone } };
      },
    });
  },

  /** Investigator acknowledges that evidence changed after the proposal; the approver's `evidenceChangeAcknowledged` is only honoured after this. */
  async acknowledgeEvidenceChange(actor: Actor, caseId: string, note: string, idempotencyKey?: string) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: "EVIDENCE_CHANGE_ACK",
      scope: caseId,
      idempotencyKey,
      body: { note },
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        assertInvestigator(actor, c);
        if (c.status !== "AWAITING_APPROVAL") throw stateNotAllowed(c, ["AWAITING_APPROVAL"]);
        const proposal = await ctx.tx.disputeCaseProposal.findFirst({ where: { caseId: c.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
        if (!proposal) throw caseError(409, "PROPOSAL_REQUIRED", "Chưa có đề xuất");
        const guard = await evidenceGuard(ctx.tx, c, proposal.evidenceSnapshot as unknown as SnapshotEntry[]);
        return {
          caseId: c.id,
          result: { acknowledged: true, changedIds: guard.newIds, staleLive: guard.staleLive },
          note,
          detail: { changedIds: guard.newIds, staleLive: guard.staleLive },
        };
      },
    });
  },

  async share(actor: Actor, caseId: string, b: { evidenceId?: string; statementId?: string; sharedWithRole: string; reason: string }, idempotencyKey?: string) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: "SHARED",
      scope: caseId,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        assertInvestigator(actor, c);
        if (isTerminal(c.status as CaseStatus) || c.status === "INTAKE") throw stateNotAllowed(c, []);
        if (b.evidenceId) {
          const ev = await ctx.tx.disputeCaseEvidence.findFirst({
            where: { id: b.evidenceId, caseId: c.id },
            select: { id: true, sensitivity: true, submittedBy: true, submittedRole: true, verificationStatus: true },
          });
          if (!ev) throw caseError(404, "EVIDENCE_NOT_FOUND", "Không tìm thấy bằng chứng trong hồ sơ này");
          // Hardening P0: evidence a party submitted about itself (unverified), anything not server-verified, anything not NORMAL: never handed over.
          const refusal = shareRefusalReason(ev);
          if (refusal) {
            throw caseError(
              409,
              "PARTY_EVIDENCE_SHARE_DESIGN_REQUIRED",
              "Bằng chứng do một bên tự nộp, chưa được máy chủ xác minh hoặc có mức nhạy cảm cao chưa được chia sẻ cho bên kia (chưa có thiết kế xác minh và che thông tin, DESIGN_REQUIRED)",
              { reason: refusal },
            );
          }
        } else {
          const st = await ctx.tx.disputeCaseStatement.findFirst({ where: { id: b.statementId!, caseId: c.id }, select: { id: true } });
          if (!st) throw caseError(404, "STATEMENT_NOT_FOUND", "Không tìm thấy lời khai trong hồ sơ này");
        }
        const row = await ctx.tx.disputeCaseShare.create({
          data: {
            caseId: c.id,
            evidenceId: b.evidenceId ?? null,
            statementId: b.statementId ?? null,
            sharedWithRole: b.sharedWithRole as any,
            sharedBy: actor.id,
            reason: b.reason,
          },
        });
        return { caseId: c.id, result: { id: row.id }, note: b.reason };
      },
    });
  },

  // ── Four-eyes decision ────────────────────────────────────────────────────────────────────────────────────────────

  async decide(
    actor: Actor,
    caseId: string,
    b: { result: "APPROVED" | "REJECTED"; reason: string; conflictOfInterestDeclaredNone: boolean; evidenceChangeAcknowledged: boolean },
    idempotencyKey?: string,
  ) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: b.result === "APPROVED" ? "DECISION_APPROVED" : "DECISION_REJECTED",
      scope: caseId,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        if (c.status !== "AWAITING_APPROVAL") throw stateNotAllowed(c, ["AWAITING_APPROVAL"]);
        if (c.type === "LEGACY_UNCLASSIFIED") throw classificationRequired(); // no approval (or rejection) while the type is provisional
        const proposal = await ctx.tx.disputeCaseProposal.findFirst({ where: { caseId: c.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
        if (!proposal) throw caseError(409, "PROPOSAL_REQUIRED", "Chưa có đề xuất để duyệt");
        const verdict = checkApprover({
          approverId: actor.id,
          approverRole: actor.role,
          proposerId: proposal.proposerId,
          investigatorId: c.investigatorId,
          clientUserId: c.clientUserId,
          ptUserId: c.ptUserId,
          conflictOfInterestDeclaredNone: b.conflictOfInterestDeclaredNone,
        });
        if (!verdict.ok) throw caseError(verdict.status, verdict.code, verdict.message);

        if (b.result === "APPROVED") {
          // Evidence-change guard, inside the SAME transaction as the CAS to DECISION_APPROVED (§1.6.4).
          const guard = await evidenceGuard(ctx.tx, c, proposal.evidenceSnapshot as unknown as SnapshotEntry[]);
          if (guard.changed) {
            const ackTimes = await ackTimesOf(ctx.tx, c);
            if (!changeAcknowledged(guard, b.evidenceChangeAcknowledged, ackTimes)) {
              throw caseError(
                409,
                "EVIDENCE_CHANGED",
                "Bằng chứng đã thay đổi sau khi đề xuất được lập. Điều tra viên cần xác nhận thay đổi và người duyệt cần tích xác nhận trước khi duyệt",
                { changedIds: guard.newIds, staleLive: guard.staleLive, needsRecollect: guard.staleLive.length > 0 },
              );
            }
          }
          await casStatus(ctx, c, "DECISION_APPROVED", b.reason);
        } else {
          await casStatus(ctx, c, "ASSESSING", b.reason);
        }
        const approval = await ctx.tx.disputeCaseApproval.create({
          data: {
            proposalId: proposal.id,
            approverId: actor.id,
            result: b.result,
            reason: b.reason,
            conflictOfInterestDeclaredNone: b.conflictOfInterestDeclaredNone,
            evidenceChangeAcknowledged: b.evidenceChangeAcknowledged,
          },
        });
        return {
          caseId: c.id,
          result: {
            approvalId: approval.id,
            result: b.result,
            caseStatus: c.status,
            outcome: proposal.outcome,
            // Slice 1 NEVER executes: no session, quota, settlement or ledger row is touched by an approval.
            ...(b.result === "APPROVED" ? { execution: EXECUTION_BLOCKED_SLICE1, executionBlockedReason: proposal.executionBlockedReason } : {}),
          },
          note: b.reason,
        };
      },
    });
  },

  // ── Reads (admin) ─────────────────────────────────────────────────────────────────────────────────────────────────

  async list(actor: Actor, q: { status?: string; limit: number; offset: number }) {
    assertAdmin(actor);
    const where = q.status ? { status: q.status as any } : {};
    const [rows, total] = await Promise.all([
      prisma.disputeCase.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "asc" }], take: q.limit, skip: q.offset }),
      prisma.disputeCase.count({ where }),
    ]);
    await logAccess(prisma, rows.map((r) => ({ caseId: r.id, viewer: actor, action: "VIEW_CASE" as const })));
    return { total, items: rows.map(summary) };
  },

  async getForAdmin(actor: Actor, caseId: string) {
    assertAdmin(actor);
    requireUuid(caseId);
    const c = await prisma.disputeCase.findUnique({ where: { id: caseId } });
    if (!c) throw notFoundCase();
    const [claims, issues, evidence, statements, shares, assessments, findings, proposals, events] = await Promise.all([
      prisma.disputeCaseClaim.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.disputeCaseIssue.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.disputeCaseEvidence.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.disputeCaseStatement.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.disputeCaseShare.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.disputeCaseAssessment.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.disputeCaseFinding.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.disputeCaseProposal.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { approvals: { orderBy: { createdAt: "asc" } } } }),
      prisma.disputeCaseEvent.findMany({ where: { caseId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 200 }),
    ]);
    const financial = await buildFinancialView(prisma, c.sessionId);
    await logAccess(prisma, [
      { caseId, viewer: actor, action: "VIEW_CASE" as const },
      ...evidence.map((e) => ({ caseId, viewer: actor, action: "VIEW_EVIDENCE" as const, evidenceId: e.id })),
    ]);
    const approved = proposals.find((p) => p.approvals.some((a) => a.result === "APPROVED"));
    return {
      case: summary(c),
      claims,
      issues,
      // The admin sees plainly which rows are a party's unverified claim (effective status even for a row written before the column existed).
      evidence: evidence.map((e) => ({ ...e, verificationStatus: effectiveVerificationStatus(e), partySubmitted: isPartySubmitted(e), provenanceLabel: provenanceLabelVi(e.provenanceType) })),
      statements,
      shares,
      assessments,
      findings,
      proposals: proposals.map((p) => ({ ...p, execution: EXECUTION_BLOCKED_SLICE1 })),
      decision: approved ? { proposalId: approved.id, outcome: approved.outcome, execution: EXECUTION_BLOCKED_SLICE1, executionBlockedReason: approved.executionBlockedReason } : null,
      events: events.map((e) => ({ ...e, payload: undefined })),
      financial,
    };
  },

  // ── Parties (client / PT) ─────────────────────────────────────────────────────────────────────────────────────────

  async listForParty(actor: Actor) {
    const rows = await prisma.disputeCase.findMany({
      where: { OR: [{ clientUserId: actor.id }, { ptUserId: actor.id }] },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      take: 100,
    });
    await logAccess(prisma, rows.map((r) => ({ caseId: r.id, viewer: actor, action: "VIEW_CASE" as const })));
    return {
      items: rows.map((r) => ({ id: r.id, sessionId: r.sessionId, type: r.type, status: r.status, role: partyRoleOf(actor.id, r), createdAt: r.createdAt })),
    };
  },

  /** A case the user is not a party of does not exist for them (404, not 403). */
  async getForParty(actor: Actor, caseId: string) {
    requireUuid(caseId);
    const c = await prisma.disputeCase.findUnique({ where: { id: caseId } });
    const role = c ? partyRoleOf(actor.id, c) : null;
    if (!c || !role) throw notFoundCase();
    const viewer = { userId: actor.id, role };
    const [claims, evidenceAll, statementsAll, shares] = await Promise.all([
      prisma.disputeCaseClaim.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.disputeCaseEvidence.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.disputeCaseStatement.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.disputeCaseShare.findMany({ where: { caseId } }),
    ]);
    const evidence = evidenceAll.filter((e) => evidenceVisibleToParty(e, viewer, shares));
    const statements = statementsAll.filter((s) => statementVisibleToParty(s, viewer, shares));
    const financial = partyFinancialView(await buildFinancialView(prisma, c.sessionId));
    await logAccess(prisma, [
      { caseId, viewer: actor, action: "VIEW_CASE" as const },
      ...evidence.map((e) => ({ caseId, viewer: actor, action: "VIEW_EVIDENCE" as const, evidenceId: e.id })),
    ]);
    return {
      case: { id: c.id, sessionId: c.sessionId, type: c.type, status: c.status, role, createdAt: c.createdAt, canSubmit: PARTY_SUBMIT_STATUSES.includes(c.status as CaseStatus) },
      accusations: claims.map((cl) => ({ id: cl.id, claimantRole: cl.claimantRole, text: cl.text, moves: cl.moves })),
      evidence: evidence.map((e) => ({
        id: e.id,
        provenanceType: e.provenanceType,
        source: e.source,
        subject: e.subject,
        eventAt: e.eventAt,
        capturedAt: e.capturedAt,
        captureStatus: e.captureStatus,
        snapshotVersion: e.snapshotVersion,
        payload: e.payload,
        verificationStatus: effectiveVerificationStatus(e),
        mine: e.submittedBy === actor.id,
      })),
      statements: statements.map((s) => ({
        id: s.id,
        partyRole: s.partyRole,
        version: s.version,
        source: s.source,
        text: s.text,
        supplementReason: s.supplementReason,
        createdAt: s.createdAt,
        mine: s.authorUserId === actor.id,
      })),
      financial,
    };
  },

  /** A party's statement. Version is computed here: version > 1 needs a supplement reason. A PT under restriction may still submit (no restriction check on purpose). */
  async submitStatement(actor: Actor, caseId: string, b: { text: string; supplementReason?: string }, idempotencyKey?: string) {
    requireUuid(caseId);
    try {
      return await mutate({
        actor,
        action: "STATEMENT_SUBMITTED",
        scope: caseId,
        idempotencyKey,
        body: b,
        run: async (ctx) => {
          const c = await lockCase(ctx.tx, caseId);
          const role = partyRoleOf(actor.id, c);
          if (!role) throw notFoundCase();
          if (!PARTY_SUBMIT_STATUSES.includes(c.status as CaseStatus)) throw stateNotAllowed(c, PARTY_SUBMIT_STATUSES);
          const latest = await ctx.tx.disputeCaseStatement.findFirst({ where: { caseId: c.id, partyRole: role }, orderBy: { version: "desc" } });
          const version = (latest?.version ?? 0) + 1;
          if (version > 1 && !b.supplementReason) {
            throw caseError(400, "SUPPLEMENT_REASON_REQUIRED", "Bổ sung lời khai cần ghi rõ lý do bổ sung");
          }
          const row = await ctx.tx.disputeCaseStatement.create({
            data: {
              caseId: c.id,
              partyRole: role,
              authorUserId: actor.id,
              version,
              source: "SUBMITTED",
              text: b.text,
              supplementReason: version > 1 ? b.supplementReason! : null,
              supersedesId: latest?.id ?? null,
              contentHash: statementHash({ partyRole: role, version, text: b.text, supplementReason: version > 1 ? b.supplementReason : null }),
            },
          });
          return { caseId: c.id, result: { id: row.id, version } };
        },
      });
    } catch (e) {
      if (isUniqueViolation(e, "dispute_case_statements_unique_version") || isUniqueViolation(e, "version")) {
        throw caseError(409, "STATEMENT_VERSION_CONFLICT", "Lời khai vừa được gửi từ nơi khác. Vui lòng tải lại rồi bổ sung");
      }
      throw e;
    }
  },

  /** EXTERNAL_DOCUMENT metadata: a description and the document's sha256 as the party computed it. No file is stored in Slice 1. */
  async submitEvidence(actor: Actor, caseId: string, b: { description: string; sha256: string; title?: string; fileName?: string }, idempotencyKey?: string) {
    requireUuid(caseId);
    return mutate({
      actor,
      action: "EVIDENCE_SUBMITTED",
      scope: caseId,
      idempotencyKey,
      body: b,
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        const role = partyRoleOf(actor.id, c);
        if (!role) throw notFoundCase();
        if (!PARTY_SUBMIT_STATUSES.includes(c.status as CaseStatus)) throw stateNotAllowed(c, PARTY_SUBMIT_STATUSES);
        const row = await insertEvidence(
          ctx.tx,
          c,
          {
            provenanceType: "SERVER_OBSERVED",
            source: "party.external_document",
            subject: `PARTY_DOC:${randomUUID()}`,
            eventAt: null,
            captureStatus: "OK",
            // Hardening P0: always RESTRICTED + CLIENT_CLAIMED_UNVERIFIED, whatever the request says (the body schema is strict).
            sensitivity: "RESTRICTED",
            payload: {
              description: b.description,
              declaredSha256: b.sha256.toLowerCase(),
              // The hash is the party's own claim; no file reached the server (and file storage is DESIGN_REQUIRED).
              hashStatus: "CLIENT_CLAIMED_UNVERIFIED",
              fileStored: false,
              title: b.title ?? null,
              fileName: b.fileName ?? null,
              fileStorage: "DESIGN_REQUIRED",
              declaredBy: role,
            },
          },
          { submittedBy: actor.id, submittedRole: role, provenanceType: "EXTERNAL_DOCUMENT", verificationStatus: "CLIENT_CLAIMED_UNVERIFIED" },
        );
        return { caseId: c.id, result: { id: row.id } };
      },
    });
  },

  /**
   * Slice 2 / S2.8 (dev / test only, flag DISPUTE_CASE_EVIDENCE_STORAGE_ENABLED): a party uploads an evidence FILE. The server decides the type from the bytes,
   * caps the size, stores it under an opaque key and computes the sha256 itself: the row is SERVER_VERIFIED - for the file bytes only. Whatever the party says
   * about the file stays their claim; the row is still RESTRICTED and a party-submitted row can NEVER be shared with the other side (share -> 409).
   */
  async submitEvidenceFile(
    actor: Actor,
    caseId: string,
    f: { bytes: Buffer; declaredMime: string; originalName?: string; description: string; title?: string },
    idempotencyKey?: string,
  ) {
    if (!evidenceStorageEnabled()) throw caseError(404, "FEATURE_DISABLED", "Chức năng lưu tệp bằng chứng chưa được bật");
    requireUuid(caseId);
    if (f.bytes.length === 0) throw caseError(400, "EMPTY_FILE", "Tệp rỗng");
    if (f.bytes.length > MAX_EVIDENCE_BYTES) throw caseError(413, "FILE_TOO_LARGE", `Tệp vượt quá ${MAX_EVIDENCE_BYTES / (1024 * 1024)} MB`);
    const sniffed = sniffMime(f.bytes);
    if (!sniffed || !ALLOWED_MIME[sniffed] || sniffed !== f.declaredMime) {
      throw caseError(415, "UNSUPPORTED_MEDIA_TYPE", "Chỉ nhận ảnh JPG, PNG, WEBP hoặc PDF, và loại tệp phải khớp với nội dung thật", { declared: f.declaredMime, detected: sniffed });
    }
    // Party / state checks BEFORE anything is written to disk.
    const pre = await prisma.disputeCase.findUnique({ where: { id: caseId } });
    if (!pre || !partyRoleOf(actor.id, pre)) throw notFoundCase();
    if (!PARTY_SUBMIT_STATUSES.includes(pre.status as CaseStatus)) throw stateNotAllowed(pre, PARTY_SUBMIT_STATUSES);
    const stored = await storeFile(caseId, f.bytes, sniffed);
    try {
      const out = await mutate({
        actor,
        action: "EVIDENCE_FILE_SUBMITTED",
        scope: caseId,
        idempotencyKey,
        body: { sha256: stored.sha256, size: stored.sizeBytes, mime: stored.mime, description: f.description, title: f.title ?? null },
        run: async (ctx) => {
          const c = await lockCase(ctx.tx, caseId);
          const role = partyRoleOf(actor.id, c);
          if (!role) throw notFoundCase();
          if (!PARTY_SUBMIT_STATUSES.includes(c.status as CaseStatus)) throw stateNotAllowed(c, PARTY_SUBMIT_STATUSES);
          const row = await insertEvidence(
            ctx.tx,
            c,
            {
              provenanceType: "SERVER_OBSERVED",
              source: "party.external_document_file",
              subject: `PARTY_FILE:${randomUUID()}`,
              eventAt: null,
              captureStatus: "OK",
              sensitivity: "RESTRICTED",
              payload: {
                description: f.description,
                title: f.title ?? null,
                fileName: (f.originalName ?? "").replace(/[^\p{L}\p{N} ._()-]/gu, "_").slice(0, 120) || null,
                declaredBy: role,
                storedFile: { key: stored.key, sha256: stored.sha256, sizeBytes: stored.sizeBytes, mime: stored.mime, serverVerified: true, scope: "FILE_BYTES_ONLY" },
                note: "Máy chủ đã lưu tệp và tự tính sha256 của chính tệp này. Mô tả và các khẳng định của bên nộp vẫn là lời của họ, chưa được xác minh.",
              },
            },
            { submittedBy: actor.id, submittedRole: role, provenanceType: "EXTERNAL_DOCUMENT", verificationStatus: "SERVER_VERIFIED" },
          );
          return { caseId: c.id, result: { id: row.id, sha256: stored.sha256, sizeBytes: stored.sizeBytes, mime: stored.mime, verificationStatus: "SERVER_VERIFIED", sensitivity: "RESTRICTED", shareable: false } };
        },
      });
      // an idempotent replay returned the FIRST upload's row: the bytes just written are a duplicate nobody points at
      if (out.replayed) await removeFile(stored.key);
      return out;
    } catch (e) {
      await removeFile(stored.key);
      throw e;
    }
  },

  /** Reads one stored evidence file: its SUBMITTER, or an ADMIN who is not a party of the case. Every read is logged; the hash is re-checked before the bytes leave. */
  async readEvidenceFile(actor: Actor, caseId: string, evidenceId: string) {
    if (!evidenceStorageEnabled()) throw caseError(404, "FEATURE_DISABLED", "Chức năng lưu tệp bằng chứng chưa được bật");
    requireUuid(caseId);
    requireUuid(evidenceId);
    const c = await prisma.disputeCase.findUnique({ where: { id: caseId } });
    if (!c) throw notFoundCase();
    const row = await prisma.disputeCaseEvidence.findFirst({ where: { id: evidenceId, caseId } });
    const stored = (row?.payload as any)?.storedFile;
    if (!row || !stored || typeof stored.key !== "string") throw caseError(404, "EVIDENCE_NOT_FOUND", "Không tìm thấy tệp bằng chứng");
    const isAdmin = actor.role === "ADMIN" && !partyRoleOf(actor.id, c);
    const isSubmitter = row.submittedBy === actor.id && !!partyRoleOf(actor.id, c);
    // Anyone else - the other side, a stranger, an admin who is a party - learns nothing: the same 404 as a missing file.
    if (!isAdmin && !isSubmitter) throw caseError(404, "EVIDENCE_NOT_FOUND", "Không tìm thấy tệp bằng chứng");
    await logAccess(prisma, [{ caseId, viewer: actor, action: "VIEW_EVIDENCE", evidenceId }]); // logged BEFORE the bytes are read: no unlogged read
    try {
      const bytes = await readVerified(stored.key, stored.sha256);
      return { bytes, mime: String(stored.mime), sha256: String(stored.sha256), fileName: ((row.payload as any).fileName as string | null) ?? null };
    } catch (e: any) {
      if (e?.code === "EVIDENCE_FILE_INTEGRITY") throw caseError(409, "EVIDENCE_FILE_INTEGRITY", "Tệp lưu không còn khớp với sha256 đã ghi lúc nộp");
      throw caseError(404, "EVIDENCE_NOT_FOUND", "Không tìm thấy tệp bằng chứng");
    }
  },
};

// ── Evidence-change guard & access log ───────────────────────────────────────────────────────────────────────────────

/**
 * What changed since the proposal's snapshot: rows written after it, plus any live source whose current hash differs from the latest stored
 * row (a change nobody has re-collected yet). Pure reads; callable inside the approve transaction.
 */
export async function evidenceGuard(tx: Tx, c: CaseRow, snapshot: SnapshotEntry[]) {
  const [ev, st] = await Promise.all([
    tx.disputeCaseEvidence.findMany({ where: { caseId: c.id }, select: { id: true, contentHash: true, createdAt: true } }),
    tx.disputeCaseStatement.findMany({ where: { caseId: c.id }, select: { id: true, contentHash: true, createdAt: true } }),
  ]);
  const heads = await systemHeads(tx, c.id);
  const collected = await collectSources(tx, c.sessionId);
  const staleLive: string[] = [];
  for (const d of collected?.evidence ?? []) {
    const head = heads.get(slotKey(d.source, d.subject));
    if (!head || head.hash !== draftHash(d)) staleLive.push(`${d.source}#${d.subject}`);
  }
  return diffAgainstSnapshot({
    snapshot,
    current: [...ev.map((e) => ({ id: e.id, hash: e.contentHash, createdAt: e.createdAt })), ...st.map((s) => ({ id: s.id, hash: s.contentHash, createdAt: s.createdAt }))],
    staleLive,
  });
}

export async function ackTimesOf(tx: Tx, c: CaseRow): Promise<Date[]> {
  if (!c.investigatorId) return [];
  const rows = await tx.disputeCaseEvent.findMany({ where: { caseId: c.id, action: "EVIDENCE_CHANGE_ACK", actorUserId: c.investigatorId }, select: { createdAt: true } });
  return rows.map((r) => r.createdAt);
}

async function logAccess(db: Db, rows: Array<{ caseId: string; viewer: Actor; action: "VIEW_CASE" | "VIEW_EVIDENCE"; evidenceId?: string }>): Promise<void> {
  if (rows.length === 0) return;
  await db.disputeCaseAccessLog.createMany({
    data: rows.map((r) => ({ caseId: r.caseId, viewerUserId: r.viewer.id, viewerRole: r.viewer.role, evidenceId: r.evidenceId ?? null, action: r.action })),
  });
}

export const __test__ = { canonicalJson, sha256Hex };
export type { PartyRole };
