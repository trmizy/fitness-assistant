# Hướng dẫn deploy Gymini bằng GitHub Actions

Tài liệu bàn giao cho cộng sự và Claude Code. Cập nhật ngày **17/11/2026** theo mã nguồn trên nhánh `aws-deploy`, HEAD `7e4c99b1` tại thời điểm đọc.

**Phạm vi: các workflow AWS DEV đang có trong repository.** Đây là hướng dẫn vận hành, chưa phải chứng nhận hệ thống sẵn sàng production. Việc soạn tài liệu chỉ dùng **CODE AUDIT**; chưa chạy workflow, truy cập AWS hay kiểm tra trực tiếp cấu hình GitHub Environments. Khi mã nguồn thay đổi, đọc lại các file được dẫn bên dưới.

## 1. Hiểu luồng trước khi thao tác

```text
Thay đổi code → PR → đọc kết quả CI → review/merge được cho phép
                                        ↓
                            code trên nhánh aws-deploy
                                        ↓
                     DEV Build → ZIP + manifest + SHA-256
                                        ↓
              Preflight bản đang chạy + nguồn rollback đã xác nhận
                                        ↓
                   DEV Application Deploy: dry_run=true
                                        ↓
                 Chủ dự án duyệt đúng phạm vi triển khai
                                        ↓
                  cùng build_run_id, dry_run=false
                                        ↓
                   health smoke → kiểm tra nghiệp vụ
                                        ↓
                         ghi nhận kết quả bàn giao
```

Build tạo gói triển khai; deploy đưa đúng gói đó lên AWS. Push code lên `aws-deploy` có thể tự kích hoạt **build**, nhưng **không tự deploy**. Các pipeline deploy hiện tại chạy thủ công.

| Thuật ngữ | Ý nghĩa thực tế |
|---|---|
| Commit SHA | Mã định danh phiên bản mã nguồn |
| Workflow run ID | Số trong URL `…/actions/runs/<run_id>`; không phải số PR hay commit SHA |
| Artifact | Gói ZIP và manifest do DEV Build lưu trên GitHub |
| Manifest | JSON ghi service, Git SHA, hash ZIP, kích thước và các Lambda đích |
| SHA-256 | Hash dùng đối chiếu đúng byte của gói triển khai |
| Dry run | Kiểm tra/lập kế hoạch theo phạm vi workflow; chưa triển khai lên AWS |
| OIDC | GitHub nhận quyền AWS tạm thời qua IAM role, không cần access key tĩnh |
| Rollback | Quay về gói đã xác nhận trước đó; không tự hoàn tác dữ liệu/database |

## 2. Chọn đúng workflow

Các đường dẫn dưới đây là nguồn sự thật, ưu tiên hơn nhận xét cũ trong comment hoặc báo cáo.

| Mục đích | Tên hiển thị / file | Cách kích hoạt và tác động |
|---|---|---|
| Kiểm tra PR | PR Validation — [pr-validation.yml](../../.github/workflows/pr-validation.yml) | PR vào `master` hoặc `aws-deploy`, bỏ qua thay đổi chỉ tài liệu; lint/build và kiểm thử theo workflow, không truy cập AWS |
| Docker và DB integration | Docker Fast Test — [docker-test.yml](../../.github/workflows/docker-test.yml) | PR và push vào `master`; có job DB test riêng, không phải deploy |
| Đóng gói Lambda | DEV Build — [dev-build.yml](../../.github/workflows/dev-build.yml) | Push vào `aws-deploy` hoặc chạy thủ công; không có quyền AWS |
| Đọc baseline/rollback | DEV Read-only Preflight (Lambda baseline + rollback source) — [dev-preflight.yml](../../.github/workflows/dev-preflight.yml) | Thủ công; đọc AWS, tải gói về runner để kiểm tra hash |
| Deploy code Lambda | DEV Application Deploy (Lambda code) — [dev-deploy.yml](../../.github/workflows/dev-deploy.yml) | Thủ công; mặc định dry run, deploy ZIP của build được chọn |
| Deploy chat ECS | DEV Chat Deploy (ECS) — [chat-deploy.yml](../../.github/workflows/chat-deploy.yml) | Thủ công; build Docker, khi chạy thật sẽ push ECR và cập nhật ECS |
| Lập kế hoạch API Gateway | DEV Infrastructure Plan (API Gateway) — [infra-plan.yml](../../.github/workflows/infra-plan.yml) | Thủ công; ghi template S3 và tạo change set, **không execute** |
| Áp dụng API Gateway | DEV Infrastructure Apply (API Gateway) — [infra-deploy.yml](../../.github/workflows/infra-deploy.yml) | Thủ công; execute change set đã review và đối chiếu digest |

