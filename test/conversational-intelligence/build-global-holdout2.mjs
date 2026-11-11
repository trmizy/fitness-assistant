// SECOND held-out set for GLOBAL routing, written AFTER the blind corpus was remediated; evaluated once, never used to tune.
import fs from "node:fs";
const cases = [];
let n = 0;
const c = (cat, text, exp, ctx = {}) => cases.push({ id: `GH-${String(++n).padStart(3, "0")}`, cat, text, exp, ctx });
const PT = { wf: "FIND_PT", slot: "budgetVnd" };
const WK = { wf: "CREATE_WORKOUT_PLAN", slot: "daysPerWeek" };
const RM = { wf: "CREATE_ROADMAP", slot: "targetWeight" };

c("read", "cho mình biết tình trạng hợp đồng PT của mình", { route: "READ_STATE", topic: "CONTRACT_STATUS" });
c("read", "mình đang tập với ai vậy nhỉ", { route: "READ_STATE", topic: "PT_STATUS" });
c("read", "hiện giờ mình đang theo giáo án nào", { route: "READ_STATE", topic: "PROGRAM_STATUS" });
c("read", "lịch tập tuần này của mình ra sao", { route: "READ_STATE", topic: "SCHEDULE" });
c("read", "mục tiêu của mình đang là gì thế", { route: "READ_STATE", topic: "GOAL" });
c("read", "tôi đang nạp bao nhiêu kcal mỗi ngày theo kế hoạch", { route: "READ_STATE", topic: "NUTRITION_TARGET" });
c("read", "bao nhiêu gram đạm mỗi ngày là mục tiêu của tôi", { route: "READ_STATE", topic: "NUTRITION_TARGET" });
c("read", "tôi nặng bao nhiêu theo hồ sơ", { route: "READ_STATE", topic: "PROFILE_FACT" });
c("read", "mình đã có thực đơn nào lưu chưa", { route: "READ_STATE", topic: "NUTRITION_PROGRAM" });
c("read", "hợp đồng nào của tôi còn hiệu lực", { route: "READ_STATE", topic: "CONTRACT_STATUS" });
c("read", "ngày mai lịch tập của tôi là gì", { route: "READ_STATE", topic: "SCHEDULE" });
c("read", "do i have a trainer yet", { route: "READ_STATE", topic: "PT_STATUS" });

c("recommend", "theo bạn mục tiêu nào phù hợp với thể trạng của tôi", { route: "RECOMMEND", topic: "GOAL" });
c("recommend", "tôi nên tăng hay giảm cân", { route: "RECOMMEND", topic: "GOAL" });
c("recommend", "mấy buổi một tuần là hợp lý với tôi", { route: "RECOMMEND", topic: "SESSIONS" });
c("recommend", "tôi nên chia bao nhiêu bữa ăn một ngày", { route: "RECOMMEND", topic: "MEALS" });
c("recommend", "có cần thiết phải thuê PT với tình trạng của tôi không", { route: "RECOMMEND", topic: "HIRE_PT" });
c("recommend", "chương trình tập nào phù hợp nhất với tôi hiện tại", { route: "RECOMMEND", topic: "PROGRAM" });
c("recommend", "PT nào phù hợp nhất với mục tiêu của tôi", { route: "RECOMMEND", topic: "PT" });
c("recommend", "tôi nên đặt cân nặng mục tiêu bao nhiêu cho hợp lý", { route: "RECOMMEND", topic: "TARGET_WEIGHT" });

c("start", "hãy lập cho tôi một thực đơn 3 bữa", { route: "START_WORKFLOW", wf: "CREATE_NUTRITION_PLAN" });
c("start", "tìm giúp tôi một huấn luyện viên", { route: "START_WORKFLOW", wf: "FIND_PT" });
c("start", "lên cho tôi lịch tập 5 buổi một tuần", { route: "START_WORKFLOW", wf: "CREATE_WORKOUT_PLAN" });
c("start", "xây dựng lộ trình 3 tháng cho tôi", { route: "START_WORKFLOW", wf: "CREATE_ROADMAP" });
c("start", "gợi ý giúp tôi vài chương trình tập", { route: "START_WORKFLOW", wf: "FIND_TRAINING_PROGRAM" });

c("qa", "Tại sao cơ bắp cần nghỉ ngơi?", { route: "KNOWLEDGE_QA" });
c("qa", "Carb tốt hay xấu?", { route: "KNOWLEDGE_QA" });
c("qa", "Nên khởi động bao lâu trước khi tập tạ?", { route: "KNOWLEDGE_QA" });
c("qa", "Plank giúp giảm mỡ bụng không?", { route: "KNOWLEDGE_QA" });
c("qa", "Huấn luyện viên cá nhân làm những việc gì?", { route: "KNOWLEDGE_QA" });
c("qa", "what does RPE mean", { route: "KNOWLEDGE_QA" });

c("write", "đổi mục tiêu của tôi sang duy trì", { route: "WRITE_ACTION", topic: "GOAL_CHANGE" });
c("write", "cập nhật mục tiêu thành tăng cơ giúp tôi", { route: "WRITE_ACTION", topic: "GOAL_CHANGE" });
c("write", "thuê PT thứ hai", { route: "WRITE_ACTION" }, { proposal: true });

c("interrupt", "ăn bao nhiêu protein là đủ vậy", { route: "KNOWLEDGE_QA", interrupts: true }, { active: PT });
c("interrupt", "mục tiêu calo của tôi đang là bao nhiêu", { route: "READ_STATE", topic: "NUTRITION_TARGET", interrupts: true }, { active: WK });
c("interrupt", "tôi có hợp đồng PT nào chưa", { route: "READ_STATE", topic: "PT_STATUS", interrupts: true }, { active: RM });
c("interrupt", "khoảng 2 triệu thôi", { route: "SLOT_ANSWER" }, { active: PT });
c("interrupt", "5 buổi nhé", { route: "SLOT_ANSWER" }, { active: WK });
c("interrupt", "thôi bỏ đi", { route: "CANCEL" }, { active: PT });
c("interrupt", "à không phải 5, tôi tập 4 buổi", { route: "CORRECTION" }, { active: WK });
c("interrupt", "chuyển sang tạo thực đơn trước", { route: "SWITCH_WORKFLOW", wf: "CREATE_NUTRITION_PLAN" }, { active: PT });

c("multi", "cho tôi biết mục tiêu hiện tại rồi gợi ý mục tiêu mới", { route: "MULTI", multi: ["READ_STATE", "RECOMMEND"] });
c("multi", "tại sao nên giảm mỡ, nếu ổn thì chuyển mục tiêu giúp tôi", { route: "EXPLAIN_AND_PROPOSE" });
c("negate", "tôi không cần thuê PT đâu", { route: "NEGATE_ACTION" });
c("negate", "đừng đổi mục tiêu của tôi", { route: "NEGATE_ACTION" });

fs.writeFileSync("test/conversational-intelligence/global-holdout2.json", JSON.stringify(cases, null, 1));
console.log(`global-holdout2.json: ${cases.length} cases`);
