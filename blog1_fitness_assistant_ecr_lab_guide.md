# Blog 1 — Từ Development đến Production: Tối ưu Docker Image cho Microservices và lưu trữ trên Amazon ECR

## 1. Mục tiêu của bài blog

Blog 1 không nên chỉ là một bài giới thiệu Docker hay Amazon ECR. Mục tiêu là thực hiện một **case study thật trên dự án Fitness Assistant** để trả lời câu hỏi:

> **Docker image dùng cho development có phù hợp để triển khai production không, và chúng ta có thể cải thiện quy trình container hóa Fitness Assistant như thế nào trước khi lưu image trên Amazon ECR?**

Trong bài này, sử dụng `fitness-service` làm service nghiên cứu chính vì service này hiện có cả:

- `backend/services/fitness-service/Dockerfile.dev`
- `backend/services/fitness-service/Dockerfile`

Hai Dockerfile này cho phép so sánh trực tiếp giữa:

- Development image
- Production image

Sau đó, production image sẽ được:

1. Gắn version theo Git commit SHA.
2. Push lên Amazon ECR.
3. Kiểm tra lại bằng thao tác pull.
4. Kiểm thử immutable tag.
5. Thu thập số liệu thật để viết phần kết quả.

---

# 2. Nguồn AWS chính thống dùng làm tiền đề

Nguồn chính:

- AWS Containers Blog — **Building better container images**
- Amazon ECR User Guide
- Amazon ECR — Creating repositories
- Amazon ECR — Pushing Docker images
- Amazon ECR — Pulling Docker images

Các nguyên tắc AWS cần áp dụng vào bài:

- Dùng base image đáng tin cậy.
- Dùng multi-stage build.
- Chỉ đưa thành phần cần thiết vào runtime image.
- Không đưa secret vào Docker image.
- Sử dụng `.dockerignore`.
- Không chỉ phụ thuộc vào tag `latest`.
- Gắn version cụ thể cho image.
- Dùng Amazon ECR để lưu trữ image.
- Có thể dùng immutable tag để tránh overwrite image cũ.

---

# 3. Kiến trúc tổng thể của bài

```text
Fitness Assistant source
        │
        ├──────── Dockerfile.dev
        │              │
        │              ▼
        │        Development Image
        │
        │
        └──────── Dockerfile
                       │
                       ▼
                Production Image
                       │
                  đo / phân tích
                       │
                       ▼
                  Version Tag
                       │
                       ▼
                  Amazon ECR
                       │
                       ▼
                 Pull Verification
                       │
                       ▼
                  EC2 Deployment
```

---

# 4. Service được chọn để nghiên cứu

Repo `fitness-assistant` hiện có nhiều backend service:

```text
ai-service
auth-service
chat-service
fitness-service
gym-service
payment-service
user-service
```

Trong Blog 1 chỉ chọn:

```text
fitness-service
```

làm case study chính.

Lý do:

- Đây là service đại diện cho nghiệp vụ cốt lõi của Fitness Assistant.
- Có cả `Dockerfile.dev` và `Dockerfile`.
- Có Prisma.
- Có TypeScript build.
- Có dependency production và development.
- Có thể phân tích rõ sự khác biệt giữa image phục vụ development và image phục vụ production.

---

# 5. Phân tích Dockerfile hiện tại trước khi chạy lab

## 5.1 Development Dockerfile

File:

```text
backend/services/fitness-service/Dockerfile.dev
```

Dockerfile development hiện dùng:

```dockerfile
FROM node:20-alpine
```

Sau đó cài:

```text
openssl
wget
pnpm
```

Và chạy:

```text
prisma db push
prisma db seed
pnpm run dev
```

Có thể hình dung:

```text
Development Container
        │
        ├── Node.js
        ├── pnpm
        ├── TypeScript tooling
        ├── tsx/watch
        ├── Prisma tooling
        ├── source code
        └── development startup
```

Mục đích của container này là:

- Phục vụ developer.
- Reload code nhanh.
- Chạy TypeScript trực tiếp.
- Hỗ trợ database development.
- Không tối ưu riêng cho production.

---

## 5.2 Production Dockerfile

File:

```text
backend/services/fitness-service/Dockerfile
```

Dockerfile production hiện được chia nhiều stage:

```text
base
 ↓
deps
 ↓
builder
 ↓
runner
```

Đây là kiến trúc multi-stage build.

Ý nghĩa:

### Stage `base`

Chuẩn bị Node.js và pnpm.

### Stage `deps`

