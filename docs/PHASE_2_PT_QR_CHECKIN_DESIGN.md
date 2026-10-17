# Phase 2 — PT QR Check-in: khảo sát và thiết kế

Ngày 18/10/2026. Trạng thái: **DISCOVERY/DESIGN — chưa code, chưa migration, chưa commit.** Người duyệt: Owner.
Nguồn: `CODE AUDIT` mã tại HEAD `ca94f4e` (đã đối chiếu lại các điểm chính), cùng `docs/GYM_PT_BRAND_PARTNERSHIP_AUDIT.md` mục G–K (11/10, viết trước Phase 2.5/3 — chỉ dùng phần còn đúng). Quyết định đã có: D16, D17, D18 (`_warroom/decisions/LOG.md`).

---

## 0. Điểm phải chốt trước tiên: QR đại diện cho cái gì, ai quét

Yêu cầu lượt này mô tả luồng "PT → QR → **khách quét**". Quyết định đã chốt **D16** lại là: *"Không sinh mã cho PT hay từng buổi; **PT quét QR của chi nhánh**, server quyết định"*, và **D17**: *"PT vào được trong ngày có ít nhất một buổi trực tiếp đã xác nhận tại chi nhánh đó."* Hai cách hiểu cho ra hai sản phẩm khác nhau:

| | **Mô hình X — vào cửa phòng gym (D16/D17, đã chốt)** | **Mô hình Y — điểm danh buổi tập (cách hiểu mới)** |
|---|---|---|
| QR | QR **chi nhánh** (đã có, chủ gym in/hiển thị) | QR do **PT** tạo cho buổi/hợp đồng |
| Ai quét | **PT** | **Khách** |
| Mục đích | Cho PT vào phòng gym để dạy khách có buổi hôm đó | Chứng minh buổi tập đã diễn ra |
| Đụng tiền? | **Không.** Chỉ đọc buổi tập; không đổi trạng thái buổi, bộ đếm, sổ cái | **Có.** Muốn có ý nghĩa thì phải nối vào hoàn thành buổi → giải phóng tiền |
| Rủi ro F1/F2/F3 | Không có (không ghi gì sang user-service) | Có: thêm một đường ghi trạng thái buổi cạnh `completeSession` / `claimDelivery` |

**Khuyến nghị:** làm **Mô hình X** đúng D16/D17 cho Phase 2. Mô hình Y là quy tắc nghiệp vụ mới có đụng tiền → theo D69 phải để Owner quyết riêng, không tự làm. Toàn bộ phần dưới thiết kế cho X; mục C có ghi chú ca nào sẽ khác nếu Owner chọn Y.

---

## A. Luồng hiện tại và khoảng trống

### A.1 Đã có (`CODE AUDIT`)
- **QR chi nhánh:** `GET /owner/gyms/:gymId/checkin-qr` (`gym-service/src/routes/owner.routes.ts:156`) → `checkinService.getGymQr` (`checkin.service.ts:53`). Token ký, hạn mặc định **365 ngày** (`GYM_QR_TTL_DAYS`, `utils/checkinToken.ts:19`), không gắn ngày, không gắn vị trí.
- **Quét:** `POST /me/gym-checkins` (`client.routes.ts:43`) mở cho cả vai trò CUSTOMER và PT, nhưng `checkInByGymToken` (`checkin.service.ts:69`) **chỉ có đường hội viên**: không có gói → `NO_MEMBERSHIP` (`:97`). Tức là hôm nay **PT không check-in được** (trừ khi PT tự có gói hội viên, và khi đó bị trừ lượt như khách).
- **Bản ghi:** `GymCheckIn` (`gym-service/prisma/schema.prisma:1109-1122`): `membershipId` bắt buộc, `clientId`, `checkedInBy`, `createdAt`. Không có cột cho PT, không có cột ngày địa phương, không có ràng buộc duy nhất.
- **Chống quét đúp hội viên:** 60 giây theo `membershipId` (`checkin.service.ts`, mục TOO_SOON).
- **Giao diện:** mobile `app/client/services/checkin.tsx` + `src/features/services/checkin.ts` (khách quét), `app/gym-owner/checkin-qr.tsx` (chủ gym hiện QR + 20 lượt gần nhất); web `components/gym/CheckinScanModal.tsx`, `GymCheckinPanel.tsx`, `pages/gym-owner/GymOwnerDashboard.tsx`. **Khu vực PT (`app/pt/*`, web PT pages) không có lối vào quét mã.**
- **Buổi tập (user-service):** khách đặt (`bookSession`), PT xác nhận (`confirmSession`) → `CONFIRMED`; sau `scheduledEndAt` PT báo xong (`completeSession`, `booking.service.ts:554`) → `PENDING_CLIENT_CONFIRMATION`; khách xác nhận / tự xác nhận → `COMPLETED` qua `claimDelivery` (CAS) và ý định quyết toán `SESSION_RELEASE` (Giai đoạn 0). `Session` không có `gymId`; chi nhánh lấy từ `Contract.gymId`.
- **Hạn chế PT:** `getEffectiveContractStatus(es)`, `isContractRestricted` (`pt-restriction.service.ts:275, 289, 383`); internal `GET /internal/pt/:ptUserId/restriction` (`internal.routes.ts:97`).
- **Thứ không đọc `GymCheckIn`:** chi trả, giải phóng tiền, khiếu nại, đánh giá (audit J.1). **Check-in hiện không chạm tiền.**

