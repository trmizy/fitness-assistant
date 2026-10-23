# D25 — Điều khoản PT và xác nhận lại: checkpoint 18/10/2026

Quyết định: D25, D72, D74. Bằng chứng: `_warroom/evidence/d25/RESULTS.md`, nguyên văn điều khoản `_warroom/evidence/d25/PT_TERMS_VERBATIM.md`, sổ làm việc `_warroom/sessions/S_d25.md`.

- **Đã làm:** bảng `pt_terms_acceptances`; văn bản 9 điều một nguồn (`user-service/src/services/pt-terms.ts`, mã `2026-10-pt-draft-1`, `PT_TERMS_IS_DRAFT = true`); cổng trung tâm `assertPtTermsForNewContract` cho `acceptContract` và nhánh admin; modal ở bước cuối hồ sơ PT; lời nhắc cho PT cũ; chốt phát hành `check-pt-terms-release` + T-01.
- **Kiểm thử:** pt-terms-acceptance 7/7, pt-terms-release 6/6, contract-*/pt-restriction-*/legacy-contract-* 282/282, liên dịch vụ thật 31/31; web 6/6 + build; mobile 6/6 + tsc; REAL BROWSER 360/375/390/412 và REAL EMULATOR theo checklist (trước khi đổi mã nháp; không đổi giao diện sau đó).
- **Chưa xong / chờ Ngài:** duyệt nguyên văn 9 điều → phát hành dưới mã chính thức MỚI (mọi PT xác nhận lại); Điều 5 nguồn tiền bồi hoàn chờ N7/D48; lưu IP/user-agent chờ chính sách quyền riêng tư (phương án a/b/c); cảnh báo cho khách khi PT chưa xác nhận → backlog (cần mở rộng DTO công khai).
- **Bộ kiểm thử ngoài repo** (Playwright E2E, Maestro) cần PT mẫu xác nhận mã `2026-10-pt-draft-1` qua `POST /pt-applications/terms/accept`.

## Follow-up 18/10 (sau khi đổi mã sang `2026-10-pt-draft-1`, D75 mục 1)

Không đổi mã sản phẩm nào của D25. `PT_TERMS_IS_DRAFT` vẫn `true`. Bằng chứng: `_warroom/evidence/d25/followup/` (nhật ký web, hash hợp đồng ACTIVE, đếm bộ kiểm thử, probe D13).

**A1. Bộ kiểm thử user-service (BACKEND INTEGRATION, DB riêng `gymcoach_user_d25r_test` trên container test, `--test-concurrency=1`)**: `pt-terms-acceptance` 7/7, `pt-terms-release` 6/6, `contract-*` + `pt-restriction-*` + `legacy-contract-*` 282/282 → tổng 295/295, 0 lỗi. Chưa chạy toàn bộ user-service, chưa chạy lại e2e liên dịch vụ trong đợt này.

**A2. REAL BROWSER (Chromium/Playwright, Vite + gateway + auth/user/payment thật, DB `*_d25r_test` nhân bản từ p36; gym-service không chạy)**: 203 kiểm tra, 0 lỗi.
- 360: A (ứng viên, bước cuối, mở modal 9 điều, không tràn ngang, nút xác nhận không bị che) 22; PT chưa xác nhận (banner, nhận bị từ chối + thông báo dễ hiểu + modal, hợp đồng không đổi) 29; nâng phiên bản (chỉ chèn một dòng có mã cũ; banner "đã được cập nhật") 29; PT đã xác nhận (không banner) 6; đổi tài khoản 5 = 91.
- 375: như trên (A có nộp hồ sơ: 25) + xác nhận lại và nhận (9) + PT đã xác nhận nhận hợp đồng (9) = 112.
- DB sau các bước: ứng viên `APPLICATION|2026-10-pt-draft-1`; PT chưa xác nhận sau khi bấm "Tôi đồng ý": `RECONFIRM|2026-10-pt-draft-1`; cả hai hợp đồng sau khi nhận: `PENDING_PAYMENT`, hạn = giờ nhận + 12 giờ; hợp đồng ACTIVE và các buổi của nó: hash trước = sau.
- Không chạy 390/412 (đã quét ở lượt trước; không đổi giao diện).

