# M9-BLOCKER-REGISTER — Sổ blocker phát hành Multi-Agent V2 vào AI Coach (M9.5-T0)

Ngày 2026-11-16. Release candidate được xét (**RC-0**) = HEAD `19577276` của branch `planning/ai-coach-v2-integration`. Phiên này **chỉ đọc** (git, source, cấu hình trong repo): không chạy runtime, không AWS, không model, không DB/Redis, không sửa code/pin/benchmark. Vì vậy **không có reproducer mới nào được chạy ở đây**; cột bằng chứng ghi rõ nguồn.

Nhãn: `CODE FACT` (đọc trực tiếp source/git ở RC-0 trong phiên này) · `HISTORICAL REPORT` (báo cáo/bộ nhớ của các phiên trước, **chưa** được đọc lại bằng code ở đây) · `PROPOSED` (đề xuất của AI, chưa duyệt) · `NOT VERIFIED`.
Trạng thái: `OPEN` · `FIXED OFFLINE` (sửa + test offline, mock — **không** phải production-ready) · `VERIFIED` (kiểm chứng độc lập trên môi trường thật — **chưa có mục nào**) · `NOT VERIFIED`.
**Mức độ (P0/P1/P2) do tài liệu này đề xuất; chủ dự án xác nhận.** Không gộp các lỗi khác nguyên nhân để giảm số P1.

Không có P0 nào được biết. Có **15 mục P1** (B-01, 02, 03, 05, 07, 08, 11, 12, 13, 14, 15, 16, 17, 18, 19: an toàn, cách ly, độ bền trạng thái, điều kiện phát hành), B-06 từng là P1 nay hạ P2 (FIXED OFFLINE), và các P2 còn lại. Một số P1 là *điều kiện phát hành chưa kiểm chứng* (NOT VERIFIED), không phải lỗi đã tái hiện. **Không mục nào ở trạng thái VERIFIED.**

