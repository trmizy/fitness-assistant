# Giai đoạn 6 — Bước 1–3: truy cập model, quyền Lambda, quota (chỉ đọc)

Ngày 2026-10-20 · Claude Code. Chỉ dùng lệnh **đọc** trên AWS (`gymini-admin` cho tài khoản 191798898985, `divuzha` cho 730323515543). Không tạo/sửa tài nguyên. External ID không được ghi trong tài liệu này.

## 1. Kết luận chính
Tiền đề của kế hoạch ("`BEDROCK_BLOCKED_ACROSS_TESTED_REGIONS`") **không còn đúng cho kiến trúc hiện tại**: Nova Pro không chạy trực tiếp trong tài khoản 191798898985 mà qua **role chéo tài khoản** trong tài khoản divuzha (730323515543). Cấu hình cho đường đó đúng ở cả hai phía; **việc gọi thật từ Lambda chưa được chứng minh** (xem §4).

## 2. Đã xác minh (REAL AWS READ-ONLY)
| Mục | Kết quả |
|---|---|
| Lambda `ai` và `ai-worker` | `LLM_PROVIDER=bedrock`, `BEDROCK_CHAT_MODEL=apac.amazon.nova-pro-v1:0`, `BEDROCK_REGION=ap-southeast-1`, có `BEDROCK_CROSS_ACCOUNT_ROLE_ARN` + external ID, embedding `cohere.embed-multilingual-v3` |
| Role của `ai` và `ai-worker` (tài khoản chính) | có `sts:AssumeRole` đúng một role đích `GyminiAiServiceBedrockCrossAccount`; cũng có quyền `bedrock:InvokeModel` cục bộ cho Nova Pro/Cohere (dự phòng, không phải đường chính) |
| Trust policy của role đích (divuzha) | tin cậy **đúng hai** role trên (`…ai-worker-role`, `…ai-lambda-role`) với điều kiện external ID **khớp** giá trị trong env của Lambda |
| Quyền của role đích | `InvokeModel`/`Converse` chỉ cho inference profile `apac.amazon.nova-pro-v1:0` và foundation model Nova Pro; `InvokeModel` cho Cohere embed. Tối thiểu, không rộng hơn cần thiết |
| Quota Nova Pro (divuzha) | **50 request/phút** và 2.000.000 token/phút (cross-region); 230.400.000 token/ngày |
| Ngân sách | `My-200$-budget` = 200 USD; chi tiêu thực tế tính được: 0,0 (có thể chưa cập nhật) |
| Inference thật bằng profile `divuzha` | Nova Pro trả lời đúng; bộ DEV 15/15 chạy qua đường này trong các lượt trước |

## 3. Không kiểm được (đã thử, bị từ chối đúng)
`gymini-admin` **không** được `sts:AssumeRole` vào role đích (chỉ hai Lambda role được) — đúng như thiết kế, nên tôi không thể mô phỏng đường gọi của Lambda từ máy này và không tìm cách vòng qua.

## 4. Còn thiếu / rủi ro
1. **Chưa có bằng chứng gọi thật từ Lambda** (assume role → Nova Pro) trong tài khoản AWS. Cần một lần gọi thử sau khi deploy, hoặc kiểm CloudWatch Logs của `ai`/`ai-worker` (chưa đọc log).
2. **50 request/phút cho toàn tài khoản** là trần thấp nếu nhiều người dùng chat cùng lúc (mỗi lượt chat có thể gọi model 1–vài lần; worker tạo kế hoạch gọi thêm). Cần đo tải ở Giai đoạn 7 và xin tăng quota trước khi mở rộng.
3. Thời gian: trong bộ DEV (20 lượt, Nova Pro qua `divuzha` từ máy cục bộ) p50 ≈ 0,3 s (lượt xác định, không gọi model), p90 ≈ 7,5 s, tối đa ≈ 8,4 s. Lambda `ai` có timeout 30 s và `LLM_TIMEOUT_MS=25000`: còn dư nhưng chưa đo từ trong AWS.
4. Chỉ **một** model được cấp quyền (Nova Pro). So sánh nhiều model (bước 4–5 của kế hoạch) cần cấp thêm quyền và bộ đánh giá độc lập; **chưa làm**.
5. Fine-tune (bước 6): chưa có cơ sở — các lỗi tôi tìm thấy ở Giai đoạn 2–5 đều là lỗi định tuyến/trạng thái/trích xuất, không phải năng lực model.
