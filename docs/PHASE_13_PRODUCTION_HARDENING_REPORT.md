# Phase 13 — Production Hardening & QA End-to-End

> Phạm vi: không thêm feature lớn mới. Mục tiêu là kiểm tra ứng dụng như chuẩn bị đưa demo/production, tìm bug thật, fix bug thật (khi an toàn), và xác nhận các flow chính (onboarding, 4 cấp độ người dùng, RAG, API contract) hoạt động qua HTTP thật — không phải chỉ unit test.

---

## 0. Tóm tắt nhanh

| Hạng mục | Kết quả |
|---|---|
| Bug thật tìm thấy | 11 (9 đã fix trong scope an toàn, 2 document lại cho phase sau) |
| fitness-service test | 205/205 pass |
| ai-service test | 292/292 pass (291/292 trước khi fix bug bind-mount dataset) |
| user-service test | 35/35 pass |
| gateway test | 21/21 pass |
| tsc --noEmit | sạch ở cả 4 service trên |
| frontend build (`vite build`) | build thành công, chỉ có warning cũ (chunk size, dynamic import) — không lỗi |
| Migration status | cả 7 service báo "up to date" (trước đó user-service có 10 migration bị lệch bookkeeping) |
| RAG/Qdrant | ingestion + truy hồi tiếng Việt vẫn hoạt động đúng, xác minh lại bằng script thật |
| Browser/UI QA | hoàn tất (spec 14+15) — tìm 1 bug P0 thật (đã fix, §7.1), còn lại PASS toàn bộ; bộ regression Playwright đầy đủ (15 spec) đang chạy nền, kết quả cuối sẽ bổ sung |

---

## 1. Hai vấn đề tồn đọng từ Phase 7-12 — đã kiểm tra và xử lý

### 1.1. `ai-service` container thiếu `@anthropic-ai/sdk`
**Thực tế nghiêm trọng hơn báo cáo trước**: đây không phải "thiếu graceful degrade" mà là **toàn bộ ai-service crash-loop, không khởi động được** (`Error: Cannot find module '@anthropic-ai/sdk'` ném ra ngay ở tầng `require()` khi import `llm.service.ts`, làm chết cả process). Nguyên nhân: `package.json`/`node_modules` không được bind-mount vào container dev (chỉ `src`/`prisma`/`data` được mount), nên dependency mới thêm vào `package.json` chưa từng được đưa vào image đã build trước đó.

**Đã fix**: `docker compose build ai-service` (rebuild lại image với dependency mới) rồi recreate container. Xác nhận: container chuyển từ `unhealthy` (365 lần healthcheck fail liên tiếp) sang `healthy`, log khởi động sạch, kết nối Qdrant/Ollama bình thường.

### 1.2. `user-service` migration drift
Xác minh: `prisma migrate status` báo 10 migration "chưa áp dụng", nhưng kiểm tra trực tiếp schema Postgres (`\d user_profiles`, `\d contracts`, `\d inbody_entries`...) cho thấy **toàn bộ cột/bảng của cả 10 migration đó đã tồn tại thật trong DB** — đây chỉ là lệch sổ sách (`_prisma_migrations`), không phải lệch schema thật. Rất có thể do các thay đổi này từng được áp dụng thủ công (`db push`/SQL tay) ở giai đoạn trước, trước khi quy trình `migrate resolve --applied` được dùng nhất quán.

**Đã fix**: chạy `prisma migrate resolve --applied <name>` cho cả 10 migration theo đúng thứ tự thời gian. Xác nhận lại: `Database schema is up to date!`.

---

## 2. Bug thật phát hiện thêm trong lúc QA (ngoài 2 vấn đề trên)

### 2.1. [P0] Regression thật: mọi user cũ bị ép quay lại onboarding wizard
`has_completed_onboarding` được thêm với default `false` (migration Phase 9), nhưng đây là cột mới nên **toàn bộ 2942 profile có sẵn** (kể cả 2940 profile đã có đủ `goal`/`experienceLevel`/`preferredTrainingDays` từ trước khi có wizard) cũng mặc định `false`. `RequireOnboarding.tsx` kiểm tra đúng `hasCompletedOnboarding !== true` → redirect `/client/onboarding`. Hậu quả: **mọi user thật (và mọi tài khoản seed mà bộ Playwright E2E hiện có đang dùng) sẽ bị ép vào wizard ngay lần đăng nhập tiếp theo**, dù họ đã dùng app từ trước.