DEV Build bỏ qua push chỉ thay đổi `docs/**`, `**/*.md`, `ci/**`, `infra/**`. Không thấy build sau một push chỉ tài liệu có thể là đúng thiết kế.

**Chưa có workflow triển khai frontend/web hoặc mobile trong danh sách này.** Express gateway trong `backend/gateway` phục vụ local/Docker; AWS dùng API Gateway HTTP API. Sửa frontend, gateway local, migration hoặc biến môi trường không có nghĩa là chạy deploy Lambda sẽ áp dụng được thay đổi đó.

## 3. Các giá trị DEV và điều kiện ban đầu

| Thành phần | Giá trị trong mã nguồn hiện tại |
|---|---|
| Repository | `trmizy/fitness-assistant` |
| Nhánh triển khai | `aws-deploy` |
| AWS account | `191798898985` |
| AWS region | `ap-southeast-1` |
| Bucket artifact | `fitness-assistant-deployments-dev-191798898985` |
| API Gateway cần bảo vệ | `id1iz7upbl` |
| Role deploy ứng dụng | `GyminiDevAppDeployRole` |
| Environment ứng dụng/preflight/chat | `dev` |
| Environment infra plan / apply | `dev-infra-plan` / `dev-infra` |

Account ID, tên resource và role là định danh, không phải mật khẩu. Không đưa access key, token, chuỗi kết nối hay nội dung `.env` vào tài liệu/log.

Trước lần đầu thao tác, người quản trị cần xác nhận:

- Cộng sự có quyền chạy Actions trong repository và người review có quyền phê duyệt deployment.
- Các workflow đã được đăng ký trên GitHub. Kiểm tra default branch thực tế; comment hiện tại nói là `master`, nhưng cần xác nhận trên remote.
- Environment có giới hạn nhánh `aws-deploy`, required reviewers và chính sách bypass đúng yêu cầu dự án. Chỉ khai báo `environment: dev` trong YAML **không tự tạo đầy đủ các quy tắc bảo vệ này**.
- AWS OIDC provider, trust policy và IAM permissions đã được cấp đúng repo/environment. Tham khảo [ci-cd-oidc.yaml](../../infra/cloudformation/ci-cd-oidc.yaml); sự tồn tại của template không chứng minh nó đã được apply.
- Xác nhận trạng thái AWS DEV với chủ dự án: database/chat có thể đang tắt theo cơ chế on-demand. Pipeline deploy code không tự bật toàn bộ môi trường.

GitHub yêu cầu quyền write để chạy workflow thủ công; cách chạy qua UI/CLI được mô tả trong [hướng dẫn chính thức](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow). Nếu không thấy nút Run workflow, kiểm tra quyền, trạng thái enabled và workflow trên default branch theo [quy tắc workflow_dispatch](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch). Không bỏ approval hoặc đổi nhánh deploy để chữa lỗi hiển thị.

## 4. Deploy Lambda: hướng dẫn từng bước

### Bước 1 — Chốt phiên bản và phạm vi

Trong checkout local, đọc `AGENTS.md`, `CLAUDE.md` và các skill liên quan trước. Kiểm tra:

```powershell
git status --short
git branch --show-current
git diff
git log -5 --oneline
```

Xác nhận commit cần triển khai đã có trên remote `aws-deploy`, đã review và có kết quả kiểm thử phù hợp. Thay đổi chưa commit trên máy không nằm trong build của GitHub. Không stage/commit/push thay đổi của người khác; không đổi branch trong working tree đang có công việc chưa lưu.

