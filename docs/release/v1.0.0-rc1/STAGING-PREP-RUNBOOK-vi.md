# RC1 — chuẩn bị staging (dev) — các bước READ-ONLY cho chủ dự án (2026-11-12)
Chỉ lưu local. Không có bước nào ở đây deploy, bật Aurora hay tạo tag.
Release SHA 3cab8b216fae9e5f9fffb19ce535fcb7c4f5d58d · CI build run 43217789667 · môi trường dev: account 191798898985, ap-southeast-1.

## 1. Xác minh ZIP Lambda (cần `gh auth login` — GitHub CLI chưa cài trên máy này)
```powershell
gh run download 43217789667 -R trmizy/fitness-assistant -p "lambda-ai-3cab8b21*" -D rc1-art
$m = Get-ChildItem rc1-art -Recurse -Filter *.manifest.json | Select-Object -First 1
$man = Get-Content $m.FullName -Raw | ConvertFrom-Json
$zip = Join-Path $m.DirectoryName "$($man.service)-$($man.gitSha).zip"
$h = (Get-FileHash $zip -Algorithm SHA256).Hash.ToLower()
"gitSha=$($man.gitSha)  manifest.sha256=$($man.sha256)  zip.sha256=$h  MATCH=$($h -eq $man.sha256)  size=$($man.sizeBytes)"
$man.targetFunctions        # kỳ vọng: fitness-assistant-dev-ai, -ai-jobs, -ai-worker
```
Kỳ vọng: `gitSha` = 3cab8b21…, MATCH=True. Digest GitHub của artifact (`39469bc1…`) là hash của file zip bọc ngoài, KHÔNG phải sha256 của ZIP Lambda.
(Không có gh: tải artifact thủ công ở tab Actions → run 43217789667 → Artifacts, rồi chạy đoạn PowerShell từ dòng `$m = ...`.)

## 2. Baseline Lambda (dùng profile/role CỦA BẠN cho tài khoản 191798898985)
```powershell
$env:AWS_PROFILE = "<profile-dev-của-bạn>"; $env:AWS_REGION = "ap-southeast-1"
aws sts get-caller-identity --query Account --output text      # PHẢI ra 191798898985, nếu không thì dừng
foreach ($f in "fitness-assistant-dev-ai","fitness-assistant-dev-ai-jobs","fitness-assistant-dev-ai-worker") {
  aws lambda get-function-configuration --function-name $f --query "{Name:FunctionName,Arn:FunctionArn,CodeSha256:CodeSha256,RevisionId:RevisionId,Version:Version,LastModified:LastModified,State:State,LastUpdateStatus:LastUpdateStatus,PackageType:PackageType}" --output json
  aws lambda list-aliases --function-name $f --query "Aliases[].[Name,FunctionVersion]" --output text
}
```
Không đụng cấu hình, không invoke; không cần bật Aurora (chỉ đọc metadata Lambda).

## 3. Nguồn rollback
- Lần deploy thật gần nhất: run 42617314070 (2026-11-09T12:28Z, success, head a54bf4d8). Build gần nhất trước đó có artifact ai: run 42614561317 (a54bf4d8), `lambda-ai-a54bf4d8…`, 34,7 MB, còn hạn tới 2026-12-09, digest bọc ngoài sha256:c8d84686….
  Chưa chứng minh được đây đúng là bản đang chạy (input build_run_id của lần deploy không đọc được qua API công khai) → so `CodeSha256` ở bước 2 với `sha256` trong manifest của artifact này (CodeSha256 của Lambda = SHA-256 dạng base64 của chính ZIP).
- Kiểm tra bản ZIP cũ còn trong S3 (chỉ đọc): `aws s3 ls s3://fitness-assistant-deployments-dev-191798898985/ci-artifacts/ai/ --recursive` — khoá có dạng ci-artifacts/ai/<gitSha>/<sha256>.zip (theo nội dung, không ghi đè).
- Rollback = chạy lại dev-deploy với build_run_id=42614561317 services=ai (khi artifact còn hạn), hoặc `aws lambda update-function-code --s3-key` trỏ ZIP cũ ở S3. Workflow không dùng version/alias → ghi baseline TRƯỚC khi deploy.
- Hạn lưu artifact: 12 tháng 12 cho build 43217789667, 9 tháng 12 cho build cũ — quá hạn thì chỉ còn S3.

## 4. Staging dry-run (tab Actions → "DEV Application Deploy (Lambda code)" → Run workflow, nhánh aws-deploy)
| Input | Giá trị |
|---|---|
| build_run_id | 43217789667 |
| services | ai |
| dry_run | true (mặc định) |
Dry-run KHÔNG assume role AWS (bước configure-aws-credentials chỉ chạy khi dry_run=false). Nó làm: resolve danh sách service → tải toàn bộ artifact `lambda-*` của run (cả 6 dịch vụ) → **verify sha256 từng ZIP với manifest (ARTIFACT_HASH_MISMATCH nếu lệch)** → in "would upload s3://fitness-assistant-deployments-dev-191798898985/ci-artifacts/ai/3cab8b21…/<sha256>.zip and update-function-code" cho `ai`.
Kỳ vọng: log có dòng `verified ai <sha256>`; không có lỗi mismatch. Job dùng `environment: dev` nên cần reviewer duyệt (nhánh aws-deploy).
Deploy thật (dry_run=false) cần bạn duyệt riêng; nó chạy Identity gate, chụp scheduler trước/sau, upload S3, update-function-code ×3, smoke /health.
