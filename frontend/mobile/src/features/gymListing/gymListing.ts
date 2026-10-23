/**
 * Listing Management (Phase M2) — the pure half of the Gym Owner "Tin đăng & tiện ích" screen.
 *
 * Every shape here was read off gym-service (routes/owner-listing.routes.ts, services/gym-listing*.ts,
 * gym-amenity-catalog.service.ts), not guessed:
 *  - `GET /owner/gyms/:id/listing` → { gym, listingVersion, listingPublishedAt, published:{payload,photos},
 *    openRevision, photos, amenities, proposals, history, limits }.
 *  - the revision `payload` is the COMPLETE desired state: { description, amenityIds, proposalIds, photoIds,
 *    coverPhotoId }. `PUT .../draft` replaces it wholesale and must carry `expectedDraftVersion` (409 DRAFT_STALE
 *    otherwise); `submit` carries it too (409 LISTING_STALE when the public listing moved after the draft began).
 *  - photos: at most 20 per branch, the cover is one of them; the 41st STAGED upload is refused (STAGED_LIMIT).
 *  - a branch only has a listing to revise when it is APPROVED or SUSPENDED (and not permanently closed) — any
 *    other status answers 409 LISTING_NOT_AVAILABLE / GYM_IS_DRAFT, so the picker never offers it.
 *  - a revision needs at least one amenity or pending proposal at submit (422 AMENITIES_REQUIRED).
 *  - every refusal is `{ success:false, error:{ code, message }, message, ...extra }`; the 409 stale answers also
 *    carry the current `revision` so the screen can offer "reload".
 *
 * The state machine and every limit live on the server; this file only mirrors them. The generic parts that are
 * identical to the PT listing (photo ordering, error unwrapping, draft sync, the status card) are IMPORTED from
 * ptListing.ts, not copied.
 *
 * No React, no Expo import: runs under `tsx --test`.
 */
import {
  COPY_FROM_CLOSED_DAYS,
  LISTING_ERROR_VI as PT_LISTING_ERROR_VI,
  addPhoto,
  listingErrorInfo,
  listingErrorMessage as ptListingErrorMessage,
  listingStatusView,
  movePhoto,
  photoRoom,
  removePhoto,
  setCover,
  type HistoryItem,
  type ListingStatusView,
  type StatusTone,
} from "../ptListing/ptListing";
import { AMENITY_CATEGORIES, isAmenityCategory, type AmenityCategory } from "./amenityIcons";

export { addPhoto, movePhoto, photoRoom, removePhoto, setCover, listingErrorInfo };
export {
  COPY_FROM_CLOSED_DAYS,
  MAX_PHOTO_BYTES,
  PREVIEW_STALE_MS,
  copyableRejected,
  decideDraftSync,
  isDraftStale,
  isListingStale,
  needsReload,
  versionAfterPhotoDelete,
  type DraftSyncAction,
  type DraftSyncState,
  type HistoryItem,
  type ListingStatusView,
  type StatusTone,
} from "../ptListing/ptListing";

// ── limits ────────────────────────────────────────────────────────────────────────────────────
export type GymListingLimits = { maxPhotos: number; maxStagedPhotos: number };
/** gym-listing.schemas.ts: MAX_GYM_PHOTOS / MAX_STAGED_PHOTOS. The server's `limits` answer overrides these. */
export const DEFAULT_GYM_LIMITS: GymListingLimits = { maxPhotos: 20, maxStagedPhotos: 40 };
/** gym-listing.schemas.ts MAX_DESCRIPTION_LENGTH (the limit the branch already had). */
export const DESCRIPTION_MAX = 300;
export const PROPOSAL_NAME_MIN = 2;
export const PROPOSAL_NAME_MAX = 40;
export const PROPOSAL_NOTE_MAX = 500;

// ── wire shapes (normalized) ──────────────────────────────────────────────────────────────────
export type GymPayload = {
  description: string | null;
  amenityIds: string[];
  proposalIds: string[];
  photoIds: string[];
  coverPhotoId: string | null;
};

