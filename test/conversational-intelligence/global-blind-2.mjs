// SECOND-GENERATION blind corpus for GLOBAL routing final stabilization (Phase G). Genuinely new sentences, not mechanical
// paraphrases of global-blind.json/global-holdout2.json. Written BEFORE any Phase G/H remediation; the first-pass result is
// frozen (results/global-blind-2-first-pass.json, never overwritten) and never used to hand-tune a single sentence.
import fs from "node:fs";
const cases = [];
let n = 0;
const c = (cat, text, exp, ctx = {}) => cases.push({ id: `GB2-${String(++n).padStart(3, "0")}`, cat, text, exp, ctx });
const PT = { wf: "FIND_PT", slot: "budgetVnd" };
const WK = { wf: "CREATE_WORKOUT_PLAN", slot: "daysPerWeek" };
const RM = { wf: "CREATE_ROADMAP", slot: "targetWeight" };
const NU = { wf: "CREATE_NUTRITION_PLAN", slot: "mealsPerDay" };
const PROG = { wf: "FIND_TRAINING_PROGRAM", slot: "days" };

// ── standalone READ ──
const R = "standalone-read";
c(R, "Giờ tôi có huấn luyện viên nào theo không?", { route: "READ_STATE", topic: "PT_STATUS" });
c(R, "Dạo này hệ thống đang ghi cân nặng tôi bao nhiêu?", { route: "READ_STATE", topic: "PROFILE_FACT" });
c(R, "Người hướng dẫn tôi chọn lúc nãy đang ở trạng thái gì?", { route: "READ_STATE", topic: "CONTRACT_STATUS" });
c(R, "Cái plan tôi đang theo là plan nào?", { route: "READ_STATE", topic: "PROGRAM_STATUS" });
c(R, "Số calo mỗi ngày Gymini đang tính cho tôi là bao nhiêu vậy?", { route: "READ_STATE", topic: "NUTRITION_TARGET" });
c(R, "Thực đơn tôi lưu gần nhất tên gì?", { route: "READ_STATE", topic: "NUTRITION_PROGRAM" });
c(R, "Trên hệ thống mục tiêu tập luyện của tôi đang để là gì?", { route: "READ_STATE", topic: "GOAL" });
c(R, "Buổi tập sáng nay theo lịch là bài gì?", { route: "READ_STATE", topic: "SCHEDULE" });
c(R, "Tuần sau lịch của tôi sắp xếp thế nào?", { route: "READ_STATE", topic: "SCHEDULE" });
c(R, "Tôi ký hợp đồng với PT nào rồi nhỉ?", { route: "READ_STATE", topic: "PT_STATUS" });
c(R, "Có hợp đồng huấn luyện nào của tôi còn giá trị không?", { route: "READ_STATE", topic: "CONTRACT_STATUS" });
c(R, "Trọng lượng cơ thể tôi ghi nhận lần cuối là bao nhiêu?", { route: "READ_STATE", topic: "PROFILE_FACT" });
c(R, "Tôi để chiều cao bao nhiêu trong hồ sơ nhỉ?", { route: "READ_STATE", topic: "PROFILE_FACT" });
c(R, "Đạm mỗi ngày hệ thống đang khuyến nghị cho tôi là bao nhiêu gram?", { route: "READ_STATE", topic: "NUTRITION_TARGET" });
c(R, "Am I currently working with any trainer?", { route: "READ_STATE", topic: "PT_STATUS" });
c(R, "What program am I currently following?", { route: "READ_STATE", topic: "PROGRAM_STATUS" });
c(R, "toi dang dung goi tap nao vay", { route: "READ_STATE", topic: "PROGRAM_STATUS" });
c(R, "hlv cua toi ten gi", { route: "READ_STATE", topic: "PT_STATUS" });
c(R, "gio la muc tieu can nang cua toi bao nhieu", { route: "READ_STATE", topic: "PROFILE_FACT" });
c(R, "tuoi toi luu trong ho so la bao nhieu", { route: "READ_STATE", topic: "PROFILE_FACT" });

