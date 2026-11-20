# V-T001.1 — Independent Security Re-review

Ngày: 2026-10-19. Reviewer: Codex. Phạm vi: shared logger, auth-service/user-service HTTP serialization, correction tests và scoped regression. Deployment: NOT AUTHORIZED.

## 1. Executive verdict

**V-T001_APPROVED_WITH_NONBLOCKING_FOLLOWUPS**

Ba finding cũ R01/R02/R03 đã được khắc phục trên các supported runtime paths được kiểm tra độc lập. Singleton compiled thật và cả hai app dùng đúng serializers; HTTP credential headers, signed query values, Location/Content-Location và top-level AxiosError metadata không lộ marker trong focused probes. 131 scoped tests pass, gồm 7 test gốc và 7 test correction. Clean shared compilation + runtime smoke cũng pass.

Có thể đóng **V-T001 ở mức local, theo bounded serialization contract** và bắt đầu controlled deployment review cho riêng correction này. Đây không phải production approval, không phải chứng nhận logger che mọi string/object, không cho phép deploy toàn bộ dirty branch và không thay đổi verdict V-T012. DB-backed regression vẫn ENVIRONMENT_BLOCKED; full clean image/ZIP vẫn CLEAN_ARTIFACT_NOT_VERIFIED.

Các follow-up không chặn local closure: deep/aggregate errors, free text/cause messages, URL paths; một edge case fragment/query được tái hiện. Không tìm thấy current in-scope callsite dùng các shape đó để ghi credential thật. Không có historical CloudWatch/rotation assessment.

## 2. Repository baseline and safety

START_HEAD = END_HEAD = 003545c6da8d524e8c4f6fbe4575444102f1fc50; branch aws-deploy. Tracked diff đầu và cuối: 11 files, 448 insertions, 59 deletions. Pre-existing status:

```text
 M backend/services/ai-service/package.json
 M backend/services/ai-service/src/middleware/auth.middleware.ts
 M backend/services/ai-service/src/routes/ai.routes.ts
 M backend/services/ai-service/src/routes/fitness-agent.routes.ts
 M backend/services/ai-service/src/routes/marketplace.routes.ts
 M backend/services/ai-service/src/routes/plan.routes.ts
 M backend/services/ai-service/src/services/bedrock.client.ts
 M backend/services/auth-service/src/app.ts
 M backend/services/user-service/src/app.ts
 M backend/shared/src/index.ts
 M pnpm-lock.yaml
?? .dev/aws/scheduler-state.json.before-shutdown-20261019
?? .dev/aws/shutdown-20261019.json
?? backend/services/ai-service/src/__tests__/ai-endpoint-policy.test.ts
?? backend/services/ai-service/src/__tests__/bedrock-cross-account.test.ts
?? backend/services/ai-service/src/middleware/ai-rate-limiters.ts
?? backend/services/ai-service/src/middleware/require-trusted-service.middleware.ts
?? backend/services/ai-service/src/services/bedrock-credentials.ts
?? backend/services/auth-service/src/__tests__/logger-redaction.test.ts
?? backend/services/user-service/src/__tests__/log-secret-hygiene.test.ts
?? backend/shared/src/log-safety.ts
?? docs/architecture/gymini-audit-verification/
?? docs/architecture/gymini-full-business-audit/
?? docs/architecture/gymini-implementation/
```

Chỉ tạo docs/architecture/gymini-implementation/V-T001_1_INDEPENDENT_REREVIEW.md trong repository. Không sửa source/tests/dist/reports cũ; không reset/stash/clean/commit/push. V-T001, V-T012, Bedrock và AWS work được giữ nguyên. Shared artifact build ghi vào thư mục tạm riêng ngoài repo, không overwrite shared/dist.

Không đọc/hash/index/traverse heldout/sealed datasets; không gọi paid model/AWS/CloudWatch; không dùng real credentials, production traffic hoặc tài liệu thật. Không kết nối/mutate DEV/prod DB. Nhãn bằng chứng: **CODE AUDIT**, **REAL HTTP/API** localhost, **TEST FIXTURE**; không có REAL BROWSER hoặc production verification.

Đã đối chiếu V-T001_INDEPENDENT_REVIEW.md, V-T001_CORRECTION_REPORT.md, V-T001_IMPLEMENTATION_REPORT.md với current source/tests. Addendum trong implementation report đã rút lại verdict/all-criteria-met cũ, sửa bare-Error explanation và test accounting. Các kết quả lịch sử không được coi là independent PASS của lần này.

