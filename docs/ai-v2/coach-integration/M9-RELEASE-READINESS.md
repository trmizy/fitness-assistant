# M9-RELEASE-READINESS — Điều kiện phát hành Multi-Agent V2 vào AI Coach trên AWS (M9.5-T0)

Ngày 2026-11-16. Baseline: worktree `ai-v2-coach-integration-plan`, branch `planning/ai-coach-v2-integration`, HEAD `19577276` (**RC-0**). Phiên **chỉ đọc**: git, source và cấu hình trong repo. Không chạy runtime, không gọi AWS/model/DB/Redis, không sửa code, pin, benchmark hay hạ tầng. Tài liệu đi kèm: `M9-BLOCKER-REGISTER.md` (sổ blocker), `M9-AWS-ROLLOUT-PLAN.md` (kế hoạch triển khai).

Nhãn: `CODE FACT` / `CONFIG FACT` (đọc trực tiếp trong repo ở RC-0) · `HISTORICAL REPORT` (phiên trước, không đọc lại ở đây) · `PROPOSED` (AI đề xuất, chưa duyệt) · `NOT VERIFIED`. Hạ tầng dùng thang riêng: `CODE VERIFIED` · `CONFIG VERIFIED` (IaC/workflow trong repo) · `REPORTED DEPLOYED` (chủ dự án/phiên trước nói đã chạy) · `LIVE NOT VERIFIED`. Không có thông tin tài khoản/secret trong tài liệu này.

## 0. Kết luận

**Cập nhật M9.5-T1S:** các phát hiện của review độc lập B-03 (false negative/positive) đã được sửa offline ở `a6b0f3a4` (chỉ `llm/safety_guard.ts`, allowlist sẵn → không thêm file vào delta RI-2/HR-27). B-03 vẫn **FIXED OFFLINE, chưa VERIFIED**: cần review độc lập Codex trên chính commit mới + rà soát lâm sàng nội dung 4 câu trả lời; còn 10 false negative ngoài phạm vi và B-01/B-02 OPEN. `LIVE AWS VERSION: NOT VERIFIED`; hotfix V1 chưa được phép. Chi tiết: M9-BLOCKER-REGISTER B-03.

**Cập nhật M9.5-T1:** B-03 (emergency tự hại/co giật/sốc nhiệt) → `FIXED OFFLINE` ở commit `3fee5775` (chỉ `llm/safety_guard.ts`, allowlist sẵn nên **không** thêm file vào delta RI-2/HR-27). **Chưa VERIFIED**, nội dung câu trả lời PROPOSED, lỗi có sẵn ở V1 (`aws-deploy`) nên có đề xuất hotfix V1 độc lập ở §10. Mọi blocker khác không đổi trạng thái. `LIVE AWS IMPACT: NOT VERIFIED`.

- `MULTI-AGENT V2 PRODUCTION: BLOCKED`. `RELEASE CANDIDATE: NOT READY`.
- Có **15 P1** và 11 P2 mở (`M9-BLOCKER-REGISTER.md`); **0 mục VERIFIED**. Hai P1 an toàn (ký tự vô hình, khoảng hở emergency) và thiếu hụt chuẩn hoá Unicode là lỗi **đã có ở V1 đang chạy** — không do V2 gây ra, nhưng là điều kiện phát hành.
- **An toàn theo thiết kế (CODE FACT):** dù mọi cờ bật, V2 **không thể phục vụ** trên AWS hiện nay: Lambda chạy `NODE_ENV=production` ⇒ cần cả cờ phê duyệt production, store session bền vững, store hạn chế vị thành niên (**không tồn tại** ⇒ 503) và port idempotency/lịch sử (**không tồn tại** ⇒ về V1). Đây là lớp phòng vệ, không phải sự sẵn sàng.
- Khoảng cách RC: RC-0 không chứa các sửa M8-C và hotfix `14716edf`; danh sách file V1-side lệch khỏi pin; không có RC nào được cắt, tag hay build.
- Chưa mở M9.5-T1. Không triển khai, không bật cờ nào.

