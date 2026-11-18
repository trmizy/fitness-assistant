# Fitness Assistant — Yêu cầu triển khai AWS v2

> Ghi chú khôi phục — 18/08/2026:
> File gốc `requirements-v2.md` được nhắc trong `infra/terraform/README.md`
> của branch `infra/serverless-foundation`, nhưng tài liệu đó ghi rõ file yêu
> cầu gốc do project owner cung cấp và chưa từng được commit vào repository.
> Bản này là bản khôi phục/tái dựng dựa trên dấu vết còn lại trong branch
> `infra/serverless-foundation`, guide Phase 1, và kiến trúc hiện tại của
> Fitness Assistant.

## 1. Định nghĩa v2

AWS Deployment Requirements v2 là kế hoạch chuyển Fitness Assistant từ mô hình
local/Docker Compose/EC2-style sang một hạ tầng AWS **serverless-first**:

- ưu tiên Lambda và các dịch vụ AWS tính phí theo lượt dùng;
- tối ưu chi phí khi hệ thống chưa có tải lớn;
- vẫn đủ thành phần DevOps để quản lý như một môi trường production thật;
- có Infrastructure as Code, CI/CD, quan sát hệ thống, rollback, secrets,
  phân quyền, tagging, logging và quản lý chi phí;
- tạo được bằng chứng triển khai để đưa vào báo cáo project.

Mục tiêu không chỉ là “deploy chạy được”, mà là chứng minh được một flow vận
hành đúng tinh thần DevOps:

```text
Code
  -> Build/Test
  -> Terraform Plan
  -> Review
  -> Deploy có kiểm soát
  -> Smoke Test
  -> Monitoring/Logs
  -> Rollback/Cleanup nếu lỗi
```

## 2. Mục tiêu chính

- Thiết kế hạ tầng AWS theo hướng serverless/pay-per-use để giảm chi phí idle.
- Dùng Terraform để quản lý hạ tầng thay vì tạo tài nguyên thủ công rời rạc.
- Dùng GitHub Actions để tự động kiểm tra build/test và Terraform plan.
- Không cho CI tự động `terraform apply` trong giai đoạn đầu; apply cần người
  review để tránh phát sinh chi phí hoặc xoá nhầm tài nguyên.
- Tách rõ môi trường `dev` và `prod`, trong đó `prod` chỉ tạo khi có quyết định
  rõ ràng.
- Quản lý secrets bằng AWS Secrets Manager hoặc SSM Parameter Store.
- Gắn observability: CloudWatch Logs, Metrics, Alarms, Dashboard, Budget.
- Có tài liệu vận hành, smoke test, rollback và checklist release.

## 3. Baseline hệ thống hiện tại

Kiến trúc local hiện tại:

```text
React Web / Mobile
   -> API Gateway
      -> auth-service
      -> user-service
      -> fitness-service
      -> ai-service
      -> chat-service
      -> payment-service
      -> gym-service

PostgreSQL databases
Redis / BullMQ / Socket.IO nếu có
Ollama + Qdrant cho AI/RAG local
Docker Compose cho orchestration local
```

Điểm cần lưu ý:

- API request/response có thể được đưa lên Lambda dễ hơn.
- Worker dài hạn, realtime socket, AI model local và vector database cần thiết kế
  riêng, không nên ép toàn bộ vào Lambda một cách máy móc.
- Payment, dữ liệu sức khỏe và AI sinh plan cần tiêu chí kiểm thử/rollback riêng.

## 4. Kiến trúc AWS mục tiêu

```text
Developer
   -> GitHub
      -> GitHub Actions
         -> lint/test/build
         -> terraform fmt/validate/plan
         -> artifact/report

Người dùng
   -> CloudFront
      -> S3 Static Frontend
      -> API Gateway HTTP API
         -> Lambda Gateway
         -> Lambda Auth Service
         -> Lambda User Service
         -> Lambda Fitness Service
         -> Lambda AI API Facade
         -> Lambda Payment Service
         -> Lambda Gym Service

Backend data
   -> Aurora Serverless v2 / RDS PostgreSQL
   -> S3 Uploads/Data/Vectors
   -> Secrets Manager / SSM Parameter Store
   -> DynamoDB cho state lock/idempotency/job metadata nếu cần

Async/DevOps
   -> SQS cho job queue
   -> EventBridge cho lịch chạy và domain events
   -> CloudWatch Logs/Metrics/Alarms/Dashboards
   -> AWS Budget / Cost Explorer

AI/RAG
   -> AI service facade
   -> managed vector store hoặc Qdrant/OpenSearch Serverless
   -> model provider/Bedrock/OpenAI-compatible provider/container inference
   -> S3 lưu dataset, eval result, prompt/model artifacts
```