## 3. Previous blocker status and exact source evidence

| Finding cũ | Status local | Source / independent evidence |
|---|---|---|
| R01 — x-service-secret / internal headers | RESOLVED for supported HTTP/error carriers | log-safety.ts:16–27 policy 9 header names; :57–65 case-insensitive projection; req :74–86, res :89–91; app wiring auth:21/user:37; correction test A + independent four-casing matrix |
| R02 — signed request URL / redirect Location | RESOLVED for normal query-bearing relative/absolute URLs | log-safety.ts:30–44, :63, :69–85; correction B/C; independent Location + Content-Location, relative/absolute, nested query, real signature verification and non-mutation assertions |
| R03 — top-level Axios Error metadata | RESOLVED for bare Error and {err} call styles | log-safety.ts:95–104 config projection, :112–125 error projection removes request/raw and replaces config/response; correction D/E + independently constructed and actual wire AxiosError probes |

Resolution does not extend to arbitrary nesting, arbitrary metadata names or free text. Remaining boundaries are documented in section 8 rather than silently claimed safe.

## 4. New implementation correctness

### Header policy

SENSITIVE_HEADERS contains authorization, proxy-authorization, cookie, set-cookie, x-gateway-secret, x-api-key, x-service-secret, x-internal-token, x-internal-secret. sanitizeHeaders makes a new object, compares lower-case names and handles AxiosHeaders.toJSON(). It replaces values, not live input headers.

index.ts:29–35 additionally builds lower/Title-Case redact paths for explicit headers objects at known depths. index.ts:39–43 retains sensitive field protection at 0–2 object levels. Arbitrary casing is guaranteed by req/res/err serializers, not by every custom explicit-object shape. Correction test F's “mixed-case” explicit header is specifically Title-Case, not proof of all random casings outside serializers.

### URLs and redirects

sanitizeUrlForLog retains path/parameter names, replaces all query values, normally drops trailing fragments. reqLogSerializer also redacts every top-level req.query value, including nested values as a whole. resLogSerializer handles both raw ServerResponse and pino-http standard-serialized shapes. sanitizeHeaders recognizes Location, Content-Location, Referer/Referrer case-insensitively, including arrays.

Actual signed document flow still uses req.query exp/sig and verifyDocumentUrl at pt_application.controller.ts:139–144 before file existence :154/sendFile :157; S3 redirect remains :171. The serializer returns new log objects; no auth/signing/controller source changed. Tests verify signature helper still accepts a valid link, raw query/header values are unchanged after logging and actual redirect headers remain byte-identical. No actual document was loaded; nonexistent file returns 404. No S3 call was made.

### Axios/errors

projectConfig retains method, sanitized url/baseURL, timeout and sanitized headers; omits data, params and other raw client config. errLogSerializer drops request/raw, reduces response to status/statusText/config and preserves useful standard Error fields. Real AxiosError bare and wrapped logs have no raw ClientRequest. Actual HTTP-created AxiosError from a localhost 418 response was also tested, including response metadata and client headers/body/query markers.

This is a bounded replacement of known carriers, not a whitelist of every enumerable Error property: ...rest remains. Aggregate/nested Error boundary is explicitly tested and disclosed below.

## 5. Runtime serializer integration

- backend/shared/src/index.ts:54–57 constructs the real logger with redact:logRedactOptions AND serializers:httpLogSerializers; :60 exports the helpers/policy.
- auth-service/src/app.ts:4,21 and user-service/src/app.ts:6,37 explicitly pass serializers:httpLogSerializers to pinoHttp. These are the only app changes in the reviewed diff; middleware ordering/auth/request contracts remain intact.
- Runtime package main resolves backend/shared/dist/index.js (shared/package.json:4), which imports dist/log-safety.js and passes its serializers to the singleton (dist/index.js:69–71).
- Installed pino 8.21.0, pino-http 9.0.0, pino-std-serializers 6.2.2 were inspected. pino-http/logger.js:27–35 installs wrapped serializers from its own options; relying only on parent logger serializers is insufficient. It passes already-standard-serialized req/res shapes to custom serializers by default; current functions support those and direct raw objects.
- Child-process stdout capture exercises actual compiled singleton, not only an exported config on a second logger. No process.stdout patching or production destination changes.

