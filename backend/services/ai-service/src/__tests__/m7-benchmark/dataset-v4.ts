/**
 * Gymini V2 Multi-Agent — M7-P4.1 BENCHMARK v4 (routing). Written 2026-11-13 BEFORE any M7-P4.1 router change; frozen by
 * SHA-256 in heldout-v4.freeze.json together with the metric definitions and gates (tests fail if this file changes).
 *
 * SINGLE-AUTHOR EVALUATION — POSSIBLE BIAS: the same AI engineer wrote every earlier set, this set AND the router; no second
 * annotator; NOT expert-validated; `review` marks labels reasonable annotators could dispute. These are author-written
 * sentences — they do NOT claim to represent real user traffic.
 *
 * Splits: DEV_V4 (may be used while correcting) · HELDOUT_V4 (scored ONCE by the final M7-P4.1 candidate).
 * Focus = the four M7-P4.1 error groups, in phrasings / structures not used in v1 / DEV / v2 / v3:
 *   A recovery ownership — soreness wording ("ê", "nhức", "đau nhức"), load ("tập dồn", "mức tải"), rest BETWEEN SETS
 *     (= training technique) vs rest days (= recovery), "ngày nghỉ" as background.
 *   B compound asks — "với cả", "đồng thời", "rồi", "còn … thì sao", numbered lists, a noun list ending in one question.
 *   C out-of-scope with fitness context — gym facilities, prices, purchases, clothes, music, weather, account help.
 *   D completeness — three explicit asks (cap 2: the third must be DEFERRED and disclosed, never silently lost).
 * Labelling protocol = M5.1 / v3 protocol unchanged (primary = owner of the ASK; support only when the user's own data from
 * that domain is needed; ≥3 asks → the first two, the rest expectDeferred).
 */
import type { AgentLabel, CaseCategory, RoutingCase } from "../m5-benchmark/dataset-v1";
import type { V3Feature } from "./dataset-v3";

export type V4Split = "dev-v4" | "heldout-v4";
export type V4Feature = V3Feature | "a_recovery_ownership" | "b_compound" | "c_oos_context" | "d_three_asks";
export type V4Case = Omit<RoutingCase, "split" | "features"> & { split: V4Split; features: V4Feature[] };
const T: AgentLabel = "training", N: AgentLabel = "nutrition", R: AgentLabel = "recovery", P: AgentLabel = "progress";
type Opt = Partial<Pick<RoutingCase, "review" | "expectDeferred">> & { features?: V4Feature[] };
function mk(split: V4Split) {
  return (id: string, category: CaseCategory, q: string, primaryIntent: string, primaryAgent: AgentLabel | null, requiredAgents: AgentLabel[], acceptable: AgentLabel[][], rationale: string, o: Opt = {}): V4Case => {
    const coverage: RoutingCase["coverage"] = !requiredAgents.length ? "NONE" : (o.expectDeferred?.length ?? 0) > 0 ? "PARTIAL" : "FULL";
    return {
      id, q, category, primaryIntent, primaryAgent, requiredAgents, acceptable, expectDeferred: o.expectDeferred ?? [], coverage,
      evidence: [], forbiddenClaims: [], safety: "NONE", fixture: "default", rationale, features: o.features ?? ["natural"],
      ...(o.review ? { review: true as const } : {}), routingScored: true, split,
    };
  };
}
const e = mk("dev-v4");
const w = mk("heldout-v4");
const A = ["a_recovery_ownership"] as V4Feature[], B = ["b_compound"] as V4Feature[], C = ["c_oos_context"] as V4Feature[], D = ["d_three_asks"] as V4Feature[];

