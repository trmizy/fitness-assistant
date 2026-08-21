# QA REMAINING ISSUES — Personalized PT Service Marketplace

**Ngày tổng hợp:** 17/08/2026  
**Nguồn:** FINAL MARKETPLACE ENGINEERING REPORT  
**Phạm vi:** Financial Lifecycle / Refund / Chat / Weekly Check-in / Plan Versioning / Review / Admin Refund UI

---

## 1. Tổng quan

Theo báo cáo kiểm thử cuối cùng:

- Backend automated tests: **396/396 PASS**
- Browser E2E: **20/20 PASS**
- FAIL cuối cùng: **0**
- BLOCKED: **0**
- P0 đang mở: **0**
- P1 đang mở: **3**
- Ngoài ra còn một số P2/P3 và rủi ro CI/E2E.

> Lưu ý quan trọng: báo cáo hiện tại **không ghi nhận bug chức năng P0/P1 nào đang khiến luồng nghiệp vụ chính chạy sai**. Các mục còn lại chủ yếu là **production gap / missing capability / technical risk**. Không nên gọi tất cả các mục dưới đây là "bug sản phẩm" nếu cần báo cáo chính xác.

---

# 2. P1 — Personalized Service chưa có Escrow / Held Funds thật

## Mã lỗi
`P1-FIN-001`

## Mức độ
**P1 — Critical production gap**

## Trạng thái
**OPEN**

## Thành phần
- payment-service
- ai-service
- Personalized Service Purchase
- Wallet / Ledger
- Refund lifecycle

## Mô tả

Khi khách hàng mua Personalized PT Service, tiền hiện được chuyển trực tiếp vào bucket `AVAILABLE` của PT.

Hệ thống payment-service đã có cơ chế:

- `wallets.pending_balance`
- `wallet_ledger_entries.bucket`
- ví `PLATFORM/ESCROW`

nhưng cơ chế escrow hiện mới được áp dụng cho:

- `PT_CONTRACT`
- `GYM_MEMBERSHIP`

Personalized Service Purchase vẫn sử dụng luồng `wallet-transfer` tổng quát, tương tự Training Package Purchase.

Kết quả là tiền của khách **không được giữ tạm** trước khi PT hoàn thành các milestone.

## Hiện trạng thực tế

```text
Customer pays
    ↓
PERSONALIZED_SERVICE_PURCHASE
    ↓
PT AVAILABLE balance
```

Thay vì:

```text
Customer pays
    ↓
PLATFORM / ESCROW
    ↓
PT PENDING balance
    ↓
Milestone completed
    ↓
Release amount
    ↓
PT AVAILABLE balance
```

## Cách tái hiện

1. Customer mua một Personalized Service.
2. Thanh toán thành công.
3. Kiểm tra wallet/ledger của PT.
4. Quan sát tiền mua dịch vụ được chuyển vào `AVAILABLE`.
5. Không tồn tại trạng thái giữ tiền tương ứng cho Personalized Service.
6. Tiếp tục qua các milestone:
   - Intake
   - Draft delivered
   - Accepted
   - Completed
7. Không có giao dịch release tiền từ escrow theo milestone.

## Expected

Tiền phải được giữ trong escrow/PENDING sau khi khách thanh toán.

Chỉ khi milestone tương ứng hoàn thành, một phần hoặc toàn bộ tiền mới được giải phóng cho PT.

## Actual

Tiền chuyển trực tiếp vào balance khả dụng của PT ngay sau purchase.

## Ảnh hưởng

### Financial risk

Nếu PT đã nhận toàn bộ tiền nhưng customer yêu cầu refund, hệ thống phải thực hiện giao dịch hoàn ngược lại thay vì giải phóng phần tiền chưa thuộc về PT.

### Dispute handling

Không thể xác định chính xác:

- tiền còn đang giữ;
- tiền đã release;
- tiền PT thực sự được hưởng;
- số tiền refund nên tự động tính theo milestone.

### Scaling

Ở quy mô lớn, admin phải xử lý refund bằng quyết định thủ công.

Điều này không phù hợp khi số lượng giao dịch tăng cao.

### Auditability

Không có ledger rõ ràng dạng:

```text
HELD
RELEASED
REFUNDED
```