pino-std-serializers/lib/err.js:21–25 builds message/stack/aggregateErrors; :28–40 copies enumerable metadata; :43–44 sets raw. Correction projects its top-level output; nested standard serializer results are not recursively re-projected.

## 6. Independently executed tests

### Scoped results

| Run | Result | Evidence boundary |
|---|---|---|
| Four user files listed below | PASS: 45 passed, 0 failed, 0 skipped; exit 0; ~3.14s | Includes all 7 correction tests A–H (D/E combined) |
| Eleven auth files listed below | PASS: 86 passed, 0 failed, 0 skipped; exit 0; ~3.21s | Includes all 7 original logger-redaction tests |
| Independent expanded singleton/HTTP/Axios probe | PASS supported matrix: exit 0; 155 distinct sensitive markers absent | 4 HTTP casing/redirect cases, 4 constructed AxiosError objects bare+wrapped, actual wire AxiosError bare+wrapped, explicit supported req shapes |
| Residual probes | Expected limitations reproduced | Deep/password, free text, cause text, URL path, AggregateError, fragment-before-query; not counted as protection PASS |
| Fresh shared artifact smoke | PASS scoped | Actual auth/user apps + fresh compiled shared, header/query/error markers absent, negative control leaks |
| Strict TypeScript consumer check, no emit | PASS scoped: zero diagnostics / zero blocked-data reads | Explicit auth app, user app, original test, correction test roots + transitive code |
| DB-backed suites | ENVIRONMENT_BLOCKED; not run | Docker Desktop Linux pipe absent; no positively identified isolated PostgreSQL/Redis |

Total unique scoped test cases passed: **131 = 45 + 86**. The seven original/new cases are already included; do not add them again. Independent probes are observations/assertions, not additional repository test-count inflation.

User files in backend/services/user-service/src/__tests__: log-secret-hygiene.test.ts; ptDocumentUrl.util.test.ts; auth-middleware-transport.test.ts; auth-service-client.test.ts.

Auth files in backend/services/auth-service/src/__tests__: credential-rotation-hardening.test.ts; logger-redaction.test.ts; login-and-refresh.test.ts; login-rate-limit.test.ts; partner-application.test.ts; pt-deactivation-relay-sweep.test.ts; pt-deactivation-relay.test.ts; registration-otp.test.ts; role-change-authorization.test.ts; self-service-recovery.test.ts; set-user-active-relays-pt-deactivation.test.ts.

Commands: Node C:/Program Files/nodejs/node.exe + resolved tsx/cli, --test followed by those explicit service-relative filenames, cwd corresponding service. No wildcard full-repository run. Child env constructed from OS-required PATH/SystemRoot/TEMP variables and synthetic JWT/internal/document secrets only, NODE_ENV=test, LOG_LEVEL=info, DATABASE_URL=postgresql://synthetic:synthetic@127.0.0.1:1/gymini_review_test?connect_timeout=1, SMTP credentials empty, AWS_EC2_METADATA_DISABLED=true, AWS_LAMBDA_FUNCTION_NAME=SYN_LOCAL_REVIEW_NO_AWS, TSX_DISABLE_CACHE=1. Lambda flag prevents local upload-directory creation; no AWS invocation. No server.ts/.env loading.

The correction test's nested child sets its own synthetic environment and nonserving localhost DB URL; parent does not pass real credentials. All contacted HTTP endpoints were localhost; redirects used manual mode, no synthetic.invalid request was sent. Test auth/client/repository seams are fixtures, not DB integration or real credential login.

Excluded auth credential-rotation-transaction.integration.test.ts uses database setup/drop/create via Docker; no isolated DB was positively identified. Full user DB tests and real S3/document flow were not run. Docker command executed: docker -H npipe:////./pipe/dockerDesktopLinuxEngine ps --format '{{.Names}}' → pipe not found. No Docker startup, provisioning or dev/prod fallback.

### Test validity and negative control

Original seven tests remain meaningful and passed unchanged: serialization-output absence assertions, nested fields, raw/wrapped Error config auth, operational metadata, mocked authenticated flow and basic concurrency. Their collecting logger uses redact config only, so they do not replace singleton/http serializer checks; original test descriptions cannot establish all new guarantees.

