import type { CollaborationStatus } from '../generated/prisma';

/**
 * B44 - an explicit, DERIVED state for a collaboration agreement, so a client never has to infer it from
 * `terminationInitiatedAt` / `effectiveAt`. The stored `status` enum is NOT changed (an agreement in its notice period is
 * still `ACCEPTED` in the database and for every older client):
 *
 *   PENDING / COUNTERED / REJECTED / EXPIRED / TERMINATED  - same as `status`
 *   ACTIVE        - ACCEPTED, no termination started
 *   TERMINATING   - ACCEPTED, termination started (notice period): refuses NEW contracts from the first moment,
 *                   contracts already running keep their snapshot; ends at `terminationEffectiveAt`
 */
export type CollaborationLifecycle = 'PENDING' | 'COUNTERED' | 'ACTIVE' | 'TERMINATING' | 'REJECTED' | 'EXPIRED' | 'TERMINATED';

export function collaborationLifecycleOf(row: {
  status: CollaborationStatus;
  terminationInitiatedAt?: Date | null;
  effectiveAt?: Date | null;
}): CollaborationLifecycle {
  if (row.status !== 'ACCEPTED') return row.status;
  return row.terminationInitiatedAt || row.effectiveAt ? 'TERMINATING' : 'ACTIVE';
}

/** Adds `lifecycle` and `terminationEffectiveAt` (the date the notice period ends; null unless TERMINATING). */
export function withCollaborationLifecycle<T extends { status: CollaborationStatus; terminationInitiatedAt?: Date | null; effectiveAt?: Date | null }>(
  row: T,
): T & { lifecycle: CollaborationLifecycle; terminationEffectiveAt: Date | null } {
  const lifecycle = collaborationLifecycleOf(row);
  return { ...row, lifecycle, terminationEffectiveAt: lifecycle === 'TERMINATING' ? (row.effectiveAt ?? null) : null };
}
