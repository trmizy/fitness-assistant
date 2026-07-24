# Use Case & Test Case — Chức năng Chu kỳ tập luyện (Training Cycle)

Bao gồm cả luồng nền tảng (v2 — `docs/training-cycle-v2.md`) và luồng đánh
giá nâng cao (`docs/adaptive-training-cycle-evaluation.md`). Actor chính:
**Người dùng (Client)**. Actor phụ: **AI System** (Decision Engine +
LLM giải thích, chạy tự động khi được Người dùng kích hoạt, không tự ý
hành động).

---

## 1. Sơ đồ Use Case (dạng danh sách)

```
                    ┌─────────────────────────────────────┐
                    │      Chức năng Chu kỳ tập luyện       │
                    │                                       │
   Người dùng ──────┼─ UC01 Tạo chu kỳ tập luyện            │
                    ├─ UC02 Bắt đầu chu kỳ (DRAFT→ACTIVE)   │
                    ├─ UC03 Cập nhật thông tin chu kỳ        │
                    ├─ UC04 Theo dõi tiến độ chu kỳ          │
                    ├─ UC05 Ghi nhận buổi tập vào chu kỳ     │
                    ├─ UC06 Liên kết chỉ số InBody           │
                    ├─ UC07 Kết thúc chu kỳ (nhanh)          │
                    ├─ UC08 Đánh giá chu kỳ (nâng cao) ──────┼──> AI System
                    ├─ UC09 Xem lịch sử đánh giá             │
                    ├─ UC10 Chấp nhận / Từ chối đề xuất      │
                    ├─ UC11 Duyệt quyết định & mở chu kỳ mới │
                    ├─ UC12 Xem lịch sử các chu kỳ           │
                    └─ UC13 Nhận cảnh báo an toàn (đau/CT) <─┼── AI System
                    └─────────────────────────────────────┘
```

| Mã | Tên Use Case | Actor | Endpoint thực tế |
|---|---|---|---|
| UC01 | Tạo chu kỳ tập luyện mới | Người dùng | `POST /training-cycles` |
| UC02 | Bắt đầu chu kỳ nháp (DRAFT → ACTIVE) | Người dùng | `POST /training-cycles/:id/start` |
| UC03 | Cập nhật thông tin chu kỳ | Người dùng | `PATCH /training-cycles/:id` |
| UC04 | Theo dõi tiến độ chu kỳ đang diễn ra | Người dùng | `GET /training-cycles/active`, `GET /:id/progress` |
| UC05 | Ghi nhận buổi tập vào chu kỳ | Người dùng | (gián tiếp qua module Workout, `WorkoutSchedule.trainingCycleId`) |
| UC06 | Liên kết chỉ số InBody vào chu kỳ | Người dùng | `POST /training-cycles/:id/inbody-links` |
| UC07 | Kết thúc chu kỳ (luồng nhanh, 3 quyết định) | Người dùng | `POST /training-cycles/:id/complete` |
| UC08 | Đánh giá chu kỳ nâng cao (6 quyết định) | Người dùng, AI System | `POST /training-cycles/:id/evaluate` |
| UC09 | Xem lịch sử đánh giá của một chu kỳ | Người dùng | `GET /:id/assessments`, `GET /:id/assessments/latest` |
| UC10 | Chấp nhận / Từ chối đề xuất của AI | Người dùng | `POST /:id/recommendation/accept`, `/reject` |
| UC11 | Duyệt quyết định & mở chu kỳ tiếp theo (luồng nhanh) | Người dùng | `POST /:id/approve` |
| UC12 | Xem lịch sử các chu kỳ đã qua | Người dùng | `GET /training-cycles` |
| UC13 | Nhận cảnh báo an toàn khi có dấu hiệu đau/chấn thương | AI System → Người dùng | `safetyFlags` trong kết quả UC08 |

---

## 2. Đặc tả chi tiết các Use Case chính

### UC01 — Tạo chu kỳ tập luyện mới

- **Actor:** Người dùng
- **Điều kiện tiên quyết:** Đã đăng nhập; không có chu kỳ nào đang `ACTIVE` (nếu tạo trực tiếp ở trạng thái `ACTIVE`).
- **Luồng chính:**
  1. Người dùng gọi tạo chu kỳ, có thể kèm `name`, `durationDays`, `targetMetrics`.
  2. Hệ thống tự tăng `cycleIndex`, lấy `goal` từ hồ sơ người dùng, tìm bản ghi InBody gần nhất làm mốc bắt đầu.
  3. Chu kỳ được tạo với trạng thái `ACTIVE` (mặc định) hoặc `DRAFT` (nếu chọn).