### A.2 Chưa có
1. Đường check-in cho PT ở gym-service (bảng riêng + logic).
2. API nội bộ ở user-service trả "các buổi đủ điều kiện của PT X tại chi nhánh G trong ngày D".
3. Quy tắc "ngày D" theo múi giờ cố định (`Asia/Ho_Chi_Minh`), không phụ thuộc `TZ` tiến trình.
4. Lối vào quét mã cho PT trên web và mobile; danh sách PT check-in cho chủ gym.
5. Mã lỗi cho PT (và sửa thiếu sót cũ: `GYM_NOT_ACTIVE` chưa có trong `CODE_STATUS` của `checkin.controller.ts`).

---

## B. Quan hệ với Phase 2.5/3 và invariant tiền

Chuỗi: **Contract → Session → (Check-in PT) → Session completion → Settlement.**

Với Mô hình X, check-in PT là **nhánh chỉ-đọc bên cạnh** chuỗi, không phải một mắt xích:

```
Contract(ACTIVE) ── Session(CONFIRMED) ── completeSession ── claimDelivery(CAS) ── SESSION_RELEASE ── ledger
                          │
                          └──(đọc)── PT check-in (gym-service, bảng riêng) — không ghi ngược
```

Invariant được giữ bằng cấu trúc:
- gym-service **không gọi** bất kỳ API ghi nào của user-service hay payment-service; chỉ gọi một API đọc mới.
- Không thay đổi `Session.status`, `usedSessions`, `compensatedSessions`, `releasedTo*`, settlement rows, sổ cái.
- Không thêm điều kiện mới vào `completeSession`/`clientConfirmSession` (nếu thêm — ví dụ "chỉ được báo xong khi đã check-in" — là quy tắc mới đụng tiền → cần Owner).

Quy tắc đã chốt phải được API đọc tôn trọng:
- **Hạn chế theo hợp đồng (D38):** An–Bình bị hạn chế → buổi của Bình **không** tính; buổi của Chi vẫn tính → An vẫn vào gym dạy Chi (yêu cầu tương thích đã ghi ở `PHASE_2_5A_BO_SUNG_11-10.md`).
- **Hạn chế tài khoản / cấm vĩnh viễn:** không buổi nào tính → không check-in huấn luyện.
- **Hợp đồng đang kết thúc (`CONTRACT_ENDING`, D59) hoặc đã kết thúc:** buổi chưa diễn ra đã/sẽ bị hủy theo F1 → không tính (đề xuất; xem quyết định Q-E).
- **Gym đóng / đối tác bị khóa:** check-in hiện đã chặn theo trạng thái chi nhánh (`checkin-gym-status-guard`); giữ nguyên.

**Kết luận B:** Mô hình X **không ảnh hưởng tiền** → không cần dừng. Mô hình Y **có** ảnh hưởng tiền → dừng, chờ Owner.

