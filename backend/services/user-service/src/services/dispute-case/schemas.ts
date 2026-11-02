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

export const listQuery = z
  .object({
    status: z
      .enum([
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
      ])
      .optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict();
export const emptyBody = z.object({}).strict();

/** Only the three real types: LEGACY_UNCLASSIFIED is never a target. */
export const classifyBody = z.object({ type: z.enum(["PT_DELIVERY", "PT_CLIENT_NO_SHOW_CLAIM", "PT_NO_SHOW_CLAIM"]) }).strict();

/** Slice 2: the decision id only SELECTS among the case's approvals (the executor re-reads and re-checks everything); no outcome / amount / user id is accepted. */
export const executeBody = z.object({ decisionId: uuid.optional() }).strict();