Cài dependency.

### Stage `builder`

- Build shared package.
- Generate Prisma client.
- Compile TypeScript.

### Stage `runner`

Chỉ copy những gì cần để chạy service.

Production container đặt:

```dockerfile
ENV NODE_ENV=production
```

Và entrypoint cuối chạy application đã build:

```text
node dist/server.js
```

---

# 6. Nguyên tắc quan trọng trước khi bắt đầu

## Không sửa Dockerfile ngay

Lần đầu tiên phải lấy **baseline thật**.

Cần đo:

```text
Development image
vs
Production image hiện tại
```

Thu thập:

- Image size.
- Number of layers.
- Build duration.
- Docker history.
- Runtime environment.
- Dependency footprint.

Sau khi có baseline mới quyết định có nên tối ưu production Dockerfile tiếp hay không.

Không nên:

```text
sửa Dockerfile trước
↓
build
↓
không còn số liệu BEFORE
```

---

# 7. Bước 1 — Chuẩn bị môi trường

Clone repo:

```bash
git clone https://github.com/trmizy/fitness-assistant.git
cd fitness-assistant
git checkout master
git pull
```

Kiểm tra Docker:

```bash
docker --version
```

Kiểm tra AWS CLI:

```bash
aws --version
```

Kiểm tra Git:

```bash
git --version
```

Kiểm tra AWS identity:

```bash
aws sts get-caller-identity
```

Kết quả sẽ có dạng:

```json
{
  "UserId": "...",
  "Account": "...",
  "Arn": "..."
}
```

> Không chụp hoặc công khai Access Key, Secret Access Key, Session Token.

---

## Ảnh cần chụp #1

Terminal hiển thị:

```text
docker --version
aws --version
git --version
aws sts get-caller-identity
```

Tên file gợi ý:

```text
01-environment.png
```

---

# 8. Bước 2 — Build Development Image

## Quan trọng về build context

Dockerfile đang copy các path như:

```text
backend/...
```

Do đó phải chạy lệnh build từ:

```text
fitness-assistant/
```

là root của repository.

Không nên:

```bash
cd backend/services/fitness-service
docker build .
```

vì build context có thể thiếu các file ở root và `backend/shared`.

---

## Linux / macOS / Git Bash

```bash
docker build \
  -f backend/services/fitness-service/Dockerfile.dev \
  -t fitness-service:dev \
  .
```

## Windows PowerShell

```powershell
docker build -f backend/services/fitness-service/Dockerfile.dev -t fitness-service:dev .
```

---

# 9. Bước 3 — Ghi kích thước Development Image

Sau khi build thành công:

```bash
docker images fitness-service
```

Hoặc:

```bash
docker images fitness-service:dev
```

Kết quả ví dụ:

```text
REPOSITORY       TAG     IMAGE ID       CREATED         SIZE
fitness-service  dev     xxxxxxxxxxxx   1 minute ago    XXXMB
```

> Không điền `XXXMB` bằng số tự đoán. Phải ghi số thật từ Docker.

Có thể kiểm tra raw size:

```bash
docker image inspect fitness-service:dev --format='{{.Size}}'
```

---

## Ghi dữ liệu vào bảng

| Metric | Development | Production |
|---|---:|---:|
| Image size | `___ MB` | |
| Layer count | `___` | |
| Build duration | `___ s` | |
| Development watcher | Yes | |
| NODE_ENV=production | No/Default | |
| Stored in ECR | No | |

---

## Ảnh cần chụp #2

```bash
docker images fitness-service
```

Tên gợi ý:

```text
02-development-image.png
```

---

# 10. Bước 4 — Xem Docker Layers của Development Image

Chạy:

```bash
docker history fitness-service:dev
```

Lệnh này cho thấy các layer được tạo bởi:

- `RUN`
- `COPY`
- `WORKDIR`
- `ENV`
- các bước Dockerfile khác.

---

## Ý cần giải thích sau này trong blog

Docker image không phải một file nguyên khối.

Có thể hình dung:

```text
Image
│
├── Layer 1 — Base Node image
├── Layer 2 — Install tools
├── Layer 3 — Copy package files
├── Layer 4 — Install dependencies
├── Layer 5 — Copy source/config
└── Layer 6 — Runtime config
```

Cách tổ chức Dockerfile ảnh hưởng đến:

- Cache.
- Build time.
- Image size.
- Maintainability.
- Security surface.

---

## Ảnh cần chụp #3

Output:

```bash
docker history fitness-service:dev
```

Tên gợi ý:

