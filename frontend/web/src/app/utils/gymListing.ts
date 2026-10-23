/**
 * Listing Management (Phase D2) — the pure half of the Gym Owner "Tin đăng & tiện ích" page, the add-branch wizard's
 * amenity step and the partner application's amenity step.
 *
 * Every shape here was read off gym-service (routes/owner-listing.routes.ts, services/gym-listing*.ts,
 * gym-amenity-catalog.service.ts, gym-amenity-selection.service.ts, partner-application.service.ts), not guessed:
 *  - `GET /owner/gyms/:id/listing` → { gym, listingVersion, listingPublishedAt, published:{payload,photos}, openRevision,
 *    photos, amenities, proposals, history, limits }.
 *  - the revision `payload` is the COMPLETE desired state { description, amenityIds, proposalIds, photoIds, coverPhotoId }.
 *    `PUT .../draft` replaces it wholesale and must carry `expectedDraftVersion` (409 DRAFT_STALE otherwise); `submit`
 *    carries it too (409 LISTING_STALE when the public listing moved after the draft began).
 *  - photos: at most 20 per branch, the cover is one of them; the 41st STAGED upload is refused (STAGED_LIMIT).
 *  - only an APPROVED / SUSPENDED branch (not permanently closed) has a listing to revise (409 LISTING_NOT_AVAILABLE /
 *    GYM_IS_DRAFT otherwise) — the branch picker says why before the server has to.
 *  - a revision needs >= 1 amenity or pending proposal at submit (422 AMENITIES_REQUIRED).
 *
 * The generic parts shared with the PT listing (photo ordering, draft sync, error unwrapping, status card) are IMPORTED
 * from ptListing.ts / listingErrors.ts, not copied. Same behaviour as the mobile screen
 * (frontend/mobile/src/features/gymListing/gymListing.ts).
 *
 * No React, no browser API: runs under `npx tsx --test`.
 */
import type { AmenityCategory, ListingPhoto, ListingHistoryItem, ListingSystemAdjustment } from "../types";
import type { GymListingPreviewDto } from "../services/ptListingApi";
import { AMENITY_CATEGORIES } from "./amenityIcons";
import { LISTING_ERROR_VI, listingErrorInfo, listingErrorMessage } from "./listingErrors";
import { listingStatusView, normalizeHistoryItem, normalizePhoto, type ListingStatusView } from "./ptListing";

export { addPhoto, movePhoto, photoRoom, removePhoto, setCover, copyableRejected, decideDraftSync, versionAfterPhotoDelete, PREVIEW_STALE_MS, photoFileError } from "./ptListing";
export { isDraftStale, isListingStale, needsReload, staleRevisionOf } from "./listingErrors";

// ── limits ────────────────────────────────────────────────────────────────────────────────────
export interface GymListingLimits {
  maxPhotos: number;
  maxStagedPhotos: number;
}
/** gym-listing.schemas.ts: MAX_GYM_PHOTOS / MAX_STAGED_PHOTOS. The server's `limits` answer overrides these. */
export const DEFAULT_GYM_LIMITS: GymListingLimits = { maxPhotos: 20, maxStagedPhotos: 40 };
/** The wizard's draft branch holds at most this many photos (gym-listing-upload.service.ts assertRoom). */
export const MAX_DRAFT_BRANCH_PHOTOS = 20;
/** gym-listing.schemas.ts MAX_DESCRIPTION_LENGTH (the limit the branch already had). */
export const DESCRIPTION_MAX = 300;
export const PROPOSAL_NAME_MIN = 2;
export const PROPOSAL_NAME_MAX = 40;
export const PROPOSAL_NOTE_MAX = 500;
export const MAX_INLINE_PROPOSALS = 10;

// ── wire shapes (normalized) ──────────────────────────────────────────────────────────────────
export interface GymPayload {
  description: string | null;
  amenityIds: string[];
  proposalIds: string[];
  photoIds: string[];
  coverPhotoId: string | null;
}

export type GymRevisionStatus = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN" | "CHANGES_REQUESTED" | "STALE";

export interface GymRevision {
  id: string;
  gymId: string;
  status: GymRevisionStatus;
  source: string;
  parentRevisionId: string | null;
  baseVersion: number;
  draftVersion: number;
  payload: GymPayload;
  systemAdjustments: ListingSystemAdjustment[];
  ownerNote: string | null;
  reviewNote: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** The public listing moved since this revision was started (server-computed). */
  stale: boolean;
}

export interface CatalogAmenity {
  id: string;
  slug: string;
  name: string;
  category: string;
  iconKey: string;
  sortOrder: number;
  /** ACTIVE | DISABLED. The catalogue answer only holds ACTIVE; the listing GET's `amenities` may carry DISABLED. */
  status: string;
  source: string;
}

