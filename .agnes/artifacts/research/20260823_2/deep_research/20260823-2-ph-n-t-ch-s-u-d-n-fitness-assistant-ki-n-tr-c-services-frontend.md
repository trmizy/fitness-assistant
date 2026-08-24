# Phân Tích Sâu Dự Án Fitness Assistant

**Ngày:** 2026-08-23  
**Chủ đề:** Tổng quan kiến trúc, dịch vụ backend, frontend, lỗi build/test và logic  
**Phạm vi:** Toàn bộ monorepo `fitness-assistant`

---

## Tóm tắt (Summary)

Dự án Fitness Assistant là một nền tảng AI fitness full-stack theo kiến trúc microservices, bao gồm:

- **7 backend services** chạy qua Docker Compose với 5 PostgreSQL databases, Redis, Qdrant, Ollama.
- **1 web frontend** (React + Vite + Tailwind) và **1 mobile app** (Expo + React Native).
- **1 API Gateway** làm điểm vào duy nhất cho client.
- AI dùng Ollama + Qdrant RAG, hỗ trợ fine-tuned Qwen2.5 model.

Dự án đã hoàn thiện hầu hết luồng nghiệp vụ cốt lõi và đạt **553/553 unit/integration tests pass** (theo báo cáo Phase 13). Tuy nhiên, còn tồn tại nhiều **gaps P1/P2** chưa được xử lý, chủ yếu về: độ tin cậy LLM, escrow cho Personalized PT Service, và thiếu type-check ở frontend.

---

## 1. Kiến Trúc Tổng Quan

```
Browser (Web) / Expo (Mobile)
        ↓
  API Gateway (port 3000)
        ↓
┌──────────────────────────────────────────────────────┐
│  Auth (3001)  │  Fitness (3002)  │  AI (3003)       │
│  User (3004)  │  Chat (3005)     │  Gym (3006)      │
│  Payment (3007)                                                    │
└──────────────────────────────────────────────────────┘
        ↓
  PostgreSQL (5 DB riêng) + Redis + Qdrant + Ollama
```

**Ngôn ngữ/stack:**
- Backend: Node.js 20+, TypeScript, Express, Prisma, Zod, BullMQ, Socket.IO
- Frontend web: React 18, Vite 6, Tailwind CSS 4, MUI 7, Zustand, TanStack Query
- Mobile: Expo 54, React Native 0.81, Expo Router 6
- Dữ liệu: PostgreSQL 15, Redis 7, Qdrant, Ollama

**Package manager:** pnpm 8.15.0 với workspaces.

---

## 2. Backend Services (backend/services/)

### 2.1 Gateway (`backend/gateway/`)

| Thuộc tính | Chi tiết |
|---|---|
| Tên package | `@gym-coach/api-gateway` |
| Ngôn ngữ | TypeScript |
| Port | 3000 |
| Vai trò | Điểm vào duy nhất, JWT auth boundary, rate limiter, CORS, proxy tới các service |
| Dependencies | express, helmet, cors, jsonwebtoken, axios, http-proxy-middleware, redis, socket.io, express-rate-limit |
| Scripts | dev, build, start, test |
| Tests | `tsx --test src/__tests__/*.test.ts` — 21/21 PASS (theo Phase 13) |

**Logic quan trọng:**
- stripping `x-user-*` headers để ngăn client spoofing
- `INTERNAL_SERVICE_SECRET` stamp trên request nội bộ
- CORS origin-scoped (không dùng wildcard)
- Proxy rewrite cho `/api/*` → gateway routes, `/socket.io` → gateway socket, `/chat-socket.io` → chat-service socket
- N8n CSP bypass middleware cho admin workflows

### 2.2 Auth Service (`backend/services/auth-service/`)

