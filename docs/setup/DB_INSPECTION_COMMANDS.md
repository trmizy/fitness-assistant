# DB Inspection Commands - Fitness Assistant

Tai lieu nay tong hop cac lenh de kiem tra database trong project, tap trung vao PostgreSQL chay trong Docker.

## 1. Thong tin nhanh

- PostgreSQL container: `gymcoach-postgres`
- DB chinh: `gymcoach`
- DB chat: `gymcoach_chat`
- User mac dinh: `gymcoach`
- Port host: `5433`

## 2. Lenh vao PostgreSQL

Dung Docker compose:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach
```

Thoat psql:

```sql
\q
```

Luu y quan trong tren PowerShell:

- Khong dung `\"` de escape dau nhay kep trong SQL.
- Neu can quote identifier kieu camelCase (vi du `"createdAt"`), hay dung backtick: `` `"createdAt`" ``.

## 3. Liet ke database

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT datname FROM pg_database ORDER BY datname;"
```

## 4. Liet ke tat ca bang trong 1 database

### 4.1 Bang trong `gymcoach`

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;"
```

### 4.2 Bang trong `gymcoach_chat`

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach_chat -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;"
```

## 5. Xem cau truc bang (cot, type, null)

Vi du bang `users`:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='users' ORDER BY ordinal_position;"
```

Hoac dung lenh mo ta nhanh:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "\d users"
```

## 6. Xem du lieu trong bang

### 6.1 Xem 20 dong dau

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT * FROM users ORDER BY `"createdAt`" DESC LIMIT 20;"
```

### 6.2 Dem tong so dong

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT COUNT(*) AS total_users FROM users;"
```

### 6.3 Chi lay cot can thiet

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT id, email, role, `"createdAt`" FROM users ORDER BY `"createdAt`" DESC LIMIT 20;"
```

## 7. Loc du lieu theo dieu kien

### 7.1 Tim user theo email

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT id, email, role FROM users WHERE email ILIKE '%john%';"
```

### 7.2 Workout theo user

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT id, name, date, duration FROM workouts WHERE user_id='USER_ID_HERE' ORDER BY date DESC LIMIT 30;"
```

### 7.3 Nutrition logs theo user

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT id, date, meal_type, food_name, calories FROM nutrition_logs WHERE user_id='USER_ID_HERE' ORDER BY date DESC LIMIT 30;"
```

## 8. Xem khoa chinh, khoa ngoai, index

### 8.1 Khoa ngoai

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='public' ORDER BY tc.table_name, kcu.column_name;"
```

### 8.2 Index cua mot bang

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='users' ORDER BY indexname;"
```

## 9. Kiem tra migration Prisma

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT migration_name, started_at, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at;"
```

Migration dang bi kẹt (neu co):

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT migration_name, started_at FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL ORDER BY started_at;"
```

## 10. Kiem tra nhanh cho chat DB

### 10.1 Conversations chat

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach_chat -c "SELECT id, type, `"lastMessageAt`", `"createdAt`" FROM conversations ORDER BY `"createdAt`" DESC LIMIT 20;"
```

### 10.2 Messages moi nhat

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach_chat -c "SELECT id, `"conversationId`", `"senderId`", content, `"createdAt`" FROM messages ORDER BY `"createdAt`" DESC LIMIT 50;"
```

## 11. Export du lieu ra CSV

Vi du export users:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "\copy (SELECT id, email, role, `"createdAt`" FROM users ORDER BY `"createdAt`" DESC) TO STDOUT WITH CSV HEADER" > users_export.csv
```

## 12. Luu y an toan

- Uu tien `SELECT` khi inspect data.
- Tranh chay `DELETE`, `UPDATE`, `TRUNCATE` tren moi truong production neu chua backup.
- Neu can test query nguy hiem, tao clone DB truoc.
- Khi query bang lon, luon dung `LIMIT` de tranh output qua lon.
