import { Prisma } from "../../generated/prisma";
import { executionEnabled, t0Enabled } from "./flags";
import { d77Key, phaseOf, type D77Read } from "./d77-key";

/**
 * DISPUTE CASE slice 2 - what the ruling core (booking.service resolveDisputeCore) asks of a CaseDecision, UNDER THE CONTRACT LOCK, BEFORE its
 * compare-and-set. Kept apart from booking.service so that file only imports these small functions.
 *
 * The contract lock is ONE lock: withContractLock / withRunningContract (contract-lock.ts) both take `pg_advisory_xact_lock(hashtext(contractId))`.
 * The late-arrival (D77) intent is written by recordLateArrivalIntent inside withRunningContract (room-close-resolution.service.ts), the ruling's CAS
 * runs inside withContractLock (claimRuling / deductQuotaOnce). Same key => the two are serialised: a guard that reads session_settlements inside
 * the ruling's transaction sees every D77 intent committed before it and makes every later D77 intent wait until the ruling committed. So guard + CAS
 * are one atomic step with respect to a D77 writer, and no second lock is needed.
 */

type Tx = Prisma.TransactionClient;

export const D77_COMBINATION_UNRESOLVED = "D77_COMBINATION_UNRESOLVED";
export const POLICY_ELIGIBILITY_UNVERIFIED = "POLICY_ELIGIBILITY_UNVERIFIED";
export const POLICY_EXCEPTION_APPLIES = "POLICY_EXCEPTION_APPLIES";
export const CASE_REQUIRED = "CASE_REQUIRED";
export const CASE_CONTEXT_INVALID = "CASE_CONTEXT_INVALID";
export const EXECUTION_DISABLED = "EXECUTION_DISABLED";
export const CASE_EXISTS = "CASE_EXISTS";

/**
 * The D77 combinations Ngai has approved (A2, 04/11/2026, APPROVED WITH CONDITIONS): exactly FOUR keys, all with L fully paid in CASH by the ledger (no obligation, nothing unpaid), each proved by
 * cross-service-money-b1-key.e2e.test.ts through this production list (no test seam) against hand-computed ledger and quota. Key = outcome | L:<state> | C:<phase> (d77-key.ts).
 * EVERYTHING else stays EXEC_BLOCKED: L OPEN / PENDING / SETTLED_PARTIAL_OPEN / CLOSED_OTHER / UNKNOWN, every CANCELLED (assertCancelNotOverD77 is independent of this list), and any state that
 * changed between the executor's read and the ruling (re-verified under the contract lock in assertNoD77Combination).
 */
export const OPENED_D77_COMBINATIONS: ReadonlyArray<string> = [
  "COMPLETED|L:SETTLED_CASH|C:ACTIVE",
  "COMPLETED|L:SETTLED_CASH|C:ENDED",
  "PT_NO_SHOW_CONFIRMED|L:SETTLED_CASH|C:ACTIVE",
  "PT_NO_SHOW_CONFIRMED|L:SETTLED_CASH|C:ENDED",
];

/** What the executor hands to the ruling core. `caseDecisionId` = dispute_case_approvals.id of the APPROVED decision. */
export interface CaseDecisionCtx {
  caseDecisionId: string;
  /**
   * TEST SEAM (never set by production code): awaited right after the decision (status CAS + intent) committed and before the money step.
   * A test makes it throw to model a process that died between the two.
   */
  afterDecisionCommitted?: () => Promise<void>;
  /**
   * TEST SEAM ONLY (B-1 release gate): D77 x outcome combinations an executor TEST may open to produce the evidence the owner asked for. Set only from ExecDeps, which only a test builds;
   * production code never sets it, and OPENED_D77_COMBINATIONS (the constant above) stays empty. It cannot open CANCELLED (assertCancelNotOverD77 is independent of it).
   */
  openedD77Combinations?: ReadonlyArray<string>;
  /**
   * B-1 (direction A): the state of L and of the contract the EXECUTOR read before the lock (settlement row + ledger). The core re-checks the parts it can see under the lock (the row's
   * SETTLED-ness and the contract phase) and treats any disagreement as "state changed" = blocked. Absent = the key cannot be built = blocked unless a test opened the outcome-only legacy entry.
   */
  d77Read?: D77Read;
}

export type ExecError = Error & { status: number; code: string; execBlocked?: boolean; details?: unknown };
function execError(status: number, code: string, message: string, extra: { execBlocked?: boolean; details?: unknown } = {}): ExecError {
  return Object.assign(new Error(message), { status, code, ...extra });
}

/** T0 is on and a caller reached the ruling core without a CaseDecision. */
export const caseRequiredError = () =>
  execError(409, CASE_REQUIRED, "Buổi khiếu nại chỉ được phán quyết thông qua hồ sơ khiếu nại (Case): quyết định được duyệt bốn mắt mới được thực thi");

