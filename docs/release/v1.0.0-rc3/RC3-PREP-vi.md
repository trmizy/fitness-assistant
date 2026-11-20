# Gymini V1 RC3 — Gói chuẩn bị (muscle-profiles authorization)

> Chỉ lưu local (không push). Ghi ngày 2026-11-13. CHƯA tag, CHƯA push `aws-deploy`, CHƯA deploy.

## 1. Nguồn và commit
| Mục | Giá trị |
|---|---|
| Nền phát hành | `origin/aws-deploy` = `4cde78f7` (= v1.0.0-rc2), đã fetch ngày 2026-11-13 |
| Commit nguồn | `1c48f3ab` (`fix/muscle-profiles-authz`) |
| Commit tích hợp | **`3ae53605`** trên nhánh `integrate/rc3-muscle-authz` (cherry-pick -x) |
| Worktree | `fitness-assistant-worktrees/rc3-muscle-authz` |
| Tree | `799b0f57…` — giống hệt tree của `1c48f3ab` (cùng parent) |
| Đưa lên `aws-deploy` | fast-forward `4cde78f7 → 3ae53605` (cần owner duyệt) |

## 2. File thay đổi (3 file, chỉ fitness-service)
- `backend/services/fitness-service/src/controllers/internal.controller.ts`
- `backend/services/fitness-service/src/__tests__/internal-exercise-muscle-profiles-authz.test.ts` (mới)
- `backend/services/fitness-service/src/__tests__/internal-exercise-muscle-profiles.integration.test.ts`

Không có thay đổi nào trong ai-service, `.github/`, `infra/` hoặc `prisma/` (không có migration). Hợp đồng response không đổi.

## 3. Hành vi
- Endpoint `POST /internal/exercises/muscle-profiles` chỉ trả về bài tập chưa archive, và là `SYSTEM + PUBLISHED` hoặc `USER_CUSTOM` có `ownerId` = người gọi. Đây là cùng quy tắc mà `plan-equipment-validator` và `exercise-reference-resolver` đang dùng.
- Người gọi được xác định bằng `req.user.id` do `internalAuthMiddleware` gán. Middleware kiểm tra `x-internal-token` trước, sau đó mới đọc `x-user-id`. `ownerId`/`userId` trong body bị bỏ qua.
- ID không được phép xem được xử lý giống ID không tồn tại. Kết quả được kiểm tra lại trong code.
- Rủi ro đã có từ trước, không thuộc phạm vi bản vá: khi thiếu `INTERNAL_SERVICE_SECRET` và `NODE_ENV` khác production, middleware tin `x-user-id` trần. Đã có test todo `internal-auth-missing-secret-weakness`. Ở production, thiếu secret thì trả 500.

## 4. Bằng chứng test (offline, worktree RC3)
| Test | Kết quả | Nhãn |
|---|---|---|
| Authorization, 10 test (router, middleware và controller thật qua HTTP, bảng Exercise giả lập in-memory) | 10/10 PASS | TEST FIXTURE |
| tsc fitness-service | 0 lỗi | — |
| Toàn bộ `src/__tests__/*.test.ts` của fitness-service, không có DB | 534 pass / 149 fail / 332 skip | xem dưới |
| Phân loại 149 fail | **149 là fail sẵn có ở baseline** (RC2 chưa patch cũng fail đúng các test này, lỗi `PrismaClientInitializationError`); **0 regression mới**; 0 test được sửa | so sánh tập tên test |
| Test DB/integration (muscle-profiles integration, substitute endpoint…) | **CHƯA CHẠY** (Docker/DB tắt, không bật) | — |
| Consumer ai-service `workout-draft-session-requests` | 14 pass / 13 skip (phần cần DB chưa chạy) | TEST FIXTURE |

## 5. Tương thích consumer
- `ai.worker.ts` (bổ sung bài của kế hoạch cũ / bài swap vào pool điều chỉnh):
  - gửi `x-internal-token` và `x-user-id` = chủ kế hoạch;
  - bài công khai và bài riêng của chủ: kết quả không đổi;
  - bài đã archive hoặc chưa PUBLISHED sẽ không còn được thêm vào pool. Validator cuối vốn đã từ chối các bài này, nên kế hoạch không còn bị fail-closed vì chúng.
- `fitness-agent-tools.getExerciseMuscleProfiles`:
  - zod schema `{success, data.exercises[{id, name?, bodyPart?, muscleGroups?}]}` khớp với response không đổi;
  - ID thiếu được `planBodyPartRemoval` coi là `unknown`: giữ lại và báo cho user, không coi là an toàn.
  - Rủi ro ghi nhận: một bản nháp cũ chứa bài đã archive sẽ không bị bỏ khi user loại trừ một nhóm cơ. Bài đó vẫn bị liệt kê là "chưa rõ nhóm cơ". Không mở rộng bản vá cho trường hợp này.
