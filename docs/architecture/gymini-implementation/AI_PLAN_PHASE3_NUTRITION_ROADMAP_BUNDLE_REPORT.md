# AI plan — Giai đoạn 3: Nutrition, Roadmap, bundle (thành công một phần)

Ngày 2026-10-20 · Claude Code · model trả lời của stack thử: Nova Pro (`apac.amazon.nova-pro-v1:0`, tài khoản `divuzha`). Không commit, không push. Phạm vi lấy từ audit đã kiểm chứng: **BDG-18** (P1, thời hạn roadmap hardcode 16 tuần trên đường chat) và **BDG-19** (P2, bundle thành công một phần không có cách thử lại từng bước), cộng với yêu cầu Nutrition của kế hoạch.

## 1. Roadmap — hợp đồng thời gian (BDG-18)
**Lỗi (CODE AUDIT, xác nhận trên code hiện tại):** `fitness-agent.service.ts` có hai chỗ `timeframeWeeks: 16` (đề xuất và chỉnh sửa), nên "lộ trình 12 tuần" và "không giới hạn thời gian" đều ra 16 tuần. Ngoài ra `timeframeWeeks` chỉ là **gợi ý trong prompt**, nên tổng tuần thật của bản nháp có thể khác con số yêu cầu và không ai kiểm tra.

**Hợp đồng mới** (`revision/roadmap-timeframe.ts`, thuần, có test):
| Người dùng nói | Hệ thống làm |
|---|---|
| Thời hạn cụ thể (tuần/tháng/ngày/năm/"nửa năm"; "mỗi 2 tuần" không phải thời hạn) | dùng đúng thời hạn (tối đa 104 tuần, nếu vượt thì nói rõ đã giới hạn) |
| "Không giới hạn thời gian", "không vội", "bao lâu cũng được"… | **không gửi** `timeframeWeeks` (không có con số ngầm); AI tự đề xuất, câu trả lời nói rõ |
| Không nói gì | mặc định có tên `DEFAULT_ROADMAP_TIMEFRAME_WEEKS = 16`, **được công bố là mặc định**, không bao giờ trình bày như lựa chọn của người dùng |
| Mâu thuẫn ("không giới hạn nhưng xong trong 12 tuần") | hỏi lại, không sinh bản nháp |
Thời hạn được tìm trong tin nhắn hiện tại rồi các tin trước của cuộc trò chuyện (mới nhất thắng) vì lượt xác nhận ("ok tạo đi") không tự mang thời hạn. Hợp đồng được lưu trên bản nháp (`payload.timeframe`): **chỉnh sửa giữ nguyên hợp đồng đã lưu** (không hardcode lại), "đổi sang 8 tuần"/"không giới hạn" thì đổi; bản nháp cũ không có hợp đồng thì dùng mặc định và nói rõ.
**Nhất quán thực tế:** sau khi sinh, tổng tuần thật của các giai đoạn được đo; nếu người dùng yêu cầu cụ thể mà lệch quá max(1 tuần, 10%) thì thử lại **một lần** có nêu yêu cầu, giữ bản gần hơn; phần lệch còn lại được **công bố** ("bạn yêu cầu 12 tuần nhưng AI chỉ xếp được 24 tuần").

Bằng chứng:
| Kiểm tra | Nhãn | Kết quả |
|---|---|---|
| `roadmap-timeframe.test.ts` (parser, đơn vị, giới hạn, mâu thuẫn, look-alike, công bố) | unit | 8/8 |
| `roadmap-timeframe-chat.test.ts` (proposePlanBundle/tryReviseRoadmapDraft thật trên DB test; chỉ stub bộ sinh) | BACKEND INTEGRATION | 8/8 |
| Probe thật gateway → ai-service → fitness-service, bản nháp do Nova Pro sinh | REAL HTTP/API | R1 "12 tuần" → **12** tuần, "theo yêu cầu"; R2 "6 tháng" → **26**; R3 "không giới hạn" → AI đề xuất **36** tuần, nói rõ không ép khung; R4 không nói → **16, công bố là mặc định**; R5 đổi sang 8 tuần → **8**; R6 chỉnh nhẹ nhàng hơn → **vẫn 12** (không rơi về 16); R7 mâu thuẫn → hỏi lại |

