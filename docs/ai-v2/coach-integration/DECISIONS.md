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
| D-008 | 2026-11-16 | Adapter AI Coach ↔ V2 | **Phương án B: cầu nối phía server trong ai-service.** V1 vẫn là mặc định; V2 nâng cấp AI Coach, không phải chatbot production độc lập; capability V1-only tiếp tục dùng V1; chỉ luồng read-only được xác minh tương thích mới đi V2; chức năng ghi có xác nhận không chuyển thành thao tác V2; không mất xác thực/quyền/giới hạn tài nguyên; không thay SSE V1 bằng JSON V2 khi chưa có adapter tương thích | brief M9.2 §3 (chủ dự án) | Chốt D-P01. M9.2 được mở, chỉ T1 |
| D-009 | 2026-11-16 | SAFETY INVARIANT của bridge | Nếu V2 đã xử lý yêu cầu và trả quyết định chặn, lỗi xác thực, lỗi Minor Gate, lỗi safety hoặc lỗi lưu trạng thái bắt buộc: **không fallback sang V1** để lấy câu trả lời; không bypass Safety Guard, Minor Gate, Answer Guard | brief M9.2 §3 | Cài ở `services/coach-v2-bridge.ts` (xem test). V1-fallback chỉ khi V2 chứng minh chưa bắt đầu xử lý |
| D-010 | 2026-11-16 | Hook chặn commit Markdown | Cho phép **ngoại lệ hẹp** chỉ cho tài liệu kiến trúc M9 và `CLAUDE.md`; cấm `ALLOW_TEST_ARTIFACTS=1` và cấm vô hiệu toàn bộ hook; phải có kiểm thử chứng minh artifact khác vẫn bị chặn | brief M9.2 §2 | Đã làm ở commit `37f3d99a` (allowlist đường dẫn chính xác + `scripts/git/check-staged-test-artifacts.test.mjs`). Không mở rộng khi chưa hỏi |
| D-011 | 2026-11-16 | D-P02 (pin RI-2) trong lượt T2 | Không cập nhật RI-2 trong lượt này; giữ `PIN UPDATE REQUIRED` | brief M9.2-T2 (chủ dự án) | Đây **không** phải phê duyệt ngoại lệ pin: nó chỉ hoãn. RI-2 và HR-27 (xem CURRENT-STATE) vẫn fail có chủ đích. D-P02 vẫn PROPOSED |
| D-012 | 2026-11-16 | Hướng D-P04 (lịch sử hội thoại) | V2 phải tích hợp lịch sử AI Coach đúng hợp đồng: không ghi bản ghi giả, không ghi câu trả lời chưa hoàn tất, không dùng DB thật trong nhiệm vụ này | brief M9.2-T2 | Cài ở `coach-v2-continuity.ts` (policy H1–H6). Các chi tiết chưa được chủ dự án chốt (PARTIAL, schema, store) nằm ở D-P11..D-P13 |
| D-013 | 2026-11-16 | Hướng D-P08 (idempotency) | Giữ `clientRequestId` ở boundary của bridge, không truyền vào request strict V2; request trùng của cùng user đã xác định là một yêu cầu không được chạy V2 hai lần; không trộn trạng thái giữa user/session | brief M9.2-T2 | Cài ở `coach-v2-continuity.ts` (I1–I5). Store bền vững chưa quyết (D-P11) |
| D-007 | 2026-11-15 | Pilot gán nhãn | Chủ dự án điều phối, không kiêm curator; 20 câu; họp rút kinh nghiệm bắt buộc; cấm đưa câu pilot/CAL vào bộ 300; thù lao theo công việc (VND chủ dự án xác nhận) | brief pilot | Không liên quan trực tiếp M9, giữ để khỏi mâu thuẫn |

