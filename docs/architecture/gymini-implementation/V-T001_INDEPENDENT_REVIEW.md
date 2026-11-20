# V-T001 — Independent Security Review

Ngày: 2026-10-19. Phạm vi: G-02/G-32, central log redaction. Nhãn bằng chứng: **CODE AUDIT**, **REAL HTTP/API** localhost với credential tổng hợp, **TEST FIXTURE** cho mock repository/probe. Không có REAL BROWSER hoặc xác minh production.

## 1. Executive verdict

**V-T001_CHANGES_REQUIRED**

Implementation có hiệu lực thật nhưng bảo vệ chưa đầy đủ. Logger singleton runtime dùng cấu hình redaction; Authorization/Cookie/gateway header ở request HTTP chuẩn được che và các test mới pass. Tuy nhiên, kiểm tra độc lập tái hiện header nội bộ x-service-secret còn nguyên, chữ ký URL tài liệu còn nguyên trong req.url, và nhiều credential trong metadata Axios không được che. Đây là các thiếu sót ngăn đóng V-T001; kết luận tất cả acceptance criteria đã đạt trong implementation report không được chấp nhận.

Không sửa source, không triển khai, không gọi AWS, không lấy log production hoặc xoay secret. Chỉ tạo báo cáo này; không sửa master audit hay implementation report.

## 2. Repository baseline

- HEAD: 003545c6da8d524e8c4f6fbe4575444102f1fc50; branch: aws-deploy.
- Tracked modifications có sẵn: backend/services/ai-service/package.json; backend/services/ai-service/src/services/bedrock.client.ts; backend/shared/src/index.ts; pnpm-lock.yaml. Diff tổng: 4 files, 401 insertions, 4 deletions.
- Untracked có sẵn: .dev/aws/scheduler-state.json.before-shutdown-20261019; .dev/aws/shutdown-20261019.json; backend/services/ai-service/src/__tests__/bedrock-cross-account.test.ts; backend/services/ai-service/src/services/bedrock-credentials.ts; backend/services/auth-service/src/__tests__/logger-redaction.test.ts; docs/architecture/gymini-audit-verification/; docs/architecture/gymini-full-business-audit/; docs/architecture/gymini-implementation/.
- Workstream Bedrock được giữ nguyên. Không reset/stash/commit/push. Không đọc/hash/index/traverse heldout hoặc sealed datasets.

## 3. Actual implementation verification

**CODE AUDIT:** backend/shared/src/index.ts:15–76 khai báo sensitive keys, tạo paths, export logRedactOptions và truyền chính object đó vào pino. Cấu hình có 63 paths, có paths trùng; paths được Pino chấp nhận và chạy được.

backend/services/auth-service/src/app.ts:4,21 và backend/services/user-service/src/app.ts:6,37 đều dùng shared logger qua pinoHttp({ logger }). Không có thay đổi auth/request logic trong diff V-T001 đã xem.

Hai nhóm header không đồng nhất: index.ts:33–43 bảo vệ authorization/cookie/x-gateway-secret/x-api-key/set-cookie dưới req/res; :34,45–49 chỉ bảo vệ authorization/Authorization dưới config, response.config, err.config, err.response.config. index.ts:58–63 giới hạn field redaction ở 0–2 object levels trước field. Đây không phải recursive sanitizer.

Comment đầu source và comment test còn mô tả bare Error được merge ở top level; với Pino đang cài, bare Error thực tế được bọc dưới err. Test TEST-04 đã giải thích đúng hơn. Cần sửa mô tả khi sửa implementation.

## 4. Sensitive-field coverage matrix

Kết quả dưới đây dùng giá trị SYN_*; không dùng credential thật. PARTIALLY_PROTECTED nghĩa là có carrier đã bảo vệ nhưng còn carrier đã tái hiện rò rỉ.