/**
 * Any trace of the late-arrival compensation of this session: a session_settlements row of ANY status under PT_LATE_ARRIVAL:<sessionId>, or any
 * PT_LATE_ARRIVAL_COMPENSATION row of the session. (An obligation / ledger operation of that key can only exist behind such a row: the money step is
 * always started from the intent row. The pre-lock check in the executor also asks the ledger, for rows older than the intents.)
 */
export async function hasD77Trace(tx: Tx, sessionId: string): Promise<boolean> {
  const row = await tx.sessionSettlement.findFirst({
    where: { OR: [{ idempotencyKey: `PT_LATE_ARRIVAL:${sessionId}` }, { sessionId, kind: "PT_LATE_ARRIVAL_COMPENSATION" }] },
    select: { id: true },
  });
  return !!row;
}

export const CANCELLED_BLOCKED_BY_D77 = "CANCELLED_BLOCKED_BY_D77";

/**
 * I6 = A (Ngai, 31/10): a session with a D77 late-arrival compensation (any trace, any state) can NOT be ruled CANCELLED. Applies to EVERY door of the
 * ruling core (the old admin route included), not only to the Case executor. Nothing is written: no status, no money, no quota. It does not turn the
 * ruling into COMPLETED or PT_NO_SHOW_CONFIRMED either - a person decides that. Called under the contract lock, before the compare-and-set.
 */
export async function assertCancelNotOverD77(tx: Tx, sessionId: string, resolution: string): Promise<void> {
  if (resolution !== "CANCELLED") return;
  if (!(await hasD77Trace(tx, sessionId))) return;
  throw execError(
    409,
    CANCELLED_BLOCKED_BY_D77,
    "Buổi này đã có khoản đền đến muộn (D77) nên không thể phán quyết HUỶ. Chưa ghi gì vào buổi, quyền buổi hay tiền. Cần xác minh khoản đền đến muộn và chọn kết quả khác",
    { details: { outcome: resolution } },
  );
}

/**
 * D-NEW-12 (B-1 release gate). A dispute ruling may only be made on a contract whose NEWEST APPROVED policy-eligibility review says ELIGIBLE_CURRENT_POLICY.
 * Fail-closed and unconditional: no review, a review nobody approved yet, or EXCEPTION_APPLIES -> 409 and NOTHING written. There is no date rule, no "missing notice" rule and no
 * switch: it applies to EVERY contract, a brand-new one included, because no effective date of the policy exists. Called under the contract lock, before the compare-and-set.
 */
export async function assertPolicyEligibility(tx: Tx, contractId: string): Promise<void> {
  const latest = await tx.disputeCasePolicyEligibilityReview.findFirst({
    where: { contractId, approvedAt: { not: null } },
    orderBy: [{ approvedAt: "desc" }, { id: "desc" }],
    select: { id: true, result: true },
  });
  if (!latest) {
    throw execError(409, POLICY_ELIGIBILITY_UNVERIFIED, "Hợp đồng này chưa có kết luận đã duyệt về việc áp dụng chính sách hiện hành (D-NEW-12). Chưa phán quyết được. Chưa ghi gì vào buổi, quyền buổi hay tiền", {
      details: { contractId },
    });
  }
  if (latest.result !== "ELIGIBLE_CURRENT_POLICY") {
    throw execError(409, POLICY_EXCEPTION_APPLIES, "Hợp đồng này thuộc một ngoại lệ lịch sử (D-NEW-12) cần xử lý riêng. Chưa phán quyết được. Chưa ghi gì vào buổi, quyền buổi hay tiền", {
      details: { contractId, reviewId: latest.id },
    });
  }
}

/**
 * B-1: EXEC_BLOCKED when the session has a D77 step in any state and its COMBINATION is not opened. The combination is the key outcome + state of L + contract phase (d77-key.ts), not the
 * outcome alone. A combination is open only if its full key is in OPENED_D77_COMBINATIONS (EMPTY in production) or in the executor's TEST-ONLY seam. For the seam only, an outcome-only entry
 * (the pre-key form, used by older suites) still opens that outcome whatever the state. Called under the contract lock, before the CAS.
 */
export async function assertNoD77Combination(tx: Tx, sessionId: string, outcome: string, testOpened: ReadonlyArray<string> = [], read?: D77Read): Promise<void> {
  if (!(await hasD77Trace(tx, sessionId))) return;
  let key: string | null = null;
  let stateNote: Record<string, unknown> = {};
  if (read) {
    // what this transaction can verify itself: the row's SETTLED-ness and the contract's phase must agree with what the executor read
    const row = await tx.sessionSettlement.findUnique({ where: { idempotencyKey: `PT_LATE_ARRIVAL:${sessionId}` }, select: { status: true } });
    const sess = await tx.session.findUnique({ where: { id: sessionId }, select: { contractId: true } });
    const phase = sess ? await phaseOf(tx, sess.contractId) : null;
    const rowSettled = row?.status === "SETTLED";
    const consistent = phase === read.phase && (read.lState === "PENDING" ? !rowSettled : rowSettled);
    stateNote = { lState: read.lState, phase: read.phase, ...(consistent ? {} : { stateChanged: true, rowSettled, phaseNow: phase }) };
    if (consistent) key = d77Key(outcome, read.lState, read.phase);
  }
  if (key !== null && (OPENED_D77_COMBINATIONS.includes(key) || testOpened.includes(key))) return;
  if (testOpened.includes(outcome)) return; // legacy outcome-only entry of the TEST seam
  throw execError(
    409,
    D77_COMBINATION_UNRESOLVED,
    "Buổi này đã có khoản đền đến muộn (D77). Tổ hợp với phán quyết này chưa được duyệt đối soát nên chưa thực thi được. Chưa ghi gì vào buổi, quyền buổi hay tiền",
    { execBlocked: true, details: { outcome, ...stateNote } },
  );
}