New log-secret-hygiene.test.ts:98 A checks credential absence/status; :106 B checks real signed URL signature absence + 404; :115 C checks sent Location unchanged vs sanitized log; :126 D/E checks both error call styles, response/config headers, body/raw request removal; :144 F checks explicit Title-Case headers; :148 G checks method/id/status/duration/Error fields; :162 H checks unprotected logger emits synthetic service/query/Axios markers. It captures child stdout and separates negative lines by neg:true.

Negative control was actually executed as part of the new test and fresh-artifact smoke. It creates a separate unprotected Pino + default pino-http, leaving singleton/source untouched. It reproduces marker leakage, demonstrating absence assertions are not vacuous. This is not a full suite mutation run removing each protection independently. The literal SYN_INTERNAL_SERVICE_SECRET absence assertion alone is weaker than sending the active secret; the previous R01 fixture and current independent field-value matrix check actual sent values.

Independent matrix adds lower-case, Title-Case, UPPERCASE and alternating casing for all 9 policy headers; actual AxiosHeaders; Content-Location; relative and absolute URLs; config.url/baseURL; raw ClientRequest from a real localhost axios request; config non-mutation; real signature verification. All 155 protected markers were absent. Operational id/method/path/status/duration and error code/message/status remain available. Actual redirect Location/Content-Location values were preserved in 4 cases.

## 7. Build/package verification

### Fresh local shared artifact: verified

Ran standard shared TypeScript project build into a new empty OS temp directory:

```text
node <resolved typescript/bin/tsc> --project backend/shared/tsconfig.json --outDir <TEMP>/gymini-vt0011-review-mbrfjL/shared-dist --incremental false
```

cwd backend/shared; exit 0; no diagnostics. Artifact directory: C:/Users/ASUS/AppData/Local/Temp/gymini-vt0011-review-mbrfjL/shared-dist. This uses the same build compiler/options as shared/package.json build=tsc, with only output location isolated; it does not use existing dist as input. Byte comparisons of fresh index.js and log-safety.js against currently resolved shared/dist were equal. No hashing or dataset read was performed.

Fresh runtime smoke maps only @gym-coach/shared to that fresh index.js in a child, NODE_PATH=backend/shared/node_modules for normal dependencies. It runs the correction test's actual auth/user app probe: 200/200 health, valid signed nonexistent document 404, Location unchanged, signature absent, header/error markers absent, unprotected negative-control markers present; exit 0. Existing shared/dist was not overwritten. This proves clean shared artifact functionality with the installed dependency tree, not hermetic dependency installation or full deployment image correctness.

### Standard packaging source: verified by CODE AUDIT

Auth Dockerfile:20 builds shared and :32 copies shared/dist. User Dockerfile:23 builds shared and :34 copies it. Auth scripts/build-lambda-artifact.js:254 and user counterpart :234 explicitly build shared before service packaging. Root recursive build includes shared. Local dev does not watch shared; infra/compose/docker-compose.dev.yml:17 documents rebuild requirement.

### Full deployable artifact: CLEAN_ARTIFACT_NOT_VERIFIED

No fresh full auth/user image or Lambda ZIP, clean dependency installation, artifact promotion or deployment was run. Standard pipelines rebuild shared by source inspection, but stale dev dist remains possible when bypassing that workflow. Full image/ZIP validation belongs in controlled deployment review; local shared build success does not certify deployed code.

Strict TypeScript check used explicit four entrypoints and transitive imports with repo-equivalent strict ES2022/CommonJS options, noEmit/incremental=false and a readFile guard rejecting heldout/sealed/data/eval paths. Zero diagnostics, zero attempted protected-data reads. This is scoped verification, not all five package typechecks reported by the author.

## 8. Remaining security risks

### RR-F01 — MEDIUM, non-blocking bounded-object/aggregate boundary

Field redact paths stop at depth 2; serializer-specific headers are case-insensitive but arbitrary explicit metadata is not. Deep structured password marker remains visible. New probe logger.error(new AggregateError([real AxiosError], 'outer')) leaves the nested Axios config service-secret marker visible: std err serializer creates aggregateErrors, and errLogSerializer:115–116 retains it through ...rest without recursively applying projectConfig. Raw request marker did NOT appear in that exact aggregate probe; do not claim it did.

