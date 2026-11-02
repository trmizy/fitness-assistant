# Eval integrity — reviewer receipt downgrade closure

Ngày 2026-11-02. Branch `feat/ai-coach-eval-integrity`; reviewed base `f0ab66c0`. Evidence **CODE AUDIT / TEST FIXTURE**, không phải đánh giá model hoặc scientific approval. Không merge/cherry-pick.

## Reproduction và bản vá P2

Probe trên HEAD trước sửa: packet có receipt hợp lệ được nhận với rawRecorded=1; sau khi chỉ xóa `reviewerExportHashes`, analyzer vẫn nhận rawRecorded=1 và tăng legacyPackets=1. Root cause: cả `validateAnnotation` và legacy counter đều dùng sự hiện diện của receipt map làm điều kiện kiểm tra; khi chưa có annotation, không có bước validation receipt độc lập.

Sau sửa:

- Factory seal `body.contract = reviewer-packet-v2` vào packetHash, tự tạo đầy đủ receipts R1/R2. Runner dùng kết quả factory thay vì tự gắn receipt sau đó.
- `validatePacketContract` chạy cho **mọi output**, kể cả chưa có annotations. Current contract bắt buộc có đúng hai receipts, được tái tính từ sealed body. Xóa, sửa, thiếu slot đều fail-closed. Annotation còn phải trỏ đúng receipt của reviewer slot.
- Packet kiểu reviewed `f0ab66c0` chưa có contract marker nhưng có representation version `redacted-canonical-v1` vẫn thuộc **receipt-required** contract; thiếu marker không biến nó thành legacy.
- Legacy V1 thật có đúng historical body shape `candidateHash,evidence,facts,instanceId,question,units`, không có receipt/representation. Chỉ nhận khi **exact packetHash** nằm trong `legacyV1PacketHashes` do trusted caller cung cấp qua options riêng, ngoài untrusted input/artifact JSON. Đây là explicit V1 policy; không suy ra legacy chỉ từ field bị thiếu.
- Tự gắn `reviewer-packet-v1`, xóa version/representation rồi rehash, hoặc thêm hash của packet V2 vào legacy pins đều không miễn kiểm tra receipt V2. Chỉ người kiểm soát trusted legacy policy mới có thể quyết định pin một historical specimen; không tự tạo pins từ incoming packets.
- Report ghi số receiptV2/legacyV1 và hash của trusted legacy policy. Invalid packet làm cả analysis lỗi, không skip dòng hoặc phát partial quality metrics. Lifecycle/failure counters, κ/bootstrap và paired comparisons không đổi.

Compatibility: annotations hiện hành gửi `reviewerExportHash` theo slot; các D1/D3 fixture helpers được cập nhật tương ứng. Legacy annotations không có receipt tiếp tục được nhận khi packet V1 đúng shape/hash và trusted caller đã pin từ nguồn lịch sử độc lập. Không tự reseal/migrate historical files hoặc sửa reviewer decisions.

P2 verification trước commit: D1, annotation infrastructure, D3/P2-1 và integrity suites: **38 pass / 0 fail / 0 skip**; TypeScript **exit 0**. Full scoped regression và redaction follow-up được ghi ở phần bàn giao cuối.

## Secret-pattern assessment

Probe bằng synthetic strings trên `f0ab66c0` xác nhận cả năm mẫu có thể lọt qua câu rationale vào reviewer artifact: `aws_secret_access_key=`, `token=`, Basic Authorization, `sk-`, `ghp_`. Object key có chữ secret đã được mask, nhưng điều đó không bảo vệ cùng chuỗi nằm trong prose. Vì vậy cần bản vá redaction riêng, không mở dự án DLP.

Giới hạn không đổi: patterns không phát hiện được mọi secret/PII/encoding; hash không phải authentication. Legacy pins phải do owner quản lý bên ngoài incoming artifact. Reviewer independence/scientific labels vẫn thuộc owner. CLI giữ FAKE_ONLY, không có quyền LIVE mới; không gọi Bedrock/Ollama/embedding/vector DB và không gỡ Ollama block.

## Bản vá redaction riêng

`representation.ts` bổ sung assignment names `aws_secret_access_key`/`secret_access_key`/`token`, object token keys, Basic credentials, `sk-` và `ghp_`. Basic chỉ được mask khi phần base64 giải mã có dấu phân cách credential `:`, tránh làm mất câu bình thường như “Basic training principles”. Token accounting fields như inputTokens/outputTokens/token_count được giữ nguyên. Đây vẫn là patterns hữu hạn, không phải DLP hoặc cam kết phát hiện mọi secret.

Factory/session tiếp tục sanitize trước khi seal. Direct export/verification của một artifact đã seal nhưng còn mẫu cần redaction sẽ lỗi `ReviewerExportRequiresRedactionReseal`; không phát plaintext và không tự sửa bytes/hash lịch sử. Owner phải tạo bản mới qua đường sanitize/seal rõ ràng nếu muốn dùng lại; redacted content vẫn `REDACTED_NOT_SCORED`.

