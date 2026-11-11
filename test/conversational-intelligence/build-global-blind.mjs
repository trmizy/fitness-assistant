// BLIND corpus for GLOBAL conversational routing (inside AND outside workflows). Written BEFORE the global router was implemented and
// NOT used to tune it; the first-pass result is frozen in results/global-blind-first-pass.json and never overwritten.
// Synthetic utterances only. Route taxonomy:
//   READ_STATE(topic) · RECOMMEND(topic) · WRITE_ACTION · START_WORKFLOW(wf) · KNOWLEDGE_QA · SLOT_ANSWER · CORRECTION · CANCEL
//   SWITCH_WORKFLOW(wf) · REFERENCE · EXPLAIN_AND_PROPOSE · NEGATE_ACTION · MULTI([routes])
// ctx.active = { wf, slot } when a workflow is waiting for that slot; ctx.proposal = the assistant proposed/recommended something earlier.
import fs from "node:fs";
const cases = [];
let n = 0;
const c = (cat, text, exp, ctx = {}) => cases.push({ id: `GB-${String(++n).padStart(3, "0")}`, cat, text, exp, ctx });
const PT = { wf: "FIND_PT", slot: "budgetVnd" };
const PTD = { wf: "FIND_PT", slot: "days" };
const WK = { wf: "CREATE_WORKOUT_PLAN", slot: "daysPerWeek" };
const RM = { wf: "CREATE_ROADMAP", slot: "targetWeight" };
const NU = { wf: "CREATE_NUTRITION_PLAN", slot: "mealsPerDay" };

// ── standalone READ-state ──
const R = "read-state";
c(R, "Tôi đang có PT chưa?", { route: "READ_STATE", topic: "PT_STATUS" });
c(R, "PT hiện tại của tôi là ai?", { route: "READ_STATE", topic: "PT_STATUS" });
c(R, "Tôi còn hợp đồng PT nào đang hoạt động không?", { route: "READ_STATE", topic: "CONTRACT_STATUS" });
c(R, "Tôi có chương trình tập chưa?", { route: "READ_STATE", topic: "PROGRAM_STATUS" });
c(R, "Tôi đang theo chương trình nào?", { route: "READ_STATE", topic: "PROGRAM_STATUS" });
c(R, "Lịch tập hiện tại của tôi là gì?", { route: "READ_STATE", topic: "SCHEDULE" });
c(R, "Hôm nay tôi tập gì?", { route: "READ_STATE", topic: "SCHEDULE" });
c(R, "Tôi đang theo thực đơn nào?", { route: "READ_STATE", topic: "NUTRITION_PROGRAM" });
c(R, "Mục tiêu hiện tại của tôi là gì?", { route: "READ_STATE", topic: "GOAL" });
c(R, "Calo hiện tại của tôi bao nhiêu?", { route: "READ_STATE", topic: "NUTRITION_TARGET" });
c(R, "Macro của tôi hiện tại là bao nhiêu?", { route: "READ_STATE", topic: "NUTRITION_TARGET" });
c(R, "Tôi đang ăn theo bao nhiêu calo?", { route: "READ_STATE", topic: "NUTRITION_TARGET" });
c(R, "Cân nặng hiện tại của tôi là bao nhiêu?", { route: "READ_STATE", topic: "PROFILE_FACT" });
c(R, "Chiều cao của tôi trong hồ sơ là bao nhiêu?", { route: "READ_STATE", topic: "PROFILE_FACT" });
c(R, "Cân nặng mục tiêu của tôi là bao nhiêu?", { route: "READ_STATE", topic: "PROFILE_FACT" });
c(R, "tôi có PT chưa", { route: "READ_STATE", topic: "PT_STATUS" });
c(R, "toi dang co pt chua", { route: "READ_STATE", topic: "PT_STATUS" });
c(R, "hop dong pt cua toi trang thai gi", { route: "READ_STATE", topic: "CONTRACT_STATUS" });
c(R, "Hợp đồng PT của tôi đang ở trạng thái nào?", { route: "READ_STATE", topic: "CONTRACT_STATUS" });
c(R, "Tôi đã đăng ký PT nào chưa?", { route: "READ_STATE", topic: "PT_STATUS" });
c(R, "Mỗi ngày tôi được ăn bao nhiêu protein?", { route: "READ_STATE", topic: "NUTRITION_TARGET" });
c(R, "Tôi đang tập mấy buổi một tuần?", { route: "READ_STATE", topic: "PROGRAM_STATUS" });
c(R, "Tuần này lịch tập của tôi thế nào?", { route: "READ_STATE", topic: "SCHEDULE" });
c(R, "ngày mai tôi tập gì", { route: "READ_STATE", topic: "SCHEDULE" });
c(R, "Mình đang theo kế hoạch calo nào vậy?", { route: "READ_STATE", topic: "NUTRITION_TARGET" });
c(R, "Tôi có thực đơn chưa?", { route: "READ_STATE", topic: "NUTRITION_PROGRAM" });
c(R, "PT của mình tên gì?", { route: "READ_STATE", topic: "PT_STATUS" });
c(R, "What's my current goal?", { route: "READ_STATE", topic: "GOAL" });
c(R, "my calo target hiện tại là bao nhiêu", { route: "READ_STATE", topic: "NUTRITION_TARGET" });
c(R, "Goal hiện tại của tôi là cut hay bulk?", { route: "READ_STATE", topic: "GOAL" });