Service hợp lệ: `auth,user,fitness,gym,payment,ai`. Danh sách dùng dấu phẩy, ví dụ `user,fitness`. Không nhập tên package hoặc tên Lambda vào ô `services`.

Đọc [service-impact-map.json](../../ci/service-impact-map.json) khi sửa `backend/shared`, lockfile hoặc công cụ build vì ảnh hưởng có thể lan sang nhiều service. Với thay đổi schema/migration, cần kế hoạch migration và khả năng tương thích bản cũ riêng trước khi triển khai code.

### Bước 2 — Build gói đúng commit

1. Vào repository → **Actions** → **DEV Build**.
2. Nếu push đã tạo build đúng SHA, dùng run đó. Nếu chạy thủ công, chọn **Run workflow**, nhánh `aws-deploy`.
3. Nhập `services` cụ thể, ví dụ `ai`, rồi chạy.
4. Đợi job `build` của từng service hoàn tất; kiểm tra SHA của run.
5. Trong Artifacts, kiểm tra có `lambda-<service>-<gitSha>` cho đủ service cần deploy.
6. Ghi lại **build run ID**, commit SHA và hash ZIP trong manifest/summary.

Nên chọn service cụ thể khi build thủ công: `auto` dùng diff, và khi không có `github.event.before` sẽ dùng `HEAD~1`; đây không phải phép so sánh với bản đang chạy trên AWS. Build thủ công hiện cũng lọc bỏ tên service không hợp lệ, nên phải kiểm tra artifact thực tế thay vì chỉ nhìn dấu xanh.

Build dùng Node 20, pnpm theo cấu hình dự án (`8.15.0` hiện tại) và Windows runner cho đóng gói Lambda. Gói có dạng:

```text
lambda-ai-<gitSha>/
  ai-<gitSha>.zip
  ai-<gitSha>.manifest.json
```

Manifest lấy `targetFunctions` từ impact map. Ví dụ `ai` cập nhật `fitness-assistant-dev-ai`, `fitness-assistant-dev-ai-jobs`, `fitness-assistant-dev-ai-worker`; `auth` chỉ có function HTTP. Những function migrate hoặc ingest chuyên biệt không tự được thêm vào chỉ vì dùng chung code service.

Artifact GitHub được cấu hình lưu **30 ngày**. Không rebuild commit cũ rồi mặc định hash ZIP sẽ giống gói đã chạy; rollback cần chính gói đã xác nhận.

### Bước 3 — Preflight và xác nhận nguồn rollback

1. Chọn **DEV Read-only Preflight (Lambda baseline + rollback source)**, nhánh `aws-deploy`.
2. `services`: cùng danh sách dự định deploy.
3. `rollback_build_run_id`: build cũ muốn dùng làm rollback nếu có; đây không phải build mới sắp triển khai.
4. Chạy và chờ reviewer của environment nếu có yêu cầu.
5. Lưu summary: từng function, `CodeSha256`, `RevisionId`, trạng thái và đường dẫn ZIP trong S3.

Đọc kết quả bằng mắt, kể cả run xanh:

- `State` phải phù hợp và `LastUpdateStatus` không có lỗi/chưa hoàn tất cần xử lý.
- Bản đang chạy phải có nguồn ZIP phục hồi xác định được. `NOT FOUND in S3` nghĩa là workflow chưa tìm ra gói đó, không phải đã có rollback.
- Hash gói S3 phải `MATCH`; candidate rollback phải có ZIP đúng hash manifest và đúng service.
- Nếu mục tiêu là phục hồi chính baseline, kiểm tra candidate có `currently running: YES` cho phạm vi tương ứng. Candidate khác baseline cần bằng chứng đã được xác nhận dùng được.

**Giới hạn hiện tại:** không tìm thấy gói S3 không nhất thiết làm preflight fail; bước đối chiếu rollback candidate cũng chỉ in `MATCH/MISMATCH`, không chặn mismatch bằng exit code riêng. Người vận hành phải dừng khi nguồn rollback chưa rõ. Preflight dùng cùng role có khả năng deploy, nhưng các lệnh của workflow này chỉ đọc AWS; nó không phải role IAM chỉ có quyền read.

