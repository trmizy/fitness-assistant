/**
 * Goal recommendation from body metrics (G4, docs/goal-coherence/GOAL_COHERENCE_AUDIT_AND_DESIGN_20261121.md §3.4).
 *
 * Pure and deterministic: no AI, no I/O. One function, so the roadmap wizard, the profile page and any future caller can never
 * disagree on "what should I aim for, given my body". The AI chat still has its own BMI-only recommender (ai-service
 * conversational-intelligence/recommenders.ts recommendGoal); switching it to this engine is a separate step, not done yet.
 * It SUGGESTS a goal with reasons and caveats; the user always decides. It is never a diagnosis and never writes anything.
 *
 * Evidence discipline (gymini-fitness-science-guardrails): every number shown says whether it is MEASURED (InBody),
 * USER_ENTERED or ESTIMATED (derived). A body-fat figure guessed from a photo ("visual_reference") is NEVER used as a basis.
 * The thresholds are PRODUCT_HEURISTIC screening bands, not clinical cut-offs, and are named and cited below so a reviewer can change them.
 *
 *   BMI            WHO international cut-offs 18.5 / 25 / 30 (WHO Expert Consultation, Lancet 2004;363:157-63 retained them and added
 *                  public-health action points at 23 / 27.5 for Asian populations: used here only as a "borderline" caveat).
 *   Body fat %     Gallagher et al., Am J Clin Nutr 2000;72:694-701 — healthy body-fat bands derived from the BMI 18.5/25/30 limits, by sex
 *                  and age (20-39, 40-59, 60-79). Only the 20-39 rows were confirmed against a secondary table in the 21/11 review; the
 *                  other rows are from the paper as recalled and MUST be reviewed before release. A 2012 NHANES study found the BMI-to-body-
 *                  fat mapping differs by population, so the bands are one reasonable estimate, never a standard.
 *   FFMI           fat-free mass / height^2. Reference range for adults of normal BMI: men 16.7-19.8, women 14.6-16.8 kg/m2
 *                  (Kyle et al. 2003, from the Schutz 2002 cohort). No validated "low" cut-off exists, so it only nudges a suggestion and
 *                  is shown as supporting evidence.
 */
import { computeFfmi } from "./fitness-diagnosis.engine";

export type Goal = "WEIGHT_LOSS" | "MUSCLE_GAIN" | "MAINTENANCE" | "ATHLETIC_PERFORMANCE";
export type BodyFatSource = "MEASURED" | "USER_ENTERED" | "VISUAL_ESTIMATE";
export type RecommendationStatus = "RECOMMENDED" | "USER_CHOICE" | "REVIEW_FIRST" | "INSUFFICIENT_DATA";
export type Confidence = "HIGH" | "MEDIUM" | "LOW";
export type EvidenceKind = "MEASURED" | "USER_ENTERED" | "ESTIMATED";

export interface GoalRecommendationInput {
  age: number | null;
  gender: "MALE" | "FEMALE" | "OTHER" | null;
  heightCm: number | null;
  weightKg: number | null;
  bodyFatPct: number | null;
  bodyFatSource: BodyFatSource | null;
  /** when the InBody reading was taken (MEASURED only) */
  bodyFatMeasuredAt: Date | null;
  experienceLevel: "BEGINNER" | "INTERMEDIATE" | "ADVANCED" | null;
  /** existing safety screening outcome (flags / follow-up suggested / minor) — see nutrition-bootstrap-screening.ts */
  professionalReviewRequired: boolean;
  now: Date;
}

export interface EvidenceRow {
  label: string;
  value: string;
  kind: EvidenceKind;
  note?: string;
}

export interface GoalRecommendation {
  status: RecommendationStatus;
  /** the single suggested goal (RECOMMENDED), or the safe default (REVIEW_FIRST); null when the user should choose */
  recommended: Goal | null;
  /** goals that make sense to choose between (USER_CHOICE) or alongside the suggestion */
  options: Goal[];
  confidence: Confidence | null;
  basis: "BODY_FAT" | "BMI" | "NONE";
  headline: string;
  reasons: string[];
  caveats: string[];
  evidence: EvidenceRow[];
  reasonCodes: string[];
  missing: string[];
}

