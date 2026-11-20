# Gymini M9.6 — AWS demo live verification — 17/11/2026

## 1. AWS environment

Account `191798898985`, region `ap-southeast-1`. API, Lambda, secrets và Aurora đều thuộc DEV. Đã kiểm tra host/database bên trong bốn reference auth/AI/user/fitness: cùng cluster DEV `fitness-assistant-dev-aurora`; không in credential. Runtime `NODE_ENV=production` là chế độ Node của Lambda, không phải bằng chứng tài nguyên production.

Owner đã duyệt khôi phục dependency DEV tối đa 60 phút rồi tắt sau test. Dùng profile `gymini-admin` đã PASS identity gate; default `vmimport-admin` bị gate từ chối và không được dùng để ghi. Không thay code/config Lambda, auth, safety, production hoặc schema.

Ban đầu Aurora stopped, không NAT/endpoint, health và JSON trả 503, SSE timeout. Đã chạy script hiện có `dev-start.ps1 -Network -Ai -Execute -AutoStopHours 1`, đặt auto-stop trước khi tạo tài nguyên; start Aurora riêng để giữ toàn bộ scheduler DISABLED. Stack DEV `gymini-dev-on-demand` CREATE_COMPLETE; NAT, Secrets Manager endpoint và OpenSearch Classic endpoint đã ACTIVE/available. Không bật Chat ECS hay ingestion.

## 2. Lambda / API artifact

API `id1iz7upbl`, stage `$default`, deployment `hwnxi5`; `/ai/{proxy+}` → V1 JSON Lambda. CloudFront `/ai/ask/stream` → Lambda Function URL RESPONSE_STREAM riêng. Không suy luận SSE từ JSON.

| Lambda | CodeSha256 |
|---|---|
| fitness-assistant-dev-ai | `wO+oue2+v1rojeEdWGsObC7oYorqBPJBzAu1dTJWDck=` |
| fitness-assistant-dev-ai-stream | `JWLXB8uQLUXjHVI/EhifL10Wse0wB7g6zbcAjFX8aSI=` |
| fitness-assistant-dev-auth | `v/BR30reVOqgiIVFJAB1f2PQMH9TSAxhmsp7v5yJ1d0=` |

Hash và RevisionId của JSON/SSE sau smoke giữ nguyên baseline. Không deploy candidate B-03 `8af46cc1`; worktree đó vẫn clean, chỉ đọc. Không commit/push/merge.

Đã đọc workflows hiện có: `.github/workflows/dev-build.yml`, `dev-deploy.yml`, `dev-preflight.yml`. Code deploy dùng artifact có manifest/hash, OIDC và environment DEV; không bao gồm SSE trong target list AI hiện tại. Không dispatch Actions; CLI `gh` không có trên máy, trạng thái run CI gần nhất chưa được kiểm tra. Lần này chỉ khôi phục hạ tầng qua script hiện có, giữ nguyên artifact V1.

## 3. URL thật

- Web: https://gymini.vn/ ; CloudFront: https://d1ub83a48p566t.cloudfront.net/
- API: https://api.gymini.vn ; API Gateway: https://id1iz7upbl.execute-api.ap-southeast-1.amazonaws.com
- SSE: https://gymini.vn/ai/ask/stream

Đã đọc bundle frontend đang deploy: API và SSE dùng đúng các domain trên. `api.gymini.vn` mapping đúng API DEV `$default`. REAL BROWSER: trang login tải được; chưa thực hiện trọn luồng đăng nhập/chat bằng browser.

## 4. Build

PASS trên checkout chính `aws-deploy` HEAD `e703b714`:

```powershell
pnpm --filter @gym-coach/shared run build
pnpm --filter @gym-coach/ai-service exec tsc --noEmit
pnpm --filter @gym-coach/ai-service run build
pnpm --filter @gym-coach/web run build
pnpm --filter @gym-coach/ai-service exec tsx --test src/__tests__/stream-lambda.test.ts src/__tests__/safety-minor-weight-goal.test.ts src/__tests__/auth-middleware-token-rejection.test.ts src/__tests__/lambda-auth-and-invoke.test.ts
```