// ── personalized RECOMMEND ──
const RC = "recommend";
c(RC, "PT nào hợp với tôi?", { route: "RECOMMEND", topic: "PT" });
c(RC, "Chương trình nào hợp với tôi?", { route: "RECOMMEND", topic: "PROGRAM" });
c(RC, "Theo tình trạng hiện tại tôi nên cut hay bulk?", { route: "RECOMMEND", topic: "GOAL" });
c(RC, "Với tình trạng hiện tại tôi nên cut hay bulk?", { route: "RECOMMEND", topic: "GOAL" });
c(RC, "Mục tiêu nào hợp với tôi?", { route: "RECOMMEND", topic: "GOAL" });
c(RC, "Bạn thấy mục tiêu nào hợp với tôi?", { route: "RECOMMEND", topic: "GOAL" });
c(RC, "Mục tiêu cân nặng nào hợp với tôi?", { route: "RECOMMEND", topic: "TARGET_WEIGHT" });
c(RC, "Tôi nên tập bao nhiêu buổi một tuần?", { route: "RECOMMEND", topic: "SESSIONS" });
c(RC, "Tôi có nên thuê PT không?", { route: "RECOMMEND", topic: "HIRE_PT" });
c(RC, "Tôi nên ăn bao nhiêu bữa mỗi ngày?", { route: "RECOMMEND", topic: "MEALS" });
c(RC, "Tôi không biết nên tập mấy buổi", { route: "RECOMMEND", topic: "SESSIONS" });
c(RC, "nen cut hay bulk vay", { route: "RECOMMEND", topic: "GOAL" });
c(RC, "tôi nên đặt cân nặng mục tiêu là bao nhiêu", { route: "RECOMMEND", topic: "TARGET_WEIGHT" });
c(RC, "Should I cut or bulk?", { route: "RECOMMEND", topic: "GOAL" });
c(RC, "bạn đề xuất giúp tôi mục tiêu phù hợp", { route: "RECOMMEND", topic: "GOAL" });
c(RC, "Tôi có cần thuê PT không nhỉ?", { route: "RECOMMEND", topic: "HIRE_PT" });
c(RC, "Tôi nên tập mấy buổi một tuần với mục tiêu hiện tại?", { route: "RECOMMEND", topic: "SESSIONS" });
c(RC, "Chương trình tập nào phù hợp với người mới như tôi?", { route: "RECOMMEND", topic: "PROGRAM" });
c(RC, "Nên ăn mấy bữa thì hợp lý?", { route: "RECOMMEND", topic: "MEALS" });
c(RC, "toi nen cut hay bulk", { route: "RECOMMEND", topic: "GOAL" });
c(RC, "recommend cho tôi chương trình phù hợp", { route: "RECOMMEND", topic: "PROGRAM" });

// ── WRITE / ACTION (must only ever PROPOSE) ──
const W = "write-action";
c(W, "Thuê PT này.", { route: "WRITE_ACTION" }, { proposal: true });
c(W, "Thuê PT đầu tiên.", { route: "WRITE_ACTION" }, { proposal: true });
c(W, "Đổi mục tiêu sang giảm mỡ.", { route: "WRITE_ACTION", topic: "GOAL_CHANGE" });
c(W, "Cập nhật cân nặng mục tiêu thành 72kg.", { route: "WRITE_ACTION", topic: "GOAL_CHANGE" });
c(W, "Lưu lịch tập này.", { route: "WRITE_ACTION" }, { proposal: true });
c(W, "Chọn chương trình thứ nhất.", { route: "WRITE_ACTION" }, { proposal: true });
c(W, "Đổi giúp tôi sang tăng cơ.", { route: "WRITE_ACTION", topic: "GOAL_CHANGE" });
c(W, "chuyển mục tiêu của tôi sang duy trì", { route: "WRITE_ACTION", topic: "GOAL_CHANGE" });

