/**
 * Listing Management (Phase D1) — API calls of the PT "Tin đăng" page and of the admin page
 * "Tin đăng & tiện ích".
 *
 * Kept in its own file (instead of a region at the end of services/api.ts) because api.ts was being edited by
 * another workstream while this was written; every call still goes through the shared axios instance.
 *
 *  ptListingService     user-service  /profile/me/listing/*            (bare objects)
 *  adminListingService  user-service  /admin/listings/pts/*            (bare objects)
 *                       gym-service   /admin/listings/gyms/*           (`{ success, data }` — unwrapped here)
 *  adminAmenityService  gym-service   /admin/amenities/*               (`{ success, data }` — unwrapped here)
 *
 * Errors are left as axios errors: utils/listingErrors.ts reads `{ error:{code,message} }` from them.
 */
import api from "./api";
import {
  normalizeListing,
  normalizePreview,
  normalizeRevision,
  normalizePhoto,
  normalizeHistoryItem,
  normalizePayload,
} from "../utils/ptListing";
import type {
  AdminGymPublishedListing,
  AdminGymRevisionDetail,
  AdminPtPublishedListing,
  AdminListingList,
  AdminListingListItem,
  AdminPtRevisionDetail,
  Amenity,
  AmenityProposalGroup,
  AmenityProposalItem,
  ListingDirectEditResult,
  ListingFieldChange,
  ListingHistoryItem,
  ListingPhoto,
  PresignedPostTarget,
  PtListingPayload,
  PtListingPreview,
  PtListingRevision,
  PtListingView,
} from "../types";

/** Image confirm re-encodes the file server-side (sharp): give it more than the default 10 s. */
const CONFIRM_TIMEOUT_MS = 60_000;

/** gym-service answers `{ success:true, data }`; user-service answers the bare object. */
const unwrap = <T>(body: any): T => (body && typeof body === "object" && "data" in body && "success" in body ? body.data : body) as T;

/** Thrown when the direct-to-storage POST fails (network, CORS, size/type policy). `code` feeds listingErrorMessage. */
export class ListingUploadError extends Error {
  readonly response = { status: 0, data: { error: { code: "UPLOAD_CONFLICT" } } };
  constructor(message = "Chưa tải được ảnh lên. Vui lòng thử lại.") {
    super(message);
    this.name = "ListingUploadError";
  }
}

/**
 * Sends the file to the storage with the presigned POST the server signed: the signed `fields` first, the file LAST
 * (S3 ignores everything after the `file` field). Not through the axios instance — it must not carry our Authorization.
 */
export async function postToPresignedTarget(target: PresignedPostTarget, file: File): Promise<void> {
  const form = new FormData();
  Object.entries(target.fields ?? {}).forEach(([k, v]) => form.append(k, v));
  form.append("file", file);
  let res: Response;
  try {
    res = await fetch(target.url, { method: "POST", body: form });
  } catch {
    throw new ListingUploadError("Không kết nối được kho lưu ảnh. Kiểm tra mạng rồi thử lại.");
  }
  if (!res.ok) throw new ListingUploadError(res.status === 403 ? "Lượt tải ảnh đã hết hạn hoặc không hợp lệ. Hãy thử lại." : undefined);
}

const normalizePhotos = (raw: any): ListingPhoto[] => (Array.isArray(raw) ? (raw.map(normalizePhoto).filter(Boolean) as ListingPhoto[]) : []);

