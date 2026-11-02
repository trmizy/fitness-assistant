# AI Coach — evaluation integrity hardening

> Follow-up tại [last P2 closure](ai-coach-last-p2-handoff.md) thay thế fallback legacy dựa vào receipt thiếu: contract hiện hành bắt buộc receipt; historical V1 cần trusted exact-hash policy riêng. Các kết quả dưới đây là lượt bàn giao ban đầu.

Ngày 2026-11-02. Baseline `e172d096`. Branch `feat/ai-coach-eval-integrity`, app-managed worktree `C:/Users/ASUS/.codex/worktrees/ai-coach-eval-integrity/fitness-assistant`. Không merge/cherry-pick vào worktree scientific review. Evidence: **CODE AUDIT / TEST FIXTURE**; không phải model evaluation hay scientific approval.

## Finding disposition

| Nhóm | Trạng thái trong phạm vi đã kiểm thử | Thay đổi |
| --- | --- | --- |
| Lifecycle / denominator | FIXED | Schema/analyzer kiểm tra tổ hợp lifecycle; generation failures không có gate decision hợp lệ. Gate processing failure được tính riêng, không mất khỏi failure accounting. Runner lưu generationStatus/postGate/lifecycle rõ ràng; parse/provider failure không bị tính thêm thành gate block. |
| Reviewer blinding | FIXED về artifact boundary | Reviewer nhận file riêng ở thư mục disjoint, UUID opaque và allowlisted body; không chia sẻ answer/schedule/preview/journal nội bộ. Recursive guard từ chối metadata/tên arm đã biết. Cùng case dùng chung reference pool cho các arm, tránh lộ RAG qua danh sách excerpt rỗng/đầy. |
| Redaction / hash | FIXED trong representation và patterns đã kiểm thử | Redact trước khi seal; hash kiểm tra canonical representation thực được lưu. Giữ original/stored hashes và changed flag trong internal receipts, không lưu original secret text. Redacted output giữ trong accounting và mang `REDACTED_NOT_SCORED`. |
| Consensus override | FIXED | Khi hai reviewer có cùng known label và adjudicator đổi label, bắt buộc `consensusOverride.reason` không rỗng. Audit giữ hai reviewer, labels, agreement, adjudicator, decision và override reason. |
| Missingness | FIXED cho các metrics hiện có | Báo theo từng metric và axis; phân biệt missing reviewer, null, NOT_EVALUATED, NOT_APPLICABLE, unresolved disagreement, redaction, failures, blocks và releases. Không đổi κ/bootstrap/paired comparison algorithms. |

“FIXED” ở đây nói về invariant kỹ thuật được fixture kiểm thử; không xác thực reviewer ngoài đời thực, không bảo đảm model reasoning hoặc chất lượng nghiên cứu.

## Reproduction trước / sau

Probe đã chạy bằng code baseline lấy từ Git `e172d096`, trong worktree riêng; chỉ dùng synthetic fixture rồi xóa các probe files do lượt này tạo:

| Probe | Baseline quan sát được | Sau sửa |
| --- | --- | --- |
| GENERATED + postGate FAILED | recorded=1, valid=1, failed=0, blocked=0, released=0 | recorded=1, valid=1, failed=1, generationFailed=0, postProcessingFailed=1; không là FN/TN/TP/FP |
| Packet chứa `api_key=FAKE_TEST_SECRET`, redact khi persist | `digest(stored.body) !== packetHash` | Synthetic API-key/email/token responses có packetHash/body, candidateHash và rawTextHash khớp persisted representation; analyzer nhận đủ ba outputs |
| FAILED + FAILED với truth=true / false | P2-1 đã loại khỏi confusion | Vẫn không tăng FN/TN; giữ failure counts và null metrics khi không có eligible samples |
| Adjudicator đổi known consensus true→false | Có thể thay đổi kết quả chỉ với rationale thông thường | Thiếu explicit override reason thì fail-closed; có reason thì áp dụng và lưu audit hai reviewer/decision |
| Reviewer export write failure sau inference | Raw journal là recovery source | Sealed internal answer/raw journal còn nguyên; resume hoàn tất export mà không lặp inference |
| Tampered reviewer export sau completion | Chưa có artifact riêng | Resume kiểm tra immutable answer receipts và reviewer export hashes, từ chối file đã đổi; không gọi provider thêm |

