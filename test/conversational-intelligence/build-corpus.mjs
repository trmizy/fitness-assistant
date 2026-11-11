// Builds test/conversational-intelligence/corpus.json — SYNTHETIC Vietnamese utterances (no production conversations, no real user data).
// Expectation keys: intent · ents ["TYPE=value"] (must be present) · forbid ["TYPE=value"] (must be absent) · corr ["FIELD>new"]
// goal ["GOAL:E|I" | "GOAL-"(negated)] · rec · ref · amb · neg ["TYPE=value"] · why · wf · noEnt
// ctx: { slot, cw (persisted current weight kg), proposal }
import fs from "node:fs";

const cases = [];
let n = 0;
const c = (cat, text, exp = {}, ctx = {}) => cases.push({ id: `${cat.slice(0, 3).toUpperCase()}-${String(++n).padStart(3, "0")}`, cat, text, exp, ctx });

// ── height / weight / unit extraction ──
const HW = "unit-extraction";
c(HW, "tôi cao 1m73", { ents: ["HEIGHT_CM=173"], forbid: ["WEIGHT_KG=73", "TARGET_WEIGHT_KG=73", "WEIGHT_UNLABELED=73"] });
c(HW, "cao 1m 73", { ents: ["HEIGHT_CM=173"], forbid: ["WEIGHT_KG=73", "TARGET_WEIGHT_KG=73"] });
c(HW, "chiều cao 1.73m", { ents: ["HEIGHT_CM=173"] });
c(HW, "173cm", { ents: ["HEIGHT_CM=173"] });
c(HW, "173 cm", { ents: ["HEIGHT_CM=173"] });
c(HW, "cao 173", { ents: ["HEIGHT_CM=173"] });
c(HW, "mình cao 1m8", { ents: ["HEIGHT_CM=180"] });
c(HW, "cao 1,75m", { ents: ["HEIGHT_CM=175"] });
c(HW, "cao 1m65 nặng 58kg", { ents: ["HEIGHT_CM=165", "WEIGHT_KG=58"], forbid: ["WEIGHT_KG=65", "TARGET_WEIGHT_KG=65"] });
c(HW, "nặng 80kg", { ents: ["WEIGHT_KG=80"] });
c(HW, "cân nặng hiện tại 82 ký", { ents: ["WEIGHT_KG=82"] });
c(HW, "tôi nặng 65.5kg", { ents: ["WEIGHT_KG=65.5"] });
c(HW, "1m73 80kg", { ents: ["HEIGHT_CM=173"], forbid: ["WEIGHT_KG=73", "TARGET_WEIGHT_KG=73"] });
c(HW, "80", { ents: ["WEIGHT_KG=80"] }, { slot: "currentWeightKg" });
c(HW, "72kg", { ents: ["TARGET_WEIGHT_KG=72"] }, { slot: "targetWeight" });
c(HW, "khoảng 75 kg", { ents: ["TARGET_WEIGHT_KG=75"] }, { slot: "targetWeight" });
c(HW, "tôi 22 tuổi", { ents: ["AGE=22"], forbid: ["WEIGHT_KG=22", "TARGET_WEIGHT_KG=22"] });
c(HW, "28 tuổi, nữ", { ents: ["AGE=28", "GENDER=FEMALE"] });
c(HW, "tôi là nam giới", { ents: ["GENDER=MALE"] });
c(HW, "mình là nữ", { ents: ["GENDER=FEMALE"] });
c(HW, "tôi tập được 3 năm rồi", { forbid: ["GENDER=MALE", "AGE=3", "WEIGHT_KG=3"], noEnt: true });
c(HW, "cao 1m73, nặng 80kg, 22 tuổi, nam", { ents: ["HEIGHT_CM=173", "WEIGHT_KG=80", "AGE=22", "GENDER=MALE"], forbid: ["WEIGHT_KG=73"] });
c(HW, "60 phút mỗi buổi", { ents: ["SESSION_MINUTES=60"], forbid: ["WEIGHT_KG=60", "TARGET_WEIGHT_KG=60"] });
c(HW, "1 tiếng rưỡi mỗi buổi thì hơi dài", { forbid: ["WEIGHT_KG=1"] });
c(HW, "tập 4 buổi một tuần", { ents: ["SESSIONS_PER_WEEK=4"], forbid: ["WEIGHT_KG=4"] });
c(HW, "5 buổi/tuần", { ents: ["SESSIONS_PER_WEEK=5"] });
c(HW, "ăn 4 bữa mỗi ngày", { ents: ["MEALS_PER_DAY=4"] });
c(HW, "ngân sách 2 triệu", { ents: ["BUDGET_VND=2000000"] });
c(HW, "khoảng 1.5tr", { ents: ["BUDGET_VND=1500000"] });
c(HW, "500k một buổi", { ents: ["BUDGET_VND=500000"] });