## 5. Nguyên tắc thiết kế

- Serverless-first, nhưng không serverless cực đoan nếu làm tăng rủi ro hoặc chi
  phí.
- Pay-per-use trước, reserved/provisioned capacity sau khi có dữ liệu tải thật.
- Mỗi phase phải có artifact chạy được hoặc bằng chứng rõ ràng.
- Hạ tầng phải quản lý bằng code, có plan trước apply.
- CI chỉ nên có quyền plan/read-only trong giai đoạn đầu.
- Không hard-code secret trong source code, Docker image, Terraform, hoặc build
  frontend.
- Mọi tài nguyên phải có tag để tracking chi phí và dọn dẹp.
- Không tạo `prod` khi chưa có checklist bảo mật, backup, rollback và monitoring.

## 6. Các phase triển khai

### Phase 1 — AWS Foundation

Mục tiêu: chứng minh account AWS, Terraform backend, IAM boundary và một tuyến
Lambda/API Gateway hello-world hoạt động.

Dịch vụ AWS:

- S3 bucket lưu Terraform state;
- DynamoDB table để lock Terraform state;
- IAM role cho Lambda execution;
- GitHub OIDC Identity Provider;
- GitHub Actions CI role chỉ đủ quyền đọc/plan;
- S3 private buckets cho frontend, uploads, vectors/data artifact;
- Lambda hello-world;
- API Gateway HTTP API route `/hello`;
- CloudWatch Log Group;
- AWS Budget.

Artifact cần có:

- `terraform fmt`;
- `terraform validate`;
- `terraform plan`;
- `terraform apply` sau khi review;
- output URL `/hello`;
- kết quả smoke test;
- screenshot AWS Console nếu cần cho báo cáo.

Tham chiếu đã tìm thấy:

- branch: `infra/serverless-foundation`;
- commit: `6f27d33 feat(infra): AWS serverless migration Phase 1 — Terraform foundation`;
- tài liệu: `infra/terraform/README.md`,
  `infra/terraform/PHASE1_MANUAL_CONSOLE_GUIDE.md`.

### Phase 2 — Frontend serverless hosting

Mục tiêu: deploy React web app lên S3 + CloudFront.

Dịch vụ AWS:

- S3 static hosting bucket;
- CloudFront distribution;
- CloudFront Origin Access Control;
- ACM certificate nếu dùng custom domain;
- Route 53 nếu dùng domain;
- CloudFront cache invalidation.

Yêu cầu:

- build frontend theo environment;
- không nhúng secret vào frontend build;
- API base URL cấu hình theo dev/prod;
- thêm security headers cơ bản;
- có rollback bằng versioned artifact hoặc upload lại build trước đó;
- smoke test URL frontend sau deploy.

### Phase 3 — Backend API serverless

Mục tiêu: đưa các service Express hiện có lên Lambda/API Gateway theo từng bước.

Ứng viên migrate:

- gateway;
- auth-service;
- user-service;
- fitness-service;
- ai-service API facade;
- payment-service;
- gym-service;
- chat-service HTTP endpoints.

Dịch vụ AWS:

- API Gateway HTTP API;
- Lambda cho gateway/service;
- Aurora Serverless v2 PostgreSQL hoặc RDS-compatible PostgreSQL;
- Secrets Manager cho `DATABASE_URL`, JWT secret, provider keys, internal service
  secret;
- VPC/Subnet/Security Group nếu Lambda cần truy cập database private;
- VPC endpoints hoặc NAT Gateway khi cần outbound private networking;
- CloudWatch Logs/Alarms.

Yêu cầu kỹ thuật:

- ưu tiên wrap Express `app.ts` bằng `serverless-http` nếu phù hợp;
- giữ Docker Compose local chạy được;
- Prisma phải có binary target tương thích Lambda runtime;
- bundling bằng esbuild hoặc công cụ tương đương;
- migration database là bước deploy có kiểm soát, không chạy bừa ở cold start;
- API Gateway vẫn là public boundary;
- service-to-service secret vẫn cần tồn tại.