| Input | Kết quả | Bằng chứng / giới hạn |
|---|---|---|
| Authorization / authorization | PARTIALLY_PROTECTED | REAL HTTP/API chuẩn và err.config/err.response.config hai casing được che; request.headers.Authorization tùy ý vẫn lộ |
| Cookie / cookie | PARTIALLY_PROTECTED | HTTP Node normalize và req.headers.cookie được che; Cookie/cookie trong hai Axios carriers còn nguyên |
| Set-Cookie / set-cookie | PARTIALLY_PROTECTED | res.getHeaders() chuẩn được che, probe response xác nhận; Axios carriers hai casing còn nguyên |
| x-gateway-secret | PARTIALLY_PROTECTED | Request chuẩn được che; err.config/err.response.config còn nguyên |
| x-api-key | PARTIALLY_PROTECTED | Request chuẩn được che; err.config/err.response.config còn nguyên |
| password | PARTIALLY_PROTECTED | Probe depth 0/1/2 che, depth 3 lộ |
| token | PARTIALLY_PROTECTED | Probe depth 0/1/2 che, depth 3 lộ |
| accessToken | PARTIALLY_PROTECTED | Probe depth 0/1/2 che, depth 3 lộ |
| refreshToken | PARTIALLY_PROTECTED | Probe depth 0/1/2 che, depth 3 lộ |
| apiKey | PARTIALLY_PROTECTED | Probe depth 0/1/2 che, depth 3 lộ |
| api_key | PARTIALLY_PROTECTED | Probe depth 0/1/2 che, depth 3 lộ |
| secret | PARTIALLY_PROTECTED | Probe depth 0/1/2 che, depth 3 lộ |
| x-service-secret | UNPROTECTED | Logger HTTP thật ghi nguyên giá trị synthetic bằng active test INTERNAL_SERVICE_SECRET; cũng lộ trong Axios |
| x-internal-token | UNPROTECTED | HTTP probe và Axios probe lộ; chưa chứng minh đây là credential header đang được auth/user tiêu thụ |
| Axios error.config.headers | PARTIALLY_PROTECTED | Authorization che; Cookie/gateway/api/service/internal/set-cookie không che |
| error.response.config.headers | PARTIALLY_PROTECTED | Cùng thiếu sót như config.headers |
| Nested Error cause | PARTIALLY_PROTECTED | Default serializer bỏ cause.config trong Error cause probe, nhưng nối cause message/stack; synthetic cause message còn nguyên |
| Explicit request object | PARTIALLY_PROTECTED | req chuẩn có paths; object dưới request.headers.Authorization/gateway lộ |
| req.url có sig | UNPROTECTED | REAL HTTP/API user app ghi chữ ký tài liệu synthetic hợp lệ |
| res.headers.location có signed query | UNPROTECTED | Response probe singleton + pino-http ghi nguyên query signature |

Field paths phân biệt chữ hoa/thường. Node normalize tên header trên HTTP thật; điều đó không áp dụng cho mọi object được log thủ công. Không suy rộng kết quả casing đã thử sang mọi casing tùy ý.

## 5. Runtime/configuration consistency

Installed: pino 8.21.0; pino-http 9.0.0; pino-std-serializers 6.2.2; tsx 4.21.0; @gym-coach/shared 1.0.0. Module resolution thực từ auth-service trỏ backend/shared/dist/index.js (package.json:4), không trực tiếp src/index.ts. Compiled dist hiện tại cũng export cấu hình và truyền vào singleton logger.

Đã chạy child process require shared singleton, capture stdout của child, không monkey-patch stdout logger thật. REAL HTTP/API qua app auth/user thật chứng minh cấu hình runtime có hiệu lực đồng thời tái hiện thiếu sót. Không chỉ dựa vào test dựng một logger thứ hai.

Installed serializer source: pino-std-serializers/lib/req.js:73,88 giữ originalUrl và headers; lib/res.js:37–38 giữ statusCode và getHeaders(); lib/err.js:21–22 nối message/stack của causes, :28–33 serialize enumerable properties và không giữ cause như object riêng. Đây là hành vi phiên bản local đã xem, không phải giả định về phiên bản khác.

## 6. Test verification

### Kết quả chạy độc lập