/** InBody older than this is "stale": the suggestion is still shown but with a lower tier and a caveat. */
export const STALE_AFTER_DAYS = 90;
const BMI = { UNDER: 18.5, BORDERLINE_ASIAN: 23, OVER: 25, OBESE: 30, VERY_LOW: 16 } as const;
/** adults only: below this the adult deficit/surplus logic is not validated; at/above the upper bound, sarcopenia and frailty need a professional */
const ADULT_MIN_AGE = 18;
const REVIEW_AT_AGE = 65;

type BfBand = { under: number; healthyMax: number; overweightMax: number };
// [maxAgeInclusive, band]; Gallagher 2000 (see header for what is and is not verified)
const BF_BANDS: Record<"MALE" | "FEMALE", Array<[number, BfBand]>> = {
  MALE: [
    [39, { under: 8, healthyMax: 19.9, overweightMax: 24.9 }],
    [59, { under: 11, healthyMax: 21.9, overweightMax: 27.9 }],
    [79, { under: 13, healthyMax: 24.9, overweightMax: 29.9 }],
  ],
  FEMALE: [
    [39, { under: 21, healthyMax: 32.9, overweightMax: 38.9 }],
    [59, { under: 23, healthyMax: 33.9, overweightMax: 39.9 }],
    [79, { under: 24, healthyMax: 35.9, overweightMax: 41.9 }],
  ],
};
// Kyle 2003 / Schutz 2002 reference FFMI (kg/m2) for adults of normal BMI
const FFMI_REFERENCE = { MALE: { low: 16.7, high: 19.8 }, FEMALE: { low: 14.6, high: 16.8 } } as const;

export type BfCategory = "UNDER" | "HEALTHY" | "OVERWEIGHT" | "OBESE";

export function bodyFatCategory(gender: "MALE" | "FEMALE", age: number, pct: number): BfCategory {
  const row = BF_BANDS[gender].find(([maxAge]) => age <= maxAge) ?? BF_BANDS[gender][BF_BANDS[gender].length - 1];
  const band = row[1];
  if (pct < band.under) return "UNDER";
  if (pct <= band.healthyMax) return "HEALTHY";
  if (pct <= band.overweightMax) return "OVERWEIGHT";
  return "OBESE";
}

export function computeBmi(weightKg: number, heightCm: number): number {
  const h = heightCm / 100;
  return Math.round((weightKg / (h * h)) * 10) / 10;
}

const vn = (n: number, digits = 1) => n.toLocaleString("vi-VN", { minimumFractionDigits: digits, maximumFractionDigits: digits });
const GOAL_VN: Record<Goal, string> = { WEIGHT_LOSS: "Giảm mỡ", MUSCLE_GAIN: "Tăng cơ", MAINTENANCE: "Duy trì vóc dáng", ATHLETIC_PERFORMANCE: "Hiệu suất thể thao" };

function emptyResult(status: RecommendationStatus, patch: Partial<GoalRecommendation>): GoalRecommendation {
  return { status, recommended: null, options: [], confidence: null, basis: "NONE", headline: "", reasons: [], caveats: [], evidence: [], reasonCodes: [], missing: [], ...patch };
}