---

## C. Chống gian lận, idempotency, race (Mô hình X)

Thiết kế lõi:
- Bảng mới `gym_pt_check_ins` (gym-service): `id, gym_id, brand_id, pt_user_id, local_date DATE, first_scan_at, last_scan_at, scan_count, qualifying_session_ids TEXT[], contract_ids TEXT[], basis, created_at`; **UNIQUE (gym_id, pt_user_id, local_date)** — một bản ghi mỗi PT mỗi chi nhánh mỗi ngày (khuyến nghị cho Q17).
- Ghi bằng `INSERT … ON CONFLICT (gym_id, pt_user_id, local_date) DO UPDATE SET last_scan_at, scan_count = scan_count + 1 RETURNING *` → quét lại / quét đồng thời luôn ra **một** bản ghi, phản hồi giống nhau.
- Quyết định "cho vào" chỉ dựa trên kết quả API đọc tại thời điểm quét; user-service không phản hồi → **từ chối có mã** `PT_SESSION_CHECK_UNAVAILABLE` (khuyến nghị cho Q16), không bao giờ coi là "không có buổi".

| # | Tình huống (theo yêu cầu) | Xử lý trong X | Ghi chú nếu chọn Y |
|---|---|---|---|
| 1 | Quét QR của "PT khác" | QR là của chi nhánh, không có QR của PT. PT quét QR chi nhánh khác → chỉ được vào nếu có buổi đủ điều kiện **tại chính chi nhánh đó** (hợp đồng `gymId` = chi nhánh). Lỗi `PT_NO_QUALIFYING_SESSION` | Phải kiểm QR gắn đúng PT của hợp đồng |
| 2 | Không có hợp đồng ACTIVE | Không có buổi đủ điều kiện → từ chối | Từ chối |
| 3 | Có hợp đồng nhưng không có buổi hôm đó | Từ chối (D17: phải có buổi trực tiếp đã xác nhận trong ngày) | Từ chối |
| 4 | Quét hai lần | Cùng bản ghi ngày (UPSERT), `scan_count` tăng, phản hồi 200 như lần đầu | Idempotency theo buổi |
| 5 | Hai thiết bị cùng quét | Ràng buộc UNIQUE + ON CONFLICT → một bản ghi; cả hai nhận cùng kết quả | Như trên |
| 6 | Ảnh chụp QR dùng sau / từ xa | **Hở hiện tại:** QR chi nhánh sống 365 ngày, không gắn vị trí. Chỉ tạo ra lượt check-in "vô hại về tiền", nhưng làm sai dữ liệu vào cửa. Phương án: (a) giữ như hội viên (chấp nhận); (b) QR xoay vòng ngắn hạn hiển thị tại quầy; (c) kiểm vị trí thiết bị; (d) lễ tân quét. Xem Q-A | Ảnh chụp = điểm danh giả → **giải phóng tiền giả** — rủi ro lớn |
| 7 | QR bị chia sẻ cho người khác | QR chi nhánh vốn công khai trong gym; người khác quét chỉ qua được nếu chính họ là PT có buổi tại đó (xác thực bằng tài khoản đăng nhập, không bằng QR) | Chia sẻ = điểm danh hộ |
| 8 | PT tạo nhiều QR | Không áp dụng (PT không tạo QR, D16) | Phải giới hạn |
| 9 | PT bị hạn chế/bị cấm nhưng "QR còn" | Quyền vào tính tại thời điểm quét qua `getEffectiveContractStatuses`: tài khoản bị hạn chế → từ chối `PT_RESTRICTED`; chỉ hợp đồng An–Bình bị hạn chế → chỉ buổi của Bình không tính | Như trên + chặn điểm danh |
| 10 | Check-in đúng lúc hợp đồng kết thúc | Hai thứ tự đều xác định: quét trước → bản ghi lưu buổi làm căn cứ, sau đó F1 hủy buổi, **không tiền nào đổi**; kết thúc trước → buổi đã hủy/không còn đủ điều kiện → từ chối. Không cần khóa vì gym-service không ghi sang user-service | Cần khóa hợp đồng như F4 |
| 11 | Check-in đúng lúc PT hủy/báo vắng | Như 10: bản ghi check-in giữ căn cứ tại thời điểm quét; hủy/báo vắng đi đường tiền hiện có (`withRunningContract`). Tín hiệu bất thường cho chủ gym (audit K.4, Q19) | Phải xử lý xung đột trạng thái buổi |
| 12 | Mất mạng sau khi check-in | Gửi lại → UPSERT trả về đúng bản ghi cũ (khóa tự nhiên `gym+PT+ngày`), không cần idempotency-key riêng | Cần idempotency-key |

