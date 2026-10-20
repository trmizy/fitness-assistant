import type { Request, Response } from 'express';
import type { Prisma } from '../generated/prisma';
import { prisma } from '../repositories/prisma';
import { partnerGuard } from './partner-guard.service';

/**
 * Listing Management, Phase B1 — the ONE public-visibility rule for branches, and the ONE public branch DTO.
 *
 * A branch is publicly visible when ALL hold:
 *   1. status = APPROVED (admin moderation) and operationalStatus = OPEN (the owner's own switch) - a temporarily or
 *      permanently closed branch stays hidden, exactly as before this phase;
 *   2. its owner is not hidden from public discovery (partnerGuard.hiddenFromPublicOwnerUserIds: SUSPENDED /
 *      TERMINATED partners).
 *
 * Every public read goes through `gymPublicWhere()`: GET /gyms, GET /gyms/:id, GET /gyms/:gymId/plans|trainers|reviews,
 * GET /pt/:ptUserId/gyms, GET /media/gym-photos/:photoId and GET /uploads/gym-photos/:file. A branch that is not
 * visible answers 404 on all of them - an id lookup cannot get around the list filter.
 */
export async function gymPublicWhere(): Promise<Prisma.GymWhereInput> {
  const hiddenOwnerIds = await partnerGuard.hiddenFromPublicOwnerUserIds();
  return {
    status: 'APPROVED',
    operationalStatus: 'OPEN',
    ...(hiddenOwnerIds.length > 0 ? { ownerId: { notIn: hiddenOwnerIds } } : {}),
  };
}

export async function isGymPubliclyVisible(gymId: string): Promise<boolean> {
  const where = await gymPublicWhere();
  const row = await prisma.gym.findFirst({ where: { AND: [{ id: gymId }, where] }, select: { id: true } });
  return row !== null;
}

/** 404 JSON for a public route whose branch is not visible (or does not exist) - the two are indistinguishable on purpose. */
export function sendGymNotFound(res: Response): void {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Không tìm thấy phòng gym' } });
}

/** Public-route guard: answers 404 and returns false when the branch in `:gymId` is not publicly visible. */
export async function requirePubliclyVisibleGym(req: Request, res: Response, param = 'gymId'): Promise<boolean> {
  if (await isGymPubliclyVisible(req.params[param])) return true;
  sendGymNotFound(res);
  return false;
}

// ── Published (client-visible) source rows ─────────────────────────────────────────────────

/** Stable URL of a PUBLISHED branch photo. The media route redirects / streams on every request, so this URL never
 * expires for a viewer (an <img> or expo-image can cache it) while the bytes behind it stay behind the visibility check. */
export function gymPhotoMediaUrl(photoId: string): string {
  return `/media/gym-photos/${photoId}`;
}

/** Reader order of a gallery: cover first, then (sort_order, created_at, id). */
const PUBLISHED_PHOTO_ORDER: Prisma.GymPhotoOrderByWithRelationInput[] = [
  { isCover: 'desc' },
  { sortOrder: 'asc' },
  { createdAt: 'asc' },
  { id: 'asc' },
];

const publishedAmenities = {
  where: { amenity: { status: 'ACTIVE' as const } },
  include: { amenity: true },
  orderBy: [{ amenity: { sortOrder: 'asc' as const } }, { amenity: { name: 'asc' as const } }],
};

const LIST_INCLUDE = {
  brand: true,
  amenities: publishedAmenities,
  // The list only needs the cover: first of the reader order, PUBLISHED only.
  photos: { where: { status: 'PUBLISHED' as const }, orderBy: PUBLISHED_PHOTO_ORDER, take: 1 },
} satisfies Prisma.GymInclude;

const DETAIL_INCLUDE = {
  brand: true,
  amenities: publishedAmenities,
  photos: { where: { status: 'PUBLISHED' as const }, orderBy: PUBLISHED_PHOTO_ORDER },
} satisfies Prisma.GymInclude;

declare const publishedBrand: unique symbol;
/**
 * A branch row read through the PUBLIC repository below: filtered by `gymPublicWhere()`, with only ACTIVE amenities and
 * only PUBLISHED photos. `toPublicGymDto` accepts nothing else, so a revision, a draft or a STAGED photo cannot reach a
 * public response by accident - there is simply no way to hand them to the mapper.
 */
export type PublishedGymSource = Prisma.GymGetPayload<{ include: typeof DETAIL_INCLUDE }> & { readonly [publishedBrand]: true };
export type PublishedGymListSource = Prisma.GymGetPayload<{ include: typeof LIST_INCLUDE }> & { readonly [publishedBrand]: true };

