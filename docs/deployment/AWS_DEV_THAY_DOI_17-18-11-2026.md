# AWS DEV: các thay đổi đã làm ngày 17–18/11/2026

Ghi chép từ phía chủ repo, tổng hợp những gì đã làm trên AWS DEV (tài khoản 191798898985, ap-southeast-1) cùng agent của partner trong đợt test sau deploy. Mục đích là để partner nắm được mọi thứ đã thay đổi và ảnh hưởng tới chi phí.

**Tóm tắt chi phí:**
- **Không tạo hay bật thêm dịch vụ tính tiền nào.** Không bật Aurora, ECS hay lịch EventBridge; không tạo NAT, OpenSearch hay instance nào.
- Mọi thay đổi là: deploy code Lambda, chỉnh cấu hình (biến môi trường, CORS, IAM) và thao tác dữ liệu test.
- Chi phí phát sinh chỉ là lượt gọi API/Lambda/S3 trong lúc test, ước dưới 1 USD.
- Chat (ECS) và toàn bộ lịch EventBridge vẫn **tắt** như trước.

---

## 1. Các lần deploy code Lambda (6 lần)

Mỗi lần deploy đều chạy workflow **DEV Application Deploy (Lambda code)** từ nhánh `aws-deploy`: chạy thử `dry_run=true` trước, rồi mới chạy thật `false`. Workflow chỉ cập nhật code (`update-function-code`), không đổi cấu hình hay hạ tầng.

| # | Thời điểm (UTC) | Build / commit | Service | Nội dung chính |
|---|---|---|---|---|
| 0 | 17/11 ~09:57 | (bản deploy gốc của partner) | auth, user, gym, payment | Bản đưa `feature/payment-gateways` lên AWS. Đây là mốc bắt đầu đợt test |
| 1 | 17/11 ~16:16 | `44120498193` / `d8e86133` | user, gym, fitness | gym và user gọi các service khác bằng Lambda invoke thay vì URL localhost (sửa lời mời nhân viên, check-in hộ, mail gym, `gym-options`). Đóng gói CSV danh mục cho trang duyệt bài tập |
| 2 | 18/11 ~04:41 | `44237002037` / `f907be8d` (gồm `e053d0e9`) | user, gym, payment | VNPay ký đúng khi tên gói có ngoặc. Cho huỷ hợp đồng kẹt ở bước ký. Tiêu đề mail lời mời theo vai trò. Sửa wizard tạo bản nháp trùng. Giấy tờ chi nhánh và ảnh khiếu nại tải thẳng lên S3 (presign) |
| 3 | 18/11 ~06:13 | `44247990471` / `0ccda7a1` | user, payment | Tìm PT theo email (ADM-01). Ngày giờ trong banner dời lịch. Lỗi tải ảnh khiếu nại hiện rõ. Không lộ chữ vận hành ZaloPay/Grafana |
| 4 | 18/11 ~08:16 | `44263793112` / `497adcb7` (gồm `59b108db`) | user | `/admin/users` phân trang và lọc trong DB. Sửa lỗi client gọi auth làm mất query. Các sửa giao diện (PT-05/08, lộ email/id, điều hướng thông báo…) |
| 5 | 18/11 (chiều) | `44268520089` / `e367aaf3` (gồm `051d43f1`) | auth, user | Dashboard admin và "Hôm nay" tính số trong DB, không kéo toàn bộ user nữa. `recentUsers` có `id` + `partnerRole`. `/auth/internal/test-account-ids` lọc trong SQL |

**Web (S3 + CloudFront)** được đồng bộ 4 lần, sau các lần deploy 2, 3, 4 và 5. Bundle lần lượt là `index-B2rkiHF2.js`, `index-BqoPpsxo.js`, `index-C4qe1Zsp.js`, `index-DrCCWcHM.js`.
- Cách đồng bộ: `aws s3 sync` **không `--delete`**, giữ nguyên `runtime-config.json`; các file vỏ (`index.html`, `sw.js`, manifest) đặt `no-cache`; mỗi lần 1 invalidation CloudFront `/*`, nằm trong hạn mức miễn phí.
- Bản cũ của các file vỏ được partner sao lưu trước mỗi lần đồng bộ.

## 2. Cấu hình đã chỉnh tay (ngoài workflow, ngoài IaC)

Do agent partner thực hiện. Tất cả là chỉnh cấu hình của tài nguyên đã có sẵn, không tạo tài nguyên mới.

