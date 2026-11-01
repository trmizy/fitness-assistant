# AI Coach — architecture evaluation blockers handoff

> Historical handoff tại `d344a75a`; các finding và số liệu dưới đây thuộc lượt đó. Trạng thái hạ tầng hiện tại nằm ở [evaluation infrastructure D1–D3](ai-coach-evaluation-infrastructure-d1-d3.md).

Ngày 2026-11-01. Reviewed HEAD `2c4806b9`; branch `feat/advisory-content-v3`, worktree `fitness-assistant-worktrees/advisory-content-v3`. Evidence: **CODE AUDIT / TEST FIXTURE**. Không có model evaluation, REAL HTTP/API, REAL BROWSER hoặc BACKEND INTEGRATION.

## Finding disposition

| Finding | Trạng thái | Thay đổi / giới hạn |
| --- | --- | --- |
| P1-1 assessment grounding | FIXED trong deterministic scope | `outcome-support.ts` xác định loại outcome từ server facts, provenance/quality và question; attendance-only không chứng minh progress/no change. E1RM không chứng minh muscle size. Adapters khác e1RM và unknown-kind review tránh blanket block. Basis của model không phải authority. Tests có attendance, valid weight/direct-strength measurement, muscle mismatch, stale data, exercise/unit mismatch và mixed-scope regression. |
| P1-2 evaluation parity | FIXED cho protocol DEV | Bốn generation arms dùng cùng V3 contract, reference allowlists/checks, sampling/retry và metrics. MINIMAL/FULL áp dụng đồng nhất. Historical V2 tách riêng. Grounding dùng chính raw RAG candidate, không gọi generation, không tính blocked là correct. Không chấm mock accuracy. |
| P1-3 retrieval evaluability | FIXED trong DEV fixture scope | Reproduced missing muscle-size aliases, thêm aliases theo concept và e1RM; selection cấp excerpt, body/topic gate và exact registry identity; supplement tách synthetic distractors khỏi science; no-match/outage/ablation controls. Chưa xác nhận real vector retrieval, semantic relevance/entailment hoặc một corpus khoa học rộng được duyệt độc lập. |
| P2 safety | FIXED cho DEV dispatch boundary | Tách NO_MATCH/UNRESOLVED/OUT_OF_DOMAIN/SAFETY/UNAVAILABLE/DISABLED. Safety classification reuse code hiện tại, trả handoff và bỏ generation. Đây là DEV handoff disposition, không dispatch thật vào production route. |
| P2 authorship/citation | FIXED về representation/identity | Quotes, metadata và assistant-authored applicability/limitations tách thành field riêng. Source/excerpt ID hợp lệ không đặt semantic support thành true. Review packet giữ labels null. |
| P2 context/facts | FIXED trong đối chiếu được | Giữ owner facts, quality, direct log/derived estimate/unverified conversation distinctions. E1RM không thành direct 1RM; explicit structured exercise/unit mismatch bị chặn khi có dữ liệu đối chiếu. Không xác minh catalog hoặc account thật. |
| Independent data / scientific review | PENDING | Có 40 DEV inputs và protocol reviewer-owned 30–40 case; chưa có independent approval/labels hoặc unopened held-out content. Hai nguồn scientific vẫn là abstract lịch sử 2009/2017, chưa cập nhật/expert review. |

**Readiness: PREPARED_PENDING_INDEPENDENT_REVIEW.** Chưa tự đánh dấu `READY_FOR_CONTROLLED_MODEL_EVALUATION`: phải hoàn tất independent case/source review và xử lý finding cụ thể còn thiếu trước. Không có cơ sở tuyên bố model reasoning tốt hơn.

## Commits và changed files

Paths `src/` bên dưới tương đối với `backend/services/ai-service/`.

