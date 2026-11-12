/**
 * Gymini V2 Multi-Agent — M5.1 DEV set (routing). Written AFTER heldout v2 was frozen; the router MAY be tuned on these
 * cases. Built from the M5 v1 error taxonomy (A synonym/paraphrase, B context taken as intent, C compound asks,
 * D primary ranking, E support choice, F out-of-scope/ambiguous, G safety pre-routing), with new wording — no v1 or
 * heldout question is copied. Same labelling protocol as heldout v2 (see dataset-heldout-v2.ts). Single author.
 */
import type { AgentLabel, CaseCategory, RoutingCase } from "./dataset-v1";

const T: AgentLabel = "training", N: AgentLabel = "nutrition", R: AgentLabel = "recovery", P: AgentLabel = "progress";
type Opt = Partial<Pick<RoutingCase, "review" | "expectDeferred" | "features">> & { group?: string };
function d(id: string, category: CaseCategory, q: string, primaryAgent: AgentLabel | null, requiredAgents: AgentLabel[], acceptable: AgentLabel[][], rationale: string, o: Opt = {}): RoutingCase {
  const coverage: RoutingCase["coverage"] = !requiredAgents.length ? "NONE" : (o.expectDeferred?.length ?? 0) > 0 ? "PARTIAL" : "FULL";
  return {
    id, q, category, primaryIntent: o.group ?? "DEV", primaryAgent, requiredAgents, acceptable, expectDeferred: o.expectDeferred ?? [], coverage,
    evidence: [], forbiddenClaims: [], safety: "NONE", fixture: "default", rationale, features: o.features ?? ["natural"],
    ...(o.review ? { review: true as const } : {}), routingScored: true, split: "dev",
  };
}