## Lifecycle contract

`ELIGIBLE` là tên wire hiện có cho candidate được release ở DEV, không phải scientific pass.

| Raw generation | postGate | Disposition |
| --- | --- | --- |
| GENERATED, candidate đúng schema | ELIGIBLE | validGenerated + released |
| GENERATED, candidate đúng schema | BLOCKED | validGenerated + blocked |
| GENERATED, candidate đúng schema | FAILED | validGenerated + postProcessingFailed + failed; loại khỏi gate confusion |
| FAILED | FAILED | generationFailed + failed; loại khỏi gate confusion |
| FAILED | BLOCKED / ELIGIBLE | Reject contract, không tự chuyển thành quyết định gate |
| GENERATED thiếu/sai candidate schema | Bất kỳ | Reject contract |
| Safety/out-of-domain routed trước generation | Không có output generation giả | Đếm routedBeforeGeneration; không gọi provider |

Với mọi input hợp lệ: `rawRecorded = failed + blockedValid + releasedValid`. `validGenerated` mô tả generation nên có thể chồng với postProcessingFailed. `scheduled` của offline analyzer vẫn là generation schedule; additive `totalPlanned = scheduled + routedBeforeGeneration`. `missingOutputs` vẫn được báo, không tạo response hoặc nhãn cho slot chưa có output. Coverage/retention giữ nguyên công thức, không trở thành correctness.

Runner giữ tên counters cũ để tương thích, thêm recordedOutputs/validGenerated/failed/redactedOutputs. `finishedOutputs` vẫn phản ánh inference attempts đã có kết quả; budget admission failures có thể được recorded mà chưa invoke, nên không dùng finishedOutputs thay cho recordedOutputs. Diagnostic verifier có thể báo candidate không hợp lệ là blocked, nhưng **postGate decision của generation failure luôn FAILED**.

## Reviewer-facing data

Mặc định, run ở `RUN` xuất internal files vào `RUN`, reviewer files vào sibling `RUN-reviewers/R1/<uuid>.json` và `R2/<uuid>.json`. Không để reviewerDirectory ở trong hoặc là parent của run directory. Không sao chép toàn bộ run cho reviewer.

Reviewer artifact `blind-review-v1` chỉ chứa opaqueId, packetHash, reviewerSlot và body question/facts/evidence/units. Owner mapping nằm trong internal answers. Reviewer reference pool là hợp các exact passages đã chuẩn bị cho cùng case, dedup theo source/excerpt ID và sắp xếp nhất quán; không thêm nguồn khoa học mới, không thay generation context và không gọi retrieval lần nữa. Một run chỉ chọn subset không có RAG có thể có pool rỗng cho tất cả arm; không suy ra đó là corpus coverage.

Internal packets pin export hash riêng cho R1/R2. Annotation mới phải gửi `reviewerExportHash` khớp reviewer slot. Dùng `verifyReviewerExport(artifact, pinnedHash)` để kiểm tra bản được giao. Validator tái tính cả hai export receipts từ sealed body, nên không thể chỉ đổi receipt map và annotation hash để qua kiểm tra. Completed resume kiểm tra internal file receipts và reviewer files đã seal; partial resume còn đối chiếu packet body với raw/case/reference pool đã pin trước khi xuất lại. Đổi metadata nội bộ thành file reviewer hoặc thêm nested treatment metadata/tên arm, kể cả qua object keys, bị strict/recursive guard từ chối.

Blinding này ngăn rò metadata qua artifacts. Reviewer vẫn có thể suy đoán treatment từ nội dung, citations hoặc cách diễn đạt của model; không tuyên bố statistical blinding hoàn hảo. Owner vẫn phải phân phối file đúng reviewer, xác nhận independence và giữ internal directory riêng tư. Filesystem/path checks không thay thế access control hoặc reviewer identity verification.

## Canonical redaction và giới hạn

`representation.ts` là điểm redaction chung, idempotent và CPU-only. Patterns gồm AWS-key-like text, Bearer tokens, các assignment/key names giống credential, email và JWT-like text. Tests chỉ dùng giá trị giả `.invalid` hoặc strings được tạo riêng.

