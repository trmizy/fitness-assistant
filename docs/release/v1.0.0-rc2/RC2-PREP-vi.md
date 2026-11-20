# Gymini V1 RC2 — chuẩn bị (chỉ lưu local; CHƯA tạo tag, CHƯA deploy) — 2026-11-12

| Mục | Giá trị |
|---|---|
| RC1 source | `3cab8b216fae9e5f9fffb19ce535fcb7c4f5d58d` (tag `v1.0.0-rc1`, giữ nguyên) |
| Sau RC1 trên aws-deploy | `e703b714` (workflow preflight, không đổi runtime) |
| **RC2 source = hotfix trên aws-deploy** | **`4cde78f7d1d26347fe0de1d8787f0217e81b42ab`** (cherry-pick -x của `5c56ebce`; ai-service tree `86c300f3` trùng hotfix đã test) |
| CI build | run `43248171960` (DEV Build #42), success, chỉ `build (ai)` |
| Artifact | `lambda-ai-4cde78f7…`, hết hạn 2026-12-12; digest GitHub (gói bọc ngoài) sha256:70ab8ffb… |
| **ZIP Lambda sha256 (manifest CI)** | **`c0efa8b9edbebf5ae88de11d586b0e6c2ee8628aea04f241cc0bb57532560dc9`**, 37.533.784 bytes |
| CodeSha256 kỳ vọng sau deploy | `wO+oue2+v1rojeEdWGsObC7oYorqBPJBzAu1dTJWDck=` |
| Đang chạy trên dev (RC1) | CodeSha256 `uMo2Vr1bV5DF7k9ZXH7jWp1qsaqi8zCv9Jd4BuNOCds=` (sha256 b8ca3656…), deploy run 43227752415 |
| Rollback về RC1 (đã xác minh) | `s3://fitness-assistant-deployments-dev-191798898985/ci-artifacts/ai/3cab8b216fae9e5f9fffb19ce535fcb7c4f5d58d/b8ca3656bd5b5790c5ee4f595c7ee35a9d6ab1aaa2f330aff4977806e34e09db.zip` hoặc dev-deploy build_run_id=43217789667 services=ai |
| Rollback xa hơn (trước RC1) | ci-artifacts/ai/a54bf4d8…/9054622f….zip (build 42614561317) |
| Lambda cần cập nhật | fitness-assistant-dev-ai, fitness-assistant-dev-ai-jobs, fitness-assistant-dev-ai-worker |

Thay đổi so với RC1 (runtime): chỉ `safety_guard.ts` + `orchestrator.service.ts` (phân loại an toàn không phụ thuộc dấu; vị thành niên). Không migration, không đổi API.

## Các bước (mỗi bước cần chủ dự án duyệt)
1. Preflight (chỉ đọc): "DEV Read-only Preflight", aws-deploy, services=ai → cả 3 hàm phải còn `uMo2Vr1b…OCds=` (RC1).
2. Dry-run: "DEV Application Deploy (Lambda code)", build_run_id=**43248171960**, services=ai, dry_run=true → bước verify hash pass.
3. Deploy thật: cùng input, dry_run=false, reviewer duyệt.
4. Preflight lại: cả 3 hàm `wO+oue2+v1rojeEdWGsObC7oYorqBPJBzAu1dTJWDck=`, khoá S3 ci-artifacts/ai/4cde78f7…/c0efa8b9edbebf5ae88de11d586b0e6c2ee8628aea04f241cc0bb57532560dc9.zip, re-hash MATCH.
5. Tag `v1.0.0-rc2` (annotated) trên `4cde78f7` — chỉ khi được duyệt riêng.
6. (Tuỳ chọn, cần duyệt chi phí) smoke an toàn: "giảm 10kg trong 1 tuần" có dấu phải nhận hướng dẫn an toàn.

## Việc sau (không làm bây giờ)
- V2 (`feature/ai-v2-agent` @ 8d53a712): đồng bộ lên bản V1 có hotfix (rebase lên 4cde78f7 hoặc tag rc2) SAU khi RC2 đã phát hành và xác minh; khi đó phần bỏ dấu trong agent-v2/answer-guards.ts trở thành dư (vô hại).
- Mobile: bước rút ngắn đường dẫn (D:/.rn*) cần ổ D: — chỉ cần cho build Android native.

## Kết quả deploy dev (2026-11-12, ~16:12Z)
- Pre-deploy preflight 43253901459: PASS (3 hàm RC1 uMo2Vr1b…, rollback RC1 rehash MATCH).
- Dry-run 43255220778: PASS (verify hash ✓, mọi bước AWS skipped).
- Deploy 43255856018 (dry_run=false, build 43248171960): verify ✓, OIDC ✓, identity ✓, Deploy services ✓ (45 s), **Smoke /health FAIL**, scheduler unchanged ✓ → run = failure.
- Trạng thái thực (đọc trực tiếp, profile gymini-admin, account 191798898985): cả 3 hàm CodeSha256 wO+oue2+v1rojeEdWGsObC7oYorqBPJBzAu1dTJWDck= (= ZIP c0efa8b9… RC2), Active/Successful, LastModified 16:12:19 / 16:12:30 / 16:12:41Z → không deploy dở dang.
- Nguyên nhân smoke fail (log CloudWatch): cold start 16:12:51Z, Status: timeout sau 30 000 ms, Max Memory Used 100 MB → kẹt ở bước lấy secret DB (ensureDatabaseUrlConfigured) trước khi app được nạp. Hạ tầng dev đang TẮT: Aurora stopped, không VPC endpoint (Secrets Manager), không NAT. Không phải lỗi code RC2; RC1 cũng sẽ fail giống vậy trong trạng thái này.
- S3: RC2 ci-artifacts/ai/4cde78f7…/c0efa8b9….zip (37 533 784 B) và rollback RC1 ci-artifacts/ai/3cab8b21…/b8ca3656….zip (37 532 988 B) đều tồn tại.
- Chưa rollback (deploy code thành công, cả 3 hàm nhất quán; rollback cũng sẽ fail smoke vì cùng nguyên nhân).
