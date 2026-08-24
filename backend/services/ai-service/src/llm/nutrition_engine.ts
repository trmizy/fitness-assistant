/**
 * Deterministic nutrition calculation + validation engine.
 *
 * Root-cause context: the AI chat's nutrition answers were previously
 * produced either by (a) a hard-coded "no saved meal plan" template
 * (nutrition_context.ts) or (b) an LLM asked to do its own arithmetic with
 * no server-side check. Neither path validated that a stored/quoted target
 * (e.g. "3000 kcal | 150g protein | 200g carb | 65g fat") actually adds up
 * (150*4 + 200*4 + 65*9 = 1985 kcal, not 3000), and neither resolved a
 * conflict between the profile's cached weight and a weight the user just
 * typed in the current message.
 *
 * This module is the single source of truth for that arithmetic — the LLM
 * is only ever allowed to explain a result computed here, never invent its
 * own. Every exported function is pure (no I/O), so it is fully unit
 * testable without a running LLM/DB.
 */

// ── Atwater conversion ───────────────────────────────────────────────────

export const ATWATER_KCAL_PER_GRAM = {
  protein: 4,
  carb: 4,
  fat: 9,
} as const;

export function computeMacroCalories(
  proteinG: number,
  carbG: number,
  fatG: number,
): number {
  return (
    proteinG * ATWATER_KCAL_PER_GRAM.protein +
    carbG * ATWATER_KCAL_PER_GRAM.carb +
    fatG * ATWATER_KCAL_PER_GRAM.fat
  );
}

// PRODUCT_HEURISTIC: 50 kcal absolute tolerance mirrors the existing
// meal-plan-validator.ts convention used for the training-cycle
// mealPlanDraft flow — roughly one typical gram-rounding slip, not a
// clinically-derived number.
export const MACRO_CALORIE_TOLERANCE_KCAL = 50;

export interface MacroCalorieCheck {
  statedCalories: number;
  computedCalories: number;
  discrepancyKcal: number;
  consistent: boolean;
}

/** Checks whether protein/carb/fat grams (Atwater 4/4/9) actually sum to
 * the stated calorie target, within MACRO_CALORIE_TOLERANCE_KCAL. */
export function checkMacroCalorieConsistency(
  statedCalories: number,
  proteinG: number,
  carbG: number,
  fatG: number,
  toleranceKcal: number = MACRO_CALORIE_TOLERANCE_KCAL,
): MacroCalorieCheck {
  const computedCalories = computeMacroCalories(proteinG, carbG, fatG);
  const discrepancyKcal = Math.round(computedCalories - statedCalories);
  return {
    statedCalories,
    computedCalories: Math.round(computedCalories),
    discrepancyKcal,
    consistent: Math.abs(discrepancyKcal) <= toleranceKcal,
  };
}

// ── Claimed-macro extraction (bug report Q3: "Đánh giá 3000 kcal, 150g
// protein, 200g carb, 65g fat") ───────────────────────────────────────────
// Previously, a user quoting a NEW set of numbers to be checked (not a
// stored NutritionGoal) had no deterministic check at all — the LLM would
// have to do the Atwater arithmetic itself, which is exactly the kind of
// math this codebase's own principle says must never be delegated to the
// model. This extracts any {calories, protein, carbs, fat} numbers stated
// together in a single message so the orchestrator can run them through
// checkMacroCalorieConsistency() BEFORE the LLM call and inject the real
// result as ground truth.

export interface ClaimedMacros {
  calories?: number;
  proteinG?: number;
  carbG?: number;
  fatG?: number;
}

export function extractClaimedMacros(message: string): ClaimedMacros | undefined {
  const q = message.toLowerCase();
  const calMatch = /\b(\d{2,5})\s*(kcal|calo|calories)\b/i.exec(q);
  const proteinMatch = /\b(\d{1,4})\s*g\w*\s*(protein|đạm|dam)\b/i.exec(q);
  const carbMatch = /\b(\d{1,4})\s*g\w*\s*(carb|carbohydrate)\b/i.exec(q);
  const fatMatch = /\b(\d{1,4})\s*g\w*\s*(fat|chất béo|chat beo)\b/i.exec(q);

  const result: ClaimedMacros = {
    calories: calMatch ? Number(calMatch[1]) : undefined,
    proteinG: proteinMatch ? Number(proteinMatch[1]) : undefined,
    carbG: carbMatch ? Number(carbMatch[1]) : undefined,
    fatG: fatMatch ? Number(fatMatch[1]) : undefined,
  };
  // Only meaningful once we have the calorie figure AND at least two of the
  // three macros — a single stray number (e.g. "500g rice") is not a claim
  // worth validating.
  const macroCount = [result.proteinG, result.carbG, result.fatG].filter(
    (v) => v != null,
  ).length;
  if (result.calories == null || macroCount < 2) return undefined;
  return result;
}

