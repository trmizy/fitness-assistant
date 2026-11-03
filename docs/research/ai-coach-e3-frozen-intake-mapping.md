# E3 frozen Case Intake → existing evaluation runner

2026-11-03. Branch `feat/advisory-content-v3`, base `49ab1ade`. Evidence: **CODE AUDIT / REAL HTTP/API / TEST FIXTURE**. Phần runner admission bên dưới cập nhật theo yêu cầu tiếp nối dùng D1 candidate `freeze-002`. Không independent scientific validation hoặc model-quality evaluation. Không có thao tác freeze, revision, owner decision, production hoặc LIVE do Codex thực hiện trong lượt này.

## Phase 1: trạng thái thật và provenance

Lần đọc đầu thấy EDITABLE. Snapshot revision 1 xuất hiện trước khi Phase 2 bắt đầu. Trong khi kiểm thử fixture, phát hiện các thay đổi đồng thời ngoài đường dẫn Codex sửa: dataset tạo revision 2 EDITABLE, một số case và mã Intake đổi. Codex dừng tích hợp working revision đó và đọc lại ở chế độ chỉ đọc; sau đó snapshot revision 2 đã xuất hiện. **Các số liệu chuẩn bên dưới thuộc revision 2**, được xác minh lại trước conversion. Không tự freeze hoặc tạo revision, không ghi đè thay đổi đồng thời, không dùng backup/report cũ làm live state. Read-only filesystem và `GET /api/freeze/preview` khớp canonical hash.

- Dataset `3b500d24-1b11-45ab-b619-47f1d6b3f873`, revision 2.
- Snapshot thật hiện tại `freeze-002-20261103T085746Z`, frozenAt `2026-11-03T08:57:46.010Z`, basedOnSnapshot `freeze-001-20261103T083346Z`.
- Canonical SHA256 `7087fd8e03b6f32c955c653ba63073a6f53cd43e17794a45506f72e8b255be11`.
- Manifest canonical-object hash `5956ef89e0a491ee1f19fde035457bef61a475837518c8df48c32ff8a1feb17b`; raw source-byte hashes ghi riêng trong private output. Không nhầm hash canonical object với hash raw manifest JSON.
- Snapshot revision 1 và output conversion cũ giữ nguyên, chỉ là historical: canonical hash `cf1ba70d4125b2933606a9f618a2c47033c9593b5265ad449e4b13a65505b171`. Không dùng nó thay revision 2.
- 20 primary cases / 20 case clusters; case keys, slots và cluster IDs duy nhất. 183 variants = 48 WORDING + 135 TRANSFER; tổng 203 câu hỏi, **không phải 203 mẫu độc lập**.
- Quota tám nhóm: progressive-overload 3; strength-e1rm 3; hypertrophy-volume 3; tempo-rir 2; recovery 2; missing-data 2; unsupported-personal-causality 2; evidence-mismatch-wrong-excerpt 3.
- 20/20 `ownerConfirmedAt` và content hashes hợp lệ; **20/20 vẫn `ownerReviewed=false`**, 20/20 `aiAssisted=true`, 20/20 `independenceAttested=false`, 20/20 synthetic. Không suy review=true từ confirmation.
- 19 case dùng AI seed; case 01 khai báo copied-from-draft/calibration và saw-model-output=true. Giữ nguyên exposure và authorship, không gọi independent held-out/gold.
- `expectedAssessment=null`: slot 02 (`case-progressive-overload-02`), 06 (`case-strength-e1rm-03`), 11 (`case-tempo-rir-02`), 13 (`case-recovery-02`). Intake parser và D1 schema cho phép null; label-readiness không yêu cầu điền assessment. Giữ nguyên null, không chấm assessment-match cho bốn case đó. Đây không phải adjudicated shouldBlock hoặc probability calibration.
- Các trường idealBehavior/safety/appropriateAbstention/corpusCoverage không null; label-readiness 20/20. Rubric và thresholds vẫn là tài liệu đề xuất, không dùng schema-valid để tuyên bố owner scientific approval.
- 91 dòng tập; tối đa 16/case. Tất cả có week, **không có session date** hoặc measured recordedAt. RIR null/NA ở 85 dòng, RPE và restSec null/NA ở 91 dòng. Chất lượng revision 2: 2 SUFFICIENT, 15 PARTIAL, 1 INSUFFICIENT_HISTORY, 1 STALE, 1 NO_DATA. Một case khai không có training data; giữ cả quality và availability theo nguồn. Các ghi chú mâu thuẫn ở case 03/06/15 không được biến thành authoritative facts.
- Current `canFreeze=false` vì state đã FROZEN; đây không phải mất confirmation. Không tạo snapshot thứ hai hoặc revision mới.

