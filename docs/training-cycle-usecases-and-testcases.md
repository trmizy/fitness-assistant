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

## 2. Đặc tả chi tiết các Use Case

Mỗi use case được đặc tả theo mẫu: Tiền điều kiện / Hậu điều kiện / Actor
chính / Actor phụ / Basic flow (2 cột Actor↔System) / Alternative flow /
Exception.

### UC01 — Tạo chu kỳ tập luyện mới

| | |
|---|---|
| **Tiền điều kiện** | - Đăng nhập thành công.<br>- Người dùng đã có hồ sơ tập luyện (goal, thông số cơ thể).<br>- Không tồn tại chu kỳ nào của người dùng đang ở trạng thái ACTIVE (áp dụng khi tạo trực tiếp ở trạng thái ACTIVE). |
| **Hậu điều kiện** | Tạo được chu kỳ tập luyện mới. |
| **Actor chính** | Người dùng |
| **Actor phụ** | System |

**Basic flow**

| Người dùng | System |
|---|---|
| 1. Chọn chức năng **Tạo chu kỳ tập luyện**, nhập tên, thời lượng, chỉ tiêu (tuỳ chọn). | 2. Kiểm tra chưa có chu kỳ ACTIVE nào; lấy `goal` từ hồ sơ và bản ghi InBody gần nhất làm mốc bắt đầu.<br>3. Tạo chu kỳ mới, tự tăng số thứ tự chu kỳ, hiển thị thông báo tạo thành công. |

**Alternative flow**

A1. Người dùng chọn tạo ở trạng thái nháp (DRAFT) — hệ thống bỏ qua bước
kiểm tra chu kỳ ACTIVE, tạo ngay chu kỳ DRAFT, không gán InBody bắt đầu.

**Exception**

2.1 Đã tồn tại chu kỳ đang hoạt động

1. Hệ thống hiển thị thông báo lỗi "Đã có chu kỳ đang hoạt động."
2. Kết thúc use case.

---

### UC02 — Bắt đầu chu kỳ nháp (DRAFT → ACTIVE)

| | |
|---|---|
| **Tiền điều kiện** | - Đăng nhập thành công.<br>- Có ít nhất 1 chu kỳ ở trạng thái DRAFT thuộc về người dùng.<br>- Không có chu kỳ nào khác đang ACTIVE. |
| **Hậu điều kiện** | Chu kỳ chuyển sang trạng thái ACTIVE với ngày bắt đầu/kết thúc chính thức. |
| **Actor chính** | Người dùng |
| **Actor phụ** | System |

**Basic flow**

| Người dùng | System |
|---|---|
| 1. Chọn **Bắt đầu chu kỳ** trên một chu kỳ đang ở trạng thái nháp. | 2. Kiểm tra chu kỳ đang DRAFT và không có ACTIVE khác; lấy chỉ số InBody gần nhất làm mốc bắt đầu.<br>3. Cập nhật trạng thái ACTIVE, tính lại ngày bắt đầu/kết thúc tại thời điểm kích hoạt, hiển thị xác nhận. |

**Alternative flow**

Không có.

**Exception**

2.1 Chu kỳ không ở trạng thái DRAFT

1. Hệ thống hiển thị thông báo lỗi "Chỉ có thể bắt đầu chu kỳ ở trạng thái nháp."
2. Kết thúc use case.

2.2 Đã tồn tại chu kỳ ACTIVE khác

1. Hệ thống hiển thị thông báo lỗi "Đã có chu kỳ đang hoạt động."
2. Kết thúc use case.

---

### UC03 — Cập nhật thông tin chu kỳ

| | |
|---|---|
| **Tiền điều kiện** | - Đăng nhập thành công.<br>- Chu kỳ tồn tại và thuộc về người dùng.<br>- Chu kỳ đang ở trạng thái DRAFT hoặc ACTIVE. |
| **Hậu điều kiện** | Thông tin chu kỳ (tên / chỉ tiêu / cấu hình) được cập nhật. |
| **Actor chính** | Người dùng |
| **Actor phụ** | System |

**Basic flow**

| Người dùng | System |
|---|---|
| 1. Chọn **Sửa thông tin chu kỳ**, nhập tên/chỉ tiêu/cấu hình mới. | 2. Kiểm tra quyền sở hữu và trạng thái chu kỳ.<br>3. Cập nhật dữ liệu, hiển thị thông tin mới. |