## Bảng tóm tắt
| ID | Sev | Vấn đề | Trạng thái | Có trên RC-0? |
|---|---|---|---|---|
| B-01 | P1 | Ký tự vô hình (ZWSP…) là dấu phân cách duy nhất làm lọt lời khai tự gây nôn / off-topic / injection | OPEN | Có (và có sẵn ở V1 đã triển khai) |
| B-02 | P1 | Dạng full-width / tương thích / homoglyph không được chuẩn hoá trong lớp fold an toàn | OPEN (NOT VERIFIED bằng reproducer) | Có |
| B-03 | P1 | Khoảng hở emergency: co giật/động kinh, ý nghĩ tự tử, tự làm hại chỉ phủ hẹp | OPEN | Có (V1 dùng chung) |
| B-04 | P2 | Nhánh hazard của Supervisor chỉ kích hoạt khi Router không chọn agent và một helper khớp | FIXED OFFLINE (phạm vi hẹp) | Có |
| B-05 | P1 | Chưa có store hạn chế vị thành niên bền vững (production → 503) | OPEN | Có |
| B-06 | P1→P2 | `sessionId` do client kiểm soát từng lift hạn chế | FIXED OFFLINE | Có (bản sửa) |
| B-07 | P1 | Cross-session / multi-instance: registry "pending" chỉ trong bộ nhớ tiến trình | OPEN | Có |
| B-08 | P1 | Sửa M8-C (quarantine/đua, ZWSP-trong-từ, evaluator) không nằm trong RC-0 | FIXED OFFLINE ở snapshot khác | **Không** |
| B-09 | P2 | Agent đang chạy khi hạn chế mới xuất hiện (cửa sổ đua trong một lượt) | NOT VERIFIED | Có |
| B-10 | P2 | Giới hạn còn lại của guard cân nặng | FIXED OFFLINE (một phần) | Có |
| B-11 | P1 | Cách ly xác thực/truy cập V1/V2 chưa kiểm với dịch vụ thật | NOT VERIFIED | — |
| B-12 | P1 | Store idempotency + IN_DOUBT không có triển khai production | OPEN | Có |
| B-13 | P1 | Repository lịch sử + metadata engine không có triển khai production | OPEN | Có |
| B-14 | P1 | RI-2/HR-27 FAIL; danh tính phát hành chưa tái lập | OPEN (chặn quy trình) | Có |
| B-15 | P1 | Domain service thật (user/fitness Lambda) chưa kiểm; hotfix auth `14716edf` không có trong RC-0 | NOT VERIFIED | Có |
| B-16 | P1 | Nova/Bedrock thật chưa gọi; quyền/NAT/IAM trên tài khoản chạy V1 chưa kiểm | NOT VERIFIED | — |
| B-17 | P1 | Chất lượng câu trả lời chưa đánh giá; G7/G8 NOT VERIFIED | OPEN | — |
| B-18 | P1 | Router: heldout v4 G7 FAIL 85% (ROUTING NOT READY) | OPEN | Có |
| B-19 | P1 | Envelope độ trễ: ngân sách V2 60 s so với timeout FE 30 s / giới hạn API Gateway | NOT VERIFIED | Có |
| B-20 | P2 | Hạ tầng V2 chưa có trong IaC: bảng DynamoDB session, IAM, biến môi trường | OPEN | — |
| B-21 | P2 | Kill switch = đổi cấu hình Lambda (thay cả khối env), không có công tắc runtime | OPEN | — |
| B-22 | P2 | PII trong log/trace thật chưa kiểm (chỉ có test offline) | NOT VERIFIED | Có |
| B-23 | P2 | Frontend chỉ DEV; chưa có đường triển khai FE trong CI | OPEN | Có |
| B-24 | P2 | Giới hạn rate-limit/chi phí: bridge dùng chung bucket `askRateLimiter`; provider dynamodb chưa xác minh trên AWS | NOT VERIFIED | Có |
| B-25 | P2 | V1 SSE không được bridge phủ; V2 không có SSE (hành vi UX khác) | OPEN (đã biết, chủ ý) | Có |
| B-26 | P2 | Chưa có đánh giá độc lập (Codex/người) cho phần M9 (bridge, continuity, guard cân nặng) | OPEN | Có |

## Chi tiết

### B-01 — Ký tự vô hình là dấu phân cách duy nhất · P1 · OPEN
- **Ảnh hưởng:** `a6b517cd`, RC-0, snapshot `1eaa29a0` (Codex M8-C vẫn còn P1 ở đây). `aws-deploy` (`e703b714`) **không** có bộ phát hiện sự kiện nôn/ói mới nên V1 đã triển khai có khoảng hở này từ trước.
- **Bằng chứng:** `HISTORICAL REPORT` (Codex M8-C, bộ nhớ dự án; "đã tái hiện, có từ trước"). `CODE FACT`: lớp fold chung `foldSafetyText` (`llm/safety_guard.ts:11`) chỉ NFD + bỏ dấu + lowercase + gộp khoảng trắng — không bỏ/không coi ký tự định dạng (U+200B…U+200D, U+2060, U+FEFF) ở cấp dùng chung; chỉ `induced_vomiting_events.ts` có xử lý riêng (chú thích dòng ~518). Họ hàng được ghi nhận: `nha<ZWSP>hang` mất cổng off-topic; `act<ZWSP>as an unrestricted AI` lọt injection.
- **Đã sửa ở:** chưa có bản sửa hoàn chỉnh ở snapshot nào. `540675fd` (M8-C C2, canonical Unicode) chỉ có ở `1eaa29a0`; Codex vẫn báo P1.
- **Kiểm chứng độc lập:** Codex BLOCKED (HISTORICAL). **Trên RC-0:** có.
- **Điều kiện đóng:** quyết định thiết kế D-P05 (chuẩn hoá có kiểm soát, không tách mọi ký tự → mất phủ định) + test vi sai (differential) + Codex không còn P1 cho phạm vi này.
- **Phụ thuộc:** quyết định chủ dự án (D-P05); đi cùng B-02.