- **Luồng thay thế:** Nếu đã có chu kỳ `ACTIVE` khác và người dùng yêu cầu tạo trực tiếp `ACTIVE` → hệ thống từ chối (409), không tạo trùng.
- **Hậu điều kiện:** Một bản ghi `TrainingCycle` mới tồn tại, thuộc về đúng người dùng.

### UC08 — Đánh giá chu kỳ nâng cao

- **Actor chính:** Người dùng (kích hoạt), **Actor phụ:** AI System.
- **Điều kiện tiên quyết:** Chu kỳ tồn tại, không ở trạng thái `DRAFT`.
- **Luồng chính:**
  1. Người dùng bấm "Đánh giá chu kỳ".
  2. Hệ thống tính toán số liệu deterministic (adherence, volume, 1RM, độ tin cậy dữ liệu InBody...).
  3. Decision Engine ra quyết định trong 6 mức: KEEP / PROGRESS / ADJUST / DELOAD / REBUILD / INSUFFICIENT_DATA, kèm lý do (`reasonCodes`).
  4. AI System chỉ **giải thích** quyết định bằng ngôn ngữ tự nhiên — không được đổi quyết định.
  5. Kết quả lưu thành một bản ghi `CycleAssessment` mới (tăng version), người dùng nhận thông báo.
- **Luồng thay thế:**
  - Nếu đang có một đánh giá `PENDING` cho chu kỳ này → trả về đánh giá đó, không tính toán lại (đảm bảo idempotent).
  - Nếu dữ liệu quá ít (chu kỳ quá ngắn, quá ít buổi tập, adherence quá thấp, không đủ số liệu InBody so sánh được) → quyết định luôn là `INSUFFICIENT_DATA`.
  - Nếu phát hiện điểm đau cao/xu hướng đau tăng → gắn `safetyFlags`, không đề xuất tăng tải bất kể các chỉ số khác tốt thế nào.
- **Hậu điều kiện:** `CycleAssessment` mới ở trạng thái `COMPLETED` (hoặc `FAILED` nếu lỗi hệ thống), `userDecision = PENDING` chờ người dùng phản hồi (UC10).

### UC10 — Chấp nhận / Từ chối đề xuất của AI

- **Actor:** Người dùng
- **Điều kiện tiên quyết:** Đã có ít nhất một `CycleAssessment` ở trạng thái `COMPLETED`, `userDecision = PENDING`.
- **Luồng chính:** Người dùng chọn "Chấp nhận" hoặc "Giữ lịch hiện tại" (từ chối) → hệ thống ghi nhận `userDecision` + `reviewedAt`.
- **Ràng buộc quan trọng:** Hành động này **không** tự động tạo hay kích hoạt chu kỳ/lịch tập mới — việc mở chu kỳ tiếp theo luôn là một bước riêng, người dùng chủ động (UC01/UC02).
- **Luồng ngoại lệ:** Đánh giá đã được review trước đó (`userDecision != PENDING`) → từ chối thao tác lần 2 (409).

---

## 3. Bộ 20 Test Case

Ký hiệu trạng thái chu kỳ: `DRAFT` → `ACTIVE` → `COMPLETED` → `ANALYZED`
(luồng nhanh) hoặc `ACTIVE` → `COMPLETED` (luồng nâng cao, có thể đánh giá
nhiều lần).