| Run | Nhãn | Kết quả |
|---|---|---|
| logger-redaction.test.ts | REAL HTTP/API + TEST FIXTURE | 7 passed, 0 failed, 0 skipped; exit 0; ~1.63s |
| 11 auth files nêu dưới | REAL HTTP/API + TEST FIXTURE | 86 passed, 0 failed, 0 skipped; exit 0; ~4.78s; đã bao gồm 7 test trên |
| 3 user files nêu dưới | TEST FIXTURE | 38 passed, 0 failed, 0 skipped; exit 0; ~1.87s |
| Separate-logger negative control | TEST FIXTURE | Với redact: marker absent và [REDACTED] present; bỏ redact: marker present; exit 0 |
| Actual singleton structured/error probes | TEST FIXTURE | Chạy thành công; phát hiện leak ở các trường hợp trong matrix, không tính là security PASS |
| Actual auth/user localhost probes | REAL HTTP/API | /health 200; signed nonexistent document 404; signature và internal header hiện trong serialized logs |
| Response redirect probe | REAL HTTP/API + TEST FIXTURE | Set-Cookie che, Location signature lộ; redirect manual, không fetch đích ngoài |

11 auth files: credential-rotation-hardening.test.ts; logger-redaction.test.ts; login-and-refresh.test.ts; login-rate-limit.test.ts; partner-application.test.ts; pt-deactivation-relay-sweep.test.ts; pt-deactivation-relay.test.ts; registration-otp.test.ts; role-change-authorization.test.ts; self-service-recovery.test.ts; set-user-active-relays-pt-deactivation.test.ts. Đều thuộc backend/services/auth-service/src/__tests__/.

3 user files trong backend/services/user-service/src/__tests__/: ptDocumentUrl.util.test.ts; auth-middleware-transport.test.ts; auth-service-client.test.ts.

Runner: Node executable C:/Program Files/nodejs/node.exe, resolve tsx/cli từ auth-service, arguments --test với danh sách files tường minh; cwd service tương ứng. Child env được dựng riêng với NODE_ENV=test, LOG_LEVEL=info, JWT/internal/document secrets chỉ SYN_*, DATABASE_URL=postgresql://synthetic:synthetic@127.0.0.1:1/gymini_review_test?connect_timeout=1, TSX_DISABLE_CACHE=1, AWS_EC2_METADATA_DISABLED=true, SMTP credentials rỗng; không kế thừa real credential env hay load server .env.

### Giới hạn và run không thành công

Một run chọn 6 user files (3 files trên cộng chat-internal-auth-configured.test.ts, chat-internal-auth-missing-secret.test.ts, chat-internal-auth-401.test.ts) **không pass**: timeout 60s, SIGTERM/ETIMEDOUT; có assertion failure ở case 401. Đọc source cho thấy notificationService.create/Prisma cleanup cần DB; cleanup trước mock.close có thể khiến process giữ handle khi DB không có. Không kết luận đây là regression của redaction. Sau đó chạy riêng 3 files không cần DB mới có 38/38 kết quả hoàn chỉnh. Kiểm tra không còn child process trực tiếp của run bị terminate.

Auth credential-rotation-transaction.integration.test.ts không chạy: top-level dùng docker exec/psql vào database quản trị để DROP/CREATE isolated DB; không thực hiện khi thiếu môi trường test được xác nhận. Docker Desktop Linux pipe không tồn tại khi kiểm tra docker ps: **ENVIRONMENT_BLOCKED**. Không khởi động Docker, không kết nối/mutate DEV/prod DB.

Implementation report ghi auth 86 pass/1 skip: đây là kết quả lịch sử, không phải lần chạy độc lập này. Current auth directory có 12 test files, reviewer chạy 11 và loại DB-backed file, nên 86/0/0 không phải full auth integration. User 198 pass/45 DB/environment failures vẫn là **45 failures được báo cáo**, không phải pass hoặc 45 tests chưa chạy. Full user suite không được reviewer chạy lại. Cụm “87/87 non-skipped” và việc reclassify failures trong report không đủ cơ sở.

### Đánh giá cả 7 test mới