```text
03-development-history.png
```

---

# 11. Bước 5 — Build Production Image

Từ root repo:

## Linux / macOS / Git Bash

```bash
docker build \
  -f backend/services/fitness-service/Dockerfile \
  -t fitness-service:prod \
  .
```

## Windows PowerShell

```powershell
docker build -f backend/services/fitness-service/Dockerfile -t fitness-service:prod .
```

---

# 12. Bước 6 — So sánh Development và Production Image

Chạy:

```bash
docker images fitness-service
```

Kết quả dự kiến dạng:

```text
REPOSITORY       TAG     IMAGE ID       CREATED       SIZE
fitness-service  prod    xxxxxxxxxxxx   ...           XXXMB
fitness-service  dev     yyyyyyyyyyyy   ...           XXXMB
```

---

## Tuyệt đối không kết luận trước

Không viết:

```text
Production image chắc chắn nhỏ hơn development image.
```

cho tới khi đo thật.

Multi-stage build **thường có lợi**, nhưng production image hiện tại vẫn copy nhiều `node_modules` từ builder sang runner, nên kích thước cuối cần được đo thực tế.

Nếu kết quả là:

```text
dev  = 500 MB
prod = 560 MB
```

vẫn ghi đúng.

Đó có thể trở thành một phát hiện kỹ thuật thú vị.

---

## Ảnh cần chụp #4

Chụp cả:

```text
fitness-service:dev
fitness-service:prod
```

trên cùng màn hình.

Tên:

```text
04-dev-vs-prod.png
```

---

# 13. Bước 7 — So sánh Docker History

Development:

```bash
docker history fitness-service:dev
```

Production:

```bash
docker history fitness-service:prod
```

So sánh:

- Base image.
- RUN layers.
- COPY layers.
- Build dependency.
- Runtime dependency.

---

## Ghi lại Layer count

Linux/macOS:

```bash
docker history --no-trunc fitness-service:dev | wc -l
docker history --no-trunc fitness-service:prod | wc -l
```

Windows có thể chỉ cần dùng:

```powershell
docker history fitness-service:dev
docker history fitness-service:prod
```

và đếm thủ công nếu cần.

---

# 14. Bước 8 — Kiểm tra Production Environment

Chạy:

```bash
docker inspect fitness-service:prod --format='{{.Config.Env}}'
```

Tìm:

```text
NODE_ENV=production
```

Điều này cho thấy production image đã được cấu hình riêng cho runtime production.

---

# 15. Bước 9 — Phân tích `.dockerignore`

File:

```text
.dockerignore
```

Repo hiện loại các thành phần như:

```text
.git
node_modules
**/node_modules
dist
.env
.env.*
**/.env
*.log
training/outputs
training/checkpoints
...
```

---

## Tại sao `.dockerignore` quan trọng

Build context có thể hình dung như:

```text
Repository
│
├── source                → gửi vào Docker build context
├── package.json          → gửi
├── pnpm-lock.yaml        → gửi
│
├── node_modules          X
├── .env                  X
├── .git                  X
├── log files             X
└── training artifacts    X
```

Lợi ích:

- Giảm lượng file gửi vào Docker daemon.
- Build nhanh hơn.
- Tránh copy nhầm secret.
- Tránh đưa local `node_modules` vào image.
- Giảm nguy cơ làm image phình to.

---

## Ảnh cần chụp #5

Một đoạn `.dockerignore` có:

```text
.git
node_modules
.env
*.log
```

Tên:

```text
05-dockerignore.png
```

---

# 16. Bước 10 — Đo Build Duration

Nên đo build time thật.

## Linux / macOS

```bash
time docker build \
  -f backend/services/fitness-service/Dockerfile.dev \
  -t fitness-service:dev-test \
  .
```

Production:

```bash
time docker build \
  -f backend/services/fitness-service/Dockerfile \
  -t fitness-service:prod-test \
  .
```

---

## Windows PowerShell

```powershell
Measure-Command {
  docker build -f backend/services/fitness-service/Dockerfile.dev -t fitness-service:dev-test .
}
```

Production:

```powershell
Measure-Command {
  docker build -f backend/services/fitness-service/Dockerfile -t fitness-service:prod-test .
}
```

---

## Ghi số liệu

| Metric | Development | Production |
|---|---:|---:|
| Build duration cold/warm | ___ s | ___ s |
| Image size | ___ MB | ___ MB |
| Layer count | ___ | ___ |

Nếu Docker cache ảnh hưởng lớn, ghi chú rõ:

```text
Cold build
Warm build
```

Không trộn hai loại thời gian.

---

# 17. Bước 11 — Kiểm tra Git Commit hiện tại

Chạy:

```bash
git rev-parse --short HEAD
```

Ví dụ:

```text
355735f
```

> Đây chỉ là ví dụ. Luôn dùng SHA thật tại thời điểm thực hiện lab.

---

# 18. Bước 12 — Build Production Image với Git SHA Tag

## Linux / Git Bash

```bash
GIT_SHA=$(git rev-parse --short HEAD)
```

Kiểm tra:

```bash
echo $GIT_SHA
```

Build:

```bash
docker build \
  -f backend/services/fitness-service/Dockerfile \
  -t fitness-service:$GIT_SHA \
  .
```

---

## Windows PowerShell

```powershell
$GIT_SHA = git rev-parse --short HEAD
```

Build:

```powershell
docker build -f backend/services/fitness-service/Dockerfile -t fitness-service:$GIT_SHA .
```

---

# 19. Vì sao dùng Git SHA

Không nên chỉ dùng:

```text
fitness-service:latest
```

Vì `latest` không nói rõ image được build từ source code nào.

Với Git SHA:

```text
Source commit
    ↓
355735f
    ↓
Docker image tag
    ↓
fitness-service:355735f
```

Nhờ đó có thể trace:

```text
Image
→ Git commit
→ Source code
→ Deployment version
```

---

# 20. Bước 13 — Kiểm tra AWS Region

Chạy:

```bash
aws configure get region
```

Nếu không có region:

```bash
aws configure
```

Ví dụ:

```text
ap-southeast-1
```

> Không copy region ví dụ nếu account của bạn dùng region khác.

---

## Linux / Git Bash

```bash
AWS_REGION=$(aws configure get region)
```

Account ID:

```bash
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
```

---

## Windows PowerShell

```powershell
$AWS_REGION = aws configure get region
$AWS_ACCOUNT_ID = aws sts get-caller-identity --query Account --output text
```

---

# 21. Bước 14 — Tạo Amazon ECR Repository

Tên repository đề xuất:

```text
fitness-assistant/fitness-service
```

Có thể tạo bằng AWS Console hoặc CLI.

---

## Cách A — AWS Console

Đi theo:

```text
AWS Console
→ Amazon ECR
→ Private repositories
→ Create repository
```

Repository name:

```text
fitness-assistant/fitness-service
```

Image tag mutability:

```text
Immutable
```

---

## Vì sao chọn Immutable

Nếu tag đã tồn tại:

```text
fitness-service:355735f
```

thì không cho phép push image khác đè lên cùng tag đó.

Điều này tạo traceability tốt:

```text
Git SHA
   ↓
Image tag
   ↓
Image digest
```

Một tag tương ứng với một version xác định.

---

## Ảnh cần chụp #6

Trang Create repository có:

```text
Repository name
Image tag mutability = Immutable
```

Tên:

```text
06-create-ecr-repository.png
```

---

# 22. Cách B — Tạo ECR bằng CLI

## Linux / Git Bash

```bash
aws ecr create-repository \
  --repository-name fitness-assistant/fitness-service \
  --image-tag-mutability IMMUTABLE \
  --region $AWS_REGION
```

## Windows PowerShell

```powershell
aws ecr create-repository `
  --repository-name fitness-assistant/fitness-service `
  --image-tag-mutability IMMUTABLE `
  --region $AWS_REGION
```

---

# 23. Bước 15 — Kiểm tra Repository đã tạo

```bash
aws ecr describe-repositories \
  --repository-names fitness-assistant/fitness-service
```

Kết quả sẽ cho biết:

- Repository ARN.
- Registry ID.
- Repository URI.
- Image tag mutability.
- CreatedAt.

---

# 24. Bước 16 — Docker Login vào Amazon ECR

## Linux / Git Bash

```bash
aws ecr get-login-password \
  --region $AWS_REGION |
docker login \
  --username AWS \
  --password-stdin \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com
```

---

## Windows PowerShell

```powershell
aws ecr get-login-password --region $AWS_REGION |
docker login --username AWS --password-stdin "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com"
```

Kết quả:

```text
Login Succeeded
```

---

## Ảnh cần chụp #7

Chụp:

```text
Login Succeeded
```

Không để lộ:

- AWS Access Key.
- Secret.
- Token.

Tên:

```text
07-ecr-login.png
```

---

# 25. Bước 17 — Tag Production Image cho ECR

Giả sử:

```text
GIT_SHA=355735f
```

URI:

```text
AWS_ACCOUNT_ID.dkr.ecr.AWS_REGION.amazonaws.com/fitness-assistant/fitness-service
```

---

## Linux / Git Bash

```bash
docker tag \
  fitness-service:$GIT_SHA \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/fitness-assistant/fitness-service:$GIT_SHA
