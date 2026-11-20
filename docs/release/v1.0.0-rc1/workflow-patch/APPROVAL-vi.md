# Patch workflow preflight chỉ-đọc — cần chủ dự án duyệt (CHƯA commit, CHƯA push)

File: `docs/release/v1.0.0-rc1/workflow-patch/dev-preflight.yml` → đích `.github/workflows/dev-preflight.yml`.

Vì sao cần: Claude Code local không có profile tài khoản dev 191798898985; đường hợp lệ duy nhất là OIDC role
`GyminiDevAppDeployRole`, mà trust policy chỉ nhận `repo:<repo>:environment:dev` → phải chạy trong GitHub Actions.

Kiểm chứng offline (đã làm): YAML hợp lệ; chỉ 5 lệnh AWS, tất cả là đọc (sts get-caller-identity, lambda get-function với
--query Configuration, s3api list-objects-v2, s3api head-object, s3 cp từ S3 về runner); không có lệnh ghi; logic base64→hex và
khớp khoá S3 đã test bằng dữ liệu giả lập. Không cần đổi IAM (role đã có lambda:GetFunction, s3:GetObject/ListBucket ci-artifacts/*).
Impact CI: Get-ChangedServices → LambdaServices = [] → dev-build không build Lambda nào.

Các bước (mỗi bước cần bạn duyệt):
1. Commit file vào `aws-deploy` (đường dẫn `.github/workflows/dev-preflight.yml`).
2. Commit cùng file vào `master` — GitHub chỉ cho chạy tay (workflow_dispatch) workflow có trên nhánh mặc định (dev-deploy.yml cũng nằm trên master).
3. Push cả hai nhánh.
4. Actions → "DEV Read-only Preflight" → Run workflow trên nhánh `aws-deploy`: services=`ai`, rollback_build_run_id=`42614561317` → reviewer environment `dev` duyệt.
5. Đọc Step Summary: bảng 3 Lambda (CodeSha256 base64 + hex, RevisionId, LastModified, State, LastUpdateStatus, PackageType, khoá S3 đang chạy),
   kết quả re-hash S3 (MATCH), và so sánh artifact a54bf4d8 với bản đang chạy (YES/NO).

Kết quả được dùng như sau: nếu cả 3 hàm có khoá S3 + MATCH → ROLLBACK VERIFIED (nguồn rollback = chính khoá S3 đó, kể cả khi
không phải a54bf4d8). Nếu NOT FOUND in S3 → bản đang chạy không do dev-deploy tạo → ROLLBACK NOT VERIFIED, không deploy.
