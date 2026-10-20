import { gymRepository } from '../repositories/gym.repository';
import { prisma } from '../repositories/prisma';
import { withCompatWriter } from '../repositories/compat-writer';
import { replaceDraftSystemAmenitiesTx } from './gym-amenity.service';
import { applyAmenitySelectionTx, hasSelection, selectionCountsTx, type AmenitySelectionInput } from './gym-amenity-selection.service';
import {
  LEGACY_NO_HEADER,
  amenitiesRequired,
  amenitiesRequiredError,
  clearLegacyNoAmenitiesTx,
  createdFlowVersionData,
  recordLegacyCompatTx,
  recordLegacyRejectedEvent,
  type LegacyCompatAction,
  type ListingCompat,
} from './legacy-compat.service';
import { brandService } from './brand.service';
import { gymCreateSchema } from '../schemas/gym.schemas';
import { gymHoursService } from './gym-hours.service';
import { gymBranchDocumentRepository } from '../repositories/gym-branch-document.repository';
import { REQUIRED_DOC_TYPES } from './gym-branch-document.service';
import { gymBranchReviewRepository } from '../repositories/gym-branch-review.repository';

function err(message: string, status: number, issues?: { field: string; message: string }[]) {
  return Object.assign(new Error(message), { status, issues });
}

const TOTAL_STEPS = 7;

/** The legacy-compat evidence of one branch-draft request (ACCEPTED event + legacy_client_at), inside the business transaction. */
function acceptedEvent(tx: Parameters<typeof recordLegacyCompatTx>[0], gymId: string, ownerId: string, compat: ListingCompat, action: LegacyCompatAction, legacyNoAmenities?: boolean) {
  return recordLegacyCompatTx(tx, {
    action,
    entityType: 'GYM',
    entityId: gymId,
    actorUserId: ownerId,
    flowHeader: compat.flowHeader,
    clientHeader: compat.clientHeader,
    outcome: 'ACCEPTED',
    legacyNoAmenities,
  });
}

/**
 * GYM_BRANCH_FORM_SPEC.md, Phase 1 — the "Add Branch" wizard shell's draft/auto-save/resume
 * mechanics. Kept separate from gym.service.ts (already large) since this is a genuinely
 * distinct concern: everything here operates on a `GymStatus.DRAFT` row with NO field
 * validation until `submitForReview` — the exact opposite discipline from the rest of
 * gym.service.ts, which validates via `gymCreateSchema`/`gymUpdateSchema` at the HTTP layer
 * before ever reaching a service function. A draft's fields are trusted precisely because
 * they are not yet real — nothing reads a DRAFT gym's data anywhere a real branch's data
 * would be read (public listing, membership purchase, check-in — all already filter to
 * APPROVED, and PENDING_REVIEW/REJECTED/SUSPENDED are already excluded from those same
 * reads, so DRAFT needs no new exclusion logic anywhere).
 */