**Không tạo biến thể F1/F2/F3** vì: không có đường ghi trạng thái buổi mới, không đọc-rồi-ghi qua hai dịch vụ, và khóa duy nhất của bản ghi check-in là tự nhiên (không phụ thuộc client).

Lạm dụng còn lại (audit K.2, không chạm tiền): PT + khách thông đồng đặt buổi để PT vào gym; check-in xong rồi dời buổi sang ngày khác (một buổi cho nhiều ngày vào cửa). Giảm thiểu đề xuất: lưu `qualifying_session_ids`; một buổi đã làm căn cứ cho ngày D không làm căn cứ cho ngày khác sau khi dời (Q-B). Chỉ là quy tắc vào cửa, không đổi tiền.

---

## D. Ảnh hưởng tài chính — ví dụ

Hợp đồng 5.000.000đ, 10 buổi, tỷ lệ chụp lúc ký 70/20/10 (dữ liệu ví dụ) → mỗi buổi 500.000đ = PT 350.000 / chi nhánh 100.000 / nền tảng 50.000. Lúc thanh toán: ký quỹ 5.000.000; PT chờ 3.500.000; chi nhánh chờ 1.000.000; nền tảng chờ 500.000 (đã đo ở P3.7/P3.6).

| Sự kiện của buổi 1 | Trạng thái buổi | Tiền (theo cơ chế HIỆN CÓ) | Check-in PT làm gì với tiền |
|---|---|---|---|
| PT quét QR chi nhánh lúc 08:00 | `CONFIRMED` (không đổi) | Không đổi | **Không gì** |
| PT báo xong sau giờ kết thúc | `PENDING_CLIENT_CONFIRMATION` | Không đổi | Không gì |
| Khách xác nhận (hoặc tự xác nhận) | `COMPLETED` | Giải phóng phần của buổi: PT 350.000, chi nhánh 100.000, nền tảng 50.000 từ chờ sang dùng được (SESSION_RELEASE, áp một lần) | Không gì |
| PT bị hạn chế riêng hợp đồng này trước khi khách xác nhận | Giữ nguyên/đi theo quy tắc lát 4–5 (tạm dừng tự xác nhận D53) | Theo cơ chế hiện có | Check-in các ngày sau cho hợp đồng này bị từ chối; hợp đồng khác của PT không ảnh hưởng |
| Hợp đồng kết thúc khi buổi đang chờ xác nhận | Giữ làm buổi treo (F2) | 500.000 giữ riêng tới khi xác nhận/phân xử | Không gì |

**Không có quy tắc tài chính mới.** Mọi dòng tiền là của Phase 2.5/3 đã nghiệm thu.

---

## E. Kế hoạch theo tệp (cho implementation sau, Sonnet)