/**
 * The context re-read from the database (the caller is not trusted): the decision exists and is APPROVED, belongs to a case of THIS session,
 * its outcome is the ruling being made, and the executor holds the case in EXECUTING for exactly this decision.
 */
export async function assertCaseDecisionContext(tx: Tx, ctx: CaseDecisionCtx, sessionId: string, resolution: string): Promise<void> {
  if (!executionEnabled()) {
    throw execError(409, EXECUTION_DISABLED, "Bộ thực thi quyết định hồ sơ đang tắt");
  }
  const bad = (why: string) => execError(409, CASE_CONTEXT_INVALID, "Quyết định hồ sơ không hợp lệ để thực thi buổi này", { details: { why } });
  const approval = await tx.disputeCaseApproval.findUnique({ where: { id: ctx.caseDecisionId }, include: { proposal: true } });
  if (!approval || approval.result !== "APPROVED") throw bad("DECISION_NOT_APPROVED");
  const c = await tx.disputeCase.findUnique({ where: { id: approval.proposal.caseId } });
  if (!c) throw bad("CASE_MISSING");
  if (c.sessionId !== sessionId) throw bad("WRONG_SESSION");
  if (c.status !== "DECISION_APPROVED") throw bad("CASE_NOT_APPROVED");
  if (c.type === "LEGACY_UNCLASSIFIED") throw bad("LEGACY_UNCLASSIFIED");
  if (approval.proposal.outcome !== resolution) throw bad("OUTCOME_MISMATCH");
  if (c.execStatus !== "EXECUTING" || c.execDecisionId !== ctx.caseDecisionId) throw bad("NOT_EXECUTING_THIS_DECISION");
}

/**
 * The ONE check the core makes before its compare-and-set, under the contract lock: the context (when given), and the D77 guard (when given).
 * T0 rules (entry-point enforcement) are applied by {@link assertEntryAllowed} before any lock is taken.
 */
export async function assertBeforeRulingClaim(tx: Tx, ctx: CaseDecisionCtx | undefined, sessionId: string, resolution: string): Promise<void> {
  if (!ctx) return;
  await assertCaseDecisionContext(tx, ctx, sessionId, resolution);
  await assertNoD77Combination(tx, sessionId, resolution, ctx.openedD77Combinations, ctx.d77Read);
}

/** T0: with the flag on, a call without a CaseDecision is refused (409 CASE_REQUIRED). With the flag off the old behaviour is untouched. */
export function assertEntryAllowed(ctx: CaseDecisionCtx | undefined): void {
  if (!ctx && t0Enabled()) throw caseRequiredError();
}

/**
 * D65 track B - the OLD door (no CaseDecision) must not rule independently of a Case. If the session has a Case in ANY non-terminal status
 * (everything except REJECTED_INTAKE - DECISION_APPROVED included: the approved decision is executed by the Case executor, not by a second ruling),
 * the old door is refused 409 CASE_EXISTS and NOTHING is written. Works with T0 off. A session with no Case keeps the old behaviour until T0.
 * The Case executor passes a ctx and is exempt. Called under the contract lock, before the compare-and-set, at the ruling core boundary, so every
 * door (route, scripts, any future caller) is covered.
 */
export async function assertNoCaseForOldDoor(tx: Tx, ctx: CaseDecisionCtx | undefined, sessionId: string): Promise<void> {
  if (ctx) return;
  // E2 (Ngai, 05/11): a case CLOSED as NOT_A_DISPUTE leaves the session DISPUTED; that session may get ONE new case, but the legacy one-admin door stays refused for it (CASE_EXISTS).
  const open = await tx.disputeCase.findFirst({
    where: { sessionId, OR: [{ status: { notIn: ["REJECTED_INTAKE", "CLOSED"] } }, { status: "CLOSED", closeReason: "NOT_A_DISPUTE" }] },
    select: { id: true, status: true },
  });
  if (!open) return;
  throw execError(
    409,
    CASE_EXISTS,
    "Buổi này đã có hồ sơ khiếu nại (Case): chỉ phán quyết được qua hồ sơ, bốn mắt. Chưa ghi gì vào buổi, quyền buổi hay tiền",
    { details: { caseId: open.id, caseStatus: open.status } },
  );
}