**Đã fix** (sau khi xin xác nhận người dùng vì đây là thao tác UPDATE hàng loạt trên DB):
- Backfill `has_completed_onboarding = true` cho 2940 profile đã có đủ 3 trường lõi (`goal`, `experienceLevel`, `preferredTrainingDays`); giữ nguyên `false` cho 2 profile thực sự thiếu dữ liệu (đúng hành vi mong muốn).
- Viết thêm migration mới `20260803010000_backfill_has_completed_onboarding` (idempotent, chỉ update các dòng còn `false`) để môi trường khác (staging, deploy mới) áp `migrate deploy` cũng tự động có backfill này, không chỉ dev hiện tại.

### 2.2. [P1] `scripts/seed-test-users.mjs`: seeder không thực sự idempotent như tài liệu tự nhận
File tự ghi chú "idempotent via ON CONFLICT DO NOTHING", nhưng thực tế 2 câu insert user auth (PT + CUSTOMER) dùng:
```sql
ON CONFLICT (email) DO UPDATE SET id = EXCLUDED.id
```
Nghĩa là **mỗi lần seeder chạy lại (mỗi lần `docker compose up`), user đã tồn tại theo email bị gán một `id` (UUID) MỚI hoàn toàn**, làm mồ côi mọi dữ liệu ở service khác từng được ghi theo `id` cũ (profile, training cycle, InBody, workout...) — vì các service khác chỉ liên kết theo `userId`, không có ràng buộc khóa ngoại xuyên service. Phát hiện được vì khi so lại mapping email↔userId trước/sau một lần `docker compose up`, cùng một email trả về `userId` khác, kéo theo `experienceLevel` (dữ liệu test ngẫu nhiên theo id mới) cũng đổi theo.

**Đã fix**: đổi cả 2 câu lệnh thành `ON CONFLICT (email) DO NOTHING` (script vẫn re-fetch `id` hiện có bằng `SELECT ... WHERE email=$1` ngay sau đó nên logic còn lại không bị ảnh hưởng).

### 2.3. [P1] `ai-service` thiếu bind-mount cho dataset nội bộ (dev) và thiếu COPY trong Dockerfile production
Test `datasets.test.ts` (`freeExerciseDbProvider.load returns exercises from the sample seed file`) fail thật: `Expected at least 10 sample exercises, got 0`. Nguyên nhân: `datasetConfig.ts` đọc file từ `process.cwd()/data/datasets/free-exercise-db/exercises.json` (tương đối theo working dir của service, khác với `data/` gốc repo dùng cho Qdrant), nhưng:
- **Dev**: `docker-compose.dev.yml` chỉ mount `src`, `prisma`, và `../../data` (thư mục gốc) — không mount `backend/services/ai-service/data/`.
- **Production**: `Dockerfile` build multi-stage copy toàn bộ thư mục service ở stage `builder`, nhưng stage `runner` (image thật chạy) **chỉ COPY `dist`, `node_modules`, `prisma`, `package.json`** — không có `data/`. Nghĩa là bug này **sẽ tồn tại y hệt ở production**, không phải chỉ vấn đề dev.
- Vì code có xử lý an toàn ("Disabled provider does not crash startup" — provider tự return rỗng khi thiếu file, không throw), lỗi này bị che giấu hoàn toàn ở runtime (không crash, không log lỗi nổi bật), chỉ lộ ra qua test thật.

**Đã fix**: thêm mount `../../backend/services/ai-service/data:/app/backend/services/ai-service/data` vào cả 2 service dùng chung Dockerfile.dev (`ai-service` và `knowledge-worker`) trong `docker-compose.dev.yml`; thêm `COPY --from=builder .../data ./backend/services/ai-service/data` vào stage `runner` của `Dockerfile` production. Xác nhận: test pass lại (292/292), file tồn tại đúng path trong container.

### 2.4. [P2] Comment lỗi thời trong `training-cycle.service.ts`
Comment khẳng định "nothing in this codebase writes SKIPPED today" — nhưng `workout.service.ts` có hàm ghi status `SKIPPED` thật, và route `/schedules/:id/skip` đã được wire vào `workout.routes.ts`. Logic code (`missedSessions = schedules.filter(s => s.status !== "COMPLETED" && s.date < now)`) vẫn xử lý đúng (coi mọi status khác COMPLETED của buổi đã qua là "missed", bất kể SKIPPED/CANCELLED/PARTIALLY_COMPLETED), chỉ có comment sai gây hiểu nhầm cho người đọc sau. **Đã sửa comment cho khớp thực tế.**

