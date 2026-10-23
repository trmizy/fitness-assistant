/**
 * Listing Management (M2) — the amenity icon allowlist and the amenity categories, the pure half.
 *
 * `AMENITY_ICON_KEYS` is the 30-key allowlist of gym-service (amenity-catalog.ts#AMENITY_ICON_KEYS: the 18 SYSTEM
 * keys, then 12 general ones). Every key is a lucide icon name, which is exactly the icon set this app ships, so
 * mobile maps each key to its lucide-react-native export by NAME here and `AmenityIcon.tsx` resolves the component.
 * A key outside the allowlist (the server may add one later) draws the generic icon — never a crash, never the raw key.
 *
 * No React, no Expo import: runs under `tsx --test`.
 */
export const AMENITY_ICON_KEYS = [
  // the 18 SYSTEM amenities
  "dumbbell",
  "heart-pulse",
  "activity",
  "users",
  "flower",
  "waves",
  "user-check",
  "scan-line",
  "lock",
  "shower-head",
  "flame",
  "shirt",
  "car",
  "wifi",
  "snowflake",
  "droplets",
  "baby",
  "cup-soda",
  // 12 general-purpose additions
  "bike",
  "coffee",
  "sparkles",
  "sun",
  "music",
  "star",
  "footprints",
  "trophy",
  "timer",
  "zap",
  "medal",
  "utensils",
] as const;

export type AmenityIconKey = (typeof AMENITY_ICON_KEYS)[number];

/** allowlist key → lucide-react-native export name. */
export const AMENITY_ICON_LUCIDE: Record<AmenityIconKey, string> = {
  dumbbell: "Dumbbell",
  "heart-pulse": "HeartPulse",
  activity: "Activity",
  users: "Users",
  flower: "Flower",
  waves: "Waves",
  "user-check": "UserCheck",
  "scan-line": "ScanLine",
  lock: "Lock",
  "shower-head": "ShowerHead",
  flame: "Flame",
  shirt: "Shirt",
  car: "Car",
  wifi: "Wifi",
  snowflake: "Snowflake",
  droplets: "Droplets",
  baby: "Baby",
  "cup-soda": "CupSoda",
  bike: "Bike",
  coffee: "Coffee",
  sparkles: "Sparkles",
  sun: "Sun",
  music: "Music",
  star: "Star",
  footprints: "Footprints",
  trophy: "Trophy",
  timer: "Timer",
  zap: "Zap",
  medal: "Medal",
  utensils: "Utensils",
};

/** The icon for a key the app does not know. */
export const GENERIC_AMENITY_ICON = "Sparkles";

export const isKnownAmenityIcon = (key: string | null | undefined): key is AmenityIconKey =>
  typeof key === "string" && (AMENITY_ICON_KEYS as readonly string[]).includes(key);

/** The lucide export name that stands for a key (the generic one for an unknown / missing key). */
export function amenityIconName(key: string | null | undefined): string {
  return isKnownAmenityIcon(key) ? AMENITY_ICON_LUCIDE[key] : GENERIC_AMENITY_ICON;
}

// ── categories ────────────────────────────────────────────────────────────────────────────────
export type AmenityCategory = "FACILITY" | "TRAINING_ZONE" | "SERVICE" | "RECOVERY";

export const AMENITY_CATEGORIES: readonly AmenityCategory[] = ["FACILITY", "TRAINING_ZONE", "SERVICE", "RECOVERY"];

/** Same wording as web (utils/amenityIcons.ts): the plan fixes the four groups, not their names. */
export const AMENITY_CATEGORY_LABEL: Record<AmenityCategory, string> = {
  FACILITY: "Cơ sở vật chất",
  TRAINING_ZONE: "Khu tập luyện",
  SERVICE: "Dịch vụ",
  RECOVERY: "Phục hồi",
};

export const amenityCategoryLabel = (c: string | null | undefined): string => AMENITY_CATEGORY_LABEL[c as AmenityCategory] ?? "Khác";

export const isAmenityCategory = (c: unknown): c is AmenityCategory => (AMENITY_CATEGORIES as readonly unknown[]).includes(c);

export type IconAmenity = { id?: string; slug?: string; name: string; category: string; iconKey: string };

export type AmenityGroup<T extends IconAmenity> = { category: string; label: string; items: T[] };

/**
 * Groups amenities by category in the fixed category order (an unknown category goes last under "Khác"),
 * keeping the server's order inside each group (sortOrder, then name — already how the server sends them),
 * dropping empty groups.
 */
export function groupAmenities<T extends IconAmenity>(list: T[]): AmenityGroup<T>[] {
  const known = new Set<string>(AMENITY_CATEGORIES);
  const groups: AmenityGroup<T>[] = AMENITY_CATEGORIES.map((c) => ({
    category: c,
    label: AMENITY_CATEGORY_LABEL[c],
    items: list.filter((a) => a.category === c),
  }));
  const other = list.filter((a) => !known.has(a.category));
  if (other.length > 0) groups.push({ category: "OTHER", label: "Khác", items: other });
  return groups.filter((g) => g.items.length > 0);
}