export const gymPublicRepository = {
  /** Newest first, exactly like the previous `findApproved`. */
  async findPublishedList(): Promise<PublishedGymListSource[]> {
    const where = await gymPublicWhere();
    const rows = await prisma.gym.findMany({ where, include: LIST_INCLUDE, orderBy: { createdAt: 'desc' } });
    return rows as PublishedGymListSource[];
  },

  async findPublishedById(id: string): Promise<PublishedGymSource | null> {
    const where = await gymPublicWhere();
    const row = await prisma.gym.findFirst({ where: { AND: [{ id }, where] }, include: DETAIL_INCLUDE });
    return row as PublishedGymSource | null;
  },

  /** Every publicly visible branch of one brand (for the brand's branch map). */
  async findPublishedBranchesOfBrand(brandId: string) {
    const where = await gymPublicWhere();
    return prisma.gym.findMany({
      where: { AND: [{ brandId }, where] },
      select: { id: true, name: true, approvedName: true, address: true, approvedAddress: true, latitude: true, longitude: true },
      orderBy: { createdAt: 'asc' },
    });
  },
};

// ── DTO ────────────────────────────────────────────────────────────────────────────────────

export interface PublicAmenityDto {
  slug: string;
  name: string;
  category: string;
  iconKey: string;
}

export interface PublicBrandDto {
  id: string;
  name: string;
  approvedName: string | null;
  description: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  tiktokUrl: string | null;
  youtubeUrl: string | null;
  logoUrl?: string | null;
}

export interface PublicGymPhotoDto {
  id: string;
  category: string | null;
  isCover: boolean;
  url: string;
}

/** The presentation of ONE amenity - shared by the public DTO and the owner/admin preview, so a preview LOOKS like the real listing. */
export function toPublicAmenityDto(a: { slug: string; name: string; category: string; iconKey: string }): PublicAmenityDto {
  return { slug: a.slug, name: a.name, category: a.category, iconKey: a.iconKey };
}

/**
 * Allowlist of what a client may see about a branch. Everything not listed here is NOT public - in particular the
 * moderation overlay (pendingName / pendingAddress / pendingNameNote / pendingAddressNote / changesRequested*), owner
 * and audit columns (ownerId, closedBy, wizardStep, closedAt, reopenedAt), the listing/compat bookkeeping columns, and
 * any brand column beyond the ones below (pendingName, logoKey, ownerId, ...).
 *
 * `facilities` is kept ONLY as a mirror for apps installed before the amenity catalogue; new clients read `amenities`.
 */
export function toPublicGymDto(
  g: PublishedGymSource | PublishedGymListSource,
  extra: { brandLogoUrl?: string | null } = {},
) {
  const brand = g.brand;
  const cover = g.photos[0];
  return {
    id: g.id,
    brandId: g.brandId,
    // The moderation-approved name/address replace the owner's raw working values on every public surface.
    name: g.approvedName ?? g.name,
    approvedName: g.approvedName,
    address: g.approvedAddress ?? g.address,
    approvedAddress: g.approvedAddress,
    description: g.description,
    city: g.city,
    provinceCode: g.provinceCode,
    wardCode: g.wardCode,
    latitude: g.latitude,
    longitude: g.longitude,
    locationNote: g.locationNote,
    phone: g.phone,
    email: g.email,
    status: g.status,
    operationalStatus: g.operationalStatus,
    closureReason: g.closureReason,
    expectedReopenAt: g.expectedReopenAt,
    createdAt: g.createdAt,
    updatedAt: g.updatedAt,
    facilities: g.facilities,
    amenities: g.amenities.map((ga) => toPublicAmenityDto(ga.amenity)),
    coverPhotoUrl: cover ? gymPhotoMediaUrl(cover.id) : null,
    brand: brand
      ? ({
          id: brand.id,
          name: brand.approvedName ?? brand.name,
          approvedName: brand.approvedName,
          description: brand.description,
          facebookUrl: brand.facebookUrl,
          instagramUrl: brand.instagramUrl,
          tiktokUrl: brand.tiktokUrl,
          youtubeUrl: brand.youtubeUrl,
          ...(extra.brandLogoUrl !== undefined ? { logoUrl: extra.brandLogoUrl } : {}),
        } satisfies PublicBrandDto)
      : null,
  };
}

/** The detail view's gallery: PUBLISHED photos only (the source type guarantees it), stable URLs, reader order. */
export function toPublicGymPhotos(g: PublishedGymSource): PublicGymPhotoDto[] {
  return g.photos.map((p) => ({ id: p.id, category: p.category, isCover: p.isCover, url: gymPhotoMediaUrl(p.id) }));
}