## 1. Baseline và quan hệ với V1 đã triển khai (`CODE FACT`, git)
| Thực thể | Giá trị |
|---|---|
| RC-0 | `19577276` (planning branch); worktree sạch |
| V1 trong repo (`aws-deploy`) | `e703b714` — là tổ tiên của RC-0; RC-0 hơn **82 commit**, `aws-deploy` không có commit nào ngoài RC-0 |
| Mốc V1 đã nêu trong bộ nhớ dự án | RC1 `3cab8b21` (tổ tiên RC-0); hotfix an toàn `4cde78f7` (tổ tiên); hotfix auth fitness `14716edf` (**không** tổ tiên) |
| Có/không trong RC-0 | M6 RC `b8e595dd`, M8-B `a6b517cd`, `af66b3a3`: có. M8-C `1eaa29a0`/`e7566dff`/`540675fd`, web demo `dd07a5f6`: **không** |
| Số file khác `aws-deploy` | 207 (phần lớn test/benchmark/docs); **V1 đang phục vụ bị chạm bởi 6 file source** |

**Bề mặt thay đổi của V1 so với `aws-deploy` (`CODE FACT`):** `app.ts` (+mount `/ai/v2`), `routes/ai.routes.ts` (+4 dòng: `coachBridgeAsk`, mặc định OFF → `next()`), `schemas/ai.schemas.ts` (giới hạn câu hỏi đổi sang hằng chung `MAX_QUESTION_CHARS` = 2000, **cùng giá trị cũ**), `llm/orchestrator.service.ts` (+15 dòng: guard cân nặng), `llm/safety_guard.ts` + `llm/fitness-concepts.ts` (+ module mới `induced_vomiting_events.ts`, `safety-limits.ts`: thiết kế lại bộ phát hiện tự gây nôn — hotfix an toàn V1 giữ lại theo D-001). Mọi thứ còn lại là file **mới** (agent-v2/, agent-v2-integration/, bridge, preflight, guard).
**Hệ quả:** *Lambda `ai` được đóng gói và triển khai theo từng artifact* (`ai-lambda.zip` gồm toàn bộ dist) ⇒ "chỉ thêm V2" là không thể về mặt đóng gói: triển khai V2 là triển khai **một artifact ai-service mới** chứa cả các thay đổi V1 ở trên. Vì vậy các thay đổi V1 phải đi qua cổng hồi quy V1 như một phát hành V1 (cờ OFF ⇒ hành vi V1 chỉ khác ở: hotfix an toàn nôn/ói, guard cân nặng, mount V2 trả 404 khi cờ OFF). **Đây là điều kiện, không phải "không deploy lại V1".** Khối lượng thay đổi V1 nhỏ nhưng phải được ghi nhận minh bạch.

## 2. Task A — Topology AWS (từ repo, không gọi AWS)
Môi trường duy nhất có trong repo là **DEV** (`fitness-assistant-dev-*`, vùng `ap-southeast-1`). Cấu hình môi trường chạy thật cho người dùng (nếu khác DEV) **không có trong repo** ⇒ `LIVE NOT VERIFIED`. Chủ dự án xác nhận V1 chạy trên AWS (`REPORTED DEPLOYED`).

