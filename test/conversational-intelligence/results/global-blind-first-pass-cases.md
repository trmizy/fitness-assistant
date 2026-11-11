| id | input | got | expected | ok |
|---|---|---|---|---|
| GB-001 | Tôi đang có PT chưa? | READ_STATE(PT_STATUS) | READ_STATE(PT_STATUS) | ✅ |
| GB-002 | PT hiện tại của tôi là ai? | READ_STATE(PT_STATUS) | READ_STATE(PT_STATUS) | ✅ |
| GB-003 | Tôi còn hợp đồng PT nào đang hoạt động không? | READ_STATE(CONTRACT_STATUS) | READ_STATE(CONTRACT_STATUS) | ✅ |
| GB-004 | Tôi có chương trình tập chưa? | READ_STATE(PROGRAM_STATUS) | READ_STATE(PROGRAM_STATUS) | ✅ |
| GB-005 | Tôi đang theo chương trình nào? | UNKNOWN | READ_STATE(PROGRAM_STATUS) | ❌ |
| GB-006 | Lịch tập hiện tại của tôi là gì? | READ_STATE(SCHEDULE) | READ_STATE(SCHEDULE) | ✅ |
| GB-007 | Hôm nay tôi tập gì? | READ_STATE(SCHEDULE) | READ_STATE(SCHEDULE) | ✅ |
| GB-008 | Tôi đang theo thực đơn nào? | READ_STATE(NUTRITION_PROGRAM) | READ_STATE(NUTRITION_PROGRAM) | ✅ |
| GB-009 | Mục tiêu hiện tại của tôi là gì? | READ_STATE(GOAL) | READ_STATE(GOAL) | ✅ |
| GB-010 | Calo hiện tại của tôi bao nhiêu? | READ_STATE(NUTRITION_TARGET) | READ_STATE(NUTRITION_TARGET) | ✅ |
| GB-011 | Macro của tôi hiện tại là bao nhiêu? | READ_STATE(NUTRITION_TARGET) | READ_STATE(NUTRITION_TARGET) | ✅ |
| GB-012 | Tôi đang ăn theo bao nhiêu calo? | READ_STATE(NUTRITION_TARGET) | READ_STATE(NUTRITION_TARGET) | ✅ |
| GB-013 | Cân nặng hiện tại của tôi là bao nhiêu? | READ_STATE(PROFILE_FACT) | READ_STATE(PROFILE_FACT) | ✅ |
| GB-014 | Chiều cao của tôi trong hồ sơ là bao nhiêu? | READ_STATE(PROFILE_FACT) | READ_STATE(PROFILE_FACT) | ✅ |
| GB-015 | Cân nặng mục tiêu của tôi là bao nhiêu? | READ_STATE(PROFILE_FACT) | READ_STATE(PROFILE_FACT) | ✅ |
| GB-016 | tôi có PT chưa | READ_STATE(PT_STATUS) | READ_STATE(PT_STATUS) | ✅ |
| GB-017 | toi dang co pt chua | READ_STATE(PT_STATUS) | READ_STATE(PT_STATUS) | ✅ |
| GB-018 | hop dong pt cua toi trang thai gi | READ_STATE(CONTRACT_STATUS) | READ_STATE(CONTRACT_STATUS) | ✅ |
| GB-019 | Hợp đồng PT của tôi đang ở trạng thái nào? | READ_STATE(CONTRACT_STATUS) | READ_STATE(CONTRACT_STATUS) | ✅ |
| GB-020 | Tôi đã đăng ký PT nào chưa? | READ_STATE(PT_STATUS) | READ_STATE(PT_STATUS) | ✅ |
| GB-021 | Mỗi ngày tôi được ăn bao nhiêu protein? | READ_STATE(NUTRITION_TARGET) | READ_STATE(NUTRITION_TARGET) | ✅ |
| GB-022 | Tôi đang tập mấy buổi một tuần? | READ_STATE(PROGRAM_STATUS) | READ_STATE(PROGRAM_STATUS) | ✅ |
| GB-023 | Tuần này lịch tập của tôi thế nào? | READ_STATE(SCHEDULE) | READ_STATE(SCHEDULE) | ✅ |
| GB-024 | ngày mai tôi tập gì | READ_STATE(SCHEDULE) | READ_STATE(SCHEDULE) | ✅ |
| GB-025 | Mình đang theo kế hoạch calo nào vậy? | READ_STATE(NUTRITION_TARGET) | READ_STATE(NUTRITION_TARGET) | ✅ |
| GB-026 | Tôi có thực đơn chưa? | READ_STATE(NUTRITION_PROGRAM) | READ_STATE(NUTRITION_PROGRAM) | ✅ |
| GB-027 | PT của mình tên gì? | READ_STATE(PT_STATUS) | READ_STATE(PT_STATUS) | ✅ |
| GB-028 | What's my current goal? | READ_STATE(GOAL) | READ_STATE(GOAL) | ✅ |
| GB-029 | my calo target hiện tại là bao nhiêu | READ_STATE(NUTRITION_TARGET) | READ_STATE(NUTRITION_TARGET) | ✅ |
| GB-030 | Goal hiện tại của tôi là cut hay bulk? | RECOMMEND(GOAL) | READ_STATE(GOAL) | ❌ |
| GB-031 | PT nào hợp với tôi? | RECOMMEND(PT) | RECOMMEND(PT) | ✅ |
| GB-032 | Chương trình nào hợp với tôi? | UNKNOWN | RECOMMEND(PROGRAM) | ❌ |
| GB-033 | Theo tình trạng hiện tại tôi nên cut hay bulk? | RECOMMEND(GOAL) | RECOMMEND(GOAL) | ✅ |
| GB-034 | Với tình trạng hiện tại tôi nên cut hay bulk? | RECOMMEND(GOAL) | RECOMMEND(GOAL) | ✅ |
| GB-035 | Mục tiêu nào hợp với tôi? | RECOMMEND(GOAL) | RECOMMEND(GOAL) | ✅ |
| GB-036 | Bạn thấy mục tiêu nào hợp với tôi? | RECOMMEND(GOAL) | RECOMMEND(GOAL) | ✅ |
| GB-037 | Mục tiêu cân nặng nào hợp với tôi? | RECOMMEND(TARGET_WEIGHT) | RECOMMEND(TARGET_WEIGHT) | ✅ |
| GB-038 | Tôi nên tập bao nhiêu buổi một tuần? | RECOMMEND(SESSIONS) | RECOMMEND(SESSIONS) | ✅ |
| GB-039 | Tôi có nên thuê PT không? | RECOMMEND(HIRE_PT) | RECOMMEND(HIRE_PT) | ✅ |
| GB-040 | Tôi nên ăn bao nhiêu bữa mỗi ngày? | RECOMMEND(MEALS) | RECOMMEND(MEALS) | ✅ |
| GB-041 | Tôi không biết nên tập mấy buổi | RECOMMEND(SESSIONS) | RECOMMEND(SESSIONS) | ✅ |
| GB-042 | nen cut hay bulk vay | RECOMMEND(GOAL) | RECOMMEND(GOAL) | ✅ |
| GB-043 | tôi nên đặt cân nặng mục tiêu là bao nhiêu | RECOMMEND(TARGET_WEIGHT) | RECOMMEND(TARGET_WEIGHT) | ✅ |
| GB-044 | Should I cut or bulk? | RECOMMEND(GOAL) | RECOMMEND(GOAL) | ✅ |
| GB-045 | bạn đề xuất giúp tôi mục tiêu phù hợp | RECOMMEND(GOAL) | RECOMMEND(GOAL) | ✅ |
| GB-046 | Tôi có cần thuê PT không nhỉ? | RECOMMEND(HIRE_PT) | RECOMMEND(HIRE_PT) | ✅ |
| GB-047 | Tôi nên tập mấy buổi một tuần với mục tiêu hiện tại? | RECOMMEND(GOAL) | RECOMMEND(SESSIONS) | ❌ |
| GB-048 | Chương trình tập nào phù hợp với người mới như tôi? | RECOMMEND(PROGRAM) | RECOMMEND(PROGRAM) | ✅ |
| GB-049 | Nên ăn mấy bữa thì hợp lý? | RECOMMEND(MEALS) | RECOMMEND(MEALS) | ✅ |
| GB-050 | toi nen cut hay bulk | RECOMMEND(GOAL) | RECOMMEND(GOAL) | ✅ |
| GB-051 | recommend cho tôi chương trình phù hợp | UNKNOWN | RECOMMEND(PROGRAM) | ❌ |
| GB-052 | Thuê PT này. | WRITE_ACTION | WRITE_ACTION | ✅ |
| GB-053 | Thuê PT đầu tiên. | WRITE_ACTION | WRITE_ACTION | ✅ |
| GB-054 | Đổi mục tiêu sang giảm mỡ. | WRITE_ACTION(GOAL_CHANGE) | WRITE_ACTION(GOAL_CHANGE) | ✅ |
| GB-055 | Cập nhật cân nặng mục tiêu thành 72kg. | WRITE_ACTION(GOAL_CHANGE) | WRITE_ACTION(GOAL_CHANGE) | ✅ |
| GB-056 | Lưu lịch tập này. | WRITE_ACTION | WRITE_ACTION | ✅ |
| GB-057 | Chọn chương trình thứ nhất. | WRITE_ACTION | WRITE_ACTION | ✅ |
| GB-058 | Đổi giúp tôi sang tăng cơ. | WRITE_ACTION(GOAL_CHANGE) | WRITE_ACTION(GOAL_CHANGE) | ✅ |
| GB-059 | chuyển mục tiêu của tôi sang duy trì | WRITE_ACTION(GOAL_CHANGE) | WRITE_ACTION(GOAL_CHANGE) | ✅ |
| GB-060 | Tạo lộ trình cho tôi. | START_WORKFLOW(CREATE_ROADMAP) | START_WORKFLOW(CREATE_ROADMAP) | ✅ |
| GB-061 | Tạo lịch tập cho tôi. | START_WORKFLOW(CREATE_WORKOUT_PLAN) | START_WORKFLOW(CREATE_WORKOUT_PLAN) | ✅ |
| GB-062 | Tạo thực đơn cho tôi. | START_WORKFLOW(CREATE_NUTRITION_PLAN) | START_WORKFLOW(CREATE_NUTRITION_PLAN) | ✅ |
| GB-063 | Tìm PT cho tôi. | START_WORKFLOW(FIND_PT) | START_WORKFLOW(FIND_PT) | ✅ |
| GB-064 | Tìm chương trình tập cho tôi. | START_WORKFLOW(FIND_TRAINING_PROGRAM) | START_WORKFLOW(FIND_TRAINING_PROGRAM) | ✅ |
| GB-065 | Lập cho tôi một lộ trình giảm mỡ 12 tuần | START_WORKFLOW(CREATE_ROADMAP) | START_WORKFLOW(CREATE_ROADMAP) | ✅ |
| GB-066 | Lên lịch tập 4 buổi cho tôi | START_WORKFLOW(CREATE_WORKOUT_PLAN) | START_WORKFLOW(CREATE_WORKOUT_PLAN) | ✅ |
| GB-067 | Gợi ý chương trình tập cho tôi | START_WORKFLOW(FIND_TRAINING_PROGRAM) | START_WORKFLOW(FIND_TRAINING_PROGRAM) | ✅ |
| GB-068 | tạo plan tập gym cho t | START_WORKFLOW(CREATE_WORKOUT_PLAN) | START_WORKFLOW(CREATE_WORKOUT_PLAN) | ✅ |
| GB-069 | lên thực đơn 4 bữa giúp tôi | START_WORKFLOW(CREATE_NUTRITION_PLAN) | START_WORKFLOW(CREATE_NUTRITION_PLAN) | ✅ |
| GB-070 | tim pt cho toi | START_WORKFLOW(FIND_PT) | START_WORKFLOW(FIND_PT) | ✅ |
| GB-071 | Build me a workout plan | START_WORKFLOW | START_WORKFLOW(CREATE_WORKOUT_PLAN) | ❌ |
| GB-072 | Tìm giúp tôi PT ở quận 1 | START_WORKFLOW(FIND_PT) | START_WORKFLOW(FIND_PT) | ✅ |
| GB-073 | Cho tôi một thực đơn giảm cân | START_WORKFLOW | START_WORKFLOW(CREATE_NUTRITION_PLAN) | ❌ |
| GB-074 | Tôi muốn có lộ trình tăng cơ | START_WORKFLOW | START_WORKFLOW(CREATE_ROADMAP) | ❌ |
| GB-075 | tao lo trinh cho toi | START_WORKFLOW(CREATE_ROADMAP) | START_WORKFLOW(CREATE_ROADMAP) | ✅ |
| GB-076 | Progressive overload là gì? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB-077 | RIR là gì? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB-078 | Superset khác dropset thế nào? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB-079 | Protein có vai trò gì? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB-080 | Tập cardio trước hay sau tạ? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB-081 | Creatine có an toàn không? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB-082 | BMI là gì và tính thế nào? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB-083 | Ăn tối muộn có béo không? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB-084 | hiit khac liss ntn | UNKNOWN | KNOWLEDGE_QA | ❌ |
| GB-085 | What is a deload week? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB-086 | Bao nhiêu set mỗi nhóm cơ là đủ? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB-087 | Squat sâu có hại gối không? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB-088 | PT là gì? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB-089 | Một PT tốt cần có tiêu chí gì? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB-090 | Thâm hụt calo là gì? | KNOWLEDGE_QA | KNOWLEDGE_QA | ✅ |
| GB-091 | Macro hiện tại của tôi bao nhiêu? | READ_STATE(NUTRITION_TARGET)+interrupt | READ_STATE(NUTRITION_TARGET)+interrupt | ✅ |
| GB-092 | protein là gì? | KNOWLEDGE_QA+interrupt | KNOWLEDGE_QA+interrupt | ✅ |
| GB-093 | 2 triệu | SLOT_ANSWER | SLOT_ANSWER | ✅ |
| GB-094 | khoảng 1.5 triệu | CORRECTION | SLOT_ANSWER | ❌ |
| GB-095 | không giới hạn | SLOT_ANSWER | SLOT_ANSWER | ✅ |
| GB-096 | Tôi đang có PT chưa? | READ_STATE(PT_STATUS)+interrupt | READ_STATE(PT_STATUS)+interrupt | ✅ |
| GB-097 | 4 buổi | SLOT_ANSWER | SLOT_ANSWER | ✅ |
| GB-098 | Lịch tập hiện tại của tôi là gì? | READ_STATE(SCHEDULE)+interrupt | READ_STATE(SCHEDULE)+interrupt | ✅ |
| GB-099 | 72kg | SLOT_ANSWER | SLOT_ANSWER | ✅ |
| GB-100 | mục tiêu hiện tại của tôi là gì? | READ_STATE(GOAL)+interrupt | READ_STATE(GOAL)+interrupt | ✅ |
| GB-101 | Squat là gì? | KNOWLEDGE_QA+interrupt | KNOWLEDGE_QA+interrupt | ✅ |
| GB-102 | 3 bữa | SLOT_ANSWER | SLOT_ANSWER | ✅ |
| GB-103 | Calo mục tiêu của tôi bao nhiêu? | READ_STATE(NUTRITION_TARGET)+interrupt | READ_STATE(NUTRITION_TARGET)+interrupt | ✅ |
| GB-104 | T2 T4 T6 | SLOT_ANSWER | SLOT_ANSWER | ✅ |
| GB-105 | thứ 2 thứ 4 thứ 6 nhé | SLOT_ANSWER | SLOT_ANSWER | ✅ |
| GB-106 | à mà creatine có an toàn không? | KNOWLEDGE_QA+interrupt | KNOWLEDGE_QA+interrupt | ✅ |
| GB-107 | ngân sách khoảng 3tr | CORRECTION | SLOT_ANSWER | ❌ |
| GB-108 | PT hiện tại của tôi là ai? | READ_STATE(PT_STATUS)+interrupt | READ_STATE(PT_STATUS)+interrupt | ✅ |
| GB-109 | Cân nặng hiện tại của tôi bao nhiêu? | READ_STATE(PROFILE_FACT)+interrupt | READ_STATE(PROFILE_FACT)+interrupt | ✅ |
| GB-110 | Hôm nay tôi tập gì? | READ_STATE(SCHEDULE)+interrupt | READ_STATE(SCHEDULE)+interrupt | ✅ |
| GB-111 | Tôi đang theo thực đơn nào? | READ_STATE(NUTRITION_PROGRAM)+interrupt | READ_STATE(NUTRITION_PROGRAM)+interrupt | ✅ |
| GB-112 | RIR là gì vậy? | KNOWLEDGE_QA+interrupt | KNOWLEDGE_QA+interrupt | ✅ |
| GB-113 | thôi tìm PT, tạo lịch tập trước | SWITCH_WORKFLOW(CREATE_WORKOUT_PLAN) | SWITCH_WORKFLOW(CREATE_WORKOUT_PLAN) | ✅ |
| GB-114 | khoan, tạo thực đơn trước đã | SWITCH_WORKFLOW(CREATE_NUTRITION_PLAN) | SWITCH_WORKFLOW(CREATE_NUTRITION_PLAN) | ✅ |
| GB-115 | Tạo lộ trình cho tôi | SWITCH_WORKFLOW(CREATE_ROADMAP) | SWITCH_WORKFLOW(CREATE_ROADMAP) | ✅ |
| GB-116 | thôi | CANCEL | CANCEL | ✅ |
| GB-117 | hủy đi | CANCEL | CANCEL | ✅ |
| GB-118 | không cần nữa | CANCEL | CANCEL | ✅ |
| GB-119 | dừng lại | CANCEL | CANCEL | ✅ |
| GB-120 | bỏ qua đi | CANCEL | CANCEL | ✅ |
| GB-121 | không phải 2 triệu, 3 triệu | CORRECTION | CORRECTION | ✅ |
| GB-122 | à không, 70kg | CORRECTION | CORRECTION | ✅ |
| GB-123 | à không, tôi tập 5 buổi | CORRECTION | CORRECTION | ✅ |
| GB-124 | ngân sách lúc nãy sai, 2 triệu thôi | CORRECTION | CORRECTION | ✅ |
| GB-125 | nhầm rồi, 4 bữa | CORRECTION | CORRECTION | ✅ |
| GB-126 | không tăng cơ nữa, tôi muốn giảm mỡ | CORRECTION | CORRECTION | ✅ |
| GB-127 | ý tôi là 72 chứ không phải 74 | CORRECTION | CORRECTION | ✅ |
| GB-128 | đổi thành 45 phút mỗi buổi | CORRECTION | CORRECTION | ✅ |
| GB-129 | thực ra tôi chỉ có 1 triệu | CORRECTION | CORRECTION | ✅ |
| GB-130 | sửa lại: mục tiêu 68kg | CORRECTION | CORRECTION | ✅ |
| GB-131 | ok đổi theo đề xuất đó | REFERENCE | REFERENCE | ✅ |
| GB-132 | dùng mức bạn đề xuất | SLOT_ANSWER | REFERENCE | ❌ |
| GB-133 | lấy mức thấp hơn | SLOT_ANSWER | REFERENCE | ❌ |
| GB-134 | chọn PT đầu tiên | WRITE_ACTION | WRITE_ACTION | ✅ |
| GB-135 | thuê người đó | WRITE_ACTION | WRITE_ACTION | ✅ |
| GB-136 | lưu plan vừa rồi | WRITE_ACTION | WRITE_ACTION | ✅ |
| GB-137 | giữ cái cũ | REFERENCE | REFERENCE | ✅ |
| GB-138 | đổi cái vừa rồi còn 3 bữa | WRITE_ACTION | REFERENCE | ❌ |
| GB-139 | ok theo đề xuất | REFERENCE | REFERENCE | ✅ |
| GB-140 | cái đầu tiên đi | REFERENCE | REFERENCE | ✅ |
| GB-141 | Vì sao bạn nghĩ tôi nên giảm mỡ? Nếu hợp lý thì đổi giúp tôi. | EXPLAIN_AND_PROPOSE(GOAL_CHANGE) | EXPLAIN_AND_PROPOSE | ✅ |
| GB-142 | Tại sao tôi nên đổi sang giảm mỡ? Đổi luôn giúp tôi nhé | EXPLAIN_AND_PROPOSE(GOAL_CHANGE) | EXPLAIN_AND_PROPOSE | ✅ |
| GB-143 | Mục tiêu hiện tại của tôi là gì, và có hợp với tình trạng của tôi không? | RECOMMEND(GOAL) | MULTI | ❌ |
| GB-144 | Tôi đang có PT chưa? Nếu chưa thì tìm giúp tôi | READ_STATE(PT_STATUS) | MULTI | ❌ |
| GB-145 | Calo của tôi bao nhiêu và thực đơn hôm nay có gì? | MULTI | MULTI | ✅ |
| GB-146 | Giải thích RIR rồi tạo lịch tập giúp tôi | START_WORKFLOW(CREATE_WORKOUT_PLAN) | MULTI | ❌ |
| GB-147 | Cho tôi biết mục tiêu hiện tại và đề xuất mục tiêu mới | MULTI | MULTI | ✅ |
| GB-148 | Cho tôi xem lịch tập hôm nay rồi tìm PT giúp tôi | MULTI | MULTI | ✅ |
| GB-149 | Tôi không muốn thuê PT | NEGATE_ACTION | NEGATE_ACTION | ✅ |
| GB-150 | Không cần tìm PT nữa | NEGATE_ACTION | NEGATE_ACTION | ✅ |
| GB-151 | đừng đổi mục tiêu | NEGATE_ACTION | NEGATE_ACTION | ✅ |
| GB-152 | không lưu | NEGATE_ACTION | NEGATE_ACTION | ✅ |
| GB-153 | tôi chưa muốn thuê ai cả | UNKNOWN | NEGATE_ACTION | ❌ |
| GB-154 | không cần tạo lộ trình đâu, chỉ cho tôi xem mục tiêu hiện tại | READ_STATE(GOAL) | READ_STATE(GOAL) | ✅ |
| GB-155 | đừng tìm PT, cho tôi biết tôi đang có PT nào | READ_STATE(PT_STATUS) | READ_STATE(PT_STATUS) | ✅ |
| GB-156 | mình có pt chưa nhỉ | READ_STATE(PT_STATUS) | READ_STATE(PT_STATUS) | ✅ |
| GB-157 | cho mình hỏi lịch tập hôm nay | READ_STATE(SCHEDULE) | READ_STATE(SCHEDULE) | ✅ |
| GB-158 | check giúp mình calo target | UNKNOWN | READ_STATE(NUTRITION_TARGET) | ❌ |
| GB-159 | cho t xem goal hiện tại | READ_STATE(GOAL) | READ_STATE(GOAL) | ✅ |
| GB-160 | muc tieu cua toi hien gio la gi | READ_STATE(GOAL) | READ_STATE(GOAL) | ✅ |
| GB-161 | chuong trinh tap cua toi la gi | KNOWLEDGE_QA | READ_STATE(PROGRAM_STATUS) | ❌ |
| GB-162 | so far tôi đang follow chương trình nào | UNKNOWN | READ_STATE(PROGRAM_STATUS) | ❌ |
| GB-163 | PT của t đâu rồi | READ_STATE(PT_STATUS) | READ_STATE(PT_STATUS) | ✅ |
| GB-164 | hợp đồng pt tôi đến đâu rồi | READ_STATE(CONTRACT_STATUS) | READ_STATE(CONTRACT_STATUS) | ✅ |