Manifest thật giữ canonical/per-case hashes, template hash, datasetShape/variant kinds, tách `ownerConfirmedInTool=20` với `ownerReviewedDeclared=0`, flags exposure, owner-only mode, independentHeldOut=false, goldLabels=false, runnerReleased=false và compatibility limitations. `EXPLORATORY_OWNER_REVIEWED` trong manifest/runner là **tên chế độ hiện có**, không được diễn giải thành khai báo review=true. Sidecar ghi rõ thực tế owner-confirmed, AI-assisted, review-declared=false.

## Mapping tối thiểu

Implementation: `backend/services/ai-service/src/evaluation/case-intake/{converter,run}.ts`. Chỉ bổ sung input contract FAKE vào `bedrock-pilot/pins.ts`; không tạo runner/analyzer/dashboard hoặc đổi gate/statistics.

| Nguồn | Mapping / boundary |
| --- | --- |
| Canonical/manifest/source hashes | Caller pins truyền riêng; xác minh whole canonical, 20 per-case hashes, confirmation content hashes, family/variant counts và review declaration. Tamper/duplicate/mismatch fail-closed. |
| Case/cluster | Primary giữ caseKey; DevRequest dùng dev-/synthetic- namespace. Cluster linkage và request hashes nằm private sidecar. REVIEWED_DEV trong legacy wire manifest chỉ là DEV split, không independent author attestation. Không tạo ReviewerCase với INDEPENDENT_REVIEWER. |
| Training rows | Mỗi row → descriptive TRAINING fact; giữ week/date/null/numeric values, ROM/technique/note và explicit missing fields. Không aggregate, tính e1RM, ước lượng outcome hoặc resolve contradiction. Thêm một availability/context fact, nên tối đa 19 row + 1 context fact; overflow/long value/unknown row field fail-closed, không truncate. |
| Thời gian | `snapshot.recordedAt` là **ownerConfirmedAt có thật của bản case**, không phải thời gian tập/đo/export/freeze. Các fact đều có `recordedAtMeaning=CASE_CONFIRMATION_CAPTURE_NOT_MEASUREMENT_TIME`; session.date giữ nguyên/null. Không tính tuổi dữ liệu từ timestamp capture. Quality/window giữ nguyên owner declaration. |
| Goal/personal context | Chỉ goal có field profile tương thích. Age, sex/sexRelevant, experience, schedule, conditionsNote **chưa vào generation**; giữ nguyên trong private source và liệt kê từng field trong compatibility. Không gán demographic thành TRAINING authority để lách schema, không sửa protected E1/E2 context schema. |
| Question/history | Primary question và các turn role/text được giữ trong request; subject namespace thống nhất. Không đưa thiết kế case/expected facts vào question. |
| WORDING/TRANSFER | Bảo toàn tất cả variants và raw metadata. `usesCaseLog=true` mới kế thừa profile/log; false nhận question của variant, goal=null, snapshots=[], conversation=[]. Các variant không kế thừa parent history theo intake preview contract. Facts có trong question giữ nguyên text; field variant.facts là expected/reviewer-only theo UI, không bơm vào model. |
| Reviewer-only | Labels, expectedAssessment, knowledge/expected facts, unsupported inferences, claim IDs/traps, rationale, reviewer notes, authorship/identity/exposure ở private sidecar. Mỗi leaf field của raw case có disposition trong compatibility; không silent-drop unknown top-level/private fields. |

