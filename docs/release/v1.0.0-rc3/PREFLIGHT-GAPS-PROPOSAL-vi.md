# RC3 fitness preflight — kết quả và đề xuất tối thiểu (CHƯA commit / push)

> Lưu local, ngày 2026-11-13. Preflight run `43269362495` (#6, aws-deploy @ `3ae53605`, services=fitness, owner duyệt env `dev`): SUCCESS.

## A. Đã xác minh (REAL — GitHub Actions OIDC, read-only)
| Mục | Kết quả |
|---|---|
| Account / region | 191798898985 / ap-southeast-1 (Account gate PASS) |
| `fitness-assistant-dev-fitness` | CodeSha256 `oZsKBkAkjjbbr53LKVANVqDGgi9gZ1Y8DELEHNwPQUg=` = hex `a19b0a06…0f4148`, RevisionId `903ff982-16c3-4433-8903-9d5781319719`, LastModified 2026-11-09T12:30:01Z, Active/Successful, Zip |
| `fitness-assistant-dev-fitness-jobs` | cùng CodeSha256/hex, RevisionId `da87aacd-3c1e-4b8f-a472-33b01cbfb8d8`, LastModified 2026-11-09T12:30:13Z, Active/Successful, Zip |
| Rollback | `ci-artifacts/fitness/a54bf4d82153ec5520ef854c8f80c35cee174dc3/a19b0a06…0f4148.zip` — đã tải về runner, sha256 **MATCH**; cả 2 Lambda chạy cùng ZIP (đã kiểm từng hàm, không giả định) |

Ghi chú nhỏ: ô "running artifact in S3" in key 2 lần (`${key:+…}${key:-…}` — lỗi định dạng summary, không ảnh hưởng kết quả).

**Phạm vi thực của deploy RC3:** fitness đang chạy `a54bf4d8` (2026-11-09). Deploy `3ae53605` mang theo **3 commit** chạm fitness/shared:
1. `02d3a430`: seed món Việt adopt alias có sẵn. Chỉ chạy khi fitness-jobs được gọi job seed tường minh, không tự chạy.
2. `ee886c21`: thêm enum `SUBSTITUTE_SAVED_EXERCISE` vào shared. Chỉ bổ sung, không bỏ gì.
3. `3ae53605`: bản vá authz.

Không có thay đổi prisma schema/migration. Owner cần biết trước khi duyệt deploy.

## B. Chưa xác minh được (workflow không đọc) → fail closed
- **Internal auth (mục 3): UNKNOWN.** Workflow không đọc environment của Lambda.
- **NODE_ENV: UNKNOWN.**
- **Network exposure (mục 4): NOT VERIFIED.** Role không có quyền đọc routes, Function URL hoặc resource policy.

## C. CODE AUDIT (source `3ae53605`) — 5 câu hỏi
1. **Middleware có secret thật không?**
   - Chỉ khi `INTERNAL_SERVICE_SECRET` có trên Lambda: middleware so sánh `x-internal-token` với giá trị này.
   - Trên runtime: UNKNOWN.
2. **Startup và middleware có cùng tên biến không?** **KHÔNG.**
   - `validateRequiredRuntimeConfig()` (gọi trong `lambda.ts` và `jobs-lambda.ts`) chấp nhận `INTERNAL_SERVICE_SECRET` **hoặc** `INTERNAL_API_SECRET`.
   - `internalAuthMiddleware` chỉ đọc `INTERNAL_SERVICE_SECRET`.
3. **Thiếu secret thì sao?**
   - `NODE_ENV === "production"` → 500 (fail closed).
   - Ngược lại → tin `x-user-id` trần, chỉ ghi log cảnh báo (**fail open**). Đã có test todo `internal-auth-missing-secret-weakness` mô tả đúng lỗ hổng này.
4. **NODE_ENV thực tế có bật nhánh bypass không?**
   - UNKNOWN.
   - Fail-open chỉ xảy ra khi đồng thời: `INTERNAL_SERVICE_SECRET` thiếu (hoặc rỗng) **và** `NODE_ENV` ≠ `production`.
   - Startup vẫn qua nếu chỉ có `INTERNAL_API_SECRET`.
5. **Caller có gửi token tương thích không?**
   - ai-service (`fitness-agent-tools.domain`, `ai.worker.ts`, `clients/fitness.client.ts`) gửi `x-internal-token = INTERNAL_SERVICE_SECRET`.
   - Startup của ai-service **bắt buộc** `INTERNAL_SERVICE_SECRET`.
   - Tương thích **nếu** fitness có cùng giá trị. Chưa xác minh giá trị khớp.

Đường gọi trên AWS: ai → fitness dùng `requestService` → `invokeHttpLambda` (Lambda Invoke trực tiếp, được IAM bảo vệ), không đi qua API Gateway. Template `api-gateway-baseline.yaml` không có prefix `internal` cho fitness và không có `$default`/catch-all gốc (CODE AUDIT trên template; cấu hình thật chưa xác minh — working tree chính còn sửa đổi chưa commit ở `api-gateway-additions.yaml`).

## D. Đề xuất 1 — bổ sung preflight cho mục 3 (không cần đổi IAM)
`GyminiDevAppDeployRole` đã có `lambda:GetFunction` trên fitness, fitness-jobs, ai, ai-jobs, ai-worker. Thêm một step chỉ in ra true/false và MATCH/MISMATCH, **không bao giờ in giá trị**:

```yaml
      - name: Internal-auth config (presence only; values never printed)
        shell: bash          # no `set -x`
        run: |
          set -euo pipefail
          echo "### Internal-auth config (presence only)" >> "$GITHUB_STEP_SUMMARY"
          echo "| function | INTERNAL_SERVICE_SECRET | INTERNAL_API_SECRET | NODE_ENV | ISS digest = fitness |" >> "$GITHUB_STEP_SUMMARY"
          echo "|---|---|---|---|---|" >> "$GITHUB_STEP_SUMMARY"
          dig() { aws lambda get-function --function-name "$1" --query "Configuration.Environment.Variables" --output json \
                  | jq -r '(.INTERNAL_SERVICE_SECRET // "") | if .=="" then "" else (.|@base64) end' | { read -r v || true; [ -n "${v:-}" ] && printf '%s' "$v" | sha256sum | cut -c1-64 || echo ""; }; }
          ref=$(dig fitness-assistant-dev-fitness)
          for f in fitness-assistant-dev-fitness fitness-assistant-dev-fitness-jobs fitness-assistant-dev-ai fitness-assistant-dev-ai-jobs fitness-assistant-dev-ai-worker; do
            row=$(aws lambda get-function --function-name "$f" --query "Configuration.Environment.Variables" --output json \
                  | jq -r '[ (has("INTERNAL_SERVICE_SECRET") and (.INTERNAL_SERVICE_SECRET|length>0)),
                             (has("INTERNAL_API_SECRET") and (.INTERNAL_API_SECRET|length>0)),
                             (.NODE_ENV // "UNSET") ] | @tsv')
            d=$(dig "$f"); m=$([ -n "$d" ] && [ "$d" = "$ref" ] && echo MATCH || echo "**NO/MISMATCH**")
            echo "| $f | $(cut -f1 <<<"$row") | $(cut -f2 <<<"$row") | $(cut -f3 <<<"$row") | $m |" >> "$GITHUB_STEP_SUMMARY"
          done
```

Lưu ý khi review step này:
- Giá trị secret chỉ chảy qua pipe trong runner. Chỉ phần `sha256(base64(value))` được so sánh, và chỉ in MATCH. NODE_ENV không phải secret.
- Không ghi file, không tạo artifact.
- **Cân nhắc:** workflow sẽ nhận được env thật (gồm DB host, v.v.) qua `get-function`. Đây vốn là quyền đã có sẵn. Không in thêm gì ngoài 4 cột trên.

## E. Đề xuất 2 — mục 4 (CẦN thêm quyền IAM đọc, phê duyệt riêng)
Thêm vào `GyminiDevAppDeployRole` (chỉ đọc):
- `apigateway:GET` trên `arn:aws:apigateway:ap-southeast-1::/apis/${ProtectedApiId}/routes*` và `/integrations*`.
- `lambda:GetFunctionUrlConfig` và `lambda:GetPolicy` trên 2 Lambda fitness.

Step tương ứng:
- `aws apigatewayv2 get-routes` / `get-integrations`: liệt kê route có integration trỏ tới fitness; cảnh báo nếu RouteKey chứa `internal`, là `$default`, hoặc là `ANY /{proxy+}` gốc.
- `aws lambda get-function-url-config`: `ResourceNotFoundException` nghĩa là không có URL; nếu có thì `AuthType` phải là `AWS_IAM`.
- `aws lambda get-policy`: liệt kê principal/SourceArn được phép invoke.
- Không invoke gì.

## F. Hotfix fail-closed tối thiểu (đề xuất, KHÔNG tự sửa)
Mục tiêu: đồng bộ tên biến và bỏ nhánh tin `x-user-id` trần ngoài môi trường dev/test được bật tường minh. Không refactor auth.

```diff
--- backend/services/fitness-service/src/config/lambda-runtime.ts
-  if (!process.env.INTERNAL_SERVICE_SECRET && !process.env.INTERNAL_API_SECRET) {
-    problems.push("INTERNAL_SERVICE_SECRET (or INTERNAL_API_SECRET)");
-  }
+  // internalAuthMiddleware and every caller use INTERNAL_SERVICE_SECRET; INTERNAL_API_SECRET alone must not pass startup.
+  if (!process.env.INTERNAL_SERVICE_SECRET) problems.push("INTERNAL_SERVICE_SECRET");
--- backend/services/fitness-service/src/middleware/auth.middleware.ts
-  const isDev = process.env.NODE_ENV !== "production";
+  // header-trust only for an explicitly-insecure local dev/test run, never by NODE_ENV alone
+  const isDev = (process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test")
+    && process.env.ALLOW_INSECURE_DEV_SECRETS === "true";
```

Ghi chú về hotfix:
- `notification.client.ts` vẫn dùng `INTERNAL_API_SECRET || INTERNAL_SERVICE_SECRET` cho chat-service, nên không bị ảnh hưởng.
- Test: chuyển test todo `internal-auth-missing-secret-weakness` thành test bắt buộc. Thêm test: startup fail khi chỉ có `INTERNAL_API_SECRET`.
- Compose dev local (`docker-compose.dev.yml`) đã đặt `INTERNAL_SERVICE_SECRET`, nên không bị ảnh hưởng.
- Rủi ro: một Lambda chỉ có `INTERNAL_API_SECRET` sẽ **không khởi động**. Đây là fail closed. Cần biết kết quả mục D trước khi deploy hotfix.

## G. Thứ tự đề xuất
1. Owner duyệt đề xuất 1. Commit step mới vào `dev-preflight.yml` trên aws-deploy (đường dẫn `.github/**` không kích hoạt deploy, nhưng có kích hoạt DEV Build), rồi chạy lại preflight `services=fitness`.
2. Nếu kết quả cho thấy secret có và digest MATCH, `NODE_ENV=production`, thì không có fail-open trên cấu hình hiện tại. Khi đó, hotfix F vẫn nên làm, nhưng không còn là blocker.
3. Đề xuất 2 (IAM đọc) chạy qua infra-plan và infra-deploy (đã có reviewer), rồi kiểm tra route và Function URL.
4. Chỉ khi các mục 3 và 4 PASS mới xin duyệt dry-run RC3.

## H. Kết quả Đề xuất 1 (2026-11-13) → RC3 NO-GO
- **Commit workflow trên `aws-deploy`:**
  - `8ba12440`: thêm step internal-auth.
  - `448f3a62`: fix `set +e`, vì GitHub chạy `bash -eo pipefail`.
  - DEV Build `43272022694` cho `8ba12440`: build **skipped**. Artifact RC3 vẫn là `43266693840` (`3ae53605`).
- **Các run preflight:**
  - Run `43273155426` (#7, `8ba12440`): FAILURE. Step thoát im lặng vì `-e`.
  - Run `43274206005` (#8, `448f3a62`): SUCCESS.
    - Baseline và rollback không đổi so với #6: `a19b0a06…`, MATCH.
    - **Cả 5 Lambda** (fitness, fitness-jobs, ai, ai-jobs, ai-worker): `PERMISSION_BLOCKED (env AccessDeniedException)`. Không có CMK (`KMSKeyArn` rỗng).
    - Nguyên nhân: Lambda trả `Environment.Error = AccessDeniedException` vì role `GyminiDevAppDeployRole` có **Deny tường minh `kms:Decrypt`** (`ci-cd-oidc.yaml`, `ExplicitDenyOfDangerousPlanes`). Deny này chặn cả việc giải mã env bằng key mặc định `aws/lambda` khi gọi `GetFunction`.
- **Kết luận:**
  - INTERNAL AUTH, NODE_ENV, AI caller secret: **UNKNOWN (PERMISSION_BLOCKED)**.
  - ENDPOINT EXPOSURE: **UNKNOWN**.
  - **RC3 NO-GO — INTERNAL AUTH & ENDPOINT EXPOSURE UNVERIFIED.**
- **Không đề xuất gỡ Deny `kms:Decrypt` khỏi deploy role.** Làm vậy sẽ cho CI đọc toàn bộ secret trong env. Các lựa chọn (owner quyết định):
  1. Owner tự chạy kiểm tra chỉ-xuất-có/không ở local bằng profile admin. Dùng đúng logic của step: chỉ in true/false, phân loại và MATCH. Đây là bằng chứng do owner thực hiện, ghi nhãn tương ứng.
  2. Tạo một role auditor riêng, chỉ có `lambda:GetFunction` và `kms:Decrypt` với điều kiện `kms:ViaService=lambda`, dùng trong một workflow audit riêng có reviewer. Đây là thay đổi IAM nên cần duyệt riêng.
  3. Bỏ phụ thuộc vào việc đọc env bằng hotfix F (fail-closed trong code). Khi đó, an toàn không còn phụ thuộc vào `NODE_ENV` hay tên biến. Mục 4 (exposure) vẫn cần đề xuất 2.
