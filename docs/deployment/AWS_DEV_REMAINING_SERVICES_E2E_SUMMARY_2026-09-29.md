# AWS DEV — Remaining Services E2E — Báo cáo tổng hợp

**Phiên audit:** 2026-09-30 (giờ UTC ghi log). Account AWS `191798898985`, region `ap-southeast-1`. Tài khoản test dùng: `john.doe@example.com` (CUSTOMER), `admin@example.com` (ADMIN) — cả hai đã được authorized từ trước.

**Group A/B Credential Rotation:** theo yêu cầu, **không đụng tới trong phiên này**.

**Báo cáo con:**
- `AWS_DEV_E2E_FITNESS_GYM_PAYMENT_2026-09-29.md`
- `AWS_DEV_E2E_AI_WORKERS_2026-09-29.md`
- `AWS_DEV_E2E_CHAT_2026-09-29.md`
- `AWS_DEV_E2E_FRONTEND_2026-09-29.md`

---

## 1. Tổng số test thật đã chạy

| Service | VERIFIED_HTTP (test thật) | PASS | FAIL | BLOCKED |
|---|---|---|---|---|
| Fitness | 19 | 18 | 1 | 0 |
| Gym | 10 | 5 | 5 | 0 |
| User (pt-applications/availability) | 5 | 5 | 0* | 0 |
| Payment | 8 | 1 | 6 | 1 |
| AI Service | 10 | 8 | 2 | 0 |
| Chat REST/WS | 3 | 0 | 0 | 3 |
| Frontend (đối chiếu cấu hình) | 7 | 6 | 0 | 1 |
| **Tổng** | **62 test HTTP thật** | **43** | **14** | **5** |

*\* 2 bug lịch sử (serviceMode, Invalid day) được root-cause riêng bằng VERIFIED_SOURCE + CloudWatch, không tính vào PASS/FAIL của bảng test trực tiếp.*

**Sự cố hạ tầng phát sinh giữa lúc audit (không do tôi gây ra):** Aurora cluster tự chuyển `available → starting` ngay khi tôi bắt đầu test (CloudTrail xác nhận `StartDBCluster` bởi cùng IAM identity của phiên này, khả năng do một tiến trình/script khác chạy song song). Đã chờ available lại (~9-10 phút) trước khi tiếp tục, không tự ý can thiệp. Toàn bộ kết luận PASS/FAIL ở trên đều lấy từ lúc Aurora đã ổn định trở lại, trừ khi ghi chú khác.

## 2. PASS/FAIL/BLOCKED theo service

| Service | Trạng thái tổng thể |
|---|---|
| **Fitness** | Hầu hết hoạt động tốt. 1 bug hạ tầng (FitnessRoadmap không có route API Gateway). |
| **Gym** | Public/owner endpoints OK. **Toàn bộ admin moderation namespace không thể truy cập** (route API Gateway đi nhầm sang user-service). |
| **Payment** | **HỎNG NẶNG** — mọi endpoint chạm DB đều 500 do Lambda thiếu VPC config. |
| **AI Service** | Phần lớn OK. 2 endpoint admin (`overview`, `queue`) timeout 30s → 503. |
| **AI Worker/Jobs** | Hạ tầng SQS đúng cấu hình nhưng **chưa từng được invoke** (không có log group). Cơ chế trigger của *-jobs Lambda (mọi service) không xác định được. |
| **Chat REST** | BLOCKED — ECS desiredCount=0 từ hôm qua. |
| **Socket.IO (Chat)** | BLOCKED — cùng lý do; có rủi ro kiến trúc mixed-content khi thêm HTTPS cho frontend sau này. |
| **Frontend** | Cấu hình API URL khớp đúng backend thật. Không dùng browser tool nên phần trải nghiệm UI thật KHÔNG được test (khai báo rõ, không tuyên bố PASS). |

## 3. Bug phát hiện, xếp theo mức độ ưu tiên phải fix trước khi public release

