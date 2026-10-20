import type { Prisma } from '../generated/prisma';
import { syncFacilitiesMirrorTx } from './gym-amenity.service';
import { proposeTx } from './gym-amenity-catalog.service';
import { ListingError } from './gym-listing.schemas';

/**
 * Listing Management B3 - the amenity selection of a branch that has NO published listing yet: the application's single DRAFT
 * branch, a branch of the "Add branch" wizard (DRAFT) and a quick-created branch (PENDING_REVIEW). There is no revision for such
 * a branch, so the selection IS its `gym_amenities` rows (catalogue amenities) plus its owner's PENDING `amenity_proposals`
 * bound to it (`gym_id`). `gyms.facilities` stays a mirror (syncFacilitiesMirrorTx, the only writer).
 *
 * Everything here runs inside the caller's transaction, so the selection is saved (or rolled back) together with the business
 * write that carries it.
 */
type Tx = Prisma.TransactionClient;

export interface AmenitySelectionInput {
  amenityIds?: string[];
  proposals?: Array<{ name: string; suggestedCategory: 'FACILITY' | 'TRAINING_ZONE' | 'SERVICE' | 'RECOVERY'; note?: string }>;
  proposalIds?: string[];
}

export const hasSelection = (i: AmenitySelectionInput) => i.amenityIds !== undefined || i.proposals !== undefined || i.proposalIds !== undefined;

export interface SelectionGym {
  id: string;
  ownerId: string;
  brandId?: string | null;
}

/**
 * Applies a selection to `gym`:
 *  - `amenityIds` present  -> the gym's `gym_amenities` become exactly those (plus the catalogue rows `proposals` matched);
 *    absent -> the current rows stay (matched rows are added);
 *  - `proposals`           -> each goes through the plan 12.3 owner algorithm (proposeTx): an ACTIVE catalogue name comes back as a
 *    matched amenity and is selected, otherwise a PENDING proposal bound to this gym;
 *  - `proposalIds` present -> exactly those of the owner's PENDING proposals (plus the ones just proposed) stay bound to the gym;
 *    every other PENDING proposal of the owner for this gym is CANCELLED. Absent -> proposals are left alone.
 * A DISABLED / unknown amenity id is a 422. Returns the resulting counts. The caller holds whatever row lock it needs.
 */
export async function applyAmenitySelectionTx(
  tx: Tx,
  gym: SelectionGym,
  actorUserId: string,
  input: AmenitySelectionInput,
): Promise<{ amenityCount: number; pendingProposalCount: number }> {
  const matchedIds: string[] = [];
  const keepProposalIds = new Set<string>(input.proposalIds ?? []);

  for (const p of input.proposals ?? []) {
    const res = await proposeTx(tx, { ownerId: gym.ownerId, actorUserId, gym, name: p.name, suggestedCategory: p.suggestedCategory, note: p.note });
    if ('matchedAmenity' in res.body) {
      matchedIds.push(res.body.matchedAmenity.id);
    } else {
      // one PENDING proposal per (owner, branch, name): this is always the proposal of THIS branch
      keepProposalIds.add(res.body.proposal.id);
    }
  }

  if (input.proposalIds !== undefined) {
    const mine = await tx.amenityProposal.findMany({
      where: { id: { in: [...keepProposalIds] }, ownerUserId: gym.ownerId, gymId: gym.id, status: 'PENDING' },
      select: { id: true },
    });
    const ok = new Set(mine.map((m) => m.id));
    const bad = [...keepProposalIds].filter((id) => !ok.has(id));
    if (bad.length > 0) {
      throw new ListingError(422, 'PROPOSAL_INVALID', 'Có đề xuất tiện ích không còn hiệu lực hoặc không thuộc chi nhánh này.', { proposalIds: bad });
    }
    // every other PENDING proposal of this branch is deselected by the owner: cancel it (nothing else references it)
    await tx.amenityProposal.updateMany({
      where: { gymId: gym.id, ownerUserId: gym.ownerId, status: 'PENDING', id: { notIn: [...keepProposalIds] } },
      data: { status: 'CANCELLED' },
    });
  }

  if (input.amenityIds !== undefined || matchedIds.length > 0) {
    const wantedIds = [...new Set([...(input.amenityIds ?? []), ...matchedIds])];
    const rows = wantedIds.length ? await tx.amenity.findMany({ where: { id: { in: wantedIds } } }) : [];
    const byId = new Map(rows.map((r) => [r.id, r]));
    const unknown = wantedIds.filter((id) => !byId.has(id));
    if (unknown.length > 0) throw new ListingError(422, 'AMENITY_UNKNOWN', 'Tiện ích không hợp lệ.', { amenityIds: unknown });
    const disabled = rows.filter((r) => r.status !== 'ACTIVE');
    if (disabled.length > 0) {
      throw new ListingError(422, 'AMENITY_DISABLED', `Tiện ích đã ngừng trong danh mục: ${disabled.map((r) => r.name).join(', ')}`, {
        amenityIds: disabled.map((r) => r.id),
      });
    }
    if (input.amenityIds !== undefined) {
      await tx.gymAmenity.deleteMany({ where: { gymId: gym.id, amenityId: { notIn: wantedIds } } });
    }
    if (wantedIds.length > 0) {
      await tx.gymAmenity.createMany({ data: wantedIds.map((amenityId) => ({ gymId: gym.id, amenityId })), skipDuplicates: true });
    }
    await syncFacilitiesMirrorTx(tx, gym.id);
  }

  return selectionCountsTx(tx, gym);
}

/** ACTIVE catalogue amenities attached to the branch, and the owner's PENDING proposals bound to it. */
export async function selectionCountsTx(tx: Tx, gym: Pick<SelectionGym, 'id' | 'ownerId'>): Promise<{ amenityCount: number; pendingProposalCount: number }> {
  const [amenityCount, pendingProposalCount] = await Promise.all([
    tx.gymAmenity.count({ where: { gymId: gym.id, amenity: { status: 'ACTIVE' } } }),
    tx.amenityProposal.count({ where: { gymId: gym.id, ownerUserId: gym.ownerId, status: 'PENDING' } }),
  ]);
  return { amenityCount, pendingProposalCount };
}