// ── Weight conflict resolution (Part 3 precedence rules) ────────────────

export type WeightSource =
  | "message_stated"
  | "conversation_confirmed"
  | "latest_measurement"
  | "profile_cache"
  | "none";

export interface WeightResolution {
  weightKg?: number;
  source: WeightSource;
  /** True when the value used differs from another known value for this
   * user (e.g. user just said 76kg, latest InBody says 73.2kg). The
   * response layer must surface this explicitly, never silently pick one. */
  conflict: boolean;
  conflictNote?: string;
  /** The value(s) that were NOT used, for transparency in the answer. */
  alternateWeightKg?: number;
  alternateSource?: WeightSource;
}

/**
 * Extracts a weight (kg) the user explicitly stated in the CURRENT message,
 * e.g. "tôi nặng 76kg", "76 kg", "cân nặng hiện tại 76kg", "weight 76kg".
 * Deliberately conservative: only fires on an explicit number directly
 * adjacent to "kg" or a weight-word ("nặng"/"cân nặng"/"weight") — a bare
 * number elsewhere in the message (reps, sets, dates) must never be
 * misread as a body weight.
 */
export function extractStatedWeightKg(message: string): number | undefined {
  const q = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d");

  // "76kg", "76 kg", "nang 76kg", "toi nang 76 kg", "can nang 76kg"
  const patterns = [
    /(?:nang|weight|can nang)\s*(?:hien tai\s*)?(?:la\s*)?(\d{2,3}(?:[.,]\d)?)\s*kg\b/,
    /\b(\d{2,3}(?:[.,]\d)?)\s*kg\b.{0,15}\b(?:nang|weight)\b/,
    /\b(\d{2,3}(?:[.,]\d)?)\s*kg\b/,
  ];
  for (const p of patterns) {
    const m = q.match(p);
    if (m) {
      const value = Number(m[1].replace(",", "."));
      // Sane adult bodyweight bounds — guards against misreading an
      // unrelated number (e.g. "76kg tạ" isn't a real case, but a stray
      // "500kg" or "1kg" typo should not silently become "the" weight).
      if (Number.isFinite(value) && value >= 25 && value <= 300) return value;
    }
  }
  return undefined;
}

/** Explicit "ignore saved data, use the number I just gave you" override
 * phrasing — Part 3's "bỏ qua dữ liệu đã lưu" requirement. */
export function requestsIgnoreSavedData(message: string): boolean {
  const q = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d");
  return /\bbo qua\b.{0,20}\b(du lieu|thong tin|so lieu)\b.{0,15}\b(da luu|cu|inbody)\b/.test(
    q,
  );
}

export interface WeightInputs {
  /** From the CURRENT message text. */
  messageStatedWeightKg?: number;
  /** Whether the user explicitly asked to override saved data with the
   * message-stated value. */
  ignoreSavedData?: boolean;
  /** Latest real measurement (InBody), with its own timestamp. */
  latestMeasurement?: { weightKg?: number; measuredAt?: string };
  /** Denormalized "current" cache on the profile (may lag the latest
   * measurement, or be the only value available for accounts with no
   * InBody history at all). */
  profileCurrentWeightKg?: number;
}

/**
 * Resolves which weight value to use per Part 3's precedence:
 *   1. Explicit value in the current message
 *   2. (conversation-confirmed value — not resolved here; the orchestrator
 *      layer folds any prior-turn confirmation into messageStatedWeightKg
 *      before calling this, since that requires chat-history access this
 *      pure function intentionally does not take)
 *   3. Latest measurement (InBody) with a timestamp
 *   4. Profile cache
 *   5. none — caller must ask
 * Never silently picks a value when message and measurement disagree by a
 * clinically-meaningful amount — it flags the conflict for the response
 * layer to state explicitly, while still returning a usable value so the
 * assistant can proceed (per the spec's own worked example).
 */
