# Database Architecture - Fitness Assistant

Tai lieu nay giai thich toan bo tang du lieu cua project theo code hien tai.

## 1. Tong quan data layer

Project su dung 3 loai storage:

1. PostgreSQL (du lieu quan he, chinh)
2. Redis (cache + queue)
3. Qdrant (vector search cho RAG)

Trong Docker compose, ca 4 backend service deu dung cung 1 PostgreSQL instance (`gymcoach-postgres`) va cung 1 database (`gymcoach`), nhung moi service quan ly bang bo table rieng.

## 2. PostgreSQL design theo service

## 2.1 Auth Service (`backend/services/auth-service/prisma/schema.prisma`)

Muc tieu: quan ly danh tinh va phien dang nhap.

Bang chinh:

- `users`
  - PK: `id` (uuid)
  - Unique: `email`
  - Cot quan trong: `password`, `role`, `createdAt`, `updatedAt`

- `refresh_tokens`
  - PK: `id`
  - Unique: `token`
  - FK noi bo service: `userId -> users.id` (onDelete: Cascade)
  - Index: `userId`, `token`

- `audit_logs`
  - PK: `id`
  - FK noi bo service: `userId -> users.id` (onDelete: Cascade)
  - Cot: `action`, `ipAddress`, `userAgent`, `metadata`
  - Index: `userId`, `createdAt`

Nhan xet:

- Auth la service duy nhat quan ly account credentials.
- Co audit log de truy vet hanh vi auth.

## 2.2 User Service (`backend/services/user-service/prisma/schema.prisma`)

Muc tieu: profile nguoi dung va preference.

Bang chinh:

- `user_profiles`
  - PK: `id`
  - Unique: `userId`
  - Cot profile: `age`, `gender`, `heightCm`, `goal`, `activityLevel`, `experienceLevel`
  - Cot mang: `preferredTrainingDays` (Int[]), `availableEquipment` (String[]), `injuries` (String[])
  - Cot denormalized: `currentWeight`, `targetWeight`

Quan he cross-service:

- `user_profiles.userId` tham chieu logic toi `auth-service.users.id` (khong co FK DB truc tiep vi la ranh gioi microservice).

Nhan xet:

- User service giu data profile phuc vu ca tinh workout/AI.

## 2.3 Fitness Service (`backend/services/fitness-service/prisma/schema.prisma`)

Muc tieu: bai tap, buoi tap, nutrition logs.

Bang chinh:

- `exercises`
  - PK: `id`
  - Enum cot: `type_of_activity`, `type_of_equipment`, `body_part`, `type`
  - Index: `(body_part, type_of_activity)`, `(type_of_equipment)`

- `workouts`
  - PK: `id`
  - Cot: `user_id`, `name`, `date`, `duration`, `notes`
  - Index: `(user_id, date)`

- `workout_exercises`
  - PK: `id`
  - FK noi bo service:
    - `workout_id -> workouts.id` (Cascade)
    - `exercise_id -> exercises.id`
  - Cot set/reps/weight/order
  - Index: `workout_id`, `exercise_id`

- `nutrition_logs`
  - PK: `id`
  - Cot: `user_id`, `meal_type`, `food_name`, `calories`, `protein`, `carbs`, `fats`
  - Index: `(user_id, date)`

Nhan xet:

- Fitness service la data hub cho tracking va phan tich workout/nutrition.
- `workout_exercises` cho phep luu chi tiet moi dong bai tap trong 1 buoi tap.

## 2.4 AI Service (`backend/services/ai-service/prisma/schema.prisma`)

Muc tieu: luu hoi thoai AI va workout plan sinh boi AI.

Bang chinh:

- `conversations`
  - PK: `id`
  - Cot: `user_id`, `question`, `answer`, `model_used`, `response_time`
  - Telemetry cot: `prompt_tokens`, `completion_tokens`, `total_tokens`, `cost`
  - Feedback cot: `feedback`, `feedback_timestamp`
  - Index: `(user_id, created_at)`, `(created_at)`

- `workout_plans`
  - PK: `id`
  - Cot: `user_id`, `goal`, `duration` (weeks), `days_per_week`
  - Cot `plan` kieu JSON de luu cau truc plan linh hoat
  - Index: `user_id`

Nhan xet:

- AI service vua luu chat history vua luu output generated plan.
- Luu token/cost de theo doi hieu nang va chi phi model.

## 3. Redis vai tro gi?

Trong compose:

- `redis` chay o port `6379`

Trong code:

- Fitness service
  - cache exercise query
  - BullMQ queue `workout-generation`
- AI service
  - BullMQ queue `ai-tasks`

Y nghia:

- Tach tac vu nang (generate plan/workout) khoi luong request sync.
- Giam tai Postgres va giam response time.

## 4. Qdrant vai tro gi?

Trong compose:

- `qdrant` chay REST `6333`, gRPC `6334`

Trong code AI service:

- dung de vector search (RAG) tren du lieu bai tap
- ket hop embedding + retrieval truoc khi goi LLM

Y nghia:

- Tra loi AI co can cu du lieu noi bo thay vi chi dua vao model memory.

## 5. Luong du lieu chinh tu frontend den DB

1. Frontend goi API den Gateway (`:3000`)
2. Gateway xac thuc JWT (voi route protected) va proxy sang service dich
3. Service dich thao tac du lieu:
   - Auth/User/Fitness/AI -> PostgreSQL
   - Fitness/AI -> Redis queue/cache
   - AI -> Qdrant retrieval
4. Ket qua tra nguoc qua Gateway ve frontend

## 6. Quan he giua cac service (muc data)

