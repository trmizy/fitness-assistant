import { randomUUID } from "node:crypto";
import { Prisma } from "../../generated/prisma";
import { prisma } from "../../repositories/profile.repository";
import { canonicalJson, contentHashOf, sha256Hex } from "./canonical";
import { collectExternal, collectSources, draftHash, type Db, type EvidenceDraft } from "./collector";
import { buildFinancialView, hasLateArrivalStep, partyFinancialView } from "./financial";
import { caseError, forbiddenRole, notFoundCase, notInvestigator, versionConflict } from "./errors";
import { CANCELLED_BLOCKED_BY_D77 } from "./execution-guard";
import { DISPUTE_CASE_FLAGS, evidenceStorageEnabled, executionEnabled, flagVerdict, gateVerdict } from "./flags";
import { assertRealAdmin, listActiveAdmins } from "./admin-account";
import { computeAllowedActions, computePartyAllowedActions, allowedList, allowedPartyList, isOrphanCase, type V21Facts } from "./allowed-actions";
import { now as clockNow } from "./clock";
import { appealsEnabled, decisionReplacementEnabled } from "./flags";
import { currentApprovalWhere, dbChecks as replacementDbChecks } from "./decision-replacement.service";
import { blockReasonVi, noticesFor, sendNotices, type NoticeSet } from "./notices";
import { deadlineDueAt, satisfyDeadlines } from "./party-notices";
import { ALLOWED_MIME, MAX_EVIDENCE_BYTES, readVerified, removeFile, sniffMime, storeFile } from "./evidence-storage";
import {
  D77_BLOCK_REASON,
  MANUAL_TARGETS,
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
  TRANSITIONS,
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
/** R-10: `allowed` is always the REAL answer. allowedKind STATUSES = the case statuses in which the action is possible; TARGETS = the statuses this case may move to now. */
const OPEN_STATUSES: readonly string[] = (Object.keys(TRANSITIONS) as CaseStatus[]).filter((s) => !isTerminal(s));
const stateNotAllowed = (c: CaseRow, allowed: readonly string[], allowedKind: "STATUSES" | "TARGETS" = "STATUSES") =>
  caseError(409, "CASE_STATE_NOT_ALLOWED", "Trạng thái hiện tại của hồ sơ không cho phép thao tác này", { status: c.status, allowed, allowedKind });

function summary(c: CaseRow) {
  return {
    id: c.id,
    sessionId: c.sessionId,
    contractId: c.contractId,
    clientUserId: c.clientUserId,
    ptUserId: c.ptUserId,
    type: c.type,
    status: c.status,
    escalated: c.escalated,
    investigatorId: c.investigatorId,
    execStatus: c.execStatus,
    execDecisionId: c.execDecisionId,
    closeReason: c.closeReason,
    previousCaseId: c.previousCaseId ?? null,
    version: c.version,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

/**
 * R-04: display names of the people of a case, from the existing profile source (user_profiles.first_name / last_name; never the e-mail). A user with no profile or no name is
 * null; the whole lookup failing is an empty map. A name is a convenience, so it NEVER fails the read.
 */
async function displayNames(ids: Array<string | null | undefined>): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  const uniq = [...new Set(ids.filter((i): i is string => !!i))];
  if (uniq.length === 0) return out;
  try {
    const rows = await prisma.userProfile.findMany({ where: { userId: { in: uniq } }, select: { userId: true, firstName: true, lastName: true } });
    for (const r of rows) out.set(r.userId, [r.firstName, r.lastName].map((x) => (x ?? "").trim()).filter(Boolean).join(" ") || null);
  } catch {
    /* names degrade to null */
  }
  return out;
}
const nameOf = (m: Map<string, string | null>, id: string | null | undefined) => (id ? (m.get(id) ?? null) : null);
const withNames = (c: CaseRow, m: Map<string, string | null>) => ({ ...summary(c), clientName: nameOf(m, c.clientUserId), ptName: nameOf(m, c.ptUserId), investigatorName: nameOf(m, c.investigatorId) });

// ── Mutation wrapper: lock, CAS, event, idempotency ──────────────────────────────────────────────────────────────────

interface Ctx {
  tx: Tx;
  actor: Actor;
  transitions: Array<{ from: CaseStatus; to: CaseStatus; note?: string }>;
  /** notices to send AFTER the transaction committed (never on an idempotent replay) */
  notices: NoticeSet[];
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
  if (!canTransition(c.status as CaseStatus, to)) throw stateNotAllowed(c, TRANSITIONS[c.status as CaseStatus], "TARGETS");
  const r = await ctx.tx.disputeCase.updateMany({
    where: { id: c.id, version: c.version, status: c.status },
    data: { status: to, version: { increment: 1 } },
  });
  if (r.count !== 1) throw versionConflict();
  ctx.transitions.push({ from: c.status as CaseStatus, to, note });
  c.status = to;
  c.version += 1;
}

/** A5: closes a case with CLOSED + closeReason (+ the audit event of the caller). Never touches the session, money or quota. Compare-and-swap like every status change. */
async function casClose(ctx: Ctx, c: CaseRow, closeReason: string, note?: string): Promise<void> {
  const r = await ctx.tx.disputeCase.updateMany({
    where: { id: c.id, version: c.version, status: c.status },
    data: { status: "CLOSED", closeReason, version: { increment: 1 } },
  });
  if (r.count !== 1) throw versionConflict();
  ctx.transitions.push({ from: c.status as CaseStatus, to: "CLOSED", note });
  c.status = "CLOSED";
  c.closeReason = closeReason;
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
    const done = await prisma.$transaction(
      async (tx) => {
        const ctx: Ctx = { tx, actor: o.actor, transitions: [], notices: [] };
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
        return { result: out.result, replayed: false, notices: ctx.notices };
      },
      { timeout: 30_000, maxWait: 10_000 },
    );
    await sendNotices(done.notices);
    return { result: done.result, replayed: false };
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
    select: { id: true, source: true, subject: true, contentHash: true, snapshotVersion: true, captureStatus: true },
  });
  const heads = new Map<string, { id: string; hash: string; version: number; captureStatus: string }>();
  for (const r of rows) {
    const k = slotKey(r.source, r.subject);
    const cur = heads.get(k);
    if (!cur || r.snapshotVersion > cur.version) heads.set(k, { id: r.id, hash: r.contentHash, version: r.snapshotVersion, captureStatus: r.captureStatus });
  }
  return heads;
}