| Hạng mục | Phát hiện | Mức bằng chứng |
|---|---|---|
| Biên API | **API Gateway HTTP API** (CloudFormation `api-gateway-baseline.yaml`, 119 route "như live tại Phase 15B-HF"). Route AI: `ANY /ai` và `ANY /ai/{proxy+}` → tích hợp `AiIntegration` → Lambda `fitness-assistant-dev-ai`. ⇒ `/ai/ask` và `/ai/v2/*` đã được định tuyến, **không cần route mới** cho bridge | CONFIG VERIFIED (template); live NOT VERIFIED |
| Express gateway (`backend/gateway`) | **Không triển khai lên AWS** (`ci/service-impact-map.json`: "validate-only… docker-compose/local dev only"). Limiter/route của Express gateway **không** áp dụng trên AWS | CONFIG VERIFIED |
| Dịch vụ AI | Lambda: `…-dev-ai` (HTTP), `…-dev-ai-jobs`, `…-dev-ai-worker` (SQS), `…-dev-ai-migrate` (prisma migrate thủ công). Đóng gói `scripts/package-lambda.ts` → `ai-lambda.zip` (handler `dist/lambda.handler`) | CODE/CONFIG VERIFIED |
| Dịch vụ khác | auth/user/fitness/gym/payment = Lambda; chat = **ECS** (cluster + ALB, bật theo yêu cầu) | CONFIG VERIFIED |
| CI/CD | GitHub Actions: `pr-validation`, `dev-build` (artifact + manifest SHA-256), `dev-deploy` (**chỉ** `update-function-code`, `workflow_dispatch`, `dry_run` mặc định true, `environment: dev` cần reviewer duyệt, OIDC role, S3 content-addressed), `dev-preflight` (read-only: CodeSha256 → S3 key → commit — **nguồn rollback**), `infra-plan/deploy` (CloudFormation), `chat-deploy`. Không có `on: push` triển khai | CONFIG VERIFIED |
| Smoke | `GET /health` (lambda-invoke); **không** gọi AI/Bedrock; POST `/ai/chat` có ghi "NEVER selected / separate opt-in" | CONFIG VERIFIED |
| DB | Aurora (PostgreSQL) — DB `fitness_assistant_ai` cho ai-service; URL lấy từ Secrets Manager (`DATABASE_SECRET_ID`), ép `database` đúng tên; có alarm Aurora CPU/capacity | CODE+CONFIG VERIFIED |
| Secrets | Secrets Manager (DB), `INTERNAL_SERVICE_SECRET` bắt buộc khi khởi động; **không** có giá trị nào trong tài liệu này | CODE VERIFIED |
| Redis | **Không có ElastiCache/Redis trong IaC AWS** (chỉ trong docker-compose; `docker-compose.prod.yml` ghi ElastiCache là "future work") | CONFIG VERIFIED |
| DynamoDB | Rate-limit provider `dynamodb` (cần bảng); bảng do script riêng tạo (dry-run mặc định); adapter session V2 có nhưng **không có bảng/IAM** trong IaC | CODE VERIFIED; bảng live NOT VERIFIED |
| Bedrock | Adapter Nova Pro (`apac.amazon.nova-pro-v1:0`, env `BEDROCK_CHAT_MODEL`); Lambda ra Bedrock cần NAT (không có VPC endpoint); IAM Bedrock cho role Lambda **không có trong repo** | CODE VERIFIED; quyền NOT VERIFIED |
| Giám sát | CloudFormation `app-monitoring.yaml`: alarm `Errors` theo Lambda (gồm `…-dev-ai`), Aurora; **không** có chỉ số/alarm riêng cho V1 so với V2 | CONFIG VERIFIED |
| Health | `/health` mỗi dịch vụ (smoke). Không có health check mức V2 | CONFIG VERIFIED |
| Rollback | Redeploy artifact trước đó (CodeSha256 ghi trong "rollback-record" của dev-deploy; `dev-preflight` ánh xạ CodeSha256 → `ci-artifacts/<svc>/<gitSha>/<sha256>.zip`). Chưa có cơ chế phiên bản/alias Lambda hay triển khai dần trong repo | CONFIG VERIFIED |
| Vòng đời DEV | DEV tắt theo lịch/`dev-start`/`dev-stop` (chủ ý, tiết kiệm chi phí) — đã từng làm smoke thất bại vì DEV dừng (HISTORICAL) | CONFIG + HISTORICAL |

`AWS TOPOLOGY: PARTIAL` (đọc đủ cho DEV; môi trường chạy thật và trạng thái live chưa kiểm). Mục tiêu "nâng cấp rủi ro thấp nhất": giữ nguyên biên API và route, chỉ thay artifact Lambda `ai` (+ cấu hình qua quy trình CONFIG_DEPLOY riêng) và để mọi cờ OFF.

