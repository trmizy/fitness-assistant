# Fitness Assistant — Project Roadmap & Issue Tracker

> **Ngày cập nhật:** 2026-05-10  
> **Trạng thái tổng quát:** ~60% production-ready — Core flow hoạt động, nhưng còn nhiều gap về validation, test coverage, và service chưa hoàn thiện.

---

## Mục lục

1. [Tổng quan kiến trúc](#1-tổng-quan-kiến-trúc)
2. [AI Service — Pipeline Issues](#2-ai-service--pipeline-issues)
3. [Gateway](#3-gateway)
4. [Auth Service](#4-auth-service)
5. [Fitness Service](#5-fitness-service)
6. [User Service](#6-user-service)
7. [Chat Service](#7-chat-service)
8. [Frontend](#8-frontend)
9. [Infrastructure & DevOps](#9-infrastructure--devops)
10. [Testing](#10-testing)
11. [Security](#11-security)
12. [Backlog ưu tiên](#12-backlog-ưu-tiên)

---

## 1. Tổng quan kiến trúc

```
Browser (React + Vite :5173)
    ↓ HTTPS
API Gateway (:3000)  ← auth middleware, rate limiting, prometheus metrics
    ├── Auth Service (:3001)         PostgreSQL (auth DB)
    ├── User Service (:3004)         PostgreSQL (user DB) + EasyOCR (Python)
    ├── Fitness Service (:3002)      PostgreSQL (fitness DB) + Redis cache
    ├── AI Service (:3003)           PostgreSQL (ai DB) + Qdrant + Ollama
    ├── Chat Service (:3005)         PostgreSQL (chat DB) + Socket.IO
    └── n8n (:5678)                  Workflow automation (notifications, alerts)

Infra: Qdrant (:6333), Redis (:6379), Prometheus (:9090), Grafana (:3100)
```

**Tech stack:** pnpm monorepo, TypeScript 5.3, Express, Prisma ORM, React 18, TailwindCSS 4, Zustand, Socket.IO, Ollama (llama3.2:3b + nomic-embed-text), Qdrant vector DB.

---

## 2. AI Service — Pipeline Issues

### 2.1 Bug: Không có routine riêng cho nhóm cơ chân, vai, core

**File:** `backend/services/ai-service/src/llm/recommendation_engine.ts:447-463`

Hàm `buildSpecificRoutineByIntent()` xử lý chest, back, biceps, push day, arms — nhưng **thiếu hoàn toàn case cho legs, shoulders, core**. Khi user hỏi "cho tôi bài tập chân", `muscleGroupHint = 'legs'` nhưng không match case nào, rơi vào `buildGeneralSpecificRoutine()` (full-body generic routine).

**Việc cần làm:**

- [ ] Viết `buildLegsRoutine()`: squat, RDL, leg press, leg curl, leg extension, calf raise (có `techniqueNotes`, `overloadGuide`)
- [ ] Viết `buildShouldersRoutine()`: OHP, lateral raise, face pull, rear delt fly, Arnold press
- [ ] Viết `buildCoreRoutine()`: plank, ab wheel, hollow body, cable crunch, Copenhagen plank
- [ ] Thêm case trong `buildSpecificRoutineByIntent()`:
  ```typescript
  if (intent.muscleGroupHint === "legs")
    return buildLegsRoutine(Boolean(intent.detailMode));
  if (intent.muscleGroupHint === "shoulders")
    return buildShouldersRoutine(Boolean(intent.detailMode));
  if (intent.muscleGroupHint === "core")
    return buildCoreRoutine(Boolean(intent.detailMode));
  ```
- [ ] Thêm case tương ứng trong `answer_validator.ts:validateRequiredSections()` để validate legs/shoulders response

---

### 2.2 Bug: Workout plan không filter theo equipment của user

**File:** `backend/services/ai-service/src/llm/recommendation_engine.ts:322-349`

`buildWorkoutPlanTemplate()` hardcode barbell-heavy exercises (Back Squat, Barbell Row, Deadlift) nhưng không đọc `profile.training.availableEquipment`. User chỉ có dumbbell tại nhà vẫn nhận plan yêu cầu barbell + rack.

**Việc cần làm:**

- [ ] Viết `filterExercisesByEquipment(exercises: ExercisePrescription[], equipment: string[]): ExercisePrescription[]`
  - Nếu `equipment` rỗng hoặc có `'barbell'/'rack'` → giữ nguyên
  - Nếu chỉ có `'dumbbell'` → thay barbell variations bằng dumbbell equivalent (Back Squat → Goblet Squat, Barbell Row → Dumbbell Row)
  - Nếu `'bodyweight'` only → thay toàn bộ bằng calisthenics
- [ ] Áp dụng filter trong `buildWorkoutPlanTemplate()` và `buildSpecificRoutineByIntent()`
- [ ] Thêm equipment context vào prompt constraint (`prompt_builder.ts`) để LLM biết

---

### 2.3 Conversation context extraction quá shallow

**File:** `backend/services/ai-service/src/llm/prompt_builder.ts:39-62`

`extractSessionContext()` chỉ scan `c.question` (câu hỏi của user), bỏ qua `c.answer`. Nếu AI đã đưa plan 5 ngày ở turn trước, turn sau nó không biết và có thể đưa plan 3 ngày mặc định.

**Việc cần làm:**

- [ ] Mở rộng `extractSessionContext()` để đọc cả `c.answer`:
  - Detect plan đã đưa (regex: `\d+ ngày/tuần`, specific day names)
  - Detect nutrition targets đã đưa (calories, protein đã mention trong answer)
  - Detect follow-up context ("tuần trước bạn đề cập...")
- [ ] Thêm field `priorPlanGiven?: { days: number; split: string }` vào session context
- [ ] Inject vào prompt: `⚠️ Bạn đã đưa plan X ngày ở câu trước — giữ nguyên split này trừ khi user yêu cầu thay đổi`

---

### 2.4 Intent router thiếu một số trường hợp quan trọng

**File:** `backend/services/ai-service/src/llm/intent_router.ts:61-133`

Các câu hỏi sau đây rơi vào `general_fitness_knowledge` mà không có deterministic handler riêng:

| Loại câu hỏi      | Ví dụ                                           | Vấn đề                         |
| ----------------- | ----------------------------------------------- | ------------------------------ |
| Supplement        | "tôi có nên dùng creatine không?"               | Không có validation rule riêng |
| Recovery/sleep    | "ngủ bao nhiêu tiếng để phục hồi?"              | Không có handler               |
| Progress tracking | "tôi đã tập 2 tháng, làm sao đánh giá tiến độ?" | Không contextual               |
| Deload            | "khi nào cần tuần deload?"                      | Không có guidance              |

**Việc cần làm:**

- [ ] Thêm intent `supplement_request` với pattern: `/(creatine|whey|bcaa|pre.?workout|thực phẩm bổ sung|supplement)/i`
- [ ] Thêm intent `recovery_request` với pattern: `/(ngủ|sleep|phục hồi|recovery|rest|deload|nghỉ ngơi)/i`
- [ ] Thêm intent `progress_assessment_request` với pattern: `/(tiến độ|progress|đánh giá|kết quả sau|sau \d+ tháng)/i`
- [ ] Viết `validateRequiredSections` cho các intent mới này
- [ ] Thêm vào `llmIntents` set trong orchestrator nếu cần LLM path

---

### 2.5 LLM model llama3.2:3b bị truncate với response dài

**File:** `backend/services/ai-service/src/services/llm.service.ts:75-79`

`num_predict: 1024` chỉ đủ cho plan 4 ngày. Plan 5-6 ngày với đầy đủ sets/reps/rest thường bị cut giữa bảng. Model 3B params cũng thường hallucinate exercise names hoặc số calories.

**Việc cần làm:**

- [ ] Tăng `num_predict` từ 1024 → 1800 (đủ cho 6-day PPL với nutrition)
- [ ] Thêm `num_ctx: 6144` (từ 4096) để fit full prompt khi có chat history dài
- [ ] Test với `llama3.2:8b-instruct` hoặc `qwen2.5:7b` — so sánh quality vs latency
- [ ] Thêm `temperature: 0.3` (hiện không set, default 0.8 quá cao cho structured output)
- [ ] Detect truncated response: nếu `completionTokens >= num_predict * 0.95` → log warning + fallback deterministic

---

### 2.6 Query expansion trong retriever hardcoded và không mở rộng được

**File:** `backend/services/ai-service/src/llm/retriever.ts:12-40`

~12 regex patterns hardcode trong code. Không có cách thêm domain mới mà không sửa code.

**Việc cần làm:**

- [ ] Tạo `data/config/query_expansions.json` với cấu trúc:
  ```json
  [
    {
      "patterns": ["fat loss", "giam mo"],
      "expansions": ["calorie deficit high protein"]
    },
    {
      "patterns": ["muscle gain", "tang co"],
      "expansions": ["progressive overload hypertrophy"]
    }
  ]
  ```
- [ ] Load file này vào `expandQueries()` thay cho hardcoded regex
- [ ] Thêm expansion cho: supplement queries, recovery queries, beginner programs

---

### 2.7 Streaming response có fake delays che lấp latency thực

**File:** `backend/services/ai-service/src/controllers/ai.controller.ts:67-73`

```typescript
await delay(450); // fake delay — không phản ánh thực tế
await delay(450);
await delay(350);
```

Tổng ~1250ms delay nhân tạo trước khi bắt đầu stream tokens. User thấy "Đang đọc hồ sơ..." nhưng thực ra RAG đã xong từ lâu.

**Việc cần làm:**

- [ ] Thay fake status events bằng real progress events từ RAG pipeline:
  - `profile_fetched` — khi `profileExtractor.extract()` resolve
  - `retrieval_done` — khi `retriever.retrieve()` resolve
  - `llm_started` — khi gọi `llmService.callLLM()`
- [ ] Cách tiếp cận: dùng `EventEmitter` hoặc callback trong orchestrator để emit progress
- [ ] Bỏ các `await delay()` hardcoded

---

### 2.8 Answer validator có regex broken cho emoji (UTF-8 encoding issue)

**File:** `backend/services/ai-service/src/llm/answer_validator.ts:100-115`

```typescript
warnings.push(
  ...requireSection(answer, [/ðŸ¥—|dinh dưỡng|nutrition/i], "nutrition"),
);
```

`ðŸ¥—` là emoji 🥗 bị encode sai (UTF-8 mojibake). Pattern sẽ không match emoji trong response thực tế.

**Việc cần làm:**

- [ ] Fix tất cả emoji bị encode sai trong `validateRequiredSections()`:
  - `ðŸ¥—` → `🥗` hoặc bỏ emoji, chỉ dùng text pattern
  - Kiểm tra toàn bộ file cho ký tự tương tự
- [ ] Thêm unit test cho validator với response chứa emoji thực tế

---

### 2.9 Profile cache có thể stale khi user cập nhật profile

**File:** `backend/services/ai-service/src/llm/profile_extractor.ts:99-198`

Cache TTL = 60s. Nếu user vừa cập nhật cân nặng/mục tiêu trong profile, AI sẽ trả lời dựa trên data cũ trong vòng 60 giây.

**Việc cần làm:**

- [ ] Giảm TTL xuống 30s hoặc thêm `Cache-Control: no-cache` header khi profile vừa được update
- [ ] Hoặc: expose endpoint `POST /ai/invalidate-cache` cho user-service gọi khi profile thay đổi
- [ ] Thêm log khi serve từ cache để dễ debug

---

## 3. Gateway

### 3.1 Không có timeout enforcement ở gateway level

**File:** `backend/gateway/src/routes/proxy.routes.ts`

Gateway proxy đến các service không có timeout riêng — nếu ai-service bị treo (Ollama hung), request sẽ treo vô thời hạn.

**Việc cần làm:**

- [ ] Thêm `axios.defaults.timeout` hoặc per-route timeout:
  - `/ai/ask`: 130s (Ollama có thể chậm)
  - `/ai/ask/stream`: 180s
  - Các route khác: 15s
- [ ] Return 504 Gateway Timeout thay vì treo khi timeout

---

### 3.2 Health check aggregation không phân loại severity

**File:** `backend/gateway/src/routes/proxy.routes.ts` (health endpoint)

Health endpoint trả về status của tất cả services nhưng không phân biệt degraded vs down. Nếu ai-service down, toàn bộ health endpoint trả `status: "unhealthy"` dù các service khác hoạt động bình thường.

**Việc cần làm:**

- [ ] Thêm `critical` vs `optional` service classification:
  - Critical: auth, fitness, user
  - Optional: ai, chat, n8n
- [ ] Return `status: "degraded"` khi chỉ optional services down
- [ ] Frontend health indicator hiển thị service nào đang down cụ thể

---

### 3.3 Rate limiting không phân biệt endpoint

**File:** `backend/gateway/src/middleware/rateLimit.middleware.ts`

Rate limit áp dụng uniform cho tất cả endpoints. `/ai/ask` là heavy endpoint cần limit thấp hơn; `/auth/login` cần stricter brute-force protection.

**Việc cần làm:**

- [ ] Tạo tiered rate limits:
  - `/ai/ask*`: 20 req/min per user
  - `/auth/login`: 5 req/min per IP
  - `/auth/register`: 3 req/min per IP
  - Các route khác: 100 req/min per user
- [ ] Trả lời `Retry-After` header khi bị rate limited

---

## 4. Auth Service

### 4.1 OTP không có expiry check rõ ràng

**File:** `backend/services/auth-service/src/` (verification logic)

**Việc cần làm:**

- [ ] Verify OTP expiry ≤ 10 phút từ lúc tạo
- [ ] Invalidate OTP sau khi dùng một lần (prevent replay)
- [ ] Rate limit `/auth/register/verify`: max 5 lần sai → block 15 phút

---

### 4.2 Refresh token không có rotation

Khi refresh token được dùng, token cũ vẫn còn valid cho đến khi hết hạn (7 ngày). Nếu token bị leak, attacker có thể dùng token cũ song song.

**Việc cần làm:**

- [ ] Implement refresh token rotation: mỗi lần dùng refresh token → revoke cái cũ, issue cái mới
- [ ] Store refresh token hash trong DB để validate
- [ ] Endpoint `POST /auth/logout/all` để revoke tất cả sessions

---

### 4.3 Thiếu password reset flow

Hiện không có endpoint `forgot-password` / `reset-password`.

**Việc cần làm:**

- [ ] `POST /auth/forgot-password` — send reset link qua email (6-digit token, expire 15 phút)
- [ ] `POST /auth/reset-password` — validate token, update password hash
- [ ] n8n workflow để gửi email reset

---

## 5. Fitness Service

### 5.1 Không có validation cho workout data

**File:** `backend/services/fitness-service/src/controllers/workout.controller.ts`

Hiện không validate:

- Số sets (có thể = 0 hoặc 1000)
- Số reps (có thể âm)
- Weight (có thể là 9999kg)
- Exercise ID có tồn tại không

**Việc cần làm:**

- [ ] Viết Zod schema cho `CreateWorkoutRequest`:
  ```typescript
  sets: z.number().int().min(1).max(20);
  reps: z.number().int().min(1).max(100);
  weightKg: z.number().min(0).max(500).optional();
  exerciseId: z.string().uuid();
  ```
- [ ] Validate exercise IDs tồn tại trong DB trước khi lưu
- [ ] Max 30 exercises per workout session
- [ ] Trả về 400 với message rõ ràng khi validation fail

---

### 5.2 Exercise CRUD chỉ có GET, thiếu POST/PATCH/DELETE

**File:** `backend/services/fitness-service/src/controllers/exercise.controller.ts`

Admin cần thêm/sửa/xóa exercises nhưng không có endpoints này.

**Việc cần làm:**

- [ ] `POST /exercises` — create exercise (ADMIN only, với full validation)
- [ ] `PATCH /exercises/:id` — update exercise metadata
- [ ] `DELETE /exercises/:id` — soft delete (set `deletedAt`, không xóa thật)
- [ ] `GET /exercises/search?q=&bodyPart=&equipment=` — full-text search + filter
- [ ] Add exercise image upload endpoint với CDN integration

---

### 5.3 Không có workout statistics / analytics

User muốn xem progress theo thời gian: volume per muscle group, weight progression, frequency chart.

**Việc cần làm:**

- [ ] `GET /stats/volume?from=&to=` — total volume per muscle group per week
- [ ] `GET /stats/progression/:exerciseId` — weight/reps progression chart data
- [ ] `GET /stats/frequency` — workouts per week last 12 weeks
- [ ] `GET /stats/streak` — current consecutive workout days
- [ ] Cache các queries này trong Redis (TTL 5 phút)

---

### 5.4 Nutrition tracking thiếu nhiều tính năng cơ bản

Hiện chỉ log calories/protein/carbs/fat cho cả ngày. Không track từng bữa, không có food database.

**Việc cần làm:**

- [ ] `POST /nutrition/meals` — log từng bữa ăn riêng (breakfast, lunch, dinner, snack)
- [ ] `GET /nutrition/meals?date=` — lấy meals của ngày cụ thể
- [ ] Integrate food database (FatSecret API hoặc Open Food Facts) để tìm nutrition info
- [ ] `GET /nutrition/summary?from=&to=` — average macros cho date range
- [ ] Water intake tracking

---

### 5.5 Seed script nằm sai vị trí

**File:** `backend/services/fitness-service/src/seed_exercises_json.ts`

Seed script đang ở `src/` thay vì `prisma/`. Điều này được note trong HANDOVER.md line 37.

**Việc cần làm:**

- [ ] Move `seed_exercises_json.ts` và `raw_exercises.json` về `prisma/`
- [ ] Update import path trong `prisma/seed.ts`
- [ ] Verify seeding vẫn hoạt động sau khi move
- [ ] Add seeding vào docker-compose init sequence để auto-run khi container fresh start

---

### 5.6 Redis cache layer tồn tại nhưng không được dùng

**File:** `backend/services/fitness-service/src/repositories/redis.ts`

File Redis repository tồn tại nhưng không có controller nào sử dụng cache.

**Việc cần làm:**

- [ ] Cache exercise list (873 items, không thay đổi thường xuyên) — TTL 1 giờ
- [ ] Cache user workout history — TTL 5 phút, invalidate khi có workout mới
- [ ] Cache nutrition daily summary — TTL 10 phút

---

## 6. User Service

### 6.1 InBody OCR upload không validate file

**File:** `backend/services/user-service/src/routes/inbody.routes.ts`

Endpoint nhận bất kỳ file nào, sau đó gọi Python subprocess `inbody_extractor/`. Không có MIME type check hay file size limit.

**Việc cần làm:**

- [ ] Validate MIME type: chỉ accept `image/jpeg`, `image/png`, `application/pdf`
- [ ] File size limit: max 10MB
- [ ] Scan filename để tránh path traversal (`../`)
- [ ] Timeout Python process sau 30s, trả về error nếu OCR quá lâu
- [ ] Quarantine uploaded files vào temp dir, xóa sau khi process xong

---

### 6.2 OCR failure không có retry / recovery

Nếu Python subprocess crash, status InBody record bị stuck ở `"pending"` vô thời hạn.

**Việc cần làm:**

- [ ] Update record status sang `"failed"` khi OCR throw error
- [ ] Trả lại error message rõ ràng cho user
- [ ] Endpoint `POST /inbody/:id/retry` để trigger lại OCR
- [ ] Add max retry count (3 lần)

---

### 6.3 Thiếu body metrics history analytics

User muốn xem progress cân nặng, body fat % theo thời gian (line chart).

**Việc cần làm:**

- [ ] `GET /inbody/history?limit=12` — trả về array InBody entries sorted by date
- [ ] `GET /inbody/trends` — calculated deltas: weight change, muscle change, fat change
- [ ] Frontend: biểu đồ InBody trend trong trang `/inbody`

---

### 6.4 PT Application workflow chưa hoàn thiện

**File:** `backend/services/user-service/src/routes/pt-applications.routes.ts`

Có endpoint submit application nhưng không có workflow approval hoàn chỉnh.

**Việc cần làm:**

- [ ] Admin `PATCH /pt-applications/:id/approve` → thay đổi role user → PT trong auth service
- [ ] Admin `PATCH /pt-applications/:id/reject` → gửi rejection email via n8n
- [ ] Notification cho user khi application status thay đổi
- [ ] PT profile creation sau khi approved

---

## 7. Chat Service

### 7.1 Service gần như chưa implement — chỉ là scaffold

**File:** `backend/services/chat-service/src/`

Controller không có logic. Socket.IO được init nhưng không có event handlers. Message không được lưu vào DB.

**Việc cần làm (theo thứ tự):**

- [ ] **Step 1 — HTTP endpoints:**
  - `GET /chat/rooms` — list chat rooms của user
  - `POST /chat/rooms` — tạo room mới (PT-Client)
  - `GET /chat/rooms/:roomId/messages?cursor=&limit=` — load messages với pagination
  - `POST /chat/rooms/:roomId/messages` — send message (HTTP fallback)
- [ ] **Step 2 — Socket.IO events:**
  - `join_room` — user join room
  - `leave_room` — user leave room
  - `send_message` — emit + lưu vào DB + broadcast to room
  - `typing_start` / `typing_stop` — typing indicator
  - `message_read` — read receipts
- [ ] **Step 3 — Features:**
  - Message persistence (lưu vào PostgreSQL)
  - Online/offline status
  - Unread message count badge
  - File/image attachment (link to fitness data, e.g. workout plan)
- [ ] **Step 4 — Rate limiting:**
  - Max 60 messages/minute per user
  - Block spam (identical message 3+ lần trong 10s)

---

### 7.2 Không có integration với AI service

PT và client chat thường xuyên hỏi về bài tập/dinh dưỡng. Hiện Chat service độc lập với AI.

**Việc cần làm:**

- [ ] Thêm command `/ask [question]` trong chat → forward tới AI service → paste AI response vào chat
- [ ] PT có thể share AI-generated plan trực tiếp vào chat room

---

## 8. Frontend

### 8.1 AICoachPage — Suggestion pills hardcoded tiếng Anh

**File:** `frontend/web/src/app/pages/client/AICoachPage.tsx:53-60` (approx)

Suggestion pills như "Create my workout plan", "What should I eat?" hardcoded tiếng Anh trong app tiếng Việt.

**Việc cần làm:**

- [ ] Move suggestions sang i18n strings hoặc fetch từ API
- [ ] Tiếng Việt: "Lập lịch tập cho tôi", "Tôi nên ăn gì?", "Bài tập chân hôm nay", "Cách tăng cơ nhanh"
- [ ] Thêm suggestions context-aware: nếu user có InBody mới → suggest "Phân tích InBody của tôi"

---

### 8.2 Không có skeleton loaders cho các trang data-heavy

Nhiều trang dùng spinner đơn giản khi fetch data. Trải nghiệm không tốt khi load chậm.

**Việc cần làm:**

- [ ] Skeleton loader cho: Dashboard (metric cards), WorkoutLog (exercise list), AICoachPage (chat history)
- [ ] Use `@radix-ui/react-skeleton` hoặc Tailwind `animate-pulse` pattern
- [ ] Error boundary + retry button khi fetch fail

---

### 8.3 Token refresh có thể race condition

**File:** `frontend/web/src/app/services/api.ts:94-112`

`isRefreshing` flag không đủ để prevent race nếu nhiều 401 hit cùng lúc — có thể trigger multiple refresh calls.

**Việc cần làm:**

- [ ] Replace `isRefreshing` flag với `refreshPromise: Promise<string> | null`:
  ```typescript
  let refreshPromise: Promise<string> | null = null;
  // Nếu đang refresh → return cùng promise thay vì trigger mới
  if (refreshPromise)
    return refreshPromise.then((token) => retry(config, token));
  refreshPromise = doRefresh().finally(() => {
    refreshPromise = null;
  });
  ```

---

### 8.4 Không có offline / error state handling

Nếu mất mạng giữa chừng, app im lặng — không có toast, không có retry.

**Việc cần làm:**

- [ ] Thêm network status detection (`navigator.onLine` + `online`/`offline` events)
- [ ] Toast notification khi mất kết nối: "Mất kết nối — đang thử lại..."
- [ ] Auto-retry với exponential backoff cho API calls quan trọng
- [ ] Optimistic updates cho workout log (show trước, sync sau)

---

### 8.5 Workout Log page chưa kết nối đầy đủ với backend

**File:** `frontend/web/src/app/pages/client/WorkoutLogPage.tsx`

Trang này có UI để log exercises nhưng một số operations vẫn còn mock hoặc thiếu validation feedback.

**Việc cần làm:**

- [ ] Verify `POST /workouts` được call đúng khi submit
- [ ] Hiển thị error message cụ thể khi save fail
- [ ] Exercise search phải show real data từ 873 exercises trong DB
- [ ] Auto-suggest last used weight/reps cho exercise đã từng làm
- [ ] Timer cho rest periods (countdown)

---

### 8.6 PT features thiếu nhiều tính năng core

**Files:** `frontend/web/src/app/pages/pt/`

- [ ] PT Dashboard: chưa có calendar view cho sessions
- [ ] PT Client Detail: chưa có workout plan assignment UI (chỉ view, không edit)
- [ ] PT Schedule: calendar component chưa integrate với booking API
- [ ] Plan Review: approve/reject plan flow chưa hoàn thiện

---

### 8.7 Admin Observability page cần thêm metrics

**File:** `frontend/web/src/app/pages/admin/AdminObservabilityPage.tsx`

**Việc cần làm:**

- [ ] Hiển thị: average LLM response latency, fallback rate, validation warning rate
- [ ] Chart: intents distribution (workout_plan vs meal_plan vs general vs ...)
- [ ] Alert khi fallback rate > 20% trong 1 giờ (hiện tại AI đang trả deterministic thay vì LLM)
- [ ] Link đến Grafana dashboard từ admin panel

---

### 8.8 Không có PWA / mobile-friendly improvements

**Việc cần làm:**

- [ ] Add `manifest.json` và service worker cho installable PWA
- [ ] Test responsive layout trên mobile (320px, 375px, 414px width)
- [ ] Bottom navigation bar trên mobile (thay side nav)
- [ ] Touch-friendly tap targets (min 44px)

---

## 9. Infrastructure & DevOps

### 9.1 Không có automated database backup

PostgreSQL data trong named volume `fitness-postgres-data`. Nếu volume bị xóa hoặc corrupt → mất tất cả data.

**Việc cần làm:**

- [ ] Thêm `pg_dump` cron job chạy daily, lưu vào `./backups/` mount
- [ ] Backup retention: 7 daily + 4 weekly
- [ ] Test restore procedure ít nhất 1 lần
- [ ] Alert qua n8n nếu backup job fail

---

### 9.2 Không có production Dockerfile

Tất cả services dùng `tsx watch` (dev mode) ngay cả khi deploy production.

**Việc cần làm:**

- [ ] Viết `Dockerfile.prod` cho mỗi service:
  - Stage 1: `node:20-alpine` + pnpm build (tsc compile)
  - Stage 2: copy dist/ + node_modules production only
  - Non-root user
  - Health check CMD
- [ ] Viết `docker-compose.prod.yml` với:
  - Production images
  - Volumes cho persistent data only
  - No source mounts
  - Resource limits (memory, cpu)
- [ ] Environment separation: `.env.dev`, `.env.staging`, `.env.prod`

---

### 9.3 n8n workflow chưa được document

n8n (:5678) được setup nhưng không có document về workflows đã tạo, triggers, và dependencies.

**Việc cần làm:**

- [ ] Export tất cả workflows ra `infra/n8n/workflows/*.json`
- [ ] Viết doc: danh sách workflows, triggers, webhook endpoints
- [ ] Backup n8n data vào git (hiện chỉ trong Docker volume)

---

### 9.4 Ollama GPU config silently fallback

**File:** `docker-compose.dev.yml` line 356-361

Config yêu cầu NVIDIA GPU nhưng không có GPU vẫn start (fallback CPU) mà không log cảnh báo.

**Việc cần làm:**

- [ ] Thêm healthcheck cho Ollama verify GPU mode: `ollama list | grep -v error`
- [ ] Log GPU status khi Ollama start
- [ ] Tạo `docker-compose.dev.cpu.yml` variant không có GPU requirements để dùng trên máy không có GPU

---

### 9.5 Monitoring alerts chưa được configure

Prometheus đang collect metrics nhưng Grafana chưa có alerting rules.

**Việc cần làm:**

- [ ] Grafana alert khi:
  - AI service error rate > 5%
  - P95 response time > 5s
  - Ollama không available > 2 phút
  - Disk usage > 80%
  - PostgreSQL connection pool > 80%
- [ ] Alert channel: email qua n8n hoặc webhook Slack/Discord

---

## 10. Testing

### 10.1 Test coverage rất thấp — chỉ AI service có tests

| Service         | Test files                   | Coverage |
| --------------- | ---------------------------- | -------- |
| AI Service      | 5 files (unit + integration) | ~60%     |
| Gateway         | 1 file (integration)         | ~40%     |
| Fitness Service | **0**                        | 0%       |
| User Service    | **0**                        | 0%       |
| Auth Service    | **0**                        | 0%       |
| Chat Service    | **0**                        | 0%       |
| Frontend        | **0**                        | 0%       |

**Việc cần làm:**

- [ ] **Fitness Service tests (priority):**
  - `workout.controller.test.ts` — CRUD operations, validation
  - `exercise.controller.test.ts` — search, filter
  - `nutrition.controller.test.ts` — log meals, summaries
- [ ] **Auth Service tests:**
  - `auth.controller.test.ts` — register, login, refresh, logout
  - Security tests: expired token, invalid token, role bypass
- [ ] **User Service tests:**
  - `profile.controller.test.ts` — CRUD
  - `inbody.controller.test.ts` — upload handling, OCR mock
- [ ] **AI Service — thêm tests:**
  - `recommendation_engine.test.ts` — equipment filtering, leg routines
  - `answer_validator.test.ts` — emoji encoding issue
  - E2E test: query → response end-to-end với mock Ollama
- [ ] **Frontend tests:**
  - Vitest + React Testing Library
  - Test: AICoachPage streaming behavior, WorkoutLog form submission
  - E2E với Playwright: login → log workout → ask AI coach

---

### 10.2 Integration tests cần mock environment

Hiện `ai.flow.test.ts` cần Ollama + Qdrant thực sự để chạy → không thể chạy trong CI/CD.

**Việc cần làm:**

- [ ] Tạo `MockLlmService` trả về canned responses
- [ ] Tạo `MockQdrantClient` với in-memory vector store
- [ ] Các test này chạy được với `pnpm test` không cần external dependencies
- [ ] Separate `pnpm test:integration` cho tests cần infrastructure thật

---

### 10.3 Chưa có load testing

Không biết system handle được bao nhiêu concurrent users.

**Việc cần làm:**

- [ ] Viết k6 scripts:
  - Scenario 1: 10 users concurrent ask AI coach
  - Scenario 2: 50 users log workout simultaneously
  - Scenario 3: 100 users browse exercises
- [ ] Baseline: measure P50, P95, P99 latency
- [ ] Identify bottleneck (suspect: Ollama single-threaded inference)

---

## 11. Security

### 11.1 InBody upload path traversal vulnerability

Đã đề cập ở section 6.1. **Priority: HIGH.**

---

### 11.2 Internal service secret weak default

**File:** `backend/gateway/src/routes/proxy.routes.ts:18`

`INTERNAL_SERVICE_SECRET` có default là `dev_internal_service_secret_change_in_production` — nếu ai quên set env var trong production, secret này bị expose.

**Việc cần làm:**

- [ ] Throw error khi `INTERNAL_SERVICE_SECRET` không được set (hoặc = default) trong `NODE_ENV=production`
- [ ] Minimum length: 32 ký tự
- [ ] Rotate secret dễ dàng mà không restart service (support 2 concurrent secrets trong 5 phút window)

---

### 11.3 N8N basic auth weak default

**File:** `docker-compose.dev.yml:386-388`

N8N dùng basic auth với default `admin/admin123`.

**Việc cần làm:**

- [ ] Require `N8N_BASIC_AUTH_PASSWORD` được set trong env
- [ ] Minimum password length: 16 ký tự
- [ ] Block n8n admin endpoint trong gateway nếu không phải ADMIN role

---

### 11.4 Không có CSRF protection

Frontend sử dụng cookie-based tokens (nếu có). API không có CSRF validation.

**Việc cần làm:**

- [ ] Verify tất cả mutating requests đi qua `Authorization: Bearer` header (không dùng cookie) — nếu đúng thì CSRF không áp dụng
- [ ] Nếu có cookie auth flow: add `SameSite=Strict` + CSRF token header check

---

### 11.5 Log có thể leak sensitive data

**Việc cần làm:**

- [ ] Audit tất cả `logger.*` calls — đảm bảo không log: JWT tokens, passwords, full user profile data
- [ ] Mask fields trong log: `authorization: '[REDACTED]'`, `password: '[REDACTED]'`
- [ ] Configure log retention: production logs không giữ quá 30 ngày

---

## 12. Backlog ưu tiên

### 🔴 P0 — Fix ngay (bugs và security)

| #    | Việc làm                                                           | File(s)                                      | Effort |
| ---- | ------------------------------------------------------------------ | -------------------------------------------- | ------ |
| P0-1 | Fix emoji encoding trong answer_validator.ts                       | `ai-service/src/llm/answer_validator.ts:100` | 30 min |
| P0-2 | Thêm leg/shoulder/core routines vào recommendation_engine          | `recommendation_engine.ts:447-463`           | 3h     |
| P0-3 | Validate MIME type + size cho InBody upload                        | `user-service/src/routes/inbody.routes.ts`   | 1h     |
| P0-4 | Throw error khi INTERNAL_SERVICE_SECRET = default trong production | `gateway/src/routes/proxy.routes.ts:18`      | 30 min |

---

### 🟠 P1 — Sprint tiếp theo (quality & correctness)

| #    | Việc làm                                              | File(s)                                      | Effort |
| ---- | ----------------------------------------------------- | -------------------------------------------- | ------ |
| P1-1 | Equipment filtering cho workout plans                 | `recommendation_engine.ts:322-349`           | 4h     |
| P1-2 | Workout validation schemas (Zod)                      | `fitness-service/src/controllers/`           | 3h     |
| P1-3 | Tăng num_predict + temperature setting cho LLM        | `llm.service.ts:75-79`                       | 1h     |
| P1-4 | Fix token refresh race condition                      | `frontend/src/app/services/api.ts:94`        | 2h     |
| P1-5 | Move seed script về prisma/ folder                    | `fitness-service/src/seed_exercises_json.ts` | 30 min |
| P1-6 | Tests cho Fitness Service (CRUD + validation)         | `fitness-service/src/__tests__/`             | 8h     |
| P1-7 | Conversation context đọc cả answer không chỉ question | `prompt_builder.ts:39-62`                    | 2h     |

---

### 🟡 P2 — Feature completion

| #    | Việc làm                                      | File(s)                                                  | Effort |
| ---- | --------------------------------------------- | -------------------------------------------------------- | ------ |
| P2-1 | Chat Service: implement core messaging        | `chat-service/src/`                                      | 2 ngày |
| P2-2 | Fitness Service: workout statistics endpoints | `fitness-service/src/controllers/stats.controller.ts`    | 1 ngày |
| P2-3 | Exercise CRUD endpoints (POST/PATCH/DELETE)   | `fitness-service/src/controllers/exercise.controller.ts` | 4h     |
| P2-4 | Auth: password reset flow                     | `auth-service/src/routes/auth.routes.ts`                 | 1 ngày |
| P2-5 | Frontend: skeleton loaders + error states     | `frontend/src/app/pages/`                                | 4h     |
| P2-6 | AI suggestion pills tiếng Việt                | `AICoachPage.tsx:53-60`                                  | 1h     |
| P2-7 | PT Application approval workflow (end-to-end) | `user-service + auth-service + n8n`                      | 1 ngày |
| P2-8 | Real progress events thay fake delays         | `ai.controller.ts:67-73`                                 | 3h     |
| P2-9 | InBody OCR failure recovery                   | `user-service/src/routes/inbody.routes.ts`               | 2h     |

---

### 🟢 P3 — Polish & Production readiness

| #     | Việc làm                              | Effort |
| ----- | ------------------------------------- | ------ |
| P3-1  | Dockerfile.prod cho tất cả services   | 1 ngày |
| P3-2  | PostgreSQL automated backup           | 3h     |
| P3-3  | Grafana alerting rules                | 2h     |
| P3-4  | Load testing với k6                   | 1 ngày |
| P3-5  | Frontend E2E tests (Playwright)       | 2 ngày |
| P3-6  | PWA / mobile responsive improvements  | 1 ngày |
| P3-7  | Query expansion move sang JSON config | 2h     |
| P3-8  | n8n workflows backup và documentation | 3h     |
| P3-9  | Refresh token rotation                | 4h     |
| P3-10 | Profile cache invalidation on update  | 1h     |

---

## Ghi chú

- Tất cả estimates là rough, có thể thay đổi tùy complexity thực tế khi đi vào code
- P0 nên fix trước khi demo cho bất kỳ user thực nào
- Chat Service (P2-1) là feature lớn nhất còn thiếu — nên bắt đầu sớm vì phụ thuộc nhiều layer
- Test coverage nên được tăng song song với development, không phải để sau