Session ghi durable raw response đã sanitize cùng stored rawTextHash, original/stored hash receipts và changed flag. Parsed candidate được sanitize trước khi trả cho runner. Packet factory sanitize question/facts/evidence/candidate trước khi tính candidateHash/body/packetHash. Không redact lại sealed packet khi persist. Atomic storage tiếp tục ghi canonical JSON; corrupted/tampered content vẫn fail-closed.

Nếu sanitization làm mất candidate schema, session ghi parse failure `REDACTION_SCHEMA_CHANGED`. Nếu vẫn đúng schema nhưng nội dung bị thay, packet giữ `REDACTED_NOT_SCORED`; analyzer không dùng nó để tính semantic metrics, gate truth hoặc agreement của scientific analysis. Raw record, failure/coverage accounting và redacted counts vẫn còn. Không chấm bản đã thay như nguyên bản, không lưu secret plaintext để giữ hash cũ hợp lệ.

Redaction là pattern-based, **không phải một DLP bảo đảm phát hiện mọi secret/PII hoặc encoded payload**. Contract vẫn là synthetic evaluation data. Original hashes không cho phép phục hồi original response; không có encrypted raw archive được thêm vào. Hashes phát hiện thay đổi so với receipts đã giữ, không chứng minh scientific truth hoặc chống một người có thể sửa đồng thời toàn bộ artifact và trusted receipts.

## Adjudication, missingness và compatibility

`consensusOverride` là field optional thêm vào từng decision. Record cũ giữ consensus hoặc phân xử disagreement vẫn hợp lệ; record cũ **đổi known consensus** phải được owner/adjudicator bổ sung reason thật trước khi phân tích. Không tự điền reason hoặc scientific labels. Per-axis audit có reviewer pseudonyms/values, AGREED/DISAGREED/INCOMPLETE, adjudicator, decision, trust eligibility và override reason.

`missingness.byMetric` bao phủ unsupportedPersonalClaimRate, assessmentCorrectness, sourceSupport, appropriateAbstention, usefulness. Mỗi metric báo eligible/scored/unscored, missing annotations, null/NE/NA, unresolved disagreements, authority-unqualified, redacted, failed, blocked và released outputs. Các reason counts có thể chồng lấp; `eligibleOutputs = scoredOutputs + unscoredOutputs`. `byAxis` giữ expected judgements và các buckets disjoint: missing reviewer, null, NE, NA, present. Không coi thiếu nhãn là 0 lỗi.

Annotation cũ không có export receipt vẫn được hỗ trợ khi internal packet cũng là legacy; analyzer báo legacyPackets. Packet mới có receipt map bắt buộc annotation receipt đúng slot. Không tự sửa/hash lại các historical artifacts đã lệch hash. Legacy `FAILED+BLOCKED` hoặc `FAILED+ELIGIBLE` phải được chuyển sang **bản sao có migration record do owner kiểm tra**, giữ original decision/diagnostics và chỉ khai báo FAILED+FAILED khi đúng generation failure; không mutate dữ liệu frozen hoặc âm thầm normalize trong analyzer. Legacy packet thiếu representation metadata cần owner xác nhận provenance/redaction trước khi dùng làm dữ liệu thực.

Packet/raw/case mismatch hoặc tampering làm **cả analysis fail-closed** thay vì skip dòng và xuất metrics đẹp hơn. Durable records vẫn còn để owner audit/recover; không tự xóa offending output, hoàn ngân budget hoặc gọi lại model. Persistence/lock failures vẫn dừng runner theo cơ chế cũ.

## Verification và ranh giới bàn giao

Các lần chạy chỉ dùng **TEST FIXTURE** và fake transport. `run.ts` không được mở LIVE; cả CLI `--live`, LIVE config và môi trường opt-in vẫn bị khóa. Bedrock/model calls, embeddings và vector DB calls thực do lượt này tạo = **0**. Ollama local vẫn blocked theo yêu cầu owner; không khởi động Docker hoặc dịch vụ.