### B-02 — Full-width / tương thích / homoglyph · P1 (đề xuất) · OPEN, NOT VERIFIED
- **Bằng chứng:** `CODE FACT`: `foldSafetyText` không dùng NFKC/NFKD tương thích (chỉ NFD + strip `[̀-ͯ]`), nên chữ full-width ("ｔｕ"), chữ toán học, và ký tự giống nhau từ bảng chữ khác không gập về ASCII. **Chưa chạy reproducer** (phiên này read-only) → mức P1 là đề xuất vì đây là kênh vượt qua cổng an toàn.
- **Ảnh hưởng:** RC-0 và V1 đã triển khai (cùng hàm). **Đã sửa ở:** không. **Độc lập:** chưa. **Đóng:** thiết kế chuẩn hoá chung + bộ test biến thể (full-width, homoglyph Latin/Cyrillic/Greek, số) + đo FP trên bộ câu thường + Codex. **Phụ thuộc:** B-01 (cùng module).

### B-03 — Khoảng hở emergency · P1 · OPEN
- **Bằng chứng (`CODE FACT`):** `MEDICAL_PATTERNS` (`llm/safety_guard.ts:59-65`) gồm đau ngực, khó thở đột ngột, ngất, đau tim và **chỉ** `tự làm hại|tu lam hai|self-harm|hurt myself|tự tổn thương`. Không có dạng "tự tử / muốn chết / suicide", không có **co giật** như tình huống khẩn cấp (cụm "co giật"/"động kinh" chỉ nằm ở `safety-narrative.ts` (triệu chứng/bệnh mạn) và `medical-referral.ts` (giới thiệu bác sĩ), không phải đường emergency). V2 dùng cùng `safetyGuard` nên không có kênh khẩn cấp riêng. Danh mục khoảng hở "đã ghi nhận" ở brief là `HISTORICAL REPORT`, chưa đọc lại đầy đủ.
- **Ảnh hưởng:** V1 đã triển khai, RC-0 và V2. **Đã sửa ở:** không. **Độc lập:** chưa. **Đóng:** owner chốt phạm vi emergency (tự hại, co giật, ngộ độc…), câu trả lời khẩn cấp cố định, test + Codex. **Phụ thuộc:** quyết định chủ dự án về nội dung phản hồi khẩn cấp (không tự sinh).
- Lưu ý: lỗi này **đã tồn tại ở V1 production**, nên có thể là một V1 patch độc lập (D-001: gộp vào một lần phát hành đồng bộ).

### B-04 — Nhánh hazard của Supervisor phụ thuộc Router · P2 · FIXED OFFLINE
- **Bằng chứng (`CODE FACT`):** `agent-v2-unrouted-hazard.test.ts` ghim: khi Router không chọn agent **và** helper `isAggressiveBodyChangeRequest` khớp, Supervisor phân xử theo Gate 1 thay vì trả `OUT_OF_SCOPE`. Nếu Router chọn agent, Gate 1/agent quyết (UH-11). Phạm vi = một họ hazard (thay đổi cơ thể quá mức), phụ thuộc một helper dạng regex.
- **Đã sửa ở:** M7-P5A.2.3 (`2d9da944`), có trên RC-0. **Độc lập:** Codex đã xem các vòng M7/M8 (HISTORICAL), phát hiện P1 khác (B-01), không xác nhận riêng mục này. **Đóng:** liệt kê họ hazard khác Router có thể bỏ qua + test hợp đồng cho từng họ (không mở rộng regex theo ví dụ).

