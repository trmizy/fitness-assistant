# Báo cáo dừng — Config A vi phạm điều kiện "không gọi Qwen"

Run `20261003T054521Z`. Trạng thái: **DỪNG CÓ CHỦ Ý**. Config B chưa chạy. Chưa có kết quả benchmark nào hợp lệ.

## 1. Điều đã xảy ra
Quy tắc đã định: Config A phải tắt LLM, kiểm tra Qwen không được gọi, và dừng nếu bị gọi.

Ba lời gọi `POST /api/chat` tới Ollama đã được ghi nhận trong access log (`gymcoach-ollama`). Cả ba trả HTTP 500 sau đúng 170 000 ms (`LLM_TIMEOUT_MS` phía server):

| Kết thúc (UTC) | Nguồn (xác định theo thời điểm) | Turn | Route | HTTP của turn |
|---|---|---|---|---|
| 06:23:20 | **Warmup** W3 "Hủy kế hoạch này nhé." | synthetic | WRITE_ACTION | 172,7 s |
| 06:27:03 | W018 attempt 1 (suy ra theo thời điểm, xem README) | W018/T1 | UNKNOWN | — (request bị bỏ khi runner bị dừng) |
| 06:27:13 | W018 attempt 2 | W018/T1 "Tôi muốn tập luyện theo lịch." | UNKNOWN | 171,6 s |

Câu trả lời người dùng nhận được ở W018 là thông báo suy giảm: "Tạm thời AI chưa sẵn sàng để phân tích chi tiết…".

**Không có** sự kiện semantic fallback có kiểu của CI nào trong ba lời gọi này (`llmCalled = false`, không có `ci_global_llm_route`, không có `ci_v2_llm_interpretation`). Chúng đến từ nhánh sinh văn bản LLM của orchestrator (không thuộc CI) cho các turn UNKNOWN và WRITE_ACTION.

## 2. Vì sao lần phát hiện này bị trì hoãn
Hai lỗi trong evaluator v3 (đã sửa thành v4):
1. `parseOllamaGin` chỉ khớp thời lượng một đơn vị. Dòng GIN dạng `2m50s` (mọi lời gọi chạm timeout 170 s) bị bỏ qua âm thầm, nên `qwenChatCalls = 0` cho các turn đó.
2. Guard contamination chỉ kiểm tra sự kiện CI, nên không thấy lời gọi Qwen không thuộc CI.

Warmup đã vi phạm ngay từ đầu, nhưng v3 không dừng. Với v4, cùng bằng chứng sẽ dừng ở warmup. Regression test đã thêm (18/18 pass).

## 3. Ý nghĩa đối với thiết kế thí nghiệm
- Trên stack này, "Config A với LLM tắt" **không phải** cấu hình không dùng LLM. Flag `CONVERSATIONAL_INTELLIGENCE_V2_LLM=off` chỉ tắt semantic fallback của CI. Orchestrator vẫn gọi Qwen cho UNKNOWN / WRITE_ACTION / KNOWLEDGE_QA.
- Mỗi lần Qwen rơi vào timeout tốn ~170 s. Với gold có ~48 turn UNKNOWN + KNOWLEDGE_QA, Config A có thể mất hàng giờ nếu các lời gọi này đều timeout.
- Config A hiện tại cũng bị ảnh hưởng bởi timeout LLM. Nó không phải một baseline sạch, vì một phần câu trả lời là thông báo suy giảm chứ không phải kết quả deterministic.

## 4. Các lựa chọn (cần người dùng quyết định)
**Lựa chọn 1 — Sửa định nghĩa Config A (khuyến nghị).** Config A = "semantic fallback của CI tắt; nhánh LLM của orchestrator vẫn bật". Đây là phép so sánh đúng với câu hỏi nghiên cứu (hiệu ứng của semantic fallback). Phải ghi thành một bản sửa protocol có run ID mới, nêu rõ 3 lời gọi đã quan sát, và báo cáo số lời gọi Qwen không thuộc CI theo từng config như một biến đo được.
- Ưu: thay đổi production ít nhất; giữ nguyên dataset, evaluator v4 và cách đo.
- Nhược: không còn đúng nguyên văn quy tắc "không gọi Qwen", và cần chấp nhận chi phí thời gian.

**Lựa chọn 2 — Cấu hình A thật sự không dùng LLM.** Ví dụ trỏ `LLM_BASE_URL` tới một endpoint từ chối ngay, hoặc thay đổi nhánh sinh câu trả lời của orchestrator khi flag tắt.
- Ưu: đúng nguyên văn quy tắc.
- Nhược: vẫn là một lời gọi bị từ chối, nên không phải "không gọi"; hoặc đổi hành vi production của orchestrator, tức là một thay đổi code cần duyệt riêng. Không tự ý làm.

**Lựa chọn 3 — Dừng nghiên cứu tại đây** và báo cáo việc vi phạm protocol, không có kết quả so sánh.

## 5. Trạng thái hiện tại
- Không có tiến trình runner nào đang chạy. `run-status.json`: `STOPPED_CONFIG_A_QWEN_INVOCATION`.
- Container `gymcoach-ai-dev` đang ở trạng thái Config A (`CONVERSATIONAL_INTELLIGENCE_V2_LLM=off`). Config B cần recreate với `--recreate`.
- Dữ liệu Config A đã hủy được lưu nguyên trong `ABORTED-config-A-evaluator-v3/` (không cite làm bằng chứng).
- Evaluator đang hiện hành: v4, hash `45712c437f1c99b26197f7cdc465ed60662947cf9076a733a8386254752ddcbe`. Lịch sử đầy đủ trong `evaluator-changelog.md`.

## 6. Đã xác minh được (không phụ thuộc quyết định trên)
- Dataset đóng băng, SHA-256 `eedb1adb…cc849`, khớp.
- Gate 1 (source snapshot), git HEAD `81d9f432…`, production aggregate `bd926900…` khớp khi preflight tái kiểm tra.
- Resume từ checkpoint: một attempt bị ngắt (W018 attempt 1) được ghi `DISCARDED_INTERRUPTED`, attempt 2 chạy trên user mới, 17 case đã hoàn tất không bị chạy lại.
- Cách ly X→X+1: baseline của user mới là 0 hàng trong smoke.
- Quan sát route qua `traceId` khớp đúng với log thật.

## 7. Chưa làm
Config A hợp lệ, Config B, phân tích ghép cặp A/B, báo cáo Markdown/DOCX, biểu đồ Mermaid, kiểm chứng tài liệu tham khảo từ nguồn gốc, ma trận coverage FR/EX/AC đã chạy (module `lib/coverage.mjs` đã viết nhưng chưa chạy). Chưa có kết luận nào về hiệu ứng của Qwen.
