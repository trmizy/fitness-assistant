# M9-AWS-ROLLOUT-PLAN — Kế hoạch triển khai và rollback Multi-Agent V2 trên AWS (M9.5-T0)

Ngày 2026-11-16. **Toàn bộ nội dung là PROPOSED** (đề xuất của AI), trừ các `CONFIG FACT`/`CODE FACT` đã đọc trong repo ở RC-0 `19577276` và ghi rõ. **Không phase nào được thực hiện; không cờ nào được bật; không gọi AWS.** D-001 vẫn có hiệu lực: không phát hành Multi-Agent trước khi hoàn tất điều kiện release và chủ dự án chấp thuận rõ ràng. Mỗi phase cần phê duyệt riêng, bằng lời của chủ dự án; phê duyệt phase trước **không** mở phase sau.
Đọc cùng `M9-RELEASE-READINESS.md` (topology, pin, trạng thái bền vững, cổng chất lượng) và `M9-BLOCKER-REGISTER.md` (blocker, ID B-xx). Không có secret, ID tài khoản hay giá trị môi trường trong tài liệu này.

## 1. Nguyên tắc
1. V1 không gián đoạn: mọi bước giữ V1 là đường mặc định; chỉ thay **artifact Lambda `ai`** bằng quy trình hiện có, **không đổi API Gateway** (`ANY /ai/{proxy+}` đã phủ `/ai/ask` và `/ai/v2/*` — CONFIG FACT).
2. V2 mặc định OFF ở nhiều lớp độc lập (§2). Phải mở **tất cả** lớp mới tới được V2.
3. Danh sách cho phép phía server (user id chính xác); mặc định từ chối tất cả (CODE FACT: `AI_COACH_V2_BRIDGE_USERS` rỗng ⇒ không ai).
4. Chưa bắt đầu V2 ⇒ V1; đã bắt đầu V2 ⇒ quyết định cuối cùng, **không** fallback (D-009). Redis/DB/model/store lỗi **không** được tạo "fallback an toàn": lỗi khởi tạo runtime/store ⇒ 503 + khoá IN_DOUBT (D-P16), lỗi giữa lượt ⇒ trả trạng thái lỗi của V2.
5. Không đưa PII vào log/trace (§6). Không dữ liệu thật của người dùng ở Phase 0–2.
6. Rollback phải được **diễn tập trước** khi có bất kỳ người dùng nào ngoài nhóm thử nghiệm.

## 2. Cổng cấu hình (CODE FACT) — năm lớp độc lập
| Lớp | Biến / điều kiện | Mặc định | Ghi chú |
|---|---|---|---|
| 1. Bridge | `AI_COACH_V2_BRIDGE=on` **và**, vì Lambda chạy `NODE_ENV=production`, `AI_COACH_V2_BRIDGE_PRODUCTION_APPROVED=yes` | OFF | `coach-v2-bridge.ts isCoachBridgeEnabled`; OFF ⇒ `next()` dòng đầu, V1 như cũ |
| 2. Người dùng | `AI_COACH_V2_BRIDGE_USERS` = danh sách user id chính xác | rỗng ⇒ từ chối tất cả | chỉ người dùng cuối đã xác minh (không gọi dịch vụ-với-dịch vụ) |
| 3. Runtime V2 | `AI_AGENT_V2=on` **và** `AI_AGENT_V2_PRODUCTION_APPROVED=yes` | OFF | đóng ⇒ `V2NotStartedError` ⇒ V1 |
| 4. Hạ tầng bắt buộc | session store `AGENT_V2_SESSION_STORE=dynamodb` + `AGENT_V2_SESSION_TABLE` + `AGENT_V2_SESSION_REGION`; store hạn chế vị thành niên (**chưa tồn tại** ⇒ 503); port idempotency + lịch sử (**chưa tồn tại** ⇒ V1) | thiếu ⇒ không phục vụ | đây là lý do V2 hiện không thể phục vụ trên AWS (B-05/12/13) |
| 5. Router | `AI_AGENT_V2_ROUTING_MODE` mặc định `deterministic`; model-assisted cần thêm `AI_AGENT_V2_HYBRID_PRODUCTION_APPROVED=yes` | deterministic | không đổi trong các phase đầu (B-18) |
Mô hình: `BEDROCK_CHAT_MODEL` (mặc định Nova Pro, D-006). Streaming `/ask/stream` không qua bridge (luôn V1).