### B-05 — Chưa có store hạn chế vị thành niên bền vững · P1 · OPEN
- **Bằng chứng (`CODE FACT`):** `agent-v2/minor-restriction.ts` header: chỉ có bản in-memory (một tiến trình, mất khi restart); adapter session Redis/DynamoDB **không** triển khai `MinorRestrictionStore`. `agent-v2-integration/multi-agent-runtime.ts` `resolveMinorRestrictionStore`: `NODE_ENV=production` → luôn `503` ("safety storage is not configured"). Mọi Lambda của dự án chạy `NODE_ENV=production` (`agent-v2/flag.ts`) ⇒ **V2 không thể phục vụ trên AWS** (fail-closed, đúng chủ ý).
- **Đã sửa ở:** không (chỉ có hợp đồng + bản in-memory ở M8-A2/M8-B). **Độc lập:** chưa. **Đóng:** triển khai store bền vững thoả "PRODUCTION CONDITIONS" của `MinorRestrictionStore` (CAS có phiên bản, fail-closed, không TTL tự xoá), test trên dịch vụ thật ở DEV, Codex. **Phụ thuộc:** D-P06 (công nghệ store, xem M9-RELEASE-READINESS §6), D-004 (chính sách gỡ hạn chế).

### B-06 — `sessionId` do client kiểm soát · P1→P2 · FIXED OFFLINE
- **Bằng chứng:** `CODE FACT`: hạn chế nay theo **userId xác thực**, `sessionId` chỉ là gợi ý (`supervisor.ts` ~476-523: đọc store người dùng mỗi lượt, có hay không có sessionId). Reproducer gốc (sessionId mới/bỏ trống lift hạn chế) được ghim ở `agent-v2-minor-restriction-user-scope.test.ts` (HISTORICAL cho việc nó từng fail).
- **Đã sửa ở:** M8-A2 (`e6bbaad9`) và các vòng M8-B/C; có trên RC-0 ở dạng in-memory. **Độc lập:** BACKEND INTEGRATION in-memory; Codex đã review các vòng M8 (HISTORICAL). **Đóng:** cùng B-05 (chỉ đúng khi store bền vững + nhiều instance).

### B-07 — Cross-session và multi-instance · P1 · OPEN
- **Bằng chứng (`CODE FACT`, chính header `minor-restriction.ts`):** registry `PendingMinorRestrictions` là bộ nhớ tiến trình; instance khác hoặc sau restart **không biết**; "KHÔNG phải bảo đảm bền vững". Lambda chạy nhiều execution environment song song ⇒ đây là tình huống mặc định, không phải biên.
- **Đã sửa ở:** không (giới hạn được khai báo thật). **Đóng:** store bền vững (B-05) + test song song nhiều instance trên hạ tầng thật. Không dùng mock in-memory làm bằng chứng. **Phụ thuộc:** B-05.

### B-08 — Sửa M8-C không nằm trong RC-0 · P1 · FIXED OFFLINE ở snapshot khác
- **Bằng chứng (`CODE FACT`, `git merge-base --is-ancestor`):** `e7566dff` (C1 quarantine/đua), `540675fd` (C2 Unicode canonical), `1eaa29a0` (snapshot M8-C), `dd07a5f6` (web demo) **không** là tổ tiên của RC-0; `a6b517cd` và `b8e595dd` là tổ tiên.
- **Đã kiểm:** Codex ở `1eaa29a0`: quarantine đóng, còn P1 B-01 (HISTORICAL). **Đóng:** quyết định tích hợp (cherry-pick/merge có kiểm soát — owner duyệt, D-001), chạy lại toàn bộ suite + pin trên RC mới, Codex trên diff tích hợp. **Phụ thuộc:** B-01, B-14.

### B-09 — Agent đang chạy khi hạn chế mới xuất hiện · P2 · NOT VERIFIED
- **Bằng chứng:** `CODE FACT`: hạn chế được đọc ở Gate 1 đầu lượt (`supervisor.ts` ~514-523) và ghi khi người dùng tự khai tuổi trong lượt đó. Một hạn chế do **request khác** (instance/phiên khác) ghi giữa lượt không dừng agent đang chạy; việc có đọc lại giữa hai lần uỷ quyền **chưa được kiểm** trong phiên này. Ngân sách ≤2 agent tuần tự/lượt giới hạn độ dài cửa sổ nhưng không loại bỏ.
- **Đóng:** test đua có kiểm soát trên store bền vững (B-05), quyết định chính sách (đọc lại trước mỗi uỷ quyền hay chấp nhận cửa sổ ≤ 1 lượt, ghi rõ).