- TEST-01 (:95): kiểm raw serialized output và marker Authorization absent, req header bằng censor; HTTP serializer thật.
- TEST-02 (:108): kiểm raw password/refreshToken absent và replacement tại depth 1/2; không kiểm depth 3 hoặc toàn bộ key list.
- TEST-03 (:122): kiểm Cookie/gateway marker absent và replacement; không kiểm service secret/API header/error carriers.
- TEST-04 (:140): raw Error và {err} có Authorization, assert raw absence và err.config path; đúng call convention nhưng fake Axios-shaped Error, chưa kiểm real AxiosError/Cookie/response.config. Reviewer đã bổ sung probe real AxiosError và phát hiện leak.
- TEST-05 (:162): method/path/status/id/duration còn hữu ích.
- TEST-06/07 (:179): real app /auth/verify 200 nhưng repository mock; leak assertion nằm ở probe logger trên requests lặp lại. Không phải DB-backed E2E và không capture singleton của phần auth flow. Reviewer kiểm singleton riêng.
- TEST-08 (:229): hai requests đồng thời, distinct ids, hai paths và credential absence; kiểm cơ bản có ý nghĩa nhưng không chứng minh mọi metadata không trộn hoặc stress concurrency.

Các security assertions có kiểm marker thực trong output, nên mất redaction tương ứng sẽ gây fail. TEST-05 chỉ operational và phần functional của TEST-06/07 không tự chứng minh redaction. Negative control reviewer thực thi chỉ cho một Authorization probe với logger riêng; không mutation-run toàn bộ 7 test và không sửa production logger.

## 7. Query-string findings

**R02 — BLOCKER: current credential-bearing document URLs được log nguyên.**

user-service/src/utils/ptDocumentUrl.util.ts:44–47,66–69 tạo URL có exp/sig và S3 key. controllers/pt_application.controller.ts:139–144 kiểm chữ ký làm quyền truy cập tài liệu; :163–171 kiểm S3 signature rồi redirect sang presigned GET URL. Đây là capability hiện có, không chỉ future risk ở auth routes.

REAL HTTP/API với real user app và helper ký thật dùng secret SYN_* tạo URL cho SYN_REVIEW_NONEXISTENT.png. Signature hợp lệ, request trả 404 vì file không tồn tại; raw signature vẫn nằm trong log req.url. Không cần tài liệu thật, DB hoặc S3 để chứng minh serializer lộ capability. Không khẳng định đã tải được tài liệu hay đã có production leak.

Response probe trên actual shared logger + pino-http đặt Location=https://synthetic.invalid/document?sig=SYN_RESPONSE_LOCATION, fetch redirect manual: marker còn nguyên. Đối chiếu route :171 cho thấy presigned redirect là supported current path; reviewer không gọi real S3 route/AWS.

Minimal correction: central serializer/projection loại bỏ query nhạy cảm khỏi req.url/originalUrl và signed Location; xử lý req.query/key/signature tương ứng, giữ method/path/request id/status/duration. Chỉ thêm path req.query.sig không che bản sao trong URL, Location hoặc Error message. Dùng policy query allowlist/drop rõ ràng và test cả request/response; không dựa vào tên token duy nhất.

## 8. Error and nested-object findings

**R01 — BLOCKER: x-service-secret của luồng nội bộ hiện tại thiếu redaction.** Auth auth.controller.ts:379,411,440,562,651 và user serviceSecret.middleware.ts:61 nhận header này. REAL HTTP/API /health gửi đúng active synthetic INTERNAL_SERVICE_SECRET cho thấy raw header trong request log, trong khi Authorization/Cookie/gateway/API header đã che. Cùng app-level logger chạy trước các route nội bộ. Không cần gọi mutation nội bộ để tái hiện việc middleware ghi header. x-internal-token cũng lộ trong probe nhưng không nâng severity dựa riêng header đó.

**R03 — HIGH: Axios/error carrier coverage thiếu material headers.** Shared index.ts:45–49 chỉ thêm authorization hai casing. Probe err.config.headers và err.response.config.headers để nguyên Cookie/cookie, Set-Cookie/set-cookie, x-gateway-secret, x-api-key, x-service-secret, x-internal-token. Real axios.AxiosError cũng để lộ Cookie/x-service-secret. Bare-error logging convention có trong user middleware/auth.middleware.ts:64 và controller :176; auth pt-deactivation-relay.service.ts:43 sử dụng outgoing x-service-secret. Đây là thiếu sót của supported error shapes, không phải bằng chứng một lỗi downstream production cụ thể đã xảy ra.

