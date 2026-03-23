# Huong dan may moi sau khi clone project

Tai lieu nay dung cho truong hop clone project tren 1 may moi hoan toan.

## 1. Yeu cau can cai truoc

1. Git
2. Node.js >= 20
3. pnpm >= 8
4. Docker Desktop (daemon phai dang chay)
5. (Khuyen nghi) VS Code + extension Docker

Kiem tra nhanh:

```powershell
node -v
pnpm -v
docker version
git --version
```

Neu `docker version` bao loi daemon, mo Docker Desktop truoc khi chay tiep.

## 2. Clone va vao thu muc project

```powershell
git clone https://github.com/trmizy/fitness-assistant.git
cd fitness-assistant
```

## 3. Tao file env cho may moi

Project su dung `.env` o root.

```powershell
Copy-Item .env.example .env
```

Sau do mo file `.env` va chinh cac gia tri can thiet (neu can):

- `POSTGRES_USER`
- `POSTGRES_PASSWORD`
- `POSTGRES_DB`
- `JWT_SECRET`
- `LLM_PROVIDER`, `LLM_BASE_URL`, `LLM_MODEL`

## 4. Cai dependencies monorepo

```powershell
pnpm install
```

## 5. Cach chay project

Co 2 che do:

1. Docker production-like (on dinh, deploy-like)
2. Docker hot reload (save file la thay doi ngay)

## 5.1 Chay production-like bang Docker Compose

```powershell
docker compose -f infra/compose/docker-compose.dev.yml --env-file .env up --build -d
```

Kiem tra:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml ps
Invoke-RestMethod -Uri "http://localhost:3000/health" | ConvertTo-Json
```

Truy cap:

- Web: http://localhost:5173
- Gateway: http://localhost:3000

## 5.2 Chay hot reload bang Docker (de dev)

Dung file override:

- `infra/compose/docker-compose.dev.yml`
- `infra/compose/docker-compose.dev.hot.yml`

Len stack:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml -f infra/compose/docker-compose.dev.hot.yml --env-file .env up -d --no-build
```

Kiem tra:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml -f infra/compose/docker-compose.dev.hot.yml ps
```

Truy cap web dev:

- Web hot reload: http://localhost:5173

Ghi chu:

- Trong hot mode, sua file frontend/backend va save se tu reload.
- Neu 5173 bi trung port, doi mapping port trong file hot compose.

## 6. Test nhanh register/login sau khi chay

Dang ky:

```powershell
$body = @{ email = "newuser@example.com"; password = "Password123!"; firstName = "New"; lastName = "User" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3000/auth/register" -Method POST -Body $body -ContentType "application/json"
```

Dang nhap:

```powershell
$login = @{ email = "newuser@example.com"; password = "Password123!" } | ConvertTo-Json
Invoke-RestMethod -Uri "http://localhost:3000/auth/login" -Method POST -Body $login -ContentType "application/json"
```

## 7. Dung va reset

Dung stack production-like:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml down
```

Dung stack hot reload:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml -f infra/compose/docker-compose.dev.hot.yml down
```

Dung kem xoa volume (can than vi mat du lieu DB):

```powershell
docker compose -f infra/compose/docker-compose.dev.yml down -v
```

## 8. Loi thuong gap va cach xu ly

## 8.1 Loi docker daemon

Trieu chung:

- `failed to connect to the docker API`

Cach xu ly:

- Mo Docker Desktop
- Cho den khi Docker daemon ready
- Chay lai lenh compose

## 8.2 Sai duong dan env file

Trieu chung:

- `couldn't find env file ... infra/compose/.env`

Cach dung:

- Luon dung `--env-file .env` o root repo

## 8.3 Bi trung port

Trieu chung:

- `bind: ... port is already allocated`

Cach xu ly:

- Doi port host trong compose
- Hoac dung process dang giu port

## 8.4 Import bi gach do trong VS Code

Trieu chung:

- `Cannot find module 'react-router-dom'`

Cach xu ly:

```powershell
pnpm install
```

Neu van bi, restart TS server trong VS Code:

- `Ctrl + Shift + P`
- `TypeScript: Restart TS Server`

## 9. Tai lieu lien quan

- `docs/setup/RUN_PROJECT_FLOW.md`
- `docs/setup/DATABASE_ARCHITECTURE.md`
- `docs/setup/QUICK_START.md`
- `docs/setup/SETUP.md`
