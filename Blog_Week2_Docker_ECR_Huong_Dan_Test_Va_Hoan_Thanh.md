# Hướng dẫn hoàn thành Blog Week 2 – Docker Images lên Amazon ECR

## 1. Mục tiêu

Hoàn thành Blog Week 2 theo luồng:

**Source code → Dockerfile production → Docker image → Amazon ECR → Verify → Cập nhật Blog**

Phạm vi MVP gồm 8 thành phần:

1. `frontend`
2. `gateway`
3. `auth-service`
4. `user-service`
5. `fitness-service`
6. `ai-service`
7. `payment-service`
8. `gym-service`

> Không đánh dấu **PASS**, **Completed** hoặc **Published** nếu chưa có output, log hoặc screenshot thực tế.

---

# 2. Chuẩn bị môi trường

Mở PowerShell trong VS Code tại thư mục gốc project.

```powershell
cd <duong-dan-den-fitness-assistant>
```

Cập nhật source:

```powershell
git checkout master
git pull
git status
```

Kiểm tra các công cụ:

```powershell
docker --version
aws --version
git --version
```

Kiểm tra AWS CLI đã đăng nhập:

```powershell
aws sts get-caller-identity
```

Kết quả cần có:

- `Account`
- `Arn`
- `UserId`

---

# 3. Tạo biến môi trường cho bài test

```powershell
$env:AWS_REGION = aws configure get region
$env:AWS_ACCOUNT_ID = aws sts get-caller-identity --query Account --output text
$env:IMAGE_TAG = Get-Date -Format "yyyy-MM-dd"
```

Kiểm tra:

```powershell
Write-Host "Region  :" $env:AWS_REGION
Write-Host "Account :" $env:AWS_ACCOUNT_ID
Write-Host "Tag     :" $env:IMAGE_TAG
```

Nếu `AWS_REGION` bị rỗng thì cấu hình region đúng với project.

Ví dụ:

```powershell
$env:AWS_REGION = "ap-southeast-1"
```

> Chỉ sử dụng region trên nếu project thực sự triển khai tại Singapore.

---

# 4. Build Docker image production

## 4.1 Frontend

```powershell
docker build `
  -t fitness-assistant/frontend:$env:IMAGE_TAG `
  -f frontend/web/Dockerfile .
```

---

## 4.2 Gateway

```powershell
docker build `
  -t fitness-assistant/gateway:$env:IMAGE_TAG `
  -f backend/gateway/Dockerfile .
```

---

## 4.3 Auth Service

```powershell
docker build `
  -t fitness-assistant/auth-service:$env:IMAGE_TAG `
  -f backend/services/auth-service/Dockerfile .
```

---

## 4.4 User Service

```powershell
docker build `
  -t fitness-assistant/user-service:$env:IMAGE_TAG `
  -f backend/services/user-service/Dockerfile .
```

---

## 4.5 Fitness Service

```powershell
docker build `
  -t fitness-assistant/fitness-service:$env:IMAGE_TAG `
  -f backend/services/fitness-service/Dockerfile .
```

---

## 4.6 AI Service

```powershell
docker build `
  -t fitness-assistant/ai-service:$env:IMAGE_TAG `
  -f backend/services/ai-service/Dockerfile .
```

---

## 4.7 Payment Service

```powershell
docker build `
  -t fitness-assistant/payment-service:$env:IMAGE_TAG `
  -f backend/services/payment-service/Dockerfile .
```

---

## 4.8 Gym Service

```powershell
docker build `
  -t fitness-assistant/gym-service:$env:IMAGE_TAG `
  -f backend/services/gym-service/Dockerfile .
```

---

# 5. Kiểm tra build có thật sự thành công không

Sau mỗi lệnh build:

```powershell
$LASTEXITCODE
```

Kết quả mong đợi:

```text
0
```

Nếu khác `0` thì build chưa thành công.

Không được ghi `PASS` nếu command vẫn lỗi.

---

# 6. Lưu log build

Ví dụ với `auth-service`:

```powershell
docker build `
  -t fitness-assistant/auth-service:$env:IMAGE_TAG `
  -f backend/services/auth-service/Dockerfile . `
  2>&1 | Tee-Object auth-build.log