```

---

## Windows PowerShell

```powershell
docker tag `
  "fitness-service:$GIT_SHA" `
  "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/fitness-assistant/fitness-service:$GIT_SHA"
```

---

# 26. Bước 18 — Kiểm tra Local Tags

```bash
docker images
```

Bạn sẽ thấy cả:

```text
fitness-service:355735f

ACCOUNT.dkr.ecr.REGION.amazonaws.com/fitness-assistant/fitness-service:355735f
```

Hai tag có thể trỏ tới cùng một IMAGE ID.

---

# 27. Bước 19 — Push Image lên ECR

## Linux / Git Bash

```bash
docker push \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/fitness-assistant/fitness-service:$GIT_SHA
```

---

## Windows PowerShell

```powershell
docker push "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/fitness-assistant/fitness-service:$GIT_SHA"
```

Kết quả cuối thường có:

```text
digest: sha256:...
```

Ghi lại:

```text
Image tag
Image digest
Push time
```

---

## Ảnh cần chụp #8

Terminal lúc push xong.

Tên:

```text
08-ecr-push.png
```

---

# 28. Bước 20 — Kiểm tra Image trên AWS Console

Vào:

```text
Amazon ECR
→ Private repositories
→ fitness-assistant/fitness-service
```

Kiểm tra:

```text
Image tag
Image URI
Digest
Pushed at
Size
```

---

## Ghi dữ liệu thật

| Field | Value |
|---|---|
| Repository | fitness-assistant/fitness-service |
| Image tag | ___ |
| Image digest | sha256:___ |
| Image size | ___ MB |
| Pushed at | ___ |

---

## Ảnh cần chụp #9

Trang ECR có image vừa push.

Tên:

```text
09-ecr-image-details.png
```

---

# 29. Bước 21 — Xác minh Pull từ ECR

Mục đích:

Chứng minh image không chỉ push thành công mà còn có thể lấy lại từ ECR.

---

## Xóa local ECR tag

Linux:

```bash
docker rmi \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/fitness-assistant/fitness-service:$GIT_SHA
```

Windows:

```powershell
docker rmi "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/fitness-assistant/fitness-service:$GIT_SHA"
```

---

## Pull lại

Linux:

```bash
docker pull \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/fitness-assistant/fitness-service:$GIT_SHA
```

Windows:

```powershell
docker pull "$AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/fitness-assistant/fitness-service:$GIT_SHA"
```

---

## Kết quả mong đợi

```text
Pull complete
Digest: sha256:...
```

Digest nên khớp image trong ECR.

---

## Ảnh cần chụp #10

Tên:

```text
10-ecr-pull-verification.png
```

---

# 30. Bước 22 — Kiểm tra Image Digest

Chạy:

```bash
docker inspect \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/fitness-assistant/fitness-service:$GIT_SHA
```

Có thể tìm:

```text
RepoDigests
```

Ví dụ:

```text
repository@sha256:...
```

So sánh digest này với digest trong AWS ECR Console.

---

# 31. Bước 23 — Test Immutable Tag

Nên dùng một tag test riêng:

```text
blog1-test
```

Không dùng Git SHA production để test lỗi.

---

## Tag image

Linux:

```bash
docker tag \
  fitness-service:prod \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/fitness-assistant/fitness-service:blog1-test
```

Push:

```bash
docker push \
  $AWS_ACCOUNT_ID.dkr.ecr.$AWS_REGION.amazonaws.com/fitness-assistant/fitness-service:blog1-test
```

---

## Build một image khác

Có thể tạo một image khác từ cùng Dockerfile nhưng dùng build thay đổi nhỏ hợp lệ hoặc chỉ dùng một image khác để thử.

Sau đó tag image khác thành:

```text
blog1-test
```

và push lại.

Nếu repository là:

```text
IMMUTABLE
```

ECR phải từ chối overwrite tag cũ.

---

## Mục tiêu của test

Chứng minh:

```text
blog1-test
     │
     ├── First image
     │
     X
     └── Cannot overwrite