| Thuộc tính | Chi tiết |
|---|---|
| Tên package | `@gym-coach/auth-service` |
| Port | 3001 |
| DB | `gymcoach_auth` |
| Vai trò | Đăng nhập/đăng ký, JWT, roles, email verification, audit events |
| Dependencies | express, bcryptjs, jsonwebtoken, nodemailer, prisma, zod, pino |
| Scripts | dev, build, start, db:generate, db:migrate, db:seed |

**Migration quan trọng:**
- `20260316000000_add_email_verifications`
- `20260320000100_role_customer_pt`
- `20260528_users_isactive`
- `20260624000000_add_gym_roles`

**Logic quan trọng:**
- Login rate-limit middleware
- JWT access (15m) + refresh (7d) tokens
- Email verification workflow
- Role-based: `CUSTOMER`, `PT`, `GYM_OWNER`, `ADMIN`

### 2.3 Fitness Service (`backend/services/fitness-service/`)

| Thuộc tính | Chi tiết |
|---|---|
| Tên package | `@gym-coach/fitness-service` |
| Port | 3002 |
| DB | `gymcoach_fitness` |
| Vai trò | Exercises, workouts, schedules, training cycles, nutrition, equipment, coach, stats |
| Dependencies | express, prisma, bullmq, redis, zod, axios, @gym-coach/shared |
| Scripts | dev, build, start, db:*, test, workout:test:completion, workout:check-consistency |
| Tests | **205/205 PASS** (Phase 13) |

**Migration quan trọng (26 migrations):**
- `20260120005039_` (initial)
- `20260408000000_add_workout_sets`
- `20260525122000_add_nutrition_goals`
- `20260718000000_add_training_cycle`
- `20260720000000_training_cycle_v2_decision_model`
- `20260721000000_adaptive_cycle_evaluation`
- `20260810000000_session_feedback_phase2`
- `20260818020000_add_nutrition_goal_versioning`
- `20260818030000_add_nutrition_adaptive_decision`
- `20260819000000_add_food_serving_metadata`
- `20260820000000_add_exercise_review_decisions`

**Services chính:**
- `workout.service.ts` — CRUD workout, schedules, completion
- `training-cycle.service.ts` — Adaptive training cycle với Decision Engine
- `cycle-decision.engine.ts` — Deterministic decision (KEEP/ADJUST/DELOAD/PROGRESS/INSUFFICIENT_DATA)
- `nutrition.service.ts` — Meal planning, calorie/macro calculation
- `exercise.service.ts` — Exercise catalog CRUD
- `exercise-substitution.service.ts` — Exercise thay thế
- `equipment.service.ts` — Equipment catalog
- `stats.service.ts` — Thống kê

**Controllers:** exercise, workout, nutrition, stats, training-cycle, coach, equipment, exercise-review, food, internal

**Repositories:** exercise, workout, food, nutrition, equipment, prisma, redis

### 2.4 AI Service (`backend/services/ai-service/`)

| Thuộc tính | Chi tiết |
|---|---|
| Tên package | `@gym-coach/ai-service` |
| Port | 3003 |
| DB | `gymcoach_ai` |
| Vai trò | Chat, RAG, workout/nutrition plan generation, marketplace moderation, personalized service, knowledge pipeline |
| Dependencies | express, prisma, bullmq, redis, @anthropic-ai/sdk, @qdrant/js-client-rest, cheerio, pdf-parse, fast-xml-parser, zod |
| Scripts | dev, build, start, db:*, test, test:all, test:evaluation, ingest, knowledge:*, ai:* |
| Tests | **292/292 PASS** (Phase 13), 402/402 khi chạy test:all |

**LLM Stack:**
- Provider: Ollama (mặc định), Anthropic Claude (hỗ trợ)
- Model: `fitness-coach-qwen2.5-1.5b:q4_K_M` (fine-tuned)
- Embedding: `nomic-embed-text` (768 dimensions)
- Vector store: Qdrant
- Collections: exercises (207), fitness_knowledge (7072), fitness_faq (5946), fitness_evidence (115)

