# AI plan — Giai đoạn 2 (đợt 1): sửa lịch tập nháp bằng một câu nói

Ngày 2026-10-20 · Claude Code (Codex không tham gia) · model trả lời của stack thử: Nova Pro (`apac.amazon.nova-pro-v1:0`, tài khoản `divuzha`). Không commit, không push.

## 1. Cách tìm ra vấn đề (REAL HTTP/API, trước khi sửa)
`test/ai-chat-full-verification/probe-workout-revisions.mjs` chạy trên gateway/ai-service thật + DB test: tạo bản nháp 4 buổi (Thứ 2, 4, 6, Chủ nhật) rồi gửi các câu chỉnh sửa. Đọc code cho thấy phần sửa nháp là **luật regex xác định** (`tryReviseWorkoutPlanDraft`), không phải LLM, nên lỗi không đến từ Nova Pro.

| Câu | Kết quả TRƯỚC khi sửa |
|---|---|
| "Đổi buổi thứ 6 sang thứ 7" (và 2 cách nói khác, kể cả không dấu) | "đổi lịch tập sang **2 buổi**/tuần: Thứ 6, Thứ 7" — 4 buổi bị phá còn 2 |
| "Thay buổi thứ 7 thành tập chân" | "sang **1 buổi**/tuần: Thứ 7" — 4 buổi còn 1 |
| "Tôi bị đau chân, bỏ bài tập chân" | cả câu bị coi là **tên bài tập**: "lịch hiện tại không có bài nào liên quan đến 'bi dau chan chan' nên chưa cần đổi gì" — trấn an sai cho một câu liên quan sức khỏe |
| "Giảm xuống 3 buổi mỗi tuần" | đúng (3 buổi) |

Nguyên nhân gốc: nhánh "Tôi tập được thứ …" nhận mọi câu có tên thứ trong tuần và coi đó là **tập hợp ngày tập**, nên "đổi A sang B" thành "tập được A và B".

## 2. Thay đổi (mở rộng hợp đồng revision sẵn có, không thêm framework)
- `src/services/revision/workout-draft-intents.ts` (mới, thuần, test được): `parseWorkoutSessionRequest` → `MOVE_SESSION` / `REPLACE_SESSION_FOCUS`; `detectBodyPartConstraint` (đau/chấn thương/bỏ nhóm cơ; loại câu hỏi; xử lý bẫy bỏ dấu "chấn thương" = "chan thuong" ≈ "chân").
- `fitness-agent.service.ts` `tryReviseWorkoutPlanDraft`:
  - MOVE chỉ đổi thứ của đúng một buổi; giữ số buổi, bài tập, `exclusions`; sắp lại theo thứ tự tuần. Từ chối **không đổi gì** và nói rõ lý do khi: ngày nguồn không có trong lịch, ngày đích đã có buổi (chưa hỗ trợ gộp/hoán đổi), cùng một ngày.
  - REPLACE focus: giữ nguyên lịch, nói rõ chưa đổi riêng nội dung một buổi.
  - Câu về đau/bỏ nhóm cơ: trả lời trung thực "chưa tự lọc bài theo nhóm cơ nên chưa thay đổi gì, không khẳng định lịch an toàn", không biến câu thành tên bài tập; bản nháp giữ nguyên và preview vẫn hiện.
- Các nhánh cũ (chọn ngày, bận, đổi số buổi/phút, tên bài) không đổi.

## 3. Bằng chứng sau khi sửa
| Kiểm tra | Nhãn | Kết quả |
|---|---|---|
| `workout-draft-session-requests.test.ts`: 11 test — 11+ cách nói MOVE (có dấu/không dấu/T6/CN/mũi tên), REPLACE, 11 câu **không** phải yêu cầu buổi, nhóm cơ/đau, và 6 test `tryTurn` thật trên DB test (4 buổi giữ nguyên, bài tập/exclusion không đổi, từ chối an toàn, status vẫn PENDING) | BACKEND INTEGRATION + unit | 11/11 pass (một lỗi thật được test bắt: "chấn thương vai" bị gán nhầm "chân"; đã sửa) |
| Probe thật lại với code mới (Nova Pro) | REAL HTTP/API | "Đổi buổi thứ 6 sang thứ 7" ×5 biến thể → **4 buổi: Thứ 2, 4, 7, Chủ nhật**, các buổi/bài khác giữ nguyên; "thay buổi thứ 7…" → không phá lịch; câu đau chân → trả lời trung thực; "giảm 3 buổi" vẫn đúng |
| Regression nhóm agent/workflow/revision/CI (33 file, DB test) | BACKEND INTEGRATION | 270/272; 2 fail **không do thay đổi này**: "thứ 3, 5, 7" pass khi có fitness-service thật (cần catalog qua HTTP); `/8 b[aÃ ]i/i` lỗi mã hóa trong test ở nhánh không đụng (chưa kiểm chứng trên HEAD sạch) |
| Scoped (9 file gồm generation-operations/admission/policy/rate-limit/auth/env-int/phiên bản mới) | BACKEND INTEGRATION | 193/193; `tsc --noEmit` sạch |