```

Điều này giúp tránh việc:

```text
same tag
≠
same content
```

---

## Ảnh cần chụp #11

Chụp lỗi immutable tag.

Tên:

```text
11-immutable-tag-test.png
```

---

# 32. Bước 24 — Thu thập bảng kết quả cuối

Điền số thật.

| Chỉ số | Development Image | Production Image |
|---|---:|---:|
| Dockerfile | `Dockerfile.dev` | `Dockerfile` |
| Build architecture | Single-stage | Multi-stage |
| Image size | ___ MB | ___ MB |
| Build duration | ___ s | ___ s |
| Layer count | ___ | ___ |
| Development watcher | Yes | No |
| TypeScript compile before runtime | No | Yes |
| `NODE_ENV=production` | No | Yes |
| Git SHA version | No | Yes |
| Stored in ECR | No | Yes |
| Immutable ECR tag | No | Yes |

---

# 33. Không ép kết quả phải đẹp

Một bài technical blog tốt phải ghi dữ liệu thật.

Ví dụ nếu:

```text
Development = 480 MB
Production  = 520 MB
```

thì không được sửa số thành:

```text
Development = 800 MB
Production  = 200 MB
```

Thay vào đó phải đặt câu hỏi:

> Tại sao production multi-stage vẫn lớn?

Đây có thể trở thành phần phân tích hay nhất bài.

---

# 34. Phát hiện kỹ thuật cần kiểm tra

Production Dockerfile hiện dùng:

```text
pnpm install --filter @gym-coach/fitness-service --frozen-lockfile
```

và sau đó copy:

```text
/app/node_modules
```

từ builder sang runner.

Trong `fitness-service/package.json` còn có devDependencies như:

```text
@types/express
@types/node
prisma
tsx
typescript
```

Do đó production image có khả năng vẫn mang theo một phần development tooling.

Đây là thứ phải **đo và xác minh**.

---

# 35. Nếu Production Image vẫn lớn — Phase tối ưu nâng cao

Chỉ thực hiện sau khi đã có baseline.

Flow:

```text
Current Production Image
          ↓
Analyze node_modules
          ↓
Identify devDependencies
          ↓
Prune development dependencies
          ↓
Build optimized runner
          ↓
