import { z } from 'zod';
import { CASE_CLASSES, CASE_STATUSES } from './rules';

/**
 * Request bodies of the complaint-case endpoints. Every schema is `.strict()`: a field nobody declared (an `outcome`, an `amount`, a `userId`, a
 * `reason`) is refused instead of ignored, so a client cannot believe it set something the server computes or takes from the token.
 */
const text = (max: number) => z.string().trim().min(1).max(max);
const uuid = z.string().uuid();

export const openCaseBody = z
  .object({
    caseClass: z.enum(CASE_CLASSES as [string, ...string[]]),
    /** MEM_* only. The server checks it belongs to the complaint's reporter and to the complaint's gym. */
    membershipId: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export const assignBody = z.object({ investigatorId: z.string().trim().min(1).max(64).optional() }).strict();

export const transitionBody = z
  .object({ to: z.enum(['COLLECTING', 'AWAITING_PARTIES', 'ASSESSING', 'REJECTED_INTAKE']), reason: text(2000).optional() })
  .strict();

export const requestMoreBody = z
  .object({
    to: z.enum(['COLLECTING', 'AWAITING_PARTIES']).default('AWAITING_PARTIES'),
    note: text(2000),
    /** A1: who is asked (and gets a response clock from a delivered notice). The Gym is asked for evidence / an explanation only (C10). */
    parties: z.array(z.enum(['MEMBER', 'GYM'])).min(1).max(2).default(['MEMBER']),
  })
  .strict();

export const appealBody = z.object({ reason: text(4000) }).strict();
export const assignReviewerBody = z.object({ reviewerId: z.string().trim().min(1).max(64).optional() }).strict();

export const claimBody = z.object({ claimantRole: z.enum(['MEMBER', 'ADMIN_ON_BEHALF']), text: text(4000) }).strict();

export const assessmentBody = z
  .object({
    claimId: uuid,
    directEvidenceIds: z.array(uuid).max(100).default([]),
    indirectEvidenceIds: z.array(uuid).max(100).default([]),
    rebuttalEvidenceIds: z.array(uuid).max(100).default([]),
    relevanceNote: text(4000),
    verifiabilityNote: text(4000),
    consistencyNote: text(4000),
    result: z.enum(['ESTABLISHED', 'NOT_ESTABLISHED', 'REFUTED']),
    reasoning: text(8000),
  })
  .strict();

export const findingBody = z.object({ finding: z.enum(['ESTABLISHED', 'NOT_ESTABLISHED']), reasoning: text(8000) }).strict();

/** No outcome, no amount, no reason: the outcome is computed from (class, finding) and the amount by the existing refund quote. */
export const proposalBody = z.object({ note: text(2000).optional() }).strict();

export const decisionBody = z
  .object({
    result: z.enum(['APPROVED', 'REJECTED']),
    reason: text(4000),
    conflictOfInterestDeclaredNone: z.boolean(),
    evidenceChangeAcknowledged: z.boolean().default(false),
  })
  .strict();

export const ackBody = z.object({ note: text(2000) }).strict();

export const shareBody = z
  .object({ evidenceId: uuid.optional(), statementId: uuid.optional(), reason: text(2000), sharedWith: z.enum(['MEMBER', 'GYM']).default('MEMBER') })
  .strict()
  .refine((b) => (b.evidenceId ? 1 : 0) + (b.statementId ? 1 : 0) === 1, { message: 'Chỉ chọn đúng một mục để chia sẻ (bằng chứng hoặc lời khai)' });

export const statementBody = z.object({ text: text(5000), supplementReason: text(2000).optional() }).strict();

/** EXTERNAL_DOCUMENT metadata only: no file is stored by this layer. sha256 is the party's declaration (a claim, not a verification). */
export const evidenceBody = z
  .object({
    description: text(2000),
    sha256: z.string().regex(/^[0-9a-fA-F]{64}$/, 'sha256 phải gồm 64 ký tự thập lục phân'),
    title: text(200).optional(),
    fileName: text(255).optional(),
  })
  .strict();

export const executeBody = z.object({ decisionId: uuid.optional() }).strict();
export const emptyBody = z.object({}).strict();

export const listQuery = z
  .object({
    status: z.enum(CASE_STATUSES as unknown as [string, ...string[]]).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).max(100000).default(0),
  })
  .strict();

/** F7: the old complaint routes validate their enums here (400, never a Prisma 500). */
export const COMPLAINT_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED'] as const;
export const COMPLAINT_SOURCES = ['SELF_DETECTED', 'MEMBER_REPORT', 'PT_REPORT', 'PARTNER_DISCLOSED'] as const;
export const COMPLAINT_ISSUE_TYPES = ['CLEANLINESS', 'STAFF_BEHAVIOR', 'EQUIPMENT_CONDITION', 'FALSE_ADVERTISING', 'BILLING', 'SAFETY', 'OTHER'] as const;
