import { peekActiveWorkflow } from "../../agent-workflow/orchestrator";
import { prisma } from "../../repositories/conversation.repository";

/**
 * Non-sensitive snapshot of the conversation state one turn is routed against. Used only for diagnostics: it carries ids, types and
 * statuses — never profile values, message text or tokens — so a trace line can be joined to its request by `correlationId` and the
 * state the router actually saw can be compared with the state the caller assumed.
 */
export interface WorkflowSnapshot { id: string; type: string; status: string; expectedSlot: string | null }
export interface TurnStateSnapshot { workflow: WorkflowSnapshot | null; pendingDraft: boolean }

export async function hasPendingDraft(userId: string, sessionId: string): Promise<boolean> {
  return (await prisma.fitnessAgentAction.count({ where: { userId, sessionId, status: "PENDING", expiresAt: { gt: new Date() } } }).catch(() => 0)) > 0;
}

export function toWorkflowSnapshot(a: { id: string; type: string; status: string; expectedSlot: string | null } | null): WorkflowSnapshot | null {
  return a ? { id: a.id, type: a.type, status: a.status, expectedSlot: a.expectedSlot } : null;
}

export async function snapshotTurnState(userId: string, sessionId: string): Promise<TurnStateSnapshot> {
  const [active, pendingDraft] = await Promise.all([peekActiveWorkflow(userId, sessionId).catch(() => null), hasPendingDraft(userId, sessionId)]);
  return { workflow: toWorkflowSnapshot(active), pendingDraft };
}

/** what changed between two snapshots of the same session (the workflow "state transition" of a turn) */
export function describeTransition(before: TurnStateSnapshot, after: TurnStateSnapshot) {
  const b = before.workflow; const a = after.workflow;
  const sameRow = Boolean(b && a && b.id === a.id);
  return {
    workflowBefore: b, workflowAfter: a,
    workflowTransition: !b && !a ? "none" : !b ? "started" : !a ? "ended" : !sameRow ? "replaced" : b.status !== a.status || b.expectedSlot !== a.expectedSlot ? "advanced" : "unchanged",
    pendingDraftBefore: before.pendingDraft, pendingDraftAfter: after.pendingDraft,
  };
}
