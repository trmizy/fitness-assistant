# Gymini AWS DEV — kiến trúc as-deployed (2026-11-17, commit fd823a98)

Nguồn: kiểm kê trực tiếp AWS CLI (account 191798898985, ap-southeast-1) ngày 17/11/2026 sau deploy M9.7. Chỉ có tài nguyên đã xác minh tồn tại.
Nhãn: **[P]** thường trực · **[W]** chỉ có trong cửa sổ DEV (stack `gymini-dev-on-demand`) · **[ngoài]** ngoài tài khoản · **[chưa deploy]**.

```mermaid
flowchart LR
  subgraph Client
    WEB[Web SPA gymini.vn]
    MOB[Mobile Expo]
  end

  subgraph Edge["Edge [P]"]
    R53[Route 53 gymini.vn] --> CF[CloudFront E2MHD79JFC1700]
    ACM[ACM us-east-1 + ap-southeast-1]
    APIDOM[API GW custom domain api.gymini.vn]
  end

  S3WEB[(S3 frontend bucket)]
  CF -->|"/* default"| S3WEB
  CF -->|"/ai/ask/stream (SSE)"| AIS[Lambda ai-stream Function URL RESPONSE_STREAM]
  CF -->|"/socket.io/* (WebSocket)"| ALB

  WEB --> CF
  WEB -->|REST| APIDOM
  MOB -->|REST| APIDOM

  subgraph APIGW["API Gateway HTTP API id1iz7upbl [P]: 151 routes"]
    A1[baseline stack: 125 routes]
    A2[stack api-gateway-m97: +26 routes]
  end
  APIDOM --> APIGW

  subgraph VPC["VPC (private subnets)"]
    LAUTH[Lambda auth]
    LUSER[Lambda user + user-jobs]
    LGYM[Lambda gym + gym-jobs]
    LPAY[Lambda payment + payment-jobs]
    LFIT[Lambda fitness + fitness-jobs]
    LAI[Lambda ai + ai-jobs + ai-worker + ai-stream]
    ALB["Chat ALB [W]"] --> ECS["ECS Fargate chat-service [W] desired=0 now"]
    NAT["NAT Gateway [W]"]
    VPCE_SM["VPC endpoint Secrets Manager [W]"]
    VPCE_OS["VPC endpoint OpenSearch Serverless [W]"]
  end

  APIGW -->|"/auth /health"| LAUTH
  APIGW -->|"/profile /inbody /sessions /contracts /dispute-cases /media/pt-physique ..."| LUSER
  APIGW -->|"/gyms /owner /admin/gyms /me/complaint-cases /media/gym-photos ..."| LGYM
  APIGW -->|"/payments /me/payments /me/wallet"| LPAY
  APIGW -->|"/workouts /nutrition /exercises /coach ..."| LFIT
  APIGW -->|"/ai/ask /ai/* /plans /marketplace"| LAI
  APIGW -->|"HTTP_PROXY /chat/*"| ALB
  AIS --- LAI

  AURORA[("Aurora PostgreSQL 17.7 Serverless v2 [P], 7 logical DBs, stopped outside window")]
  LAUTH & LUSER & LGYM & LPAY & LFIT & LAI & ECS --> AURORA
  SM[Secrets Manager: per-DB secrets + internal service secret] --- VPCE_SM
  LAUTH & LUSER & LGYM & LPAY & LFIT & LAI -. DATABASE_SECRET_ID .-> VPCE_SM

  LAI --> VPCE_OS --> AOSS[(OpenSearch Serverless fitness-assistant-dev-ai-vectors [P])]
  LAI --> SQS[SQS ai-tasks + DLQ [P]]
  SQS --> LAI
  AIS --> DDB[(DynamoDB ai-rate-limit [P])]
  LUSER --> S3UP[(S3 uploads bucket [P])]
  LGYM --> S3UP
  NAT --> INET((Internet))
  LAI -->|"Bedrock Nova Pro + Cohere embed via cross-account role"| BEDROCK["Bedrock in ANOTHER account 730323515543 [ngoài]"]
  LUSER -->|"InBody vision claude-sonnet-4-6"| ANTH["Anthropic API [ngoài]"]
  LPAY -->|sandbox| VNPAY["VNPay sandbox [ngoài]"]
  LAUTH -->|SMTP| GMAIL["Gmail SMTP [ngoài]"]

  subgraph Ops["Operations [P]"]
    EB["EventBridge Scheduler: 15 schedules, ALL DISABLED"]
    CW[CloudWatch alarms x12 + logs]
    SNS[SNS app-alerts]
    KS["aurora-keep-stopped (EventBridge rule + Lambda)"]
  end
  EB -.-> LAI & LUSER & LGYM & LPAY & LFIT
  CW --> SNS

  V2["AI V2 / Multi-Agent [chưa deploy]"]:::off
  classDef off stroke-dasharray: 5 5,color:#888
```