### 2.5. [P1 — document, chưa fix] Độ tin cậy AI explanation: LLM thường xuyên sinh sai enum, dẫn đến fallback
Log thật từ ai-service trong lúc chạy 4 luồng persona:
```
"received": "", "code": "invalid_enum_value", "path": ["proposedChanges", 0, "type"]
"Invalid enum value. Expected 'VOLUME' | 'LOAD' | 'REPS' | 'EXERCISE' | 'FREQUENCY' | 'DELOAD', received ''"
...
"phase failed after retries, using fallback for this phase"
```
Model LLM local (fine-tuned qwen2.5-1.5b) **nhiều lần bỏ trống trường `type` bắt buộc** trong `proposedChanges`, khiến Zod validate fail, retry (tối đa 3 lần), và khi hết retry thì rơi vào fallback template chung ("AI không tạo được phần giải thích chi tiết — dưới đây là các lý do được hệ thống tính toán trực tiếp."). Trong 4 lần test persona thật, **1/4 lần rơi hẳn vào fallback**, các lần khác phải retry ít nhất 1 lần mới qua được. Ngoài ra một số câu tóm tắt AI bị lẫn tiếng Anh vào câu tiếng Việt ("giữ khoảng 75-90% if possible").

Đây **không phải bug code** (magnitude-cap 20%/60% hoạt động đúng như thiết kế — xác nhận qua log "implausible ... dropping them" đúng là do validator chặn thay đổi quá lớn, không phải lỗi) mà là **vấn đề độ tin cậy đầu ra của LLM khi chạy với model nhỏ/local**. Ảnh hưởng thật: một phần các lần đánh giá chu kỳ, user sẽ thấy `proposedChanges: []` (rỗng) dù quyết định (KEEP/ADJUST/...) vẫn đúng, làm giảm giá trị "recommendedActions hợp lý" theo yêu cầu ban đầu.

**Đề xuất cho phase sau** (không sửa trong lần này vì đây là vấn đề prompt/schema-reliability cần thiết kế lại cẩn thận, không phải fix 1 dòng):
- Thêm bước "repair" nhẹ trước khi Zod validate: nếu `type` là chuỗi rỗng/gần đúng (ví dụ chứa "volume", "load"...), map về enum hợp lệ thay vì fail thẳng.
- Tăng số lần retry riêng cho lỗi enum rỗng, hoặc few-shot thêm ví dụ JSON đúng format trong prompt.
- Cân nhắc post-process cắt bỏ các từ tiếng Anh lẫn vào câu tiếng Việt trước khi trả về.

### 2.6. [Không phải bug, nhưng nên biết] Session feedback (RPE/đau/readiness) chỉ sửa được trong ngày
`assertScheduleDateEditable` (dùng chung logic khóa lịch tập đã có sẵn) chặn `POST /training-cycles/:id/sessions/:scheduleId/feedback` cho buổi tập đã qua ngày: `"Không thể chỉnh sửa buổi tập của ngày đã qua."`. Đây là hành vi hợp lý (feedback nên ghi ngay sau buổi tập), nhưng có nghĩa là **logic fatigue/pain-aware của Decision Engine hoàn toàn phụ thuộc vào việc user ghi feedback đúng lúc** — nếu user quên, dữ liệu đó vĩnh viễn không thể bổ sung cho chu kỳ đó. Không phải lỗi kiến trúc cần sửa gấp, nhưng đáng lưu ý khi đánh giá vì sao DELOAD có thể ít khi được kích hoạt trong thực tế nếu user không log RPE/đau đều đặn.

### 2.7. [Quan sát] Frontend không có `tsconfig.json` — không có bước type-check nào cho frontend
Xác minh: `frontend/web/` (cả trên host lẫn trong container) **không có file `tsconfig.json` nào** (`Glob` toàn bộ thư mục không ra kết quả). `Dockerfile.dev` chỉ copy `index.html`, `vite.config.ts`, `postcss.config.mjs` — không có tsconfig. Nghĩa là Vite/esbuild transpile TypeScript **không hề kiểm tra type nào cả**, kể cả khi chạy `vite build`. Đây là gap thật về tooling (không phải bug tính năng), nhưng đáng ghi nhận: lỗi type hiện tại chỉ có thể được bắt bởi IDE của lập trình viên (nếu IDE tự suy ra tsconfig ngầm), không có gate nào ở CI/build. Đề xuất phase sau: thêm `tsconfig.json` + bước `tsc --noEmit` riêng cho frontend (có thể phát sinh một số lỗi type tồn đọng cần dọn, nên nên làm thành phase riêng, không lẫn vào phase hardening này).

