import { gymRepository } from '../repositories/gym.repository';
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
  async createDraft(ownerId: string) {
    const existingBrands = await brandService.listOwned(ownerId);
    const brand = existingBrands[0];
    if (!brand) {
      throw err('Bạn cần hoàn tất thiết lập thương hiệu trước khi tạo chi nhánh', 400);
    }
    return gymRepository.create({
      ownerId,
      name: 'Chi nhánh mới',
      address: '',
      status: 'DRAFT',
      wizardStep: 1,
      brand: { connect: { id: brand.id } },
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
    }>,
  ) {
    const gym = await this.getOwnedDraft(gymId, ownerId);
    const patch: Record<string, unknown> = {};
    for (const key of ['name', 'description', 'address', 'city', 'phone', 'email', 'provinceCode', 'wardCode', 'latitude', 'longitude', 'locationNote', 'facilities'] as const) {
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
    return gymRepository.update(gymId, patch);
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
  async submitForReview(gymId: string, ownerId: string) {
    const gym = await this.getOwnedDraft(gymId, ownerId);
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
      throw err('Hồ sơ chi nhánh chưa đầy đủ', 400, issues);
    }
    const updated = await gymRepository.update(gymId, {
      status: 'PENDING_REVIEW',
      pendingName: gym.name,
      pendingAddress: gym.address,
      wizardStep: null,
    });
    // GYM_BRANCH_FORM_SPEC.md, Phase 4 — a successful resubmission is the one moment
    // resolution happens: the owner fixed everything across however many steps needed it,
    // then submitted once. Simpler and more correct than trying to auto-detect "was THIS
    // specific category's issue actually addressed" per field edit.
    await gymBranchReviewRepository.resolveAllOpen(gymId);
    return updated;
  },
};
