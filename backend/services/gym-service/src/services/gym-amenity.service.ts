import type { Prisma } from '../generated/prisma';
import { withCompatWriter } from '../repositories/compat-writer';

type Tx = Prisma.TransactionClient;

function err(message: string, status: number, code?: string) {
  return Object.assign(new Error(message), { status, ...(code ? { code } : {}) });
}

/**
 * THE ONLY WRITER of `gyms.facilities` (Listing Management B4). The column is a mirror, for apps installed before the
 * amenity catalogue: exactly the slugs of the branch's ACTIVE SYSTEM amenities in `gym_amenities` (a SYSTEM slug is a
 * `GymFacility` enum label; CUSTOM amenities have no enum value and appear only in `amenities[]`). Ordered by the
 * catalogue's sort_order.
 *
 * Allowed callers: the transaction that applies a listing revision, the admin direct edit, the admin enable/disable of a
 * catalogue amenity (re-syncs the branches using it), and - for a DRAFT branch only - the wizard facility write below.
 * Must run inside a transaction; it marks that transaction as an event-aware writer (it UPDATEs `gyms`).
 */
export async function syncFacilitiesMirrorTx(tx: Tx, gymId: string): Promise<void> {
  await withCompatWriter(tx);
  await tx.$executeRaw`
    UPDATE "gyms" SET
      "facilities" = COALESCE(
        (SELECT array_agg(a."slug"::"GymFacility" ORDER BY a."sort_order", a."slug")
           FROM "gym_amenities" ga
           JOIN "amenities" a ON a."id" = ga."amenity_id"
          WHERE ga."gym_id" = "gyms"."id" AND a."source" = 'SYSTEM' AND a."status" = 'ACTIVE'),
        ARRAY[]::"GymFacility"[]),
      "updated_at" = now()
    WHERE "id" = ${gymId}`;
}

/**
 * DRAFT-branch wizard write: the owner's facility selection (GymFacility labels = SYSTEM amenity slugs) becomes the
 * branch's SYSTEM rows in `gym_amenities`, then the mirror is re-synced. CUSTOM amenities already attached to the
 * branch are left alone. A slug whose catalogue row is DISABLED cannot be attached (422 AMENITY_DISABLED).
 * Duplicates in the input collapse. The caller has already established that the gym is a DRAFT owned by the caller.
 */
export async function replaceDraftSystemAmenitiesTx(tx: Tx, gymId: string, slugs: readonly string[]): Promise<void> {
  const wanted = [...new Set(slugs)];
  const found = wanted.length
    ? await tx.amenity.findMany({ where: { slug: { in: wanted }, source: 'SYSTEM' } })
    : [];
  const bySlug = new Map(found.map((a) => [a.slug, a]));
  const unknown = wanted.filter((s) => !bySlug.has(s));
  if (unknown.length > 0) throw err('Tiện ích không hợp lệ', 422, 'AMENITY_UNKNOWN');
  const disabled = found.filter((a) => a.status !== 'ACTIVE');
  if (disabled.length > 0) {
    throw err(`Tiện ích đã ngừng trong danh mục: ${disabled.map((a) => a.name).join(', ')}`, 422, 'AMENITY_DISABLED');
  }

  await tx.gymAmenity.deleteMany({ where: { gymId, amenity: { source: 'SYSTEM' } } });
  if (found.length > 0) {
    await tx.gymAmenity.createMany({ data: found.map((a) => ({ gymId, amenityId: a.id })), skipDuplicates: true });
  }
  await syncFacilitiesMirrorTx(tx, gymId);
}