## 3. Release candidate gap (tóm tắt)
1. Quyết định RC: cắt từ nhánh nào, gồm gì (M8-C? hotfix?). 2. Tích hợp M8-C (B-08) rồi chạy lại toàn bộ suite + Codex. 3. Đóng P1 an toàn B-01/02/03 (một phần là V1 patch). 4. Store bền vững + port (B-05/12/13) và IaC (B-20). 5. Tái lập danh tính phát hành (B-14). 6. Đánh giá độc lập M9 (B-26). 7. Build artifact bất biến (dev-build) và ghi manifest. **Không** có bước nào được thực hiện ở T0.

## 4. Product requirement — đối chiếu (`CODE FACT`)
Kiến trúc đích khớp code: `UI hiện có → API Gateway hiện có → ai-service (/ai/ask) → Coach Bridge → V1 | V2`. V1 là mặc định (cờ OFF ⇒ `next()` dòng đầu). Chưa bắt đầu V2 (cờ OFF, ngoài allowlist, capability không hỗ trợ, thiếu port) ⇒ V1; **đã bắt đầu V2** ⇒ quyết định là cuối cùng, **không** fallback (D-009). Redis/DB/model lỗi không được tạo "fallback an toàn": lỗi tạo runtime/store ⇒ 503 + IN_DOUBT, không chuyển sang V1 sau khi V2 đã chạm trạng thái an toàn.

## 5. Task C — Ghim phát hành RI-2 và HR-27
**Cơ chế (`CODE FACT`):** cả hai là kiểm tra **phạm vi** bằng `git diff --name-only` so với một mốc, không đo hành vi. RI-2 (`agent-v2-release-identity.test.ts:54`): (1) danh sách file V1-side (ngoài `agent-v2`, `__tests__`, `generated`) thay đổi từ M6 RC `b8e595dd` phải **bằng đúng** `ALLOWED_V1` (17 file); (2) không file nào ngoài `ai-service` đổi (trừ `docs/ai-v2`, `.codex`); (3) `app.ts` chỉ có dòng thêm vào liên quan `aiV2Routes`. HR-27 (`agent-v2-hybrid-router.test.ts:314`): từ mốc `4898b54d`, chỉ một danh sách nhỏ file V1-side được thay đổi.
**Vì sao baseline pass:** ở M6 RC/M7 danh sách file V1-side đúng bằng allowlist (chỉ composition root, route V2, hotfix an toàn V1 đã được owner duyệt).
**M9 đã thay đổi ngoài phạm vi (so với M6 RC):**
- **7 file V1-side không có trong allowlist:** `llm/orchestrator.service.ts`, `llm/personal_weight_guard.ts`, `routes/ai.routes.ts`, `services/coach-bridge.middleware.ts`, `services/coach-capability-preflight.ts`, `services/coach-v2-bridge.ts`, `services/coach-v2-continuity.ts`.
- **12 file ngoài ai-service:** `CLAUDE.md`, 9 file `frontend/web/src/**`, 2 file `scripts/git/check-staged-test-artifacts.*`.
- HR-27 lệch bởi cùng nhóm (ngoài ra tính từ mốc `4898b54d`).
**Assertion bị che:** RI-2 dừng ở assertion (1) nên (2) và (3) không được đánh giá. Kiểm bằng git ở đây (`CODE FACT`): (3) sẽ **pass** (`app.ts` chỉ +4 dòng thêm: import, mount và chú thích); (2) sẽ **fail** (12 file ngoài). **Test thực sự đo hành vi:** RI-1 (tổ tiên), RI-3/RI-5 (router khoá sha, artifact benchmark đóng băng bất biến), RI-4 (cờ OFF mặc định), `V1R-6`-họ (V1 giống baseline), và toàn bộ họ `agent-v2-*` (1413/1418 pass, chỉ RI-2/HR-27 fail — M9.4-T3). Hai pin này đo *phạm vi*, nên "pin xanh" không chứng minh hành vi và "pin đỏ" không chứng minh hồi quy.
**Lưu ý CI:** script `test` của ai-service chạy `src/__tests__/*.test.ts` và `docker-test.yml` chạy `pnpm run --recursive test` ⇒ RI-2/HR-27 sẽ làm đỏ CI chuẩn khi nhánh này được đẩy lên (chưa kiểm vì không chạy CI).
**Quy trình tái lập danh tính (PROPOSED — chưa duyệt, không tự rebaseline):**
1. Đóng băng code RC (không còn thay đổi hành vi). 2. Chủ dự án phê duyệt **bằng văn bản từng file** thêm vào allowlist kèm lý do (7 + 12 ở trên, cộng bất cứ gì phát sinh) trong một commit riêng chỉ sửa pin. 3. Điều kiện **trước** khi được phép đổi pin: toàn bộ họ `agent-v2-*` và `llm` pass (trừ chính hai pin), RI-1/3/4/5 pass, artifact benchmark byte-identical, bộ so sánh V1 cờ-OFF (V1R) giống baseline, Codex xem diff V1-side không có P0/P1, các blocker B-01/02/03/08 đã được xử lý hoặc chấp nhận có ghi chép. 4. Sau đổi pin: chạy lại toàn bộ và ghi mốc mới (tag RC) — chỉ khi owner cho phép (D-001).

