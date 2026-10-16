# AWS DEV E2E — Fitness / Gym / Payment Services

**Phạm vi:** Phase 2 của "AWS DEV Remaining Services E2E Testing". Test thật (real HTTP) chạy trực tiếp vào API Gateway `id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com` trên tài khoản AWS `191798898985`, dùng 2 tài khoản test đã authorized sẵn (`john.doe@example.com` / CUSTOMER, `admin@example.com` / ADMIN). Không tạo workout log, không tạo training cycle, không tạo application/payment thật.

**Ngày thực hiện:** 2026-09-30 (giờ UTC ghi trong log).

## Sự cố hạ tầng phát hiện giữa lúc test (quan trọng, ảnh hưởng cách đọc bảng bên dưới)

Ngay khi bắt đầu gọi `POST /auth/login`, Aurora cluster `fitness-assistant-dev-aurora` chuyển từ `available` sang `starting` (xác nhận bằng `aws rds describe-db-clusters` + CloudTrail: `StartDBCluster` lúc 09:28:16 +07 bởi IAM user `vmimport-admin` — cùng identity với credential của phiên làm việc này, khả năng cao do một script/phiên khác — ví dụ `aws-dev-power.ps1` — chạy song song, **không phải do tôi chủ động start**). Trong ~9 phút đó mọi endpoint chạm DB trả 500 (`PrismaClientInitializationError: Can't reach database server`). Đã đợi Aurora quay lại `available` (real, qua polling, không ép buộc) trước khi chạy phần lớn bảng test bên dưới. Ghi rõ trong cột Evidence Type cho từng dòng bị ảnh hưởng.

---

## 1. Fitness Service (`fitness-assistant-dev-fitness`)

| Test ID | Endpoint | Scenario | Expected | Actual | Evidence Type | Status |
|---|---|---|---|---|---|---|
| F01 | GET /exercises?page=1&limit=5 | Danh mục bài tập (auth CUSTOMER) | 200 + list | 200, 6487 bytes | VERIFIED_HTTP | PASS |
| F02 | GET /exercises/filter-options | Filter options cho catalog | 200 | 200 | VERIFIED_HTTP | PASS |
| F03 | GET /exercises/muscles | Danh sách muscle groups | 200 | 200, 4375 bytes | VERIFIED_HTTP | PASS |
| F04 | GET /equipment | Catalog thiết bị | 200 | 200, 12909 bytes | VERIFIED_HTTP | PASS |
| F05 | GET /equipment/me | Thiết bị của user | 200 | 200 | VERIFIED_HTTP | PASS |
| F06 | GET /workouts | Lịch sử workout | 200 | 200, 479KB (dữ liệu migrate thật, nhiều bản ghi) | VERIFIED_HTTP | PASS |
| F07 | GET /workouts/prs | Personal records | 200 | 200 | VERIFIED_HTTP | PASS |
| F08 | GET /training-cycles/active | Không có active cycle | 404 app-level, không phải bug | `{"error":"No active training cycle"}` | VERIFIED_HTTP | PASS (empty-state đúng, không phải lỗi) |
| F09 | GET /training-cycles | Danh sách training cycle | 200 | 200, 16520 bytes | VERIFIED_HTTP | PASS |
| F10 | GET /nutrition/goals | NutritionGoal hiện tại | 200 | 200 | VERIFIED_HTTP | PASS |
| F11 | GET /nutrition/active-state | Trạng thái nutrition | 200 | 200 | VERIFIED_HTTP | PASS |
| F12 | GET /food/search?q=chicken | Tìm food | 200 | 200, 5493 bytes | VERIFIED_HTTP | PASS |
| F13 | GET /templates/mine | Template của user | 200 | 200 | VERIFIED_HTTP | PASS |
| F14 | GET /stats/workouts | Thống kê workout | 200 | 200 | VERIFIED_HTTP | PASS |
| F15 | GET /fitness-roadmaps/current | FitnessRoadmap hiện tại | 200/404 app-level | **404 `{"message":"Not Found"}` — đây là 404 của API Gateway, không phải app** | VERIFIED_HTTP + VERIFIED_INFRA | **FAIL — xem BUG-F1** |
| F16 | GET /exports/json | Export dữ liệu | 200 | 200, 106KB | VERIFIED_HTTP | PASS |
| F17 | GET /exercises (không token) | Endpoint public theo thiết kế | 200 | 200, 36612 bytes | VERIFIED_HTTP | PASS (đúng — route không có authMiddleware, xác nhận qua source `exercise.routes.ts:9`) |
| F18 | GET /workouts (token sai) | Từ chối token không hợp lệ | 401 | 401 `{"error":"Invalid token"}` | VERIFIED_HTTP | PASS |
| F19 | GET /exercises/{uuid-không-tồn-tại} | ID không tồn tại | 404 app-level | 404 `{"error":"Exercise not found"}` | VERIFIED_HTTP | PASS |

