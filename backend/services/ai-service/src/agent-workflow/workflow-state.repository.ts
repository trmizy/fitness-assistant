import { prisma } from "../repositories/conversation.repository";
import { Prisma } from "../generated/prisma";
import type { WorkflowStatus, PendingProfileUpdate } from "./types";

/** Real DB-backed CRUD for AgentWorkflowSession — see the model's own doc
 * comment in schema.prisma and docs/conversational-ai-coach-workflow-
 * design.md for why this exists as its own table. One ACTIVE (non-terminal)
 * workflow per (userId, sessionId) — see findActive()'s own query. */

const TERMINAL_STATUSES: WorkflowStatus[] = ["COMPLETED", "CANCELLED", "EXPIRED"];
// 30 minutes — long enough to survive a page refresh/brief disconnect
// (docs/...§Workflow expiry — "use current session/draft TTL conventions
// where sensible"), matching the same order of magnitude as
// FitnessAgentAction's own 15-minute action-confirmation TTL, doubled since
// a multi-turn slot-filling conversation naturally spans more real time
// than a single yes/no confirmation.
export const WORKFLOW_TTL_MS = 30 * 60_000;

export const workflowStateRepository = {
  async findActive(userId: string, sessionId: string) {
    const row = await prisma.agentWorkflowSession.findFirst({
      where: { userId, sessionId, status: { notIn: TERMINAL_STATUSES } },
      orderBy: { createdAt: "desc" },
    });
    if (!row) return null;
    if (row.expiresAt < new Date()) {
      await prisma.agentWorkflowSession.update({ where: { id: row.id }, data: { status: "EXPIRED" } });
      return null;
    }
    return row;
  },

  /** Codex Evaluation #1 §14/§28/§35 — the DB now enforces "at most one
   * active workflow per (userId, sessionId)" via a partial unique index
   * (see schema.prisma's comment + migration
   * 20260916090000_agent_workflow_session_active_unique). A concurrent
   * loser's INSERT fails with Postgres error 23505 (Prisma code P2002),
   * caught here and turned into `null` — the caller must never crash the
   * turn on this, it means a different concurrent request already won and
   * created the active row first. */
  async create(userId: string, sessionId: string, workflowType: string, known: Record<string, unknown>) {
    try {
      return await prisma.agentWorkflowSession.create({
        data: {
          userId, sessionId, workflowType, status: "COLLECTING_SLOTS",
          slotsJson: known as any, expiresAt: new Date(Date.now() + WORKFLOW_TTL_MS),
        },
      });
    } catch (err: any) {
      if (err?.code === "P2002") return null;
      throw err;
    }
  },

  async update(id: string, data: {
    status?: WorkflowStatus; expectedSlot?: string | null; slotsJson?: Record<string, unknown>;
    pendingProfileUpdate?: PendingProfileUpdate | null; draftRef?: Record<string, unknown> | null; bumpRevision?: boolean;
    extendExpiry?: boolean;
  }) {
    return prisma.agentWorkflowSession.update({
      where: { id },
      data: {
        ...(data.status !== undefined ? { status: data.status } : {}),
        ...(data.expectedSlot !== undefined ? { expectedSlot: data.expectedSlot } : {}),
        ...(data.slotsJson !== undefined ? { slotsJson: data.slotsJson as any } : {}),
        ...(data.pendingProfileUpdate !== undefined ? { pendingProfileUpdate: data.pendingProfileUpdate as any } : {}),
        ...(data.draftRef !== undefined ? { draftRef: data.draftRef as any } : {}),
        ...(data.bumpRevision ? { revision: { increment: 1 } } : {}),
        ...(data.extendExpiry ? { expiresAt: new Date(Date.now() + WORKFLOW_TTL_MS) } : {}),
      },
    });
  },

  async cancel(id: string) {
    return prisma.agentWorkflowSession.update({ where: { id }, data: { status: "CANCELLED" } });
  },

  async complete(id: string) {
    return prisma.agentWorkflowSession.update({ where: { id }, data: { status: "COMPLETED" } });
  },

  /** Codex Evaluation #1 §37 "Concurrent Confirm" — two simultaneous
   * "Xác nhận cập nhật" replies against the SAME AWAITING_SLOT_CONFIRMATION
   * row could both read the row before either wrote, then both call
   * updateProfileFields() and complete(). Atomically claim the row via a
   * CONDITIONAL update (only succeeds if status is still exactly
   * AWAITING_SLOT_CONFIRMATION — Postgres serializes concurrent UPDATEs on
   * the same row, so only one of two concurrent callers can win this).
   * Returns true if THIS call won the claim; false means another request
   * is already processing the same confirmation. A transient "WRITING"
   * status is used rather than jumping straight to COMPLETED so a write
   * failure can cleanly revert (see releaseClaimAfterFailedWrite) without
   * ever having marked the workflow complete before the write actually
   * succeeded — preserving the existing "failed write stays pending"
   * contract. */
  async claimForWrite(id: string): Promise<boolean> {
    const result = await prisma.agentWorkflowSession.updateMany({
      where: { id, status: "AWAITING_SLOT_CONFIRMATION" },
      data: { status: "WRITING" },
    });
    return result.count === 1;
  },

  async releaseClaimAfterFailedWrite(id: string) {
    await prisma.agentWorkflowSession.updateMany({
      where: { id, status: "WRITING" },
      data: { status: "AWAITING_SLOT_CONFIRMATION" },
    });
  },

  /** X4 event-ordering fix (docs/conversational-intelligence-x4-event-ordering-fix.md), Defect A:
   * the previous version fetched only the 5 most recent TERMINAL rows and filtered for a
   * non-null `pendingProfileUpdate` in JS — Codex's independent "history-over-five" reproduction
   * proved that six newer, unrelated terminal workflows (e.g. abandoned CREATE_WORKOUT_PLAN
   * slot-collections, `pendingProfileUpdate` always null) fill all 5 slots and hide an older,
   * genuinely completed profile confirmation, falsely denying a real saved change.
   *
   * Fixed by filtering AT THE DATABASE LEVEL — `pendingProfileUpdate: { not: Prisma.DbNull }`
   * matches every row where a real value was ever written (this code only ever stores an actual
   * proposal array or leaves the column at its SQL-NULL default — never an explicit JSON `null`
   * literal — so `DbNull`, not `JsonNull`/`AnyNull`, is the correct sentinel here) — combined with
   * `status IN (terminal)` and `ORDER BY updated_at DESC LIMIT 1` in a single query. No
   * take/window truncation of any kind; the (userId, sessionId, status, updatedAt) index added
   * alongside this fix (migration 20260927150000_fitness_agent_action_updated_at) keeps this a
   * single index-scan lookup regardless of how much unrelated terminal-workflow history exists
   * for the session.
   *
   * The status filter is technically redundant with findActive()'s own contract (this is only
   * ever meaningful to call after findActive() has returned null, so every row is already
   * terminal) but is kept explicit for clarity/safety against future callers. */
  async findLatestProfileConfirmation(userId: string, sessionId: string) {
    return prisma.agentWorkflowSession.findFirst({
      where: { userId, sessionId, status: { in: TERMINAL_STATUSES }, pendingProfileUpdate: { not: Prisma.DbNull } },
      orderBy: { updatedAt: "desc" },
      select: { status: true, updatedAt: true, pendingProfileUpdate: true },
    });
  },
};
