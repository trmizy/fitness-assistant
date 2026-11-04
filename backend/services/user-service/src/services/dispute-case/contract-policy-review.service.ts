import { Prisma } from "../../generated/prisma";
import { prisma } from "../../repositories/profile.repository";
import { isDraftTermsVersionId } from "../pt-terms";
import { contentHashOf } from "./canonical";
import { caseError } from "./errors";
import { checkApprover } from "./rules";
import { policyReviewsOf } from "./dispute-case.service";

/**
 * D-NEW-12, CONTRACT-LEVEL policy review (Ngai's decision 03/11/2026). A review of ONE contract that needs NO Case: a non-disputed transaction (release, no-show) must not be blocked
 * globally just because nobody could attach a Case. It writes the SAME table the Case-level review writes (case_id NULL), so `assertPolicyEligibility` accepts an approved contract-level
 * review exactly like a Case-level one; nothing else about that guard changes.
 *
 *   evidence   a list of REFERENCES the server RESOLVES against real rows of THIS contract (a pt_terms_acceptances row of the contract's PT, or an audit_logs row of the contract).
 *              Free text is never proof: `reasoning` is explanation only and is never read by any rule. A reference that names a DRAFT terms version is refused (a draft is never proof).
 *              PT acceptance says nothing about the client, so there is no reference kind that pretends otherwise.
 *   four eyes  proposer: an ADMIN who is not a party of the contract; approver: another ADMIN, not the proposer, not a party, declares no conflict (checkApprover, the same rule as everywhere).
 *   audit      append-only dispute_policy_review_events (who, what, the stored answer of an Idempotency-Key). Idempotency-Key replays the stored answer.
 *   classifier READ-ONLY `classify`: shows the group and the missing facts. It never writes and never makes the guard pass.
 */
export interface Actor {
  id: string;
  role: string;
}
type Tx = Prisma.TransactionClient;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const toJson = (v: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(v ?? null));

export type EvidenceRefKind = "PT_TERMS_ACCEPTANCE" | "CONTRACT_AUDIT_LOG";
export interface EvidenceRefInput {
  kind: EvidenceRefKind;
  id: string;
}

async function loadContract(db: Tx | typeof prisma, contractId: string) {
  const c = UUID_RE.test(contractId) ? await db.contract.findUnique({ where: { id: contractId }, select: { id: true, clientUserId: true, ptUserId: true, status: true, createdAt: true, startDate: true } }) : null;
  if (!c) throw caseError(404, "CONTRACT_NOT_FOUND", "Không tìm thấy hợp đồng");
  return c;
}
const isParty = (c: { clientUserId: string; ptUserId: string }, userId: string) => userId === c.clientUserId || userId === c.ptUserId;