Converter lưu nguyên canonical/manifest trong sidecar để không mất field chưa map; riêng generation chỉ allowlist DevRequest. Contract `released-intake-fake-input-v1`, scope `OWNER_CONFIRMED_EXPLORATORY_FAKE_ONLY`, không dùng literal legacy OWNER_REVIEWED để mô tả khai báo false. Input này bắt buộc claim registry, CLAIM_MAP_V3, OWNER_ONLY_EXPLORATORY và FAKE; không tự fallback legacy corpus hoặc TWO_RATER. Receipt hash ở generation là **offline FAKE conversion receipt**, không owner-issued model release, signature hoặc spend authorization. Runner phải nhận `sources.intakeSidecarFile`: kiểm tra hash và tái đối chiếu canonical/source/candidate/cluster/request ngay tại load admission; sidecar bytes được pin vào corpus để kiểm tra lại trước dispatch/resume. Rehash một cluster sai trong sidecar không làm nó trở thành hợp lệ. Không đưa sidecar vào generation prompt.

## Runner admission của D1 candidate freeze-002

Đã đọc và kiểm tra read-only candidate thật tại `e3-case-intake-data/d1-candidate/freeze-002-20261103T085746Z`. Không chỉ dựa trên `d1-validation.json` hoặc schema sao chép:

- `DevRequestSchema` import **trực tiếp từ source V3 hiện tại**: **203 valid / 0 invalid**.
- Candidate manifest canonical-object hash: `b2e79b5fae459bc0d9e5a16bd6909780615723b81609cea0a4758125a8a9e5d3`.
- Requests canonical/byte hash: `e5b6036cb96ee0ffcb9c68413a3a3b5ca8dff5a8dafd7b1964ca171a63df07e4`.
- Private annotations canonical/byte hash: `9fea1831360f4b694d64ab83b24ba14714667757fc2789df7c0e692c09e5a4c3`.
- Source snapshot ID/hash/frozenAt, 20 primary/183 variant counts, wrapper requestRef/caseKey/clusterId/kind/variantId và cả annotations phải khớp frozen canonical. Request đúng schema nhưng trỏ cluster khác, chèn reviewer text vào question, stale version hoặc gán lại owner-reviewed đều bị từ chối.
- TRANSFER labels giữ null, không kế thừa primary expected labels. Những nhãn/facts riêng của variant giữ private; không chuyển thành generation facts do reviewer cung cấp.

`candidate.ts` xác minh candidate rồi reconcile từ immutable canonical sang official projection đã mô tả ở bảng mapping. Không sửa candidate gốc. Candidate dùng freeze-time capture convention, official projection dùng ownerConfirmedAt capture thật; cả hai đều **không** phải measurement dates. Candidate mất availability/reason khi không có row; official thêm context fact, nên 91 training-row facts → **111 facts = 91 rows + 20 context facts**. Raw empty strings và row order giữ theo canonical; fact IDs được map lại, original IDs/source/candidate documents giữ nguyên trong private provenance. Không tính thêm fitness outcome.

CLI converter nhận thêm optional candidate directory và trusted candidate manifest hash. Có candidate thì mới xuất `candidateAdmission` receipt vào private sidecar; generation không nhận candidate documents/labels. File entry mới và field `intakeSidecarFile` chỉ bổ sung cho scope intake FAKE; contract cũ không bị tự chuyển phiên bản. `admission.ts` thực thi binding tại hạ tầng runner cũ. Không đổi D1 independent-author schema hoặc thuật toán D3.

