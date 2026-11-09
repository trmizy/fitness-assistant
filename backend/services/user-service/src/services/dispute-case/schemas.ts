import { z } from "zod";
import { CLAIM_MOVES } from "./rules";

/**
 * Request bodies of the dispute-case endpoints. Every schema is `.strict()`: a field nobody declared (an `outcome`, an `amount`, a `userId`)
 * is refused instead of ignored, so a client cannot believe it set something the server computes or takes from the token.
 */
const text = (max: number) => z.string().trim().min(1).max(max);
const uuid = z.string().uuid();

export const intakeBody = z.object({ sessionId: z.string().trim().min(1).max(64) }).strict();

export const assignBody = z.object({ investigatorId: z.string().trim().min(1).max(64).optional() }).strict();

export const transitionBody = z
  .object({
    to: z.enum(["COLLECTING", "AWAITING_PARTIES", "ASSESSING", "TECH_RECONCILIATION", "REJECTED_INTAKE"]),
    reason: text(2000).optional(),
    note: text(2000).optional(),
  })
  .strict();

export const requestMoreBody = z
  .object({ to: z.enum(["COLLECTING", "AWAITING_PARTIES"]).default("AWAITING_PARTIES"), note: text(2000) })
  .strict();

export const claimBody = z
  .object({
    claimantRole: z.enum(["CLIENT", "PT", "SYSTEM"]),
    text: text(4000),
    moves: z.array(z.enum(CLAIM_MOVES)).max(3).default([]),
  })
  .strict();

export const issueBody = z
  .object({
    kind: z.enum(["PT_LATE"]),
    finding: z.enum(["LATE_CONFIRMED_BY_ROOM_DATA", "LATE_CONTESTED", "NOT_LATE", "UNDETERMINED"]),
    note: text(4000).optional(),
  })
  .strict();

export const assessmentBody = z
  .object({
    claimId: uuid,
    directEvidenceIds: z.array(uuid).max(100).default([]),
    indirectEvidenceIds: z.array(uuid).max(100).default([]),
    rebuttalEvidenceIds: z.array(uuid).max(100).default([]),
    relevanceNote: text(4000),
    verifiabilityNote: text(4000),
    consistencyNote: text(4000),
    result: z.enum(["ESTABLISHED", "NOT_ESTABLISHED", "REFUTED"]),
    reasoning: text(8000),
  })
  .strict();

export const findingBody = z
  .object({
    finding: z.enum([
      "VERIFIED_DELIVERED",
      "VERIFIED_CLIENT_ABSENT",
      "VERIFIED_PT_ABSENT",
      "VERIFIED_NOT_DELIVERED_NO_FAULT",
      "INSUFFICIENT_EVIDENCE",
      "NOT_A_DISPUTE",
    ]),
    reasoning: text(8000),
  })
  .strict();

/** No outcome, no amount: both are computed by the server. */
export const proposalBody = z.object({ note: text(2000).optional() }).strict();

export const approvalBody = z
  .object({
    result: z.enum(["APPROVED", "REJECTED"]),
    reason: text(4000),
    conflictOfInterestDeclaredNone: z.boolean(),
    evidenceChangeAcknowledged: z.boolean().default(false),
  })
  .strict();

/**
 * D-NEW-12 guard. ONE contract per call (the case's own contract - never taken from the body), the result, at least one evidence row OF THIS CASE and the reasoning.
 * Strict: no list of cases / contracts, no "all", no date. The identity of the proposer / approver comes from the token.
 */
export const policyEligibilityBody = z
  .object({
    result: z.enum(["ELIGIBLE_CURRENT_POLICY", "EXCEPTION_APPLIES"]),
    evidenceIds: z.array(uuid).min(1).max(50),
    reasoning: text(4000),
    supersedesId: uuid.optional(),
  })
  .strict();

/** Contract-level review (no Case): the evidence is a list of REFERENCES the server resolves, never free text. Strict: no case id, no list of contracts, no amount. */
export const contractPolicyEvidenceRef = z.object({ kind: z.enum(["PT_TERMS_ACCEPTANCE", "CONTRACT_AUDIT_LOG"]), id: uuid }).strict();
export const contractPolicyReviewBody = z
  .object({
    result: z.enum(["ELIGIBLE_CURRENT_POLICY", "EXCEPTION_APPLIES"]),
    evidenceRefs: z.array(contractPolicyEvidenceRef).min(1).max(20),
    reasoning: text(4000),
    supersedesId: uuid.optional(),
  })
  .strict();

export const policyEligibilityApproveBody = z
  .object({
    reason: text(4000),
    conflictOfInterestDeclaredNone: z.boolean(),
  })
  .strict();

export const ackBody = z.object({ note: text(2000) }).strict();

export const shareBody = z
  .object({
    evidenceId: uuid.optional(),
    statementId: uuid.optional(),
    sharedWithRole: z.enum(["CLIENT", "PT"]),
    reason: text(2000),
  })
  .strict()
  .refine((b) => (b.evidenceId ? 1 : 0) + (b.statementId ? 1 : 0) === 1, { message: "Chỉ chọn đúng một mục để chia sẻ (bằng chứng hoặc lời khai)" });

export const statementBody = z.object({ text: text(5000), supplementReason: text(2000).optional() }).strict();

/** EXTERNAL_DOCUMENT metadata only: Slice 1 stores no file (file storage is DESIGN_REQUIRED). */
export const partyEvidenceBody = z
  .object({
    description: text(2000),
    sha256: z.string().regex(/^[0-9a-fA-F]{64}$/, "sha256 phải gồm 64 ký tự thập lục phân"),
    title: text(200).optional(),
    fileName: text(255).optional(),
  })
  .strict();

