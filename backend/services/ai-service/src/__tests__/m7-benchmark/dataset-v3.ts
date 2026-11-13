/**
 * Gymini V2 Multi-Agent — M7-P4 BENCHMARK v3 (routing). Written 2026-11-13 BEFORE any M7-P4 router change; frozen by
 * SHA-256 in heldout-v3.freeze.json (tests fail if this file changes).
 *
 * SINGLE-AUTHOR EVALUATION: the same AI engineer wrote v1, DEV, heldout v2, this set AND the router. No second annotator,
 * NOT expert-validated, independence from the tuning is limited (the author knows the router's rules). `review` marks
 * labels where reasonable annotators could differ.
 *
 * Splits:
 *   DEV_V3      — may be used while fixing KD-1 / KD-2 (inspected freely).
 *   HELDOUT_V3  — NOT used for tuning; the M7-P4 candidate is scored on it ONCE (re-runs only check determinism).
 *
 * Labelling protocol = the M5.1 heldout-v2 protocol, unchanged:
 *  - primaryAgent owns what the user ASKS for; background context / user statements do not create a required agent.
 *  - a supporting agent is REQUIRED only when the user's OWN data from that domain is needed to answer the ask.
 *  - "X hay Y" asks every option only when X and Y are two real alternatives; "hay" = "often" (tần suất) or "hay" =
 *    "good / catchy" asks nothing by itself. "mọi người" (everyone) is never a symptom; "mỏi người" (sore body) is.
 *  - ≥ 3 real needs: acceptable = the first two asks; the rest is expectDeferred (cap 2, as M5).
 * Phrasing styles new to v3: "mọi người / người ta" generalisations, frequency "hay", "hay" = good, teen/loose spelling,
 * noun-list imperatives, alternative questions inside one domain, comparison of two options, plus unaccented variants.
 */
import type { AgentLabel, CaseCategory, RoutingCase } from "../m5-benchmark/dataset-v1";

export type V3Split = "dev-v3" | "heldout-v3";
/** v3 adds feature tags for the two known defects (kd1 = mọi/mỏi người, kd2_* = the senses of "hay"). */
export type V3Feature = RoutingCase["features"][number] | "kd1" | "kd2_frequency" | "kd2_choice" | "kd2_other_sense";
export type V3Case = Omit<RoutingCase, "split" | "features"> & { split: V3Split; features: V3Feature[] };
const T: AgentLabel = "training", N: AgentLabel = "nutrition", R: AgentLabel = "recovery", P: AgentLabel = "progress";
type Opt = Partial<Pick<RoutingCase, "review" | "expectDeferred">> & { features?: V3Feature[] };
function mk(split: V3Split) {
  return (id: string, category: CaseCategory, q: string, primaryIntent: string, primaryAgent: AgentLabel | null, requiredAgents: AgentLabel[], acceptable: AgentLabel[][], rationale: string, o: Opt = {}): V3Case => {
    const coverage: RoutingCase["coverage"] = !requiredAgents.length ? "NONE" : (o.expectDeferred?.length ?? 0) > 0 ? "PARTIAL" : "FULL";
    return {
      id, q, category, primaryIntent, primaryAgent, requiredAgents, acceptable, expectDeferred: o.expectDeferred ?? [], coverage,
      evidence: [], forbiddenClaims: [], safety: "NONE", fixture: "default", rationale, features: o.features ?? ["natural"],
      ...(o.review ? { review: true as const } : {}), routingScored: true, split,
    };
  };
}
const d = mk("dev-v3");
const h = mk("heldout-v3");