### gym-service
| Tệp | Việc | Lý do |
|---|---|---|
| `prisma/schema.prisma` + migration mới | Model `GymPtCheckIn` (bảng `gym_pt_check_ins`), UNIQUE `(gym_id, pt_user_id, local_date)` | Tách khỏi `GymCheckIn` (audit J.2 lựa chọn 2): không làm sai thống kê hội viên, không chạm `gym_membership_contracts` |
| `src/services/pt-checkin.service.ts` (mới) | Xác thực token chi nhánh, tính ngày D, gọi user-service, UPSERT, trả kết quả | Không sửa đường hội viên |
| `src/services/checkin.service.ts` | Chỉ thêm điểm rẽ theo vai trò (PT → `ptCheckinService`) — hoặc tuyến riêng | Giữ nguyên hành vi hội viên |
| `src/controllers/checkin.controller.ts` | Mã lỗi PT (`PT_NO_QUALIFYING_SESSION`, `PT_RESTRICTED`, `PT_SESSION_CHECK_UNAVAILABLE`) + bổ sung `GYM_NOT_ACTIVE` vào `CODE_STATUS` | Lỗi có mã rõ |
| `src/clients/user.client.ts` | Hàm gọi API đọc mới, timeout 3s, nhánh Lambda theo khuôn `lambda-http.client.ts` | Theo quy ước H.2 |
| `src/utils/local-day.ts` (mới) | Ngày D theo `Asia/Ho_Chi_Minh` bằng `Intl.DateTimeFormat` | Không phụ thuộc `TZ` |
| `src/routes/client.routes.ts` | Dùng lại `POST /me/gym-checkins` (rẽ theo vai trò) hoặc thêm `POST /me/pt-gym-checkins` | Q-C |
| `src/repositories/checkin.repository.ts` + owner route | Danh sách PT check-in cho chủ gym (không lộ danh tính khách) | Q19 |

### user-service
| Tệp | Việc |
|---|---|
| `src/routes/internal.routes.ts` | `GET /internal/pt/:ptUserId/gym-sessions?gymId&from&to` → `{ ptActive, sessions:[{sessionId, contractId, status, scheduledStartAt, scheduledEndAt}] }`, chỉ đọc |
| `src/repositories/session.repository.ts` | Truy vấn buổi `OFFLINE` của PT tại `contract.gymId = G`, giao khoảng `[from,to)`, trạng thái theo Q14 |
| dùng lại `pt-restriction.service.ts` (`getEffectiveContractStatuses`) và trạng thái `CONTRACT_ENDING` | Loại hợp đồng bị hạn chế / đang kết thúc — **không sửa** các tệp tiền |

### Web / Mobile
- Mobile: thêm lối vào quét cho PT trong `app/pt/` (dùng lại camera của `app/client/services/checkin.tsx`), thẻ kết quả PT không có số lượt (`src/features/services/checkin.ts`); `app/gym-owner/checkin-qr.tsx` thêm danh sách PT.
- Web: lối vào quét cho PT (dùng lại `CheckinScanModal.tsx`); `GymCheckinPanel.tsx` / `GymOwnerDashboard.tsx` tách PT khỏi hội viên.
- Cần Owner cho phép sửa UI khi triển khai.

### Migration
Có: một bảng mới ở gym-service (bổ sung, không đụng bảng cũ). Không migration ở user-service/payment-service.

### Kiểm thử
- Có sẵn, phải giữ xanh: `checkin-exhausts-visits-expires-membership`, `checkin-gym-status-guard`, `membership-eligibility`, các bộ tiền Phase 2.5/3 (`cross-service-money*`, `phase3-flow`, `contract-race-family`).
- Cần thêm: tích hợp gym-service (PT có/không có buổi, sai chi nhánh, quét lại, 10 quét đồng thời → 1 bản ghi, user-service sập → 503 có mã, ngày D quanh nửa đêm); tích hợp user-service (API đọc: hạn chế theo hợp đồng chỉ loại đúng hợp đồng, hạn chế tài khoản loại hết, `CONTRACT_ENDING`/đã kết thúc không tính); liên dịch vụ thật (gym + user) và một kiểm thử **khẳng định sổ cái và bảng buổi tập không đổi một byte** sau mọi lần check-in; REAL BROWSER cho màn PT quét (khi có UI).

---

## F. Tiêu chí nghiệm thu (implementation)

