/**
 * "How far is each branch from the client" for `GET /contracts/gym-options`.
 *
 * ONE definition shared with the gym search page (gym-service `gym-search.service.ts`):
 *   - client reference point = the centre of the client's saved search ward (UserProfile.searchWardCode,
 *     resolved by `resolveReferencePoint` in agentic-pt-location.ts - the same source the AI PT search and the
 *     PT search page use). A client with only a province, or nothing, has no point -> no distance.
 *   - branch point = Gym.latitude / Gym.longitude (a branch without a pin has no distance).
 *   - formula = Haversine, earth radius 6371.0088 km, rounded to 0.1 km (identical to the SQL in gym-search).
 * Pure functions only; the ordering helper never reorders anything when no branch has a distance.
 */

const EARTH_RADIUS_KM = 6371.0088;
// Same plausibility box gym-search applies to a ward centroid: a coordinate outside Vietnam is bad data, not a distance.
const VN_LAT_MIN = 8;
const VN_LAT_MAX = 24;
const VN_LNG_MIN = 102;
const VN_LNG_MAX = 110;

const rad = (deg: number) => (deg * Math.PI) / 180;

function validPoint(lat: unknown, lng: unknown): lat is number {
  return (
    typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= VN_LAT_MIN && lat <= VN_LAT_MAX && lng >= VN_LNG_MIN && lng <= VN_LNG_MAX
  );
}

/** Great-circle distance in km, rounded to 1 decimal; null when either point is missing or outside Vietnam. */
export function gymDistanceKm(
  ref: { lat: number | null; lng: number | null } | null | undefined,
  gym: { latitude?: number | null; longitude?: number | null } | null | undefined,
): number | null {
  if (!ref || !gym) return null;
  if (!validPoint(ref.lat, ref.lng) || !validPoint(gym.latitude, gym.longitude)) return null;
  const dLat = rad(gym.latitude! - ref.lat!);
  const dLng = rad(gym.longitude! - ref.lng!);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(ref.lat!)) * Math.cos(rad(gym.latitude!)) * Math.sin(dLng / 2) ** 2;
  const km = 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(Math.min(1, h)));
  return Math.round(km * 10) / 10;
}

/**
 * Nearest first, branches with no distance last. `tieBreak` is the caller's existing ordering, used between equal
 * distances and between the unknowns. When NO branch has a distance the input order is kept untouched.
 */
export function sortByDistanceNullsLast<T extends { distanceKm: number | null }>(
  items: T[],
  tieBreak: (a: T, b: T) => number,
): T[] {
  if (!items.some((i) => i.distanceKm !== null)) return items;
  return [...items].sort((a, b) => {
    if (a.distanceKm !== b.distanceKm) {
      if (a.distanceKm === null) return 1;
      if (b.distanceKm === null) return -1;
      return a.distanceKm - b.distanceKm;
    }
    return tieBreak(a, b);
  });
}