export const ROUTING_CASES_DEV_V3: readonly V3Case[] = Object.freeze([
  d("D3-01", "SINGLE", "Mọi người thường ăn gì sau buổi tập tối?", "NUTRITION_POST_WORKOUT", N, [N], [[N]], "'Mọi người' = everyone, not soreness.", { features: ["kd1"] }),
  d("D3-02", "SINGLE", "moi nguoi tap gym bao lau thi thay ket qua", "TRAINING_EXPECTATION", T, [T], [[T], [P]], "Unaccented 'moi nguoi' without a state marker = everyone; general results timeline.", { features: ["kd1", "unaccented"], review: true }),
  d("D3-03", "SINGLE", "Tôi hay bị đói khi tập buổi sáng, nên ăn gì trước?", "NUTRITION_PRE_WORKOUT", N, [N], [[N]], "Frequency 'hay bị' is a self-report; the ask is food.", { features: ["kd2_frequency"] }),
  d("D3-04", "SINGLE", "Nên ăn cơm hay khoai trước khi tập?", "NUTRITION_PRE_WORKOUT", N, [N], [[N]], "Alternative inside one domain.", { features: ["kd2_choice"] }),
  d("D3-05", "SINGLE", "Tập tạ hay chạy bộ thì đốt mỡ tốt hơn?", "TRAINING_MODALITY", T, [T], [[T]], "Two training options.", { features: ["kd2_choice"] }),
  d("D3-06", "TWO", "Đổi lịch tập hay giảm lượng ăn thì tốt hơn cho tôi lúc này?", "CHOICE_TRAINING_OR_NUTRITION", T, [T, N], [[T, N]], "Alternative across two domains: both asked.", { features: ["kd2_choice"] }),
  d("D3-07", "SINGLE", "Mỏi người thế này thì có nên tập tiếp không?", "RECOVERY_FATIGUE", R, [R], [[R], [R, T]], "Accented 'mỏi người' = soreness.", { features: ["kd1"], review: true }),
  d("D3-08", "SINGLE", "toi hay bi moi nguoi sau khi chay", "RECOVERY_FATIGUE", R, [R], [[R]], "Unaccented with a state marker ('bi'): soreness.", { features: ["kd1", "kd2_frequency", "unaccented"] }),
  d("D3-09", "SINGLE", "Mọi người nghĩ sao về việc tập mỗi ngày?", "TRAINING_FREQUENCY", T, [T], [[T], [R]], "General frequency question.", { features: ["kd1"], review: true }),
  d("D3-10", "SINGLE", "Hôm nay trong lịch của tôi có bài nào cho tay không?", "TRAINING_TODAY", T, [T], [[T]], "Today's schedule content."),
  d("D3-11", "SINGLE", "Mục tiêu đạm hằng ngày của tôi là bao nhiêu gam?", "NUTRITION_TARGET", N, [N], [[N]], "Protein target."),
  d("D3-12", "SINGLE", "Ba tuần nay cân nặng của mình đi lên hay đi xuống?", "PROGRESS_WEIGHT_TREND", P, [P], [[P]], "Alternative inside progress.", { features: ["kd2_choice"] }),
  d("D3-13", "SINGLE", "Tôi hay quên ăn sáng, có ảnh hưởng tới việc giảm cân không?", "NUTRITION_HABIT", N, [N], [[N], [N, P]], "Frequency 'hay quên'; meal habit.", { features: ["kd2_frequency"], review: true }),
  d("D3-14", "SINGLE", "Người ta hay khuyên nghỉ 48 tiếng giữa hai buổi cùng nhóm cơ, đúng không?", "RECOVERY_REST", R, [R], [[R], [T]], "'Người ta hay khuyên' = people often advise.", { features: ["kd2_frequency"], review: true }),
  d("D3-15", "SINGLE", "Có nên tập bụng mỗi ngày hay cách ngày?", "TRAINING_FREQUENCY", T, [T], [[T]], "Two training-frequency options.", { features: ["kd2_choice"] }),
  d("D3-16", "SINGLE", "Sức mạnh của tôi có tăng không hay vẫn giậm chân tại chỗ?", "PROGRESS_STRENGTH", P, [P], [[P]], "Alternative inside progress."),
  d("D3-17", "TWO", "Tôi đang mệt hay là do ăn thiếu nhỉ?", "RECOVERY_OR_NUTRITION", R, [R, N], [[R, N]], "Alternative 'hay là' across recovery and nutrition.", { features: ["kd2_choice"], review: true }),
  d("D3-18", "TWO", "Hôm qua tập lưng xong hôm nay vẫn mỏi, nên tập chân hay nghỉ?", "TODAY_TRAIN_OR_REST", R, [R, T], [[R, T]], "Soreness + choice between training and rest.", { features: ["kd2_choice"] }),
  d("D3-19", "TWO", "Lượng calo hiện tại có hợp với tiến độ giảm cân của tôi không?", "NUTRITION_VS_PROGRESS", N, [N, P], [[N, P]], "Calorie target vs own progress."),
  d("D3-20", "MULTI", "Cho tôi xem tiến độ, lịch tập hôm nay và mục tiêu calo", "PROGRESS_TODAY_TARGET", P, [P, T, N], [[P, T]], "Noun-list imperative, three needs.", { expectDeferred: [N] }),
  d("D3-21", "OOS_AMBIGUOUS", "Mọi người ơi, app này dùng sao vậy?", "APP_HELP", null, [], [[]], "Vocative 'mọi người'; app help.", { features: ["kd1"] }),
  d("D3-22", "OOS_AMBIGUOUS", "Quán ăn healthy nào ngon ở Hà Nội?", "RESTAURANT", null, [], [[]], "Restaurant recommendation."),
  d("D3-23", "SINGLE", "Tập xong hay bị chóng mặt thì nên ăn gì?", "NUTRITION_POST_WORKOUT", N, [N], [[N], [N, R]], "Frequency 'hay bị'; the ask is food.", { features: ["kd2_frequency"], review: true }),
  d("D3-24", "SINGLE", "Lịch tập của tôi tuần này có buổi nghỉ nào không?", "TRAINING_SCHEDULE", T, [T], [[T], [T, R]], "Rest days in the schedule.", { review: true }),
  d("D3-25", "TWO", "Cơ bắp tôi tuần này có tăng không và có cần ngủ nhiều hơn không?", "PROGRESS_AND_RECOVERY", P, [P, R], [[P, R]], "Two asks."),
  d("D3-26", "SINGLE", "tuan nay toi nen tap may buoi", "TRAINING_FREQUENCY", T, [T], [[T]], "Unaccented frequency.", { features: ["unaccented"] }),
  d("D3-27", "SINGLE", "Mình hay ăn vặt buổi tối, có nên đổi thực đơn không?", "NUTRITION_PLAN", N, [N], [[N]], "Frequency 'hay ăn'.", { features: ["kd2_frequency"] }),
  d("D3-28", "SINGLE", "Chạy bộ hay đạp xe tốt cho đầu gối hơn?", "TRAINING_MODALITY", T, [T], [[T]], "Two training options.", { features: ["kd2_choice"] }),
  d("D3-29", "SINGLE", "Đau vai thì nên đổi bài ép ngực hay tạm dừng tập vai?", "TRAINING_SUBSTITUTION", T, [T], [[T], [T, R]], "Two training options with a pain context.", { features: ["kd2_choice"], review: true }),
  d("D3-30", "OOS_AMBIGUOUS", "Bài nhạc này hay quá, tập cùng được không?", "MUSIC", null, [], [[]], "'hay' = catchy; music.", { features: ["kd2_other_sense"] }),
]);