**Services chính:**
- `llm.service.ts` — LLM abstraction layer
- `orchestrator.service.ts` — AI chat orchestration
- `plan-content-analyzer.ts` — Plan content analysis
- `plan-moderation-analysis.service.ts` — Marketplace moderation
- `plan-quality-scorer.ts` — Plan quality scoring
- `plan-similarity.ts` — Plan similarity detection
- `rag.service.ts` — RAG retrieval
- `workout-plan-invariant.service.ts` — Final semantic invariant validator
- `nutrition.processor.ts` — Nutrition plan generation
- `nutrition-plan-invariant.service.ts` — Nutrition invariant validator
- `personalized-service.service.ts` — Personalized PT service
- `conversation.service.ts` — Conversation management
- `cycle-assessment.service.ts` — Training cycle assessment
- `cycle-analysis.service.ts` — Cycle analysis
- `feedback-analysis.service.ts` — Session feedback analysis
- `client-plan-draft.service.ts` — PT plan draft

**Knowledge Pipeline:**
- `knowledge-pipeline/service.ts` — Pipeline orchestration
- `knowledge-pipeline/web.ts` — Web research fetcher
- `knowledge-pipeline/pubmed.ts` — PubMed fetcher
- `knowledge-pipeline/rss.ts` — RSS feed processor
- `knowledge-pipeline/chunking.ts` — Text chunking
- `knowledge-pipeline/qdrant-writer.ts` — Qdrant writer
- `knowledge-pipeline/safety-judge.ts` — Safety classifier
- `knowledge-pipeline/scoring.ts` — Score computation
- `knowledge-pipeline/metrics.ts` — Metrics tracking

**Workers:**
- `ai.worker.ts` — BullMQ job worker cho plan generation
- `worker-user-context.ts` — User context builder cho worker

**Routes:** ai, plans, admin-ai, marketplace, personalized-service, admin-marketplace, internal, session, memory

### 2.5 User Service (`backend/services/user-service/`)

| Thuộc tính | Chi tiết |
|---|---|
| Tên package | `@gym-coach/user-service` |
| Port | 3004 |
| DB | `gymcoach_user` |
| Vai trò | Profiles, InBody, PT contracts, bookings, availability, training locations, notifications |
| Dependencies | express, prisma, zod, axios, multer, pdfkit, pino, helmet, @dropbox/sign, @anthropic-ai/sdk |
| Scripts | dev, build, start, db:*, test |
| Tests | **35/35 PASS** (Phase 13) |

**Migration quan trọng (17 migrations):**
- `20260120003413_` (initial)
- `20260317054558_add_is_pt`
- `20260323000000_create_pt_contract_baseline`
- `20260324000000_add_booking_availability`
- `20260627000001_pt_contract_payment_gate`
- `20260720000000_inbody_visceral_fat_bmr`
- `20260731000000_user_profile_competes_in_sport`
- `20260803000000_user_profile_onboarding_fields`
- `20260803010000_backfill_has_completed_onboarding`
- `20260809000000_add_date_of_birth`
- `20260810000000_add_client_session_confirmation`
- `20260811120000_add_audit_log`
- `20260817000000_contract_source_marketplace`
- `20260818010000_add_starting_weight`

**InBody extractor (Python):**
- Thư mục `inbody_extractor/` với OCR, block locator, parser, validator
- Yêu cầu: Python, OpenCV, Tesseract

**Services chính:**
- `profile.service.ts` — Profile CRUD
- `booking.service.ts` — Booking management
- `availability.service.ts` — Slot availability
- `contract.service.ts` — PT contract lifecycle
- `contract-payout.service.ts` — Contract payout calculation
- `contractPdf.service.ts` — Contract PDF generation
- `inbody.service.ts` — InBody data management
- `inbody-vision.service.ts` — InBody OCR/vision
- `pt_application.service.ts` — PT application processing
- `pt_service_package.service.ts` — PT service packages
- `session-autoconfirm.service.ts` — Session auto-confirm
- `reschedule-expiry.service.ts` — Reschedule expiry handling
- `audit.service.ts` — Audit logging
- `notification.service.ts` — Push notifications
- `dropboxSignWebhook.service.ts` — Dropbox Sign webhook handling