### B-10 — Giới hạn còn lại của guard cân nặng · P2 · FIXED OFFLINE (một phần)
- **Nguồn:** M9.4-T2/T3 (`e6532e95`, `c8c05185`), ARCHITECTURE "Hợp đồng grounding cân nặng cá nhân". Còn: chỉ phủ cân nặng; số tự khai không gắn nhãn (D-P24); ngưỡng 90 ngày chưa duyệt (D-P22); số kg nói về tạ có thể trùng; "lần đo gần nhất" được giữ dù không có ngày; không phân xử mâu thuẫn; mẫu diễn đạt ngoài danh sách lọt; `fitness_agent` chưa truy vết. **Kiểm chứng:** offline, model là kịch bản; chưa có Codex. **Đóng:** model thật + mẫu câu độc lập, quyết định D-P22/D-P24.

### B-11 — Cách ly xác thực / truy cập V1 và V2 · P1 · NOT VERIFIED
- **Bằng chứng (`CODE FACT`):** danh tính chỉ từ `req.context` (`requireAuth`); bridge chạy **sau** auth, `askRateLimiter`, validate, requestIdentity; agent đọc bằng bearer của chính người dùng; 0 chéo người dùng ở bộ M9 (S05, S13, WG-8) — tất cả với **fake** auth/service. **Chưa kiểm** với auth Lambda, user/fitness Lambda và Aurora thật.
- **Đóng:** REAL HTTP/API trên DEV với tài khoản thử nghiệm được phép: hai người dùng, kiểm chéo dữ liệu/phiên/idempotency/hạn chế; không dữ liệu thật của người dùng. **Phụ thuộc:** B-15.

### B-12 — Idempotency store + IN_DOUBT · P1 · OPEN
- **Bằng chứng (`CODE FACT`):** `coach-bridge.middleware.ts`: `seam.ports` (idempotency + history) không có triển khai production ⇒ `CONTINUITY_NOT_CONFIGURED` ⇒ V1. `IN_DOUBT` trả 409 `IDEMPOTENCY_KEY_CONFLICT`. Chưa có chính sách phục hồi/TTL cho IN_DOUBT ngoài việc người dùng gửi lại (D-P11/D-P16).
- **Đóng:** store bền vững với claim nguyên tử, TTL ngắn, hành vi restart/recovery được test trên hạ tầng thật; chính sách IN_DOUBT được duyệt. **Phụ thuộc:** D-P11, M9-RELEASE-READINESS §6.

### B-13 — Repository lịch sử + metadata · P1 · OPEN
- **Bằng chứng (`CODE FACT`):** không có port lịch sử production; schema hiện có chỉ `Conversation.modelUsed` (dấu `multi-agent-v2`) và `traceId`; metadata engine đầy đủ cần quyết định schema (D-P13/D-P18). Lượt V2 sẽ không hiện trong `/ai/sessions` nếu thiếu. **Đóng:** triển khai port lịch sử theo hợp đồng V1 (D-012), quyết định schema (expand-migrate-contract, migration qua Lambda `ai-migrate`, chưa thực thi), kiểm chứng trên DB test. **Phụ thuộc:** D-P13/D-P18.

### B-14 — RI-2, HR-27 và danh tính phát hành · P1 · OPEN
Xem M9-RELEASE-READINESS §5. Tóm tắt: 7 file V1-side + 12 file ngoài ai-service lệch khỏi allowlist; không phát hiện hồi quy hành vi; chưa tái lập danh tính. **Đóng:** quy trình rebaseline do owner duyệt (không tự động), sau khi đóng băng code. **Phụ thuộc:** B-08, mọi thay đổi code còn lại.