export const ROUTING_CASES_DEV_V4: readonly V4Case[] = Object.freeze([
  e("E-01", "SINGLE", "Giữa các hiệp squat nghỉ 2 phút có đủ không?", "TRAINING_REST_INTERVAL", T, [T], [[T]], "Rest between sets = training technique.", { features: A }),
  e("E-02", "SINGLE", "Đau nhức sau tập ngực thì xử lý thế nào?", "RECOVERY_SORENESS", R, [R], [[R]], "Post-workout soreness.", { features: A }),
  e("E-03", "SINGLE", "Chân tôi còn ê, có nên tập chân tiếp không?", "RECOVERY_SORENESS", R, [R], [[R], [R, T]], "Soreness + whether to train.", { features: A, review: true }),
  e("E-04", "SINGLE", "Tôi tập dồn cả tuần, tải vậy có ổn không?", "RECOVERY_LOAD", R, [R], [[R]], "Own training load.", { features: A }),
  e("E-05", "SINGLE", "Ngày nghỉ nên ăn bao nhiêu tinh bột?", "NUTRITION_REST_DAY", N, [N], [[N]], "'Ngày nghỉ' is background; the ask is food.", { features: A }),
  e("E-06", "SINGLE", "Tăng cơ được bao nhiêu từ lúc bắt đầu?", "PROGRESS_MUSCLE", P, [P], [[P]], "Muscle gained."),
  e("E-07", "SINGLE", "Tôi khỏe hơn chưa?", "PROGRESS_STRENGTH", P, [P], [[P]], "Am I stronger."),
  e("E-08", "TWO", "Lịch tập ngày mai và lượng nước cần uống là bao nhiêu?", "SCHEDULE_AND_WATER", T, [T, N], [[T, N]], "Noun list ending in one question.", { features: B }),
  e("E-09", "MULTI", "Cân nặng tuần này, thực đơn hiện tại và mức tải gần đây của tôi", "WEIGHT_PLAN_LOAD", P, [P, N, R], [[P, N]], "Three asks; cap 2.", { features: D, expectDeferred: [R] }),
  e("E-10", "TWO", "Hôm nay tập gì rồi tối ăn gì cho đủ đạm?", "TODAY_AND_FOOD", T, [T, N], [[T, N]], "'rồi' joins two asks.", { features: B }),
  e("E-11", "TWO", "Sức mạnh có lên không, với cả nên ngủ thêm không?", "STRENGTH_AND_SLEEP", P, [P, R], [[P, R]], "'với cả' joins two asks.", { features: B }),
  e("E-12", "OOS_AMBIGUOUS", "Phòng gym có chỗ gửi xe không?", "GYM_FACILITY", null, [], [[]], "Facility question.", { features: C }),
  e("E-13", "OOS_AMBIGUOUS", "Mua đai lưng tập tạ ở đâu?", "PURCHASE", null, [], [[]], "Where to buy.", { features: C }),
  e("E-14", "OOS_AMBIGUOUS", "Nghe nhạc gì khi tập cho hăng?", "MUSIC", null, [], [[]], "Music.", { features: C }),
  e("E-15", "SINGLE", "Nên nghỉ bao lâu giữa hai bài tập trong một buổi?", "TRAINING_REST_INTERVAL", T, [T], [[T]], "Rest between exercises in a session.", { features: A }),
  e("E-16", "SINGLE", "Mức tải của tôi tuần này có cao quá không?", "RECOVERY_LOAD", R, [R], [[R]], "Own load.", { features: A }),
  e("E-17", "SINGLE", "Cơ bụng tôi đau nhức sau khi tập plank, có sao không?", "RECOVERY_SORENESS", R, [R], [[R]], "Soreness after an exercise.", { features: A }),
  e("E-18", "MULTI", "Tôi muốn biết tiến độ, lịch tập và calo mục tiêu", "PROGRESS_SCHEDULE_TARGET", P, [P, T, N], [[P, T]], "Three asks; cap 2.", { features: D, expectDeferred: [N] }),
  e("E-19", "SINGLE", "Mọi người hay nghỉ giữa set bao lâu?", "TRAINING_REST_INTERVAL", T, [T], [[T]], "KD-1/KD-2 + rest between sets.", { features: ["kd1", "kd2_frequency", "a_recovery_ownership"] }),
  e("E-20", "SINGLE", "toi hay bi e co sau khi tap", "RECOVERY_SORENESS", R, [R], [[R]], "Unaccented soreness statement.", { features: ["unaccented", "a_recovery_ownership"] }),
  e("E-21", "TWO", "Tôi mệt rồi, tập tiếp hay nghỉ?", "TRAIN_OR_REST", R, [R, T], [[R, T]], "Fatigue + choice.", { features: ["kd2_choice"] }),
  e("E-22", "TWO", "Cho tôi xem cân nặng, rồi gợi ý bữa tối", "WEIGHT_AND_DINNER", P, [P, N], [[P, N]], "Imperative + 'rồi'.", { features: B }),
  e("E-23", "TWO", "Vòng eo có nhỏ đi không và nên đổi bài cardio nào?", "WAIST_AND_CARDIO", P, [P, T], [[P, T]], "Two asks.", { features: B }),
  e("E-24", "SINGLE", "Hôm nay mình có lịch không, còn ngày mai thì sao?", "TRAINING_SCHEDULE", T, [T], [[T]], "Two schedule asks, one domain.", { features: B }),
  e("E-25", "OOS_AMBIGUOUS", "Áo tập màu gì đẹp?", "CLOTHING", null, [], [[]], "Clothing.", { features: C }),
  e("E-26", "SINGLE", "Có nên ăn trước khi tập buổi sáng sớm không?", "NUTRITION_PRE_WORKOUT", N, [N], [[N]], "Pre-workout eating."),
  e("E-27", "SINGLE", "Tập xong bị ê vai thì có nên chườm đá không?", "RECOVERY_SORENESS", R, [R], [[R]], "Soreness care.", { features: A }),
  e("E-28", "TWO", "Thay đổi giáo án hay giảm tải tuần này thì hợp lý hơn?", "PROGRAM_OR_DELOAD", T, [T, R], [[T, R]], "Alternative across training and recovery.", { features: ["kd2_choice"] }),
  e("E-29", "MULTI", "Mục tiêu calo, buổi tập hôm nay và mức độ phục hồi", "TARGET_TODAY_RECOVERY", N, [N, T, R], [[N, T]], "Three asks; cap 2.", { features: D, expectDeferred: [R] }),
  e("E-30", "OOS_AMBIGUOUS", "Phòng tập đông quá thì nên đổi giờ đi tập không?", "GYM_CROWD", null, [], [[], [T]], "Crowded gym: logistics (or own schedule).", { features: C, review: true }),
]);