// ── workflow START commands ──
const S = "workflow-start";
c(S, "Tạo lộ trình cho tôi.", { route: "START_WORKFLOW", wf: "CREATE_ROADMAP" });
c(S, "Tạo lịch tập cho tôi.", { route: "START_WORKFLOW", wf: "CREATE_WORKOUT_PLAN" });
c(S, "Tạo thực đơn cho tôi.", { route: "START_WORKFLOW", wf: "CREATE_NUTRITION_PLAN" });
c(S, "Tìm PT cho tôi.", { route: "START_WORKFLOW", wf: "FIND_PT" });
c(S, "Tìm chương trình tập cho tôi.", { route: "START_WORKFLOW", wf: "FIND_TRAINING_PROGRAM" });
c(S, "Lập cho tôi một lộ trình giảm mỡ 12 tuần", { route: "START_WORKFLOW", wf: "CREATE_ROADMAP" });
c(S, "Lên lịch tập 4 buổi cho tôi", { route: "START_WORKFLOW", wf: "CREATE_WORKOUT_PLAN" });
c(S, "Gợi ý chương trình tập cho tôi", { route: "START_WORKFLOW", wf: "FIND_TRAINING_PROGRAM" });
c(S, "tạo plan tập gym cho t", { route: "START_WORKFLOW", wf: "CREATE_WORKOUT_PLAN" });
c(S, "lên thực đơn 4 bữa giúp tôi", { route: "START_WORKFLOW", wf: "CREATE_NUTRITION_PLAN" });
c(S, "tim pt cho toi", { route: "START_WORKFLOW", wf: "FIND_PT" });
c(S, "Build me a workout plan", { route: "START_WORKFLOW", wf: "CREATE_WORKOUT_PLAN" });
c(S, "Tìm giúp tôi PT ở quận 1", { route: "START_WORKFLOW", wf: "FIND_PT" });
c(S, "Cho tôi một thực đơn giảm cân", { route: "START_WORKFLOW", wf: "CREATE_NUTRITION_PLAN" });
c(S, "Tôi muốn có lộ trình tăng cơ", { route: "START_WORKFLOW", wf: "CREATE_ROADMAP" });
c(S, "tao lo trinh cho toi", { route: "START_WORKFLOW", wf: "CREATE_ROADMAP" });

// ── general knowledge Q&A (must never start a workflow or read business state) ──
const Q = "knowledge-qa";
c(Q, "Progressive overload là gì?", { route: "KNOWLEDGE_QA" });
c(Q, "RIR là gì?", { route: "KNOWLEDGE_QA" });
c(Q, "Superset khác dropset thế nào?", { route: "KNOWLEDGE_QA" });
c(Q, "Protein có vai trò gì?", { route: "KNOWLEDGE_QA" });
c(Q, "Tập cardio trước hay sau tạ?", { route: "KNOWLEDGE_QA" });
c(Q, "Creatine có an toàn không?", { route: "KNOWLEDGE_QA" });
c(Q, "BMI là gì và tính thế nào?", { route: "KNOWLEDGE_QA" });
c(Q, "Ăn tối muộn có béo không?", { route: "KNOWLEDGE_QA" });
c(Q, "hiit khac liss ntn", { route: "KNOWLEDGE_QA" });
c(Q, "What is a deload week?", { route: "KNOWLEDGE_QA" });
c(Q, "Bao nhiêu set mỗi nhóm cơ là đủ?", { route: "KNOWLEDGE_QA" });
c(Q, "Squat sâu có hại gối không?", { route: "KNOWLEDGE_QA" });
c(Q, "PT là gì?", { route: "KNOWLEDGE_QA" });
c(Q, "Một PT tốt cần có tiêu chí gì?", { route: "KNOWLEDGE_QA" });
c(Q, "Thâm hụt calo là gì?", { route: "KNOWLEDGE_QA" });

