# 02 — Đối chiếu các artifact

Ngày 2026-10-19 (Asia/Saigon). START_HEAD: 003545c6da8d524e8c4f6fbe4575444102f1fc50. Nhánh aws-deploy.

Bằng chứng: **CODE AUDIT / STATIC_CODE_VERIFIED** trong phạm vi từng trích đoạn; không có test chạy, REAL BROWSER, REAL HTTP/API, live runtime hay deployment verification. Định nghĩa test được đọc không tương đương UNIT_TEST_VERIFIED hoặc INTEGRATION_TEST_VERIFIED.

Đếm trực tiếp: **101 capability, 101 ID duy nhất, 14 domain hợp lệ**. Không có ID JSON trùng hoặc tham chiếu domain không tồn tại. Markdown có 102 ID: CAP-06-06 là “Freshness check vs. newer evidence”, một ghi chú kiểm toán, không phải chức năng sản phẩm; không tự động thêm thành capability thứ 102.

| Trạng thái gốc | Số record trực tiếp |
| --- | --- |
| IMPLEMENTED_NOT_RUNTIME_VERIFIED | 9 |
| IMPLEMENTED_AND_VERIFIED | 58 |
| UNKNOWN_INSUFFICIENT_EVIDENCE | 3 |
| PARTIALLY_IMPLEMENTED | 16 |
| BROKEN_OR_INCONSISTENT | 3 |
| MOCK_OR_SEED_ONLY | 1 |
| PLANNED_NOT_IMPLEMENTED | 7 |
| FEATURE_FLAGGED_OFF | 4 |

Manifest ghi tổng 101 nhưng phân bổ trạng thái cộng thành 100; phân bổ cũ 48/14/20/6/4/3/1/4 không khớp 58/9/16/7/4/3/1/3 trong record. Đây là metadata chưa đồng bộ sau chỉnh sửa, không chứng minh thất lạc một chức năng thực. Bảng Markdown report 14 vẫn dùng số xấp xỉ cũ.

Metadata capabilities.json tự nhận “Partial extraction”; gaps.json còn ghi chỉ BDG-01..12 và Case C/D đang chờ, dù đã có BDG-13..20. CAP-13-05 trong Markdown vẫn pending, JSON đã broken. Các mâu thuẫn trạng thái trực tiếp:

| ID | JSON | Markdown |
| --- | --- | --- |
| CAP-01-06 | IMPLEMENTED_AND_VERIFIED | IMPLEMENTED_NOT_RUNTIME_VERIFIED |
| CAP-01-09 | UNKNOWN_INSUFFICIENT_EVIDENCE | PARTIALLY_IMPLEMENTED |
| CAP-03-11 | BROKEN_OR_INCONSISTENT | PARTIALLY_IMPLEMENTED |
| CAP-06-02 | PARTIALLY_IMPLEMENTED | IMPLEMENTED_AND_VERIFIED |
| CAP-08-04 | PLANNED_NOT_IMPLEMENTED | **CONFIRMED NOT_IMPLEMENTED** |
| CAP-10-03 | IMPLEMENTED_AND_VERIFIED | FIXED (historical) |
| CAP-10-04 | PLANNED_NOT_IMPLEMENTED | **Pending in-flight agent** |
| CAP-13-05 | BROKEN_OR_INCONSISTENT | **Pending in-flight agent — this is Case C/D directly.** |

20 BDG có phân bổ gốc P0=0/P1=7/P2=9/P3=4. 36 G có P0=4/P1=20/P2=10/P3=2. Đây là số lịch sử, không phải số rủi ro triển khai hiện tại. BDG-01 đã lặp G-17; BDG-17/20 trùng nguyên nhân nhưng phải giữ scenario riêng.

Số đếm mới có định nghĩa tái lập: 144 model trong 7 schema Prisma nguồn; 58 file *.routes.ts; 59 file .ts dưới routes (khác định nghĩa 56 file được classified). Web có 89 khai báo path, mobile có 104 file màn hình TSX bỏ _layout; không cộng thành số URL duy nhất hay so thẳng với 161 “routes/screens classified”. 10 đơn vị ứng dụng trong repo không chứng minh 10 đơn vị đang triển khai. 4 enum role xác nhận; MANAGER là quyền trong gym partner. 16 AICAP/8 WF là số record inventory, không chứng minh độ đầy đủ. 16 jobs/90 proxy registrations chưa được đếm độc lập theo cùng định nghĩa.

Các capability có giao nhau nhưng không xóa ID: CAP-01-07/CAP-14-01 (quản trị user); CAP-01-08/CAP-12-01 (partner onboarding); CAP-03-05 và CAP-09-02 (workflow nền); CAP-13-01/02 là gate và signal, không hoàn toàn trùng.


**Bổ sung kiểm tra nguồn:** AssessCycleOutputSchema CÓ decision; cycle-assessment.service.ts ép về req.decision.value, requiresConfirmation=true và allowedChanges. Claim “decision field absent, structurally impossible” trong ai-integrations.json và report 06 là sai cơ chế. Exercise progression explanation là nhánh khác chỉ trả explanation; legacy analyze-cycle lại có model decision phase, không phải deterministic CycleAssessment. E55: `backend/services/ai-service/src/schemas/cycle-assessment.schemas.ts:90`; E56: `backend/services/ai-service/src/services/cycle-assessment.service.ts:153`; E72: `backend/services/ai-service/src/services/exercise-progression-explanation.service.ts:66`; E73: `backend/services/ai-service/src/services/cycle-analysis.service.ts:215`.

16 AICAP records có ID duy nhất, nhưng governance “active” không được dùng làm runtime evidence. Không đồng nhất hai nhánh cycle-analysis và cycle-assessment.