Measure again
```

---

# 36. Một số lệnh phân tích dependency

Kiểm tra node_modules:

```bash
docker run --rm fitness-service:prod sh -c "du -sh /app/node_modules"
```

Kiểm tra service node_modules:

```bash
docker run --rm fitness-service:prod sh -c "du -sh /app/backend/services/fitness-service/node_modules"
```

Kiểm tra package lớn:

```bash
docker run --rm fitness-service:prod sh -c "du -sh /app/node_modules/* 2>/dev/null | sort -h | tail"
```

> Với pnpm, cấu trúc dependency có thể khác npm truyền thống. Chỉ dùng output thật để kết luận.

---

# 37. Kiểm tra có TypeScript tooling trong production image hay không

Ví dụ:

```bash
docker run --rm fitness-service:prod sh -c "which tsc || true"
```

Kiểm tra `tsx`:

```bash
docker run --rm fitness-service:prod sh -c "which tsx || true"
```

Kiểm tra package:

```bash
docker run --rm fitness-service:prod sh -c "ls node_modules/.bin | grep -E 'tsx|tsc|prisma' || true"
```

Nếu thấy những tool không cần runtime, ghi lại để phân tích.

---

# 38. Chạy Production Container để test

Production Dockerfile có thể cần database và environment variable thật.

Nếu đã có môi trường Docker Compose của project, ưu tiên test qua Docker Compose.

Không được tự ý chạy production container với thiếu database rồi kết luận image lỗi.

Cần kiểm tra:

- PostgreSQL.
- Redis nếu service dùng.
- Environment variable.
- Prisma migration.
- Seed behavior.

---

# 39. Checklist screenshot hoàn chỉnh

Nên lưu các ảnh:

```text
01-environment.png
02-development-image.png
03-development-history.png
04-dev-vs-prod.png
05-dockerignore.png
06-create-ecr-repository.png
07-ecr-login.png
08-ecr-push.png
09-ecr-image-details.png
10-ecr-pull-verification.png
11-immutable-tag-test.png
12-final-comparison.png
```

Có thể chụp thêm:

```text
13-prod-history.png
14-git-sha.png
15-image-digest.png
16-runtime-dependency-analysis.png
```

---

# 40. Những thông tin tuyệt đối không để lộ trong screenshot

Không được chụp/công khai:

```text
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_SESSION_TOKEN
DATABASE_URL
JWT_SECRET
API keys
OpenAI keys
Redis password
RDS password
.env content
```

Có thể hiển thị:

```text
AWS Account ID
Region
Repository name
Image tag
Image digest
Image size
```

Nếu muốn an toàn hơn, có thể blur AWS Account ID.

---

# 41. Cách đặt tên ảnh trong blog

Không nên:

```text
Screenshot 2026-08-12 113422.png
Screenshot 2026-08-12 114133.png
```

Nên:

```text
blog1-01-environment.png
blog1-02-dev-image.png
blog1-03-docker-history.png
blog1-04-dev-vs-prod.png
blog1-05-ecr-create.png
blog1-06-ecr-push.png
blog1-07-ecr-image.png
blog1-08-ecr-pull.png
blog1-09-immutable-tag.png
```

---

# 42. Cấu trúc bài Blog 1 sau khi hoàn thành lab

## 42.1 Tiêu đề

> **Từ Development đến Production: Tối ưu Docker Image cho kiến trúc Microservices với Amazon ECR**

---

## 42.2 Mục tiêu

Giải thích ngắn:

- Fitness Assistant sử dụng microservices.
- Local development sử dụng Docker.
- Development image không đồng nghĩa production-ready.
- Bài viết so sánh Development và Production image.
- Áp dụng multi-stage build, `.dockerignore`, version tag.
- Lưu production image trên Amazon ECR.

---

## 42.3 Bối cảnh hệ thống

Giới thiệu:

```text
Fitness Assistant
│
├── API Gateway
├── Auth Service
├── User Service
├── Fitness Service
├── Gym Service
├── Chat Service
├── Payment Service
└── AI Service
```

Chọn:

```text
fitness-service
```

làm case study.

---

## 42.4 Development Container

Giải thích:

- `Dockerfile.dev`.
- Single-stage.
- Chạy `pnpm run dev`.
- Hỗ trợ hot reload.
- Có TypeScript tooling.
- Hợp với developer workflow.

Đưa ảnh:

```text
Development build
docker history
```

---

## 42.5 Production Container

Giải thích multi-stage:

```text
base
↓
deps
↓
builder
↓
runner
```

Điểm chính:

- Compile trước.
- Chạy JavaScript `dist`.
- `NODE_ENV=production`.
- Không chạy watcher.

---

## 42.6 `.dockerignore`

Giải thích:

```text
node_modules
.env
.git
logs
training artifacts
```

không được gửi vào build context.

---

## 42.7 So sánh Development vs Production

Đưa bảng:

| Metric | Dev | Prod |
|---|---:|---:|
| Size | | |
| Build time | | |
| Layers | | |
| Watcher | | |
| NODE_ENV | | |

Phân tích dựa trên số thật.

---

## 42.8 Versioning bằng Git SHA

Giải thích:

```text
git commit
    ↓
Docker tag
    ↓
ECR image
```

Ví dụ:

```text
fitness-service:355735f
```

---

## 42.9 Amazon ECR

Trình bày:

- Tạo repository.
- Immutable tags.
- Docker login.
- Tag.
- Push.
- Image digest.

---

## 42.10 Pull Verification

Chứng minh:

```text
Build local
↓
Push ECR
↓
Remove local tag
↓
Pull ECR
↓
Digest verified
```

---

## 42.11 Immutable Tag Test

Giải thích:

```text
same tag
cannot be overwritten
```

Liên hệ:

```text
Git SHA
+
immutable tag
=
better traceability
```

---

## 42.12 Kết quả

Bảng before/after thật.

Không ghi số giả.

---

## 42.13 Những vấn đề còn tồn tại

Ví dụ nếu phát hiện:

- Production image vẫn có devDependency.
- node_modules còn lớn.
- Prisma CLI vẫn cần runtime cho migrate/seed.
- Runner vẫn chứa tool có thể giảm.

Phải ghi trung thực.

---

## 42.14 Kết luận

Nội dung nên xoay quanh:

- Development và production có mục tiêu khác nhau.
- Multi-stage giúp tách build/runtime.
- `.dockerignore` giảm build context và rủi ro.
- Git SHA giúp trace version.
- ECR cung cấp registry quản lý image.
- Immutable tag giúp tránh overwrite.
- Measurement thực tế quan trọng hơn assumption.

---

# 43. Bảng dữ liệu cần hoàn thiện trong quá trình lab

```markdown
| Metric | Dev | Prod |
|---|---:|---:|
| Image size | TODO | TODO |
| Build time cold | TODO | TODO |
| Build time warm | TODO | TODO |
| Layer count | TODO | TODO |
| Main runtime command | TODO | TODO |
| NODE_ENV | TODO | TODO |
| Image digest | N/A | TODO |
| Git SHA tag | No | Yes |
```

---

# 44. Nhật ký lab

Nên tạo một file riêng:

```text
blog1-lab-notes.md
```

và ghi mỗi lần chạy.

Ví dụ:

```markdown
## Environment

