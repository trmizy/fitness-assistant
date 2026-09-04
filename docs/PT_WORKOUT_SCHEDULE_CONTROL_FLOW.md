# PT kiểm soát lịch tập của khách hàng

> Ngày tạo: 18/08/2026  
> Phạm vi: quan hệ PT-client, quyền xem/gán/sửa workout program và workout schedule theo gói khách đã mua.

## 1. Ý tưởng nghiệp vụ

Khi khách hàng thuê PT, lịch tập của khách không còn là luồng tự phục vụ hoàn
toàn. Nếu hợp đồng/gói dịch vụ cho phép, PT phải có quyền:

- xem khách đang theo chương trình tập nào;
- xem lịch tập theo ngày/tuần của khách;
- xem trạng thái từng buổi: chưa tập, đang tập, hoàn thành, bỏ qua, huỷ;
- xem feedback/RPE/đau/mệt mỏi nếu khách đã ghi;
- tạo và gán chương trình tập mới cho khách;
- sửa chương trình/lịch tập trong phạm vi gói;
- để lại ghi chú chuyên môn cho khách;
- theo dõi lịch sử thay đổi để audit khi có tranh chấp.

Nguyên tắc quan trọng: PT chỉ có quyền với khách có **Contract ACTIVE** và quyền
cụ thể phải dựa trên snapshot của gói tại thời điểm khách mua/ký hợp đồng.

## 2. Phân biệt hai loại lịch

Trong hệ thống hiện tại có hai khái niệm dễ bị lẫn:

```text
Lịch booking PT
  -> Session trong user-service
  -> dùng cho buổi gặp PT, xác nhận, đổi lịch, thanh toán/quota

Lịch tập workout của client
  -> WorkoutProgram / WorkoutProgramDay / WorkoutSchedule trong fitness-service
  -> dùng cho chương trình tập, ngày tập, bài tập, sets/reps, log hoàn thành
```

Yêu cầu mới nằm ở loại thứ hai: **PT kiểm soát workout program/schedule của
client**, không chỉ đặt lịch gặp PT.

## 3. Hiện trạng code đã có

Nền hiện tại đã đúng hướng:

- `Contract` trong user-service đã là source of truth cho quan hệ PT-client.
- `Contract.status === ACTIVE` đã được dùng để xác thực PT có quyền với client.
- fitness-service đã có `coachService.assertActivePtClientRelationship()`.
- PT đã có endpoint:
  - `GET /coach/clients/:clientId/summary`;
  - `POST /coach/clients/:clientId/plans`;
  - `POST /coach/clients/:clientId/plan-draft`.
- `PTClientDetail.tsx` đã có nút “Giao kế hoạch”.
- `AssignPlanModal.tsx` cho phép PT tạo/gán plan thủ công hoặc dùng AI draft.
- Có `CoachClientActionAudit` để ghi audit hành động PT.

Khoảng thiếu hiện tại:

- Gói PT chưa có capability rõ ràng như view-only, assign plan, edit plan.
- Contract chưa snapshot quyền can thiệp lịch tập của gói.
- PT chưa có UI xem trực tiếp calendar/workout schedule đầy đủ của client.
- PT chưa có endpoint riêng để sửa program/day/exercise/schedule của client.
- Chưa có gate “gói này có được sửa lịch hay chỉ được xem”.
- Chưa có version/audit đầy đủ cho mỗi lần PT sửa lịch.

## 4. Mô hình quyền theo gói

Đề xuất không hard-code theo tên gói như “Basic/Premium”, mà lưu capability rõ
ràng.

Ví dụ capability:

```json
{
  "canViewWorkoutSchedule": true,
  "canViewWorkoutLogs": true,
  "canViewFeedback": true,
  "canAssignWorkoutPlan": true,
  "canEditAssignedPlan": true,
  "canEditFutureSchedules": true,
  "canCancelFutureSchedules": false,
  "canUseAiDraft": true,
  "requiresClientApprovalForPlanChanges": false,
  "maxActiveAssignedPlans": 1
}
```

Gợi ý tier sản phẩm:

| Gói | Quyền |
|---|---|
| Theo dõi cơ bản | PT xem lịch, log, feedback; không sửa |
| Coaching tiêu chuẩn | PT xem + gán plan mới; sửa plan do PT gán |
| Coaching nâng cao | PT xem + gán + sửa lịch tương lai + dùng AI draft |
| Online check-in | PT xem log/feedback và đề xuất thay đổi; client duyệt trước khi apply |

## 5. Schema cần bổ sung

### user-service

`PTServicePackage` nên có field:

```text
workoutControlCapabilities Json?
```

`Contract` nên snapshot field:

```text
workoutControlSnapshot Json?
```

Lý do snapshot: nếu PT sửa package sau này, hợp đồng đã ký của khách không bị
đổi quyền âm thầm.

### fitness-service

Nên bổ sung metadata cho `WorkoutProgram`:

```text
assignedByPtUserId String?
assignmentContractId String?
assignmentSource String // CLIENT_SELF | AI_SELF | PT_ASSIGNED | MARKETPLACE
requiresClientApproval Boolean
clientApprovalStatus String? // PENDING | ACCEPTED | REJECTED
```

