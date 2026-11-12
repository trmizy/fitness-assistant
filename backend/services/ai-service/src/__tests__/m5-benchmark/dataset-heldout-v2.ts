/**
 * Gymini V2 Multi-Agent — M5.1 HELDOUT v2 (routing). Written 2026-11-13 BEFORE any M5.1 router change and BEFORE the DEV set;
 * frozen by SHA-256 in heldout-v2.freeze.json (the benchmark test fails if this file changes). Single author (the same AI
 * engineer who wrote v1 and will tune the router) — NOT expert-validated, no second annotator; `review` marks ambiguous
 * labels. The author has seen these questions, so independence from the tuning is limited (documented in the report).
 *
 * Labelling protocol = M5 v1 protocol plus the M5.1 clarifications fixed before writing:
 *  - primaryAgent owns what the user ASKS for; background context / user statements do not create a required agent.
 *  - A supporting agent is REQUIRED only when the user's OWN data from that domain is needed to answer the ask
 *    (personal question + that domain's facts change the answer). General-knowledge questions → the owner only.
 *  - When reasonable annotators could differ, several acceptable sets are listed and the case is flagged `review`.
 *  - ≥3 real needs: acceptable sets keep the primary + the most decision-relevant support; the rest is expectDeferred.
 * Phrasing styles deliberately differ from v1: polite particles (ạ/nhé/nha), imperatives ("xem giúp", "kiểm tra"),
 * loanwords (cut, bulk, macro, cardio, deload, PR), time expressions, question-first and statement-first orders.
 */
import type { AgentLabel, CaseCategory, RoutingCase } from "./dataset-v1";

const T: AgentLabel = "training", N: AgentLabel = "nutrition", R: AgentLabel = "recovery", P: AgentLabel = "progress";
type Opt = Partial<Pick<RoutingCase, "review" | "expectDeferred" | "features">>;
function h(id: string, category: CaseCategory, q: string, primaryIntent: string, primaryAgent: AgentLabel | null, requiredAgents: AgentLabel[], acceptable: AgentLabel[][], rationale: string, o: Opt = {}): RoutingCase {
  const coverage: RoutingCase["coverage"] = !requiredAgents.length ? "NONE" : (o.expectDeferred?.length ?? 0) > 0 ? "PARTIAL" : "FULL";
  return {
    id, q, category, primaryIntent, primaryAgent, requiredAgents, acceptable, expectDeferred: o.expectDeferred ?? [], coverage,
    evidence: [], forbiddenClaims: [], safety: "NONE", fixture: "default", rationale, features: o.features ?? ["natural"],
    ...(o.review ? { review: true as const } : {}), routingScored: true, split: "heldout-v2",
  };
}