// ── READ vs FIND (must never restart a search) ──
const RF = "read-vs-find";
c(RF, "Tôi đã ký hợp đồng với ai chưa hay vẫn chưa có?", { route: "READ_STATE", topic: "PT_STATUS" });
c(RF, "Trước khi tìm PT mới, cho tôi biết tôi đang có PT không đã", { route: "READ_STATE", topic: "PT_STATUS" });
c(RF, "Đừng tìm chương trình mới, tôi chỉ muốn biết đang theo cái nào", { route: "READ_STATE", topic: "PROGRAM_STATUS" });
c(RF, "Tôi từng đăng ký gói huấn luyện nào chưa vậy?", { route: "READ_STATE", topic: "CONTRACT_STATUS" });
c(RF, "Không cần gợi ý PT mới đâu, ai đang huấn luyện tôi vậy?", { route: "READ_STATE", topic: "PT_STATUS" });
c(RF, "Tìm PT phù hợp với thể trạng của tôi giúp mình.", { route: "START_WORKFLOW", wf: "FIND_PT" });
c(RF, "Lọc giúp tôi vài chương trình tập phù hợp.", { route: "START_WORKFLOW", wf: "FIND_TRAINING_PROGRAM" });
c(RF, "Chọn giúp tôi một huấn luyện viên phù hợp.", { route: "RECOMMEND", topic: "PT" });

// ── READ vs RECOMMEND ──
const RR = "read-vs-recommend";
c(RR, "Nếu theo tình trạng của tôi thì nên siết hay tăng?", { route: "RECOMMEND", topic: "GOAL" });
c(RR, "Mục tiêu hiện tại tôi đang để trên hệ thống là gì?", { route: "READ_STATE", topic: "GOAL" });
c(RR, "Nhìn số liệu của tôi, bạn thấy nên đi hướng nào?", { route: "RECOMMEND", topic: "GOAL" });
c(RR, "Chỉ số dinh dưỡng hiện tại của tôi đang set ở đâu?", { route: "READ_STATE", topic: "NUTRITION_TARGET" });
c(RR, "Theo bạn thì tôi cần bao nhiêu protein mỗi ngày là vừa?", { route: "RECOMMEND", topic: "MEALS" });
c(RR, "Tôi có cần đổi huấn luyện viên không nhỉ?", { route: "RECOMMEND", topic: "HIRE_PT" });
c(RR, "Tần suất tập hiện tại tôi đang để mấy buổi vậy?", { route: "READ_STATE", topic: "PROGRAM_STATUS" });
c(RR, "Theo dữ liệu của tôi thì tập mấy buổi là hợp lý?", { route: "RECOMMEND", topic: "SESSIONS" });

// ── general knowledge Q&A ──
const Q = "general-qa";
c(Q, "Cho hỏi ké, protein có tác dụng gì?", { route: "KNOWLEDGE_QA" });
c(Q, "RIR nghĩa là sao vậy mọi người?", { route: "KNOWLEDGE_QA" });
c(Q, "Tại sao tập nặng lại cần ngủ đủ giấc?", { route: "KNOWLEDGE_QA" });
c(Q, "Deload week là như thế nào?", { route: "KNOWLEDGE_QA" });
c(Q, "Ăn trước hay sau khi tập thì tốt hơn?", { route: "KNOWLEDGE_QA" });
c(Q, "Vì sao nhiều người bị đau lưng khi deadlift sai form?", { route: "KNOWLEDGE_QA" });
c(Q, "Creatine dùng lâu dài có hại thận không?", { route: "KNOWLEDGE_QA" });
c(Q, "Sự khác nhau giữa tạ tự do và máy tập là gì?", { route: "KNOWLEDGE_QA" });
c(Q, "Một chu kỳ giảm mỡ nên kéo dài bao lâu?", { route: "KNOWLEDGE_QA" });
c(Q, "why does progressive overload matter", { route: "KNOWLEDGE_QA" });
c(Q, "tai sao phai khoi dong truoc khi tap", { route: "KNOWLEDGE_QA" });

