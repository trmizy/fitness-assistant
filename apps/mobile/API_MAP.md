# API Map — Gym Coach Backend (Phase 0 khảo sát cho mobile app)

> Lưu ý quan trọng: prompt gốc giả định cấu trúc repo `apps/api-gateway`,
> `apps/web`, `packages/shared`. Cấu trúc THẬT của repo này khác — đã điều
> chỉnh theo thực tế:
> - Gateway: `backend/gateway` (package `@gym-coach/api-gateway`, entry
>   `app.ts`/`server.ts`, không phải `main.ts`)
> - Shared package: `backend/shared` (package **`@gym-coach/shared`**, không
>   phải `packages/shared`/`@fitness/shared`)
> - Web app: `frontend/web` (không phải `apps/web`)
> - Package manager: pnpm workspace, khai báo trong `pnpm-workspace.yaml`
>   (`frontend/*`, `backend/gateway`, `backend/services/*`, `backend/shared`)
>   — mobile app sẽ được thêm vào danh sách này ở Phase 1 (`apps/mobile`
>   hoặc `frontend/mobile` tuỳ layout cuối cùng, xem DECISIONS.md).

Nguồn đã đọc: `backend/gateway/src/{app.ts,server.ts,routes/*,middleware/auth.middleware.ts}`,
`backend/services/auth-service/src/**`, `backend/services/fitness-service/src/**`,
`backend/services/user-service/src/**`, `backend/services/ai-service/src/**`,
`backend/services/chat-service/src/routes/chat.routes.ts`,
`frontend/web/src/app/services/api.ts`, `frontend/web/src/app/services/refresh-once.ts`,
`frontend/web/src/app/pages/**`.

Gateway base URL: `http://localhost:3000` (env `GATEWAY_URL`). Mobile app chỉ
gọi thẳng gateway, không gọi service nào trực tiếp (trừ Socket.IO của
chat-service — connect thẳng `:3005`, xem §4.6).

---

## 1. Gateway routing inventory

Mounted trong `app.ts`: `app.use("/", translateRoutes)` rồi `app.use("/", proxyRoutes)`.
Tất cả path bên dưới là tương đối so với gateway root, **không có prefix `/api`**
(ngoại trừ `/api/translate`).

### Route xử lý trực tiếp ở gateway (không phải proxy thuần)

| Method | Path | Auth | Ghi chú |
|---|---|---|---|
| POST | `/api/translate` | No | Không liên quan mobile. |
| GET | `/admin/system-monitor` | ADMIN | |
| GET | `/admin/dashboard` | ADMIN | |
| GET | `/admin/users` | ADMIN | |
| PATCH | `/admin/users/:userId/role` | ADMIN | |
| PATCH | `/admin/users/:userId/disable`\|`/enable` | ADMIN | |
| GET/POST | `/admin/workflows/*` | ADMIN | n8n studio — không liên quan mobile. |
| GET | `/health` | No | `{status, service, timestamp, uptime}` |
| GET | `/metrics` | No | Prometheus. |
| POST | `/plans/explain/stream` | Yes | SSE proxy ai-service (native http, không buffer). |
| POST | `/plans/nutrition/:planId/save-to-nutrition` | Yes | Gọi trực tiếp ai-service. |
| POST | `/ai/ask/stream` | Yes | **SSE** — route riêng, đăng ký trước `/ai` proxy chung. |
| POST | `/webhooks/dropbox-sign` | No | Không liên quan mobile. |
| POST | `/payments/webhook/:provider` | No | Không liên quan mobile. |
| GET | `/gyms`, `/gyms/:id`, `/gyms/:gymId/plans`, `/gyms/:gymId/trainers` | No | Public browse gym. |

### Route proxy theo nhóm (`router.use(prefix, [auth], [roles], proxy(...))`)

Auth middleware gọi `POST {AUTH_SERVICE_URL}/auth/verify` với bearer token (live
call, không verify JWT tại chỗ), inject `x-user-id`/`x-user-email`/`x-user-role`
cho downstream service. 401 nếu thiếu/sai token, 403 nếu sai role.