Project theo microservice boundary:

- Moi service so huu schema/table cua rieng no
- Co su dung `userId` de lien ket logic giua service
- Khong dat FK cross-service trong DB

Loi ich:

- Giam coupling giua service
- De scale va deploy doc lap

Doi lai:

- Can dam bao tinh nhat quan userId o tang application

## 7. Migration va startup trong Docker

Theo Dockerfile hien tai cua cac service Prisma:

- Luc build: `prisma generate`
- Luc startup container: `prisma migrate deploy`

Nghia la:

- Container tu dong apply migration can thiet truoc khi app listen
- Giam nguy co loi schema mismatch khi deploy

## 8. Chi so va toi uu da co san

Da co index cho cac truong truy van thuong xuyen:

- Auth: `email`, `refresh token`, `audit by user/time`
- Fitness: `workouts by user/date`, `exercise filters`
- AI: `conversation by user/time`

Goi y toi uu tiep theo:

1. Them retention policy cho `conversations` neu du lieu lon
2. Can nhac tach schema Postgres theo service (`auth`, `user`, `fitness`, `ai`) de governance ro hon
3. Bo sung migration check trong CI

## 9. File tham chieu

- `infra/compose/docker-compose.dev.yml`
- `backend/services/auth-service/prisma/schema.prisma`
- `backend/services/user-service/prisma/schema.prisma`
- `backend/services/fitness-service/prisma/schema.prisma`
- `backend/services/ai-service/prisma/schema.prisma`

---

<a id="merged-db-inspection-commands"></a>

## Consolidated reference: DB_INSPECTION_COMMANDS.md

> Consolidated 2026-09-07. Original dates, verification results and deployment
> snapshots below are historical; confirm them against current code/environment.

## DB Inspection Commands - Fitness Assistant

Tai lieu nay tong hop cac lenh de kiem tra database trong project, tap trung vao PostgreSQL chay trong Docker.

### 1. Thong tin nhanh

- PostgreSQL container: `gymcoach-postgres`
- DB chinh: `gymcoach`
- DB chat: `gymcoach_chat`
- User mac dinh: `gymcoach`
- Port host: `5433`

### 2. Lenh vao PostgreSQL

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

### 3. Liet ke database

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT datname FROM pg_database ORDER BY datname;"
```

### 4. Liet ke tat ca bang trong 1 database

#### 4.1 Bang trong `gymcoach`

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;"
```

#### 4.2 Bang trong `gymcoach_chat`

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach_chat -c "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name;"
```

### 5. Xem cau truc bang (cot, type, null)

Vi du bang `users`:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='users' ORDER BY ordinal_position;"
```

Hoac dung lenh mo ta nhanh:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "\d users"
```

### 6. Xem du lieu trong bang

#### 6.1 Xem 20 dong dau

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT * FROM users ORDER BY `"createdAt`" DESC LIMIT 20;"
```

#### 6.2 Dem tong so dong

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT COUNT(*) AS total_users FROM users;"
```

#### 6.3 Chi lay cot can thiet

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT id, email, role, `"createdAt`" FROM users ORDER BY `"createdAt`" DESC LIMIT 20;"
```

### 7. Loc du lieu theo dieu kien

#### 7.1 Tim user theo email

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT id, email, role FROM users WHERE email ILIKE '%john%';"
```

#### 7.2 Workout theo user

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT id, name, date, duration FROM workouts WHERE user_id='USER_ID_HERE' ORDER BY date DESC LIMIT 30;"
```

#### 7.3 Nutrition logs theo user

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT id, date, meal_type, food_name, calories FROM nutrition_logs WHERE user_id='USER_ID_HERE' ORDER BY date DESC LIMIT 30;"
```

### 8. Xem khoa chinh, khoa ngoai, index

#### 8.1 Khoa ngoai

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT tc.table_name, kcu.column_name, ccu.table_name AS foreign_table_name, ccu.column_name AS foreign_column_name FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema JOIN information_schema.constraint_column_usage ccu ON ccu.constraint_name = tc.constraint_name AND ccu.table_schema = tc.table_schema WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema='public' ORDER BY tc.table_name, kcu.column_name;"
```

#### 8.2 Index cua mot bang

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='users' ORDER BY indexname;"
```

### 9. Kiem tra migration Prisma

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT migration_name, started_at, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY started_at;"
```

Migration dang bi kẹt (neu co):

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "SELECT migration_name, started_at FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL ORDER BY started_at;"
```

### 10. Kiem tra nhanh cho chat DB

#### 10.1 Conversations chat

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach_chat -c "SELECT id, type, `"lastMessageAt`", `"createdAt`" FROM conversations ORDER BY `"createdAt`" DESC LIMIT 20;"
```

#### 10.2 Messages moi nhat

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach_chat -c "SELECT id, `"conversationId`", `"senderId`", content, `"createdAt`" FROM messages ORDER BY `"createdAt`" DESC LIMIT 50;"
```

### 11. Export du lieu ra CSV

Vi du export users:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml exec -T postgres psql -U gymcoach -d gymcoach -c "\copy (SELECT id, email, role, `"createdAt`" FROM users ORDER BY `"createdAt`" DESC) TO STDOUT WITH CSV HEADER" > users_export.csv
```

### 12. Luu y an toan

- Uu tien `SELECT` khi inspect data.
- Tranh chay `DELETE`, `UPDATE`, `TRUNCATE` tren moi truong production neu chua backup.
- Neu can test query nguy hiem, tao clone DB truoc.
- Khi query bang lon, luon dung `LIMIT` de tranh output qua lon.
