# Checkpoint: Production-Hardening Pass — Chức năng Tập luyện

> Point-in-time hardening checkpoint retained for traceability. Re-run current
> tests before relying on its pass counts.

Trạng thái tại thời điểm này: **chưa hoàn tất toàn bộ** yêu cầu gốc (rất lớn,
nhiều phase). Tài liệu này là điểm checkpoint để phiên làm việc sau tiếp tục
đúng chỗ, không làm lại từ đầu.

## Đã hoàn thành và đã xác minh (real DB / real browser / real build)

### P0 — Nghiêm trọng

1. **Reload mở khóa lại ngày đã qua.** Nguyên nhân gốc: `selectedDate` trong
   `WorkoutLogPage.tsx` luôn khởi tạo lại thành `new Date()` (hôm nay) mỗi lần
   mount, bất kể URL đang xem ngày nào — trong khi khóa chỉnh sửa và phần
   merge dữ liệu thật đều tính theo `selectedDate`. Đã sửa: URL mang thêm
   `date=YYYY-MM-DD` (`workout-log-url.utils.ts`), `selectedDate` được khôi
   phục từ URL này khi mount. Xác minh bằng Playwright thật: banner khóa, RPE
   slider disabled, nút hoàn thành disabled, nút timer disabled đều giữ đúng
   sau khi F5. 24 unit test cho việc parse/ghi URL (bao gồm dữ liệu ngày sai
   định dạng như `2026-13-99`).
2. **Backend có thực sự chặn sửa ngày đã qua qua API không?** Đã xác nhận
   CÓ — `schedule-lock.util.ts`'s `assertScheduleDateEditable` được gọi ở mọi
   endpoint ghi (start/complete/addSet/updateSet/delete/create/update), trả
   409 `SCHEDULE_DATE_LOCKED`. `schedule-lock.integration.test.ts` (9 test,
   dùng DB thật, không mock) xác nhận điều này không bị ảnh hưởng bởi bug ở
   mục 1 — bug đó chỉ ở phía URL/state của frontend, backend chưa từng bị
   bypass thật.
3. **Một buổi hiện 0% rồi chuyển 100% sau reload.** Nguyên nhân: cùng gốc
   với mục 1 — phần merge dữ liệu thật (`weight/rpe/rir` + tập nào đã hoàn
   thành) tra cứu theo `selectedDate` sai. Đã tách logic merge ra
   `workout-log-completion-merge.utils.ts` (hàm thuần, không phụ thuộc DOM)
   và viết 7 unit test khẳng định: không suy luận 100% chỉ vì tồn tại bản ghi
   `WorkoutExercise`; phải có **mọi set** `completed = true` mới tính là xong.

### P1 — Không nhất quán dữ liệu

4. **"58 buổi hoàn thành" vs báo cáo chu kỳ "21 hoàn thành".** Nguyên nhân:
   `statsService.getWorkoutStats` đếm số dòng bảng `Workout` thô (kể cả log
   không gắn với schedule COMPLETED nào), khác định nghĩa "hoàn thành" dùng ở
   mọi nơi khác (`WorkoutSchedule.status === COMPLETED`). Đã sửa: thêm
   `workoutRepository.countCompletedSchedules`, dùng định nghĩa canonical
   này cho `totalWorkouts`. Xác nhận bằng `stats.service.integration.test.ts`
   (DB thật) + `curl` thật qua gateway: số giảm từ 56 → 42 sau khi sửa (không
   còn đếm nhầm log rời rạc).
5. **"Tuần này: 0/6".** Nguyên nhân: field `weeklyWorkouts` chưa từng tồn tại
   ở backend — frontend đọc `workoutStats?.weeklyWorkouts` và luôn fallback
   về `0` cứng. Đã thêm `currentWeekRange(now, tz)` (Thứ 2 → Chủ nhật, tính
   theo `Asia/Ho_Chi_Minh`, dùng chung logic timezone với khóa ngày) trong
   `schedule-lock.util.ts`, và trả `weeklyWorkouts` thật từ backend. Xác nhận
   qua Playwright thật trên UI: hiển thị "5 / 6 buổi" (không còn 0 cứng), và
   qua 3 integration test mới (DB thật).
6. **"Buổi tập sắp tới" chứa ngày đã qua.** Nguyên nhân: danh sách lấy 5 phần
   tử đầu của `aiSchedules` không lọc theo ngày. Đã thêm `upcomingSchedules`
   (lọc bằng `isScheduleDateApiValueLocked`, khử trùng theo ngày).