| Prefix | Service đích | Auth | Role giới hạn |
|---|---|---|---|
| `/auth/users/:userId/role`, `/auth/users` | auth-service | Yes | ADMIN |
| `/auth` | auth-service | No (rate-limited) | — |
| `/profile/me/become-pt` | user-service | Yes | CUSTOMER, ADMIN |
| `/profile` | user-service | Yes | — |
| `/workouts` | fitness-service | Yes | — |
| `/training-cycles` | fitness-service | Yes | — |
| `/nutrition` | fitness-service | Yes | — |
| `/stats` | fitness-service | Yes | — |
| `/exercises` | fitness-service | **No** (public) | — |
| `/food` | fitness-service | Yes | — |
| `/plans` (trừ 2 route trực tiếp ở trên) | ai-service | Yes | inject `x-internal-token` |
| `/marketplace` | ai-service | Yes | inject `x-internal-token` |
| `/ai` (trừ `/ai/ask/stream`) | ai-service | Yes | `/ai/ask` có thêm `aiAskRateLimiter` |
| `/chat` | chat-service | Yes | REST only — Socket.IO connect thẳng `:3005` |
| `/contracts`, `/availability`, `/sessions`, `/notifications` | user-service | Yes | — |
| `/inbody` | user-service | Yes | timeout 180s (OCR) |
| `/pt-applications` | user-service | Yes | — |
| `/uploads`, `/locations` | user-service | No | — |
| `/me/payments`, `/me/wallet` | payment-service | Yes | — |
| `/me/pt-wallet` | payment-service | Yes | PT role check ở service |
| `/admin/payments` | payment-service | Yes | ADMIN |
| `/me/gym-memberships` | gym-service | Yes | CUSTOMER, PT |
| `/gyms/:gymId/memberships` (POST) | gym-service | Yes | CUSTOMER, PT |
| `/pt/gym-invitations`, `/pt/gym-affiliations` | gym-service | Yes | PT |
| `/owner/gyms` | gym-service | Yes | GYM_OWNER |
| `/admin/gyms` | gym-service | Yes | ADMIN |
| `/admin/ai` | ai-service | Yes | ADMIN |

**Auth middleware**: header `Authorization: Bearer <accessToken>` bắt buộc.
401 `{success:false, error:{code:"UNAUTHORIZED", message:"No token provided"|"Invalid or expired token"}}`.
403 `{success:false, error:{code:"FORBIDDEN", ...}}` khi sai role.

---

## 2. Cơ chế Auth (auth-service)

Path thật: `backend/services/auth-service/src/{routes/auth.routes.ts,
controllers/auth.controller.ts, services/auth.service.ts}`.

Access + refresh JWT pair (`jsonwebtoken`, secret riêng biệt).
- Access token: env `JWT_ACCESS_EXPIRY`, mặc định **`15m`**. Payload `{userId, role, email}`.
- Refresh token: env `JWT_REFRESH_EXPIRY`, mặc định **`7d`**. Payload `{userId, jti}`,
  lưu server-side (bảng `RefreshToken`), **rotate mỗi lần refresh** (token cũ bị xoá).

### Endpoint (mount tại `/auth/*`, không cần gateway auth trừ `/auth/users*`)

**POST `/auth/register`** — OTP-based, chưa tạo account ngay.
Request: `{ email, password (min 8), firstName?, lastName? }`
Response `202`: `{ message: "OTP sent", email, expiresInMinutes, devOtp? }` (`devOtp` chỉ non-prod)
Lỗi: `409` email đã tồn tại, `429` resend quá nhanh.

**POST `/auth/register/verify`**
Request: `{ email, otp: string(6 ký tự) }`
Response `201`: `{ user: {id, email, firstName, lastName, role:"CUSTOMER"}, accessToken, refreshToken }`

**POST `/auth/login`** (rate-limit theo IP+email)
Request: `{ email, password }`
Response `200`: `{ user: {id, email, firstName, lastName, role}, accessToken, refreshToken }`
Lỗi: `401` sai cred, `403` account bị disable.

**POST `/auth/refresh`**
Request: `{ refreshToken }`
Response `200`: `{ accessToken, refreshToken }` (rotate)
Lỗi: `401` refresh token invalid/hết hạn.