riêng cho Personalized Service.

## Root cause

Domain Personalized Service chưa được tích hợp với escrow ledger hiện có.

Payment service đã có implementation tương tự tại:

- `contract-ledger.service.ts`
- `membership-ledger.service.ts`

nhưng chưa có:

```text
personalized-service-ledger.service.ts
```

## Hướng sửa đề xuất

Tạo ledger riêng cho Personalized Service theo mẫu hiện có.

Ví dụ:

```text
personalized-service-ledger.service.ts
```

Các action tối thiểu:

```text
holdPersonalizedServicePayment()
releasePersonalizedServiceMilestone()
refundHeldPersonalizedServiceFunds()
getPersonalizedServiceLedgerSummary()
```

Purchase flow:

```text
PERSONALIZED_SERVICE_PURCHASE
        ↓
ESCROW / PENDING
```

Không chuyển trực tiếp vào `AVAILABLE`.

## Acceptance Criteria

- [ ] Purchase không tăng trực tiếp `AVAILABLE` của PT.
- [ ] Purchase tạo ledger entry vào escrow/PENDING.
- [ ] Tổng tiền HELD khớp `priceAtPurchase`.
- [ ] Release có idempotency.
- [ ] Refund không thể vượt `HELD + RELEASED refundable amount`.
- [ ] Ledger có thể audit toàn bộ lifecycle.
- [ ] Retry request không double-release.
- [ ] Concurrent request không double-release.
- [ ] Browser E2E xác minh purchase → hold → release → refund.
- [ ] DB verification xác minh chính xác bucket và transaction status.

---

# 3. P1 — Chưa có Milestone-Based Release

## Mã lỗi
`P1-FIN-002`

## Mức độ
**P1 — High production gap**

## Trạng thái
**OPEN**

## Phụ thuộc
Phụ thuộc trực tiếp vào `P1-FIN-001`.

## Mô tả

Hệ thống hiện có các milestone nghiệp vụ:

- Intake submitted/reviewed
- Draft delivered
- Plan accepted
- Completed

Nhưng các milestone này hiện chỉ phản ánh trạng thái nghiệp vụ.

Chúng **không làm thay đổi trạng thái tiền**.

## Cách tái hiện

1. Customer mua service.
2. Customer gửi Intake.
3. PT giao Draft v1.
4. Customer yêu cầu sửa.
5. PT giao Draft v2.
6. Customer Accept.
7. Customer Complete.
8. Theo dõi financial ledger sau từng bước.

## Expected

Mỗi milestone có thể kích hoạt release dựa theo rule/config.

Ví dụ minh họa:

```text
Purchase              → 100% HELD
Intake reviewed       → release 10%
Draft delivered       → release 30%
Accepted              → release 40%
Completed             → release 20%
```

Tỷ lệ cụ thể phải lấy từ business configuration, không hard-code nếu product chưa chốt.

## Actual

Milestone chỉ thay đổi order/domain state.

Không có held/released balance tương ứng.

## Ảnh hưởng

- Refund không thể tự động dựa trên công việc đã hoàn thành.
- Admin phải tự phán đoán số tiền PT "xứng đáng" nhận.
- Dễ xảy ra dispute.
- Không scale tốt.
- Không có financial state machine đầy đủ.

## Root cause

Escrow chưa được tích hợp với Personalized Service.

## Hướng sửa

Thiết kế một financial state machine riêng.

Ví dụ:

```text
PURCHASED
  ↓
FUNDS_HELD
  ↓
PARTIALLY_RELEASED
  ↓
FULLY_RELEASED
```

Refund có thể đi từ:

```text
FUNDS_HELD → REFUNDED
PARTIALLY_RELEASED → PARTIAL_REFUND
```

## Acceptance Criteria

- [ ] Milestone release dựa trên config.
- [ ] Không hard-code business percentage nếu chưa được product xác nhận.
- [ ] Một milestone không release hai lần.
- [ ] Milestone out-of-order bị reject.
- [ ] Có transaction/ledger record cho mỗi lần release.
- [ ] Có audit metadata: orderId, milestone, amount, timestamp.
- [ ] Refund calculation đọc dữ liệu ledger thật.
- [ ] Tests bao gồm retry và concurrent execution.

---

