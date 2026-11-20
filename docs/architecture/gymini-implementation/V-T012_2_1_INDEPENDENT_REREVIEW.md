# V-T012.2.1 — Independent re-review

Ngày 2026-10-19. Reviewer: Codex. **V-T012_2_1_CHANGES_REQUIRED**.

## 1. Baseline và phạm vi

START_HEAD = END_HEAD: `003545c6da8d524e8c4f6fbe4575444102f1fc50`; branch `aws-deploy`. Review tại working tree hiện tại; không checkout baseline, không reset/stash/clean/commit/push. Chỉ tạo báo cáo này. Source, migrations, generated client, tests và báo cáo cũ giữ nguyên.

Baseline có 30 tracked files modified (780 insertions/267 deletions; generated Prisma được Git hiển thị binary): ai-service package/schema/generated client, app/controllers/errors/jobs-lambda/auth/rate middleware/repository/routes, conversation/fitness-agent/nutrition/worker/queue và Bedrock; auth/user app, shared logger, lockfile. Untracked có sẵn: hai migration generation-operation/epoch, generation services và tests/helpers, Bedrock credentials/test, log-safety/tests, các thư mục audit/implementation, hai AWS shutdown/scheduler JSON. Tất cả là input read-only của review. Đã đọc CLAUDE.md và skill parallel-agent-safety, real-e2e-verification.

Không đọc/hash/index/traverse heldout/sealed/training/eval; không gọi AWS, DB DEV/production, SQS thật hay paid inference. Các probe dùng synthetic identity, mock provider, fixture store/transport. Không triển khai hoặc áp migration.

## 2. Kết luận chính

102/102 scoped regression tests pass độc lập; ai-service TypeScript noEmit exit 0. Những kết quả này **không đủ duyệt durability**. Có lỗi độc lập tái hiện được ngoài các assertion hiện tại:

| ID mới | Mức độ | Kết quả |
|---|---|---|
| RR-01 | HIGH | Retry chat sau khi response đã persist sinh operation key mới; retry trước persist và intentional repeat vẫn nhập nhằng |
| RR-02 | HIGH | Operation chuyển FAILED trước khi ghi Plan FAILED; nếu ghi Plan lỗi, recovery lần sau không chọn terminal row, Plan QUEUED bị bỏ lại |
| RR-03 | HIGH / BullMQ compatibility | Job ID `operationId:epoch` bị chính BullMQ 5.66.5 đang cài từ chối |

PostgreSQL integration: **POSTGRESQL_INTEGRATION_ENVIRONMENT_BLOCKED**. Docker Linux-engine pipe không tồn tại. `docker-compose.test.yml` xác định test profile dùng `postgres-test` và database `gymcoach_ai_test`; không có container chạy để xác minh danh tính. Không kết nối hoặc migrate DB thay thế.

## 3. Atomic fencing — D22-R01

**CODE AUDIT:** `backend/services/ai-service/src/services/generation-operations.ts:172` dùng interactive Prisma transaction; UPDATE operation có id/epoch/leaseOwner/RUNNING/unexpired lease, kiểm count=1 rồi truyền đúng `tx` vào callback. Sáu writer ở `repositories/conversation.repository.ts:468,480,502,602,611,625` dùng runFenced. UPDATE trên cùng operation row là điểm serialization với claim/takeover; transaction timeout 15s, maxWait 5s. Không giữ transaction qua model call.

Đây là sửa đúng hướng cho check-then-write cũ. Test R01a độc lập chạy lại đặt barrier trong writer sau ownership check: memory mutex chặn competing claim; R01b kiểm stale attempt bị từ chối và B còn authoritative. **TEST FIXTURE**, không phải PostgreSQL row-lock proof. Fixture tự cài mutex nên không chứng minh Prisma SQL, rollback, lock wait hay predicate re-evaluation thật.

Giới hạn: runFenced chỉ ràng buộc operation/epoch/token; không kiểm targetId của mutation. Writer vẫn nhận planId độc lập. Claim kiểm binding ban đầu, nhưng không nên tuyên bố helper tự bảo vệ arbitrary wrong-target writes. Cần transaction assertion targetType/targetId và kiểm count của Plan mutations. finish/release (`:195,202`) có epoch/token/status nhưng thiếu unexpired-lease predicate. Terminal Operation/Plan chưa atomic: xem RR-02.

