# Content-aware V3 — bàn giao implementation

Ngày 2026-11-01. Trạng thái: đã triển khai experiment offline và kiểm tra trong
phạm vi nêu dưới đây. **Chưa có independent scientific validation.** Không có
Bedrock calls, inference ablation, production integration, deployment hoặc merge.

## Git và worktree

- Commit A, baseline V2: `ea98576d48ed97a1964bfae1f48b1a9af9197288`, branch `baseline/advisory-progress-v2`.
- Commit B, semantic design: `820f21cf3c854d6393b7f1ba0738ef2ed83d5619`.
- Commit C, V3 implementation: `6c9b39d72689e0d0180deeec50a524134a1ed700`.
- Commit D chứa tests và bản bàn giao này; lấy hash bằng `git log -1 --format=%H feat/advisory-content-v3` sau khi commit.
- Branch V3: `feat/advisory-content-v3`.
- Worktree: `C:/D_Backup/project_personal/fitness-assistant-worktrees/advisory-content-v3`.

Baseline chụp 24 file evaluation/data/test cần thiết, gồm helper advisory-baseline
được bốn test baseline sử dụng. Không đưa thay đổi production đang dở vào commit.
Git index tạm được dùng để giữ nguyên index và branch aws-deploy của worktree gốc.
Một `.gitattributes` cục bộ giữ bản review người dùng nguyên byte; không sửa nội
dung hay whitespace của tài liệu gốc. Runtime `artifacts/` không được force-add.

## Changed files của V3 so với baseline

Trong `backend/services/ai-service/src/evaluation/advisory-progress/`:

| File | Vai trò |
| --- | --- |
| `content-aware-v3-schema.ts` | Contract riêng, năm claim types, structured confirmation và metric assertion |
| `content-aware-v3.ts` | ContentGate, invariants, screen mọi trường text, adapter review V2 |
| `content-aware-v3-repair.ts` | Prompt V3, hard-error feedback, callback repair tối đa một lượt |
| `source-ablation-v3.ts` | Parse protocol/map, resolve excerpt, tạo input ablation và synthetic dependencies |
| `frozen-v2-integrity.ts` | Kiểm tra bytes/hash/candidates/history, xử lý artifact unavailable |
| `prepare-content-v3.ts` | CLI offline; không có tùy chọn live hay provider import |
| `CONTENT_AWARE_V3.md` | Lệnh chạy, giới hạn và yêu cầu dependencies cho worktree mới |

Trong `backend/services/ai-service/src/__tests__/`:

- `advisory-content-v3.fixtures.ts` — dữ liệu cá nhân tổng hợp, không DB.
- `advisory-content-v3.test.ts` — 25 tests.
- `advisory-content-v3-repair.test.ts` — 8 tests, chỉ callback mock.
- `advisory-source-ablation-v3.test.ts` — 9 tests, không inference.
- `advisory-frozen-v2-integrity.test.ts` — 6 tests, gồm 3 tests cần artifact thật.

Trong `data/eval/advisory-progress-dev/`:

- `README.md` — liên kết V3 và phạm vi offline.
- `reviews/content-aware-v3-design.md` — semantic design và known limitations.
- `reviews/frozen-v2-integrity.json` — metadata pin, không chứa raw runtime artifacts.
- `reviews/content-aware-v3-handoff.md` — báo cáo này.

## Validation đã triển khai

`OBSERVATION` cần fact; `GENERAL_PRINCIPLE` cần source và không có personal fact
references; `MEASUREMENT_LIMITATION` không bị ép thành hypothesis hoặc phải có
needsConfirmation. `PERSONAL_HYPOTHESIS` cần facts, sources, confirmation=true
và câu hỏi missingToConfirm. Invariant chỉ kiểm tra cấu trúc; sự liên quan thực
chất vẫn cần review. Mọi personal hypothesis hợp lệ về cấu trúc vẫn được FLAG
để review entailment.

`PERSONAL_RECOMMENDATION` có trong enum để biểu diễn lỗi model nhưng luôn bị
treatment policy BLOCKED. Citation và confirmation không miễn kiểm tra. Non-null
action, trường mutation ngoài schema, reference không tồn tại/sai namespace,
input identity trùng/colliding đều bị chặn. Metric assertions được đối chiếu đúng
fact đã dẫn; giá trị sai, mô tả structured e1RM thành direct 1RM hoặc assessment
mâu thuẫn với referenced estimated-strength metric đều bị chặn deterministically.
Không tính lại e1RM, calories hay quyết định thích nghi của service nghiệp vụ.

Screen V2 được tái sử dụng qua adapter; các pattern V3 bổ sung xử lý một số
paraphrase Việt có dấu/không dấu và English đã có fixtures. Rationale, claim text,
missing questions và confirmation questions đều được screen. Trích dẫn/câu hỏi/
ngữ cảnh population-level được nhận diện thì hạ xuống soft review. Các dấu hiệu
causality, e1RM→hypertrophy, unknown→unchanged, estimated→measured, key mismatch
và câu không phải câu hỏi là soft flags; không coi chúng là classifier khoa học.

ContentGate: BLOCKED > FLAGGED_FOR_REVIEW > NO_RULE_MATCH_NOT_CONTENT_PASS.
Không có boolean contentPass; originalContractPass được giữ riêng. Repair chỉ
được kích hoạt bởi hard findings/schema errors, tối đa một callback; soft flags
không kích hoạt. Feedback chứa path/code, không chứa gold/case-specific expected
answer. KEEP không ghi đè hard findings; REVISE phải đi qua toàn bộ schema/gate.
UNCERTAIN, malformed response, callback error hay revision còn lỗi đều unresolved.