## 3. Cơ chế triển khai sẽ dùng lại (CONFIG FACT)
- **CODE_DEPLOY:** `dev-build` (artifact + manifest SHA-256, bất biến) → `dev-deploy` (`workflow_dispatch`, `dry_run=true` mặc định, reviewer duyệt `environment: dev`, OIDC, chỉ `update-function-code`, ghi CodeSha256 cũ vào rollback-record, smoke `/health` không gọi AI) → `dev-preflight` (read-only: CodeSha256 → S3 key → git commit).
- **CONFIG_DEPLOY** (đổi cờ/biến): **tách riêng**, không nằm trong `dev-deploy` ("never update-function-configuration"). `update-function-configuration` thay **cả khối env (có secret)** ⇒ chỉ dùng thủ tục *gộp biến* đã được viết và diễn tập (mẫu: `-ApplyLambdaEnv` của script quota), không bao giờ ghi tay cả khối.
- Hạ tầng (bảng DynamoDB, IAM, NAT…): pipeline CloudFormation/IaC hiện có; **chưa có** tài nguyên V2 (B-20). Đề xuất IaC mới cần owner duyệt, không thực thi.
- Chưa có alias/phiên bản Lambda hay triển khai dần; rollback = triển khai lại artifact trước đó. Có thể bổ sung alias có trọng số (PROPOSED; quyết định riêng).

## 4. Các phase
Mỗi phase có: điều kiện vào, hành động, bằng chứng bắt buộc, điều kiện ra, tiêu chí STOP. **Chủ dự án duyệt trước khi vào mỗi phase.**

### Phase 0 — Release candidate cục bộ (không đụng AWS)
- **Vào:** owner chốt định nghĩa RC và chính sách tích hợp M8-C (B-08).
- **Làm:** tích hợp có kiểm soát M8-C; đóng B-01/02/03 (và các P1 an toàn khác); triển khai store bền vững + port + IaC *dưới dạng code/test* (B-05/12/13/20) với test trên **DB/DynamoDB local hoặc DB test cô lập**; chạy toàn bộ suite + Codex; đóng băng code; owner phê duyệt rebaseline RI-2/HR-27 (§5 của readiness) rồi tạo RC bất biến (commit/tag — chỉ khi owner cho phép).
- **Ra:** RC có commit cố định, toàn bộ suite pass, pin tái lập có phê duyệt, Codex không còn P0/P1 trên diff, artifact build bất biến (manifest SHA-256).
- **STOP:** bất kỳ P0/P1 mới; suite đỏ; pin cần "bỏ qua".

### Phase 1 — Staging riêng, người dùng/dữ liệu tổng hợp
- **Vào:** Phase 0 đạt; **quyết định môi trường (D-P26)**: repo chỉ có **DEV**; cần chọn dùng lại DEV (bật bằng `dev-start`, có chi phí và có thể đang tắt) hay dựng stack staging riêng bằng IaC. Cần cơ chế **tài khoản thử nghiệm được phép** (HISTORICAL REPORT: dự án chặn tài khoản test trên AWS và lọc khỏi thống kê — cần ngoại lệ có kiểm soát do owner duyệt).
- **Làm:** (1) CODE_DEPLOY artifact RC với **mọi cờ OFF**, smoke `/health`, so sánh hành vi V1 (cờ OFF) với baseline; (2) áp IaC V2 (bảng, IAM) trên staging; (3) CONFIG_DEPLOY bật theo lớp, chỉ allowlist là tài khoản tổng hợp; (4) kiểm chứng REAL HTTP/API: cách ly hai người dùng (B-11), 4 agent đọc dữ liệu thật của DEV (B-15), idempotency/IN_DOUBT, store hạn chế vị thành niên đa instance (B-05/07/09), lịch sử; (5) **diễn tập rollback** (§7) và kill switch, đo thời gian; (6) rà log CloudWatch (B-22).
- **Chưa gọi model thật** trừ khi owner đã duyệt điều kiện §7 của readiness; nếu duyệt: chạy E1–E10 với trần chi phí cứng.
- **Ra:** mọi mục P1 liên quan có bằng chứng `REAL HTTP/API` (không phải mock); rollback đã diễn tập và đạt do owner đặt; không dương tính an toàn nào.
- **STOP:** xem §8.