// ── target weight & roles ──
const TW = "target-weight";
c(TW, "mục tiêu 70kg", { ents: ["TARGET_WEIGHT_KG=70"] });
c(TW, "tôi muốn xuống 72kg", { ents: ["TARGET_WEIGHT_KG=72"] });
c(TW, "xuống 72 ký", { ents: ["TARGET_WEIGHT_KG=72"] });
c(TW, "mục tiêu 72 cân", { ents: ["TARGET_WEIGHT_KG=72"] });
c(TW, "muốn giảm còn 68kg", { ents: ["TARGET_WEIGHT_KG=68"] });
c(TW, "muốn lên 75kg", { ents: ["TARGET_WEIGHT_KG=75"] });
c(TW, "nặng 80kg, mục tiêu 72kg", { ents: ["WEIGHT_KG=80", "TARGET_WEIGHT_KG=72"] });
c(TW, "hiện 80kg muốn xuống 72kg", { ents: ["WEIGHT_KG=80", "TARGET_WEIGHT_KG=72"] });
c(TW, "toi 80kg cao 1m73 muon xuong 72", { ents: ["HEIGHT_CM=173", "WEIGHT_KG=80", "TARGET_WEIGHT_KG=72"], forbid: ["TARGET_WEIGHT_KG=73"] });
c(TW, "80 là cân hiện tại, 72 mới là mục tiêu", { ents: ["WEIGHT_KG=80", "TARGET_WEIGHT_KG=72"] });
c(TW, "1m73 là chiều cao chứ không phải cân nặng", { ents: ["HEIGHT_CM=173"], forbid: ["WEIGHT_KG=73", "TARGET_WEIGHT_KG=73"] });
c(TW, "với chiều cao 1m73 thì 80kg là đang khá mập rồi tôi muốn xuống 72kg là đẹp", { ents: ["HEIGHT_CM=173", "WEIGHT_KG=80", "TARGET_WEIGHT_KG=72"], forbid: ["TARGET_WEIGHT_KG=73", "WEIGHT_KG=73", "WEIGHT_UNLABELED=73"], goal: ["WEIGHT_LOSS:I"] }, { slot: "targetWeight" });
c(TW, "74kg", { ents: ["TARGET_WEIGHT_KG=74"] }, { slot: "targetWeight" });
c(TW, "70", { ents: ["TARGET_WEIGHT_KG=70"] }, { slot: "targetWeight" });
c(TW, "mục tiêu 72", { amb: true }, {});
c(TW, "mục tiêu 72", { ents: ["TARGET_WEIGHT_KG=72"], amb: false }, { slot: "targetWeight" });
c(TW, "mục tiêu 72", { ents: ["TARGET_WEIGHT_KG=72"], amb: false }, { cw: 80 });
c(TW, "tôi muốn còn 65", { ents: ["TARGET_WEIGHT_KG=65"] }, { slot: "targetWeight" });
c(TW, "nặng 80 muốn xuống 72", { ents: ["WEIGHT_KG=80", "TARGET_WEIGHT_KG=72"] });