Private output chính thức: `artifacts/ai-coach-e3-admission/2026-11-03/admitted-private/{generation/cases.fake.json,private/sidecar.json,private/source-byte-hashes.json,summary.json}`. Đây là input offline FAKE, không phải owner-issued release sang model thật. Các output `converted-owner-r2/` ở bước trước không có candidate admission chỉ còn là bằng chứng conversion trước đó.

Các file implementation/tests của bàn giao: `evaluation/case-intake/{converter,candidate,admission,run}.ts`, sửa tối thiểu `evaluation/bedrock-pilot/{config,pins}.ts`; tests `ai-coach-intake-{converter,admission}.test.ts`, `fixtures/intake.ts`; cùng tài liệu này. Không stage data, private snapshot/sidecar/journals, owner decisions, Dashboard/E3A changes đang có từ trước.

## Kiểm thử admission cuối và FAKE trên input thật

CLI thực tế kiểm tra frozen source → candidate → official inputs; existing E2 runner nhận 20 primary, hai arms, một repeat; variants không xếp lịch. Trên profile offline FAKE riêng: **40 scheduled / 40 finished / 0 failed / 40 BLOCKED / 0 released**; **40 R1 receipts/full-envelope identities verified**, 0 R2 exports, 0 variant calls. Không dùng expected labels để viết scripted answers, không nới gate. Dummy output thiếu personal observations nên bị chặn; blocked không được tính là correct. Model quality **NOT_MEASURED**, scientificPass/rawCorrectness/postGateCorrectness đều null. Counter ghi 33 unique prompt-count calls được cache cho 40 slots; không phải 33 case độc lập. Không có model/embedding/vector request thật.

Regression: 15 existing suites có **146 pass / 0 fail / 0 skip**. Hai suite intake cuối có **14 pass / 0 fail / 0 skip / 0 cancelled** trên code cuối, gồm kiểm tra lại 40 fixture answers, 20 sourced claimLinks answers, identity/grounding/R1 receipts và các negative controls. Tổng **160 test khác nhau thuộc 17 file**, chạy theo scope existing và final intake riêng; không gọi là một lượt full repository regression. Hai assertion lỗi ở fixture (không có positive retrieval và chặn nhầm excerpt authorship) được sửa chỉ trong tests, không đổi product retrieval/blinding. Không cộng reruns thành test mới hoặc nói initial combined log không có lỗi. TypeScript sau sửa assertion cuối **exit 0**.

Log mới: `artifacts/ai-coach-e3-admission/2026-11-03/{regression,tsc,actual-fake}.log`. Private config/journals/result ở cùng thư mục ignored, không commit.

Final pass log: `final-intake-verified.log` (14/14); TypeScript `tsc-closeout.log` (exit 0). Các initial failing test logs vẫn được giữ riêng, không sửa scores/log bytes. Final protected baseline: **87 file không đổi**, gồm snapshot/candidate/owner decisions/Intake source; Frozen V2/source hashes không đổi. Chỉ commit chọn lọc 10 implementation/test/doc paths đã liệt kê. Source facts/labels, issued ledger/trust hoặc private journals không vào Git; không merge.

Lượt đầu dùng lại cap 12.000 của preset trước đã **dừng đúng ở token preflight**, 0 inference/answer files: một prompt RAG được CPU fake counter ước tính 12.508. Không sửa nội dung owner, corpus selection, gate hoặc preset đó; journal thất bại giữ tại `actual-fake-run/`. Một probe bỏ metadata lặp cũng không đủ, nên không áp dụng thay đổi đó vào converter.

Bài kiểm tra nối dữ liệu sau đó dùng **profile offline FAKE riêng**: 40 slots, input tối đa 13.000/call, tổng 520.000, output tối đa 81.920, giá/usage đều fixture, không approval hay LIVE opt-in. Đây không phải phát hành budget warmup hoặc nới budget thật của owner; không cập nhật decision store. Native CountTokens/model access và khả năng chạy dưới cap warmup 12.000 vẫn NOT_VERIFIED/BLOCKED. Fake byte-based tokens không phải token count của Haiku. Log mới là `offline-integration.log`, kết quả riêng `offline-integration-result.json` và `offline-integration-run/`.

