# Listing Management — Ma trận kiểm thử

Nhãn bằng chứng dùng đúng nghĩa: `BACKEND INTEGRATION` (test tích hợp trên DB `*_test` cô lập), `REAL HTTP/API` (gọi gateway/dịch vụ chạy thật), `REAL BROWSER` (trình duyệt thật), `REAL DEVICE` (thiết bị Android thật), `TEST FIXTURE` (dữ liệu/giả lập chuẩn bị sẵn), `CODE AUDIT` (đọc code). Không gọi đọc code là E2E; không gọi một lượt chạy phạm vi hẹp là "toàn bộ hồ sơ".

Mọi con số dưới đây là **kết quả đã ghi nhận** ở các lượt chạy trước (nguồn: `_warroom/TINH_THE.md` và thư mục bằng chứng); đợt viết tài liệu này **không chạy lại** test nào. Trước khi tin vào một dòng, chạy lại lệnh ở cột "Chạy lại".

## 1. Đã kiểm

| # | Phạm vi | Nhãn | Kết quả ghi nhận | Nơi chứa / chạy lại |
|---|---|---|---|---|
| 1 | gym-service: workflow bản sửa, tiện ích, upload, tương thích app cũ, hiển thị công khai, khóa đường cũ, đọc Admin | BACKEND INTEGRATION | Lượt 20/10 (commit `3271ab09`): 617 bài, 597 qua, 1 lỗi môi trường (retry-pay, không thuộc Listing) | `backend/services/gym-service/src/__tests__/listing-b1-*`, `listing-b2-*`, `listing-b3-*`, `listing-d1-admin-read`, `amenity-facility-contract.test.ts` |
| 2 | user-service: workflow bản sửa PT, DTO công khai, upload ảnh, khóa gói, đọc Admin, schema | BACKEND INTEGRATION | 3 bộ nền C1: 15/15; lượt C1+C2 18/10 (`12ad5522`): 833 bài, 698 qua, 3 lỗi không liên quan Listing | `backend/services/user-service/src/__tests__/pt-listing-*.test.ts`, `pt-media-s3-public-via-request.test.ts` |
| 3 | Mobile PT: đọc/ghi Tin đăng qua gateway thật | REAL HTTP/API | **17/17** | `frontend/mobile/e2e/ptListing.e2e.ts` (`npx tsx --test e2e/ptListing.e2e.ts`); log `_warroom/evidence/listing-J/ptListing.out.txt` |
| 4 | Mobile chủ gym: Tin đăng chi nhánh, tiện ích, ảnh | REAL HTTP/API | **27/27** ở 2 lượt với 2 tài khoản chủ gym khác nhau (`gymListing-le-hoang-thanh`, `gymListing-van-bao-hanh`); lượt đầu `gymListing.out.txt` chỉ 17 qua + 10 bỏ qua (tài khoản có bản mở) | `frontend/mobile/e2e/gymListing.e2e.ts`; log `_warroom/evidence/listing-J/gymListing*.out.txt` |
| 5 | Phase J web: Client / PT / Owner / Admin ở 360, 390, 1280 | REAL BROWSER | qua; sửa BUG-1 (Vite chưa proxy bucket ảnh PT) và BUG-2 (Tìm PT thiếu "Xem thêm") — commit `f0d9812c` | `_warroom/evidence/listing-J/` (ảnh chụp, `*-checks.json`, `dump-*.txt`) |
| 6 | Phase E1 web (đợt đầu 23/10): 0 lỗi sản phẩm | REAL BROWSER | qua | `_warroom/evidence/listing-E1/` |
| 7 | Playwright spec 21 (PT) | REAL BROWSER | **7/7** | harness `D:\fitnessassistant-playwright-e2e` (ngoài git) |
| 8 | Playwright spec 31 (vòng đời đối tác gym, **viết lại** theo luồng tự đăng ký) | REAL BROWSER | **26/26** (4 lượt) | cùng harness; log `_warroom/evidence/listing-J/spec31-run{1..4}.txt` |
| 9 | Playwright spec 03 (chạy cùng lượt với 21/31) | REAL BROWSER | 18/18 (`verdict READY, FAIL=0`) | `_warroom/evidence/listing-J/harness-spec-03-21-31.txt` |
| 10 | Maestro, 7 luồng: PT sửa→gửi duyệt (+đăng nhập lại còn "Chờ duyệt"), giới hạn 5 ảnh + đổi thứ tự, chủ gym tiện ích/đề xuất/ảnh thứ 21 bị từ chối, hồ sơ mở lại tới bước Tiện ích, bản cần sửa, bị từ chối, Client tìm + xem chi tiết | REAL DEVICE (ASUS ROG, Android 12) | **7/7**, bản **release cài 24/10**, chạy 29/10; 0 lỗi Listing | `frontend/mobile/.maestro/listing/README.md`; `_warroom/evidence/mobile-listing/` |
| 11 | db-clean (audit, manifest, freeze, backup, clean, verify, unfreeze) | BACKEND INTEGRATION (container test cô lập) | **14/14** | `node --test --test-concurrency=1 scripts/db-clean/__tests__/db-clean.test.mjs` |
| 12 | db-clean chạy thật trên dev (H0–H4 PASS, có sao lưu + thử khôi phục) | thao tác DB trực tiếp theo manifest đã duyệt; riêng bước đăng nhập H4 là REAL HTTP/API | PASS | `_warroom/evidence/db-clean-G5/`, `db-clean-H*/` |
| 13 | Seed: `verify-integrity` sau lần chạy thật trên 7 DB `*_seedrun` | REAL HTTP/API + DB | **11/11**; chạy lại `--reseed` ghi 0 dòng nghiệp vụ | `_warroom/evidence/seed-live/REPORT.md`, `integrity-final.log` |
| 14 | Seed: tầng 1 + planners, guard, payload với zod thật | TEST FIXTURE / CODE AUDIT chạy thành test | 61 qua / 0 lỗi / 8 bỏ qua (lúc nghiệm thu 23/10) | `scripts/seed-marketplace/__tests__/` |
| 15 | Lượt viết lại tài liệu F: đối chiếu route, trạng thái, giới hạn, DTO với code | CODE AUDIT | không chạy test | 6 tệp trong thư mục này |