## PROPOSED (đề xuất của AI — **chưa được duyệt**)
| ID | Vấn đề | Các phương án | Khuyến nghị của AI | Tác động nếu chọn | Cần ai |
|---|---|---|---|---|---|
| ~~D-P01~~ | ~~Adapter AI Coach ↔ V2~~ | → **đã chốt thành D-008 (phương án B)** | — | — | — |
| D-P02 | Ngoại lệ pin cho cầu nối | cập nhật isolation allowlist/RI-2/HR-27 · hoặc đặt cầu nối trong `routes/ai-v2.routes.ts` để khỏi sửa pin | **M9.2-T1 không sửa pin nào** (lõi bridge không import `agent-v2`, nên pin cô lập vẫn xanh). RI-2 báo `PIN UPDATE REQUIRED` (xem CURRENT-STATE); cập nhật pin chỉ khi chủ dự án duyệt | Đổi bộ test pin | Chủ dự án |
| D-P03 | Chính sách chọn V1/V2 | cờ toàn cục · danh sách người dùng/tài khoản nội bộ · cờ theo yêu cầu | Danh sách tài khoản nội bộ, mặc định V1. **Đã sửa theo D-009:** V2 lỗi **sau khi đã xử lý** → KHÔNG về V1; chỉ về V1 khi V2 chưa bắt đầu. Code T1 chỉ cài mặc định *từ chối tất cả* (`AI_COACH_V2_BRIDGE_USERS` rỗng) — đó là giới hạn an toàn, không phải phê duyệt chính sách | UI/BE cần tập người dùng | Chủ dự án |
| ~~D-P04~~ | ~~Lịch sử chat của lượt V2~~ | → **hướng đã chốt ở D-012** (ghi vào `ChatSession`/`Conversation` qua bridge, theo hợp đồng V1); phần chi tiết còn mở: D-P12, D-P13 | — | — | — |
| D-P05 | Đóng P1 ký tự vô hình giữa từ | chuẩn hoá Unicode có kiểm soát (đã thử, loại: tách mọi ký tự → mất phủ định) · thay đổi quy tắc ranh giới · gỡ thay đổi | cần thiết kế riêng với vi sai; không vá từng ví dụ | Thay đổi phân loại an toàn | Chủ dự án + Codex |
| D-P06 | Store hạn chế vị thành niên bền vững | Redis có CAS · DynamoDB · bảng Postgres | chọn theo hạ tầng đang có cho session (Redis/DynamoDB đã có adapter session) | Hạ tầng mới/IAM | Chủ dự án |
| D-P07 | SSE cho V2 | giữ JSON, FE tắt stream · phát một `token` rồi `done` · thêm SSE thật vào V2 | **không** thêm SSE thật ở M9.2; phát `status`→`token`→`done` từ kết quả JSON. **T1:** mọi yêu cầu SSE đi V1 (capability `CHAT_STREAM` không đủ điều kiện) cho tới khi có adapter được duyệt | UX khác V1 | Chủ dự án |
| ~~D-P08~~ | ~~Idempotency của retry~~ | → **hướng đã chốt ở D-013** (xử lý ở bridge, key không vào V2). Phần chi tiết còn mở: D-P11 (store bền vững) | — | — | — |
| ~~D-P09~~ | ~~Vị trí và commit của tài liệu M9~~ | → **đã chốt thành D-010** (ngoại lệ hẹp, commit `37f3d99a`). Tài liệu vẫn chỉ tồn tại trên branch `planning/ai-coach-v2-integration` (chưa push, theo D-001) | — | — | — |
| D-P11 | Store idempotency bền vững cho production | DynamoDB conditional put (đã có adapter session DynamoDB) · Redis `SET NX` (đã có adapter session Redis) · bảng Postgres `UNIQUE(user_id, client_request_id)` | **Chưa chọn** — không đủ dữ kiện hạ tầng. Yêu cầu bắt buộc của mọi lựa chọn: claim nguyên tử theo (user, key); bản ghi `IN_PROGRESS` không bao giờ hết hạn thành "có thể claim"; TTL ≥ cửa sổ retry của client; chỉ `COMPLETED` được phép hết hạn | Hạ tầng mới / IAM; **chặn mọi phơi bày người dùng** | Chủ dự án |
| D-P12 | Có lưu câu trả lời `PARTIAL` vào lịch sử không | không lưu (mặc định hiện tại) · lưu (đã có cờ `persistPartial`) | **Không lưu** cho tới khi chủ dự án chốt: PARTIAL luôn kèm phần ý định bị hoãn, V1 sau này đọc lịch sử làm ngữ cảnh, và schema không có chỗ đánh dấu PARTIAL (D-P13). Nếu chốt "lưu" thì cần cột đánh dấu | UX lịch sử vs. ngữ cảnh V1 | Chủ dự án |
| D-P13 | Đề xuất migration schema (KHÔNG thực thi) | (a) `conversations.engine` (text, null = V1) thay cho dấu `modelUsed="multi-agent-v2"`; (b) `conversations.engine_turn_id` (V2 `turnId` chưa có cột); (c) cho phép `prompt/completion/total_tokens` NULL thay vì ghi 0 "chưa đo"; (d) cột đánh dấu `completion_status` (ANSWERED/PARTIAL). Expand→Migrate→Contract, backward-compatible | Chưa cần để chạy bằng fixture; cần trước khi bật thật vì số 0 token làm sai thống kê chi phí admin | Migration + Prisma generate | Chủ dự án |
| D-P10 | Nhà cung cấp mô hình cho V2 | chỉ Bedrock (hiện tại) · thêm ollama như V1 | giữ Bedrock; dev dùng mock | Trải nghiệm dev | Chủ dự án |

## REJECTED
| ID | Mục | Lý do / nguồn |
|---|---|---|
| D-002 | M7R `4b155c3e` | chủ dự án từ chối (brief M9) |
| D-R01 | Chatbot V2 độc lập là mục tiêu production | chủ dự án (D-003) |
| D-R02 | Thay hoàn toàn / chuyển tự động V1 sang V2 | chủ dự án (D-003) |

## Ghi chú
- Mọi đề xuất bị từ chối hoặc được duyệt phải được cập nhật ở đây cùng ngày, kèm nguồn.
- `D-008`–`D-013` ghi nguyên văn quyết định của brief M9.2 / M9.2-T2 (2026-11-16); AI không thêm quyết định nào khác thành APPROVED.
- `D-004` và `D-005` được ghi theo brief M8-C; nếu chủ dự án muốn điều chỉnh, ghi quyết định mới thay vì sửa dòng cũ.