**Alternative flow**

Không có.

**Exception**

2.1 Chu kỳ đã đóng (COMPLETED / ANALYZED)

1. Hệ thống hiển thị thông báo lỗi "Không thể sửa chu kỳ đã đóng."
2. Kết thúc use case.

---

### UC04 — Theo dõi tiến độ chu kỳ đang diễn ra

| | |
|---|---|
| **Tiền điều kiện** | - Đăng nhập thành công.<br>- Có chu kỳ đang ACTIVE (hoặc chỉ định một chu kỳ cụ thể). |
| **Hậu điều kiện** | Xem được tiến độ chu kỳ: tỉ lệ tuân thủ, volume tập luyện, xu hướng, cảnh báo. |
| **Actor chính** | Người dùng |
| **Actor phụ** | System |

**Basic flow**

| Người dùng | System |
|---|---|
| 1. Chọn chức năng **Xem tiến độ chu kỳ**. | 2. Tính toán (hoặc lấy từ cache) tỉ lệ tuân thủ, volume theo tuần, xu hướng sức mạnh/hồi phục, cảnh báo.<br>3. Hiển thị bảng tiến độ. |

**Alternative flow**

Không có.

**Exception**

2.1 Không có chu kỳ nào đang hoạt động

1. Hệ thống hiển thị thông báo "Bạn chưa có chu kỳ tập luyện nào đang diễn ra."
2. Kết thúc use case.

---

### UC05 — Ghi nhận buổi tập vào chu kỳ

| | |
|---|---|
| **Tiền điều kiện** | - Đăng nhập thành công.<br>- Có chu kỳ đang ACTIVE.<br>- Có lịch tập trong ngày. |
| **Hậu điều kiện** | Buổi tập được đánh dấu hoàn thành và gắn với chu kỳ đang hoạt động. |
| **Actor chính** | Người dùng |
| **Actor phụ** | System |

**Basic flow**

| Người dùng | System |
|---|---|
| 1. Thực hiện và hoàn thành các bài tập trong buổi tập (set/rep/weight). | 2. Ghi nhận tiến độ từng bài tập, tính % hoàn thành buổi tập.<br>3. Khi đạt 100%, cập nhật trạng thái buổi tập = COMPLETED, gắn với chu kỳ đang hoạt động, làm mới cache tiến độ. |

**Alternative flow**

A1. Không có chu kỳ ACTIVE nào tại thời điểm ghi nhận — buổi tập vẫn được
lưu bình thường nhưng không gắn với chu kỳ nào.

**Exception**

Không có.

---

### UC06 — Liên kết chỉ số InBody vào chu kỳ

| | |
|---|---|
| **Tiền điều kiện** | - Đăng nhập thành công.<br>- Chu kỳ tồn tại, đang ở trạng thái DRAFT hoặc ACTIVE.<br>- Có bản ghi đo InBody hợp lệ. |
| **Hậu điều kiện** | Bản ghi InBody được liên kết với chu kỳ, phục vụ tính xu hướng cơ thể. |
| **Actor chính** | Người dùng |
| **Actor phụ** | System |

**Basic flow**

| Người dùng | System |
|---|---|
| 1. Sau khi đo InBody, chọn **Liên kết vào chu kỳ hiện tại**. | 2. Kiểm tra bản ghi InBody và trạng thái chu kỳ hợp lệ.<br>3. Lưu liên kết (bỏ qua nếu đã liên kết trước đó), làm mới cache tiến độ. |

**Alternative flow**

Không có.

**Exception**

2.1 Chu kỳ đã đóng

1. Hệ thống hiển thị thông báo lỗi "Không thể liên kết số đo vào chu kỳ đã đóng."
2. Kết thúc use case.

---

### UC07 — Kết thúc chu kỳ (luồng nhanh)

| | |
|---|---|
| **Tiền điều kiện** | - Đăng nhập thành công.<br>- Chu kỳ đang ở trạng thái ACTIVE. |
| **Hậu điều kiện** | Chu kỳ chuyển COMPLETED rồi ANALYZED, có quyết định đề xuất (KEEP / ADJUST / NEW_PLAN). |
| **Actor chính** | Người dùng |
| **Actor phụ** | System |

**Basic flow**