Thông tin chi tiết bất thường:
- Dòng 3–4 tự bỏ qua test ghi nếu PT/chủ gym đang có bản mở (không đụng việc dang dở) và bỏ qua test upload khi không với tới được URL S3 ký sẵn — kiểm số "bỏ qua" trong log khi trích dẫn.
- Dòng 8 cần `PARTNER_APPLICATION_DEV_ECHO` bật tạm; đã tắt và xác nhận `printenv` = `false` (xem [SEED](SEED.md) §4).
- Dòng 10 không bao gồm các thay đổi từ commit `78eba2a5` (xem §2).

## 2. Chưa kiểm / còn thiếu

| Mục | Tình trạng | Việc cần làm |
|---|---|---|
| Maestro trên bản build có commit `78eba2a5` (giao diện tiếng Việt toàn bộ, lịch tháng đặt buổi) | **Chưa**. Bằng chứng 7/7 là của bản release 24/10, trước commit này | Dựng build mới, chạy lại 7 luồng |
| Playwright spec 33 / 34 / 35 | **Chưa viết** (đã chốt 26/10: không viết trong đợt này) | Viết khi có yêu cầu |
| Hợp đồng PT `COMPLETED` và đánh giá buổi tập trong dữ liệu seed | **Không seed được** — không có API để lùi thời gian; ghi SQL cần khớp sổ cái payment-service | Chờ quyết định về cách tạo lịch sử; các màn dùng lịch sử này chưa có dữ liệu mẫu để kiểm bằng seed |
| Chạy lại toàn bộ test user-service / gym-service sau các commit gần đây | **Chưa** làm trong đợt này; con số ở dòng 1–2 là của lượt cũ | Chạy trên DB `*_test` cô lập (`gymcoach_<svc>_lm_test`, cổng 55433), ghi rõ bộ nào chạy |
| Thiết bị khác ROG (ví dụ iOS), build debug | Chưa | — |
| Trễ làm mới giữa thiết bị (React Query `staleTime` 30 giây) | Hạn chế đã biết, không phải lỗi | Xem ARCHITECTURE §7 |

## 3. Cách đọc nhãn khi trích

- Nói "đã qua X/Y" kèm **nhãn** và **bản build/commit** của thứ được kiểm; con số không có nhãn không được dùng làm bằng chứng nghiệm thu.
- Dữ liệu seed là `TEST FIXTURE` cho đến khi một luồng người dùng thật (trình duyệt/thiết bị) đi qua nó.
- Bằng chứng nằm trong `_warroom/evidence/` có thể không được commit; coi nó là ghi chép của người chạy, không phải đảm bảo của repo.