export const ROUTING_CASES_DEV: readonly RoutingCase[] = Object.freeze([
  // A — synonyms / paraphrases
  d("D-A01", "SINGLE", "Chiều nay mình có buổi nào không?", T, [T], [[T]], "Schedule without 'tập'.", { group: "A", features: ["synonym"] }),
  d("D-A02", "SINGLE", "Tuần mấy buổi lên phòng là hợp lý cho người mới?", T, [T], [[T]], "Gym slang frequency.", { group: "A", features: ["slang"] }),
  d("D-A03", "SINGLE", "Giáo án ppl với upper lower cái nào hợp với mình hơn?", T, [T], [[T]], "Program split with 'giáo án'.", { group: "A", features: ["slang"] }),
  d("D-A04", "SINGLE", "Đêm qua ngủ có 5 tiếng thì cơ có hồi kịp không?", R, [R], [[R]], "Sleep & recovery.", { group: "A", features: ["synonym"] }),
  d("D-A05", "SINGLE", "nguoi ue oai qua, chac tai tap nhieu", R, [R], [[R]], "Fatigue statement, unaccented.", { group: "A", features: ["unaccented", "no_subject"] }),
  d("D-A06", "SINGLE", "Hai tháng nay mình xuống được bao nhiêu cân rồi?", P, [P], [[P]], "Weight lost ('xuống cân').", { group: "A", features: ["slang"] }),
  d("D-A07", "SINGLE", "Đợt đánh giá chu kỳ gần nhất nói gì về mình?", P, [P], [[P]], "Assessment.", { group: "A" }),
  d("D-A08", "SINGLE", "Bắp chân còn nhức từ hôm kia, có bình thường không?", R, [R], [[R]], "Soreness.", { group: "A" }),
  d("D-A09", "SINGLE", "Chuột rút bắp đùi lúc tập là do đâu?", R, [R], [[R], [N]], "Cramp cause: recovery or nutrition.", { group: "A", review: true }),
  d("D-A10", "SINGLE", "Tôi có đang đi đúng lộ trình giảm cân không?", P, [P], [[P]], "Trajectory.", { group: "A", features: ["synonym"] }),
  d("D-A11", "SINGLE", "Bao lâu mới nên tập lại ngực sau buổi đẩy nặng?", R, [R], [[R], [T]], "Recovery interval.", { group: "A", review: true }),
  d("D-A12", "SINGLE", "Cuối giai đoạn này dự kiến mình còn bao nhiêu ký?", P, [P], [[P]], "Forecast without 'dự báo'.", { group: "A", features: ["synonym"] }),
  d("D-A13", "SINGLE", "Lượng đạm mỗi ngày của mình đang được đặt là bao nhiêu?", N, [N], [[N]], "Protein target ('đạm').", { group: "A", features: ["synonym"] }),
  d("D-A14", "SINGLE", "Mai tập gì vậy?", T, [T], [[T]], "Tomorrow's session, short.", { group: "A", features: ["no_subject"] }),
  // B — context mistaken for an independent intent
  d("D-B01", "SINGLE", "Sau buổi gym nên uống gì cho mau lại sức?", N, [N], [[N], [N, R]], "Food ask; gym is context.", { group: "B", review: true }),
  d("D-B02", "SINGLE", "Trước khi đi tập có nên ăn chuối không?", N, [N], [[N]], "General food question.", { group: "B" }),
  d("D-B03", "SINGLE", "Bench press của mình 1RM ước tính đang là bao nhiêu?", P, [P], [[P]], "Exercise name is context for progress.", { group: "B" }),
  d("D-B04", "SINGLE", "Uống cà phê trước buổi tập có tốt không?", N, [N], [[N]], "General.", { group: "B" }),
  d("D-B05", "SINGLE", "Tập gym thì ăn bao nhiêu đạm là đủ?", N, [N], [[N]], "General protein question with gym context.", { group: "B", features: ["no_subject"] }),
  d("D-B06", "SINGLE", "Squat sâu có hại gối không?", T, [T], [[T]], "Technique.", { group: "B" }),
  d("D-B07", "SINGLE", "Tập xong bị đói thì ăn gì?", N, [N], [[N]], "General.", { group: "B", features: ["no_subject"] }),
  d("D-B08", "SINGLE", "Cân nặng tuần này của tôi có thay đổi so với tuần trước không?", P, [P], [[P]], "'Thay đổi' is not a program change.", { group: "B" }),
  d("D-B09", "SINGLE", "Giáo án hiện tại có bao nhiêu bài?", T, [T], [[T]], "'giáo án' is not eating.", { group: "B" }),
  // C — compound asks
  d("D-C01", "TWO", "Buổi tập hôm nay là gì, và tối nên ăn món gì?", T, [T, N], [[T, N]], "Two asks.", { group: "C", features: ["compound"] }),
  d("D-C02", "TWO", "Xem giúp mình mục tiêu calo rồi xem luôn lịch tập tuần này", N, [N, T], [[N, T]], "Two imperatives.", { group: "C", features: ["compound"] }),
  d("D-C03", "TWO", "Tiến độ cân nặng tháng này sao rồi, có nên đổi thực đơn không?", P, [P, N], [[P, N]], "Two asks.", { group: "C", features: ["compound"] }),
  d("D-C04", "TWO", "Mình có đang quá tải không, và tuần sau nên tập mấy buổi?", R, [R, T], [[R, T]], "Two asks.", { group: "C", features: ["compound"] }),
  d("D-C05", "TWO", "Sức đẩy của tôi tăng chưa và có nên đổi bài tập ngực?", P, [P, T], [[P, T]], "Two asks.", { group: "C", features: ["compound"] }),
  d("D-C06", "TWO", "Tôi nên ngủ bao nhiêu và ăn gì để phục hồi tốt?", R, [R, N], [[R, N]], "Two asks.", { group: "C", features: ["compound"] }),
  d("D-C07", "TWO", "Lịch tuần này thế nào, có ngày nghỉ không?", T, [T], [[T], [T, R]], "Schedule incl. rest days.", { group: "C", review: true }),
  // D — primary ranking with background
  d("D-D01", "TWO", "Deadlift chững cả tháng, chương trình có cần sửa không?", T, [T, P], [[T, P]], "Plateau context → program ask.", { group: "D", features: ["slang"] }),
  d("D-D02", "TWO", "Mình mệt rã rời mấy hôm nay, có nên nghỉ buổi tối nay không?", R, [R, T], [[R, T]], "Rest decision for tonight's session.", { group: "D" }),
  d("D-D03", "TWO", "Cân không nhúc nhích, có cần giảm calo không?", N, [N, P], [[N, P]], "Plateau context → calorie ask.", { group: "D" }),
  d("D-D04", "TWO", "Vì hôm qua chạy dài nên hôm nay tập gì cho hợp?", T, [T, R], [[T, R]], "History context → today.", { group: "D" }),
  d("D-D05", "TWO", "Sức mạnh đi xuống, có phải do thiếu ngủ không?", P, [P, R], [[P, R]], "Strength vs sleep.", { group: "D", features: ["progress_vs_recovery"] }),
  d("D-D06", "TWO", "Tôi muốn giảm số buổi vì quá đuối, bỏ buổi nào thì hợp lý?", T, [T, R], [[T, R]], "Program cut given fatigue.", { group: "D" }),
  d("D-D07", "TWO", "Mỡ không xuống dù tập đều, thực đơn hiện tại có ổn không?", N, [N, P], [[N, P]], "Plan review given body-fat trend.", { group: "D" }),
  d("D-D08", "TWO", "Tập liên tục 6 tuần rồi, tiến bộ có chậm lại không?", P, [P, R], [[P], [P, R]], "Progress ask; load is context.", { group: "D", review: true }),
  // E — supporting agent choice
  d("D-E01", "TWO", "Hôm qua tập lưng nặng, hôm nay nên ăn gì?", N, [N], [[N], [N, R]], "Food ask with history context.", { group: "E", review: true }),
  d("D-E02", "TWO", "Tôi bị mỏi vai, buổi đẩy hôm nay có nên bỏ bài overhead press?", T, [T, R], [[T, R]], "Session change given soreness.", { group: "E" }),
  d("D-E03", "TWO", "Sau 2 tháng cut, cơ thể mình thay đổi ra sao và có nên ăn lại bình thường?", P, [P, N], [[P, N]], "Two asks.", { group: "E", features: ["compound", "slang"] }),
  d("D-E04", "TWO", "Tôi ăn ít mà vẫn không giảm cân, có phải do trao đổi chất không?", P, [P, N], [[P, N], [N, P]], "Weight plateau vs intake.", { group: "E", review: true }),
  d("D-E05", "TWO", "Tôi mệt suốt, xem giúp tải tập tuần này của tôi", R, [R], [[R]], "Recovery ask with fatigue context.", { group: "E" }),
  // multi (cap pressure)
  d("D-M01", "MULTI", "Hôm nay nên tập gì, ăn mấy bữa và có cần ngủ trưa không?", T, [T, N, R], [[T, N], [T, R]], "Three asks.", { group: "C", expectDeferred: [N, R], features: ["compound", "cap_pressure"] }),
  d("D-M02", "MULTI", "Tóm lại cho tôi tiến độ cân nặng, mức hồi phục và lượng calo tuần này", P, [P, R, N], [[P, R], [P, N]], "Three objects.", { group: "C", expectDeferred: [R, N], features: ["cap_pressure"] }),
  d("D-M03", "MULTI", "Tôi kiệt sức, cân không giảm, nên đổi lịch tập hay giảm ăn?", T, [T, N, R, P], [[T, N]], "Asks program or diet.", { group: "D", expectDeferred: [R, P], review: true, features: ["cap_pressure"] }),
  d("D-M04", "MULTI", "Sức mạnh chững, ngủ ít, ăn uống thất thường, tuần sau nên tập thế nào?", T, [T, P, R, N], [[T, P], [T, R]], "Ask = next week's training.", { group: "D", expectDeferred: [P, R, N], review: true, features: ["cap_pressure"] }),
  d("D-M05", "MULTI", "Đánh giá giúp tôi sức mạnh, tải tập và chế độ ăn tháng này", P, [P, R, N], [[P, R], [P, N]], "Three objects.", { group: "C", expectDeferred: [R, N], features: ["cap_pressure"] }),
  // F — out of scope / ambiguous
  d("D-F01", "OOS_AMBIGUOUS", "Mở nhạc giúp mình", null, [], [[]], "Not supported.", { group: "F" }),
  d("D-F02", "OOS_AMBIGUOUS", "Có nên mua giày tập gym loại đế bằng không?", null, [], [[]], "Shopping.", { group: "F", review: true }),
  d("D-F03", "OOS_AMBIGUOUS", "Cái này là sao?", null, [], [[]], "Ambiguous reference.", { group: "F" }),
  d("D-F04", "OOS_AMBIGUOUS", "Tôi muốn sống lành mạnh hơn", null, [], [[]], "Vague wish.", { group: "F" }),
  d("D-F05", "OOS_AMBIGUOUS", "Cho tôi mật khẩu wifi", null, [], [[]], "OOS.", { group: "F" }),
  d("D-F06", "OOS_AMBIGUOUS", "Hôm nay là thứ mấy?", null, [], [[]], "Calendar question, not training.", { group: "F" }),
  d("D-F07", "OOS_AMBIGUOUS", "Mọi thứ ổn chứ?", null, [], [[]], "Chit-chat ('mọi' folds to 'moi').", { group: "F" }),
  d("D-F08", "OOS_AMBIGUOUS", "Mới đi làm về, chán quá", null, [], [[]], "Statement ('mới' folds to 'moi').", { group: "F" }),
  d("D-F09", "OOS_AMBIGUOUS", "Giáo án môn toán lớp 10 soạn thế nào?", null, [], [[]], "'giáo án' in a school context.", { group: "F", review: true }),
  d("D-F10", "OOS_AMBIGUOUS", "Đặt lịch hẹn cắt tóc giúp mình", null, [], [[]], "'lịch' outside training.", { group: "F" }),
  // personal vs general (single owner)
  d("D-G01", "SINGLE", "Protein whey có hại thận không?", N, [N], [[N]], "General.", { group: "B" }),
  d("D-G02", "SINGLE", "Lịch tập của tôi tuần này có buổi nào nghỉ không?", T, [T], [[T]], "Personal schedule.", { group: "B" }),
  d("D-G03", "SINGLE", "Deload là gì?", R, [R], [[R]], "Concept.", { group: "A" }),
  d("D-G04", "SINGLE", "Tôi đã tập được bao nhiêu buổi trong tháng?", R, [R], [[R], [P], [T]], "Logged sessions: history (recovery) vs adherence.", { group: "A", review: true }),
  d("D-G05", "SINGLE", "an gi de tang co", N, [N], [[N]], "Unaccented general.", { group: "A", features: ["unaccented"] }),
  d("D-G06", "SINGLE", "lich tap ngay mai cua toi", T, [T], [[T]], "Unaccented statement-form request.", { group: "A", features: ["unaccented"] }),
]);