### Phase 4 — Async jobs, queue và realtime

Mục tiêu: thay thế các giả định local như BullMQ/Redis/job worker bằng dịch vụ
managed/pay-per-use.

Dịch vụ AWS:

- SQS cho durable job queue;
- EventBridge cho scheduled jobs và domain events;
- Lambda consumer cho job ngắn;
- ECS Fargate hoặc container runtime khác cho job dài nếu Lambda không phù hợp;
- DynamoDB hoặc Aurora table cho idempotency, job status và audit.

Luồng cần migrate:

- AI plan generation jobs;
- notification jobs;
- scheduled sync/maintenance jobs;
- evaluation jobs;
- các job hiện phụ thuộc Redis/BullMQ.

Realtime options:

- API Gateway WebSocket;
- AppSync subscriptions;
- hoặc tạm giữ Socket.IO trên ECS/Fargate nếu realtime chưa phải trọng tâm của
  phase serverless đầu tiên.

### Phase 5 — AI/RAG trên AWS

Mục tiêu: đưa AI/RAG vào quy trình vận hành có kiểm soát, không nhất thiết ép
mọi model vào Lambda.

Yêu cầu:

- version prompt/model;
- lưu dataset/eval result/artifact trên S3;
- có model registry hoặc ít nhất là model versioning rõ ràng;
- có live evaluation harness trước khi rollout prompt/model mới;
- vector store có quyết định rõ: OpenSearch Serverless, Qdrant managed/self-hosted
  hoặc phương án tạm cho demo;
- model provider có quyết định rõ: Bedrock, OpenAI-compatible provider,
  container inference, hoặc Ollama chỉ dùng local/demo;
- workout/nutrition plan phải qua schema validation và invariant validation;
- AI không tự quyết định transaction/payment/permission.

Ghi chú: v2 ưu tiên chứng minh hạ tầng AWS + DevOps. AI/RAG production hardening
có thể là phase riêng nếu vượt quá phạm vi báo cáo deploy ban đầu.

### Phase 6 — Observability, security và vận hành production-like

Mục tiêu: hệ thống không chỉ chạy, mà còn quan sát, debug, kiểm soát chi phí và
rollback được.

Dịch vụ/capability:

- CloudWatch Logs;
- CloudWatch Metrics;
- CloudWatch Alarms;
- CloudWatch Dashboard;
- AWS Budget;
- Cost Explorer;
- structured JSON logs;
- correlation/request ID;
- X-Ray hoặc OpenTelemetry nếu phù hợp;
- IAM least privilege;
- Secrets Manager/SSM;
- backup/restore database;
- runbook xử lý lỗi.

Các chỉ số nên theo dõi:

- API 4xx/5xx;
- Lambda error/throttle/duration/cold start;
- API Gateway latency;
- database connections;
- queue depth;
- failed jobs;
- AI schema failure;
- AI fallback rate;
- chi phí theo service/tag.

## 7. CI/CD yêu cầu

Pipeline tối thiểu:

```text
Pull Request
   -> install dependencies
   -> lint/typecheck/test
   -> build
   -> terraform fmt -check
   -> terraform validate
   -> terraform plan
   -> post/report plan result

Manual deploy
   -> review plan
   -> terraform apply
   -> build/package Lambda/frontend
   -> deploy artifact
   -> smoke test
   -> update report
```

Nguyên tắc:

- CI không có quyền apply ở giai đoạn đầu.
- Deploy phải gắn commit SHA hoặc artifact version.
- Có rollback instruction cho frontend và backend.
- Có log/screenshot/kết quả smoke test để phục vụ báo cáo.

## 8. Chiến lược môi trường

Ban đầu chỉ nên có:

- `dev`: môi trường AWS demo/report;
- `prod`: chưa tạo cho đến khi có quyết định rõ.

Quy định:

- state file riêng cho từng môi trường;
- resource name riêng;
- secret riêng;
- tag riêng;
- không dùng dữ liệu production trong dev;
- không chạy thao tác phá huỷ database khi chưa backup và review plan.

Tag bắt buộc:

```text
project=fitness-assistant
environment=dev|prod
managed-by=terraform
phase=<phase-number>
```

## 9. Kiểm soát chi phí

Yêu cầu:

- ưu tiên Lambda, API Gateway HTTP API, S3, SQS, EventBridge, DynamoDB
  pay-per-request;