**POST `/auth/logout`**
Request: `{ refreshToken }` → `{ message: "Logged out successfully" }`

**POST `/auth/verify`** (nội bộ, gateway middleware dùng; có thể gọi trực tiếp)
Header: `Authorization: Bearer <accessToken>` → `{ user: {...} }`

**PATCH `/auth/me`**: `{ firstName?, lastName? }` → `{ user: {...} }`

**GET `/auth/users`** (ADMIN) → `{ users: [...] }`
**PATCH `/auth/users/:userId/role`** (ADMIN): `{ role }` (không cho gán ADMIN, 403)
**PATCH `/auth/users/:userId/disable`/`/enable`** (ADMIN) → `{ user: {...} }`

### Gateway yêu cầu
Header: `Authorization: Bearer <accessToken>` (check `startsWith("Bearer ")`).
Không có cookie-based auth.

---

## 3. Token storage & refresh (tham chiếu web — mobile dùng SecureStore thay localStorage)

File: `frontend/web/src/app/services/api.ts` + `refresh-once.ts`.

- Lưu ở `localStorage`, key: `accessToken`, `refreshToken`, `user` (JSON string).
- Request interceptor: đọc `accessToken`, set `Authorization: Bearer <token>`
  (guard `hasUsableToken` — coi `"null"`/`"undefined"` string là không có token).
- Response interceptor xử lý 401:
  1. Chỉ trigger refresh nếu `status===401` VÀ lỗi là token issue
     (`error.code==="UNAUTHORIZED"` hoặc message match `/token|unauthorized/i`)
     VÀ request gốc không phải `/auth/login`/`/auth/register`/`/auth/refresh`
     VÀ chưa retry (`_retry` flag).
  2. Gọi `refreshOnce()` — dedupe concurrent 401 thành 1 lần gọi
     `POST /auth/refresh` (dùng axios instance riêng `refreshClient` tránh
     đệ quy interceptor).
  3. Thành công: lưu token mới, retry request gốc.
  4. Thất bại: `clearSessionAndRedirectToLogin()` — xoá 3 key, redirect `/login`.
- SSE (`/ai/ask/stream`) dùng raw `fetch` với refresh-once + retry-once thủ công.

**Mobile tương đương**: lưu `accessToken`/`refreshToken` bằng `expo-secure-store`;
bắt buộc phải có cơ chế dedupe refresh giống web vì nhiều màn hình mount song
song sẽ bắn nhiều request 401 cùng lúc.

---

## 4. Shape các resource chính

### 4.1 Workouts / log buổi tập — fitness-service, prefix `/workouts` (auth required)

Router: `backend/services/fitness-service/src/routes/workout.routes.ts`.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/workouts` | query `startDate?, endDate?, limit?` | `Workout[]` (array trần) |
| GET | `/workouts/:id` | — | `Workout` |
| POST | `/workouts` | `createWorkoutSchema` | `201 Workout` |
| PUT | `/workouts/:id` | `createWorkoutSchema` | `Workout` |
| DELETE | `/workouts/:id` | — | delete result |
| POST | `/workouts/:id/sets` | `{ exerciseId, setNumber?, weight?, reps?, rpe?(1-10) }` | `201 WorkoutSet` |
| PATCH | `/workouts/sets/:setId` | `{ reps?:int>0, weight?:number>=0, rpe?(1-10), completed? }` | `WorkoutSet` |
| GET | `/workouts/prs` | query `exerciseId?` | PR list |
| GET | `/workouts/schedules` | query `limit?, startDate?, endDate?` | schedules array |
| POST | `/workouts/schedules` | `{ date, programDayId, notes? }` | `{success, data:{alreadyExists, schedule}}` |
| POST | `/workouts/schedules/:id/start` | `{ repeat? }` | `{success, data}` |
| POST | `/workouts/schedules/:id/exercises/:programExerciseId/complete` | — | `{success, data}` |
| DELETE | `/workouts/schedules/:id` | — | result |
| GET | `/workouts/programs/current` | — | `{success, data:{program: Program\|null}}` |
| POST | `/workouts/programs/manual` | `createManualProgramSchema` | `201 {success, data}` |
| PATCH/DELETE | `/workouts/programs/:id` | free-form / — | program / result |
| PATCH | `/workouts/program-days/:id` | free-form | day |
| POST | `/workouts/program-days/:id/exercises` | `{exerciseId, order?, sets?, reps?, restSeconds?, notes?}` | `201` |
| PATCH/DELETE | `/workouts/program-exercises/:id` | free-form / — | — |
| POST | `/workouts/generate` | `{goal?, duration?, equipment?, bodyParts?}` | `202` job |

`createWorkoutSchema`:
```
{ scheduleId?, name, description?, date?, duration?(min), notes?,
  exercises: [{ exerciseId, programExerciseId?, sets:int, reps?:int, duration?:sec,
    weight?:kg, completed?, notes? }] (min 1) }
