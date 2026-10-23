/**
 * Listing Management (Phase D1) — the pure half of the admin page "Tin đăng & tiện ích".
 *
 * Request bodies were read off the zod schemas (user-service pt-listing.schemas.ts#adminDirectEditBodySchema /
 * adminRetireBodySchema / adminNoteRequiredBodySchema, gym-service gym-listing.schemas.ts) — all `.strict()`, so
 * only the keys built here may be sent. No React: runs under `npx tsx --test`.
 */
import type {
  AdminListingListItem,
  Amenity,
  AmenityCategory,
  AmenityProposalGroup,
  GymListingPayload,
  ListingRevisionStatus,
  PtListingPackageDraft,
  PtListingPayload,
  PtListingProfileDraft,
} from "../types";
import type { StatusTone } from "./ptListing";
import { isKnownAmenityIcon } from "./amenityIcons";

// ── limits (server constants) ─────────────────────────────────────────────────────────────────
export const MIN_ADMIN_REASON_LENGTH = 10;
export const MAX_ADMIN_REASON_LENGTH = 1000;
export const MAX_NOTE_LENGTH = 1000;
export const MAX_PT_PHOTOS = 5;
/** gym-service gym-listing.schemas.ts#MAX_GYM_PHOTOS */
export const MAX_GYM_PHOTOS = 20;
export const MAX_GYM_DESCRIPTION = 300;
export const AMENITY_NAME_MIN = 2;
export const AMENITY_NAME_MAX = 40;
export const PROPOSAL_REJECT_REASON_MIN = 3;
export const PROPOSAL_REJECT_REASON_MAX = 500;

// ── revision status as the admin reads it ─────────────────────────────────────────────────────
export const REVISION_STATUS_VIEW: Record<ListingRevisionStatus, { label: string; tone: StatusTone }> = {
  DRAFT: { label: "Đang soạn", tone: "neutral" },
  PENDING: { label: "Chờ duyệt", tone: "info" },
  APPROVED: { label: "Đã duyệt", tone: "success" },
  REJECTED: { label: "Đã từ chối", tone: "danger" },
  CHANGES_REQUESTED: { label: "Đã yêu cầu sửa", tone: "warning" },
  WITHDRAWN: { label: "Đã rút lại", tone: "neutral" },
  STALE: { label: "Đã lỗi thời", tone: "warning" },
};

export const revisionStatusView = (s: string) =>
  REVISION_STATUS_VIEW[s as ListingRevisionStatus] ?? { label: "Không rõ", tone: "neutral" as StatusTone };

/** Queue filter: PENDING first (the default), then the closed ones the admin may want to look back at. */
export const QUEUE_STATUS_OPTIONS: { value: ListingRevisionStatus; label: string }[] = [
  { value: "PENDING", label: "Chờ duyệt" },
  { value: "APPROVED", label: "Đã duyệt" },
  { value: "REJECTED", label: "Đã từ chối" },
  { value: "CHANGES_REQUESTED", label: "Đã yêu cầu sửa" },
  { value: "STALE", label: "Đã lỗi thời" },
  { value: "WITHDRAWN", label: "Đã rút lại" },
  { value: "DRAFT", label: "Đang soạn" },
];

export function revisionSourceLabel(source: string | undefined | null): string {
  if (source === "ADMIN_DIRECT") return "Admin sửa trực tiếp";
  if (source === "OWNER") return "Chủ tin gửi";
  return "Hệ thống";
}

/** Query params of GET /admin/listings/{pts|gyms}. Empty filters are not sent. */
export function buildQueueParams(f: { status: string; q?: string; brandId?: string; gymId?: string; page?: number }) {
  const out: Record<string, string | number> = { status: f.status };
  if (f.q?.trim()) out.q = f.q.trim();
  if (f.brandId) out.brandId = f.brandId;
  if (f.gymId) out.gymId = f.gymId;
  if (f.page && f.page > 1) out.page = f.page;
  return out;
}

export const queueItemTitle = (i: AdminListingListItem): string => i.ptName ?? i.gymName ?? "Tin đăng";

// ── reasons / notes ───────────────────────────────────────────────────────────────────────────
export function adminReasonError(reason: string): string | null {
  const r = reason.trim();
  if (r.length < MIN_ADMIN_REASON_LENGTH) return `Lý do cần ít nhất ${MIN_ADMIN_REASON_LENGTH} ký tự (hiện ${r.length}).`;
  if (r.length > MAX_ADMIN_REASON_LENGTH) return `Lý do tối đa ${MAX_ADMIN_REASON_LENGTH} ký tự.`;
  return null;
}

