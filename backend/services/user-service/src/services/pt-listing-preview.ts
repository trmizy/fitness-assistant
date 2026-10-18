/**
 * The PREVIEW mapper of a listing revision (plan §1 B14, §12.13 item 3).
 *
 * Deliberately a different function from `toPublicPtDto`, with a different input type (an open revision, not a
 * `PublishedPtSource`): the public DTO can never be handed a draft, and this one is imported ONLY by the owner and
 * admin controllers (an architecture test greps that no public route file imports it).
 *
 * Presentation helpers are shared with the public DTO (price derivation), so a preview LOOKS like the real listing.
 * What differs: `isPreview: true`, `revisionStatus`, `systemAdjustments`, and photo URLs that may be short-lived
 * presigned links (STAGED photos) with an `expiresAt` - a plain <img> cannot send an Authorization header.
 */
import { computeFromPricesByMode } from "./pt-public-dto";
import type { PtListingPayload } from "./pt-listing.schemas";
import type { StagedPhotoView } from "./pt-physique-upload.service";

export interface ListingPreviewDto {
  isPreview: true;
  viewer: "OWNER" | "ADMIN";
  revisionId: string;
  revisionStatus: string;
  revisionSource: string;
  systemAdjustments: unknown;
  /** Earliest moment a presigned photo URL in this response stops working (null when there is none). */
  photoUrlsExpireAt: string | null;
  userId: string;
  firstName: string | null;
  lastName: string | null;
  specialties: string[];
  ptApplication: PtListingPayload["profile"] & { fromPricePerSession: number | null; fromPackagePrice: number | null };
  servicePackages: Array<PtListingPayload["packages"][number] & { isNew: boolean }>;
  fromPricePerSession: number | null;
  fromPackagePrice: number | null;
  physiquePhotos: Array<{ id: string; url: string; expiresAt: string | null; isCover: boolean; sortOrder: number; status: string }>;
  coverPhotoUrl: string | null;
}

export function toListingPreviewDto(
  revision: { id: string; status: string; source: string; payload: PtListingPayload; systemAdjustments: unknown },
  who: { userId: string; firstName: string | null; lastName: string | null },
  photos: StagedPhotoView[],
  viewer: "OWNER" | "ADMIN",
): ListingPreviewDto {
  const payload = revision.payload;
  const live = payload.packages.filter((p) => !p.archive);
  // Only packages that would actually be for sale count towards the "from" prices.
  const forSale = live.filter((p) => p.isActive);
  const prices = computeFromPricesByMode(forSale);

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
    userId: who.userId,
    firstName: who.firstName,
    lastName: who.lastName,
    specialties: payload.profile.mainSpecialties,
    ptApplication: { ...payload.profile, fromPricePerSession: prices.overall.fromPricePerSession, fromPackagePrice: prices.overall.fromPackagePrice },
    servicePackages: forSale.map((p) => ({ ...p, isNew: !p.id })),
    fromPricePerSession: prices.overall.fromPricePerSession,
    fromPackagePrice: prices.overall.fromPackagePrice,
    physiquePhotos: ordered,
    coverPhotoUrl: ordered.find((p) => p.isCover)?.url ?? null,
  };
}