### Bước 4 — Chạy dry run của deploy

1. Chọn **DEV Application Deploy (Lambda code)**, nhánh `aws-deploy`.
2. Nhập `build_run_id` ở bước 2, `services` đúng danh sách, giữ `dry_run=true`.
3. Đọc plan: Git SHA lấy từ manifest, hash ZIP, S3 key, các Lambda đích phải khớp dự định.

Dry run tải artifact và kiểm tra hash, nhưng không assume AWS role, không kiểm tra quyền AWS thực tế và không smoke ứng dụng. Nó vẫn có thể phải chờ environment reviewer do job tham chiếu `dev`.

**Phải tự kiểm tra nguồn build:** deploy hiện chưa ràng buộc đầy đủ build run với nhánh/commit được phê duyệt. Chỉ dùng run thành công của `dev-build.yml` trong đúng repository, đúng SHA, có đủ artifact. Dòng `commit` trong summary deploy là SHA của workflow run; SHA **code được triển khai** nằm trong manifest (`gitSha`) và log từng service. Hai SHA có thể khác khi triển khai build cũ.

### Bước 5 — Triển khai thật sau khi được duyệt

Khi chủ dự án đã duyệt phạm vi, build ID và rollback target, chạy lại cùng workflow, cùng branch, cùng `build_run_id`, cùng `services`, đổi **`dry_run=false`**. Reviewer kiểm tra rồi **Approve and deploy** nếu environment đang yêu cầu.

Workflow sẽ kiểm tra hash → assume role OIDC → kiểm tra identity → ghi trạng thái scheduler → lưu hash code trước deploy → upload ZIP vào S3 → update code các function → chờ cập nhật → health smoke → đối chiếu scheduler.

S3 key có dạng:

```text
ci-artifacts/<service>/<gitSha>/<sha256-hex>.zip
```

Pipeline cập nhật lần lượt các service/function, **không phải giao dịch nguyên tử**. Nếu lỗi giữa chừng, một phần fleet có thể đã đổi code. Không cancel một deploy đang chạy rồi mặc định hệ thống chưa thay đổi. Các workflow DEV dùng chung concurrency group `gymini-dev-deploy`, `cancel-in-progress=false`; tránh xếp chồng nhiều yêu cầu.

### Bước 6 — Xác nhận sau deploy

- Đọc toàn bộ job, summary và trạng thái từng function; lưu URL run.
- Smoke tự động chỉ kiểm tra `/health`: auth qua HTTP API, các service Lambda còn lại qua synthetic HTTP event gửi trực tiếp Lambda.
- Scheduler phải giữ nguyên so với trước deploy.
- Kiểm tra nghiệp vụ chịu ảnh hưởng bằng tài khoản/dữ liệu test phù hợp, ghi rõ bước nào được chạy và kết quả. Kiểm tra AI gọi provider, gửi email hay thanh toán cần phạm vi cho phép riêng.
- Không kết luận toàn bộ hệ thống hoạt động chỉ vì `/health` trả 200; jobs/worker, auth, database và hành trình người dùng cần bằng chứng riêng tùy thay đổi.

## 5. Chạy bằng GitHub CLI

Đây là lệnh mẫu cho người đã được cấp quyền. Thay ID ví dụ bằng run thực tế. `gh auth login` chỉ cần nếu chưa đăng nhập; không paste token vào hội thoại.

```powershell
gh auth status
gh workflow list --repo trmizy/fitness-assistant

# Chỉ build, không ghi AWS.
gh workflow run dev-build.yml --repo trmizy/fitness-assistant --ref aws-deploy -f services=ai
gh run list --repo trmizy/fitness-assistant --workflow dev-build.yml --branch aws-deploy --limit 5

# Lấy đúng ID từ danh sách/URL, đối chiếu headSha rồi mới sử dụng.
$buildRunId = 'THAY_BANG_BUILD_RUN_ID'
gh run view $buildRunId --repo trmizy/fitness-assistant --json databaseId,headSha,headBranch,conclusion,url

# Preflight read-only; có thể phải được approve qua GitHub.
gh workflow run dev-preflight.yml --repo trmizy/fitness-assistant --ref aws-deploy -f services=ai

# Dry run của deploy.
gh workflow run dev-deploy.yml --repo trmizy/fitness-assistant --ref aws-deploy -f build_run_id=$buildRunId -f services=ai -f dry_run=true
```

