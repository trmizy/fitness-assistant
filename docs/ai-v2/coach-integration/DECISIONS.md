# DECISIONS — Nhật ký quyết định kiến trúc

Quy tắc: chỉ ghi **APPROVED** khi chủ dự án đã nói rõ (ghi nguồn: tin nhắn/brief và ngày). Đề xuất của AI luôn là **PROPOSED** cho tới khi chủ dự án duyệt. AI không tự chuyển trạng thái. Người đọc phải kiểm lại nguồn khi một quyết định quan trọng; nguồn "memory" nghĩa là ghi nhớ của dự án về phát biểu của chủ dự án, không phải văn bản trong repo.

## APPROVED (do chủ dự án quyết)
| ID | Ngày | Vấn đề | Quyết định | Nguồn | Tác động |
|---|---|---|---|---|---|
| D-001 | 2026-11-13 | Khi nào được deploy | Không deploy/dry-run/push-để-deploy/AWS cho tới khi toàn bộ Multi-Agent hoàn tất và được duyệt; V1 fix giữ cho một lần phát hành đồng bộ | memory `deploy-only-when-multi-agent-complete` | Mọi milestone M9 dừng trước deploy |
| D-002 | 2026-11-16 | Tích hợp M7R `4b155c3e` | **Bị từ chối** | brief M9 | Không dùng `agent/m7r-integration` làm nền |
| D-003 | 2026-11-16 | Vai trò của V2 | V2 nâng cấp AI Coach hiện có, không phải chatbot độc lập; V1 tiếp tục hoạt động; V2 tích hợp có kiểm soát, không tự thay V1; ≤ 2 agent/lượt; thông báo ý định bị hoãn; không giả định SSE; không bỏ qua Safety/Minor Gate/Supervisor/Answer Guard; giữ P1 là release blocker | brief M9 (nguyên tắc 1–12) | Các invariants trong `ARCHITECTURE.md` §5 |
| D-004 | 2026-11-16 | Chính sách an toàn vị thành niên | Tuổi giả định không mặc nhiên là tự khai; gỡ hạn chế chỉ bằng xác minh tuổi đáng tin cậy hoặc quy trình quản trị có kiểm toán; store bắt buộc không khả dụng thì fail-closed | brief M8-C | Ràng buộc M9.4-T2. **Ghi chú:** code hiện chưa thực thi phần "giả định không là tự khai" (CURRENT-STATE §Known) |
| D-005 | 2026-11-16 | Hợp đồng evaluator F1–F8 | G7 theo membership; NOT_EVALUABLE chỉ ảnh hưởng cổng liên quan; SG1/SG3 cần bằng chứng đã thực thi; REVIEW chưa ký chỉ cho phép đánh giá offline chẩn đoán; G7/G8 đo selected, executed/deferred báo riêng | brief M8-C | Đã cài ở commit `e4e8253e` (chưa tích hợp vào nhánh phát triển) |
| D-006 | 2026-11-11 | Mô hình được phép | Chỉ Bedrock Nova Pro cho tới khi duyệt khác; không Opus/Sonnet vision/Gemini cho đánh giá; embedding Cohere cần hỏi | memory `bedrock-nova-pro-only` | Chặn gọi live; lưu ý V1 vision dùng Gemini (`gemini-vision.client.ts`) — chưa có quyết định về điều này |
| D-007 | 2026-11-15 | Pilot gán nhãn | Chủ dự án điều phối, không kiêm curator; 20 câu; họp rút kinh nghiệm bắt buộc; cấm đưa câu pilot/CAL vào bộ 300; thù lao theo công việc (VND chủ dự án xác nhận) | brief pilot | Không liên quan trực tiếp M9, giữ để khỏi mâu thuẫn |