## Cũ → mới (so với kiểm kê 14/11/2026)

| Hạng mục | Trước (14–17/11 sáng) | Sau deploy M9.7 |
|---|---|---|
| Topology (loại tài nguyên) | — | **Không đổi.** Không thêm dịch vụ thường trực mới |
| API Gateway | 125 route, 1 stack baseline | **151 route**: baseline giữ nguyên + stack `fitness-assistant-dev-api-gateway-m97` (+26 route, +14 quyền Lambda theo tiền tố) |
| Lambda auth / user / gym / payment | 2b2f6fb7 / df332234 / df332234 / 2b2f6fb7 | **fd823a98** (hash khớp artifact CI) |
| Lambda fitness / ai / ai-jobs / ai-worker | 14716edf / 4cde78f7 | **giữ nguyên** (không deploy) |
| ai-stream | bản build tay 09/11 | **giữ nguyên** (không deploy; vẫn thiếu RC1 + hotfix an toàn) |
| Schema DB | user 68, gym 32, payment 20 migration | user **93**, gym **39**, payment **25** (+37, chỉ thêm) |
| Web | bundle `index-CWIV8_6P.js` (10/11) | `index-BDDUq3UN.js` (fd823a98) |
| Chat ECS | image 25/10, desired 0 | **không đổi** (chưa deploy bản chat mới) |
| AI Coach V1 / RAG | V1 4cde78f7 + 164 tài liệu RAG | **không đổi** |
| Lịch EventBridge | 15, tất cả tắt | 15, tất cả tắt (workflow xác nhận trạng thái không đổi) |

## Route do stack m97 thêm (26)
- gym: `/me/pt-gym-checkins`, `/me/complaint-cases`, `/me/collaborations`, `/admin/complaint-cases`, `/admin/listings/gyms`, `/admin/amenities`, `/complaint-photos` (mỗi cái ANY + `{proxy+}`), `GET /partner-invitations/{token}`, `POST /partner-invitations/{token}/accept`, `GET|HEAD /media/gym-photos/{proxy+}`, `GET|HEAD /uploads/gym-photos/{proxy+}`.
- user: `ANY /dispute-cases` (+ proxy), `GET|HEAD /media/pt-physique/{proxy+}`, `ANY /uploads/{proxy+}`.
- auth: `PATCH /auth/users/{userId}/name`.
- Không đụng `/ai/*`. Không đổi hostname/stage.

## Chưa có / lệch so với mong đợi
- **AI V2 / Multi-Agent: chưa deploy** (ai Lambda không có biến cờ V2, chưa có bảng session V2).
- **Bedrock chạy ở tài khoản khác (730323515543)** qua `BEDROCK_CROSS_ACCOUNT_ROLE_ARN`, không phải tài khoản này.
- **user Lambda gọi Anthropic API** (`INBODY_VISION_MODEL=claude-sonnet-4-6`) — ngoài Nova Pro.
- Chưa có WAF, CloudTrail, GuardDuty; API Gateway không bật throttling/access log; secret JWT/SMTP/VNPay vẫn nằm trong biến môi trường Lambda.
- Route chỉ có ở gateway local và không có trên AWS: `/api/translate`, `/webhooks/dropbox-sign` (e-sign tắt), `/chat-socket.io` (thay bằng CloudFront `/socket.io/*`).
- Dữ liệu DEV hiện có: ~99% tài khoản auth thuộc tên miền test; chưa dọn (xem báo cáo deploy).
- Ảnh PNG/SVG: chưa tạo (môi trường chưa có mermaid-cli); sơ đồ Mermaid ở trên render được trong GitHub/VS Code.
