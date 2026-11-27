/**
 * "New on Gymini" rule for PT discovery: ONE definition shared by the ranking SQL, the quality boost window in
 * pt-discovery-stats.service.ts and the `isNewTrainer` flag on the public DTO.
 *
 * Kept free of imports on purpose (the query module, the stats service and the DTO all need it and they already
 * import each other through the repository).
 */

/** A PT counts as new for this many days after `pt_applications.approved_at`. Also the quality "new trainer" boost window. */
export const NEW_TRAINER_WINDOW_DAYS = 30;

/**
 * Default recommended order interleaves the two streams: this many established PTs, then one new PT, repeating
 * (NEW_TRAINER_SLOT_EVERY = 5 means positions 1-4 established, position 5 new).
 */
export const NEW_TRAINER_SLOT_EVERY = 5;

const DAY_MS = 86_400_000;

/** The instant before which an approval no longer counts as new. */
export function newTrainerCutoff(now: Date = new Date()): Date {
  return new Date(now.getTime() - NEW_TRAINER_WINDOW_DAYS * DAY_MS);
}

/** True when approved strictly after the cutoff (a PT approved exactly 30 days ago is already established). */
export function isNewTrainerApprovedAt(
  approvedAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!approvedAt) return false;
  const t = approvedAt instanceof Date ? approvedAt.getTime() : new Date(approvedAt).getTime();
  if (!Number.isFinite(t)) return false;
  return t > newTrainerCutoff(now).getTime();
}