export function resolveWeightForCalculation(
  inputs: WeightInputs,
): WeightResolution {
  const {
    messageStatedWeightKg,
    ignoreSavedData,
    latestMeasurement,
    profileCurrentWeightKg,
  } = inputs;
  const measurementKg = latestMeasurement?.weightKg;

  // PRODUCT_HEURISTIC: >1.5kg difference is treated as a "real" conflict
  // worth surfacing (not float noise / same-day re-weigh variance).
  const CONFLICT_THRESHOLD_KG = 1.5;

  if (messageStatedWeightKg != null) {
    const conflict =
      measurementKg != null &&
      Math.abs(messageStatedWeightKg - measurementKg) > CONFLICT_THRESHOLD_KG;
    return {
      weightKg: messageStatedWeightKg,
      source: "message_stated",
      conflict,
      conflictNote: conflict
        ? `Bạn vừa cung cấp ${messageStatedWeightKg}kg, khác với số đo InBody gần nhất (${measurementKg}kg${
            latestMeasurement?.measuredAt
              ? ` — đo ngày ${latestMeasurement.measuredAt}`
              : ""
          }). ${ignoreSavedData ? "Mình dùng số bạn vừa cung cấp theo yêu cầu." : "Mình dùng số bạn vừa cung cấp cho câu trả lời này."}`
        : undefined,
      alternateWeightKg: conflict ? measurementKg : undefined,
      alternateSource: conflict ? "latest_measurement" : undefined,
    };
  }

  if (measurementKg != null) {
    return { weightKg: measurementKg, source: "latest_measurement", conflict: false };
  }

  if (profileCurrentWeightKg != null) {
    return { weightKg: profileCurrentWeightKg, source: "profile_cache", conflict: false };
  }

  return { source: "none", conflict: false };
}

// ── Protein g/kg evaluation (Part 5) ─────────────────────────────────────

// SCIENTIFIC_EVIDENCE: 1.4-2.0 g/kg/day range for physically active adults
// — Jäger et al. 2017 (ISSN Position Stand: Protein and Exercise), PMID
// 28642676, DOI 10.1186/s12970-017-0177-8. 1.6 g/kg is a commonly-cited
// practical starting point WITHIN that range, not a separate threshold.
export const PROTEIN_EVIDENCE_RANGE_G_PER_KG = { floor: 1.4, ceiling: 2.0 };
export const PROTEIN_PRACTICAL_STARTING_POINT_G_PER_KG = 1.6;
// PRODUCT_HEURISTIC: above this, flag as "very high" — worth a diversity/
// medical-review note — not itself a hard safety limit for a healthy adult.
export const PROTEIN_VERY_HIGH_G_PER_KG = 2.5;

export type ProteinIntakeTier =
  | "below_range"
  | "within_range"
  | "very_high";

export interface ProteinEvaluation {
  proteinG: number;
  weightKg: number;
  gPerKg: number;
  tier: ProteinIntakeTier;
  note: string;
}

export function evaluateProteinIntake(
  proteinG: number,
  weightKg: number,
): ProteinEvaluation {
  const gPerKg = weightKg > 0 ? proteinG / weightKg : 0;
  const rounded = Math.round(gPerKg * 100) / 100;
  let tier: ProteinIntakeTier;
  let note: string;
  if (gPerKg < PROTEIN_EVIDENCE_RANGE_G_PER_KG.floor) {
    tier = "below_range";
    note = `${rounded} g/kg/ngày thấp hơn khoảng tham chiếu ${PROTEIN_EVIDENCE_RANGE_G_PER_KG.floor}-${PROTEIN_EVIDENCE_RANGE_G_PER_KG.ceiling} g/kg cho người tập luyện.`;
  } else if (gPerKg > PROTEIN_VERY_HIGH_G_PER_KG) {
    tier = "very_high";
    note = `${rounded} g/kg/ngày cao hơn đáng kể so với khoảng tham chiếu ${PROTEIN_EVIDENCE_RANGE_G_PER_KG.floor}-${PROTEIN_EVIDENCE_RANGE_G_PER_KG.ceiling} g/kg — mức này thường không cần thiết và có thể chiếm chỗ của carb/fat/chất xơ trong khẩu phần.`;
  } else {
    tier = "within_range";
    const nearCeiling = gPerKg >= PROTEIN_EVIDENCE_RANGE_G_PER_KG.ceiling - 0.15;
    note = nearCeiling
      ? `${rounded} g/kg/ngày nằm ở đầu trên của khoảng thường dùng cho người tập (${PROTEIN_EVIDENCE_RANGE_G_PER_KG.floor}-${PROTEIN_EVIDENCE_RANGE_G_PER_KG.ceiling} g/kg).`
      : `${rounded} g/kg/ngày nằm trong khoảng thường dùng cho người tập (${PROTEIN_EVIDENCE_RANGE_G_PER_KG.floor}-${PROTEIN_EVIDENCE_RANGE_G_PER_KG.ceiling} g/kg).`;
  }
  return { proteinG, weightKg, gPerKg: rounded, tier, note };
}