- `plan-equipment-validator` và `exercise-reference-resolver`: không sửa. Đây là nguồn của quy tắc hiển thị.

## 6. CI và deploy dự kiến
- Push lên `aws-deploy` sẽ kích hoạt **DEV Build** (`dev-build.yml`, `services=auto`). Theo `ci/service-impact-map.json`, thay đổi trong `backend/services/fitness-service/` chỉ ảnh hưởng **fitness** (artifact `fitness-lambda.zip`). Ngoài ra có thể chạy `pr-validation` / `docker-test` nếu được kích hoạt.
- Lambda đích:
  - `fitness-assistant-dev-fitness`
  - `fitness-assistant-dev-fitness-jobs`
  - Không có migrate function.
- Không đụng tới ai, ai-jobs hay ai-worker (vẫn chạy RC2).

## 7. Rollback baseline
- Fitness chưa được deploy trong RC1/RC2, nên baseline là CodeSha256 hiện tại của 2 Lambda fitness. Giá trị này phải được **DEV Read-only Preflight** ghi lại trước khi deploy (chưa đọc, vì không gọi AWS trong nhiệm vụ này).
- Rollback code: đặt lại `update-function-code` về artifact và CodeSha256 mà preflight đã ghi. Rollback git: `aws-deploy` quay lại `4cde78f7` bằng một commit revert (không force-push).

## 8. Các bước (mỗi bước cần owner duyệt)
1. Owner duyệt fast-forward `aws-deploy` → `3ae53605`, rồi push.
2. DEV Build chạy tự động: kiểm tra job fitness xanh, ghi lại sha256 và kích thước ZIP, cùng `gitSha` = `3ae53605`.
3. DEV Read-only Preflight với `services=fitness`: ghi CodeSha256 baseline của 2 Lambda.
4. DEV Deploy với `dry_run=true`, `build_run_id` = run ở bước 2, `services=fitness`.
5. DEV Deploy thật (owner tự duyệt environment), rồi smoke `/health`. Lưu ý: smoke cần hạ tầng đang bật (Aurora, VPC); lần RC2 smoke fail vì hạ tầng tắt.
6. Kiểm tra REAL HTTP/API khi hạ tầng bật: bài công khai và bài riêng của chính mình được trả về; bài riêng của user khác thì không.
7. Tạo tag `v1.0.0-rc3` (chỉ khi owner duyệt), rồi merge RC3 vào `feature/ai-v2-agent`.

