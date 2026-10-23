/**
 * The PREVIEW mapper of a branch-listing revision (plan §1 B14, §12.13 item 3).
 *
 * Deliberately a different function from `toPublicGymDto`, with a different input type (an open revision, not a
 * `PublishedGymSource`): the public DTO can never be handed a draft, and this one is imported ONLY by the owner and
 * admin controllers (the architecture test greps that no public route file imports it).
 *
 * Presentation helpers are shared with the public DTO (`toPublicAmenityDto`), so a preview LOOKS like the real listing.
 * What differs: `isPreview: true`, `revisionStatus`, `systemAdjustments`, amenity proposals shown as "pending", and photo
 * URLs that may be short-lived presigned links (STAGED photos) with an `expiresAt` - a plain <img> cannot send an
 * Authorization header.
 */
import { toPublicAmenityDto, type PublicAmenityDto } from './gym-public';
import type { GymListingPayload } from './gym-listing.schemas';
import type { PhotoView } from './gym-listing.helpers';

export interface ListingPreviewDto {
  isPreview: true;
  viewer: 'OWNER' | 'ADMIN';
  revisionId: string;
  revisionStatus: string;
  revisionSource: string;
  systemAdjustments: unknown;
  /** Earliest moment a presigned photo URL in this response stops working (null when there is none). */
  photoUrlsExpireAt: string | null;
  gymId: string;
  name: string;
  address: string;
  city: string | null;
  description: string | null;
  amenities: Array<PublicAmenityDto & { id: string; disabled: boolean }>;
  /** Proposals still waiting for an admin: shown as pending chips, never as real amenities. */
  pendingAmenities: Array<{ proposalId: string; name: string; suggestedCategory: string; kind: string }>;
  photos: Array<{ id: string; url: string | null; expiresAt: string | null; isCover: boolean; sortOrder: number; status: string }>;
  coverPhotoUrl: string | null;
}

export function toListingPreviewDto(
  revision: { id: string; status: string; source: string; payload: GymListingPayload; systemAdjustments: unknown },
  gym: { id: string; name: string; approvedName: string | null; address: string; approvedAddress: string | null; city: string | null },
  amenities: Array<{ id: string; slug: string; name: string; category: string; iconKey: string; status: string }>,
  proposals: Array<{ id: string; name: string; suggestedCategory: string; kind: string; status: string }>,
  photos: PhotoView[],
  viewer: 'OWNER' | 'ADMIN',
): ListingPreviewDto {
  const payload = revision.payload;

  const amenityById = new Map(amenities.map((a) => [a.id, a]));
  const shownAmenities = payload.amenityIds
    .map((id) => amenityById.get(id))
    .filter((a): a is NonNullable<typeof a> => !!a)
    .map((a) => ({ id: a.id, ...toPublicAmenityDto(a), disabled: a.status !== 'ACTIVE' }));

  const proposalById = new Map(proposals.map((p) => [p.id, p]));
  const pending = payload.proposalIds
    .map((id) => proposalById.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p && p.status === 'PENDING')
    .map((p) => ({ proposalId: p.id, name: p.name, suggestedCategory: p.suggestedCategory, kind: p.kind }));

  const byId = new Map(photos.map((p) => [p.id, p]));
  const ordered = payload.photoIds
    .map((id, index) => {
      const v = byId.get(id);
      if (!v) return null;
      return { id, url: v.url, expiresAt: v.expiresAt, isCover: id === payload.coverPhotoId, sortOrder: index, status: v.status };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);
  const expiries = ordered.map((p) => p.expiresAt).filter((e): e is string => !!e).sort();

  return {
    isPreview: true,
    viewer,
    revisionId: revision.id,
    revisionStatus: revision.status,
    revisionSource: revision.source,
    systemAdjustments: revision.systemAdjustments,
    photoUrlsExpireAt: expiries[0] ?? null,
    gymId: gym.id,
    name: gym.approvedName ?? gym.name,
    address: gym.approvedAddress ?? gym.address,
    city: gym.city,
    description: payload.description,
    amenities: shownAmenities,
    pendingAmenities: pending,
    photos: ordered,
    coverPhotoUrl: ordered.find((p) => p.isCover)?.url ?? null,
  };
}