**R04 — MEDIUM: depth/case/explicit-object boundary.** Tất cả 7 named credential fields vừa chạy depth 0–3: 0–2 che, 3 lộ. request.headers.Authorization/gateway tùy ý cũng lộ. Scoped callsite review chưa xác định concrete current callsite đang ghi đúng deep/explicit shapes này; không xếp BLOCKER chỉ vì shape lý thuyết.

**R05 — MEDIUM: free text và cause messages.** Synthetic message string và Error cause message còn nguyên. Default serializer bỏ cause.config trong probe Error-cause, nên không được nói case đó lộ metadata; nó nối message/stack. Scoped auth/user search không tìm thấy callsite chắc chắn interpolate credential trực tiếp. Một số callsites ghi err.message/downstream text có boundary không kiểm soát toàn bộ nội dung. Redaction theo structured path không phải text sanitizer; cần policy không ghi credential-bearing messages và tests cho known error projection, không tuyên bố che mọi string.

## 9. Build/deployment packaging findings

**CODE AUDIT:** backend/shared/package.json:4 resolve dist/index.js, :7 build=tsc. Current compiled dist đã có cấu hình và singleton đúng. Root package.json:14 recursive build bao gồm shared; :13 dev chỉ watch frontend/gateway/services, không watch shared.

Auth Dockerfile:20 build shared, :32 copy shared/dist; user Dockerfile:23 build shared, :34 copy dist. Auth scripts/build-lambda-artifact.js:254 và user equivalent :234 chạy shared build trước service packaging. Vì vậy clean standard packaging được mô tả bởi source có rebuild shared, không cần commit ignored dist.

Chưa build ZIP/image sạch, chưa smoke-test artifact và chưa deploy. Local probes dùng dist hiện có; dev chạy service khi quên rebuild shared có thể dùng dist cũ. Không kết luận “deployment cannot silently use stale code” trên mọi entrypoint chỉ từ source inspection. Required follow-up validation: rebuild shared và packaging trong workflow được phép, kiểm artifact/runtime trước release; không cần thực hiện deployment trong review này.

## 10. Residual risks

Trước fix, default HTTP serializer giữ headers nguyên và shared logger không có redaction; CODE AUDIT xác nhận có khả năng ghi x-gateway-secret. Không truy xuất historical logs để xác nhận tần suất hoặc credential thật.

Future-log correction không xóa historical exposure. Rotation, CloudWatch retention/access controls và incident assessment là các việc riêng cần được chủ hệ thống cho phép; review này không thực hiện hoặc xác nhận chúng. Không đánh đồng redaction code với rotation hoàn tất.

R04/R05 là giới hạn đã chứng minh trên synthetic shapes, chưa có concrete credential-interpolating callsite được xác nhận. DB integration và deployable artifact runtime vẫn chưa xác minh. Implementation report cần được tác giả sửa theo bằng chứng mới; reviewer không sửa report đó.

## 11. Acceptance gate results

| Gate | Kết quả | Bằng chứng |
|---|---|---|
| GATE-01 effective shared protection | PARTIAL | shared/index.ts:69–76 có hiệu lực; R01/R02/R03 còn leak |
| GATE-02 bearer tokens | PARTIAL | req chuẩn và Axios Authorization đã che; explicit request.headers.Authorization lộ (R04) |
| GATE-03 cookies/gateway secrets | FAIL | HTTP chuẩn che nhưng Axios Cookie/gateway còn nguyên; index.ts:45–49; R03 |
| GATE-04 Axios/error metadata | FAIL | Real AxiosError và err.response.config probes lộ; R03 |
| GATE-05 URL/query | FAIL | Current signed docs req.url và response Location còn lộ; util:47,69/controller:171; R02 |
| GATE-06 actual runtime logger | PASS | shared/index.ts:74–76, dist resolution, real app singleton HTTP probes |
| GATE-07 useful operational logs | PASS | TEST-05 :162; runtime metadata probe; method/path/status/id/duration giữ được |
| GATE-08 auth regressions | PARTIAL | Không quan sát regression trong 86 auth/38 selected user tests; real auth flow mock repository; DB blocked |
| GATE-09 no silent stale build | PARTIAL | Docker/Lambda rebuild source đúng; local dev không watch shared; chưa verify clean artifact runtime |
| GATE-10 honest disclosure | PASS | Báo cáo độc lập phân biệt passed/failure/blocked và residuals; không chấp nhận claim all-criteria-met của implementation report |