Sáu synthetic tests: năm mẫu qua question/facts/excerpts/candidate và direct sealed export; một fake transport test qua journal/internal answer/reviewer export/resume. Đều xác nhận không giữ fake secret plaintext, stored hashes khớp, idempotency và không lặp inference khi resume. Không dùng credential hoặc thông tin cá nhân thật. Focused result: **6 pass / 0 fail / 0 skip**, TypeScript **exit 0**.

## Phạm vi regression và bằng chứng

Lượt cuối trên source đã chốt: **34 test files / 340 pass / 0 fail / 0 skip**: 12 advisory suites, 16 ai-coach suites, hai Bedrock provider/cross-account suites và bốn RAG suites. TypeScript **exit 0**. Sau direct-export guard, fixture tamper được đổi sang prefix để tiếp tục kiểm tra raw/case mismatch thay vì nối chữ vào redaction marker rồi bị guard chặn sớm; không nới invariant. Focused integrity/redaction rerun **11 pass / 0 fail / 0 skip** và full scoped rerun **340/0/0**. Các lượt chồng lấp không cộng thành tổng tests độc lập. Đây là scoped evaluation regression, không phải full monorepo regression, REAL HTTP/API hoặc model evaluation.

```powershell
# cwd: backend/services/ai-service trên feat/ai-coach-eval-integrity
$env:ADVISORY_V2_ARTIFACT_DIR='C:/D_Backup/project_personal/fitness-assistant/artifacts/ai-advisory-progress/bedrock-guarded-v2'
$advisory=@(rg --files src/__tests__ -g 'advisory-*.test.ts')
$coach=@(rg --files src/__tests__ -g 'ai-coach*.test.ts')
pnpm exec tsx --test @advisory @coach `
  src/__tests__/bedrock-provider.test.ts src/__tests__/bedrock-cross-account.test.ts `
  src/__tests__/rag-retrieval-v2.test.ts src/__tests__/rag-remediation-4-7r.test.ts `
  src/__tests__/rag-ood-safety-4-7r2.test.ts src/__tests__/rag-safety-signals-4-7r3.test.ts
pnpm exec tsc --noEmit
```

Frozen V2 hiện có và integrity tests không skip. Evidence pack SHA256 giữ `4251adb6c9aa0d88d54d6b69a88824b60e37ce33a74467b822bf042483e1b8ea`; frozen results giữ `4f3f376ac81a93f645ba86a49a241f2d761e2bdf29388dcb44f79530e16c857a`. `git diff --exit-code f0ab66c0 -- data .../advisory-progress .../statistics.ts .../routes .../llm infra` xác nhận các protected paths không đổi. Không đọc/chỉnh scientific-review-round1 hoặc private held-out decisions.

## File và dòng thay đổi chính

Các đường `src/` tương đối với `backend/services/ai-service`:

| File | Điểm thay đổi |
| --- | --- |
| `src/evaluation/evaluation-kit/annotations.ts:60` | Prepare sealed body; marker tại dòng 70, factory receipts tại 76 |
| `src/evaluation/evaluation-kit/annotations.ts:88` | Explicit trusted V1 policy/contract validation; annotation admission tại 128 |
| `src/evaluation/evaluation-kit/offline-analysis.ts:48` | Policy options; validate mọi output tại 74; explicit counter tại 94; policy hash report tại 180 |
| `src/evaluation/bedrock-pilot/runner.ts` | Bỏ phần tự gắn receipt, dùng contract/receipts do factory tạo |
| `src/evaluation/evaluation-kit/representation.ts:3` | Các secret patterns và token-key handling |
| `src/evaluation/evaluation-kit/reviewer-export.ts:26` | Fail-closed khi direct export cần redaction; verification guard tại 31 |
| `src/__tests__/ai-coach-offline-analysis-d3.test.ts` | Valid/deleted/tampered/incomplete receipts, no-annotation/mixed inputs, trusted legacy và forged legacy |
| `src/__tests__/ai-coach-annotation-d1.test.ts`, `ai-coach-annotation-infrastructure.test.ts`, `ai-coach-evaluation-integrity.test.ts` | Fixture annotations gửi receipt đúng slot; strict factory được kiểm thử ngay khi tạo packet |
| `src/__tests__/ai-coach-secret-redaction.test.ts` | Sáu synthetic tests cho exposure/persistence/hash/resume |

## Review và tích hợp

P2 commit: `a9fd41c0`. Redaction có commit riêng tiếp theo (xem `git log --oneline f0ab66c0..HEAD`); chỉ gồm patterns, direct-export guard, synthetic tests/fixture adjustment và tài liệu này. Không tạo scientific approval hoặc nới LIVE.

Review đúng contract admission trước annotations, packetHash-bound version, derived R1/R2 receipts, explicit historical V1 pins và việc invalid input không bị skip. Chỉ tích hợp sau Claude Code xác minh; không yêu cầu mở lại toàn bộ kiến trúc. Không đụng scientific review, corpus hoặc frozen V2.