// ── goal signals ──
const GS = "goal-signals";
c(GS, "tôi muốn giảm mỡ", { goal: ["WEIGHT_LOSS:E"] });
c(GS, "tôi muốn tăng cơ", { goal: ["MUSCLE_GAIN:E"] });
c(GS, "muốn duy trì vóc dáng", { goal: ["MAINTENANCE:E"] });
c(GS, "tôi muốn xuống cân", { goal: ["WEIGHT_LOSS:E"] });
c(GS, "muốn gọn hơn", { goal: ["WEIGHT_LOSS:E"] });
c(GS, "tôi đang khá mập", { goal: ["WEIGHT_LOSS:I"] });
c(GS, "muốn giảm mỡ nhưng giữ cơ", { goal: ["WEIGHT_LOSS:E"] });
c(GS, "t muốn lose fat nhưng giữ muscle", { goal: ["WEIGHT_LOSS:E"] });
c(GS, "muốn cut mấy tháng tới", { goal: ["WEIGHT_LOSS:E"] });
c(GS, "muốn bulk", { goal: ["MUSCLE_GAIN:E"] });
c(GS, "không cần tăng cân", { goal: ["MUSCLE_GAIN-"] });
c(GS, "tôi muốn cải thiện hiệu suất chạy bộ", { goal: ["ATHLETIC_PERFORMANCE:E"] });
c(GS, "giảm mỡ bụng", { goal: ["WEIGHT_LOSS:E"] });
c(GS, "muon giam mo", { goal: ["WEIGHT_LOSS:E"] });
c(GS, "muon tang co", { goal: ["MUSCLE_GAIN:E"] });
c(GS, "tôi thấy mình quá nặng", { goal: ["WEIGHT_LOSS:I"] });

// ── corrections ──
const CO = "corrections";
c(CO, "không phải 74, là 72", { intent: "CORRECT_INFORMATION", corr: ["TARGET_WEIGHT_KG>72"], forbid: ["TARGET_WEIGHT_KG=74"] }, { slot: "targetWeight" });
c(CO, "à không, tôi tập 5 buổi", { intent: "CORRECT_INFORMATION", corr: ["SESSIONS_PER_WEEK>5"] });
c(CO, "ngân sách lúc nãy sai, 2 triệu thôi", { intent: "CORRECT_INFORMATION", corr: ["BUDGET_VND>2000000"] });
c(CO, "không tăng cơ nữa, tôi muốn giảm mỡ", { intent: "CORRECT_INFORMATION", corr: ["GOAL>WEIGHT_LOSS"], goal: ["MUSCLE_GAIN-", "WEIGHT_LOSS:E"] });
c(CO, "thay vì 74 thì 72", { intent: "CORRECT_INFORMATION", corr: ["TARGET_WEIGHT_KG>72"] }, { slot: "targetWeight" });
c(CO, "à không, cân nặng của tôi là 78kg", { corr: ["WEIGHT_KG>78"] });
c(CO, "lúc nãy tôi nói sai, tôi cao 1m75", { corr: ["HEIGHT_CM>175"] });
c(CO, "tôi đổi ý, muốn giảm mỡ", { intent: "CORRECT_INFORMATION", corr: ["GOAL>WEIGHT_LOSS"] });
c(CO, "khoan, ăn 3 bữa thôi", { corr: ["MEALS_PER_DAY>3"] });
c(CO, "ý tôi là 60 phút mỗi buổi", { corr: ["SESSION_MINUTES>60"] });
c(CO, "nhầm rồi, tôi 25 tuổi", { corr: ["AGE>25"] });
c(CO, "thực ra tôi nặng 79kg", { corr: ["WEIGHT_KG>79"] });
c(CO, "sửa lại: mục tiêu 70kg", { corr: ["TARGET_WEIGHT_KG>70"] });
c(CO, "à không, tôi muốn tăng cơ chứ không giảm mỡ", { intent: "CORRECT_INFORMATION", corr: ["GOAL>MUSCLE_GAIN"] });

// ── contradiction vs correction distinctions ──
const CC = "contradiction-vs-correction";
c(CC, "tôi nặng 80kg nhưng mục tiêu là 72kg", { ents: ["WEIGHT_KG=80", "TARGET_WEIGHT_KG=72"], intent: "PROVIDE_INFORMATION" });
c(CC, "tôi nói 80 nhưng thật ra là 78", { intent: "CORRECT_INFORMATION", corr: ["WEIGHT_KG>78"] }, { slot: "currentWeightKg" });
c(CC, "trước tôi muốn tăng cơ, giờ muốn giảm mỡ", { goal: ["WEIGHT_LOSS:E"] });
c(CC, "80kg nhưng mong muốn 72kg", { ents: ["TARGET_WEIGHT_KG=72"] }, { cw: 80 });