### BUG-F1 (P1) — FitnessRoadmap hoàn toàn không thể truy cập qua API Gateway
- **Bằng chứng:** `aws apigatewayv2 get-routes` (toàn bộ danh sách route) **không có bất kỳ route nào chứa "roadmap"** — trong khi `backend/services/fitness-service/src/app.ts:50` mount đầy đủ `app.use("/fitness-roadmaps", fitnessRoadmapRoutes)` với 15 endpoint hoạt động đầy đủ (create/diagnosis/projection/ai-draft/current/activate/advance/rebuild/archive...).
- **Root cause category:** Infrastructure / API contract (route thiếu trong API Gateway, không phải lỗi code).
- **Tác động:** Toàn bộ tính năng Journey/FitnessRoadmap — theo `gymini-roadmap-product-flow` — **không dùng được trên AWS DEV**, kể cả khi Lambda code hoàn toàn sẵn sàng.
- **Đề xuất (không tự sửa theo scope):** Thêm route `ANY /fitness-roadmaps` và `ANY /fitness-roadmaps/{proxy+}` trỏ tới Lambda `fitness-assistant-dev-fitness` (giống pattern `/training-cycles`). Đây là thay đổi hạ tầng (API Gateway), cần approval riêng.

---

## 2. Gym Service (`fitness-assistant-dev-gym`)

| Test ID | Endpoint | Scenario | Expected | Actual | Evidence Type | Status |
|---|---|---|---|---|---|---|
| G01 | GET /gyms?page=1&limit=5 (không token) | Danh sách gym công khai | 200 | 200, 1961 bytes | VERIFIED_HTTP | PASS |
| G02 | GET /gyms?page=1&limit=5 (CUSTOMER) | Như trên, có auth | 200 | 200 | VERIFIED_HTTP | PASS |
| G03 | GET /gyms/{uuid-không-tồn-tại} | Gym không tồn tại | 404 app-level | `{"success":false,"error":{"code":"NOT_FOUND","message":"Gym not found"}}` | VERIFIED_HTTP | PASS |
| G04 | GET /owner/gyms (CUSTOMER) | Không phải owner | 403 | 403 `{"error":"Permission denied"}`-style | VERIFIED_HTTP | PASS (role gating đúng) |
| G05 | GET /owner/brands (CUSTOMER) | Không phải owner | 403 | 403 | VERIFIED_HTTP | PASS |
| G06 | GET /admin/gyms (ADMIN) | Admin xem danh sách gym chờ duyệt | 200 | **404 `Cannot GET /admin/gyms`** | VERIFIED_HTTP + VERIFIED_INFRA + VERIFIED_SOURCE | **FAIL — xem BUG-G1** |
| G07 | GET /admin/gyms (CUSTOMER) | Từ chối role sai | 403 | 403 `{"error":"Permission denied"}` | VERIFIED_HTTP | PASS (nhưng xảy ra ở **user-service**, không phải gym-service — xem BUG-G1) |
| G08 | GET /admin/brands (ADMIN) | Danh sách brand chờ duyệt | 200 | 404 `Cannot GET /admin/brands` | VERIFIED_HTTP | **FAIL — cùng BUG-G1** |
| G09 | GET /admin/partners (ADMIN) | Hàng đợi duyệt partner application | 200 | 404 `Cannot GET /admin/partners` | VERIFIED_HTTP | **FAIL — cùng BUG-G1** |
| G10 | GET /admin/commission-rate (ADMIN) | Tỷ lệ hoa hồng hiện tại | 200 | 404 `Cannot GET /admin/commission-rate` | VERIFIED_HTTP | **FAIL — cùng BUG-G1** |

