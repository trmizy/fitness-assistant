/**
 * Listing Management (Phase D2) — the 18 legacy `GymFacility` values and what each one is in the amenity catalogue.
 *
 * `gyms.facilities` is only a MIRROR of `gym_amenities` now (plan B4): the enum labels of the ACTIVE SYSTEM amenities.
 * The amenity catalogue is the source of truth; this table exists for one reason only: a response that carries `facilities` but no
 * `amenities` (an older deployment, a cached response) still renders with proper names and icons.
 *
 * Mirrors gym-service/src/services/amenity-catalog.ts#SYSTEM_AMENITY_SEEDS (a test pins the 18 rows).
 * Pure: runs under `npx tsx --test`.
 */
import type { AmenityCategory, GymFacility } from "../types";

export interface FacilityMeta {
  name: string;
  category: AmenityCategory;
  iconKey: string;
}

export const SYSTEM_FACILITIES: Record<GymFacility, FacilityMeta> = {
  FREE_WEIGHTS: { name: "Tạ tự do", category: "TRAINING_ZONE", iconKey: "dumbbell" },
  CARDIO_MACHINES: { name: "Máy cardio", category: "TRAINING_ZONE", iconKey: "heart-pulse" },
  FUNCTIONAL_TRAINING_AREA: { name: "Khu tập functional", category: "TRAINING_ZONE", iconKey: "activity" },
  GROUP_CLASSES: { name: "Lớp tập nhóm", category: "SERVICE", iconKey: "users" },
  YOGA_STUDIO: { name: "Phòng Yoga", category: "TRAINING_ZONE", iconKey: "flower" },
  SWIMMING_POOL: { name: "Hồ bơi", category: "TRAINING_ZONE", iconKey: "waves" },
  PERSONAL_TRAINER: { name: "Huấn luyện viên cá nhân", category: "SERVICE", iconKey: "user-check" },
  INBODY_SCAN: { name: "Máy đo InBody", category: "SERVICE", iconKey: "scan-line" },
  LOCKER_ROOM: { name: "Phòng thay đồ / tủ khoá", category: "FACILITY", iconKey: "lock" },
  SHOWER: { name: "Phòng tắm", category: "FACILITY", iconKey: "shower-head" },
  SAUNA: { name: "Xông hơi", category: "RECOVERY", iconKey: "flame" },
  TOWEL_SERVICE: { name: "Dịch vụ khăn tắm", category: "SERVICE", iconKey: "shirt" },
  PARKING: { name: "Bãi đỗ xe", category: "FACILITY", iconKey: "car" },
  WIFI: { name: "Wifi miễn phí", category: "FACILITY", iconKey: "wifi" },
  AIR_CONDITIONING: { name: "Máy lạnh", category: "FACILITY", iconKey: "snowflake" },
  DRINKING_WATER: { name: "Nước uống miễn phí", category: "FACILITY", iconKey: "droplets" },
  KIDS_AREA: { name: "Khu vui chơi trẻ em", category: "FACILITY", iconKey: "baby" },
  VENDING_MACHINE: { name: "Máy bán hàng tự động", category: "SERVICE", iconKey: "cup-soda" },
};

/** Vietnamese label of a legacy facility value (an unknown value is shown as it is — never dropped). */
export const FACILITY_LABEL: Record<GymFacility, string> = Object.fromEntries(
  Object.entries(SYSTEM_FACILITIES).map(([k, v]) => [k, v.name]),
) as Record<GymFacility, string>;

export const isGymFacility = (v: string): v is GymFacility => Object.prototype.hasOwnProperty.call(SYSTEM_FACILITIES, v);
