/**
 * Listing Management (Phase D1) — the amenity icon allowlist and the amenity categories.
 *
 * `AMENITY_ICON_KEYS` is the 30-key allowlist from gym-service/src/services/amenity-catalog.ts
 * (18 SYSTEM keys, then 12 general ones; every key is a lucide icon name). The server also returns its own copy
 * in GET /admin/amenities (`iconKeys`), and the admin picker uses THAT list — this one is the web's mapping table.
 *
 * `AMENITY_ICON_PHOSPHOR` maps each key to the Phosphor export (web uses Phosphor, see
 * docs/features/GYMINI_PHOSPHOR_ICON_MIGRATION_REPORT.md) — kept as names so this file stays free of React;
 * components/listing/amenityIconMap.ts holds the actual components, and a test asserts every key is covered.
 * It is the ONLY place that decides which Phosphor icon stands for which key.
 */
import type { AmenityCategory } from "../types";

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

/** lucide key → Phosphor export name (without the `Icon` suffix). */
export const AMENITY_ICON_PHOSPHOR: Record<AmenityIconKey, string> = {
  dumbbell: "Barbell",
  "heart-pulse": "Heartbeat",
  activity: "Pulse",
  users: "Users",
  flower: "FlowerLotus",
  waves: "Waves",
  "user-check": "UserCheck",
  "scan-line": "Scan",
  lock: "Lock",
  "shower-head": "Shower",
  flame: "Fire",
  shirt: "TShirt",
  car: "Car",
  wifi: "WifiHigh",
  snowflake: "Snowflake",
  droplets: "Drop",
  baby: "Baby",
  "cup-soda": "Storefront", // vending machine — Phosphor has no soda cup
  bike: "Bicycle",
  coffee: "Coffee",
  sparkles: "Sparkle",
  sun: "Sun",
  music: "MusicNotes",
  star: "Star",
  footprints: "Footprints",
  trophy: "Trophy",
  timer: "Timer",
  zap: "Lightning",
  medal: "Medal",
  utensils: "ForkKnife",
};

export const isKnownAmenityIcon = (key: string): key is AmenityIconKey => (AMENITY_ICON_KEYS as readonly string[]).includes(key);

/** Vietnamese names of the Phosphor-mapped icons for the picker's tooltip / aria-label. */
export const AMENITY_ICON_LABEL_VI: Record<AmenityIconKey, string> = {
  dumbbell: "Tạ",
  "heart-pulse": "Nhịp tim",
  activity: "Vận động",
  users: "Nhóm",
  flower: "Yoga",
  waves: "Bơi lội",
  "user-check": "Huấn luyện viên",
  "scan-line": "Máy quét",
  lock: "Tủ khóa",
  "shower-head": "Phòng tắm",
  flame: "Xông hơi",
  shirt: "Khăn / đồ",
  car: "Bãi xe",
  wifi: "Wifi",
  snowflake: "Máy lạnh",
  droplets: "Nước uống",
  baby: "Trẻ em",
  "cup-soda": "Bán hàng tự động",
  bike: "Xe đạp",
  coffee: "Cà phê",
  sparkles: "Nổi bật",
  sun: "Ánh sáng",
  music: "Âm nhạc",
  star: "Ngôi sao",
  footprints: "Chạy bộ",
  trophy: "Giải thưởng",
  timer: "Bấm giờ",
  zap: "Năng lượng",
  medal: "Huy chương",
  utensils: "Ăn uống",
};

// ── categories ───────────────────────────────────────────────────────────────────────────────
export const AMENITY_CATEGORIES: readonly AmenityCategory[] = ["FACILITY", "TRAINING_ZONE", "SERVICE", "RECOVERY"];

/** Display names of the four categories (the plan fixes the four groups, not their wording — see report). */
export const AMENITY_CATEGORY_LABEL: Record<AmenityCategory, string> = {
  FACILITY: "Cơ sở vật chất",
  TRAINING_ZONE: "Khu tập luyện",
  SERVICE: "Dịch vụ",
  RECOVERY: "Phục hồi",
};

export const amenityCategoryLabel = (c: string): string => AMENITY_CATEGORY_LABEL[c as AmenityCategory] ?? "Khác";