/** reject / request-changes need a note (min 1). */
export function noteRequiredError(note: string): string | null {
  const n = note.trim();
  if (!n) return "Hãy nhập ghi chú cho chủ tin.";
  if (n.length > MAX_NOTE_LENGTH) return `Ghi chú tối đa ${MAX_NOTE_LENGTH} ký tự.`;
  return null;
}

export function proposalRejectReasonError(reason: string): string | null {
  const r = reason.trim();
  if (r.length < PROPOSAL_REJECT_REASON_MIN) return `Lý do cần ít nhất ${PROPOSAL_REJECT_REASON_MIN} ký tự.`;
  if (r.length > PROPOSAL_REJECT_REASON_MAX) return `Lý do tối đa ${PROPOSAL_REJECT_REASON_MAX} ký tự.`;
  return null;
}

// ── approve (gym) ─────────────────────────────────────────────────────────────────────────────
export interface GymApproveOptions {
  note?: string;
  dropRejectedAmenities?: boolean;
  dropDisabledAmenities?: boolean;
}

/** Body of POST /admin/listings/gyms/revisions/:rid/approve — only the keys that are set (`.strict()`). */
export function buildGymApproveBody(o: GymApproveOptions): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  if (o.note?.trim()) body.note = o.note.trim();
  if (o.dropRejectedAmenities) body.dropRejectedAmenities = true;
  if (o.dropDisabledAmenities) body.dropDisabledAmenities = true;
  return body;
}

/** The server refuses approval while a custom amenity of the revision is still PENDING (CUSTOM_AMENITY_PENDING). */
export function approveBlockedByProposal(flags: { hasPendingProposal: boolean } | undefined): boolean {
  return !!flags?.hasPendingProposal;
}

// ── photo ordering (admin works on what is PUBLIC) ────────────────────────────────────────────
/** Photos an admin may keep on a PT: only ones already public (the server answers 422 PHOTO_NOT_PUBLISHED otherwise). */
export function ptAdminPhotoCandidates(publishedIds: string[], selected: string[]): string[] {
  const pub = new Set(publishedIds);
  return selected.filter((id) => pub.has(id));
}

// ── direct edit bodies ────────────────────────────────────────────────────────────────────────
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** The package fields the server compares (pt-listing-diff.ts PACKAGE_COMMERCIAL_FIELDS). */
const PKG_FIELDS = ["name", "description", "price", "sessionCount", "sessionMode", "sessionDurationMinutes", "validityDays", "isActive"] as const;

function cleanPackage(p: PtListingPackageDraft): PtListingPackageDraft {
  return {
    ...(p.id ? { id: p.id } : {}),
    name: p.name.trim(),
    description: p.description?.trim() ? p.description.trim() : null,
    price: p.price,
    sessionCount: p.sessionCount,
    sessionMode: p.sessionMode,
    sessionDurationMinutes: p.sessionDurationMinutes,
    validityDays: p.validityDays,
    isActive: p.isActive,
    ...(p.archive ? { archive: true } : {}),
  };
}

function packagesChanged(before: PtListingPackageDraft[], after: PtListingPackageDraft[]): boolean {
  const live = after.filter((p) => !p.archive);
  if (live.length !== before.length) return true;
  const byId = new Map(before.map((p) => [p.id, p]));
  return live.some((p) => {
    if (!p.id) return true;
    const old = byId.get(p.id);
    if (!old) return true;
    return PKG_FIELDS.some((f) => !same(f === "price" ? Number(old[f]) : old[f], f === "price" ? Number(p[f]) : p[f]));
  });
}

export interface PtDirectEditInput {
  published: PtListingPayload;
  profile: PtListingProfileDraft;
  packages: PtListingPackageDraft[];
  photoIds: string[];
  coverPhotoId: string | null;
  reason: string;
  expectedListingVersion: number;
}

/**
 * Body of POST /admin/listings/pts/:ptUserId/direct-edit. Only what differs from the published listing is sent
 * (profile as a partial, packages as the complete wanted list, photos/cover), plus `reason` and
 * `expectedListingVersion`. Returns null when nothing differs (the server would answer 422 NO_CHANGES).
 */