// ── ask recommendation ──
const RC = "ask-recommendation";
c(RC, "ok hãy đề xuất cho tôi", { intent: "ASK_RECOMMENDATION", rec: true, noEnt: true }, { slot: "targetWeight" });
c(RC, "bạn chọn giúp tôi", { intent: "ASK_RECOMMENDATION", rec: true });
c(RC, "mức nào hợp lý?", { intent: "ASK_RECOMMENDATION", rec: true });
c(RC, "theo bạn nên bao nhiêu?", { intent: "ASK_RECOMMENDATION", rec: true });
c(RC, "tôi không biết nên đặt bao nhiêu", { intent: "ASK_RECOMMENDATION", rec: true });
c(RC, "bạn tự đề xuất đi", { intent: "ASK_RECOMMENDATION", rec: true });
c(RC, "ok đề xuất đi", { intent: "ASK_RECOMMENDATION", rec: true });
c(RC, "bạn thấy mục tiêu nào hợp với tôi?", { intent: "ASK_RECOMMENDATION", rec: true });
c(RC, "theo tình trạng của tôi thì nên cut hay bulk?", { intent: "ASK_RECOMMENDATION", rec: true });
c(RC, "tôi không biết nên tập mấy buổi", { intent: "ASK_RECOMMENDATION", rec: true });
c(RC, "bao nhiêu thì hợp lý", { intent: "ASK_RECOMMENDATION", rec: true });
c(RC, "gợi ý giúp mình mức cân nặng mục tiêu", { rec: true });
c(RC, "hãy tính giúp tôi", { rec: true });
c(RC, "bạn quyết giúp tôi đi", { rec: true });
c(RC, "tôi muốn xuống 72kg, bạn thấy có hợp lý không?", { ents: ["TARGET_WEIGHT_KG=72"] });

// ── multi-slot ──
const MS = "multi-slot";
c(MS, "Tôi cao 1m73, nặng 80kg, muốn xuống 72kg, tập 4 buổi một tuần, chỉ rảnh tối.", { ents: ["HEIGHT_CM=173", "WEIGHT_KG=80", "TARGET_WEIGHT_KG=72", "SESSIONS_PER_WEEK=4"], forbid: ["TARGET_WEIGHT_KG=73"] });
c(MS, "tôi 22 tuổi, cao 1m73, nặng 80kg, tôi là nam giới, mục tiêu của tôi là 70kg", { ents: ["AGE=22", "HEIGHT_CM=173", "WEIGHT_KG=80", "GENDER=MALE", "TARGET_WEIGHT_KG=70"], forbid: ["WEIGHT_KG=73"] });
c(MS, "nữ, 30 tuổi, 1m60, 55kg, muốn xuống 52kg", { ents: ["GENDER=FEMALE", "AGE=30", "HEIGHT_CM=160", "WEIGHT_KG=55", "TARGET_WEIGHT_KG=52"], forbid: ["WEIGHT_KG=60"] });
c(MS, "45 phút mỗi buổi, 3 buổi một tuần", { ents: ["SESSION_MINUTES=45", "SESSIONS_PER_WEEK=3"] });
c(MS, "4 bữa mỗi ngày, ngân sách 2 triệu", { ents: ["MEALS_PER_DAY=4", "BUDGET_VND=2000000"] });
c(MS, "cao 170 nặng 65 kg 25 tuổi", { ents: ["AGE=25", "WEIGHT_KG=65"] });
c(MS, "1m73 80kg 22 tuổi nam muốn xuống 72kg", { ents: ["HEIGHT_CM=173", "WEIGHT_KG=80", "AGE=22", "TARGET_WEIGHT_KG=72", "GENDER=MALE"], forbid: ["WEIGHT_KG=73"] });