// ── Bulk-surplus sanity check (Part 4 muscle-gain surplus rule) ─────────

// PRODUCT_HEURISTIC: conservative default surplus band for muscle gain.
// Evidence does not establish one single optimal surplus (Slater et al.
// 2019; Helms et al. 2023 "small vs large surplus") — this is a starting
// point to individualize from, not a prescription.
export const CONSERVATIVE_SURPLUS_PCT = { min: 0.05, max: 0.15 };
export const LARGE_SURPLUS_WARNING_PCT = 0.2;

export interface SurplusEvaluation {
  surplusPct: number;
  isLarge: boolean;
  note: string;
}

export function evaluateCalorieSurplus(
  maintenanceCalories: number,
  targetCalories: number,
): SurplusEvaluation {
  const surplusPct =
    maintenanceCalories > 0
      ? (targetCalories - maintenanceCalories) / maintenanceCalories
      : 0;
  const isLarge = surplusPct > LARGE_SURPLUS_WARNING_PCT;
  const note = isLarge
    ? `Mức thặng dư ~${Math.round(surplusPct * 100)}% cao hơn khoảng bảo thủ thường dùng (${Math.round(CONSERVATIVE_SURPLUS_PCT.min * 100)}-${Math.round(CONSERVATIVE_SURPLUS_PCT.max * 100)}%) — thặng dư lớn thường tăng tích mỡ nhiều hơn mà không tăng thêm lợi ích xây cơ tương ứng.`
    : `Mức thặng dư ~${Math.round(surplusPct * 100)}% nằm trong khoảng bảo thủ, phù hợp để điều chỉnh dần theo xu hướng cân nặng thực tế.`;
  return { surplusPct: Math.round(surplusPct * 1000) / 1000, isLarge, note };
}

// ── Deterministic calorie/TDEE estimation (Part 4) ──────────────────────
//
// Root-cause gap: no function anywhere in the codebase computed a BMR/TDEE
// estimate — a CALORIE_ESTIMATION-type question ("mình cần bao nhiêu calo
// một ngày?") had nothing to inject as ground truth, so the LLM was left to
// do the arithmetic itself (or, worse, invent a number), exactly what this
// module's own file-level doc comment says must never happen. This is the
// single source of truth for that estimate: it NEVER guesses a missing
// input — checkCalorieEstimationInputs() must report `complete: true`
// before estimateTdee() is called, and the orchestrator is expected to ask
// the user for exactly the fields checkCalorieEstimationInputs() lists
// rather than falling back to an assumed default.

export type BiologicalSexForBmr = "male" | "female";

export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "active"
  | "very_active";

// SCIENTIFIC_EVIDENCE: standard TDEE activity multipliers built on top of
// Mifflin-St Jeor BMR — the same bands used throughout the sports-nutrition
// literature (e.g. summarized in the ACSM/AND/DC 2016 joint position
// stand). These are broad multiplier BANDS, not individually validated —
// hence estimateTdee() always returns a range, never a single number.
export const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

export interface CalorieEstimationInputs {
  weightKg?: number;
  heightCm?: number;
  age?: number;
  sex?: BiologicalSexForBmr;
  activityLevel?: ActivityLevel;
  /** Optional context this module does not require to compute a number,
   * but the response layer should still ask about when entirely absent —
   * a calorie target without a stated goal/training context is easy to
   * misapply (see APPLICABILITY note below). */
  goal?: "maintain" | "muscle_gain" | "fat_loss";
  trainingDaysPerWeek?: number;
}

export const REQUIRED_CALORIE_CALC_FIELDS = [
  "weightKg",
  "heightCm",
  "age",
  "sex",
  "activityLevel",
] as const;