export type GymListingStatus = "DRAFT" | "PENDING" | "APPROVED" | "REJECTED" | "WITHDRAWN" | "CHANGES_REQUESTED" | "STALE";

export type SystemAdjustment = { type: string; [key: string]: unknown };

export type GymRevision = {
  id: string;
  gymId: string;
  status: GymListingStatus;
  source: string;
  parentRevisionId: string | null;
  baseVersion: number;
  draftVersion: number;
  payload: GymPayload;
  systemAdjustments: SystemAdjustment[];
  ownerNote: string | null;
  reviewNote: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** The public listing moved since this revision was started (server-computed). */
  stale: boolean;
};

export type Amenity = {
  id: string;
  slug: string;
  name: string;
  category: string;
  iconKey: string;
  sortOrder: number;
  /** ACTIVE | DISABLED. The catalogue answer only holds ACTIVE; `refs` (listing GET) may carry DISABLED. */
  status: string;
  source: string;
};

export type ProposalStatus = "PENDING" | "APPROVED" | "REJECTED" | "MERGED" | "CANCELLED";
export type Proposal = {
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
};

/** A photo as the owner sees it. `url` is null when the server could not link it (a STAGED file it failed to presign). */
export type GymPhotoView = {
  id: string;
  /** PUBLISHED = shown to clients now; STAGED = uploaded, not public, URL expires. */
  status: "STAGED" | "PUBLISHED" | string;
  url: string | null;
  expiresAt: string | null;
  isCover: boolean;
  sortOrder: number;
};

export type GymSummary = { id: string; name: string; status: string; operationalStatus: string };

export type GymListingView = {
  gym: GymSummary;
  listingVersion: number;
  listingPublishedAt: string | null;
  published: { payload: GymPayload; photos: GymPhotoView[] };
  openRevision: GymRevision | null;
  /** Every photo the owner can put in a revision (STAGED + PUBLISHED). */
  photos: GymPhotoView[];
  /** The amenities the payloads mention (any status) — so an id can be labelled, and a DISABLED one recognised. */
  amenities: Amenity[];
  /** The owner's PENDING proposals (of EVERY branch of theirs) plus those a payload mentions. Filter with `proposalsOfGym`. */
  proposals: Proposal[];
  history: HistoryItem[];
  limits: GymListingLimits;
};

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()))] : [];
const int = (v: unknown, fallback = 0): number => (Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : fallback);

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

/** A revision as the 200/201 bodies (`{ revision }`) and the 409 bodies carry it. */
export const gymRevisionFromResponse = (body: any): GymRevision | null => normalizeGymRevision(body?.revision);

/** The revision a 409 DRAFT_STALE / LISTING_STALE carried (the server's CURRENT draft), if any. */
export const staleGymRevisionOf = (e: unknown): GymRevision | null => normalizeGymRevision(listingErrorInfo(e).body?.revision);

export function normalizeGymPhoto(raw: any): GymPhotoView | null {
  if (!raw || typeof raw.id !== "string") return null;
  return {
    id: raw.id,
    status: String(raw.status ?? "PUBLISHED"),
    url: typeof raw.url === "string" && raw.url ? raw.url : null,
    expiresAt: raw.expiresAt ?? null,
    isCover: raw.isCover === true,
    sortOrder: int(raw.sortOrder),
  };
}

