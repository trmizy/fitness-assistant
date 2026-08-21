import type {
  RecommendationResult,
  ResponseLanguage,
  UserProfile,
  ValidationResult,
} from "./types";

// `(?:${keyword})` — a bare `${keyword}` before `[^\d]{0,20}(...)` mis-groups
// any "a|b" keyword alternation (e.g. "carb|carbs") as
// `(a)|(b[^\d]{0,20}(\d+))`, so a lone "carb" match with no number nearby
// still "matches" but with capture group 1 undefined. The non-capturing
// group makes the alternation apply to the keyword only, as intended.
//
// `\d{1,5}` (not `\d{2,5}`) — real bug found via E2E persona testing
// (24-ai-nutrition-persona-b-c.spec.ts): a lazy/small local LLM answer that
// literally writes "Đạm 0g" for a 125g target has a single-digit
// placeholder. The old 2-5-digit-only regex could never capture "0" (or any
// single digit).
function buildNearKeywordRegex(keyword: string): RegExp {
  return new RegExp(`(?:${keyword})[^\\d]{0,20}(\\d{1,5})`, "gi");
}

/**
 * Returns every number found near `keyword` in `text`, not just the first.
 *
 * Real bug found via E2E persona testing: a "meal" answer can legitimately
 * echo the correct deterministic target once (e.g. a pre-injected "Mục tiêu
 * ngày: ... Đạm: 125g" header) and THEN have the LLM's own free-text body
 * restate the same field wrong ("Đạm 0g" in its own table further down). A
 * first-match-only extractor finds the correct echo and stops, silently
 * missing the LLM's own later error. Scanning every occurrence and flagging
 * on the worst one matches this validator's own stated philosophy
 * elsewhere in this file ("the engine's number wins regardless of what the
 * model chose to say") — erring toward catching too much is the safe
 * direction here, since a false positive only costs a fallback to the
 * already-correct deterministic answer, never a wrong answer reaching the
 * user.
 */
function extractAllNumbersNearKeyword(text: string, keyword: string): number[] {
  const regex = buildNearKeywordRegex(keyword);
  const values: number[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const value = Number(match[1]);
    if (Number.isFinite(value)) values.push(value);
  }
  return values;
}

function worstDiffRatio(found: number[], expected: number): number {
  let worst = 0;
  for (const value of found) {
    const ratio = Math.abs(value - expected) / Math.max(1, expected);
    if (ratio > worst) worst = ratio;
  }
  return worst;
}

function validateCalories(
  text: string,
  expected: number,
  keyword: string = "calories|kcal",
): string[] {
  const warnings: string[] = [];
  if (!expected) return warnings;
  const found = extractAllNumbersNearKeyword(text, keyword);
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
): string[] {
  const warnings: string[] = [];
  if (!expected) return warnings;
  const found = extractAllNumbersNearKeyword(text, label);
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
): string[] {
  if (!profile) return [];

  const requiredSignals: string[] = [];
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
  const answerNorm = answer.toLowerCase();
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

      warnings.push(
        ...validateCalories(answer, nutrition.targetCalories || 0, caloriesKeyword),
      );
      warnings.push(
        ...validateMacro(answer, proteinKeyword, nutrition.proteinGrams || 0),
      );
      warnings.push(
        ...validateMacro(answer, carbKeyword, nutrition.carbsGrams || 0),
      );
      warnings.push(
        ...validateMacro(answer, fatKeyword, nutrition.fatGrams || 0),
      );
      warnings.push(...validateRequiredSections(answer, recommendation));
      warnings.push(...validateNutritionConsistency(recommendation));
      warnings.push(...validatePersonalization(answer, profile));
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