// ── personalized Q&A ──
const P = "personalized-qa";
c(P, "Với chiều cao và cân nặng hiện tại, tôi có đang thừa cân không?", { route: "READ_STATE", topic: "PROFILE_FACT" });
c(P, "Lịch trống của tôi hôm nay có buổi tập nào không?", { route: "READ_STATE", topic: "SCHEDULE" });
c(P, "Xem giúp tôi đang follow gói ăn nào.", { route: "READ_STATE", topic: "NUTRITION_PROGRAM" });
c(P, "Kiểm tra giúp tôi hợp đồng PT còn hạn không.", { route: "READ_STATE", topic: "CONTRACT_STATUS" });
c(P, "Show tôi cân nặng mục tiêu đang lưu trong hệ thống.", { route: "READ_STATE", topic: "PROFILE_FACT" });

// ── recommendation requests ──
const RC = "recommendation-request";
c(RC, "Tôi không biết nên đặt mục tiêu cân nặng bao nhiêu, bạn tư vấn giúp.", { route: "RECOMMEND", topic: "TARGET_WEIGHT" });
c(RC, "Cho tôi lời khuyên xem có nên thuê PT lúc này không.", { route: "RECOMMEND", topic: "HIRE_PT" });
c(RC, "Bạn nghĩ chương trình nào hợp với người mới như tôi?", { route: "RECOMMEND", topic: "PROGRAM" });
c(RC, "Tôi phân vân giữa siết cân với tăng cơ, bạn thấy sao?", { route: "RECOMMEND", topic: "GOAL" });
c(RC, "Ăn bao nhiêu bữa một ngày thì vừa sức với tôi?", { route: "RECOMMEND", topic: "MEALS" });

// ── corrections ──
const CO = "correction";
c(CO, "à khoan, tôi nói nhầm, phải là 3 buổi", { route: "CORRECTION" }, { active: WK });
c(CO, "ý tôi là ngân sách 5 triệu chứ không phải 2", { route: "CORRECTION" }, { active: PT });
c(CO, "sửa lại giúp mình: mục tiêu 65kg", { route: "CORRECTION" }, { active: RM });
c(CO, "không phải vậy đâu, tôi ăn 5 bữa mới đúng", { route: "CORRECTION" }, { active: NU });
c(CO, "thật ra tôi 26 tuổi chứ không phải 28", { route: "CORRECTION" }, { active: RM });
c(CO, "đổi lại thành thứ 2 4 6 giúp mình", { route: "CORRECTION" }, { active: PROG });

// ── negations ──
const NG = "negation";
c(NG, "Tôi muốn nghe lời khuyên thôi, chưa cần thay đổi gì.", { route: "RECOMMEND", topic: "GOAL" });
c(NG, "Nếu thấy hợp thì đề xuất, đừng lưu vội.", { route: "RECOMMEND", topic: "GOAL" });
c(NG, "Đừng thuê PT giúp tôi, tôi tự cân nhắc trước đã.", { route: "NEGATE_ACTION" });
c(NG, "Khoan hãy đổi mục tiêu, để tôi suy nghĩ thêm.", { route: "NEGATE_ACTION" });
c(NG, "Tôi chưa muốn lưu thực đơn này đâu.", { route: "NEGATE_ACTION" }, { proposal: true });

// ── references ──
const REF = "reference";
c(REF, "Giải thích trước rồi tôi mới quyết định.", { route: "EXPLAIN_AND_PROPOSE" });
c(REF, "Cứ theo mức bạn vừa gợi ý đi.", { route: "REFERENCE" }, { proposal: true });
c(REF, "Chốt theo cái đề xuất lúc nãy giúp mình.", { route: "REFERENCE" }, { proposal: true });
c(REF, "Người bạn nhắc ở trên đó, thuê giúp mình.", { route: "WRITE_ACTION" }, { proposal: true });
c(REF, "Giữ nguyên phương án cũ, đừng đổi.", { route: "REFERENCE" }, { proposal: true });