Date:
Region:
Git commit:
Docker version:
AWS CLI version:

## Development build

Command:
Duration:
Image ID:
Size:
Notes:

## Production build

Command:
Duration:
Image ID:
Size:
Notes:

## ECR

Repository:
Tag:
Digest:
Push time:
Pull verification:
```

Việc này giúp tránh quên số liệu lúc viết blog.

---

# 45. Các lỗi thường gặp

## Lỗi 1 — Docker build không tìm thấy `backend/shared`

Nguyên nhân:

Build từ sai directory.

Phải chạy từ:

```text
fitness-assistant/
```

---

## Lỗi 2 — AWS CLI chưa có region

Kiểm tra:

```bash
aws configure get region
```

Cấu hình:

```bash
aws configure
```

---

## Lỗi 3 — `no basic auth credentials`

Login lại:

```bash
aws ecr get-login-password ...
```

---

## Lỗi 4 — Repository does not exist

Kiểm tra:

```bash
aws ecr describe-repositories
```

Tạo repository trước khi push.

---

## Lỗi 5 — ImageTagAlreadyExistsException

Nếu repository immutable:

Đây có thể là hành vi đúng.

Dùng tag mới:

```text
new Git SHA
```

thay vì overwrite tag cũ.

---

## Lỗi 6 — Production container không chạy

Không kết luận ngay Dockerfile sai.

Kiểm tra:

- DATABASE_URL.
- Redis.
- Prisma migration.
- Seed.
- Required env.
- Network.

---

# 46. Flow thao tác ngắn gọn để thực hiện thực tế

## Phase A — Baseline

```bash
docker build -f backend/services/fitness-service/Dockerfile.dev -t fitness-service:dev .
docker build -f backend/services/fitness-service/Dockerfile -t fitness-service:prod .
docker images fitness-service
docker history fitness-service:dev
docker history fitness-service:prod
```

---

## Phase B — Measure

```text
Record:
- Dev size
- Prod size
- Build time
- Layers
```

---

## Phase C — Version

```bash
git rev-parse --short HEAD
```

Build:

```bash
docker build -f backend/services/fitness-service/Dockerfile -t fitness-service:<GIT_SHA> .
```

---

## Phase D — ECR

```text
Create repository
↓
Immutable
↓
Login
↓
Tag
↓
Push
```

---

## Phase E — Verification

```text
Delete local ECR tag
↓
Pull
↓
Compare digest
```

---

## Phase F — Immutable Test

```text
Push blog1-test
↓
Try overwrite blog1-test
↓
ECR rejects
```

---

## Phase G — Analyze

```text
Dev vs Prod
↓
Why?
↓
Can runtime dependencies be reduced?
```

---

# 47. Kết quả cuối cùng Blog 1 cần chứng minh

Blog 1 phải chứng minh được ít nhất 5 điều:

### 1. Development và Production Container khác mục đích

```text
Development
→ developer productivity

Production
→ predictable runtime
```

### 2. Multi-stage build đang được áp dụng

```text
base
deps
builder
runner
```

### 3. Build context được kiểm soát

`.dockerignore`.

### 4. Production image có version rõ ràng

```text
Git SHA
```

### 5. Image được lưu và xác minh trên ECR

```text
push
↓
digest
↓
pull
```

---

# 48. Việc cần làm ngay

Từ root repository:

```bash
docker build -f backend/services/fitness-service/Dockerfile.dev -t fitness-service:dev .
```

Sau đó:

```bash
docker build -f backend/services/fitness-service/Dockerfile -t fitness-service:prod .
```

Sau đó:

```bash
docker images fitness-service
```

Và:

```bash
docker history fitness-service:dev
docker history fitness-service:prod
```

Ghi lại toàn bộ output và screenshot.

**Chưa sửa Dockerfile trước khi có baseline.**

Sau khi có kết quả thật, bước tiếp theo là phân tích xem production image hiện tại có thực sự tối ưu hơn development image hay chưa, từ đó quyết định có cần thêm một vòng tối ưu dependency/runtime trước khi push phiên bản cuối lên Amazon ECR.