export function buildPtDirectEditBody(i: PtDirectEditInput): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};
  const profile: Record<string, unknown> = {};
  (Object.keys(i.profile) as (keyof PtListingProfileDraft)[]).forEach((k) => {
    if (!same(i.profile[k], i.published.profile[k])) profile[k] = i.profile[k];
  });
  if (Object.keys(profile).length) body.profile = profile;
  if (packagesChanged(i.published.packages, i.packages)) body.packages = i.packages.map(cleanPackage);
  const photos = [...new Set(i.photoIds)];
  if (!same(photos, i.published.photoIds)) body.photoIds = photos;
  const cover = photos.length === 0 ? null : i.coverPhotoId && photos.includes(i.coverPhotoId) ? i.coverPhotoId : photos[0];
  if (!same(cover, i.published.coverPhotoId)) body.coverPhotoId = cover;
  if (Object.keys(body).length === 0) return null;
  return { ...body, reason: i.reason.trim(), expectedListingVersion: i.expectedListingVersion };
}

export interface GymDirectEditInput {
  published: GymListingPayload;
  description: string;
  amenityIds: string[];
  photoIds: string[];
  coverPhotoId: string | null;
  reason: string;
  expectedListingVersion: number;
}

/** Body of POST /admin/listings/gyms/:gymId/direct-edit (description, amenityIds, photoIds, coverPhotoId). */
export function buildGymDirectEditBody(i: GymDirectEditInput): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};
  const description = i.description.trim() ? i.description.trim() : null;
  if (!same(description, i.published.description || null)) body.description = description;
  const amenities = [...new Set(i.amenityIds)];
  if (!same([...amenities].sort(), [...i.published.amenityIds].sort())) body.amenityIds = amenities;
  const photos = [...new Set(i.photoIds)];
  if (!same(photos, i.published.photoIds)) body.photoIds = photos;
  const cover = photos.length === 0 ? null : i.coverPhotoId && photos.includes(i.coverPhotoId) ? i.coverPhotoId : photos[0];
  if (!same(cover, i.published.coverPhotoId)) body.coverPhotoId = cover;
  if (Object.keys(body).length === 0) return null;
  return { ...body, reason: i.reason.trim(), expectedListingVersion: i.expectedListingVersion };
}

export function gymDirectEditError(i: { description: string; photoIds: string[] }): string | null {
  if (i.description.trim().length > MAX_GYM_DESCRIPTION) return `Giới thiệu tối đa ${MAX_GYM_DESCRIPTION} ký tự.`;
  if (i.photoIds.length > MAX_GYM_PHOTOS) return `Chi nhánh chỉ có tối đa ${MAX_GYM_PHOTOS} ảnh.`;
  return null;
}

/** Body of POST .../photos/:photoId/retire (and .../physique/:photoId/retire). */
export function buildRetireBody(reason: string, purge: boolean): { reason: string; purge?: boolean } {
  return { reason: reason.trim(), ...(purge ? { purge: true } : {}) };
}

// ── amenity catalogue ─────────────────────────────────────────────────────────────────────────
export function amenityNameError(name: string): string | null {
  const n = name.trim();
  if (n.length < AMENITY_NAME_MIN) return `Tên tiện ích tối thiểu ${AMENITY_NAME_MIN} ký tự.`;
  if (n.length > AMENITY_NAME_MAX) return `Tên tiện ích tối đa ${AMENITY_NAME_MAX} ký tự.`;
  return null;
}

export interface AmenityForm {
  name: string;
  category: AmenityCategory;
  iconKey: string;
  sortOrder: string;
}

/** Icon must be on the allowlist the server returned (falls back to the web's own table before the list loads). */
export function iconAllowed(key: string, serverKeys?: string[]): boolean {
  return serverKeys && serverKeys.length > 0 ? serverKeys.includes(key) : isKnownAmenityIcon(key);
}

export function amenityFormError(f: AmenityForm, serverIconKeys?: string[]): string | null {
  const nameErr = amenityNameError(f.name);
  if (nameErr) return nameErr;
  if (!iconAllowed(f.iconKey, serverIconKeys)) return "Hãy chọn biểu tượng trong danh sách.";
  if (f.sortOrder.trim()) {
    const n = Number(f.sortOrder);
    if (!Number.isInteger(n) || n < 0 || n > 100000) return "Thứ tự là số nguyên từ 0 đến 100000.";
  }
  return null;
}

/** Body of POST /admin/amenities. */
export function buildAmenityCreateBody(f: AmenityForm): Record<string, unknown> {
  return {
    name: f.name.trim(),
    category: f.category,
    iconKey: f.iconKey,
    ...(f.sortOrder.trim() ? { sortOrder: Number(f.sortOrder) } : {}),
  };
}