```
Lưu ý: `rpe` set-level chỉ nhận qua `POST /workouts/:id/sets` và
`PATCH /workouts/sets/:setId`, không có trong `createWorkoutSchema`.

`WorkoutSet`: `{id, workoutExerciseId, setNumber, reps?, weight?(kg), rpe?(1-10), completed, createdAt}`
`WorkoutExercise`: `{id, workoutId, exerciseId, programExerciseId?, sets, reps?, duration?, weight?, notes?, order}`
`Workout`: `{id, userId, name, description?, date, duration?(min), notes?, createdAt, updatedAt}`

### 4.2 Danh mục bài tập — fitness-service, prefix `/exercises` (public, **không auth**)

207 bài (`grep -c "INSERT INTO exercises" seed_exercises.sql` = 207).

| Method | Path | Auth | Ghi chú |
|---|---|---|---|
| GET | `/exercises` | No | query `search?, bodyPart?, muscleGroup?, equipment?, activityType?, type?, typeOfActivity?, typeOfEquipment?, page?, limit?(default 30, max 100)` → `{success:true, data:{exercises:Exercise[], pagination:{page,limit,total}, filters:{...}}}` |
| GET | `/exercises/filter-options` | No | `{success:true, data:{...}}` |
| GET | `/exercises/:id` | No | `Exercise` |
| POST | `/exercises` | Yes (admin) | tạo mới |

`Exercise`: `{id, exerciseName, typeOfActivity:"STRENGTH"|"CARDIO"|"MOBILITY"|"STRENGTH_CARDIO"|"STRENGTH_MOBILITY", typeOfEquipment:"BODYWEIGHT"|"BARBELL"|"DUMBBELLS"|"KETTLEBELL"|"MACHINE"|"RESISTANCE_BAND"|"CABLE"|"MEDICINE_BALL"|"FOAM_ROLLER", bodyPart:"UPPER_BODY"|"LOWER_BODY"|"CORE"|"FULL_BODY", type:"PUSH"|"PULL"|"HOLD"|"STRETCH", muscleGroupsActivated:string[], instructions:string, videoUrl?:string, createdAt, updatedAt}`

### 4.3 InBody — user-service, prefix `/inbody` (auth required)

Đã có **bmr + visceralFat** (thêm gần đây, xem `docs/training-cycle-v2.md`).

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/inbody` | — | `InBodyEntry[]` |
| GET | `/inbody/latest` | — | `InBodyEntry` hoặc `404` |
| GET | `/inbody/client/:clientUserId` | — | PT xem lịch sử client |
| POST | `/inbody` | free-form (xem model), upsert theo user+ngày | `InBodyEntry` |
| PATCH | `/inbody/:id` | partial | `InBodyEntry` |
| POST | `/inbody/upload` | multipart `image` (max 5MB), timeout 180s | `{result: <OCR raw>, entryData:{...}}` |

`InBodyEntry`:
```
{ id, userId, date, dateOnly (unique/user/ngày),
  weight:number, height?:number, bmi?:number,
  bodyFat:number(kg), bodyFatPct?:number(%),
  muscleMass:number,
  visceralFat?:number,   // MỚI
  bmr?:int,               // MỚI
  rightArmMuscle?, leftArmMuscle?, trunkMuscle?, rightLegMuscle?, leftLegMuscle?:number,
  rightArmFat?, leftArmFat?, trunkFat?, rightLegFat?, leftLegFat?:number,
  status:"manual"|"extracted"|"pending", notes?, createdAt, updatedAt }
```
Lưu ý: OCR upload hiện **chưa điền** `bmr`/`visceralFat` (chỉ nhập tay mới có).