This is a confirmed synthetic serialization limitation, not confirmed current exploitable credential logging in auth/user. Scoped production-source search found no AggregateError/aggregateErrors callsite or demonstrated equivalent nested Axios shape; actual current top-level Error conventions are protected. Preserve the bounded contract and add safe recursive/allowlisted nested-error projection if such a carrier is introduced; do not advertise protection for all nested Errors.

### RR-F02 — LOW, fragment-before-query handling edge

log-safety.ts:35–44 finds ? before handling fragment order. sanitizeUrlForLog('https://synthetic.invalid/p#SYN_RR_FRAGMENT_SECRET?x=value') retains SYN_RR_FRAGMENT_SECRET, contradicting unconditional “fragment dropped” wording. Valid URL semantics put that ? inside the fragment. Normal signed query URLs with ? before # pass; browser HTTP requests do not send fragments, but Location/Referer or manually logged URL strings can carry them. No current secret-bearing fragment-before-query route/callsite was found. Follow-up should strip at first # before parsing the remaining query, with a regression; no source correction performed here.

### RR-F03 — MEDIUM, free text/cause messages and URL path

Probe message text, Error cause text and /document/SYN_RR_PATH still appear. std error serializer concatenates cause message/stack; header/config projection cannot sanitize arbitrary text. URL paths/req.params, query parameter names and unlisted metadata remain observable by design. No confirmed current in-scope callsite interpolating credential directly into message, or credential-token path segment, was identified by this scoped review. Existing signed document capability is a query value and is now protected; filename remaining visible is not proof that signature still leaks.

These are guardrails for future code: avoid secret-bearing text/path/name representations, prefer safe projections, add a specific serializer when a new real carrier is found. Do not impose a recursive regex sanitizer or claim complete DLP from current fix.

### Historical exposure / deployment limitations

Correction prevents future covered emissions; it does not erase earlier logs. No CloudWatch retrieval, access/retention assessment, credential rotation or proof of historical absence/exposure occurred. Owner assessment/rotation, if warranted, is a separate authorized operation. DB integration, real S3 redirect delivery and target deployed artifact remain unverified. Other services adopting pino-http must explicitly pass these serializers; parent logger alone is insufficient.

## 9. Acceptance gate matrix

| Gate | Result | Evidence / practical limit |
|---|---|---|
| R01 HTTP/service headers | PASS scoped | Real auth/user app probes + 4 casing variants / 9-header policy |
| R01 error header casing | PASS scoped | AxiosHeaders config/response.config, bare/wrapped constructed and wire errors |
| R02 signed request query | PASS scoped | Real signing helper, signature absent from user log, valid signature still verifies, nonexistent doc 404 |
| R02 Location + Content-Location | PASS scoped | Relative/absolute query URLs, raw headers unchanged, log markers absent |
| R02 request/redirect non-mutation | PASS scoped | Independent raw query/header/config assertions and sent-header equality |
| R03 unsafe raw request removal | PASS scoped | Top-level real AxiosError ClientRequest/config/data/response projections |
| Runtime singleton + explicit app serializers | PASS | Source wiring, actual dist resolution, real app child stdout |
| Existing tests / operational metadata | PASS scoped | 86 auth + 45 user, including original/new tests, method/id/status/duration/Error fields |
| Fresh shared compilation/runtime | PASS scoped | Temp clean build + equality of 2 key JS files + actual app smoke |
| Full clean service image/ZIP | NOT_VERIFIED | CLEAN_ARTIFACT_NOT_VERIFIED |
| DB-backed regression | NOT_VERIFIED | ENVIRONMENT_BLOCKED, not counted as PASS |
| Universal deep/text/aggregate/path sanitization | PARTIAL | Explicit non-blocking limitations RR-F01/F02/F03; not an implemented universal guarantee |
| Historical production log safety / rotation | NOT_VERIFIED | No CloudWatch or real credential access |
| Scope/repository safety | PASS | One new repo report; existing diff/HEAD preserved, temp artifact isolated |

## 10. Local closure and controlled deployment recommendation

V-T001 may be closed locally for R01/R02/R03 under the supported bounded contract; RR-F01/F02/F03 remain documented non-blocking follow-ups. There is no remaining independently confirmed current auth/user credential-bearing HTTP/Axios path among the previous blockers that requires withholding local correction approval.

Controlled deployment **review** for this correction may begin, with full image/ZIP rebuild/runtime check, target rollout/observability review and explicit DB test disposition. This does not authorize deployment, certify historical log hygiene or override other milestones: V-T012 retains its own changes-required verdict, Bedrock/AWS work is outside scope, and the dirty branch is not approved as a combined release.

