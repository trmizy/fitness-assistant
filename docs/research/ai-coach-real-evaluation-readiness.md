# AI Coach — chuẩn bị real LLM evaluation

> Historical snapshot qua `06ed544c`. Các thay đổi sau final review nằm ở [final pilot infrastructure hardening](ai-coach-pilot-infrastructure-hardening.md); số liệu dưới đây giữ nguyên theo lượt cũ.

Ngày 2026-11-01. Review base `d344a75a`, branch `feat/advisory-content-v3`, worktree `fitness-assistant-worktrees/advisory-content-v3`.

**READY_FOR_FINAL_CODE_AUDIT — NOT_AUTHORIZED_FOR_LIVE_EXECUTION.** Bằng chứng lượt này là **CODE AUDIT / TEST FIXTURE**. Không có independent model evaluation hoặc scientific gold mới.

## 1. Finding disposition

| Finding | Trạng thái | Bằng chứng và phần phụ thuộc bên ngoài |
| --- | --- | --- |
| P1-A adapter / telemetry | FIXED về hạ tầng đã kiểm thử fake transport | Reuse Bedrock client builders/parser/transport; CountTokens admission, ledger tuần tự, append-only journal và preservation khi parse/schema lỗi. Giá thật, profile/region, CountTokens support của target và phê duyệt LIVE chưa có. |
| P1-B RAG | PARTIAL | Exact quote/source pins chặn relabelled synthetic và forged excerpts; specific-topic coverage chặn nguồn strength cho protein/creatine/calories. ACSM được retrieve cho progressive-resistance scope. Hai nguồn lịch sử vẫn `PENDING_SOURCE_REVIEW`; chưa đủ corpus khoa học rộng hoặc independent relevance/entailment labels. |
| P1-C independent evaluation | EXTERNAL_DEPENDENCY về dữ liệu/nhãn thực | Case/label schemas, hash freeze, owner release, blind packets, annotation/agreement/adjudication scaffolding đã có. Chưa có reviewer-authored/approved cases, labels thật, hoặc held-out content chưa mở. 40 template đều null, không phải 40 case độc lập. |

Không tự mark ready cho chạy pilot. Code có thể được Claude Code audit lần cuối; owner vẫn phải xác nhận các điều kiện dữ liệu, API, giá và ngân sách bên dưới.

## 2. Commit groups và changed files

Paths `src/` tương đối với `backend/services/ai-service/`.

1. `bfc756e9` — DEV Bedrock adapter/telemetry: `src/evaluation/bedrock-pilot/session.ts`, `evaluation-kit/identity.ts`, `ai-coach-bedrock-evaluation.test.ts`.
2. `9c99dfb3` — RAG relevance/distractors: `ai-coach-dev/source-registry.ts`, `retrieval.ts`, một doc-term alias trong `llm/fitness-concepts.ts`, relevance tests, `source-registry.json`, `source-expansion-workflow.json`.
3. `42a606b6` — sáu ablation arms, arm-local source allowlist, bỏ duplicate facts, matched-character placebo, wrong-excerpt control, context-size reporting và tests.
4. `8262096c` — single-outcome scope, bounded canonical exercise/unit/direct-measurement prose checks; explicit safety/crisis/out-of-domain dispositions; cập nhật regression expectations cho các invariant được siết theo yêu cầu mới.
5. Commit annotation/tests/docs chứa report này: `evaluation-kit/annotations.ts`, `bedrock-pilot/prepare.ts`, pure prompt preparation và raw post-processing interface, source-metadata leakage controls; protocol/template/pilot-plan JSON, telemetry refinements và bàn giao. Hash cuối cùng trong `git log -5` và phản hồi bàn giao.

Không thay production route, config Bedrock thật, DB/schema, index hoặc flag; không deploy/merge. Shared concept matcher chỉ thêm doc-term `progressive resistance`, có scoped regression. `services/bedrock.client.ts` và V2 protected source/data không đổi.

## 3. Adapter, budget và live lock

