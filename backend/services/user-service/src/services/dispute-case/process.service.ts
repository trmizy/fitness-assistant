import type { Prisma } from "../../generated/prisma";
import { prisma } from "../../repositories/profile.repository";
import { withContractLock } from "../contract-lock";
import { assertRealAdmin } from "./admin-account";
import { now as clockNow, DAY_MS } from "./clock";
import { contentHashOf } from "./canonical";
import { caseError } from "./errors";
import { appealsEnabled } from "./flags";
import { noticesFor } from "./notices";
import { __internals, type Actor } from "./dispute-case.service";
import { APPEAL_WINDOW_DAYS, checkApprover, outcomeForFinding, partyRoleOf, type CaseStatus, type FindingKind } from "./rules";
import { HELD_REVIEW_DAYS } from "./dispute-timers.service";
import { paymentClient } from "../../clients/payment.client";
import { logger } from "@gym-coach/shared";

/**
 * DISPUTE V2.1 PROCESS (Ngai 05/11/2026): mutual agreement, appeal (review request), the consequences of an appeal (B2-B4), the quota correction (B3), the held-money decision and the
 * visible stuck queue. Every mutating route is behind the fail-closed flag DISPUTE_CASE_APPEALS_ENABLED (409 DISPUTE_PROCESS_DISABLED). Case-level actions go through the same lock + CAS +
 * append-only event + Idempotency-Key wrapper as every other case action. NOTHING here executes a ruling or pays: the money path stays the executor (and payment-service).
 */
export { APPEAL_WINDOW_DAYS };
const OUTCOME_LABEL_VI: Record<string, string> = {
  COMPLETED: "Buổi tập được tính là đã hoàn thành",
  CANCELLED: "Buổi tập huỷ, không trừ buổi",
  PT_NO_SHOW_CONFIRMED: "Xác nhận huấn luyện viên vắng mặt",
};
export const outcomeLabelVi = (o: string) => OUTCOME_LABEL_VI[o] ?? o;
/** The finding that carries each agreed outcome into the NORMAL proposal / four-eyes / executor path. */
const FINDING_FOR_OUTCOME: Record<string, FindingKind> = { COMPLETED: "VERIFIED_DELIVERED", CANCELLED: "VERIFIED_NOT_DELIVERED_NO_FAULT", PT_NO_SHOW_CONFIRMED: "VERIFIED_PT_ABSENT" };

const requireFlag = () => {
  if (!appealsEnabled()) throw caseError(409, "DISPUTE_PROCESS_DISABLED", "Chức năng thoả thuận, xem xét lại và hiệu chỉnh buổi chưa được bật");
};
const text = (s: unknown) => String(s ?? "");

/** content both parties confirm: it names the case, the session and the outcome - nothing else can be agreed to by confirming this hash */
export const agreementHash = (caseId: string, sessionId: string, outcome: string) => contentHashOf({ kind: "DISPUTE_AGREEMENT", caseId, sessionId, outcome });

