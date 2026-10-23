/**
 * Listing Management (Phase D2) — what the CLIENT side reads off a public gym row.
 *
 * The public DTO (gym-service gym-public.ts#toPublicGymDto) carries:
 *   amenities[]      { slug, name, category, iconKey }   — only ACTIVE catalogue amenities, catalogue order
 *   facilities[]     the legacy enum mirror, kept for apps installed before the catalogue
 *   coverPhotoUrl    "/media/gym-photos/<id>" (stable, public) or null
 *   photos[]         (detail only) { id, category, isCover, url: "/media/gym-photos/<id>" }
 * New clients read `amenities`; a row that has none (an older deployment, a cached response) falls back to `facilities`.
 *
 * Pure (the API base is a parameter): runs under `npx tsx --test`.
 */
import type { AmenityCategory } from "../types";
import { isAmenityCategory, groupAmenitiesByCategory, type AmenityGroup } from "./gymListing";
import { SYSTEM_FACILITIES, isGymFacility } from "./facilityLabels";
import { resolveListingMediaUrl } from "./listingMedia";
import { listingErrorInfo } from "./listingErrors";

export interface PublicAmenity {
  /** Stable key for React (the slug; the public DTO has no id). */
  key: string;
  name: string;
  category: AmenityCategory;
  iconKey: string;
}

type PublicGymLike = {
  amenities?: unknown;
  facilities?: unknown;
  coverPhotoUrl?: unknown;
  photos?: unknown;
};

/** The amenities of a public gym row: `amenities[]` when the server sent it, else the legacy `facilities` mapped to the catalogue. */
export function publicAmenitiesOf(gym: PublicGymLike | null | undefined): PublicAmenity[] {
  const raw = gym?.amenities;
  if (Array.isArray(raw)) {
    const out = raw
      .filter((a: any) => a && typeof a.name === "string" && a.name.trim())
      .map((a: any, i: number) => ({
        key: String(a.slug ?? a.id ?? `${a.name}-${i}`),
        name: a.name.trim(),
        category: isAmenityCategory(a.category) ? a.category : ("FACILITY" as AmenityCategory),
        iconKey: typeof a.iconKey === "string" ? a.iconKey : "",
      }));
    // An explicit (even empty) amenities[] from a new server is authoritative; only a MISSING field falls back.
    return out;
  }
  const facilities = Array.isArray(gym?.facilities) ? (gym!.facilities as unknown[]).filter((f): f is string => typeof f === "string") : [];
  return facilities.map((f) => {
    if (isGymFacility(f)) {
      const meta = SYSTEM_FACILITIES[f];
      return { key: f, name: meta.name, category: meta.category, iconKey: meta.iconKey };
    }
    return { key: f, name: f, category: "FACILITY" as AmenityCategory, iconKey: "" };
  });
}

/** Up to `max` chips for a result card, and how many more there are ("+3"). */
export function cardAmenityChips(gym: PublicGymLike | null | undefined, max = 4): { chips: PublicAmenity[]; extra: number } {
  const all = publicAmenitiesOf(gym);
  return { chips: all.slice(0, max), extra: Math.max(0, all.length - max) };
}

/** The detail view's amenities grouped by the four categories (Cơ sở vật chất / Khu tập luyện / Dịch vụ / Phục hồi). */
export function groupedPublicAmenities(gym: PublicGymLike | null | undefined): AmenityGroup<PublicAmenity & { name: string }>[] {
  return groupAmenitiesByCategory(publicAmenitiesOf(gym).map((a, i) => ({ ...a, sortOrder: i })));
}

/** Cover image URL of a card: the server's `coverPhotoUrl`, else the detail's cover / first photo; null when the gym has none. */
export function coverUrlOf(gym: PublicGymLike | null | undefined, apiBase: string): string | null {
  const direct = typeof gym?.coverPhotoUrl === "string" && gym.coverPhotoUrl ? gym.coverPhotoUrl : null;
  if (direct) return resolveListingMediaUrl(direct, apiBase);
  const photos = Array.isArray(gym?.photos) ? (gym!.photos as any[]) : [];
  const pick = photos.find((p) => p?.isCover && typeof p.url === "string") ?? photos.find((p) => typeof p?.url === "string");
  return pick ? resolveListingMediaUrl(pick.url, apiBase) : null;
}

export interface GalleryItem {
  id: string;
  url: string | null;
  category?: string | null;
  isCover?: boolean;
}

/** The detail gallery with every stable `/media/...` URL resolved against the API base (the gallery uses the URL as `<img src>`). */
export function galleryPhotosOf(gym: PublicGymLike | null | undefined, apiBase: string): GalleryItem[] {
  const photos = Array.isArray(gym?.photos) ? (gym!.photos as any[]) : [];
  return photos
    .filter((p) => p && typeof p.id === "string")
    .map((p) => ({ id: p.id, url: resolveListingMediaUrl(typeof p.url === "string" ? p.url : null, apiBase), category: p.category ?? null, isCover: p.isCover === true }));
}

/** 404 on a gym / its plans / its reviews: hidden, suspended, closed or removed since the list was loaded. */
export const isPublicGymGone = (error: unknown): boolean => listingErrorInfo(error).status === 404;
