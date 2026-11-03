import { createElement, type ReactElement } from "react";
import type { DisputeCaseDetail } from "../disputeCaseTypes";
import { ApprovalActions } from "../actions/ApprovalActions";
import { AssessmentActions } from "../actions/AssessmentActions";
import { EvidenceActions } from "../actions/EvidenceActions";
import { FindingActions } from "../actions/FindingActions";
import { OverviewActions } from "../actions/OverviewActions";
import { StatementActions } from "../actions/StatementActions";

/**
 * D2 - the WRITE slots of the Case Workspace. The read views render each slot at the place where its actions live.
 * D3 filled every slot except Execution with the forms in `../actions/*` (one file per slot, tab layout untouched). The Execution slot
 * stays `null` on purpose: the executor is off outside tests and no GET returns `execStatus` (R-01, R-02), so there is no execute button.
 * The policy-eligibility routes (A16/A17) are not built either: nothing lists pending reviews (R-03, D-NEW-12).
 *
 * Contract of every slot:
 *  - `detail`        the A3 answer currently on screen (read-only);
 *  - `currentUserId` the signed-in admin (to hide actions the server would refuse: the server stays authoritative);
 *  - `onChanged`     call after a successful write: the workspace re-reads the case (A3) and refreshes the queue. After a write that answered
 *                    CASE_VERSION_CONFLICT, a state refusal or an unknown outcome the form keeps its content, shows "Tải lại hồ sơ" and calls
 *                    it only when the user clicks (D3: no automatic re-read that could unmount the form, no automatic resend).
 *
 * Which routes belong to which slot (D1 client `disputeCaseApi`):
 *  OverviewActionsSlot    assign (A4), transition (A6), requestMore (A7), classify (A8), addIssue (A10)
 *  EvidenceActionsSlot    recollect (A5), acknowledgeEvidenceChange (A15), share evidence (A18)
 *  StatementsActionsSlot  share statement (A18)
 *  AssessmentsActionsSlot addClaim (A9), addAssessment (A11)
 *  FindingsActionsSlot    recordFinding (A12), propose (A13)
 *  ApprovalsActionsSlot   decide (A14)
 *  ExecutionActionsSlot   execute / reconcile (A20/A21): flag-off outside tests and no `execStatus` in any GET yet, so keep it null until both exist.
 * Money and history have no write action on purpose.
 */
export interface ActionSlotProps {
  detail: DisputeCaseDetail;
  currentUserId: string | null;
  onChanged: () => void | Promise<unknown>;
}

// createElement (not JSX) so that a plain `tsx --test` can call a slot without a React runtime in scope.
export function OverviewActionsSlot(props: ActionSlotProps): ReactElement {
  return createElement(OverviewActions, props);
}
export function EvidenceActionsSlot(props: ActionSlotProps): ReactElement {
  return createElement(EvidenceActions, props);
}
export function StatementsActionsSlot(props: ActionSlotProps): ReactElement {
  return createElement(StatementActions, props);
}
export function AssessmentsActionsSlot(props: ActionSlotProps): ReactElement {
  return createElement(AssessmentActions, props);
}
export function FindingsActionsSlot(props: ActionSlotProps): ReactElement {
  return createElement(FindingActions, props);
}
export function ApprovalsActionsSlot(props: ActionSlotProps): ReactElement {
  return createElement(ApprovalActions, props);
}
export function ExecutionActionsSlot(_props: ActionSlotProps): null {
  return null;
}