// ── multi-intent ──
const M = "multi-intent";
c(M, "Người hướng dẫn tôi chọn lúc nãy đang ở trạng thái gì, và nếu chưa xong thì tìm giúp tôi người khác?", { route: "MULTI", multi: ["READ_STATE", "START_WORKFLOW"] });
c(M, "Cho tôi biết mục tiêu dinh dưỡng hiện tại, rồi nói xem có hợp với thể trạng tôi không.", { route: "MULTI", multi: ["READ_STATE", "RECOMMEND"] });
c(M, "Trước tiên giải thích RIR là gì, sau đó tạo lịch tập giúp tôi.", { route: "MULTI", multi: ["KNOWLEDGE_QA", "START_WORKFLOW"] });
c(M, "Xem giúp tôi lịch hôm nay, rồi tìm một huấn luyện viên phù hợp.", { route: "MULTI", multi: ["READ_STATE", "START_WORKFLOW"] });

// ── workflow interruption ──
const I = "interruption";
c(I, "Khoan chuyện PT đã, hiện tôi ăn mục tiêu bao nhiêu calo?", { route: "READ_STATE", topic: "NUTRITION_TARGET", interrupts: true }, { active: PT });
c(I, "Trước khi trả lời, cho hỏi progressive overload là gì?", { route: "KNOWLEDGE_QA", interrupts: true }, { active: WK });
c(I, "Nhân tiện, tôi có đang theo thực đơn nào không?", { route: "READ_STATE", topic: "NUTRITION_PROGRAM", interrupts: true }, { active: RM });
c(I, "3 triệu", { route: "SLOT_ANSWER" }, { active: PT });
c(I, "5 buổi mỗi tuần", { route: "SLOT_ANSWER" }, { active: WK });
c(I, "thứ hai, thứ tư, thứ sáu", { route: "SLOT_ANSWER" }, { active: PROG });
c(I, "Mục tiêu hiện tại của tôi đang lưu là gì vậy?", { route: "READ_STATE", topic: "GOAL", interrupts: true }, { active: NU });
c(I, "không giới hạn ngân sách", { route: "SLOT_ANSWER" }, { active: PT });
c(I, "Tiện thể, hợp đồng PT của tôi còn hạn không?", { route: "READ_STATE", topic: "CONTRACT_STATUS", interrupts: true }, { active: WK });

// ── workflow switching ──
const SW = "workflow-switch";
c(SW, "Thôi khoan tìm PT, tạo thực đơn cho tôi trước đi", { route: "SWITCH_WORKFLOW", wf: "CREATE_NUTRITION_PLAN" }, { active: PT });
c(SW, "Đổi ý rồi, lập lộ trình cho tôi trước đã", { route: "SWITCH_WORKFLOW", wf: "CREATE_ROADMAP" }, { active: WK });
c(SW, "thôi không cần nữa", { route: "CANCEL" }, { active: NU });
c(SW, "dừng lại giúp mình", { route: "CANCEL" }, { active: PT });
c(SW, "hủy yêu cầu này đi", { route: "CANCEL" }, { active: RM });

// ── confirmation / dismissal ──
const CD = "confirmation-dismissal";
c(CD, "đồng ý, chốt vậy đi", { route: "CONFIRM" });
c(CD, "xác nhận luôn", { route: "CONFIRM" });
c(CD, "bỏ qua bản nháp này", { route: "DISMISS" });
c(CD, "thôi bỏ qua đi", { route: "DISMISS" });

// ── casual / no-diacritic / mixed ──
const CV = "casual-vietnamese";
c(CV, "gio minh co huan luyen vien chua ta", { route: "READ_STATE", topic: "PT_STATUS" });
c(CV, "check giup t lich hom nay", { route: "READ_STATE", topic: "SCHEDULE" });
c(CV, "plan hien tai cua m la gi vay", { route: "READ_STATE", topic: "PROGRAM_STATUS" });
c(CV, "t nen cut hay bulk day", { route: "RECOMMEND", topic: "GOAL" });
c(CV, "cho e hoi protein la gi ạ", { route: "KNOWLEDGE_QA" });
c(CV, "mình đang dùng gói pt nào ấy nhỉ", { route: "READ_STATE", topic: "PT_STATUS" });
c(CV, "so far minh dang theo goal nao", { route: "READ_STATE", topic: "GOAL" });