/** Resolves every reference against the database. Throws a coded 422 for the first that is not proof. Returns the stored form (kind, id, hash, small summary). */
async function resolveRefs(tx: Tx, contract: { id: string; ptUserId: string }, refs: EvidenceRefInput[]) {
  const seen = new Set<string>();
  const out: Array<{ kind: EvidenceRefKind; id: string; hash: string; summary: Record<string, unknown> }> = [];
  for (const r of refs) {
    const key = `${r.kind}:${r.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (r.kind === "PT_TERMS_ACCEPTANCE") {
      const row = await tx.ptTermsAcceptance.findUnique({ where: { id: r.id } });
      if (!row) throw caseError(422, "EVIDENCE_REF_NOT_FOUND", "Không tìm thấy bản ghi chấp nhận điều khoản được tham chiếu", { kind: r.kind, id: r.id });
      if (row.userId !== contract.ptUserId) throw caseError(422, "EVIDENCE_REF_NOT_IN_CONTRACT", "Bản ghi chấp nhận không phải của PT của hợp đồng này", { kind: r.kind, id: r.id });
      if (isDraftTermsVersionId(row.version)) throw caseError(422, "EVIDENCE_REF_NOT_PROOF", "Điều khoản bản nháp không phải là bằng chứng", { kind: r.kind, id: r.id, version: row.version });
      out.push({
        kind: r.kind,
        id: r.id,
        hash: contentHashOf({ id: row.id, userId: row.userId, version: row.version, source: row.source, acceptedAt: row.acceptedAt }),
        summary: { version: row.version, source: row.source, acceptedAt: row.acceptedAt, party: "PT" },
      });
    } else {
      const row = await tx.auditLog.findUnique({ where: { id: r.id } });
      if (!row) throw caseError(422, "EVIDENCE_REF_NOT_FOUND", "Không tìm thấy bản ghi nhật ký được tham chiếu", { kind: r.kind, id: r.id });
      if (row.entityType !== "CONTRACT" || row.entityId !== contract.id) throw caseError(422, "EVIDENCE_REF_NOT_IN_CONTRACT", "Bản ghi nhật ký không thuộc hợp đồng này", { kind: r.kind, id: r.id });
      const stated = (row.metadata as { ptTermsVersion?: unknown } | null)?.ptTermsVersion;
      if (typeof stated === "string" && isDraftTermsVersionId(stated)) {
        throw caseError(422, "EVIDENCE_REF_NOT_PROOF", "Bản ghi này nêu điều khoản bản nháp, không phải là bằng chứng", { kind: r.kind, id: r.id, version: stated });
      }
      out.push({
        kind: r.kind,
        id: r.id,
        hash: contentHashOf({ id: row.id, actorUserId: row.actorUserId, action: row.action, metadata: row.metadata, createdAt: row.createdAt }),
        summary: { action: row.action, createdAt: row.createdAt, ...(typeof stated === "string" ? { ptTermsVersion: stated } : {}) },
      });
    }
  }
  return out;
}

async function findReplay<T>(key: string | null, requestHash: string): Promise<{ result: T; replayed: true } | null> {
  if (!key) return null;
  const prior = await prisma.disputePolicyReviewEvent.findUnique({ where: { idempotencyKey: key } });
  if (!prior) return null;
  const p = (prior.payload ?? {}) as { requestHash?: string; result?: T };
  if (p.requestHash !== requestHash) throw caseError(409, "IDEMPOTENCY_KEY_REUSED", "Khoá Idempotency-Key này đã được dùng cho một yêu cầu khác nội dung");
  return { result: p.result as T, replayed: true };
}
const isUnique = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";

export const contractPolicyReviewService = {
  async propose(
    actor: Actor,
    contractId: string,
    b: { result: "ELIGIBLE_CURRENT_POLICY" | "EXCEPTION_APPLIES"; evidenceRefs: EvidenceRefInput[]; reasoning: string; supersedesId?: string },
    idempotencyKey?: string,
  ) {
    if (actor.role !== "ADMIN") throw caseError(403, "ADMIN_ONLY", "Chỉ quản trị viên được thực hiện thao tác này");
    const key = idempotencyKey ? `${actor.id}:CONTRACT_POLICY_PROPOSED:${contractId}:${idempotencyKey}` : null;
    const requestHash = contentHashOf(b);
    const prior = await findReplay<Record<string, unknown>>(key, requestHash);
    if (prior) return prior;
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const contract = await loadContract(tx, contractId);
          if (isParty(contract, actor.id)) throw caseError(403, "CONFLICT_OF_INTEREST", "Quản trị viên là một bên của hợp đồng nên không được đề xuất kết luận chính sách");
          if (b.supersedesId) {
            const prev = UUID_RE.test(b.supersedesId) ? await tx.disputeCasePolicyEligibilityReview.findUnique({ where: { id: b.supersedesId } }) : null;
            if (!prev || prev.contractId !== contract.id) throw caseError(422, "SUPERSEDES_INVALID", "Kết luận được thay thế phải là của cùng hợp đồng");
          }
          const refs = await resolveRefs(tx, contract, b.evidenceRefs);
          const row = await tx.disputeCasePolicyEligibilityReview.create({
            data: { caseId: null, contractId: contract.id, result: b.result, evidenceIds: [], evidenceRefs: toJson(refs), reasoning: b.reasoning, proposedBy: actor.id, supersedesId: b.supersedesId ?? null },
          });
          const out = { reviewId: row.id, level: "CONTRACT" as const, result: row.result, contractId: contract.id, approved: false, evidenceRefs: refs.map((r) => ({ kind: r.kind, id: r.id, hash: r.hash })) };
          await tx.disputePolicyReviewEvent.create({
            data: {
              reviewId: row.id,
              contractId: contract.id,
              actorUserId: actor.id,
              actorRole: actor.role,
              action: "CONTRACT_POLICY_PROPOSED",
              note: b.reasoning,
              idempotencyKey: key,
              payload: toJson({ requestHash, result: out, detail: { result: b.result, supersedesId: b.supersedesId ?? null, refs: refs.map((r) => `${r.kind}:${r.id}`) } }),
            },
          });
          return out;
        },
        { timeout: 20_000 },
      );
      return { result, replayed: false as const };
    } catch (e) {
      if (key && isUnique(e)) {
        const again = await findReplay<Record<string, unknown>>(key, requestHash);
        if (again) return again;
      }
      throw e;
    }
  },

  async approve(actor: Actor, contractId: string, reviewId: string, b: { reason: string; conflictOfInterestDeclaredNone: boolean }, idempotencyKey?: string) {
    if (actor.role !== "ADMIN") throw caseError(403, "ADMIN_ONLY", "Chỉ quản trị viên được thực hiện thao tác này");
    const key = idempotencyKey ? `${actor.id}:CONTRACT_POLICY_APPROVED:${reviewId}:${idempotencyKey}` : null;
    const requestHash = contentHashOf(b);
    const prior = await findReplay<Record<string, unknown>>(key, requestHash);
    if (prior) return prior;
    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const contract = await loadContract(tx, contractId);
          const row = UUID_RE.test(reviewId) ? await tx.disputeCasePolicyEligibilityReview.findUnique({ where: { id: reviewId } }) : null;
          if (!row || row.contractId !== contract.id || row.caseId !== null) throw caseError(404, "POLICY_REVIEW_NOT_FOUND", "Không tìm thấy kết luận chính sách cấp hợp đồng này");
          const verdict = checkApprover({
            approverId: actor.id,
            approverRole: actor.role,
            proposerId: row.proposedBy,
            investigatorId: null,
            clientUserId: contract.clientUserId,
            ptUserId: contract.ptUserId,
            conflictOfInterestDeclaredNone: b.conflictOfInterestDeclaredNone,
          });
          if (!verdict.ok) throw caseError(verdict.status, verdict.code, verdict.message);
          if (row.approvedAt) throw caseError(409, "POLICY_REVIEW_ALREADY_APPROVED", "Kết luận chính sách này đã được duyệt");
          // the references are checked AGAIN at approval: a row the review cites must still resolve (the approver approves what is true now)
          const refs = (row.evidenceRefs ?? []) as unknown as Array<{ kind: EvidenceRefKind; id: string; hash: string }>;
          const fresh = await resolveRefs(tx, contract, refs.map((r) => ({ kind: r.kind, id: r.id })));
          if (fresh.length !== refs.length || fresh.some((f) => refs.find((r) => r.kind === f.kind && r.id === f.id)?.hash !== f.hash)) {
            throw caseError(409, "EVIDENCE_REF_CHANGED", "Một tham chiếu bằng chứng của kết luận không còn khớp với bản ghi gốc", { reviewId });
          }
          const stamped = await tx.disputeCasePolicyEligibilityReview.updateMany({ where: { id: row.id, approvedAt: null }, data: { approvedBy: actor.id, approvedAt: new Date() } });
          if (stamped.count !== 1) throw caseError(409, "POLICY_REVIEW_ALREADY_APPROVED", "Kết luận chính sách này đã được duyệt");
          const out = { reviewId: row.id, level: "CONTRACT" as const, result: row.result, contractId: contract.id, approved: true };
          await tx.disputePolicyReviewEvent.create({
            data: {
              reviewId: row.id,
              contractId: contract.id,
              actorUserId: actor.id,
              actorRole: actor.role,
              action: "CONTRACT_POLICY_APPROVED",
              note: b.reason,
              idempotencyKey: key,
              payload: toJson({ requestHash, result: out, detail: { proposedBy: row.proposedBy, conflictOfInterestDeclaredNone: b.conflictOfInterestDeclaredNone } }),
            },
          });
          return out;
        },
        { timeout: 20_000 },
      );
      return { result, replayed: false as const };
    } catch (e) {
      if (key && isUnique(e)) {
        const again = await findReplay<Record<string, unknown>>(key, requestHash);
        if (again) return again;
      }
      throw e;
    }
  },

  /** READ-ONLY: the group of a contract and the facts the data can / cannot support. Writes nothing; its answer is never read by assertPolicyEligibility. */
  async classify(actor: Actor, contractId: string) {
    if (actor.role !== "ADMIN") throw caseError(403, "ADMIN_ONLY", "Chỉ quản trị viên được thực hiện thao tác này");
    const contract = await loadContract(prisma, contractId);
    const [acceptances, audits, reviews] = await Promise.all([
      prisma.ptTermsAcceptance.findMany({ where: { userId: contract.ptUserId }, orderBy: [{ acceptedAt: "asc" }, { id: "asc" }], select: { id: true, version: true, source: true, acceptedAt: true } }),
      prisma.auditLog.findMany({ where: { entityType: "CONTRACT", entityId: contract.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 200, select: { id: true, action: true, createdAt: true, metadata: true } }),
      policyReviewsOf(prisma, contract.id),
    ]);
    const ptAtAcceptance = audits.find((a) => typeof (a.metadata as { ptTermsVersion?: unknown } | null)?.ptTermsVersion === "string");
    return classifyContractPolicy({
      contract,
      ptAcceptances: acceptances.map((a) => ({ ...a, isDraft: isDraftTermsVersionId(a.version) })),
      ptTermsAtAcceptance: ptAtAcceptance
        ? { auditLogId: ptAtAcceptance.id, version: (ptAtAcceptance.metadata as { ptTermsVersion: string }).ptTermsVersion, at: ptAtAcceptance.createdAt }
        : null,
      reviews: { currentReviewId: reviews.currentReviewId, currentResult: reviews.currentResult, pending: reviews.items.filter((r) => r.status === "PENDING").length },
    });
  },
};

/** Mốc rà soát 20/10/2026 (đầu ngày, giờ Việt Nam): chỉ để xếp hàng rà soát, KHÔNG BAO GIỜ là bằng chứng. */
export const REVIEW_CUTOFF = new Date("2026-10-20T00:00:00+07:00");

export interface ClassifyInput {
  contract: { id: string; status: string; createdAt: Date; startDate: Date | null };
  ptAcceptances: Array<{ id: string; version: string; source: string; acceptedAt: Date; isDraft: boolean }>;
  ptTermsAtAcceptance: { auditLogId: string; version: string; at: Date } | null;
  reviews: { currentReviewId: string | null; currentResult: string | null; pending: number };
  /** Nguồn chưa tồn tại (D-NEW-12 đề xuất mục 5): luôn null cho tới khi Ngài quyết định tạo ra nó. */
  effectivePolicy?: { version: string; effectiveFrom: Date; isDraft: boolean } | null;
  /** Nguồn chưa tồn tại: bản ghi chấp nhận của KHÁCH theo hợp đồng + phiên bản. */
  clientAcceptance?: { version: string; acceptedAt: Date } | null;
}

export type PolicyGroup = "NEW_CURRENT_POLICY" | "HISTORICAL_NOTICE" | "INSUFFICIENT_DATA" | "EXCEPTION_VERIFIED";

export function classifyContractPolicy(i: ClassifyInput) {
  const missing: Array<{ code: string; message: string }> = [];
  const policy = i.effectivePolicy ?? null;
  if (!policy) missing.push({ code: "NO_EFFECTIVE_POLICY_VERSION", message: "Chưa có phiên bản chính sách khiếu nại chính thức và ngày hiệu lực trong hệ thống" });
  else if (policy.isDraft) missing.push({ code: "POLICY_VERSION_IS_DRAFT", message: "Phiên bản chính sách hiện có là bản nháp, không phải bằng chứng" });
  const officialPt = i.ptAcceptances.filter((a) => !a.isDraft);
  if (officialPt.length === 0) missing.push({ code: "NO_OFFICIAL_PT_ACCEPTANCE", message: "PT chưa có bản ghi chấp nhận điều khoản chính thức (chỉ có bản nháp hoặc chưa có)" });
  if (!i.clientAcceptance) missing.push({ code: "NO_CLIENT_ACCEPTANCE", message: "Không có bản ghi khách đã chấp nhận điều khoản nào (PT chấp nhận không suy ra khách chấp nhận)" });
  if (!i.ptTermsAtAcceptance) missing.push({ code: "NO_TERMS_VERSION_LINKED_TO_CONTRACT", message: "Không có nhật ký nào gắn hợp đồng này với một phiên bản điều khoản" });
  else if (isDraftTermsVersionId(i.ptTermsAtAcceptance.version)) missing.push({ code: "LINKED_TERMS_VERSION_IS_DRAFT", message: "Phiên bản điều khoản gắn với hợp đồng là bản nháp" });

  const exception = i.reviews.currentResult === "EXCEPTION_APPLIES";
  // NEW_CURRENT_POLICY needs EVERY machine-checkable condition; today the sources of two of them do not exist, so this is unreachable until Ngai decides to create them.
  const allMachineConditions =
    !!policy && !policy.isDraft && !!i.clientAcceptance && officialPt.length > 0 && !!i.ptTermsAtAcceptance && !isDraftTermsVersionId(i.ptTermsAtAcceptance.version) && i.contract.createdAt >= policy.effectiveFrom && !exception;
  const group: PolicyGroup = exception ? "EXCEPTION_VERIFIED" : allMachineConditions ? "NEW_CURRENT_POLICY" : i.contract.createdAt < REVIEW_CUTOFF ? "HISTORICAL_NOTICE" : "INSUFFICIENT_DATA";
  return {
    contractId: i.contract.id,
    group,
    /** Ngài chưa duyệt tự động đủ điều kiện: luôn false. Phân loại không bao giờ làm cổng chính sách qua. */
    autoEligible: false as const,
    reviewRequired: true as const,
    reviewCutoff: { date: REVIEW_CUTOFF.toISOString(), role: "REVIEW_HINT_ONLY" as const },
    facts: {
      contract: { status: i.contract.status, createdAt: i.contract.createdAt, startDate: i.contract.startDate, createdBeforeReviewCutoff: i.contract.createdAt < REVIEW_CUTOFF },
      ptAcceptances: i.ptAcceptances,
      ptTermsAtAcceptance: i.ptTermsAtAcceptance,
      clientAcceptance: i.clientAcceptance ? { available: true as const, ...i.clientAcceptance } : { available: false as const },
      effectivePolicy: policy ? { available: true as const, ...policy } : { available: false as const },
      reviews: i.reviews,
    },
    missing,
    note: "Chỉ để hiển thị và xếp hàng rà soát. Mở khoá phán quyết chỉ bằng một kết luận chính sách đã được duyệt bốn mắt (cấp hợp đồng hoặc cấp hồ sơ).",
  };
}
