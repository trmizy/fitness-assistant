# RC3 — Checklist AWS read-only cho người vận hành (KHÔNG dùng GyminiDevAppDeployRole)

> Chỉ lưu local. Ngày 2026-11-13.
>
> **Ai thực hiện:** người vận hành có AWS identity được cấp quyền đọc cấu hình Lambda, bao gồm quyền để Lambda giải mã env (`kms:Decrypt` qua Lambda), cùng quyền đọc API Gateway và resource policy của Lambda.
>
> **Ranh giới:**
> - Không dùng role CI. Role này cố ý bị Deny `kms:Decrypt`; không tìm cách vượt qua.
> - Không thay đổi gì trên AWS. Không invoke Lambda. Không gửi request giả mạo danh tính.
>
> **Nhãn bằng chứng:** `REAL — OPERATOR READ-ONLY (<identity ARN>, <thời điểm>)`.

## 0. Chuẩn bị (an toàn cho secret)
- Chạy script dưới đây **từ một file**, không dán từng lệnh vào terminal, để giá trị không vào shell history. Script không nhận secret qua tham số.
- Không bật `--debug` của AWS CLI. Không bật `Set-PSDebug -Trace`.
- Không redirect output thô ra file. Không chụp màn hình phần output thô.
- Báo cáo **chỉ** dùng các nhãn: PRESENT / MISSING / MATCH / MISMATCH / PRODUCTION / NON_PRODUCTION / UNSET / UNKNOWN.
- Không ghi plaintext, hash, fingerprint hay độ dài của secret. Không đính kèm cấu hình Lambda thô.

## 1. Danh tính và vùng
```powershell
aws sts get-caller-identity --query "{Account:Account,Arn:Arn}" --output table   # Account phải là 191798898985
aws configure get region                                                         # hoặc truyền --region ap-southeast-1
```

## 2. Cấu hình xác thực nội bộ (chỉ xuất nhãn)
**Receiver:** `fitness-assistant-dev-fitness`. Lambda này chạy `internalAuthMiddleware`.

**Caller gửi `x-internal-token = INTERNAL_SERVICE_SECRET`** (đã đối chiếu với source):
- `fitness-assistant-dev-ai`, `-ai-jobs`, `-ai-worker`: ai-service (`fitness-agent-tools`, `fitness.client`, `ai.worker`, `nutrition.processor`, auto-accept sweep).
- `fitness-assistant-dev-user`, `-user-jobs`: user-service, qua `clients/fitness-service.client.ts`.

**Thông tin thêm:** `fitness-assistant-dev-fitness-jobs` không phải receiver.

Lưu đoạn sau thành `rc3-auth-check.ps1` (PowerShell 5.1+), rồi chạy `powershell -NoProfile -File rc3-auth-check.ps1 -Profile <profile>`:
```powershell
param([Parameter(Mandatory)][string]$Profile, [string]$Region = "ap-southeast-1")
$ErrorActionPreference = "Stop"
$receiver = "fitness-assistant-dev-fitness"
$funcs = @($receiver, "fitness-assistant-dev-fitness-jobs", "fitness-assistant-dev-ai", "fitness-assistant-dev-ai-jobs",
           "fitness-assistant-dev-ai-worker", "fitness-assistant-dev-user", "fitness-assistant-dev-user-jobs")
$q = "{kms:KMSKeyArn,err:Environment.Error.ErrorCode,iss:Environment.Variables.INTERNAL_SERVICE_SECRET,ias:Environment.Variables.INTERNAL_API_SECRET,ne:Environment.Variables.NODE_ENV}"
function Read-Cfg($f) {
  $raw = aws lambda get-function-configuration --function-name $f --query $q --output json --profile $Profile --region $Region 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $raw) { return $null }
  return ($raw | Out-String | ConvertFrom-Json)
}
function Is-Set($v) { return ($v -is [string]) -and ($v.Trim() -ne "") }
$ref = Read-Cfg $receiver
$rows = foreach ($f in $funcs) {
  $c = if ($f -eq $receiver) { $ref } else { Read-Cfg $f }
  if (-not $c -or $c.err) {
    [pscustomobject]@{ Function=$f; Read=$(if ($c -and $c.err) { "BLOCKED(env $($c.err))" } else { "UNKNOWN" }); ISS="UNKNOWN"; IAS="UNKNOWN"; NODE_ENV="UNKNOWN"; ISS_vs_receiver="UNKNOWN" }
    continue
  }
  $ne = if (-not (Is-Set $c.ne)) { "UNSET" } elseif ($c.ne -eq "production") { "PRODUCTION" } else { "NON_PRODUCTION" }
  $cmp = if ($f -eq $receiver) { "(receiver)" }
         elseif ($f -eq "fitness-assistant-dev-fitness-jobs") { "N/A" }
         elseif (-not $ref -or $ref.err) { "UNKNOWN" }
         elseif (-not (Is-Set $c.iss) -or -not (Is-Set $ref.iss)) { "MISSING" }
         elseif ([string]::Equals([string]$c.iss, [string]$ref.iss, [StringComparison]::Ordinal)) { "MATCH" } else { "MISMATCH" }
  [pscustomobject]@{ Function=$f; Read="OK"; ISS=$(if (Is-Set $c.iss) {"PRESENT"} else {"MISSING"}); IAS=$(if (Is-Set $c.ias) {"PRESENT"} else {"MISSING"}); NODE_ENV=$ne; ISS_vs_receiver=$cmp }
  Remove-Variable c -ErrorAction SilentlyContinue
}
Remove-Variable ref -ErrorAction SilentlyContinue
$rows | Format-Table -AutoSize   # only labels; no value ever leaves the in-memory objects above
```

