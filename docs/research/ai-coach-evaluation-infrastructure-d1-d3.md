# AI Coach — evaluation infrastructure D1–D3

Ngày 2026-11-02. Base `b0e563a6`, branch `feat/advisory-content-v3`, worktree `fitness-assistant-worktrees/advisory-content-v3`. Evidence: **CODE AUDIT / TEST FIXTURE**.

**IMPLEMENTED_PENDING_INDEPENDENT_CODE_REVIEW; REVIEWER_DEPENDENCY_PENDING.** Chưa có scientific approval, independent held-out labels hoặc model evaluation. Không gán `EVALUATION_APPROVED`, không merge và không mở LIVE.

## Finding disposition

| Dependency | Trạng thái kỹ thuật | Phạm vi / giới hạn |
| --- | --- | --- |
| D-1 annotation schema | FIXED | Hai trục mới, rationale và references được lưu/kiểm tra strict. Migration additive: thiếu trục mới = NOT_EVALUATED; không sửa nhãn cũ hoặc suy support từ citation. Reviewer vẫn phải hiệu chỉnh rubric. |
| D-2 repeated evaluation | FIXED cho FAKE-only runner | Design pin arms/policies/repeats; attempt identity gồm case/arm/policy/repeat/config/prompt. Cùng repeat không gọi lại; ngân sách/approval/lock không reset sau restart. Chưa chạy sampling model thật. |
| D-3 offline analysis | FIXED cho arithmetic + authority boundary | Metrics, paired case comparisons, case-cluster percentile bootstrap, Cohen κ và adjudicated gate confusion đã có tests synthetic. Không có independent annotations thật để báo effectiveness/κ/CI nghiên cứu. |

## Commits và changed files

Paths `src/` dưới đây tương đối với `backend/services/ai-service/`.

1. `63d7540a` — giữ riêng draft preparation: `docs/research/ai-coach-independent-evaluation-preparation.md`, năm JSON trong `data/eval/ai-coach-eval-prep/`. Đã đọc nội dung, kiểm tra JSON/credential patterns và held-out chỉ có quota, không có nội dung. Không coi scan là bảo đảm nhận diện mọi PII. Bộ này vẫn DRAFT/PENDING_APPROVAL.
2. `48039607` — D-1: `src/evaluation/evaluation-kit/annotations.ts`, `src/__tests__/ai-coach-annotation-d1.test.ts`.
3. `7804cb07` — D-2: `bedrock-pilot/{design,config,prepare,pins,runner}.ts`, repeated-run tests, fixture input/OS crash child.
4. `31d02bbd` — D-3: `evaluation-kit/{statistics,offline-analysis}.ts`, shared `annotationUnits`/manifest schema, runner schedule output, offline-analysis tests.
5. Tests/protocol/docs commit chứa report này: thêm raw/post denominator probes và split/fixture telemetry boundaries; cập nhật reviewer rubric, held-out protocol, metadata tests và historical banners. Hash cuối trong `git log -5` và phản hồi bàn giao.

Không sửa source science bytes/registry/claim map/supplement, frozen V2 answers/scores, production route/provider/config/flags hoặc DB/index. `evidence-inventory.json` giữ bytes từ preparation commit; mọi scientific decision và owner identity vẫn null/PENDING. Không stage secrets, private labels thực hoặc runtime artifacts.

## D-1 — additive annotation contract

`AnnotationSchema.units[]` thêm:

- `personalApplicability`: SUPPORTED / PARTIAL / UNSUPPORTED / NOT_APPLICABLE / NOT_EVALUATED.
- `unsupportedCausalInference`: NONE / PERSONAL_CAUSE_ASSERTED / GROUP_TO_INDIVIDUAL / STRENGTH_TO_HYPERTROPHY / ATTENDANCE_TO_OUTCOME / OTHER / NOT_APPLICABLE / NOT_EVALUATED.
- `references`: unitIds, factIds, sourceIds, excerptIds; rationale per unit vẫn bắt buộc.

`validateAnnotation` kiểm tra full unit coverage và references có trong packet. References hợp lệ chỉ xác nhận identity, không gán scientific support. Adjudication nhận hai trục mới và kiểm tra decision đúng enum của axis. Unknown fields vẫn bị từ chối, kể cả `scientificPass` tự chèn.

Records cũ không bị rewrite. Khi parse, hai field thiếu mặc định NOT_EVALUATED, references thiếu mặc định empty. Explicit NA được giữ và khác chưa chấm. Rubric cũ APPROPRIATE/OVERAPPLIED của applicability đổi sang SUPPORTED/UNSUPPORTED trong draft v2; đây là thay vocabulary cho tương lai, không tự migration một nhãn độc lập đã có. Old core example vẫn giữ nguyên và parse được.