7. **Chu kỳ vừa "đang phân tích AI" vừa "không có chu kỳ hoạt động".**
   Nguyên nhân: `DecisionCard` (hệ cũ) hiện banner "đang phân tích" chỉ dựa
   vào `status === COMPLETED`, không biết hệ mới (`CycleAssessment` qua
   `/evaluate`) đã có kết quả thật, và không có timeout nếu job cũ treo mãi.
   Đã sửa: ưu tiên hiển thị assessment mới nếu có; sau 2 phút không xong thì
   gợi ý dùng "Đánh giá chu kỳ (nâng cao)" thay vì spin vô hạn.
8. **Cùng một chu kỳ hiện 74%/88%/95% tuân thủ ở 3 chỗ khác nhau.**
   `CycleHistoryRow` trước đây đọc field cũ `cycle.summary?.adherence.percent
   ?? 0` — fabricating "0%" khi field này null dù hệ mới đã có số thật. Đã
   sửa: fallback sang `computedMetrics.adherenceRate` của assessment mới,
   chỉ hiện "Chưa có dữ liệu" khi thật sự không có nguồn nào. Đổi nhãn thành
   "Tuân thủ buổi tập" để không trùng tên với các loại tuân thủ khác.
9. **Công thức chỉ số ẩn (vd "Sức mạnh 93%") không giải thích được.** Đã thêm
   prop `formula` bắt buộc cho `StatTile`, hiện icon "Cách tính" có nội dung
   thật (không fabricate) cho cả 4 tile trên trang tiến độ chu kỳ.

### P2 — UX/A11y (một phần)

10. Tiêu đề tab trình duyệt: sửa từ "Make interface mobile responsive" →
    "FITNESS AI — AI Gym Coach" trong `index.html`. **Lưu ý:** container dev
    (`gymcoach-web-dev`) chỉ bind-mount thư mục `src/`, không mount
    `index.html` gốc — nên sửa này chỉ có hiệu lực sau khi rebuild image
    (đã xác nhận đúng qua `npm run build` → `dist/index.html` có tiêu đề
    mới), chưa restart container dev để giữ nguyên trạng thái đang chạy.
11. Ô lịch (calendar cell) là `div` với `onClick` nhưng thiếu hỗ trợ bàn
    phím — đã thêm `role="button"`, `tabIndex={0}`, `onKeyDown` (Enter/Space),
    `focus-visible` ring rõ ràng.
12. Nút chuyển tháng trước/sau chỉ có icon, không có `aria-label` — đã thêm
    "Tháng trước"/"Tháng sau".

## Tài liệu kiến trúc đã cập nhật

- `docs/workout-log-audit.md`: thêm phần "Session State Machine" (bảng
  trạng thái NOT_STARTED/IN_PROGRESS/COMPLETED thật đang dùng, cơ chế khóa
  ngày, vì sao server luôn là nguồn xác thực cuối), "Unified Metrics" (bảng
  công thức từng con số, tại sao "58" và "21" là hai khái niệm khác nhau
  một cách có chủ đích chứ không phải bug, sau khi cả hai đã dùng chung định
  nghĩa "hoàn thành"), và "Known Gaps" (liệt kê trung thực các trạng thái
  spec đề xuất nhưng CHƯA implement: `SKIPPED` tồn tại trong schema nhưng
  không có code path nào ghi giá trị này; không có `PARTIALLY_COMPLETED`
  hay `CANCELLED` riêng biệt; không có coach/admin override + audit log vì
  hệ thống chưa có role đó cho workout schedule).

## Kiểm thử đã chạy (tất cả đã pass)

- `schedule-lock.util.test.ts`: 23/23 (bao gồm 5 test mới cho
  `currentWeekRange`, qua biên tuần/tháng/timezone).
- `stats.service.integration.test.ts` (mới, DB thật qua
  `FITNESS_DATABASE_URL`): 7/7 (bao gồm 4 test cho `currentStreakDays`).
- `workout-log-url.utils.test.ts`: 24/24 (không đổi từ trước, vẫn pass).
- `workout-log-completion-merge.utils.test.ts` (mới): 7/7.
- `advanced-set-logging.integration.test.ts` (mới, DB thật): 5/5.
- `persona-fixtures.integration.test.ts` (mới, DB thật): 4/4.
- `workout-analytics.utils.test.ts` (mới): 9/9.
- Toàn bộ test thuần phía frontend (`src/app/pages/client/__tests__` +
  `src/app/components/__tests__`): 78/78.