export type ProposalStatus = "PENDING" | "APPROVED" | "REJECTED" | "MERGED" | "CANCELLED";
export interface OwnerProposal {
  id: string;
  gymId: string | null;
  kind: "NEW" | "REENABLE";
  targetAmenityId: string | null;
  name: string;
  suggestedCategory: AmenityCategory;
  note: string | null;
  status: ProposalStatus;
  resultingAmenityId: string | null;
  rejectReason: string | null;
  createdAt: string | null;
}

export interface GymSummary {
  id: string;
  name: string;
  status: string;
  operationalStatus: string;
}

export interface GymListingView {
  gym: GymSummary;
  listingVersion: number;
  listingPublishedAt: string | null;
  published: { payload: GymPayload; photos: ListingPhoto[] };
  openRevision: GymRevision | null;
  /** Every photo the owner can put in a revision (STAGED + PUBLISHED). */
  photos: ListingPhoto[];
  /** The amenities the payloads mention (any status) — so an id can be labelled, and a DISABLED one recognised. */
  amenities: CatalogAmenity[];
  /** The owner's PENDING proposals (of EVERY branch of theirs) plus those a payload mentions. Filter with `proposalsOfGym`. */
  proposals: OwnerProposal[];
  history: ListingHistoryItem[];
  limits: GymListingLimits;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()))] : [];
const int = (v: unknown, fallback = 0): number => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fallback);
const nonNull = <T>(x: T | null): x is T => x !== null;

export const isAmenityCategory = (v: unknown): v is AmenityCategory => (AMENITY_CATEGORIES as readonly unknown[]).includes(v);

export function normalizeGymPayload(raw: any): GymPayload {
  return {
    description: str(raw?.description),
    amenityIds: strList(raw?.amenityIds),
    proposalIds: strList(raw?.proposalIds),
    photoIds: strList(raw?.photoIds),
    coverPhotoId: typeof raw?.coverPhotoId === "string" && raw.coverPhotoId ? raw.coverPhotoId : null,
  };
}

export function normalizeGymRevision(raw: any): GymRevision | null {
  if (!raw || typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    gymId: String(raw.gymId ?? ""),
    status: raw.status,
    source: String(raw.source ?? "OWNER"),
    parentRevisionId: raw.parentRevisionId ?? null,
    baseVersion: int(raw.baseVersion),
    draftVersion: int(raw.draftVersion, 1),
    payload: normalizeGymPayload(raw.payload),
    systemAdjustments: Array.isArray(raw.systemAdjustments) ? raw.systemAdjustments.filter((a: any) => a && typeof a.type === "string") : [],
    ownerNote: str(raw.ownerNote),
    reviewNote: str(raw.reviewNote),
    submittedAt: raw.submittedAt ?? null,
    reviewedAt: raw.reviewedAt ?? null,
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
    stale: raw.stale === true,
  };
}

/** The revision a 409 DRAFT_STALE / LISTING_STALE carried (the server's CURRENT draft), if any. */
export const staleGymRevisionOf = (e: unknown): GymRevision | null => normalizeGymRevision(listingErrorInfo(e).body?.revision);