## Kiểm tra đã thực sự chạy

**TEST FIXTURE — scoped required regression:** 76 pass, 0 fail, 0 skip, 0 cancelled.
Bao gồm 28 tests thuộc bốn file baseline và 48 tests V3. Không phải full repository
regression, BACKEND INTEGRATION, REAL HTTP/API hoặc REAL BROWSER.

Từ `backend/services/ai-service` trong worktree V3:

```powershell
$env:ADVISORY_V2_ARTIFACT_DIR = 'C:/D_Backup/project_personal/fitness-assistant/artifacts/ai-advisory-progress/bedrock-guarded-v2'
pnpm exec tsx --test src/__tests__/advisory-baseline.test.ts src/__tests__/advisory-progress.test.ts src/__tests__/advisory-progress-guarded.test.ts src/__tests__/advisory-content-review.test.ts src/__tests__/advisory-content-v3.test.ts src/__tests__/advisory-content-v3-repair.test.ts src/__tests__/advisory-source-ablation-v3.test.ts src/__tests__/advisory-frozen-v2-integrity.test.ts
pnpm exec tsc --noEmit
pnpm exec tsx src/evaluation/advisory-progress/prepare-content-v3.ts --artifact-dir=C:/D_Backup/project_personal/fitness-assistant/artifacts/ai-advisory-progress/bedrock-guarded-v2
pnpm exec tsx src/evaluation/advisory-progress/prepare-content-v3.ts
```

TypeScript: exit 0. Có build shared package trước khi compile trên worktree mới;
dependencies cài bằng offline frozen lockfile, ignore scripts. Không sửa dependency
manifest/lockfile. Pattern scan trước commit không phát hiện token/private key/
credential assignment trong các file được stage; đây không phải security audit đầy đủ.

CLI có artifact: INTEGRITY_CONFIRMED, đọc đủ 24 rows. CLI mặc định trong worktree
không chứa runtime artifacts: ARTIFACT_UNAVAILABLE, 0 rows, không báo pass giả.
Sáu excerpt ablations và năm synthetic tasks chỉ được chuẩn bị trong bộ nhớ;
modelGroundingUnderAblation=NOT_RUN, modelCalls=0. Nếu không cung cấp biến artifact
khi chạy test ở checkout khác, ba tests artifact báo skip rõ lý do; lần chạy nêu
trên đã cung cấp thư mục và không có skip.

**CODE AUDIT — local frozen artifacts:** bốn raw artifact files, source pack,
bốn frozen code files, request/scenario hashes, 24 candidate hashes và historical
scores khớp metadata pin. Results SHA-256 vẫn là
`4f3f376ac81a93f645ba86a49a241f2d761e2bdf29388dcb44f79530e16c857a`.
V2 prompt/validator/evidence pack không đổi. Diff V3 không có production files;
search production sources không thấy import experiment. Chưa chạy production E2E
hay toàn bộ production regression; không suy ra chứng nhận production từ đây.

## Findings khi đọc lại V2

Screen V3: 1 BLOCKED (`no-external-evidence:D`, lời khuyên “không cần đổi lịch”
trong rationale dù action=null), 12 FLAGGED_FOR_REVIEW, 11 NO_RULE_MATCH_NOT_CONTENT_PASS.
Historical contractPass vẫn true cho cả 24 rows. Số liệu này không phải accuracy
và không thay thế content annotations trước đó.

Review assistant trước đó ghi 8 answers có unsupported personal application,
14 hypothesis blocks cần phân loại lại, 1 unsupported advice và 1 unknown-as-unchanged.
Các nhóm có thể chồng lấp và khác granularity với screen. Không gán lại claimType
V3 cho V2 bằng heuristic, không sửa finalCandidates hoặc tính lại điểm lịch sử.

## Known false positives/false negatives và phần chưa tự động chứng minh

- Tests cố ý giữ một paraphrase khuyên tiếp tục phương án hiện tại mà pattern
  không phát hiện, và một general claim sai có citation hợp lệ nhưng không bị
  rule nào bắt. Kết quả no-match của chúng không phải content approval.
- Các quote/condition/negation phức tạp, punctuation khác và directive ngầm có
  thể tạo false positives hoặc negatives. Bộ nhận diện quote/ngữ cảnh chỉ hẹp;
  chưa được đo precision/recall trên bộ độc lập.
- Text-only numbers chưa được kiểm tra unit-aware attribution; deterministic
  contradiction checking hiện tập trung metricAssertion và structured basis.
- Key/question matching chỉ có vài quy tắc cụ thể; không chứng minh rằng câu
  hỏi thực sự cần thiết hoặc đủ để xác nhận causal link.
- Source ID tồn tại và excerpt dependency graph hợp lệ không chứng minh text
  được excerpt entail, nguyên nhân cá nhân có cơ sở, hay nguồn đủ hiện hành.
- Ablation đã loại excerpt cùng dependent finding và bỏ summaries có thể leak
  nội dung; chưa quan sát một model nào phản ứng với các input đó.
- Tất cả thiết kế, code, fixtures, text rules và integrity pin V3 chưa được
  independent review. Review từ người dùng chưa xác minh credentials/independence;
  không dùng nó làm scientific gold. Không có rollout authorization từ test này.

Claude Code có thể review branch/worktree nêu trên, đặc biệt severity của text
patterns và phạm vi structured assertions, trước khi đề xuất một thí nghiệm
inference mới. Không tự merge hoặc bật production flags trong lần bàn giao này.
