# Gymini V2 Training Agent — điều kiện BẮT BUỘC trước P4 (live pilot) / P5 (bật cho người dùng)

> Chỉ lưu local (không push). Ghi ngày 2026-11-12. Không mở lại P2 offline (đã đóng: `c0f0a57c`, `8d53a712` trên `feature/ai-v2-agent`).

## Gate 1 — An toàn cho người dưới 18 tuổi

**Hiện trạng (VERIFIED BY CODE):** Training Agent chỉ kiểm tra an toàn trên câu hỏi (`safetyGuard.check`, có thêm bản bỏ dấu). Nó **không** áp chính sách vị thành niên theo tuổi trong hồ sơ như V1 (`resolveProfileAwareSafety` + `minor_safety_policy`), vì projection `get_profile_context` không trả tuổi.

**Phải làm trước P4/P5:**
- Lấy tuổi **đã xác minh** từ hồ sơ của user đã xác thực (phía server, không qua model); không bao giờ dùng tuổi do model suy đoán.
- Áp đúng chính sách V1: `minorAgeResult()` cho yêu cầu cá nhân/kế hoạch; câu hỏi kiến thức chung được trả lời kèm dòng giám sát.
- Tuổi mâu thuẫn (câu nói ≠ hồ sơ): ưu tiên an toàn — nếu một trong hai nguồn < 18 thì áp chính sách vị thành niên (giống `TurnFacts.minorProtected` của V1).
- Test: người dưới 18 tuổi (theo hồ sơ và theo câu nói) yêu cầu chương trình tập cá nhân → không nhận kế hoạch cá nhân; câu kiến thức chung → trả lời chung kèm giám sát; tuổi mâu thuẫn.

## Gate 2 — Quyền truy cập dữ liệu bài tập

**Hiện trạng (VERIFIED BY CODE):**
- `fitness-service` `POST /internal/exercises/muscle-profiles` (`internal.controller.ts::exerciseMuscleProfiles`) trả mọi `Exercise` theo id: `prisma.exercise.findMany({ where: { id: { in: ids } } })` — **không lọc** `source`, `ownerId`, `status`.
- Bảng `Exercise` **có** dữ liệu riêng: `source` = `"SYSTEM" | "USER_CUSTOM"` kèm `ownerId`, và `status` (`STAGING`, `REVIEW_REQUIRED`, `APPROVED`, `PUBLISHED`, `DEPRECATED`, `REJECTED`). Endpoint vì vậy **không** chỉ chứa dữ liệu công khai → cần lọc.
- V2 hiện chỉ giảm thiểu bằng quy tắc nguồn gốc ID (ID phải xuất hiện trong kết quả tool trước đó cùng lượt). Đây **không** phải là kiểm soát truy cập.

**Phải làm trước P4/P5:**
- Thực thi quyền tại ranh giới service: chỉ trả `source = SYSTEM` và `status = PUBLISHED`, hoặc `USER_CUSTOM` có `ownerId` = user đang yêu cầu (user lấy từ identity đã xác minh `x-user-id` của internal auth, không lấy từ body).
- ID không truy cập được: coi như không tồn tại (không phân biệt "của người khác" với "không có").
- Test: ID custom của user khác, ID STAGING/REJECTED, ID không tồn tại, trộn hợp lệ/không hợp lệ; caller V1 (`ai.worker.ts`, `fitness-agent-tools.ts`) không đổi hành vi với dữ liệu hợp lệ.
- Rà các endpoint đọc khác dùng ID do model cung cấp (`/exercises/:id/substitute`, `/exercises?search=`, `validate-plan-equipment`) theo cùng quy tắc.

## Trạng thái ngày 2026-11-13
- **Gate 1:** đã commit `fb1db825` trên `feature/ai-v2-agent` (gồm `minor-gate.ts` và 12 test).
  - **Còn 1 blocker:** reader tuổi mặc định đi qua `profileExtractor`, mà hàm này nuốt lỗi 403 và lỗi sự cố. Kết quả là "không có quyền" bị hiểu thành "chưa có tuổi".
- **Gate 2:** đã có commit tích hợp `3ae53605` (`integrate/rc3-muscle-authz`), xem `docs/release/v1.0.0-rc3/RC3-PREP-vi.md`. Chưa push, chưa deploy.

### Contract tối thiểu cho reader tuổi (blocker cuối của Gate 1, cần thay đổi tích hợp riêng)
| Trạng thái | Nghĩa | Xử lý yêu cầu cá nhân nhạy cảm |
|---|---|---|
| `PROFILE_OK` | Đọc được hồ sơ của user đã xác thực, có tuổi hợp lệ (số nguyên 1–120) | Theo tuổi (vị thành niên thì áp chính sách V1) |
| `AGE_UNKNOWN` | Đọc được hồ sơ nhưng không có tuổi đáng tin cậy (chưa có hồ sơ, hoặc tuổi trống/sai) | Giống V1 (không phải vị thành niên), trừ khi user tự nói tuổi dưới 18 |
| `PROFILE_ACCESS_DENIED` | 401/403 hoặc identity không khớp | **Fail closed**: từ chối tư vấn cá nhân, chỉ trả lời kiến thức chung với tool không cá nhân |
| `PROFILE_UNAVAILABLE` | Timeout, 5xx, lỗi mạng, response sai định dạng | **Fail closed** như trên |

- Không được gộp `PROFILE_ACCESS_DENIED` hoặc `PROFILE_UNAVAILABLE` vào `AGE_UNKNOWN`.
- Reader phải đọc nguồn hồ sơ đã xác thực (user-service, token của chính user) và trả lỗi có cấu trúc. Agent không được tự gọi một endpoint tùy ý; rule isolation tĩnh cấm `agent-v2` tự gọi HTTP.
- Cách làm đề xuất: thêm một hàm đọc có báo lỗi ở phía V1 (domain tool), rồi inject qua `TrainingAgentDeps.getVerifiedProfileAge`. Hiện `minor-gate.ts` đang gộp hai trạng thái cuối thành `FAILED`; có thể ánh xạ trực tiếp sang contract trên.

## Các điều kiện khác đã biết (không phải gate mới)
- V1 safety hotfix (`5c56ebce`, nhánh `hotfix/v1-safety-accent`) phải có trên nền V2 trước P4 (rebase V2 lên bản V1 có hotfix).
- P4 live chạy qua provider gate với trần call/USD do chủ dự án duyệt; Redis riêng cho mỗi lần chạy.