SCOPED REQUIRED REGRESSION: bốn file trên, **26/26 PASS**. Evidence: TEST FIXTURE và BACKEND INTEGRATION loopback HTTP. Không phải full repository regression hoặc AWS E2E. Frontend Vite có cảnh báo chunk lớn, build vẫn exit 0. Không tạo release ZIP mới; không build/promote candidate bị BLOCKED. Giữ nguyên mọi thay đổi có sẵn trong worktree.

## 5–6. JSON / SSE — REAL HTTP/API

| Kiểm tra live sau recovery | Kết quả |
|---|---|
| Health | 200 |
| Login tài khoản seed tổng hợp có sẵn | 200, token thật |
| Verify identity / profile | 200 / 200 |
| Gym Q&A JSON | 200; Nova Pro, 2433 input / 339 output tokens; 7.476 giây |
| Nutrition Q&A JSON | 200; Nova Pro, 3224 / 408 tokens; 4.892 giây |
| Hỏi cách bố trí ngày nghỉ | 200; Nova Pro, 2377 / 482 tokens; 5.690 giây |
| SSE riêng qua CloudFront | 200 text/event-stream; 408 network chunks; 403 token events + done |
| SSE timing | chunk đầu 760 ms; chunk cuối 13591 ms; tổng 13.593 giây |
| Không token: JSON / SSE | 401 / 401 |
| Safety steroid | 200 với safety response; trace `safety_gate`, 0 input/output tokens |
| List/read session | 200; đúng owner; đủ 3 lượt gym, nutrition, SSE |
| Logout → login mới → đọc lại session | 200; cả 3 conversation ID và token counters vẫn tồn tại |
| Logout | 200 |

SSE đã được đo chunk thực tế trước khi response kết thúc; đây là application SSE với hiệu ứng chia nhỏ câu trả lời, không phải bằng chứng token streaming trực tiếp từ Bedrock.

## 7–8. LLM và database

**LLM thật, không mock:** Bedrock `apac.amazon.nova-pro-v1:0`; CloudWatch có `llm_call`, provider bedrock, token counts và trace `responseSource=llm` tương ứng. Cấu hình dùng cross-account role; không in external ID hay credential. Safety trace `ai_1794850232388_dnx2et` kết thúc ở `safety_gate`, 0 tokens; không có LLM call được ghi cho lượt đó. Trường modelUsed riêng lẻ không được dùng làm bằng chứng inference.

**Database thật:** Aurora PostgreSQL DEV; dữ liệu tài khoản seed tổng hợp đã có sẵn, không DB mock và không tạo fixture bằng SQL. Session `65d13156-9857-4004-a7b3-d673eb3689c4` chứa các lượt `9b17a905-1c86-4c34-9b0f-7fee818e74a2`, `7eb99191-2802-4231-9350-7cce69c8c680`, `ca94c312-0a60-4471-a315-e8dd906e4895`, đọc lại sau lần đăng nhập mới. Không seed lại DB, sửa kế hoạch, migration hoặc dùng tài khoản cá nhân. Refresh sessions của các lần thử đều logout.

## 9–10. Đã chạy và giới hạn

REAL HTTP/API end-to-end: đăng nhập → verify/profile → hỏi gym/nutrition → nhận Nova thật → SSE riêng → lưu/list/read conversation → logout/login → đọc lại. Không tuyên bố full browser E2E.

