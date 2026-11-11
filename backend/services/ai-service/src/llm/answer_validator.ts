import type {
  RecommendationResult,
  ResponseLanguage,
  UserProfile,
  ValidationResult,
} from "./types";

// History: numbers were once taken as "the next number after the keyword" (buildNearKeywordRegex /
// extractAllNumbersNearKeyword, which also fixed the a|b alternation grouping, single-digit "Đạm 0g" capture and
// first-match-only bugs). Those guarantees are kept by extractDailyKcal / extractDailyMacroGrams below (every
// occurrence is still scanned and the worst one wins); the unit-blind matching that discarded correct answers is gone.

function worstDiffRatio(found: number[], expected: number): number {
  let worst = 0;
  for (const value of found) {
    const ratio = Math.abs(value - expected) / Math.max(1, expected);
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

// Real bug found by the nutrition quality evaluation (test/ai-quality-eval, 2026-11-08, REAL HTTP/API with Nova Pro):
// `keyword[^\d]{0,20}(\d+)` took the NEXT number after the keyword whatever its unit, so a correct answer such as
// "| Calo | 2370 kcal | Đạm: 145g" yielded calories [2370, 145], per-food grams ("Gà nướng 150g (35g protein)") and
// per-meal figures were compared with the DAILY target, and 52% of answers were discarded for a deterministic template
// that did not answer the question. A number now counts only when its own unit is attached (kcal for energy, g for a
// macro), and figures that are per-item / per-meal / per-kg / a threshold or a deficit are not daily-target claims.
// The worst-case-over-all-remaining-occurrences rule is kept (a wrong restatement anywhere is still caught).
const normalizeThousands = (text: string) => text.replace(/(\d)[.,](\d{3})(?!\d)/g, "$1$2");
const NOT_A_DAILY_TARGET_BEFORE =
  /(dưới|trên|thấp hơn|cao hơn|ít hơn|nhiều hơn|tối thiểu|tối đa|ít nhất|không dưới|không quá|giảm|tăng|bớt|thêm|thâm hụt|thặng dư|thiếu hụt|chênh|below|under|above|at least|at most|minimum|maximum|deficit|surplus|reduce|increase)[^.\n]{0,14}$/i;
const PER_MEAL_LINE = /bữa|meal|breakfast|lunch|dinner|snack|món|khẩu phần|serving/i;
const OTHER_MACRO = "protein|đạm|carb|carbs|tinh bột|chất béo|béo|fat|fats|calo|kcal";
const PER_ITEM_BEFORE =
  /(chứa|cung cấp|trong\s+(một|1)|(một|1)\s+(quả|lát|hộp|muỗng|thìa|cốc|ly|chén|miếng|lạng|phần|bát|tô|gói|hũ|scoop|serving)|100\s*g)[^.\n]{0,30}$/i;

function lineOf(text: string, index: number): string {
  const start = text.lastIndexOf("\n", index) + 1;
  const end = text.indexOf("\n", index);
  return text.slice(start, end === -1 ? text.length : end);
}

// In a DIRECT answer the daily target is stated with a daily marker ("mỗi ngày", "mục tiêu", "bạn cần"); a line without
// one is an example (food list "ức gà 100 g ~31 g protein", "1 quả trứng 6 g protein") and is not compared with it.
const DAILY_CONTEXT_LINE = /ngày|daily|per day|a day|mục tiêu|target|bạn cần|cần khoảng|nên ăn|tổng cộng|mỗi hôm/i;

/** Daily energy figures: a number directly followed by an energy unit, excluding thresholds/deltas/per-meal lines. */
function extractDailyKcal(raw: string, allowPerMealLines: boolean, dailyContextOnly = false): number[] {
  const text = normalizeThousands(raw);
  const out: number[] = [];
  for (const m of text.matchAll(/(\d{3,5})\s*(?:kcal|calo(?:ries)?|calories|cal)\b/gi)) {
    const value = Number(m[1]);
    const index = m.index ?? 0;
    if (dailyContextOnly && !DAILY_CONTEXT_LINE.test(lineOf(text, index))) continue;
    if (NOT_A_DAILY_TARGET_BEFORE.test(text.slice(Math.max(0, index - 30), index))) continue;
    if (!allowPerMealLines && PER_MEAL_LINE.test(lineOf(text, index))) continue;
    // per-meal / per-food energy is usually well below a daily target; a value < 800 is only a daily claim when it says so
    if (value < 800 && !/^\s*(kcal|calo\w*|cal)\s*(\/\s*ngày|mỗi ngày|một ngày|\/\s*day|per day|a day)/i.test(text.slice(index + m[1].length, index + m[1].length + 24))) continue;
    out.push(value);
  }
  return out;
}

/** Daily macro grams: "<kw> … 145g" or "145g (of) <kw>", unit attached; skips g/kg, per-item "(35g protein)" and per-meal lines. */
function extractDailyMacroGrams(raw: string, keyword: string, dailyContextOnly = false): number[] {
  const text = normalizeThousands(raw);
  const out: number[] = [];
  const consider = (value: number, index: number, tail: string) => {
    if (dailyContextOnly && !DAILY_CONTEXT_LINE.test(lineOf(text, index))) return;
    if (/^\s*(\/\s*kg|mỗi\s*kg|per\s*kg|\/\s*kilogram)/i.test(tail)) return;
    if (PER_MEAL_LINE.test(lineOf(text, index))) return;
    if (NOT_A_DAILY_TARGET_BEFORE.test(text.slice(Math.max(0, index - 30), index))) return;
    out.push(value);
  };
  for (const m of text.matchAll(new RegExp(`(?:${keyword})([^\\d\\n]{0,20}?)(\\d{1,4})\\s*(?:g|gr|gram)\\b`, "gi"))) {
    // "145 g protein, 299 g carb": after a list separator / "và" the next number belongs to the next macro, and a number
    // immediately followed by another macro's name ("299 g carb") is that macro's figure, not this one's.
    if (/[,;·]|\svà\s|\sand\s/i.test(m[1])) continue;
    const after = text.slice((m.index ?? 0) + m[0].length);
    if (new RegExp(`^\\s*\\**\\s*(?:${OTHER_MACRO})`, "i").test(after) && !new RegExp(`^\\s*\\**\\s*(?:${keyword})`, "i").test(after)) continue;
    const numIndex = (m.index ?? 0) + m[0].lastIndexOf(m[2]);
    consider(Number(m[2]), numIndex, after);
  }
  for (const m of text.matchAll(new RegExp(`(\\d{1,4})\\s*(?:g|gr|gram)\\s+(?:of\\s+)?(?:${keyword})`, "gi"))) {
    const index = m.index ?? 0;
    if (/\(\s*$/.test(text.slice(Math.max(0, index - 3), index))) continue; // "(35g protein)" annotates one food item
    if (Number(m[1]) <= 1) continue; // "1 gram chất béo = 9 kcal" defines a unit, it is not an intake target
    if (PER_ITEM_BEFORE.test(text.slice(Math.max(0, index - 40), index))) continue; // "1 quả trứng chứa ~6 g protein"
    consider(Number(m[1]), index, "");
  }
  return out;
}

function validateCalories(
  text: string,
  expected: number,
  _keyword: string = "calories|kcal",
  allowedReferences: number[] = [],
  allowPerMealLines = false,
  dailyContextOnly = false,
): string[] {
  const warnings: string[] = [];
  if (!expected) return warnings;
  // the estimated maintenance (TDEE) may legitimately be quoted next to the target
  const found = extractDailyKcal(text, allowPerMealLines, dailyContextOnly).filter(
    (v) => !allowedReferences.some((ref) => ref && Math.abs(v - ref) / ref <= 0.05),
  );
  if (found.length === 0) return warnings;

  const diffRatio = worstDiffRatio(found, expected);
  if (diffRatio > 0.12) {
    warnings.push(
      `Calories in answer (${found.join(", ")}) differ significantly from deterministic target (${expected}).`,
    );
  }

  return warnings;
}

function validateMacro(
  text: string,
  label: string,
  expected: number,
  dailyContextOnly = false,
): string[] {
  const warnings: string[] = [];
  if (!expected) return warnings;
  const found = extractDailyMacroGrams(text, label, dailyContextOnly);
  if (found.length === 0) return warnings;

  const diffRatio = worstDiffRatio(found, expected);
  if (diffRatio > 0.2) {
    warnings.push(
      `${label} grams in answer (${found.join(", ")}) differ from deterministic target (${expected}).`,
    );
  }

  return warnings;
}

function validateSafetyLanguage(text: string): string[] {
  const warnings: string[] = [];
  const riskyPatterns = [
    /guarantee[d]?\s+results?/i,
    /no need to consult/i,
    /ignore pain/i,
    /train through injury/i,
    /không cần bác sĩ|không cần tư vấn bác sĩ/i,
    /chắc chắn giảm|đảm bảo kết quả|tuyệt đối hiệu quả/i,
  ];

  riskyPatterns.forEach((pattern) => {
    if (pattern.test(text)) {
      warnings.push(
        `Potentially unsafe phrase detected: ${pattern.toString()}`,
      );
    }
  });

  return warnings;
}

function validateGeneralFitnessAdvice(answer: string): string[] {
  const warnings: string[] = [];

  // Flag extreme protein-per-kg claims (> 4 g/kg is beyond evidence-based upper limit)
  const proteinPerKgMatch = answer.match(
    /(\d+(?:\.\d+)?)\s*g?\s*(?:per\s*kg|\/\s*kg|g\/kg|mỗi\s*kg)/i,
  );
  if (proteinPerKgMatch) {
    const val = Number(proteinPerKgMatch[1]);
    if (val > 4) {
      warnings.push(
        `Extreme protein-per-kg recommendation (${val}g/kg) — evidence-based ceiling is ~2.2g/kg for most goals.`,
      );
    }
  }

  // Flag obviously out-of-range explicit calorie targets
  const calMatches = [...answer.matchAll(/\b(\d{3,5})\s*kcal/gi)];
  for (const m of calMatches) {
    const val = Number(m[1]);
    if (val < 800 || val > 6000) {
      warnings.push(
        `Calorie value outside safe range: ${val} kcal (typical range 800–5000 kcal for most individuals).`,
      );
      break;
    }
  }

  return warnings;
}

function requireSection(
  answer: string,
  sectionPatterns: RegExp[],
  sectionLabel: string,
): string[] {
  const exists = sectionPatterns.some((pattern) => pattern.test(answer));
  return exists ? [] : [`Missing required section: ${sectionLabel}.`];
}

function validateRequiredSections(
  answer: string,
  recommendation: RecommendationResult,
): string[] {
  const warnings: string[] = [];
  const intent = recommendation.responseIntent;

  if (intent === "meal_plan_request") {
    warnings.push(
      ...requireSection(
        answer,
        [/dinh dưỡng|nutrition|meal|thực đơn/i],
        "nutrition",
      ),
    );
    warnings.push(
      ...requireSection(answer, [/meal|bữa|thực đơn/i], "meal_examples"),
    );
    warnings.push(
      ...requireSection(answer, [/điều chỉnh|adjust/i], "adjustment"),
    );
    if (/(bài tập|exercise|workout)/i.test(answer)) {
      warnings.push("Answer includes workout content for meal-only intent.");
    }
  }

  if (intent === "nutrient_timing_request") {
    // Deliberately NOT requiring a "nutrition"/"meal_examples"/"adjustment"
    // section like meal_plan_request above — this intent is a short,
    // direct answer to one timing question, not a full plan (see
    // prompt_builder.ts's isTiming instructions).
    //
    // DOES require the answer to actually address pre- AND post-workout
    // timing specifically — real gap found via E2E persona testing
    // (24-ai-nutrition-persona-b-c.spec.ts, Persona B): even with a strong,
    // header-based prompt instruction, the local LLM sometimes drifts into
    // a generic or even off-topic answer instead of actually covering
    // "trước tập"/"sau tập". Using requireSection here (not a bespoke
    // warning string) means a miss is caught by
    // hasCriticalStructureMismatch below and the orchestrator substitutes
    // formatNutrientTiming()'s deterministic fallback — which always
    // reliably covers both — the same "engine's answer wins over an
    // unreliable small-LLM answer" belt-and-braces pattern already used
    // for the calorie/macro mismatch case elsewhere in this file.
    warnings.push(
      ...requireSection(
        answer,
        [/trước.{0,15}tập|before.{0,15}training|pre.?workout/i],
        "pre_workout_timing",
      ),
    );
    warnings.push(
      ...requireSection(
        answer,
        [/sau.{0,15}tập|after.{0,15}training|post.?workout/i],
        "post_workout_timing",
      ),
    );

    // Guard against the same failure modes meal_plan_request guards
    // against: workout content leaking in, and the answer ballooning into
    // a full multi-meal day-by-day table when only a quick timing tip was
    // asked for.
    if (/(bài tập|exercise|workout)/i.test(answer)) {
      warnings.push("Answer includes workout content for timing-only intent.");
    }
    if (/(bữa sáng|bữa trưa|bữa tối|breakfast|lunch|dinner)/i.test(answer)) {
      warnings.push(
        "Answer expanded into a full multi-meal day plan for a timing-only question.",
      );
    }
  }

  if (
    intent === "workout_plan_request" ||
    intent === "body_recomposition_request" ||
    intent === "frequency_change_request" ||
    intent === "combined_plan_request"
  ) {
    warnings.push(
      ...requireSection(answer, [/day|ngày|tuần|week/i], "workout_table"),
    );
    warnings.push(
      ...requireSection(
        answer,
        [/calo|kcal/i, /dinh|nutri/i],
        "nutrition_summary",
      ),
    );
    warnings.push(...requireSection(answer, [/sets?|hiệp/i], "sets"));
    warnings.push(...requireSection(answer, [/reps?|lặp/i], "reps"));
    warnings.push(...requireSection(answer, [/rest|nghỉ/i], "rest"));
  }

  if (
    intent === "specific_exercise_request" ||
    intent === "muscle_group_routine_request"
  ) {
    warnings.push(
      ...requireSection(answer, [/exercise|bài tập/i], "exercise_list"),
    );
    warnings.push(
      ...requireSection(answer, [/technique|kỹ thuật/i], "technique_notes"),
    );
    warnings.push(
      ...requireSection(answer, [/safety|an toàn/i], "safety_notes"),
    );

    const sessionGoal = (
      recommendation.specificRoutine?.sessionGoal ?? ""
    ).toLowerCase();
    if (/ch[aâ]n|leg/.test(sessionGoal)) {
      warnings.push(
        ...requireSection(
          answer,
          [/squat|deadlift|lunge|leg press/i],
          "legs_compound",
        ),
      );
      warnings.push(
        ...requireSection(
          answer,
          [/romanian|rdl|gân khoeo|hamstring/i],
          "legs_posterior",
        ),
      );
      warnings.push(
        ...requireSection(
          answer,
          [/calf|bắp chân|split squat|đơn chân/i],
          "legs_accessory",
        ),
      );
    }
    if (/vai|shoulder/.test(sessionGoal)) {
      warnings.push(
        ...requireSection(answer, [/press|raise/i], "shoulders_press_raise"),
      );
      warnings.push(
        ...requireSection(
          answer,
          [/rear delt|face pull|vai sau/i],
          "shoulders_rear_delt",
        ),
      );
    }
    if (/core|bụng/.test(sessionGoal)) {
      warnings.push(
        ...requireSection(
          answer,
          [/plank|dead bug|hollow|ab wheel/i],
          "core_stability",
        ),
      );
      warnings.push(
        ...requireSection(
          answer,
          [/không.*mỡ|không.*giảm|không giảm|spot/i],
          "core_spot_reduction_note",
        ),
      );
    }
  }

  if (recommendation.detailMode) {
    warnings.push(...requireSection(answer, [/set|hiệp/i], "detail_sets"));
    warnings.push(...requireSection(answer, [/rep|lặp/i], "detail_reps"));
    warnings.push(...requireSection(answer, [/rest|nghỉ/i], "detail_rest"));
    warnings.push(
      ...requireSection(answer, [/technique|kỹ thuật/i], "detail_technique"),
    );
  }

  return warnings;
}

function validateNutritionConsistency(
  recommendation: RecommendationResult,
): string[] {
  const n = recommendation.nutrition;
  if (!n.targetCalories || !n.proteinGrams || !n.carbsGrams || !n.fatGrams)
    return [];
  const kcalFromMacro = n.proteinGrams * 4 + n.carbsGrams * 4 + n.fatGrams * 9;
  const diff = Math.abs(kcalFromMacro - n.targetCalories);
  if (diff > 120) {
    return [
      `Nutrition inconsistency: macro-derived kcal (${kcalFromMacro}) differs from target (${n.targetCalories}).`,
    ];
  }
  return [];
}

function validatePersonalization(
  answer: string,
  profile: UserProfile | undefined,
  recommendation?: RecommendationResult,
): string[] {
  if (!profile) return [];

  const requiredSignals: string[] = [];
  // Stating the user's own computed targets IS personalization (they are derived from the profile / the saved
  // NutritionGoal) — a correct "bạn cần 2370 kcal, 145 g protein" answer was flagged before because it did not also
  // repeat the user's weight or height back.
  const n = recommendation?.nutrition;
  if (n?.targetCalories) requiredSignals.push(String(n.targetCalories));
  if (n?.proteinGrams) requiredSignals.push(`${n.proteinGrams}g`, `${n.proteinGrams} g`);
  if (profile.currentWeightKg || profile.inBody?.weightKg)
    requiredSignals.push(
      String(profile.currentWeightKg || profile.inBody?.weightKg),
    );
  if (profile.heightCm) requiredSignals.push(String(profile.heightCm));
  if (profile.gender === "FEMALE") requiredSignals.push("nữ");
  if (profile.gender === "MALE") requiredSignals.push("nam");
  if (profile.training.injuries.length > 0) requiredSignals.push("chấn thương");
  if (profile.training.availableEquipment.length > 0)
    requiredSignals.push("thiết bị");

  if (requiredSignals.length < 2) return [];
  const answerNorm = normalizeThousands(answer.toLowerCase());
  const hitCount = requiredSignals.filter((s) =>
    answerNorm.includes(s.toLowerCase()),
  ).length;
  if (hitCount === 0) {
    return [
      "Personalization missing: user profile fields were provided but not reflected in answer.",
    ];
  }
  return [];
}

function validateLanguageLock(
  answer: string,
  language: ResponseLanguage,
): string[] {
  if (language !== "vi") return [];
  const warnings: string[] = [];
  const hasVietnameseSignal =
    /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệóòỏõọốồổỗộớờởỡợúùủũụứừửữựíìỉĩị]/i.test(
      answer,
    ) ||
    /(bạn|mục tiêu|lịch tập|dinh dưỡng|hành động|tuần|bài tập|nghỉ)/i.test(
      answer,
    );
  const englishSignalCount = (
    answer.match(
      /\b(the|and|your|with|training|nutrition|goal|week|plan|target)\b/gi,
    ) || []
  ).length;
  if (!hasVietnameseSignal && englishSignalCount >= 4) {
    warnings.push("Language lock violation: expected Vietnamese answer.");
  }
  return warnings;
}

/**
 * Returns true when at least one validation warning indicates that a calorie
 * or macro number in the LLM answer differs materially from the deterministic
 * target.  Used by the orchestrator to decide whether to fall back.
 */
export function hasCriticalNutritionMismatch(warnings: string[]): boolean {
  return warnings.some((w) => /differ.*from deterministic target/i.test(w));
}

export function hasCriticalStructureMismatch(warnings: string[]): boolean {
  return warnings.some((w) =>
    /Missing required section|Language lock violation|meal-only intent|timing-only intent|full multi-meal day plan|Nutrition inconsistency|Personalization missing/i.test(
      w,
    ),
  );
}

export const answerValidator = {
  validate(
    answer: string,
    recommendation: RecommendationResult,
    language: ResponseLanguage = "en",
    profile?: UserProfile,
    options?: { nutritionAnswerMode?: "direct" | "plan" | "meal"; personalQuestion?: boolean },
  ): ValidationResult {
    const warnings: string[] = [];
    const nutrition = recommendation.nutrition;
    const isGeneralKnowledge =
      recommendation.responseIntent === "general_fitness_knowledge";

    if (!isGeneralKnowledge) {
      // Real bug found via E2E persona testing (Persona B/C,
      // 24-ai-nutrition-persona-b-c.spec.ts): these keyword patterns were
      // English-only regardless of `language`, so for a Vietnamese answer
      // (which writes "Đạm"/"Béo", never the literal word "protein"/"fat")
      // extractNumberNearKeyword found nothing and validateMacro silently
      // skipped the check entirely — the one case (Vietnamese output) this
      // validator most needs to cover, since that's this app's primary
      // response language. "carb"/"kcal" happened to still work because
      // this codebase's Vietnamese prompts use those as loanwords
      // ("Carb: 249g"), which is why only protein/fat silently went
      // unchecked rather than all four fields.
      const caloriesKeyword =
        language === "vi" ? "calories|kcal|calo" : "calories|kcal";
      const proteinKeyword = language === "vi" ? "protein|đạm" : "protein";
      const carbKeyword =
        language === "vi" ? "carb|carbs|tinh bột" : "carb|carbs";
      const fatKeyword =
        language === "vi" ? "fat|fats|béo|chất béo" : "fat|fats";

      // Answer mode (nutrition_answer_mode.ts; absent = "plan", the historical behaviour for every other intent):
      //   plan   — full-day plan: daily targets checked on every line, meal sections + personalization required.
      //   direct — direct question: only lines stating a DAILY figure are compared; no meal sections; no
      //            personalization requirement (its fallback is a numbers-only answer, so discarding a correct
      //            food-source / knowledge answer for not restating the profile made answers worse, not safer).
      //   meal   — ONE meal ("một bữa trưa 600 kcal"): its figures are per-meal, never compared with daily targets.
      const mode = options?.nutritionAnswerMode ?? "plan";
      if (mode !== "meal") {
        const dailyOnly = mode === "direct";
        warnings.push(
          ...validateCalories(
            answer,
            nutrition.targetCalories || 0,
            caloriesKeyword,
            [nutrition.maintenanceCalories || 0],
            false,
            dailyOnly,
          ),
        );
        warnings.push(...validateMacro(answer, proteinKeyword, nutrition.proteinGrams || 0, dailyOnly));
        warnings.push(...validateMacro(answer, carbKeyword, nutrition.carbsGrams || 0, dailyOnly));
        warnings.push(...validateMacro(answer, fatKeyword, nutrition.fatGrams || 0, dailyOnly));
      }
      if (mode !== "direct") {
        warnings.push(...validateRequiredSections(answer, recommendation));
      }
      warnings.push(...validateNutritionConsistency(recommendation));
      if (mode === "plan") {
        warnings.push(...validatePersonalization(answer, profile, recommendation));
      }
    } else {
      warnings.push(...validateGeneralFitnessAdvice(answer));
    }

    warnings.push(...validateSafetyLanguage(answer));
    warnings.push(...validateLanguageLock(answer, language));

    if (recommendation.missingFields.length > 0 && !isGeneralKnowledge) {
      const asksFollowup =
        /follow-up|follow up|can you share|please provide|could you tell|ban co the cho minh biet|ban vui long cung cap|cho minh xin them thong tin|cau hoi de ca nhan hoa/i.test(
          answer,
        );
      if (!asksFollowup) {
        warnings.push(
          "Answer does not ask follow-up questions despite missing user fields.",
        );
      }
    }

    return {
      valid: warnings.length === 0,
      warnings,
    };
  },
};
