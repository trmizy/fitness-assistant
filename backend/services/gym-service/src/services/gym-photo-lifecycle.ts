import type { Prisma } from '../generated/prisma';

type Tx = Prisma.TransactionClient;

/** Photo order everywhere: cover first is the READER's concern; the stored order is always (sort_order, created_at, id). */
const PHOTO_ORDER = [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] as const;

/** A branch in one of these statuses has never been public, so all of its photos are STAGED (migration backfill rule). */
export const NEVER_PUBLIC_GYM_STATUSES = ['DRAFT', 'PENDING_REVIEW', 'REJECTED'] as const;

export function wasNeverPublic(status: string): boolean {
  return (NEVER_PUBLIC_GYM_STATUSES as readonly string[]).includes(status);
}

/**
 * The FIRST approval of a branch (DRAFT / PENDING_REVIEW / REJECTED -> APPROVED) makes its STAGED photos PUBLISHED.
 * Photos submitted with a new branch are STAGED (they must never be reachable before approval); without this step an
 * approved branch would show no photos at all, because clients only ever see PUBLISHED.
 *
 * Inside the same transaction it also leaves the gallery in the shape the database enforces: at most one PUBLISHED
 * cover (the first flagged photo by order, else the first photo) and a gap-free sort_order 0..n-1.
 * Returns how many photos were published.
 */
export async function publishStagedGymPhotosTx(tx: Tx, gymId: string): Promise<number> {
  const rows = await tx.gymPhoto.findMany({
    where: { gymId, status: { in: ['STAGED', 'PUBLISHED'] } },
    orderBy: [...PHOTO_ORDER],
  });
  const staged = rows.filter((r) => r.status === 'STAGED');
  if (staged.length === 0) return 0;

  const coverId = (rows.find((r) => r.isCover) ?? rows[0]).id;
  // Clear the stale flags BEFORE publishing so the unique "one PUBLISHED cover" index is never violated mid-way.
  await tx.gymPhoto.updateMany({ where: { gymId, isCover: true, id: { not: coverId } }, data: { isCover: false } });
  await tx.gymPhoto.updateMany({ where: { id: coverId }, data: { isCover: true } });
  await tx.gymPhoto.updateMany({ where: { gymId, status: 'STAGED' }, data: { status: 'PUBLISHED' } });
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].sortOrder !== i) await tx.gymPhoto.update({ where: { id: rows[i].id }, data: { sortOrder: i } });
  }
  return staged.length;
}