## 4. Execution epoch — D22-R02

**CODE AUDIT + TEST FIXTURE:** epoch tăng khi reopen FAILED; messages mang operationId/epoch/planId/kind/actorUserId. Claim kiểm đầy đủ binding trước model callback; old epoch được acknowledge không chạy; forged actor/target/kind và current-epoch duplicates có test pass. Đây là cải thiện xác thực incarnation so với operationId đơn lẻ. Không chứng minh producer identity bằng những field đó: queue origin vẫn là trust boundary riêng.

Legacy không operationId vẫn chạy unwrapped trừ khi `AI_GENERATION_REQUIRE_OPERATION=true`. Đây là compatibility mode, không có atomic fencing cho legacy. Drain/cutoff là prerequisite; không có deployed drain evidence. Không được dựa riêng vào comment rằng legacy targets không bao giờ trùng operation targets như một enforced invariant.

FAILED cùng key có thể nhận fingerprint khác (`submitGeneration`), trong khi reopen không đổi kind/subjectUserId. Cần từ chối conflicting logical input nhất quán hoặc định nghĩa rõ immutable logical record/new execution; không coi key conflict test ở trạng thái nonterminal là proof cho FAILED case.

## 5. Chat identity — D22-R04 / RR-01

`fitness-agent.service.ts:59,2146,2268`: key dùng newest persisted conversation ID + params hash (revision thêm action ID), không dùng current authenticated request ID. `rag.service.ts:115` persist conversation sau orchestration.

Probe độc lập gọi actual `fitnessAgent.proposeNutritionPlan`, fake target/profile/repository và recorder queue command: lần đầu previous turn=null; mô phỏng response đã commit bằng `{id:'committed-first-response'}`; gửi lại **cùng logical request** sinh key khác. Assertion `keys[0] !== keys[1]` pass. Không model call, không DB. Tình huống thực tế: server commit response nhưng client mất response rồi retry. Hai thiết bị chia sẻ conversation cũng có thể thay đổi previous turn không liên quan đến request retry.

Các test qua 20 phút chỉ giữ nguyên lastTurn fixture, nên không kiểm retry sau commit. Intentional repeat trước persist vẫn có thể collapse; đây là thiếu request identity contract, không phải xử lý được bằng hash text. Revision retry sau một turn khác cũng đổi key dù là retry cũ. Hai users có namespace riêng; same key conflicting payload được kiểm ở nonterminal; PT/client binding cần giữ authorized subject trong fingerprint và validate quan hệ ở boundary chủ sở hữu.

Sửa nhỏ nhất: request/turn/revision ID ổn định, authenticated và persisted trước generation; truyền từ ingress qua domain command. Retry cùng ID trả operation cũ kể cả sau commit; deliberate repeat tạo ID mới. Không dùng “last turn hiện tại” làm identity của request.

## 6. Metadata — D22-R03

Plan.jobId được gán operationId khi create; advanced replay có ensurePlanRow để sửa thiếu metadata. Transport messageId tách riêng. Đây là cải thiện đúng; fixture publish/worker-before-ack tests pass.

Giới hạn: `findPlanByJobId` ở repository:546 chỉ tìm WorkoutPlan, không NutritionPlan; `/plans/job/:jobId` không phải general operation-status endpoint. Cùng operationId được dùng lại qua nhiều epoch và nhiều Plan, findFirst không chọn epoch/current target: poll có thể thấy Plan cũ sau reopen. Chưa tái hiện qua real DB; **CODE AUDIT** risk cần test riêng. Existing owner check trên found Plan được giữ, nhưng không thay cho epoch-aware status contract.

## 7. Recovery — D22-R05 / RR-02

`generation-operations.ts:223` selection chỉ RESERVING/ADMITTED/PUBLISHED/expired RUNNING, không FAILED/COMPLETED. `:457` failOrphan ghi Operation FAILED rồi `ensureTargetFailed` ghi Plan ở statement khác. Claim exhaustion cũng gọi Plan repair sau operation terminalization (`:522`).

