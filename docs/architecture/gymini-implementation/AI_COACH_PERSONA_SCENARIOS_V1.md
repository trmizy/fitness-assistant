# Kịch bản kiểm thử AI Coach theo 3 kiểu người dùng (v1 + khung v2)

Ngày 2026-10-20 · Claude Code. v1 do kỹ sư soạn (DEV) — **không phải bộ đánh giá độc lập**. v2 là khung để **bạn tự nhập câu hỏi và chấm**.

## 1. Cách dùng khung v2
1. Bật stack: `node test/ai-chat-full-verification/stack.mjs up` (kèm biến Nova Pro như các lần trước).
2. Chạy: `GATEWAY_URL=http://localhost:13000 JOURNEY_STAMP=v3 node test/ai-eval/playground/server.mjs`
3. Mở **http://127.0.0.1:17000**.
4. Chọn vai: *Người mới / Người đã biết tập / Người tập lâu năm* (hồ sơ của vai hiện ở cột trái).
5. Hai chế độ:
   - **Kịch bản v1**: bấm "Gửi câu này" để chạy từng câu trong kịch bản; khung vàng cho biết "một câu trả lời hợp lý nên làm gì".
   - **Tự nhập (v2)**: gõ câu hỏi ở ô dưới cùng.
6. Dưới mỗi câu trả lời: chọn **👍 Hợp lý / 😐 Đúng một phần / 👎 Chưa hợp lý**, ghi lý do và (nếu muốn) "AI nên trả lời thế nào", bấm **Lưu đánh giá**.
7. Nếu AI trả về thẻ có nút **Xác nhận**, bạn bấm được ngay trong trang (chỉ ghi vào DB test).
8. Đánh giá được lưu ở `data/eval/ai-system-eval/reviews/reviews-<ngày>.jsonl`. Bạn nhắn cho tôi "đã chấm xong" — tôi đọc file này và sửa theo từng đánh giá.

## 2. Kịch bản v1
**Người mới** (nữ 27 tuổi, giảm mỡ, chưa tập): hỏi bắt đầu từ đâu → hỏi tập ở nhà → lập lộ trình → có nên thuê PT → buổi tập đầu tiên → kỹ thuật squat + đau gối → ăn gì để giảm cân.
Kỳ vọng: gợi ý đủ chuỗi **lộ trình → lịch tập → thực đơn → (tùy chọn) PT**, bản nháp trước và chỉ lưu khi xác nhận; không dồn thuật ngữ; đau thì không chẩn đoán.
**Người đã biết tập** (nam 29, 1,5 năm, tăng cơ): chững cơ ngực → đổi sang upper/lower 4 buổi → progressive overload → cắt mỡ 8 tuần → creatine.
Kỳ vọng: không giảng kiến thức cơ bản; làm đúng số buổi/thời lượng đã nêu; trả lời what-if mà không đè mục tiêu đã lưu.
**Người tập lâu năm** (nam 36, 8 năm, thi powerlifting): chia chu kỳ 12 tuần → deload → đau khuỷu tay kéo xà → thực đơn 3200 kcal/180 g đạm → PT chuyên powerlifting.
Kỳ vọng: trả lời ở mức nâng cao; tôn trọng con số người dùng nêu; không chẩn đoán; nói thẳng nếu không có PT chuyên mục đó.

## 3. Lỗi thật tìm thấy khi chạy v1 (REAL HTTP/API) và đã sửa
| # | Vai | Hiện tượng | Nguyên nhân | Sửa |
|---|---|---|---|---|
| 1 | Mới | "Tôi mới đăng ký… nên bắt đầu từ đâu?" → "Mình chưa thấy lịch tập cụ thể được lưu cho hôm nay" | định tuyến nhầm sang bộ đọc lịch hôm nay | thêm câu trả lời khởi đầu theo hồ sơ (`beginner-start.ts`): 4 bước thật của app, chỉ lưu khi xác nhận |
| 2 | Mới | Sau khi mở lộ trình/hỏi PT, **mọi câu hỏi khác** (kỹ thuật squat, thực đơn…) bị kẹt: "Mình vẫn cần thông tin này…" hoặc bị coi là chỉnh lộ trình | workflow đang chờ và bản nháp lộ trình nuốt mọi tin nhắn | câu hỏi thật về chủ đề khác được trả lời bình thường, workflow vẫn chờ; lộ trình chỉ bị chỉnh khi câu có ý muốn chỉnh |
| 3 | Mới | "Ab Wheel Rollout Rollout", "30-45s reps", "45-60 seconds reps" | định dạng | bỏ từ lặp; đơn vị đúng |
| 4 | Đã biết tập | "Đổi giúp tôi sang lịch upper/lower 4 buổi…" → trả một buổi full-body | không nhận ra là yêu cầu tạo lịch | nhận ra → tạo bản nháp 4 buổi |
| 5 | Đã biết tập | "Progressive overload … thế nào cho bài bench press?" → "chưa thấy lịch tập hôm nay" | chữ "thế" trong "thế nào" bị coi là câu nối tiếp về lịch | chỉ coi là nối tiếp khi tin nhắn ngắn |
| 6 | Đã biết tập | "Cắt mỡ 8 tuần… bao nhiêu calo?" → đáp theo mục tiêu tăng cơ (2792 kcal) | "cắt mỡ" không được nhận là mục tiêu giảm mỡ; mục tiêu đã lưu đè lên | nhận "cắt mỡ"; trả lời what-if (2275 kcal) và ghi rõ không đổi mục tiêu đã lưu |
| 7 | Lâu năm | "Nên chia chu kỳ thế nào?" → "Đánh giá chu kỳ tập: chưa đủ dữ liệu" | hiểu nhầm câu hỏi lập kế hoạch thành yêu cầu đánh giá chu kỳ của chính họ | tách hai loại câu hỏi |
| 8 | Lâu năm | "Thực đơn 3200 kcal, protein 180g" → 3157 kcal / 141 g | bỏ qua con số người dùng nêu | dùng con số trong ngưỡng an toàn, ghi chú "ước tính, không đổi mục tiêu đã lưu" |
Test mới: `beginner-start`, `roadmap-draft-question-not-revision`, `nutrition-stated-targets` (7), `fitness-agent-intent-persona-journeys` (3), `workout-schedule-followup-length` (2), `workout-opening-slot-extraction` (2).

## 4. Điểm để bạn đánh giá (chưa sửa, mang tính thiết kế)
- Khi hỏi "Có nên thuê PT không?" / "Cần PT chuyên powerlifting", AI **hỏi ngay ngày tập và ngân sách** trước khi nói gì — người mới có thể muốn được giải thích trước. Bạn muốn AI trả lời ngắn trước rồi mới hỏi?
- Câu trả lời kiến thức chung (squat, deload, creatine…) do model viết nên đôi khi có lỗi chữ ("Ren Luyện Tim Mạch"); chưa có cách sửa xác định.
- "Tập ở nhà không có dụng cụ" trả buổi core có **Ab Wheel** (cần dụng cụ) — chưa sửa; cần rà quy tắc thiết bị cho nhánh "buổi tập theo yêu cầu".