Scoped regression từ trạng thái trước chốt runner cuối: **31 files, 303 pass / 0 fail / 0 skip**. Scope: 12 `advisory-*.test.ts`, 15 `ai-coach*.test.ts`, bốn RAG suites bên dưới. Sau chốt runner, D2/runner/integrity chạy lại: **15 pass / 0 fail / 0 skip**. Sau chốt receipt validation: D1/annotation infrastructure/D3/integrity **36 pass / 0 fail / 0 skip**. Probe integration cuối cho partial-resume tampering: **5 pass / 0 fail / 0 skip**. `pnpm exec tsc --noEmit` sau source change cuối: **exit 0**. Các lần chạy chồng lấp, không cộng thành số tests độc lập. Không gọi đây là full repository regression.

```powershell
# cwd: backend/services/ai-service trong worktree riêng
$env:ADVISORY_V2_ARTIFACT_DIR='C:/D_Backup/project_personal/fitness-assistant/artifacts/ai-advisory-progress/bedrock-guarded-v2'
$advisory=@(rg --files src/__tests__ -g 'advisory-*.test.ts')
$coach=@(rg --files src/__tests__ -g 'ai-coach*.test.ts')
pnpm exec tsx --test @advisory @coach `
  src/__tests__/rag-retrieval-v2.test.ts `
  src/__tests__/rag-remediation-4-7r.test.ts `
  src/__tests__/rag-ood-safety-4-7r2.test.ts `
  src/__tests__/rag-safety-signals-4-7r3.test.ts
pnpm exec tsx --test src/__tests__/ai-coach-repeats-d2.test.ts `
  src/__tests__/ai-coach-pilot-runner.test.ts src/__tests__/ai-coach-evaluation-integrity.test.ts
pnpm exec tsc --noEmit
```

Frozen V2 artifacts khả dụng và integrity tests chạy không skip. Hash evidence-pack giữ `4251adb6c9aa0d88d54d6b69a88824b60e37ce33a74467b822bf042483e1b8ea`; results giữ `4f3f376ac81a93f645ba86a49a241f2d761e2bdf29388dcb44f79530e16c857a`. `git diff --exit-code e172d096` xác nhận không thay data/scientific sources, advisory grounding/frozen implementation, production routes/config, `statistics.ts` hoặc infra. Không chạy DB/schema/ingestion/migration/seed.

Không đọc/sửa owner held-out/reviewer decisions hoặc scientific-review-round1 files; các private files dùng trong tests đều do fixture tự tạo ở thư mục tạm. Không can thiệp audit export hay owner review ongoing. Dependencies dùng junction tới các thư mục node_modules đã cài, không chạy install hooks hoặc thay dependency manifest.

## Commits và review tiếp theo

1. `c7639082` — lifecycle/denominator/schema và P2-1 regression adaptation.
2. `2c3de75b` — reviewer export boundary, hashes và resume checks.
3. `a2005c14` — canonical redaction/hash và scoring disposition.
4. `b3a6e3af` — consensus override/audit và metric/axis missingness.
5. Commit chốt runner, receipt derivation, treatment-independent reference pool và tests/docs: hash báo cùng bàn giao cuối; xem `git log --oneline e172d096..HEAD`.

Changed paths chỉ thuộc `src/evaluation/{evaluation-kit,bedrock-pilot}`, ba scoped test files và tài liệu này, tương đối với AI-service trừ docs. Không đổi kiến trúc AI Coach, scientific claims, source approval, production behavior hoặc regex grounding.

Claude Code cần review đúng các invariant trên: lifecycle partition/P2-1, reference pool và absence of nested treatment leakage, stored representation/hash/resume receipts, R1/R2 export receipt binding, explicit consensus override và missingness denominators. Các P3/architecture findings không thuộc phạm vi và scientific review độc lập vẫn là known limitations, chưa tự coi đã đóng.

Sau khi owner kết thúc scientific review và Claude Code xác minh, owner có thể chọn cherry-pick các commit theo thứ tự từ branch này vào `feat/advisory-content-v3`, hoặc merge branch sau khi kiểm tra conflict. Chạy lại scoped commands trong target tree, đặc biệt source pins/hashes và reviewer protocol. **Không tự cherry-pick/merge**, không dùng fixture pass làm quyền chạy model thật hoặc scientific approval.
