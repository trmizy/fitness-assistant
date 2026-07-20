# Blocked / cần backend hỗ trợ thêm

Ghi theo yêu cầu "khi gặp lỗi không thể vượt qua sau 3 cách thử khác
nhau" và các điểm phụ thuộc backend chưa có — không phải lỗi thực thi,
mà là giới hạn API hiện tại.

## P7 — `POST /workouts` không có idempotency key / clientId

**Vấn đề**: `createWorkoutSchema` (`backend/services/fitness-service/src/models/fitness.models.ts`)
không có field nào để client gửi kèm một `clientId`/`idempotencyKey` mà
server có thể dùng để phát hiện + từ chối request trùng lặp. Điều này
quan trọng cho hàng đợi offline (P7): nếu app crash/mất mạng đúng lúc
giữa lúc server đã tạo workout thành công nhưng response chưa kịp về
tới client (hoặc chưa kịp xoá item khỏi queue local), lần retry tiếp
theo sẽ tạo ra một buổi tập bị trùng thật sự trên server — không có
cách nào để server tự phát hiện và từ chối.

**Đã thử/đánh giá 3 hướng**:
1. Kiểm tra `createWorkoutSchema` + `workout.service.ts::createWorkout` —
   xác nhận không có unique constraint nào theo (userId, date, name)
   hay field tương tự có thể tận dụng tạm làm khoá chống trùng.
2. Kiểm tra `WorkoutSchedule` (có `@@unique([userId, date])`) — không áp
   dụng được vì đây là bảng lịch, không phải bảng log thực tế
   (`Workout`), và một ngày có thể có nhiều `Workout` hợp lệ (VD: tập 2
   buổi/ngày).
3. Cân nhắc thêm field `notes` chứa clientId dạng chuỗi rồi client tự
   query lại để kiểm tra trùng trước khi tạo — bị loại vì đây là hack
   dữ liệu (lạm dụng field `notes` cho mục đích không phải của nó), dễ
   vỡ nếu người dùng cũng ghi ghi chú thật vào đó.

**Đề xuất backend** (chưa implement, ngoài phạm vi nhánh
`feature/mobile-app` — nhánh này chỉ code mobile theo đúng chỉ dẫn "chỉ
thêm, không đổi behavior cũ" của phần backend):
- Thêm `clientId String? @unique @map("client_id")` vào model `Workout`
  (nullable, để không phá dữ liệu cũ).
- `createWorkoutSchema` thêm `clientId: z.string().uuid().optional()`.
- `workoutService.createWorkout`: nếu có `clientId`, kiểm tra
  `prisma.workout.findUnique({ where: { clientId } })` trước — nếu đã
  tồn tại, trả về workout cũ (200) thay vì tạo mới (201), đúng ngữ nghĩa
  idempotent POST.

**Giải pháp tạm thời đã áp dụng ở mobile** (`src/offline/workoutQueue.ts`):
mỗi item trong hàng đợi vẫn có `clientId` (uuid, sinh bằng
`expo-crypto`) để định danh nội bộ trong SQLite, nhưng KHÔNG gửi lên
server (vì server sẽ bỏ qua field lạ). Chống trùng chỉ dựa vào: (1) xoá
item khỏi queue NGAY sau khi POST thành công, trước khi xử lý item tiếp
theo; (2) `syncQueuedWorkoutLogs()` có cờ `isSyncing` chặn chạy đồng
thời 2 lần (vd. user bấm "Đồng bộ ngay" đúng lúc NetInfo listener cũng
đang tự động sync). Rủi ro trùng thật sự chỉ còn ở đúng 1 khe hẹp: app
bị kill hoàn toàn (crash/OS kill) giữa lúc `submitWorkoutLog()` POST
thành công và `removeQueuedWorkoutLog()` chạy xong — chấp nhận được vì
tần suất cực thấp và hậu quả nhẹ (1 buổi tập log trùng, xoá tay được),
không đáng để build cơ chế phức tạp hơn khi chưa có server hỗ trợ thật.