// ── ambiguity ──
const AM = "ambiguity";
c(AM, "72", { amb: true });
c(AM, "80 và 72", { amb: true });
c(AM, "mục tiêu 72", { amb: true });
c(AM, "khoảng 70 gì đó", { amb: true });

// ── references ──
const RF = "references";
c(RF, "mức đó", { ref: "ACCEPT_PROPOSAL" });
c(RF, "dùng mức bạn đề xuất", { ref: "ACCEPT_PROPOSAL" });
c(RF, "72 đó", { ref: "ACCEPT_PROPOSAL" });
c(RF, "lấy mức thấp hơn", { ref: "LOWER_OPTION" });
c(RF, "lấy mức cao hơn", { ref: "HIGHER_OPTION" });
c(RF, "mức giữa", { ref: "MIDDLE_OPTION" });
c(RF, "chọn PT đầu tiên", { ref: "FIRST_ITEM" });
c(RF, "thuê người đó", { ref: "THIS_ITEM" });
c(RF, "lưu plan này", { ref: "THIS_ITEM" });
c(RF, "PT này", { ref: "THIS_ITEM" });
c(RF, "giữ cái cũ", { ref: "PREVIOUS_STATE" });
c(RF, "đổi cái vừa rồi còn 3 bữa", { ref: "PREVIOUS_STATE", ents: ["MEALS_PER_DAY=3"] });
c(RF, "dùng mức bạn đề xuất", { ref: "ACCEPT_PROPOSAL" }, { proposal: { field: "targetWeight", recommendedKg: 72, lowKg: 72, highKg: 76 } });

// ── negation ──
const NG = "negation";
c(NG, "tôi không muốn xuống 70", { neg: ["WEIGHT_UNLABELED=70"], forbid: ["TARGET_WEIGHT_KG=70"] });
c(NG, "không phải 72", { neg: ["WEIGHT_UNLABELED=72"], forbid: ["TARGET_WEIGHT_KG=72"] });
c(NG, "đừng đổi mục tiêu", { neg: ["GOAL"] });
c(NG, "không cần PT", { neg: ["ACTION"] });
c(NG, "không lưu", { neg: ["ACTION"] });
c(NG, "không phải 74 mà là 72", { corr: ["TARGET_WEIGHT_KG>72"], forbid: ["TARGET_WEIGHT_KG=74"] }, { slot: "targetWeight" });
c(NG, "không tăng cơ nữa", { goal: ["MUSCLE_GAIN-"] });

// ── workflow start ──
const WS = "workflow-start";
c(WS, "Tạo lộ trình giảm mỡ cho tôi", { wf: "CREATE_ROADMAP", goal: ["WEIGHT_LOSS:E"] });
c(WS, "hãy tạo lộ trình cho tôi", { wf: "CREATE_ROADMAP" });
c(WS, "Tạo lịch tập cho tôi", { wf: "CREATE_WORKOUT_PLAN" });
c(WS, "Tạo thực đơn cho tôi", { wf: "CREATE_NUTRITION_PLAN" });
c(WS, "Tìm PT phù hợp với tôi", { wf: "FIND_PT" });
c(WS, "Tìm chương trình tập phù hợp", { wf: "FIND_TRAINING_PROGRAM" });
c(WS, "Tạo lộ trình tăng cơ", { wf: "CREATE_ROADMAP", goal: ["MUSCLE_GAIN:E"] });
c(WS, "tạo lộ trình, tôi cao 1m73 nặng 80kg muốn xuống 72kg", { wf: "CREATE_ROADMAP", ents: ["HEIGHT_CM=173", "WEIGHT_KG=80", "TARGET_WEIGHT_KG=72"], forbid: ["TARGET_WEIGHT_KG=73"] });