Lượt regression combined đầu có một lỗi fixture: câu hỏi tổng hợp không retrieve được nguồn nên assertion yêu cầu nonempty claimLinks không thể pass. Chỉ đổi câu hỏi fixture sang tình huống progressive overload đã có positive retrieval control; không sửa retriever/gate/claims nguồn. Assertion privacy sau đó chặn nhầm `originalExcerpts[].authorship=ORIGINAL_SCIENTIFIC_EXCERPT`, vốn là field hợp lệ; sửa assertion để cấm owner flags/labels/case identity, không bỏ tag provenance khoa học. Retrospective check của run hoàn tất xác nhận **40 receipts**, **20 sourced answers**, **80 scientific excerpt tags**, **0 owner-label leaks**. Suite cuối kiểm lại toàn bộ luồng sourced principle → excerpt/claimLinks → full candidate identity/receipts, bên cạnh các negative controls.

## Chuẩn bị runner và giới hạn thí nghiệm

Private local outputs revision 2 (ignored, không commit): `artifacts/ai-coach-e3-intake/2026-11-03/converted-owner-r2/{generation/cases.fake.json,private/sidecar.json,private/source-byte-hashes.json,summary.json}`. Summary validation: `converted-owner-r2-validation.json`. Output `converted-owner/` là revision 1 historical. Phase 1 summary/protected manifest revision 2 ở worktree eval-integrity dưới `artifacts/e3-prefreeze/2026-11-03/current-r2/`. Không sao chép đè owner exports/snapshot hoặc source pins.

20 primary và 183 archived variant requests đều qua DevRequest validation. Preparation thực tế dùng current E1 registry config, existing E2 adapter: **40 prepared slots, 0 safety-routed, 0 variant calls**, hai arm × một repeat, **0 inference calls trên dữ liệu owner**. Hai arm giữ nguyên facts/policy; RAG dùng tối đa hai approved claims như adapter hiện có. Max user-prompt UTF8 size 43,168 bytes; không coi đó là token count hoặc bằng chứng budget đủ. Không auto nhân 183 variants × arms × repeats, không tự phát hành main experiment.

## Bằng chứng conversion trước runner-candidate admission (historical)

- Converter suite trên code cuối: **9 pass / 0 fail / 0 skip / 0 cancelled**, gồm 40 inference attempts FAKE trên 20 primary **synthetic fixture** × hai arms × một repeat; 40 answer files, 0 parse/provider failures, full E2 envelope/claimLinks và R1 receipt verification. Không tạo R2 exports. Không dùng nhãn owner làm scripted answers. Raw/post-gate diagnostics và failure accounting dùng hạ tầng cũ. Scripted empty-claim responses không đo model quality; scientificPass=null.
- Scoped existing regression: **146 pass / 0 fail / 0 skip / 0 cancelled**, 15 file. Chạy trước khi bổ sung các điều kiện admission riêng của input intake mới; các điều kiện đó được suite 9 tests kiểm lại trên code cuối. Scope: annotation-d1, annotation-infrastructure, evaluation-integrity, offline-analysis-d3, pilot-pins, pilot-runner, pilot-hardening, repeats-d2, secret-redaction, claim-correctness, claim-dev, scientific-claim-map-v3, advisory-frozen-v2-integrity, bedrock-provider và bedrock-cross-account. Tổng 155 test khác nhau thuộc 16 file; không gọi đây là full repository regression hoặc cộng reruns thành test mới.
- AI-service `pnpm exec tsc --noEmit`: **exit 0** trên code cuối. Frozen V2 integrity không skip; evidence pack vẫn SHA256 `4251adb6c9aa0d88d54d6b69a88824b60e37ce33a74467b822bf042483e1b8ea`, frozen results `4f3f376ac81a93f645ba86a49a241f2d761e2bdf29388dcb44f79530e16c857a`.
- Actual revision 2 offline validation: 20 primary + 183 variant requests đều schema-valid, sidecar hash khớp; 135 usesCaseLog=false không có parent snapshots/goal/history. Prepared 40 slots, routed 0, model/embedding/vector calls **0**. Không inference actual owner dataset trong lượt này.
- Protected baseline mới sau revision 2: **83 file không đổi** tại lần đối chiếu, gồm cả hai snapshot, dataset/cases, prep, Intake source và decision stores. Không tuyên bố baseline revision 1 toàn bộ giữ nguyên: đã ghi nhận thay đổi đồng thời ở dataset/working cases/source UI trước khi chụp baseline revision 2. Codex chỉ ghi code converter/tests/docs và local output riêng; không ghi đường dẫn owner/protected.
- Diff đối chiếu base cho advisory-progress, evaluation-kit/statistics, scientific registry, frozen V2, routes và Bedrock application client: không sửa. Bước conversion ban đầu chưa commit; final runner-admission closeout cho phép commit chọn lọc implementation/tests/docs sau checks, hash được báo trong bàn giao. Private data vẫn ngoài Git, không merge production.