| Người dùng | System |
|---|---|
| 1. Chọn **Kết thúc chu kỳ**. | 2. Tính chỉ số tổng kết (tuân thủ, volume, thay đổi InBody), chuyển trạng thái COMPLETED, trả kết quả ngay lập tức.<br>3. (Chạy nền) Gửi dữ liệu cho AI phân tích, nhận quyết định, cập nhật trạng thái ANALYZED. |

**Alternative flow**

A1. AI không phản hồi được — hệ thống tự áp dụng quy tắc mặc định theo xu
hướng tổng thể (không chặn use case).

**Exception**

2.1 Không tìm thấy chu kỳ hoặc chu kỳ không thuộc người dùng

1. Hệ thống hiển thị thông báo lỗi "Không tìm thấy chu kỳ."
2. Kết thúc use case.

---

### UC08 — Đánh giá chu kỳ nâng cao

| | |
|---|---|
| **Tiền điều kiện** | - Đăng nhập thành công.<br>- Chu kỳ tồn tại, không ở trạng thái DRAFT. |
| **Hậu điều kiện** | Một bản đánh giá mới (`CycleAssessment`) hoàn tất, chờ người dùng phản hồi (UC10). |
| **Actor chính** | Người dùng |
| **Actor phụ** | System (AI) |

**Basic flow**

| Người dùng | System |
|---|---|
| 1. Chọn **Đánh giá chu kỳ**. | 2. Tính số liệu deterministic: tỉ lệ tuân thủ, volume, 1RM, độ tin cậy dữ liệu InBody.<br>3. Decision Engine ra quyết định 1 trong 6 mức (KEEP / PROGRESS / ADJUST / DELOAD / REBUILD / INSUFFICIENT_DATA), kèm lý do rõ ràng.<br>4. AI chỉ diễn giải quyết định bằng ngôn ngữ tự nhiên — không được đổi quyết định.<br>5. Lưu kết quả thành bản đánh giá mới, gửi thông báo cho người dùng. |

**Alternative flow**

A1. Đang có một đánh giá chờ xử lý cho chu kỳ này — hệ thống trả về đánh
giá đó, không tính toán lại (đảm bảo idempotent), không tạo bản ghi mới.

**Exception**

3.1 Dữ liệu quá ít để đánh giá (chu kỳ quá ngắn, quá ít buổi tập, tỉ lệ
tuân thủ quá thấp, không đủ số liệu InBody so sánh được)

1. Hệ thống ghi nhận quyết định là "Chưa đủ dữ liệu" (INSUFFICIENT_DATA) kèm lý do cụ thể.
2. Kết thúc use case.

3.2 Phát hiện điểm đau cao hoặc xu hướng đau tăng liên tục

1. Hệ thống gắn cảnh báo an toàn vào kết quả, không đề xuất tăng tải dù các chỉ số khác tốt (xem UC13).
2. Tiếp tục use case ở bước 5.

---

### UC09 — Xem lịch sử đánh giá của một chu kỳ

| | |
|---|---|
| **Tiền điều kiện** | - Đăng nhập thành công.<br>- Chu kỳ tồn tại và thuộc về người dùng. |
| **Hậu điều kiện** | Xem được danh sách đánh giá hoặc đánh giá mới nhất. |
| **Actor chính** | Người dùng |
| **Actor phụ** | System |

**Basic flow**

| Người dùng | System |
|---|---|
| 1. Chọn **Xem lịch sử đánh giá**. | 2. Truy vấn danh sách đánh giá theo chu kỳ (có phân trang) hoặc đánh giá mới nhất.<br>3. Hiển thị kết quả. |

**Alternative flow**

Không có.

**Exception**

2.1 Chưa có đánh giá nào cho chu kỳ này

1. Hệ thống hiển thị thông báo "Chưa có đánh giá nào cho chu kỳ này."
2. Kết thúc use case.

---

### UC10 — Chấp nhận / Từ chối đề xuất của AI

| | |
|---|---|
| **Tiền điều kiện** | - Đăng nhập thành công.<br>- Đã có ít nhất một đánh giá hoàn tất, chưa được phản hồi (`userDecision = PENDING`). |
| **Hậu điều kiện** | Đề xuất được ghi nhận là đã chấp nhận hoặc từ chối; **không** có chu kỳ/plan mới nào được tự động tạo hay kích hoạt. |
| **Actor chính** | Người dùng |
| **Actor phụ** | System |

