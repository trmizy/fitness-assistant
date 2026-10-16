# Rà soát web ↔ mobile: dữ liệu và chức năng còn thiếu trên mobile (3/10/2026)

Nhãn bằng chứng: **CODE AUDIT** toàn bộ (đọc code, không bấm thử). Web là "sàn tối thiểu" (kế hoạch mobile, nguyên tắc chung).

## Cách rà

1. **Trang:** liệt kê ~90 route web (`frontend/web/src/app/routes.tsx`) và ~100 màn mobile (`frontend/mobile/app`), đối chiếu với
   `MOBILE_MIGRATION_MANIFEST.md`.
2. **Chức năng:** liệt kê mọi hàm API (`xxxService.fn`) mà **giao diện** web gọi rồi tìm trong **giao diện** mobile (không tính
   `api.ts` — mobile đã chép gần hết lớp API của web ở Phase 2 nên có hàm chưa chắc đã có màn dùng). 411 hàm web ↔ 288 hàm
   mobile → 154 hàm chỉ web gọi; từng nhóm được kiểm lại bằng tay xem mobile có làm cùng việc bằng hàm khác tên không
   (vd. mời quản lý, onboarding, biểu đồ tiến bộ bài tập — **có**, chỉ khác tên).
3. **Dữ liệu hiển thị:** trích tiêu đề khối/mục (h1–h4, tiêu đề thẻ, tab) của từng trang web cùng component con, tìm bên
   mobile; khối nào không thấy thì đọc tay cả hai bên.

Script ở thư mục tạm của phiên (không thuộc repo). Đã loại các mục Ngài đã quyết hoãn hoặc web tự không dùng (ghi ở mục E).

## A. Chức năng lớn còn thiếu (ưu tiên cao — chạm luồng chính của khách / PT / chủ gym)

| # | Chức năng (web) | Web | Mobile hiện có | Ghi chú |
|---|---|---|---|---|
| A1 | **Chu kỳ tập & đánh giá chu kỳ** — bắt đầu/hoàn thành/huỷ/xoá chu kỳ; đánh giá (CycleAssessment: Giữ/Tăng tải/Điều chỉnh/Deload/Xây lại); chấp nhận/từ chối đề xuất tập luyện **và** dinh dưỡng; diet break; báo cáo, tiến độ, tuân thủ buổi tập, chất lượng dữ liệu, tóm tắt phản hồi; lịch sử chu kỳ | `TrainingCyclePage` (`trainingCycleService.*` 16 hàm) | Tab "Chu kỳ" chỉ **xem** chu kỳ đang chạy (`getActive`) | CycleAssessment là nơi ra quyết định thích nghi (bảng nguồn sự thật CLAUDE.md) — mobile không có đường nào để khách đưa ra/nhận quyết định |
| A2 | **Phản hồi sau buổi tập** — cảm nhận, RPE, đau/khó chịu, mệt; nhận xét từng bài (thích, quá nặng/nhẹ, nhiều/ít set, đau, thiếu dụng cụ…) | `WorkoutLogPage` (`sessionFeedbackService.get/submit`) | Không có | Dữ liệu này nuôi A1 (tóm tắt phản hồi của chu kỳ) |
| A3 | **Quản lý lịch & chương trình tập** — bỏ buổi (kèm lý do), dời buổi, thêm lịch, đánh dấu hoàn thành/hoàn tác từng bài, tạo chương trình thủ công, thêm/sửa/xoá bài trong chương trình, sửa ngày tập, nhóm bài (superset), bài tập tự tạo, loại set (warm-up/top set/drop set…), tóm tắt buổi, bài thay thế (`getSubstitutes`) | `WorkoutLogPage` (`workoutService.*` ~20 hàm, `exerciseService.getSubstitutes`) | Bắt đầu buổi, thêm/sửa set, xem lịch sử, nhập từ app khác, mẫu | Mobile chỉ **thực hiện** buổi đã có lịch; không **sửa** được kế hoạch |
| A4 | **Thực hiện thực đơn** — đánh dấu bữa đã ăn/hoàn tác, ghi phần đã ăn (%), thêm/sửa lượng/xoá món trong bữa, xoá bữa khỏi kế hoạch, trạng thái thực đơn đang chạy; sửa nhật ký ăn | `NutritionPage` (`nutritionService` 8 hàm: `upsert/deleteMealCompletion`, `add/update/deleteMealItem`, `deletePlanMeal`, `getActiveState`, `updateLog`) | Ghi/xoá nhật ký, mục tiêu, lịch sử mục tiêu, tháng, việc trong ngày, dừng kế hoạch | |
| A5 | **PT: thẻ thể lực & tiến độ học viên** — dữ liệu tập luyện, cảm nhận (tích cực/tiêu cực…), thực đơn khớp/lệch mục tiêu, đo InBody theo thời gian; **duyệt / sửa / từ chối đề xuất dinh dưỡng của chu kỳ**, đề xuất diet break | `PTClientDetail` → `ClientFitnessSummaryCard`, `ClientProgressCard` (`ptCoachService` 6 hàm) | Thẻ Lộ trình (WB-13), hợp đồng, buổi | Đường "PT duyệt có kiểm toán" mà nguồn-sự-thật nhắc tới |
| A6 | **PT giao kế hoạch tập cho học viên** | `AssignPlanModal`, `PTServiceOrderPage` (`ptCoachService.createAndAssignPlan`) | Không có | |
| A7 | **Chủ gym: trang quản lý chi nhánh (GY-03)** — sửa giới thiệu/điện thoại/email chi nhánh, giờ hoạt động (kể cả 24 giờ), tiện ích & dịch vụ, ảnh (tải lên, xoá, sắp xếp, ảnh bìa), giấy tờ xác minh theo chi nhánh, trạng thái vận hành (mở/tạm đóng/đóng vĩnh viễn + tác động khi đóng), hợp tác PT theo chi nhánh | `GymManagePage` (`getOwnedGym`, `updateGym`, `get/setGymHours`, `setGymOperationalStatus`, `getClosureImpact`, ảnh/giấy tờ) | Danh sách chi nhánh, ví, mã QR check-in (E1) | Manifest GY-03 "chưa làm" từ đầu |