**Controllers:** profile, inbody, pt-application, contract, dropbox-sign-webhook, booking, availability, location, training-location, notification, pt-service-package, admin

### 2.6 Chat Service (`backend/services/chat-service/`)

| Thuộc tính | Chi tiết |
|---|---|
| Tên package | `@gym-coach/chat-service` |
| Port | 3005 |
| DB | `gymcoach_chat` |
| Vai trò | Realtime chat, video/voice calls, Socket.IO |
| Dependencies | express, prisma, socket.io, zod, axios, helmet, pino |
| Scripts | dev, build, start, db:*, test |
| Tests | **9/9 PASS** (Phase 13) |

**Migration quan trọng (3 migrations):**
- `20260317060850_init_chat`
- `20260413055255_add_call_sessions`
- `20260525063358_make_conversation_id_optional`

**Socket.IO:**
- `socket/chat.handler.ts` — Chat messages
- `socket/call.handler.ts` — Call signaling
- `socket/index.ts` — Socket.IO initialization

**Services chính:**
- `chat.service.ts` — Message CRUD
- `call.service.ts` — Call management
- `chat.policy.ts` — Chat access policy
- `call.policy.ts` — Call access policy

**Controllers:** chat, call

### 2.7 Payment Service (`backend/services/payment-service/`)

| Thuộc tính | Chi tiết |
|---|---|
| Tên package | `@gym-coach/payment-service` |
| Port | 3007 |
| DB | `gymcoach_payment` |
| Vai trò | Wallet, top-up, withdrawal, payment provider integration, escrow, ledger |
| Dependencies | express, prisma, zod, axios |
| Scripts | dev, build, start, db:*, test, test:integration |
| Tests | **18/18 PASS** (Phase 13) |

**Payment providers:**
- `momo.provider.ts` — MoMo (Vietnam)
- `vnpay.provider.ts` — VNPay
- `zalopay.provider.ts` — ZaloPay
- `payos.provider.ts` — PayOS
- `payment-provider.interface.ts` — Abstraction layer

**Services chính:**
- `wallet.service.ts` — Wallet CRUD, top-up, withdrawal
- `contract-ledger.service.ts` — PT contract escrow ledger
- `membership-ledger.service.ts` — Gym membership ledger
- `personalized-service-ledger.service.ts` — Personalized service ledger (đã có skeleton)
- `payment.service.ts` — Payment orchestration
- `reconcile.service.ts` — Reconciliation
- `reconciliation.service.ts` — Detailed reconciliation
- `webhook.service.ts` — Provider webhook handling

**Controllers:** wallet, payment, webhook, admin, internal

### 2.8 Gym Service (`backend/services/gym-service/`)

| Thuộc tính | Chi tiết |
|---|---|
| Tên package | `@gym-coach/gym-service` |
| Port | 3006 |
| DB | `gymcoach_gym` |
| Vai trò | Gym management, memberships, trainers, check-ins, reviews, collaborations, brand management |
| Dependencies | express, prisma, zod, axios |
| Scripts | dev, build, start, db:*, test |
| Tests | **9/9 PASS** (Phase 13) |

**Migration quan trọng (5 migrations):**
- `20260626000001_initial_gym_schema`
- `20260718000001_add_gym_checkins_and_reviews`
- `20260811073209_add_pt_collaboration_and_referral`
- `20260811085507_add_collaboration_index_and_membership_payout_columns`
- `20260817004151_add_gym_brands_and_plan_sale_window`

**Services chính:**
- `gym.service.ts` — Gym CRUD
- `membership.service.ts` — Membership plans and enrollment
- `checkin.service.ts` — QR check-in
- `review.service.ts` — Gym reviews
- `collaboration.service.ts` — PT ↔ Gym collaboration
- `affiliation.service.ts` — Gym affiliations
- `brand.service.ts` — Brand management
- `plan.service.ts` — Gym plans (marketplace)

