# D25 — Điều khoản PT và xác nhận lại: checkpoint 18/10/2026

Quyết định: D25, D72, D74. Bằng chứng: `_warroom/evidence/d25/RESULTS.md`, nguyên văn điều khoản `_warroom/evidence/d25/PT_TERMS_VERBATIM.md`, sổ làm việc `_warroom/sessions/S_d25.md`.

- **Đã làm:** bảng `pt_terms_acceptances`; văn bản 9 điều một nguồn (`user-service/src/services/pt-terms.ts`, mã `2026-10-pt-draft-1`, `PT_TERMS_IS_DRAFT = true`); cổng trung tâm `assertPtTermsForNewContract` cho `acceptContract` và nhánh admin; modal ở bước cuối hồ sơ PT; lời nhắc cho PT cũ; chốt phát hành `check-pt-terms-release` + T-01.
- **Kiểm thử:** pt-terms-acceptance 7/7, pt-terms-release 6/6, contract-*/pt-restriction-*/legacy-contract-* 282/282, liên dịch vụ thật 31/31; web 6/6 + build; mobile 6/6 + tsc; REAL BROWSER 360/375/390/412 và REAL EMULATOR theo checklist (trước khi đổi mã nháp; không đổi giao diện sau đó).
- **Chưa xong / chờ Ngài:** duyệt nguyên văn 9 điều → phát hành dưới mã chính thức MỚI (mọi PT xác nhận lại); Điều 5 nguồn tiền bồi hoàn chờ N7/D48; lưu IP/user-agent chờ chính sách quyền riêng tư (phương án a/b/c); cảnh báo cho khách khi PT chưa xác nhận → backlog (cần mở rộng DTO công khai).
- **Bộ kiểm thử ngoài repo** (Playwright E2E, Maestro) cần PT mẫu xác nhận mã `2026-10-pt-draft-1` qua `POST /pt-applications/terms/accept`.