export function normalizeAmenity(raw: any): Amenity | null {
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

export function normalizeProposal(raw: any): Proposal | null {
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

export function normalizeLimits(raw: any): GymListingLimits {
  return {
    maxPhotos: int(raw?.maxPhotos, DEFAULT_GYM_LIMITS.maxPhotos) || DEFAULT_GYM_LIMITS.maxPhotos,
    maxStagedPhotos: int(raw?.maxStagedPhotos, DEFAULT_GYM_LIMITS.maxStagedPhotos) || DEFAULT_GYM_LIMITS.maxStagedPhotos,
  };
}

const nonNull = <T,>(x: T | null): x is T => x !== null;

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
      photos: (Array.isArray(published.photos) ? published.photos : []).map(normalizeGymPhoto).filter(nonNull),
    },
    openRevision: normalizeGymRevision(raw?.openRevision),
    photos: (Array.isArray(raw?.photos) ? raw.photos : []).map(normalizeGymPhoto).filter(nonNull),
    amenities: (Array.isArray(raw?.amenities) ? raw.amenities : []).map(normalizeAmenity).filter(nonNull),
    proposals: (Array.isArray(raw?.proposals) ? raw.proposals : []).map(normalizeProposal).filter(nonNull),
    history: (Array.isArray(raw?.history) ? raw.history : [])
      .filter((h: any) => h && typeof h.id === "string")
      .map((h: any) => ({
        id: h.id,
        status: h.status,
        parentRevisionId: h.parentRevisionId ?? null,
        reviewNote: str(h.reviewNote),
        submittedAt: h.submittedAt ?? null,
        reviewedAt: h.reviewedAt ?? null,
        closedAt: h.closedAt ?? null,
        createdAt: h.createdAt ?? null,
      })),
    limits: normalizeLimits(raw?.limits),
  };
}

/** `GET /owner/amenities` → the ACTIVE catalogue and the owner's own proposals (every branch, every status, newest first). */
export function normalizeCatalog(raw: any): { amenities: Amenity[]; proposals: Proposal[] } {
  return {
    amenities: (Array.isArray(raw?.amenities) ? raw.amenities : []).map(normalizeAmenity).filter(nonNull),
    proposals: (Array.isArray(raw?.proposals) ? raw.proposals : []).map(normalizeProposal).filter(nonNull),
  };
}

// ── which branches have a listing to edit ─────────────────────────────────────────────────────
export type BranchAvailability = { editable: boolean; reason: string | null };

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

// ── errors → Vietnamese ───────────────────────────────────────────────────────────────────────
const SHARED_FROM_PT = [
  "VALIDATION_FAILED",
  "OPEN_REVISION_EXISTS",
  "REVISION_CLOSED",
  "REVISION_UNDER_REVIEW",
  "REVISION_NOT_PENDING",
  "REVISION_CONFLICT",
  "REVISION_NOT_FOUND",
  "REVISION_NOT_CLOSED",
  "REVISION_TOO_OLD_TO_COPY",
  "NO_OPEN_REVISION",
  "NO_CHANGES",
  "DRAFT_STALE",
  "LISTING_STALE",
  "PHOTO_DUPLICATE",
  "PHOTO_NOT_OWNED",
  "PHOTO_NOT_FOUND",
  "PHOTO_PUBLISHED",
  "PHOTO_IN_REVIEW",
  "COVER_NOT_IN_PHOTOS",
  "UPLOADS_UNAVAILABLE",
  "STAGED_LIMIT",
  "TOO_MANY_UPLOADS",
  "UPLOAD_NOT_FOUND",
  "INTENT_EXPIRED",
  "INTENT_ALREADY_USED",
  "UPLOAD_CONFLICT",
  "IMAGE_MISSING",
  "IMAGE_TOO_LARGE",
  "IMAGE_INVALID",
  "LISTING_REVIEW_REQUIRED",
] as const;