export const ROUTING_CASES_HELDOUT_V2: readonly RoutingCase[] = Object.freeze([
  // ── SINGLE: training (9) ──
  h("H-T01", "SINGLE", "Cho mình xem buổi tập hôm nay với", "TRAINING_TODAY", T, [T], [[T]], "Imperative: show today's session."),
  h("H-T02", "SINGLE", "Thứ Năm này mình có lịch tập không nhỉ?", "TRAINING_SCHEDULE", T, [T], [[T]], "Schedule on a weekday."),
  h("H-T03", "SINGLE", "Bài nào tốt cho cơ xô nếu không có máy kéo cáp?", "TRAINING_EXERCISE_CHOICE", T, [T], [[T]], "Exercise choice under equipment constraint.", { features: ["no_subject"] }),
  h("H-T04", "SINGLE", "Romanian deadlift khác deadlift thường chỗ nào?", "TRAINING_EXERCISE_INFO", T, [T], [[T]], "Exercise comparison."),
  h("H-T05", "SINGLE", "Giáo án hiện tại của em đang tập mấy ngày một tuần ạ?", "TRAINING_PROGRAM", T, [T], [[T]], "Current program frequency.", { features: ["synonym"] }),
  h("H-T06", "SINGLE", "tap bung moi ngay co duoc khong", "TRAINING_FREQUENCY", T, [T], [[T], [R]], "Daily ab training: programming vs recovery both defensible.", { features: ["unaccented", "no_subject"], review: true }),
  h("H-T07", "SINGLE", "Đổi giúp mình bài leg press sang bài khác, phòng tập hết máy", "TRAINING_SUBSTITUTION", T, [T], [[T]], "Substitution request with a reason clause."),
  h("H-T08", "SINGLE", "Tuần này chương trình có bài cardio nào không?", "TRAINING_PROGRAM", T, [T], [[T]], "Cardio in the program."),
  h("H-T09", "SINGLE", "Plank giữ bao lâu thì hiệu quả?", "TRAINING_TECHNIQUE", T, [T], [[T]], "Exercise prescription.", { features: ["no_subject"] }),
  // ── SINGLE: nutrition (9) ──
  h("H-N01", "SINGLE", "Cho mình biết mục tiêu macro hằng ngày của mình", "NUTRITION_TARGET", N, [N], [[N]], "Personal macro target.", { features: ["slang"] }),
  h("H-N02", "SINGLE", "Ăn tối lúc 10 giờ đêm có ảnh hưởng gì không?", "NUTRITION_TIMING", N, [N], [[N]], "Late dinner.", { features: ["no_subject"] }),
  h("H-N03", "SINGLE", "Một quả trứng luộc được bao nhiêu protein?", "NUTRITION_FOOD", N, [N], [[N]], "Food lookup."),
  h("H-N04", "SINGLE", "Creatine nên uống lúc nào trong ngày?", "NUTRITION_SUPPLEMENT", N, [N], [[N]], "Supplement timing (adult).", { review: true }),
  h("H-N05", "SINGLE", "thuc don tuan nay cua toi co du dam khong", "NUTRITION_PLAN_VS_GOAL", N, [N], [[N]], "Meal plan protein adequacy.", { features: ["unaccented", "synonym"] }),
  h("H-N06", "SINGLE", "Đi ăn cỗ cuối tuần thì nên chọn món gì cho đỡ béo?", "NUTRITION_FOOD_CHOICE", N, [N], [[N]], "Food choice at a feast.", { features: ["slang", "no_subject"] }),
  h("H-N07", "SINGLE", "Uống sữa trước khi ngủ có làm tăng mỡ không?", "NUTRITION_TIMING", N, [N], [[N]], "Milk before bed."),
  h("H-N08", "SINGLE", "Calo mục tiêu của tôi bây giờ là bao nhiêu vậy?", "NUTRITION_TARGET", N, [N], [[N]], "Personal calorie target."),
  h("H-N09", "SINGLE", "Muốn tăng cân sạch thì bữa phụ nên ăn gì?", "NUTRITION_FOOD_CHOICE", N, [N], [[N]], "Snack choice for a lean bulk.", { features: ["slang", "no_subject"] }),
  // ── SINGLE: recovery (9) ──
  h("H-R01", "SINGLE", "Dạo này tập xong người cứ rã rời, mình có đang tập quá sức không?", "RECOVERY_OVERREACHING", R, [R], [[R], [R, T]], "Personal overload question; training optional.", { review: true, features: ["synonym"] }),
  h("H-R02", "SINGLE", "Đau mỏi bắp chân sau khi chạy thì nên làm gì cho mau hết?", "RECOVERY_SORENESS", R, [R], [[R]], "Soreness relief.", { features: ["no_subject"] }),
  h("H-R03", "SINGLE", "Một tuần nên có mấy ngày nghỉ hoàn toàn?", "RECOVERY_REST_DAYS", R, [R], [[R], [T]], "Rest days: recovery vs programming.", { review: true, features: ["no_subject"] }),
  h("H-R04", "SINGLE", "Thiếu ngủ thì có nên vẫn đi tập nặng không?", "RECOVERY_READINESS", R, [R], [[R], [R, T]], "Readiness under sleep loss (general).", { review: true, features: ["no_subject"] }),
  h("H-R05", "SINGLE", "Khối lượng tập của mình mấy tuần gần đây có tăng đột ngột không?", "RECOVERY_LOAD", R, [R], [[R]], "Personal training load trend."),
  h("H-R06", "SINGLE", "Có cần tuần giảm tải không khi mình đã tập liên tục 8 tuần?", "RECOVERY_DELOAD", R, [R], [[R]], "Deload need ('giảm tải').", { features: ["synonym"] }),
  h("H-R07", "SINGLE", "met moi keo dai sau buoi tap chan", "RECOVERY_FATIGUE", R, [R], [[R]], "Fatigue statement, unaccented, no question mark.", { features: ["unaccented", "no_subject"] }),
  h("H-R08", "SINGLE", "Massage hay foam roller có giúp cơ phục hồi không?", "RECOVERY_MODALITY", R, [R], [[R]], "Recovery modality."),
  h("H-R09", "SINGLE", "Cơ còn ê ẩm thì tập tiếp có sao không?", "RECOVERY_DOMS", R, [R], [[R], [R, T]], "Training while sore (general).", { review: true, features: ["synonym", "no_subject"] }),
  // ── SINGLE: progress (9) ──
  h("H-P01", "SINGLE", "So với tháng trước thì vòng eo với cân nặng của mình thế nào?", "PROGRESS_BODY", P, [P], [[P]], "Body change month over month."),
  h("H-P02", "SINGLE", "Bench press của tôi có tăng sức mạnh trong 4 tuần qua không?", "PROGRESS_STRENGTH", P, [P], [[P]], "Strength trend."),
  h("H-P03", "SINGLE", "Mình còn cách mục tiêu bao xa?", "PROGRESS_GOAL_GAP", P, [P], [[P]], "Goal gap without naming weight.", { review: true }),
  h("H-P04", "SINGLE", "Kết quả InBody tuần này so với lần trước ra sao?", "PROGRESS_BODY", P, [P], [[P]], "Measurement comparison."),
  h("H-P05", "SINGLE", "Theo kế hoạch thì cuối tháng 12 mình dự kiến nặng bao nhiêu?", "PROGRESS_FORECAST", P, [P], [[P]], "Forecast question without the word 'dự báo'.", { features: ["synonym"] }),
  h("H-P06", "SINGLE", "Tỉ lệ mỡ của em đã giảm được bao nhiêu từ lúc bắt đầu?", "PROGRESS_BODY", P, [P], [[P]], "Body-fat change."),
  h("H-P07", "SINGLE", "Chu kỳ tập vừa xong được đánh giá thế nào?", "PROGRESS_ASSESSMENT", P, [P], [[P]], "Cycle assessment."),
  h("H-P08", "SINGLE", "Squat 1RM ước tính hiện giờ của mình là bao nhiêu?", "PROGRESS_STRENGTH", P, [P], [[P]], "Estimated 1RM."),
  h("H-P09", "SINGLE", "tien trien cua toi tu dau thang den gio", "PROGRESS_GENERAL", P, [P], [[P]], "Progress since month start, unaccented, no question mark.", { features: ["unaccented"] }),
  // ── TWO-domain (30) ──
  h("H-TN1", "TWO", "Hôm nay mình tập gì, và nên ăn gì sau buổi đó?", "TRAINING_TODAY", T, [T, N], [[T, N]], "Two explicit asks.", { features: ["compound"] }),
  h("H-TN2", "TWO", "Tối nay có buổi đẩy không, nếu có thì ăn tối trước hay sau?", "TRAINING_SCHEDULE", T, [T, N], [[T, N]], "Schedule check then meal timing.", { features: ["compound", "slang"] }),
  h("H-TN3", "TWO", "Mình muốn biết lịch tập tuần này và lượng protein mỗi ngày cần ăn", "TRAINING_SCHEDULE", T, [T, N], [[T, N]], "Two nouns asked, statement form.", { features: ["compound"] }),
  h("H-TN4", "TWO", "Ăn gì trước khi tập chân hôm nay cho đủ sức?", "NUTRITION_TIMING", N, [N], [[N], [N, T]], "Food ask; the session is stated by the user (schedule optional).", { review: true, features: ["no_subject"] }),
  h("H-TN5", "TWO", "Đang cut thì giáo án tập có cần đổi không và nên ăn bao nhiêu calo?", "TRAINING_PROGRAM_REVIEW", T, [T, N], [[T, N]], "Program review + calories during a cut.", { features: ["compound", "slang"] }),
  h("H-TR1", "TWO", "Hôm qua mình chạy 10km, hôm nay nên tập bài gì?", "TRAINING_TODAY", T, [T, R], [[T, R]], "Today's plan given yesterday's load (personal history).", { features: ["compound"] }),
  h("H-TR2", "TWO", "Lưng còn mỏi sau buổi deadlift, buổi hôm nay có nên đổi bài?", "TRAINING_ADJUST", T, [T, R], [[T, R]], "Adjust today's session given residual fatigue.", { features: ["no_subject"] }),
  h("H-TR3", "TWO", "Mệt quá thì hôm nay nghỉ hay tập nhẹ?", "RECOVERY_READINESS", R, [R, T], [[R, T]], "Rest vs light session today.", { features: ["no_subject"] }),
  h("H-TR4", "TWO", "Tuần này tập dồn 3 buổi chân liền, có nên sắp xếp lại lịch không?", "TRAINING_ADJUST", T, [T, R], [[T, R]], "Reschedule given clustered load.", { features: ["no_subject"] }),
  h("H-TR5", "TWO", "Ngủ có 4 tiếng, buổi tập hôm nay nên giảm cường độ thế nào?", "TRAINING_ADJUST", T, [T, R], [[T, R]], "Adjust intensity given sleep loss.", { features: ["no_subject"] }),
  h("H-PT1", "TWO", "Squat đứng yên 3 tuần rồi, nên đổi chương trình thế nào?", "TRAINING_ADJUST", T, [T, P], [[T, P]], "Plateau → program change.", { features: ["slang", "no_subject"] }),
  h("H-PT2", "TWO", "Sức mạnh tăng chậm quá, mình có nên tăng số buổi tập không?", "TRAINING_FREQUENCY", T, [T, P], [[T, P]], "Slow strength → frequency."),
  h("H-PT3", "TWO", "Xem giúp tiến độ bench rồi gợi ý mức tạ buổi tới", "PROGRESS_STRENGTH", P, [P, T], [[P, T]], "Two imperatives.", { features: ["compound", "no_subject"] }),
  h("H-PT4", "TWO", "Dựa vào kết quả chu kỳ trước, tuần sau tập gì?", "TRAINING_NEXT", T, [T, P], [[T, P]], "Next week's training informed by the assessment.", { features: ["no_subject"] }),
  h("H-PT5", "TWO", "1RM deadlift ước tính của tôi bao nhiêu, và hôm nay có nên test max không?", "PROGRESS_STRENGTH", P, [P, T], [[P, T]], "Estimate then a training decision.", { features: ["compound"] }),
  h("H-PR1", "TWO", "Sức mạnh giảm có phải do tôi tập quá tải không?", "PROGRESS_STRENGTH", P, [P, R], [[P, R]], "Strength decline vs overload.", { features: ["progress_vs_recovery"] }),
  h("H-PR2", "TWO", "Hiệu suất tụt mấy tuần nay, xem giúp mức mệt mỏi và tải tập của tôi", "RECOVERY_LOAD", R, [R, P], [[R, P]], "Ask = fatigue/load; performance drop is context but personal.", { features: ["progress_vs_recovery"], review: true }),
  h("H-PR3", "TWO", "Vòng bụng không giảm mà người lúc nào cũng uể oải, hai cái có liên quan không?", "PROGRESS_BODY", P, [P, R], [[P, R]], "Body change vs fatigue correlation.", { features: ["progress_vs_recovery", "no_subject"], review: true }),
  h("H-PR4", "TWO", "Mình tiến bộ chậm, có cần một tuần deload không?", "RECOVERY_DELOAD", R, [R, P], [[R, P]], "Deload decision informed by progress.", { features: ["slang", "progress_vs_recovery"] }),
  h("H-PR5", "TWO", "Kiểm tra giúp mình tiến độ tháng này và xem có dấu hiệu quá tải không", "PROGRESS_GENERAL", P, [P, R], [[P, R]], "Two imperatives.", { features: ["compound"] }),
  h("H-PN1", "TWO", "Cân giảm đều chưa, có cần tăng calo lên không?", "PROGRESS_BODY", P, [P, N], [[P, N]], "Weight trend then intake change.", { features: ["compound", "no_subject"] }),
  h("H-PN2", "TWO", "Đã 2 tháng mà mỡ không xuống, thực đơn có vấn đề gì không?", "NUTRITION_PLAN_REVIEW", N, [N, P], [[N, P]], "Meal plan review informed by body-fat trend.", { features: ["no_subject"] }),
  h("H-PN3", "TWO", "Với tốc độ giảm cân hiện tại thì nên ăn bao nhiêu protein?", "NUTRITION_INTAKE", N, [N, P], [[N, P]], "Protein informed by the current rate of loss.", { features: ["no_subject"], review: true }),
  h("H-PN4", "TWO", "Mục tiêu calo có phù hợp với tiến độ cân nặng của tôi không?", "NUTRITION_TARGET", N, [N, P], [[N, P]], "Target vs measured progress."),
  h("H-PN5", "TWO", "Xem chỉ số InBody mới nhất rồi chỉnh giúp chế độ ăn", "PROGRESS_BODY", P, [P, N], [[P, N]], "Two imperatives.", { features: ["compound", "no_subject"] }),
  h("H-NR1", "TWO", "Tập xong mệt rã rời, nên bổ sung gì để hồi sức?", "NUTRITION_RECOVERY", N, [N], [[N], [N, R]], "Recovery nutrition; recovery agent optional.", { review: true, features: ["no_subject"] }),
  h("H-NR2", "TWO", "Ăn uống thế nào để giảm đau mỏi cơ sau tập?", "NUTRITION_RECOVERY", N, [N], [[N], [N, R]], "Diet for soreness (general).", { review: true, features: ["no_subject"] }),
  h("H-NR3", "TWO", "Cả tuần uể oải, xem giúp mình có đang ăn thiếu so với mục tiêu không", "NUTRITION_PLAN_VS_GOAL", N, [N], [[N], [N, R]], "Ask = intake vs target; fatigue is context.", { review: true }),
  h("H-NR4", "TWO", "Uống đủ nước có giúp phục hồi nhanh hơn không?", "NUTRITION_HYDRATION", N, [N], [[N], [R], [N, R]], "Hydration & recovery: nutrition or recovery.", { review: true, features: ["no_subject"] }),
  h("H-NR5", "TWO", "Đang trong tuần deload thì có nên giảm ăn không?", "NUTRITION_INTAKE", N, [N], [[N], [N, R]], "Intake during a deload week.", { review: true, features: ["slang", "no_subject"] }),
  // ── MULTI-domain (14) ──
  h("H-M01", "MULTI", "Hôm nay tập gì, ăn gì, và tôi có cần nghỉ thêm không?", "TRAINING_TODAY", T, [T, N, R], [[T, N], [T, R]], "Three asks, training first.", { expectDeferred: [N, R], features: ["compound", "cap_pressure"] }),
  h("H-M02", "MULTI", "Kiểm tra tiến độ sức mạnh, mức mệt mỏi và đề xuất lịch tập tuần tới cho tôi", "PROGRESS_STRENGTH", P, [P, R, T], [[P, R], [P, T]], "Three imperative objects, progress first.", { expectDeferred: [R, T], features: ["compound", "cap_pressure"] }),
  h("H-M03", "MULTI", "Bench không lên, ngủ kém, tôi nên đổi giáo án hay ăn thêm?", "TRAINING_ADJUST", T, [T, N, P, R], [[T, N]], "Ask = program or diet; plateau and sleep are context.", { expectDeferred: [P, R], review: true, features: ["compound", "cap_pressure", "slang"] }),
  h("H-M04", "MULTI", "Giảm cân chậm, hay mệt, giúp tôi chỉnh cả thực đơn lẫn lịch tập", "NUTRITION_PLAN_CHANGE", N, [N, T, P, R], [[N, T]], "Two asks (diet, schedule); context = progress, fatigue.", { expectDeferred: [P, R], review: true, features: ["compound", "cap_pressure"] }),
  h("H-M05", "MULTI", "Xem giúp cân nặng, tải tập và lượng ăn của tôi tuần này", "PROGRESS_BODY", P, [P, R, N], [[P, R], [P, N]], "Three nouns, weight first.", { expectDeferred: [R, N], features: ["cap_pressure"] }),
  h("H-M06", "MULTI", "Sau đợt ốm, nên tập lại thế nào, ăn gì và nghỉ bao nhiêu?", "TRAINING_RETURN", T, [T, N, R], [[T, N], [T, R]], "Return to training; three asks.", { expectDeferred: [N, R], features: ["compound", "cap_pressure", "no_subject"] }),
  h("H-M07", "MULTI", "Dự báo bảo tôi giảm 4kg nhưng thực tế cân chưa đổi, có nên ăn ít đi và tập thêm cardio không?", "NUTRITION_INTAKE", N, [N, T, P], [[N, T], [N, P]], "Asks diet + cardio; forecast vs actual is context (personal).", { expectDeferred: [T, P], review: true, features: ["compound", "cap_pressure"] }),
  h("H-M08", "MULTI", "Tôi mệt, sức mạnh đi xuống, hôm nay có nên tập không?", "RECOVERY_READINESS", R, [R, T, P], [[R, T], [R, P]], "Readiness decision with fatigue and strength context.", { expectDeferred: [T, P], review: true, features: ["cap_pressure", "progress_vs_recovery"] }),
  h("H-M09", "MULTI", "Tuần sau thi đấu, nên giảm tập thế nào, ăn gì và theo dõi cân ra sao?", "TRAINING_TAPER", T, [T, N, P], [[T, N], [T, P]], "Taper; three asks.", { expectDeferred: [N, P], features: ["compound", "cap_pressure", "no_subject"] }),
  h("H-M10", "MULTI", "tuan nay toi tap qua suc, can nang khong doi, nen an va tap lai the nao", "NUTRITION_AND_TRAINING", N, [N, T, R, P], [[N, T]], "Asks eat + train; overload and weight are context.", { expectDeferred: [R, P], review: true, features: ["unaccented", "compound", "cap_pressure"] }),
  h("H-M11", "MULTI", "Phân tích giúp tôi: tiến bộ 3 tháng, mức phục hồi, chế độ ăn và lịch tập hiện tại", "PROGRESS_GENERAL", P, [P, R, N, T], [[P, R], [P, N], [P, T]], "Four objects, progress first.", { expectDeferred: [R, N, T], review: true, features: ["cap_pressure"] }),
  h("H-M12", "MULTI", "Vai hơi mỏi, sức đẩy giảm, buổi ngực hôm nay nên tập ra sao?", "TRAINING_TODAY", T, [T, R, P], [[T, R], [T, P]], "Today's session with fatigue + strength context.", { expectDeferred: [R, P], features: ["cap_pressure", "no_subject"] }),
  h("H-M13", "MULTI", "Muốn giảm mỡ trước hè: xem tiến độ, gợi ý thực đơn và số buổi cardio", "PROGRESS_GENERAL", P, [P, N, T], [[P, N], [P, T]], "Three imperative objects, progress first.", { expectDeferred: [N, T], review: true, features: ["cap_pressure", "no_subject"] }),
  h("H-M14", "MULTI", "Ăn ít mà vẫn mệt và không xuống cân, có nên deload hay đổi thực đơn?", "RECOVERY_DELOAD", R, [R, N, P], [[R, N]], "Asks deload or diet change; weight is context.", { expectDeferred: [P], review: true, features: ["compound", "cap_pressure", "no_subject"] }),
  // ── OUT OF SCOPE / AMBIGUOUS (16) ──
  h("H-O01", "OOS_AMBIGUOUS", "Dịch giúp câu này sang tiếng Anh: chúc mừng sinh nhật", "OUT_OF_SCOPE", null, [], [[]], "Translation."),
  h("H-O02", "OOS_AMBIGUOUS", "Tỷ giá đô hôm nay bao nhiêu?", "OUT_OF_SCOPE", null, [], [[]], "Exchange rate."),
  h("H-O03", "OOS_AMBIGUOUS", "Gợi ý quán cà phê yên tĩnh ở Đà Nẵng", "OUT_OF_SCOPE", null, [], [[]], "Places."),
  h("H-O04", "OOS_AMBIGUOUS", "Làm sao để học tiếng Nhật nhanh?", "OUT_OF_SCOPE", null, [], [[]], "Language learning."),
  h("H-O05", "OOS_AMBIGUOUS", "Viết code Python đảo ngược chuỗi", "OUT_OF_SCOPE", null, [], [[]], "Programming."),
  h("H-O06", "OOS_AMBIGUOUS", "Hôm nay trời có mưa không?", "OUT_OF_SCOPE", null, [], [[]], "Weather."),
  h("H-O07", "OOS_AMBIGUOUS", "Ok cảm ơn nhé", "AMBIGUOUS", null, [], [[]], "Thanks."),
  h("H-O08", "OOS_AMBIGUOUS", "Bạn là ai?", "OUT_OF_SCOPE", null, [], [[]], "Identity."),
  h("H-O09", "OOS_AMBIGUOUS", "Cái đó thì sao?", "AMBIGUOUS", null, [], [[]], "Ambiguous reference without context."),
  h("H-O10", "OOS_AMBIGUOUS", "Làm tiếp đi", "AMBIGUOUS", null, [], [[]], "Continue command."),
  h("H-O11", "OOS_AMBIGUOUS", "Mình nên làm gì bây giờ?", "AMBIGUOUS", null, [], [[]], "Vague."),
  h("H-O12", "OOS_AMBIGUOUS", "Tôi cảm thấy không ổn lắm", "AMBIGUOUS", null, [], [[], [R]], "Vague malaise; recovery possible.", { review: true }),
  h("H-O13", "OOS_AMBIGUOUS", "Có nên mua máy chạy bộ để ở nhà không?", "OUT_OF_SCOPE", null, [], [[], [T]], "Equipment purchase.", { review: true }),
  h("H-O14", "OOS_AMBIGUOUS", "Giải thích giúp mình định luật Newton", "OUT_OF_SCOPE", null, [], [[]], "Physics."),
  h("H-O15", "OOS_AMBIGUOUS", "Mình muốn thay đổi bản thân", "AMBIGUOUS", null, [], [[]], "Vague wish."),
  h("H-O16", "OOS_AMBIGUOUS", "Thời gian gần đây công việc căng thẳng quá", "AMBIGUOUS", null, [], [[]], "Statement, no fitness domain."),
]);