export type RequiredCalorieCalcField =
  (typeof REQUIRED_CALORIE_CALC_FIELDS)[number];

const MISSING_FIELD_LABEL_VI: Record<RequiredCalorieCalcField, string> = {
  weightKg: "cân nặng (kg)",
  heightCm: "chiều cao (cm)",
  age: "tuổi",
  sex: "giới tính sinh học (nam/nữ, để chọn đúng công thức)",
  activityLevel: "mức độ vận động hằng ngày (ít vận động/nhẹ/vừa/nhiều/rất nhiều)",
};

export interface CalorieInputsCheck {
  complete: boolean;
  missingFields: RequiredCalorieCalcField[];
  /** Ready-to-inject Vietnamese prompt asking for exactly what's missing —
   * Part 4's "ask for missing data rather than guessing" requirement. */
  missingFieldsPromptVi?: string;
}

export function checkCalorieEstimationInputs(
  inputs: CalorieEstimationInputs,
): CalorieInputsCheck {
  const missingFields = REQUIRED_CALORIE_CALC_FIELDS.filter(
    (field) => inputs[field] == null,
  );
  if (missingFields.length === 0) {
    return { complete: true, missingFields: [] };
  }
  const labels = missingFields.map((f) => MISSING_FIELD_LABEL_VI[f]).join(", ");
  return {
    complete: false,
    missingFields,
    missingFieldsPromptVi: `Để tính lượng calo cần thiết chính xác, mình cần thêm: ${labels}. Bạn cho mình biết các thông tin này nhé — mình sẽ không đoán để tránh đưa ra con số sai lệch.`,
  };
}

export const MIFFLIN_ST_JEOR_FORMULA_VERSION = "Mifflin-St Jeor (1990)";

// PRODUCT_HEURISTIC: ±10% band around the point estimate — Mifflin-St Jeor
// is the most accurate of the common predictive equations in validation
// studies but still has meaningful individual error, so this is presented
// as a starting range to calibrate from with real intake/weight-trend data
// (Part 4's "prefer 2-4 week real-data calibration when available"), not a
// precise number. Real-data calibration itself (deriving TDEE from a
// user's actual logged intake + weight-trend history) is NOT implemented
// in this pass — it needs a materially larger data pipeline than a single
// pure function can provide, and is explicitly called out as deferred
// rather than silently left out.
const TDEE_RANGE_BAND_PCT = 0.1;

export interface TdeeEstimate {
  bmrKcal: number;
  tdeeKcal: number;
  tdeeRangeLowKcal: number;
  tdeeRangeHighKcal: number;
  activityMultiplier: number;
  formulaVersion: string;
  /** Populated when the inputs fall outside Mifflin-St Jeor's validated
   * adult population (Part 4: "never blindly applied to children/
   * pregnancy/athletes/medical conditions") — the caller must surface this
   * as a real caveat, not silently apply the number anyway. Age/pregnancy/
   * medical-condition screening for MINORS and pregnancy is primarily
   * safety_guard.ts's job (it can refuse/redirect before this is ever
   * called); this flag is a second, narrower layer specifically about the
   * formula's own validated population and is not a substitute for that
   * triage. */
  applicabilityWarnings: string[];
}

/**
 * Computes a Mifflin-St Jeor BMR + activity-scaled TDEE estimate, as a
 * range rather than a single number. Callers MUST call
 * checkCalorieEstimationInputs() first and only call this once `complete`
 * is true — this function does not itself guess a missing field.
 */
