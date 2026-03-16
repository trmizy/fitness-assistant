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
