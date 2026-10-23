# Bàn giao partner — Codex #8: Workout/Nutrition có hiệu lực ngay khi PT giao

Trạng thái: **AUDITED — HANDOFF TO PARTNER — NOT IMPLEMENTED BY THIS TEAM** (PARTNER OWNED).
Nguồn: CODE AUDIT ngày 22/10/2026 trên HEAD `f43e049a`. Chưa chạy kiểm thử; dòng mã có thể lệch vài dòng.

## 1. Đường mã PT giao workout (fitness-service)

- `coach.service.ts:300` `createAndAssignPlan` → `workoutService.createManualProgram(clientUserId, input)`; controller `coach.controller.ts:78` truyền nguyên body.
- `replaceExisting` mặc định `true` (`fitness.models.ts:140`).
- Trong một transaction (`workout.service.ts:1663-1790`):
  - `:1716` **xóa mọi `WorkoutSchedule` chưa hoàn thành của khách** (`workoutId: null`), mọi ngày, mọi nguồn — kể cả lịch thuộc TrainingCycle của roadmap đang chạy.
  - `:1725-1727` **lưu trữ (archive) `WorkoutProgram` ACTIVE hiện tại**, bất kể khách tự tạo, AI tạo hay theo chu kỳ roadmap.
  - Tạo program ACTIVE mới + schedule gắn cycle qua `resolveScheduleTrainingCycleId`.
- Không có trạng thái nháp; `WorkoutProgram` không có cột nguồn PT (`sourceType` = "MANUAL").
- Dấu vết duy nhất: `CoachClientActionAudit` + thông báo best-effort SAU khi đổi (`coach.service.ts:325`). Khách không phủ quyết được.
- Web `AssignPlanModal.tsx` không cảnh báo sẽ thay giáo án hiện tại.

## 2. Nutrition (fitness-service)

- `coach.service.ts:~188-260` `modifyNutritionRecommendation` / `approveNutritionRecommendation` chỉ thao tác trên đề xuất PENDING có sẵn (PT không tự tạo mục tiêu mới).
- `applyNutritionReviewDecision` (`training-cycle.service.ts:396`) claim nguyên tử dòng PENDING → `nutritionRepository.upsertGoal`: goal ACTIVE cũ → SUPERSEDED, goal mới ACTIVE ngay.
- **Rủi ro:** nhánh PT sửa không truyền `goalMode` → mặc định `RECOMMENDED` → có thể **ghi đè chế độ CUSTOM** của khách (đọc mã, chưa kiểm thử).
- Approve không gửi thông báo; modify/reject có.
- `NutritionProgram` không bị PT đụng (vẫn dẫn xuất qua `sourceGoalId`).

## 3. Khác biệt với Roadmap

- Roadmap PT tạo là DRAFT, chỉ ACTIVE khi khách gọi `activateRoadmap` (`fitness-roadmap.service.ts:999`) — xem `docs/FITNESS_ROADMAP_PT_INTEGRATION_DESIGN.md:65-81`.
- Workout/Nutrition: có hiệu lực ngay — ghi là "hợp đồng sản phẩm hiện tại" trong `docs/GYMINI_PT_PERMISSION_MATRIX.md:43-66`, chưa có quyết định chủ dự án (D81 xếp "chưa chốt").
- Mẫu duy nhất "PT đề xuất → khách chấp nhận" đang có: `triggerDietBreakRecommendation` (`training-cycle.service.ts:1956`, CycleAssessment PENDING).

## 4. Phương án (partner quyết)

| | Nội dung | Công |
|---|---|---|
| A | Giữ hiệu lực ngay + rào chắn: 409 nếu khách có program ACTIVE / cycle có lịch, trừ khi PT xác nhận `replaceExisting:true`; cảnh báo trong modal; ghi program cũ vào audit để khôi phục; thông báo không im lặng | ~1 ngày, không đổi schema |
| B | PT tạo đề xuất (program PROPOSED, không archive, không tạo lịch); khách accept/decline (`POST /workouts/programs/:id/accept`) → archive + tạo lịch nguyên tử; PT sửa dinh dưỡng thành đề xuất PENDING khách chấp nhận | 4–6 ngày, có migration, web + mobile |
| C | Giữ nguyên, ghi rõ PT có quyền này trong quyết định | 0 |