**Controllers:** gym, membership, checkin, review, collaboration, affiliation, brand, plan, internal, admin, pt

### 2.9 Shared Package (`backend/shared/`)

| Thuộc tính | Chi tiết |
|---|---|
| Tên package | `@gym-coach/shared` |
| Vai trò | Common utilities across all services |
| Exports | logger (pino), metrics (prom-client), axios instance, Zod schemas |

---

## 3. Frontend

### 3.1 Web Frontend (`frontend/web/`)

| Thuộc tính | Chi tiết |
|---|---|
| Tên package | `@gym-coach/web` |
| Framework | React 18 + Vite 6 |
| Styling | Tailwind CSS 4 + MUI 7 + Radix UI |
| State | Zustand + TanStack Query |
| Build | `vite build` (2.05 MB bundle) |
| Capacitor | `@capacitor/android` 8.5 để wrap thành APK |
| TypeScript | **KHÔNG có tsconfig.json** — không có type-check |

**Scripts:**
- `dev` — Vite dev server (port 5173)
- `build` — Vite production build
- `app:build` — Build cho Capacitor
- `app:sync` — Build + `cap sync android`

**Cấu trúc src:**
- `app/` — components, pages, hooks, services, stores, context, utils
- `styles/` — Tailwind, theme, fonts
- `assets/` — images

**Vite proxy config:**
- `/api` → `http://localhost:3000` (gateway)
- `/socket.io` → gateway socket
- `/chat-socket.io` → chat-service socket

**Known issues:**
- Frontend bundle 2.05 MB + bg-gym.jpg 6.33 MB — cần code splitting và image optimization
- Không có `tsconfig.json` → không có type-check trong build

### 3.2 Mobile App (`apps/mobile/`)

| Thuộc tính | Chi tiết |
|---|---|
| Tên package | `@gym-coach/mobile` |
| Framework | Expo ~54.0.36, React Native 0.81 |
| Router | Expo Router 6 |
| State | Zustand + TanStack Query |
| TypeScript | `tsc --noEmit` (typecheck script) |

**Dependencies:**
- `expo`, `expo-router`, `expo-splash-screen`, `expo-status-bar`
- `expo-secure-store`, `expo-haptics`, `expo-device`
- `expo-notifications`, `expo-linking`, `expo-constants`
- `expo-sqlite` (offline-first foundation)
- `react-native-gesture-handler`, `react-native-screens`, `react-native-safe-area-context`
- `react-native-svg`

**Scripts:**
- `start` — Expo start
- `android` — Expo Android
- `ios` — Expo iOS
- `web` — Expo web
- `typecheck` — `tsc --noEmit`
- `lint` — ESLint

---

## 4. Lỗi Build Phát Hiện Được

### 4.1 Frontend thiếu `tsconfig.json`

**Mức độ:** P2 (tooling gap)  
**Thực tế:** `frontend/web/` không có `tsconfig.json`, nghĩa là Vite/esbuild **không kiểm tra type nào** cả. Lỗi type chỉ có thể được bắt bởi IDE local, không có gate nào trong CI/build.

**Khuyến nghị:** Thêm `tsconfig.json` + bước `tsc --noEmit` vào CI.

### 4.2 Payment Service — Test File Leaves Handle Open

**Mức độ:** P2  
**Thực tế:** `src/__tests__/admin-routes-auth.test.ts` không thoát được — file import gì đó giữ handle mở, khiến `node:test` báo fail. Script test mặc định đã loại trừ file này:

```json
"_comment_test:admin-routes": "All 5 assertions pass, but the file never exits — something it imports leaves a handle open — so node:test eventually reports the whole file as failed. Kept out of `test` so the suite stays usable; run it on its own and read the assertions."
```

### 4.3 Container Port Conflict (PostgreSQL)