// ═══ ptListingService — the signed-in trainer's own listing ═════════════════════════════════════
export const ptListingService = {
  get: async (): Promise<PtListingView> => {
    const { data } = await api.get("/profile/me/listing");
    return normalizeListing(data);
  },
  createDraft: async (copyFromRevisionId?: string): Promise<PtListingRevision | null> => {
    const { data } = await api.post("/profile/me/listing/draft", copyFromRevisionId ? { copyFromRevisionId } : {});
    return normalizeRevision(data?.revision);
  },
  /** expectedDraftVersion is mandatory (B7): the server answers 409 DRAFT_STALE with the current draft when it moved. */
  saveDraft: async (body: { expectedDraftVersion: number; payload: PtListingPayload; ownerNote?: string }): Promise<PtListingRevision | null> => {
    const { data } = await api.put("/profile/me/listing/draft", body);
    return normalizeRevision(data?.revision);
  },
  submit: async (body: { expectedDraftVersion: number; ownerNote?: string }): Promise<PtListingRevision | null> => {
    const { data } = await api.post("/profile/me/listing/submit", body);
    return normalizeRevision(data?.revision);
  },
  /** PENDING → WITHDRAWN, and the server hands back a fresh DRAFT with the same content. */
  withdraw: async (): Promise<PtListingRevision | null> => {
    const { data } = await api.post("/profile/me/listing/withdraw", {});
    return normalizeRevision(data?.revision);
  },
  discard: async (): Promise<void> => {
    await api.post("/profile/me/listing/discard", {});
  },
  rebase: async (expectedDraftVersion?: number): Promise<PtListingRevision | null> => {
    const { data } = await api.post("/profile/me/listing/rebase", expectedDraftVersion ? { expectedDraftVersion } : {});
    return normalizeRevision(data?.revision);
  },
  preview: async (): Promise<PtListingPreview | null> => {
    const { data } = await api.get("/profile/me/listing/preview");
    return normalizePreview(data);
  },
  presign: async (contentType: string): Promise<PresignedPostTarget> => {
    const { data } = await api.post("/profile/me/listing/physique/presign", { contentType });
    return data;
  },
  confirm: async (uploadId: string): Promise<{ photo: ListingPhoto | null; deduplicated: boolean }> => {
    const { data } = await api.post("/profile/me/listing/physique/confirm", { uploadId }, { timeout: CONFIRM_TIMEOUT_MS });
    return { photo: normalizePhoto(data?.photo), deduplicated: data?.deduplicated === true };
  },
  /** presign → POST to storage → confirm. The result is a STAGED photo: it is public only once a revision is approved. */
  uploadPhoto: async (file: File): Promise<{ photo: ListingPhoto | null; deduplicated: boolean }> => {
    const target = await ptListingService.presign(file.type);
    await postToPresignedTarget(target, file);
    return ptListingService.confirm(target.uploadId);
  },
  /** Deletes a photo that is not public. A photo in the saved DRAFT leaves it and bumps draftVersion once. */
  deletePhoto: async (photoId: string): Promise<void> => {
    await api.delete(`/profile/me/listing/physique/${photoId}`);
  },
};

// ═══ adminListingService ════════════════════════════════════════════════════════════════════════
export type AdminListingKind = "pts" | "gyms";

const normalizeChanges = (raw: any): ListingFieldChange[] =>
  Array.isArray(raw)
    ? raw
        .filter((c: any) => c && typeof c.path === "string")
        .map((c: any) => ({
          path: c.path,
          before: c.before ?? null,
          after: c.after ?? null,
          ...(Array.isArray(c.added) ? { added: c.added } : {}),
          ...(Array.isArray(c.removed) ? { removed: c.removed } : {}),
        }))
    : [];

function normalizeListItem(r: any): AdminListingListItem {
  return {
    ...normalizeHistoryItem(r),
    currentListingVersion: typeof r.currentListingVersion === "number" ? r.currentListingVersion : null,
    stale: r.stale === true,
    ptUserId: r.ptUserId,
    ptName: r.ptName ?? null,
    gymId: r.gymId,
    gymName: r.gymName,
    brandId: r.brandId ?? null,
    brandName: r.brandName ?? null,
    summary: {
      photoCount: Number(r.summary?.photoCount ?? 0),
      packageCount: r.summary?.packageCount,
      amenityCount: r.summary?.amenityCount,
      proposalCount: r.summary?.proposalCount,
    },
  };
}

function normalizeList(raw: any): AdminListingList {
  return {
    total: Number(raw?.total ?? 0),
    page: Number(raw?.page ?? 1),
    pageSize: Number(raw?.pageSize ?? 20),
    items: (Array.isArray(raw?.items) ? raw.items : []).filter((r: any) => r && typeof r.id === "string").map(normalizeListItem),
  };
}