// ── general Q&A must not start workflows ──
const QA = "general-qa";
c(QA, "Progressive overload là gì?", { intent: "ANSWER_QUESTION", noEnt: true });
c(QA, "Protein có vai trò gì?", { intent: "ANSWER_QUESTION" });
c(QA, "Squat có hại đầu gối không?", { intent: "ANSWER_QUESTION" });
c(QA, "Một ngày nên ăn bao nhiêu protein?", { intent: "ANSWER_QUESTION" });
c(QA, "Tập cardio trước hay sau tạ?", { intent: "ANSWER_QUESTION" });
c(QA, "Whey có bắt buộc không?", { intent: "ANSWER_QUESTION" });
c(QA, "Creatine có an toàn không?", { intent: "ANSWER_QUESTION" });
c(QA, "Nghỉ giữa các set bao lâu?", { intent: "ANSWER_QUESTION" });
c(QA, "Kế hoạch giảm cân trong 1 tuần có được không?", { intent: "ANSWER_QUESTION" });
c(QA, "Sao tập xong lại đau cơ?", { intent: "ANSWER_QUESTION" });

// ── typo / no-diacritic / mixed / slang ──
const NV = "natural-vietnamese";
c(NV, "toi cao 1m73 nang 80kg", { ents: ["HEIGHT_CM=173", "WEIGHT_KG=80"], forbid: ["WEIGHT_KG=73"] });
c(NV, "m cao 1m73 nặng 80 muốn cut", { ents: ["HEIGHT_CM=173", "WEIGHT_KG=80"], goal: ["WEIGHT_LOSS:E"], forbid: ["WEIGHT_KG=73"] });
c(NV, "tạo plan cho t 4 buổi, gym full máy", { ents: ["SESSIONS_PER_WEEK=4"] });
c(NV, "đổi còn 3 bữa thôi", { ents: ["MEALS_PER_DAY=3"] });
c(NV, "toi 22 tuoi nam cao 1m73", { ents: ["AGE=22", "GENDER=MALE", "HEIGHT_CM=173"] });
c(NV, "muon xuong 72kg thoi", { ents: ["TARGET_WEIGHT_KG=72"] });
c(NV, "nặng 80 ký muốn còn 72 ký", { ents: ["WEIGHT_KG=80", "TARGET_WEIGHT_KG=72"] });
c(NV, "hôm nay tôi 80kg", { ents: ["WEIGHT_KG=80"] });
c(NV, "tui cao 1m7 nặng 68kg", { ents: ["HEIGHT_CM=170", "WEIGHT_KG=68"] });
c(NV, "mình muốn lên cân, tăng cơ", { goal: ["MUSCLE_GAIN:E"] });
c(NV, "tập 3 buổi 1 tuần thôi nhé", { ents: ["SESSIONS_PER_WEEK=3"] });
c(NV, "budget 3tr", { ents: ["BUDGET_VND=3000000"] });

// ── confirmation / dismissal ──
const CD = "confirmation-dismissal";
c(CD, "xác nhận", { intent: "CONFIRM" });
c(CD, "đồng ý", { intent: "CONFIRM" });
c(CD, "bỏ qua bản này", { intent: "DISMISS" });
c(CD, "không lưu", { neg: ["ACTION"] });

// ── why ──
const WH = "why";
c(WH, "vì sao bạn đề xuất 72?", { why: true });
c(WH, "tại sao lại là mức đó?", { why: true });
c(WH, "sao phải đổi mục tiêu?", { why: true });
c(WH, "tại sao bạn nghĩ tôi nên giảm mỡ? nếu hợp lý thì đổi mục tiêu giúp tôi", { why: true });

// ── multi-intent / interruption ──
const MI = "interruption";
c(MI, "Thôi tôi thấy mình đang quá nặng, đổi sang giảm mỡ đi.", { goal: ["WEIGHT_LOSS:E"] });
c(MI, "khoan, cho tôi hỏi protein là gì?", { intent: "ANSWER_QUESTION" });
c(MI, "hôm nay tôi nên ăn tối đa bao nhiêu calo?", { intent: "ANSWER_QUESTION", noEnt: true });
c(MI, "Squat là gì? à mà tôi cao 1m73", { ents: ["HEIGHT_CM=173"], forbid: ["WEIGHT_KG=73"] });

fs.writeFileSync("test/conversational-intelligence/corpus.json", JSON.stringify(cases, null, 1));
console.log(`corpus.json: ${cases.length} cases in ${new Set(cases.map((x) => x.cat)).size} categories`);