Nếu không muốn sửa schema ngay, có thể bắt đầu bằng audit metadata trong
`CoachClientActionAudit`, nhưng về lâu dài nên có cột chính thức để query.

## 6. Backend flow đề xuất

### Xem lịch tập client

```text
PT request
  -> authMiddleware
  -> coachService.assertActivePtClientRelationship(ptUserId, clientUserId)
  -> fetch contract capability snapshot từ user-service
  -> nếu canViewWorkoutSchedule=false: 403
  -> fitness-service đọc WorkoutProgram/WorkoutSchedule của client
  -> ghi CoachClientActionAudit: VIEW_CLIENT_WORKOUT_SCHEDULE
  -> trả data cho PT UI
```

Endpoint đề xuất:

```text
GET /coach/clients/:clientId/workout-program
GET /coach/clients/:clientId/workout-schedules
```

### Gán plan cho client

```text
PT submit plan
  -> check Contract ACTIVE
  -> check canAssignWorkoutPlan
  -> validate exercise IDs, ngày tập, lịch tương lai
  -> archive/replace incomplete schedules theo rule hiện có
  -> create WorkoutProgram + WorkoutSchedule cho client
  -> set assignedByPtUserId / assignmentContractId
  -> audit CREATE_AND_ASSIGN_PLAN
```

Endpoint hiện có:

```text
POST /coach/clients/:clientId/plans
```

Cần bổ sung: check capability từ contract snapshot.

### Sửa plan/lịch client

```text
PT edit
  -> check Contract ACTIVE
  -> check canEditAssignedPlan hoặc canEditFutureSchedules
  -> chỉ cho sửa plan do chính PT/gói này gán, trừ khi gói cho phép takeover
  -> không sửa workout đã completed/logged
  -> chỉ sửa schedule tương lai hoặc hôm nay nếu chưa completed
  -> ghi audit trước/sau
```

Endpoint đề xuất:

```text
PATCH /coach/clients/:clientId/programs/:programId
PATCH /coach/clients/:clientId/program-days/:dayId
POST  /coach/clients/:clientId/program-days/:dayId/exercises
PATCH /coach/clients/:clientId/program-exercises/:exerciseId
DELETE /coach/clients/:clientId/program-exercises/:exerciseId
PATCH /coach/clients/:clientId/schedules/:scheduleId
DELETE /coach/clients/:clientId/schedules/:scheduleId
```

Các endpoint này nên gọi lại service logic hiện có của `workoutService`, nhưng
đưa `clientUserId` làm owner thay vì `req.user.id`, sau khi đã pass quyền PT.

## 7. Quy tắc an toàn

- Không sửa lịch đã có workout log hoàn thành.
- Không xoá bài cuối cùng trong một ngày tập.
- Không gán exercise ID ngoài catalog.
- Không gán lịch vào ngày quá khứ.
- Không sửa plan của client nếu contract đã CANCELLED/EXPIRED/COMPLETED.
- Không cho frontend tự gửi capability; backend luôn đọc từ Contract snapshot.
- Mọi hành động PT phải ghi audit.
- Nếu gói yêu cầu client approval, plan/sửa đổi phải ở trạng thái pending trước
  khi active.

## 8. UI đề xuất

Trong `PTClientDetail` nên có thêm tab/khu vực:

```text
Tổng quan
Lịch booking PT
Lịch tập của khách
Feedback & tiến độ
Kế hoạch được giao
```

Tab “Lịch tập của khách” nên hiển thị:

- active program hiện tại;
- lịch tuần/tháng;
- trạng thái từng buổi;
- bài tập trong từng ngày;
- feedback sau buổi;
- nút “Gán plan”, “Sửa plan”, “Sửa lịch tương lai” theo quyền gói.

Nếu quyền không đủ, UI hiển thị read-only và giải thích:

```text
Gói hiện tại chỉ cho phép PT theo dõi lịch tập, không cho phép sửa trực tiếp.
```

## 9. Test cần có

Backend:

- PT không có contract ACTIVE xem client schedule → 403.
- PT có contract ACTIVE nhưng gói view-only gán plan → 403.
- PT có quyền assign gán plan thành công.
- PT có quyền edit sửa future schedule thành công.
- PT không được sửa completed workout schedule.
- Contract bị cancel sau khi PT mở trang thì request sửa tiếp theo → 403.
- Mỗi view/write action tạo audit row.

Frontend:

- PTClientDetail hiển thị schedule client khi có quyền view.
- Nút gán/sửa bị ẩn hoặc disabled theo capability.
- AssignPlanModal submit thành công refresh schedule.
- Khi backend trả 403, UI hiện lý do quyền gói.

## 10. Kết luận

Thiết kế đúng là:

```text
PTServicePackage định nghĩa quyền
  -> Contract snapshot quyền khi khách mua/ký
  -> fitness-service check Contract ACTIVE + capability mỗi request
  -> PT xem/gán/sửa workout schedule theo quyền
  -> mọi thay đổi được audit
```

Như vậy hệ thống phản ánh đúng nghiệp vụ: khách thuê PT thì PT có quyền quản lý
lịch tập trong phạm vi gói đã mua, nhưng vẫn an toàn, audit được và không phụ
thuộc vào dữ liệu frontend tự khai.