// ── typos / indirect phrasing ──
const TY = "typo-indirect";
c(TY, "toi dg co hlv khong ta", { route: "READ_STATE", topic: "PT_STATUS" });
c(TY, "cho minh xin thong tin lich tap tuan nay voi", { route: "READ_STATE", topic: "SCHEDULE" });
c(TY, "khong biet chuong trinh minh dang theo la gi nua", { route: "READ_STATE", topic: "PROGRAM_STATUS" });
c(TY, "minh hoi kieu la calo muc tieu cua minh dg la bnhieu", { route: "READ_STATE", topic: "NUTRITION_TARGET" });

// ── long sentences ──
const LS = "long-sentence";
c(LS, "Dạo gần đây tôi khá bận nên chưa để ý lắm, không biết là hệ thống hiện đang ghi nhận tôi có huấn luyện viên riêng nào đồng hành hay chưa nhỉ?", { route: "READ_STATE", topic: "PT_STATUS" });
c(LS, "Tôi đang cân nhắc xem có nên tiếp tục với mục tiêu tăng cơ hiện tại hay chuyển hướng sang giảm mỡ, dựa trên tình trạng cơ thể của tôi lúc này thì bạn nghĩ sao?", { route: "RECOMMEND", topic: "GOAL" });
c(LS, "Trước khi quyết định có nên đổi chương trình tập hay không, tôi muốn biết là hiện tại mình đang theo chương trình cụ thể nào đã.", { route: "READ_STATE", topic: "PROGRAM_STATUS" });

// ── short ambiguous sentences (should clarify, not misfire into a write/search) ──
const SA = "short-ambiguous";
c(SA, "hiện tại?", { route: "UNKNOWN" });
c(SA, "vậy à", { route: "UNKNOWN" });
c(SA, "được không", { route: "UNKNOWN" });

// ── write actions (must always stay a proposal) ──
const W = "write-action";
c(W, "Cập nhật giúp tôi mục tiêu thành duy trì cân nặng.", { route: "WRITE_ACTION", topic: "GOAL_CHANGE" });
c(W, "Chuyển mục tiêu của tôi sang tăng cơ luôn đi.", { route: "WRITE_ACTION", topic: "GOAL_CHANGE" });
c(W, "Thuê giúp tôi huấn luyện viên thứ hai trong danh sách.", { route: "WRITE_ACTION" }, { proposal: true });
c(W, "Lưu chương trình này lại cho tôi.", { route: "WRITE_ACTION" }, { proposal: true });

// ── workflow start ──
const S = "workflow-start";
c(S, "Soạn giúp tôi một lộ trình tập trong 3 tháng.", { route: "START_WORKFLOW", wf: "CREATE_ROADMAP" });
c(S, "Lên giúp tôi thực đơn ăn kiêng.", { route: "START_WORKFLOW", wf: "CREATE_NUTRITION_PLAN" });
c(S, "Xếp lịch tập 5 buổi mỗi tuần cho tôi.", { route: "START_WORKFLOW", wf: "CREATE_WORKOUT_PLAN" });
c(S, "Tìm giúp tôi vài huấn luyện viên ở khu vực gần đây.", { route: "START_WORKFLOW", wf: "FIND_PT" });
c(S, "Kiếm giúp tôi chương trình tập phù hợp với người mới.", { route: "START_WORKFLOW", wf: "FIND_TRAINING_PROGRAM" });

