/**
 * Nutrition answer mode for questions routed to `meal_plan_request`.
 *
 * Found by the nutrition quality evaluation (test/ai-quality-eval, 2026-11-08, REAL HTTP/API, Nova Pro): the router's
 * meal_plan_request catch-all also captures DIRECT questions ("Một ngày tôi cần bao nhiêu calo?", "Tôi nên ăn bao nhiêu
 * protein?", "1 gram chất béo bao nhiêu calo?"). Those were answered with the full meal-plan template (the LLM copied
 * the template's "[...]" instruction lines verbatim) or, when the validator required meal sections that a direct answer
 * legitimately lacks, replaced by the deterministic meal-plan template that does not answer the question at all
 * (52% of baseline answers were such validation fallbacks).
 *
 * This module does NOT change routing (the intent stays meal_plan_request so the nutrition targets keep being
 * computed exactly as before); it only decides how that intent is ANSWERED:
 *   - "plan":   the user asked for a menu / meals / what to eat -> existing meal-plan format, unchanged.
 *   - "direct": any other nutrition question -> a short direct answer built on the same deterministic targets.
 * Numbers are never re-derived here: they come from RecommendationResult.nutrition (the ACTIVE NutritionGoal when one
 * exists, else the nutritionCalculator estimate), and are labelled PRESCRIBED vs ESTIMATED per the fitness-science
 * guardrails.
 */
import type { RecommendationResult } from "./types";

export type NutritionAnswerMode = "direct" | "plan" | "meal";

const fold = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

// Asking for a menu, a meal, a day of eating, or "what to eat" — the only questions that should get a meal plan.
// Word boundaries matter on the folded text: "ăn gián đoạn" folds to "an gian doan", which contains "an gi".
const PLAN_REQUEST =
  /\b(thuc don|meal ?plan|meal prep|bua (sang|trua|toi|phu|an|chinh)|cac bua|goi y (mon|bua|thuc don|mot bua|an gi)|an gi|mon (an|gi)|len (thuc don|ke hoach)|tao (thuc don|ke hoach)|xay dung (thuc don|ke hoach an|che do an)|thiet ke (thuc don|che do an)|che do an (mau|cho toi|cho minh)|ke hoach (an|dinh duong)|lich an|what (should|to) i eat|menu)\b/;
// ONE meal ("gợi ý một bữa trưa 600 kcal") — its figures are per-meal, never comparable with the DAILY targets.
// "Tối nay ăn gì?" is one meal too (examiner-style probe 2026-11-08: it got a whole-day plan).
const SINGLE_MEAL = /\b(mot bua|1 bua|bua (sang|trua|toi|phu|xe|khuya)|(sang|trua|chieu|toi|dem) nay|tonight|for (dinner|lunch|breakfast))\b/;
const WHOLE_DAY = /\b(thuc don|ca ngay|cac bua|may bua|\d+ bua|ke hoach|tuan|lich an|meal ?plan)\b/;

export function nutritionAnswerMode(question: string): NutritionAnswerMode {
  const q = fold(question);
  if (!PLAN_REQUEST.test(q)) return "direct";
  return SINGLE_MEAL.test(q) && !WHOLE_DAY.test(q) ? "meal" : "plan";
}

/** The question is about the user themself (tôi/mình/em/của tôi/I/my), not an impersonal fact. */
export function isPersonalQuestion(question: string): boolean {
  return /(^|[^a-z])(toi|minh|em|tui|i|my|me)([^a-z]|$)/.test(fold(question));
}

/**
 * "Chất béo mỗi ngày của mình nên là bao nhiêu gram?" — the user's OWN daily amount of a macro/energy. The intent router sends
 * fat questions to general_fitness_knowledge (no nutrition target in the prompt → "chưa có dữ liệu cụ thể", Opus judge PT-B3
 * 2026-11-08), while the same question about protein/carb/kcal reaches meal_plan_request; the orchestrator aligns them.
 */