| # | Bug | Mức độ | Root cause | Đã reproduce live? |
|---|---|---|---|---|
| 1 | **Payment Lambda không có VPC config → mọi endpoint DB-touching trả 500** | **P0** | Infrastructure (Lambda networking) | **Có, live, retest 2 lần vẫn 500** |
| 2 | **"Invalid day: Mon" — fix đã có trong source (commit 2026-09-07) nhưng Lambda user-service chưa deploy lại (LastModified 2026-08-28)** — chặn hoàn toàn đăng ký PT mới | **P0/P1** | Migrated/stale deployment | **Có, 3 lần trong CloudWatch 24h qua** |
| 3 | **Gym-service admin namespace (duyệt gym/brand/partner application) không có route ở API Gateway** | **P1** | API contract / Infrastructure | Có, live (404 "Cannot GET" từ user-service) |
| 4 | **FitnessRoadmap không có route ở API Gateway** — tính năng Journey không dùng được | P1 | API contract / Infrastructure | Có, live (404 API-Gateway-level) |
| 5 | `/admin/ai/overview`, `/admin/ai/queue` timeout 30s → 503 | P1/P2 | Application code (chưa xác định dòng cụ thể) | Có, live |
| 6 | Chat ECS desiredCount=0 (đã vậy từ hôm qua, không phải do audit) | P1 | Infrastructure (vận hành) | Có, live |
| 7 | Không có CloudFront/HTTPS cho frontend + ALB Chat chỉ HTTP → rủi ro mixed-content khi nâng cấp HTTPS sau này | P2 (sẽ thành P1 nếu thêm HTTPS mà quên sửa đồng thời) | Infrastructure | Chưa xảy ra hôm nay, xác nhận qua cấu hình |
| 8 | `VITE_ENABLE_CHAT=false` + `VITE_ENABLE_CHAT_WS=true` gây kết nối Socket.IO "mồ côi" nền | P2 | API contract (frontend config) | Có, xác nhận qua source |

## 4. Bug lịch sử đã reproduce lại được (khác với bug mới phát hiện)

- **"Invalid day: Mon"** — đã biết từ CloudWatch trong audit Auth/User trước đây; lần này **root-cause đầy đủ + xác nhận fix có trong source nhưng chưa deploy** (mục 3.2 ở trên).
- **"Missing required field: serviceMode"** — root-cause thật là bug frontend (stale-echo re-merge), **đã fix và đã deploy** từ trước; occurrence gần nhất (2026-09-29 07:48Z) nhiều khả năng là validation đúng, không phải bug tái phát — không kết luận chắc chắn nếu không ghi dữ liệu thật (ngoài phạm vi audit).

## 5. Remaining deployment gaps (không phải bug, nhưng cần biết)

- AI Worker Lambda chưa từng được invoke — không ai biết code xử lý SQS message có chạy đúng không.
- AI Jobs + fitness/gym/payment/user-jobs: không rõ cơ chế trigger (không EventBridge rule, không event source mapping nào trong toàn account).
- `gym_membership_plans.brand_id SET NOT NULL` — vẫn là manual item chưa áp dụng (không đụng tới theo đúng yêu cầu).
- Group A (rotate admin password) — đã PREPARED từ trước, chưa EXECUTE. Group B (12 seed account) — chưa đụng tới.

## 6. AWS cost considerations

- Aurora tự "wake" giữa audit (StartDBCluster) — cần xác nhận với chủ account đây có phải hành vi mong muốn (auto-restart sau 7 ngày stop) hay một script/phiên khác đang chạy song song ngoài kiểm soát, vì Aurora chạy 24/7 sau khi start sẽ phát sinh chi phí liên tục cho tới khi ai đó stop lại.
- Chat ECS đang ở desiredCount=0 — đang tiết kiệm chi phí Fargate, nhưng đồng nghĩa Chat không demo được cho tới khi ai đó chủ động scale lên lại.
- Không phát sinh chi phí AI/LLM hay payment provider nào trong audit này (đã tuân thủ tuyệt đối hard safety rules).

## 7. Đề xuất thứ tự triển khai fix (dựa trên dependency thật quan sát được)

1. **Payment Lambda VPC config** (P0) — không phụ thuộc gì khác, sửa được ngay, mở khóa toàn bộ payment/wallet.
2. **Redeploy user-service Lambda** (chứa fix Invalid-day, đã có sẵn trong source, không cần code mới) — mở khóa đăng ký PT mới.
3. **Thêm route API Gateway cho gym-service admin namespace** — cần biết chính xác payload/response mong đợi trước khi thêm route (không phức tạp, nhưng cần test lại sau khi thêm).
4. **Thêm route API Gateway cho `/fitness-roadmaps`** — độc lập với các bug khác, có thể làm song song với #3.
5. **Trace nguyên nhân timeout `/admin/ai/overview|queue`** — cần code lambda AI service, không chặn các phần khác.
6. **Quyết định về Chat ECS + kế hoạch HTTPS cho frontend** — mang tính quyết định sản phẩm/chi phí, nên làm sau khi các bug P0 đã xử lý.

## 8. Bước tiếp theo chính xác

- Chờ user xác nhận đã đọc 4 báo cáo con + báo cáo này.
- **KHÔNG** tự động chuyển sang Credential Rotation (Group A/B) hoặc CI/CD — theo đúng yêu cầu HARD STOP.
- Nếu user muốn fix bug P0 (#1, #2 ở mục 7), cần approval riêng cho từng thay đổi (Lambda VPC config là networking change, Lambda redeploy là deploy action) — cả hai đều là hành động bị cấm trong phạm vi audit read-only này.