---

## 3. QA luồng thật qua HTTP (persona theo cấp độ)

Test qua gateway thật (`http://localhost:3000`), dùng tài khoản test có sẵn (`testuserNNN@example.com` / `Test@123456`), dữ liệu buổi tập/InBody được seed trực tiếp qua SQL (theo đúng convention integration test đã có sẵn của dự án) rồi gọi thật `POST /training-cycles`, `POST /training-cycles/:id/inbody-links`, `POST /training-cycles/:id/evaluate` — không mock, chạy qua Decision Engine + AI service thật.

| Persona (xác nhận qua profile thật lúc eval) | Dữ liệu seed | Decision | Ghi chú |
|---|---|---|---|
| BEGINNER, không thi đấu | 31 buổi tập đều, tăng nhẹ, có InBody đầu/cuối | **ADJUST**, `minor_adjustment` | Không đề xuất volume/intensity cao; 1 proposedChange volume 27% bị validator loại đúng vì vượt trần 20% dành riêng cho beginner |
| ADVANCED, không thi đấu | 31 buổi, tăng tải đều, InBody cải thiện rõ | **PROGRESS**, reasonCodes `STRONG_COMPOSITE_PROGRESS_SCORE` | Có `proposedChanges` cấu trúc thật (VOLUME, số cụ thể "2440 kg → 2650-2980 kg") |
| BEGINNER (test dự định cho fatigue cao, RPE 9/đau 4/readiness 3 mọi buổi, volume giảm mạnh) | 31 buổi, volume giảm 84% | **ADJUST** (không phải DELOAD) | Đúng như thiết kế: ngưỡng DELOAD cho BEGINNER khoan dung hơn nhiều (`lowRecoveryScoreBeginner=0.25` so với 0.45 của ADVANCED) — recoveryScore đo được (0.3) không vượt ngưỡng beginner dù đã vượt ngưỡng advanced. Xác nhận gián tiếp logic level-aware hoạt động đúng, nhưng **chưa tái xác nhận riêng nhánh DELOAD ở tầng HTTP cho user ADVANCED thật trong lần QA này** (đã được unit test Phase 8/11 bao phủ đầy đủ với 36 tổ hợp) |
| ADVANCED + `competesInSport=true` (chuyên nghiệp), dữ liệu thưa (không link InBody, không feedback) | 31 buổi tập nhưng thiếu InBody/feedback | **INSUFFICIENT_DATA**, reasonCodes gồm cả `INSUFFICIENT_COMPARABLE_DATA` **và** `PROFESSIONAL_REQUIRES_HIGHER_DATA_QUALITY` | Xác nhận cổng data-quality riêng cho vận động viên chuyên nghiệp kích hoạt đúng qua HTTP thật |
| INTERMEDIATE + `competesInSport=true` (không đủ điều kiện "chuyên nghiệp" vì chưa ADVANCED) | dữ liệu thưa | **INSUFFICIENT_DATA** qua cổng chung (không có `PROFESSIONAL_...`) | Xác nhận đúng thiết kế: chỉ `ADVANCED && competesInSport` mới được coi là chuyên nghiệp — `competesInSport=true` một mình không đủ |

Kết luận: **quyết định thực sự khác nhau giữa các cấp độ khi chạy qua HTTP thật**, không chỉ trong unit test; beginner không bao giờ được đề xuất thay đổi biên độ lớn; cổng data-quality riêng cho vận động viên chuyên nghiệp hoạt động đúng và độc lập với cổng chung.

---

## 4. API contract QA

Kiểm tra qua gateway thật, cùng tài khoản trên:
- `GET /training-cycles/:id/assessments`, `/audit`, `/progress` — trả đúng cấu trúc, khớp type ở frontend (`api.ts`).
- Không token → `401 {"success":false,"error":{"code":"UNAUTHORIZED",...}}`.
- User khác cố truy cập cycle không phải của mình → `404 "Training cycle not found"` (không lộ thông tin tồn tại, đúng pattern `where:{id,userId}` toàn bộ codebase đang dùng).
- `PUT /profile/me` với `competesInSport` — lưu và đọc lại đúng ngay lập tức.
- Không còn legacy path nào tạo `decision` khác với Decision Engine hợp nhất (`/complete` và `/evaluate` đều đi qua `runVersionedAssessment` — xác nhận lại từ Phase 7, không đổi trong phase này).