# 4. P1 — PT Reputation đã có Backend nhưng chưa hiển thị UI

## Mã lỗi
`P1-UI-001`

## Mức độ
**P1 — Product completeness**

## Trạng thái
**OPEN**

## Thành phần

Backend method đã tồn tại:

```text
getSellerReviewSummary
```

Dữ liệu:

```text
averageRating
reviewCount
```

Nhưng dữ liệu này chưa được nối vào:

- `PTProfilePage.tsx`
- Personalized Service listing/card

## Mô tả

Customer có thể đánh giá PT sau khi service COMPLETED.

Backend cũng đã tính được reputation summary.

Tuy nhiên buyer mới chưa nhìn thấy reputation đó trước khi mua.

## Cách tái hiện

1. Hoàn thành Personalized Service.
2. Customer đánh giá PT 5 sao.
3. Backend có review.
4. Gọi summary backend và xác nhận có:
   - averageRating
   - reviewCount
5. Truy cập PT Profile hoặc Marketplace listing.
6. Rating không xuất hiện.

## Expected

Marketplace card/Profile hiển thị tối thiểu:

```text
★ 4.8 (27 đánh giá)
```

Nếu chưa có review:

```text
Chưa có đánh giá
```

## Actual

Không hiển thị reputation summary trên UI công khai.

## Ảnh hưởng

- Buyer thiếu tín hiệu tin cậy trước khi mua.
- Review feature chưa tạo đủ giá trị marketplace.
- Khó phân biệt PT tốt và PT mới.
- Giảm conversion/marketplace trust.

## Hướng sửa

Tích hợp API review summary vào:

```text
PTProfilePage.tsx
PersonalizedServiceCard
```

Nên tránh N+1 API request nếu listing có nhiều PT.

Ưu tiên backend trả summary cùng listing hoặc hỗ trợ batch query.

## Acceptance Criteria

- [ ] PT Profile hiển thị rating.
- [ ] Marketplace card hiển thị rating.
- [ ] Hiển thị reviewCount.
- [ ] Trạng thái chưa có review được xử lý đúng.
- [ ] Không gây N+1 request nghiêm trọng.
- [ ] Rating được cập nhật sau khi review thành công.
- [ ] Không cho seller tự tăng rating bằng self-review.
- [ ] Browser E2E xác minh review → profile/listing cập nhật.

---

# 5. P2 — Chat chưa có SYSTEM Message theo sự kiện nghiệp vụ

## Mã lỗi
`P2-CHAT-001`

## Mức độ
**P2**

## Trạng thái
**OPEN**

## Mô tả

Chat hiện hoạt động hai chiều:

```text
Customer ↔ PT
```

Tin nhắn TEXT hoạt động và được giữ sau refresh.

Tuy nhiên chưa có message tự động khi order thay đổi trạng thái.

Ví dụ chưa có:

```text
PT đã gửi kế hoạch phiên bản v2
Khách hàng đã yêu cầu chỉnh sửa
Khách hàng đã chấp nhận kế hoạch
Khách hàng đã gửi Weekly Check-in
Đơn hàng đã hoàn thành
Yêu cầu hoàn tiền đã được tạo
```

## Expected

Chat timeline nên phản ánh những sự kiện quan trọng của order.

## Actual

Chat chỉ chứa message do người dùng tự nhập.

## Ảnh hưởng

- Người dùng khó theo dõi lịch sử.
- Context giữa chat và order bị tách rời.
- Support/debug dispute khó hơn.
- PT/customer phải tự thông báo trạng thái.

## Hướng sửa

Thêm message type:

```text
TEXT
SYSTEM
```

SYSTEM message phải do backend tạo, không cho client giả mạo.

Ví dụ event:

```text
PLAN_VERSION_DELIVERED
REVISION_REQUESTED
PLAN_ACCEPTED
CHECKIN_SUBMITTED
ORDER_COMPLETED
REFUND_REQUESTED
REFUND_RESOLVED
```

## Acceptance Criteria

- [ ] Client không thể tự gửi SYSTEM message.
- [ ] Backend phát SYSTEM event đúng một lần.
- [ ] Retry không tạo message duplicate.
- [ ] SYSTEM messages render khác TEXT.
- [ ] Không làm lộ dữ liệu nhạy cảm.
- [ ] E2E xác minh các event chính.