```

Có thể áp dụng tương tự cho các service khác.

---

# 7. Kiểm tra danh sách và kích thước Docker image

Chạy:

```powershell
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}"
```

Hoặc chỉ lọc project:

```powershell
docker images --format "table {{.Repository}}\t{{.Tag}}\t{{.Size}}" |
    Select-String "fitness-assistant"
```

Ghi lại kích thước thật của từng image.

Ví dụ bảng trong Blog:

| Service | Build | Image Size |
|---|---|---:|
| frontend | PASS/FAIL | số thật |
| gateway | PASS/FAIL | số thật |
| auth-service | PASS/FAIL | số thật |
| user-service | PASS/FAIL | số thật |
| fitness-service | PASS/FAIL | số thật |
| ai-service | PASS/FAIL | số thật |
| payment-service | PASS/FAIL | số thật |
| gym-service | PASS/FAIL | số thật |

> Không tự điền số MB nếu chưa chạy.

---

# 8. Screenshot số 1 – Docker Images

Chụp Terminal thể hiện:

- Repository
- Tag
- Size
- 8 image của project

Gợi ý tên file:

```text
static/images/blog1/01-docker-images-size.png
```

---

# 9. Tạo danh sách service để thao tác ECR

```powershell
$services = @(
    "frontend",
    "gateway",
    "auth-service",
    "user-service",
    "fitness-service",
    "ai-service",
    "payment-service",
    "gym-service"
)
```

---

# 10. Tạo Amazon ECR repositories

```powershell
foreach ($service in $services) {
    aws ecr create-repository `
        --repository-name "fitness-assistant/$service" `
        --region $env:AWS_REGION `
        --image-scanning-configuration scanOnPush=true
}
```

Nếu gặp:

```text
RepositoryAlreadyExistsException
```

nghĩa là repository đã tồn tại.

Không cần tạo lại.

---

# 11. Kiểm tra ECR repositories

```powershell
aws ecr describe-repositories `
  --region $env:AWS_REGION `
  --query "repositories[].repositoryName"
```

Kết quả mong đợi có:

```text
fitness-assistant/frontend
fitness-assistant/gateway
fitness-assistant/auth-service
fitness-assistant/user-service
fitness-assistant/fitness-service
fitness-assistant/ai-service
fitness-assistant/payment-service
fitness-assistant/gym-service
```

---

# 12. Screenshot số 2 – ECR repositories

Vào AWS Console:

```text
Amazon ECR
→ Private repositories
```

Chụp danh sách repository.

Gợi ý:

```text
static/images/blog1/02-ecr-repositories.png
```

---

# 13. Docker login vào Amazon ECR

```powershell
aws ecr get-login-password `
    --region $env:AWS_REGION |
docker login `
    --username AWS `
    --password-stdin `
    "$env:AWS_ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com"
```

Kết quả mong đợi:

```text
Login Succeeded
```

---

# 14. Screenshot số 3 – Login ECR

Chụp phần Terminal có:

```text
Login Succeeded
```

Không chụp:

- Access Key
- Secret Access Key
- Token
- Credential nhạy cảm

Gợi ý:

```text
static/images/blog1/03-ecr-login.png
```

---

# 15. Tag Docker image cho Amazon ECR

Ví dụ `auth-service`:

```powershell
docker tag `
  fitness-assistant/auth-service:$env:IMAGE_TAG `
  "$env:AWS_ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/fitness-assistant/auth-service:$env:IMAGE_TAG"
```

Tag toàn bộ 8 image:

```powershell
foreach ($service in $services) {

    docker tag `
      "fitness-assistant/${service}:$env:IMAGE_TAG" `
      "$env:AWS_ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/fitness-assistant/${service}:$env:IMAGE_TAG"
}
```

---

# 16. Push toàn bộ Docker image lên ECR

```powershell
foreach ($service in $services) {

    docker push `
      "$env:AWS_ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/fitness-assistant/${service}:$env:IMAGE_TAG"
}
```

Khi thành công thường sẽ xuất hiện:

```text
digest: sha256:...
```

---

# 17. Screenshot số 4 – Docker Push

Chụp Terminal có:

- repository
- tag
- digest
- trạng thái push thành công

Gợi ý:

```text
static/images/blog1/04-ecr-push.png
```

---

# 18. Xác minh image bằng AWS CLI

```powershell
foreach ($service in $services) {

    Write-Host ""
    Write-Host "===== $service ====="

    aws ecr list-images `
      --repository-name "fitness-assistant/$service" `
      --region $env:AWS_REGION
}
```

Kết quả thường có:

```json
{
    "imageIds": [
        {
            "imageDigest": "sha256:...",
            "imageTag": "2026-08-18"
        }
    ]
}
```

---

# 19. Screenshot số 5 – ECR Image Details

Trong AWS Console:

```text
Amazon ECR
→ Private repositories
→ Chọn repository
→ Images
```

Chụp các thông tin:

- Image tag
- Digest
- Pushed at
- Size

Gợi ý:

```text
static/images/blog1/05-ecr-image-details.png
```

---

# 20. Test pull-back từ ECR

Nên kiểm tra thêm một image để chứng minh image có thể tải lại.

Ví dụ `auth-service`.

Xóa image local:

```powershell
docker rmi fitness-assistant/auth-service:$env:IMAGE_TAG
```

Sau đó pull từ ECR:

```powershell
docker pull `
"$env:AWS_ACCOUNT_ID.dkr.ecr.$env:AWS_REGION.amazonaws.com/fitness-assistant/auth-service:$env:IMAGE_TAG"
```