### Phase 2 — Chấp nhận nội bộ (tài khoản thử nghiệm được phép; model thật + dịch vụ thật)
- **Vào:** Phase 1 đạt; owner duyệt ngân sách/cửa sổ model (D-006: chỉ Nova Pro); quyền Bedrock + đường mạng xác nhận (B-16).
- **Làm:** đánh giá mù cặp V1/V2 (E3–E4), grounding/hallucination (E5), tool accuracy (E6), hồi quy an toàn (E7), độ trễ (E8) so với envelope (B-19), chi phí (E9), lỗi/timeout (E10). Allowlist nhỏ nhân sự nội bộ có hiểu biết. Giám sát riêng V1/V2 (§5).
- **Ra:** báo cáo theo ca/nhóm có khoảng tin cậy; chủ dự án tự đặt ngưỡng release (tài liệu này **không** đặt ngưỡng, không gọi G7/G8, không tuyên bố hơn V1 khi chưa có bằng chứng).
- **STOP:** xem §8.

### Phase 3 — Triển khai production có kiểm soát (chỉ sau khi owner phê duyệt **toàn bộ** release gates)
- **Vào:** Phase 2 đạt; tất cả P1 ở sổ blocker `VERIFIED` hoặc được owner chấp nhận rủi ro bằng văn bản từng mục; đánh giá độc lập; D-001 được dỡ bằng quyết định rõ; kill switch/rollback đã diễn tập.
- **Làm (đề xuất):** mở allowlist theo bậc nhỏ (cohort cố định, tăng dần theo mốc owner đặt), mỗi bậc có thời gian quan sát tối thiểu và quyền rollback tức thời; **không** mở theo tỉ lệ ngẫu nhiên (an toàn: hạn chế vị thành niên, session affinity cần người dùng nhất quán); V1 luôn là đường cho mọi người ngoài allowlist.
- **STOP:** xem §8. Quay về mức thấp hơn bất cứ lúc nào bằng kill switch.

## 5. Giám sát (PROPOSED)
Hiện có (CONFIG FACT): alarm `Errors` của Lambda `…-dev-ai` và Aurora; **không** tách V1/V2. Cần bổ sung trước Phase 1: chỉ số theo `engine` (V1/V2) từ log có cấu trúc **chỉ mã**: số yêu cầu, trạng thái (ANSWERED/PARTIAL/BLOCKED/FAILED), 409 IN_DOUBT, 503 cấu hình, độ trễ p50/p95/p99, số agent chạy, số lượt model/tool, chi phí ước tính, tỉ lệ bị chặn an toàn (V1 và V2 riêng), số lần guard cân nặng gỡ câu, số lần preflight giữ V1. Alarm theo ngưỡng do owner đặt. Dashboard V1/V2 tách. Không đưa nội dung câu hỏi/câu trả lời vào chỉ số.

## 6. Quyền riêng tư của log/trace (yêu cầu)
Không ghi: câu hỏi, câu trả lời, tuổi, số đo, id người dùng thô, token/bearer, nội dung tool. Chỉ mã, đếm, độ trễ, id lượt không thể suy ngược. Đã có test offline (`UH-12`, `P-24`); phải **rà log thật** trên staging (B-22) trước Phase 2. Log lỗi từ SDK/Prisma/Bedrock phải được lọc.