const gymPayload = (raw: any) => ({
  description: typeof raw?.description === "string" && raw.description ? raw.description : null,
  amenityIds: Array.isArray(raw?.amenityIds) ? raw.amenityIds.filter((x: unknown) => typeof x === "string") : [],
  proposalIds: Array.isArray(raw?.proposalIds) ? raw.proposalIds.filter((x: unknown) => typeof x === "string") : [],
  photoIds: Array.isArray(raw?.photoIds) ? raw.photoIds.filter((x: unknown) => typeof x === "string") : [],
  coverPhotoId: typeof raw?.coverPhotoId === "string" ? raw.coverPhotoId : null,
});

export const adminListingService = {
  // ── PT (user-service, bare objects) ─────────────────────────────────────────────────────────
  listPt: async (params: Record<string, string | number>): Promise<AdminListingList> => {
    const { data } = await api.get("/admin/listings/pts", { params });
    return normalizeList(data);
  },
  getPtRevision: async (rid: string): Promise<AdminPtRevisionDetail> => {
    const { data } = await api.get(`/admin/listings/pts/revisions/${rid}`);
    return {
      revision: {
        ...normalizeHistoryItem(data.revision),
        ptUserId: data.revision.ptUserId,
        draftVersion: Number(data.revision.draftVersion ?? 1),
        payload: normalizePayload(data.revision.payload),
        previousSnapshot: data.revision.previousSnapshot ?? null,
        ownerNote: data.revision.ownerNote ?? null,
      },
      pt: data.pt ?? null,
      stale: data.stale === true,
      published: data.published ? normalizePayload(data.published) : null,
      changes: normalizeChanges(data.changes),
      changesAtDecision: data.changesAtDecision ? normalizeChanges(data.changesAtDecision) : null,
      photos: normalizePhotos(data.photos),
    };
  },
  previewPtRevision: async (rid: string): Promise<PtListingPreview | null> => {
    const { data } = await api.get(`/admin/listings/pts/revisions/${rid}/preview`);
    return normalizePreview(data);
  },
  approvePt: async (rid: string, note?: string) => (await api.post(`/admin/listings/pts/revisions/${rid}/approve`, note?.trim() ? { note: note.trim() } : {})).data,
  rejectPt: async (rid: string, note: string) => (await api.post(`/admin/listings/pts/revisions/${rid}/reject`, { note: note.trim() })).data,
  requestChangesPt: async (rid: string, note: string) => (await api.post(`/admin/listings/pts/revisions/${rid}/request-changes`, { note: note.trim() })).data,
  directEditPt: async (ptUserId: string, body: Record<string, unknown>): Promise<ListingDirectEditResult> =>
    (await api.post(`/admin/listings/pts/${ptUserId}/direct-edit`, body)).data,
  retirePtPhoto: async (ptUserId: string, photoId: string, body: { reason: string; purge?: boolean }) =>
    (await api.post(`/admin/listings/pts/${ptUserId}/physique/${photoId}/retire`, body)).data,
  /** The CURRENT published listing + version of one trainer, revision or not (user-service GET /admin/listings/pts/:id). */
  getPtPublished: async (ptUserId: string): Promise<AdminPtPublishedListing> => {
    const { data } = await api.get(`/admin/listings/pts/${ptUserId}`);
    return {
      pt: data.pt,
      published: normalizePayload(data.published),
      photos: normalizePhotos(data.photos),
      openRevision: data.openRevision ?? null,
    };
  },
  ptHistory: async (ptUserId: string, page = 1): Promise<ListingHistoryResult> => {
    const { data } = await api.get(`/admin/listings/pts/${ptUserId}/history`, { params: { page } });
    return {
      revisions: (Array.isArray(data?.revisions) ? data.revisions : []).map(normalizeHistoryItem),
      audit: Array.isArray(data?.audit) ? (data.audit as Array<Record<string, any>>) : [],
    };
  },

  // ── Gym (gym-service, { success, data }) ────────────────────────────────────────────────────
  listGym: async (params: Record<string, string | number>): Promise<AdminListingList> => {
    const { data } = await api.get("/admin/listings/gyms", { params });
    return normalizeList(unwrap(data));
  },
  getGymRevision: async (rid: string): Promise<AdminGymRevisionDetail> => {
    const { data } = await api.get(`/admin/listings/gyms/revisions/${rid}`);
    const d: any = unwrap(data);
    return {
      revision: {
        ...normalizeHistoryItem(d.revision),
        draftVersion: Number(d.revision.draftVersion ?? 1),
        payload: gymPayload(d.revision.payload),
        previousSnapshot: d.revision.previousSnapshot ?? null,
        ownerNote: d.revision.ownerNote ?? null,
      },
      gym: d.gym,
      stale: d.stale === true,
      published: gymPayload(d.published),
      changes: normalizeChanges(d.changes),
      changesAtDecision: d.changesAtDecision ? normalizeChanges(d.changesAtDecision) : null,
      amenities: Array.isArray(d.amenities) ? d.amenities : [],
      proposals: Array.isArray(d.proposals) ? d.proposals : [],
      flags: {
        hasDisabledAmenity: d.flags?.hasDisabledAmenity === true,
        disabledAmenities: Array.isArray(d.flags?.disabledAmenities) ? d.flags.disabledAmenities : [],
        hasPendingProposal: d.flags?.hasPendingProposal === true,
        pendingProposals: Array.isArray(d.flags?.pendingProposals) ? d.flags.pendingProposals : [],
      },
      photos: normalizePhotos(d.photos),
    };
  },
  /** Gym preview: pending custom amenities and presigned photo links are in the payload; the page reads it as-is. */
  previewGymRevision: async (rid: string): Promise<GymListingPreviewDto | null> => {
    const { data } = await api.get(`/admin/listings/gyms/revisions/${rid}/preview`);
    const d: any = unwrap(data);
    return d && d.isPreview === true ? (d as GymListingPreviewDto) : null;
  },
  approveGym: async (rid: string, body: Record<string, unknown>) => unwrap<any>((await api.post(`/admin/listings/gyms/revisions/${rid}/approve`, body)).data),
  rejectGym: async (rid: string, note: string) => unwrap<any>((await api.post(`/admin/listings/gyms/revisions/${rid}/reject`, { note: note.trim() })).data),
  requestChangesGym: async (rid: string, note: string) =>
    unwrap<any>((await api.post(`/admin/listings/gyms/revisions/${rid}/request-changes`, { note: note.trim() })).data),
  directEditGym: async (gymId: string, body: Record<string, unknown>): Promise<ListingDirectEditResult> =>
    unwrap<ListingDirectEditResult>((await api.post(`/admin/listings/gyms/${gymId}/direct-edit`, body)).data),
  retireGymPhoto: async (gymId: string, photoId: string, body: { reason: string; purge?: boolean }) =>
    unwrap<any>((await api.post(`/admin/listings/gyms/${gymId}/photos/${photoId}/retire`, body)).data),
  /** The CURRENT published listing + version of one branch, revision or not (gym-service GET /admin/listings/gyms/:id). */
  getGymPublished: async (gymId: string): Promise<AdminGymPublishedListing> => {
    const { data } = await api.get(`/admin/listings/gyms/${gymId}`);
    const d: any = unwrap(data);
    return {
      gym: d.gym,
      published: gymPayload(d.published),
      amenities: Array.isArray(d.amenities) ? d.amenities : [],
      photos: normalizePhotos(d.photos),
      openRevision: d.openRevision ?? null,
    };
  },
  gymHistory: async (gymId: string, page = 1): Promise<ListingHistoryResult> => {
    const { data } = await api.get(`/admin/listings/gyms/${gymId}/history`, { params: { page } });
    const d: any = unwrap(data);
    return {
      revisions: (Array.isArray(d?.revisions) ? d.revisions : []).map(normalizeHistoryItem),
      audit: Array.isArray(d?.audit) ? (d.audit as Array<Record<string, any>>) : [],
    };
  },
  presignGymPhoto: async (gymId: string, contentType: string): Promise<PresignedPostTarget> =>
    unwrap<PresignedPostTarget>((await api.post(`/admin/listings/gyms/${gymId}/photos/presign`, { contentType })).data),
  confirmGymPhoto: async (gymId: string, uploadId: string): Promise<{ photo: ListingPhoto | null; deduplicated: boolean }> => {
    const d: any = unwrap((await api.post(`/admin/listings/gyms/${gymId}/photos/confirm`, { uploadId }, { timeout: CONFIRM_TIMEOUT_MS })).data);
    return { photo: normalizePhoto(d?.photo), deduplicated: d?.deduplicated === true };
  },
  /** Admin photo for a branch (never for a PT): STAGED until a direct edit puts it in the public set. */
  uploadGymPhoto: async (gymId: string, file: File) => {
    const target = await adminListingService.presignGymPhoto(gymId, file.type);
    await postToPresignedTarget(target, file);
    return adminListingService.confirmGymPhoto(gymId, target.uploadId);
  },
};