## B. Chức năng nhỏ còn thiếu

| # | Chức năng | Web | Ghi chú |
|---|---|---|---|
| B1 | Huỷ gói hội viên **đang hoạt động** | `GymMembershipsPage` (`cancelActiveMembership`) | Mobile chỉ huỷ gói đang chờ thanh toán |
| B2 | Viết / xoá **đánh giá phòng gym** | `GymReviewsSection` (`submit/deleteGymReview`) | Mobile chỉ xem đánh giá |
| B3 | **Chi tiết hợp đồng** riêng + **tải PDF hợp đồng**, gửi lại ký điện tử | `ContractPage` (`getById`, `getPdfUrl`, `resendESign`) | E-sign đang tắt; PDF vẫn có |
| B4 | PT **đánh giá khách hàng** sau buổi | `PTContractsPage` (`sessionService.reviewClient`) | |
| B5 | **Chia sẻ mẫu buổi tập** cho người khác | `TemplatesPage` (`templateService.share`) | Đã biết (CL-16 PARTIAL, GAP-8) |
| B6 | AI **giải thích kế hoạch** (stream) | `AIPlansPage` (`planService.explainPlanStream`) | |
| B7 | **Tạo gói bán từ kế hoạch đã duyệt** / "Gói bán của tôi" / gỡ gói | `PlanMarketplacePage` (`trainingPackageService.create/listMine/archive`) | Mobile có đăng kế hoạch lên chợ (`marketplaceService`) nhưng không có phần "gói tập đang bán" này |
| B8 | Bộ lọc thư viện thực phẩm | `FoodLibraryPage` (`foodService.getFilterOptions`) | Mobile chỉ tìm theo tên |
| B9 | Nhận **lời mời làm quản lý chi nhánh** (WB-02) | `/partner/invite/:token` (`preview/acceptPartnerInvitation`) | Manifest WB-02 "chưa làm"; cần mở link từ email (deep link) |

## C. Dữ liệu web hiển thị mà mobile không hiển thị