export const gymDraftService = {
  /** "Add Branch" — one click, no required fields, matches §3's precondition check. */
  async createDraft(ownerId: string, compat: ListingCompat = LEGACY_NO_HEADER) {
    const existingBrands = await brandService.listOwned(ownerId);
    const brand = existingBrands[0];
    if (!brand) {
      throw err('Bạn cần hoàn tất thiết lập thương hiệu trước khi tạo chi nhánh', 400);
    }
    return prisma.$transaction(async (tx) => {
      await withCompatWriter(tx);
      const created = await tx.gym.create({
        data: {
          ownerId,
          name: 'Chi nhánh mới',
          address: '',
          status: 'DRAFT',
          wizardStep: 1,
          // Listing Management B3: a branch started by a new client is a flow-2 branch.
          ...createdFlowVersionData(compat),
          brand: { connect: { id: brand.id } },
        },
      });
      await acceptedEvent(tx, created.id, ownerId, compat, 'BRANCH_DRAFT_CREATE');
      return tx.gym.findUniqueOrThrow({ where: { id: created.id } });
    });
  },

  async getOwnedDraft(gymId: string, ownerId: string) {
    const gym = await gymRepository.findById(gymId);
    if (!gym || gym.ownerId !== ownerId) throw err('Không tìm thấy chi nhánh', 404);
    if (gym.status !== 'DRAFT') throw err('Chi nhánh này không còn ở trạng thái nháp', 409);
    return gym;
  },

  /** Partial, unvalidated save — every field optional, no min-length/format checks. The
   * only two things enforced here are ownership and "still actually a draft" (editing a
   * submitted branch goes through the normal, validated updateOwnedGym instead). */
  async updateDraft(
    gymId: string,
    ownerId: string,
    data: Partial<{
      name: string;
      description: string;
      address: string;
      city: string;
      phone: string;
      email: string;
      provinceCode: number | null;
      wardCode: number | null;
      latitude: number | null;
      longitude: number | null;
      locationNote: string;
      facilities: string[];
      wizardStep: number;
    }> &
      AmenitySelectionInput,
    compat: ListingCompat = LEGACY_NO_HEADER,
  ) {
    const gym = await this.getOwnedDraft(gymId, ownerId);
    const patch: Record<string, unknown> = {};
    // `facilities` is deliberately NOT part of this list: it is only a mirror of gym_amenities (Listing Management B4)
    // and is written solely by syncFacilitiesMirrorTx - the wizard's selection goes to gym_amenities below.
    for (const key of ['name', 'description', 'address', 'city', 'phone', 'email', 'provinceCode', 'wardCode', 'latitude', 'longitude', 'locationNote'] as const) {
      if (data[key] !== undefined) patch[key] = data[key];
    }
    if (data.wizardStep !== undefined) {
      const requested = Math.max(1, Math.min(TOTAL_STEPS, Math.trunc(data.wizardStep)));
      // §9/§10 — a monotonic high-water mark, not "wherever the owner currently is": stepping
      // back to review an earlier step (Back button, or clicking an already-unlocked rail
      // item) must not re-lock steps already reached, and a refresh should resume at the
      // furthest point made, not force re-clicking through steps already unlocked.
      patch.wizardStep = Math.max(gym.wizardStep ?? 1, requested);
    }
    const selection: AmenitySelectionInput = { amenityIds: data.amenityIds, proposals: data.proposals, proposalIds: data.proposalIds };
    return prisma.$transaction(async (tx) => {
      await withCompatWriter(tx);
      await tx.gym.update({ where: { id: gymId }, data: patch });
      // `amenityIds` (the amenity step) is authoritative; the older `facilities` labels only apply when it is absent.
      if (data.facilities !== undefined && data.amenityIds === undefined) await replaceDraftSystemAmenitiesTx(tx, gymId, data.facilities);
      if (hasSelection(selection)) await applyAmenitySelectionTx(tx, gym, ownerId, selection);
      if (data.facilities !== undefined || hasSelection(selection)) {
        const counts = await selectionCountsTx(tx, gym);
        if (counts.amenityCount + counts.pendingProposalCount > 0) await clearLegacyNoAmenitiesTx(tx, 'GYM', gymId);
      }
      await acceptedEvent(tx, gymId, ownerId, compat, 'BRANCH_DRAFT_SAVE');
      return tx.gym.findUniqueOrThrow({ where: { id: gymId } });
    });
  },

  /**
   * §34 — full validation, listing exactly what's still missing rather than a generic
   * failure ("3 required items remain", each with its own [Go to issue]). Validates the
   * CURRENT stored state of the draft (not a fresh request body — the owner already saved
   * everything via updateDraft/gymHoursService.setHours along the way). Accumulates every
   * failing check into one `issues` list rather than stopping at the first one, so the
   * owner sees everything that's still missing in a single pass instead of fixing one item
   * only to be told about the next.
   */
  async submitForReview(gymId: string, ownerId: string, compat: ListingCompat = LEGACY_NO_HEADER) {
    const gym = await this.getOwnedDraft(gymId, ownerId);
    const needAmenities = amenitiesRequired(compat, gym.createdFlowVersion);
    const issues: { field: string; message: string }[] = [];

    const result = gymCreateSchema.safeParse({
      name: gym.name,
      description: gym.description ?? undefined,
      address: gym.address,
      city: gym.city ?? undefined,
      phone: gym.phone ?? undefined,
      email: gym.email ?? undefined,
      provinceCode: gym.provinceCode,
      wardCode: gym.wardCode,
      latitude: gym.latitude,
      longitude: gym.longitude,
    });
    if (!result.success) {
      issues.push(...result.error.issues.map((i) => ({ field: String(i.path[0] ?? ''), message: i.message })));
    }

    try {
      await gymHoursService.assertReadyForSubmit(gymId);
    } catch (e: any) {
      issues.push({ field: 'operatingHours', message: e.message });
    }

    // GYM_BRANCH_FORM_SPEC.md, Phase 4 — extends submit-time validation to Step 6's required
    // documents (§95.4: LEASE_OR_PROPERTY_DOC + FACILITY_PHOTOS; fire safety stays optional).
    // A missing row (never touched) counts the same as one with no fileToken — both mean
    // "not actually uploaded yet".
    const existingDocs = await gymBranchDocumentRepository.listByGym(gymId);
    const uploadedTypes = new Set(existingDocs.filter((d) => d.fileToken).map((d) => d.docType));
    for (const docType of REQUIRED_DOC_TYPES) {
      if (!uploadedTypes.has(docType)) {
        issues.push({ field: 'verification', message: `Còn thiếu giấy tờ bắt buộc: ${docType}` });
      }
    }

    if (issues.length > 0) {
      // Every missing item in one answer; the amenities are listed too when this client has to provide them.
      if (needAmenities) {
        const counts = await selectionCountsTx(prisma, gym);
        if (counts.amenityCount + counts.pendingProposalCount === 0) {
          issues.push({ field: 'amenities', message: 'Hãy chọn ít nhất một tiện ích cho chi nhánh' });
        }
      }
      throw err('Hồ sơ chi nhánh chưa đầy đủ', 400, issues);
    }
    let updated;
    try {
      updated = await prisma.$transaction(async (tx) => {
        await withCompatWriter(tx);
        await tx.$queryRaw`SELECT id FROM gyms WHERE id = ${gymId} FOR UPDATE`;
        const counts = await selectionCountsTx(tx, gym);
        const total = counts.amenityCount + counts.pendingProposalCount;
        if (total === 0 && needAmenities) throw amenitiesRequiredError(compat);
        await tx.gym.update({
          where: { id: gymId },
          data: { status: 'PENDING_REVIEW', pendingName: gym.name, pendingAddress: gym.address, wizardStep: null },
        });
        await acceptedEvent(tx, gymId, ownerId, compat, 'BRANCH_DRAFT_SUBMIT', total === 0);
        if (total > 0) await clearLegacyNoAmenitiesTx(tx, 'GYM', gymId);
        return tx.gym.findUniqueOrThrow({ where: { id: gymId } });
      });
    } catch (e) {
      if ((e as { code?: string })?.code === 'AMENITIES_REQUIRED' && !compat.newClient) {
        await recordLegacyRejectedEvent({
          action: 'BRANCH_DRAFT_SUBMIT',
          entityType: 'GYM',
          entityId: gymId,
          actorUserId: ownerId,
          flowHeader: compat.flowHeader,
          clientHeader: compat.clientHeader,
        });
      }
      throw e;
    }
    // GYM_BRANCH_FORM_SPEC.md, Phase 4 — a successful resubmission is the one moment
    // resolution happens: the owner fixed everything across however many steps needed it,
    // then submitted once. Simpler and more correct than trying to auto-detect "was THIS
    // specific category's issue actually addressed" per field edit.
    await gymBranchReviewRepository.resolveAllOpen(gymId);
    return updated;
  },
};