| # | Test Case | Điều kiện tiên quyết | Các bước thực hiện | Kết quả mong đợi | Mức ưu tiên |
|---|---|---|---|---|---|
| TC01 | Tạo chu kỳ mới thành công (mặc định ACTIVE) | Người dùng chưa có chu kỳ ACTIVE nào | Gọi `POST /training-cycles` không kèm `status` | Trả về 201, chu kỳ có `status=ACTIVE`, `cycleIndex` tăng đúng, `startInbodyId` được gán nếu có InBody gần nhất | Cao |
| TC02 | Tạo chu kỳ ở trạng thái DRAFT | Người dùng đang có 1 chu kỳ ACTIVE khác | Gọi `POST /training-cycles` với `status: "DRAFT"` | Trả về 201 thành công (không bị chặn bởi chu kỳ ACTIVE khác vì DRAFT không cần kiểm tra xung đột), `startInbodyId = null` | Cao |
| TC03 | Tạo chu kỳ ACTIVE khi đã có chu kỳ ACTIVE khác | Đang có 1 chu kỳ ACTIVE | Gọi `POST /training-cycles` không kèm `status` | Trả về lỗi 409 "An active training cycle already exists" | Cao |
| TC04 | Bắt đầu chu kỳ DRAFT thành công | Có 1 chu kỳ DRAFT, không có chu kỳ ACTIVE nào khác | Gọi `POST /:id/start` | Trả về 200, `status=ACTIVE`, `startDate`/`endDate` được tính lại tại thời điểm kích hoạt (không phải lúc tạo) | Cao |
| TC05 | Bắt đầu chu kỳ DRAFT khi đang có chu kỳ ACTIVE khác | Có chu kỳ DRAFT + 1 chu kỳ ACTIVE khác | Gọi `POST /:id/start` trên chu kỳ DRAFT | Trả về lỗi 409, chu kỳ vẫn giữ nguyên DRAFT | Cao |
| TC06 | Bắt đầu chu kỳ không ở trạng thái DRAFT | Chu kỳ đang ACTIVE | Gọi `POST /:id/start` | Trả về lỗi 409 "Only a DRAFT cycle can be started" | Trung bình |
| TC07 | Cập nhật tên/target chu kỳ đang ACTIVE | Chu kỳ đang ACTIVE | Gọi `PATCH /:id` với `name`, `targetMetrics` mới | Trả về 200, các field được cập nhật đúng, các field khác không đổi | Trung bình |
| TC08 | Cập nhật chu kỳ đã đóng | Chu kỳ ở trạng thái COMPLETED hoặc ANALYZED | Gọi `PATCH /:id` | Trả về lỗi 409 "Cannot update a cycle that has already been closed" | Trung bình |
| TC09 | Xem tiến độ chu kỳ đang hoạt động | Chu kỳ ACTIVE, đã ghi một số buổi tập | Gọi `GET /training-cycles/active` | Trả về đúng `adherence`, `volumeByWeek`, `alerts` tính từ dữ liệu thật, không dùng cache | Cao |
| TC10 | Cache của `GET /:id/progress` hoạt động đúng | Chu kỳ có dữ liệu | Gọi `GET /:id/progress` 2 lần liên tiếp trong 120s | Lần 2 trả kết quả giống hệt lần 1 (từ cache); sau khi ghi buổi tập mới, gọi lại phải thấy dữ liệu mới (cache đã bị invalidate) | Trung bình |
| TC11 | Ghi buổi tập liên kết đúng vào chu kỳ | Chu kỳ ACTIVE | Hoàn thành 1 buổi tập trong thời gian chu kỳ | `WorkoutSchedule.trainingCycleId` trỏ đúng về chu kỳ; `adherenceRate` ở `GET /:id/progress` tăng tương ứng | Cao |
| TC12 | Liên kết InBody vào chu kỳ lần đầu | Chu kỳ ACTIVE, có bản ghi InBody hợp lệ | Gọi `POST /:id/inbody-links` với `inbodyEntryId` | Trả về 201, bản ghi `CycleInBodyLink` được tạo | Cao |
| TC13 | Liên kết InBody trùng lặp | Đã liên kết 1 InBody entry vào chu kỳ | Gọi lại `POST /:id/inbody-links` với cùng `inbodyEntryId` | Trả về 201, KHÔNG tạo bản ghi trùng, KHÔNG lỗi (idempotent) | Trung bình |
| TC14 | Kết thúc chu kỳ theo luồng nhanh | Chu kỳ ACTIVE | Gọi `POST /:id/complete` | Trả về `status=COMPLETED` ngay lập tức; sau vài giây, `GET /:id` cho thấy `status=ANALYZED` kèm `decision` (KEEP/ADJUST/NEW_PLAN) | Cao |
| TC15 | Đánh giá chu kỳ với dữ liệu quá ít | Chu kỳ mới tạo, chưa ghi buổi tập nào | Gọi `POST /:id/evaluate` | Trả về `decision=INSUFFICIENT_DATA`, `reasonCodes` liệt kê rõ lý do (ví dụ `CYCLE_TOO_SHORT`, `TOO_FEW_COMPLETED_SESSIONS`) | Cao |
| TC16 | Đánh giá chu kỳ với dữ liệu tiến bộ tốt | Chu kỳ đủ 28 ngày, adherence ≥70%, chỉ số cơ thể cải thiện theo mục tiêu | Gọi `POST /:id/evaluate` | Trả về `decision=KEEP` hoặc `PROGRESS` tuỳ mức độ tiến bộ, `confidenceScore` > 0.5 | Cao |
| TC17 | Gọi đánh giá 2 lần liên tiếp khi lần 1 chưa xong | Chu kỳ đủ điều kiện đánh giá | Gọi `POST /:id/evaluate` hai lần gần như đồng thời | Không tạo 2 bản ghi `CycleAssessment` cùng version; lệnh gọi thứ 2 trả về đúng bản ghi đang xử lý của lệnh thứ nhất | Cao |
| TC18 | Xem đánh giá mới nhất khi chưa từng đánh giá | Chu kỳ chưa gọi `/evaluate` lần nào | Gọi `GET /:id/assessments/latest` | Trả về lỗi 404 "No assessment found for this cycle" | Trung bình |
| TC19 | Chấp nhận đề xuất — không tự động áp dụng plan mới | Có `CycleAssessment` COMPLETED, `userDecision=PENDING` | Gọi `POST /:id/recommendation/accept` | Trả về 200, `userDecision=ACCEPTED`; kiểm tra lại chu kỳ: KHÔNG có chu kỳ mới nào được tự tạo, `nextPlanId` không tự động được gán | Cao |
| TC20 | Người dùng khác không thể truy cập/chấp nhận đề xuất của chu kỳ không thuộc về mình | Chu kỳ thuộc user A | User B (đã đăng nhập) gọi `GET /:id` hoặc `POST /:id/recommendation/accept` trên chu kỳ của user A | Trả về lỗi 404 (không lộ thông tin tồn tại của chu kỳ — theo đúng nguyên tắc ownership hiện có trong code) | Cao |