| # | Trang | Web có | Mobile |
|---|---|---|---|
| C1 | Tổng quan khách | Biểu đồ xu hướng cân nặng, biểu đồ cơ bắp, Calories tuần này, "Kế hoạch đang dùng", **AI Insights**, "Tập luyện gần đây", ô Mỡ cơ thể và số buổi tập | Chuỗi ngày, buổi sắp tới, calo/đạm hôm nay, cân nặng/cơ bắp (theo thiết kế Figma) |
| C2 | Tập luyện | Khối "Chỉ số cơ thể" (hành trình cân nặng: khởi đầu/hiện tại/mục tiêu/còn lại + ghi chỉ số), "Phân bổ nhóm cơ", "Phân bổ loại bài tập" | Không có trên màn Tập luyện (cân nặng khởi đầu chỉ ở Sửa hồ sơ) |
| C3 | InBody | Radar "Cân bằng cơ thể", biểu đồ xu hướng mỡ, tab Lịch sử liệt kê mọi lần đo | Tổng quan + so sánh 2 lần gần nhất, cơ/mỡ theo vùng, biểu đồ lịch sử, quét ảnh |
| C4 | Dinh dưỡng | Nhận xét dinh dưỡng trong ngày ("Protein hôm nay còn thấp…"), biểu đồ 7 ngày gần nhất | |
| C5 | Chi tiết PT (khách xem) | "Phương pháp huấn luyện" (`trainingMethodsApproach`), "Đối tượng & Mục tiêu" | Có kinh nghiệm/học vấn, gói, đánh giá, giờ rảnh |
| C6 | Tổng quan PT | Biểu đồ doanh thu hợp đồng, "Cảnh báo học viên" | Ví + 5 chỉ số + buổi sắp tới (cùng API) |
| C7 | Tổng quan admin | Biểu đồ tăng trưởng người dùng, tỉ lệ vai trò, cảnh báo hệ thống, người đăng ký gần đây | 4 chỉ số + thống kê quét InBody (cùng API `getDashboard`) |

## D. Admin — chức năng còn thiếu (ngoài các trang đã hoãn)

| # | Chức năng | Web |
|---|---|---|
| D1 | **Quản lý đối tác đang hoạt động**: danh sách đối tác, tạm khoá/mở khoá/chấm dứt (kèm tác động), chuyển quyền sở hữu, xem như đối tác, đặt lại mật khẩu / buộc đăng xuất / thu hồi tài khoản đối tác, nhật ký trao đổi, ghi chú nội bộ, giấy tờ đối tác, giấy phép sắp hết hạn, chiết khấu riêng, nhật ký kiểm toán | `AdminPartnersPage` (~30 hàm `adminService.*Partner*`). Mobile chỉ có duyệt hồ sơ đăng ký (WB-17) và duyệt chi nhánh |
| D2 | **Tài chính: tổng quan + đối soát** | `AdminFinancePage` (`getFinanceOverview`, `getReconciliation`). Mobile chỉ có duyệt rút tiền |
| D3 | **Danh sách PT đang hoạt động** (AD-03) | Đã biết — BLOCKED do backend thiếu API (GAP-1) |

## E. Không tính là thiếu (đã quyết hoặc chỉ web dùng)

- **WB-05..10** công cụ admin bàn làm việc (quản lý gym tổng quan, duyệt bài tập, chất lượng danh mục, hệ thống, workflow, AI
  observability) — Ngài cho hoãn 27/9.
- **Wizard thêm chi nhánh 7 bước (GY-07)** — chính web vẫn dùng hộp thoại đơn giản làm luồng thật.
- **Trang đặt lại mật khẩu từ link email** — mobile gửi yêu cầu, link mở trang web (GAP-4; cần tên miền + App Links, GAP-20).
- **Số liệu hồ sơ PT trên web là số bịa** — cố ý không chép (Phase 10).
- Ghi chú: dòng **AD-02** trong manifest vẫn ghi "chưa làm" ở cột trạng thái nhưng thực tế đã xong 28/9 (§35.3).

## Đề xuất thứ tự

1. **A1 + A2** (chu kỳ + phản hồi buổi tập) — cùng một luồng, là phần "thích nghi" cốt lõi của sản phẩm.
2. **A5 + A6** (PT xem thể lực, duyệt đề xuất dinh dưỡng, giao kế hoạch) — mặt PT của cùng luồng.
3. **A4** (thực hiện thực đơn) và **A3** (sửa lịch/chương trình).
4. **A7** (GY-03 quản lý chi nhánh).
5. **B** và **C** theo từng màn khi đụng tới; **D1/D2** nếu admin cần dùng trên điện thoại.