const STATUS_ENUM = z.enum([
  "INTAKE",
  "COLLECTING",
  "AWAITING_PARTIES",
  "ASSESSING",
  "TECH_RECONCILIATION",
  "FINDING_RECORDED",
  "POLICY_PENDING",
  "PROPOSED",
  "AWAITING_APPROVAL",
  "DECISION_APPROVED",
  "REJECTED_INTAKE",
  "CLOSED",
]);
/** A query-string boolean: only the exact strings "true" / "false". */
const queryBool = z.enum(["true", "false"]).transform((v) => v === "true");

export const listQuery = z
  .object({
    status: STATUS_ENUM.optional(),
    execStatus: z.enum(["NOT_STARTED", "EXECUTING", "BUSINESS_DONE", "EXEC_BLOCKED", "NEEDS_HUMAN"]).optional(),
    type: z.enum(["PT_DELIVERY", "PT_CLIENT_NO_SHOW_CLAIM", "PT_NO_SHOW_CLAIM", "LEGACY_UNCLASSIFIED"]).optional(),
    investigatorId: z.string().trim().min(1).max(64).optional(),
    unassigned: queryBool.optional(),
    sessionId: z.string().trim().min(1).max(64).optional(),
    contractId: z.string().trim().min(1).max(64).optional(),
    createdFrom: z.coerce.date().optional(),
    createdTo: z.coerce.date().optional(),
    sort: z.enum(["createdAt", "updatedAt"]).optional(),
    order: z.enum(["asc", "desc"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict();

/** Sessions that need (or have) a case. */
export const queueQuery = z
  .object({
    sessionStatus: z.enum(["DISPUTED", "PT_NO_SHOW_REPORTED"]).optional(),
    hasCase: queryBool.optional(),
    contractId: z.string().trim().min(1).max(64).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict();

/** Closing a case without a decision: the reason is required (it is the audit). */
export const closeBody = z.object({ reason: text(2000) }).strict();
export const closeExecutedBody = closeBody;
export const acknowledgeNeedsHumanBody = z.object({ note: text(2000) }).strict();
/** R-19: the access log of one case. */
export const accessLogQuery = z
  .object({
    action: z.enum(["VIEW_CASE", "VIEW_EVIDENCE"]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict();
/** V2.1 process bodies (all strict). */
export const agreementBody = z.object({ outcome: z.enum(["COMPLETED", "CANCELLED", "PT_NO_SHOW_CONFIRMED"]), note: text(2000) }).strict();
export const agreementConfirmBody = z.object({ contentHash: z.string().regex(/^[0-9a-f]{64}$/i, "contentHash phải gồm 64 ký tự thập lục phân") }).strict();
export const appealBody = z.object({ reason: text(4000) }).strict();
export const appealReviewerBody = z.object({ reviewerId: z.string().trim().min(1).max(64) }).strict();
export const appealDecisionBody = z
  .object({
    result: z.enum(["UPHELD", "NEW_FINDING"]),
    reasoning: text(8000),
    finding: z.enum(["VERIFIED_DELIVERED", "VERIFIED_CLIENT_ABSENT", "VERIFIED_PT_ABSENT", "VERIFIED_NOT_DELIVERED_NO_FAULT", "INSUFFICIENT_EVIDENCE", "NOT_A_DISPUTE"]).optional(),
    // E5: a MONEY consequence may carry the ESTABLISHED amount (whole dong) and the responsible party - both or neither; validated against the finding in the service, never free text.
    consequences: z
      .array(
        z
          .object({
            kind: z.enum(["MONEY", "QUOTA", "PT_AT_FAULT"]),
            note: text(2000),
            amountVnd: z.number().int().min(1).max(10_000_000_000).optional(),
            responsibleParty: z.enum(["PT", "GYM", "PLATFORM"]).optional(),
          })
          .strict()
          .refine((k) => (k.amountVnd === undefined) === (k.responsibleParty === undefined), "amountVnd và responsibleParty phải đi cùng nhau")
          .refine((k) => k.kind === "MONEY" || (k.amountVnd === undefined && k.responsibleParty === undefined), "Chỉ hệ quả tiền (MONEY) mới có số tiền và bên chịu trách nhiệm"),
      )
      .max(3)
      .optional(),
  })
  .strict();
export const quotaCorrectionBody = z.object({ delta: z.number().int().min(-100).max(100).refine((n) => n !== 0, "delta khác 0"), reason: text(2000) }).strict();
export const heldDecisionBody = z
  .object({ decision: z.enum(["KEEP_HOLDING", "EXIT_STARTED"]), reason: text(2000), exitRef: z.object({ kind: z.enum(["D65B_RESOLUTION", "LATE_OPEN_PROPOSAL"]), id: uuid }).strict().optional() })
  .strict();
export const heldQuery = z.object({ overdue: queryBool.optional(), limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(100000).default(0) }).strict();
export const stuckQuery = z.object({ kind: z.enum(["POLICY_PENDING", "NEEDS_HUMAN", "EXEC_BLOCKED"]).optional(), limit: z.coerce.number().int().min(1).max(100).default(50), offset: z.coerce.number().int().min(0).max(100000).default(0) }).strict();
export const emptyBody = z.object({}).strict();

/** Only the three real types: LEGACY_UNCLASSIFIED is never a target. */
export const classifyBody = z.object({ type: z.enum(["PT_DELIVERY", "PT_CLIENT_NO_SHOW_CLAIM", "PT_NO_SHOW_CLAIM"]) }).strict();

/** Slice 2: the decision id only SELECTS among the case's approvals (the executor re-reads and re-checks everything); no outcome / amount / user id is accepted. */
export const executeBody = z.object({ decisionId: uuid.optional() }).strict();