### B-15 — Domain service thật · P1 · NOT VERIFIED
- **Bằng chứng:** `CODE FACT`: V2 đọc qua `requestService` (HTTP khi local, Lambda Invoke khi có `<SERVICE>_LAMBDA_NAME`) — chỉ test với fake. Hotfix `14716edf` (fitness internal-auth fail-closed; HISTORICAL: đã build/deploy lên Lambda fitness) **không** là tổ tiên của RC-0 và không có trên `aws-deploy`; các tool V2 gọi endpoint nội bộ fitness, nên cần xác nhận phiên bản fitness đang chạy khớp. **Đóng:** REAL HTTP/API trên DEV (4 agent × dữ liệu test), xác nhận CodeSha256 fitness/user bằng workflow preflight. **Phụ thuộc:** B-11.

### B-16 — Model Nova/Bedrock thật · P1 · NOT VERIFIED
- **Bằng chứng:** `CODE FACT`: adapter mặc định `apac.amazon.nova-pro-v1:0` (`BEDROCK_CHAT_MODEL`), `maxAttempts=1`; Lambda ra Bedrock cần NAT (template ghi "Bedrock Runtime has no VPC endpoint today"); smoke matrix ghi `BEDROCK_BLOCKED_POSSIBLE`. `HISTORICAL REPORT`: Nova Pro chạy được qua một profile AWS **khác** tài khoản dev (bộ nhớ dự án); quyền Bedrock trên tài khoản chạy V1 và IAM của role Lambda **không có trong repo**. D-006: chỉ Nova Pro cho tới khi duyệt khác. **Đóng:** xem M9-RELEASE-READINESS §7.

### B-17 — Chất lượng câu trả lời · P1 · OPEN
M9.4-T1: `ANSWER QUALITY: NOT EVALUATED` (mọi model là kịch bản). G7/G8 NOT VERIFIED; bộ gán nhãn pilot chưa bắt đầu (HISTORICAL). **Đóng:** kế hoạch §7; không tuyên bố vượt V1 khi chưa có bằng chứng.

### B-18 — Router chưa đạt ngưỡng nội bộ · P1 · OPEN
- **Bằng chứng (`CODE FACT`, tên test `M7P41-23`):** "heldout v4 result (recorded, not re-tuned): G7 FAIL 85% → ROUTING NOT READY; G8 and every safety gate PASS". Quy tắc dừng đã ghi: không tạo heldout v5; router dùng LLM cần phê duyệt riêng (HISTORICAL). Hybrid router có offline, mặc định deterministic. **Đóng:** quyết định chủ dự án về hướng router (không sửa Router trong T0), đo trên bộ độc lập.

### B-19 — Envelope độ trễ · P1 · NOT VERIFIED
- **Bằng chứng:** `CODE FACT`: ngân sách một lượt V2 `maxWallTimeMs: 60_000` (`supervisor.ts:46`); frontend `coachService.chat` timeout 30 s (ARCHITECTURE §2.1). Giới hạn tích hợp của API Gateway HTTP API là ~30 s theo tài liệu AWS (không được xác minh trong repo; cấu hình timeout Lambda **không có** trong repo). Một lượt V2 chậm có thể bị cắt phía client/API Gateway khi V2 vẫn đang chạy ⇒ trạng thái mơ hồ (IN_DOUBT). **Đóng:** đo độ trễ thật (p50/p95/p99) với model thật, đặt trần trong ngân sách ≤ trần thấp nhất của chuỗi, hoặc thiết kế bất đồng bộ (cần quyết định riêng).

### B-20 — Hạ tầng V2 chưa có trong IaC · P2 · OPEN
`CODE FACT`: không có tài nguyên nào cho `AGENT_V2_SESSION_TABLE`, bảng idempotency/minor, hay IAM `bedrock:InvokeModel`/`dynamodb:*` cho V2 trong `infra/` hoặc `scripts/aws/`; bảng DynamoDB rate-limit được tạo bởi một script riêng (`ai-quota-and-recovery-setup.ps1`, dry-run mặc định) và trạng thái thực tế `NOT VERIFIED`. Không có ElastiCache/Redis trong IaC AWS (chỉ docker-compose). **Đóng:** đề xuất IaC + owner duyệt + áp dụng qua pipeline hạ tầng hiện có (không thực thi ở T0).