`openEvaluationSession(config, directory, fakeTransport?)` mặc định schema mode FAKE; FAKE bắt buộc truyền fake transport, không fallback sang network. LIVE chỉ tạo transport sau khi:

- Có `liveOptIn=true`, synthetic-only data class, supported model/parameters và profile confirmation.
- Pricing khớp model/region, nguồn AWS, version/evidence hash/owner confirmation và hạn hiệu lực còn hợp lệ; không chấp nhận `FAKE_TEST_ONLY` cho live.
- Approval riêng có scope `BEDROCK_EVALUATION_PILOT`, config hash trùng toàn bộ config/pins/budget, chưa hết hạn. Pricing/approval được kiểm tra lại trước attempt và trước inference.
- Region khớp existing Bedrock client. Không đổi env/config để ép region.

CLI `ai-coach-dev/run.ts` vẫn chỉ hỗ trợ mock và từ chối `--live` trước inference. Đã thực thi negative check: exit 1. Session API là interface cho runner được owner phê duyệt sau này, không được gọi thật trong nhiệm vụ này.

Reuse `buildConverseTextInput`, `parseConverseText`, `bedrockRuntimeDeps.send` và credential chain hiện có. CountTokens dùng cùng transport; compatibility cast cục bộ cần thiết vì public command union cũ chưa liệt kê CountTokens. Không tạo provider/client/credential implementation cạnh tranh.