**Đọc kết quả:**

| Kết quả | Ý nghĩa |
|---|---|
| Receiver `ISS=PRESENT` và mọi caller `ISS_vs_receiver=MATCH` | Đường xác thực đúng cho cả code cũ lẫn hotfix |
| Receiver `ISS=MISSING`, `IAS=PRESENT`, `NODE_ENV≠PRODUCTION` | **FAIL-OPEN đang có thật** trên code hiện tại (`a54bf4d8`); hotfix sẽ chặn |
| Receiver `ISS=MISSING`, `NODE_ENV=PRODUCTION` | Endpoint nội bộ đang trả 500. Hotfix làm Lambda **không khởi động** (fail closed) cho tới khi đặt secret |
| Caller `MISMATCH` hoặc `MISSING` | Các tính năng gọi endpoint nội bộ đang lỗi 401/500. Cần đồng bộ secret: thay đổi cấu hình, phải duyệt riêng |

**Lưu ý trước khi deploy hotfix:** nếu `fitness-assistant-dev-fitness` có `ISS=MISSING`, deploy hotfix sẽ làm Lambda HTTP fitness **không khởi động**. Phải đặt `INTERNAL_SERVICE_SECRET` (bằng giá trị caller đang dùng) trước. Đây là thay đổi cấu hình, cần duyệt riêng.

## 3. Mức độ lộ endpoint (runtime, không phải template)
API Gateway HTTP API của dự án: `id1iz7upbl` (theo `ci/service-impact-map.json`; xác nhận lại bằng `get-apis`).

