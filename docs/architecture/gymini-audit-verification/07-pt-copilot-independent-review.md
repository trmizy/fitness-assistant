# 07 — PT client management và Copilot

Ngày 2026-10-19 (Asia/Saigon). START_HEAD: 003545c6da8d524e8c4f6fbe4575444102f1fc50. Nhánh aws-deploy.

Bằng chứng: **CODE AUDIT / STATIC_CODE_VERIFIED** trong phạm vi từng trích đoạn; không có test chạy, REAL BROWSER, REAL HTTP/API, live runtime hay deployment verification. Định nghĩa test được đọc không tương đương UNIT_TEST_VERIFIED hoặc INTEGRATION_TEST_VERIFIED.

coach route→controller→service dùng client path và authenticated PT; service check active pair trước read/write. Active lookup qua user-service fail-closed khi lỗi; persistence assignment dùng clientUserId, không context thiết bị của PT (E19: `backend/services/fitness-service/src/services/coach.service.ts:38`; E20: `backend/services/fitness-service/src/services/coach.service.ts:314`; E21: `backend/services/fitness-service/src/services/coach.service.ts:464`; E23: `backend/services/fitness-service/src/routes/coach.routes.ts:1`; E49: `backend/services/fitness-service/src/clients/user.client.ts:307`; E50: `backend/services/user-service/src/repositories/contract.repository.ts:60`). Phạm vi này tốt, không chứng minh mọi endpoint PT/user/chat/gym/delegated tool không thể IDOR. Revocation giữa check và commit chưa có test.

Roster contract trả contract/profile/review; coach summary có per-client cycle/nutrition; tiến độ InBody/schedules và training/nutrition recommendation review đều có implementation. Không có aggregate adherence trong route contract được kiểm tra. Per-client API trả lời câu hỏi một học viên, không đủ làm dashboard roster bằng N+1 vô hạn.

| Use case | Status | Giới hạn |
| --- | --- | --- |
| Ai bỏ buổi tập? | PARTIALLY_SUPPORTED | Per-client schedules/summary có sẵn; roster-wide attention query chưa có. |
| Ai giảm adherence? | PARTIALLY_SUPPORTED | Metrics theo client có nền tảng; chưa có time-window trend batch contract. |
| Ai cần follow-up? | PARTIALLY_SUPPORTED | PT đọc dữ liệu và tự quyết; thiếu roster prioritization và missing-data semantics. |
| Ai thường hụt mục tiêu ăn? | PARTIALLY_SUPPORTED | Có goal/plan context; không coi meal plan-consistency là consumed-target adherence. |
| Chuẩn bị revision cá nhân? | PARTIALLY_SUPPORTED | Single-client generatePlanDraft và assignment thật; không có batch orchestration/individual confirm proven. |

Thiết kế đề xuất: user-service là authority contract/roster, fitness-service là authority schedules/logs/nutrition. Bounded batch projection trả window, timezone, asOf, completeness, workout adherence và nutrition actual-vs-target riêng. Relationship allowlist phải kiểm tra lại khi request/confirm/send; tool không nhận clientId tùy ý mà bỏ gate. Không cần thêm một authority tính toán số liệu ở ai-service.

Recommendation-only: xếp ưu tiên, giải thích evidence/freshness, soạn nội dung, draft revision. PT phải quyết định từng target/change trước apply; gửi tin cần explicit authorization tương ứng; không tự động nhắn hàng loạt. Một client fail không áp proposal của client khác. Audit phải lưu PT/client/source/action/version/outcome; audit hiện best-effort trong các sampled methods, chưa chứng minh durable consent guarantees.

Chưa truy vết đầy đủ: PT notes, communication room authorization, multiple-client aggregate ở mọi service khác, delegated tools ngoài fitness-agent-tools, full nutrition monitoring trend, batch consent, đồng thời revoke/confirm. Không lặp lại kết luận tuyệt đối “không có code path nào”.


**Communication/tool scope mới:** chat policy cho ACTIVE-like relationship HOẶC approved-PT discovery theo user-service, không giống coach ACTIVE-only. Chat create kiểm tra eligibility; get/send kiểm tra participant. Revocation contract không mặc định xóa quyền đọc lịch sử chat — đây cần policy theo communication, không áp nhầm invariant ACTIVE-only cho mọi message. E62/E63. Delegated LLM tools đọc caller personalization, không tùy ý đổi client (E59/E60); chưa chứng minh mọi business endpoint. PT draft prefilter injuries có implementation (E57/E58), nên là reusable building block có giới hạn.