Probe độc lập actual recoverPendingGenerations + memory store + fake Plan repository: tạo operation PUBLISHED, đặt publishCount=3, clock +1,000,000ms; inject Prisma Plan updateMany throw sau failOrphan. Kết quả:

```json
{"first":{"reservationsCleared":0,"republished":0,"completedOrphans":0,"failed":0,"errors":1},"second":{"reservationsCleared":0,"republished":0,"completedOrphans":0,"failed":0,"errors":0},"operation":"FAILED","plan":"QUEUED"}
```

Không có permanent repair ở lần sau: terminal rows không được chọn. Đây là TEST FIXTURE tái hiện ordering defect thật, không là production incident. Cần atomic terminal Operation + target Plan dưới operation lock hoặc durable repair-needed state được recovery lựa chọn, checked row counts, epoch/target predicates.

Publish bound chưa phải hard concurrent bound: nhiều runner đọc cùng publishCount rồi publish trước khi increment; failed publish không tăng count; stale ADMITTED không kiểm maxPublishes. Có thể retry không giới hạn khi queue lỗi, hoặc nhiều publication hơn limit khi concurrent runners. Cần durable publication claim/attempt CAS với bounded retries/backoff; worker dedupe không làm publisher bounded.

Entry point `jobs-lambda.ts:105` có `ai-generation-recovery`; chưa có schedule trong change. Automatic recovery là operational release prerequisite, **NOT_VERIFIED**. Không bật schedule trong review.

## 8. BullMQ — RR-03

`generation-operations.ts:327` publish opts.jobId=`${row.id}:${row.epoch}`. `workers/queue-provider.ts:96` chuyển nguyên giá trị vào aiQueue.add ở non-SQS path. Installed BullMQ 5.66.5 `dist/cjs/classes/job.js:987` reject colon ID trừ legacy 3-part repeat form; UUID:epoch có hai phần.

Probe không Redis: gọi actual `Job.prototype.validateOptions.call({opts:{jobId:'synthetic-op:1'}},{})`, nhận **Custom Id cannot contain :**. Một lần probe đầu dùng constructor thiếu queue keys bị TypeError setup; đã sửa bằng gọi validator trực tiếp, không coi setup failure là product defect. Chọn ID hợp lệ (ví dụ dấu gạch nối) và test actual installed validator/isolated queue. Fake enqueue suites không thấy lỗi này. SQS path không bị quy tắc BullMQ này.

## 9. External autosave

`nutrition.processor.ts:584–600` hoàn thành Plan trong DB rồi probe lease và POST `/nutrition/from-ai-plan`; probe không fence HTTP side effect. `fitness-service/src/services/nutrition.service.ts:1427` dedupe theo userId+sourcePlanId rồi create ACTIVE NutritionProgram nếu chưa có; không nhận execution fencing token. Do đó downstream write có thể xuất hiện sau khi claim đã mất; nếu owner mới short-circuit vì Plan đã COMPLETED, autosave cũng có thể không được retry.

Không tái hiện live/cross-service race trong review này. **CODE AUDIT**: đây là user-visible NutritionProgram creation risk, không phải chỉ operational log. Chưa chứng minh stale overwrite của existing NutritionProgram (existing branch trả alreadyExists). Không phóng đại thành confirmed overwrite. Cần downstream idempotency/fencing hoặc durable save intent sau canonical completion; không giữ PostgreSQL transaction qua HTTP.

## 10. Lease, quota, configuration

Source defaults: lease 900s, attempts 3, reservation timeout 60s, published stale 900s, maxPublishes 3; renewal ở writes, không heartbeat. llm.service default call timeout 60,000ms nhưng whole job có nhiều calls/repair/DB/HTTP nên không suy ra whole-job bound. Invalid/nonpositive env chưa được validate chặt. infra/terraform/modules/lambda-http-api/main.tf:21 có timeout=10 cho module HTTP, không phải evidence timeout worker target.

RATE_LIMIT_PROVIDER default memory; dynamodb option hiện có, off cũng có. Shared REST/chat quota tests pass; không proof deployed distributed quota/table/IAM. Target Lambda timeout, SQS visibility, DLQ/redrive, EventBridge rule, deployed rate provider: **DEPLOYMENT_NOT_VERIFIED**. Không đọc runtime AWS. Cần cấu hình lease/heartbeat/visibility/maximum run và bounded redelivery nhất quán. Không hứa exactly-once inference hoặc quota transaction giữa PostgreSQL và DynamoDB.