Logs local ignored: `artifacts/ai-coach-e3-intake/2026-11-03/{final-converter-admission,regression,tsc}.log`. Converter suite cuối thực sự chạy đủ chín test dù command có name pattern, như log ghi nhận.

Chạy lại trong `backend/services/ai-service`:

```powershell
pnpm exec tsx --test src/__tests__/ai-coach-intake-converter.test.ts
# Existing scoped regression: 15 files liệt kê ở trên; Frozen V2 cần ADVISORY_V2_ARTIFACT_DIR trỏ local frozen artifacts.
pnpm exec tsc --noEmit
```

## Các phần chưa được giải quyết

- Unmapped personal fields nêu trên có thể ảnh hưởng usefulness/personal applicability. Phải báo đúng phạm vi context cho reviewer; không tuyên bố đã kiểm tra model trên đầy đủ personal context Intake. Việc mở rộng profile contract cần phạm vi riêng, không lén thêm ở converter.
- D1 independent sealed-case admission và formal D3 analysis chưa chấp nhận tác giả owner/AI-assisted review=false. Sidecar là compatibility representation trung thực; không chế ReviewerCase độc lập, reviewer thứ hai, κ hoặc independent CI. Case labels không phải unit annotations hoặc shouldBlock labels; raw answers vẫn cần all-text human review sau model thật.
- Schema-valid/confirmation/hash identity không xác nhận scientific support, factual correctness của owner notes, synthetic content không chứa PII, hoặc semantic entailment. Không dùng conversion để cải thiện historical scores.
- Frozen proposal pack còn có decision status lịch sử; không ghi đè bằng dashboard hoặc coi đó là current LIVE authorization. Chủ đích synthetic-only không thay account/privacy review.
- LIVE tiếp tục bị khóa. Exact model/profile CountTokens compatibility, account IAM/access/quotas, verified official pricing, residency/logging, clean pinned checkout và trust/signature/durable issued ledger vẫn cần bằng chứng/authority thật trước model execution. Không tạo chúng trong công việc này.

Không sửa Frozen V2, Scientific Claim Map V3, owner decisions, Dashboard 4787, DB, embedding hoặc vector stores. Không gọi Bedrock/Ollama/AWS inference. Không merge production hoặc commit dữ liệu riêng tư.

**Closeout: E3_FROZEN_DATASET_FAKE_READY.** Trạng thái này chỉ xác nhận mapping/admission và plumbing FAKE đã kiểm tra. LIVE vẫn khóa; profile 13.000 chỉ dành cho offline test, không thay cap warmup 12.000 hoặc tạo authority thật. Config/journals local pin implementation trước commit; lần chạy mới sau commit phải recompute code/commit/config pins bằng cơ chế hiện có, không sửa pin để resume một journal cũ. Dừng phát triển data adapter sau bàn giao.
