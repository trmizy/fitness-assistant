# RC1 → AWS dev: hướng dẫn deploy (chủ dự án bấm; Claude Code không có quyền kích hoạt workflow)

Kiểm tra trước deploy (2026-11-12, sau preflight 13:17Z):
- Artifact lambda-ai-3cab8b21… của build 43217789667 còn tới 2026-12-12; hash ZIP so với manifest đã PASS ở dry-run 43223942042.
- Không có dev-deploy/preflight/chat/infra run nào đang chạy; sau preflight không có deploy nào.
- Baseline (preflight 43225808184): cả 3 hàm Active/Successful, CodeSha256 kFRiL623…NG6I= = ZIP a54bf4d8 trong S3 (đã tải về và hash lại).
- dev-deploy (dry_run=false) làm: OIDC → identity gate → chụp scheduler (chỉ đọc) → ghi CodeSha256 cũ → s3 cp ZIP RC1 → update-function-code
  lần lượt ai → ai-jobs → ai-worker (wait function-updated-v2 sau mỗi hàm) → smoke → kiểm scheduler không đổi.
  KHÔNG có migration, không đụng Aurora/EventBridge/IAM, chỉ service ai.
- Phạm vi code: a54bf4d8 → 3cab8b21 = 218 commit, 98 file ai-service/shared (không chỉ 4 commit RC1). Không có migration ai-service.
  Endpoint chéo service mà code mới gọi (/internal/exercises/muscle-profiles của fitness, /inbody của user) đã có ở các bản cũ đang chạy.

RỦI RO ĐÃ BIẾT — bước Smoke: invoke fitness-assistant-dev-ai GET /health (không gọi Bedrock/LLM, không ghi gì). Khi cold start,
Lambda lấy DATABASE_URL từ Secrets Manager và kiểm tra vector store. Nếu backend/VPC endpoint đang tắt (auto-stop 10/11 = STOPPED),
lời gọi có thể treo tới timeout → SMOKE_FAIL → workflow ĐỎ, nhưng cả 3 hàm ĐÃ được cập nhật (smoke chạy sau khi cập nhật xong) — đó
là "code deployed, smoke pending", không phải deploy dở dang. Không bật backend để chữa việc này nếu chưa duyệt riêng.

Các bước:
1. (Khuyến nghị, 1 phút) chạy lại "DEV Read-only Preflight", nhánh aws-deploy, services=ai, rollback_build_run_id để trống.
   Cả 3 hàm phải còn CodeSha256 kFRiL623…NG6I= và khoá S3 a54bf4d8. Khác → DỪNG.
2. Actions → "DEV Application Deploy (Lambda code)" → nhánh aws-deploy → build_run_id=43217789667, services=ai, dry_run=false → reviewer duyệt.
3. Đợi xong. Ghi run ID. Trong Step Summary có "Rollback reference (previous CodeSha256)".
4. Chạy lại preflight (như bước 1). Đạt khi cả 3 hàm Active/Successful và cột S3 là ci-artifacts/ai/3cab8b216fae9e5f9fffb19ce535fcb7c4f5d58d/<sha256>.zip
   (re-hash MATCH). Tên file <sha256> = sha256 của ZIP RC1 → đó là "RC1 CodeSha256" dạng hex.
5. Gửi Claude Code: run ID deploy + bảng preflight sau deploy.

Rollback (khi cần, đã có sẵn): update-function-code cho từng hàm với
  --s3-bucket fitness-assistant-deployments-dev-191798898985
  --s3-key ci-artifacts/ai/a54bf4d82153ec5520ef854c8f80c35cee174dc3/9054622fadb7b24894c3189941595f6a3e68f58873aada7b999c74a5dc4d1ba2.zip
  hoặc dev-deploy build_run_id=42614561317 services=ai. Rollback không nguyên tử: kiểm từng hàm về kFRiL623…NG6I=.
