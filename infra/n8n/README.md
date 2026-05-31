# n8n Workflow Orchestration

n8n chạy như một service riêng biệt trong Docker Compose. Nó **không** nằm trong request path chính của AI pipeline — ai-service đã có orchestrator riêng.

## Vai trò của n8n trong hệ thống này

n8n phục vụ các tác vụ **automation hậu kỳ**:
- Scheduled reports (weekly AI coach stats)
- PT approval workflows
- User notifications (email/Slack)
- Data sync và export

**Không** đẩy business logic lõi của AI coaching vào n8n.

## Cách truy cập

### Admin UI (qua Gateway — recommended)
```
http://localhost:3000/admin/workflows/studio
```
Được bảo vệ bởi JWT + ADMIN role. Embed trong Admin Portal tại `/admin/workflows`.

### Trực tiếp (local dev only)
```
http://localhost:5678
Username: admin  (N8N_BASIC_AUTH_USER)
Password: ...    (N8N_BASIC_AUTH_PASSWORD từ .env)
```

## Setup n8n Public API Key (cần để list workflows trên dashboard)

1. Vào n8n Studio → Settings → API
2. Tạo API key mới
3. Copy key vào `.env`:
   ```
   N8N_PUBLIC_API_KEY=n8n_api_xxxxxxxxxxxxxxxx
   ```
4. Restart gateway: `docker-compose restart api-gateway`

## Import workflow mẫu

```bash
# Trong n8n Studio: Settings → Import workflow
# Chọn file: infra/n8n/workflows/sample-weekly-ai-report.json
```

## Workflows hiện có

| File | Mô tả | Trigger |
|------|-------|---------|
| `sample-weekly-ai-report.json` | Weekly AI coach usage report | Cron: Monday 8am |

## Gọi gateway từ n8n

n8n container nằm trong Docker network `gymcoach-network`. Gọi các services qua tên container:

```
http://api-gateway:3000/...    ← API Gateway
http://ai-service:3003/...     ← AI Service trực tiếp (nếu cần)
http://user-service:3004/...   ← User Service
```

Đối với các route cần auth, dùng HTTP Header Auth credential với Bearer token của service account.

## Environment variables

Xem `.env.example` section `n8n Workflow Orchestration` để biết đầy đủ các biến cần thiết.