export function estimateTdee(
  inputs: Required<
    Pick<CalorieEstimationInputs, RequiredCalorieCalcField>
  >,
): TdeeEstimate {
  const { weightKg, heightCm, age, sex, activityLevel } = inputs;
  // Mifflin-St Jeor (1990): men = 10w + 6.25h - 5a + 5; women = ... - 161.
  const sexConstant = sex === "male" ? 5 : -161;
  const bmrKcal = 10 * weightKg + 6.25 * heightCm - 5 * age + sexConstant;
  const activityMultiplier = ACTIVITY_MULTIPLIERS[activityLevel];
  const tdeeKcal = bmrKcal * activityMultiplier;

  const applicabilityWarnings: string[] = [];
  // PRODUCT_HEURISTIC: Mifflin-St Jeor was derived and validated on
  // generally-healthy adults — under-18, very advanced age, and very high
  // training volumes are all populations the original validation doesn't
  // cover well.
  if (age < 18) {
    applicabilityWarnings.push(
      "Công thức Mifflin-St Jeor được xây dựng cho người trưởng thành — với người dưới 18 tuổi, nhu cầu năng lượng nên được đánh giá bởi bác sĩ nhi khoa/chuyên gia dinh dưỡng, số ước tính này chỉ mang tính tham khảo rất thô.",
    );
  }
  if (age > 65) {
    applicabilityWarnings.push(
      "Với người trên 65 tuổi, sai số của công thức này thường lớn hơn — nên xem đây là điểm khởi đầu để theo dõi cân nặng thực tế rồi điều chỉnh, không phải con số cố định.",
    );
  }
  if (activityLevel === "very_active") {
    applicabilityWarnings.push(
      "Ở mức vận động rất cao (vận động viên/tập luyện khối lượng lớn), công thức dự đoán chung này thường kém chính xác hơn — nên ưu tiên hiệu chỉnh theo cân nặng thực tế đo được trong 2-4 tuần thay vì dùng số ước tính này lâu dài.",
    );
  }

  return {
    bmrKcal: Math.round(bmrKcal),
    tdeeKcal: Math.round(tdeeKcal),
    tdeeRangeLowKcal: Math.round(tdeeKcal * (1 - TDEE_RANGE_BAND_PCT)),
    tdeeRangeHighKcal: Math.round(tdeeKcal * (1 + TDEE_RANGE_BAND_PCT)),
    activityMultiplier,
    formulaVersion: MIFFLIN_ST_JEOR_FORMULA_VERSION,
    applicabilityWarnings,
  };
}

/** Detects a calorie/TDEE/BMR estimation question — "mình cần bao nhiêu
 * calo một ngày?", "TDEE của mình là bao nhiêu?", "how many calories do I
 * need?". Deliberately narrow (a specific ask for a personal calorie
 * NUMBER), not a general nutrition-knowledge question about calories in
 * the abstract — those stay on the GENERAL_NUTRITION_QA path. */
export function hasCalorieEstimationSignal(message: string): boolean {
  const q = message
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d");
  const viPatterns = [
    /\b(bao nhieu|can bao nhieu)\b.{0,20}\b(calo|kcal)\b/,
    /\b(calo|kcal)\b.{0,20}\bcan (thiet|nap)\b/,
    /\bnhu cau\b.{0,10}\bcalo\b/,
    /\btinh\b.{0,10}\b(calo|kcal|tdee|bmr)\b/,
    /\btdee\b/,
    /\bbmr\b/,
  ];
  const enPatterns = [
    /how many calories/,
    /calorie(s)? (needs?|requirement|intake) (per|a) day/,
    /daily calorie (need|target|requirement)/,
    /\btdee\b/,
    /\bbmr\b/,
  ];
  return [...viPatterns, ...enPatterns].some((p) => p.test(q));
}

/** Maps the AI-service UserProfile's gender/activityLevel enums to this
 * engine's Mifflin-St Jeor inputs. Returns undefined for a field this
 * engine cannot map confidently — the caller must then treat it as
 * missing (ask, never guess), rather than silently picking a default. */
export function mapGenderToBiologicalSex(
  gender: "MALE" | "FEMALE" | "OTHER" | undefined,
): BiologicalSexForBmr | undefined {
  if (gender === "MALE") return "male";
  if (gender === "FEMALE") return "female";
  // "OTHER" and undefined are both left unmapped — Mifflin-St Jeor only
  // has a validated binary-sex constant, so this must be asked for
  // explicitly (framed as "which formula constant applies"), never
  // defaulted/guessed for a real "OTHER" answer.
  return undefined;
}

export function mapActivityLevel(
  activityLevel:
    | "SEDENTARY"
    | "LIGHTLY_ACTIVE"
    | "MODERATELY_ACTIVE"
    | "VERY_ACTIVE"
    | "EXTREMELY_ACTIVE"
    | undefined,
): ActivityLevel | undefined {
  switch (activityLevel) {
    case "SEDENTARY":
      return "sedentary";
    case "LIGHTLY_ACTIVE":
      return "light";
    case "MODERATELY_ACTIVE":
      return "moderate";
    case "VERY_ACTIVE":
      return "active";
    case "EXTREMELY_ACTIVE":
      return "very_active";
    default:
      return undefined;
  }
}