**Mức độ:** P3 (dev environment)  
**Thực tế:** docker-compose.dev.yml expose PostgreSQL trên port `5433` (mapped từ 5432). Nếu có PostgreSQL khác chạy trên host port 5433, container sẽ fail.

### 4.4 AI Service Healthcheck Start Period

**Mức độ:** P2  
**Thực tế:** AI service có `start_period: 10m` — mất đến 10 phút để healthcheck pass. Điều này gây khó khăn cho CI và auto-restart.

---

## 5. Tests — Trạng Thái

### 5.1 Tổng Quan

| Service | Tests | Trạng Thái |
|---|---|---|
| fitness-service | 205/205 | ✅ PASS |
| ai-service | 292/292 (test) / 402/402 (test:all) | ✅ PASS |
| user-service | 35/35 | ✅ PASS |
| gateway | 21/21 | ✅ PASS |
| chat-service | 9/9 | ✅ PASS |
| gym-service | 9/9 | ✅ PASS |
| payment-service | 18/18 | ✅ PASS |
| **Tổng cộng** | **589/589** | **✅ TẤT CẢ PASS** |

### 5.2 Test Files Không Chạy Trong Mặc Định

- `payment-service/src/__tests__/admin-routes-auth.test.ts` — bị loại trừ do handle leak
- `payment-service/src/__tests__/auth-header-spoofing.test.ts` — không chạy trong default `test` script
- `gym-service/src/__tests__/auth-header-spoofing.test.ts` — tương tự
- `ai-service/src/datasets/__tests__/datasets.test.ts` — cần chạy `test:all`

### 5.3 Known Flaky Tests

Theo Phase 13 báo cáo:
- **4 wallet balance tests** trong Playwright E2E flaky do tích lũy số dư qua nhiều lần chạy
- Rate limiter (20 req/15min auth, 100 req/min general) có thể gây 429 khi chạy E2E dày đặc

---

## 6. Logic Errors & Bugs Đã Sửa

### 6.1 BUG-AI-WORKOUT-001 (ĐÃ FIX)

- **Trước:** Final equipment check có thể fail nhưng worker vẫn persist `COMPLETED`
- **Sau:** Added final semantic invariant validator, fail-closed persistence, constrained repair
- **Files:** `workout-plan-invariant.service.ts`, `ai.worker.ts`

### 6.2 BUG-AI-NUTRITION-001 (ĐÃ FIX)

- **Trước:** LLM trả fewer meals → deterministic expansion chọn protein-heavy catalog → 400-550g protein/ngày
- **Sau:** Final calorie/macro invariant, diverse food filtering, deterministic expansion
- **Files:** `nutrition.processor.ts`, `nutrition-plan-invariant.service.ts`

### 6.3 BUG-FINANCE-IDEMPOTENCY-001 (ĐÃ FIX)

- **Trước:** Concurrent duplicate internal transfer/refund có thể double ledger mutation
- **Sau:** Compare-and-swap khi lock wallet
- **Files:** `wallet.service.ts`

### 6.4 P0 Onboarding Race Condition (ĐÃ FIX - Phase 13)

- **Trước:** User bị bật ngược lại onboarding wizard sau khi hoàn tất
- **Nguyên nhân:** `invalidateQueries` bất đồng bộ + `navigate()` ngay lập tức → `RequireOnboarding` đọc cache cũ
- **Sau:** `setQueryData` đồng bộ trước `navigate()`

### 6.5 AI Plan Exercise Alphabet Bias (ĐÃ FIX - Phase 13)

- **Trước:** Candidate list bị cắt theo alphabet → AI chỉ chọn bài từ A/B
- **Sau:** Fisher-Yates shuffle trước khi slice

### 6.6 Plugin Exercise Muscle/Equipment (ĐÃ FIX - Phase 13)