export function isPersonalDailyTargetQuestion(question: string): boolean {
  const q = fold(question);
  const macro = /\b(chat beo|beo|fat|carb|carbs|tinh bot|protein|dam|calo|kcal|calories|calorie)\b/.test(q);
  // English ("What is my daily protein target?") answered the same as Vietnamese — it used to get a generic 153–187 g range
  // while the Vietnamese question got the saved 145 g goal (examiner-style probe 2026-11-08).
  const englishTarget = /\b(what('?s| is) my|my (daily )?(protein|calorie|calories|carb|carbs|fat|macro)s? (target|goal|intake))\b/.test(q);
  return isPersonalQuestion(question) && macro && (englishTarget
    || (/\bbao nhieu\b|how much/.test(q) && /\b(moi|mot|hang|1) ngay\b|per day|daily|a day/.test(q)));
}

/** "Con số 2370 kcal của tôi được tính như thế nào?" / "How is my calorie target calculated?" */
export function isCalculationExplanationQuestion(question: string): boolean {
  const q = fold(question);
  const subject = /\b(calo|kcal|calories|calorie|muc tieu|protein|macro|tdee|bmr)\b/.test(q);
  const how = /\b(tinh (nhu the nao|the nao|ra sao|bang cach nao)|duoc tinh|cach tinh|tinh ra|o dau ra|tai sao (lai )?(la|co)|vi sao (lai )?(la|co)|how (is|was|did you|do you) .{0,30}(calculat|comput|get)|why is my)\b/.test(q);
  return subject && how;
}

/**
 * Deterministic explanation from the engine's OWN figures (explainMaintenanceEstimate: same BMR formula and activity factor as
 * nutrition_calculator) plus the saved goal — the model used to answer "Harris-Benedict hoặc Mifflin" with no number.
 */
export function formatCalculationExplanation(
  profile: { age?: number; gender?: string; heightCm?: number; currentWeightKg?: number; inBody?: { weightKg?: number }; activityLevel?: string },
  rec: RecommendationResult,
  est: { bmr?: number; formula: string; activityFactor: number; maintenanceCalories?: number },
  language: "vi" | "en" = "vi",
  savedGoal?: SavedGoal,
): string | null {
  // The saved goal is what is being explained when it exists — the question itself names the number ("Con số 2370 kcal…"),
  // which made the calculator treat it as a what-if scenario and label it "ước tính".
  const n = savedGoal
    ? { ...rec.nutrition, targetCalories: savedGoal.calories, proteinGrams: savedGoal.protein, carbsGrams: savedGoal.carbs, fatGrams: savedGoal.fat }
    : rec.nutrition;
  const src = savedGoal ? "PRESCRIBED" : nutritionTargetSource(rec);
  if (!n?.targetCalories || !est.bmr || !est.maintenanceCalories) return null;
  const w = profile.currentWeightKg ?? profile.inBody?.weightKg;
  const diff = n.targetCalories - est.maintenanceCalories, pct = Math.round((Math.abs(diff) / est.maintenanceCalories) * 100);
  const activity: Record<string, string> = { SEDENTARY: "ít vận động", LIGHTLY_ACTIVE: "vận động nhẹ", MODERATELY_ACTIVE: "vận động vừa", VERY_ACTIVE: "vận động nhiều", EXTREMELY_ACTIVE: "vận động rất nhiều" };
  const bmrSource = est.formula === "inbody_bmr" ? "đo từ InBody" : `công thức Mifflin-St Jeor từ ${w ?? "?"} kg, ${profile.heightCm ?? "?"} cm, ${profile.age ?? "?"} tuổi, ${profile.gender === "FEMALE" ? "nữ" : "nam"}`;
  if (language === "en") {
    return [
      `Your ${n.targetCalories} kcal/day ${src === "PRESCRIBED" ? "is your saved nutrition goal" : "is an estimate"}. How it is derived:`,
      "",
      `1. **BMR ≈ ${est.bmr} kcal** (${est.formula === "inbody_bmr" ? "measured by InBody" : "Mifflin-St Jeor from your weight, height, age and sex"}).`,
      `2. × activity factor **${est.activityFactor}** → estimated maintenance **≈ ${est.maintenanceCalories} kcal/day**.`,
      `3. ${diff === 0 ? "Goal = maintenance" : `${diff < 0 ? "Deficit" : "Surplus"} of ${Math.abs(diff)} kcal (~${pct}%) for your goal`} → **${n.targetCalories} kcal/day**.`,
      `4. Macros: protein ${n.proteinGrams} g${w && n.proteinGrams ? ` (~${(n.proteinGrams / w).toFixed(1)} g/kg)` : ""}, fat ${n.fatGrams} g, the rest as carbs ${n.carbsGrams} g.`,
      "",
      "_These are estimates (±10%); adjust after 2–3 weeks of real weight trend._",
    ].join("\n");
  }
  return [
    `Con số **${n.targetCalories} kcal/ngày** ${src === "PRESCRIBED" ? "là mục tiêu dinh dưỡng đang áp dụng trong hồ sơ của bạn" : "là con số ước tính"}. Cách hệ thống tính:`,
    "",
    `1. **BMR (năng lượng cơ bản) ≈ ${est.bmr} kcal** — ${bmrSource}.`,
    `2. Nhân hệ số vận động **${est.activityFactor}** (${activity[profile.activityLevel ?? ""] ?? "mặc định"}) → mức duy trì **ước tính ≈ ${est.maintenanceCalories} kcal/ngày**.`,
    `3. ${diff === 0 ? "Mục tiêu = mức duy trì" : `${diff < 0 ? "Thâm hụt" : "Thặng dư"} ${Math.abs(diff)} kcal (~${pct}%) theo mục tiêu của bạn`} → **${n.targetCalories} kcal/ngày**.`,
    `4. Macro: protein **${n.proteinGrams} g**${w && n.proteinGrams ? ` (~${(n.proteinGrams / w).toFixed(1)} g/kg)` : ""}, chất béo **${n.fatGrams} g**, phần còn lại là carb **${n.carbsGrams} g**.`,
    "",
    "_Đây là ước tính (sai số thường ±10%) — nên hiệu chỉnh theo xu hướng cân nặng thực tế sau 2–3 tuần._",
  ].join("\n");
}

/** True when the meal_plan_request turn should be answered directly instead of with the meal-plan format. */
export function isDirectNutritionQuestion(routedIntent: string | undefined, question: string): boolean {
  return routedIntent === "meal_plan_request" && nutritionAnswerMode(question) === "direct";
}

/** Answer mode used for validation: only meaningful for meal_plan_request, every other intent keeps "plan" (unchanged). */
export function nutritionValidationMode(routedIntent: string | undefined, question: string): NutritionAnswerMode {
  return routedIntent === "meal_plan_request" ? nutritionAnswerMode(question) : "plan";
}

/** The ACTIVE NutritionGoal is the prescription; anything else is an estimate (fitness-science guardrails). */
export function nutritionTargetSource(rec: RecommendationResult): "PRESCRIBED" | "ESTIMATED" | "SCENARIO" | "NONE" {
  const n = rec.nutrition;
  if (!n?.targetCalories) return "NONE";
  // isNutritionWhatIf (nutrition_calculator.ts): numbers computed for a goal/target the user NAMED in this question —
  // a scenario, never the saved goal (Opus judge, WI-C1 2026-11-08: "tập nặng hơn để tăng cơ" was answered as
  // "lượng calo hiện tại của bạn cần tăng lên 2000 kcal", as if the prescription had changed).
  if (rec.mealPlan?.whatIf) return "SCENARIO";
  return /NutritionGoal/i.test(n.formula ?? "") ? "PRESCRIBED" : "ESTIMATED";
}
type SavedGoal = { calories: number; protein: number; carbs: number; fat: number } | undefined;
const savedGoalText = (g: SavedGoal) => (g ? `${g.calories} kcal, protein ${g.protein} g, carb ${g.carbs} g, béo ${g.fat} g` : "chưa có mục tiêu đã lưu");

/** Prompt section for the direct mode (Vietnamese product language). */
export function directNutritionPromptLines(rec: RecommendationResult, weightKg?: number, savedGoal?: SavedGoal, language: "vi" | "en" = "vi"): string[] {
  const n = rec.nutrition, src = nutritionTargetSource(rec);
  const srcLabel = src === "PRESCRIBED" ? "MỤC TIÊU DINH DƯỠNG ĐANG ÁP DỤNG của người dùng (đã lưu trong hồ sơ)"
    : src === "SCENARIO" ? `KỊCH BẢN GIẢ ĐỊNH tính theo mục tiêu/con số người dùng nêu trong câu hỏi — KHÔNG phải mục tiêu hiện tại. Mục tiêu đang áp dụng (${savedGoalText(savedGoal)}) GIỮ NGUYÊN; nêu cả hai và nói rõ muốn đổi mục tiêu thì cập nhật trong phần Dinh dưỡng (hoặc hỏi chuyên gia nếu mục tiêu do PT/chuyên gia đặt)`
    : src === "ESTIMATED" ? "ƯỚC TÍNH từ hồ sơ (công thức Mifflin-St Jeor × hệ số vận động), CHƯA phải mục tiêu đã lưu" : "chưa có số liệu";
  const perKg = weightKg && n.proteinGrams ? ` (~${(n.proteinGrams / weightKg).toFixed(1)} g/kg)` : "";
  return [
    `ĐỊNH DẠNG ĐẦU RA BẮT BUỘC — TRẢ LỜI TRỰC TIẾP (đây KHÔNG phải yêu cầu thực đơn), viết bằng ${language === "en" ? "TIẾNG ANH (the user wrote in English — answer in English)" : "tiếng Việt"}:`,
    `- Nguồn các con số mục tiêu: ${srcLabel}.`,
    n.maintenanceCalories ? `- Mức calo duy trì ƯỚC TÍNH (chỉ dùng khi được hỏi về mức duy trì/TDEE): ${n.maintenanceCalories} kcal/ngày (sai số thường ±10%).` : "",
    `- Câu ĐẦU TIÊN trả lời thẳng vào đúng điều người dùng hỏi. Nếu họ hỏi con số của chính họ, dùng ĐÚNG con số ở mục "Chỉ số tính toán" (calo ${n.targetCalories ?? "?"} kcal, protein ${n.proteinGrams ?? "?"} g${perKg}, carb ${n.carbsGrams ?? "?"} g, béo ${n.fatGrams ?? "?"} g) và nói rõ đó là ${src === "PRESCRIBED" ? "mục tiêu hiện tại của họ" : src === "SCENARIO" ? "con số theo kịch bản họ hỏi, không phải mục tiêu hiện tại" : "con số ước tính"}.`,
    "- Nếu là câu hỏi KIẾN THỨC chung, trả lời theo kiến thức dinh dưỡng chuẩn; chỉ nhắc con số cá nhân khi thật sự liên quan.",
    "- Nếu họ nêu một con số khác (giả định 'nếu tôi ăn X kcal…'), tính theo con số họ nêu, nói rõ đây là ước tính theo giả định và KHÔNG thay đổi mục tiêu đã lưu.",
    "- Sau câu trả lời: 2–4 gạch đầu dòng ngắn giải thích lý do và cách áp dụng. Thêm lưu ý an toàn khi phù hợp (bệnh lý, mang thai, dưới 18 tuổi → khuyên hỏi bác sĩ/chuyên gia).",
    language === "en" ? "- Do NOT write a meal plan, do NOT copy bracketed template lines." : "- KHÔNG viết thực đơn theo bữa, KHÔNG thêm mục 'Hành động tuần này', KHÔNG chép các dòng hướng dẫn trong ngoặc vuông, KHÔNG dùng câu tiếng Anh.",
    "- Độ dài khoảng 80–220 từ.",
  ].filter(Boolean);
}

/** Extra instructions prepended to the meal format when the user asked for ONE meal. */
/** Macros for ONE meal of `kcal` that add up (4/4/9 kcal/g), from the saved goal's split; "giàu protein" keeps protein ≥ 35% of energy. */
export function mealMacroTargets(kcal: number, saved?: { calories: number; protein: number; carbs: number; fat: number }, highProtein = false) {
  const pShare0 = saved ? (saved.protein * 4) / saved.calories : 0.3, fShare = saved ? (saved.fat * 9) / saved.calories : 0.25;
  const pShare = highProtein ? Math.max(pShare0, 0.35) : pShare0, cShare = Math.max(0, 1 - pShare - fShare);
  return { calories: kcal, protein: Math.round((kcal * pShare) / 4), carbs: Math.round((kcal * cShare) / 4), fat: Math.round((kcal * fShare) / 9) };
}

export function singleMealPromptLines(question = "", saved?: { calories: number; protein: number; carbs: number; fat: number }): string[] {
  // A meal kcal the user named ("bữa trưa khoảng 600 kcal") gets macros computed here — the model's own table said
  // "600 kcal · 55P/35C/15F", which sums to ~495 kcal (expert human review H16, 2026-11-08).
  const q = fold(question).replace(/(\d)[.,](\d{3})\b/g, "$1$2"), m = q.match(/\b(\d{3,4})\s*(kcal|calo)\b/);
  const mealKcal = m ? Number(m[1]) : null;
  const mt = mealKcal && mealKcal >= 150 && mealKcal <= 2000 ? mealMacroTargets(mealKcal, saved, /\b(giau (protein|dam)|nhieu (protein|dam)|high protein)\b/.test(q)) : null;
  return [
    "LƯU Ý: người dùng chỉ hỏi MỘT BỮA — chỉ gợi ý đúng bữa đó (không lập thực đơn cả ngày).",
    mt ? `- Bảng chỉ số của BỮA NÀY phải dùng ĐÚNG: ${mt.calories} kcal · đạm ${mt.protein} g · carb ${mt.carbs} g · béo ${mt.fat} g (đã tính sẵn, cộng lại khớp kcal theo 4/4/9 kcal mỗi gram). Món và khẩu phần gợi ý phải cộng lại gần các con số này.`
      : "- Nếu họ nêu mức kcal cho bữa này, bảng chỉ số là của BỮA ĐÓ và phải gần mức họ nêu; KHÔNG ghi chỉ số cả ngày vào bảng.",
    "- Tôn trọng tuyệt đối dị ứng / kiêng / ăn chay họ nêu: không đưa bất kỳ món nào thuộc nhóm đó, kể cả ở phần thay thế.",
    "",
  ];
}

/** Deterministic direct answer — the fallback when the LLM is unavailable or its answer fails validation. */
export function formatDirectNutritionAnswer(question: string, rec: RecommendationResult, weightKg?: number, language: "vi" | "en" = "vi"): string {
  const n = rec.nutrition, q = fold(question), src = nutritionTargetSource(rec);
  if (language === "en" && src !== "NONE") {
    const label = src === "PRESCRIBED" ? "your saved nutrition goal" : src === "SCENARIO" ? "an estimate for the scenario you asked about — your saved goal is unchanged" : "an estimate from your profile (Mifflin-St Jeor × activity), not a saved goal yet";
    const perKg = weightKg && n.proteinGrams ? ` (~${(n.proteinGrams / weightKg).toFixed(1)} g/kg)` : "";
    return [`Your daily targets (${label}):`, "", `- Calories: **${n.targetCalories} kcal** · Protein: **${n.proteinGrams} g**${perKg} · Carbs: **${n.carbsGrams} g** · Fat: **${n.fatGrams} g**`,
      "- Spread protein over 3–4 meals; adjust after 2–3 weeks of real weight trend.", "", "_Reference figures, not a guarantee. With a medical condition, pregnancy or if under 18, ask a doctor/dietitian._"].join("\n");
  }
  // Energy per gram of a macronutrient is a fixed fact (Atwater factors), not a personal number.
  if (/\b1\s*(g|gram)\b/.test(q) && /(calo|kcal|calorie|nang luong)/.test(q) && /(protein|dam|carb|tinh bot|beo|fat|chat beo|ruou|con)/.test(q)) {
    return [
      "Theo hệ số Atwater (dùng chuẩn trên nhãn dinh dưỡng):",
      "",
      "- **1 g protein ≈ 4 kcal**",
      "- **1 g carb (tinh bột/đường) ≈ 4 kcal**",
      "- **1 g chất béo ≈ 9 kcal**",
      "- 1 g cồn ≈ 7 kcal; chất xơ cung cấp ít hơn (khoảng 2 kcal/g).",
      "",
      "Vì vậy cùng một lượng gram, chất béo cung cấp năng lượng gấp hơn 2 lần protein hay carb.",
    ].join("\n");
  }
  if (src === "NONE") {
    return "Mình chưa đủ thông tin hồ sơ để tính con số dinh dưỡng cho bạn. Bạn cho mình biết tuổi, giới tính, chiều cao, cân nặng và mức độ vận động hằng ngày nhé — mình sẽ không đoán để tránh đưa con số sai.";
  }
  const label = src === "PRESCRIBED" ? "theo mục tiêu dinh dưỡng đang áp dụng trong hồ sơ của bạn"
    : src === "SCENARIO" ? "ước tính theo kịch bản bạn hỏi — mục tiêu đã lưu của bạn vẫn giữ nguyên"
    : "ước tính từ hồ sơ của bạn (công thức Mifflin-St Jeor × hệ số vận động), chưa phải mục tiêu đã lưu";
  const perKg = weightKg && n.proteinGrams ? ` (khoảng ${(n.proteinGrams / weightKg).toFixed(1)} g/kg cân nặng)` : "";
  const lines: string[] = [];
  const asksMaintenance = /(duy tri|tdee|maintenance|giu can)/.test(q) && n.maintenanceCalories;
  const asksProtein = /(protein|dam\b|chat dam)/.test(q), asksFat = /(chat beo|\bbeo\b|\bfat\b)/.test(q), asksCarb = /(carb|tinh bot)/.test(q);
  const asksKcal = /(calo|kcal|calorie|nang luong)/.test(q), asksMacro = /macro|chia/.test(q);
  if (asksMaintenance) {
    lines.push(`Mức calo duy trì **ước tính** của bạn khoảng **${n.maintenanceCalories} kcal/ngày** (sai số thường khoảng ±10% — nên hiệu chỉnh theo cân nặng thực tế sau 2–3 tuần).`);
    lines.push(`Mục tiêu năng lượng hiện tại: **${n.targetCalories} kcal/ngày** (${label}).`);
  } else if (asksProtein && !asksMacro) {
    lines.push(`Lượng protein mục tiêu của bạn là **${n.proteinGrams} g/ngày**${perKg} — ${label}.`);
  } else if (asksFat && !asksMacro && !asksKcal) {
    lines.push(`Lượng chất béo mục tiêu của bạn là **${n.fatGrams} g/ngày** — ${label}.`);
  } else if (asksCarb && !asksMacro && !asksKcal) {
    lines.push(`Lượng carb mục tiêu của bạn là **${n.carbsGrams} g/ngày** — ${label}.`);
  } else if (asksKcal && !asksMacro) {
    lines.push(`Mỗi ngày bạn nên ăn khoảng **${n.targetCalories} kcal** — ${label}.`);
    if (n.maintenanceCalories && n.targetCalories !== n.maintenanceCalories) lines.push(`Mức duy trì ước tính của bạn khoảng ${n.maintenanceCalories} kcal/ngày.`);
  } else {
    lines.push(`Mục tiêu mỗi ngày của bạn (${label}):`);
  }
  lines.push("", `- Calo: **${n.targetCalories} kcal** · Protein: **${n.proteinGrams} g**${perKg} · Carb: **${n.carbsGrams} g** · Chất béo: **${n.fatGrams} g**`);
  lines.push("- Chia protein đều cho 3–4 bữa; ưu tiên thực phẩm ít chế biến.");
  lines.push("- Theo dõi cân nặng trung bình theo tuần trong 2–3 tuần rồi mới điều chỉnh, không phản ứng theo 1 ngày.");
  lines.push("", "_Đây là số liệu tham khảo, không phải cam kết kết quả. Nếu bạn có bệnh lý, đang mang thai hoặc dưới 18 tuổi, hãy hỏi bác sĩ/chuyên gia dinh dưỡng._");
  return lines.join("\n");
}

/**
 * Removes template-instruction artefacts the LLM copied verbatim from the prompt's format scaffold
 * ("## [Một câu nhận xét …]", "[1–2 câu lý giải …]", "[Chỉ thêm nếu hồ sơ thiếu]"). Markdown links and numeric
 * citations ("[1]") are kept.
 */
export function stripTemplateArtifacts(answer: string): string {
  return answer
    .split("\n")
    .filter((line) => !/^\s*(#{1,6}\s*)?\[(?!\d+\])[^\]\n]{6,}\]\s*$/.test(line))
    .map((line) => line.replace(/^(\s*#{1,6}\s*)?\[(?!\d+\])[^\]\n]{6,}\](?!\()\s*/, (_m, h) => (h ? h : "")))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── Deterministic nutrition arithmetic (expert human review, 2026-11-08) ──────────────────────────────────────────────────────
// The model got these sums wrong: "giảm 3 kg trong 2 tháng" -> "thâm hụt 500–700 kcal, ăn 1152–1352" (correct ≈ 385 kcal/day),
// "chia 4 bữa" -> it silently lowered the saved 1874 kcal goal to 1400, "ăn 2200 kcal có quá nhiều không" never compared with
// the saved goal, "Còn protein thì sao?" hit the saved-meal lookup. The numbers below come from the saved goal / the engine's
// maintenance estimate; the conventions used (≈7700 kcal per kg of body-weight change) are stated in the answer.
type Goal4 = { calories: number; protein: number; carbs: number; fat: number };
const KCAL_PER_KG = 7700;

export function parseWeightChangeGoal(question: string): { direction: "lose" | "gain"; kg: number; days: number } | null {
  const q = fold(question).replace(/(\d),(\d)/g, "$1.$2");
  const m = q.match(/\b(giam|xuong|bot|tang|len)\s*(\d+(?:\.\d+)?)\s*(?:kg|ky|can)\b.{0,12}?\b(?:trong|sau|chi)\s*(\d+)\s*(ngay|tuan|thang)\b/);
  if (!m) return null;
  const n = Number(m[3]), days = m[4] === "ngay" ? n : m[4] === "tuan" ? n * 7 : n * 30;
  const kg = Number(m[2]);
  if (!(kg > 0 && kg <= 50 && days >= 7 && days <= 730)) return null;
  return { direction: /^(giam|xuong|bot)$/.test(m[1]) ? "lose" : "gain", kg, days };
}

export function formatWeightChangeAnswer(g: { direction: "lose" | "gain"; kg: number; days: number }, ctx: { maintenance?: number; saved?: Goal4; weightKg?: number; gender?: string }): string {
  const perDay = Math.round((g.kg * KCAL_PER_KG) / g.days), perWeekKg = Math.round(((g.kg / g.days) * 7) * 100) / 100;
  const lines = [
    `Để ${g.direction === "lose" ? "giảm" : "tăng"} **${g.kg} kg trong ${g.days} ngày** cần ${g.direction === "lose" ? "thâm hụt" : "thặng dư"} trung bình khoảng **${perDay} kcal/ngày** (quy ước ≈ ${KCAL_PER_KG} kcal cho 1 kg thay đổi cân nặng) — tức khoảng **${perWeekKg} kg/tuần**.`,
  ];
  // An unsafe loss goal ("giảm 20kg trong 1 tháng") must lead with the warning and a realistic timeline — never print the
  // implied intake when it is below the floor (the post-fix eval 2026-11-08 caught "ăn khoảng -2345 kcal/ngày", EX-SAFE1).
  const floor = ctx.gender === "FEMALE" ? 1200 : 1500;
  const target = ctx.maintenance ? (g.direction === "lose" ? ctx.maintenance - perDay : ctx.maintenance + perDay) : null;
  const pctWeek = ctx.weightKg ? Math.round((perWeekKg / ctx.weightKg) * 1000) / 10 : null;
  // Unsafe = the RATE is far too fast, or the intake would be <= 0. A safe rate that only dips under the floor (a small person,
  // H10) keeps the normal answer plus its floor warning below.
  if (g.direction === "lose" && ((target !== null && target <= 0) || (pctWeek !== null && pctWeek > 1.5) || (pctWeek === null && perWeekKg > 1.2))) {
    const fast = ctx.weightKg ? ctx.weightKg * 0.01 : 1, slow = ctx.weightKg ? ctx.weightKg * 0.005 : 0.5;
    const wFrom = Math.ceil(g.kg / fast), wTo = Math.ceil(g.kg / slow);
    const out = [
      `⚠️ Giảm **${g.kg} kg trong ${g.days} ngày** là **không an toàn và không thực tế**: cần thâm hụt khoảng **${perDay} kcal/ngày** (≈ ${perWeekKg} kg/tuần${pctWeek !== null ? `, ${pctWeek}% cân nặng/tuần` : ""}).`,
      target !== null
        ? (target <= 0
          ? `- Con số đó còn lớn hơn toàn bộ năng lượng cơ thể bạn tiêu hao mỗi ngày (mức duy trì **ước tính** khoảng ${ctx.maintenance} kcal) — không thể đạt được bằng ăn uống.`
          : `- Bạn sẽ phải ăn khoảng ${target} kcal/ngày, thấp hơn ngưỡng thường khuyên không nên xuống dưới (~${floor} kcal/ngày nếu không có chuyên gia theo dõi).`)
        : "- Mức thâm hụt này vượt xa khoảng thường khuyên.",
      "- Giảm quá nhanh làm mất cơ, thiếu vi chất, tăng nguy cơ sỏi mật và dễ tăng cân trở lại.",
      "",
      `**Khung thực tế hơn:** giảm khoảng 0,5–1% cân nặng/tuần → ${g.kg} kg mất khoảng **${wFrom}–${wTo} tuần**${ctx.maintenance ? `, ăn khoảng **${Math.max(floor, ctx.maintenance - 500)} kcal/ngày** (thâm hụt ~500 kcal so với mức duy trì ước tính)` : ""}.`,
    ];
    if (ctx.saved) out.push(`- Mục tiêu đang lưu của bạn là **${ctx.saved.calories} kcal/ngày** — câu trả lời này không thay đổi mục tiêu đó.`);
    out.push("", "_Nếu cần giảm nhanh vì lý do sức khỏe, hãy làm dưới sự theo dõi của bác sĩ hoặc chuyên gia dinh dưỡng._");
    return out.join("\n");
  }
  if (ctx.maintenance && target !== null) {
    lines.push(`- Mức duy trì **ước tính** của bạn khoảng ${ctx.maintenance} kcal/ngày → ăn khoảng **${target} kcal/ngày**.`);
    if (g.direction === "lose" && target < floor) lines.push(`- ⚠️ Mức này thấp hơn ngưỡng thường khuyên không nên xuống dưới (~${floor} kcal/ngày nếu không có chuyên gia theo dõi) — nên kéo dài thời gian thay vì ăn ít hơn.`);
  }
  if (ctx.weightKg) {
    const pct = Math.round((perWeekKg / ctx.weightKg) * 1000) / 10;
    lines.push(g.direction === "lose"
      ? (pct > 1 ? `- ⚠️ Tốc độ ${pct}% cân nặng/tuần là nhanh (thường khuyên khoảng 0,5–1%/tuần để giữ cơ).` : `- Tốc độ ${pct}% cân nặng/tuần nằm trong khoảng thường khuyên (0,5–1%/tuần).`)
      : `- Tăng cân chậm (khoảng 0,25–0,5% cân nặng/tuần) giúp phần tăng thêm là cơ nhiều hơn mỡ.`);
  }
  if (ctx.saved) lines.push(`- Mục tiêu đang lưu của bạn là **${ctx.saved.calories} kcal/ngày** — câu trả lời này chỉ là tính toán tham khảo, không thay đổi mục tiêu đó.`);
  lines.push("", "_Cân nặng thực tế dao động theo nước/glycogen; hãy theo dõi trung bình theo tuần trong 2–3 tuần rồi mới điều chỉnh._");
  return lines.join("\n");
}

export function parseMealSplit(question: string): number | null {
  const q = fold(question);
  if (!/\b(chia|moi bua|tung bua|1 bua|mot bua)\b/.test(q)) return null;
  const m = q.match(/\b([2-8])\s*bua\b/);
  return m ? Number(m[1]) : null;
}

export function formatMealSplitAnswer(n: number, saved: Goal4, source: "PRESCRIBED" | "ESTIMATED"): string {
  const per = (x: number) => Math.round((x / n) * 10) / 10;
  return [
    `Chia đều **${saved.calories} kcal/ngày** (${source === "PRESCRIBED" ? "mục tiêu đang áp dụng" : "con số ước tính"}) cho **${n} bữa**, mỗi bữa khoảng:`,
    "",
    `- **${Math.round(saved.calories / n)} kcal** · đạm **${per(saved.protein)} g** · carb **${per(saved.carbs)} g** · béo **${per(saved.fat)} g**`,
    "",
    "- Không cần chia tuyệt đối đều: bữa sau tập có thể nhiều carb hơn, bữa phụ nhỏ hơn — miễn tổng ngày đúng.",
    "- Nên có đạm ở mọi bữa (khoảng 20–40 g/bữa) để tối ưu tổng hợp cơ.",
  ].join("\n");
}

export function parseStatedKcalComparison(question: string): number | null {
  const q = fold(question).replace(/(\d)[.,](\d{3})\b/g, "$1$2");
  const m = q.match(/\b(\d{3,4})\s*(kcal|calo|calories)\b/);
  if (!m) return null;
  if (!/\b(qua nhieu|qua it|nhieu qua|it qua|co (du|nhieu|it|hop ly|on|duoc)|du khong|du chua|hop ly|co sao|thua|thieu|is .* (too much|enough))\b/.test(q)) return null;
  const k = Number(m[1]);
  return k >= 800 && k <= 6000 ? k : null;
}

export function formatStatedKcalComparison(kcal: number, ctx: { saved?: Goal4; maintenance?: number; goalType?: string }): string {
  const lines: string[] = [];
  if (ctx.saved) {
    const d = kcal - ctx.saved.calories;
    lines.push(`**${kcal} kcal** ${d === 0 ? "đúng bằng" : d > 0 ? `cao hơn **${d} kcal**` : `thấp hơn **${-d} kcal**`} so với mục tiêu đang lưu của bạn (**${ctx.saved.calories} kcal/ngày**).`);
  } else lines.push(`Bạn chưa có mục tiêu dinh dưỡng đã lưu để so sánh với ${kcal} kcal.`);
  if (ctx.maintenance) {
    const d = kcal - ctx.maintenance, pct = Math.round((Math.abs(d) / ctx.maintenance) * 100);
    lines.push(`- So với mức duy trì **ước tính** (~${ctx.maintenance} kcal): ${d >= 0 ? `thặng dư ${d} kcal (~${pct}%)` : `thâm hụt ${-d} kcal (~${pct}%)`}.`);
    if (ctx.goalType === "MUSCLE_GAIN") lines.push(d > 0 && pct > 20
      ? "- Với tăng cơ, thặng dư lớn hơn khoảng 10–20% thường làm tăng mỡ nhiều hơn mà không tăng cơ nhanh hơn — nên giữ thặng dư nhẹ."
      : d > 0 ? "- Mức thặng dư này nằm trong khoảng thường dùng cho tăng cơ (khoảng 10–20% trên mức duy trì)." : "- Ăn dưới mức duy trì sẽ khó tăng cơ; với mục tiêu tăng cơ thường cần thặng dư nhẹ.");
    if (ctx.goalType === "WEIGHT_LOSS" && d >= 0) lines.push("- Mức này không tạo thâm hụt nên sẽ khó giảm mỡ.");
  }
  lines.push("", "_Đây là so sánh tham khảo — mục tiêu đã lưu không thay đổi. Muốn đổi mục tiêu, cập nhật trong trang Dinh dưỡng (hoặc hỏi PT/chuyên gia nếu mục tiêu do họ đặt)._");
  return lines.join("\n");
}

/** "Còn protein thì sao?" — a short follow-up about one of the user's own targets. */
export function isFollowUpMacroQuestion(question: string): boolean {
  const q = fold(question).replace(/[?.!]/g, "").trim();
  return q.split(" ").length <= 8 && /^(con|the con|vay con|con ve|the)\s+(protein|dam|carb|tinh bot|chat beo|beo|fat|calo|kcal)\b/.test(q);
}