## 2. Bundle thành công một phần (BDG-19)
**Hiện trạng đã đúng một nửa:** báo cáo từng bước ✅/❌ trung thực. **Thiếu:** thành công một phần bị ghi `COMPLETED` (không thử lại được phần thiếu), và xác nhận lại từ đầu sẽ chấp nhận thêm một lộ trình thứ hai (`acceptRoadmapDraft` không idempotent).
**Sửa:** tiến trình từng bước được lưu trên hành động (`bundleProgress`: id lộ trình, đã kích hoạt, đã áp chương trình tập, đã tạo dinh dưỡng). Xác nhận lại chỉ chạy các bước **chưa xong**: lộ trình đã chấp nhận thì chỉ kích hoạt, không chấp nhận lần hai; chương trình tập/dinh dưỡng đã tạo không lặp lại. Lỗi **tạm thời** (hoặc dinh dưỡng thiếu dữ liệu hồ sơ) trả hành động về `PENDING` với thời hạn mới và nói "bấm Xác nhận lại để thử lại CHỈ các phần chưa tạo"; lỗi **vĩnh viễn** (không có chương trình tập phù hợp) không giữ hành động mở mãi và không hứa thử lại. Cơ chế claim `EXECUTING` nguyên tử được giữ.
| Kiểm tra | Nhãn | Kết quả |
|---|---|---|
| `plan-bundle-partial-recovery.test.ts` 8 test: tất cả thành công; dinh dưỡng lỗi → thử lại chỉ dinh dưỡng (accept 1, activate 1, apply 1, boot 2); kích hoạt lỗi → thử lại chỉ kích hoạt; chương trình tập lỗi tạm thời; thiếu dữ liệu dinh dưỡng; lỗi vĩnh viễn; vĩnh viễn + tạm thời; 3 xác nhận đồng thời không tạo trùng | BACKEND INTEGRATION (DB test thật, business calls stub và đếm) | 8/8 |

## 3. Nutrition
Kiểm tra bằng probe thật (không phát hiện lỗi nên **không sửa code**): bản nháp 4 bữa "không ăn cá", "không ăn thịt bò" → "Ít bữa hơn" → "Tôi dị ứng đậu phộng".
| Chỉ tiêu | Kết quả (REAL HTTP/API, Nova Pro) |
|---|---|
| Mục tiêu chính thức qua 3 lần sinh | **không đổi**: 2370 kcal · P145 · C299 · F66 |
| Loại trừ | tích lũy đúng: `cá`, `thịt bò`, rồi `đậu phộng/lạc`; 0 món cá/bò/đậu phộng trong 7 ngày |
| Số bữa | 4 → 3 |
Mục tiêu calo của luồng này lấy từ `NutritionGoal`/công thức hồ sơ (không để AI tự nghĩ), nên "mục tiêu từ dữ liệu hồ sơ hợp lệ" đã được đảm bảo bởi kiến trúc hiện có; khi hồ sơ thiếu dữ liệu agent từ chối tạo và nói thiếu gì.

## 4. Tổng số liệu (không phải full regression)
ai-service nhóm agent/workflow/revision/CI/roadmap/bundle/generation/dedupe/transport (50 file): **541/543** (2 lỗi cũ không liên quan, đã mô tả ở báo cáo Giai đoạn 2); `test:integration` PG+Redis **29/29**; `tsc` sạch.

## 5. Giới hạn còn lại
- Thời hạn chỉ đọc dạng số + vài cụm ("nửa năm", "một năm"); mốc ngày cụ thể ("trước Tết", "đến 31/12") **chưa** hỗ trợ (sẽ bị coi là không nêu thời hạn và dùng mặc định có công bố).
- Mặc định 16 tuần là chính sách cũ được giữ lại có tên và có công bố; có nên hỏi lại thay vì mặc định là **quyết định sản phẩm**.
- Khi AI không xếp được đúng số tuần, hệ thống công bố chứ không tự nén/giãn giai đoạn (tránh bịa dữ liệu).
- Bước xác nhận lại của bundle phụ thuộc thẻ xác nhận còn hiển thị ở UI; chưa kiểm chứng REAL BROWSER cho nhánh thử lại này.
- Chưa có bộ đánh giá độc lập cho Roadmap/Nutrition (Giai đoạn 5); các test là bộ phát triển.