- **Trước:** Plan chỉ lưu `{exerciseId, order, name, sets, reps, restSeconds, note}` — frontend luôn hiển thị `"--"`
- **Sau:** Thêm `ids` filter vào `GET /exercises`, frontend gọi `getExercisesByIds` để tra cứu

### 6.7 Seeder Non-Idempotent (ĐÃ FIX - Phase 13)

- **Trước:** `seed-test-users.mjs` dùng `ON CONFLICT DO UPDATE SET id = EXCLUDED.id` → mỗi lần chạy seeder, userId bị đổi
- **Sau:** Đổi thành `ON CONFLICT (email) DO NOTHING`

### 6.8 AI Service Missing Dependency (ĐÃ FIX - Phase 13)

- **Trước:** `@anthropic-ai/sdk` thiếu trong container dev → ai-service crash-loop
- **Sau:** Rebuild image với dependency mới

---

## 7. Logic Errors & Bugs Còn Sống (OPEN)

### P0

| Mã | Mô tả | Trạng thái |
|---|---|---|
| — | **Không có P0 code bugs** — tất cả P0 đã được fix | ✅ Đóng |

### P1

| Mã | Mô tả | Trạng thái |
|---|---|---|
| `BUG-AI-SAFETY-LIVE-001` | Fine-tuned safety recall 42.9% — bỏ sót ngất, đau cấp, tê yếu thần kinh | **Mở** |
| `BUG-AI-EVAL-001` | Fine-tuned không chứng minh tốt hơn base: citation precision 50% vs 100% | **Mở** |
| `BUG-AI-NUTRITION-ALLERGY-001` | Nutrition catalog không có allergen/dietary tags authoritative | **Mở** |
| `BUG-DATA-WORKOUT-LEGACY-001` | Legacy PPL plan có muscle split không khớp exercises | **Mở** |
| `BUG-E2E-PROVIDER-GAPS-001` | OTP, Dropbox Sign, payment sandbox, escrow/release chưa xác minh E2E | **Mở/BLOCKED** |
| `P1-FIN-001` | Personalized Service chưa có Escrow/Held Funds | **Mở** |
| `P1-FIN-002` | Chưa có Milestone-Based Release | **Mở** |
| `P1-UI-001` | PT Reputation chưa hiển thị UI | **Mở** |

### P2

| Mã | Mô tả | Trạng thái |
|---|---|---|
| `BUG-TEST-DOCKER-BUILD-001` | `docker:test:full` build >10 phút | **Mở** |
| `BUG-UI-AI-HEALTH-DUPLICATE-001` | AI Plans gọi `/plans/llm-health` 3 lần khi load | **Mở** |
| `P2-CHAT-001` | Chat chưa có SYSTEM messages theo business events | **Mở** |
| `P2-DOMAIN-001` | HYBRID_COACHING chưa tích hợp booking/session | **Mở** |
| Frontend không tsconfig | Không có type-check trong build | **Mở** |

### P3

| Mã | Mô tả | Trạng thái |
|---|---|---|
| `P3-GROWTH-001` | Chưa có Free Plan → PT Service CTA funnel | **Mở** |

---

## 8. Rủi Ro & Gaps

### 8.1 AI Quality Risks

1. **Safety recall thấp:** Fine-tuned model chỉ 42.9% safety recall, tệ hơn base model (71.4%)
2. **Citation precision:** Base 100% vs Fine-tuned 50%
3. **LLM enum hallucination:** Model thường sinh sai enum trong `proposedChanges`, gây fallback
4. **Vietnamese quality:** Một số câu tóm tắt lẫn tiếng Anh

### 8.2 Financial Risks

1. **Personalized Service không có escrow** — tiền chuyển thẳng vào PT AVAILABLE
2. **Không có milestone-based release** — không thể tính refund theo công việc hoàn thành
3. **External provider E2E chưa chạy** — SMS, Dropbox Sign, payment sandbox chưa có credentials

### 8.3 Infrastructure Risks