1. `2408fdf6` — grounding/assessment: thêm `src/evaluation/advisory-progress/outcome-support.ts`; sửa `content-aware-v3-facts.ts`, `content-aware-v3-schema.ts`, `content-aware-v3.ts`; thêm `advisory-assessment-support.test.ts`, cập nhật một assertion cũ từ FLAGGED sang BLOCKED cho weight-only muscle assessment theo P1-1 mới.
2. `85e16959` — evaluation parity: sửa `src/evaluation/ai-coach-dev/{pipeline,fixtures,evaluation,run}.ts` và `src/__tests__/ai-coach-dev.test.ts`.
3. `a64557f2` — retrieval/corpus/P2: sửa `src/llm/fitness-concepts.ts`, `src/evaluation/ai-coach-dev/{context,pipeline,retrieval,review,run}.ts`; thêm `ai-coach-dev-retrieval.test.ts` và `data/eval/ai-coach-dev/corpus-supplement.json`.
4. Tests/docs commit chứa report này: bổ sung protocol/40 DEV inputs, harness scenarios và coverage output, protocol tests/direct-strength control; cập nhật architecture/handoff docs. Hash cuối cùng báo trong bàn giao cùng `git log -4`.

Không đổi production routes, application flags, Bedrock configuration, DB/schema hoặc vector index; không merge. Shared concept matcher chỉ bổ sung aliases đã regression. Không thay V2 frozen source, evidence pack, outputs hoặc historical scores.

## Test evidence đã chạy

Scope cuối gồm 19 test files: 12 `advisory-*.test.ts`, ba `ai-coach-dev*.test.ts`, và bốn RAG files ghi rõ trong command dưới. Kết quả: **228 pass / 0 fail / 0 skip**. AI-service `pnpm exec tsc --noEmit`: **exit 0**. Đây là scoped regression, không phải full repository regression.

```powershell
# cwd: advisory-content-v3/backend/services/ai-service
$env:ADVISORY_V2_ARTIFACT_DIR='C:/D_Backup/project_personal/fitness-assistant/artifacts/ai-advisory-progress/bedrock-guarded-v2'
$advisoryTests=@(rg --files src/__tests__ -g 'advisory-*.test.ts')
$devTests=@(rg --files src/__tests__ -g 'ai-coach-dev*.test.ts')
pnpm exec tsx --test @advisoryTests @devTests `
  src/__tests__/rag-retrieval-v2.test.ts `
  src/__tests__/rag-remediation-4-7r.test.ts `
  src/__tests__/rag-ood-safety-4-7r2.test.ts `
  src/__tests__/rag-safety-signals-4-7r3.test.ts
pnpm exec tsc --noEmit
pnpm exec tsx src/evaluation/ai-coach-dev/run.ts --mock
```

Coverage includes: common reference checks for every arm; identical prompt policy/settings/allowlists per variant; same-raw-object grounding with zero extra provider calls; nullable unmeasured metrics; prompt injection kept in user data; explicit citation identity vs pending semantic support; paraphrase/excerpt scope/distractor rejection; safety before generation; source ablation and IO failure. Existing V3 R-A–R-D controls remain in the advisory regression.

Frozen byte/source/score integrity tests ran with the preserved local artifacts. Manual hashes and `git diff --exit-code 2c4806b9 -- <protected V2 files>` also confirmed unchanged:

- Evidence pack: `4251adb6c9aa0d88d54d6b69a88824b60e37ce33a74467b822bf042483e1b8ea`.
- Frozen V2 results: `4f3f376ac81a93f645ba86a49a241f2d761e2bdf29388dcb44f79530e16c857a`.

## Mock snapshot và retrieval coverage

Ignored local artifact: `artifacts/ai-coach-dev/blockers-final-b8bc5b1409f043ae84a3a671de67535f/experiment.json` trong worktree. Snapshot manifest pin implementation/cases/corpus/prompts/supplement/protocol và reused-code hashes. Implementation hash: `1debe1a71feed83d423d665023dde6bed3f3839c7a453d2ebc8d78eed1e09f32`. Không commit output này vào dataset hoặc sửa pin frozen V2.

- 40 implementer-authored DEV cases × 4 generation arms × 2 policies × 2 repeats = 640 scheduled slots.
- 32 slots được safety-route trước generation; thực tế **608 mock calls**.
- Model/LLM/Bedrock calls **0**; embedding calls **0**; vector DB calls **0**.
- RAG status coverage, mỗi case đếm một lần: **29 FOUND, 4 EMPTY_UNRESOLVED, 3 EMPTY_NO_MATCH, 1 UNAVAILABLE, 2 EMPTY_SAFETY, 1 EMPTY_OUT_OF_DOMAIN**.

