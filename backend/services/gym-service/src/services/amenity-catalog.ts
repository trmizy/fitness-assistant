/**
 * Listing Management, Phase B1 — the amenity catalogue's code-side constants.
 *
 * `SYSTEM_AMENITY_SEEDS` is the ONE description of the 18 SYSTEM rows the migration
 * `*_amenity_catalog_listing_revisions` inserts (one per `GymFacility` enum value, slug = the enum label
 * verbatim). The migration SQL is hand-written, so `amenity-facility-contract.test.ts` is what keeps this file,
 * the Prisma enum, the migration's seed rows and the web/mobile FACILITY_LABEL tables from drifting apart.
 *
 * ⚠ `category`, `iconKey` and `sortOrder` of these seeds are a PROVISIONAL choice (the plan fixes the four
 * categories and says "icon from an allowlist of ~30 keys" but does not assign either to the 18 rows) — see the
 * Phase B1 report, "QUESTIONS FOR NGÀI".
 */

export const AMENITY_CATEGORIES = ['FACILITY', 'TRAINING_ZONE', 'SERVICE', 'RECOVERY'] as const;
export type AmenityCategoryValue = (typeof AMENITY_CATEGORIES)[number];

export interface SystemAmenitySeed {
  /** Exactly the `GymFacility` enum label. */
  slug: string;
  /** Vietnamese display name — same text as FACILITY_LABEL on web and mobile. */
  name: string;
  category: AmenityCategoryValue;
  iconKey: string;
  sortOrder: number;
}

export const SYSTEM_AMENITY_SEEDS: readonly SystemAmenitySeed[] = [
  { slug: 'FREE_WEIGHTS', name: 'Tạ tự do', category: 'TRAINING_ZONE', iconKey: 'dumbbell', sortOrder: 10 },
  { slug: 'CARDIO_MACHINES', name: 'Máy cardio', category: 'TRAINING_ZONE', iconKey: 'heart-pulse', sortOrder: 20 },
  { slug: 'FUNCTIONAL_TRAINING_AREA', name: 'Khu tập functional', category: 'TRAINING_ZONE', iconKey: 'activity', sortOrder: 30 },
  { slug: 'GROUP_CLASSES', name: 'Lớp tập nhóm', category: 'SERVICE', iconKey: 'users', sortOrder: 40 },
  { slug: 'YOGA_STUDIO', name: 'Phòng Yoga', category: 'TRAINING_ZONE', iconKey: 'flower', sortOrder: 50 },
  { slug: 'SWIMMING_POOL', name: 'Hồ bơi', category: 'TRAINING_ZONE', iconKey: 'waves', sortOrder: 60 },
  { slug: 'PERSONAL_TRAINER', name: 'Huấn luyện viên cá nhân', category: 'SERVICE', iconKey: 'user-check', sortOrder: 70 },
  { slug: 'INBODY_SCAN', name: 'Máy đo InBody', category: 'SERVICE', iconKey: 'scan-line', sortOrder: 80 },
  { slug: 'LOCKER_ROOM', name: 'Phòng thay đồ / tủ khoá', category: 'FACILITY', iconKey: 'lock', sortOrder: 90 },
  { slug: 'SHOWER', name: 'Phòng tắm', category: 'FACILITY', iconKey: 'shower-head', sortOrder: 100 },
  { slug: 'SAUNA', name: 'Xông hơi', category: 'RECOVERY', iconKey: 'flame', sortOrder: 110 },
  { slug: 'TOWEL_SERVICE', name: 'Dịch vụ khăn tắm', category: 'SERVICE', iconKey: 'shirt', sortOrder: 120 },
  { slug: 'PARKING', name: 'Bãi đỗ xe', category: 'FACILITY', iconKey: 'car', sortOrder: 130 },
  { slug: 'WIFI', name: 'Wifi miễn phí', category: 'FACILITY', iconKey: 'wifi', sortOrder: 140 },
  { slug: 'AIR_CONDITIONING', name: 'Máy lạnh', category: 'FACILITY', iconKey: 'snowflake', sortOrder: 150 },
  { slug: 'DRINKING_WATER', name: 'Nước uống miễn phí', category: 'FACILITY', iconKey: 'droplets', sortOrder: 160 },
  { slug: 'KIDS_AREA', name: 'Khu vui chơi trẻ em', category: 'FACILITY', iconKey: 'baby', sortOrder: 170 },
  { slug: 'VENDING_MACHINE', name: 'Máy bán hàng tự động', category: 'SERVICE', iconKey: 'cup-soda', sortOrder: 180 },
] as const;

/** One slug per `GymFacility` enum value — the contract test compares this with the Prisma enum. */
export const SYSTEM_AMENITY_SLUGS: readonly string[] = SYSTEM_AMENITY_SEEDS.map((s) => s.slug);

/**
 * The icon allowlist (AMENITY_ICON_KEYS, 30 keys) an admin may pick from for a catalogue amenity; web and mobile map each key
 * to their own icon set. The first 18 are the keys the SYSTEM rows use; the 12 after them are general-purpose additions
 * (Ngài, Phase B2 follow-up). Every key is a lucide icon name (checked against lucide-react-native 1.47, the set mobile ships).
 */
export const AMENITY_ICON_KEYS: readonly string[] = [
  ...SYSTEM_AMENITY_SEEDS.map((s) => s.iconKey),
  'bike',
  'coffee',
  'sparkles',
  'sun',
  'music',
  'star',
  'footprints',
  'trophy',
  'timer',
  'zap',
  'medal',
  'utensils',
];

/**
 * Canonical form of an amenity name for the unique `name_normalized` column: Unicode-decomposed, accents stripped
 * (đ → d), lower-cased, whitespace collapsed. "Phòng boxing" and "phong BOXING" normalise to the same string.
 * The migration's seed rows carry values produced by this function (the contract test re-derives them).
 */
export function normalizeAmenityName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/[đĐ]/g, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}