export function normalizeCatalogAmenity(raw: any): CatalogAmenity | null {
  if (!raw || typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  return {
    id: raw.id,
    slug: String(raw.slug ?? ""),
    name: raw.name,
    category: String(raw.category ?? ""),
    iconKey: String(raw.iconKey ?? ""),
    sortOrder: int(raw.sortOrder),
    status: String(raw.status ?? "ACTIVE"),
    source: String(raw.source ?? ""),
  };
}

export function normalizeProposal(raw: any): OwnerProposal | null {
  if (!raw || typeof raw.id !== "string" || typeof raw.name !== "string") return null;
  return {
    id: raw.id,
    gymId: typeof raw.gymId === "string" ? raw.gymId : null,
    kind: raw.kind === "REENABLE" ? "REENABLE" : "NEW",
    targetAmenityId: typeof raw.targetAmenityId === "string" ? raw.targetAmenityId : null,
    name: raw.name,
    suggestedCategory: isAmenityCategory(raw.suggestedCategory) ? raw.suggestedCategory : "FACILITY",
    note: str(raw.note),
    status: (typeof raw.status === "string" ? raw.status : "PENDING") as ProposalStatus,
    resultingAmenityId: typeof raw.resultingAmenityId === "string" ? raw.resultingAmenityId : null,
    rejectReason: str(raw.rejectReason),
    createdAt: raw.createdAt ?? null,
  };
}

export function normalizeGymLimits(raw: any): GymListingLimits {
  return {
    maxPhotos: int(raw?.maxPhotos, DEFAULT_GYM_LIMITS.maxPhotos) || DEFAULT_GYM_LIMITS.maxPhotos,
    maxStagedPhotos: int(raw?.maxStagedPhotos, DEFAULT_GYM_LIMITS.maxStagedPhotos) || DEFAULT_GYM_LIMITS.maxStagedPhotos,
  };
}

export function normalizeGymListing(raw: any): GymListingView {
  const published = raw?.published ?? {};
  return {
    gym: {
      id: String(raw?.gym?.id ?? ""),
      name: String(raw?.gym?.name ?? ""),
      status: String(raw?.gym?.status ?? ""),
      operationalStatus: String(raw?.gym?.operationalStatus ?? ""),
    },
    listingVersion: int(raw?.listingVersion),
    listingPublishedAt: raw?.listingPublishedAt ?? null,
    published: {
      payload: normalizeGymPayload(published.payload),
      photos: (Array.isArray(published.photos) ? published.photos : []).map(normalizePhoto).filter(nonNull),
    },
    openRevision: normalizeGymRevision(raw?.openRevision),
    photos: (Array.isArray(raw?.photos) ? raw.photos : []).map(normalizePhoto).filter(nonNull),
    amenities: (Array.isArray(raw?.amenities) ? raw.amenities : []).map(normalizeCatalogAmenity).filter(nonNull),
    proposals: (Array.isArray(raw?.proposals) ? raw.proposals : []).map(normalizeProposal).filter(nonNull),
    history: (Array.isArray(raw?.history) ? raw.history : []).filter((h: any) => h && typeof h.id === "string").map(normalizeHistoryItem),
    limits: normalizeGymLimits(raw?.limits),
  };
}

/** `GET /owner/amenities` → the ACTIVE catalogue and the owner's own proposals (every branch, every status, newest first). */
export function normalizeCatalog(raw: any): { amenities: CatalogAmenity[]; proposals: OwnerProposal[] } {
  return {
    amenities: (Array.isArray(raw?.amenities) ? raw.amenities : []).map(normalizeCatalogAmenity).filter(nonNull),
    proposals: (Array.isArray(raw?.proposals) ? raw.proposals : []).map(normalizeProposal).filter(nonNull),
  };
}

// ── which branches have a listing to edit ─────────────────────────────────────────────────────
export interface BranchAvailability {
  editable: boolean;
  reason: string | null;
}

/**
 * Mirror of gym-listing.helpers.ts#assertListingAvailable: only APPROVED and SUSPENDED branches (not permanently
 * closed) have a published listing to revise; the server answers 409 for anything else, so the picker says why first.
 */
export function branchAvailability(g: { status?: string | null; operationalStatus?: string | null }): BranchAvailability {
  if (g.operationalStatus === "PERMANENTLY_CLOSED") return { editable: false, reason: "Chi nhánh đã đóng cửa vĩnh viễn nên không sửa tin đăng được." };
  switch (g.status) {
    case "APPROVED":
    case "SUSPENDED":
      return { editable: true, reason: null };
    case "DRAFT":
      return { editable: false, reason: "Chi nhánh còn ở bước nháp. Hoàn tất và gửi duyệt chi nhánh trước." };
    case "PENDING_REVIEW":
      return { editable: false, reason: "Chi nhánh đang chờ Gymini duyệt lần đầu. Duyệt xong mới sửa được tin đăng." };
    case "REJECTED":
      return { editable: false, reason: "Chi nhánh bị từ chối nên chưa có tin đăng." };
    default:
      return { editable: false, reason: "Chi nhánh chưa ở trạng thái được sửa tin đăng." };
  }
}

/** The branch to open: ?gymId= when it is one of the owner's AND editable, else the first editable one, else null. */
export function pickInitialGymId<T extends { id: string; status?: string | null; operationalStatus?: string | null }>(gyms: T[], requested: string | null): string | null {
  const editable = gyms.filter((g) => branchAvailability(g).editable);
  if (requested && editable.some((g) => g.id === requested)) return requested;
  return editable[0]?.id ?? null;
}

// ── errors → Vietnamese ───────────────────────────────────────────────────────────────────────
export const GYM_LISTING_ERROR_VI: Record<string, string> = {
  PHOTO_LIMIT: `Tin đăng chỉ có tối đa ${DEFAULT_GYM_LIMITS.maxPhotos} ảnh. Hãy gỡ bớt một ảnh trước khi thêm.`,
  PHOTO_SET_MISMATCH: "Danh sách ảnh không khớp với ảnh hiện có. Hãy tải lại rồi thử lại.",
  GYM_NOT_FOUND: "Không tìm thấy chi nhánh này.",
  GYM_IS_DRAFT: "Chi nhánh còn ở bước nháp nên chưa có tin đăng để sửa.",
  GYM_NOT_DRAFT: "Chi nhánh đã gửi duyệt nên ảnh được sắp xếp trong bản sửa tin đăng.",
  LISTING_NOT_AVAILABLE: "Chi nhánh này hiện chưa có tin đăng để sửa (chưa được duyệt hoặc đã đóng cửa vĩnh viễn).",
  PARTNER_REQUIRED: "Chi nhánh này chưa gắn với hồ sơ đối tác nên chưa tải ảnh lên được.",
  UPLOAD_ROUTE_RETIRED: "Cách tải ảnh này không còn dùng nữa. Hãy tải lại trang để dùng bản mới.",
  AMENITIES_REQUIRED: "Hãy chọn ít nhất một tiện ích (hoặc gửi một đề xuất tiện ích) cho chi nhánh.",
  AMENITY_UNKNOWN: "Có tiện ích không còn trong danh mục. Hãy tải lại danh sách.",
  AMENITY_DISABLED: "Có tiện ích đã ngừng trong danh mục.",
  AMENITY_LIMIT: "Mỗi chi nhánh có tối đa 60 tiện ích.",
  PROPOSAL_NOT_OWNED: "Có đề xuất tiện ích không còn hiệu lực. Hãy tải lại bản nháp.",
  PROPOSAL_INVALID: "Có đề xuất tiện ích không còn hiệu lực. Hãy tải lại rồi chọn lại.",
  PROPOSAL_NOT_FOUND: "Không tìm thấy đề xuất này.",
  PROPOSAL_ALREADY_DECIDED: "Đề xuất này đã được Gymini xử lý nên không sửa hay huỷ được nữa.",
  PROPOSAL_IN_REVIEW: "Đề xuất đang nằm trong bản sửa chờ duyệt. Hãy rút lại bản sửa trước khi huỷ đề xuất.",
  PROPOSAL_NAME_TAKEN: "Chi nhánh này đã có một đề xuất khác với tên này.",
  AMENITY_ALREADY_EXISTS: "Tiện ích này đã có sẵn trong danh mục — hãy chọn nó thay vì đề xuất.",
  AMENITY_CONFLICT: "Chưa tạo được đề xuất. Vui lòng thử lại.",
  NAME_INVALID: "Tên tiện ích không hợp lệ.",
  LISTING_REVIEW_REQUIRED: "Giới thiệu, tiện ích và ảnh của chi nhánh đã duyệt chỉ sửa được ở mục “Tin đăng & tiện ích” rồi gửi duyệt.",
  BRANCH_REQUIRED: "Hãy hoàn thành bước Chi nhánh trước khi chọn tiện ích.",
};

/** Vietnamese sentence for any listing / amenity refusal. Gym codes first, then the shared handling (status codes, network). */
export function gymListingErrorMessage(error: unknown, fallback = "Có lỗi xảy ra. Vui lòng thử lại."): string {
  const code = listingErrorInfo(error).code;
  if (code && GYM_LISTING_ERROR_VI[code]) return GYM_LISTING_ERROR_VI[code];
  return listingErrorMessage(error, fallback);
}

export const errorCodeOf = (e: unknown): string | null => listingErrorInfo(e).code;
export const errorStatusOf = (e: unknown): number | null => listingErrorInfo(e).status;
/** 410 UPLOAD_ROUTE_RETIRED: the old disk-photo routes are gone. */
export const isUploadRouteRetired = (e: unknown) => errorStatusOf(e) === 410 || errorCodeOf(e) === "UPLOAD_ROUTE_RETIRED";
/** 422 AMENITIES_REQUIRED (listing submit, application submit / resubmit, new branch). */
export const isAmenitiesRequired = (e: unknown) => errorCodeOf(e) === "AMENITIES_REQUIRED";
/** AMENITY_DISABLED — 422 on save, 409 on submit (a rare race) — with the list of amenities that were switched off. */
export const isAmenityDisabled = (e: unknown) => errorCodeOf(e) === "AMENITY_DISABLED";
/** 404 on a branch / listing the owner can no longer reach. */
export const isGymGone = (e: unknown) => errorStatusOf(e) === 404;
/** The ids the server named in an AMENITY_DISABLED answer (`amenities: [{ id, name }]`, or `amenityIds` on the wizard route). */
export function disabledAmenitiesOf(e: unknown): { id: string; name: string }[] {
  const body = listingErrorInfo(e).body;
  const list = body?.amenities;
  if (Array.isArray(list)) {
    return list.filter((a: any) => a && typeof a.id === "string").map((a: any) => ({ id: a.id, name: String(a.name ?? "") }));
  }
  return Array.isArray(body?.amenityIds) ? body.amenityIds.filter((x: unknown) => typeof x === "string").map((id: string) => ({ id, name: "" })) : [];
}

// ── status card (the PT card + gym-specific notices) ──────────────────────────────────────────
/** One sentence per system adjustment the server made to the owner's draft (gym-listing.helpers.ts / apply / catalogue). */
export function gymAdjustmentNotice(a: ListingSystemAdjustment): string | null {
  const name = typeof a.name === "string" && a.name ? `"${a.name}"` : null;
  switch (a.type) {
    case "PHOTO_NO_LONGER_AVAILABLE":
      return "Một ảnh không còn dùng được nên đã được gỡ khỏi bản nháp.";
    case "REBASED_AFTER_ADMIN_EDIT":
      return "Quản trị viên vừa cập nhật tin đăng của chi nhánh. Nội dung bạn soạn đã được giữ lại — hãy xem lại rồi gửi duyệt lại.";
    case "AMENITY_NO_LONGER_AVAILABLE":
      return "Một tiện ích không còn trong danh mục nên đã được bỏ khỏi bản nháp.";
    case "PROPOSAL_RESOLVED":
      return name ? `Đề xuất ${name} đã được duyệt — tiện ích đã được thêm vào bản nháp.` : "Một đề xuất tiện ích đã được duyệt và thêm vào bản nháp.";
    case "PROPOSAL_NO_LONGER_AVAILABLE":
    case "PROPOSAL_REJECTED_REMOVED":
      return name ? `Đề xuất ${name} không còn hiệu lực nên đã được bỏ khỏi bản nháp.` : "Một đề xuất tiện ích không còn hiệu lực nên đã được bỏ khỏi bản nháp.";
    case "PROPOSAL_CANCELLED_REMOVED":
      return name ? `Đề xuất ${name} đã được huỷ nên đã bỏ khỏi bản nháp.` : "Một đề xuất tiện ích đã được huỷ nên đã bỏ khỏi bản nháp.";
    // AMENITY_DISABLED_REMOVED has its own block (with the "Đề xuất bật lại" button) — see disabledAmenityNotices.
    default:
      return null;
  }
}

export function gymListingStatusView(view: { openRevision: GymRevision | null; history: ListingHistoryItem[] }): ListingStatusView {
  const open = view.openRevision;
  // The PT card builds its notices from PT adjustments; hand it none and add the gym ones.
  const base = listingStatusView({
    openRevision: open ? ({ ...open, systemAdjustments: [] } as never) : null,
    history: view.history,
  });
  const notices = (open?.systemAdjustments ?? []).map(gymAdjustmentNotice).filter((n): n is string => !!n);
  return { ...base, notices };
}

// ── disabled amenities (plan §12.3) ───────────────────────────────────────────────────────────
export interface DisabledAmenityNotice {
  amenityId: string;
  name: string;
  category: AmenityCategory;
}

/**
 * Amenities switched off in the catalogue that the owner should be told about, each once:
 *  - removed from the draft by the server (`AMENITY_DISABLED_REMOVED` adjustments), and
 *  - amenities still on the published listing whose catalogue row is DISABLED (hidden from clients already).
 * `category` is the amenity's own (what a REENABLE proposal suggests); unknown → FACILITY.
 */
export function disabledAmenityNotices(view: Pick<GymListingView, "openRevision" | "amenities" | "published">): DisabledAmenityNotice[] {
  const byId = new Map(view.amenities.map((a) => [a.id, a]));
  const out = new Map<string, DisabledAmenityNotice>();
  const categoryOf = (id: string): AmenityCategory => {
    const c = byId.get(id)?.category;
    return isAmenityCategory(c) ? c : "FACILITY";
  };
  for (const a of view.openRevision?.systemAdjustments ?? []) {
    if (a.type !== "AMENITY_DISABLED_REMOVED" || typeof a.amenityId !== "string") continue;
    const name = (typeof a.name === "string" && a.name) || byId.get(a.amenityId)?.name || "";
    if (name) out.set(a.amenityId, { amenityId: a.amenityId, name, category: categoryOf(a.amenityId) });
  }
  for (const id of view.published.payload.amenityIds) {
    const a = byId.get(id);
    if (a && a.status !== "ACTIVE" && !out.has(id)) out.set(id, { amenityId: id, name: a.name, category: categoryOf(id) });
  }
  return [...out.values()];
}

/** A REENABLE proposal of this owner that is still waiting for Gymini, for a given disabled amenity. */
export function pendingReenableFor(proposals: OwnerProposal[], amenityId: string): OwnerProposal | null {
  return proposals.find((p) => p.kind === "REENABLE" && p.status === "PENDING" && p.targetAmenityId === amenityId) ?? null;
}

// ── proposals ─────────────────────────────────────────────────────────────────────────────────
/** The owner's proposals that belong to ONE branch (the listing GET and the catalogue answer span all their branches). */
export const proposalsOfGym = (proposals: OwnerProposal[], gymId: string): OwnerProposal[] => proposals.filter((p) => p.gymId === gymId);

/** Merge two proposal lists by id (the later list wins: the catalogue answer knows every status, the listing GET only PENDING ones). */
export function mergeProposals(...lists: OwnerProposal[][]): OwnerProposal[] {
  const byId = new Map<string, OwnerProposal>();
  for (const list of lists) for (const p of list) byId.set(p.id, p);
  return [...byId.values()];
}

export type ProposeOutcome =
  | { kind: "matched"; amenity: CatalogAmenity }
  | { kind: "proposal"; proposal: OwnerProposal; reenable: boolean; created: boolean };

/**
 * `POST /owner/amenities/proposals` answers (plan §12.3):
 *  - 200 { matchedAmenity }                      — the name is an ACTIVE catalogue amenity: nothing was created, select it;
 *  - 201 { proposal, kind: 'NEW', created }      — a new proposal;
 *  - 200 { proposal, kind: 'REENABLE', created } — the name is a DISABLED amenity: a request to switch it back on;
 *  - 200 { proposal, created: false }            — the owner's own PENDING proposal of that name, returned again (idempotent).
 */
export function interpretProposeResponse(raw: any): ProposeOutcome | null {
  const matched = normalizeCatalogAmenity(raw?.matchedAmenity);
  if (matched) return { kind: "matched", amenity: matched };
  const proposal = normalizeProposal(raw?.proposal);
  if (!proposal) return null;
  return { kind: "proposal", proposal, reenable: raw?.kind === "REENABLE" || proposal.kind === "REENABLE", created: raw?.created !== false };
}

/** What the owner is told after proposing. */
export function proposeOutcomeMessage(o: ProposeOutcome): string {
  if (o.kind === "matched") return `"${o.amenity.name}" đã có sẵn trong danh mục — đã chọn giúp bạn.`;
  if (!o.created) return `Bạn đã gửi đề xuất "${o.proposal.name}" rồi — đang chờ Gymini duyệt.`;
  if (o.reenable) return `"${o.proposal.name}" đang tạm ngưng trong danh mục — đã gửi yêu cầu Gymini bật lại.`;
  return `Đã gửi đề xuất "${o.proposal.name}" — Gymini sẽ duyệt và báo cho bạn.`;
}

/** Applies a propose answer to a selection: a matched amenity is selected, a proposal joins `proposalIds` (idempotent). */
export function applyProposeOutcome<S extends { amenityIds: string[]; proposalIds: string[] }>(sel: S, o: ProposeOutcome): S {
  if (o.kind === "matched") return sel.amenityIds.includes(o.amenity.id) ? sel : { ...sel, amenityIds: [...sel.amenityIds, o.amenity.id] };
  return sel.proposalIds.includes(o.proposal.id) ? sel : { ...sel, proposalIds: [...sel.proposalIds, o.proposal.id] };
}

/** Client-side check of the proposal form (mirror of proposalNameField / ownerProposalBodySchema). */
export function proposalFormError(f: { name: string; category: string | null; note?: string }): string | null {
  const name = f.name.trim();
  if (name.length < PROPOSAL_NAME_MIN) return `Tên tiện ích tối thiểu ${PROPOSAL_NAME_MIN} ký tự.`;
  if (name.length > PROPOSAL_NAME_MAX) return `Tên tiện ích tối đa ${PROPOSAL_NAME_MAX} ký tự.`;
  if (!f.category || !isAmenityCategory(f.category)) return "Chọn nhóm cho tiện ích.";
  if ((f.note ?? "").trim().length > PROPOSAL_NOTE_MAX) return `Ghi chú tối đa ${PROPOSAL_NOTE_MAX} ký tự.`;
  return null;
}

/**
 * The catalogue's own name normalization (amenity-catalog.ts#normalizeAmenityName): accents stripped (đ → d), lower-case,
 * whitespace collapsed. Used ONLY to tell the owner "that already exists" before sending; the server stays the judge.
 */
export function normalizeAmenityName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .replace(/[đĐ]/g, "d")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The ACTIVE catalogue amenity with this name (accent / case insensitive), or null. */
export function findCatalogMatch(catalog: CatalogAmenity[], name: string): CatalogAmenity | null {
  const n = normalizeAmenityName(name);
  if (!n) return null;
  return catalog.find((a) => a.status === "ACTIVE" && normalizeAmenityName(a.name) === n) ?? null;
}

// ── editable form ← → payload ─────────────────────────────────────────────────────────────────
export interface GymForm {
  description: string;
  amenityIds: string[];
  proposalIds: string[];
  photoIds: string[];
  coverPhotoId: string | null;
}

export function formFromGymPayload(p: GymPayload): GymForm {
  return {
    description: p.description ?? "",
    amenityIds: p.amenityIds,
    proposalIds: p.proposalIds,
    photoIds: p.photoIds,
    coverPhotoId: p.coverPhotoId,
  };
}

const unique = (list: string[]) => [...new Set(list.map((x) => x.trim()).filter(Boolean))];

/** The body of `PUT .../draft` (payload part). The same normalization the server applies, so it compares clean. */
export function buildGymDraftPayload(form: GymForm): GymPayload {
  const photoIds = [...new Set(form.photoIds)];
  const cover = photoIds.length === 0 ? null : form.coverPhotoId && photoIds.includes(form.coverPhotoId) ? form.coverPhotoId : photoIds[0];
  return {
    description: form.description.trim() ? form.description.trim() : null,
    amenityIds: unique(form.amenityIds),
    proposalIds: unique(form.proposalIds),
    photoIds,
    coverPhotoId: cover,
  };
}

/** A stable string for "did the owner change anything" (order of ids is part of the content for photos, not for amenities). */
export const gymPayloadSignature = (payload: GymPayload): string => JSON.stringify(buildGymDraftPayload(formFromGymPayload(payload)));
export const gymFormSignature = (form: GymForm): string => JSON.stringify(buildGymDraftPayload(form));

export const toggleId = (list: string[], id: string): string[] => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

/** Number of amenities (catalogue + pending proposals) the draft would publish — the server needs >= 1 to submit. */
export const amenityTotal = (form: Pick<GymForm, "amenityIds" | "proposalIds">): number => unique(form.amenityIds).length + unique(form.proposalIds).length;

export function gymPhotoLimitMessage(max: number): string {
  return `Tin đăng chỉ có tối đa ${max} ảnh. Hãy gỡ hoặc xóa bớt một ảnh trước khi thêm ảnh mới.`;
}

/** Whole-form validation (mirror of gymListingPayloadSchema + validateRefs). `forSubmit` adds the >= 1 amenity rule. */
export function validateGymForm(form: GymForm, limits: GymListingLimits = DEFAULT_GYM_LIMITS, forSubmit = false): string | null {
  if (form.description.trim().length > DESCRIPTION_MAX) return `Phần giới thiệu tối đa ${DESCRIPTION_MAX} ký tự.`;
  if (form.photoIds.length > limits.maxPhotos) return gymPhotoLimitMessage(limits.maxPhotos);
  if (forSubmit && amenityTotal(form) === 0) return GYM_LISTING_ERROR_VI.AMENITIES_REQUIRED;
  return null;
}

// ── amenity pool: what the chips can show ─────────────────────────────────────────────────────
/**
 * The amenities the editor can draw as chips: the ACTIVE catalogue, plus any amenity the payloads mention that the
 * catalogue answer does not hold (so a selected-but-switched-off one is still visible and can be unselected), plus
 * amenities picked up from a `matchedAmenity` answer. De-duplicated by id; the catalogue's order wins.
 */
export function amenityPool(catalog: CatalogAmenity[], extra: CatalogAmenity[]): CatalogAmenity[] {
  const seen = new Set<string>();
  const out: CatalogAmenity[] = [];
  for (const a of [...catalog, ...extra]) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

/** Chips shown as selectable: ACTIVE ones, plus a selected DISABLED one (flagged) so it can be removed. */
export function selectableAmenities(pool: CatalogAmenity[], selectedIds: string[]): CatalogAmenity[] {
  return pool.filter((a) => a.status === "ACTIVE" || selectedIds.includes(a.id));
}

export interface AmenityGroup<T extends { category: string }> {
  category: AmenityCategory;
  items: T[];
}

/** The four categories in their fixed order; an unknown category falls into FACILITY; empty groups are dropped. */
export function groupAmenitiesByCategory<T extends { category: string; sortOrder?: number; name: string }>(items: T[]): AmenityGroup<T>[] {
  const groups = new Map<AmenityCategory, T[]>(AMENITY_CATEGORIES.map((c) => [c, []]));
  for (const a of items) groups.get(isAmenityCategory(a.category) ? a.category : "FACILITY")!.push(a);
  return AMENITY_CATEGORIES.map((category) => ({
    category,
    items: [...groups.get(category)!].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, "vi")),
  })).filter((g) => g.items.length > 0);
}