GATE-10 PASS áp dụng disclosure của independent review này; không chứng nhận cách phân loại 45 failures trong report trước.

## 12. Required corrections

Một correction scope V-T001 nhỏ nhất nhưng đầy đủ:

1. Đồng nhất sensitive-header policy trên HTTP và supported Axios/config/error carriers, gồm x-service-secret và các header nội bộ thực sự sử dụng; xử lý casing nhất quán.
2. Sanitize credential-bearing request URLs/query và response signed Location trước serialize, giữ operational fields.
3. Thêm regression cho real singleton và installed serializers: current service header, document signature URL, signed redirect, Cookie/gateway/API headers trong config/response.config, bare/wrapped AxiosError. Assert raw synthetic marker absent, negative control và useful metadata.
4. Nêu rõ bounded field nesting/free-text contract; chọn safe error/request projection cho supported shapes thay vì cam kết recursive redaction chưa có bằng chứng. Sửa comment sai và test-result accounting.
5. Chạy lại scoped regressions; chạy DB-backed suites khi isolated test PostgreSQL khả dụng; kiểm clean packaged artifact trước release.

Không triển khai thay đổi nào trong review này. Không mở V-T012 hoặc feature khác.

## 13. Independent release recommendation

Chưa thể đóng V-T001 tại local. **Chưa phù hợp chuyển sang controlled deployment review** cho bản hiện tại vì current significant secret/capability leakage đã tái hiện. Không phải chỉ thiếu môi trường DB; R01/R02/R03 đủ yêu cầu correction ngay cả nếu DB suites pass.

Không có production deployment hoặc production readiness được xác nhận.

## 14. Exact next action

Giao lại tác giả một V-T001 correction patch cho header carriers và URL/Location sanitization cùng regression synthetic ở mục 12, rồi independent re-review. Giữ nguyên workstream Bedrock; không tự động sửa source hoặc deploy từ báo cáo này.

### Reproduction appendix (synthetic only; không chạy với .env thật)

Các snippets dưới được thực thi bằng child Node, cwd backend/services/auth-service, minimal environment mô tả mục 6. Capture stdout child; không đổi singleton destination. HTTP app snippet dùng -r <resolved tsx/cjs>; thêm AWS_LAMBDA_FUNCTION_NAME=SYN_LOCAL_REVIEW_NO_AWS để user app không tạo local upload directories. Flag này không gọi AWS. Chỉ probe nonexistent file; không truy cập dữ liệu tài liệu thật.

#### Singleton structured/error probe

```js
const {logger}=require('@gym-coach/shared'); const axios=require('axios'); const c=(tag,shape)=>logger.info({caseTag:tag,...shape},'synthetic logger probe');c('named-top',{password:'SYN_TOP_PASSWORD'});c('named-two',{payload:{body:{refreshToken:'SYN_TWO_REFRESH'}}});c('named-three',{payload:{a:{body:{refreshToken:'SYN_THREE_REFRESH'}}}});for(const key of ['authorization','Authorization','cookie','Cookie','x-gateway-secret','x-api-key','set-cookie','Set-Cookie','x-service-secret','x-internal-token']){const err=new Error('synthetic downstream');err.config={headers:{[key]:'SYN_ERR_'+key}};err.response={config:{headers:{[key]:'SYN_RESPONSE_'+key}}};logger.error({caseTag:'error-'+key,err},'synthetic error metadata');}const cause=new Error('inner');cause.config={headers:{Authorization:'SYN_CAUSE_AUTH'}};logger.error({caseTag:'cause',err:new Error('outer',{cause})},'synthetic nested cause');const ax=new axios.AxiosError('synthetic axios','ERR_BAD_RESPONSE',{headers:{Authorization:'SYN_REAL_AX_AUTH','x-service-secret':'SYN_REAL_AX_SERVICE',Cookie:'SYN_REAL_AX_COOKIE'}});logger.error({caseTag:'actual-AxiosError',err:ax},'synthetic axios instance');c('explicit-request',{request:{headers:{Authorization:'SYN_EXPLICIT_AUTH','x-gateway-secret':'SYN_EXPLICIT_GATEWAY'}}});logger.error({caseTag:'string-message'},'synthetic message includes SYN_STRING_SECRET');logger.info({caseTag:'operations',requestId:'review-123',method:'GET',statusCode:200,duration:3},'normal synthetic operation');logger.flush();
```