### 4.4 Workout plans / nutrition plans — ai-service, prefix `/plans` (auth required)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/plans/llm-health` | — | LLM readiness |
| POST | `/plans/workout/generate` | `{goal:string(1-200), durationWeeks:int(1-52), daysPerWeek:int(1-7), exercisesPerDay?(default 4), trainingLocation?:"HOME"|"GYM"(default GYM), equipmentPreference?:"MACHINE_ONLY"|"MIXED_GYM"(default MIXED_GYM), contractId?}` | `202 {planId, jobId}` |
| GET | `/plans/job/:jobId` | — | job status |
| GET | `/plans/current` | — | ≤10 plan COMPLETED gần nhất |
| GET | `/plans/:planId` | — | 1 plan (mọi status) |
| POST | `/plans/explain` | `{planId}` (`?lang=vi|en`) | `{planId, explanation, source:"llm"|"fallback", warnings:string[]}` |
| POST | `/plans/explain/stream` | như trên | SSE |
| POST | `/plans/adjust` | `{planId, adjustments:string(5-1000), daysPerWeek?, exercisesPerDay?}` | plan version mới |
| POST | `/plans/:planId/save-to-workout-log` | `{startDate?, repeatWeeks?(1-52), selectedWeekdays?, replaceExisting?(default true)}` | lưu vào lịch tập |
| DELETE | `/plans/:planId` | — | soft-archive |
| POST | `/plans/nutrition/generate` | `{goal, durationWeeks(≤1), mealsPerDay?(2-6,default 3), dailyCaloriesTarget?, dietPreference?, budgetLevel?, restrictions?, notes?, weightKg?, heightCm?, age?, gender?, bodyFatPct?, ...}` | `202` job |
| GET | `/plans/nutrition/current` | — | plan gần nhất |
| POST | `/plans/nutrition/:planId/explain` | — | explanation |
| POST | `/plans/nutrition/:planId/adjust` | — | version mới |
| POST | `/plans/nutrition/:planId/save-to-nutrition` | — | lưu vào nutrition log |
| DELETE | `/plans/nutrition/:planId` | — | soft-archive |

Nội dung workout plan (`PlanContentSchema`):
```
{ goal, durationWeeks(1-52), daysPerWeek(1-7), exercisesPerDay?,
  weeklySchedule: [{ day, goal, exercises:[{exerciseId, order(1-30), name, sets(1-10), reps:"8-12", restSeconds(0-600), note?}], cardio? }],
  progressionNotes:string[], recoveryNotes:string[], nutritionSummary? }
```

### 4.5 Training cycles — fitness-service, prefix `/training-cycles` (auth required)

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/training-cycles` | `{planId?, startDate?, durationDays?(default 30)}` | `201 TrainingCycle (ACTIVE)` |
| GET | `/training-cycles/active` | — | `{cycle:TrainingCycle, summary:CycleSummary}` (tính realtime) |
| POST | `/training-cycles/:id/complete` | `{endInbodyId?}` | `TrainingCycle status:"COMPLETED"`, `summary.progressSignals` có, `decision`/`aiAnalysis` tính **async** — poll `GET /:id` chờ `status:"ANALYZED"` |
| POST | `/training-cycles/:id/approve` | `{nextPlanId}` (bắt buộc) | `TrainingCycle` có `nextPlanId`. `409` nếu chưa `ANALYZED` |
| GET | `/training-cycles` | query `limit?`(default 20) | `{cycles:TrainingCycle[]}` |
| GET | `/training-cycles/:id` | — | `TrainingCycle` |

```ts
TrainingCycle = {
  id, userId, planId: string|null, cycleIndex: number,
  startDate, endDate, durationDays: number, goal: string|null,
  status: "ACTIVE" | "COMPLETED" | "ANALYZED",
  startInbodyId: string|null, endInbodyId: string|null,
  summary: CycleSummary | null, lowConfidence: boolean,
  decision: "KEEP" | "ADJUST" | "NEW_PLAN" | null,
  aiAnalysis: CycleAnalysisDetails | null,
  nextPlanId: string|null, createdAt, updatedAt
}