Khuyến nghị của nhóm hiện tại: A ngay, B sau. Câu cần partner/chủ dự án chốt:
1. PT có được duyệt đề xuất dinh dưỡng AI thay khách?
2. PT sửa mục tiêu có giữ `goalMode` CUSTOM?
3. Đề xuất hết hạn sau bao lâu?
4. PT có được thay giáo án khách tự tạo?

## 5. Rủi ro dữ liệu & kiểm thử partner nên làm

- Xóa `WorkoutSchedule` của TrainingCycle roadmap → `WorkoutSchedule` là liên kết program↔cycle (nguồn sự thật theo CLAUDE.md); kiểm: roadmap đang chạy + PT giao bài → cycle còn lịch hợp lệ? CycleAssessment có bị lệch?
- Giáo án khách tự tạo bị archive không báo trước; kiểm khôi phục.
- CUSTOM goalMode bị đổi; kiểm trước/sau với goal CUSTOM.
- Đồng thời: PT giao bài trong lúc khách đang ghi buổi tập (schedule bị xóa giữa chừng).
- Nhãn bằng chứng: chạy trên DB `*_test` cô lập, REAL HTTP qua gateway, web + mobile.

## 6. Liên quan khác thuộc partner

- Codex #2 phía ai-service: `adminResolveRefund` (personalized-service) đánh dấu REFUNDED theo số yêu cầu, không theo số ledger thực trả — cần dùng `paid/unpaid` do payment-service trả về (nhóm hiện tại chỉ sửa payment-service).
- Codex #3 (`openDispute` chỉ từ trạng thái hợp lệ) đã được nhóm hiện tại sửa trong ai-service ở commit `86dec221` trước khi phân công lại — partner nên rà và tiếp quản.
- FH-5 (`activateAfterPayment` trả 409 NOT_ACTIVATABLE, `cancelOrder` ghi có điều kiện) đã sửa ở `2259f4c2` — partner tiếp quản.
- FH-4 cần một route nội bộ chỉ đọc trạng thái đơn cá nhân hóa trong ai-service (đặc tả sẽ gửi kèm khi có).

## 7. Codex #2 — phần ai-service (SHARED INTEGRATION, partner làm)

payment-service đã sửa ở `4d9dbacf`: `POST /internal/personalized-service/refund` chỉ dùng tiền của chính đơn; giữ các trường cũ (`refund`, `clawedBack`, `shortfall`) và THÊM `owed`, `paid`, `unpaid`, `obligationId` (khi `unpaid > 0`). `refund == paid`; `owed` = số yêu cầu. Khóa idempotency cũ phát lại kết quả cũ (không có `paid`) → coi như `paid = refund`, `unpaid = 0`.

Cần sửa trong `ai-service/src/services/personalized-service.service.ts` (`adminResolveRefund`):
- `:944` `newCumulative` phải cộng `paid`, không cộng số yêu cầu; `:945` `isFullyRefunded` tính lại theo đó.
- `:950-953` chỉ đặt `REFUNDED` / `APPROVED_FULL` khi `unpaid = 0`.
- `:956` ghi chú: "Đã hoàn Xđ; Yđ còn lại đang được đối soát" khi `unpaid > 0`.
- `:937` trần hoàn: tính cả phần OPEN chưa trả để admin không tạo nghĩa vụ trùng.
- `clients/payment.client.ts` (~:38): thêm các trường mới (tùy chọn).
- `:793` `cancelOrder` dùng giá mua (rủi ro thấp: chỉ hoàn đơn chưa giải ngân).

Bản sửa tham khảo (có kiểm thử, đã chạy xanh trên DB test rồi gỡ ra theo phân công): `docs/handoff/codex2-ai-service-reference.patch`.

**Điều kiện chặn tiền thật:** cho tới khi ai-service cập nhật, admin hoàn một đơn đã giải ngân sẽ cộng ví khách ít hơn (hoặc 0) nhưng đơn vẫn hiện "đã hoàn đủ". Sổ cái đúng (nghĩa vụ OPEN có trong trang Đối soát) nhưng thông tin cho khách sai → không dùng luồng hoàn đơn cá nhân hóa ở môi trường thật trước khi partner sửa.