Sau khi có phê duyệt triển khai thật, dùng cùng lệnh `dev-deploy.yml` và đổi thành `-f dry_run=false`. Mỗi lần dispatch tạo **run ID mới**; `$buildRunId` luôn giữ ID của DEV Build, không thay bằng ID dry run/preflight. Để theo dõi một run đã xác định:

```powershell
gh run watch RUN_ID --repo trmizy/fitness-assistant --exit-status
```

## 6. Chat ECS, API Gateway và các thay đổi ngoài code Lambda

### Chat ECS

Chạy `DEV Chat Deploy (ECS)` trên `aws-deploy`, bắt đầu với `dry_run=true`, `force_on=false`. Dry run vẫn build Docker image trên runner. Chạy thật cần duyệt, đổi `dry_run=false`; workflow push image gắn Git SHA, resolve digest, tạo task definition revision và cập nhật ECS.

- Giữ `force_on=false` để bảo toàn trạng thái bật/tắt. Chỉ đặt `force_on=true` khi chủ dự án yêu cầu bật chat, vì có thể tạo chi phí runtime.
- Ghi lại image digest, task definition trước/sau và desired count.
- Chat đang OFF có thể chỉ đăng ký revision; nếu có `CHAT_SERVICE_UPDATE_DEFERRED`, việc pin revision cho service bị hoãn. Không báo ứng dụng đang chạy bản mới khi chưa xác nhận.
- `NOT_RUN` health khi chat OFF không chứng minh websocket/chat hoạt động. Cần kiểm tra khi môi trường được bật có chủ đích.

### API Gateway

1. Kiểm tra nhánh `aws-deploy` và biến `APIGW_ADOPTION_COMPLETE=true` đã được người có trách nhiệm xác nhận. Không tự set biến để vượt gate.
2. Chạy `DEV Infrastructure Plan (API Gateway)`; `allowlist_file` để trống nếu không có ngoại lệ đã review.
3. Review `changes.json`, `verdict.json`, `semantic-diff.json`, `plan-artifact.json` và summary. Plan có ghi S3/tạo change set, không phải read-only preflight.
4. Nếu NOOP thì không apply. Nếu có thay đổi được duyệt, lấy đúng `change_set_name`, `reviewed_digest`, `reviewed_proposed_template_digest` từ cùng plan.
5. Chạy `DEV Infrastructure Apply (API Gateway)` với ba giá trị trên và chờ reviewer của `dev-infra`.
6. Kiểm tra API ID giữ nguyên, route parity, `/health` và kết quả drift. Workflow chỉ khởi tạo drift detection, cần xem trạng thái/kết quả tiếp theo nếu muốn kết luận drift sạch.

Plan hiện đọc `infra/cloudformation/api-gateway-baseline.yaml`; không mặc định mọi thay đổi trong `api-gateway-additions.yaml` hay `dev-on-demand.yaml` đều được workflow này apply. Gate route parity có `-AllowKnownSourceOnly`, vì vậy dấu xanh không chứng minh mọi route trong source đã có trên AWS.

### Migration, configuration, secrets, frontend và lifecycle

`dev-deploy.yml` chỉ cập nhật code Lambda. Không tự chạy Prisma migration, không đổi Lambda environment/configuration, không rotate secrets, không đổi scheduler hay bật/tắt DEV. Những việc đó cần runbook và phê duyệt tương ứng. Frontend/web và mobile cần quy trình riêng; không tạo workflow mới trong lúc chỉ được yêu cầu deploy backend.

## 7. Rollback khi có sự cố

**Không có automatic rollback trong các workflow này.** Lưu bằng chứng, xác định function/service nào đã đổi trước khi chọn cách xử lý. Không rerun toàn bộ deploy một cách máy móc khi có lỗi sau mutation.