CycleSummary = {
  adherence: {completed, total, percent},
  volumeByWeek: [{week, totalVolumeKg, byMuscleGroup: Record<string,number>}],
  volumeChangePct: number|null,
  e1rmTrend: [{exerciseName, weeklyTop:[{week, e1rm}]}],
  rpeTrend: {weeklyAvg:number[], trend:"stable"|"increasing"|"decreasing"},
  newPRs: string[],
  inBodySeries: [{id, date, weight, bodyFatPct?, muscleMass}],
  alerts: [{code, severity:"info"|"warning", message, createdAt}],
  computedAt: string,
  // chỉ có ở summary CUỐI (sau /complete):
  progressSignals?: {
    overallTrend: "PROGRESSING"|"PLATEAU"|"DECLINING",
    deltaSMM: number|null, deltaPBF: number|null, volumeChangePct: number|null,
    newPRs: string[], adherencePct: number,
    rpeTrend: "stable"|"increasing"|"decreasing", laggingMuscleGroups: string[]
  },
  closedAt?: string
}

CycleAnalysisDetails = {
  cycleReview: {bodyCompositionTrend, trainingNote, laggingMuscleGroups:string[], confidence:"high"|"low"},
  keepDetails: {overloadIncreasePct, calorieDelta, notes} | null,
  adjustDetails: {pumpSetTargets:string[], maxPumpSessionsPerWeek, exerciseSwaps:unknown[], calorieDeltaPct, notes} | null,
  newPlanDraft: {goal, durationDays, daysPerWeek, splitSuggestion, deloadWeekFirst, notes} | null,
  mealPlanDraft: {estimatedTDEE, calorieTarget, macros:{proteinG, carbG, fatG}, notes} | null,
  aiFallback?: boolean
}
```
Fallback khi ai-service không tới được: `PROGRESSING→KEEP`, `PLATEAU→ADJUST`, `DECLINING→NEW_PLAN`.

### 4.6 AI Coach chat — ai-service, prefix `/ai` (auth required). **Có streaming.**

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/ai/ask` | `{question:string(1-2000), sessionId?}` | `{success:true, data:{conversationId, sessionId, answer, evidenceUsed?, adjustmentReasons?, safetyNotes?, timing?, fallbackReason?}}` |
| POST | `/ai/ask/stream` | như trên | **SSE**, event: `{type:"status",message}`, `{type:"token",content}`, `{type:"done",...}`, `{type:"error",message}` |
| GET | `/ai/conversations` | query `limit?`(1-100, default 10) | `{success:true, data:{...}}` |
| GET | `/ai/sessions` | — | `{success:true, data:{sessions:[{id,userId,title,lastMessageAt,archivedAt,createdAt,updatedAt}]}}` |
| GET | `/ai/sessions/:sessionId/messages` | — | `{success:true, data:{messages:[{id,question,answer,createdAt,evidenceUsed?}]}}` |
| PATCH | `/ai/sessions/:sessionId` | `{title}` | rename |
| DELETE | `/ai/sessions/:sessionId` | — | archive |
| POST | `/ai/feedback` | `{conversationId, feedback:1\|-1}` | thumbs up/down |
| POST | `/ai/generate-workout` | `{goal?, duration?(10-300,default 60), equipment?:string[], bodyParts?:string[]}` | queued |

Chat PT↔client (khác AI coach) — chat-service, prefix `/chat`:
| Method | Path |
|---|---|
| POST | `/chat/conversations/direct` (`{targetUserId}`) |
| GET | `/chat/conversations` |
| GET | `/chat/conversations/:id/messages` |
| POST | `/chat/conversations/:id/messages` |
| PATCH | `/chat/conversations/:id/read` |
Socket.IO connect **thẳng** chat-service `:3005` (không qua gateway) để realtime.

