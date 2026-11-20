# Giai đoạn 5 — Bộ khung đánh giá hệ thống AI (bước 1: khung + bộ DEV)

Ngày 2026-10-20 · Claude Code. **Chưa phải đánh giá độc lập.**

## 1. Đã làm
- `data/eval/ai-system-eval/` — `README.md` (quy trình, tách DEV/INDEPENDENT), `schema.json` (8 nhóm: intent, context, workout, nutrition, roadmap, health, pt_copilot, operations; 4 trục: routing, business, safety, sideEffect).
- `test/ai-eval/score.mjs` (chấm điểm thuần, tách **lỗi định tuyến** và **lỗi suy luận** theo §6.2) + `score.test.mjs` (4/4).
- `test/ai-eval/run-eval.mjs` — chạy qua gateway thật; trục sideEffect đọc DB test cô lập. **Heldout bị niêm phong**: cần `EVAL_OPEN_HELDOUT="<lý do>"`, mỗi lần mở ghi vào `heldout/ACCESS_LOG.jsonl` cùng sha256.
- `dev/dev-v1.json` — 15 mục DEV, tác giả `engineer`. **Không dùng làm bằng chứng tổng quát hóa.**

## 2. Kết quả (REAL HTTP/API, Nova Pro, DB test cô lập)
Lần đầu **12/15**. Ba mục fail được phân tích, không sửa mù:
| Mục | Nguyên nhân | Xử lý |
|---|---|---|
| D-WO-01/02 | **Lỗi sản phẩm thật**: "Tạo lịch tập 3 buổi mỗi tuần, mỗi buổi 45 phút" vẫn bị hỏi lại số buổi (workflow tạo lịch tập không có `extractFromMessage`) | thêm trích xuất chặt (phải có từ đơn vị cạnh số; số ngoài ngữ cảnh như tuổi, cân nặng, "8 bài cho thứ 7" không bị nhận), test `workout-opening-slot-extraction.test.ts` 2/2 |
| D-WO-01 (lần 2) | kỳ vọng sai của tôi (loại khối là `CREATE_WORKOUT_PLAN`, không phải `ACTION_CONFIRMATION`) | sửa kỳ vọng |
| D-PT-01 | kỳ vọng sai: nhãn client không có tên là email theo thiết kế, hiển thị cho chính PT | bỏ ràng buộc |
Sau sửa: **15/15** (DEV). Nhóm workflow/workout/agent của ai-service (200 test): 185 pass, 2 fail, phần còn lại bị bỏ qua (skip). Hai lỗi là lỗi cũ không liên quan (`thứ 3, 5, 7`, `8 bai tap cho thu 7`), đã kiểm trên HEAD sạch (worktree 003545c6): cùng 2 lỗi, nên có từ trước, không do thay đổi của tôi.

## 3. Còn thiếu (cần người thật)
Câu hỏi do người thật viết, hai người gán nhãn độc lập theo `ANNOTATION_GUIDELINES_V1`, niêm phong vào `heldout/`. Chưa có. Tôi không tự viết vì sẽ không độc lập.