### BUG-G1 (P0/P1) — Toàn bộ namespace `/admin/*` của gym-service không thể truy cập qua API Gateway (đi nhầm sang user-service)
- **Bằng chứng 3 lớp, khớp nhau hoàn toàn:**
  1. **VERIFIED_INFRA** — `aws apigatewayv2 get-routes`: route `ANY /admin/{proxy+}` trỏ integration `tqe5r7h` = Lambda `fitness-assistant-dev-user`. Không có route `/admin/gyms*`, `/admin/brands*`, `/admin/partners*`, `/admin/commission-rate*` nào trỏ về Lambda `fitness-assistant-dev-gym`.
  2. **VERIFIED_SOURCE** — `backend/services/gym-service/src/app.ts:48` có `app.use('/admin', adminRoutes)` và `admin.routes.ts` (170 dòng) implement đầy đủ: duyệt gym, duyệt brand, hàng đợi partner application (`/partners/queue`, `/partners/applications`, `/partners/:id/application/approve|reject`), commission rate, complaints... — toàn bộ đã code xong nhưng không tới được vì gateway không route tới Lambda này.
  3. **VERIFIED_HTTP** — gọi trực tiếp xác nhận request tới đúng `fitness-assistant-dev-user` Lambda (log CloudWatch: `"url":"/admin/gyms"` trong log của Lambda `fitness-assistant-dev-user`, xử lý trong 22-30ms — quá nhanh so với truy vấn DB thật, khớp với Express 404 handler mặc định `Cannot GET`).
- **Root cause category:** API contract / Infrastructure (thiếu route trong API Gateway) — không phải lỗi logic gym-service.
- **Tác động:** Toàn bộ workflow admin duyệt gym/brand/partner-application (bao gồm cả hàng đợi duyệt hồ sơ đối tác phòng gym) **hoàn toàn không dùng được** trên AWS DEV, dù Lambda code sẵn sàng 100%.
- **Đề xuất:** Cần thêm route cụ thể hơn (ví dụ `ANY /admin/gyms/{proxy+}`, `ANY /admin/brands/{proxy+}`, `ANY /admin/partners/{proxy+}`, `ANY /admin/commission-rate/{proxy+}`, `ANY /admin/gym-memberships/{proxy+}`, `ANY /admin/complaints/{proxy+}`) trỏ về `fitness-assistant-dev-gym`, đặt **trước** route catch-all `/admin/{proxy+}` hiện có (API Gateway HTTP API ưu tiên route cụ thể hơn route có `{proxy+}`). Đây là thay đổi API Gateway, cần approval riêng — không tự thực hiện trong audit này.

---

## 3. Root-cause 2 bug lịch sử (theo yêu cầu Phase 2 Gym Service)

**Phát hiện quan trọng đầu tiên:** cả 2 bug **không nằm trong gym-service** — chúng nằm trong **user-service** (`pt_application.service.ts`, `availability.service.ts`), xác nhận qua route table (`/pt-applications`, `/availability` đều trỏ Lambda `fitness-assistant-dev-user`, không phải `fitness-assistant-dev-gym`) và qua `find` trực tiếp file trong repo.

### Bug A — "Missing required field for submission: serviceMode"
- **Root cause thật (đã fix từ trước):** không phải lỗi tên field/enum. Đây là bug **stale-echo re-merge** ở frontend: `PTApplicationPage.tsx` từng re-hydrate `formData` từ mọi response của draft-save, ghi đè giá trị người dùng vừa nhập (kể cả `serviceMode`, `yearsOfExperience`) bằng giá trị `null` cũ từ server trước khi server kịp lưu — làm mất dữ liệu âm thầm giữa wizard, submit cuối cùng báo thiếu field mà user chắc chắn đã nhập.
- **Bằng chứng fix:** `frontend/web/src/app/pages/client/PTApplicationPage.tsx:415-429` — `hydratedRef` chỉ hydrate **một lần duy nhất**, từ đó `formData` là nguồn sự thật một chiều (local → server). Comment tại chỗ ghi rõ: *"Confirmed live while building an E2E test: identity-document uploads and yearsOfExperience/serviceMode fields were silently wiped mid-wizard this way"*.
- **Trạng thái deploy:** Fix nằm trong baseline commit `3f88dd5c` (2026-09-04), **frontend S3 build hiện tại (2026-09-22) đã bao gồm fix này** → **VERIFIED_SOURCE, đã deploy**.
- **Đối chiếu CloudWatch:** user-service log 24h gần nhất có **1 lần** lỗi `Missing required field for submission: serviceMode` lúc 2026-09-29T07:48:56Z. Vì fix frontend đã deploy, khả năng cao đây là validation đúng (hồ sơ thật sự chưa hoàn chỉnh khi submit) chứ không phải bug tái phát — **không thể kết luận chắc chắn nếu không ghi dữ liệu thật (ngoài phạm vi audit này, cần `WRITE_TEST_PENDING_APPROVAL` để tái hiện có kiểm soát)**.
- **Kết luận:** HISTORICAL bug, đã fix và đã deploy ở phía gây ra gốc rễ thật (frontend). Không phải bug đang hoạt động cần fix gấp.