### 4.7 User profile — user-service, prefix `/profile` (auth required)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/profile/me` | — | profile |
| PUT | `/profile/me` | `{age?(13-120), gender?:"MALE"|"FEMALE"|"OTHER", heightCm?, goal?:"WEIGHT_LOSS"|"MUSCLE_GAIN"|"MAINTENANCE"|"ATHLETIC_PERFORMANCE", activityLevel?, experienceLevel?, preferredTrainingDays?:int[0-6][], availableEquipment?:string[], injuries?:string[], currentWeight?, targetWeight?, dietaryPreference?, photoUrl?}` | profile mới |
| POST | `/profile/me/photo` | multipart `photo` (max 5MB) | `{photoUrl}` |
| PATCH | `/profile/me/become-pt` | — | (CUSTOMER/ADMIN only) |
| DELETE | `/profile/me` | — | xoá |
| GET | `/profile/pts` | — | list PT |

---

## 5. Màn hình web hiện có → API gọi khi mount

| Màn hình | File | Gọi API chính |
|---|---|---|
| Login | `auth/LoginPage.tsx` | `POST /auth/login` |
| Register | `auth/RegisterPage.tsx` | `POST /auth/register` → `POST /auth/register/verify` → `PUT /profile/me` |
| Dashboard | `client/ClientDashboard.tsx` | `profileService.getProfile`, `inbodyService.getHistory`, `workoutService.getHistory(1,4)`, `getCurrentProgram`, `getSchedules(10,...)` |
| InBody | `client/InBodyModule.tsx` | `trainingCycleService.getActive`, `inbodyService.getHistory`; mutation `create`/`upload` |
| Workouts (log) | `client/WorkoutLogPage.tsx` | `getHistory(1,50)`, `inbodyService.getHistory`, `getStats`, `getSchedules(100,...)`, `getCurrentProgram`, `profileService.getProfile` |
| Plans | `client/AIPlansPage.tsx` | `getCurrentPlans`, `getLlmHealth`; mutation `generateWorkoutPlan`/`explainPlan`/`archivePlan`/`adjustPlan`/`savePlanToWorkoutLog`/`explainPlanStream` |
| Nutrition | `client/NutritionPage.tsx` | `getLogs`, `getDailyTask`, `getMonthlySummary`, `getGoal`, `foodService.search` |
| Training Cycle | `client/TrainingCyclePage.tsx` | `getActive`, `list(20)`, `get(id)`; mutation `start`/`complete` |
| AI Coach | `client/AICoachPage.tsx` | `listSessions`, `getSessionMessages(id)`, `inbodyService.getHistory`; `chat`/`chatStream` |
| PT/Client chat | `client/ChatPage.tsx` | `listConversations`, `getMessages(id)`; Socket.IO |
| Profile | `client/ProfilePage.tsx` | `getProfile`; mutation `updateProfile`/`uploadPhoto` |

---

## 6. training-cycles — trạng thái: **ĐÃ CÓ** trên backend (v2, decision model)

Khác với giả định "chưa có" trong prompt gốc — feature này đã build đầy đủ
trong phiên trước (xem `docs/training-cycle-v2.md`). Mobile app **vẫn nên**
đặt các màn liên quan sau flag `FEATURE_CYCLES` (mặc định `true` vì backend
đã hỗ trợ) để dễ tắt nếu cần test môi trường chưa migrate.

---

## Checklist thiết lập client mobile

1. Base URL → gateway root (`http://<host>:3000`), không có prefix `/api`
   (trừ `/api/translate`, không liên quan mobile).
2. Header auth: `Authorization: Bearer <accessToken>` cho mọi call cần đăng nhập.
3. Lưu `accessToken`/`refreshToken` bằng `expo-secure-store`; 401 với
   `code==="UNAUTHORIZED"` → `POST /auth/refresh {refreshToken}`, dedupe
   concurrent refresh, retry 1 lần, thất bại thì logout.
4. `/exercises` và `GET /gyms*` public — dùng được trước khi đăng nhập.
5. SSE (`/ai/ask/stream`, `/plans/explain/stream`) cần client streaming dựa
   trên `fetch` (axios/react-query không tự parse `text/event-stream`).
6. Upload OCR InBody (`POST /inbody/upload`) và ảnh profile
   (`POST /profile/me/photo`) cần `multipart/form-data`; timeout dài (180s)
   riêng cho OCR.