- [ ] PT chỉ check-in được tại chi nhánh G khi có ít nhất một buổi trực tiếp đủ điều kiện của hợp đồng `gymId = G` trong ngày D (D17).
- [ ] Không có hợp đồng ACTIVE / không có buổi hôm đó / buổi ở chi nhánh khác → từ chối có mã.
- [ ] Hạn chế theo hợp đồng An–Bình chỉ loại buổi của Bình; An vẫn check-in dạy Chi (D38).
- [ ] Hạn chế tài khoản / cấm → không check-in huấn luyện.
- [ ] Hợp đồng đang kết thúc hoặc đã kết thúc → buổi của nó không làm căn cứ.
- [ ] Quét lại, quét đồng thời, gửi lại sau mất mạng → đúng **một** bản ghi mỗi PT/chi nhánh/ngày, phản hồi giống nhau.
- [ ] user-service không phản hồi → 503 `PT_SESSION_CHECK_UNAVAILABLE`, không ghi bản ghi, không coi là "không có buổi".
- [ ] Ngày D tính theo `Asia/Ho_Chi_Minh` của thời điểm máy chủ nhận, đúng quanh nửa đêm.
- [ ] Check-in PT **không** thay đổi trạng thái buổi, bộ đếm, settlement, sổ cái (kiểm bằng ảnh chụp trước/sau).
- [ ] Đường hội viên không đổi hành vi; thống kê hội viên không đếm PT.
- [ ] Chủ gym thấy PT check-in tách khỏi hội viên, không thấy danh tính khách.
- [ ] Race với kết thúc hợp đồng / PT hủy / khách hủy: kết quả xác định, không tiền nào đổi.
- [ ] Toàn bộ bộ kiểm thử tiền Phase 2.5/3 vẫn xanh.

---

## OPEN BUSINESS DECISIONS (Owner quyết — chưa code)

| Mã | Câu hỏi | Phương án | Khuyến nghị |
|---|---|---|---|
| **Q-M** | Mô hình X (PT quét QR chi nhánh để vào cửa, D16) hay Y (khách quét QR của PT để điểm danh, nối vào hoàn thành buổi) | X / Y / cả hai (Y để sau) | **X** cho Phase 2; Y là quy tắc mới đụng tiền |
| Q14 | Buổi `DISPUTED`/`PT_NO_SHOW_REPORTED` trong ngày có làm căn cứ không; buổi đã `PENDING_CLIENT_CONFIRMATION`/`COMPLETED` sớm có cho vào lại cùng ngày không | Chỉ `CONFIRMED` / cả `PENDING`+`COMPLETED` trong ngày | `CONFIRMED`, `PENDING_CLIENT_CONFIRMATION`, `COMPLETED` trong ngày; loại `DISPUTED`, `PT_NO_SHOW_REPORTED` |
| Q15 | PT vừa có gói hội viên vừa có buổi đủ điều kiện | Ưu tiên đường PT (không trừ lượt) / đường hội viên | Ưu tiên đường PT; không có buổi thì đi đường hội viên |
| Q16 | user-service không phản hồi | Từ chối có mã / cho vào, đánh dấu chưa xác minh | Từ chối có mã (+ bản ghi ngày làm kết quả đã lưu cho lần quét sau) |
| Q17 | Một bản ghi mỗi ngày hay mỗi lần quét | Mỗi ngày (UPSERT) / mỗi lần | Mỗi ngày + `scan_count` |
| Q18 | Múi giờ; buổi vắt qua nửa đêm | `Asia/Ho_Chi_Minh` toàn hệ thống; tính ngày bắt đầu / cả hai ngày | `Asia/Ho_Chi_Minh`; tính cả hai ngày giao khoảng |
| Q19 | Chủ gym xem tín hiệu gì về PT | Chỉ danh sách check-in / thêm tín hiệu K.4 | Danh sách + số ngày check-in so với số buổi hoàn thành; ẩn danh tính khách |
| Q-A | Ảnh chụp QR (365 ngày) | Chấp nhận / QR xoay vòng / vị trí / lễ tân quét | Chấp nhận cho X (không đụng tiền); QR xoay vòng nếu cần chặt hơn |
| Q-B | Buổi đã làm căn cứ rồi bị dời sang ngày khác | Vẫn làm căn cứ ngày mới / không | Không làm căn cứ lần hai |
| Q-C | Dùng lại `POST /me/gym-checkins` hay tuyến mới cho PT | Rẽ theo vai trò / tuyến riêng | Tuyến riêng — tách rõ, ít rủi ro cho đường hội viên |
| Q-E | Buổi của hợp đồng `CONTRACT_ENDING` | Tính / không tính | Không tính |