### Lambda

Đường thuận tiện nếu artifact GitHub cũ vẫn còn: chọn đúng build cũ đã xác nhận, dry run với `build_run_id` cũ, review manifest/hash và schema compatibility, rồi sau phê duyệt triển khai lại gói cũ bằng `dev-deploy.yml`.

Nếu artifact GitHub đã hết hạn nhưng có ZIP cũ đúng hash trong S3, pipeline hiện không có input deploy trực tiếp S3 key; chuyển người phụ trách thực hiện recovery có review từ gói đó. `CodeSha256` chỉ là fingerprint, không đủ để khôi phục nếu không tìm được gói tương ứng. Không chọn tùy ý artifact có tên gần giống.

Nếu các function của cùng service trước đó chạy các hash khác nhau, một build chung có thể không khôi phục chính xác từng function. Cần kế hoạch phục hồi theo function trước khi thao tác.

### Chat và hạ tầng

- Chat: phục hồi task definition revision/image digest trước đó bằng thao tác ECS đã review, bảo toàn desired count; workflow chat hiện không có input chọn revision rollback.
- API Gateway: ưu tiên forward-fix bằng change set mới đã review. Không xóa stack, tạo lại API hay tự rollback thủ công tài nguyên đã import.
- Database: rollback code không xóa migration hoặc hoàn tác dữ liệu. Kiểm tra khả năng bản cũ đọc schema/dữ liệu mới; phục hồi dữ liệu cần backup và phương án riêng được duyệt.

Sau phục hồi vẫn cần health smoke, kiểm tra nghiệp vụ và tính toàn vẹn dữ liệu liên quan; không kết luận đã rollback thành công chỉ vì lệnh update kết thúc.

## 8. Chẩn đoán nhanh

| Hiện tượng | Kiểm tra / xử lý |
|---|---|
| Workflow chờ approval | Review environment và người duyệt; không bỏ gate |
| Không có artifact cho service | Đúng build run, đúng SHA, matrix build không bị skip, tên service hợp lệ, artifact còn hạn |
| Artifact hash mismatch | Dừng; đối chiếu nguồn artifact/manifest; không sửa hash để qua gate |
| OIDC/AccessDenied | Repo, environment, branch rule, trust policy, role và account; không thay bằng access key cá nhân hay mở AdministratorAccess |
| `CI_ACTIVATION_BLOCKED` | Adoption chưa xác nhận/biến chưa đúng; nhờ người phụ trách kiểm tra thực tế |
| `DEPLOY_BRANCH_BLOCKED` | Workflow chạy sai ref; chọn lại `aws-deploy` sau khi kiểm tra SHA |
| Template/digest mismatch | Review lại, tạo plan mới; không sửa digest theo giá trị báo lỗi để ép apply |
| Health lỗi sau update | Xác định code đã đổi ở đâu, đọc log đã che secret, kiểm tra dependencies và rollback target |
| Workflow xanh có `NOT_RUN`/`BLOCKED` | Đọc summary/test log: thiếu DB/provider có thể được phân loại không blocking; không gọi đó là test pass |
| Build chat lỗi trên runner | Đọc log build thực tế; workflow có ghi nhận hạn chế runner trước đây, chưa chứng minh lỗi hiện tại cùng nguyên nhân |
| Deploy AI xong nhưng ingest chưa đổi | Đối chiếu `targetFunctions`; function ingest chuyên biệt không nằm trong map deploy Lambda hiện tại |

Không in toàn bộ Lambda configuration, ECS task definition, env hoặc URL tải code ký sẵn vào log bàn giao. Trích thông tin hẹp cần cho chẩn đoán.

## 9. Mẫu giao việc cho Claude Code của cộng sự

Copy đoạn dưới vào Claude Code trong checkout của cộng sự. Claude cần đọc file trong repository; không có việc “học vĩnh viễn” chỉ nhờ gửi một tài liệu trong hội thoại.