## 6. Task D — Thiết kế trạng thái bền vững (PROPOSED; không migration, không thực thi)
Hạ tầng hiện có (`CONFIG FACT`): Aurora PostgreSQL (DB ai riêng), DynamoDB (đã dùng cho rate-limit; adapter session V2 có sẵn), SQS (worker), **không có Redis**. In-memory/mock **không** là bằng chứng an toàn multi-instance (Lambda tạo nhiều execution environment).

| Trạng thái | Cần | Độ bền | Nguyên tử | Retention | Đề xuất (PROPOSED) |
|---|---|---|---|---|---|
| **Hạn chế vị thành niên** (an toàn) | theo `userId`; một bản ghi/user: owner, provenance, thời điểm, số lần, `expiresAt` (điểm xem xét, không phải quyền) | **Bền, không mất khi restart/scale** | CAS có phiên bản (đã có hợp đồng) | Không xoá tự động; **không dùng TTL tự xoá** (xoá bản ghi = gỡ hạn chế — vi phạm D-004); chỉ gỡ ngoài luồng bởi quy trình có kiểm toán | DynamoDB bảng riêng, conditional write theo version, **không bật TTL**; hoặc bảng Postgres trong DB ai. Tránh Redis (chưa có hạ tầng; evict/persistence khó bảo đảm). Chọn: D-P25 |
| **Idempotency + IN_DOUBT** | khoá `(userId, clientRequestId)`; trạng thái claimed/completed/in-doubt; hash yêu cầu | Bền trong cửa sổ retry | Claim nguyên tử (put-if-absent) | Ngắn (ví dụ 24 h, theo chính sách duyệt) — TTL **phù hợp** ở đây | DynamoDB conditional put (có mẫu hạ tầng); chính sách IN_DOUBT (hết hạn, thử lại) cần owner duyệt (D-P11/D-P16) |
| **Session affinity / ngữ cảnh hội thoại V2** | ngữ cảnh theo `(userId, sessionId)`; `sessionId` chỉ là gợi ý | Trung bình (mất ⇒ mất ngữ cảnh, không mất an toàn vì hạn chế nằm store riêng) | CAS (adapter có sẵn) | TTL được | Adapter DynamoDB đã viết (`329ff0be`): cần bảng + IAM (B-20); **không** dùng làm nơi giữ hạn chế |
| **Lịch sử hội thoại** | `ChatSession`/`Conversation` hiện có; thêm engine/turn metadata | Bền (dữ liệu sản phẩm) | Giao dịch Postgres | Theo chính sách V1 hiện có | Port repository theo hợp đồng V1 (D-012). Metadata: bảng phụ (side table) khuyến nghị cho D-P18; migration expand–migrate–contract qua Lambda `ai-migrate` — **chỉ đề xuất** |
| **Pending registry (quarantine)** | hiện in-process | Không bền (giới hạn đã khai báo) | — | — | Bỏ phụ thuộc vào registry khi store bền vững có write-ahead đáng tin; nếu giữ thì chỉ là tối ưu, không phải bảo đảm |
| **Concurrency/Restart** | nhiều instance song song | — | CAS/conditional write ở mọi store | — | Test song song + restart trên hạ tầng thật (DEV) trước khi coi là đạt |