// ── caches (uid-scoped, so an account switch never shows the previous owner's branch) ─────────
export const ownerGymsKey = (uid: string) => ["gym-listing-gyms", uid] as const;
export const gymListingKey = (uid: string, gymId: string) => ["gym-listing", uid, gymId] as const;
export const gymListingPreviewKey = (uid: string, gymId: string) => ["gym-listing-preview", uid, gymId] as const;
export const ownerAmenitiesKey = (uid: string) => ["owner-amenities", uid] as const;
export const applicationAmenityCatalogKey = (uid: string) => ["application-amenity-catalog", uid] as const;

/**
 * Every query that can show this branch's listing: the page's own, the branch screen and the branch list, and what
 * clients read (gym directory + detail). Public keys end in the gym id (or are list prefixes).
 */
export function gymListingInvalidationKeys(uid: string, gymId: string): (readonly unknown[])[] {
  return [
    gymListingKey(uid, gymId),
    gymListingPreviewKey(uid, gymId),
    ownerAmenitiesKey(uid),
    ["owned-gym", gymId],
    ["owned-gyms"],
    ["gym-photos", gymId],
    ["gyms"],
    ["gym", gymId],
  ];
}

// ── preview (GET .../listing/preview → ListingPreviewDto) ─────────────────────────────────────
export function normalizeGymPreview(raw: any): GymListingPreviewDto | null {
  if (!raw || raw.isPreview !== true) return null;
  return {
    isPreview: true,
    revisionStatus: String(raw.revisionStatus ?? ""),
    photoUrlsExpireAt: typeof raw.photoUrlsExpireAt === "string" ? raw.photoUrlsExpireAt : null,
    name: String(raw.name ?? "Phòng gym"),
    address: String(raw.address ?? ""),
    city: str(raw.city),
    description: str(raw.description),
    amenities: (Array.isArray(raw.amenities) ? raw.amenities : [])
      .filter((a: any) => a && typeof a.name === "string")
      .map((a: any) => ({ id: String(a.id ?? a.slug ?? a.name), name: a.name, iconKey: String(a.iconKey ?? ""), category: String(a.category ?? ""), disabled: a.disabled === true })),
    pendingAmenities: (Array.isArray(raw.pendingAmenities) ? raw.pendingAmenities : [])
      .filter((p: any) => p && typeof p.name === "string")
      .map((p: any) => ({ proposalId: String(p.proposalId ?? ""), name: p.name, suggestedCategory: String(p.suggestedCategory ?? ""), kind: String(p.kind ?? "NEW") })),
    photos: (Array.isArray(raw.photos) ? raw.photos : [])
      .filter((p: any) => p && typeof p.id === "string")
      .map((p: any) => ({ id: p.id, url: typeof p.url === "string" && p.url ? p.url : null, isCover: p.isCover === true, status: String(p.status ?? "") })),
    coverPhotoUrl: typeof raw.coverPhotoUrl === "string" ? raw.coverPhotoUrl : null,
  };
}