```text
Bạn đang làm việc trên Gymini (fitness-assistant).
Đọc AGENTS.md, CLAUDE.md, docs/deployment/GITHUB_ACTIONS_DEPLOY_GUIDE_VI.md
và skill gymini-default-engineering-rules, gymini-ai-governance,
gymini-parallel-agent-safety, gymini-real-e2e-verification tại đường dẫn
thực tế trong checkout. Chỉ dẫn hiện hành và mã nguồn được ưu tiên hơn báo cáo cũ.

Nhiệm vụ ban đầu: chuẩn bị kế hoạch deploy AWS DEV cho service [DANH_SACH],
commit [SHA_DA_REVIEW], không tự triển khai thật khi chưa được cho phép.

1. Kiểm tra git status/branch/diff/log; bảo toàn thay đổi của người khác.
2. Đọc workflow và scripts thực tế; xác định code deploy, config, migration,
   API Gateway, chat hay frontend thuộc luồng nào.
3. Kiểm tra commit remote, kết quả CI và các NOT_RUN/BLOCKED trong phạm vi.
4. Xác định build run ID, manifest gitSha, SHA-256 và targetFunctions.
5. Chuẩn bị baseline, nguồn ZIP rollback, hash và schema compatibility.
6. Trong phạm vi được cấp, thực hiện kiểm tra read-only/dry run trước;
   trước mutation, trình bày account/region/service/function/build ID/SHA,
   tác động dữ liệu, rollback target và phần chưa kiểm chứng để chủ dự án duyệt.
7. Sau khi được duyệt đúng phạm vi, tiến hành và lưu URL run/bằng chứng;
   không hỏi lại cho cùng hành động đã được cho phép, nhưng dừng nếu phạm vi đổi.
8. Báo cáo chính xác CODE AUDIT, REAL HTTP/API, REAL BROWSER,
   BACKEND INTEGRATION hoặc TEST FIXTURE; chỉ nhận pass khi đã chạy có kết quả.

Không tự commit/push/merge; không force-push/reset/clean hay ghi đè code người khác.
Không tự đổi IAM, secrets, scheduler, lifecycle, migration hoặc mở production.
Không gọi LLM trả phí hay dùng dữ liệu production làm test khi chưa được phép.
Không bật Ollama/knowledge-worker; tuân thủ owner lock local Ollama.
Nếu bị gate chặn, nêu gate và bằng chứng, không bypass.
```

Để Claude dễ tìm tài liệu ở những phiên sau, cộng sự có thể yêu cầu thêm đường dẫn này vào `CLAUDE.md` của checkout sau khi review. Tài liệu này không tự thay đổi hướng dẫn hay quyền của Claude.

## 10. Mẫu ghi nhận một lần deploy

```text
Môi trường/account/region:
Người yêu cầu và phạm vi được duyệt:
Service / function đích:
Commit code trong manifest:
Commit workflow deploy:
Build run URL / ID:
Dry-run URL / ID và kết quả:
Preflight URL / ID:
Baseline hash từng function:
Rollback build ID hoặc S3 key + hash đã kiểm tra:
Migration/config thay đổi và khả năng tương thích:
Deploy run URL / ID, thời gian (Asia/Saigon):
Kết quả update từng function/service:
Health smoke:
Kiểm tra nghiệp vụ đã chạy + loại bằng chứng:
Kiểm tra chưa chạy / NOT_RUN / BLOCKED:
Scheduler/power state trước và sau:
Sự cố / quyết định rollback / phần việc còn lại:
```

Các file để đọc tiếp: [Build-LambdaArtifact.ps1](../../scripts/ci/Build-LambdaArtifact.ps1), [Get-ChangedServices.ps1](../../scripts/ci/Get-ChangedServices.ps1), [CiHelpers.psm1](../../scripts/ci/CiHelpers.psm1), [Test-DeploymentSafety.ps1](../../scripts/ci/Test-DeploymentSafety.ps1), [smoke-matrix.json](../../ci/smoke-matrix.json). Với lifecycle, đọc [AWS DEV daily start/stop runbook](AWS_DEV_DAILY_START_STOP_RUNBOOK.md) và kiểm tra scripts hiện hành trước thao tác.