## PROPOSED (đề xuất của AI — **chưa được duyệt**)
| ID | Vấn đề | Các phương án | Khuyến nghị của AI | Tác động nếu chọn | Cần ai |
|---|---|---|---|---|---|
| D-P01 | Adapter AI Coach ↔ V2 | A: chuyển ở frontend · **B**: cầu nối phía server trong ai-service · C: định tuyến ở gateway (ARCHITECTURE §3) | **B** (giữ lịch sử V1, xác thực, idempotency ở một nơi) | Cần file V1 mới chạm `agent-v2` | Chủ dự án |
| D-P02 | Ngoại lệ pin cho cầu nối | cập nhật isolation allowlist/RI-2/HR-27 · hoặc đặt cầu nối trong `routes/ai-v2.routes.ts` để khỏi sửa pin | Đặt trong file đã được phép nếu đủ nhỏ; nếu không, ngoại lệ có ghi chú owner | Đổi bộ test pin | Chủ dự án |
| D-P03 | Chính sách chọn V1/V2 | cờ toàn cục · danh sách người dùng/tài khoản nội bộ · cờ theo yêu cầu | Danh sách tài khoản nội bộ, mặc định V1, V2 lỗi → V1 | UI/BE cần tập người dùng | Chủ dự án |
| D-P04 | Lịch sử chat của lượt V2 | ghi vào `ChatSession`/`Conversation` qua cầu nối · tách bảng V2 · không ghi | Ghi vào bảng V1 qua cầu nối | Hợp nhất lịch sử | Chủ dự án |
| D-P05 | Đóng P1 ký tự vô hình giữa từ | chuẩn hoá Unicode có kiểm soát (đã thử, loại: tách mọi ký tự → mất phủ định) · thay đổi quy tắc ranh giới · gỡ thay đổi | cần thiết kế riêng với vi sai; không vá từng ví dụ | Thay đổi phân loại an toàn | Chủ dự án + Codex |
| D-P06 | Store hạn chế vị thành niên bền vững | Redis có CAS · DynamoDB · bảng Postgres | chọn theo hạ tầng đang có cho session (Redis/DynamoDB đã có adapter session) | Hạ tầng mới/IAM | Chủ dự án |
| D-P07 | SSE cho V2 | giữ JSON, FE tắt stream · phát một `token` rồi `done` · thêm SSE thật vào V2 | **không** thêm SSE thật ở M9.2; phát `status`→`token`→`done` từ kết quả JSON | UX khác V1 | Chủ dự án |
| D-P08 | Idempotency của retry | thêm `clientRequestId` vào V2 · xử lý ở cầu nối | ở cầu nối | Dùng lại `services/request-identity.ts` của V1 | Chủ dự án |
| D-P09 | Vị trí và commit của tài liệu M9 | để untracked trong worktree `ai-v2-coach-integration-plan` (hiện tại; hook chặn commit `docs/`/`.md`) · commit một lần bằng `ALLOW_TEST_ARTIFACTS=1` · chuyển nội dung sang nơi được phép | giữ nguyên cho tới khi chủ dự án chọn; **không** vượt hook | Tài liệu chỉ có ở worktree này; mất nếu worktree bị dọn | Chủ dự án |
| D-P10 | Nhà cung cấp mô hình cho V2 | chỉ Bedrock (hiện tại) · thêm ollama như V1 | giữ Bedrock; dev dùng mock | Trải nghiệm dev | Chủ dự án |

## REJECTED
| ID | Mục | Lý do / nguồn |
|---|---|---|
| D-002 | M7R `4b155c3e` | chủ dự án từ chối (brief M9) |
| D-R01 | Chatbot V2 độc lập là mục tiêu production | chủ dự án (D-003) |
| D-R02 | Thay hoàn toàn / chuyển tự động V1 sang V2 | chủ dự án (D-003) |

## Ghi chú
- Mọi đề xuất bị từ chối hoặc được duyệt phải được cập nhật ở đây cùng ngày, kèm nguồn.
- `D-004` và `D-005` được ghi theo brief M8-C; nếu chủ dự án muốn điều chỉnh, ghi quyết định mới thay vì sửa dòng cũ.