Đã đối chiếu [Converse API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_Converse.html) và [Nova request schema](https://docs.aws.amazon.com/nova/latest/userguide/complete-request-schema.html): adapter hiện chỉ nhận Nova Pro v1, `maxTokens` tối đa 5,000, chọn temperature hoặc topP; không gửi seed. Seed 17/18 trong mock harness chỉ là scheduling metadata. Hỗ trợ model khác cần capability review riêng.

Theo [CountTokens API](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_CountTokens.html), việc đếm phụ thuộc model. `session.previewTokenCounts(prompts)` cho phép preflight toàn bộ frozen batch mà không inference; LIVE từ chối evaluate trước khi mọi prompt pin có count. Owner phải kiểm tra placebo/token lengths rồi mới gọi evaluate; nếu chỉnh padding thì repin/reapprove. Count được cache theo exact prompt hash trong session, số CountTokens API calls cũng bị cap bởi maxCalls. Không dùng char/token estimate làm hard input cap. Nếu target chưa hỗ trợ/được cấp quyền hoặc count lỗi: không fallback, không inference. Support thực tế chưa được xác nhận qua network.

Ledger serialize admission để tránh oversubscribe qua concurrent requests. Giới hạn call attempts, input/call và input tổng, output tổng, spend estimate và failure threshold. Mỗi attempt giữ trước input count + output cap; unknown usage/transport failure giữ reservation, không tự gọi lại. Refusal hoặc parse failure có usage hợp lệ vẫn được reconcile theo tokens đã dùng. Usage khác preflight/cap làm stop. Spend tính trên tổng tokens reserved/used với conservative nanodollar ceiling; đây là estimated model-token spend theo pricing đã duyệt, không phải hóa đơn account toàn cục. Giới hạn áp dụng cho một run; owner cần approval mới cho run mới.

SDK maxAttempts=1 cho CountTokens/Converse; retry count=0. Directory phải mới, không resume/reset budget trên một run cũ. Append lỗi làm stop. Budget giả định service tuân thủ CountTokens/output cap; nếu usage không nhất quán, stop và yêu cầu manual audit.

### Persistence

- `manifest.json` tạo bằng `wx`: config/pins/hash/mode/pricing authority và thời điểm tạo.
- `results.jsonl` append-only: STARTED, RESERVED, FINISHED hoặc REJECTED, gồm từng failed attempt.
- Raw response text, parsed candidate kể cả schema-invalid, parse/schema error, input/output tokens, stop reason, provider category, model/profile/region và hashes được giữ.
- `latencyMs` là end-to-end; `countLatencyMs` đo bước count/cache lookup của attempt, `inferenceLatencyMs` đo invocation riêng. Batch preflight là bước riêng, không lấy cache lookup time làm server CountTokens latency. Không đo được giữ null.
- Error messages/stack không được persist; known credential fields/patterns được redact, original text có digest. Không log prompt/credentials. Chỉ dùng reviewed synthetic cases; redaction không thay thế privacy review và không bảo đảm phát hiện mọi PII tùy ý.

Giá thật chưa được điền hoặc xác nhận. [AWS Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) là nguồn cần owner kiểm tra theo model/profile/region và version trước live; không suy giá từ tên model. Fake rates trong tests được đánh dấu test-only.

## 4. Sáu arms và fairness

`FLAT_LAYOUT`, `LAYERED`, `LAYERED_CONTEXT`, `LAYERED_CONTEXT_PLACEBO`, `LAYERED_CONTEXT_RAG`, `LAYERED_CONTEXT_WRONG_EXCERPT`.

Cùng AnswerV3 envelope, validators, policy variant, personal facts và generation settings giữa các arm so sánh. Source allowlist chỉ gồm IDs thực xuất hiện trong context của arm; bốn arm không RAG không thấy corpus IDs. Fact values xuất hiện một lần; namespace/provenance metadata chỉ trỏ factIds.

Placebo giữ raw personal information và thêm whitespace padding để khớp character length của context arm, không thêm facts/evidence. Character/UTF-8 sizes được report; **exact model tokens còn null**. Không gọi đây là token-matched: phải chạy approved model-specific preflight, kiểm tra tolerance rồi repin prompts trước inference. Padding có thể tạo hiệu ứng attention/tokenization khác; phải ghi đây là confound.

Wrong-excerpt arm đưa một registered original quote khác relevant set; control status/arm label không vào provider prompt. Allowlist/citation identity vẫn theo context đó. Đây là negative control; valid citation không biến quote sai scope thành support. Nếu không còn quote khác thì context rỗng, không tạo quote mới.

`prepareReleasedPilot` tạo prompts/pins và verification context từ owner-released bundles, không gọi provider. Sau approval thật, runner có thể gửi đúng `row.prompt` qua session, rồi áp `verifyRawEvaluation(row.verificationContext, attempt.parsedCandidate)` offline trên cùng raw candidate. Không cần tạo một model call riêng cho grounding.

Report raw quality, common-contract eligibility, post-gate coverage và routed slots riêng. `STRUCTURED_INVARIANT` blockers tách `NARROW_TEXT_HEURISTIC`. Blocked không được tính đúng; schema-valid, FOUND hay no-rule-match không phải semantic correctness. V2 chỉ là historical reference ngoài ablation.

## 5. RAG và context/safety limits

Trusted registry pin metadata + exact excerpt content hash, không tin sourceClass từ payload. Synthetic bị relabel curated hoặc quote bị thay nội dung không qua pin. Original excerpts, source metadata và assistant-authored applicability/limitations vẫn tách fields. Engineering pin không phải expert approval.

Specific nutrition/supplement/programming concepts phải được nội dung excerpt bao phủ; generic strength result không đủ. Scope này vẫn là deterministic relevance heuristic, chưa phải scientific entailment. No-source/no-match/outage/near-topic/wrong-excerpt/relabel controls có tests. ACSM progressive-resistance excerpt retrieve được cho query phù hợp; không ép ACSM xuất hiện ở mọi case.

[Source expansion workflow](../../data/eval/ai-coach-dev/source-expansion-workflow.json) giữ protein, creatine, nutrition/calories, current guideline và genuine research-conflict sources ở **PENDING_SOURCE_REVIEW**. Reviewer cần kiểm tra primary quote, population/intervention/comparator/outcome/currency trước registry update. Frozen pack V1 không đổi.

Single explicit outcome thiếu corresponding measurement bị hard-block khi xác minh được; mixed/unknown scope cần review. Structured assertions và bounded prose checks đối chiếu canonical names/units đã có trong facts. Không xác minh catalog thật hoặc khẳng định phủ mọi paraphrase. Các prose blockers được report là narrow heuristics.

DEV crisis triage normalize một tập cue hẹp vào existing self-harm safety gate, không tạo diagnosis/advice policy. Có control tránh nhầm `tự tử` với `từ từ`. Safety và ngoài miền có explicit disposition, bỏ generation và giữ disposition sau gate. Coverage crisis/negation/metaphor/language vẫn cần safety-owner review; không tuyên bố classifier y tế đầy đủ hoặc thay production policy.

## 6. Independent cases, labels và annotation

`evaluation-kit/annotations.ts` cung cấp:

1. ReviewerCaseSchema: request/facts, expected outcome scope, reference support, safety/abstention labels và author attestation.
2. Freeze trước generation: request hash, salted label hash, author-attestation hash. Public manifest chỉ có hashes; content/labels/salt nằm riêng ở owner-private directory.
3. Owner release cần receipt bound manifest, expiry và explicit held-out release. Generation bundle chỉ có request/pins/receipt hash; validator đối chiếu trusted manifest/receipt từ owner, chặn changed request/labels và extra metadata.
4. Hai packets R1/R2 không có arm/policy/expected labels, có claims + conclusion + questions, facts và excerpts để đối chiếu. Treatment trace và extra source/case metadata bị bỏ.
5. AnnotationSchema, complete-unit validation, distinct reviewer handles, AgreementSchema và AdjudicationSchema. Chưa có labels: agreement/kappa null. Test judgements giữ authority TEST_FIXTURE; kappa chưa tự tính, kể cả fixtures.

Pseudonyms/attestations và path separation không phải xác thực danh tính, encryption hoặc ACL. Owner phải giữ held-out content/labels ngoài implementer workspace trong tài khoản/storage được bảo vệ và độc lập duyệt authorship. Repo hiện **không có independent questions/labels thật**, không có kappa, không có scientific gold mới.

[Reviewer templates](../../data/eval/ai-coach-dev/reviewer-case-templates.json): 40 slot null (30 reviewed DEV, 10 held-out do owner giữ), minimum independent count 30. Không coi slot là authored case hoặc tuyên bố đã giữ kín một dataset chưa được tạo. Bộ 40 DEV cũ vẫn implementer-authored, không held-out.

## 7. Pilot nhỏ: chỉ chuẩn bị

[Pilot plan](../../data/eval/ai-coach-dev/bedrock-pilot-plan.json) là **NOT_AUTHORIZED_NOT_EXECUTABLE**, không phải live config hợp lệ:

- Target đề xuất Nova Pro v1, profile chưa xác nhận, region ap-southeast-1 là proposal.
- Hai independent owner-released cases × sáu arms × MINIMAL × một repetition: tối đa 12 inference attempts; offline grounding không thêm calls. CountTokens preflight tối đa một lần/attempt; đây là API request riêng, cũng cần authorization.
- Proposal: input/call 12,000; input tổng 144,000; output/call 2,048; output tổng 24,576; maxFailures=2; retries=0. Đây chưa phải ngân sách được duyệt.
- USD budget, pricing/version/expiry, code/corpus/case/prompt pins và approval còn null. Không tính cost hoặc ngầm chấp thuận một mức tiền khi chưa có giá.
- Parse failures/raw blocked answers phải manual review, có token/cost accounting, không âm thầm retry/repair hoặc loại khỏi mẫu số.

Trước live: owner xác nhận model/profile/region + CountTokens support; scientific owner duyệt corpus; evaluation owner cung cấp/release independent cases và freeze labels; pin clean reviewed code/prompts/corpus/cases, token-length controls; người dùng phê duyệt riêng config hash + call count + maximum USD. Hiện chưa có approval đó.

Trước expansion: hai reviewer chấm mù, adjudicate disagreement, đọc mọi blocked/parse-failed answer, xem unsupported personal claims/abstention/usefulness và coverage cùng chi phí/latency. Pilot thành công không cấp quyền production rollout.

## 8. Verification và audit handoff

Kết quả cuối: **281 pass / 0 fail / 0 skip trong 26 file**, ai-service `tsc --noEmit` exit 0. Scope: 12 advisory files, tám ai-coach files, bốn RAG files và hai existing Bedrock test files. Existing Bedrock/STS SDK calls được fake; Qdrant trong provider test là HTTP stub, không phải vector DB thật. Đây không phải full repository regression, REAL HTTP/API, REAL BROWSER hay model evaluation.

```powershell
# cwd: advisory-content-v3/backend/services/ai-service
$env:ADVISORY_V2_ARTIFACT_DIR='C:/D_Backup/project_personal/fitness-assistant/artifacts/ai-advisory-progress/bedrock-guarded-v2'
$a=@(rg --files src/__tests__ -g 'advisory-*.test.ts')
$c=@(rg --files src/__tests__ -g 'ai-coach-*.test.ts')
pnpm exec tsx --test @a @c `
  src/__tests__/rag-retrieval-v2.test.ts src/__tests__/rag-remediation-4-7r.test.ts `
  src/__tests__/rag-ood-safety-4-7r2.test.ts src/__tests__/rag-safety-signals-4-7r3.test.ts `
  src/__tests__/bedrock-provider.test.ts src/__tests__/bedrock-cross-account.test.ts
pnpm exec tsc --noEmit
pnpm exec tsx src/evaluation/ai-coach-dev/run.ts --mock
```

Model/Bedrock, embedding và vector DB calls thực tế = **0**. Positive LIVE-gate path chỉ được kiểm thử với synthetic approval và SDK seam bị thay bằng fake; không phải một approval hoặc network invocation thật.

Frozen source/score/byte integrity đã chạy với local V2 artifacts. Manual hashes giữ nguyên: evidence pack `4251adb6c9aa0d88d54d6b69a88824b60e37ce33a74467b822bf042483e1b8ea`; results `4f3f376ac81a93f645ba86a49a241f2d761e2bdf29388dcb44f79530e16c857a`. Diff protected V2 files và existing Bedrock client so với reviewed base bằng 0.

Mock harness chỉ kiểm tra plumbing: 40 DEV cases × 6 arms × 2 policies × 2 repeats = 960 scheduled slots, 888 mock completions sau safety/out-of-domain routing. RAG 160 slots: 8 safety, 4 out-of-domain, 148 raw generated, 144 post-gate eligible, 4 blocked structured invariant; heuristic blockers 0 trong scripted mock. Không tính retention là accuracy; correctness/semantic support/usefulness/model costs vẫn null.

DEV status coverage: 28 FOUND, 4 NO_MATCH, 4 UNRESOLVED, 1 UNAVAILABLE, 2 SAFETY, 1 OUT_OF_DOMAIN. Excerpt occurrence counts: strength-result 24, hypertrophy-result 5, ACSM opening 1; một case có thể có nhiều excerpts. Corpus vẫn hẹp, không kết luận semantic recall từ các con số này.

Ignored snapshot local: `artifacts/ai-coach-dev/real-eval-final-ee768fc824c44bafb5a01ae7b9dd229b/experiment.json`. Mock-pipeline hash `0842e4c14df94ff7e0f77c68d66dac1f30c5afe97d234a7636a062941d7a04d0`; manifest ghi đúng parent commit và `workingTreeDirty=true` của lượt kiểm tra trước commit cuối. Đây là plumbing snapshot, không phải frozen real-model experiment hoặc independent benchmark.

Claude Code cần audit: approval/pricing/count preflight và ledger accounting; SDK CountTokens compatibility; parsing/redaction/persistence; request/label freeze + owner-private storage; arm-local allowlists và placebo token confounds; narrow-scope grounding/safety limitations; independent reviewer protocol. Không merge hoặc gọi Bedrock trong lượt bàn giao này.