Fail-closed (bất biến): lỗi đọc/ghi store an toàn ⇒ coi là bị hạn chế (đã là hành vi hiện có), lỗi khởi tạo ⇒ 503; **không** fallback sang V1 sau khi V2 đã chạm trạng thái an toàn.

## 7. Task E — Cổng mô hình & chất lượng (PROPOSED; chưa gọi model)
**Điều kiện tối thiểu để chạy Nova theo D-006:** (1) chủ dự án duyệt rõ: Nova Pro duy nhất, ngân sách, cửa sổ thời gian, phạm vi dữ liệu; (2) một tài khoản/role có quyền Bedrock đã xác nhận (`HISTORICAL REPORT`: Nova Pro chạy được qua profile AWS khác tài khoản chạy V1; quyền trên tài khoản dev `NOT VERIFIED`) và đường mạng (NAT) hoặc chạy đánh giá ngoài Lambda; (3) mọi lượt qua cổng provider + sổ cái token/chi phí (harness có sẵn từ `3cab8b21`), `maxCostUsd` 0.08/lượt đã là trần mã, thêm trần **tổng** ngân sách và dừng cứng; (4) dữ liệu tổng hợp, không dữ liệu thật; (5) không Opus/Sonnet/Gemini (D-006) — giám khảo model cần duyệt riêng, mặc định đánh giá mù bởi người.
**Kế hoạch đánh giá:** E1 bộ câu kỹ thuật tổng hợp (định tuyến, tool, an toàn, đa miền) · E2 bộ độc lập riêng (không trộn với 300 câu AI-labeled hay bộ pilot) · E3 cặp V1/V2 cùng câu/cùng dữ liệu · E4 chấm mù (đúng/đủ/an toàn/ngôn ngữ) · E5 grounding + hallucination (cân nặng và số cá nhân khác) · E6 độ chính xác tool (tool đúng/đủ/không thừa) · E7 hồi quy an toàn (cả hai engine) · E8 độ trễ p50/p95/p99 + so với B-19 · E9 token/chi phí/lượt · E10 hành vi lỗi/timeout/fallback (không fallback sau khi V2 đã chạy). Báo cáo theo ca/nhóm, có khoảng tin cậy; **không** đặt ngưỡng release chính thức ở đây, **không** gọi G7/G8, **không** tuyên bố hơn V1 khi chưa có bằng chứng. **Đề xuất ngân sách (PROPOSED, owner đặt số):** pilot nhỏ (vài chục lượt) để đo token/độ trễ → ước tính, rồi trần cứng = chi phí ước tính × hệ số an toàn do owner chọn; cơ chế: sổ cái chi phí trong harness + hủy toàn bộ khi chạm trần + log chỉ số liệu (không nội dung).

## 8. Thứ tự đóng blocker (PROPOSED)
1. **Quyết định & quy trình:** định nghĩa RC; chính sách tích hợp M8-C (B-08); hướng router (B-18); D-P22/D-P24/D-P25/D-P26. 2. **P1 an toàn dùng chung (cũng vá V1 đã triển khai):** B-01 → B-02 → B-03 (+Codex). 3. **Trạng thái bền vững:** B-05/07 (hạn chế) → B-12 (idempotency) → B-13 (lịch sử) → B-20 (IaC) — kiểm chứng trên DEV thật. 4. **Dịch vụ thật:** B-15 (xác nhận phiên bản fitness/user), B-11 (cách ly với tài khoản test). 5. **Model:** B-16 → E1–E10 (B-17, B-19). 6. **Vận hành:** B-21 (kill switch), B-22 (log), B-24 (rate-limit), B-26 (đánh giá độc lập). 7. **Đóng băng + tái lập danh tính:** B-14; cắt RC bất biến. 8. Diễn tập rollback (Phase 1). Chỉ sau đó owner xét Phase 2–3.

