/**
 * Shared fixtures of the Dispute Case slice 2 suites: drives the REAL Slice 1 service (open -> assign -> claim -> assess -> finding -> proposal ->
 * four-eyes approval) for a session that is already DISPUTED, and switches the fail-closed flags the way the test environment does.
 * Evidence label of everything built here: TEST FIXTURE (the case workflow itself is the real service; the session / contract rows are inserted).
 */
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { disputeCaseService as svc, type Actor } from "../services/dispute-case/dispute-case.service";
import type { FindingKind } from "../services/dispute-case/rules";
// Slice 2 / S2.3: this suite must not open sockets to chat-service / gym-service; the collector keeps its Slice 1 placeholders here.
process.env.DISPUTE_CASE_EXTERNAL_EVIDENCE_DISABLED ??= "true";

export const admin = (): Actor => ({ id: randomUUID(), role: "ADMIN" });

/** NODE_ENV=test + the execution flag: what the fail-closed flag needs. DB_ISOLATION comes from the preload (accepted when TEST_DATABASE_URL is valid). */
export function enableExecutionFlags(on: { execution?: boolean; t0?: boolean; evidence?: boolean } = { execution: true }) {
  process.env.NODE_ENV = "test";
  if (on.execution) process.env.DISPUTE_CASE_EXECUTION_ENABLED = "true";
  if (on.t0) process.env.DISPUTE_CASE_T0 = "true";
  if (on.evidence) process.env.DISPUTE_CASE_EVIDENCE_STORAGE_ENABLED = "true";
}
export function disableExecutionFlags() {
  delete process.env.DISPUTE_CASE_EXECUTION_ENABLED;
  delete process.env.DISPUTE_CASE_T0;
  delete process.env.DISPUTE_CASE_EVIDENCE_STORAGE_ENABLED;
}

export const FINDING_FOR = { COMPLETED: "VERIFIED_DELIVERED", CANCELLED: "VERIFIED_NOT_DELIVERED_NO_FAULT", PT_NO_SHOW_CONFIRMED: "VERIFIED_PT_ABSENT" } as const;

export interface ApprovedCase {
  caseId: string;
  approvalId: string;
  proposalId: string;
  investigator: Actor;
  approver: Actor;
}

/** A case for `sessionId` (must be DISPUTED) taken to DECISION_APPROVED by two different admins. */
/** A case investigated up to the finding (claim, assessment, finding recorded): the caller decides what happens next (propose, ...). */
export async function caseAtFinding(sessionId: string, finding: FindingKind, A1: Actor = admin()): Promise<{ caseId: string; investigator: Actor }> {
  const caseId = (await svc.openCase(A1, sessionId)).result.case.id;
  await svc.assign(A1, caseId, undefined);
  await svc.transition(A1, caseId, "COLLECTING", {});
  const claim = await svc.addClaim(A1, caseId, { claimantRole: "CLIENT", text: "PT không có mặt đủ giờ", moves: ["MONEY", "QUOTA"] });
  await svc.transition(A1, caseId, "ASSESSING", {});
  const ev = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId, subject: "SESSION_ROW" } });
  await svc.addAssessment(A1, caseId, {
    claimId: claim.result.id,
    directEvidenceIds: [ev.id],
    indirectEvidenceIds: [],
    rebuttalEvidenceIds: [],
    relevanceNote: "Đúng buổi, đúng khung giờ",
    verifiabilityNote: "Dữ liệu máy chủ",
    consistencyNote: "Khớp các nguồn còn lại",
    result: "ESTABLISHED",
    reasoning: "Dữ liệu phòng và lời khai khớp nhau",
  });
  await svc.recordFinding(A1, caseId, { finding, reasoning: "Đã xác minh" });
  return { caseId, investigator: A1 };
}

export async function approvedCaseFor(sessionId: string, finding: FindingKind, over: { investigator?: Actor; approver?: Actor; approveBody?: Record<string, unknown> } = {}): Promise<ApprovedCase> {
  const A1 = over.investigator ?? admin();
  const A2 = over.approver ?? admin();
  const caseId = (await svc.openCase(A1, sessionId)).result.case.id;
  await svc.assign(A1, caseId, undefined);
  await svc.transition(A1, caseId, "COLLECTING", {});
  const claim = await svc.addClaim(A1, caseId, { claimantRole: "CLIENT", text: "PT không có mặt đủ giờ", moves: ["MONEY", "QUOTA"] });
  await svc.transition(A1, caseId, "ASSESSING", {});
  const ev = await prisma.disputeCaseEvidence.findFirstOrThrow({ where: { caseId, subject: "SESSION_ROW" } });
  await svc.addAssessment(A1, caseId, {
    claimId: claim.result.id,
    directEvidenceIds: [ev.id],
    indirectEvidenceIds: [],
    rebuttalEvidenceIds: [],
    relevanceNote: "Đúng buổi, đúng khung giờ",
    verifiabilityNote: "Dữ liệu máy chủ",
    consistencyNote: "Khớp các nguồn còn lại",
    result: "ESTABLISHED",
    reasoning: "Dữ liệu phòng và lời khai khớp nhau",
  });
  await svc.recordFinding(A1, caseId, { finding, reasoning: "Đã xác minh" });
  const proposal = (await svc.propose(A1, caseId, undefined)).result;
  const decided = await svc.decide(A2, caseId, { result: "APPROVED", reason: "Đồng ý", conflictOfInterestDeclaredNone: true, evidenceChangeAcknowledged: false, ...(over.approveBody ?? {}) } as any);
  return { caseId, approvalId: decided.result.approvalId, proposalId: proposal.id, investigator: A1, approver: A2 };
}

export const caseRow = (caseId: string) => prisma.disputeCase.findUniqueOrThrow({ where: { id: caseId } });
export const execRows = (caseId: string) => prisma.disputeCaseExecution.findMany({ where: { caseId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