---

## 5. Data/RAG QA

Chạy lại `testTrainingMethodsIntegration.ts` (script thật, không mock, dùng Qdrant + retriever thật):
- Cả 4 record `training_methods.json` tồn tại trong collection `fitness_evidence`, đều có `title`, `source_url` dạng http(s) thật, `copyright_safe=true`, `created_from` đúng dataset.
- Truy vấn tiếng Việt thật qua `retriever.retrieveEvidence()` → `evidenceUsedFromDocs()` vẫn trả về ít nhất 1 citation hợp lệ, và ít nhất 1 record từ `training_methods.json` thực sự được truy hồi (không chỉ nằm trong DB mà không bao giờ được tìm thấy).
- Không phát hiện nội dung copy nguyên văn chương trình trả phí — cơ chế `copyright_safe` gate + `wording_rule` (paraphrase bắt buộc) vẫn nguyên vẹn từ Phase 10.
- AI explanation dùng RAG evidence để giải thích (không tính toán metric) — xác nhận qua code path, Decision Engine vẫn là nơi duy nhất tính số liệu; AI chỉ nhận structured payload theo đúng nguyên tắc "AI không tự tính metric".

---

## 6. Kết quả regression đầy đủ

Lệnh chạy chính xác (qua container dev):
```bash
# fitness-service
docker exec gymcoach-fitness-dev sh -c "FITNESS_DATABASE_URL='postgresql://gymcoach:gymcoach_password@postgres:5432/gymcoach_fitness_test' npx tsx --test src/__tests__/*.test.ts"
# ai-service
docker exec gymcoach-ai-dev sh -c "npx tsx --test src/__tests__/*.test.ts src/llm/__tests__/*.test.ts src/datasets/__tests__/*.test.ts"
# user-service
docker exec gymcoach-user-dev sh -c "npx tsx --test src/__tests__/*.test.ts"
# gateway
docker exec gymcoach-gateway-dev sh -c "npx tsx --test src/__tests__/*.test.ts"
# tsc từng service
docker exec <container> npx tsc --noEmit
# frontend build
docker exec gymcoach-web-dev sh -c "npx vite build"
# migration
docker exec <container> npx prisma migrate status
```

| Service | Test | tsc | Ghi chú |
|---|---|---|---|
| fitness-service | 205/205 ✅ | sạch | không đổi so với Phase 12 |
| ai-service | 292/292 ✅ (291/292 trước fix §2.3) | sạch | |
| user-service | 35/35 ✅ | sạch | |
| gateway | 21/21 ✅ | sạch | |
| frontend | build OK (vite build) | không có tsconfig — xem §2.7 | |
| Migration (7 service) | tất cả "up to date" | — | user-service trước đó lệch 10 migration, đã resolve (§1.2) + backfill mới (§2.1) |

**Tổng**: 553 → **553/553 test pass** (205+292+35+21), không tính test mới; không có regression thật nào do các thay đổi trong phase này gây ra (fail duy nhất phát sinh — dataset bind-mount — đã fix ngay và xác nhận lại).

---

## 7. Browser/UI QA

Được giao cho một agent nền chạy Playwright thật (headless Chromium) qua bộ harness E2E có sẵn ngoài repo (`fitnessassistant-playwright-e2e/`), viết 2 spec mới:
- `tests/14-onboarding-wizard.spec.ts` — round-trip đầy đủ: đặt `hasCompletedOnboarding=false` cho `john.doe@example.com` qua API, xác nhận bị redirect `/client/onboarding`, điền đủ 6 bước wizard bằng giá trị phân biệt được, xác nhận lưu đúng cả 6 trường (`experienceLevel`, `competesInSport`, `preferredSplit`, `goal`, `availableEquipment`, `injuries`), xác nhận vào được app chính, và **bắt buộc khôi phục lại profile gốc của john.doe** sau khi test xong (vì tài khoản này được nhiều spec khác dùng).
- `tests/15-phase13-ui-qa.spec.ts` — chụp màn hình desktop (1280x800) + mobile (390x844) cho: dashboard chu kỳ tập luyện (DecisionCard, CycleHistoryRow với toàn bộ lịch sử quyết định 6 loại của john.doe), trang log workout (kiểm tra lại phản ánh khiếu nại "khá mờ và không cân" của RulerSlider), InBody, màn giải thích AI, chính wizard onboarding ở mobile, trang hồ sơ.

