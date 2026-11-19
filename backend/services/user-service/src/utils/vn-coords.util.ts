export const VN_LAT_MIN = 8;
export const VN_LAT_MAX = 24;
export const VN_LNG_MIN = 102;
export const VN_LNG_MAX = 110;

export class VnCoordsValidationError extends Error {
  status = 400;
  code = "INVALID_COORDINATES";
  constructor(message: string) {
    super(message);
    this.name = "VnCoordsValidationError";
  }
}

export type ParsedOptionalCoords =
  | { present: false }
  | { present: true; latitude: null; longitude: null }
  | { present: true; latitude: number; longitude: number };

export function roundCoord6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

/**
 * Validates optional (latitude, longitude) pairs for Vietnam-bounded coordinates.
 * Requires both or neither (or both explicit null to clear), validates finite numbers
 * in [8..24] x [102..110], and rounds to 6 decimal places.
 */
export function parseOptionalVnCoords(
  rawLat: unknown,
  rawLng: unknown,
): ParsedOptionalCoords {
  const latUndefined = rawLat === undefined;
  const lngUndefined = rawLng === undefined;
  if (latUndefined && lngUndefined) {
    return { present: false };
  }
  if (rawLat === null && rawLng === null) {
    return { present: true, latitude: null, longitude: null };
  }
  if (
    latUndefined ||
    lngUndefined ||
    rawLat === null ||
    rawLng === null
  ) {
    throw new VnCoordsValidationError(
      "Vĩ độ và kinh độ phải được cung cấp cùng nhau",
    );
  }
  if (
    typeof rawLat !== "number" ||
    typeof rawLng !== "number" ||
    !Number.isFinite(rawLat) ||
    !Number.isFinite(rawLng)
  ) {
    throw new VnCoordsValidationError(
      "Tọa độ không hợp lệ: vĩ độ và kinh độ phải là số thực hữu hạn",
    );
  }
  if (
    rawLat < VN_LAT_MIN ||
    rawLat > VN_LAT_MAX ||
    rawLng < VN_LNG_MIN ||
    rawLng > VN_LNG_MAX
  ) {
    throw new VnCoordsValidationError(
      `Tọa độ phải nằm trong phạm vi Việt Nam (vĩ độ ${VN_LAT_MIN}..${VN_LAT_MAX}, kinh độ ${VN_LNG_MIN}..${VN_LNG_MAX})`,
    );
  }
  return {
    present: true,
    latitude: roundCoord6(rawLat),
    longitude: roundCoord6(rawLng),
  };
}