export function recommendGoalFromBody(input: GoalRecommendationInput): GoalRecommendation {
  const missing: string[] = [];
  if (!input.heightCm) missing.push("chiều cao");
  if (!input.weightKg) missing.push("cân nặng");
  if (!input.age) missing.push("tuổi");
  if (missing.length > 0) {
    return emptyResult("INSUFFICIENT_DATA", {
      missing,
      headline: "Chưa đủ thông tin để gợi ý",
      reasons: [`Cần thêm ${missing.join(", ")}.`],
    });
  }

  const age = input.age!, heightCm = input.heightCm!, weightKg = input.weightKg!;
  const bmi = computeBmi(weightKg, heightCm);
  const evidence: EvidenceRow[] = [
    { label: "Chỉ số khối cơ thể (BMI)", value: vn(bmi), kind: "ESTIMATED", note: "Tính từ chiều cao và cân nặng" },
  ];

  // ── Safety gates first: these never get a "lose/gain" direction ──────────────────────────────────────────
  const gates: Array<{ code: string; reason: string }> = [];
  if (age < ADULT_MIN_AGE) gates.push({ code: "MINOR", reason: "Bạn dưới 18 tuổi: cơ thể đang phát triển nên Gymini không gợi ý giảm hay tăng cân." });
  if (age >= REVIEW_AT_AGE) gates.push({ code: "AGE_65_PLUS", reason: "Ở tuổi này, thay đổi cân nặng và khối cơ nên có tư vấn của bác sĩ hoặc chuyên gia dinh dưỡng." });
  if (input.professionalReviewRequired && age >= ADULT_MIN_AGE) gates.push({ code: "SCREENING_FLAGS", reason: "Hồ sơ sức khỏe của bạn có lưu ý cần tham khảo chuyên gia trước khi giảm hay tăng cân." });
  if (bmi < BMI.VERY_LOW) gates.push({ code: "VERY_LOW_BMI", reason: "BMI của bạn rất thấp. Hãy gặp bác sĩ để kiểm tra trước khi đặt mục tiêu." });
  if (gates.length > 0) {
    return emptyResult("REVIEW_FIRST", {
      recommended: "MAINTENANCE",
      options: ["MAINTENANCE"],
      headline: "Nên hỏi chuyên gia trước khi chọn hướng giảm hay tăng cân",
      reasons: gates.map((g) => g.reason),
      caveats: ["Trong lúc chờ, mức Duy trì là lựa chọn an toàn nhất. Gợi ý này không phải chẩn đoán."],
      evidence,
      reasonCodes: gates.map((g) => g.code),
      basis: "NONE",
    });
  }

  // ── Which body-fat figure may be used as a basis ────────────────────────────────────────────────────────
  const caveats: string[] = [];
  const reasonCodes: string[] = [];
  const sex = input.gender === "MALE" || input.gender === "FEMALE" ? input.gender : null;
  const ageInBandRange = age <= 64;
  const bfUsable = input.bodyFatPct != null && (input.bodyFatSource === "MEASURED" || input.bodyFatSource === "USER_ENTERED");
  const measuredAgeDays = input.bodyFatMeasuredAt ? Math.floor((input.now.getTime() - input.bodyFatMeasuredAt.getTime()) / 86_400_000) : null;
  const stale = input.bodyFatSource === "MEASURED" && measuredAgeDays != null && measuredAgeDays > STALE_AFTER_DAYS;

  if (input.bodyFatPct != null && input.bodyFatSource === "VISUAL_ESTIMATE") {
    caveats.push("Tỷ lệ mỡ bạn ước lượng qua ảnh chỉ để tham khảo nên Gymini không dùng nó để đưa ra gợi ý.");
    reasonCodes.push("VISUAL_BODY_FAT_IGNORED");
  }
  if (input.bodyFatPct != null && bfUsable) {
    const kind: EvidenceKind = input.bodyFatSource === "MEASURED" ? "MEASURED" : "USER_ENTERED";
    evidence.push({
      label: "Tỷ lệ mỡ cơ thể",
      value: `${vn(input.bodyFatPct)}%`,
      kind,
      note: kind === "MEASURED" ? `InBody${measuredAgeDays != null ? `, đo cách đây ${measuredAgeDays} ngày` : ""}` : "Bạn tự nhập",
    });
  }

  // ── Body-fat based suggestion ──────────────────────────────────────────────────────────────────────────
  if (bfUsable && sex && ageInBandRange) {
    const category = bodyFatCategory(sex, age, input.bodyFatPct!);
    const ffmi = computeFfmi(weightKg, heightCm, input.bodyFatPct!);
    const ref = FFMI_REFERENCE[sex];
    evidence.push({
      label: "Khối nạc trên chiều cao (FFMI)",
      value: vn(ffmi.ffmi),
      kind: "ESTIMATED",
      note: `Người trưởng thành BMI bình thường thường khoảng ${vn(ref.low)}–${vn(ref.high)}`,
    });
    const ffmiLowerHalf = ffmi.ffmi < (ref.low + ref.high) / 2;
    if (age < 20) caveats.push("Khoảng tham chiếu % mỡ được xây dựng cho người từ 20 tuổi, nên với bạn chỉ mang tính tham khảo.");
    caveats.push("Máy đo InBody có thể lệch khi cơ thể mất nước hoặc vừa ăn/tập xong. Hãy so sánh các lần đo cùng điều kiện.");
    if (stale) caveats.push(`Số đo InBody đã cũ (${measuredAgeDays} ngày). Đo lại để gợi ý chính xác hơn.`);
    const tier = (base: Confidence): Confidence => (stale || input.bodyFatSource === "USER_ENTERED" || age < 20 ? (base === "HIGH" ? "MEDIUM" : "LOW") : base);

    if (category === "OVERWEIGHT" || category === "OBESE") {
      if (bmi < BMI.UNDER) {
        // underweight with a high fat share: little muscle, not too much weight. Never a weight-loss direction.
        reasonCodes.push("HIGH_BODY_FAT_UNDERWEIGHT");
        return {
          status: "RECOMMENDED", recommended: "MUSCLE_GAIN", options: ["MUSCLE_GAIN"], confidence: tier("MEDIUM"), basis: "BODY_FAT",
          headline: `Gợi ý: ${GOAL_VN.MUSCLE_GAIN}`,
          reasons: [
            `BMI ${vn(bmi)} thấp hơn khoảng bình thường nên không nên giảm cân, dù tỷ lệ mỡ ${vn(input.bodyFatPct!)}% khá cao.`,
            "Điều này thường cho thấy khối cơ còn ít. Tăng cơ có kiểm soát, ăn đủ đạm và năng lượng là hướng hợp lý.",
          ],
          caveats: [...caveats, "Nếu bạn sụt cân ngoài ý muốn, hãy đi khám."], evidence, reasonCodes, missing: [],
        };
      }
      if (bmi < BMI.BORDERLINE_ASIAN) {
        // high fat at a normal weight: more muscle matters as much as less fat
        reasonCodes.push("HIGH_BODY_FAT_NORMAL_BMI");
        return {
          status: "USER_CHOICE", recommended: null, options: ["WEIGHT_LOSS", "MUSCLE_GAIN"], confidence: tier("MEDIUM"), basis: "BODY_FAT",
          headline: "Tỷ lệ mỡ cao hơn khoảng khoẻ mạnh dù cân nặng bình thường",
          reasons: [
            `Tỷ lệ mỡ ${vn(input.bodyFatPct!)}% cao hơn khoảng tham khảo cho bạn, trong khi BMI ${vn(bmi)} vẫn bình thường.`,
            "Với người như vậy, tập sức mạnh và ăn đủ đạm quan trọng không kém giảm mỡ. Bạn có thể chọn giảm mỡ hoặc tăng cơ tuỳ ưu tiên.",
          ],
          caveats, evidence, reasonCodes, missing: [],
        };
      }
      reasonCodes.push(category === "OBESE" ? "BODY_FAT_OBESE_RANGE" : "BODY_FAT_ABOVE_HEALTHY");
      return {
        status: "RECOMMENDED", recommended: "WEIGHT_LOSS", options: ["WEIGHT_LOSS"], confidence: tier("HIGH"), basis: "BODY_FAT",
        headline: `Gợi ý: ${GOAL_VN.WEIGHT_LOSS}`,
        reasons: [
          `Tỷ lệ mỡ ${vn(input.bodyFatPct!)}% cao hơn khoảng khoẻ mạnh tham khảo cho người cùng giới và độ tuổi.`,
          "Khi tỷ lệ mỡ cao hơn khoảng khoẻ mạnh, giảm mỡ từ từ thường là hướng được ưu tiên.",
        ],
        caveats, evidence, reasonCodes, missing: [],
      };
    }
    if (category === "UNDER") {
      reasonCodes.push("BODY_FAT_BELOW_HEALTHY");
      return {
        status: "RECOMMENDED", recommended: "MUSCLE_GAIN", options: ["MUSCLE_GAIN", "MAINTENANCE"], confidence: tier("MEDIUM"), basis: "BODY_FAT",
        headline: `Gợi ý: ${GOAL_VN.MUSCLE_GAIN}`,
        reasons: [`Tỷ lệ mỡ ${vn(input.bodyFatPct!)}% thấp hơn khoảng tham khảo, nên không cần giảm thêm. Tăng cơ có kiểm soát là hướng hợp lý.`],
        caveats: [...caveats, "Nếu bạn sụt cân ngoài ý muốn, hãy đi khám."], evidence, reasonCodes, missing: [],
      };
    }
    // healthy body fat
    if (bmi >= BMI.OVER) {
      reasonCodes.push("HIGH_BMI_HEALTHY_BODY_FAT");
      return {
        status: "USER_CHOICE", recommended: null, options: ["MAINTENANCE", "MUSCLE_GAIN"], confidence: tier("MEDIUM"), basis: "BODY_FAT",
        headline: "BMI cao nhưng tỷ lệ mỡ ở mức khoẻ mạnh",
        reasons: [
          `BMI ${vn(bmi)} nằm ở mức thừa cân, nhưng tỷ lệ mỡ ${vn(input.bodyFatPct!)}% vẫn trong khoảng khoẻ mạnh. BMI không phân biệt cơ với mỡ nên có thể bạn nhiều cơ.`,
          "Bạn không cần giảm cân chỉ vì BMI. Duy trì hoặc tăng cơ đều hợp lý.",
        ],
        caveats, evidence, reasonCodes, missing: [],
      };
    }
    if (ffmiLowerHalf) {
      reasonCodes.push("HEALTHY_FAT_LOW_FFMI");
      return {
        status: "RECOMMENDED", recommended: "MUSCLE_GAIN", options: ["MUSCLE_GAIN", "MAINTENANCE"], confidence: tier("MEDIUM"), basis: "BODY_FAT",
        headline: `Gợi ý: ${GOAL_VN.MUSCLE_GAIN}`,
        reasons: [
          `Tỷ lệ mỡ ${vn(input.bodyFatPct!)}% đang ở mức khoẻ mạnh nên không cần giảm mỡ.`,
          "Khối nạc trên chiều cao của bạn nằm ở nửa thấp của khoảng tham khảo, nên tăng cơ là hướng có nhiều dư địa nhất.",
        ],
        caveats: [...caveats, "Khoảng FFMI là mức tham chiếu của dân số, không phải mục tiêu cho riêng bạn."], evidence, reasonCodes, missing: [],
      };
    }
    reasonCodes.push("HEALTHY_COMPOSITION");
    return {
      status: "USER_CHOICE", recommended: null, options: ["MUSCLE_GAIN", "MAINTENANCE"], confidence: tier("MEDIUM"), basis: "BODY_FAT",
      headline: "Cơ thể bạn đang ở mức cân đối, bạn tự chọn hướng",
      reasons: [`Tỷ lệ mỡ ${vn(input.bodyFatPct!)}% và BMI ${vn(bmi)} đều trong khoảng khoẻ mạnh, nên cả duy trì lẫn tăng cơ đều hợp lý.`],
      caveats, evidence, reasonCodes, missing: [],
    };
  }

  // ── BMI-only suggestion (no usable body-fat figure) ────────────────────────────────────────────────────
  caveats.push("Gymini chưa có số đo tỷ lệ mỡ của bạn. BMI không phân biệt cơ với mỡ, nên hãy đo InBody để gợi ý chính xác hơn.");
  if (input.bodyFatPct != null && bfUsable && !sex) caveats.push("Khoảng tỷ lệ mỡ tham chiếu chỉ có cho nam và nữ, nên Gymini dùng BMI cho bạn.");
  if (input.bodyFatPct != null && bfUsable && !ageInBandRange) caveats.push("Khoảng tỷ lệ mỡ tham chiếu chỉ áp dụng đến 64 tuổi, nên Gymini dùng BMI cho bạn.");
  reasonCodes.push("BMI_ONLY");
  const trained = input.experienceLevel === "INTERMEDIATE" || input.experienceLevel === "ADVANCED";

  if (bmi >= BMI.OBESE) {
    reasonCodes.push("BMI_OBESE_RANGE");
    return { status: "RECOMMENDED", recommended: "WEIGHT_LOSS", options: ["WEIGHT_LOSS"], confidence: "MEDIUM", basis: "BMI", headline: `Gợi ý: ${GOAL_VN.WEIGHT_LOSS}`,
      reasons: [`BMI ${vn(bmi)} ở mức béo phì theo phân loại của WHO, nên giảm mỡ từ từ là hướng nên ưu tiên.`], caveats, evidence, reasonCodes, missing: [] };
  }
  if (bmi >= BMI.OVER) {
    if (trained) {
      reasonCodes.push("BMI_HIGH_TRAINED");
      return { status: "USER_CHOICE", recommended: null, options: ["WEIGHT_LOSS", "MAINTENANCE", "MUSCLE_GAIN"], confidence: "LOW", basis: "BMI", headline: "BMI cao, nhưng bạn đã tập luyện nên cần thêm số đo",
        reasons: [`BMI ${vn(bmi)} ở mức thừa cân, nhưng người tập luyện lâu năm có thể có BMI cao do nhiều cơ. Hãy đo InBody trước khi chọn giảm mỡ.`], caveats, evidence, reasonCodes, missing: [] };
    }
    return { status: "RECOMMENDED", recommended: "WEIGHT_LOSS", options: ["WEIGHT_LOSS", "MAINTENANCE"], confidence: "LOW", basis: "BMI", headline: `Gợi ý: ${GOAL_VN.WEIGHT_LOSS}`,
      reasons: [`BMI ${vn(bmi)} cao hơn khoảng bình thường (18,5 đến 24,9), nên giảm mỡ là hướng thường được ưu tiên.`], caveats, evidence, reasonCodes, missing: [] };
  }
  if (bmi >= BMI.BORDERLINE_ASIAN) {
    reasonCodes.push("BMI_BORDERLINE_ASIAN");
    return { status: "USER_CHOICE", recommended: null, options: ["WEIGHT_LOSS", "MAINTENANCE", "MUSCLE_GAIN"], confidence: "LOW", basis: "BMI", headline: "BMI ở ngưỡng cần để ý, bạn tự chọn hướng",
      reasons: [`BMI ${vn(bmi)} còn trong khoảng bình thường theo WHO, nhưng với người châu Á từ 23 trở lên đã bắt đầu tăng nguy cơ sức khoẻ. Giảm mỡ nhẹ hoặc duy trì đều hợp lý.`], caveats, evidence, reasonCodes, missing: [] };
  }
  if (bmi < BMI.UNDER) {
    reasonCodes.push("BMI_UNDERWEIGHT");
    return { status: "RECOMMENDED", recommended: "MUSCLE_GAIN", options: ["MUSCLE_GAIN", "MAINTENANCE"], confidence: "MEDIUM", basis: "BMI", headline: `Gợi ý: ${GOAL_VN.MUSCLE_GAIN}`,
      reasons: [`BMI ${vn(bmi)} thấp hơn khoảng bình thường, nên tăng cân theo hướng tăng cơ là hợp lý.`], caveats: [...caveats, "Nếu bạn sụt cân ngoài ý muốn, hãy đi khám."], evidence, reasonCodes, missing: [] };
  }
  return { status: "USER_CHOICE", recommended: null, options: ["MUSCLE_GAIN", "MAINTENANCE"], confidence: "LOW", basis: "BMI", headline: "BMI bình thường, bạn tự chọn hướng",
    reasons: [`BMI ${vn(bmi)} nằm trong khoảng bình thường, nên cả tăng cơ lẫn duy trì đều hợp lý. Chọn theo điều bạn muốn.`], caveats, evidence, reasonCodes, missing: [] };
}