**Basic flow**

| Người dùng | System |
|---|---|
| 1. Xem đề xuất, chọn **Chấp nhận** hoặc **Giữ lịch hiện tại**. | 2. Kiểm tra đánh giá tồn tại và chưa được phản hồi.<br>3. Ghi nhận `userDecision` (ACCEPTED/REJECTED) và thời điểm phản hồi, hiển thị xác nhận. |

**Alternative flow**

Không có. *(Việc mở chu kỳ tiếp theo sau khi chấp nhận luôn là một bước
riêng, người dùng chủ động thực hiện ở UC01/UC02 — không tự động.)*

**Exception**

2.1 Đánh giá đã được phản hồi trước đó

1. Hệ thống hiển thị thông báo lỗi "Đề xuất này đã được xử lý."
2. Kết thúc use case.

---

### UC11 — Duyệt quyết định & mở chu kỳ tiếp theo (luồng nhanh)

| | |
|---|---|
| **Tiền điều kiện** | - Đăng nhập thành công.<br>- Chu kỳ ở trạng thái ANALYZED, đã có quyết định đề xuất. |
| **Hậu điều kiện** | Ghi nhận kế hoạch (`nextPlanId`) cho chu kỳ tiếp theo. |
| **Actor chính** | Người dùng |
| **Actor phụ** | System |

**Basic flow**

| Người dùng | System |
|---|---|
| 1. Xem đề xuất, chọn **Đồng ý — mở chu kỳ tiếp theo**. | 2. Kiểm tra chu kỳ đang ở trạng thái ANALYZED.<br>3. Ghi nhận kế hoạch tiếp theo vào chu kỳ. |

**Alternative flow**

Không có.

**Exception**

2.1 Chu kỳ chưa được phân tích xong

1. Hệ thống hiển thị thông báo lỗi "Chu kỳ cần được phân tích trước khi duyệt quyết định."
2. Kết thúc use case.

---

### UC12 — Xem lịch sử các chu kỳ đã qua

| | |
|---|---|
| **Tiền điều kiện** | Đăng nhập thành công. |
| **Hậu điều kiện** | Xem được danh sách các chu kỳ trước đó, sắp xếp theo ngày bắt đầu giảm dần. |
| **Actor chính** | Người dùng |
| **Actor phụ** | System |

**Basic flow**

| Người dùng | System |
|---|---|
| 1. Chọn chức năng **Lịch sử chu kỳ**. | 2. Truy vấn danh sách chu kỳ theo người dùng, sắp xếp theo ngày bắt đầu giảm dần.<br>3. Hiển thị danh sách. |

**Alternative flow**

Không có.

**Exception**

2.1 Chưa có chu kỳ nào được hoàn thành

1. Hệ thống hiển thị thông báo "Chưa có chu kỳ nào được hoàn thành."
2. Kết thúc use case.

---

### UC13 — Nhận cảnh báo an toàn khi có dấu hiệu đau/chấn thương

| | |
|---|---|
| **Tiền điều kiện** | - Đang thực hiện UC08 (Đánh giá chu kỳ nâng cao).<br>- Có dữ liệu điểm đau (`painScore`) được ghi nhận trong chu kỳ (qua phản hồi sau buổi tập). |
| **Hậu điều kiện** | Người dùng nhận được cảnh báo an toàn rõ ràng; không có đề xuất tăng tải nào được đưa ra. |
| **Actor chính** | System (AI) |
| **Actor phụ** | Người dùng |

**Basic flow**

| System | Người dùng |
|---|---|
| 1. Trong lúc tính toán đánh giá (UC08), phát hiện điểm đau cao hoặc xu hướng đau tăng liên tục qua nhiều buổi tập.<br>2. Gắn cờ cảnh báo an toàn vào kết quả đánh giá; chặn mọi đề xuất tăng tải bất kể chỉ số khác tốt thế nào; không tự chẩn đoán nguyên nhân. | 3. Xem cảnh báo trong kết quả đánh giá, được khuyến nghị dừng bài tập gây đau và tham khảo chuyên gia y tế/huấn luyện viên phù hợp. |

**Alternative flow**

Không có.

**Exception**

Không có — cảnh báo luôn được gắn kèm quyết định chính (UC08), không làm
gián đoạn luồng đánh giá.

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