FOUND là topic heuristic, không phải independently judged relevance hoặc support. Không gọi 29/40 là scientific recall/accuracy. Supplement có synthetic conflicts để thử loại nguồn giả, chưa phải một cặp nghiên cứu thật mâu thuẫn được curated. Case source ablation bỏ đúng excerpt khỏi fixture search, không thay allowlist hoặc bơm summary bù lại.

| Raw vs post-gate RAG | Count |
| --- | ---: |
| Scheduled RAG slots | 160 |
| Safety-routed trước generation | 8 |
| Raw generated | 152 |
| Raw common-contract eligible | 152 |
| Post-gate eligible | 148 |
| Blocked bởi V3 | 4 |

Gate chặn bốn bản lặp của unit-mismatch fixture. Coverage = 148/152 ≈ **97.37%**, chỉ là retention của mock. Raw correctness/post-gate correctness, semantic support, uncertainty appropriateness, usefulness, model tokens/latency/cost đều **null / NOT_EVALUATED**. Bốn blocked candidates không được tính là correct; raw responses và diagnostics vẫn còn để review.

## Known V3 limitations và review còn thiếu

Đã đối chiếu `v3-closure.md`, second-review report và các attachments đã cung cấp. Có mô tả R-A/R-D và tests cho bounded delta/directive invariants; không có reproduction mới cụ thể của phần “còn sót” trong yêu cầu hiện tại. Không tự mở rộng regex theo từng paraphrase hoặc tuyên bố phủ mọi cách diễn đạt.

R-E/R-F/R-G/R-H vẫn **DESCRIPTION_NOT_SUPPLIED / severity UNKNOWN / PENDING_CLASSIFICATION**; R-I ở report trước cũng chưa có mô tả. Những mã này không được tự gán sang finding khác hoặc tự phân loại P2 chỉ vì tên có trong task. Cần nội dung review thật để quyết định hard invariant nào bị vi phạm.

Deterministic V3 vẫn giới hạn ở adapters, structured assertions và bounded text checks. Numeric membership/reference identity không chứng minh attribution hoặc entailment. Unseen prose, mệnh lệnh ngầm, claim bị gán sai loại, multiple outcomes/exercises và future measurement kinds còn cần semantic review. No-rule-match/FLAGGED chỉ có nghĩa DEV review candidate; không phát scientific pass.

## Confounds và việc Claude Code cần review

- MINIMAL/FULL có chủ ý khác domain cues; phải so cùng policy variant trước khi quy kết tác động organization/context/RAG. Context annotations tự bổ sung missingness/provenance cues nên không phải một phép thử “chỉ format”.
- Flat legacy-policy V3 không byte-identical với V2. Historical V2 nằm ngoài controlled ablation, không so trực tiếp score cũ với mock mới.
- 40 DEV inputs, nguồn và template đều implementer-visible; chưa có independent labels/held-out split. Các fact flips là paired controls, không phải các mẫu độc lập thống kê.
- CPU lexical fixture không đánh giá real embedding/Qdrant/OpenSearch, model sampling, cost hoặc latency. Mock luôn abstain, nên retention không đo reasoning hay chất lượng tư vấn.
- Chưa có expert/current corpus review, real conflicting research pair hoặc validated claim entailment judge. Original quotes không làm assistant-authored applicability trở thành lời nguyên văn nghiên cứu.

Claude Code cần review outcome adapters/ambiguous scope; common-contract parity và absence of label leakage; exact excerpt ranking/authorship; no-source/error/safety dispatch; raw/post-gate denominator; và protocol independent annotation. Reviewer khác phải author/approve 30–40 case, sở hữu phần 10 case chưa mở, freeze labels rồi chấm mù các claims/conclusion/questions trước khi xin chạy model thật.

Không tích hợp production hoặc chạy Bedrock trong bàn giao này. Các phần được triển khai đã có scoped fixture evidence; độ đúng khoa học và khả năng suy luận của model chưa được đánh giá.