## 11. Tests và evidence

Từ `backend/services/ai-service`:

```text
node node_modules/tsx/dist/cli.mjs --test src/__tests__/generation-operations.test.ts src/__tests__/generation-admission.test.ts src/__tests__/ai-endpoint-policy.test.ts src/__tests__/rate-limit.test.ts src/__tests__/auth-middleware-token-rejection.test.ts
node node_modules/typescript/bin/tsc --noEmit
```

Synthetic DATABASE_URL trỏ 127.0.0.1:1/gymini_review_test, NODE_ENV=test, mock LLM/embedding, synthetic secrets, Redis localhost:1, LOG_LEVEL=silent, EC2 metadata disabled. Tests stub database/queue/model seams; không load actual credential để gọi external services.

| Check | Kết quả |
|---|---|
| Five scoped suites | 102 PASS / 0 FAIL / 0 SKIPPED, exit 0, 13.8s |
| ai-service noEmit | PASS, exit 0 |
| Independent terminal-repair probe | Defect reproduced; expected-bug assertions pass |
| Actual chat function key probe | Defect reproduced; expected-bug assertion pass |
| Installed BullMQ validator | Rejection reproduced without Redis |
| Real PostgreSQL lock/rollback/20-way/CAS/cross-process | ENVIRONMENT_BLOCKED, not executed |
| AWS/runtime scheduler/provider | NOT_VERIFIED |

Four negative controls are meaningful counterexamples inside their fixture (uniqueness, exclusive claim, epoch/target checks, unfenced write); their PASS means deliberately broken variants exhibit bad behavior. They are not PostgreSQL negative controls and do not establish all writers/transitions covered. Historical 56/283 failures neither resolved nor classified as new regressions here; no comparable full baseline run.

## 12. V-T003 và corrections cần thiết

Operation là admission/execution coordination; Plan vẫn sở hữu generated content, proposal vẫn sở hữu preview/confirmation version. V-T003 cần explicit `{operationId, epoch, planId, proposalId, contentVersion, verifiedOwner}` và expected-version CAS khi attach revision. Queue command result/draft hiện chưa truyền đầy đủ epoch contract; không suy ra epoch từ jobId/operationId vì logical row có thể reopen. Không sửa execute/confirm trong review này.

Thứ tự correction: stable request identity; atomic terminal pair + repair selection; compatible BullMQ ID; epoch-aware status/metadata; bounded publisher reservation; downstream autosave contract; sau đó PostgreSQL interleaving/rollback/concurrent recovery tests. Recovery schedule, migration-before-code, legacy drain/cutoff và deployed DynamoDB/queue timing là gates độc lập trước release.

## 13. Acceptance

| Gate | Verdict |
|---|---|
| Atomic six local Plan writers | PARTIAL: source + fixture đúng hướng, PostgreSQL blocked |
| Epoch/binding ordinary redelivery | PASS scoped fixture; legacy transition PARTIAL |
| Stable chat retry/intended repeat | FAIL RR-01 |
| Terminal transition/recovery consistency | FAIL RR-02 |
| Published reference repair | PARTIAL: epoch/polling/terminal coverage còn thiếu |
| BullMQ compatibility | FAIL RR-03 |
| Shared quotas/auth policy regressions | PASS scoped; production distributed NOT_VERIFIED |
| External autosave fencing | PARTIAL / residual user-visible side effect |
| Recovery scheduling / bounded publications | PARTIAL; schedule NOT_VERIFIED, concurrent bound thiếu |
| Real PostgreSQL durability | ENVIRONMENT_BLOCKED |
| TypeScript | PASS |
| Scope safety | PASS: chỉ báo cáo mới, không source/DB/AWS/paid inference changes |

**Final: V-T012_2_1_CHANGES_REQUIRED.** Chưa đủ bằng chứng để approve controlled deploy review; các lỗi source/fixture độc lập đã đủ yêu cầu correction, không chỉ chờ môi trường PostgreSQL.