| Hạng mục | Thay đổi | Lý do |
|---|---|---|
| CORS bucket `fitness-assistant-uploads-dev-191798898985` | Thêm origin `https://gymini.vn`, `https://www.gymini.vn` | Web không tải tệp lên được |
| CORS API Gateway `id1iz7upbl` | Thêm allow-header `x-gymini-client`, `x-gymini-listing-flow`, `x-gymini-venue-consent` | Hồ sơ đối tác gym và nút "Tôi đồng ý" bị chặn |
| Env Lambda `user` | `REQUIRE_CONTRACT_ESIGN=false`, `PT_MEDIA_S3_BUCKET`, `GYM_LAMBDA_NAME`, `PAYMENT_LAMBDA_NAME` | Hợp đồng kẹt bước ký; ảnh PT; gọi gym/payment |
| Env **mọi Lambda** (auth, user, user-jobs, gym, payment, fitness) | `TZ=Asia/Ho_Chi_Minh` | Giờ buổi tập lệch 7 tiếng |
| Env Lambda `payment` | Khoá ZaloPay **sandbox**, `ZALOPAY_CALLBACK_URL`, `ZALOPAY_PRODUCTION_VERIFIED=true` | Bật ZaloPay sandbox. **Cờ này chỉ được bật khi dùng khoá sandbox** |
| IAM role `user` | Quyền S3 trên `pt-physique/*`, quyền invoke Lambda gym/payment | Ảnh PT, gọi service |
| IAM role `gym` | Quyền S3 trên `listing-photos/*`, `branch-documents/*`, `complaint-photos/*` | Ảnh tin đăng, giấy tờ chi nhánh, ảnh khiếu nại |
| Aurora `fitness-assistant-dev-aurora` | **Bật Data API** (chủ repo bật, 17/11) | Đọc/ghi dữ liệu test mà không cần bastion |
| Env Lambda `user`: `CHAT_SERVICE_URL` (**do script quản lý, không đặt cứng**) | `dev-start.ps1 -Chat` đặt thành `http://<DNS ALB chat mới>` (bước 6c); `dev-stop.ps1 -Chat` để rỗng (bước 2b-iii). Công cụ: `scripts/aws/lib/set-lambda-env.cjs` (đọc map env, đổi đúng 1 khoá, ghi lại cả map) | ALB chat được tạo lại mỗi lần `dev-start -Chat` nên DNS đổi mỗi ngày; đặt cứng một lần sẽ hỏng từ hôm sau. Cần cho đẩy thông báo realtime và `POST /internal/contracts/connect` (tự tạo chat khi kích hoạt hợp đồng). Hai lời gọi này là best-effort, chat tắt thì hợp đồng vẫn kích hoạt. 19/11/2026 |

Toàn bộ cấu hình trên đã được ghi lại thành script `scripts/aws/dev-manual-config.mjs` (nhánh `aws-deploy`): chạy không tham số là chỉ kiểm tra, `--apply` là áp dụng. **Lưu ý:** pipeline hay stack nào ghi đè cấu hình Lambda/CORS/IAM sẽ trả các mục này về giá trị cũ.

## 3. Dữ liệu trên DB DEV

- **Trong lúc test** có tạo tài khoản test, hợp đồng, buổi tập, gói gym và **5 giao dịch thanh toán sandbox** (VNPay và ZaloPay sandbox, tiền ảo), cùng 1 tài khoản admin phụ để xét kháng nghị.
- **Sau khi test (18/11):** toàn bộ dữ liệu test đã được **hoàn tác về mốc trước khi test**, bằng Data API theo transaction từng DB.
  - Đã kiểm lại: escrow = tổng số dư phải trả, drift = 0, không ví âm.
  - Tổng tài khoản trở lại 1.299, gồm 3 admin.
  - Xoá thêm 2 tài khoản người lạ đăng ký trên web công khai.
  - Dữ liệu partner tạo trong cùng khoảng thời gian (InBody và hồ sơ của tranminhduy1902) được **giữ nguyên**.
- Một số ảnh/tệp test vẫn còn trong S3. Dung lượng nhỏ, không còn DB nào trỏ tới.

## 4. Ước tính chi phí phát sinh từ đợt này

| Khoản | Ước tính |
|---|---|
| Lượt gọi Lambda và API Gateway khi test (vài nghìn request) | gần như 0, trong free tier |
| Data API (vài nghìn lệnh đọc/ghi) | < 0,01 USD |
| S3: vài chục tệp test, vài MB | < 0,01 USD/tháng |
| CloudFront invalidation (4 lần) | miễn phí |
| Mail | gửi qua SMTP Gmail, không dùng SES |
| **Tổng** | **< 1 USD** |

Chi phí chính của DEV vẫn là **thời gian Aurora chạy**. Việc bật hay tắt Aurora do partner quyết, phía chủ repo không bật hay tắt dịch vụ nào.

## 5. Còn mở

- Lọc `partnerRole=…` ở `/admin/users` mất khoảng 3 giây (gọi gym-service từng đợt).
- Backend chỉ ký URL avatar `s3://` ở hồ sơ của chính mình; màn hiện avatar người khác chưa ký.
- `/translate` 404 (AWS không có gateway). Mail đặt lại mật khẩu và mail lời mời kế toán vào Spam (chưa có SPF/DKIM).
- Đưa các cấu hình ở mục 2 vào IaC/runbook.