## Rủi ro và điều chưa xác định
- `TZ` production chưa rõ (audit I.1); thiết kế không phụ thuộc vào nó.
- Mobile/web PT có quyền vào màn quét hiện tại không phụ thuộc cơ chế chuyển hồ sơ (audit, chưa xác minh).
- Production vẫn BLOCKED: Financial Hardening + Security Hardening + xoay credential (gồm chuỗi kết nối DB dev vừa lộ trong transcript).

---

## Checkpoint 17/10/2026 — PHASE 2 (MÔ HÌNH X) FUNCTIONAL SCOPE COMPLETE

Quyết định: D70 (mô hình X, Q14–Q-E), D71 (cách làm, phân loại 🔴/🟡/⚪).

| Lát | Nội dung | Kiểm thử | Nhãn bằng chứng |
|---|---|---|---|
| P2.1 | user-service `GET /internal/pt/:ptUserId/gym-sessions` (chỉ đọc) | 18/18 | BACKEND INTEGRATION |
| P2.2 | gym-service bảng `gym_pt_check_ins` (migration `20261018000000_gym_pt_check_ins`), `POST /me/pt-gym-checkins`, `GET /owner/gyms/:gymId/pt-checkins`, `local-day` | 29/29 (cả TZ=UTC), local-day 7/7, bộ hội viên không đổi | BACKEND INTEGRATION + REAL HTTP/API (user-service giả lập) |
| P2.3 | gateway (PT-only), web + mobile: màn PT quét, danh sách PT cho chủ gym | gateway 5/5; mobile 819/819 đơn vị; web 19/19 + build | BACKEND INTEGRATION / TEST FIXTURE |
| P2.4 | Liên dịch vụ thật user + gym + payment, bất biến md5 toàn hàng | 15/15 ×3 | BACKEND INTEGRATION, sổ cái thật trên DB kiểm thử |
| P2.5 | Web trên trình duyệt thật 360/375/390/412, camera giả phát QR thật | 108/108; bất biến 11/11 bảng | REAL BROWSER |
| Mobile | Android emulator (Pixel_10_Pro_XL), app thật + backend thật | Mọi bước đạt; bất biến 11/11 bảng | REAL EMULATOR UI + REAL HTTP/API; **bước quét được bơm mã vào `onScanned`, camera giải mã chưa kiểm (evidence gap do môi trường)** |

**Bất biến đã chứng minh:** check-in PT không đổi một byte ở sessions, contracts, session_settlements, ví, sổ cái, giao dịch, gói hội viên, check-in hội viên. Sau khi khách xác nhận, giải phóng tiền đúng một lần qua đường hiện có.

**Lỗi đã sửa trong Phase 2 (🟡):** `GYM_NOT_ACTIVE` thiếu trong `CODE_STATUS` (có từ trước); mobile: thẻ "Check-in thành công" cũ còn hiện khi mở lại màn (route ẩn vẫn mounted) → reset khi rời màn; huy hiệu "Đã check-in" lệch trái.

**Backlog (⚪):** QR chi nhánh chụp dùng từ xa (365 ngày) — security weakness của mô hình X; camera giải mã trên emulator/thiết bị thật chưa kiểm; màn 503 chưa chụp; thẻ hợp tác chủ gym hiện mã PT nội bộ (có từ trước); đối tác bị khóa nhưng chi nhánh mở vẫn cho vào (giống đường hội viên, đổi là quy tắc mới).

**Production vẫn là production gate:** Financial Hardening + Security Hardening + xoay credential.

**Cập nhật 17/10 (D72) — camera mobile:** lần thử có giới hạn đã **xác minh camera giải mã QR thật trên Android emulator** (camera ảo virtual-scene, áp phích QR thật của chi nhánh đặt trước camera trong bản sao tài nguyên emulator; không chèn mã, không sửa mã nguồn). Màn PT tự hiện thẻ thành công; quét lại tăng `scan_count` 1→2, `first_scan_at` giữ nguyên. Nhãn: REAL EMULATOR UI + REAL HTTP/API. Chưa kiểm: camera điện thoại thật (góc nghiêng, khoảng cách, thiếu sáng). Bằng chứng: `_warroom/evidence/p2_mobile_camera/RESULTS.md`.