---

# 6. P2 — HYBRID_COACHING / Booking Session chưa tích hợp

## Mã lỗi
`P2-DOMAIN-001`

## Mức độ
**P2**

## Trạng thái
**OPEN / NOT IMPLEMENTED**

## Mô tả

Luồng Personalized Service hiện đã hỗ trợ luồng coaching chính, nhưng `HYBRID_COACHING` chưa được tích hợp sâu với booking/session domain.

## Expected

Nếu service type là HYBRID, order phải có khả năng liên kết với:

- PT session
- booking
- lịch
- trạng thái buổi tập
- cancellation/reschedule rules

## Actual

Chưa có domain integration đầy đủ.

## Ảnh hưởng

- HYBRID service có thể được biểu diễn ở UI nhưng chưa có lifecycle thực tế hoàn chỉnh.
- Không nên quảng bá như một production feature hoàn thiện.

## Acceptance Criteria

- [ ] Order liên kết được booking/session.
- [ ] Authorization đúng buyer/PT.
- [ ] Không double-book.
- [ ] Cancellation/reschedule được định nghĩa rõ.
- [ ] Session completion có thể ảnh hưởng milestone nếu business yêu cầu.
- [ ] Browser E2E full flow.

---

# 7. P3 — Chưa có Free Plan → PT Service Funnel

## Mã lỗi
`P3-GROWTH-001`

## Mức độ
**P3**

## Trạng thái
**OPEN**

## Mô tả

Free Plan detail hiện chưa có CTA dẫn customer sang Personalized PT Service.

Ví dụ CTA:

```text
Xem dịch vụ PT
Thuê PT cá nhân hóa kế hoạch này
```

## Ảnh hưởng

Không ảnh hưởng correctness.

Ảnh hưởng chủ yếu:

- conversion;
- discoverability;
- marketplace funnel.

## Acceptance Criteria

- [ ] Có CTA phù hợp ở Free Plan.
- [ ] CTA dẫn đúng marketplace/filter.
- [ ] Không làm user hiểu nhầm free plan bắt buộc phải trả phí.

---

# 8. Technical Risk — Rate Limiter gây flaky CI/E2E

## Mã
`RISK-QA-001`

## Mức độ
**Technical Risk**

## Trạng thái
**OPEN / NEEDS CI HARDENING**

## Thông số đã ghi nhận trong báo cáo

```text
Auth rate limit:     20 / 15 phút
General rate limit: 100 / phút
```

## Mô tả

Khi Playwright E2E được chạy lặp lại nhiều lần trong thời gian ngắn, test đã chạm rate limiter.

Rate limiter hoạt động đúng về mặt security.

Vấn đề nằm ở môi trường QA/CI:

- nhiều spec chạy song song;
- login lặp lại;
- retry;
- test setup gọi API nhiều lần.

Có thể khiến test fail dù product không bị lỗi.

## Cách tái hiện

1. Chạy nhiều E2E spec liên tục.
2. Cho các worker cùng login.
3. Lặp suite nhiều lần.
4. Quan sát response 429.

## Expected trong CI

Test có môi trường/cơ chế xác thực phù hợp để rate-limit production không gây flaky suite.

## Actual

Có khả năng chạm threshold khi chạy dày.

## Không nên sửa bằng cách

Không nên đơn giản:

```text
disable toàn bộ rate limiter
```

trong production.

## Hướng sửa

Các lựa chọn an toàn:

1. CI/test environment có rate-limit config riêng.
2. Reuse authenticated `storageState`.
3. Seed token/test user thay vì login liên tục.
4. Giảm worker cho các spec auth-heavy.
5. Tách auth rate-limit tests khỏi business E2E.
6. Xác minh rate limiter vẫn được test riêng.

## Acceptance Criteria

- [ ] Full E2E chạy lặp tối thiểu 3 lần không flaky do 429.
- [ ] Parallel CI không vượt threshold ngoài chủ đích.
- [ ] Production rate limiter vẫn bật.
- [ ] Có test riêng xác minh 429 đúng khi thật sự abuse.

---

# 9. Những bug đã phát hiện nhưng ĐÃ ĐÓNG

Các mục dưới đây không còn là bug open nhưng cần giữ lại để tránh regression.