Exact next action: review the correction's deployable artifact and rollout evidence through the normal controlled review process; track fragment-order regression and nested-error contract follow-up separately. No implementation, infrastructure change, secret rotation or deployment is performed by this re-review.

## 11. Reproduction appendix

Independent expanded probe ran as child Node -r <resolved tsx/cjs> -, cwd backend/services/user-service, minimal synthetic environment in section 6; capture child stdout. Lines beginning RR_SUMMARY are metadata for assertions, not logger output; protected-marker absence is checked only against JSON log lines. Residual markers are deliberately different from protected marker set.

```js
const assert=require('assert/strict');const http=require('http');const express=require('express');const axios=require('axios');const {logger,httpLogSerializers,sanitizeUrlForLog,sanitizeHeaders}=require('@gym-coach/shared');const pinoHttp=require('pino-http');const {verifyDocumentUrl,toSignedPtDocumentUrl}=require('./src/utils/ptDocumentUrl.util.ts');const names=['authorization','cookie','set-cookie','x-service-secret','x-internal-token','x-internal-secret','x-gateway-secret','x-api-key','proxy-authorization'];const markers=[];const expected=[];const title=s=>s.replace(/(^|-)([a-z])/g,(_,a,b)=>a+b.toUpperCase());const variants=[s=>s,title,s=>s.toUpperCase(),s=>s.split('').map((c,i)=>i%2?c.toUpperCase():c).join('')];let counter=0;function headers(v){return Object.fromEntries(names.map(n=>{const m='SYN_RR_HEADER_'+(++counter);markers.push(m);return [v(n),m]}))}const app=express();app.use(pinoHttp({logger,serializers:httpLogSerializers}));app.get('/redirect/:mode',(req,res)=>{const location=req.params.mode==='abs'?'https://synthetic.invalid/doc?sig=SYN_RR_LOCATION_ABS#SYN_RR_FRAGMENT':'/doc?sig=SYN_RR_LOCATION_REL';const content=req.params.mode==='abs'?'/content?key=SYN_RR_CONTENT_REL':'https://synthetic.invalid/content?key=SYN_RR_CONTENT_ABS';markers.push(location.includes('ABS')?'SYN_RR_LOCATION_ABS':'SYN_RR_LOCATION_REL',content.includes('REL')?'SYN_RR_CONTENT_REL':'SYN_RR_CONTENT_ABS');expected.push({originalUrl:req.originalUrl,sig:req.query.sig,header:req.headers['x-service-secret'],location,content});req.log.info('route operational');res.setHeader('Content-Location',content);res.redirect(302,location)});app.post('/axios',(req,res)=>{res.setHeader('X-Service-Secret','SYN_RR_RESPONSE_SECRET');markers.push('SYN_RR_RESPONSE_SECRET');res.status(418).json({secret:'SYN_RR_RESPONSE_BODY'});markers.push('SYN_RR_RESPONSE_BODY')});const s=http.createServer(app);s.listen(0,'127.0.0.1',async()=>{try{const base='http://127.0.0.1:'+s.address().port;for(let i=0;i<variants.length;i++){const h=headers(variants[i]);const sig='SYN_RR_REQ_'+i;markers.push(sig);const r=await fetch(base+'/redirect/'+(i%2?'rel':'abs')+'?sig='+sig+'&nested[x]=SYN_RR_QUERY_NESTED',{headers:h,redirect:'manual'});markers.push('SYN_RR_QUERY_NESTED');const e=expected.at(-1);assert.equal(r.headers.get('location'),e.location);assert.equal(r.headers.get('content-location'),e.content);assert.equal(e.sig,sig);assert.equal(e.header,h[Object.keys(h).find(k=>k.toLowerCase()==='x-service-secret')]);}for(const v of variants){const config={url:'/relative?sig=SYN_RR_ERR_URL',baseURL:'https://synthetic.invalid/?key=SYN_RR_ERR_BASE',headers:axios.AxiosHeaders.from(headers(v)),method:'post',timeout:123,data:'SYN_RR_ERR_DATA',params:{token:'SYN_RR_ERR_PARAMS'}};markers.push('SYN_RR_ERR_URL','SYN_RR_ERR_BASE','SYN_RR_ERR_DATA','SYN_RR_ERR_PARAMS','SYN_RR_RAW_REQUEST');const err=new axios.AxiosError('synthetic downstream failure','SYN_ERROR_CODE',config,{_header:'SYN_RR_RAW_REQUEST'},{status:503,statusText:'Unavailable',config,request:{_header:'SYN_RR_RAW_REQUEST'},data:'SYN_RR_ERR_DATA',headers:headers(v)});logger.error(err,'bare-real');logger.error({err},'wrapped-real');assert.equal(config.headers.get('x-service-secret').startsWith('SYN_RR_HEADER'),true);assert.equal(config.url,'/relative?sig=SYN_RR_ERR_URL');}try{await axios.post(base+'/axios?sig=SYN_RR_WIRE_QUERY','SYN_RR_WIRE_BODY',{headers:headers(title)})}catch(err){assert(axios.isAxiosError(err));markers.push('SYN_RR_WIRE_QUERY','SYN_RR_WIRE_BODY');assert(err.request instanceof http.ClientRequest);logger.error(err,'wire-AxiosError');logger.error({err},'wrapped-wire-AxiosError');}const signed=toSignedPtDocumentUrl('/uploads/pt-applications/SYN_RR_DOCUMENT.png');const u=new URL(signed,base);assert(verifyDocumentUrl('SYN_RR_DOCUMENT.png',u.searchParams.get('exp'),u.searchParams.get('sig')));for(const raw of ['/relative?sig=SYN_RR_DIRECT_QUERY#SYN_RR_DIRECT_FRAGMENT','https://synthetic.invalid/absolute?key=SYN_RR_DIRECT_QUERY#SYN_RR_DIRECT_FRAGMENT']){logger.info({req:{id:'manual',method:'GET',url:raw,query:{key:'SYN_RR_DIRECT_QUERY',nested:{password:'SYN_RR_DIRECT_QUERY'}},headers:headers(title)}},'explicit-supported-req');markers.push('SYN_RR_DIRECT_QUERY','SYN_RR_DIRECT_FRAGMENT');}logger.info({deep:{a:{b:{password:'SYN_RR_DEEP'}}}},'residual-deep');logger.error(new Error('outer',{cause:new Error('SYN_RR_CAUSE_TEXT')}),'residual-cause');logger.info('residual message SYN_RR_FREE_TEXT');logger.info({req:{id:1,method:'GET',url:'/document/SYN_RR_PATH?sig=safe',headers:{}}},'residual-path');const edge=sanitizeUrlForLog('/p#SYN_RR_FRAGMENT_BEFORE_QUERY?x=value');console.log('RR_SUMMARY '+JSON.stringify({markers:[...new Set(markers)],httpRequests:4,constructedAxiosErrors:4,wireAxiosError:true,unchangedRedirects:4,signatureStillVerifies:true,edgeFragmentPreserved:edge.includes('SYN_RR_FRAGMENT_BEFORE_QUERY')}));}catch(e){console.error(e);process.exitCode=1}finally{s.close(()=>logger.flush())}});
```