### Ghi chú bổ sung (test case dự phòng, không tính vào 20 case trên)

- Chấp nhận 2 lần trên cùng một đánh giá → 409 "This recommendation has already been reviewed".
- Chỉ số đau (`painScore`) cao hoặc xu hướng tăng liên tục → `safetyFlags` xuất hiện trong kết quả đánh giá, `decision` không được là `PROGRESS`.
- Chỉ có 1 lần đo InBody trong chu kỳ → `dataQualityScore` thấp, không kết luận chắc chắn về thay đổi cơ/mỡ.
- Hai chu kỳ liên tiếp đều không đạt mục tiêu → `decision=REBUILD` ở chu kỳ thứ 3.

---

## 4. Ánh xạ Test Case ↔ Test tự động đã có trong repo

Phần lớn logic nghiệp vụ cốt lõi (TC15–TC17, các nhánh quyết định, xử lý dữ
liệu InBody bất thường) đã có test tự động thật, chạy pass 100%:

- `backend/services/fitness-service/src/__tests__/cycle-decision.engine.test.ts` (17 test — tương ứng TC15, TC16 và các biến thể 6 trạng thái)
- `backend/services/fitness-service/src/__tests__/inbody-quality.evaluator.test.ts` (9 test — dữ liệu InBody bất thường/thiếu)
- `backend/services/fitness-service/src/__tests__/cycle-metrics.engine.test.ts` (25 test)
- `backend/services/fitness-service/src/__tests__/adaptive-cycle-evaluation.integration.test.ts` (9 bước — tương ứng TC01, TC04, TC11–TC14, TC13, TC17, TC19)
- `backend/services/ai-service/src/__tests__/cycle-assessment.test.ts` (9 test — hành vi AI System trong UC08)

TC03, TC05, TC06, TC08, TC10, TC18, TC20 hiện **chưa có bản automated
test riêng** — là các trường hợp phù hợp để bổ sung thêm nếu cần tăng độ
phủ (TC03/TC05/TC06/TC08 đã được xác minh thủ công qua `curl` trong phiên
làm việc xây dựng tính năng này — xem lịch sử commit — nhưng chưa có test
tự động tương ứng).