Agent bị gián đoạn một lần giữa chừng do chạm giới hạn phiên làm việc (không phải lỗi kỹ thuật thật), đã được resume và hoàn tất.

### 7.1. [P0 — ĐÃ FIX] Sau khi hoàn tất wizard, user bị "bật ngược" lại bước 1 dù dữ liệu đã lưu đúng
Phát hiện qua browser thật, tái hiện được 3/3 lần: bấm "Hoàn tất" (hoặc "Bỏ qua, thiết lập sau") ở bước cuối → dữ liệu lưu đúng (toast xác nhận, giá trị hiển thị đúng nếu quay lại bước 1) nhưng **màn hình bị điều hướng ngược về `/client/onboarding` (reset về bước 1/6)** thay vì vào `/client/dashboard`.

**Nguyên nhân (đã xác định chính xác)**: `OnboardingWizardPage`'s `onSuccess` gọi `queryClient.invalidateQueries(['profile', user.id])` (chỉ đánh dấu stale + kích hoạt refetch nền, KHÔNG đợi refetch xong) rồi gọi `navigate('/client/dashboard')` ngay lập tức. `RequireOnboarding.tsx` mount tại route đích và đọc đúng query key đó — nhưng tại thời điểm đó refetch nền có thể chưa kịp trả về, nên guard vẫn thấy dữ liệu cũ (`hasCompletedOnboarding` chưa cập nhật) và bật user quay lại onboarding. Vì `RequireOnboarding` loại trừ chính route onboarding, user bị kẹt ở đó cho đến khi tự điều hướng tay lần 2 (lúc đó cache đã mới).

**Đã fix**: đổi `mutationFn` để trả luôn profile mới nhất từ response của `PUT /profile/me` (đã có sẵn, trước đây bị bỏ qua), rồi trong `onSuccess` gọi `queryClient.setQueryData(['profile', user?.id], profile)` (ghi cache đồng bộ, không qua refetch bất đồng bộ) **trước khi** `navigate()`. Loại bỏ hoàn toàn khoảng hở đua giữa 2 lệnh. Đã xác nhận `vite build` sạch sau khi sửa; do đây là bug được tìm ra ở lượt QA cuối, khuyến nghị chạy lại spec 14 một lần nữa trước khi coi Phase 13 đóng hoàn toàn.

### 7.2. Kết quả còn lại — PASS
- Cả 6 trường (`experienceLevel`, `competesInSport`, `preferredSplit`, `goal`, `availableEquipment`, `injuries`) xác nhận round-trip đúng qua API sau khi điền wizard.
- Đường "Bỏ qua, thiết lập sau" cũng set `hasCompletedOnboarding=true` — đúng chủ ý thiết kế (để không bị kẹt vòng lặp redirect), không phải bug.
- **Profile của john.doe được khôi phục chính xác về trạng thái ban đầu** — xác nhận qua diff đầy đủ response API trước/sau, PASS.
- Spec 15 (QA UI diện rộng): tất cả pass trên cả desktop lẫn mobile cho Training Cycle tab, Workout Log tab, InBody, Profile, trạng thái loading, và wizard onboarding ở 390×844 — không trang trắng, không React error boundary, không lỗi 5xx, không tràn ngang, không hiển thị "undefined" trong lịch sử chu kỳ.
- Quan sát phụ (không phải lỗi): kế hoạch tập hiện tại của john.doe không có ngày nào "mở khóa" để log vào đúng ngày QA chạy (2026-08-04), nên **chưa tái xác nhận trực quan được khiếu nại "khá mờ và không cân" của RulerSlider** trong một phiên log thật — cần lặp lại khi có ngày tập khả dụng. Footer nút của wizard ("Quay lại"/"Bỏ qua, thiết lập sau") xuống 2 dòng ở màn 390px — chỉ là vấn đề thẩm mỹ nhỏ, không che khuất hay chồng lấn gì.

Bộ regression đầy đủ của harness (`npm run test:e2e:with-cleanup`, 15 spec 00-15) được agent chạy nền sau đó — kết quả pass/fail/blocked chính xác sẽ được cập nhật khi có (đã biết trước 4 test "wallet balance" là flaky do tích luỹ số dư qua nhiều lần chạy, không tính là regression mới — xem `AGENT_HANDOFF.md` mục 9).

