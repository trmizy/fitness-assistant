// Option lists the product itself uses (copied from the web forms / shared constants, NOT invented):
//  - SPECIALTIES: frontend/web/src/app/constants/specialties.ts
//  - TARGET_GROUPS / TRAINING_GOALS / YEARS: frontend/web/src/app/pages/client/PTApplicationPage.tsx
//  - AMENITY enum slugs: gym-service amenity-catalog.ts
export const SPECIALTIES = [
  "Tăng cơ", "Giảm mỡ", "Powerlifting", "Thể hình", "Calisthenics", "Yoga", "Phục hồi chấn thương", "Dinh dưỡng thể thao",
  "HIIT", "Functional Training", "Sức bền", "Dẻo dai & Vận động", "Thể thao thành tích", "Boxing & MMA",
];
export const TARGET_GROUPS = [
  "Beginners", "Weight-loss clients", "Postpartum women", "Advanced trainees", "Office workers", "Athletes", "Rehab clients",
  "Seniors", "Teens / Youth", "Competitive bodybuilders",
];
export const TRAINING_GOALS = [
  "Fat Loss & Body Recomposition", "Muscle Building & Hypertrophy", "Strength & Powerlifting", "Rehabilitation & Injury Recovery",
  "Sports Performance", "General Fitness & Health",
];
export const YEARS_OF_EXPERIENCE = ["<1", "1-3", "3-5", "5-10", "10+"];
export const LANGUAGES = ["Tiếng Việt", "English", "日本語", "한국어", "中文"];
export const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const WEEKDAY_ENUM = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];

export const SYSTEM_AMENITIES = [
  "FREE_WEIGHTS", "CARDIO_MACHINES", "FUNCTIONAL_TRAINING_AREA", "GROUP_CLASSES", "YOGA_STUDIO", "SWIMMING_POOL", "PERSONAL_TRAINER",
  "INBODY_SCAN", "LOCKER_ROOM", "SHOWER", "SAUNA", "TOWEL_SERVICE", "PARKING", "WIFI", "AIR_CONDITIONING", "DRINKING_WATER", "KIDS_AREA",
  "VENDING_MACHINE",
];

// Catalogue additions an ADMIN creates (POST /admin/amenities). "Nước uống miễn phí" from the plan is NOT here: its normalised name equals
// the SYSTEM row DRINKING_WATER ("Nước uống miễn phí"), so the catalogue would refuse it as a duplicate - see SEED.md "Questions".
export const CUSTOM_CATALOGUE_AMENITIES = [
  { key: "stretching", name: "Khu stretching", category: "TRAINING_ZONE", iconKey: "footprints", sortOrder: 190 },
  { key: "recovery", name: "Khu recovery", category: "RECOVERY", iconKey: "sparkles", sortOrder: 200 },
  { key: "gym-towel", name: "Khăn tập", category: "SERVICE", iconKey: "shirt", sortOrder: 210 },
];

export const BANKS = [
  ["Vietcombank", "VCB"], ["Techcombank", "TCB"], ["MB Bank", "MB"], ["ACB", "ACB"], ["BIDV", "BIDV"], ["VPBank", "VPB"], ["TPBank", "TPB"], ["Sacombank", "STB"],
];

export const INJURIES = ["đau lưng dưới", "đau gối trái", "đau vai phải", "viêm gân khuỷu tay", "thoát vị đĩa đệm nhẹ", "bong gân cổ chân cũ", "đau cổ do ngồi nhiều"];
export const EQUIPMENT = ["barbell", "dumbbells", "machines", "cables", "bodyweight", "kettlebell", "resistance bands", "pull-up bar"];
export const DIETS = ["Ăn cân bằng", "Ít tinh bột", "Nhiều đạm", "Ăn chay", "Ăn sạch (eat clean)", "Không kiêng"];