1. **Docker build time** — `docker:test:full` build >10 phút, CI sẽ chậm
2. **Frontend bundle size** — 2.05 MB chính + 6.33 MB background image
3. **No frontend type-check** — type errors chỉ bị bắt bởi IDE, không có gate CI

### 8.4 Data Risks

1. **Legacy workout data** — các plan cũ có thể có muscle split không khớp
2. **InBody vision** — chưa có production credential và bộ ảnh ground truth

---

## 9. Khuyến Nghị

### Cấp cao (P0/P1)

1. **Build live evaluation harness** — so sánh base vs fine-tuned model với golden set
2. **Thêm allergen/dietary tags** vào nutrition catalog
3. **Triển khai escrow cho Personalized Service** — `personalized-service-ledger.service.ts`
4. **Milestone-based release** — giữ tiền trong escrow, giải phóng theo milestone
5. **PT reputation UI** — hiển thị rating/reviewCount trên profile và marketplace

### Cấp trung (P2)

6. **Thêm tsconfig.json** cho frontend + `tsc --noEmit` trong CI
7. **Sửa admin-routes-auth test** — đóng handle sau test
8. **Giảm duplicate `/plans/llm-health` calls** — cache result
9. **SYSTEM messages trong chat** — phản ánh business events
10. **HYBRID_COACHING booking integration**

### Cấp thấp (P3)

11. **Free Plan → PT Service CTA** funnel
12. **Image optimization** — bg-gym.jpg 6.33 MB
13. **Docker build optimization** — improve layer caching

---

## 10. Action Items

| STT | Hành động | Owner | Deadline |
|---|---|---|---|
| 1 | Xây live model evaluation harness | AI Team | Phase sau |
| 2 | Triển khai escrow cho Personalized Service | Payment Team | Phase sau |
| 3 | Milestone-based release cho Personalized Service | Payment Team | Phase sau |
| 4 | Thêm allergen tags vào nutrition catalog | Nutrition Team | Phase sau |
| 5 | Hiển thị PT reputation trên UI | Frontend Team | Phase sau |
| 6 | Thêm tsconfig.json cho frontend | Frontend Team | Phase sau |
| 7 | Fix admin-routes-auth test handle leak | QA Team | Phase sau |
| 8 | Giảm duplicate llm-health calls | Frontend Team | Phase sau |
| 9 | SYSTEM messages trong chat | Chat Team | Phase sau |
| 10 | HYBRID_COACHING booking integration | Domain Team | Phase sau |

---

## 11. Kết Luận

Dự án Fitness Assistant là một nền tảng AI fitness **đủ tốt để demo production-hardened MVP** với:

- **589/589 unit/integration tests pass**
- **9 bug P0/P1 đã sửa** trong Phase 12-13
- **Kiến trúc microservices rõ ràng** với 7 services + gateway
- **AI pipeline hoạt động** với RAG + deterministic guardrails

Tuy nhiên, **chưa sẵn sàng cho production scale** do:

- Quality của fine-tuned model chưa tốt hơn base model
- Thiếu escrow cho Personalized Service
- Thiếu provider sandbox E2E (SMS, Dropbox Sign, payment)
- Không có frontend type-check
- Nhiều P1/P2 gaps chưa đóng

**Mức sẵn sàng hiện tại: Demo-ready, chưa Beta/Production-ready.**

---

## Tài Liệu Tham Khảo

- `docs/report/FINAL_ENGINEERING_QA_REPORT_2026-08-17.md`
- `docs/report/AI_FUNCTIONAL_AUDIT_2026-08-17.md`
- `docs/PHASE_13_PRODUCTION_HARDENING_REPORT.md`
- `QA_REMAINING_ISSUES.md`
- `QA_REMAINING_ISSUES_PERSONALIZED_PT.md`
- `QA_FIXED_ISSUES.md`
- `README.md`
- `infra/compose/docker-compose.dev.yml`

---

*Báo cáo được tạo từ deep analysis của monorepo fitness-assistant vào ngày 2026-08-23.*