export const ROUTING_CASES_HELDOUT_V3: readonly V3Case[] = Object.freeze([
  // ── SINGLE: training (10) ──
  h("V-T01", "SINGLE", "Mai mình nên tập nhóm cơ nào nhỉ?", "TRAINING_SCHEDULE", T, [T], [[T]], "Tomorrow's session."),
  h("V-T02", "SINGLE", "Lịch tập tuần tới của tôi có bao nhiêu buổi chân?", "TRAINING_SCHEDULE", T, [T], [[T]], "Next week's schedule."),
  h("V-T03", "SINGLE", "Tập ngực bằng tạ đơn ở nhà thì có những bài gì?", "TRAINING_EXERCISE_CHOICE", T, [T], [[T]], "Exercise choice with equipment."),
  h("V-T04", "SINGLE", "Hip thrust với glute bridge cái nào tốt cho mông hơn?", "TRAINING_EXERCISE_COMPARE", T, [T], [[T]], "Exercise comparison."),
  h("V-T05", "SINGLE", "Tôi hay tập vai vào thứ mấy trong chương trình hiện tại?", "TRAINING_PROGRAM", T, [T], [[T]], "Frequency 'hay tập' about the own program.", { features: ["kd2_frequency"] }),
  h("V-T06", "SINGLE", "Mọi người thường khởi động bao lâu trước khi squat?", "TRAINING_WARMUP", T, [T], [[T]], "'Mọi người' = everyone; warm-up.", { features: ["kd1"] }),
  h("V-T07", "SINGLE", "nen tap full body hay chia nhom co cho nguoi moi", "TRAINING_SPLIT", T, [T], [[T]], "Unaccented alternative inside training.", { features: ["kd2_choice", "unaccented"] }),
  h("V-T08", "SINGLE", "Có cách nào thay bài kéo xà khi mình chưa kéo được cái nào không?", "TRAINING_SUBSTITUTION", T, [T], [[T]], "Substitution."),
  h("V-T09", "SINGLE", "Buổi tập hôm nay có mấy bài vậy?", "TRAINING_TODAY", T, [T], [[T]], "Today's session size."),
  h("V-T10", "SINGLE", "Mọi người hay tập mấy buổi một tuần, còn lịch hiện tại của tôi có đủ không?", "TRAINING_FREQUENCY", T, [T], [[T]], "KD-1 + KD-2 general clause, then the own schedule.", { features: ["kd1", "kd2_frequency"] }),
  // ── SINGLE: nutrition (9) ──
  h("V-N01", "SINGLE", "Một bữa nên ăn bao nhiêu gam đạm thì hợp lý?", "NUTRITION_PROTEIN", N, [N], [[N]], "Protein per meal."),
  h("V-N02", "SINGLE", "Mục tiêu năng lượng mỗi ngày của tôi hiện là bao nhiêu kcal?", "NUTRITION_TARGET", N, [N], [[N]], "Calorie target."),
  h("V-N03", "SINGLE", "Ăn khoai lang trước khi tập có tốt không?", "NUTRITION_PRE_WORKOUT", N, [N], [[N]], "Pre-workout food."),
  h("V-N04", "SINGLE", "Mọi người hay ăn gì để tăng cân sạch?", "NUTRITION_BULK", N, [N], [[N]], "KD-1 + KD-2: everyone often eats …", { features: ["kd1", "kd2_frequency"] }),
  h("V-N05", "SINGLE", "Thực đơn của tôi có khớp với mục tiêu dinh dưỡng không?", "NUTRITION_PLAN_CONSISTENCY", N, [N], [[N]], "Plan vs goal."),
  h("V-N06", "SINGLE", "uong whey luc nao la tot nhat", "NUTRITION_TIMING", N, [N], [[N]], "Unaccented supplement timing.", { features: ["unaccented"] }),
  h("V-N07", "SINGLE", "Người ta hay nói ăn tối muộn dễ béo, có đúng không?", "NUTRITION_MYTH", N, [N], [[N]], "'Người ta hay nói' = people often say.", { features: ["kd2_frequency"] }),
  h("V-N08", "SINGLE", "Mình nên uống bao nhiêu nước một ngày khi đang tập nặng?", "NUTRITION_HYDRATION", N, [N], [[N]], "Hydration; training is background."),
  h("V-N09", "SINGLE", "moi nguoi hay an sang bang gi truoc khi tap", "NUTRITION_PRE_WORKOUT", N, [N], [[N]], "Unaccented KD-1 + KD-2.", { features: ["kd1", "kd2_frequency", "unaccented"] }),
  // ── SINGLE: recovery (10) ──
  h("V-R01", "SINGLE", "Dạo này tôi hay bị chuột rút ban đêm, có cần nghỉ tập không?", "RECOVERY_REST", R, [R], [[R], [R, T]], "Frequency self-report + rest question.", { features: ["kd2_frequency"], review: true }),
  h("V-R02", "SINGLE", "Mỏi người quá, hôm nay có nên nghỉ không?", "RECOVERY_REST", R, [R], [[R], [R, T]], "Accented 'mỏi người' = soreness.", { features: ["kd1"], review: true }),
  h("V-R03", "SINGLE", "toi moi nguoi qua, co nen tap nhe thoi khong", "RECOVERY_FATIGUE", R, [R], [[R], [R, T]], "Unaccented with markers (first person + 'qua').", { features: ["kd1", "unaccented"], review: true }),
  h("V-R04", "SINGLE", "Ngủ có 5 tiếng thì cơ có phục hồi kịp không?", "RECOVERY_SLEEP", R, [R], [[R]], "Sleep and recovery (general)."),
  h("V-R05", "SINGLE", "Cơ đùi tôi vẫn còn ê sau buổi hôm kia, bình thường không?", "RECOVERY_SORENESS", R, [R], [[R]], "Lingering soreness."),
  h("V-R06", "SINGLE", "Bao lâu thì nên có một tuần giảm tải?", "RECOVERY_DELOAD", R, [R], [[R]], "Deload timing."),
  h("V-R07", "SINGLE", "Tuần qua tôi tập dồn liên tục, tải như vậy có quá sức không?", "RECOVERY_LOAD", R, [R], [[R]], "Own training load."),
  h("V-R08", "SINGLE", "Đau nhức sau tập kéo dài mấy ngày là bình thường?", "RECOVERY_SORENESS", R, [R], [[R]], "DOMS duration (general)."),
  h("V-R09", "SINGLE", "Mỏi người sau tập có sao không?", "RECOVERY_FATIGUE", R, [R], [[R]], "Accented 'mỏi người' without any marker.", { features: ["kd1"] }),
  h("V-R10", "SINGLE", "Tôi hay mỏi người mỗi khi tập xong, có phải thiếu ngủ không?", "RECOVERY_FATIGUE", R, [R], [[R]], "Frequency + soreness.", { features: ["kd1", "kd2_frequency"] }),
  // ── SINGLE: progress (8) ──
  h("V-P01", "SINGLE", "Từ lúc bắt đầu tới giờ tôi đã giảm được mấy ký?", "PROGRESS_WEIGHT", P, [P], [[P]], "Weight lost so far."),
  h("V-P02", "SINGLE", "Lần đo InBody mới nhất của tôi là khi nào?", "PROGRESS_MEASUREMENT", P, [P], [[P]], "Latest measurement date."),
  h("V-P03", "SINGLE", "Sức mạnh đẩy ngực của tôi tháng này có nhích lên không?", "PROGRESS_STRENGTH", P, [P], [[P]], "Strength trend."),
  h("V-P04", "SINGLE", "Tôi còn cách cân nặng mục tiêu bao xa?", "PROGRESS_GOAL_GAP", P, [P], [[P]], "Goal gap."),
  h("V-P05", "SINGLE", "Dự báo của app nói tôi sẽ về 65kg vào tháng sau, thực tế đang đi đúng hướng không?", "PROGRESS_FORECAST_VS_OBSERVED", P, [P], [[P]], "Forecast vs observed."),
  h("V-P06", "SINGLE", "Chu kỳ tập hiện tại có đánh giá gì chưa?", "PROGRESS_CYCLE_ASSESSMENT", P, [P], [[P], [T]], "Cycle assessment: progress or training.", { review: true }),
  h("V-P07", "SINGLE", "Mỡ bụng của mình có giảm chút nào không?", "PROGRESS_BODY_FAT", P, [P], [[P]], "Belly fat change."),
  h("V-P08", "SINGLE", "can nang toi thang nay thay doi the nao", "PROGRESS_WEIGHT_TREND", P, [P], [[P]], "Unaccented weight trend.", { features: ["unaccented"] }),
  // ── TWO (15) ──
  h("V-X01", "TWO", "Lịch tập hôm nay của tôi là gì, và sau buổi nên ăn gì?", "TODAY_AND_FOOD", T, [T, N], [[T, N]], "Two asks."),
  h("V-X02", "TWO", "Tôi hay bị đau gối khi squat, nên đổi bài nào và có cần nghỉ vài hôm không?", "SUBSTITUTION_AND_REST", T, [T, R], [[T, R]], "Frequency self-report; substitution + rest.", { features: ["kd2_frequency"] }),
  h("V-X03", "TWO", "Cân nặng của tôi chững lại ba tuần nay, có nên giảm calo không?", "CALORIES_VS_PLATEAU", N, [N, P], [[N, P]], "Calorie change needs the own weight trend."),
  h("V-X04", "TWO", "Sức mạnh squat của tôi giảm, có phải do tập quá tải không?", "STRENGTH_VS_LOAD", P, [P, R], [[P, R]], "Causal question across own strength and own load.", { review: true }),
  h("V-X05", "TWO", "Nên tập full body hay ăn kiêng trước để giảm mỡ?", "CHOICE_TRAINING_OR_DIET", T, [T, N], [[T, N]], "Alternative across two domains.", { features: ["kd2_choice"] }),
  h("V-X06", "TWO", "Tôi mệt rã rời, hôm nay vẫn nên tập theo lịch hay nghỉ?", "TODAY_TRAIN_OR_REST", R, [R, T], [[R, T]], "Fatigue + today's schedule vs rest."),
  h("V-X07", "TWO", "Tháng này tôi tăng cơ được bao nhiêu, và cần ăn thêm đạm không?", "MUSCLE_AND_PROTEIN", P, [P, N], [[P, N]], "Two asks."),
  h("V-X08", "TWO", "Sau khi tập xong hôm qua tôi bị đau lưng, hôm nay nên tập gì?", "TODAY_AFTER_PAIN", T, [T, R], [[T, R]], "Own history/pain + today."),
  h("V-X09", "TWO", "Tiến độ giảm mỡ của tôi chậm, thực đơn hiện tại có vấn đề không?", "PLAN_VS_PROGRESS", N, [N, P], [[N, P]], "Meal plan check needs the own progress."),
  h("V-X10", "TWO", "Nghỉ giữa các hiệp bao lâu và nên uống gì trong lúc tập?", "REST_INTERVAL_AND_DRINK", T, [T, N], [[T, N]], "General: set rest (training) + drink (nutrition)."),
  h("V-X11", "TWO", "Tôi ngủ kém mấy hôm nay, có nên giảm cường độ buổi tập ngày mai không?", "ADJUST_AFTER_POOR_SLEEP", T, [T, R], [[T, R], [T]], "Adjust tomorrow; sleep self-report may need recovery.", { review: true }),
  h("V-X12", "TWO", "Chương trình của tôi có cần thêm cardio để giảm cân nhanh hơn không, cân nặng mấy tuần nay đứng yên", "PROGRAM_VS_PLATEAU", T, [T, P], [[T, P]], "Program change needs the own weight trend."),
  h("V-X13", "TWO", "Ăn ít tinh bột thì có làm mình hay bị mệt khi tập không?", "LOW_CARB_FATIGUE", N, [N], [[N], [N, R]], "Frequency 'hay bị'; diet effect (general).", { features: ["kd2_frequency"], review: true }),
  h("V-X14", "TWO", "So với tháng trước tôi khỏe hơn chưa, và tuần này có nên deload không?", "PROGRESS_AND_DELOAD", P, [P, R], [[P, R]], "Two asks."),
  h("V-X15", "TWO", "Tôi muốn biết calo mục tiêu và số buổi tập mỗi tuần hiện tại của tôi", "TARGET_AND_FREQUENCY", N, [N, T], [[N, T]], "Two own-data asks in one clause."),
  // ── MULTI (6) ──
  h("V-M01", "MULTI", "Hôm nay tập gì, ăn bao nhiêu calo, và có cần ngủ thêm không?", "TODAY_FOOD_SLEEP", T, [T, N, R], [[T, N]], "Three asks; cap 2.", { expectDeferred: [R] }),
  h("V-M02", "MULTI", "Cân nặng tôi tuần này ra sao, thực đơn có ổn không và lịch tập có cần đổi không?", "WEIGHT_PLAN_PROGRAM", P, [P, N, T], [[P, N]], "Three asks; cap 2.", { expectDeferred: [T] }),
  h("V-M03", "MULTI", "Kiểm tra giúp tôi tiến độ tháng này, mục tiêu calo hiện tại và tình trạng phục hồi", "PROGRESS_TARGET_RECOVERY", P, [P, N, R], [[P, N]], "Imperative noun list; cap 2.", { expectDeferred: [R] }),
  h("V-M04", "MULTI", "Lịch tập tuần sau, lượng đạm cần ăn và số ngày nghỉ nên có là bao nhiêu?", "SCHEDULE_PROTEIN_REST", T, [T, N, R], [[T, N]], "Three asks; cap 2.", { expectDeferred: [R] }),
  h("V-M05", "MULTI", "Cho mình biết cân nặng hiện tại, buổi tập hôm nay và có nên nghỉ ngày mai không", "WEIGHT_TODAY_REST", P, [P, T, R], [[P, T]], "Three asks; cap 2.", { expectDeferred: [R] }),
  h("V-M06", "MULTI", "Xem giúp mục tiêu kcal, lịch tập hôm nay và mức tải tuần qua của tôi", "TARGET_TODAY_LOAD", N, [N, T, R], [[N, T]], "Imperative noun list; cap 2.", { expectDeferred: [R] }),
  // ── OUT OF SCOPE (8) ──
  h("V-O01", "OOS_AMBIGUOUS", "Phòng gym gần nhà mình mở cửa mấy giờ?", "GYM_HOURS", null, [], [[]], "Opening hours."),
  h("V-O02", "OOS_AMBIGUOUS", "Có nên mua đồng hồ thông minh để đo nhịp tim không?", "PURCHASE", null, [], [[]], "Purchase advice."),
  h("V-O03", "OOS_AMBIGUOUS", "Bạn có biết hôm nay thời tiết thế nào không?", "WEATHER", null, [], [[]], "Weather."),
  h("V-O04", "OOS_AMBIGUOUS", "Mọi người ơi, cho mình hỏi chút", "VOCATIVE", null, [], [[]], "Vocative 'mọi người' only.", { features: ["kd1"] }),
  h("V-O05", "OOS_AMBIGUOUS", "Bài hát nào hay để nghe khi tập?", "MUSIC", null, [], [[]], "'hay' = good; music.", { features: ["kd2_other_sense"] }),
  h("V-O06", "OOS_AMBIGUOUS", "Ứng dụng này có bản cho máy tính bảng không?", "APP_PLATFORM", null, [], [[]], "App platform."),
  h("V-O07", "OOS_AMBIGUOUS", "Kể cho mình một câu chuyện vui về con mèo đi", "SMALL_TALK", null, [], [[]], "Small talk."),
  h("V-O08", "OOS_AMBIGUOUS", "Giá một gói PT bao nhiêu tiền?", "PRICING", null, [], [[]], "Pricing."),
]);