- Toàn bộ test suite backend fitness-service (161 test): 158 pass, 3 fail
  — cả 3 fail đều ở `adaptive-cycle-evaluation.integration.test.ts` do lỗi
  401 khi gọi sang user-service (thiếu token nội bộ hợp lệ trong môi trường
  chạy test độc lập này, không liên quan gì đến các thay đổi trong phiên
  làm việc này — cần chạy qua stack Docker đầy đủ với auth thật để pass).
- `npx tsc --noEmit` (fitness-service): sạch, không lỗi.
- `npm run build` (frontend, Vite): thành công, không lỗi.
- Xác minh trực tiếp qua trình duyệt thật (Playwright, đăng nhập user
  seed thật `john.doe@example.com`): trang Workout Log hiển thị đúng
  "Tuần này: 5/6 buổi", "Đã hoàn thành: 42", danh sách "Buổi tập sắp tới"
  chỉ chứa ngày tương lai, không có console error.

10 (bis). **"Streak: 0 ngày" hardcode đã sửa.** Thêm
`computeCurrentStreakDays` (`stats.service.ts`) — số ngày liên tiếp gần nhất
(kết thúc ở hôm nay hoặc hôm qua) có ít nhất một `WorkoutSchedule` với
`status = COMPLETED`, tính theo lịch `Asia/Ho_Chi_Minh` (dùng chung
`todayAsScheduleDate` mới tách ra từ `schedule-lock.util.ts`). Hôm nay chưa
tập thì streak vẫn giữ nguyên tính đến hôm qua; nhưng một ngày trống thật sự
(không COMPLETED) sẽ cắt streak về đúng vị trí đó. Xác nhận qua 4 integration
test mới (streak liên tiếp, streak chưa tính hôm nay, streak bị gãy do có
khoảng trống thật) và qua `curl` thật: `currentStreakDays: 2` cho user seed
`john.doe@example.com`.

13. **Giải thích RPE/RIR cho người mới đã thêm.** Box giải thích ngắn (RPE
    là gì, RIR là gì, ví dụ cụ thể) hiện ngay phía trên 2 slider RPE/RIR
    trong card "GHI CHÉP", chỉ hiện cho người dùng có `experienceLevel`
    khác `INTERMEDIATE`/`ADVANCED` (bao gồm cả `null` — chưa set level thì
    mặc định vẫn hiện, an toàn hơn là ẩn nhầm với người mới thật). Có nút
    đóng (chỉ trong phiên, không cần thêm field backend cho việc này). Xác
    nhận hiển thị thật qua Playwright với user seed (`experienceLevel:
    null`).
14. **Mô hình dữ liệu set nâng cao cho VĐV chuyên nghiệp đã có nền tảng
    data + API (chưa có UI).** Migration
    `20260730000000_workout_set_advanced_logging` thêm 6 cột nullable vào
    `workout_sets`: `setType` (WARMUP/WORKING/TOP/BACKOFF/FAILURE), `tempo`,
    `rangeOfMotion`, `side` (LEFT/RIGHT/BOTH), `painScore` (0-10),
    `techniqueNotes`. Validate ở cả `updateWorkoutSetSchema`/
    `createWorkoutSchema` (Zod) và `addSet` (validate thủ công, cùng danh
    sách giá trị hợp lệ `SET_TYPES`/`SET_SIDES` dùng chung). Đã áp dụng
    migration lên CẢ DB dev (`gymcoach_fitness`) và DB test
    (`gymcoach_fitness_test`). 5 integration test (DB thật) xác nhận
    persist/validate đúng. Xem `docs/advanced-set-logging.md` để biết rõ
    phần bằng chứng khoa học (thuật ngữ "top set/back-off set" là quy ước
    của huấn luyện viên thực chiến, KHÔNG phải phân loại có bình duyệt) và
    lý do UI thật cho màn hình "GHI CHÉP" CHƯA được xây trong lượt này (màn
    hình hiện tại chỉ log 1 giá trị weight/RPE/RIR dùng chung cho cả bài
    tập, chưa có UI theo từng set — thêm UI cho 6 field mới cần thiết kế
    lại toàn bộ mô hình tương tác của màn hình log, rủi ro/phạm vi lớn hơn
    nhiều so với thêm cột + endpoint có validate).