Không phải full repository regression.

## 4. Còn thiếu có chủ đích (không giả vờ đã xong)
1. **`REMOVE_BODY_PART` thật + vòng đời ràng buộc sức khỏe.** Bản nháp chỉ có `exerciseId`/`name`, không có nhóm cơ; exclusion hiện khớp theo token tên bài. Probe sau sửa vẫn cho thấy 8 bài chân còn trong bản nháp sau "bỏ bài tập chân", và S7/S8 (đau chân → hỏi câu khác → đổi buổi) chưa thể chứng minh ràng buộc sống sót vì chưa có ràng buộc để giữ. Cần thiết kế riêng: tra nhóm cơ theo `Exercise.id` ở fitness-service (nguồn sự thật của catalog), lưu ràng buộc **tạm thời** trong payload nháp với vòng đời rõ (thêm/bỏ/hết hạn), không biến thành hồ sơ chấn thương vĩnh viễn (đúng yêu cầu của kế hoạch). Đây là thay đổi liên service ⇒ đề xuất làm sau khi bạn chốt thiết kế.
2. **Đổi nội dung riêng một buổi** (`REPLACE_SESSION_FOCUS`) và **hoán đổi hai buổi**: hiện chỉ từ chối trung thực.
3. **Hỏi lại khi mơ hồ** và đa lượt: mới có từ chối + gợi ý; chưa có hội thoại làm rõ.
4. Các câu chỉnh sửa Nutrition/Roadmap/Health (Giai đoạn 3–4) chưa động tới.
5. Probe chạy 1 user, 1 profile; bộ đánh giá độc lập nhiều cách diễn đạt (Giai đoạn 5) chưa có; test hiện tại là **bộ phát triển**, chưa phải heldout.
6. Phát hiện ngoài phạm vi, chỉ ghi nhận: câu "protein giúp gì cho cơ bắp?" bị định tuyến sang bản nháp thực đơn (lỗi định tuyến, Giai đoạn 2/5).

---

# Đợt 2: `REMOVE_BODY_PART` thật + vòng đời ràng buộc sức khỏe (cùng ngày)

Đợt 1 chỉ trả lời trung thực "chưa lọc được theo nhóm cơ". Đợt này làm thật, dựa trên dữ liệu catalog (Exercise là nguồn sự thật), không dựa vào câu chữ hay model.

## Thiết kế
- **fitness-service (additive):** `POST /internal/exercises/muscle-profiles` (token nội bộ, tối đa 200 id) trả `{id, name, bodyPart, muscleGroups}` đúng từ bảng Exercise. Id không có trong catalog thì **vắng mặt** (người gọi coi là "chưa biết", không bao giờ là "an toàn").
- **ai-service:** tool `getExerciseMuscleProfiles`; `revision/workout-draft-intents.ts` có ánh xạ nhóm (chân/gối→LEGS, ngực, lưng, vai, tay, bụng) sang chuỗi cơ trong catalog + enum `bodyPart`; `planBodyPartRemoval` thuần (không sửa input). Khớp cả cơ chính lẫn cơ phụ (thận trọng: bỏ "lưng" cũng bỏ squat/deadlift vì tác động lưng dưới; câu trả lời nói rõ).
- **Vòng đời, lưu trong payload của bản nháp (tạm thời, không ghi vào hồ sơ người dùng, đúng yêu cầu của kế hoạch):** `bodyPartExclusions[{key, part, reason: PAIN|PREFERENCE, since}]` và `pendingBodyPartDecision`.
  - Yêu cầu bỏ rõ ràng + không buổi nào bị trống → áp dụng ngay, giữ số buổi/ngày tập, đánh lại `order`.
  - Chỉ nói đau (không có lệnh bỏ), hoặc việc bỏ sẽ làm **trống cả buổi** → **hỏi trước**, không đổi gì; trả lời ngắn "đồng ý"/"giữ nguyên" mới tính. Câu nhắc an toàn giữ lại khi người dùng từ chối.
  - Dữ liệu nhóm cơ không có → không đổi gì và nói thẳng, không khẳng định an toàn.
  - Không bài nào thuộc nhóm đó → nói đã kiểm tra, vẫn ghi nhận để tránh khi tạo lại.
  - Ràng buộc **sống sót** qua dời buổi, câu hỏi không liên quan, và tạo lại lịch (`regenerate` lọc lại bằng catalog; nếu mất dữ liệu cơ thì trả lịch rỗng chứ không trả bản nháp chưa lọc).
  - "Hết đau chân" gỡ ràng buộc; bài đã bỏ **không** tự quay lại.