export const processService = {
  // ── Mutual agreement ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────

  async proposeAgreement(actor: Actor, caseId: string, b: { outcome: "COMPLETED" | "CANCELLED" | "PT_NO_SHOW_CONFIRMED"; note: string }, key?: string) {
    requireFlag();
    __internals.assertAdmin(actor);
    return __internals.mutate<Record<string, unknown>>({
      actor,
      action: "AGREEMENT_PROPOSED",
      scope: caseId,
      idempotencyKey: key,
      body: b,
      run: async (ctx) => {
        const c = await __internals.lockCase(ctx.tx, caseId);
        __internals.assertInvestigator(actor, c);
        if (!["COLLECTING", "AWAITING_PARTIES", "ASSESSING"].includes(c.status)) throw __internals.stateNotAllowed(c, ["COLLECTING", "AWAITING_PARTIES", "ASSESSING"]);
        if (c.type === "LEGACY_UNCLASSIFIED") throw caseError(409, "CLASSIFICATION_REQUIRED", "Hồ sơ còn ở phân loại tạm; cần phân loại trước");
        await ctx.tx.disputeCaseAgreement.updateMany({ where: { caseId: c.id, status: "PROPOSED" }, data: { status: "WITHDRAWN" } });
        const hash = agreementHash(c.id, c.sessionId, b.outcome);
        const row = await ctx.tx.disputeCaseAgreement.create({ data: { caseId: c.id, outcome: b.outcome, contentHash: hash, note: b.note, proposedBy: actor.id } });
        ctx.notices.push(noticesFor("AGREEMENT_PROPOSED", c));
        return { caseId: c.id, result: { id: row.id, outcome: row.outcome, outcomeLabel: outcomeLabelVi(row.outcome), contentHash: hash, status: row.status }, note: b.note, detail: { agreementId: row.id, outcome: b.outcome, contentHash: hash } };
      },
    });
  },

  /** A party confirms the SAME content: it must send the hash of exactly what was proposed. Both confirmed -> AGREED. Nothing is executed. */
  async confirmAgreement(actor: Actor, caseId: string, agreementId: string, b: { contentHash: string }, key?: string) {
    requireFlag();
    __internals.requireUuid(caseId);
    return __internals.mutate<Record<string, unknown>>({
      actor,
      action: "AGREEMENT_CONFIRMED",
      scope: `${caseId}:${agreementId}`,
      idempotencyKey: key,
      body: b,
      run: async (ctx) => {
        const c = await __internals.lockCase(ctx.tx, caseId);
        const role = partyRoleOf(actor.id, c);
        if (!role) throw caseError(404, "CASE_NOT_FOUND", "Không tìm thấy hồ sơ khiếu nại");
        const ag = /^[0-9a-f-]{36}$/i.test(agreementId) ? await ctx.tx.disputeCaseAgreement.findUnique({ where: { id: agreementId }, include: { confirmations: true } }) : null;
        if (!ag || ag.caseId !== c.id) throw caseError(404, "AGREEMENT_NOT_FOUND", "Không tìm thấy phương án chung");
        if (ag.status !== "PROPOSED") throw caseError(409, "AGREEMENT_NOT_OPEN", "Phương án chung này không còn chờ xác nhận", { status: ag.status });
        if (b.contentHash !== ag.contentHash) throw caseError(409, "AGREEMENT_CONTENT_MISMATCH", "Nội dung xác nhận không khớp phương án được đề xuất; hãy xác nhận đúng nội dung hiển thị");
        if (ag.confirmations.some((x) => x.partyRole === role)) throw caseError(409, "AGREEMENT_ALREADY_CONFIRMED", "Bạn đã xác nhận phương án này");
        await ctx.tx.disputeCaseAgreementConfirmation.create({ data: { agreementId: ag.id, partyRole: role, userId: actor.id, confirmedHash: b.contentHash } });
        const both = new Set([...ag.confirmations.map((x) => x.partyRole), role]).size === 2;
        if (both) await ctx.tx.disputeCaseAgreement.update({ where: { id: ag.id }, data: { status: "AGREED", agreedAt: clockNow() } });
        return { caseId: c.id, result: { agreementId: ag.id, partyRole: role, status: both ? "AGREED" : "PROPOSED", bothConfirmed: both }, note: `${role} xác nhận phương án chung`, detail: { agreementId: ag.id, partyRole: role, bothConfirmed: both } };
      },
    });
  },

  async withdrawAgreement(actor: Actor, caseId: string, agreementId: string, key?: string) {
    requireFlag();
    __internals.assertAdmin(actor);
    return __internals.mutate<Record<string, unknown>>({
      actor,
      action: "AGREEMENT_WITHDRAWN",
      scope: `${caseId}:${agreementId}`,
      idempotencyKey: key,
      body: {},
      run: async (ctx) => {
        const c = await __internals.lockCase(ctx.tx, caseId);
        __internals.assertInvestigator(actor, c);
        const r = await ctx.tx.disputeCaseAgreement.updateMany({ where: { id: agreementId, caseId: c.id, status: { in: ["PROPOSED", "AGREED"] } }, data: { status: "WITHDRAWN" } });
        if (r.count !== 1) throw caseError(409, "AGREEMENT_NOT_OPEN", "Phương án chung này không còn hiệu lực để rút");
        return { caseId: c.id, result: { agreementId, status: "WITHDRAWN" } };
      },
    });
  },

  /** An AGREED agreement becomes a finding; the NORMAL proposal -> four-eyes approval -> executor path follows (nothing is executed here). */
  async recordAgreementFinding(actor: Actor, caseId: string, agreementId: string, key?: string) {
    requireFlag();
    __internals.assertAdmin(actor);
    return __internals.mutate<Record<string, unknown>>({
      actor,
      action: "AGREEMENT_FINDING_RECORDED",
      scope: `${caseId}:${agreementId}`,
      idempotencyKey: key,
      body: {},
      run: async (ctx) => {
        const c = await __internals.lockCase(ctx.tx, caseId);
        __internals.assertInvestigator(actor, c);
        if (c.status !== "ASSESSING") throw __internals.stateNotAllowed(c, ["ASSESSING"]);
        const ag = await ctx.tx.disputeCaseAgreement.findUnique({ where: { id: agreementId }, include: { confirmations: true } });
        if (!ag || ag.caseId !== c.id) throw caseError(404, "AGREEMENT_NOT_FOUND", "Không tìm thấy phương án chung");
        if (ag.status !== "AGREED" || ag.confirmations.length !== 2) throw caseError(409, "AGREEMENT_NOT_AGREED", "Cả hai bên chưa cùng xác nhận phương án này");
        if (ag.confirmations.some((x) => x.confirmedHash !== ag.contentHash) || ag.contentHash !== agreementHash(c.id, c.sessionId, ag.outcome)) {
          throw caseError(409, "AGREEMENT_CONTENT_MISMATCH", "Nội dung đã xác nhận không còn khớp phương án");
        }
        const finding = FINDING_FOR_OUTCOME[ag.outcome];
        const previous = await ctx.tx.disputeCaseFinding.findFirst({ where: { caseId: c.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
        const reasoning = `Hai bên cùng xác nhận phương án chung (${outcomeLabelVi(ag.outcome)}), mã nội dung ${ag.contentHash}. Kết luận này chưa phải quyết định: vẫn cần đề xuất và duyệt bốn mắt.`;
        const row = await ctx.tx.disputeCaseFinding.create({ data: { caseId: c.id, finding, reasoning, recordedBy: actor.id, supersedesId: previous?.id ?? null } });
        await ctx.tx.disputeCaseAgreement.update({ where: { id: ag.id }, data: { status: "USED", findingId: row.id } });
        await __internals.casStatus(ctx, c, "FINDING_RECORDED", reasoning);
        return { caseId: c.id, result: { findingId: row.id, finding, caseStatus: c.status, agreementId: ag.id, proposalPossible: outcomeForFinding(finding) !== null }, note: reasoning, detail: { agreementId: ag.id, contentHash: ag.contentHash } };
      },
    });
  },

  async listAgreements(actor: Actor, caseId: string) {
    __internals.assertAdmin(actor);
    __internals.requireUuid(caseId);
    const rows = await prisma.disputeCaseAgreement.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { confirmations: true } });
    return { items: rows.map(agreementView) };
  },

  // ── Appeal (review request) ────────────────────────────────────────────────────────────────────────────────────────────────────────────

  async requestAppeal(actor: Actor, caseId: string, b: { reason: string }, key?: string) {
    requireFlag();
    __internals.requireUuid(caseId);
    return __internals.mutate<Record<string, unknown>>({
      actor,
      action: "APPEAL_REQUESTED",
      scope: caseId,
      idempotencyKey: key,
      body: b,
      run: async (ctx) => {
        const c = await __internals.lockCase(ctx.tx, caseId);
        const role = partyRoleOf(actor.id, c);
        if (!role) throw caseError(404, "CASE_NOT_FOUND", "Không tìm thấy hồ sơ khiếu nại");
        const appealable = c.status === "DECISION_APPROVED" || (c.status === "CLOSED" && ["EXECUTED", "APPEAL_CONCLUDED"].includes(text(c.closeReason)));
        if (!appealable) throw __internals.stateNotAllowed(c, ["DECISION_APPROVED", "CLOSED"]);
        // the window opens at the moment the CONCLUSION notice to THIS party was validly recorded (in-app); no recorded notice, no window
        const notice = await ctx.tx.disputeCasePartyNotice.findFirst({ where: { caseId: c.id, userId: actor.id, kind: "CONCLUSION" }, orderBy: [{ recordedAt: "desc" }, { id: "desc" }] });
        if (!notice) throw caseError(409, "APPEAL_NOTICE_NOT_RECORDED", "Chưa có thông báo kết luận được ghi nhận cho bạn nên chưa mở thời hạn xem xét lại");
        const closesAt = new Date(notice.recordedAt.getTime() + APPEAL_WINDOW_DAYS * DAY_MS);
        if (clockNow().getTime() > closesAt.getTime()) throw caseError(409, "APPEAL_WINDOW_CLOSED", "Đã quá 14 ngày kể từ khi thông báo kết luận được ghi nhận cho bạn", { closesAt });
        const prior = await ctx.tx.disputeCaseAppeal.findUnique({ where: { caseId_partyRole: { caseId: c.id, partyRole: role } } });
        if (prior) throw caseError(409, "APPEAL_ALREADY_REQUESTED", "Mỗi bên chỉ được yêu cầu xem xét lại một lần cho mỗi hồ sơ");
        const row = await ctx.tx.disputeCaseAppeal.create({ data: { caseId: c.id, partyRole: role, requestedBy: actor.id, reason: b.reason, noticeRecordedAt: notice.recordedAt } });
        return { caseId: c.id, result: { appealId: row.id, partyRole: role, status: row.status, windowClosesAt: closesAt }, note: b.reason, detail: { appealId: row.id, partyRole: role } };
      },
    });
  },

  async assignAppealReviewer(actor: Actor, caseId: string, appealId: string, b: { reviewerId: string }, key?: string) {
    requireFlag();
    __internals.assertAdmin(actor);
    await assertRealAdmin(b.reviewerId); // network call BEFORE the transaction
    return __internals.mutate<Record<string, unknown>>({
      actor,
      action: "APPEAL_REVIEWER_ASSIGNED",
      scope: `${caseId}:${appealId}`,
      idempotencyKey: key,
      body: b,
      run: async (ctx) => {
        const c = await __internals.lockCase(ctx.tx, caseId);
        if (actor.id === c.clientUserId || actor.id === c.ptUserId) throw caseError(403, "CONFLICT_OF_INTEREST", "Quản trị viên là một bên của vụ việc");
        const ap = await ctx.tx.disputeCaseAppeal.findUnique({ where: { id: appealId } });
        if (!ap || ap.caseId !== c.id) throw caseError(404, "APPEAL_NOT_FOUND", "Không tìm thấy yêu cầu xem xét lại");
        if (ap.status === "DECIDED") throw caseError(409, "APPEAL_ALREADY_DECIDED", "Yêu cầu này đã có kết quả");
        await assertIndependentReviewer(ctx.tx, c, b.reviewerId);
        await ctx.tx.disputeCaseAppeal.update({ where: { id: ap.id }, data: { reviewerId: b.reviewerId, reviewerAssignedBy: actor.id, status: "UNDER_REVIEW" } });
        return { caseId: c.id, result: { appealId: ap.id, reviewerId: b.reviewerId, status: "UNDER_REVIEW" }, note: `reviewer ${b.reviewerId}`, detail: { appealId: ap.id, reviewerId: b.reviewerId } };
      },
    });
  },

  /**
   * The reviewer decides. The outcome ONLY records a NEW finding that references the old one (supersedesId) - nothing is rewritten, nothing is executed. Consequences are RECORDED and settled by
   * their own routes: MONEY never becomes a debt here (NEEDS_RECONCILIATION), QUOTA needs the four-eyes correction, PT_AT_FAULT is recorded and escalated only.
   */
  async decideAppeal(
    actor: Actor,
    caseId: string,
    appealId: string,
    b: { result: "UPHELD" | "NEW_FINDING"; reasoning: string; finding?: FindingKind; consequences?: Array<{ kind: "MONEY" | "QUOTA" | "PT_AT_FAULT"; note: string; amountVnd?: number; responsibleParty?: "PT" | "GYM" | "PLATFORM" }> },
    key?: string,
  ) {
    requireFlag();
    __internals.assertAdmin(actor);
    // E5: an established amount + responsible party is valid ONLY for the finding that establishes who is responsible (the PT was absent -> the PT); anything else cannot be "established" here.
    for (const k of b.consequences ?? []) {
      if (k.amountVnd === undefined) continue;
      if (b.result !== "NEW_FINDING" || b.finding !== "VERIFIED_PT_ABSENT" || k.responsibleParty !== "PT") {
        throw caseError(400, "MONEY_NOT_ESTABLISHED_BY_FINDING", "Số tiền và bên chịu trách nhiệm chỉ được nêu khi kết luận mới là 'PT vắng mặt' và bên chịu trách nhiệm là PT; các trường hợp khác để đối soát");
      }
    }
    if (b.result === "NEW_FINDING" && !b.finding) throw caseError(400, "FINDING_REQUIRED", "Kết quả 'kết luận mới' cần nêu kết luận");
    if (b.result === "UPHELD" && ((b.consequences?.length ?? 0) > 0 || b.finding)) throw caseError(400, "UPHELD_HAS_NO_CHANGE", "Giữ nguyên kết luận thì không kèm kết luận mới hay hệ quả");
    const decided = await __internals.mutate<Record<string, any>>({
      actor,
      action: "APPEAL_DECIDED",
      scope: `${caseId}:${appealId}`,
      idempotencyKey: key,
      body: b,
      run: async (ctx) => {
        const c = await __internals.lockCase(ctx.tx, caseId);
        const ap = await ctx.tx.disputeCaseAppeal.findUnique({ where: { id: appealId } });
        if (!ap || ap.caseId !== c.id) throw caseError(404, "APPEAL_NOT_FOUND", "Không tìm thấy yêu cầu xem xét lại");
        if (ap.status === "DECIDED") throw caseError(409, "APPEAL_ALREADY_DECIDED", "Yêu cầu này đã có kết quả");
        if (ap.status !== "UNDER_REVIEW" || ap.reviewerId !== actor.id) throw caseError(403, "NOT_APPEAL_REVIEWER", "Chỉ người xem xét lại được giao mới ghi kết quả");
        await assertIndependentReviewer(ctx.tx, c, actor.id);
        const previous = await ctx.tx.disputeCaseFinding.findFirst({ where: { caseId: c.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } });
        let newFindingId: string | null = null;
        const made: Array<{ id: string; kind: string; status: string }> = [];
        if (b.result === "NEW_FINDING") {
          const f = await ctx.tx.disputeCaseFinding.create({ data: { caseId: c.id, finding: b.finding!, reasoning: b.reasoning, recordedBy: actor.id, supersedesId: previous?.id ?? null } });
          newFindingId = f.id;
          for (const k of b.consequences ?? []) {
            // B2: the approved finding carries no amount and no responsible party, so a money consequence is NEVER a formal obligation here: it needs reconciliation.
            // B4: a reversed ptAtFault is recorded and escalated only. B3: a quota effect waits for its own four-eyes correction.
            const status = k.kind === "MONEY" ? "NEEDS_RECONCILIATION" : k.kind === "PT_AT_FAULT" ? "RESOLVED" : "OPEN";
            const detail =
              k.kind === "MONEY"
                ? k.amountVnd !== undefined
                  ? { obligationCreated: false, requested: { amountVnd: k.amountVnd, responsibleParty: k.responsibleParty }, why: "Kết luận đã duyệt xác lập số tiền và bên chịu trách nhiệm; đang tạo khoản nợ chính thức tại payment-service. Chưa trả tiền" }
                  : { obligationCreated: false, why: "Kết luận đã duyệt chưa xác lập số tiền và bên chịu trách nhiệm; cần đối soát, không tạo khoản nợ" }
                : k.kind === "PT_AT_FAULT"
                  ? { recordedOnly: true, entitlementsChanged: false, contractReopened: false }
                  : { correction: "PENDING_PROPOSAL" };
            const row = await ctx.tx.disputeCaseAppealConsequence.create({ data: { appealId: ap.id, caseId: c.id, kind: k.kind, status, note: k.note, detail, ...(status === "RESOLVED" ? { resolvedAt: clockNow(), resolvedBy: actor.id } : {}) } });
            made.push({ id: row.id, kind: row.kind, status: row.status });
          }
          if ((b.consequences ?? []).some((k) => k.kind === "PT_AT_FAULT") && !c.escalated) await __internals.casData(ctx, c, { escalated: true });
        }
        await ctx.tx.disputeCaseAppeal.update({
          where: { id: ap.id },
          data: { status: "DECIDED", result: b.result, reasoning: b.reasoning, decidedAt: clockNow(), previousFindingId: previous?.id ?? null, newFindingId },
        });
        ctx.notices.push(noticesFor("APPEAL_DECIDED", c));
        return {
          caseId: c.id,
          result: { appealId: ap.id, result: b.result, newFindingId, previousFindingId: previous?.id ?? null, consequences: made, fullyResolved: made.every((m) => m.status === "RESOLVED") },
          note: b.reasoning,
          detail: { appealId: ap.id, result: b.result, newFindingId, consequences: made.map((m) => `${m.kind}:${m.status}`) },
        };
      },
    });
    // E5: AFTER the decision committed (never an HTTP call inside the case transaction): every MONEY consequence whose finding ESTABLISHED an amount and a responsible party asks payment-service for the formal
    // obligation. Idempotent; a failure leaves the consequence NEEDS_RECONCILIATION (no fake debt) and the retry route finishes it.
    const rows = await processService.createObligationsForAppeal(actor, caseId, appealId);
    const res = decided.result as any;
    if (res && typeof res === "object" && Array.isArray(res.consequences)) {
      res.consequences = res.consequences.map((m: any) => ({ ...m, status: rows.get(m.id) ?? m.status }));
      res.fullyResolved = res.consequences.every((m: any) => m.status === "RESOLVED");
    }
    return decided;
  },

  // ── E5: the formal obligation after a won appeal ────────────────────────────────────────────────

  /** Tries to create the obligation of every MONEY consequence of an appeal that carries an established request. Returns id -> status after the attempt. Never throws for a payment-service failure. */
  async createObligationsForAppeal(actor: Actor, caseId: string, appealId: string): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const rows = await prisma.disputeCaseAppealConsequence.findMany({ where: { caseId, appealId, kind: "MONEY" } });
    for (const r of rows) {
      const requested = ((r.detail as any)?.requested ?? null) as { amountVnd?: number; responsibleParty?: string } | null;
      if (r.status === "NEEDS_RECONCILIATION" && requested?.amountVnd) {
        try {
          out.set(r.id, (await processService.tryCreateObligation(actor, r.id)).status);
          continue;
        } catch {
          /* stays NEEDS_RECONCILIATION: the retry route finishes it */
        }
      }
      out.set(r.id, r.status);
    }
    return out;
  },

  /** Admin retry: ask payment-service again for the obligation of ONE consequence (idempotent). */
  async createAppealObligation(actor: Actor, caseId: string, consequenceId: string) {
    requireFlag();
    __internals.assertAdmin(actor);
    __internals.requireUuid(caseId);
    __internals.requireUuid(consequenceId);
    const cons = await prisma.disputeCaseAppealConsequence.findUnique({ where: { id: consequenceId } });
    if (!cons || cons.caseId !== caseId || cons.kind !== "MONEY") throw caseError(404, "CONSEQUENCE_NOT_FOUND", "Không tìm thấy hệ quả tiền của hồ sơ này");
    const requested = ((cons.detail as any)?.requested ?? null) as { amountVnd?: number } | null;
    if (!requested?.amountVnd) throw caseError(409, "MONEY_NOT_ESTABLISHED", "Kết luận chưa xác lập số tiền và bên chịu trách nhiệm: không tạo khoản nợ, giữ để đối soát");
    if (cons.status === "OBLIGATION_OPEN" || cons.status === "RESOLVED") return { consequenceId: cons.id, status: cons.status, obligation: (cons.detail as any)?.obligation ?? null, replayed: true };
    try {
      return { ...(await processService.tryCreateObligation(actor, cons.id)), replayed: false };
    } catch (e: any) {
      if (e?.status && e?.code) throw e;
      logger.warn({ message: e?.message, status: e?.response?.status, data: e?.response?.data }, "[E5] creating the appeal obligation failed");
      throw caseError(503, "OBLIGATION_UNAVAILABLE", "Chưa tạo được khoản nợ tại payment-service lúc này; hệ quả vẫn giữ để đối soát. Thử lại sau");
    }
  },

  async tryCreateObligation(actor: Actor, consequenceId: string) {
    const cons = await prisma.disputeCaseAppealConsequence.findUniqueOrThrow({ where: { id: consequenceId } });
    const requested = (cons.detail as any)?.requested as { amountVnd: number; responsibleParty: "PT" | "GYM" | "PLATFORM" };
    const c = await prisma.disputeCase.findUniqueOrThrow({ where: { id: cons.caseId }, select: { id: true, contractId: true } });
    const contract = await prisma.contract.findUnique({ where: { id: c.contractId }, select: { id: true, price: true, paymentTransactionId: true } });
    if (!contract?.paymentTransactionId || contract.price == null) throw caseError(409, "CONTRACT_HAS_NO_PAYMENT", "Hợp đồng không có khoản thanh toán phía sau: không tạo khoản nợ");
    if (requested.amountVnd > Number(contract.price)) throw caseError(422, "AMOUNT_EXCEEDS_CONTRACT", "Số tiền xác lập lớn hơn giá trị hợp đồng: không tạo khoản nợ");
    let answer: any;
    try {
      answer = await paymentClient.createAppealObligation({
        transactionId: contract.paymentTransactionId,
        contractId: contract.id,
        consequenceId: cons.id,
        caseId: c.id,
        appealId: cons.appealId,
        amount: String(requested.amountVnd),
        responsibleParty: requested.responsibleParty,
        decidedBy: actor.id,
        reason: `Kháng nghị ${cons.appealId} được chấp nhận: ${cons.note ?? ""}`.slice(0, 2000),
      });
    } catch (e: any) {
      // payment-service refused with a definite 4xx (contract mismatch, amount above the payment ...): say so; anything else (down, 5xx) is the caller's "try again"
      const st = e?.response?.status;
      const code = e?.response?.data?.error?.code;
      if (typeof st === "number" && st >= 400 && st < 500 && typeof code === "string") throw caseError(st === 400 ? 422 : st, code, String(e?.response?.data?.error?.message ?? "payment-service từ chối tạo khoản nợ"));
      throw e;
    }
    const obligation = { id: answer.obligationId, owed: answer.owed, unpaid: answer.unpaid, status: answer.status, responsibleParty: answer.responsibleParty };
    const moved = await prisma.disputeCaseAppealConsequence.updateMany({
      where: { id: cons.id, status: "NEEDS_RECONCILIATION" },
      data: { status: "OBLIGATION_OPEN", detail: { ...((cons.detail as object) ?? {}), obligationCreated: true, obligation, why: "Khoản nợ chính thức đã tạo; chưa trả tiền. Chỉ xong khi khoản nợ được thanh toán đã xác minh" } },
    });
    if (moved.count === 1) {
      await prisma.disputeCaseEvent.create({
        data: { caseId: c.id, actorUserId: actor.id, actorRole: actor.role, action: "APPEAL_OBLIGATION_CREATED", note: `obligation ${answer.obligationId}`, payload: { consequenceId: cons.id, obligation, moneyMoved: false } as any },
      });
    }
    return { consequenceId: cons.id, status: "OBLIGATION_OPEN" as string, obligation };
  },

  /** Reads the obligation's live state; when it is SETTLED (paid and verified, resolved, paid via the ledger) the consequence becomes RESOLVED. Waived / still owed: it stays open. */
  async syncAppealObligation(actor: Actor, caseId: string, consequenceId: string) {
    requireFlag();
    __internals.assertAdmin(actor);
    __internals.requireUuid(caseId);
    __internals.requireUuid(consequenceId);
    const cons = await prisma.disputeCaseAppealConsequence.findUnique({ where: { id: consequenceId } });
    if (!cons || cons.caseId !== caseId || cons.kind !== "MONEY") throw caseError(404, "CONSEQUENCE_NOT_FOUND", "Không tìm thấy hệ quả tiền của hồ sơ này");
    if (cons.status !== "OBLIGATION_OPEN" && cons.status !== "RESOLVED") throw caseError(409, "NO_OBLIGATION", "Hệ quả này chưa có khoản nợ chính thức");
    let live: any;
    try {
      live = await paymentClient.readAppealObligation(cons.id);
    } catch {
      throw caseError(503, "OBLIGATION_UNAVAILABLE", "Chưa đọc được khoản nợ tại payment-service lúc này");
    }
    if (!live?.found) throw caseError(409, "OBLIGATION_MISSING", "payment-service không có khoản nợ của hệ quả này: cần đối soát");
    const SETTLED = ["RESOLVED", "PAID_VERIFIED", "RESOLVED_OTHER", "PAID_VIA_LEDGER"];
    if (cons.status === "OBLIGATION_OPEN" && SETTLED.includes(live.status) && Number(live.unpaid) === 0) {
      const moved = await prisma.disputeCaseAppealConsequence.updateMany({
        where: { id: cons.id, status: "OBLIGATION_OPEN" },
        data: { status: "RESOLVED", resolvedAt: clockNow(), resolvedBy: actor.id, detail: { ...((cons.detail as object) ?? {}), obligation: { ...((cons.detail as any)?.obligation ?? {}), status: live.status, unpaid: live.unpaid } } },
      });
      if (moved.count === 1) {
        await prisma.disputeCaseEvent.create({ data: { caseId, actorUserId: actor.id, actorRole: actor.role, action: "APPEAL_OBLIGATION_SETTLED", note: `obligation ${live.obligationId} ${live.status}`, payload: { consequenceId: cons.id, obligation: live } as any } });
      }
    }
    const after = await prisma.disputeCaseAppealConsequence.findUniqueOrThrow({ where: { id: cons.id } });
    return { consequenceId: cons.id, status: after.status, obligation: live };
  },

  async listAppeals(actor: Actor, caseId: string) {
    __internals.assertAdmin(actor);
    __internals.requireUuid(caseId);
    const rows = await prisma.disputeCaseAppeal.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { consequences: { include: { quotaCorrections: true } } } });
    return { items: rows };
  },

  // ── B3: quota correction after an appeal ───────────────────────────────────────────────────────────────────────────────────────────────

  async proposeQuotaCorrection(actor: Actor, caseId: string, consequenceId: string, b: { delta: number; reason: string }, key?: string) {
    requireFlag();
    __internals.assertAdmin(actor);
    return __internals.mutate<Record<string, unknown>>({
      actor,
      action: "QUOTA_CORRECTION_PROPOSED",
      scope: `${caseId}:${consequenceId}`,
      idempotencyKey: key,
      body: b,
      run: async (ctx) => {
        const c = await __internals.lockCase(ctx.tx, caseId);
        if (actor.id === c.clientUserId || actor.id === c.ptUserId) throw caseError(403, "CONFLICT_OF_INTEREST", "Quản trị viên là một bên của vụ việc");
        const cons = await ctx.tx.disputeCaseAppealConsequence.findUnique({ where: { id: consequenceId } });
        if (!cons || cons.caseId !== c.id || cons.kind !== "QUOTA") throw caseError(404, "CONSEQUENCE_NOT_FOUND", "Không tìm thấy hệ quả buổi tập của hồ sơ này");
        if (cons.status !== "OPEN") throw caseError(409, "CONSEQUENCE_NOT_OPEN", "Hệ quả này đã được xử lý");
        const pending = await ctx.tx.disputeCaseQuotaCorrection.count({ where: { consequenceId: cons.id, appliedAt: null } });
        if (pending > 0) throw caseError(409, "CORRECTION_ALREADY_PROPOSED", "Đã có đề xuất hiệu chỉnh đang chờ duyệt cho hệ quả này");
        const contract = await ctx.tx.contract.findUniqueOrThrow({ where: { id: c.contractId }, select: { totalSessions: true, usedSessions: true } });
        assertQuotaBounds(contract.usedSessions, contract.totalSessions, b.delta); // refused at the proposal already; re-checked under the lock when applied
        const row = await ctx.tx.disputeCaseQuotaCorrection.create({ data: { consequenceId: cons.id, caseId: c.id, contractId: c.contractId, delta: b.delta, reason: b.reason, proposedBy: actor.id } });
        return { caseId: c.id, result: { correctionId: row.id, delta: row.delta, applied: false, usedSessions: contract.usedSessions, totalSessions: contract.totalSessions }, note: b.reason, detail: { correctionId: row.id, delta: b.delta } };
      },
    });
  },

  /** Applied in ONE transaction under the CONTRACT lock: re-read the quota, bounds, compare-and-set on the value read, stamp the correction, settle the consequence, audit. History (sessions) is never touched. */
  async approveQuotaCorrection(actor: Actor, caseId: string, correctionId: string, b: { reason: string; conflictOfInterestDeclaredNone: boolean }, key?: string) {
    requireFlag();
    __internals.assertAdmin(actor);
    __internals.requireUuid(caseId);
    const replayKey = key ? `${actor.id}:QUOTA_CORRECTION_APPLIED:${correctionId}:${key}` : null;
    const requestHash = contentHashOf(b);
    if (replayKey) {
      const prior = await prisma.disputeCaseEvent.findUnique({ where: { idempotencyKey: replayKey } });
      if (prior) {
        const p = (prior.payload ?? {}) as { requestHash?: string; result?: Record<string, unknown> };
        if (p.requestHash !== requestHash) throw caseError(409, "IDEMPOTENCY_KEY_REUSED", "Khoá Idempotency-Key này đã được dùng cho một yêu cầu khác nội dung");
        return { result: p.result ?? {}, replayed: true as const };
      }
    }
    const corr = /^[0-9a-f-]{36}$/i.test(correctionId) ? await prisma.disputeCaseQuotaCorrection.findUnique({ where: { id: correctionId } }) : null;
    if (!corr || corr.caseId !== caseId) throw caseError(404, "CORRECTION_NOT_FOUND", "Không tìm thấy đề xuất hiệu chỉnh");
    const result = await withContractLock(corr.contractId, async (tx) => {
      const c = await tx.disputeCase.findUniqueOrThrow({ where: { id: caseId } });
      const cur = await tx.disputeCaseQuotaCorrection.findUniqueOrThrow({ where: { id: corr.id } });
      if (cur.appliedAt) throw caseError(409, "CORRECTION_ALREADY_APPLIED", "Đề xuất hiệu chỉnh này đã được áp dụng");
      const appeal = await tx.disputeCaseAppealConsequence.findUnique({ where: { id: cur.consequenceId }, include: { appeal: true } });
      const verdict = checkApprover({
        approverId: actor.id,
        approverRole: actor.role,
        proposerId: cur.proposedBy,
        investigatorId: c.investigatorId,
        clientUserId: c.clientUserId,
        ptUserId: c.ptUserId,
        conflictOfInterestDeclaredNone: b.conflictOfInterestDeclaredNone,
      });
      if (!verdict.ok) throw caseError(verdict.status, verdict.code, verdict.message);
      if (appeal?.appeal.reviewerId === actor.id) throw caseError(403, "SELF_APPROVAL_FORBIDDEN", "Người xem xét lại không được tự duyệt hiệu chỉnh buổi do mình quyết định");
      const contract = await tx.contract.findUniqueOrThrow({ where: { id: cur.contractId }, select: { id: true, usedSessions: true, totalSessions: true } });
      const after = assertQuotaBounds(contract.usedSessions, contract.totalSessions, cur.delta); // bounded under the lock
      const moved = await tx.contract.updateMany({ where: { id: contract.id, usedSessions: contract.usedSessions }, data: { usedSessions: after } });
      if (moved.count !== 1) throw caseError(409, "QUOTA_CHANGED", "Số buổi đã dùng vừa thay đổi; thử lại");
      const at = clockNow();
      await tx.disputeCaseQuotaCorrection.update({ where: { id: cur.id }, data: { approvedBy: actor.id, approvedAt: at, appliedAt: at, usedBefore: contract.usedSessions, usedAfter: after } });
      await tx.disputeCaseAppealConsequence.update({ where: { id: cur.consequenceId }, data: { status: "RESOLVED", resolvedAt: at, resolvedBy: actor.id } });
      await tx.auditLog.create({
        data: { actorUserId: actor.id, action: "DISPUTE_QUOTA_CORRECTED", entityType: "CONTRACT", entityId: contract.id, metadata: { caseId, correctionId: cur.id, delta: cur.delta, usedBefore: contract.usedSessions, usedAfter: after, proposedBy: cur.proposedBy } },
      });
      const out = { correctionId: cur.id, delta: cur.delta, usedBefore: contract.usedSessions, usedAfter: after, totalSessions: contract.totalSessions, applied: true };
      await tx.disputeCaseEvent.create({
        data: { caseId, actorUserId: actor.id, actorRole: actor.role, action: "QUOTA_CORRECTION_APPLIED", note: b.reason, idempotencyKey: replayKey, payload: { requestHash, result: out, detail: { correctionId: cur.id, delta: cur.delta, usedBefore: contract.usedSessions, usedAfter: after } } as never },
      });
      return out;
    });
    return { result: result as Record<string, unknown>, replayed: false as const };
  },

  // ── Held money: the mandatory decision every 7 days ────────────────────────────────────────────────────────────────────────────────────

  async listHeldMoney(actor: Actor, q: { overdue?: boolean; limit: number; offset: number }) {
    __internals.assertAdmin(actor);
    const at = clockNow();
    const where = { closedAt: null, ...(q.overdue ? { nextReviewDueAt: { lte: at } } : {}) };
    const [rows, total] = await Promise.all([
      prisma.disputeHeldMoneyReview.findMany({ where, orderBy: [{ nextReviewDueAt: "asc" }, { id: "asc" }], take: q.limit, skip: q.offset, include: { decisions: { orderBy: { decidedAt: "desc" }, take: 1 } } }),
      prisma.disputeHeldMoneyReview.count({ where }),
    ]);
    return {
      total,
      limit: q.limit,
      offset: q.offset,
      hasMore: q.offset + rows.length < total,
      items: rows.map((r) => ({
        reviewId: r.id,
        settlementRowId: r.settlementRowId,
        sessionId: r.sessionId,
        contractId: r.contractId,
        firstSeenAt: r.firstSeenAt,
        daysHeld: Math.floor((at.getTime() - r.firstSeenAt.getTime()) / DAY_MS),
        nextReviewDueAt: r.nextReviewDueAt,
        overdue: r.nextReviewDueAt.getTime() <= at.getTime(),
        ownerEscalatedAt: r.ownerEscalatedAt,
        lastDecision: r.decisions[0] ? { decision: r.decisions[0].decision, reason: r.decisions[0].reason, exitRef: r.decisions[0].exitRef, decidedBy: r.decisions[0].decidedBy, decidedAt: r.decisions[0].decidedAt } : null,
        note: "Không có chi trả hay xoá tự động; mỗi kỳ 7 ngày phải có một quyết định được ghi lại.",
      })),
    };
  },

  async decideHeldMoney(actor: Actor, reviewId: string, b: { decision: "KEEP_HOLDING" | "EXIT_STARTED"; reason: string; exitRef?: { kind: "D65B_RESOLUTION" | "LATE_OPEN_PROPOSAL"; id: string } }) {
    requireFlag();
    __internals.assertAdmin(actor);
    if (!/^[0-9a-f-]{36}$/i.test(reviewId)) throw caseError(404, "HELD_REVIEW_NOT_FOUND", "Không tìm thấy kỳ rà soát khoản giữ");
    if (b.decision === "EXIT_STARTED") {
      if (!b.exitRef) throw caseError(400, "EXIT_REF_REQUIRED", "Cần nêu đường xử lý đã mở (đề xuất D65-B hoặc đề xuất đối soát khoản đền muộn)");
      const exists =
        b.exitRef.kind === "D65B_RESOLUTION" ? await prisma.d65bResolution.findUnique({ where: { id: b.exitRef.id }, select: { id: true } }) : await prisma.lateOpenReconciliation.findUnique({ where: { id: b.exitRef.id }, select: { id: true } });
      if (!exists) throw caseError(422, "EXIT_REF_NOT_FOUND", "Không tìm thấy đề xuất xử lý được tham chiếu");
    } else if (b.exitRef) throw caseError(400, "EXIT_REF_NOT_ALLOWED", "Giữ tiếp thì không kèm tham chiếu xử lý");
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM dispute_held_money_reviews WHERE id = ${reviewId}::uuid FOR UPDATE`;
      const r = await tx.disputeHeldMoneyReview.findUnique({ where: { id: reviewId } });
      if (!r) throw caseError(404, "HELD_REVIEW_NOT_FOUND", "Không tìm thấy kỳ rà soát khoản giữ");
      if (r.closedAt) throw caseError(409, "HELD_REVIEW_CLOSED", "Khoản giữ này không còn được giữ");
      const at = clockNow();
      const d = await tx.disputeHeldMoneyDecision.create({ data: { reviewId: r.id, decision: b.decision, reason: b.reason, exitRef: b.exitRef ? `${b.exitRef.kind}:${b.exitRef.id}` : null, decidedBy: actor.id, decidedAt: at } });
      const next = new Date(at.getTime() + HELD_REVIEW_DAYS * DAY_MS);
      await tx.disputeHeldMoneyReview.update({ where: { id: r.id }, data: { nextReviewDueAt: next } });
      return { reviewId: r.id, decisionId: d.id, decision: d.decision, nextReviewDueAt: next, moneyMoved: false };
    });
  },

  // ── The visible deadlock queue ─────────────────────────────────────────────────────────────────────────────────────────────────────────

  async stuckQueue(actor: Actor, q: { kind?: "POLICY_PENDING" | "NEEDS_HUMAN" | "EXEC_BLOCKED"; limit: number; offset: number }) {
    __internals.assertAdmin(actor);
    const at = clockNow();
    const or: object[] = [];
    if (!q.kind || q.kind === "POLICY_PENDING") or.push({ status: "POLICY_PENDING" });
    if (!q.kind || q.kind === "NEEDS_HUMAN") or.push({ execStatus: "NEEDS_HUMAN" });
    if (!q.kind || q.kind === "EXEC_BLOCKED") or.push({ execStatus: "EXEC_BLOCKED" });
    const where = { status: { notIn: ["CLOSED", "REJECTED_INTAKE"] as never[] }, OR: or };
    const [rows, total] = await Promise.all([
      prisma.disputeCase.findMany({ where, orderBy: [{ updatedAt: "asc" }, { id: "asc" }], take: q.limit, skip: q.offset }),
      prisma.disputeCase.count({ where }),
    ]);
    const names = await __internals.displayNames(rows.map((r) => r.investigatorId));
    const items = [];
    for (const r of rows) {
      const kind = r.status === "POLICY_PENDING" ? "POLICY_PENDING" : r.execStatus;
      const last = await prisma.disputeCaseEvent.findFirst({ where: { caseId: r.id }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { action: true, createdAt: true, actorUserId: true, note: true } });
      const since = (await prisma.disputeCaseEvent.findFirst({ where: { caseId: r.id, ...(kind === "POLICY_PENDING" ? { toStatus: "POLICY_PENDING" as const } : { action: { in: ["EXECUTION_BLOCKED", "EXECUTION_NEEDS_HUMAN"] } }) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { createdAt: true } }))?.createdAt ?? r.updatedAt;
      items.push({
        caseId: r.id,
        sessionId: r.sessionId,
        kind,
        status: r.status as CaseStatus,
        execStatus: r.execStatus,
        ownerId: r.investigatorId,
        ownerName: r.investigatorId ? (names.get(r.investigatorId) ?? null) : null,
        ownerRequired: !r.investigatorId,
        escalated: r.escalated,
        since,
        ageDays: Math.floor((at.getTime() - since.getTime()) / DAY_MS),
        lastAudit: last ? { action: last.action, at: last.createdAt, by: last.actorUserId, note: last.note } : null,
      });
    }
    return { total, limit: q.limit, offset: q.offset, hasMore: q.offset + rows.length < total, items };
  },
};

/** used + delta must stay inside 0 .. total (never below zero, never above the contract's total). Returns the new value. */
export function assertQuotaBounds(used: number, total: number, delta: number): number {
  const after = used + delta;
  if (after < 0 || after > total) {
    throw caseError(409, "QUOTA_OUT_OF_BOUNDS", "Hiệu chỉnh làm số buổi đã dùng nằm ngoài khoảng từ 0 đến tổng số buổi của hợp đồng", { used, total, delta, after });
  }
  return after;
}

/** The reviewer is independent: not the investigator, not a proposer or approver of any proposal of the case, not a party. */
async function assertIndependentReviewer(tx: Prisma.TransactionClient, c: { id: string; investigatorId: string | null; clientUserId: string; ptUserId: string }, reviewerId: string) {
  if (reviewerId === c.clientUserId || reviewerId === c.ptUserId) throw caseError(403, "CONFLICT_OF_INTEREST", "Người xem xét lại là một bên của vụ việc");
  if (c.investigatorId && reviewerId === c.investigatorId) throw caseError(403, "REVIEWER_NOT_INDEPENDENT", "Người xem xét lại không được là điều tra viên của hồ sơ");
  const proposals = await tx.disputeCaseProposal.findMany({ where: { caseId: c.id }, select: { proposerId: true, approvals: { select: { approverId: true } } } });
  const involved = new Set(proposals.flatMap((p) => [p.proposerId, ...p.approvals.map((a) => a.approverId)]));
  if (involved.has(reviewerId)) throw caseError(403, "REVIEWER_NOT_INDEPENDENT", "Người xem xét lại không được là người đã đề xuất hoặc duyệt quyết định ban đầu");
}

export function agreementView(a: { id: string; outcome: string; contentHash: string; note: string; status: string; agreedAt: Date | null; findingId: string | null; createdAt: Date; confirmations: Array<{ partyRole: string; confirmedAt: Date }> }) {
  return {
    id: a.id,
    outcome: a.outcome,
    outcomeLabel: outcomeLabelVi(a.outcome),
    contentHash: a.contentHash,
    note: a.note,
    status: a.status,
    agreedAt: a.agreedAt,
    findingId: a.findingId,
    createdAt: a.createdAt,
    confirmations: a.confirmations.map((x) => ({ partyRole: x.partyRole, confirmedAt: x.confirmedAt })),
  };
}