- không tạo NAT Gateway nếu chưa thật sự cần;
- chưa bật Aurora Serverless v2 khi chưa có kế hoạch migrate schema/data;
- đặt log retention ngắn ở dev;
- bật AWS Budget;
- xem Cost Explorer sau mỗi phase;
- ghi rõ tài nguyên nào có chi phí idle.

Các rủi ro chi phí cần chú ý:

- NAT Gateway;
- Aurora/RDS idle;
- CloudWatch log ingest lớn;
- OpenSearch/Vector store managed;
- data transfer CloudFront/API Gateway;
- Lambda chạy lâu do cold start hoặc AI inference không phù hợp.

## 10. Bảo mật

Yêu cầu:

- không commit AWS access key, JWT secret, database URL, service secret,
  provider/payment key;
- không đưa `.env` vào image hoặc frontend build;
- dùng GitHub OIDC thay cho long-lived CI key;
- IAM least privilege cho CI và runtime;
- API Gateway là public boundary;
- Lambda/service chỉ nhận quyền đúng phần cần dùng;
- secrets nằm trong Secrets Manager hoặc SSM Parameter Store;
- CORS/rate limit/auth phải cấu hình theo môi trường;
- audit log cho các hành động nhạy cảm.

## 11. Database

Yêu cầu:

- quyết định rõ mỗi service dùng database riêng, schema riêng hay cluster chung;
- migration phải là bước deploy có kiểm soát;
- không dùng `prisma db push --accept-data-loss` trong môi trường AWS;
- có backup trước migration quan trọng;
- có quy trình restore test;
- xử lý connection pooling cho Lambda + PostgreSQL;
- Prisma binary target phải tương thích runtime AWS.

## 12. Tài liệu/bằng chứng cần cho báo cáo

Cần thu thập:

- sơ đồ kiến trúc trước/sau;
- cây thư mục Terraform;
- ảnh AWS Console của resource đã tạo;
- kết quả `terraform plan`;
- kết quả `terraform apply` nếu đã chạy;
- output smoke test Lambda/API Gateway;
- output frontend deploy;
- bằng chứng ECR nếu phase container/image vẫn được dùng;
- AWS Budget/cost estimate;
- checklist không lộ secret;
- danh sách giới hạn hiện tại;
- kế hoạch phase tiếp theo.

## 13. Release gate cho từng phase

Một phase chỉ được coi là hoàn thành khi:

- code/hạ tầng đã nằm trong git hoặc được ghi rõ là local-only;
- Terraform validate pass;
- smoke test pass;
- biết rõ tài nguyên nào đã tạo;
- biết chi phí dự kiến;
- có rollback hoặc cleanup instruction;
- không lộ secret;
- docs cập nhật ngày, resource name, region, kết quả test.

## 14. Trạng thái hiện tại

- [x] Tìm thấy dấu vết AWS serverless foundation trong branch
      `infra/serverless-foundation`.
- [x] Tìm thấy commit Phase 1:
      `6f27d33 feat(infra): AWS serverless migration Phase 1 — Terraform foundation`.
- [x] Đã khôi phục/tái dựng file `requirements-v2.md` bằng tiếng Việt.
- [ ] Chưa khôi phục toàn bộ source Terraform từ branch `infra/serverless-foundation`
      vào working tree hiện tại.
- [ ] Chưa review lại với bản requirement gốc nếu sau này tìm được.
- [ ] Chưa triển khai Phase 2 frontend S3/CloudFront.
- [ ] Chưa triển khai Phase 3 backend Lambda/API Gateway thật.
- [ ] Chưa chốt phương án AI/RAG production trên AWS.

## 15. Kết luận định hướng

V2 không phải chỉ là “đưa app lên AWS”. V2 là kế hoạch biến Fitness Assistant
thành một hệ thống có thể vận hành theo tư duy DevOps/production-like:

- deploy được;
- quản lý hạ tầng bằng Terraform;
- build/test bằng CI;
- kiểm soát secret;
- theo dõi log/metric/chi phí;
- rollback được;
- mở rộng từng phase;
- tối ưu chi phí bằng serverless/pay-per-use.

Đây là hướng phù hợp cho báo cáo project vì vừa chứng minh năng lực cloud
deployment, vừa thể hiện tư duy vận hành sản phẩm thật.