- **Ranh giới xác nhận không bị làm yếu:** "đồng ý" vốn là câu bị chặn ("chưa lưu gì cả"). Khi agent đang có câu hỏi mở về bản nháp, câu trả lời có/không được chuyển cho vòng chỉnh sửa; mọi câu có "lưu/xác nhận/chốt/cập nhật" (ví dụ "ok lưu đi") **không bao giờ** được tính là trả lời và vẫn ra "chưa lưu gì cả" (có test).

## Bằng chứng
| Kiểm tra | Nhãn | Kết quả |
|---|---|---|
| fitness-service endpoint: id thật trả đúng bodyPart/muscleGroups từ DB, id lạ vắng mặt, trùng id gộp; 401 không/sai token; 400 đầu vào sai/quá lớn | REAL HTTP/API (Express thật + DB fitness test) | 2/2 pass (chạy không dùng `--test-force-exit` vì lỗi libuv trên Windows) |
| `workout-draft-session-requests.test.ts`: phân tích thuần, kế hoạch loại bỏ (3 test), trả lời có/không, hết đau, và 10 test `tryTurn` thật trên DB test (hỏi→đồng ý→dời buổi→hết đau; giữ nguyên; lịch trộn áp dụng ngay giữ 4 buổi; chỉ đau → hỏi; dữ liệu cơ không có; không bài nào khớp; "ok lưu đi" không lưu/không bỏ) | BACKEND INTEGRATION + unit | 24/24 pass |
| Probe thật qua gateway → ai-service → fitness-service, catalog thật, Nova Pro | REAL HTTP/API | S6: "9 bài tác động lên chân, 1 buổi (Thứ 4) chỉ gồm bài chân" → hỏi, không đổi; S6b sau "đồng ý": 3 buổi, **0 bài chân**; S7/S8 (dời buổi; câu hỏi không liên quan xen giữa): vẫn 0 bài chân; S9 tạo lại 3 buổi từ catalog thật: 0 bài chân; S10 hết đau: gỡ ràng buộc, không đổi bài |
| Regression (40 file: agent/workflow/revision/CI/generation-operations/admission/policy/rate-limit/auth/env-int/workout-draft) | BACKEND INTEGRATION | 462/464; 2 fail cũ không liên quan (xem đợt 1) |
| `pnpm test:integration` (PG + Redis, stack tắt) | BACKEND INTEGRATION | 29/29; `tsc --noEmit` ai-service và fitness-service sạch |

Không phải full repository regression.

## Giới hạn còn lại
- Ánh xạ nhóm cơ dựa trên chuỗi `muscle_groups_activated` hiện có trong catalog (6 nhóm); "cổ", "mông" riêng, "lưng trên/dưới" chưa tách. Gối được xử lý như chân.
- Ràng buộc chỉ sống trong **bản nháp** (15 phút, gia hạn theo mỗi lần chỉnh). Sau khi lưu lịch, ràng buộc không đi theo; việc lưu thành ràng buộc dài hạn/hồ sơ chấn thương cần quyết định sản phẩm riêng (kế hoạch nói rõ không tự biến lời kể tạm thời thành hồ sơ vĩnh viễn).
- Chưa có UI riêng hiển thị "đang tránh: chân"; trạng thái chỉ thấy qua câu trả lời của AI.
- Thay nội dung riêng một buổi (`REPLACE_SESSION_FOCUS`) và hoán đổi hai buổi vẫn chỉ từ chối trung thực.
- Bộ test vẫn là bộ **phát triển**; chưa có bộ đánh giá độc lập nhiều cách diễn đạt (Giai đoạn 5).