---

## 7.3. [P1 — ĐÃ FIX, phát hiện ngoài lịch, do người dùng báo trực tiếp] AI plan chọn bài tập theo bảng chữ cái, không theo tiêu chuẩn tập luyện

Người dùng báo cáo trực tiếp một plan AI thật có 6 bài tập gần như xếp tuyệt đối theo alphabet (Axle Deadlift, Alternating Floor Press, Atlas Stone Trainer, Atlas Stones, Back Flyes, Barbell Ab Rollout), nghi ngờ bản fix trước đó (dặn LLM không lấy thứ tự catalog làm thứ tự tập) không còn tác dụng. Điều tra qua code + log xác nhận: **model không hề yếu**, đây là 2 bug tầng dữ liệu:

**a) Candidate-list bị cắt theo alphabet trước khi tới LLM.** `exerciseRepository.findMany` luôn `orderBy: exerciseName ASC` (đúng cho trang duyệt catalog, không đổi). Nhưng `internal.controller.ts`'s `/internal/exercises/for-ai-plans` — endpoint duy nhất nuôi dữ liệu cho AI plan generation — lấy toàn bộ kết quả (đã sắp alphabet) rồi `.slice(0, lim)` (`lim`=120, gửi từ `ai.worker.ts`). Nếu bộ lọc goal/equipment khớp hơn 120 bài, chỉ nhóm A/B mới lọt vào candidate pool — bất kể LLM có "suy nghĩ" tốt đến đâu, nó chỉ được chọn từ một tập mẫu thiên lệch sẵn. Bản fix trước (prompt dặn LLM tự sắp `order`) chỉ sửa **thứ tự hiển thị trong ngày**, không sửa bước này.
  - **Đã fix**: xáo trộn (Fisher-Yates) toàn bộ kết quả trước khi cắt còn `lim`, thay vì cắt thẳng trên mảng đã sắp alphabet. Xác nhận sống: gọi lại endpoint 3 lần với cùng tham số, mỗi lần trả về một tập bài tập hoàn toàn khác nhau (trước đây luôn giống hệt, luôn nhóm A/B).
  - Đã lần theo toàn bộ luồng dữ liệu để xác nhận nhánh fallback hoàn toàn không qua LLM (`buildDeterministicPlanFromCatalogs`, kích hoạt khi LLM timeout hoặc trả JSON hỏng) cũng nhận input từ đúng candidate pool này (không có bước sắp xếp nào khác ở giữa) — nên **được sửa cùng lúc, không cần đụng vào chính nhánh đó**. Cân nhắc thêm 1 lớp xáo trộn ngay trong nhánh fallback nhưng quyết định KHÔNG làm — vì nhánh này chọn theo điểm số phù hợp (`filterExercisesForDay`) đã sort giảm dần theo score, xáo trộn thêm ở đây sẽ phá vỡ đúng thứ tự ưu tiên đó (bài phù hợp hơn có thể bị xếp sau bài kém phù hợp hơn) — không phải fix, mà là đánh đổi lấy rủi ro mới.

**b) "Muscle/Equipment: --" xảy ra ở MỌI bài tập, mọi plan — không liên quan riêng gì tới các bài trong ảnh.** Plan content chỉ lưu `{exerciseId, order, name, sets, reps, restSeconds, note}` — chưa từng lưu muscle/equipment. Frontend đọc thẳng các field này từ JSON của plan (vốn không có) rồi fallback `"--"`, không hề join lại catalog.
  - **Đã fix**: thêm filter `ids` vào endpoint `GET /exercises` sẵn có (`exercise.service.ts`/`exercise.controller.ts`) để tra cứu hàng loạt theo id trong 1 lần gọi (không phá endpoint cũ — khi có `ids`, bỏ qua phân trang mặc định 30/trang để trả đủ tất cả id yêu cầu). Frontend (`AIPlansPage.tsx`) gom toàn bộ `exerciseId` hợp lệ trong plan đang xem, gọi 1 lần qua `workoutService.getExercisesByIds`, dựng map tra cứu, hiển thị `muscleGroupsActivated`/`typeOfEquipment` thật thay vì luôn `"--"`.
  - **"Intensity" bị bỏ khỏi giao diện** (không phải "để trống có chủ đích" mà là gỡ bỏ) — xác nhận khái niệm này chưa từng tồn tại ở bất kỳ đâu (không trong plan schema, không trong exercise catalog): hiển thị `"--"` vĩnh viễn cho một field không hề có nguồn dữ liệu là gây hiểu lầm hơn là hữu ích, và tự bịa một giá trị intensity sẽ vi phạm nguyên tắc "không tự bịa metric" của cả dự án.
  - Xác nhận sống: gọi `GET /exercises?ids=id1,id2,id3` trả đúng chính xác 3 bài yêu cầu kèm `typeOfEquipment`/`muscleGroupsActivated` thật (trước khi container fitness-service được restart để nạp code mới, endpoint này từng "cache hit" nhầm vào listing cũ — một lưu ý vận hành: `tsx watch` đôi khi không tự hot-reload thay đổi tầng route/service, cần restart thủ công để chắc chắn, giống vấn đề Prisma-client-cache đã ghi nhận ở Phase 9).