`unsupportedPersonalClaim` vẫn là judgement explicit của reviewer, không tự derive từ source ID hoặc vài label. Rubric decomposition cần owner calibration; NOTEVALUATED/NA không được coi là causal error. Legacy `reviewerAgreement` giữ κ=null để tương thích; D-3 tính per-axis κ riêng khi đủ input.

## D-2 — repeat identity và budget

Config thêm optional `design={repeats,arms,policies}`: repeats integer 1…50; arms chỉ chọn trong sáu arm hiện có; policies MINIMAL/FULL; không trùng phần tử. Không truyền design giữ default một repeat, MINIMAL, đủ sáu arm. Không thêm free-text arm.

`prepareReleasedPilot` tạo row với repeatIndex zero-based, request/prompt hashes và verification context. Prompt/provider payload không nhận repeat metadata, gold labels hoặc config/arm identity. Cùng input/policy giữa repeats dùng cùng prompt bytes; repeats là attempt khác nhau, không giả định provider deterministic.

`attemptIdentity` hash caseKey + arm + policy + repeatIndex + configHash + promptHash. `configHash` bao phủ design, budgets/settings và pins. Đổi repeat/policy/arm phải repin, thay config hash và không dùng lại approval cũ. Không đưa provider seed; sampler seed của bootstrap chỉ tái lập số học phân tích.

Preview tính mọi planned repeat trong call/token/cost ceilings; CountTokens cache theo unique prompt hash còn ledger cộng budget cho từng inference reservation. Scheduled attempts được lưu ở `schedule.json`, gồm metadata cần join offline. Kết quả `answer-*` có case/arm/policy/repeat ngoài blind packets. Resume kiểm tra schedule, dùng cùng approval/ledger, không khởi tạo ngân sách mới. Attempt reserved mà thiếu final row yêu cầu owner audit; orphan lock sau crash không tự xóa. Code version/pins thay đổi không thể resume artifact cũ bằng cách bỏ qua approval.

Fixture đã kiểm 2 case × 2 arm × 3 repeat = 12 attempts; dừng sau ba completions rồi resume vẫn tổng 12. Policy MINIMAL+FULL dựng 24 planned prompt rows trong fixture. Duplicate repeat bị chặn; budget không đủ bị preview từ chối. Crash child giữ reservation và lock. Đây là plumbing/scheduling, không phải repeated model evaluation.

## D-3 — provider-independent analysis

Entry: `evaluation/evaluation-kit/offline-analysis.ts:analyzeOffline(input)`. Pure in-memory module; không gọi provider, embedding hoặc vector DB. Owner đọc private files ngoài workspace và truyền dữ liệu ở bước phân tích; không đưa nhãn vào runner/generation.

Input `offline-evaluation-v1`:

| Thành phần | Contract |
| --- | --- |
| purpose/configHash | TEST_FIXTURE hoặc INDEPENDENT_ANALYSIS; một frozen config cho toàn schedule |
| cases | Manifest + sealed request/labels/salt + authority; đối chiếu request/label/author hashes. Không export lại labels trong report. |
| schedule | attemptKey/caseKey/arm/policy/repeat/configHash/promptHash; key phải tính lại khớp. Không pool REVIEWED_DEV với HELD_OUT. |
| outputs | Raw candidate/text/status/mode/usage/latency/estimated cost; post-gate decision/scopes; exact reviewer packet |
| annotations | R1/R2 pseudonyms, authority, units/rationale/references/usefulness; validate packet hash, facts/question/units và candidate identity |
| adjudications | Third reviewer + unique per-unit/axis decisions, explicit nullable shouldBlock; giữ judgement gốc |

Từ runner artifacts: `schedule.json` là schedule; `answer.raw.parsedCandidate/rawText` vào raw candidate/text, parse/provider failures thành FAILED; `answer.verification` cung cấp post-gate diagnostics, packet lấy `answer.packets.reviewers[0]`. Khi generation FAILED không được coi là eligible. Mode phải lấy từ run manifest; owner giữ bảng mapping và provenance, không tự đổi FAKE thành LIVE. Private case labels chỉ join ở analysis.

Analyzer từ chối changed frozen labels, unknown/duplicate attempt/packet/reviewer, packet/raw/question/fact mismatch, invalid adjudication units, adjudicator trùng rater/author. Pseudonyms/REVIEWER_ATTESTED không tự xác thực con người; owner phải xác minh independence/identity và run provenance qua kênh riêng. Hash không thay scientific approval hoặc chống một người dùng hai pseudonym.