export const ROUTING_CASES_HELDOUT_V4: readonly V4Case[] = Object.freeze([
  // ── SINGLE: training (9) ──
  w("W-T01", "SINGLE", "Giữa hai set bench nên nghỉ bao nhiêu giây?", "TRAINING_REST_INTERVAL", T, [T], [[T]], "Rest between sets.", { features: A }),
  w("W-T02", "SINGLE", "Khoảng nghỉ giữa các bài trong buổi tập sức bền nên dài cỡ nào?", "TRAINING_REST_INTERVAL", T, [T], [[T]], "Rest between exercises.", { features: A }),
  w("W-T03", "SINGLE", "Thứ Bảy tuần này lịch của tôi là bài gì?", "TRAINING_SCHEDULE", T, [T], [[T]], "Schedule on a weekday."),
  w("W-T04", "SINGLE", "Làm sao để đẩy vai mà không đau khớp?", "TRAINING_TECHNIQUE", T, [T], [[T], [T, R]], "Technique to avoid joint pain.", { review: true }),
  w("W-T05", "SINGLE", "Giáo án tuần này có bao nhiêu bài cho lưng?", "TRAINING_PROGRAM", T, [T], [[T]], "Program content."),
  w("W-T06", "SINGLE", "Người mới nên bắt đầu với máy hay tạ tự do?", "TRAINING_EQUIPMENT_CHOICE", T, [T], [[T]], "Two training options.", { features: ["kd2_choice"] }),
  w("W-T07", "SINGLE", "Có nên giảm số hiệp squat khi đang tăng tạ không?", "PROGRAM_ADJUSTMENT", T, [T], [[T]], "Program adjustment."),
  w("W-T08", "SINGLE", "lam the nao de tang so lan hit xa", "TRAINING_TECHNIQUE", T, [T], [[T]], "Unaccented: more pull-up reps.", { features: ["unaccented"] }),
  w("W-T09", "SINGLE", "Buổi kế tiếp trong lịch là nhóm cơ nào?", "TRAINING_SCHEDULE", T, [T], [[T]], "Next session."),
  // ── SINGLE: nutrition (8) ──
  w("W-N01", "SINGLE", "Bữa sáng nên có bao nhiêu đạm?", "NUTRITION_PROTEIN", N, [N], [[N]], "Protein at breakfast."),
  w("W-N02", "SINGLE", "Tôi đang được đặt mục tiêu bao nhiêu gam tinh bột mỗi ngày?", "NUTRITION_TARGET", N, [N], [[N]], "Carb target."),
  w("W-N03", "SINGLE", "Uống cà phê trước khi tập có giúp tỉnh táo hơn không?", "NUTRITION_PRE_WORKOUT", N, [N], [[N]], "Pre-workout drink."),
  w("W-N04", "SINGLE", "Kế hoạch ăn hiện tại của tôi có đủ chất xơ không?", "NUTRITION_PLAN", N, [N], [[N]], "Plan content."),
  w("W-N05", "SINGLE", "Ăn chay có đủ protein để lên cơ không?", "NUTRITION_PROTEIN", N, [N], [[N]], "Vegetarian protein."),
  w("W-N06", "SINGLE", "Sau khi tập ai cũng uống sữa, mình có nên uống theo không?", "NUTRITION_POST_WORKOUT", N, [N], [[N]], "'ai cũng' generalisation."),
  w("W-N07", "SINGLE", "bua toi nen an nhe hay an no", "NUTRITION_DINNER", N, [N], [[N]], "Unaccented alternative inside nutrition.", { features: ["unaccented", "kd2_choice"] }),
  w("W-N08", "SINGLE", "Ngày nghỉ tập có cần ăn ít calo hơn không?", "NUTRITION_REST_DAY", N, [N], [[N]], "'Ngày nghỉ' is background.", { features: A }),
  // ── SINGLE: recovery (10) ──
  w("W-R01", "SINGLE", "Bắp tay tôi ê suốt từ hôm thứ Hai, vậy có sao không?", "RECOVERY_SORENESS", R, [R], [[R]], "'ê' soreness.", { features: A }),
  w("W-R02", "SINGLE", "Nhức cơ sau buổi đầu tiên đi tập là chuyện bình thường hả?", "RECOVERY_SORENESS", R, [R], [[R]], "Soreness after a first session.", { features: A }),
  w("W-R03", "SINGLE", "Đau nhức toàn thân sau khi chạy dài thì nên làm gì?", "RECOVERY_SORENESS", R, [R], [[R]], "Soreness after a long run.", { features: A }),
  w("W-R04", "SINGLE", "Tôi tập dồn bốn buổi liền, có cần nghỉ hẳn một hôm không?", "RECOVERY_LOAD_REST", R, [R], [[R], [R, T]], "Load + rest day.", { features: A, review: true }),
  w("W-R05", "SINGLE", "Mức tải mấy tuần nay của tôi có đang quá cao không?", "RECOVERY_LOAD", R, [R], [[R]], "Own load.", { features: A }),
  w("W-R06", "SINGLE", "Ngủ trưa có giúp cơ hồi lại nhanh hơn không?", "RECOVERY_SLEEP", R, [R], [[R]], "Nap and recovery."),
  w("W-R07", "SINGLE", "Giãn cơ sau tập nên giữ mỗi động tác bao lâu?", "RECOVERY_STRETCH", R, [R], [[R], [T]], "Stretching: recovery or technique.", { review: true }),
  w("W-R08", "SINGLE", "Bao lâu mới hết ê ẩm sau buổi chân nặng?", "RECOVERY_SORENESS", R, [R], [[R]], "Soreness duration.", { features: A }),
  w("W-R09", "SINGLE", "Mỗi tuần nên có mấy ngày nghỉ hoàn toàn?", "RECOVERY_REST_DAYS", R, [R], [[R], [T]], "Rest days.", { features: A, review: true }),
  w("W-R10", "SINGLE", "Tôi bị chuột rút giữa buổi, lần sau phải làm sao?", "RECOVERY_CRAMP", R, [R], [[R]], "Cramp."),
  // ── SINGLE: progress (9) ──
  w("W-P01", "SINGLE", "Từ đầu năm tới giờ vòng eo của tôi nhỏ đi bao nhiêu?", "PROGRESS_WAIST", P, [P], [[P]], "Waist change."),
  w("W-P02", "SINGLE", "Tôi đã khỏe hơn so với tháng trước chưa?", "PROGRESS_STRENGTH", P, [P], [[P]], "Stronger than last month."),
  w("W-P03", "SINGLE", "Lượng cơ tôi tăng được bao nhiêu kể từ lần đo đầu?", "PROGRESS_MUSCLE", P, [P], [[P]], "Muscle gained."),
  w("W-P04", "SINGLE", "Kết quả InBody gần nhất của tôi cho thấy gì?", "PROGRESS_MEASUREMENT", P, [P], [[P]], "Latest InBody."),
  w("W-P05", "SINGLE", "Mức tạ deadlift của tôi có tiến bộ không?", "PROGRESS_STRENGTH", P, [P], [[P]], "Deadlift progress."),
  w("W-P06", "SINGLE", "App dự báo thế nào về cân nặng của tôi tháng tới?", "PROGRESS_FORECAST", P, [P], [[P]], "Forecast (scenario)."),
  w("W-P07", "SINGLE", "Tôi đang đi đúng lộ trình giảm mỡ không?", "PROGRESS_GOAL", P, [P], [[P]], "On track."),
  w("W-P08", "SINGLE", "Ba tháng qua tôi thay đổi ra sao?", "PROGRESS_GENERAL", P, [P], [[P]], "Change over three months."),
  w("W-P09", "SINGLE", "co the toi tien trien the nao tu luc bat dau", "PROGRESS_GENERAL", P, [P], [[P]], "Unaccented progress.", { features: ["unaccented"] }),
  // ── TWO (16) ──
  w("W-X01", "TWO", "Hôm nay tôi tập gì, với cả bữa tối nên ăn gì?", "TODAY_AND_DINNER", T, [T, N], [[T, N]], "'với cả'.", { features: B }),
  w("W-X02", "TWO", "Mức tạ squat của tôi tiến bộ chưa, đồng thời tuần này có nên deload không?", "STRENGTH_AND_DELOAD", P, [P, R], [[P, R]], "'đồng thời'.", { features: B }),
  w("W-X03", "TWO", "Bữa trước buổi tập nên ăn gì rồi tập xong nên giãn cơ ra sao?", "MEAL_AND_STRETCH", N, [N, R], [[N, R], [N, T]], "'rồi'; stretching recovery or technique.", { features: B, review: true }),
  w("W-X04", "TWO", "Lịch tập tuần này và mục tiêu đạm của tôi là gì?", "SCHEDULE_AND_PROTEIN", T, [T, N], [[T, N]], "Noun list, one question.", { features: B }),
  w("W-X05", "TWO", "Cân nặng tháng này với lịch tập hôm nay của tôi thế nào?", "WEIGHT_AND_TODAY", P, [P, T], [[P, T]], "Noun list joined by 'với'.", { features: B }),
  w("W-X06", "TWO", "Tôi ê hết người sau buổi chân, hôm nay còn nên tập theo lịch không?", "SORE_AND_TODAY", R, [R, T], [[R, T]], "Soreness + today's schedule.", { features: A }),
  w("W-X07", "TWO", "Nghỉ giữa các hiệp bao lâu và giữa hai buổi chân nên cách mấy ngày?", "INTERVAL_AND_FREQUENCY", T, [T, R], [[T, R], [T]], "Set rest (training) + days between sessions (recovery or training).", { features: A, review: true }),
  w("W-X08", "TWO", "Thực đơn có hợp với tiến độ giảm mỡ của tôi không?", "PLAN_VS_PROGRESS", N, [N, P], [[N, P]], "Plan vs own progress."),
  w("W-X09", "TWO", "Tôi có nên đổi giáo án không, vì mấy tuần nay sức đẩy ngực không lên?", "PROGRAM_VS_STRENGTH", T, [T, P], [[T, P]], "Program change needs own strength trend."),
  w("W-X10", "TWO", "Khỏe hơn chưa và có nên tăng calo không?", "STRENGTH_AND_CALORIES", P, [P, N], [[P, N]], "Two asks.", { features: B }),
  w("W-X11", "TWO", "1) Hôm nay tập gì 2) Ăn bao nhiêu kcal", "TODAY_AND_CALORIES", T, [T, N], [[T, N]], "Numbered list.", { features: B }),
  w("W-X12", "TWO", "Mức tải tuần qua có quá cao không, và tôi nên ăn thêm gì để hồi phục?", "LOAD_AND_FOOD", R, [R, N], [[R, N]], "Two asks.", { features: [...A, ...B] }),
  w("W-X13", "TWO", "Tôi ngủ ít mấy đêm liền, có nên bỏ buổi tập hôm nay không?", "SLEEP_AND_SKIP", R, [R, T], [[R, T]], "Sleep self-report + today's session."),
  w("W-X14", "TWO", "Vòng bụng tôi có giảm không, còn khẩu phần tinh bột thì sao?", "WAIST_AND_CARBS", P, [P, N], [[P, N]], "'còn … thì sao'.", { features: B }),
  w("W-X15", "TWO", "Giữa các set nên nghỉ bao lâu, và nên uống nước lúc nào?", "INTERVAL_AND_WATER", T, [T, N], [[T, N]], "Set rest + hydration.", { features: [...A, ...B] }),
  w("W-X16", "TWO", "Sức kéo xà của tôi có lên không và chương trình nên thêm bài gì?", "STRENGTH_AND_PROGRAM", P, [P, T], [[P, T]], "Two asks.", { features: B }),
  // ── MULTI (8) ──
  w("W-M01", "MULTI", "Lịch tập hôm nay, lượng calo cần ăn và tình trạng phục hồi của tôi?", "TODAY_CALORIES_RECOVERY", T, [T, N, R], [[T, N]], "Noun list; cap 2.", { features: D, expectDeferred: [R] }),
  w("W-M02", "MULTI", "Cho mình biết tiến độ cân nặng, thực đơn tuần này và số buổi tập còn lại", "PROGRESS_PLAN_SESSIONS", P, [P, N, T], [[P, N]], "Imperative list; cap 2.", { features: D, expectDeferred: [T] }),
  w("W-M03", "MULTI", "Tôi mệt, nên ăn gì, tập gì và nghỉ bao lâu?", "FOOD_TRAINING_REST", N, [N, T, R], [[N, T]], "Three asks after a fatigue report.", { features: D, expectDeferred: [R] }),
  w("W-M04", "MULTI", "Hôm nay nên tập gì, uống bao nhiêu nước, ngủ mấy tiếng?", "TODAY_WATER_SLEEP", T, [T, N, R], [[T, N]], "Three asks; cap 2.", { features: D, expectDeferred: [R] }),
  w("W-M05", "MULTI", "Xem giúp mức tải tuần này, cân nặng hiện tại và mục tiêu kcal", "LOAD_WEIGHT_TARGET", R, [R, P, N], [[R, P]], "Imperative list; cap 2.", { features: D, expectDeferred: [N] }),
  w("W-M06", "MULTI", "Có nên deload, đổi giáo án hay giảm calo trong tuần tới?", "DELOAD_PROGRAM_CALORIES", R, [R, T, N], [[R, T]], "Three options; cap 2.", { features: [...D, "kd2_choice"], expectDeferred: [N] }),
  w("W-M07", "MULTI", "Tóm tắt giúp tôi: buổi tập ngày mai, lượng đạm hằng ngày, và cơ đã tăng bao nhiêu", "TOMORROW_PROTEIN_MUSCLE", T, [T, N, P], [[T, N]], "Imperative list; cap 2.", { features: D, expectDeferred: [P] }),
  w("W-M08", "MULTI", "Sức mạnh có tăng không, mức tải có quá cao không, và tôi nên ăn thêm không?", "STRENGTH_LOAD_FOOD", P, [P, R, N], [[P, R]], "Three asks; cap 2.", { features: D, expectDeferred: [N] }),
  // ── OUT OF SCOPE (10) ──
  w("W-O01", "OOS_AMBIGUOUS", "Phòng tập nào gần đây có hồ bơi?", "GYM_FACILITY", null, [], [[]], "Facility search.", { features: C }),
  w("W-O02", "OOS_AMBIGUOUS", "Mua giày tập gym loại nào bền?", "PURCHASE", null, [], [[]], "Purchase.", { features: C }),
  w("W-O03", "OOS_AMBIGUOUS", "Áo thun tập nên chọn chất liệu gì?", "CLOTHING", null, [], [[]], "Clothing.", { features: C }),
  w("W-O04", "OOS_AMBIGUOUS", "Có playlist nào hay để nghe lúc chạy bộ không?", "MUSIC", null, [], [[]], "Music.", { features: [...C, "kd2_other_sense"] }),
  w("W-O05", "OOS_AMBIGUOUS", "Gói hội viên phòng gym một tháng bao nhiêu tiền?", "PRICING", null, [], [[]], "Membership price.", { features: C }),
  w("W-O06", "OOS_AMBIGUOUS", "Bạn tên là gì vậy?", "SMALL_TALK", null, [], [[]], "Small talk."),
  w("W-O07", "OOS_AMBIGUOUS", "Đi tập về thì xem phim gì cho thư giãn?", "MOVIE", null, [], [[]], "Movie.", { features: C }),
  w("W-O08", "OOS_AMBIGUOUS", "Làm sao để đổi mật khẩu tài khoản?", "ACCOUNT", null, [], [[]], "Account help."),
  w("W-O09", "OOS_AMBIGUOUS", "Phòng gym mở cửa vào ngày lễ không?", "GYM_HOURS", null, [], [[]], "Opening hours.", { features: C }),
  w("W-O10", "OOS_AMBIGUOUS", "Mai trời có mưa không, mình định đi tập ngoài trời", "WEATHER", null, [], [[]], "Weather with a training plan as context.", { features: C }),
]);

/** Metric definitions and gates, fixed BEFORE scoring (also recorded in heldout-v4.freeze.json). */
export const V4_METRICS = Object.freeze({
  definitions: "m5-benchmark/routing-eval.ts routingMetrics, unchanged (primary coverage, exact-set ≤2, macro/micro F1, per-agent P/R, correct deferral, unreported deferred intents, OOS detection, false-positive agents, PARTIAL vs label)",
  added: "requiredUndetected = required agents of a case that are neither selected, nor deferred by the plan, nor present as REQUEST intents of the plan (counted per case-agent; informational, not a gate)",
  gates: { G7_primaryCoveragePctMin: 90, G8_exactSetLe2PctMin: 85, agentCap: 2, safetyGates: "G1–G6, G9 (M6 adjudications), G10 — QUALITY_GATES_M51 thresholds unchanged" },
  comparators: ["keyword-v1", "intent-v1.1 (frozen)", "intent-v1.2 (frozen)", "M7-P4.1 candidate"],
});