// ── interruptions of a waiting workflow ──
const I = "interruption";
c(I, "Macro hiện tại của tôi bao nhiêu?", { route: "READ_STATE", topic: "NUTRITION_TARGET", interrupts: true }, { active: PT });
c(I, "protein là gì?", { route: "KNOWLEDGE_QA", interrupts: true }, { active: PT });
c(I, "2 triệu", { route: "SLOT_ANSWER" }, { active: PT });
c(I, "khoảng 1.5 triệu", { route: "SLOT_ANSWER" }, { active: PT });
c(I, "không giới hạn", { route: "SLOT_ANSWER" }, { active: PT });
c(I, "Tôi đang có PT chưa?", { route: "READ_STATE", topic: "PT_STATUS", interrupts: true }, { active: PT });
c(I, "4 buổi", { route: "SLOT_ANSWER" }, { active: WK });
c(I, "Lịch tập hiện tại của tôi là gì?", { route: "READ_STATE", topic: "SCHEDULE", interrupts: true }, { active: WK });
c(I, "72kg", { route: "SLOT_ANSWER" }, { active: RM });
c(I, "mục tiêu hiện tại của tôi là gì?", { route: "READ_STATE", topic: "GOAL", interrupts: true }, { active: RM });
c(I, "Squat là gì?", { route: "KNOWLEDGE_QA", interrupts: true }, { active: WK });
c(I, "3 bữa", { route: "SLOT_ANSWER" }, { active: NU });
c(I, "Calo mục tiêu của tôi bao nhiêu?", { route: "READ_STATE", topic: "NUTRITION_TARGET", interrupts: true }, { active: NU });
c(I, "T2 T4 T6", { route: "SLOT_ANSWER" }, { active: PTD });
c(I, "thứ 2 thứ 4 thứ 6 nhé", { route: "SLOT_ANSWER" }, { active: PTD });
c(I, "à mà creatine có an toàn không?", { route: "KNOWLEDGE_QA", interrupts: true }, { active: PT });
c(I, "ngân sách khoảng 3tr", { route: "SLOT_ANSWER" }, { active: PT });
c(I, "PT hiện tại của tôi là ai?", { route: "READ_STATE", topic: "PT_STATUS", interrupts: true }, { active: PT });
c(I, "Cân nặng hiện tại của tôi bao nhiêu?", { route: "READ_STATE", topic: "PROFILE_FACT", interrupts: true }, { active: RM });
c(I, "Hôm nay tôi tập gì?", { route: "READ_STATE", topic: "SCHEDULE", interrupts: true }, { active: RM });
c(I, "Tôi đang theo thực đơn nào?", { route: "READ_STATE", topic: "NUTRITION_PROGRAM", interrupts: true }, { active: WK });
c(I, "RIR là gì vậy?", { route: "KNOWLEDGE_QA", interrupts: true }, { active: NU });

// ── switching / cancelling ──
const SW = "switch-cancel";
c(SW, "thôi tìm PT, tạo lịch tập trước", { route: "SWITCH_WORKFLOW", wf: "CREATE_WORKOUT_PLAN" }, { active: PT });
c(SW, "khoan, tạo thực đơn trước đã", { route: "SWITCH_WORKFLOW", wf: "CREATE_NUTRITION_PLAN" }, { active: WK });
c(SW, "Tạo lộ trình cho tôi", { route: "SWITCH_WORKFLOW", wf: "CREATE_ROADMAP" }, { active: PT });
c(SW, "thôi", { route: "CANCEL" }, { active: PT });
c(SW, "hủy đi", { route: "CANCEL" }, { active: RM });
c(SW, "không cần nữa", { route: "CANCEL" }, { active: PT });
c(SW, "dừng lại", { route: "CANCEL" }, { active: NU });
c(SW, "bỏ qua đi", { route: "CANCEL" }, { active: PT });

// ── corrections inside a workflow ──
const CO = "correction";
c(CO, "không phải 2 triệu, 3 triệu", { route: "CORRECTION" }, { active: PT });
c(CO, "à không, 70kg", { route: "CORRECTION" }, { active: RM });
c(CO, "à không, tôi tập 5 buổi", { route: "CORRECTION" }, { active: WK });
c(CO, "ngân sách lúc nãy sai, 2 triệu thôi", { route: "CORRECTION" }, { active: PT });
c(CO, "nhầm rồi, 4 bữa", { route: "CORRECTION" }, { active: NU });
c(CO, "không tăng cơ nữa, tôi muốn giảm mỡ", { route: "CORRECTION" }, { active: RM });
c(CO, "ý tôi là 72 chứ không phải 74", { route: "CORRECTION" }, { active: RM });
c(CO, "đổi thành 45 phút mỗi buổi", { route: "CORRECTION" }, { active: WK });
c(CO, "thực ra tôi chỉ có 1 triệu", { route: "CORRECTION" }, { active: PT });
c(CO, "sửa lại: mục tiêu 68kg", { route: "CORRECTION" }, { active: RM });

