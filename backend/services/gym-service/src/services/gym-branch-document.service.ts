import { gymBranchDocumentRepository } from '../repositories/gym-branch-document.repository';
import { gymRepository } from '../repositories/gym.repository';
import { partnerRepository } from '../repositories/partner.repository';
import { partnerDiligenceService } from './partner-diligence.service';
import { gymService } from './gym.service';
import type { BranchDocumentType, PartnerDocumentStatus } from '../generated/prisma';

function err(message: string, status: number) {
  return Object.assign(new Error(message), { status });
}

/** §95.4 — LEASE_OR_PROPERTY_DOC and FACILITY_PHOTOS are always required; a fire-safety
 * certificate isn't mandated in every locality, same discretion diligence.service.ts already
 * gives FIRE_SAFETY_CERTIFICATE at the partner level. Exported — gym-draft.service.ts's
 * Phase 4 submit-time check reuses these instead of a second, driftable copy. */
export const REQUIRED_DOC_TYPES: BranchDocumentType[] = ['LEASE_OR_PROPERTY_DOC', 'FACILITY_PHOTOS'];
export const ALL_DOC_TYPES: BranchDocumentType[] = ['LEASE_OR_PROPERTY_DOC', 'FIRE_SAFETY_CERTIFICATE', 'FACILITY_PHOTOS'];

/**
 * GYM_BRANCH_FORM_SPEC.md, Phase 3 — Step 6 "Verification". §95.4: this is branch-level
 * verification ONLY (lease/property doc, fire-safety cert, facility photos) — never the
 * partner-level business registration/tax/rep-identity, already collected once at partner
 * vetting (GymPartnerDocument). listForOwner surfaces those partner-level documents too, but
 * strictly as read-only context (`partnerContext` below) — nothing here ever writes to them.
 */
/** Luôn trả đủ 3 dòng (kể cả chưa từng đụng tới), same "never make the caller infer a
 * missing row" discipline as gymHoursService.getHours/partnerDiligenceService.listDocuments.
 * Shared by listForOwner/listForAdmin below — the only difference between the two is HOW
 * `ownerId` was obtained (the caller's own identity vs. looked up from the gym row). */
async function buildDocumentsView(gymId: string, ownerId: string) {
  const [existing, account] = await Promise.all([
    gymBranchDocumentRepository.listByGym(gymId),
    partnerRepository.findAccountByUserId(ownerId),
  ]);
  const byType = new Map(existing.map((d) => [d.docType, d]));
  const documents = ALL_DOC_TYPES.map(
    (docType) =>
      byType.get(docType) ?? {
        id: null,
        gymId,
        docType,
        required: REQUIRED_DOC_TYPES.includes(docType),
        fileToken: null,
        status: 'PENDING' as PartnerDocumentStatus,
        verifiedBy: null,
        verifiedAt: null,
      },
  );

  // §95.4 — read-only context so the owner/admin sees this branch's owner doesn't need to
  // resubmit what was already collected once at partner vetting. Reuses
  // partnerDiligenceService.listDocuments (not the bare repository call) specifically for its
  // "always all 6 rows" padding. Empty array if this owner somehow has no partner record at
  // all (pre-partner-model legacy gym) rather than failing the whole call.
  const partnerContext = account?.partnerId ? await partnerDiligenceService.listDocuments(account.partnerId) : [];

  return { documents, partnerContext, gymId };
}

export const gymBranchDocumentService = {
  async listForOwner(gymId: string, ownerId: string) {
    const gym = await gymService.getOwnedGym(gymId, ownerId);
    return buildDocumentsView(gymId, gym.ownerId);
  },

  /** GYM_BRANCH_FORM_SPEC.md, Phase 6 — admin review workspace. No ownership check (an admin
   * reviews any gym); ownerId is looked up from the gym row instead of the caller's own
   * identity, purely to resolve which partner's documents belong in `partnerContext`. */
  async listForAdmin(gymId: string) {
    const gym = await gymRepository.findById(gymId);
    if (!gym) throw err('Gym not found', 404);
    return buildDocumentsView(gymId, gym.ownerId);
  },

  async attachFile(gymId: string, ownerId: string, docType: BranchDocumentType, fileToken: string) {
    await gymService.getOwnedGym(gymId, ownerId);
    if (!ALL_DOC_TYPES.includes(docType)) throw err('Loại giấy tờ không hợp lệ', 400);
    if (!fileToken?.trim()) throw err('Chưa có tệp nào được tải lên', 400);
    // Re-uploading resets any prior review — a new file needs a fresh look, not to silently
    // keep an old VERIFIED/REJECTED status attached to different bytes.
    return gymBranchDocumentRepository.upsert(gymId, docType, {
      fileToken: fileToken.trim(),
      required: REQUIRED_DOC_TYPES.includes(docType),
      status: 'RECEIVED',
    });
  },
};