#### Real auth/user app HTTP probe

```js
const http=require('http');const {logger}=require('@gym-coach/shared');const auth=require('./src/app.ts').default;const user=require('../user-service/src/app.ts').default;const {toSignedPtDocumentUrl}=require('../user-service/src/utils/ptDocumentUrl.util.ts');async function start(app){const s=http.createServer(app);await new Promise(r=>s.listen(0,'127.0.0.1',r));return s;}async function go(){const a=await start(auth),u=await start(user);try{const r=await fetch('http://127.0.0.1:'+a.address().port+'/health',{headers:{Authorization:'Bearer SYN_HTTP_AUTH',Cookie:'SYN_HTTP_COOKIE','x-gateway-secret':'SYN_HTTP_GATEWAY','x-api-key':'SYN_HTTP_API','x-service-secret':process.env.INTERNAL_SERVICE_SECRET,'x-internal-token':'SYN_HTTP_INTERNAL'}});const signed=toSignedPtDocumentUrl('/uploads/pt-applications/SYN_REVIEW_NONEXISTENT.png');const sig=new URL(signed,'http://local').searchParams.get('sig');const d=await fetch('http://127.0.0.1:'+u.address().port+signed);console.log(JSON.stringify({probeSummary:true,authStatus:r.status,documentStatus:d.status,syntheticDocumentSig:sig,queryPath:signed}));}finally{await Promise.all([new Promise(r=>a.close(r)),new Promise(r=>u.close(r))]);logger.flush();}}go().catch(e=>{console.log(JSON.stringify({probeError:e.message}));process.exitCode=1;});
```

#### Response serializer probe (redirect manual)

```js
const express=require('express');const http=require('http');const pinoHttp=require('pino-http');const {logger}=require('@gym-coach/shared');const a=express();a.use(pinoHttp({logger}));a.get('/response',(_,res)=>{res.setHeader('Set-Cookie','session=SYN_RESPONSE_COOKIE');res.redirect(302,'https://synthetic.invalid/document?sig=SYN_RESPONSE_LOCATION');});const s=http.createServer(a);s.listen(0,'127.0.0.1',async()=>{try{await fetch('http://127.0.0.1:'+s.address().port+'/response',{redirect:'manual'});}finally{s.close(()=>logger.flush());}});
```

#### Negative control (separate logger only)

```js
const pino=require('pino');const {logRedactOptions}=require('@gym-coach/shared');const {Writable}=require('stream');for(const [name,redact]of [['protected',logRedactOptions],['negative-control',undefined]]){let raw='';const l=pino(redact?{redact}:{},new Writable({write(c,e,cb){raw+=c;cb();}}));l.info({req:{headers:{authorization:'SYN_NEGATIVE_CONTROL'}}},'probe');console.log(JSON.stringify({case:name,secretPresent:raw.includes('SYN_NEGATIVE_CONTROL'),redacted:raw.includes('[REDACTED]'),linePresent:raw.length>0}));}
```

#### All named fields and cause message

```js
const {logger}=require('@gym-coach/shared'); const keys=['password','token','accessToken','refreshToken','apiKey','api_key','secret']; for(const key of keys) for(let depth=0;depth<=3;depth++){let obj={[key]:'SYN_MATRIX_'+key+'_'+depth};for(let i=0;i<depth;i++)obj={nested:obj};logger.info(obj,'matrix:'+key+':'+depth)} const cause=new Error('SYN_CAUSE_MESSAGE');logger.error(new Error('outer',{cause}),'cause-message');
```