## 9. Push + CI (2026-11-13)
- Push fast-forward `4cde78f7..3ae53605` lên `refs/heads/aws-deploy` (không force). Đã xác minh remote HEAD = `3ae536056779382936c57259ab11a7b1b0c15383`. Chưa có tag `v1.0.0-rc3`.
- Chỉ `dev-build.yml` có trigger `push: aws-deploy`. Workflow này không có bước AWS nào, chỉ `upload-artifact`. Các workflow deploy, preflight và infra đều là `workflow_dispatch`.
- **DEV Build run `43266693840`** (#43, event push, SHA `3ae53605`): SUCCESS, chạy 3 phút 32 giây. Job `impact` chọn đúng một service là fitness; job `build (fitness)` SUCCESS.
- Artifact và mã băm:

| Mục | Giá trị |
|---|---|
| GitHub artifact | `lambda-fitness-3ae536056779382936c57259ab11a7b1b0c15383` (52.8 MB, digest `sha256:998cb27a…aac2`) |
| ZIP SHA-256 (theo manifest, đọc từ job summary) | `2a0f211d49b7ac5745da87c0f17f97c228e6931bbfd7e678a8c1be512c0511d3`, 56,087,077 bytes |
| CodeSha256 dự kiến sau deploy | `Kg8hHUm3rFdF2ofA8X+Xwijmkxu/1+Z4qMG+USwFEdM=` |

- Không có migration (build không có bước migrate; fitness không có migrateFunction). Không deploy runtime.

## 10. Preflight tiếp theo phải xác minh (CHƯA đọc AWS)
1. CodeSha256 baseline, LastModified và State của `fitness-assistant-dev-fitness` và `fitness-assistant-dev-fitness-jobs`, cùng artifact rollback thực tế (S3 key / build run).
2. `INTERNAL_SERVICE_SECRET` có tồn tại trên fitness, fitness-jobs và các caller (ai, ai-jobs, ai-worker) hay không. Chỉ kiểm tra có/không và độ dài/hash, không in giá trị.
3. **Đường fail-open (CODE AUDIT):**
   - `config/lambda-runtime.ts` cho Lambda khởi động khi có `INTERNAL_SERVICE_SECRET` **hoặc** `INTERNAL_API_SECRET`.
   - Nhưng `internalAuthMiddleware` chỉ đọc `INTERNAL_SERVICE_SECRET`.
   - Vậy nếu chỉ có `INTERNAL_API_SECRET` và `NODE_ENV` ≠ `production`, middleware sẽ tin `x-user-id` trần.
   - Preflight phải ghi lại giá trị `NODE_ENV` và việc có hay không có cả hai biến secret.
4. **Ranh giới mạng:**
   - Template `api-gateway-baseline.yaml` không có prefix `internal` cho fitness (CODE AUDIT).
   - Cần xác minh trên API Gateway thật rằng không có route `/internal/*` hoặc route bắt-tất-cả nào trỏ tới fitness, và Function URL của fitness (nếu có) dùng `AWS_IAM`.
- Gate 2 chưa được coi là runtime VERIFIED cho tới khi 4 điểm trên PASS và có kiểm tra REAL HTTP/API sau deploy.

## 11. Preflight run 43269362495 (2026-11-13) → NO-GO
- Mục 2 VERIFIED:
  - fitness và fitness-jobs đều chạy `a19b0a06…0f4148` (git `a54bf4d8`), Active/Successful;
  - rollback ZIP trong S3, hash MATCH.
- Mục 3 và 4 UNKNOWN: workflow không đọc được. Fail closed.
- Chi tiết, đề xuất và hotfix: `PREFLIGHT-GAPS-PROPOSAL-vi.md`.

## 12. Hotfix xác thực nội bộ fail-closed (2026-11-13) — LOCAL, chưa push
- **Vị trí:**
  - Worktree: `fitness-assistant-worktrees/rc3-internal-auth-hotfix`
  - Branch: `hotfix/fitness-internal-auth-fail-closed`
  - Commit: **`14716edf`**, parent `448f3a62` = `origin/aws-deploy`. Fast-forward được.
- **File thay đổi** (chỉ fitness-service): `middleware/auth.middleware.ts`, `config/lambda-runtime.ts`, `lambda.ts`, `jobs-lambda.ts`, `__tests__/internal-auth-fail-closed.test.ts` (mới, 14 test), `__tests__/internal-auth-missing-secret-weakness.test.ts` (từ todo thành bắt buộc).
- **Hành vi:**
  - Middleware: thiếu `INTERNAL_SERVICE_SECRET` (hoặc giá trị rỗng) → 500 ở mọi `NODE_ENV`. `x-user-id` chỉ được dùng khi token khớp.
  - Startup của Lambda HTTP: bắt buộc có `INTERNAL_SERVICE_SECRET`. Startup của jobs: giữ quy tắc cũ.
- **Test (offline):**
  - Nhóm tập trung: 36/36.
  - tsc: 0 lỗi.
  - Suite fitness: 1030 test, 549 pass, 149 fail, 332 skip. Tập 149 fail **trùng baseline**; **0 regression mới**.
- **CI:** `Get-ChangedServices` cho `LambdaServices=fitness`, không migration. Push sẽ **rebuild fitness**.
- **Release identity:**
  - Artifact `43266693840` (`3ae53605`) **KHÔNG còn là artifact cuối**.
  - Source RC3 mới = `14716edf` (gồm authz `3ae53605`, 2 commit workflow và hotfix). Hash ZIP và CodeSha256 mới sẽ có từ DEV Build mới.
- **Điều kiện bắt buộc trước khi deploy:** checklist operator (`AWS-OPERATOR-CHECKLIST-vi.md`) phải xác nhận `fitness-assistant-dev-fitness` có `INTERNAL_SERVICE_SECRET` = PRESENT, và các caller (ai, ai-jobs, ai-worker, user, user-jobs) MATCH. Nếu receiver MISSING, code mới sẽ **không khởi động** (đúng thiết kế fail closed), và cần đặt secret trước (thay đổi cấu hình, duyệt riêng).
- **Các bước tiếp (mỗi bước cần owner duyệt):**
  1. Operator chạy checklist (cấu hình + exposure).
  2. Push fast-forward `14716edf` lên aws-deploy.
  3. DEV Build (fitness): ghi lại sha256 và CodeSha256 mới.
  4. Preflight `services=fitness`.
  5. Dry-run.
  6. Deploy.
  7. Smoke `/health` và kiểm tra REAL HTTP/API khi hạ tầng bật.
  8. Tag `v1.0.0-rc3`.