### Bug B — "Invalid day: Mon" — **BUG CÒN SỐNG TRÊN PRODUCTION (P0/P1)**
- **Root cause:** `availability.service.ts`'s `validateAvailabilityBlocks()` (dòng 239-277) chỉ chấp nhận tên ngày đầy đủ viết hoa (`MONDAY`...) qua `DAY_ORDER`. PT Application wizard ở frontend (`PTApplicationPage.tsx`, dayOptions) gửi dạng viết tắt (`"Mon"`, `"Tue"`...). `setAvailability()` (dòng 284-301) đã có `DAY_NAME_NORMALIZE` map để chuyển `"Mon"` → `DayOfWeek.MONDAY` **trước khi** validate — đây chính là fix, có comment tại chỗ mô tả đúng bug này.
- **Fix đã có trong source, commit `a9f54941` (2026-09-07).**
- **VẤN ĐỀ:** Lambda `fitness-assistant-dev-user` hiện tại có `LastModified = 2026-08-28T14:37:57Z` — **TRƯỚC** commit fix (2026-09-07). Tức là **bản deploy hiện tại trên AWS DEV KHÔNG chứa fix này.**
- **Bằng chứng tái hiện live (VERIFIED_INFRA, log thật, không phải tôi tạo lỗi):** CloudWatch log group `/aws/lambda/fitness-assistant-dev-user`, 3 dòng lỗi thật trong 24h qua:
  - `2026-09-29T07:50:14.858Z` — Invalid day: Mon
  - `2026-09-29T07:50:19.678Z` — Invalid day: Mon
  - `2026-09-29T07:50:41.636Z` — Invalid day: Mon
- **Tác động:** Mọi user cố lưu draft PT-application có set khối giờ rảnh (availability blocks) — bước **bắt buộc** để submit hồ sơ PT — sẽ bị lỗi 400 ngay lập tức. **Đây là bug chặn hoàn toàn luồng đăng ký làm PT mới trên AWS DEV.**
- **Root cause category:** Migrated/stale deployment (code đã fix trong repo nhưng Lambda chưa được deploy lại) — không phải lỗi logic hiện tại trong source.
- **Đề xuất (không tự thực hiện):** Deploy lại `fitness-assistant-dev-user` Lambda từ commit hiện tại của nhánh `aws-deploy` (đã chứa cả 2 fix). Đây là hành động deploy, cần approval riêng.

---

## 4. Payment Service (`fitness-assistant-dev-payment`) — **P0: DỊCH VỤ HỎNG HOÀN TOÀN Ở TẦNG DB**

| Test ID | Endpoint | Scenario | Expected | Actual | Evidence Type | Status |
|---|---|---|---|---|---|---|
| P01 | GET /me/payments | Lịch sử giao dịch | 200 | **500** `{"message":"Internal Server Error"}` | VERIFIED_HTTP + VERIFIED_INFRA | **FAIL — BUG-P1** |
| P02 | GET /me/payments/methods | Danh sách payment method khả dụng | 200 | 200, 653 bytes (đây là endpoint tĩnh, không chạm DB) | VERIFIED_HTTP | PASS |
| P03 | GET /me/wallet | Số dư ví | 200 | 500 | VERIFIED_HTTP | **FAIL — cùng BUG-P1** |
| P04 | GET /me/wallet/transactions | Lịch sử ví | 200 | 500 | VERIFIED_HTTP | **FAIL — cùng BUG-P1** |
| P05 | GET /me/withdrawals | Lịch sử rút tiền | 200 | 500 | VERIFIED_HTTP | **FAIL — cùng BUG-P1** |
| P06 | GET /admin/payments (ADMIN) | 200 giao dịch gần nhất | 200 | 500 | VERIFIED_HTTP | **FAIL — cùng BUG-P1** |
| P07 | GET /admin/payments/reconciliation (ADMIN) | Báo cáo đối soát | 200/409 | 500 | VERIFIED_HTTP | **FAIL — cùng BUG-P1** |
| P08 | GET /admin/payments/finance-overview (ADMIN) | Tổng quan tài chính | 200 | 404 `Cannot GET` | VERIFIED_HTTP | INCONCLUSIVE (có thể do path/query param chưa đúng — không quan trọng vì DB đã hỏng ở tầng dưới, xem BUG-P1) |