## 7. Kill switch và rollback (PROPOSED; phải diễn tập ở Phase 1)
Mức từ nhẹ tới nặng — mỗi mức độc lập:
| Mức | Hành động | Hiệu lực | Ghi chú |
|---|---|---|---|
| L0 | Rỗng `AI_COACH_V2_BRIDGE_USERS` | Mọi người về V1 cho **lượt mới** | CONFIG_DEPLOY gộp biến |
| L1 | `AI_COACH_V2_BRIDGE` khác `on` | Bridge `next()` ngay | CONFIG_DEPLOY gộp biến |
| L2 | `AI_AGENT_V2` khác `on` | `/ai/v2/*` 404, executor `V2NotStarted` | CONFIG_DEPLOY gộp biến |
| L3 | Triển khai lại artifact trước đó (CODE_DEPLOY với `build_run_id` cũ; xác minh bằng `dev-preflight`: CodeSha256 khớp S3 key/commit) | Toàn bộ code về bản trước | cần `rollback-record` + artifact bất biến còn trong S3 |
Lưu ý: (a) cờ là biến môi trường ⇒ không tức thời như công tắc runtime; thời gian có hiệu lực thật của một thay đổi cấu hình Lambda (môi trường đang ấm) phải được **đo** trong diễn tập, không giả định; (b) lượt V2 đang chạy tại thời điểm tắt vẫn kết thúc theo quyết định của chính nó (D-009), người dùng có thể thấy IN_DOUBT/409 và gửi lại — gửi lại sẽ đi V1; (c) rollback code **không** hoàn tác dữ liệu đã ghi vào store V2/lịch sử: cần kế hoạch dữ liệu (đọc được bởi V1, không xoá tự động, đặc biệt **hạn chế vị thành niên phải được giữ**); (d) công tắc runtime (ví dụ cờ trong DynamoDB/SSM đọc có cache ngắn) là phương án thay thế **cần code + quyết định riêng** (D-P27).
Diễn tập (Phase 1): triển khai artifact N+1 (cờ OFF) → bật V2 cho tài khoản tổng hợp → đo L0/L1/L2/L3, thời gian, trạng thái yêu cầu đang bay → xác nhận V1 hành vi bình thường sau mỗi mức → xác nhận hạn chế vị thành niên và lịch sử còn nguyên sau L3.

## 8. Tiêu chí STOP / rollback (định tính; ngưỡng số do chủ dự án đặt)
Dừng và hạ xuống L0/L1 **ngay**, mở sự cố, không tiến phase, nếu xảy ra bất kỳ điều sau:
- thấy dữ liệu/phiên/idempotency của người dùng khác (rò chéo); lượt V2 chạy với danh tính không phải của người gọi;
- một yêu cầu vị thành niên/an toàn mà V1 sẽ chặn lại được V2 trả lời; hạn chế vị thành niên bị lift hoặc mất sau restart/scale/rollback;
- câu trả lời bịa số cá nhân (cân nặng…) lọt qua; nội dung emergency/tự hại không được xử lý theo cổng;
- fallback V1 xảy ra **sau** khi V2 đã bắt đầu; hoặc một ghi (write) bị tạo bởi V2;
- PII xuất hiện trong log/trace/metric;
- tỉ lệ lỗi/503/IN_DOUBT, độ trễ p95/p99 hoặc chi phí/lượt vượt ngưỡng owner đặt; ngân sách tổng chạm trần;
- V1 hồi quy (smoke, lỗi, độ trễ, an toàn) sau khi triển khai artifact mới;
- cấu hình lệch (biến mất sau CONFIG_DEPLOY; scheduler/IAM đổi ngoài kế hoạch);
- Codex/người phát hiện P0/P1 mới trên phần liên quan.

## 9. Việc chủ dự án cần quyết (PROPOSED — chưa duyệt)
D-P25 công nghệ store (hạn chế vị thành niên/idempotency: DynamoDB đề xuất, không TTL tự xoá cho hạn chế); D-P26 môi trường staging (dùng DEV hay stack mới; tài khoản thử nghiệm trên AWS); D-P27 cơ chế kill switch (env + diễn tập vs công tắc runtime); D-P28 ngân sách/cửa sổ/ngưỡng đánh giá model và ngưỡng STOP số; cộng các quyết định đã có: D-P05, D-P11, D-P13/D-P18, D-P21–D-P24, rebaseline RI-2/HR-27 (D-011), tích hợp M8-C, hướng Router (B-18).

## 10. Không làm trong T0
Không triển khai, không build, không gọi AWS/Bedrock/DB/Redis, không sửa code/pin/benchmark, không migration, không bật cờ, không mở M9.5-T1.