export const GYM_LISTING_ERROR_VI: Record<string, string> = {
  ...Object.fromEntries(SHARED_FROM_PT.map((k) => [k, PT_LISTING_ERROR_VI[k]])),
  PHOTO_LIMIT: `Tin đăng chỉ có tối đa ${DEFAULT_GYM_LIMITS.maxPhotos} ảnh. Hãy gỡ bớt một ảnh trước khi thêm.`,
  PHOTO_SET_MISMATCH: "Danh sách ảnh không khớp với ảnh hiện có. Hãy tải lại rồi thử lại.",
  GYM_NOT_FOUND: "Không tìm thấy chi nhánh này.",
  GYM_IS_DRAFT: "Chi nhánh còn ở bước nháp nên chưa có tin đăng để sửa.",
  GYM_NOT_DRAFT: "Chi nhánh đã gửi duyệt nên ảnh được sắp xếp trong bản sửa tin đăng.",
  LISTING_NOT_AVAILABLE: "Chi nhánh này hiện chưa có tin đăng để sửa (chưa được duyệt hoặc đã đóng cửa vĩnh viễn).",
  PARTNER_REQUIRED: "Chi nhánh này chưa gắn với hồ sơ đối tác nên chưa tải ảnh lên được.",
  UPLOAD_ROUTE_RETIRED: "Cách tải ảnh này không còn dùng nữa. Hãy cập nhật ứng dụng.",
  AMENITIES_REQUIRED: "Hãy chọn ít nhất một tiện ích (hoặc gửi một đề xuất tiện ích) cho chi nhánh.",
  AMENITY_UNKNOWN: "Có tiện ích không còn trong danh mục. Hãy tải lại danh sách.",
  AMENITY_DISABLED: "Có tiện ích đã ngừng trong danh mục.",
  AMENITY_LIMIT: "Mỗi chi nhánh có tối đa 60 tiện ích.",
  PROPOSAL_NOT_OWNED: "Có đề xuất tiện ích không còn hiệu lực. Hãy tải lại bản nháp.",
  PROPOSAL_INVALID: "Có đề xuất tiện ích không còn hiệu lực.",
  PROPOSAL_NOT_FOUND: "Không tìm thấy đề xuất này.",
  PROPOSAL_ALREADY_DECIDED: "Đề xuất này đã được Gymini xử lý nên không sửa hay huỷ được nữa.",
  PROPOSAL_IN_REVIEW: "Đề xuất đang nằm trong bản sửa chờ duyệt. Hãy rút lại bản sửa trước khi huỷ đề xuất.",
  PROPOSAL_NAME_TAKEN: "Chi nhánh này đã có một đề xuất khác với tên này.",
  AMENITY_ALREADY_EXISTS: "Tiện ích này đã có trong danh mục.",
  AMENITY_CONFLICT: "Chưa tạo được đề xuất. Vui lòng thử lại.",
  NAME_INVALID: "Tên tiện ích không hợp lệ.",
};

/** Vietnamese sentence for any listing / amenity refusal. Gym codes first, then the PT-shared handling (status codes, network). */
export function gymListingErrorMessage(error: unknown, fallback = "Có lỗi xảy ra. Vui lòng thử lại."): string {
  const code = listingErrorInfo(error).code;
  if (code && GYM_LISTING_ERROR_VI[code]) return GYM_LISTING_ERROR_VI[code];
  return ptListingErrorMessage(error, fallback);
}

export const errorCodeOf = (e: unknown): string | null => listingErrorInfo(e).code;
export const errorStatusOf = (e: unknown): number | null => listingErrorInfo(e).status;
/** 409 LISTING_REVIEW_REQUIRED: a legacy edit route refused a change that now goes through a revision. */
export const isReviewRequired = (e: unknown) => errorCodeOf(e) === "LISTING_REVIEW_REQUIRED";
/** 410 UPLOAD_ROUTE_RETIRED: the old disk-photo routes are gone. */
export const isUploadRouteRetired = (e: unknown) => errorStatusOf(e) === 410 || errorCodeOf(e) === "UPLOAD_ROUTE_RETIRED";
/** 422 AMENITIES_REQUIRED. */
export const isAmenitiesRequired = (e: unknown) => errorCodeOf(e) === "AMENITIES_REQUIRED";
/** AMENITY_DISABLED — 422 on save, 409 on submit (a rare race) — with the list of amenities that were switched off. */
export const isAmenityDisabled = (e: unknown) => errorCodeOf(e) === "AMENITY_DISABLED";
/** The ids the server named in an AMENITY_DISABLED answer (`amenities: [{ id, name }]`). */
export function disabledAmenitiesOf(e: unknown): { id: string; name: string }[] {
  const list = listingErrorInfo(e).body?.amenities;
  return Array.isArray(list)
    ? list.filter((a: any) => a && typeof a.id === "string").map((a: any) => ({ id: a.id, name: String(a.name ?? "") }))
    : [];
}