### Metric và mẫu số

- Unsupported personal claim rate: true / personal units có boolean judgement final; OBSERVATION/PERSONAL_HYPOTHESIS/MEASUREMENT_LIMITATION/CONCLUSION; không dùng general principles/questions làm mẫu số PE1.
- Assessment correctness: match expectedAssessment đã freeze có authority, chỉ khi đủ paired annotations; label null thì metric null. Đây chỉ đo assessment enum, không coi toàn bộ câu trả lời đúng.
- Source support: SUPPORTED / {SUPPORTED, PARTIAL, UNSUPPORTED} do reviewer chấm, gồm unquoted research claims nếu reviewer nhận diện. NA/NE không thành support; PARTIAL không được nửa điểm tự động.
- Appropriate abstention: conclusion APPROPRIATE trên các case cần abstain và có label đánh giá được; NA/NE giữ missing. Usefulness là trung bình các final judgement 1–5.
- Gate sensitivity/specificity/precision: từ explicit adjudicated shouldBlock, không suy truth từ validator hoặc từ thiếu nhãn. Có breakdown structured/narrow heuristic với cùng adjudicated overall-error denominator; không diễn giải thành từng heuristic đã đúng khoa học.
- Raw recorded/responded/valid/failed, released/blocked, missing scheduled outputs và routed slots được báo riêng. Coverage = released valid / raw responses; attempt retention = released valid / recorded attempts. Blocked không được tính correct hoặc tự loại khỏi raw quality. Post-gate quality chỉ trên released valid, kèm mẫu số/coverage.

Đơn vị không có final judgement bị loại khỏi mẫu số metric tương ứng và được ghi missing, không tính zero errors. Hai rater bất đồng phải có adjudication đúng axis mới dùng judgement cuối; original labels và unresolved disagreements vẫn giữ. Metric authority không dựa vào việc claim có citation.

### Paired statistics và agreement

Trong mỗi case/arm/policy, cộng numerator/denominator qua các repeats đã được chấm rồi tính tỷ số cell. So hai arm trong cùng case/policy, mỗi case trọng số bằng nhau; chỉ complete pairs có dữ liệu. Không pool policies hoặc dùng repeats/claims như các case độc lập. Case-level clustering giả định các case độc lập: fact-flip variants hoặc case chung người/nguồn có thể vi phạm, cần owner xử lý trong pre-registration; code chưa có family/multi-level cluster model.

`pairedClusterBootstrap` resample case indices có hoàn lại, giữ cặp cùng nhau, lấy percentile 95% của mean paired differences, default 10,000 resamples. Sampler seed/algorithm được ghi để audit thống kê, không phải seed model. High-level report không xuất CI cho FAKE/TEST_FIXTURE; independent analysis có ít hơn 20 paired cases chỉ có descriptive estimate, CI=null. Ngưỡng 20 là guard theo protocol, không bảo đảm power/coverage. Missing pairs/degenerate distributions được nêu; không p-value hoặc kết luận tương đương.

Tham chiếu cơ chế paired/percentile resampling: [SciPy bootstrap documentation](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.bootstrap.html). Code này là implementation TS riêng, không chạy SciPy và không gọi nó là BCa. Percentile intervals có giới hạn finite sample; mixed-effects sensitivity model, Holm-adjusted p-values và power analysis trong draft plan chưa triển khai/không được giả vờ hoàn thành.

