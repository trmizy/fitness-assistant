/**
 * AI Nutrition Cycle Engine (Gymini) — regional personalization data for
 * nutrition-food-suggestion.engine.ts and nutrition-food-substitution.engine.ts.
 *
 * Grounded in real research on Vietnamese regional cuisine (not invented),
 * done 2026-09-07 — see sources below. Deliberately 3 macro-regions (Bắc/
 * Trung/Nam), the granularity Vietnamese people actually self-identify by
 * for food culture, not 63 provinces. `UserProfile.region` is optional —
 * unset means "national" (today's existing behavior, unchanged).
 *
 * Sources:
 * - https://pasgo.vn/blog/dac-trung-am-thuc-ba-mien-bac-trung-nam-3799
 * - https://huongvietmart.vn/am-thuc-ba-mien-bac-trung-nam/
 * - https://buffetposeidon.com/tin-tuc/bi-mat-gia-vi-am-thuc-ba-mien-bac-trung-nam
 * - https://thucphamhuongduong.com/mam-tom-mam-nem-mam-ruoc/
 *
 * Key facts these lists encode:
 *   - Miền Bắc: thanh đạm, ít cay, ít ngọt; nước mắm pha loãng chanh/giấm,
 *     mắm tôm; ưa đậu phụ, cá nước ngọt, luộc/hấp.
 *   - Miền Trung: cay nồng, đậm đà; mắm ruốc/mắm nêm; ưa hải sản (cá biển,
 *     tôm), kho/rim đậm vị.
 *   - Miền Nam: vị ngọt (đường, nước dừa); ưa cá nước ngọt vùng đồng bằng
 *     sông Cửu Long (cá basa/cá tra), tôm, canh chua, kho nước dừa.
 *
 * IMPORTANT — what this does NOT claim: the underlying nutrition numbers
 * always come from the generic ingredient in the Food catalog (e.g. "cá
 * basa" = raw/cooked basa fish's real macros), never a composite-dish
 * estimate (no fabricated "bún bò Huế has X kcal" — this repo has no
 * Vietnamese composite-dish nutrition database, only USDA-based single
 * ingredients + a Vietnamese alias layer). The prep-style label is a
 * cooking-style SUGGESTION in the user's own regional style, presented as
 * exactly that — never implied to change the stated macro numbers.
 */

export type VietnameseRegion = "BAC" | "TRUNG" | "NAM";

export const VIETNAMESE_REGIONS: VietnameseRegion[] = ["BAC", "TRUNG", "NAM"];

export function isVietnameseRegion(value: unknown): value is VietnameseRegion {
  return value === "BAC" || value === "TRUNG" || value === "NAM";
}

export const REGION_LABEL_VI: Record<VietnameseRegion, string> = {
  BAC: "Miền Bắc",
  TRUNG: "Miền Trung",
  NAM: "Miền Nam",
};

// Culturally-typical protein sources per region, most-typical first. Used
// only to REORDER an already budget-filtered candidate pool (see
// orderByRegionPriority below) — never to bypass the budget tier (a LOW
// budget user in Miền Trung still never sees tôm/cá hồi if those aren't in
// PROTEIN_QUERIES.LOW to begin with).
export const REGION_PROTEIN_PRIORITY: Record<VietnameseRegion, string[]> = {
  // Thanh đạm, ít cay — đậu phụ và cá nước ngọt (rô phi) rất phổ biến,
  // luộc/hấp là cách chế biến hằng ngày phổ biến nhất.
  BAC: ["đậu hũ", "đậu phụ", "trứng", "cá rô phi", "ức gà", "thịt heo nạc"],
  // Hải sản + cay đậm là đặc trưng rõ nhất; cá thu là cá biển phổ thông,
  // rẻ, sẵn có quanh năm ở miền Trung.
  TRUNG: ["cá thu", "tôm", "thịt heo nạc", "ức gà", "trứng", "đậu hũ"],
  // Cá basa/cá tra (cá nước ngọt Đồng bằng sông Cửu Long) và tôm là nguồn
  // đạm hằng ngày rất phổ biến, giá rẻ.
  NAM: ["cá basa", "tôm", "đậu hũ", "ức gà", "thịt heo nạc"],
};

// A short, honest cooking-style suggestion in the user's regional style —
// descriptive text only (see file header), never a nutrition claim.
export const REGION_PREP_STYLE_VI: Record<VietnameseRegion, string> = {
  BAC: "chế biến kiểu Bắc: luộc hoặc hấp thanh đạm, chấm nước mắm pha chanh/giấm, ít cay",
  TRUNG: "chế biến kiểu Trung: kho hoặc rim cay với ớt, dùng kèm mắm ruốc/mắm nêm",
  NAM: "chế biến kiểu Nam: kho với nước dừa hoặc nấu canh chua",
};

/**
 * Stable-reorders `candidateQueries` (already the budget-appropriate pool —
 * this function never adds anything not already in that list) so entries
 * that also appear in the region's priority list come first, in that
 * priority's relative order; everything else keeps its original relative
 * order. `region == null` (not set, or a request with no region context)
 * returns the input completely unchanged — the existing, pre-region
 * behavior for every profile that hasn't set this new, optional field.
 */
export function orderByRegionPriority(
  candidateQueries: string[],
  region: VietnameseRegion | null | undefined,
): string[] {
  if (!region) return candidateQueries;
  const priority = REGION_PROTEIN_PRIORITY[region];
  if (!priority) return candidateQueries;
  const priorityIndex = new Map(priority.map((q, i) => [q, i]));
  return [...candidateQueries].sort((a, b) => {
    const ai = priorityIndex.get(a) ?? Number.MAX_SAFE_INTEGER;
    const bi = priorityIndex.get(b) ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return candidateQueries.indexOf(a) - candidateQueries.indexOf(b);
  });
}