// ── status card (the PT card + gym-specific notices) ──────────────────────────────────────────
/** One sentence per system adjustment the server made to the owner's draft (gym-listing.helpers.ts / apply / catalogue). */
export function gymAdjustmentNotice(a: SystemAdjustment): string | null {
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

export function gymListingStatusView(view: Pick<GymListingView, "openRevision" | "history">): ListingStatusView {
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
export type DisabledAmenityNotice = { amenityId: string; name: string; category: AmenityCategory };

/**
 * Amenities switched off in the catalogue that the owner should be told about, each once:
 *  - removed from the draft by the server (`AMENITY_DISABLED_REMOVED` adjustments), and
 *  - amenities still on the published listing whose catalogue row is DISABLED (hidden from clients already).
 * `category` is the amenity's own (what a REENABLE proposal suggests); unknown → FACILITY.
 */
export function disabledAmenityNotices(view: Pick<GymListingView, "openRevision" | "amenities" | "published">): DisabledAmenityNotice[] {
  const byId = new Map(view.amenities.map((a) => [a.id, a]));
  const out = new Map<string, DisabledAmenityNotice>();
  const categoryOf = (id: string): AmenityCategory => (isAmenityCategory(byId.get(id)?.category) ? (byId.get(id)!.category as AmenityCategory) : "FACILITY");
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

/** A REENABLE proposal of this branch that is still waiting for Gymini, for a given disabled amenity. */
export function pendingReenableFor(proposals: Proposal[], amenityId: string): Proposal | null {
  return proposals.find((p) => p.kind === "REENABLE" && p.status === "PENDING" && p.targetAmenityId === amenityId) ?? null;
}

// ── proposals ─────────────────────────────────────────────────────────────────────────────────
/** The owner's proposals that belong to ONE branch (the listing GET and the catalogue answer span all their branches). */
export const proposalsOfGym = (proposals: Proposal[], gymId: string): Proposal[] => proposals.filter((p) => p.gymId === gymId);

export type ProposeOutcome =
  | { kind: "matched"; amenity: Amenity }
  | { kind: "proposal"; proposal: Proposal; reenable: boolean; created: boolean };

/**
 * `POST /owner/amenities/proposals` answers (plan §12.3):
 *  - 200 { matchedAmenity }                     — the name is an ACTIVE catalogue amenity: nothing was created, select it;
 *  - 201 { proposal, kind: 'NEW', created }     — a new proposal;
 *  - 200 { proposal, kind: 'REENABLE', created }— the name is a DISABLED amenity: a request to switch it back on;
 *  - 200 { proposal, created: false }           — the owner's own PENDING proposal of that name, returned again (idempotent).
 */
export function interpretProposeResponse(raw: any): ProposeOutcome | null {
  const matched = normalizeAmenity(raw?.matchedAmenity);
  if (matched) return { kind: "matched", amenity: matched };
  const proposal = normalizeProposal(raw?.proposal);
  if (!proposal) return null;
  return { kind: "proposal", proposal, reenable: raw?.kind === "REENABLE" || proposal.kind === "REENABLE", created: raw?.created !== false };
}

/** What the owner is told after proposing. */
export function proposeOutcomeMessage(o: ProposeOutcome): string {
  if (o.kind === "matched") return `"${o.amenity.name}" đã có sẵn trong danh mục — mình đã chọn giúp bạn.`;
  if (!o.created) return `Bạn đã gửi đề xuất "${o.proposal.name}" rồi — đang chờ Gymini duyệt.`;
  if (o.reenable) return `"${o.proposal.name}" đang tạm ngưng trong danh mục — đã gửi yêu cầu Gymini bật lại.`;
  return `Đã gửi đề xuất "${o.proposal.name}" — Gymini sẽ duyệt và báo cho bạn.`;
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
export function findCatalogMatch(catalog: Amenity[], name: string): Amenity | null {
  const n = normalizeAmenityName(name);
  if (!n) return null;
  return catalog.find((a) => a.status === "ACTIVE" && normalizeAmenityName(a.name) === n) ?? null;
}

// ── editable form ← → payload ─────────────────────────────────────────────────────────────────
export type GymForm = {
  description: string;
  amenityIds: string[];
  proposalIds: string[];
  photoIds: string[];
  coverPhotoId: string | null;
};

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
export function gymPayloadSignature(payload: GymPayload): string {
  return JSON.stringify(buildGymDraftPayload(formFromGymPayload(payload)));
}
export const gymFormSignature = (form: GymForm): string => JSON.stringify(buildGymDraftPayload(form));

export const toggleId = (list: string[], id: string): string[] => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

/** Number of amenities (catalogue + pending proposals) the draft would publish — the server needs >= 1 to submit. */
export const amenityTotal = (form: Pick<GymForm, "amenityIds" | "proposalIds">): number => unique(form.amenityIds).length + unique(form.proposalIds).length;

export function photoLimitMessage(max: number): string {
  return `Tin đăng chỉ có tối đa ${max} ảnh. Hãy gỡ hoặc xóa bớt một ảnh trước khi thêm ảnh mới.`;
}

/** Whole-form validation (mirror of gymListingPayloadSchema + validateRefs). `forSubmit` adds the >= 1 amenity rule. */
export function validateGymForm(form: GymForm, limits: GymListingLimits = DEFAULT_GYM_LIMITS, forSubmit = false): string | null {
  if (form.description.trim().length > DESCRIPTION_MAX) return `Phần giới thiệu tối đa ${DESCRIPTION_MAX} ký tự.`;
  if (form.photoIds.length > limits.maxPhotos) return photoLimitMessage(limits.maxPhotos);
  if (forSubmit && amenityTotal(form) === 0) return GYM_LISTING_ERROR_VI.AMENITIES_REQUIRED;
  return null;
}

// ── amenity pool: what the chips can show ─────────────────────────────────────────────────────
/**
 * The amenities the editor can draw as chips: the ACTIVE catalogue, plus any amenity the payloads mention that the
 * catalogue answer does not hold (so a selected-but-switched-off one is still visible and can be unselected), plus
 * amenities picked up from a `matchedAmenity` answer. De-duplicated by id; the catalogue's order wins.
 */
export function amenityPool(catalog: Amenity[], extra: Amenity[]): Amenity[] {
  const seen = new Set<string>();
  const out: Amenity[] = [];
  for (const a of [...catalog, ...extra]) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
}

/** Chips shown as selectable: ACTIVE ones, plus a selected DISABLED one (flagged) so it can be removed. */
export function selectableAmenities(pool: Amenity[], selectedIds: string[]): Amenity[] {
  return pool.filter((a) => a.status === "ACTIVE" || selectedIds.includes(a.id));
}

// ── caches (uid-scoped, so an account switch never shows the previous owner's branch) ─────────
export const gymListingKey = (uid: string, gymId: string) => ["gym-listing", uid, gymId] as const;
export const gymListingPreviewKey = (uid: string, gymId: string) => ["gym-listing-preview", uid, gymId] as const;
/** The application wizard's read of the catalogue (under the application key, so refreshing the application refreshes it too). */
export const applicationAmenityCatalogKey = (uid: string) => ["partner-application", uid, "catalog"] as const;
export const ownerAmenitiesKey = (uid: string) => ["owner-amenities", uid] as const;

/**
 * Every query that can show this branch's listing: the screen's own, the branch screen and the branch list, and what
 * clients read (gym directory + detail). Public keys end in the gym id (or are list prefixes).
 */
export function gymListingInvalidationKeys(uid: string, gymId: string): (readonly unknown[])[] {
  return [
    gymListingKey(uid, gymId),
    gymListingPreviewKey(uid, gymId),
    ownerAmenitiesKey(uid),
    ["owned-gym", uid, gymId],
    ["owned-gyms", uid],
    ["owned-gym-photos", uid, gymId],
    ["gyms"],
    ["gym", gymId],
  ];
}

// ── preview (GET .../listing/preview → ListingPreviewDto) ─────────────────────────────────────
export type GymPreviewView = {
  revisionStatus: string;
  name: string;
  address: string;
  city: string | null;
  description: string | null;
  amenities: { id: string; name: string; category: string; iconKey: string; disabled: boolean }[];
  pendingAmenities: { proposalId: string; name: string; suggestedCategory: string; kind: string }[];
  photos: { id: string; url: string | null; isCover: boolean }[];
  coverPhotoUrl: string | null;
  photoUrlsExpireAt: string | null;
};

export function normalizeGymPreview(raw: any): GymPreviewView | null {
  if (!raw || raw.isPreview !== true) return null;
  return {
    revisionStatus: String(raw.revisionStatus ?? ""),
    name: String(raw.name ?? "Phòng gym"),
    address: String(raw.address ?? ""),
    city: str(raw.city),
    description: str(raw.description),
    amenities: (Array.isArray(raw.amenities) ? raw.amenities : [])
      .filter((a: any) => a && typeof a.name === "string")
      .map((a: any) => ({ id: String(a.id ?? a.slug ?? a.name), name: a.name, category: String(a.category ?? ""), iconKey: String(a.iconKey ?? ""), disabled: a.disabled === true })),
    pendingAmenities: (Array.isArray(raw.pendingAmenities) ? raw.pendingAmenities : [])
      .filter((p: any) => p && typeof p.name === "string")
      .map((p: any) => ({ proposalId: String(p.proposalId ?? ""), name: p.name, suggestedCategory: String(p.suggestedCategory ?? ""), kind: String(p.kind ?? "NEW") })),
    photos: (Array.isArray(raw.photos) ? raw.photos : [])
      .filter((p: any) => p && typeof p.id === "string")
      .map((p: any) => ({ id: p.id, url: typeof p.url === "string" && p.url ? p.url : null, isCover: p.isCover === true })),
    coverPhotoUrl: typeof raw.coverPhotoUrl === "string" ? raw.coverPhotoUrl : null,
    photoUrlsExpireAt: typeof raw.photoUrlsExpireAt === "string" ? raw.photoUrlsExpireAt : null,
  };
}

// ── a selection for a branch with no published listing (quick create, application wizard) ───────
export type InlineProposalInput = { name: string; suggestedCategory: AmenityCategory; note?: string };
export type AmenitySelection = { amenityIds: string[]; proposals: InlineProposalInput[]; proposalIds?: string[] };

/** A new client must send at least one amenity or proposal (422 AMENITIES_REQUIRED otherwise); say so before the round trip. */
export function amenitySelectionError(sel: AmenitySelection): string | null {
  return sel.amenityIds.length + sel.proposals.length + (sel.proposalIds?.length ?? 0) > 0 ? null : "Chọn ít nhất một tiện ích (hoặc gửi một đề xuất) cho chi nhánh.";
}

/** The amenity part of the body of POST /owner/gyms and PUT /owner/application/amenities. Empty lists are still sent: amenityIds replaces the branch's amenities. */
export function amenitySelectionPayload(sel: AmenitySelection) {
  return {
    amenityIds: [...new Set(sel.amenityIds)],
    ...(sel.proposals.length ? { proposals: sel.proposals.map((p) => ({ name: p.name.trim(), suggestedCategory: p.suggestedCategory, ...(p.note?.trim() ? { note: p.note.trim() } : {}) })) } : {}),
    ...(sel.proposalIds !== undefined ? { proposalIds: [...new Set(sel.proposalIds)] } : {}),
  };
}

export { AMENITY_CATEGORIES };