Kết quả có thể là:

```text
Status: Downloaded newer image
```

hoặc:

```text
Image is up to date
```

---

# 21. Kiểm tra bảo mật Docker image

## 21.1 Kiểm tra Docker history

```powershell
docker history fitness-assistant/auth-service:$env:IMAGE_TAG
```

Không nên thấy:

```text
COPY .env
```

---

## 21.2 Tìm `.env` bên trong container

```powershell
docker run --rm `
  --entrypoint sh `
  fitness-assistant/auth-service:$env:IMAGE_TAG `
  -c "find /app -name '.env' -o -name '.env.*'"
```

Không nên có file secret bị đóng gói vào image.

---

# 22. Lưu ý riêng cho frontend

Frontend dùng các biến `VITE_*` tại thời điểm build.

Ví dụ:

```text
VITE_API_URL
VITE_SOCKET_URL
VITE_CHAT_WS_URL
```

Nếu image được build bằng giá trị:

```text
localhost
```

thì chỉ nên kết luận:

> Frontend image build thành công.

Không nên kết luận:

> Frontend đã hoàn toàn sẵn sàng cho production AWS.

Khi triển khai thật cần build frontend với endpoint production phù hợp.

---

# 23. Bộ screenshot nên có trong Blog

Nên lưu ít nhất:

```text
static/images/blog1/
├── 01-docker-build.png
├── 02-docker-images-size.png
├── 03-ecr-repositories.png
├── 04-ecr-login-push.png
├── 05-ecr-image-details.png
└── 06-ecr-verification.png
```

Không cần chụp quá nhiều ảnh.

Quan trọng là ảnh phải chứng minh đúng kết quả.

---

# 24. Cập nhật trạng thái Blog

Nếu Blog hiện đang có:

```text
Trạng thái: Draft
Ngày đăng: TODO_DATE
URL bài viết: TODO_BLOG_URL
Ảnh bìa: TODO
```

thì chỉ sửa sau khi có bằng chứng thật.

Nếu đã hoàn thành kỹ thuật nhưng chưa đăng bài công khai:

```text
Trạng thái: Completed – Ready for publication
```

Nếu đã đăng công khai:

```text
Trạng thái: Published
```

Không tự tạo URL giả.

---

# 25. Bảng kết quả cuối cùng nên thêm vào Blog

| Service | Docker Build | Image Size | Push ECR | Verify |
|---|---|---:|---|---|
| frontend | PASS/FAIL | số thật | PASS/FAIL | PASS/FAIL |
| gateway | PASS/FAIL | số thật | PASS/FAIL | PASS/FAIL |
| auth-service | PASS/FAIL | số thật | PASS/FAIL | PASS/FAIL |
| user-service | PASS/FAIL | số thật | PASS/FAIL | PASS/FAIL |
| fitness-service | PASS/FAIL | số thật | PASS/FAIL | PASS/FAIL |
| ai-service | PASS/FAIL | số thật | PASS/FAIL | PASS/FAIL |
| payment-service | PASS/FAIL | số thật | PASS/FAIL | PASS/FAIL |
| gym-service | PASS/FAIL | số thật | PASS/FAIL | PASS/FAIL |

---

# 26. Definition of Done

Chỉ coi Blog Week 2 hoàn thành khi đáp ứng đủ:

- [ ] 8 Dockerfile production được kiểm tra.
- [ ] 8 Docker image build thành công.
- [ ] Có kích thước image thật.
- [ ] ECR repositories tồn tại.
- [ ] Docker login ECR thành công.
- [ ] Image được tag version rõ ràng.
- [ ] Image được push lên ECR.
- [ ] AWS CLI xác minh được image.
- [ ] AWS Console hiển thị tag/digest/size.
- [ ] Có screenshot thực tế.
- [ ] Không còn `TODO` chưa xử lý.
- [ ] Không ghi `PASS` khi chưa test.
- [ ] Scope Blog đồng bộ với 8 service MVP.
- [ ] Frontend được ghi chú đúng về các biến build-time.
- [ ] Trạng thái Blog được cập nhật đúng.

---

# 27. Luồng tổng thể của Blog

```text
Developer / VS Code
        |
        v