/** F5: the cross-service evidence of a case's session, read WITHOUT a transaction (null when the case or session is unknown: the caller's own checks answer that). */
async function prefetchForCase(caseId: string): Promise<EvidenceDraft[] | null> {
  if (!UUID_RE.test(caseId)) return null;
  const pre = await prisma.disputeCase.findUnique({ where: { id: caseId }, select: { sessionId: true } });
  return pre ? collectExternal(prisma, pre.sessionId) : null;
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
    // A5: a session whose case was CLOSED is never reopened by opening another case (no endless reopen); the close reason is on the closed case.
    // E2 (Ngai, 05/11): the ONE exception - a case closed as NOT_A_DISPUTE leaves the session DISPUTED with its money standing still, so the session may get ONE new case through this normal path (four-eyes
    // downstream, never the legacy one-admin door). Not after any other closure, and not a third case: if the new case is also closed NOT_A_DISPUTE the session is refused here. The link is audited.
    const closedAll = await prisma.disputeCase.findMany({ where: { sessionId, status: "CLOSED" }, select: { id: true, closeReason: true }, orderBy: { createdAt: "desc" } });
    let predecessorId: string | null = null;
    if (closedAll.length > 0) {
      const onlyNotADispute = closedAll.every((c) => c.closeReason === "NOT_A_DISPUTE");
      if (!onlyNotADispute || closedAll.length >= 2) {
        const closed = closedAll[0];
        throw caseError(409, "CASE_CLOSED_NO_REOPEN", "Hồ sơ của buổi tập này đã được đóng; không mở lại hồ sơ mới cho cùng một buổi", { caseId: closed.id, closeReason: closed.closeReason });
      }
      predecessorId = closedAll[0].id;
    }
    const decided = await prisma.disputeCase.findFirst({ where: { sessionId, status: "DECISION_APPROVED" }, select: { id: true } });
    if (decided) {
      throw caseError(409, "CASE_DECISION_PENDING_EXECUTION", "Buổi tập này đã có hồ sơ được duyệt nhưng chưa được thực thi (Slice 2). Chưa mở hồ sơ mới", { caseId: decided.id });
    }
    const type = deriveCaseType(session.status, session.disputeType);
    if (!type) {
      throw caseError(409, "DISPUTE_TYPE_UNKNOWN", "Không xác định được loại hồ sơ cho buổi tập này");
    }
    const provisional = type === "LEGACY_UNCLASSIFIED";
    // F5: the chat / gym calls are made HERE, before the transaction, so no lock or open transaction waits on the network.
    const prefetched = await collectExternal(prisma, sessionId);

    try {
      return await mutate({
        actor,
        action: "INTAKE",
        scope: `INTAKE:${sessionId}`,
        idempotencyKey,
        body: { sessionId },
        run: async (ctx) => {
          const collected = await collectSources(ctx.tx, sessionId, undefined, prefetched);
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
              ...(predecessorId ? { previousCaseId: predecessorId } : {}),
            },
          });
          if (predecessorId) {
            // E2: the audit link, appended to the CLOSED case's history (the closed case itself is not changed)
            await ctx.tx.disputeCaseEvent.create({
              data: { caseId: predecessorId, actorUserId: actor.id, actorRole: actor.role, action: "CASE_SUCCEEDED_BY", note: "Buổi tập vẫn đang khiếu nại; mở một hồ sơ mới (E2)", payload: toJson({ newCaseId: created.id, moneyMoved: false }) },
            });
          }
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
          ctx.notices.push(noticesFor("OPENED", created));
          return {
            caseId: created.id,
            result: { created: true, case: summary(created) },
            // A session whose dispute_type is NULL is taken in as a PROVISIONAL classification; sessions.dispute_type is not written.
            ...(provisional ? { note: "Phân loại tạm: buổi tập chưa có loại khiếu nại (dispute_type rỗng). Điều tra viên cần phân loại trước khi ghi kết luận" } : {}),
            detail: { evidenceRows: collected.evidence.length, legacyStatements: collected.statements.length, ...(predecessorId ? { previousCaseId: predecessorId } : {}), ...(provisional ? { provisionalClassification: "LEGACY_UNCLASSIFIED" } : {}) },
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
    const prefetched = await prefetchForCase(caseId);
    return mutate({
      actor,
      action: "RECOLLECT",
      scope: caseId,
      idempotencyKey,
      body: {},
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        if (isTerminal(c.status as CaseStatus)) throw stateNotAllowed(c, OPEN_STATUSES);
        const collected = await collectSources(ctx.tx, c.sessionId, undefined, prefetched);
        if (!collected) throw caseError(404, "SESSION_NOT_FOUND", "Không tìm thấy buổi tập");
        const heads = await systemHeads(ctx.tx, c.id);
        let added = 0;
        let unchanged = 0;
        const skippedUnavailable: string[] = [];
        for (const d of collected.evidence) {
          const head = heads.get(slotKey(d.source, d.subject));
          const hash = draftHash(d);
          if (head && head.hash === hash) {
            unchanged += 1;
            continue;
          }
          // F5: a source that cannot be read RIGHT NOW must not bury data that was read before. The good row stays the head; the slot is reported so the
          // admin knows it was not refreshed, and the next recollect (after the source answers) appends the real new version.
          if (head && d.captureStatus === "UNAVAILABLE" && head.captureStatus !== "UNAVAILABLE") {
            skippedUnavailable.push(`${d.source}#${d.subject}`);
            continue;
          }
          await insertEvidence(ctx.tx, c, d, { snapshotVersion: head ? head.version + 1 : 1, supersedesId: head?.id ?? null });
          added += 1;
        }
        return { caseId: c.id, result: { added, unchanged, skippedUnavailable }, detail: { added, unchanged, skippedUnavailable } };
      },
    });
  },

  // ── Assignment & status ───────────────────────────────────────────────────────────────────────────────────────────

  async assign(actor: Actor, caseId: string, investigatorId: string | undefined, idempotencyKey?: string) {
    assertAdmin(actor);
    const target = investigatorId ?? actor.id;
    // F9: the person handed the case must be a real, active ADMIN (same check as the late-open hand-over). The caller themselves is an authenticated admin already.
    // The lookup is a network call: it is made here, before the transaction.
    if (target !== actor.id) await assertRealAdmin(target);
    return mutate({
      actor,
      action: "ASSIGN",
      scope: caseId,
      idempotencyKey,
      body: { investigatorId: target },
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        if (isTerminal(c.status as CaseStatus)) throw stateNotAllowed(c, OPEN_STATUSES);
        if (target === c.clientUserId || target === c.ptUserId) {
          throw caseError(403, "CONFLICT_OF_INTEREST", "Một bên của vụ việc không được làm điều tra viên");
        }
        await casData(ctx, c, { investigatorId: target });
        ctx.notices.push(noticesFor("ASSIGNED", c, { actorId: actor.id, assigneeId: target }));
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
        if (isTerminal(c.status as CaseStatus)) throw stateNotAllowed(c, OPEN_STATUSES);
        if (c.status !== "INTAKE") assertInvestigator(actor, c);
        if (!canTransitionManually(c.status as CaseStatus, to)) throw stateNotAllowed(c, MANUAL_TARGETS.filter((t) => canTransitionManually(c.status as CaseStatus, t)), "TARGETS");
        if (to === "REJECTED_INTAKE" && !o.reason) throw caseError(400, "REASON_REQUIRED", "Cần nhập lý do từ chối hồ sơ");
        const from = c.status;
        await casStatus(ctx, c, to, o.reason ?? o.note);
        if (to === "REJECTED_INTAKE") {
          await casData(ctx, c, { closeReason: "INTAKE_REJECTED" });
          ctx.notices.push(noticesFor("CLOSED", c));
        }
        if (to === "AWAITING_PARTIES") ctx.notices.push(noticesFor("EVIDENCE_REQUESTED", c));
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
        if (c.status === "AWAITING_PARTIES") ctx.notices.push(noticesFor("EVIDENCE_REQUESTED", c));
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
        if (isTerminal(c.status as CaseStatus)) throw stateNotAllowed(c, OPEN_STATUSES);
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
        ctx.notices.push(noticesFor("FINDING_RECORDED", c));
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
            // F4: NO proposal was created. `proposalCreated:false` + `proposal:null` say so explicitly; the HTTP status is 200 (the request was processed and the case
            // moved to POLICY_PENDING), never 201 (nothing was created).
            result: { proposalCreated: false, proposal: null, policyPending: true, blocked: CANCELLED_BLOCKED_BY_D77, caseStatus: c.status, reason, nextStep: "Xác minh khoản đền đến muộn của buổi rồi ghi kết luận khác, hoặc chờ quyết định chính sách" },
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
        ctx.notices.push(noticesFor("AWAITING_APPROVAL", c));
        return {
          caseId: c.id,
          result: { proposalCreated: true, id: proposal.id, outcome, executionBlockedReason: proposal.executionBlockedReason, caseStatus: c.status, execStatus: c.execStatus },
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
    const prefetched = await prefetchForCase(caseId);
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
        const guard = await evidenceGuard(ctx.tx, c, proposal.evidenceSnapshot as unknown as SnapshotEntry[], prefetched);
        return {
          caseId: c.id,
          result: { acknowledged: true, changedIds: guard.newIds, staleLive: guard.staleLive, unreadableLive: guard.unreadableLive },
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
        if (isTerminal(c.status as CaseStatus) || c.status === "INTAKE") throw stateNotAllowed(c, OPEN_STATUSES.filter((x) => x !== "INTAKE"));
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

  // ── Closing a case WITHOUT a decision (never money) ──────────────────────────────────────────────────────────────────

  /**
   * An ORPHAN case: its session left dispute (ruled through the old route, or the PT agreed to the no-show report) while the case was still open. Any ADMIN who
   * is not a party closes it with a reason. The case becomes REJECTED_INTAKE (terminal; closeReason ORPHAN_SESSION_LEFT_DISPUTE) so it stops blocking the late-open
   * path and the one-open-case-per-session rule. Writes the case row, its event and the notices ONLY: no session, quota, settlement or ledger row is touched.
   */
  async closeOrphan(actor: Actor, caseId: string, reason: string, idempotencyKey?: string) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: "CASE_CLOSED_ORPHAN",
      scope: caseId,
      idempotencyKey,
      body: { reason },
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        if (actor.id === c.clientUserId || actor.id === c.ptUserId) throw caseError(403, "CONFLICT_OF_INTEREST", "Quản trị viên là một bên của vụ việc nên không được đóng hồ sơ");
        if (isTerminal(c.status as CaseStatus)) throw stateNotAllowed(c, OPEN_STATUSES);
        const session = await ctx.tx.session.findUnique({ where: { id: c.sessionId }, select: { status: true } });
        if (!session) throw caseError(404, "SESSION_NOT_FOUND", "Không tìm thấy buổi tập");
        if (!isOrphanCase(c.status, session.status)) {
          throw caseError(409, "CASE_NOT_ORPHAN", "Buổi tập vẫn đang trong khiếu nại nên hồ sơ không phải hồ sơ mồ côi", { sessionStatus: session.status });
        }
        const from = c.status;
        await casClose(ctx, c, "ORPHAN_SESSION_LEFT_DISPUTE", reason);
        ctx.notices.push(noticesFor("CLOSED", c));
        return {
          caseId: c.id,
          result: { closed: true, from, to: c.status, closeReason: "ORPHAN_SESSION_LEFT_DISPUTE", sessionStatus: session.status, version: c.version, moneyMoved: false },
          note: reason,
          detail: { sessionStatus: session.status },
        };
      },
    });
  },

  /**
   * The investigator recorded NOT_A_DISPUTE: closes the case with a reason. The case becomes REJECTED_INTAKE (closeReason NOT_A_DISPUTE). The SESSION is not
   * touched (what happens to such a session is a pending policy decision): it stays in dispute and returns to the queue as a session without a case.
   */
  async closeNotADispute(actor: Actor, caseId: string, reason: string, idempotencyKey?: string) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: "CASE_CLOSED_NOT_A_DISPUTE",
      scope: caseId,
      idempotencyKey,
      body: { reason },
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        assertInvestigator(actor, c);
        if (c.status !== "FINDING_RECORDED") throw stateNotAllowed(c, ["FINDING_RECORDED"]);
        const finding = await ctx.tx.disputeCaseFinding.findFirst({ where: { caseId: c.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
        if (!finding || finding.finding !== "NOT_A_DISPUTE") throw caseError(409, "FINDING_NOT_A_DISPUTE", "Chỉ đóng được khi kết luận hiện tại là 'không phải khiếu nại'");
        const from = c.status;
        await casClose(ctx, c, "NOT_A_DISPUTE", reason);
        ctx.notices.push(noticesFor("CLOSED", c));
        return { caseId: c.id, result: { closed: true, from, to: c.status, closeReason: "NOT_A_DISPUTE", version: c.version, moneyMoved: false }, note: reason };
      },
    });
  },

  /**
   * A5/C1: the normal end of a case whose approved decision WAS executed (execStatus BUSINESS_DONE): CLOSED, closeReason EXECUTED (APPEAL_CONCLUDED when appeals took part). ONE admin who is
   * not a party may do it - it has no money effect and can never release money, skip an approved decision, or run one: an approved decision that is not BUSINESS_DONE is refused. It is
   * also refused while an appeal is undecided or a consequence of an appeal is still OPEN. Whether the money axis is final is NOT decided here: `financial` and `closure` keep saying so.
   */
  async closeExecuted(actor: Actor, caseId: string, reason: string, idempotencyKey?: string) {
    assertAdmin(actor);
    return mutate({
      actor,
      action: "CASE_CLOSED_EXECUTED",
      scope: caseId,
      idempotencyKey,
      body: { reason },
      run: async (ctx) => {
        const c = await lockCase(ctx.tx, caseId);
        if (actor.id === c.clientUserId || actor.id === c.ptUserId) throw caseError(403, "CONFLICT_OF_INTEREST", "Quản trị viên là một bên của vụ việc nên không được đóng hồ sơ");
        if (c.status !== "DECISION_APPROVED") throw stateNotAllowed(c, ["DECISION_APPROVED"]);
        if (c.execStatus !== "BUSINESS_DONE") {
          throw caseError(409, "DECISION_NOT_EXECUTED", "Quyết định đã duyệt chưa được thực thi xong nên chưa đóng được hồ sơ (đóng không bao giờ thay cho thực thi)", { execStatus: c.execStatus });
        }
        const appeals = await ctx.tx.disputeCaseAppeal.findMany({ where: { caseId: c.id }, select: { status: true } });
        if (appeals.some((a) => a.status !== "DECIDED")) throw caseError(409, "APPEAL_PENDING", "Còn yêu cầu xem xét lại chưa có kết quả nên chưa đóng được hồ sơ");
        const open = await ctx.tx.disputeCaseAppealConsequence.count({ where: { caseId: c.id, status: "OPEN" } });
        if (open > 0) throw caseError(409, "APPEAL_CONSEQUENCE_OPEN", "Kết quả xem xét lại còn việc chưa xử lý (tiền, buổi hoặc lỗi PT) nên chưa đóng được hồ sơ", { open });
        const from = c.status;
        const closeReason = appeals.length > 0 ? "APPEAL_CONCLUDED" : "EXECUTED";
        await casClose(ctx, c, closeReason, reason);
        return { caseId: c.id, result: { closed: true, from, to: c.status, closeReason, version: c.version, moneyMoved: false }, note: reason };
      },
    });
  },

  // ── Four-eyes decision ────────────────────────────────────────────────────────────────────────────────────────────

  /** C3: an unreadable evidence source at approval is counted, backed off and escalated (recordEvidenceSourceFailure); every other outcome is unchanged. */
  async decide(
    actor: Actor,
    caseId: string,
    b: { result: "APPROVED" | "REJECTED"; reason: string; conflictOfInterestDeclaredNone: boolean; evidenceChangeAcknowledged: boolean },
    idempotencyKey?: string,
  ) {
    try {
      return await disputeCaseService.decideOnce(actor, caseId, b, idempotencyKey);
    } catch (e) {
      throw await enrichEvidenceSourceError(e, caseId, actor);
    }
  },

  async decideOnce(
    actor: Actor,
    caseId: string,
    b: { result: "APPROVED" | "REJECTED"; reason: string; conflictOfInterestDeclaredNone: boolean; evidenceChangeAcknowledged: boolean },
    idempotencyKey?: string,
  ) {
    assertAdmin(actor);
    // F5: the chat / gym evidence is read BEFORE the transaction that holds the case lock (only an approval compares it).
    const prefetched = b.result === "APPROVED" ? await prefetchForCase(caseId) : null;
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
          const guard = await evidenceGuard(ctx.tx, c, proposal.evidenceSnapshot as unknown as SnapshotEntry[], prefetched);
          // F5: a live source that cannot be read right now (while the stored copy holds real data) is UNKNOWN, not "changed": refuse (fail-closed) with a retryable
          // code. Nothing needs acknowledging and nothing is recorded; the approval works as soon as the source answers again.
          if (guard.unreadableLive.length > 0) {
            throw caseError(503, "EVIDENCE_SOURCE_UNAVAILABLE", "Chưa đọc được một nguồn bằng chứng (chat hoặc phòng tập) nên chưa kiểm tra được bằng chứng có thay đổi hay không. Vui lòng thử duyệt lại sau", {
              unreadable: guard.unreadableLive,
              retryable: true,
            });
          }
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
          ctx.notices.push(noticesFor("DECISION_APPROVED", c, { actorId: actor.id }));
        } else {
          await casStatus(ctx, c, "ASSESSING", b.reason);
          ctx.notices.push(noticesFor("DECISION_REJECTED", c, { actorId: actor.id }));
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
            // An approval NEVER executes: no session, quota, settlement or ledger row is touched by it. Execution is a separate call (execute); the case's
            // execStatus says where it is.
            ...(b.result === "APPROVED" ? { execStatus: c.execStatus, executionBlockedReason: proposal.executionBlockedReason } : {}),
          },
          note: b.reason,
        };
      },
    });
  },

  // ── Reads (admin) ─────────────────────────────────────────────────────────────────────────────────────────────────

  async list(actor: Actor, q: CaseListQuery) {
    assertAdmin(actor);
    const where: Prisma.DisputeCaseWhereInput = {
      ...(q.status ? { status: q.status as any } : {}),
      ...(q.execStatus ? { execStatus: q.execStatus as any } : {}),
      ...(q.type ? { type: q.type as any } : {}),
      ...(q.investigatorId ? { investigatorId: q.investigatorId } : {}),
      ...(q.unassigned ? { investigatorId: null } : {}),
      ...(q.sessionId ? { sessionId: q.sessionId } : {}),
      ...(q.contractId ? { contractId: q.contractId } : {}),
      ...(q.createdFrom || q.createdTo ? { createdAt: { ...(q.createdFrom ? { gte: q.createdFrom } : {}), ...(q.createdTo ? { lte: q.createdTo } : {}) } } : {}),
    };
    const sortField = q.sort ?? "createdAt";
    const order = q.order ?? "desc";
    const [rows, total] = await Promise.all([
      prisma.disputeCase.findMany({ where, orderBy: [{ [sortField]: order }, { id: "asc" }] as any, take: q.limit, skip: q.offset }),
      prisma.disputeCase.count({ where }),
    ]);
    await logAccess(prisma, rows.map((r) => ({ caseId: r.id, viewer: actor, action: "VIEW_CASE" as const })));
    const names = await displayNames(rows.flatMap((r) => [r.clientUserId, r.ptUserId, r.investigatorId]));
    return { total, limit: q.limit, offset: q.offset, hasMore: q.offset + rows.length < total, items: rows.map((r) => withNames(r, names)) };
  },

  /**
   * The queue of sessions that need (or have) a case: every session in dispute (DISPUTED) or waiting for the PT's answer to a no-show report (PT_NO_SHOW_REPORTED),
   * with whether a case exists. `hasCase` = a case that is open or whose decision was approved (a closed-without-decision case does not count: the session
   * is back in the queue). No age or deadline is computed: there is no approved timing rule.
   */
  async listDeadlines(actor: Actor, caseId: string) {
    assertAdmin(actor);
    requireUuid(caseId);
    const c = await prisma.disputeCase.findUnique({ where: { id: caseId }, select: { id: true } });
    if (!c) throw notFoundCase();
    const rows = await prisma.disputeCaseDeadline.findMany({ where: { caseId }, orderBy: [{ startedAt: "asc" }, { id: "asc" }] });
    return { items: rows.map(deadlineView) };
  },

  async queue(actor: Actor, q: QueueQuery) {
    assertAdmin(actor);
    const cases = await prisma.disputeCase.findMany({
      where: { status: { not: "REJECTED_INTAKE" } },
      select: { id: true, sessionId: true, status: true, type: true, execStatus: true, investigatorId: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
    });
    const bySession = new Map<string, (typeof cases)[number]>();
    for (const c of cases) if (!bySession.has(c.sessionId)) bySession.set(c.sessionId, c); // newest first
    const ids = [...bySession.keys()];
    const statuses = q.sessionStatus ? [q.sessionStatus] : ["DISPUTED", "PT_NO_SHOW_REPORTED"];
    const where: Prisma.SessionWhereInput = {
      status: { in: statuses as any },
      ...(q.hasCase === true ? { id: { in: ids } } : q.hasCase === false ? { id: { notIn: ids } } : {}),
      ...(q.contractId ? { contractId: q.contractId } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.session.findMany({
        where,
        orderBy: [{ disputedAt: "asc" }, { scheduledStartAt: "asc" }, { id: "asc" }],
        take: q.limit,
        skip: q.offset,
        select: { id: true, contractId: true, status: true, disputeType: true, disputedAt: true, scheduledStartAt: true, clientUserId: true, ptUserId: true },
      }),
      prisma.session.count({ where }),
    ]);
    const qNames = await displayNames(rows.flatMap((r) => [r.clientUserId, r.ptUserId]));
    return {
      total,
      limit: q.limit,
      offset: q.offset,
      hasMore: q.offset + rows.length < total,
      items: rows.map((r) => {
        const c = bySession.get(r.id);
        return {
          sessionId: r.id,
          contractId: r.contractId,
          sessionStatus: r.status,
          disputeType: r.disputeType,
          disputedAt: r.disputedAt,
          scheduledStartAt: r.scheduledStartAt,
          clientUserId: r.clientUserId,
          ptUserId: r.ptUserId,
          clientName: nameOf(qNames, r.clientUserId),
          ptName: nameOf(qNames, r.ptUserId),
          hasCase: !!c,
          needsCase: !c,
          caseId: c?.id ?? null,
          caseStatus: c?.status ?? null,
          caseType: c?.type ?? null,
          execStatus: c?.execStatus ?? null,
          investigatorId: c?.investigatorId ?? null,
        };
      }),
    };
  },

  /**
   * R-02: the REAL verdict of every Dispute flag in THIS process (the same function the guards call: "true" AND NODE_ENV=test AND an accepted isolated DB), read-only.
   * `refusedBecause` says why a flag is off although the variable asks for on. The UI hides what is false and never guesses.
   */
  async listAdmins(actor: Actor) {
    assertAdmin(actor);
    return listActiveAdmins();
  },

  capabilities(actor: Actor) {
    assertAdmin(actor);
    const verdict = (name: (typeof DISPUTE_CASE_FLAGS)[keyof typeof DISPUTE_CASE_FLAGS]) => {
      const v = flagVerdict(name);
      return { effective: v.effective, ...(v.refusedBecause ? { refusedBecause: v.refusedBecause } : {}) };
    };
    const d = {
      execution: verdict(DISPUTE_CASE_FLAGS.EXECUTION),
      t0: verdict(DISPUTE_CASE_FLAGS.T0),
      evidenceStorage: verdict(DISPUTE_CASE_FLAGS.EVIDENCE_STORAGE),
      lateOpenReconciliation: verdict(DISPUTE_CASE_FLAGS.LATE_OPEN_RECONCILIATION),
      d65bResolution: verdict(DISPUTE_CASE_FLAGS.D65B_RESOLUTION),
      timers: verdict(DISPUTE_CASE_FLAGS.TIMERS),
      appeals: verdict(DISPUTE_CASE_FLAGS.APPEALS),
      decisionReplacement: verdict(DISPUTE_CASE_FLAGS.DECISION_REPLACEMENT),
    };
    return {
      execution: d.execution.effective,
      t0: d.t0.effective,
      evidenceStorage: d.evidenceStorage.effective,
      lateOpenReconciliation: d.lateOpenReconciliation.effective,
      d65bResolution: d.d65bResolution.effective,
      timers: d.timers.effective,
      appeals: d.appeals.effective,
      decisionReplacement: d.decisionReplacement.effective,
      details: d,
      runtime: { mode: gateVerdict().mode, open: gateVerdict().open, ...(gateVerdict().refusedBecause ? { refusedBecause: gateVerdict().refusedBecause } : {}) },
    };
  },

  /** R-19: the access log of ONE case, read-only (reading it writes nothing, so the audit cannot grow by being read). Newest first. */
  async accessLog(actor: Actor, caseId: string, q: { action?: "VIEW_CASE" | "VIEW_EVIDENCE"; limit: number; offset: number }) {
    assertAdmin(actor);
    requireUuid(caseId);
    const c = await prisma.disputeCase.findUnique({ where: { id: caseId }, select: { id: true } });
    if (!c) throw notFoundCase();
    const where: Prisma.DisputeCaseAccessLogWhereInput = { caseId, ...(q.action ? { action: q.action } : {}) };
    const [rows, total] = await Promise.all([
      prisma.disputeCaseAccessLog.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: q.limit, skip: q.offset }),
      prisma.disputeCaseAccessLog.count({ where }),
    ]);
    const names = await displayNames(rows.map((r) => r.viewerUserId));
    return {
      total,
      limit: q.limit,
      offset: q.offset,
      hasMore: q.offset + rows.length < total,
      items: rows.map((r) => ({ id: r.id, viewerUserId: r.viewerUserId, viewerName: nameOf(names, r.viewerUserId), viewerRole: r.viewerRole, action: r.action, evidenceId: r.evidenceId, createdAt: r.createdAt })),
    };
  },

  /** R-16: an admin reads ONE session (GET /sessions/:id is refused to admins). Explicit field list, no contract money; the open case (if any) is named. */
  async getSessionForAdmin(actor: Actor, sessionId: string) {
    assertAdmin(actor);
    if (!sessionId || sessionId.length > 64) throw caseError(404, "SESSION_NOT_FOUND", "Không tìm thấy buổi tập");
    const s = await prisma.session.findUnique({ where: { id: sessionId }, include: { contract: { select: { id: true, status: true, packageName: true, sessionMode: true, totalSessions: true, usedSessions: true } } } });
    if (!s) throw caseError(404, "SESSION_NOT_FOUND", "Không tìm thấy buổi tập");
    const cases = await prisma.disputeCase.findMany({ where: { sessionId }, orderBy: [{ createdAt: "desc" }, { id: "asc" }], select: { id: true, status: true, type: true, execStatus: true, investigatorId: true, closeReason: true, createdAt: true } });
    const names = await displayNames([s.clientUserId, s.ptUserId]);
    return {
      session: {
        id: s.id,
        contractId: s.contractId,
        clientUserId: s.clientUserId,
        clientName: nameOf(names, s.clientUserId),
        ptUserId: s.ptUserId,
        ptName: nameOf(names, s.ptUserId),
        status: s.status,
        sessionMode: s.sessionMode,
        scheduledStartAt: s.scheduledStartAt,
        scheduledEndAt: s.scheduledEndAt,
        disputeType: s.disputeType,
        disputeReason: s.disputeReason,
        ptNotes: s.ptNotes,
        disputedAt: s.disputedAt,
        completedAt: s.completedAt,
        sessionDeducted: s.sessionDeducted,
        ptAtFault: s.ptAtFault,
        clientConfirmDeadline: s.clientConfirmDeadline,
        autoConfirmed: s.autoConfirmed,
        cancelledBy: s.cancelledBy,
        resolvedBy: s.resolvedBy,
        resolvedAt: s.resolvedAt,
        resolvedByCaseDecisionId: s.resolvedByCaseDecisionId,
        roomPtJoinedAt: s.roomPtJoinedAt,
        roomClientJoinedAt: s.roomClientJoinedAt,
      },
      contract: s.contract,
      openCase: cases.find((c) => c.status !== "REJECTED_INTAKE" && c.status !== "CLOSED") ?? null,
      cases,
    };
  },

  /** The policy-eligibility (D-NEW-12) reviews of a contract, read-only: who proposed, who approved, when, which one is the current one. */
  async listPolicyReviewsForContract(actor: Actor, contractId: string) {
    assertAdmin(actor);
    return policyReviewsOf(prisma, contractId);
  },

  async listPolicyReviewsOfCase(actor: Actor, caseId: string) {
    assertAdmin(actor);
    requireUuid(caseId);
    const c = await prisma.disputeCase.findUnique({ where: { id: caseId }, select: { contractId: true } });
    if (!c) throw notFoundCase();
    return policyReviewsOf(prisma, c.contractId);
  },

  async getForAdmin(actor: Actor, caseId: string) {
    assertAdmin(actor);
    requireUuid(caseId);
    const c = await prisma.disputeCase.findUnique({ where: { id: caseId } });
    if (!c) throw notFoundCase();
    const [claims, issues, evidence, statements, shares, assessments, findings, proposals, events, executions, session, reviews, deadlineRows, agreementRows, appealRows] = await Promise.all([
      prisma.disputeCaseClaim.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.disputeCaseIssue.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.disputeCaseEvidence.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.disputeCaseStatement.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.disputeCaseShare.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.disputeCaseAssessment.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.disputeCaseFinding.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.disputeCaseProposal.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { approvals: { orderBy: { createdAt: "asc" } } } }),
      prisma.disputeCaseEvent.findMany({ where: { caseId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: EVENTS_LIMIT + 1 }),
      prisma.disputeCaseExecution.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      prisma.session.findUnique({ where: { id: c.sessionId }, select: { status: true } }),
      policyReviewsOf(prisma, c.contractId),
      prisma.disputeCaseDeadline.findMany({ where: { caseId }, orderBy: [{ startedAt: "asc" }, { id: "asc" }] }),
      prisma.disputeCaseAgreement.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { confirmations: true } }),
      prisma.disputeCaseAppeal.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { consequences: { include: { quotaCorrections: true } } } }),
    ]);
    const financial = await buildFinancialView(prisma, c.sessionId);
    await logAccess(prisma, [
      { caseId, viewer: actor, action: "VIEW_CASE" as const },
      ...evidence.map((e) => ({ caseId, viewer: actor, action: "VIEW_EVIDENCE" as const, evidenceId: e.id })),
    ]);
    const latestProposal = proposals.length ? proposals[proposals.length - 1] : null;
    const approvedProposal = [...proposals].reverse().find((p) => p.approvals.some((a) => a.result === "APPROVED")) ?? null;
    const approval = approvedProposal ? ([...approvedProposal.approvals].reverse().find((a) => a.result === "APPROVED") ?? null) : null;
    const latestApproval = latestProposal?.approvals.length ? latestProposal.approvals[latestProposal.approvals.length - 1] : null;
    const sessionStatus = session?.status ?? null;
    const execution = executionView(c, approvedProposal, approval, executions, events.slice(0, EVENTS_LIMIT), sessionStatus, reviews.items);
    // V2.1 facts for allowedActions (rows already read above, plus what only the process tables hold)
    const [replacementRows, heldRows, currentApproval] = await Promise.all([
      prisma.disputeCaseDecisionReplacement.findMany({ where: { caseId, approvedAt: null, rejectedAt: null }, select: { id: true, proposedBy: true } }),
      prisma.disputeHeldMoneyReview.findMany({ where: { sessionId: c.sessionId, closedAt: null }, select: { id: true } }),
      prisma.disputeCaseApproval.findFirst({ where: await currentApprovalWhere(prisma, caseId), orderBy: { createdAt: "desc" }, select: { id: true } }),
    ]);
    let effectCode: string | null = null;
    if (currentApproval) {
      try {
        await replacementDbChecks(prisma, c, currentApproval.id); // DB-visible "no effect" checks only; the ledger check stays with the route
      } catch (e: any) {
        effectCode = e?.code ?? "DECISION_HAS_EFFECT";
      }
    }
    const v21: V21Facts = {
      agreements: agreementRows.map((a) => ({ id: a.id, status: a.status, confirmedRoles: a.confirmations.map((x) => x.partyRole) })),
      appeals: appealRows.map((a) => ({
        id: a.id,
        status: a.status,
        reviewerId: a.reviewerId,
        consequences: a.consequences.map((k) => ({
          id: k.id,
          kind: k.kind,
          status: k.status,
          amountRequested: !!((k.detail as any)?.requested?.amountVnd),
          corrections: k.quotaCorrections.map((x) => ({ id: x.id, proposedBy: x.proposedBy, appliedAt: x.appliedAt })),
        })),
      })),
      involvedIds: [...new Set(proposals.flatMap((p) => [p.proposerId, ...p.approvals.map((a) => a.approverId)]))],
      replacement: { hasApprovedDecision: !!currentApproval, effectCode, pending: replacementRows },
      openHeldReviewIds: heldRows.map((r) => r.id),
      pendingContractPolicyReviews: reviews.items.filter((r) => r.status === "PENDING" && !r.caseId).map((r) => ({ id: r.reviewId, proposedBy: r.proposedBy })),
    };
    const actions = computeAllowedActions({
      actor,
      c,
      v21,
      sessionStatus,
      proposerId: latestProposal?.proposerId ?? null,
      latestFinding: findings.length ? findings[findings.length - 1].finding : null,
      pendingPolicyReviews: reviews.items.filter((r) => r.status === "PENDING" && r.caseId === c.id).map((r) => ({ id: r.reviewId, proposedBy: r.proposedBy })),
      flags: { executionEnabled: executionEnabled(), evidenceStorageEnabled: evidenceStorageEnabled(), appealsEnabled: appealsEnabled(), decisionReplacementEnabled: decisionReplacementEnabled() },
    });
    return {
      case: { ...withNames(c, await displayNames([c.clientUserId, c.ptUserId, c.investigatorId])), sessionStatus, orphan: isOrphanCase(c.status, sessionStatus) },
      claims,
      issues,
      // The admin sees plainly which rows are a party's unverified claim (effective status even for a row written before the column existed).
      // The stored-file key is internal: it never leaves the server (the file is read through the evidence-file route).
      evidence: evidence.map((e) => ({ ...e, payload: publicEvidencePayload(e.payload), verificationStatus: effectiveVerificationStatus(e), partySubmitted: isPartySubmitted(e), provenanceLabel: provenanceLabelVi(e.provenanceType) })),
      statements,
      shares,
      assessments,
      findings,
      proposals,
      latestProposal: latestProposal ? { id: latestProposal.id, outcome: latestProposal.outcome, proposerId: latestProposal.proposerId, executionBlockedReason: latestProposal.executionBlockedReason, createdAt: latestProposal.createdAt, evidenceChange: await evidenceChangeView(c, latestProposal.evidenceSnapshot as unknown as SnapshotEntry[], evidence, statements) } : null,
      latestApproval: latestApproval ? { id: latestApproval.id, proposalId: latestApproval.proposalId, approverId: latestApproval.approverId, result: latestApproval.result, reason: latestApproval.reason, createdAt: latestApproval.createdAt } : null,
      decision: approvedProposal && approval ? { proposalId: approvedProposal.id, approvalId: approval.id, outcome: approvedProposal.outcome, approvedBy: approval.approverId, approvedAt: approval.createdAt, executionBlockedReason: approvedProposal.executionBlockedReason } : null,
      execution,
      policyReviews: reviews,
      deadlines: deadlineRows.map(deadlineView),
      agreements: agreementRows.map(agreementViewOf),
      appeals: appealRows,
      closure: closureOf(c, appealRows),
      allowedActions: allowedList(actions),
      actions,
      events: eventSummaries(events.slice(0, EVENTS_LIMIT)),
      eventsLimit: EVENTS_LIMIT,
      eventsTruncated: events.length > EVENTS_LIMIT,
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
    // the party's own allowedActions: the buttons the frontend may draw (same predicates as the party routes)
    const [agreementFacts, notice, myAppeal] = await Promise.all([
      prisma.disputeCaseAgreement.findMany({ where: { caseId }, include: { confirmations: true } }),
      prisma.disputeCasePartyNotice.findFirst({ where: { caseId, userId: actor.id, kind: "CONCLUSION" }, orderBy: [{ recordedAt: "desc" }, { id: "desc" }] }),
      prisma.disputeCaseAppeal.findUnique({ where: { caseId_partyRole: { caseId, partyRole: role } }, select: { id: true } }),
    ]);
    const partyActions = computePartyAllowedActions({
      role,
      c: { status: c.status, closeReason: c.closeReason },
      flags: { evidenceStorageEnabled: evidenceStorageEnabled(), appealsEnabled: appealsEnabled() },
      now: clockNow(),
      agreements: agreementFacts.map((a) => ({ id: a.id, status: a.status, confirmedRoles: a.confirmations.map((x) => x.partyRole) })),
      conclusionNoticeRecordedAt: notice?.recordedAt ?? null,
      appealRequested: !!myAppeal,
    });
    return {
      allowedActions: allowedPartyList(partyActions),
      actions: partyActions,
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
        payload: publicEvidencePayload(e.payload),
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
      // V2.1: what this party may confirm (the SAME content hash both sides confirm) and its own response clocks
      agreements: (await prisma.disputeCaseAgreement.findMany({ where: { caseId, status: { in: ["PROPOSED", "AGREED", "USED"] } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { confirmations: true } })).map((a) => ({
        id: a.id,
        outcome: a.outcome,
        outcomeLabel: a.outcome === "COMPLETED" ? "Buổi tập được tính là đã hoàn thành" : a.outcome === "CANCELLED" ? "Buổi tập huỷ, không trừ buổi" : "Xác nhận huấn luyện viên vắng mặt",
        contentHash: a.contentHash,
        status: a.status,
        myConfirmed: a.confirmations.some((x) => x.userId === actor.id),
        otherConfirmed: a.confirmations.some((x) => x.userId !== actor.id),
      })),
      deadlines: (await prisma.disputeCaseDeadline.findMany({ where: { caseId, userId: actor.id }, orderBy: [{ startedAt: "asc" }, { id: "asc" }] })).map((d) => ({ kind: d.kind, hours: d.hours, startedAt: d.startedAt, dueAt: deadlineDueAt(d), paused: !!d.pausedAt, status: d.status })),
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
          await satisfyDeadlines(ctx.tx, c.id, actor.id); // V2.1: the party answered, its response clock is satisfied
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
        await satisfyDeadlines(ctx.tx, c.id, actor.id);
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
          await satisfyDeadlines(ctx.tx, c.id, actor.id);
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

export interface CaseListQuery {
  status?: string;
  execStatus?: string;
  type?: string;
  investigatorId?: string;
  unassigned?: boolean;
  sessionId?: string;
  contractId?: string;
  createdFrom?: Date;
  createdTo?: Date;
  sort?: "createdAt" | "updatedAt";
  order?: "asc" | "desc";
  limit: number;
  offset: number;
}
export interface QueueQuery {
  sessionStatus?: "DISPUTED" | "PT_NO_SHOW_REPORTED";
  hasCase?: boolean;
  contractId?: string;
  limit: number;
  offset: number;
}

/** The evidence payload as an admin / party may see it: the internal storage key of a stored file is removed (the file is read through the evidence-file route). */
export function publicEvidencePayload(payload: unknown): unknown {
  const p = payload as { storedFile?: Record<string, unknown> } | null | undefined;
  if (!p || typeof p !== "object" || !p.storedFile || typeof p.storedFile !== "object") return payload;
  const { key: _key, ...rest } = p.storedFile;
  return { ...p, storedFile: rest };
}

export async function policyReviewsOf(db: Db, contractId: string) {
  const rows = await db.disputeCasePolicyEligibilityReview.findMany({ where: { contractId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const current = rows.filter((r) => r.approvedAt).sort((a, b) => b.approvedAt!.getTime() - a.approvedAt!.getTime() || b.id.localeCompare(a.id))[0];
  return {
    contractId,
    currentReviewId: current?.id ?? null,
    currentResult: current?.result ?? null,
    items: rows.map((r) => ({
      reviewId: r.id,
      caseId: r.caseId,
      level: r.caseId ? ("CASE" as const) : ("CONTRACT" as const),
      evidenceRefs: r.evidenceRefs ?? null,
      contractId: r.contractId,
      result: r.result,
      status: r.approvedAt ? ("APPROVED" as const) : ("PENDING" as const),
      current: current?.id === r.id,
      evidenceIds: r.evidenceIds,
      reasoning: r.reasoning,
      proposedBy: r.proposedBy,
      proposedAt: r.createdAt,
      approvedBy: r.approvedBy,
      approvedAt: r.approvedAt,
      supersedesId: r.supersedesId,
    })),
  };
}

export const EVENTS_LIMIT = 200;

export const deadlineView = (d: { id: string; kind: string; partyRole: string; userId: string; hours: number; startedAt: Date; pausedAt: Date | null; pausedSeconds: number; status: string; satisfiedAt: Date | null; expiredAt: Date | null }) => ({
  id: d.id,
  kind: d.kind,
  partyRole: d.partyRole,
  userId: d.userId,
  hours: d.hours,
  startedAt: d.startedAt,
  dueAt: deadlineDueAt(d),
  paused: !!d.pausedAt,
  pausedSeconds: d.pausedSeconds,
  status: d.status,
  satisfiedAt: d.satisfiedAt,
  expiredAt: d.expiredAt,
});
const agreementViewOf = (a: { id: string; outcome: string; contentHash: string; note: string; status: string; agreedAt: Date | null; findingId: string | null; createdAt: Date; confirmations: Array<{ partyRole: string; confirmedAt: Date }> }) => ({
  id: a.id,
  outcome: a.outcome,
  contentHash: a.contentHash,
  note: a.note,
  status: a.status,
  agreedAt: a.agreedAt,
  findingId: a.findingId,
  createdAt: a.createdAt,
  confirmations: a.confirmations.map((x) => ({ partyRole: x.partyRole, confirmedAt: x.confirmedAt })),
});

/**
 * B5: how "done" a case really is. `fullyResolved` is false while an appeal is undecided or a consequence of an appeal is OPEN or NEEDS_RECONCILIATION - also AFTER the case is CLOSED.
 * `moneyAxisSettled` is never true while a money consequence is unsettled; the derived `financial` view is never rewritten to look finished.
 */
export function closureOf(c: { status: string; closeReason: string | null }, appeals: Array<{ id: string; status: string; consequences: Array<{ id: string; kind: string; status: string }> }>) {
  const unresolved = appeals.flatMap((a) => a.consequences.filter((x) => x.status !== "RESOLVED").map((x) => ({ appealId: a.id, consequenceId: x.id, kind: x.kind, status: x.status })));
  const pendingAppeals = appeals.filter((a) => a.status !== "DECIDED").length;
  const moneyOpen = unresolved.some((u) => u.kind === "MONEY");
  return {
    state: c.status === "CLOSED" ? ("CLOSED" as const) : ("OPEN" as const),
    closeReason: c.closeReason,
    fullyResolved: unresolved.length === 0 && pendingAppeals === 0,
    pendingAppeals,
    unresolved,
    moneyAxisSettled: !moneyOpen,
    note: "Đóng hồ sơ không bao giờ có nghĩa tiền đã chuyển; đọc trạng thái tiền ở mục tài chính.",
  };
}

/**
 * R-14: the event line an admin reads. The raw payload (request hash, the stored answer of an idempotent call) and the idempotency key never leave the server; `summary` keeps only
 * the SHORT scalar facts the action recorded in payload.detail (ids, counts, results). Newest first.
 */
export function eventSummaries(events: Array<{ id: string; action: string; actorUserId: string; actorRole: string; fromStatus: string | null; toStatus: string | null; note: string | null; createdAt: Date; payload: unknown }>) {
  const scalar = (v: unknown) => v === null || typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length <= 300);
  return events.map((e) => {
    const detail = (e.payload as { detail?: unknown } | null | undefined)?.detail;
    const summary: Record<string, unknown> = {};
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      for (const [k, v] of Object.entries(detail as Record<string, unknown>)) {
        if (scalar(v)) summary[k] = v;
        else if (Array.isArray(v) && v.length <= 20 && v.every(scalar)) summary[k] = v;
      }
    }
    return { id: e.id, action: e.action, actorUserId: e.actorUserId, actorRole: e.actorRole, fromStatus: e.fromStatus, toStatus: e.toStatus, note: e.note, createdAt: e.createdAt, summary };
  });
}

/** Blockers a person can read BEFORE pressing execute (informational: the executor re-checks everything itself). */
function executionBlockers(c: CaseRow, proposal: { executionBlockedReason: string | null } | null, sessionStatus: string | null, reviews: Array<{ current: boolean; result: string }>) {
  const out: Array<{ code: string; message: string }> = [];
  if (c.status !== "DECISION_APPROVED" || c.execStatus === "BUSINESS_DONE") return out;
  if (!executionEnabled()) out.push({ code: "EXECUTION_DISABLED", message: "Bộ thực thi quyết định hồ sơ đang tắt" });
  const cur = reviews.find((r) => r.current);
  if (!cur) out.push({ code: "POLICY_ELIGIBILITY_UNVERIFIED", message: "Hợp đồng chưa có kết luận chính sách đã được duyệt" });
  else if (cur.result !== "ELIGIBLE_CURRENT_POLICY") out.push({ code: "POLICY_EXCEPTION_APPLIES", message: "Hợp đồng thuộc một ngoại lệ lịch sử cần xử lý riêng" });
  if (proposal?.executionBlockedReason) out.push({ code: proposal.executionBlockedReason, message: "Buổi tập có khoản đền đến muộn cần được đối soát trước khi thực thi" });
  if (sessionStatus === "PT_NO_SHOW_REPORTED") out.push({ code: "PT_NO_SHOW_REPORTED_NOT_SUPPORTED", message: "Buổi đang chờ huấn luyện viên phản hồi báo vắng mặt; chưa thực thi được" });
  else if (sessionStatus !== null && sessionStatus !== "DISPUTED") out.push({ code: "SESSION_ALREADY_PROCESSED", message: "Buổi tập không còn ở trạng thái đang khiếu nại" });
  return out;
}

/** The execution axis as the admin reads it: the real execStatus, the decision it belongs to, the reason it waits, and the history from the append-only table. */
function executionView(
  c: CaseRow,
  proposal: { id: string; outcome: string; executionBlockedReason: string | null } | null,
  approval: { id: string } | null,
  executions: Array<Prisma.DisputeCaseExecutionGetPayload<{}>>,
  events: Array<{ action: string; createdAt: Date; note: string | null; actorUserId: string }>,
  sessionStatus: string | null,
  reviews: Array<{ current: boolean; result: string }>,
) {
  const lastWaiting = [...executions].reverse().find((e) => e.state === "BLOCKED" || e.state === "NEEDS_HUMAN");
  const blockedReason = c.execStatus === "EXEC_BLOCKED" || c.execStatus === "NEEDS_HUMAN" ? (lastWaiting?.blockedReason ?? null) : null;
  return {
    status: c.execStatus,
    decisionId: c.execDecisionId ?? approval?.id ?? null,
    outcome: proposal?.outcome ?? null,
    blockedReason,
    blockedReasonText: blockedReason ? blockReasonVi(blockedReason) : null,
    blockers: executionBlockers(c, proposal, sessionStatus, reviews),
    needsHuman: c.execStatus === "NEEDS_HUMAN" ? { reason: lastWaiting?.blockedReason ?? null, detail: lastWaiting?.response ?? null, sessionStatus } : null,
    history: executions.map((e) => ({ id: e.id, state: e.state, attempt: e.attempt, outcome: e.outcome, blockedReason: e.blockedReason, note: e.note, actorUserId: e.actorUserId, response: e.response, createdAt: e.createdAt })),
    acknowledgements: events.filter((e) => e.action === "NEEDS_HUMAN_ACKNOWLEDGED").map((e) => ({ actorUserId: e.actorUserId, note: e.note, createdAt: e.createdAt })),
    moneyNote: "Trạng thái tiền được dẫn xuất riêng ở mục financial; execStatus BUSINESS_DONE chỉ nghĩa là đường nghiệp vụ đã trả lời, không phải tiền đã tới.",
  };
}

// ── Evidence-change guard & access log ───────────────────────────────────────────────────────────────────────────────

/**
 * What changed since the proposal's snapshot: rows written after it, plus any live source whose current hash differs from the latest stored
 * row (a change nobody has re-collected yet). Pure reads; callable inside the approve transaction.
 */
/**
 * INT-06: read-only preview of what the approve guard will say about evidence, computed from STORED rows only (same diffAgainstSnapshot / changeAcknowledged as the guard).
 * It CANNOT know about a live source (chat / gym) that changed but was not re-collected yet, nor one that cannot be read now: those need the network read of evidenceGuard at approve time,
 * so `liveSourcesChecked` is false and `needsRecollect` is only ever true for what is knowable (never here). The approve call stays the authority.
 */
async function evidenceChangeView(c: CaseRow, snapshot: SnapshotEntry[], evidence: Array<{ id: string; contentHash: string; createdAt: Date }>, statements: Array<{ id: string; contentHash: string; createdAt: Date }>) {
  const r = diffAgainstSnapshot({
    snapshot,
    current: [...evidence.map((e) => ({ id: e.id, hash: e.contentHash, createdAt: e.createdAt })), ...statements.map((x) => ({ id: x.id, hash: x.contentHash, createdAt: x.createdAt }))],
    staleLive: [],
  });
  const evIds = new Set(evidence.map((e) => e.id));
  const ids = [...r.newIds.map((id) => ({ id, change: "NEW" as const })), ...r.mutatedIds.map((id) => ({ id, change: "MUTATED" as const }))];
  const acknowledged = r.changed ? changeAcknowledged(r, true, await ackTimesOf(prisma, c)) : false;
  return {
    changedSinceProposal: r.changed,
    acknowledgedByInvestigator: acknowledged,
    needsRecollect: false,
    liveSourcesChecked: false,
    items: ids.map((i) => ({ id: i.id, kind: evIds.has(i.id) ? "EVIDENCE" : "STATEMENT", change: i.change })),
  };
}

export async function evidenceGuard(tx: Tx, c: CaseRow, snapshot: SnapshotEntry[], prefetched?: EvidenceDraft[] | null) {
  const [ev, st] = await Promise.all([
    tx.disputeCaseEvidence.findMany({ where: { caseId: c.id }, select: { id: true, contentHash: true, createdAt: true } }),
    tx.disputeCaseStatement.findMany({ where: { caseId: c.id }, select: { id: true, contentHash: true, createdAt: true } }),
  ]);
  const heads = await systemHeads(tx, c.id);
  const collected = await collectSources(tx, c.sessionId, undefined, prefetched);
  const staleLive: string[] = [];
  const unreadableLive: string[] = [];
  for (const d of collected?.evidence ?? []) {
    const head = heads.get(slotKey(d.source, d.subject));
    if (head && head.hash === draftHash(d)) continue;
    // F5: the live read FAILED now while the stored head holds real data: unknown, not changed.
    if (head && d.captureStatus === "UNAVAILABLE" && head.captureStatus !== "UNAVAILABLE") unreadableLive.push(`${d.source}#${d.subject}`);
    else staleLive.push(`${d.source}#${d.subject}`);
  }
  return diffAgainstSnapshot({
    snapshot,
    current: [...ev.map((e) => ({ id: e.id, hash: e.contentHash, createdAt: e.createdAt })), ...st.map((s) => ({ id: s.id, hash: s.contentHash, createdAt: s.createdAt }))],
    staleLive,
    unreadableLive,
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

/**
 * C3 (Ngai 05/11): EVIDENCE_SOURCE_UNAVAILABLE is not left to the caller. Each refusal is recorded (append-only event, outside the failed transaction), the answer carries a backoff
 * (30 s, 60 s, 120 s ... capped at 8 min: ADVICE, the next try still reads the live source), and after EVIDENCE_RETRY.maxAttempts consecutive failures the case is ESCALATED
 * (escalated flag, event, notice) with the responsible admin (the investigator) named. A decision or an execution start ends the streak. It moves no money and approves nothing.
 */
export const EVIDENCE_RETRY = { maxAttempts: 5, baseSeconds: 30, capSeconds: 480 } as const;
const STREAK_RESET_ACTIONS = ["DECISION_APPROVED", "DECISION_REJECTED", "EXECUTION_STARTED"];

export async function recordEvidenceSourceFailure(caseId: string, actor: Actor, unreadable: string[]) {
  const c = await prisma.disputeCase.findUnique({ where: { id: caseId } });
  if (!c) throw notFoundCase();
  const lastReset = await prisma.disputeCaseEvent.findFirst({ where: { caseId, action: { in: STREAK_RESET_ACTIONS } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { createdAt: true } });
  const streak = await prisma.disputeCaseEvent.count({ where: { caseId, action: "EVIDENCE_SOURCE_UNAVAILABLE", ...(lastReset ? { createdAt: { gt: lastReset.createdAt } } : {}) } });
  const attempt = streak + 1;
  const retryAfterSeconds = Math.min(EVIDENCE_RETRY.baseSeconds * 2 ** (attempt - 1), EVIDENCE_RETRY.capSeconds);
  await prisma.disputeCaseEvent.create({
    data: { caseId, actorUserId: actor.id, actorRole: actor.role, action: "EVIDENCE_SOURCE_UNAVAILABLE", note: `lần ${attempt}`, payload: toJson({ attempt, unreadable, retryAfterSeconds }) },
  });
  let escalated = c.escalated;
  if (attempt >= EVIDENCE_RETRY.maxAttempts && !(await prisma.disputeCaseEvent.findFirst({ where: { caseId, action: "EVIDENCE_SOURCE_ESCALATED", ...(lastReset ? { createdAt: { gt: lastReset.createdAt } } : {}) }, select: { id: true } }))) {
    await prisma.disputeCase.updateMany({ where: { id: caseId }, data: { escalated: true, version: { increment: 1 } } });
    await prisma.disputeCaseEvent.create({
      data: { caseId, actorUserId: actor.id, actorRole: actor.role, action: "EVIDENCE_SOURCE_ESCALATED", note: `sau ${attempt} lần không đọc được nguồn`, payload: toJson({ attempt, unreadable, responsibleAdminId: c.investigatorId }) },
    });
    await sendNotices([noticesFor("EVIDENCE_SOURCE_ESCALATED", c)]);
    escalated = true;
  }
  return { attempt, maxAttempts: EVIDENCE_RETRY.maxAttempts, retryAfterSeconds, escalated, responsibleAdminId: c.investigatorId };
}

/** Turns the plain 503 into the C3 answer; any other error passes through untouched. */
export async function enrichEvidenceSourceError(e: unknown, caseId: string, actor: Actor): Promise<unknown> {
  const err = e as { code?: string; message?: string; details?: { unreadable?: string[] } };
  if (err?.code !== "EVIDENCE_SOURCE_UNAVAILABLE" || !UUID_RE.test(caseId)) return e;
  try {
    const info = await recordEvidenceSourceFailure(caseId, actor, err.details?.unreadable ?? []);
    return caseError(503, "EVIDENCE_SOURCE_UNAVAILABLE", err.message ?? "Chưa đọc được nguồn bằng chứng", { ...(err.details ?? {}), retryable: true, ...info });
  } catch {
    return e;
  }
}

export const __internals = { mutate, lockCase, casStatus, casData, casClose, stateNotAllowed, requireUuid, summary, assertAdmin, assertInvestigator, toJson, displayNames, nameOf };
export const __test__ = { canonicalJson, sha256Hex };
export type { PartyRole };