Đã build lại frontend (`vite build` sạch) và chạy lại toàn bộ test fitness-service (205/205) + ai-service (292/292) sau các thay đổi trên — không phát sinh regression.

## 8. Rủi ro còn lại / đề xuất phase sau

1. **Độ tin cậy structured output của LLM local** (§2.5) — cần một phase riêng tập trung vào prompt engineering/schema-repair, không nên gộp vào hardening.
2. **Không có type-check cho frontend** (§2.7) — nên thêm `tsconfig.json` + `tsc --noEmit` như một phase riêng vì có thể lộ ra nhiều lỗi type tồn đọng cần thời gian dọn.
3. **Session feedback chỉ sửa được trong ngày** (§2.6) — cân nhắc UX nhắc nhở user log RPE/đau ngay sau buổi tập nếu muốn Decision Engine tận dụng tối đa tín hiệu fatigue.
4. **Chưa tái xác nhận riêng nhánh DELOAD ở tầng HTTP cho một user ADVANCED thật** trong đợt QA này (do nhầm lẫn nhãn persona khi seeder gây xáo trộn userId — xem §2.2) — nhánh này đã được unit test đầy đủ (Phase 8/11, 36 tổ hợp), rủi ro thấp, nhưng nếu muốn xác nhận thêm ở tầng HTTP thì có thể lặp lại với một user ADVANCED xác định chắc chắn.
5. Các gap đã biết từ Phase 7-12 (TrainingBlockPlan/periodization cho vận động viên chuyên nghiệp, một số bản ghi `external_evidence_dataset` cũ thiếu `source_url`, drift bookkeeping ở service khác ngoài user-service — đã kiểm tra lại ở §6, không còn) vẫn giữ nguyên trạng thái như tài liệu Phase 12 đã ghi.

---

## 9. Kết luận readiness

**Có thể demo/production ở mức "production-hardened cho MVP"** với các điều kiện:
- Nguyên tắc cốt lõi (Decision Engine deterministic quyết định, AI chỉ giải thích) **vẫn được giữ nguyên và xác nhận lại qua HTTP thật** trong phase này — không có luồng nào để LLM tự quyết định hay tự tính metric.
- 2 bug hạ tầng nghiêm trọng nhất (ai-service crash-loop, mọi user bị ép onboarding lại) đã được xử lý — đây là những thứ **chắc chắn sẽ gây sự cố thật nếu demo/deploy mà không phát hiện**.
- Rủi ro còn lại chủ yếu ở **chất lượng/độ tin cậy của phần giải thích AI** (không phải quyết định), có fallback an toàn (không bao giờ trả về lỗi cho user, chỉ có thể kém chi tiết hơn mong đợi) — chấp nhận được cho demo, cần cải thiện trước khi coi là "polish" hoàn chỉnh.
- Phần Browser/UI QA (mục 7) đã hoàn tất và tìm ra 1 bug P0 thật ở chính bước cuối cùng của onboarding (user bị bật ngược về bước 1 dù dữ liệu đã lưu đúng) — **đã fix** (race condition giữa `invalidateQueries` bất đồng bộ và `navigate()`, khắc phục bằng `setQueryData` đồng bộ trước khi điều hướng). Đây là bug ảnh hưởng **100% user mới hoàn thành onboarding lần đầu** nếu không phát hiện — mức độ nghiêm trọng cao dù cách khắc phục đơn giản. Khuyến nghị chạy lại spec 14 một lần để xác nhận trực quan fix trước khi coi mục này đóng hoàn toàn; kết quả bộ regression Playwright đầy đủ (15 spec) sẽ được bổ sung khi agent nền hoàn tất.
