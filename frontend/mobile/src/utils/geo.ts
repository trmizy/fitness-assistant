/**
 * Vietnam's bounding box, islands included (Trường Sa to the south-east, Hoàng Sa to the east, Cà Mau tip,
 * Lũng Cú). Used to refuse drawing a map pin for coordinates that cannot be a Vietnamese branch (a swapped
 * pair, a 0,0, a typo) - N15M-13: markers appeared outside Vietnam. The gym stays in every list; only the
 * marker is not drawn and the map is not centred on it.
 */
export const VIETNAM_BOUNDS = { minLat: 8.0, maxLat: 23.5, minLng: 102.0, maxLng: 117.5 } as const;

export function isInVietnam(latitude: unknown, longitude: unknown): boolean {
  return (
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    latitude >= VIETNAM_BOUNDS.minLat &&
    latitude <= VIETNAM_BOUNDS.maxLat &&
    longitude >= VIETNAM_BOUNDS.minLng &&
    longitude <= VIETNAM_BOUNDS.maxLng
  );
}