// ── extra standalone READ (round 2, deliberately varied phrasing) ──
c(R, "Trạng thái hợp đồng huấn luyện của tôi bây giờ ra sao?", { route: "READ_STATE", topic: "CONTRACT_STATUS" });
c(R, "Chiều nay lịch tập của tôi có gì không?", { route: "READ_STATE", topic: "SCHEDULE" });
c(R, "Bao nhiêu gram carb mỗi ngày đang là mục tiêu của tôi?", { route: "READ_STATE", topic: "NUTRITION_TARGET" });
c(R, "Thực đơn hiện hành của tôi đang áp dụng là cái nào?", { route: "READ_STATE", topic: "NUTRITION_PROGRAM" });
c(R, "Số tuổi tôi khai trong hồ sơ hiện là bao nhiêu?", { route: "READ_STATE", topic: "PROFILE_FACT" });
c(R, "Tôi đang nặng bao nhiêu theo dữ liệu mới nhất?", { route: "READ_STATE", topic: "PROFILE_FACT" });
c(R, "Which trainer am I currently signed with?", { route: "READ_STATE", topic: "PT_STATUS" });
c(R, "What's my target weight saved as?", { route: "READ_STATE", topic: "PROFILE_FACT" });
c(R, "hom nay minh co lich tap gi khong", { route: "READ_STATE", topic: "SCHEDULE" });
c(R, "goi dinh duong minh dang theo la goi nao", { route: "READ_STATE", topic: "NUTRITION_PROGRAM" });

// ── extra recommendation ──
c(RC, "Tôi nên chọn mức cân nặng mục tiêu nào cho phù hợp?", { route: "RECOMMEND", topic: "TARGET_WEIGHT" });
c(RC, "Có nên tìm huấn luyện viên riêng vào lúc này không?", { route: "RECOMMEND", topic: "HIRE_PT" });
c(RC, "Tập bao nhiêu buổi mỗi tuần là hợp với tôi?", { route: "RECOMMEND", topic: "SESSIONS" });
c(RC, "Should I bulk or cut given my current stats?", { route: "RECOMMEND", topic: "GOAL" });
c(RC, "Chương trình tập nào sẽ hợp với người mới bắt đầu như tôi?", { route: "RECOMMEND", topic: "PROGRAM" });

// ── extra general Q&A ──
c(Q, "Tại sao phải tăng dần khối lượng tạ theo thời gian?", { route: "KNOWLEDGE_QA" });
c(Q, "Ăn nhiều bữa nhỏ có tốt hơn ba bữa lớn không?", { route: "KNOWLEDGE_QA" });
c(Q, "Superset là gì vậy?", { route: "KNOWLEDGE_QA" });
c(Q, "Tại sao càng tập lâu năm càng khó tăng cơ?", { route: "KNOWLEDGE_QA" });
c(Q, "what is a deload week", { route: "KNOWLEDGE_QA" });

// ── extra interruption ──
c(I, "Tiện thể cho hỏi, mục tiêu calo hiện tại của tôi bao nhiêu?", { route: "READ_STATE", topic: "NUTRITION_TARGET", interrupts: true }, { active: WK });
c(I, "Khoan đã, protein có tác dụng gì trong việc tăng cơ?", { route: "KNOWLEDGE_QA", interrupts: true }, { active: PT });
c(I, "6 buổi", { route: "SLOT_ANSWER" }, { active: WK });
c(I, "1.5 triệu thôi", { route: "SLOT_ANSWER" }, { active: PT });

// ── extra casual/no-diacritic ──
c(CV, "hop dong pt cua t con han khong", { route: "READ_STATE", topic: "CONTRACT_STATUS" });
c(CV, "muc tieu dinh duong hien tai la bnhieu calo", { route: "READ_STATE", topic: "NUTRITION_TARGET" });
c(CV, "e nen tap bao nhieu buoi 1 tuan a", { route: "RECOMMEND", topic: "SESSIONS" });
c(CV, "recommend giup m 1 chuong trinh tap voi", { route: "RECOMMEND", topic: "PROGRAM" });