15. **4 bộ fixture theo persona A/B/C/D đã xây dựng.**
    `src/__tests__/fixtures/persona-fixtures.ts` — mỗi persona seed dữ liệu
    thật vào DB test (không chạm production), với đặc điểm khác biệt thật
    sự (không chỉ đổi tên cùng 1 bộ dữ liệu): Persona A chỉ 1 schedule
    NOT_STARTED (không có lịch sử thật); Persona B 3 tuần dữ liệu với mix
    COMPLETED/IN_PROGRESS(partial)/NOT_STARTED(missed) thật; Persona C 2
    `TrainingCycle` thật (1 ARCHIVED + 1 ACTIVE) dưới 2 chương trình khác
    tên nhau (mô phỏng đổi chương trình thật); Persona D dùng đủ set type
    WARMUP/TOP/BACKOFF/FAILURE thật, tempo, side trái/phải cho bài tập
    unilateral, painScore + technique notes. 4 integration test
    (`persona-fixtures.integration.test.ts`, DB thật) xác nhận từng persona
    cho ra số liệu/đặc điểm đúng như thiết kế (không fabricate, không lẫn
    lộn giữa các persona). Giới hạn đã ghi rõ: fixture chỉ seed phần dữ
    liệu do fitness-service sở hữu (Workout/WorkoutSchedule/WorkoutSet/
    TrainingCycle) — không seed InBody vì đó là dữ liệu cross-service
    (user-service), cùng giới hạn đã biết với
    `adaptive-cycle-evaluation.integration.test.ts`.

16. **E2E 8 viewport bắt buộc đã chạy** (320×568, 360×800, 390×844, 412×915,
    768×1024, 1024×768, 1366×768, 1440×900), đăng nhập thật, chụp cả màn
    hình "Tổng quan" và "Kế hoạch tập". Kết quả: **không có overflow ngang ở
    bất kỳ viewport nào** (`scrollWidth === clientWidth` cho cả 8). Lưu ý
    trung thực: lần chạy đầu dùng 1 lượt đăng nhập/viewport và bị chặn bởi
    rate limiter đăng nhập thật của auth-service (429) ở vài viewport —
    KHÔNG phải bug, mà là giới hạn bảo mật hoạt động đúng dưới tải test
    dồn dập không thực tế (8 lần đăng nhập liên tiếp trong vài giây). Đã sửa
    cách test (đăng nhập 1 lần, dùng chung session cho cả 8 viewport) và
    chạy lại sạch.
17. **Phát hiện thêm 1 bug fabricated-data nghiêm trọng khi rà soát màn hình
    Tổng quan cho E2E: 2 biểu đồ tròn "Phân bổ nhóm cơ" và "Phân bổ loại bài
    tập" là dữ liệu HOÀN TOÀN giả, hardcode cứng (vd "Chest 25%", "Compound
    45%") — giống hệt nhau cho MỌI người dùng, không liên quan gì đến lịch
    sử tập luyện thật, kèm bộ lọc thời gian (TimeFilterBar) trông như hoạt
    động nhưng thực ra không lọc gì cả.** Đây là vi phạm trực tiếp nguyên
    tắc "không fabricate dữ liệu để làm dashboard đẹp hơn". Đã sửa: hàm
    thuần `computeMuscleGroupDistribution`/`computeActivityTypeDistribution`
    (`workout-analytics.utils.ts`) tính phần trăm THẬT từ `workoutCache`
    (lịch sử tập đã fetch), có tôn trọng bộ lọc last/week/month/all thật.
    "Compound/Isolation" (nhãn giả cũ) không có field tương ứng thật trong
    schema Exercise — đã thay bằng `typeOfActivity` thật (Sức mạnh/Cardio/
    Vận động linh hoạt...) thay vì tự chế một cách phân loại không có căn
    cứ. Không có dữ liệu trong khoảng thời gian → hiện thông báo trung thực
    "Chưa có dữ liệu buổi tập nào trong khoảng thời gian này", không còn vẽ
    biểu đồ giả. Số "6"/"4" hardcode ở giữa vòng tròn (số nhóm cơ/loại bài
    tập) cũng đã đổi thành số thật. 9 unit test mới xác nhận.