## 9. Giới hạn của lần audit này
Không chạy test/CI/reproducer mới; mức P1 của B-02, B-03 dựa trên đọc source; hạ tầng chỉ đọc IaC/workflow trong repo (không biết trạng thái live, không biết tài nguyên ngoài IaC); không biết cấu hình timeout/bộ nhớ Lambda thật; các báo cáo M8/Codex là `HISTORICAL REPORT`. Không dùng tài liệu `docs/*.md` khác làm sự thật hiện tại.

## 10. Đề xuất hotfix V1 độc lập cho B-03 (PROPOSED — chưa duyệt; D-001 **không** được coi là cho phép)
**Bối cảnh (`CODE FACT`):** khoảng hở B-03 có ở source `aws-deploy` (`e703b714`) — bản V1 trong repo — chứ không chỉ ở RC-0. Phiên bản **đang chạy thật** trên AWS là `LIVE NOT VERIFIED` (có thể map CodeSha256 → commit bằng workflow `dev-preflight` read-only, do con người chạy). Người dùng thật có thể bị ảnh hưởng nếu V1 live giống `aws-deploy`: một tin nhắn tự hại/co giật/sốc nhiệt được trả lời như câu hỏi fitness thường.
- **Phạm vi tối thiểu:** chỉ guard an toàn V1 (`llm/safety_guard.ts`) + test của nó; không V2, không bridge, không guard cân nặng, không thay đổi Unicode. **Không thể áp thẳng bản vá M9.5-T1:** guard của `aws-deploy` chưa có `foldSafetyText`, `safetyForms`, `SafetyCheckOptions` (đã kiểm: 0 lần xuất hiện) — cần một bản *port* tự chứa (hàm fold nội bộ nhỏ, không `accentFoldedRetry`), viết và kiểm thử riêng trên nền `aws-deploy`.
- **Điều kiện trước khi trình duyệt:** (1) rà soát lâm sàng/chủ dự án nội dung 3 câu trả lời và quyết định D-P29 (ngôi thứ ba, over-triage, đường dây hỗ trợ địa phương); (2) Codex/đánh giá độc lập không còn P0/P1 trên diff; (3) bộ test RED/GREEN + differential trên nền `aws-deploy` (0 Unsafe→Safe; mọi câu lành tính giữ verdict); (4) toàn bộ suite V1 của `aws-deploy` xanh; (5) xác định bản đang chạy (preflight) và nhánh/commit gốc cho artifact.
- **Kiểm thử:** như (3)/(4); smoke `/health` của pipeline hiện có **không** gọi AI nên không chứng minh hành vi — cần kiểm tra có điều kiện trên DEV bằng tài khoản thử nghiệm được phép (REAL HTTP/API), không bằng người dùng thật.
- **Rollback:** triển khai lại artifact trước đó theo `rollback-record` (CodeSha256) của `dev-deploy`, xác minh bằng `dev-preflight`; thay đổi chỉ là code (không cờ, không dữ liệu, không migration) nên rollback không để lại trạng thái.
- **Phê duyệt:** chủ dự án phê duyệt riêng từng bước (build artifact → `dev-deploy` dry-run → deploy thật → xác minh); không tự động, không gộp vào phát hành Multi-Agent (D-001 giữ nguyên cho V2). Không có hotfix production nào được thực hiện trong M9.5-T1.

### 10.1 Cập nhật M9.5-T1S — ảnh hưởng đến khả năng port hotfix V1
Candidate `a6b0f3a4` lớn hơn bản T1 (đoạn B-03 ~+240/−55 dòng, phụ thuộc `foldSafetyText`, `MEDICAL_PATTERNS`, `SafetyCheckOptions` — **không có** trong guard của `aws-deploy`). Một bản port tự chứa cho `aws-deploy` phải sao chép đoạn B-03 cùng một hàm fold nội bộ nhỏ và tự cài kiểu `SafetyCheckOptions` (hoặc bỏ tham số), rồi chạy **toàn bộ** test trong §10 trên nền `aws-deploy`. Danh sách file tối thiểu không đổi (`safety_guard.ts` + hai file test B-03); khối lượng review tăng, nên review độc lập **phải** nhắm vào đúng commit sẽ được port. Chưa viết bản port nào; hotfix vẫn **chưa được phép** (D-P30).