// ── extra long sentences ──
c(LS, "Vì công việc dạo này khá bận rộn nên tôi không theo dõi kỹ, không rõ hiện tại thực đơn tôi đang áp dụng có phải bản mới nhất mình từng lưu hay không?", { route: "READ_STATE", topic: "NUTRITION_PROGRAM" });
c(LS, "Tôi vừa đọc được vài thông tin về deload week nhưng chưa hiểu rõ lắm, không biết là nó hoạt động như thế nào trong một chu kỳ tập luyện dài hạn?", { route: "KNOWLEDGE_QA" });

// ── extra workflow start ──
c(S, "Giúp tôi dựng một chương trình tập tạ cho người mới.", { route: "START_WORKFLOW", wf: "CREATE_WORKOUT_PLAN" });
c(S, "Build a nutrition plan for me please.", { route: "START_WORKFLOW", wf: "CREATE_NUTRITION_PLAN" });

// ── extra corrections ──
c(CO, "khoan, tôi 68kg chứ không phải 70", { route: "CORRECTION" }, { active: RM });
c(CO, "nhầm rồi, ngân sách của tôi là 1 triệu thôi", { route: "CORRECTION" }, { active: PT });
c(CO, "à không, mình ăn 4 bữa mới đúng", { route: "CORRECTION" }, { active: NU });
c(CO, "sai rồi, phải là 5 buổi mỗi tuần", { route: "CORRECTION" }, { active: WK });
c(CO, "thực ra tôi tập được thứ 2 4 6 thôi", { route: "CORRECTION" }, { active: PROG });

// ── extra references ──
c(REF, "Ừ dùng luôn mức đó cho tôi.", { route: "REFERENCE" }, { proposal: true });
c(REF, "Cứ để như cũ, không cần đổi.", { route: "REFERENCE" }, { proposal: true });
c(REF, "Lấy phương án đầu tiên giúp tôi.", { route: "WRITE_ACTION" }, { proposal: true });
c(REF, "Đồng ý theo gợi ý bạn vừa đưa ra.", { route: "REFERENCE" }, { proposal: true });

// ── extra negation ──
c(NG, "Tôi không cần đổi chương trình đâu, cứ để vậy.", { route: "NEGATE_ACTION" });
c(NG, "Không cần tìm huấn luyện viên nữa, tôi tự tập.", { route: "NEGATE_ACTION" });
c(NG, "Chưa cần lưu gì cả, để tôi xem thêm đã.", { route: "NEGATE_ACTION" }, { proposal: true });

// ── extra confirmation/dismissal ──
c(CD, "được rồi, chốt luôn", { route: "CONFIRM" });
c(CD, "ok tôi đồng ý", { route: "CONFIRM" });
c(CD, "không dùng bản này", { route: "DISMISS" });
c(CD, "bỏ bản nháp đi", { route: "DISMISS" });

// ── extra workflow switch/cancel ──
c(SW, "Khoan, để tôi tìm chương trình tập trước đã", { route: "SWITCH_WORKFLOW", wf: "FIND_TRAINING_PROGRAM" }, { active: PT });
c(SW, "Thôi dẹp qua một bên, không cần làm nữa", { route: "CANCEL" }, { active: WK });
c(SW, "huỷ giúp tôi cái này", { route: "CANCEL" }, { active: NU });

// ── extra short-ambiguous ──
c(SA, "ừ", { route: "UNKNOWN" });
c(SA, "thế à", { route: "UNKNOWN" });
c(SA, "ok vậy", { route: "UNKNOWN" });
c(SA, "không rõ nữa", { route: "UNKNOWN" });

// ── extra typo/indirect ──
c(TY, "co ai dang huan luyen cho toi khong ta", { route: "READ_STATE", topic: "PT_STATUS" });
c(TY, "khong biet muc tieu dinh duong minh dang la bnhieu", { route: "READ_STATE", topic: "NUTRITION_TARGET" });
c(TY, "minh nen tang hay giam day ta", { route: "RECOMMEND", topic: "GOAL" });
c(TY, "cho minh hoi la protein co quan trong khong", { route: "KNOWLEDGE_QA" });