### B-21 — Kill switch · P2 · OPEN
`CODE FACT`: cờ là biến môi trường Lambda (`AI_AGENT_V2`, `AI_AGENT_V2_PRODUCTION_APPROVED`, `AI_COACH_V2_BRIDGE`, `AI_COACH_V2_BRIDGE_PRODUCTION_APPROVED`, `AI_COACH_V2_BRIDGE_USERS`); workflow deploy "never update-function-configuration"; script hạ tầng ghi `update-function-configuration` **thay cả khối env (chứa secret)** ⇒ đổi cờ là một CONFIG_DEPLOY riêng, có rủi ro làm mất biến. Không có công tắc runtime. **Đóng:** quy trình gộp-biến đã kiểm tra + diễn tập, hoặc thiết kế công tắc runtime (PROPOSED).

### B-22 — PII trong log/trace thật · P2 · NOT VERIFIED
Trace V2 được thiết kế "chỉ mã" và có test (`UH-12`, `P-24`: không câu hỏi/câu trả lời/id/token trong trace) — offline. Log CloudWatch thật, log bridge/continuity và lỗi từ SDK chưa được kiểm. **Đóng:** rà log trên DEV với dữ liệu test + test chặn ghi câu hỏi/câu trả lời.

### B-23 — Frontend · P2 · OPEN
`CODE FACT`: 9 file `frontend/web` khác `aws-deploy`; chỉ DEV (`import.meta.env.DEV && VITE_AI_COACH_V2_DEV=1`), quét bundle production sạch (HISTORICAL M9.3-T1); `ci/service-impact-map.json`: triển khai FE S3/CloudFront không thuộc phạm vi pipeline. Chưa có UI production cho V2. **Đóng:** quyết định sản phẩm (có cần UI riêng cho V2 hay không); typecheck đầy đủ (6 dòng lỗi sẵn có).

### B-24 — Rate-limit / chi phí · P2 · NOT VERIFIED
`CODE FACT`: bridge nằm sau `askRateLimiter` dùng chung với V1; provider rate-limit chọn bằng `RATE_LIMIT_PROVIDER` (memory|dynamodb|off) — trên Lambda cần bảng DynamoDB (HISTORICAL 2026-10-20: bảng chưa tồn tại); chi phí lượt V2 (trần 0.08 USD/lượt trong `PILOT_LIMITS`) chưa có bucket riêng. **Đóng:** xác minh provider trên DEV, bucket/ngân sách riêng cho V2 (PROPOSED).

### B-25 — SSE · P2 · OPEN (chủ ý)
`/ask/stream` không được bridge; mọi yêu cầu SSE đi V1 (D-P07). Không phải lỗi; ghi để QA biết hai trải nghiệm khác nhau.

### B-26 — Đánh giá độc lập cho phần M9 · P2 · OPEN
Chưa có Codex/con người xem bridge, continuity, guard cân nặng, preflight (chỉ test của chính tác giả). **Đóng:** review độc lập trước khi RC được đề xuất.

## Điều kiện đóng — nguyên tắc chung
Không mục nào chuyển sang `VERIFIED` nếu chỉ có test offline/mock (`TEST FIXTURE`/`BACKEND INTEGRATION`). `VERIFIED` cần ít nhất một trong: `REAL HTTP/API` trên môi trường được phép (tài khoản test), kiểm chứng độc lập của Codex/con người đối với phần an toàn, hoặc kết quả đo thật (model/độ trễ). Việc đóng blocker không đồng nghĩa được phép phát hành: D-001 vẫn có hiệu lực — cần owner chấp thuận rõ ràng.