**RAG chưa hoạt động:** các index search trả `401`, hint `X01:network-policy-deny`; retrievalEmpty=true và evidenceUsed rỗng. Collection trả endpoint NextGen `*.aoss.ap-southeast-1.on.aws`, trong khi template on-demand tạo endpoint Classic bằng OpenSearch Serverless API. Theo [AWS PrivateLink documentation](https://docs.aws.amazon.com/opensearch-service/latest/developerguide/serverless-vpc.html), NextGen dùng standard interface endpoint `aoss-data`; Classic dùng endpoint managed và DNS `*.aoss.amazonaws.com`. Đây là bằng chứng cấu hình không tương thích; chưa kiểm chứng corpus/index content. Không mở public access hoặc thay kiến trúc để làm RAG xanh. Demo thay thế: Q&A Nova thật, không trình bày là trả lời có trích dẫn RAG.

Câu so sánh full-body/split thử thêm trả lời từ nhánh deterministic (0 tokens), đã lưu riêng bằng chứng; không gọi câu đó là LLM. V2 DISABLED, chưa kiểm chứng bridge/model/store thật. Chat ECS, payment và toàn bộ business journey ngoài MVP không được kiểm thử.

## 11. Rollback / shutdown

V1 JSON artifact S3 khớp commit `4cde78f7d1d26347fe0de1d8787f0217e81b42ab`:

`s3://fitness-assistant-deployments-dev-191798898985/ci-artifacts/ai/4cde78f7d1d26347fe0de1d8787f0217e81b42ab/c0efa8b9edbebf5ae88de11d586b0e6c2ee8628aea04f241cc0bb57532560dc9.zip`

Hai artifact tải về `$env:TEMP/gymini-m96-readonly/v1-running.zip` và `v1-stream-running.zip`, đã SHA-256 MATCH với Lambda. SSE SHA-256 hex: `2562d707cb902d45e31d523f12189f2f5d16b1ed3007b83acdb7008c55fc6922`. Không có code rollout nên không cần rollback code; nếu cần về sau, dùng đúng artifact đã hash qua pipeline DEV. Không có data migration để rollback; conversation tổng hợp vẫn là dữ liệu demo.

Shutdown **hoàn tất** khoảng 00:52 ngày 17/11/2026 Asia/Saigon, trong cửa sổ 60 phút đã duyệt. `dev-stop.ps1 -Backend -Network -Ai -Secrets -Execute` exit 0; Aurora `stopped`, stack on-demand đã xóa, không còn NAT/VPC endpoint/OpenSearch endpoint; mọi scheduler vẫn DISABLED. Auto-stop đã được hủy sau khi xác minh không còn tài nguyên on-demand bật. Conversation và collection/index được giữ nguyên. Đây không phải tuyên bố toàn bộ tài khoản AWS có chi phí bằng 0: các tài nguyên persistent hiện có vẫn tồn tại.

## 12. Kịch bản trình diễn và bằng chứng

Bật cửa sổ DEV có giới hạn bằng hạ tầng hiện có, giữ scheduler nền tắt; kiểm tra health. Mở web → đăng nhập tài khoản demo → AI Coach → hỏi: “Khi sắp xếp các buổi tập trong tuần, vì sao nên có ngày nghỉ sau các buổi nặng?” → xem trả lời → mở lịch sử → thử SSE → tải lại session. API workflow của kịch bản đã chạy; browser workflow còn cần người trình diễn kiểm tra. Không giới thiệu RAG/V2 là chức năng đã sẵn sàng. Vì đã duyệt tắt sau test, cần bật lại DEV trước buổi bảo vệ; URL không đồng nghĩa backend luôn online.

Bằng chứng local không chứa token/mật khẩu: `.dev/m96/core-smoke-evidence.json`, `llm-schedule-evidence.json`, `deterministic-schedule-evidence.json`, `persistence-evidence.json`, `cloudwatch-evidence.json`, `aws-artifact-evidence.json`, `shutdown-evidence.json`, `login-page.png`. Harness: `.dev/m96/live-smoke.mjs`; tối đa vài câu tổng hợp, credential chỉ ở bộ nhớ, không in/lưu token. Snapshot JSON đầy đủ có thời điểm chunk, ID và kết quả HTTP. Sau khi có thay đổi code mới phải kiểm thử lại, không tái sử dụng claim của lần này.

```text
GYMINI AWS DEMO: PARTIAL
V1: VERIFIED
V2: DISABLED
JSON: PASS
SSE: PASS
PRODUCTION CHANGED: NO
```