// ── extra write-actions ──
c(W, "Đổi giúp tôi mục tiêu sang hiệu suất thể thao.", { route: "WRITE_ACTION", topic: "GOAL_CHANGE" });
c(W, "Cập nhật cân nặng mục tiêu thành 75kg giúp tôi.", { route: "WRITE_ACTION", topic: "GOAL_CHANGE" });
c(W, "Chọn PT đầu tiên trong danh sách giúp tôi.", { route: "WRITE_ACTION" }, { proposal: true });

// ── extra workflow start ──
c(S, "Tạo giúp tôi lịch ăn cho cả tuần.", { route: "START_WORKFLOW", wf: "CREATE_NUTRITION_PLAN" });
c(S, "Xây một lộ trình giảm mỡ dài hạn cho tôi.", { route: "START_WORKFLOW", wf: "CREATE_ROADMAP" });
c(S, "Find me a suitable personal trainer.", { route: "START_WORKFLOW", wf: "FIND_PT" });

// ── extra read-vs-find/recommend ──
c(RF, "Trước khi tìm gói tập mới, tôi đang dùng gói nào vậy?", { route: "READ_STATE", topic: "PROGRAM_STATUS" });
c(RF, "Không cần đề xuất PT nữa, hợp đồng hiện tại của tôi ra sao rồi?", { route: "READ_STATE", topic: "CONTRACT_STATUS" });
c(RR, "Số liệu hiện tại của tôi đang lưu là gì, và có nên đổi mục tiêu không?", { route: "MULTI", multi: ["READ_STATE", "RECOMMEND"] });

// ── round 3: final top-up to reach the 200+ minimum, still genuinely new phrasing per category ──
c(R, "Coach hiện tại của tôi trên hệ thống là ai vậy?", { route: "READ_STATE", topic: "PT_STATUS" });
c(R, "Ngày mai theo lịch tôi có buổi tập nào không?", { route: "READ_STATE", topic: "SCHEDULE" });
c(R, "Béo mỗi ngày hệ thống đang giới hạn cho tôi bao nhiêu gram?", { route: "READ_STATE", topic: "NUTRITION_TARGET" });
c(RC, "Bạn thấy tôi có nên đổi sang tập nặng hơn không?", { route: "RECOMMEND", topic: "SESSIONS" });
c(Q, "Nghỉ giữa các hiệp bao lâu là hợp lý?", { route: "KNOWLEDGE_QA" });
c(Q, "Tại sao ăn đủ nước lại quan trọng khi tập gym?", { route: "KNOWLEDGE_QA" });
c(I, "Nhân tiện, tôi đang theo chương trình tập nào vậy?", { route: "READ_STATE", topic: "PROGRAM_STATUS", interrupts: true }, { active: PT });
c(I, "2 bữa thôi", { route: "SLOT_ANSWER" }, { active: NU });
c(CV, "minh co dang ky goi pt nao chua ta", { route: "READ_STATE", topic: "CONTRACT_STATUS" });
c(CV, "lich tap ngay mai co gi khong ta", { route: "READ_STATE", topic: "SCHEDULE" });
c(CO, "khoan đã, đúng ra tôi muốn 4 bữa", { route: "CORRECTION" }, { active: NU });
c(LS, "Tôi đang phân vân không biết có nên tiếp tục thuê huấn luyện viên hiện tại hay không, dựa trên tiến độ tập luyện gần đây của mình thì bạn thấy thế nào?", { route: "RECOMMEND", topic: "HIRE_PT" });
c(S, "Lên kế hoạch tập gym 4 buổi mỗi tuần cho tôi.", { route: "START_WORKFLOW", wf: "CREATE_WORKOUT_PLAN" });
c(W, "Chuyển mục tiêu chính sang giảm mỡ giúp tôi.", { route: "WRITE_ACTION", topic: "GOAL_CHANGE" });
c(SA, "hmm", { route: "UNKNOWN" });

fs.writeFileSync("test/conversational-intelligence/global-blind-2.json", JSON.stringify(cases, null, 1));
console.log(`global-blind-2.json: ${cases.length} cases in ${new Set(cases.map((x) => x.cat)).size} categories`);
