| id | input | got | expected | ok |
|---|---|---|---|---|
| GB2-001 | Giờ tôi có huấn luyện viên nào theo không? | READ_STATE(PT_STATUS) | READ_STATE(PT_STATUS) | ✅ |
| GB2-002 | Dạo này hệ thống đang ghi cân nặng tôi bao nhiêu? | READ_STATE(PROFILE_FACT) | READ_STATE(PROFILE_FACT) | ✅ |
| GB2-003 | Người hướng dẫn tôi chọn lúc nãy đang ở trạng thái gì? | UNKNOWN | READ_STATE(CONTRACT_STATUS) | ❌ |
| GB2-004 | Cái plan tôi đang theo là plan nào? | UNKNOWN | READ_STATE(PROGRAM_STATUS) | ❌ |
| GB2-005 | Số calo mỗi ngày Gymini đang tính cho tôi là bao nhiêu vậy? | READ_STATE(NUTRITION_TARGET) | READ_STATE(NUTRITION_TARGET) | ✅ |
| GB2-006 | Thực đơn tôi lưu gần nhất tên gì? | READ_STATE(NUTRITION_PROGRAM) | READ_STATE(NUTRITION_PROGRAM) | ✅ |
| GB2-007 | Trên hệ thống mục tiêu tập luyện của tôi đang để là gì? | READ_STATE(GOAL) | READ_STATE(GOAL) | ✅ |
| GB2-008 | Buổi tập sáng nay theo lịch là bài gì? | KNOWLEDGE_QA | READ_STATE(SCHEDULE) | ❌ |
| GB2-009 | Tuần sau lịch của tôi sắp xếp thế nào? | KNOWLEDGE_QA | READ_STATE(SCHEDULE) | ❌ |
| GB2-010 | Tôi ký hợp đồng với PT nào rồi nhỉ? | MULTI | READ_STATE(PT_STATUS) | ❌ |
| GB2-011 | Có hợp đồng huấn luyện nào của tôi còn giá trị không? | READ_STATE(CONTRACT_STATUS) | READ_STATE(CONTRACT_STATUS) | ✅ |
| GB2-012 | Trọng lượng cơ thể tôi ghi nhận lần cuối là bao nhiêu? | UNKNOWN | READ_STATE(PROFILE_FACT) | ❌ |
| GB2-013 | Tôi để chiều cao bao nhiêu trong hồ sơ nhỉ? | READ_STATE(PROFILE_FACT) | READ_STATE(PROFILE_FACT) | ✅ |
| GB2-014 | Đạm mỗi ngày hệ thống đang khuyến nghị cho tôi là bao nhiêu gram? | UNKNOWN | READ_STATE(NUTRITION_TARGET) | ❌ |
| GB2-015 | Am I currently working with any trainer? | UNKNOWN | READ_STATE(PT_STATUS) | ❌ |
| GB2-016 | What program am I currently following? | READ_STATE(PROGRAM_STATUS) | READ_STATE(PROGRAM_STATUS) | ✅ |
| GB2-017 | toi dang dung goi tap nao vay | UNKNOWN | READ_STATE(PROGRAM_STATUS) | ❌ |
| GB2-018 | hlv cua toi ten gi | READ_STATE(PT_STATUS) | READ_STATE(PT_STATUS) | ✅ |
| GB2-019 | gio la muc tieu can nang cua toi bao nhieu | READ_STATE(PROFILE_FACT) | READ_STATE(PROFILE_FACT) | ✅ |
| GB2-020 | tuoi toi luu trong ho so la bao nhieu | READ_STATE(PROFILE_FACT) | READ_STATE(PROFILE_FACT) | ✅ |
| GB2-021 | Tôi đã ký hợp đồng với ai chưa hay vẫn chưa có? | READ_STATE(CONTRACT_STATUS) | READ_STATE(PT_STATUS) | ❌ |
| GB2-022 | Trước khi tìm PT mới, cho tôi biết tôi đang có PT không đã | READ_STATE(PT_STATUS) | READ_STATE(PT_STATUS) | ✅ |
| GB2-023 | Đừng tìm chương trình mới, tôi chỉ muốn biết đang theo cái nào | READ_STATE(PROGRAM_STATUS) | READ_STATE(PROGRAM_STATUS) | ✅ |
| GB2-024 | Tôi từng đăng ký gói huấn luyện nào chưa vậy? | UNKNOWN | READ_STATE(CONTRACT_STATUS) | ❌ |
| GB2-025 | Không cần gợi ý PT mới đâu, ai đang huấn luyện tôi vậy? | NEGATE_ACTION | READ_STATE(PT_STATUS) | ❌ |
| GB2-026 | Tìm PT phù hợp với thể trạng của tôi giúp mình. | START_WORKFLOW(FIND_PT) | START_WORKFLOW(FIND_PT) | ✅ |
| GB2-027 | Lọc giúp tôi vài chương trình tập phù hợp. | RECOMMEND(PROGRAM) | START_WORKFLOW(FIND_TRAINING_PROGRAM) | ❌ |
| GB2-028 | Chọn giúp tôi một huấn luyện viên phù hợp. | WRITE_ACTION | RECOMMEND(PT) | ❌ |
| GB2-029 | Nếu theo tình trạng của tôi thì nên siết hay tăng? | RECOMMEND | RECOMMEND(GOAL) | ❌ |
| GB2-030 | Mục tiêu hiện tại tôi đang để trên hệ thống là gì? | READ_STATE(GOAL) | READ_STATE(GOAL) | ✅ |
| GB2-031 | Nhìn số liệu của tôi, bạn thấy nên đi hướng nào? | RECOMMEND | RECOMMEND(GOAL) | ❌ |
| GB2-032 | Chỉ số dinh dưỡng hiện tại của tôi đang set ở đâu? | READ_STATE(NUTRITION_TARGET) | READ_STATE(NUTRITION_TARGET) | ✅ |
| GB2-033 | Theo bạn thì tôi cần bao nhiêu protein mỗi ngày là vừa? | READ_STATE(NUTRITION_TARGET) | RECOMMEND(MEALS) | ❌ |
| GB2-034 | Tôi có cần đổi huấn luyện viên không nhỉ? | READ_STATE(PT_STATUS) | RECOMMEND(HIRE_PT) | ❌ |
| GB2-035 | Tần suất tập hiện tại tôi đang để mấy buổi vậy? | UNKNOWN | READ_STATE(PROGRAM_STATUS) | ❌ |
| GB2-036 | Theo dữ liệu của tôi thì tập mấy buổi là hợp lý? | RECOMMEND(SESSIONS) | RECOMMEND(SESSIONS) | ✅ |
| GB2-037 | Cho hỏi ké, protein có tác dụng gì? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB2-038 | RIR nghĩa là sao vậy mọi người? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB2-039 | Tại sao tập nặng lại cần ngủ đủ giấc? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB2-040 | Deload week là như thế nào? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB2-041 | Ăn trước hay sau khi tập thì tốt hơn? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB2-042 | Vì sao nhiều người bị đau lưng khi deadlift sai form? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB2-043 | Creatine dùng lâu dài có hại thận không? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB2-044 | Sự khác nhau giữa tạ tự do và máy tập là gì? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB2-045 | Một chu kỳ giảm mỡ nên kéo dài bao lâu? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB2-046 | why does progressive overload matter | UNKNOWN | KNOWLEDGE_QA | ❌ |
| GB2-047 | tai sao phai khoi dong truoc khi tap | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB2-048 | Với chiều cao và cân nặng hiện tại, tôi có đang thừa cân không? | READ_STATE(PROFILE_FACT) | READ_STATE(PROFILE_FACT) | ✅ |
| GB2-049 | Lịch trống của tôi hôm nay có buổi tập nào không? | READ_STATE(SCHEDULE) | READ_STATE(SCHEDULE) | ✅ |
| GB2-050 | Xem giúp tôi đang follow gói ăn nào. | UNKNOWN | READ_STATE(NUTRITION_PROGRAM) | ❌ |
| GB2-051 | Kiểm tra giúp tôi hợp đồng PT còn hạn không. | READ_STATE(CONTRACT_STATUS) | READ_STATE(CONTRACT_STATUS) | ✅ |
| GB2-052 | Show tôi cân nặng mục tiêu đang lưu trong hệ thống. | READ_STATE(PROFILE_FACT) | READ_STATE(PROFILE_FACT) | ✅ |
| GB2-053 | Tôi không biết nên đặt mục tiêu cân nặng bao nhiêu, bạn tư vấn giúp. | RECOMMEND(TARGET_WEIGHT) | RECOMMEND(TARGET_WEIGHT) | ✅ |
| GB2-054 | Cho tôi lời khuyên xem có nên thuê PT lúc này không. | RECOMMEND(HIRE_PT) | RECOMMEND(HIRE_PT) | ✅ |
| GB2-055 | Bạn nghĩ chương trình nào hợp với người mới như tôi? | RECOMMEND(PROGRAM) | RECOMMEND(PROGRAM) | ✅ |
| GB2-056 | Tôi phân vân giữa siết cân với tăng cơ, bạn thấy sao? | UNKNOWN | RECOMMEND(GOAL) | ❌ |
| GB2-057 | Ăn bao nhiêu bữa một ngày thì vừa sức với tôi? | UNKNOWN | RECOMMEND(MEALS) | ❌ |
| GB2-058 | à khoan, tôi nói nhầm, phải là 3 buổi | CORRECTION | CORRECTION | ✅ |
| GB2-059 | ý tôi là ngân sách 5 triệu chứ không phải 2 | CORRECTION | CORRECTION | ✅ |
| GB2-060 | sửa lại giúp mình: mục tiêu 65kg | CORRECTION | CORRECTION | ✅ |
| GB2-061 | không phải vậy đâu, tôi ăn 5 bữa mới đúng | CORRECTION | CORRECTION | ✅ |
| GB2-062 | thật ra tôi 26 tuổi chứ không phải 28 | CORRECTION | CORRECTION | ✅ |
| GB2-063 | đổi lại thành thứ 2 4 6 giúp mình | SLOT_ANSWER | CORRECTION | ❌ |
| GB2-064 | Tôi muốn nghe lời khuyên thôi, chưa cần thay đổi gì. | UNKNOWN | RECOMMEND(GOAL) | ❌ |
| GB2-065 | Nếu thấy hợp thì đề xuất, đừng lưu vội. | NEGATE_ACTION | RECOMMEND(GOAL) | ❌ |
| GB2-066 | Đừng thuê PT giúp tôi, tôi tự cân nhắc trước đã. | NEGATE_ACTION | NEGATE_ACTION | ✅ |
| GB2-067 | Khoan hãy đổi mục tiêu, để tôi suy nghĩ thêm. | UNKNOWN | NEGATE_ACTION | ❌ |
| GB2-068 | Tôi chưa muốn lưu thực đơn này đâu. | REFERENCE | NEGATE_ACTION | ❌ |
| GB2-069 | Giải thích trước rồi tôi mới quyết định. | KNOWLEDGE_QA | EXPLAIN_AND_PROPOSE | ❌ |
| GB2-070 | Cứ theo mức bạn vừa gợi ý đi. | REFERENCE | REFERENCE | ✅ |
| GB2-071 | Chốt theo cái đề xuất lúc nãy giúp mình. | UNKNOWN | REFERENCE | ❌ |
| GB2-072 | Người bạn nhắc ở trên đó, thuê giúp mình. | UNKNOWN | WRITE_ACTION | ❌ |
| GB2-073 | Giữ nguyên phương án cũ, đừng đổi. | NEGATE_ACTION | REFERENCE | ❌ |
| GB2-074 | Người hướng dẫn tôi chọn lúc nãy đang ở trạng thái gì, và nếu chưa xong thì tìm giúp tôi người khác? | UNKNOWN | MULTI | ❌ |
| GB2-075 | Cho tôi biết mục tiêu dinh dưỡng hiện tại, rồi nói xem có hợp với thể trạng tôi không. | MULTI | MULTI | ✅ |
| GB2-076 | Trước tiên giải thích RIR là gì, sau đó tạo lịch tập giúp tôi. | MULTI | MULTI | ✅ |
| GB2-077 | Xem giúp tôi lịch hôm nay, rồi tìm một huấn luyện viên phù hợp. | MULTI | MULTI | ✅ |
| GB2-078 | Khoan chuyện PT đã, hiện tôi ăn mục tiêu bao nhiêu calo? | READ_STATE(PT_STATUS)+interrupt | READ_STATE(NUTRITION_TARGET)+interrupt | ❌ |
| GB2-079 | Trước khi trả lời, cho hỏi progressive overload là gì? | KNOWLEDGE_QA+interrupt | KNOWLEDGE_QA+interrupt | ✅ |
| GB2-080 | Nhân tiện, tôi có đang theo thực đơn nào không? | READ_STATE(NUTRITION_PROGRAM)+interrupt | READ_STATE(NUTRITION_PROGRAM)+interrupt | ✅ |
| GB2-081 | 3 triệu | SLOT_ANSWER | SLOT_ANSWER | ✅ |
| GB2-082 | 5 buổi mỗi tuần | SLOT_ANSWER | SLOT_ANSWER | ✅ |
| GB2-083 | thứ hai, thứ tư, thứ sáu | UNKNOWN | SLOT_ANSWER | ❌ |
| GB2-084 | Mục tiêu hiện tại của tôi đang lưu là gì vậy? | READ_STATE(GOAL)+interrupt | READ_STATE(GOAL)+interrupt | ✅ |
| GB2-085 | không giới hạn ngân sách | SLOT_ANSWER | SLOT_ANSWER | ✅ |
| GB2-086 | Tiện thể, hợp đồng PT của tôi còn hạn không? | READ_STATE(CONTRACT_STATUS)+interrupt | READ_STATE(CONTRACT_STATUS)+interrupt | ✅ |
| GB2-087 | Thôi khoan tìm PT, tạo thực đơn cho tôi trước đi | SWITCH_WORKFLOW(CREATE_NUTRITION_PLAN) | SWITCH_WORKFLOW(CREATE_NUTRITION_PLAN) | ✅ |
| GB2-088 | Đổi ý rồi, lập lộ trình cho tôi trước đã | SWITCH_WORKFLOW(CREATE_ROADMAP) | SWITCH_WORKFLOW(CREATE_ROADMAP) | ✅ |
| GB2-089 | thôi không cần nữa | NEGATE_ACTION | CANCEL | ❌ |
| GB2-090 | dừng lại giúp mình | UNKNOWN | CANCEL | ❌ |
| GB2-091 | hủy yêu cầu này đi | WRITE_ACTION | CANCEL | ❌ |
| GB2-092 | đồng ý, chốt vậy đi | UNKNOWN | CONFIRM | ❌ |
| GB2-093 | xác nhận luôn | UNKNOWN | CONFIRM | ❌ |
| GB2-094 | bỏ qua bản nháp này | UNKNOWN | DISMISS | ❌ |
| GB2-095 | thôi bỏ qua đi | UNKNOWN | DISMISS | ❌ |
| GB2-096 | gio minh co huan luyen vien chua ta | READ_STATE(PT_STATUS) | READ_STATE(PT_STATUS) | ✅ |
| GB2-097 | check giup t lich hom nay | READ_STATE(SCHEDULE) | READ_STATE(SCHEDULE) | ✅ |
| GB2-098 | plan hien tai cua m la gi vay | KNOWLEDGE_QA | READ_STATE(PROGRAM_STATUS) | ❌ |
| GB2-099 | t nen cut hay bulk day | RECOMMEND(GOAL) | RECOMMEND(GOAL) | ✅ |
| GB2-100 | cho e hoi protein la gi ạ | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB2-101 | mình đang dùng gói pt nào ấy nhỉ | READ_STATE(PT_STATUS) | READ_STATE(PT_STATUS) | ✅ |
| GB2-102 | so far minh dang theo goal nao | READ_STATE(GOAL) | READ_STATE(GOAL) | ✅ |
| GB2-103 | toi dg co hlv khong ta | UNKNOWN | READ_STATE(PT_STATUS) | ❌ |
| GB2-104 | cho minh xin thong tin lich tap tuan nay voi | READ_STATE(SCHEDULE) | READ_STATE(SCHEDULE) | ✅ |
| GB2-105 | khong biet chuong trinh minh dang theo la gi nua | READ_STATE(PROGRAM_STATUS) | READ_STATE(PROGRAM_STATUS) | ✅ |
| GB2-106 | minh hoi kieu la calo muc tieu cua minh dg la bnhieu | UNKNOWN | READ_STATE(NUTRITION_TARGET) | ❌ |
| GB2-107 | Dạo gần đây tôi khá bận nên chưa để ý lắm, không biết là hệ thống hiện đang ghi nhận tôi có huấn luyện viên riêng nào đồng hành hay chưa nhỉ? | RECOMMEND(PT) | READ_STATE(PT_STATUS) | ❌ |
| GB2-108 | Tôi đang cân nhắc xem có nên tiếp tục với mục tiêu tăng cơ hiện tại hay chuyển hướng sang giảm mỡ, dựa trên tình trạng cơ thể của tôi lúc này thì bạn nghĩ sao? | RECOMMEND(GOAL) | RECOMMEND(GOAL) | ✅ |
| GB2-109 | Trước khi quyết định có nên đổi chương trình tập hay không, tôi muốn biết là hiện tại mình đang theo chương trình cụ thể nào đã. | RECOMMEND(PROGRAM) | READ_STATE(PROGRAM_STATUS) | ❌ |
| GB2-110 | hiện tại? | KNOWLEDGE_QA | UNKNOWN | ❌ |
| GB2-111 | vậy à | UNKNOWN | UNKNOWN | ✅ |
| GB2-112 | được không | KNOWLEDGE_QA | UNKNOWN | ❌ |
| GB2-113 | Cập nhật giúp tôi mục tiêu thành duy trì cân nặng. | WRITE_ACTION(GOAL_CHANGE) | WRITE_ACTION(GOAL_CHANGE) | ✅ |
| GB2-114 | Chuyển mục tiêu của tôi sang tăng cơ luôn đi. | WRITE_ACTION(GOAL_CHANGE) | WRITE_ACTION(GOAL_CHANGE) | ✅ |
| GB2-115 | Thuê giúp tôi huấn luyện viên thứ hai trong danh sách. | WRITE_ACTION | WRITE_ACTION | ✅ |
| GB2-116 | Lưu chương trình này lại cho tôi. | WRITE_ACTION | WRITE_ACTION | ✅ |
| GB2-117 | Soạn giúp tôi một lộ trình tập trong 3 tháng. | UNKNOWN | START_WORKFLOW(CREATE_ROADMAP) | ❌ |
| GB2-118 | Lên giúp tôi thực đơn ăn kiêng. | START_WORKFLOW(CREATE_NUTRITION_PLAN) | START_WORKFLOW(CREATE_NUTRITION_PLAN) | ✅ |
| GB2-119 | Xếp lịch tập 5 buổi mỗi tuần cho tôi. | UNKNOWN | START_WORKFLOW(CREATE_WORKOUT_PLAN) | ❌ |
| GB2-120 | Tìm giúp tôi vài huấn luyện viên ở khu vực gần đây. | START_WORKFLOW(FIND_PT) | START_WORKFLOW(FIND_PT) | ✅ |
| GB2-121 | Kiếm giúp tôi chương trình tập phù hợp với người mới. | RECOMMEND(PROGRAM) | START_WORKFLOW(FIND_TRAINING_PROGRAM) | ❌ |
| GB2-122 | Trạng thái hợp đồng huấn luyện của tôi bây giờ ra sao? | READ_STATE(CONTRACT_STATUS) | READ_STATE(CONTRACT_STATUS) | ✅ |
| GB2-123 | Chiều nay lịch tập của tôi có gì không? | READ_STATE(SCHEDULE) | READ_STATE(SCHEDULE) | ✅ |
| GB2-124 | Bao nhiêu gram carb mỗi ngày đang là mục tiêu của tôi? | READ_STATE(NUTRITION_TARGET) | READ_STATE(NUTRITION_TARGET) | ✅ |
| GB2-125 | Thực đơn hiện hành của tôi đang áp dụng là cái nào? | READ_STATE(NUTRITION_PROGRAM) | READ_STATE(NUTRITION_PROGRAM) | ✅ |
| GB2-126 | Số tuổi tôi khai trong hồ sơ hiện là bao nhiêu? | READ_STATE(PROFILE_FACT) | READ_STATE(PROFILE_FACT) | ✅ |
| GB2-127 | Tôi đang nặng bao nhiêu theo dữ liệu mới nhất? | READ_STATE(PROFILE_FACT) | READ_STATE(PROFILE_FACT) | ✅ |
| GB2-128 | Which trainer am I currently signed with? | UNKNOWN | READ_STATE(PT_STATUS) | ❌ |
| GB2-129 | What's my target weight saved as? | READ_STATE(PROFILE_FACT) | READ_STATE(PROFILE_FACT) | ✅ |
| GB2-130 | hom nay minh co lich tap gi khong | READ_STATE(SCHEDULE) | READ_STATE(SCHEDULE) | ✅ |
| GB2-131 | goi dinh duong minh dang theo la goi nao | READ_STATE(NUTRITION_TARGET) | READ_STATE(NUTRITION_PROGRAM) | ❌ |
| GB2-132 | Tôi nên chọn mức cân nặng mục tiêu nào cho phù hợp? | RECOMMEND(TARGET_WEIGHT) | RECOMMEND(TARGET_WEIGHT) | ✅ |
| GB2-133 | Có nên tìm huấn luyện viên riêng vào lúc này không? | RECOMMEND(HIRE_PT) | RECOMMEND(HIRE_PT) | ✅ |
| GB2-134 | Tập bao nhiêu buổi mỗi tuần là hợp với tôi? | RECOMMEND(SESSIONS) | RECOMMEND(SESSIONS) | ✅ |
| GB2-135 | Should I bulk or cut given my current stats? | RECOMMEND(GOAL) | RECOMMEND(GOAL) | ✅ |
| GB2-136 | Chương trình tập nào sẽ hợp với người mới bắt đầu như tôi? | RECOMMEND(PROGRAM) | RECOMMEND(PROGRAM) | ✅ |
| GB2-137 | Tại sao phải tăng dần khối lượng tạ theo thời gian? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB2-138 | Ăn nhiều bữa nhỏ có tốt hơn ba bữa lớn không? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB2-139 | Superset là gì vậy? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB2-140 | Tại sao càng tập lâu năm càng khó tăng cơ? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB2-141 | what is a deload week | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB2-142 | Tiện thể cho hỏi, mục tiêu calo hiện tại của tôi bao nhiêu? | READ_STATE(NUTRITION_TARGET)+interrupt | READ_STATE(NUTRITION_TARGET)+interrupt | ✅ |
| GB2-143 | Khoan đã, protein có tác dụng gì trong việc tăng cơ? | CORRECTION | KNOWLEDGE_QA+interrupt | ❌ |
| GB2-144 | 6 buổi | SLOT_ANSWER | SLOT_ANSWER | ✅ |
| GB2-145 | 1.5 triệu thôi | SLOT_ANSWER | SLOT_ANSWER | ✅ |
| GB2-146 | hop dong pt cua t con han khong | READ_STATE(CONTRACT_STATUS) | READ_STATE(CONTRACT_STATUS) | ✅ |
| GB2-147 | muc tieu dinh duong hien tai la bnhieu calo | READ_STATE(NUTRITION_TARGET) | READ_STATE(NUTRITION_TARGET) | ✅ |
| GB2-148 | e nen tap bao nhieu buoi 1 tuan a | RECOMMEND(SESSIONS) | RECOMMEND(SESSIONS) | ✅ |
| GB2-149 | recommend giup m 1 chuong trinh tap voi | RECOMMEND(PROGRAM) | RECOMMEND(PROGRAM) | ✅ |
| GB2-150 | Vì công việc dạo này khá bận rộn nên tôi không theo dõi kỹ, không rõ hiện tại thực đơn tôi đang áp dụng có phải bản mới nhất mình từng lưu hay không? | READ_STATE(NUTRITION_PROGRAM) | READ_STATE(NUTRITION_PROGRAM) | ✅ |
| GB2-151 | Tôi vừa đọc được vài thông tin về deload week nhưng chưa hiểu rõ lắm, không biết là nó hoạt động như thế nào trong một chu kỳ tập luyện dài hạn? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB2-152 | Giúp tôi dựng một chương trình tập tạ cho người mới. | UNKNOWN | START_WORKFLOW(CREATE_WORKOUT_PLAN) | ❌ |
| GB2-153 | Build a nutrition plan for me please. | START_WORKFLOW | START_WORKFLOW(CREATE_NUTRITION_PLAN) | ❌ |
| GB2-154 | khoan, tôi 68kg chứ không phải 70 | CORRECTION | CORRECTION | ✅ |
| GB2-155 | nhầm rồi, ngân sách của tôi là 1 triệu thôi | CORRECTION | CORRECTION | ✅ |
| GB2-156 | à không, mình ăn 4 bữa mới đúng | CORRECTION | CORRECTION | ✅ |
| GB2-157 | sai rồi, phải là 5 buổi mỗi tuần | CORRECTION | CORRECTION | ✅ |
| GB2-158 | thực ra tôi tập được thứ 2 4 6 thôi | SLOT_ANSWER | CORRECTION | ❌ |
| GB2-159 | Ừ dùng luôn mức đó cho tôi. | REFERENCE | REFERENCE | ✅ |
| GB2-160 | Cứ để như cũ, không cần đổi. | REFERENCE | REFERENCE | ✅ |
| GB2-161 | Lấy phương án đầu tiên giúp tôi. | REFERENCE | WRITE_ACTION | ❌ |
| GB2-162 | Đồng ý theo gợi ý bạn vừa đưa ra. | REFERENCE | REFERENCE | ✅ |
| GB2-163 | Tôi không cần đổi chương trình đâu, cứ để vậy. | NEGATE_ACTION | NEGATE_ACTION | ✅ |
| GB2-164 | Không cần tìm huấn luyện viên nữa, tôi tự tập. | NEGATE_ACTION | NEGATE_ACTION | ✅ |
| GB2-165 | Chưa cần lưu gì cả, để tôi xem thêm đã. | UNKNOWN | NEGATE_ACTION | ❌ |
| GB2-166 | được rồi, chốt luôn | UNKNOWN | CONFIRM | ❌ |
| GB2-167 | ok tôi đồng ý | UNKNOWN | CONFIRM | ❌ |
| GB2-168 | không dùng bản này | UNKNOWN | DISMISS | ❌ |
| GB2-169 | bỏ bản nháp đi | UNKNOWN | DISMISS | ❌ |
| GB2-170 | Khoan, để tôi tìm chương trình tập trước đã | SWITCH_WORKFLOW(FIND_TRAINING_PROGRAM) | SWITCH_WORKFLOW(FIND_TRAINING_PROGRAM) | ✅ |
| GB2-171 | Thôi dẹp qua một bên, không cần làm nữa | NEGATE_ACTION | CANCEL | ❌ |
| GB2-172 | huỷ giúp tôi cái này | WRITE_ACTION | CANCEL | ❌ |
| GB2-173 | ừ | UNKNOWN | UNKNOWN | ✅ |
| GB2-174 | thế à | UNKNOWN | UNKNOWN | ✅ |
| GB2-175 | ok vậy | UNKNOWN | UNKNOWN | ✅ |
| GB2-176 | không rõ nữa | UNKNOWN | UNKNOWN | ✅ |
| GB2-177 | co ai dang huan luyen cho toi khong ta | UNKNOWN | READ_STATE(PT_STATUS) | ❌ |
| GB2-178 | khong biet muc tieu dinh duong minh dang la bnhieu | UNKNOWN | READ_STATE(NUTRITION_TARGET) | ❌ |
| GB2-179 | minh nen tang hay giam day ta | UNKNOWN | RECOMMEND(GOAL) | ❌ |
| GB2-180 | cho minh hoi la protein co quan trong khong | READ_STATE(NUTRITION_TARGET) | KNOWLEDGE_QA | ❌ |
| GB2-181 | Đổi giúp tôi mục tiêu sang hiệu suất thể thao. | WRITE_ACTION(GOAL_CHANGE) | WRITE_ACTION(GOAL_CHANGE) | ✅ |
| GB2-182 | Cập nhật cân nặng mục tiêu thành 75kg giúp tôi. | WRITE_ACTION(GOAL_CHANGE) | WRITE_ACTION(GOAL_CHANGE) | ✅ |
| GB2-183 | Chọn PT đầu tiên trong danh sách giúp tôi. | WRITE_ACTION | WRITE_ACTION | ✅ |
| GB2-184 | Tạo giúp tôi lịch ăn cho cả tuần. | START_WORKFLOW | START_WORKFLOW(CREATE_NUTRITION_PLAN) | ❌ |
| GB2-185 | Xây một lộ trình giảm mỡ dài hạn cho tôi. | START_WORKFLOW(CREATE_ROADMAP) | START_WORKFLOW(CREATE_ROADMAP) | ✅ |
| GB2-186 | Find me a suitable personal trainer. | START_WORKFLOW(FIND_PT) | START_WORKFLOW(FIND_PT) | ✅ |
| GB2-187 | Trước khi tìm gói tập mới, tôi đang dùng gói nào vậy? | UNKNOWN | READ_STATE(PROGRAM_STATUS) | ❌ |
| GB2-188 | Không cần đề xuất PT nữa, hợp đồng hiện tại của tôi ra sao rồi? | RECOMMEND(PT) | READ_STATE(CONTRACT_STATUS) | ❌ |
| GB2-189 | Số liệu hiện tại của tôi đang lưu là gì, và có nên đổi mục tiêu không? | MULTI | MULTI | ❌ |
| GB2-190 | Coach hiện tại của tôi trên hệ thống là ai vậy? | UNKNOWN | READ_STATE(PT_STATUS) | ❌ |
| GB2-191 | Ngày mai theo lịch tôi có buổi tập nào không? | READ_STATE(SCHEDULE) | READ_STATE(SCHEDULE) | ✅ |
| GB2-192 | Béo mỗi ngày hệ thống đang giới hạn cho tôi bao nhiêu gram? | UNKNOWN | READ_STATE(NUTRITION_TARGET) | ❌ |
| GB2-193 | Bạn thấy tôi có nên đổi sang tập nặng hơn không? | RECOMMEND | RECOMMEND(SESSIONS) | ❌ |
| GB2-194 | Nghỉ giữa các hiệp bao lâu là hợp lý? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB2-195 | Tại sao ăn đủ nước lại quan trọng khi tập gym? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB2-196 | Nhân tiện, tôi đang theo chương trình tập nào vậy? | READ_STATE(PROGRAM_STATUS)+interrupt | READ_STATE(PROGRAM_STATUS)+interrupt | ✅ |
| GB2-197 | 2 bữa thôi | SLOT_ANSWER | SLOT_ANSWER | ✅ |
| GB2-198 | minh co dang ky goi pt nao chua ta | READ_STATE(PT_STATUS) | READ_STATE(CONTRACT_STATUS) | ❌ |
| GB2-199 | lich tap ngay mai co gi khong ta | READ_STATE(SCHEDULE) | READ_STATE(SCHEDULE) | ✅ |
| GB2-200 | khoan đã, đúng ra tôi muốn 4 bữa | CORRECTION | CORRECTION | ✅ |
| GB2-201 | Tôi đang phân vân không biết có nên tiếp tục thuê huấn luyện viên hiện tại hay không, dựa trên tiến độ tập luyện gần đây của mình thì bạn thấy thế nào? | RECOMMEND(HIRE_PT) | RECOMMEND(HIRE_PT) | ✅ |
| GB2-202 | Lên kế hoạch tập gym 4 buổi mỗi tuần cho tôi. | START_WORKFLOW(CREATE_WORKOUT_PLAN) | START_WORKFLOW(CREATE_WORKOUT_PLAN) | ✅ |
| GB2-203 | Chuyển mục tiêu chính sang giảm mỡ giúp tôi. | WRITE_ACTION(GOAL_CHANGE) | WRITE_ACTION(GOAL_CHANGE) | ✅ |
| GB2-204 | hmm | UNKNOWN | UNKNOWN | ✅ |