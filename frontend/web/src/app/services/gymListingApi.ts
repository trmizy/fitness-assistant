/**
 * Listing Management (Phase D2) — gym-service calls of the Gym Owner "Tin đăng & tiện ích" page, the add-branch wizard's
 * amenity + photo steps and the partner application's amenity step.
 *
 * Own file (not a region of services/api.ts) so it never collides with other workstreams; every call still goes through
 * the shared axios instance. gym-service answers `{ success:true, data }` (unwrapped here); every refusal is
 * `{ success:false, error:{ code, message }, message, ...extra }` — left as axios errors, read by utils/gymListing.ts.
 *
 * Importing this module also registers the "new client" headers (services/listingFlowHeaders.ts).
 */
import "./listingFlowHeaders";
import { api } from "./api";
import { postToPresignedTarget } from "./ptListingApi";
import {
  normalizeCatalog,
  normalizeGymListing,
  normalizeGymPreview,
  normalizeGymRevision,
  type AmenitySelection,
  type GymListingView,
  type GymPayload,
  type GymRevision,
  amenitySelectionPayload,
} from "../utils/gymListing";
import { normalizePhoto } from "../utils/ptListing";
import type { GymListingPreviewDto } from "./ptListingApi";
import type { AmenityCategory, ListingPhoto, PresignedPostTarget } from "../types";

/** Image confirm re-encodes the file server-side (sharp): give it more than the default 10 s. */
const CONFIRM_TIMEOUT_MS = 60_000;

const unwrap = <T>(res: any): T => (res?.data?.data ?? res?.data) as T;
const base = (gymId: string) => `/owner/gyms/${gymId}/listing`;

export const gymListingService = {
  /** Published listing + the open revision + every usable photo + the amenities/proposals the payloads mention + history + limits. */
  get: async (gymId: string): Promise<GymListingView> => normalizeGymListing(unwrap(await api.get(base(gymId)))),
  /** Starts a draft from the published listing, or (copyFromRevisionId) from a closed revision <= 30 days old. */
  createDraft: async (gymId: string, copyFromRevisionId?: string): Promise<GymRevision | null> =>
    normalizeGymRevision(unwrap<any>(await api.post(`${base(gymId)}/draft`, copyFromRevisionId ? { copyFromRevisionId } : {}))?.revision),
  /** expectedDraftVersion is mandatory (B7): the server answers 409 DRAFT_STALE with the current draft when it moved. */
  saveDraft: async (gymId: string, body: { expectedDraftVersion: number; payload: GymPayload; ownerNote?: string }): Promise<GymRevision | null> =>
    normalizeGymRevision(unwrap<any>(await api.put(`${base(gymId)}/draft`, body))?.revision),
  submit: async (gymId: string, body: { expectedDraftVersion: number; ownerNote?: string }): Promise<GymRevision | null> =>
    normalizeGymRevision(unwrap<any>(await api.post(`${base(gymId)}/submit`, body))?.revision),
  /** PENDING → WITHDRAWN, and the server hands back a fresh DRAFT with the same content. */
  withdraw: async (gymId: string): Promise<GymRevision | null> => normalizeGymRevision(unwrap<any>(await api.post(`${base(gymId)}/withdraw`, {}))?.revision),
  discard: async (gymId: string): Promise<void> => {
    await api.post(`${base(gymId)}/discard`, {});
  },
  rebase: async (gymId: string, expectedDraftVersion?: number): Promise<GymRevision | null> =>
    normalizeGymRevision(unwrap<any>(await api.post(`${base(gymId)}/rebase`, expectedDraftVersion ? { expectedDraftVersion } : {}))?.revision),
  preview: async (gymId: string): Promise<GymListingPreviewDto | null> => normalizeGymPreview(unwrap(await api.get(`${base(gymId)}/preview`))),

  presign: async (gymId: string, contentType: string): Promise<PresignedPostTarget> =>
    unwrap<PresignedPostTarget>(await api.post(`${base(gymId)}/photos/presign`, { contentType })),
  confirm: async (gymId: string, uploadId: string): Promise<{ photo: ListingPhoto | null; deduplicated: boolean }> => {
    const d: any = unwrap(await api.post(`${base(gymId)}/photos/confirm`, { uploadId }, { timeout: CONFIRM_TIMEOUT_MS }));
    return { photo: normalizePhoto(d?.photo), deduplicated: d?.deduplicated === true };
  },
  /** presign → POST to storage → confirm. The result is a STAGED photo: public only once a revision (or the branch's first approval) publishes it. */
  uploadPhoto: async (gymId: string, file: File): Promise<{ photo: ListingPhoto | null; deduplicated: boolean }> => {
    const target = await gymListingService.presign(gymId, file.type);
    await postToPresignedTarget(target, file);
    return gymListingService.confirm(gymId, target.uploadId);
  },
  /** Deletes a photo that is not public yet. A photo in the saved DRAFT leaves it and bumps draftVersion once. */
  deletePhoto: async (gymId: string, photoId: string): Promise<void> => {
    await api.delete(`${base(gymId)}/photos/${photoId}`);
  },
  /** DRAFT branch only (the wizard): order of its STAGED photos — exactly that set (422 PHOTO_SET_MISMATCH). Any other branch: 409 GYM_NOT_DRAFT. */
  reorderPhotos: async (gymId: string, photoIds: string[]): Promise<ListingPhoto[]> =>
    (unwrap<any>(await api.put(`${base(gymId)}/photos/reorder`, { photoIds }))?.photos ?? []).map(normalizePhoto).filter(Boolean) as ListingPhoto[],
  /** DRAFT branch only: exactly one STAGED photo is the cover. */
  setCover: async (gymId: string, photoId: string): Promise<ListingPhoto[]> =>
    (unwrap<any>(await api.patch(`${base(gymId)}/photos/${photoId}/cover`, {}))?.photos ?? []).map(normalizePhoto).filter(Boolean) as ListingPhoto[],
};