// ── references to something the assistant said ──
const RF = "reference";
c(RF, "ok đổi theo đề xuất đó", { route: "REFERENCE" }, { proposal: true });
c(RF, "dùng mức bạn đề xuất", { route: "REFERENCE" }, { proposal: true, active: RM });
c(RF, "lấy mức thấp hơn", { route: "REFERENCE" }, { proposal: true, active: RM });
c(RF, "chọn PT đầu tiên", { route: "WRITE_ACTION" }, { proposal: true });
c(RF, "thuê người đó", { route: "WRITE_ACTION" }, { proposal: true });
c(RF, "lưu plan vừa rồi", { route: "WRITE_ACTION" }, { proposal: true });
c(RF, "giữ cái cũ", { route: "REFERENCE" }, { proposal: true });
c(RF, "đổi cái vừa rồi còn 3 bữa", { route: "REFERENCE" }, { proposal: true });
c(RF, "ok theo đề xuất", { route: "REFERENCE" }, { proposal: true });
c(RF, "cái đầu tiên đi", { route: "REFERENCE" }, { proposal: true });

// ── multi-intent / explanation + action ──
const M = "multi-intent";
c(M, "Vì sao bạn nghĩ tôi nên giảm mỡ? Nếu hợp lý thì đổi giúp tôi.", { route: "EXPLAIN_AND_PROPOSE" });
c(M, "Tại sao tôi nên đổi sang giảm mỡ? Đổi luôn giúp tôi nhé", { route: "EXPLAIN_AND_PROPOSE" });
c(M, "Mục tiêu hiện tại của tôi là gì, và có hợp với tình trạng của tôi không?", { route: "MULTI", multi: ["READ_STATE", "RECOMMEND"] });
c(M, "Tôi đang có PT chưa? Nếu chưa thì tìm giúp tôi", { route: "MULTI", multi: ["READ_STATE", "START_WORKFLOW"] });
c(M, "Calo của tôi bao nhiêu và thực đơn hôm nay có gì?", { route: "MULTI", multi: ["READ_STATE", "READ_STATE"] });
c(M, "Giải thích RIR rồi tạo lịch tập giúp tôi", { route: "MULTI", multi: ["KNOWLEDGE_QA", "START_WORKFLOW"] });
c(M, "Cho tôi biết mục tiêu hiện tại và đề xuất mục tiêu mới", { route: "MULTI", multi: ["READ_STATE", "RECOMMEND"] });
c(M, "Cho tôi xem lịch tập hôm nay rồi tìm PT giúp tôi", { route: "MULTI", multi: ["READ_STATE", "START_WORKFLOW"] });

// ── negation ──
const NG = "negation";
c(NG, "Tôi không muốn thuê PT", { route: "NEGATE_ACTION" });
c(NG, "Không cần tìm PT nữa", { route: "NEGATE_ACTION" });
c(NG, "đừng đổi mục tiêu", { route: "NEGATE_ACTION" });
c(NG, "không lưu", { route: "NEGATE_ACTION" }, { proposal: true });
c(NG, "tôi chưa muốn thuê ai cả", { route: "NEGATE_ACTION" });
c(NG, "không cần tạo lộ trình đâu, chỉ cho tôi xem mục tiêu hiện tại", { route: "READ_STATE", topic: "GOAL" });
c(NG, "đừng tìm PT, cho tôi biết tôi đang có PT nào", { route: "READ_STATE", topic: "PT_STATUS" });

// ── casual / no-diacritic / mixed ──
const CV = "casual-vietnamese";
c(CV, "mình có pt chưa nhỉ", { route: "READ_STATE", topic: "PT_STATUS" });
c(CV, "cho mình hỏi lịch tập hôm nay", { route: "READ_STATE", topic: "SCHEDULE" });
c(CV, "check giúp mình calo target", { route: "READ_STATE", topic: "NUTRITION_TARGET" });
c(CV, "cho t xem goal hiện tại", { route: "READ_STATE", topic: "GOAL" });
c(CV, "muc tieu cua toi hien gio la gi", { route: "READ_STATE", topic: "GOAL" });
c(CV, "chuong trinh tap cua toi la gi", { route: "READ_STATE", topic: "PROGRAM_STATUS" });
c(CV, "so far tôi đang follow chương trình nào", { route: "READ_STATE", topic: "PROGRAM_STATUS" });
c(CV, "PT của t đâu rồi", { route: "READ_STATE", topic: "PT_STATUS" });
c(CV, "hợp đồng pt tôi đến đâu rồi", { route: "READ_STATE", topic: "CONTRACT_STATUS" });

fs.writeFileSync("test/conversational-intelligence/global-blind.json", JSON.stringify(cases, null, 1));
console.log(`global-blind.json: ${cases.length} cases in ${new Set(cases.map((x) => x.cat)).size} categories`);