// ── a selection for a branch with no published listing (wizard, application) ───────────────────
export interface InlineProposalInput {
  name: string;
  suggestedCategory: AmenityCategory;
  note?: string;
}
export interface AmenitySelection {
  amenityIds: string[];
  /** New proposals sent inline with the save (used where `/owner/amenities` is not reachable yet: the application). */
  proposals: InlineProposalInput[];
  /** Own PENDING proposals the server already holds for the branch, to keep (every other PENDING one is cancelled). */
  proposalIds?: string[];
}

/** A new client must send at least one amenity or proposal (422 AMENITIES_REQUIRED otherwise); say so before the round trip. */
export function amenitySelectionError(sel: AmenitySelection): string | null {
  return sel.amenityIds.length + sel.proposals.length + (sel.proposalIds?.length ?? 0) > 0 ? null : "Chọn ít nhất một tiện ích (hoặc gửi một đề xuất) cho chi nhánh.";
}

/**
 * The amenity part of the body of PUT /owner/application/amenities and PATCH /owner/gyms/:id/draft. Empty lists are still
 * sent: `amenityIds` replaces the branch's amenities, `proposalIds` replaces which of its own proposals stay.
 */
export function amenitySelectionPayload(sel: AmenitySelection) {
  return {
    amenityIds: [...new Set(sel.amenityIds)],
    ...(sel.proposals.length
      ? { proposals: sel.proposals.map((p) => ({ name: p.name.trim(), suggestedCategory: p.suggestedCategory, ...(p.note?.trim() ? { note: p.note.trim() } : {}) })) }
      : {}),
    ...(sel.proposalIds !== undefined ? { proposalIds: [...new Set(sel.proposalIds)] } : {}),
  };
}