Aggregate/fragment residual probe (expected limitations, not protection PASS):

```js
const {logger,httpLogSerializers,sanitizeUrlForLog}=require('@gym-coach/shared');const axios=require('axios');const e=new axios.AxiosError('inner','SYN_CODE',{headers:{'X-Service-Secret':'SYN_RR_AGGREGATE_SECRET'}},{_header:'SYN_RR_AGGREGATE_REQUEST'});logger.error(new AggregateError([e],'outer'),'residual-aggregate');console.log('RR_EDGE '+sanitizeUrlForLog('https://synthetic.invalid/p#SYN_RR_FRAGMENT_SECRET?x=value'));
```

Fresh-artifact smoke used the PROBE literal from log-secret-hygiene.test.ts, prepended this child-only module resolution hook, then executed via stdin with NODE_PATH pointed at shared/node_modules:

```js
const Module=require('module');const originalResolve=Module._resolveFilename;Module._resolveFilename=function(request,...args){if(request==='@gym-coach/shared')return "C:\\Users\\ASUS\\AppData\\Local\\Temp\\gymini-vt0011-review-mbrfjL/shared-dist/index.js";return originalResolve.call(this,request,...args)};
```

The report's positive result is limited to local source/dependencies and this fresh shared compilation. No full deployed-artifact or production result is implied.