---

## CLOSED — Frontend sập do dependency không đồng bộ sau Git merge

### Mã
`REG-INFRA-001`

### Triệu chứng

Vite error:

```text
Failed to resolve import '@capacitor/preferences'
Failed to resolve import '@capacitor/app'
jsqr
```

### Root cause

Git merge thêm dependency vào `package.json`, nhưng Docker web container chỉ bind-mount `src/`.

`node_modules` và package metadata vẫn nằm trong image cũ.

### Fix đã thực hiện

```bash
docker compose build web
docker compose up -d --no-deps web
```

### Regression requirement

- [ ] Khi `package.json` / lockfile đổi, CI/dev image phải rebuild.
- [ ] Health check frontend sau rebuild.

---

## CLOSED — Playwright storageState authentication bị hỏng

### Mã
`REG-QA-002`

### Root cause

Token storage chuyển sang `@capacitor/preferences`.

Web Preferences prefix key bằng:

```text
CapacitorStorage.
```

Test cũ ghi:

```text
accessToken
```

trong khi app đọc:

```text
CapacitorStorage.accessToken
```

### Fix đã thực hiện

Đã sửa:

```text
fixtures/authState.ts
17-personalized-service-marketplace.spec.ts
18-personalized-service-lifecycle-extended.spec.ts
```

### Regression requirement

- [ ] Auth fixture phải dùng cùng storage abstraction với app.
- [ ] Có smoke test xác minh fixture đăng nhập được.

---

## CLOSED — DraftView hiển thị UUID bài tập

### Mã
`REG-UI-003`

### Triệu chứng

Customer nhìn thấy exercise UUID thay cho tên bài tập.

### Fix

Đã resolve exercise IDs bằng:

```text
workoutService.getExercisesByIds
```

### Regression requirement

- [ ] UI không render raw UUID trong draft.
- [ ] Exercise missing phải có fallback hợp lý.

---

# 10. Trường hợp KHÔNG phải bug

## Chat Customer → Approved PT trước khi mua

Test ban đầu giả định:

```text
Customer lạ không được chat với PT lạ
```

Nhưng policy hiện có `BR-29` cho phép:

```text
CUSTOMER → APPROVED PT
```

trước purchase để phục vụ pre-sale discovery.

Do đó API trả `201` là đúng.

Boundary đúng:

```text
CUSTOMER ↔ unrelated CUSTOMER → 403
CUSTOMER → APPROVED PT        → allowed
```

Không được sửa product theo giả định cũ của test.

---

# 11. Thứ tự ưu tiên sửa đề xuất

## Phase 1 — Financial correctness

1. `P1-FIN-001` — Escrow/PENDING cho Personalized Service.
2. `P1-FIN-002` — Milestone release.
3. Bổ sung reconciliation + concurrent/idempotency tests.

## Phase 2 — Marketplace trust

4. `P1-UI-001` — PT rating/reputation trên Profile + listing.

## Phase 3 — Product context

5. `P2-CHAT-001` — SYSTEM messages.
6. `P2-DOMAIN-001` — HYBRID booking integration.

## Phase 4 — Growth/UX

7. `P3-GROWTH-001` — Free Plan → PT Service CTA.

## CI hardening song song

8. `RISK-QA-001` — xử lý rate-limit/flaky E2E.

---

# 12. Production Gate đề xuất

Không nên đánh dấu Personalized Service là **fully production-ready** cho quy mô lớn cho đến khi tối thiểu hoàn thành:

- [ ] Escrow thật.
- [ ] Milestone-based release.
- [ ] Refund calculation dựa trên financial ledger thay vì admin tự phán đoán toàn bộ.
- [ ] Concurrent financial tests.
- [ ] Idempotency tests.
- [ ] Reconciliation tests.
- [ ] CI/E2E không flaky vì rate limiter.
- [ ] Load/concurrency test cho financial endpoints.

Luồng nghiệp vụ không tài chính hiện có thể xem là **BETA-READY** theo kết quả test hiện tại.

Refund hiện hoạt động bằng giao dịch thật và có ceiling/idempotency, nhưng vẫn chỉ nên xem là **DEMO/BETA-READY** cho tới khi escrow + milestone release được triển khai.