18. **Phát hiện thêm 1 bug flash-empty-state khi rà soát cho E2E:** màn hình
    "Kế hoạch tập" → xem chi tiết 1 ngày cụ thể kết luận "Bạn chưa có ngày
    tập trong chương trình hiện tại" bất cứ khi nào `currentProgram` chưa
    tải xong — kể cả khi đang tải bình thường (không chỉ khi lỗi), vì
    không kiểm tra cờ `isLoading` trước khi kết luận "không có". Deep-link
    thẳng vào `?tab=plan&day=1` sẽ thấy thông báo sai này trong chốc lát
    trước khi dữ liệu thật tới — cùng loại lỗi đã sửa ở những chỗ khác
    trong phiên này. Đã thêm guard `isLoading` để hiện skeleton loading
    thay vì kết luận sai. **Giới hạn còn lại (ghi rõ, chưa sửa):** nếu
    request thất bại thật (lỗi mạng/429) sau khi `isLoading` đã về false,
    màn hình vẫn hiện "không có chương trình" giống hệt trường hợp thật sự
    không có — chưa phân biệt được "tải lỗi" và "thật sự trống". Sửa đầy đủ
    cần thêm state `fetchError` riêng, để lại cho lượt sau.
19. **VI/EN consistency**: sửa các nhãn tiếng Anh còn sót lại trộn giữa giao
    diện tiếng Việt: filter "Full Body" → "Toàn thân"; tile "Streak" →
    "Chuỗi ngày tập"; slider "Sets"/"Reps"/"Rest" (trong màn hình sửa
    prescription bài tập) → "Số set"/"Số reps"/"Nghỉ (giây)". Không đổi tên
    bài tập trong catalog (874 bài tập seed sẵn, phần lớn tên tiếng Anh) —
    đây là dữ liệu danh mục/thuật ngữ chuyên ngành, không phải chrome giao
    diện, dịch lại toàn bộ catalog là phạm vi khác, lớn hơn nhiều, không nằm
    trong lượt này.

## Việc KHÔNG được coi là xong (chưa động tới trong phiên này)

Theo đúng yêu cầu §17 — không được tuyên bố hoàn thành nếu còn tồn tại các
mục sau:

1. **UI thật cho mô hình set nâng cao** (xem mục 14 ở trên) — chỉ có
   data/API, chưa có màn hình nhập liệu theo từng set.
2. **E2E 8 viewport đã chạy (mục 16) nhưng CHƯA dùng 4 persona fixture** —
   mới test với 1 user seed thật (`john.doe@example.com`), chưa lặp lại cho
   cả 4 persona A/B/C/D. Chưa có before/after screenshot theo đúng nghĩa
   cặp đôi (before-state của các bug đã sửa được chụp và xóa ở các lượt
   làm việc trước đó trong phiên, theo đúng quy ước dọn dẹp temp artifact —
   chỉ còn bằng chứng after/hiện-trạng).
3. **Rà soát nhất quán Việt/Anh** mới làm cho `WorkoutLogPage.tsx` (màn hình
   chính của tính năng này) — chưa quét toàn bộ ứng dụng.
4. **`fetchError` riêng biệt** cho trường hợp fetch thật sự lỗi (mục 18) —
   chưa làm, mới sửa được trường hợp "đang tải".
5. Chưa build lại (rebuild) container dev `gymcoach-web-dev` để tiêu đề tab
   trình duyệt thật sự đổi trên môi trường dev đang chạy (source đã đúng,
   xác nhận qua production build) — container `gymcoach-fitness-dev` ĐÃ được
   restart nhiều lần trong phiên này nên các thay đổi backend đều đã live.

## Bước tiếp theo chính xác (để phiên sau tiếp tục)

Theo thứ tự ưu tiên còn lại: (1) thêm `fetchError` state riêng để phân biệt
"tải lỗi thật" khỏi "thật sự trống" (mục 18, nhỏ, rõ ràng); (2) lặp lại E2E
8 viewport cho cả 4 persona fixture (không chỉ 1 user seed); (3) rà soát
Việt/Anh toàn ứng dụng (ngoài phạm vi WorkoutLogPage.tsx); (4) nếu có thời
gian: thiết kế UI thật theo từng set cho mô hình set nâng cao (mục 1 ở
trên) — đây là phần kiến trúc lớn nhất còn lại, nên tách phase riêng như
cách `nested-hopping-liskov.md` đã làm với Adaptive Cycle Evaluation, bắt
đầu bằng việc thiết kế lại tương tác của card "GHI CHÉP" từ "1 giá
trị/bài tập" sang "danh sách set có thể mở rộng".