```powershell
# thêm `--profile <profile> --region ap-southeast-1` vào MỖI lệnh bên dưới
aws apigatewayv2 get-apis --query "Items[].{Id:ApiId,Name:Name,Proto:ProtocolType,Disabled:DisableExecuteApiEndpoint}" --output table
aws apigateway get-rest-apis --query "items[].{Id:id,Name:name}" --output table                     # REST API (v1), nếu có
# integrations trỏ tới fitness HTTP Lambda
aws apigatewayv2 get-integrations --api-id <API_ID> --query "Items[?contains(IntegrationUri,'fitness-assistant-dev-fitness')].{Id:IntegrationId,Uri:IntegrationUri}" --output table
# routes trỏ tới các integration đó
aws apigatewayv2 get-routes --api-id <API_ID> --query "Items[?Target=='integrations/<INTEGRATION_ID>'].{Key:RouteKey,Auth:AuthorizationType}" --output table
# route bắt-tất-cả hoặc route nội bộ trên toàn API
aws apigatewayv2 get-routes --api-id <API_ID> --query "Items[?RouteKey=='`$default' || contains(RouteKey,'internal') || RouteKey=='ANY /{proxy+}'].{Key:RouteKey,Target:Target,Auth:AuthorizationType}" --output table
aws lambda get-function-url-config --function-name fitness-assistant-dev-fitness       # ResourceNotFoundException = không có Function URL
aws lambda get-function-url-config --function-name fitness-assistant-dev-fitness-jobs
aws lambda get-policy --function-name fitness-assistant-dev-fitness --query Policy --output text   # chỉ ghi Principal / SourceArn / Condition vào báo cáo
```

**Tiêu chí PASS:**
- Không có route nào chứa `internal` trỏ tới fitness.
- Không có `$default` hoặc `ANY /{proxy+}` gốc trỏ tới fitness.
- Các route prefix của fitness (`/exercises`, `/workouts`, …) không có biến thể nào dẫn tới đường dẫn `/internal/*`.
- Không có Function URL, hoặc chỉ có Function URL với `AuthType=AWS_IAM`.
- Resource policy chỉ cho phép:
  - `apigateway.amazonaws.com` với `SourceArn` của API dự án;
  - các principal nội bộ dự kiến.
- Đường ai/user → fitness đi qua Lambda Invoke trực tiếp, được bảo vệ bởi quyền `lambda:InvokeFunction` của role thực thi. Xác nhận role của ai và user chỉ có invoke trên fitness, không có `*`:
  `aws lambda get-function-configuration --function-name fitness-assistant-dev-ai --query Role` → `aws iam list-attached-role-policies` / `list-role-policies` (chỉ đọc).

Trường hợp thiếu quyền ở bước nào thì ghi **UNKNOWN** cho bước đó, không suy đoán. Template trong repo (`api-gateway-baseline.yaml`: không có prefix `internal`) chỉ là IaC, **không** phải bằng chứng runtime.

## 4. Mẫu báo cáo trả về
| Item | Result |
|---|---|
| Identity | Account=191798898985, Arn=<…> |
| fitness ISS / IAS / NODE_ENV | PRESENT/MISSING · PRESENT/MISSING · PRODUCTION/NON_PRODUCTION/UNSET |
| ai / ai-jobs / ai-worker / user / user-jobs ISS vs receiver | MATCH/MISMATCH/MISSING/UNKNOWN |
| API Gateway routes to fitness containing internal / catch-all | NONE / FOUND(<RouteKey>) / UNKNOWN |
| Function URL fitness / fitness-jobs | NONE / AWS_IAM / NONE_AUTH(!) / UNKNOWN |
| Resource policy principals | <danh sách principal, không ARN nhạy cảm khác> / UNKNOWN |

## 5. KẾT QUẢ (2026-11-13) — REAL — OPERATOR READ-ONLY (arn:aws:iam::191798898985:user/gymini-admin, ap-southeast-1)
**Cấu hình (script mục 2, chỉ nhãn):**

| Function | Read | ISS | IAS | NODE_ENV | ISS vs receiver |
|---|---|---|---|---|---|
| fitness-assistant-dev-fitness | OK | PRESENT | MISSING | PRODUCTION | (receiver) |
| fitness-assistant-dev-fitness-jobs | OK | PRESENT | MISSING | PRODUCTION | N/A |
| fitness-assistant-dev-ai | OK | PRESENT | MISSING | PRODUCTION | MATCH |
| fitness-assistant-dev-ai-jobs | OK | PRESENT | MISSING | PRODUCTION | MATCH |
| fitness-assistant-dev-ai-worker | OK | PRESENT | MISSING | PRODUCTION | MATCH |
| fitness-assistant-dev-user | OK | PRESENT | MISSING | PRODUCTION | MATCH |
| fitness-assistant-dev-user-jobs | OK | PRESENT | MISSING | PRODUCTION | MATCH |

→ Trên cấu hình hiện tại không có fail-open. Hotfix `14716edf` sẽ khởi động bình thường, vì receiver có `INTERNAL_SERVICE_SECRET`.

**Exposure:**
- **API Gateway:** chỉ có một API, `id1iz7upbl` (HTTP). Không có REST API v1.
  - Có 24 route trỏ tới fitness (integration `wv4c1bs`): `ANY /<prefix>` và `/<prefix>/{proxy+}` cho 12 prefix, `AuthorizationType=NONE` (xác thực ở tầng ứng dụng).
  - Trên toàn API: không có route nào chứa `internal`, không có `$default`, không có `ANY /{proxy+}` gốc. `/internal/*` không có đường công khai.
- **Ghi nhận:** `POST /workouts/from-ai-plan` và `POST /nutrition/from-ai-plan` dùng `internalAuthMiddleware` nhưng nằm dưới prefix công khai.
  - Không có ranh giới mạng; chỉ được bảo vệ bởi shared secret (đang có).
  - Sau hotfix: fail closed kể cả khi thiếu secret. Ngoài phạm vi RC3.
- **Function URL:** fitness và fitness-jobs đều không có.
- **Resource policy của fitness:** chỉ `apigateway.amazonaws.com` với `SourceArn` thuộc `id1iz7upbl` và đúng 24 route. fitness-jobs: không có resource policy.
- **Quyền invoke trực tiếp:**
  - ai-lambda-role và ai-worker-role: invoke tường minh trên auth, user, fitness, payment (không wildcard).
  - ai-jobs-role: không có quyền invoke.
  - user-lambda-role: chỉ invoke auth.
  - Hai dòng trên là khoảng trống chức năng có từ trước, không phải lỗ hổng bảo mật; ngoài phạm vi.
  - Role CI deploy có invoke fitness (smoke). Với hotfix, role này không thể mạo danh nếu không có secret.

**Kết luận:** AUTH CONFIG VERIFIED. ENDPOINT EXPOSURE VERIFIED (với các ghi nhận ở trên).