Source Code + Dockerfile Production
        |
        v
docker build
        |
        v
Local Docker Images
        |
        v
docker tag
        |
        v
docker login
        |
        v
docker push
        |
        v
Amazon ECR
        |
        +----> AWS CLI: aws ecr list-images
        |
        +----> ECR Console: tag / digest / size
```

---

# 28. Sơ đồ Draw.io

Sơ đồ Blog Week 2 nên thể hiện các khối:

1. Developer / VS Code
2. Source code + Dockerfile production
3. `docker build`
4. Local Docker Images
5. `docker tag`
6. `docker login`
7. `docker push`
8. AWS Cloud
9. Amazon ECR
10. 8 ECR repositories
11. AWS CLI Verification
12. ECR Console Verification

Luồng:

```text
Developer
→ Source code
→ Docker build
→ Local Docker Images
→ Tag/Login/Push
→ Amazon ECR
→ Verify
```

---

# 29. File Draw.io đã tạo

Tên file:

```text
blog_week2_docker_ecr_editable.drawio
```

File này có thể mở bằng:

- diagrams.net
- draw.io desktop
- VS Code extension hỗ trợ Draw.io

Các thành phần có thể chỉnh sửa riêng:

- Text
- AWS ECR icon
- AWS Cloud boundary
- Service boxes
- Docker flow
- Arrows
- Verification boxes
- Repository labels

---

# 30. Thứ tự thực hiện khuyến nghị

Thực hiện theo thứ tự:

```text
1. Pull source mới nhất
2. Kiểm tra Docker/AWS CLI
3. Build 8 Docker image
4. Sửa tất cả lỗi build
5. Ghi kích thước image
6. Tạo ECR repositories
7. Docker login ECR
8. Tag image
9. Push image
10. Verify bằng AWS CLI
11. Verify bằng AWS Console
12. Pull-back test
13. Kiểm tra secret/.env
14. Chụp screenshot
15. Điền bảng kết quả
16. Xóa TODO
17. Cập nhật trạng thái Blog
18. Chèn sơ đồ Draw.io vào Blog
```

---

# 31. Kết quả cuối cùng cần đạt

Sau khi hoàn tất, Blog Week 2 phải chứng minh được rằng:

> Source code của Fitness Assistant đã được đóng gói thành các Docker image production, version hóa bằng tag, đẩy thành công lên Amazon ECR, kiểm tra được thông qua AWS CLI và AWS Console, đồng thời có đầy đủ bằng chứng thực nghiệm để phục vụ cho bước triển khai tiếp theo.