Cohen κ danh nghĩa từng axis từ raw paired rater labels trước adjudication; usefulness dùng quadratic-weighted κ trên thứ tự 1…5. NA là category đã chấm để giữ disagreement về applicability; NE/null không phải category, bị loại và đếm missing. Empty hoặc degenerate marginals trả κ=null, không 1. Agreement không có CI, không coi các claim/repeat là independent observations cho inferential claims. Công thức/weighting đối chiếu [scikit-learn Cohen kappa documentation](https://scikit-learn.org/stable/modules/generated/sklearn.metrics.cohen_kappa_score.html).

### Authority boundary

Semantics chỉ có khi purpose INDEPENDENT_ANALYSIS, raw mode LIVE, frozen case authority REVIEWER_ATTESTED và hai rater đủ authority/khác author. Gate truth còn cần third-reviewer adjudication. Chưa có data đó thì semantics=null/status NOT_EVALUATED. TEST_FIXTURE có nhánh `fixtureCalculations` gắn nhãn MATH_ONLY_NOT_MODEL_EVALUATION để kiểm phép tính; không có paired CI hoặc scientific pass. Kể cả fixture khai mode LIVE cũng không được công bố token/cost measurements thật khi purpose TEST_FIXTURE.

Telemetry model chỉ tổng hợp raw mode LIVE trong independent-analysis input; thiếu usage/cost giữ null và báo missing/observed counts. FAKE latency/tokens/prices không thành model measurements. Estimated USD không phải hoá đơn AWS. Không có phép đo model effectiveness, actual costs, real reviewer κ hoặc real CI mới trong lượt này.

## Protocol và external dependencies

30 candidate sketches vẫn AI-authored draft, chỉ thành reviewer-approved sau substantive review. Tối thiểu 20 independent held-out cases cho khám phá; mục tiêu 35+ tùy pilot/power/precision analysis, chưa có nguồn lực reviewer: **REVIEWER_DEPENDENCY_PENDING**. Ten quota examples và 40 legacy null templates không đủ số lượng mới; không tạo thêm nội dung/nhãn để lấp quota. Target 50/65 tổng trong protocol chỉ là 30 draft + held-out minimum/precision target, không phải số case độc lập đã có.

Reviewer sở hữu sealed labels và content ngoài AI-accessible workspace. Held-out không được tune prompt/retrieval trước chấm; release/pre-registration/identity/ACL vẫn do owner quản lý. Scientific source review/corpus 15–20 nguồn, genuinely unrelated excerpt control và genuine conflicting sources vẫn pending.

Sáu arm đều dùng structured output, nên không isolate structured analysis. So prompt năm tầng chủ yếu đo layout/organization và phần context khác nhau. Không thêm free-text arm hoặc tuyên bố cơ chế reasoning/safety tốt hơn. Mock outputs không đo intelligence; effectiveness, token/latency/cost thật chỉ đo sau evaluation được phê duyệt. D-4 LIVE runner và D-5 được reviewer ghi riêng vẫn ngoài nhiệm vụ này; không coi D1–D3 là đã giải quyết hai mục đó.

## Verification và handoff

**TEST FIXTURE:** scoped regression có **313 pass / 0 fail / 0 skip trong 32 file**. Scope: 12 advisory files, 14 ai-coach files, bốn RAG files và hai Bedrock SDK/STS fixture suites. `pnpm exec tsc --noEmit`: **exit 0**. Không phải full repository regression, REAL HTTP/API, REAL BROWSER hoặc model evaluation. Existing SDK calls là fake, Qdrant HTTP stub không phải vector DB thật.

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
```

Các tests mới: D-1 valid/unsupported/causal/NA/backward-compatible/strict/reference checks; D-2 deterministic identity, 12-attempt partial resume, duplicates, actual child crash, budget và pin/config mismatch; D-3 hand-calculated nominal/quadratic κ, percentile bootstrap trên synthetic case clusters, missing/NA/degenerate labels, gate confusion, raw/post/missing-output denominators và rejection của tampered labels/packets/reviewers. Các số học fixture không được coi là independent model performance.

Các thống kê nghiên cứu **chưa đo**: unsupported personal claim rate thực, assessment correctness thực, source support, abstention, usefulness, gate sensitivity/specificity/precision theo nhãn độc lập, reviewer agreement/κ, paired-effect estimate/CI, actual token/latency/cost. Chúng giữ null/NOT_EVALUATED khi thiếu input có thẩm quyền; không báo accuracy/p-value/CI nghiên cứu từ mock oracle.

**Model/Bedrock calls thật = 0; embedding calls thật = 0; vector DB calls thật = 0.** CLI/runner vẫn FAKE_ONLY và negative LIVE/env tests còn chạy trong scoped suite. Source bytes, frozen answers và historical score integrity được kiểm với preserved local V2 artifacts. Manual SHA256: pack `4251adb6c9aa0d88d54d6b69a88824b60e37ce33a74467b822bf042483e1b8ea`; frozen results `4f3f376ac81a93f645ba86a49a241f2d761e2bdf29388dcb44f79530e16c857a`. Protected V2 source, production client/routes/config, registry/claim-map/supplement diff bằng 0 so với `b0e563a6`.

Claude Code cần review độc lập: additive schema/migration và references; repeat/config identity cùng ledger/no-retry behavior; schedule/raw/post/packet joins; authoritative-label gating và missingness; aggregation qua repeats rồi case; kappa categories/weights/degeneracy và percentile bootstrap assumptions; raw/post denominators, scope-level gate estimands và protocol minimum/target. Đây là technical code review, không thay scientific hoặc independent annotation review.