export const ownerAmenityService = {
  /** The ACTIVE catalogue and the caller's own proposals (newest first, <= 100). OWNER role only (a manager gets 403). */
  catalog: async () => normalizeCatalog(unwrap(await api.get("/owner/amenities"))),
  /** 200 `{ matchedAmenity }` | 200/201 `{ proposal, kind: "NEW" | "REENABLE", created }` — read with interpretProposeResponse. */
  propose: async (body: { gymId: string; name: string; suggestedCategory: AmenityCategory; note?: string }) =>
    unwrap<any>(await api.post("/owner/amenities/proposals", body)),
  updateProposal: async (id: string, body: { name?: string; suggestedCategory?: AmenityCategory; note?: string | null }) =>
    unwrap<any>(await api.patch(`/owner/amenities/proposals/${id}`, body)),
  cancelProposal: async (id: string) => unwrap<any>(await api.delete(`/owner/amenities/proposals/${id}`)),
};

/** `PUT /owner/application/amenities` — the application wizard's amenity step (the application's single DRAFT branch). */
export const applicationAmenityService = {
  /** `GET /owner/application/amenities/catalog` — the same catalogue + own proposals as /owner/amenities, open to an applicant. */
  catalog: async () => normalizeCatalog(unwrap(await api.get("/owner/application/amenities/catalog"))),
  save: async (sel: AmenitySelection) => unwrap<any>(await api.put("/owner/application/amenities", amenitySelectionPayload(sel))),
};

/**
 * `POST /owner/gyms` — the quick "Thêm chi nhánh" dialog of MyGymsPage. A new client must send >= 1 of amenityIds / proposals
 * (422 AMENITIES_REQUIRED otherwise); the branch and its amenities are saved in ONE transaction.
 */
export const quickCreateGymService = {
  create: async (body: Record<string, unknown>, sel: AmenitySelection) => unwrap<any>(await api.post("/owner/gyms", { ...body, ...amenitySelectionPayload(sel) })),
};

/** The add-branch wizard's amenity save: `PATCH /owner/gyms/:id/draft` with the amenity part (+ wizardStep, if given). */
export const branchDraftAmenityService = {
  save: async (gymId: string, sel: AmenitySelection) => unwrap<any>(await api.patch(`/owner/gyms/${gymId}/draft`, amenitySelectionPayload(sel))),
};

/** The wizard's photos of a DRAFT branch: the (read-only, still allowed) owner photo list `GET /owner/gyms/:id/photos`. */
export const branchPhotoService = {
  list: async (gymId: string): Promise<ListingPhoto[]> => {
    const rows = unwrap<any[]>(await api.get(`/owner/gyms/${gymId}/photos`)) ?? [];
    return rows
      .map((r) => normalizePhoto({ id: r.id, status: r.status ?? "STAGED", url: r.url ?? null, expiresAt: null, isCover: r.isCover, sortOrder: r.sortOrder }))
      .filter(Boolean) as ListingPhoto[];
  },
};