/** Adds an inline proposal unless an ACTIVE catalogue amenity or an earlier proposal already has that name (select / explain instead). */
export type AddInlineResult =
  | { outcome: "matched"; amenity: CatalogAmenity }
  | { outcome: "duplicate" }
  | { outcome: "added"; proposals: InlineProposalInput[] };

export function addInlineProposal(
  catalog: CatalogAmenity[],
  proposals: InlineProposalInput[],
  existingPending: Array<{ name: string }>,
  input: InlineProposalInput,
): AddInlineResult {
  const match = findCatalogMatch(catalog, input.name);
  if (match) return { outcome: "matched", amenity: match };
  const n = normalizeAmenityName(input.name);
  if (proposals.some((p) => normalizeAmenityName(p.name) === n) || existingPending.some((p) => normalizeAmenityName(p.name) === n)) return { outcome: "duplicate" };
  if (proposals.length + existingPending.length >= MAX_INLINE_PROPOSALS) return { outcome: "duplicate" };
  return { outcome: "added", proposals: [...proposals, { name: input.name.trim(), suggestedCategory: input.suggestedCategory, ...(input.note?.trim() ? { note: input.note.trim() } : {}) }] };
}

/**
 * What `GET /owner/gyms/:id` says about a branch's amenity choice (OWNER only): `amenities` = the amenity DTOs of its
 * gym_amenities rows (custom ones included) and `amenityProposals` = the owner's PENDING proposals for it. Anything else is empty.
 */
export function normalizeBranchSelection(raw: any): { amenities: CatalogAmenity[]; proposals: OwnerProposal[] } {
  return {
    amenities: (Array.isArray(raw?.amenities) ? raw.amenities : []).map(normalizeCatalogAmenity).filter(nonNull),
    proposals: (Array.isArray(raw?.amenityProposals) ? raw.amenityProposals : []).map(normalizeProposal).filter(nonNull),
  };
}

/**
 * The add-branch wizard's starting selection, read back from the branch itself. Only ACTIVE amenities are selected (the server
 * refuses a DISABLED one with 422 AMENITY_DISABLED on the next save) and only PENDING proposals stay attached.
 */
export function initialDraftSelection(raw: any): { amenityIds: string[]; proposalIds: string[] } {
  const { amenities, proposals } = normalizeBranchSelection(raw);
  return {
    amenityIds: [...new Set(amenities.filter((a) => a.status === "ACTIVE").map((a) => a.id))],
    proposalIds: [...new Set(proposals.filter((p) => p.status === "PENDING").map((p) => p.id))],
  };
}