**A3. REAL EMULATOR UI (Pixel_10_Pro_XL, dev client, Metro thật; một kích thước ~448dp, không quét 360/375)**: PT chưa xác nhận: banner trên tổng quan và hợp đồng; "Nhận" bị từ chối, sheet có thông báo + nhãn bản nháp + đủ 9 điều + nút "Tôi đồng ý", không lộ mã nội bộ, hợp đồng vẫn PENDING_REVIEW, chưa có dòng xác nhận; nâng phiên bản (dòng mã cũ) → banner "đã được cập nhật" sau lần bị từ chối kế tiếp; xác nhận qua banner → `RECONFIRM|2026-10-pt-draft-1`; "Nhận" thành công → PENDING_PAYMENT, hạn +12 giờ, không mở sheet; đổi tài khoản An → PT đã xác nhận (không banner) → An (banner "đã được cập nhật"): không rò trạng thái; hợp đồng ACTIVE không đổi. Không chạy lại luồng ứng viên mobile (web đã phủ; phía server không đổi).
- Quan sát (chưa chẩn đoán, không sửa vì không được đổi giao diện khi chưa xin phép): khi mã phiên bản đổi trong lúc ứng dụng mobile đang mở, banner không tự đổi chữ sang "đã được cập nhật" sau ~3 phút điều hướng; nó cập nhật ngay khi PT bấm "Nhận" (bị từ chối thì làm mới) hoặc đăng nhập lại. Cổng phía server vẫn chặn đúng, nên chỉ là độ trễ hiển thị chữ banner.

**A4. Bộ kiểm thử ngoài repo**
- Không tìm thấy luồng Maestro (yaml) nào trong repo hay các thư mục D:\ liên quan; Maestro chưa cài. E2E mobile trong repo (`frontend/mobile/e2e/*.e2e.ts`) chỉ gửi/hủy yêu cầu phía khách, không có bước PT nhận hợp đồng. `D:\fitnessassistant-mobile-e2e` (Capacitor) đã ngừng. `D:\fitnessassistant-teacher-demo-kit` chỉ đọc hợp đồng ACTIVE.
- `D:\fitnessassistant-playwright-e2e`, PT mẫu `pt@example.com`:
  - `tests/05-pt-contract-payment.spec.ts` TC-PTC-ACCEPT-001 (PT nhận hợp đồng qua giao diện thật) sẽ nhận 409 `PT_TERMS_NOT_ACCEPTED`; thông báo "Contract accepted!" không bao giờ hiện → FAIL. Kéo theo: TC-PTC-PAY-001 (không có hợp đồng "Payment Due") và toàn bộ `tests/25-session-lifecycle-and-disputes.spec.ts` (cần hợp đồng ACTIVE từ 05; TC-SESS-000 trở đi). TC-RBAC-005 (khách nhận → 403) không đổi.
  - `tests/23-pt-application-workflow.spec.ts` TC-PTAPP-001/002: không phải 409 mà là locator; ô cuối của bước "Cam kết" đổi chữ ("Tôi đồng ý với điều khoản dành cho Huấn luyện viên của Gymini.") nên `label hasText` cũ hết thời gian chờ. TC-PTAPP-003 chỉ POST gửi lại khi đã REJECTED, vẫn bị chặn như trước.
  - `tests/20`, `tests/21`: chỉ `POST /contracts/request` → không ảnh hưởng (khách vẫn gửi được tới PT chưa xác nhận). `tests/11` TC-UID-006 đã hỏng sẵn từ trước (route PATCH status bị khóa 410 và payload cũ) → không liên quan D25.
- Sửa tối thiểu đã làm (chỉ công cụ kiểm thử, CHƯA chạy vì chạy sẽ ghi vào DB dev): `fixtures/auth.ts` thêm `ensurePtTermsAccepted` (GET `/pt-applications/terms` rồi POST `/pt-applications/terms/accept` với đúng mã đang phục vụ, idempotent, không phụ thuộc mã cụ thể); `05-...spec.ts` gọi nó trong `beforeAll` sau khi đăng nhập PT; `23-...spec.ts` đổi locator ô thứ 4 sang regex `/điều khoản dành cho Huấn luyện viên/`. Hệ quả: lần chạy đầu sẽ ghi một dòng xác nhận mã nháp cho `pt@example.com` trên DB dev; vô hại với bản chính thức (mã mới thì xác nhận lại). `tsc` không báo lỗi mới ở 3 file này (các lỗi cũ ở file khác không đổi).

**Dọn dẹp**: dịch vụ, Metro, emulator, adb đã dừng; container `gymcoach-test-postgres-test-1` vẫn chạy; DB `gymcoach_{auth,user,gym,payment}_d25r_test` còn lại trong container test (nhân bản từ p36). Không ghi DB dev.