**Retest sau khi Aurora đã ổn định lại hoàn toàn (~10 phút sau khi login thành công trở lại): vẫn 500 y hệt** — không phải hiện tượng thoáng qua do Aurora vừa restart.

### BUG-P1 (P0 — CRITICAL) — Lambda `fitness-assistant-dev-payment` không có VPC config, không thể kết nối Aurora
- **Bằng chứng CloudWatch (VERIFIED_INFRA):** mọi request chạm DB đều lỗi `Runtime.UnhandledPromiseRejection` / `PrismaClientInitializationError: Can't reach database server at fitness-assistant-dev-aurora...:5432`, duration ~5-6 giây (đúng bằng timeout kết nối TCP), `Status: error`, `Error Type: Runtime.ExitError`.
- **Root cause xác nhận qua AWS CLI (VERIFIED_INFRA), không suy đoán:**
  ```
  aws lambda get-function-configuration --function-name fitness-assistant-dev-payment --query VpcConfig
  → null
  ```
  So sánh với `fitness-assistant-dev-fitness` (Lambda đang hoạt động bình thường):
  ```
  → { SubnetIds: [subnet-02b39d77762465ef8, subnet-09e3230f7bca04c8e], SecurityGroupIds: [sg-0b38ab22927b284ab], VpcId: vpc-010c13afd8920c8f1 }
  ```
  Aurora's security group (`sg-00e8e01671812bf44`) chỉ cho phép inbound port 5432 từ 2 security group nội bộ VPC (`sg-0b38ab22927b284ab`, `sg-00726a813b1163459`). Lambda `payment` **không nằm trong VPC nào cả** → không thể và sẽ không bao giờ kết nối được tới Aurora, bất kể Aurora có sẵn sàng hay không, bất kể retry bao nhiêu lần.
- **Đây KHÔNG liên quan tới sự cố Aurora restart nêu ở đầu báo cáo** — auth/fitness/user/ai Lambda đều kết nối lại bình thường ngay khi Aurora available; riêng payment thì không, vì thiếu cấu hình VPC ở tầng Lambda, không phải ở tầng Aurora.
- **Tác động:** **100% các endpoint payment/wallet/withdrawal có chạm DB đều hỏng** trên AWS DEV hiện tại. Chỉ endpoint tĩnh (`/me/payments/methods`) hoạt động vì không cần DB.
- **Root cause category:** Infrastructure (Lambda deployment/networking config) — không phải lỗi code payment-service.
- **Đề xuất (không tự thực hiện — đây là thay đổi networking/Lambda config, nằm ngoài phạm vi audit):** Redeploy hoặc cập nhật `fitness-assistant-dev-payment` Lambda với đúng `VpcConfig` (subnet + security group) như các Lambda khác. Đây là **P0 chặn phát hành**, nên được ưu tiên xử lý đầu tiên trong số mọi bug tìm thấy trong toàn bộ audit này.

---

## Tổng kết Phase 2

| Service | Tests thật (HTTP) | PASS | FAIL | BLOCKED |
|---|---|---|---|---|
| Fitness | 19 | 18 | 1 (BUG-F1) | 0 |
| Gym | 10 | 5 | 5 (BUG-G1) | 0 |
| User (liên quan 2 bug) | 5 | 5 | 0 (bug đã phân tích riêng ở trên) | 0 |
| Payment | 8 | 1 | 6 (BUG-P1) | 1 (P08 inconclusive) |

**3 bug thật, có bằng chứng đầy đủ, cần xử lý trước khi public release, theo thứ tự ưu tiên:**
1. **BUG-P1 (P0)** — payment Lambda thiếu VPC config → toàn bộ payment/wallet hỏng.
2. **Bug B / Invalid day: Mon (P0/P1)** — fix đã có trong source nhưng chưa deploy → chặn đăng ký PT mới.
3. **BUG-G1 (P1)** — gym-service admin namespace không có route ở API Gateway → admin không duyệt được gym/brand/partner application.
4. **BUG-F1 (P1)** — FitnessRoadmap không có route ở API Gateway → tính năng Journey không dùng được.