export interface ListingHistoryResult {
  revisions: ListingHistoryItem[];
  audit: Array<Record<string, any>>;
}

export interface GymListingPreviewDto {
  isPreview: true;
  revisionStatus: string;
  /** Earliest moment a presigned photo link in this response stops working. */
  photoUrlsExpireAt?: string | null;
  name: string;
  address: string;
  city: string | null;
  description: string | null;
  amenities: Array<{ id: string; name: string; iconKey: string; category: string; disabled: boolean }>;
  pendingAmenities: Array<{ proposalId: string; name: string; suggestedCategory: string; kind: string }>;
  photos: Array<{ id: string; url: string | null; isCover: boolean; status: string }>;
  coverPhotoUrl: string | null;
}

// ═══ adminAmenityService ════════════════════════════════════════════════════════════════════════
export const adminAmenityService = {
  list: async (params: { status?: string; category?: string; q?: string } = {}) => {
    const { data } = await api.get("/admin/amenities", { params });
    const d: any = unwrap(data);
    return {
      pendingProposalCount: Number(d?.pendingProposalCount ?? 0),
      amenities: (Array.isArray(d?.amenities) ? d.amenities : []) as Amenity[],
      iconKeys: (Array.isArray(d?.iconKeys) ? d.iconKeys : []) as string[],
    };
  },
  create: async (body: Record<string, unknown>): Promise<Amenity> => {
    const { data } = await api.post("/admin/amenities", body);
    return unwrap<any>(data).amenity;
  },
  update: async (id: string, body: Record<string, unknown>): Promise<Amenity> => {
    const { data } = await api.patch(`/admin/amenities/${id}`, body);
    return unwrap<any>(data).amenity;
  },
  history: async (id: string) => {
    const { data } = await api.get(`/admin/amenities/${id}/history`);
    return unwrap<{ amenity: Amenity; history: Array<Record<string, any>> }>(data);
  },
  listProposals: async (status = "PENDING"): Promise<AmenityProposalGroup[]> => {
    const { data } = await api.get("/admin/amenities/proposals", { params: { status } });
    const d: any = unwrap(data);
    return (Array.isArray(d?.groups) ? d.groups : []) as AmenityProposalGroup[];
  },
  approve: async (body: Record<string, unknown>) => unwrap<ProposalDecisionResult>((await api.post("/admin/amenities/proposals/approve", body)).data),
  reject: async (body: Record<string, unknown>) => unwrap<ProposalDecisionResult>((await api.post("/admin/amenities/proposals/reject", body)).data),
  merge: async (body: Record<string, unknown>) => unwrap<ProposalDecisionResult>((await api.post("/admin/amenities/proposals/merge", body)).data),
};

export interface ProposalDecisionResult {
  outcome: "APPROVED" | "MERGED" | "REJECTED";
  amenity: Amenity | null;
  reenabledAmenityIds: string[];
  revisionsUpdated: string[];
  decided: Array<{ proposalId: string; status: string; resultingAmenityId: string | null }>;
}

export type { AmenityProposalItem };