/** Body of PATCH /admin/amenities/:id — only the fields that differ (the server treats an unchanged resend as a no-op). */
export function buildAmenityPatchBody(before: Amenity, f: AmenityForm): Record<string, unknown> | null {
  const body: Record<string, unknown> = {};
  if (f.name.trim() !== before.name) body.name = f.name.trim();
  if (f.category !== before.category) body.category = f.category;
  if (f.iconKey !== before.iconKey) body.iconKey = f.iconKey;
  if (f.sortOrder.trim() && Number(f.sortOrder) !== before.sortOrder) body.sortOrder = Number(f.sortOrder);
  return Object.keys(body).length ? body : null;
}

export const amenityFormFrom = (a: Amenity): AmenityForm => ({
  name: a.name,
  category: a.category,
  iconKey: a.iconKey,
  sortOrder: String(a.sortOrder),
});

/** Catalogue grouped by category, each group sorted by sortOrder then name. */
export function groupAmenitiesByCategory(list: Amenity[], order: readonly AmenityCategory[]): Array<{ category: AmenityCategory; items: Amenity[] }> {
  return order
    .map((category) => ({
      category,
      items: list.filter((a) => a.category === category).sort((x, y) => x.sortOrder - y.sortOrder || x.name.localeCompare(y.name, "vi")),
    }))
    .filter((g) => g.items.length > 0);
}

// ── proposals ─────────────────────────────────────────────────────────────────────────────────
/** The category most owners suggested for a group (ties: first in the object). */
export function dominantCategory(group: Pick<AmenityProposalGroup, "suggestedCategories">): AmenityCategory | null {
  const entries = Object.entries(group.suggestedCategories ?? {});
  if (entries.length === 0) return null;
  return entries.sort((a, b) => b[1] - a[1])[0][0] as AmenityCategory;
}

/** "3 chủ gym cùng đề xuất" */
export const ownerCountLabel = (n: number): string => (n <= 1 ? "1 chủ gym đề xuất" : `${n} chủ gym cùng đề xuất`);

export interface ProposalApproveForm {
  category: AmenityCategory;
  iconKey: string;
  sortOrder: string;
}

/** Body of POST /admin/amenities/proposals/approve. REENABLE groups send ids only (they never create anything). */
export function buildProposalApproveBody(
  group: Pick<AmenityProposalGroup, "kind" | "proposalIds">,
  form: ProposalApproveForm,
  opts: { reenableAndMerge?: boolean } = {},
): Record<string, unknown> {
  const body: Record<string, unknown> = { proposalIds: group.proposalIds };
  if (group.kind === "NEW") {
    body.category = form.category;
    // empty = "mặc định theo nhóm": the server picks the category's default icon
    if (form.iconKey) body.iconKey = form.iconKey;
    if (form.sortOrder.trim()) body.sortOrder = Number(form.sortOrder);
  }
  if (opts.reenableAndMerge) body.reenableAndMerge = true;
  return body;
}

export const buildProposalRejectBody = (group: Pick<AmenityProposalGroup, "proposalIds">, reason: string) => ({
  proposalIds: group.proposalIds,
  reason: reason.trim(),
});

export const buildProposalMergeBody = (group: Pick<AmenityProposalGroup, "proposalIds">, targetAmenityId: string, opts: { reenableAndMerge?: boolean } = {}) => ({
  proposalIds: group.proposalIds,
  targetAmenityId,
  ...(opts.reenableAndMerge ? { reenableAndMerge: true } : {}),
});

/** What the admin is told after a proposal decision (the server's outcome → one sentence). */
export function proposalOutcomeMessage(outcome: string, amenityName?: string | null): string {
  if (outcome === "APPROVED") return amenityName ? `Đã thêm "${amenityName}" vào danh mục.` : "Đã duyệt đề xuất.";
  if (outcome === "MERGED") return amenityName ? `Đã gộp vào tiện ích có sẵn "${amenityName}".` : "Đã gộp đề xuất vào tiện ích có sẵn.";
  if (outcome === "REJECTED") return "Đã từ chối đề xuất.";
  return "Đã xử lý đề xuất.";
}

/** Merge targets: ACTIVE catalogue rows (a DISABLED one needs the explicit "bật lại và gộp"), excluding the proposal's own name. */
export function mergeTargets(catalogue: Amenity[]): Amenity[] {
  return [...catalogue].sort((a, b) => a.name.localeCompare(b.name, "vi"));
}
