# Kiểm toán nguồn tiền đền từ ví gộp (AVAILABLE) của PT — điều kiện trước N7 (D48)

Chỉ đọc. Không sửa mã, không ghi DB (chỉ `SELECT` trên DB dev `gymcoach_payment` / `gymcoach_user`, container `gymcoach-postgres`; DB kiểm thử không đụng). Không quyết định: phần xử lý nghĩa vụ cũ là các phương án để Ngài chọn.

Nhãn bằng chứng:
- `CODE AUDIT` — đọc mã trong cây làm việc (có tệp:dòng). Không phải E2E, không chạy gì. Các tệp của user-service đang được agent khác sửa (nhóm F1–F3) nên tại hạ trích theo tên hàm; số dòng chỉ là chỉ dẫn.
- `ĐỌC DB DEV` — câu `SELECT` chỉ-đọc trên DB dev. Là dữ liệu thật của môi trường dev nhưng phần lớn là dữ liệu mồi / dư lượng bộ kiểm thử harness; KHÔNG phải kiểm thử, KHÔNG phải số liệu production.
- `ĐỌC UI/VĂN BẢN` — đọc chuỗi hiển thị hoặc văn bản trong mã frontend/tài liệu.
- Không có nhãn `REAL BROWSER`, `REAL HTTP/API`, `BACKEND INTEGRATION` nào trong tài liệu này.

Liên quan: `docs/PHASE_2_5A_SLICE5_FINANCIAL_HOLD_DESIGN.md` (bản 3), mục 3, 8, 12, 18 (câu 2, 7); `_warroom/decisions/LOG.md` D20–D23, D43, D46–D49.

---

## 0. Kết luận ngắn

| Câu hỏi | Trả lời | Bằng chứng |
|---|---|---|
| Đường mã nào rút tiền đền từ AVAILABLE gộp của PT? | **5 cơ chế** trong payment-service (3 hàm đền/thu hồi + 2 hàm bù/thu nợ), và **3 đường lân cận** của sản phẩm khác (hoa hồng giới thiệu, hoàn dịch vụ cá nhân hoá) dùng cùng cơ chế. Mục 1 | `CODE AUDIT` |
| Khoản đền "quỹ 10%" có rút từ ví gộp không? | **Không.** Đền tự động ở `terminateContract` chỉ lấy từ quỹ của đúng hợp đồng (`min(h×base, quỹ, PT còn được trả)`). Đây là đường đúng N7 | `CODE AUDIT` |
| Điều khoản đã ký / văn bản cho khách và PT có nêu nghĩa vụ đền từ ví gộp, nợ PT, nền tảng ứng không? | **Không tìm thấy.** Không có điều khoản nào của hợp đồng (`Contract.terms` chỉ ghi "Hủy trước 24h không mất phí…"), không có văn bản "Điều khoản dịch vụ" của PT trong kho mã, không có bản ghi nào lưu việc PT đồng ý một điều khoản đền. Chỉ có thông báo SAU khi sự việc xảy ra và một hộp thoại di động nói "bồi thường theo chính sách" TRƯỚC khi PT bấm xác nhận vắng. Mục 2 | `ĐỌC UI/VĂN BẢN` + `CODE AUDIT` |
| Vậy logic tự đền hiện tại có đang thực hiện một nghĩa vụ đã thoả thuận hợp lệ không? | **Không chứng minh được từ bằng chứng trong kho.** Phần "hoàn giá trị buổi chưa dạy bằng tiền của chính buổi đó" có căn cứ trong tài liệu nội bộ và D19; phần "lấy ví gộp / nền tảng ứng / ghi nợ PT" thì không có căn cứ nào hiển thị cho PT. Đây không phải ý kiến pháp lý; cần Ngài/luật sư xác nhận | mục 2 |
| Trên DB dev: có hợp đồng không có quỹ mà vẫn có khoản đền không? | Có: **cả 3 khoản đền vắng (1.200.000đ)** thuộc hợp đồng không có quỹ (không hợp đồng nào có quỹ). Nhưng **cả 3 đều trừ từ PENDING của chính hợp đồng; 0đ từ AVAILABLE gộp**. Mục 3 | `ĐỌC DB DEV` |
| Có hợp đồng ĐANG CHẠY nào còn kích hoạt được đường rút ví gộp? | **1 hợp đồng thật** (`9d2a34ee`, 1.600.000đ) trong điều kiện hẹp (cần buổi sót sau kết thúc, hoặc sổ cái hỏng); 1 hợp đồng mồi (`6db9017a`) không chạm tiền được vì không có giao dịch thanh toán (khoá ngoại). Mục 3.5 | `ĐỌC DB DEV` + `CODE AUDIT` |

---

## 1. Các đường mã rút từ AVAILABLE gộp (payment-service)

`PS` = `backend/services/payment-service/src`, `US` = `backend/services/user-service/src`. Ví PT / gym / REVENUE mỗi bên có MỘT ngăn AVAILABLE gộp mọi hợp đồng; dòng sổ cái mang `transactionId` của hợp đồng gây ra khoản trừ nhưng tiền bị trừ có thể là tiền của hợp đồng khác (sau khi rút, không phân biệt được theo số dư).

### 1.1 Năm cơ chế rút / lấy từ ví gộp

| # | Hàm (`PS/services/contract-ledger.service.ts`) | Nhánh rút từ ví gộp | Thứ tự nguồn | Khoá chống lặp | Ai gọi (user-service, `CODE AUDIT`) |
|---|---|---|---|---|---|
| P1 | `compensateNoShow` (`:563-640`) — hàm `charge` | `:594-603`: vòng `['PENDING','AVAILABLE']`; nhánh AVAILABLE lấy `ops.balance(walletId,'AVAILABLE')` của ví PT, gym, REVENUE | (1) `ownPending(T)` của ví đó → (2) **AVAILABLE gộp** → (3) phần thiếu: `coverShortfall` (`:620-627`) | `PT_NO_SHOW:<sessionId>` | `markNoShow` (PT tự nhận vắng) và `respondToNoShowReport` AGREE; `resolveDispute` `PT_NO_SHOW_CONFIRMED`; `addException` (PT chặn ngày < 24h); `cancelSession` (PT huỷ < 24h); quét đóng phòng ca "PT không vào phòng"; quét thử lại `session-settlement-sweep` |
| P2 | `compensateLateArrival` (`:650-715`) — hàm `charge` | `:675-684`: cùng cấu trúc P1, mức nửa buổi | như P1 | `PT_LATE_ARRIVAL:<sessionId>` | quét đóng phòng, ca PT vào muộn sau thời gian ân hạn |
| P3 | `terminateContract` — kẹp thu hồi PT "đã giải phóng quá" (`settleParty`, nhánh `gap < 0`) | `:1048-1058`: lấy từ `ops.balance(walletId,'AVAILABLE')` của PT/gym/REVENUE, ghi `— over-released, clawed back` | AVAILABLE gộp (đến số có thể) | `CONTRACT_TERMINATE:<contractId>` | `settleContractTermination` (mọi lý do chấm dứt) |
| P4 | `coverShortfall` (`:726-749`) — nền tảng ứng | Trừ **AVAILABLE của ví REVENUE (nền tảng)**, ghi `PartnerReceivable` (nợ PT hoặc gym). Gọi từ: P1 (`:621`), P2 (`:696`), `terminateContract` khi `residue < 0` (`:1127`), `refundUnactivatedContractPayment` (`:347`) | AVAILABLE của REVENUE; nếu REVENUE không đủ → huỷ cả thao tác | cùng khoá của hàm gọi | như P1/P3; hoàn khi hợp đồng không kích hoạt được |
| P5 | `recoverReceivables` (`:780-834`) — thu nợ | Khi PT có khoản GHI CÓ mới vào AVAILABLE (giải phóng buổi, top-up, giải phóng quỹ, giải quyết buổi treo), trừ **từ khoản vừa ghi có** để trả `PartnerReceivable` cũ (của bất kỳ hợp đồng nào) rồi chuyển về REVENUE. Không rút số dư đã có từ trước | Chỉ phần vừa ghi có | trong khoá của hàm gọi | `releaseSession` (`:513`), `terminateContract` (`:1037`), `releasePtHoldback` (`:1225`), `resolveUnresolvedSession` (`:1369`) |

Ghi chú: P4 và P5 là hai nửa của "nền tảng ứng rồi thu nợ PT" (`docs/money-flow.md` §8); đó chính là "nợ PT" và "nền tảng ứng" mà D20/D22/D48 cấm. P5 thu nợ từ thu nhập hợp đồng KHÁC của PT (không phải tiền của hợp đồng gây nợ).

### 1.2 Ba đường lân cận (cùng cơ chế, KHÁC sản phẩm — ngoài phạm vi N7 nhưng cùng mã nên được liệt kê)

| # | Hàm | Nhánh | Ghi chú |
|---|---|---|---|
| A1 | `PS/services/membership-ledger.service.ts` — hoa hồng giới thiệu, hàm chuyển hoa hồng gym → PT (khoảng `:60-100`) | thiếu thì `coverShortfall` rồi ghi có cho PT từ tiền nền tảng ứng (`:88-99`) | Là tiền CỘNG cho PT chứ không phải trừ PT; nợ ghi vào GYM |
| A2 | Cùng tệp — thu hồi hoa hồng khi gói hội viên bị huỷ (khoảng `:140-190`) | PENDING của PT dưới giao dịch → rồi **AVAILABLE gộp của PT** (`:164-171`) → rồi `PartnerReceivable` nợ PT (`:176-190`) | Là "rút ví gộp + nợ PT" cho sản phẩm hội viên |
| A3 | `PS/services/personalized-service-ledger.service.ts` — `refundOrder` (khoảng `:150-215`) | PENDING của đơn → **AVAILABLE gộp** của PT/REVENUE → `coverShortfall` | Hoàn đơn dịch vụ cá nhân hoá |

### 1.3 Các đường KHÔNG rút ví gộp (để phân biệt)

| Đường | Nguồn | Ghi chú |
|---|---|---|
| Đền tự động ở `terminateContract` cho `PT_CANCELLED`, `PT_BANNED`, `PT_REPEATED_NO_SHOW` (`:992-1000`, `:1107-1113`) | **Quỹ của đúng hợp đồng** (`reserve`), `min(h×base, quỹ, PT còn được trả)`; không AVAILABLE, không ứng, không nợ | Đúng N7 về nguồn. Xung đột N3/N8 là chuyện khác (thiết kế bản 3, mục 8, 9) |
| Phần của P1/P2 lấy từ `ownPending(T)` | PENDING của chính hợp đồng (chính phần chưa kiếm của buổi đó) | Cả 3 khoản đền vắng trên dev thuộc loại này |
| `refundUnactivatedContractPayment` — rút `ownPending` | PENDING của chính giao dịch | Chỉ nhánh bù thiếu (P4) mới ra ngoài |
| `releaseSession`, `resolveUnresolvedSession` | PENDING → AVAILABLE, không trừ ví gộp | — |
| Đường admin hoàn tiền `POST /admin/payments/:id/refund` (`PS/routes/admin.routes.ts:160-206`) | Cần `payerWalletId`/`receiverWalletId`; giao dịch cổng của hợp đồng PT KHÔNG có hai trường này (`ĐỌC DB DEV`: giao dịch `864ede79…` cả hai NULL) nên trả 400 `NOT_REFUNDABLE` | Không giao với hợp đồng PT |

### 1.4 Ví dụ bằng đồng (mã hôm nay, `TÍNH TAY`)

Hợp đồng X: 4.000.000đ, 8 buổi (mỗi buổi 500.000đ = PT 450.000 + nền tảng 50.000). Hợp đồng đã kết thúc, PENDING của X đã về 0. Còn một buổi `CONFIRMED` sót trên X (lỗi nhóm F1). PT chặn đúng ngày đó < 24h (`addException`): `compensateNoShow` chạy.
- Khách nhận **500.000đ** (một dòng `— compensation for a missed session`).
- PT bị trừ 450.000: PENDING(X) = 0 → trừ **AVAILABLE gộp của PT** 450.000 — đó là tiền kiếm từ hợp đồng Y của PT, không liên quan X.
- Nền tảng bị trừ 50.000: PENDING(X) của REVENUE = 0 → trừ **AVAILABLE của REVENUE** 50.000.
- Nếu AVAILABLE của PT chỉ có 100.000: lấy 100.000, phần 350.000 còn lại nền tảng ứng (`coverShortfall`) và ghi `PartnerReceivable` 350.000 nợ PT; về sau 350.000 bị trừ dần từ thu nhập mới của PT (P5).
Đối chiếu N7 (D48): không có quỹ nào của X liên quan; khoản "đền" là tiền của hợp đồng Y và/hoặc nền tảng ứng và/hoặc nợ PT — ba điều bị bác.

---

## 2. Điều khoản và văn bản hiển thị nói gì về việc đền

Mục tiêu: xác định khoản tự đền hiện tại có phải nghĩa vụ đã được thoả thuận hợp lệ với khách và với PT không. Đây là kiểm tra bằng chứng trong kho, KHÔNG phải ý kiến pháp lý.

### 2.1 Điều khoản hợp đồng (snapshot lưu theo hợp đồng)

| Nguồn | Nội dung | Nói gì về đền |
|---|---|---|
| `Contract.terms` (cột `terms`, `US/prisma/schema.prisma`; sao từ gói dịch vụ của PT: `US/services/contract.service.ts` ~`:220-653`; cho sửa ở `EDITABLE_FIELDS` ~`:1195`) | `ĐỌC DB DEV`: 1.800 hợp đồng mang đúng một chuỗi **"Hủy trước 24h không mất phí. Chỉnh lịch linh hoạt theo thỏa thuận."**; 0 hợp đồng nào có chữ "bồi thường", "giữ lại", "compensat", "holdback" hoặc "10" | **Không nói gì** |
| Các cột chụp theo hợp đồng: `platform_rate`, `pt_rate`, `gym_rate`, `pt_holdback_rate` | `pt_holdback_rate` hiện tại luôn 0 (và dev chưa áp migration cột này) | Chỉ có tỷ lệ chia; không có điều khoản đền |
| Ký điện tử (`esign_*`, `contract_pdf_path`) | Nội dung PDF do dịch vụ ký sinh; không tìm thấy mẫu văn bản đền trong mã | Không thấy |

### 2.2 Văn bản hiển thị cho khách

| Nơi (`ĐỌC UI/VĂN BẢN`) | Câu chữ | Ý nghĩa |
|---|---|---|
| `frontend/web/src/app/pages/client/ContractPage.tsx` ~`:665-680` — khối "Terms" | "Sessions must be booked at least 24 hours in advance"; "Cancellations within 24 hours will count as a used session"; "Contract auto-expires on end date…" | Không nói PT vắng thì khách được gì |
| `ContractPage.tsx` ~`:781` | "Hủy sẽ áp dụng phí hủy 10% trên…" | Nói về phí khách huỷ |
| `frontend/web/.../WalletPage.tsx` ~`:72, :94`; `frontend/mobile/app/client/profile/wallet.tsx:105` | "Refunds and no-show compensation land here"; ví chỉ rút được tiền "hoàn trả và bồi thường" | Nói chỗ tiền bồi thường đến; không nói bồi thường bao nhiêu, từ đâu |
| Thông báo khi PT vắng (`US/services/booking.service.ts`, `room-close-resolution.service.ts`) | "Huấn luyện viên vắng mặt. Bạn được hoàn tiền một buổi vào ví và buổi tập không bị trừ." | Hứa **một buổi** (đúng `unit`), sau khi sự việc xảy ra |
| Thông báo đến muộn | "…bạn được bồi thường một phần vào ví, buổi tập không bị trừ." | Hứa "một phần", không nêu số |

### 2.3 Văn bản hiển thị cho PT

| Nơi (`ĐỌC UI/VĂN BẢN`) | Câu chữ | Trước hay sau hành động | Ghi chú |
|---|---|---|---|
| `frontend/web/.../pages/client/PTApplicationPage.tsx:2449-2450` (hộp chọn bước cuối hồ sơ) | "Tôi đồng ý với Điều khoản dịch vụ và Quy tắc ứng xử của Huấn luyện viên Gymnini." | Trước (khi đăng ký) | Chỉ là hộp chọn bật nút gửi. Không tìm thấy trang/văn bản "Điều khoản dịch vụ" hay "Quy tắc ứng xử" nào trong `frontend/web` hoặc `frontend/mobile` để hộp chọn này trỏ tới. Cụm từ chỉ xuất hiện ở hộp chọn |
| `frontend/mobile/src/features/ptApplication/PTApplicationWizard.tsx:56` | "Tôi đồng ý với điều khoản dành cho Huấn luyện viên của Gymini." | Trước | như trên |
| Backend | `ĐỌC mã`: không có trường nào lưu việc đồng ý (`termsAgreed` không xuất hiện trong `backend/`); `US/services/pt-holdback-rate.ts:14-17` ghi rõ "the terms-acceptance feature that decides that does not exist yet" | — | Không có bằng chứng lưu rằng PT nào đã chấp nhận điều khoản nào |
| `frontend/mobile/app/pt/schedule.tsx:200` — hộp thoại "Xác nhận bạn vắng buổi này?" | "Hệ thống sẽ bồi thường cho học viên theo chính sách. Không thể hoàn tác." | **Trước** hành động (PT đồng ý khách báo vắng) | Duy nhất nơi báo trước; "theo chính sách" không được định nghĩa ở đâu trong giao diện; không nêu số tiền, nguồn tiền |
| `frontend/web/.../pt/PTSchedulePage.tsx` ~`:292, :331` | "Đã xác nhận vắng mặt — khách sẽ được bồi thường"; "Date blocked — N session(s)… cancelled and the client(s) compensated" | **Sau** hành động | Thông báo kết quả |
| `frontend/web/.../pt/PTContractsPage.tsx` ~`:1015` (hộp thoại PT huỷ hợp đồng) | "This cannot be undone. The client is refunded 100% of the unused value." (đoạn "phạt 10%" đã bị gỡ ở commit `de07bdd`) | Trước | Nói hoàn cho khách; không nói gì về khấu trừ vào ví PT |
| Thông báo cho PT khi quét đóng phòng đánh vắng | "Bạn không vào phòng học trước khi hết giờ — buổi tập được ghi nhận vắng mặt, khách được bồi thường." | Sau | |

### 2.4 Tài liệu nội bộ (không hiển thị cho người dùng)

| Nơi | Nội dung | Ghi chú |
|---|---|---|
| `docs/money-flow.md` §5 (PT vắng buổi), §8 "Ngăn chờ không đủ tiền (§3.9 đề bài)" | Quy tắc: trừ PENDING trước, hết thì trừ AVAILABLE ("đòi lại là hợp lý chứ không phải trừng phạt"), còn thiếu thì nền tảng ứng và ghi `PartnerReceivable`, "khách luôn được nhận đủ" | Đây là NGUỒN của hành vi P1–P5. Là tài liệu thiết kế, không phải điều khoản người dùng ký |
| `US/services/session-outcome.ts` (ma trận §0.1) | PT huỷ < 24h hoặc vắng ⇒ luôn bồi thường khách | Quy tắc sản phẩm; hiển thị cho PT chỉ qua các câu ở 2.3 |
| `_warroom/decisions/LOG.md` D21–D28 | Giữ lại 10%, đền từ quỹ, PT cũ phải xác nhận lại điều khoản (D25) | Quyết định của chủ sở hữu; **chưa** thành điều khoản hiển thị hay lưu đồng ý |

### 2.5 Kết luận về hiệu lực thoả thuận (không phải ý kiến pháp lý)

1. Đối với KHÁCH: có thông báo hứa hoàn một buổi / bồi thường một phần sau sự cố; không có điều khoản nào quy định số tiền hay nguồn tiền. Khách không bị thiệt nếu logic đổi, miễn là họ vẫn nhận phần giá trị buổi.
2. Đối với PT: bằng chứng về việc PT BIẾT và ĐỒNG Ý rằng (a) bị trừ khi vắng — có một hộp thoại di động trước hành động và thông báo sau; (b) bị trừ vào **ví gộp** thu nhập hợp đồng khác — không có; (c) bị **ghi nợ** và bị thu dần từ thu nhập sau — không có; (d) nền tảng ứng thay — không có. Hộp chọn "Điều khoản" ở hồ sơ PT không trỏ tới văn bản nào trong kho và không được lưu.
3. Vì vậy: phần hoàn giá trị buổi chưa dạy bằng tiền của chính buổi đó có chỗ dựa trong quy tắc sản phẩm; phần lấy ví gộp / nợ PT / ứng không có chỗ dựa hiển thị. Đây là lý do D48 yêu cầu kiểm trước khi sửa: không có "nghĩa vụ đã ký hợp lệ" nào bị bỏ sót khi bỏ nhánh P1–P5 vượt PENDING, nhưng quyền lợi đã phát sinh của khách (đã nhận hoặc đang chờ) không được xoá (mục 5).
4. Cần Ngài (hoặc cố vấn pháp lý) xác nhận: văn bản "Điều khoản dịch vụ / Quy tắc ứng xử của HLV" có tồn tại ngoài kho mã không, và có điều khoản nào về khấu trừ ví / ghi nợ không.

---

## 3. Dữ liệu dev (`ĐỌC DB DEV`, chỉ SELECT)

Cảnh báo: dev chủ yếu là dữ liệu mồi và dư lượng harness (tài khoản e2e như `f506697b…`, `68aca044…`; một buổi mang ghi chú "cleanup leftover from earlier harness attempt"). Nhiều hợp đồng đã bị xoá khỏi user-service nhưng sổ cái payment-service còn dòng. Con số dưới đây chỉ cho thấy HÌNH DẠNG vấn đề, không phải quy mô production.

### 3.1 Tổng quan sổ cái (payment)

| Chỉ tiêu | Kết quả |
|---|---|
| Số dòng `wallet_ledger_entries` | 702 |
| Dòng có chữ "PT holdback" (quỹ) | **0** |
| Dòng khách nhận "compensation" | **3** (500.000 + 500.000 + 200.000 = **1.200.000đ**) |
| Dòng "fronted by the platform" (nền tảng ứng) | **2** (200.000 + 70.000 = 270.000đ) |
| `ledger_operations` theo khoá: `PT_NO_SHOW:` / `PT_LATE_ARRIVAL:` / `CONTRACT_TERMINATE:` / `SESSION_RELEASE:` | 2 / 0 / 6 / 5 |
| `partner_receivables` | 2 dòng: 200.000 (đã thu đủ 200.000, tất toán 08/09) và **70.000 (chưa thu)**; cả hai nợ PT `e81ef52a` |
| Bất biến toàn hệ thống: ESCROW AVAILABLE so với Σ ví khác | 107.447.000 = 107.447.000 (cân) |

### 3.2 Chi tiết 3 khoản đền vắng — nguồn tiền

| Giao dịch (T) | Hợp đồng | Ngày | Khách nhận | PT bị trừ | Nền tảng bị trừ | Từ ngăn nào | Từ AVAILABLE gộp? |
|---|---|---|---|---|---|---|---|
| `4802a975…` | `e200e8a0…` (4.000.000đ, 8 buổi) | 31/08 | 500.000 (buổi `092d1e61`) | 450.000 | 50.000 | PENDING của PT và REVENUE | **0đ** |
| `4802a975…` | `e200e8a0…` | 31/08 | 500.000 (buổi `5905e34d`) | 450.000 | 50.000 | PENDING | **0đ** |
| `c41f788c…` | `cc2a6925…` (đã xoá khỏi user-service) | 17/08 | 200.000 | 180.000 | 20.000 | PENDING | **0đ** (nhưng cùng giao dịch có thêm 200.000 nền tảng ứng khi kết thúc — mục 3.3) |

Ghi chú: buổi `092d1e61` có `pt_at_fault = false` và ghi chú harness; buổi `5905e34d` có `pt_at_fault = true`. Ghi nhận trong user-service: 210 dòng `session_settlements` loại `PT_NO_SHOW_COMPENSATION` (178 đã tất toán, 32 lỗi `payment-service unreachable`), nhưng 176 + 32 dòng thuộc hợp đồng không còn tồn tại; chỉ 2 dòng thuộc hợp đồng còn tồn tại (`e200e8a0`), khớp 2 khoá `PT_NO_SHOW:` trong sổ cái. Khoản 200.000 của `cc2a6925` có trước cơ chế khoá chống lặp.

### 3.3 Khoản nền tảng ứng (không phải đền, nhưng cùng cơ chế P4)

| T | Hợp đồng | Lý do ghi | Số tiền | Tình trạng |
|---|---|---|---|---|
| `c41f788c…` (17/08) | `cc2a6925…` | `Termination refund shortfall … CLIENT_CANCELLED` | 200.000 | Nợ PT `e81ef52a`, **đã thu đủ** 08/09 |
| `349ac317…` (29/09) | `ae947271…` (1.600.000đ, 8 buổi, đã dạy 2) | `Termination refund shortfall … CLIENT_CANCELLED` | 70.000 | Nợ PT `e81ef52a`, **chưa thu** |

### 3.4 Quỹ 10%

`pt_holdback_rate` không tồn tại trong bảng `contracts` của DB dev (migration `contract_pt_holdback` chưa áp lên dev, đúng như `_warroom/TINH_THE.md`); 0 dòng sổ cái "PT holdback". **Mọi hợp đồng dev đều không có quỹ.** Do đó mọi khoản đền ở trên là "đền khi hợp đồng không có quỹ".

### 3.5 Hợp đồng đang chạy có thể còn kích hoạt rút ví gộp

Có 14 hợp đồng đã gắn giao dịch thanh toán: 8 đã `CANCELLED`, 6 đang `ACTIVE`.

| Hợp đồng ACTIVE đã thanh toán | Giá / buổi | Trạng thái tiền | Kích hoạt được rút ví gộp? |
|---|---|---|---|
| `d9e66127`, `5a1b47cc`, `7b3445c7`, `3ad55e9a` (MARKETPLACE) | 500.000đ / 0 buổi | `total_sessions = 0` nên `payableOrNull` trả null | **Không** (không đi qua sổ cái hợp đồng) |
| `6db9017a` (9.000.000đ, 30 buổi, 28 buổi `CONFIRMED` đã quá ngày) | giao dịch `test-demo-fill-2weeks` | Không có dòng `payment_transactions` / sổ cái cho giao dịch này; `wallet_ledger_entries.transaction_id` có khoá ngoại tới `payment_transactions` | **Không**: mọi lời gọi tiền sẽ vi phạm khoá ngoại, hoàn tác (và `settleTracked` ghi lỗi) |
| **`9d2a34ee`** (1.600.000đ, 8 buổi, PT `e81ef52a`, hạn 28/11) | giao dịch `864ede79…` thật | PENDING PT 1.440.000 + REVENUE 160.000; chưa có buổi nào | **Có điều kiện**: mỗi lần PT vắng/đến muộn trừ PENDING của chính hợp đồng trước (tối đa 8 × 180.000 = 1.440.000 phần PT). Chỉ chạm AVAILABLE gộp (PT này đang có 1.424.050) nếu có buổi sót SAU khi hợp đồng kết thúc (lỗi F1), hoặc nếu PENDING của hợp đồng bị hỏng/thiếu |

Buổi mở trên hợp đồng đã kết thúc: 157 buổi `CONFIRMED` (141 trên `COMPLETED`, 16 trên `EXPIRED`) — không buổi nào thuộc hợp đồng đã thanh toán, nên chưa có tiền bị chạm. Sổ phụ (ví, PENDING, T) đang ÂM ở 7 nơi (PT `f506697b` T `349b8fa3` −2.025.000; PT `e81ef52a` T `f3eea0b7` −1.440.000 và `349ac317` −1.440.000; REVENUE T `349b8fa3` −225.000, `f3eea0b7` −190.000, `4802a975` −130.000, `349ac317` −50.000): với những giao dịch này `ownPending` bị kẹp về 0 nên bất kỳ khoản đền nào phát sinh trên đó sẽ đi thẳng sang AVAILABLE gộp. Hợp đồng gắn với các giao dịch ấy đều đã `CANCELLED`, nên không có kích hoạt mới.

### 3.6 Bảng đối soát (dev)

| Nhóm | Số mục | Số tiền | Ghi chú |
|---|---|---|---|
| Đền vắng đã trả, nguồn PENDING của chính hợp đồng | 3 | 1.200.000đ | không có quỹ; đây là "hoàn giá trị buổi" (xem thiết kế mục 8.3) |
| Đền vắng/muộn đã trả có phần lấy AVAILABLE gộp | 0 | 0đ | |
| Đền từ quỹ 10% | 0 | 0đ | không có quỹ nào |
| Nền tảng ứng khi kết thúc hợp đồng | 2 | 270.000đ | nợ PT: 200.000 đã thu, **70.000 còn nợ** |
| Nghĩa vụ đền chờ tất toán (`PT_NO_SHOW_COMPENSATION` ở trạng thái FAILED) | 32 | không xác định | tất cả thuộc hợp đồng không còn tồn tại ⇒ không còn nghĩa vụ thật |
| Hợp đồng đang chạy, có tiền thật, còn có thể kích hoạt | 1 (`9d2a34ee`) | trần 1.440.000đ từ chính PENDING của nó | |
| Sổ phụ âm (hậu quả lỗi vét tiền chờ đã sửa, commit `2578561`) | 7 | −5.500.000đ (tổng giá trị tuyệt đối PT + REVENUE) | dữ liệu hỏng, cần quyết định riêng (`_warroom/TINH_THE.md` nêu ~3.880.000đ chưa hoàn) |

---

## 4. Truy vấn để chạy trên môi trường khác (chỉ-đọc)

Chạy với tài khoản chỉ-đọc, `SET default_transaction_read_only = on`.

```sql
-- (payment) Q-A. Mọi khoản khách nhận "compensation" và nguồn trừ đi kèm theo giao dịch
SELECT e.transaction_id,
       SUM(CASE WHEN w.owner_type='CLIENT' AND e.entry_type='CREDIT' AND e.description ILIKE '%compensation%' THEN e.amount ELSE 0 END) AS paid_to_client,
       SUM(CASE WHEN w.owner_type IN ('PT','GYM') AND e.entry_type='DEBIT' AND e.bucket='PENDING'   AND (e.description LIKE '%no-show charge' OR e.description LIKE '%late-arrival charge') THEN e.amount ELSE 0 END) AS from_pending,
       SUM(CASE WHEN w.owner_type IN ('PT','GYM') AND e.entry_type='DEBIT' AND e.bucket='AVAILABLE' AND (e.description LIKE '%no-show charge' OR e.description LIKE '%late-arrival charge') THEN e.amount ELSE 0 END) AS from_pooled_available,
       SUM(CASE WHEN e.description LIKE '%fronted by the platform' THEN e.amount ELSE 0 END) AS platform_fronted
FROM wallet_ledger_entries e JOIN wallets w ON w.id = e.wallet_id
GROUP BY 1 HAVING SUM(CASE WHEN w.owner_type='CLIENT' AND e.description ILIKE '%compensation%' THEN 1 ELSE 0 END) > 0
                OR SUM(CASE WHEN e.description LIKE '%fronted by the platform' THEN 1 ELSE 0 END) > 0;

-- (payment) Q-B. Rút ví gộp khi chấm dứt: kẹp thu hồi
SELECT transaction_id, SUM(amount) AS clawed_from_available
FROM wallet_ledger_entries WHERE description LIKE '%over-released, clawed back' GROUP BY 1;

-- (payment) Q-C. Nợ PT còn lại
SELECT partner_type, partner_id, SUM(amount - recovered) AS outstanding
FROM partner_receivables WHERE settled_at IS NULL GROUP BY 1,2;

-- (payment) Q-D. Hợp đồng có quỹ (sau khi bật 10%) mà vẫn có đền không từ quỹ
SELECT DISTINCT transaction_id FROM wallet_ledger_entries WHERE description LIKE '% — PT holdback retained';

-- (user) Q-E. Hợp đồng đang chạy đã thanh toán kèm buổi còn mở (có thể kích hoạt đền)
SELECT c.id, c.status, c.payment_transaction_id, count(*) FILTER (WHERE s.status IN ('REQUESTED','CONFIRMED','PENDING_CLIENT_CONFIRMATION','DISPUTED','PT_NO_SHOW_REPORTED')) AS open_sessions
FROM contracts c LEFT JOIN sessions s ON s.contract_id = c.id
WHERE c.payment_transaction_id IS NOT NULL GROUP BY 1,2,3 HAVING count(*) FILTER (WHERE s.status IN ('REQUESTED','CONFIRMED','PENDING_CLIENT_CONFIRMATION','DISPUTED','PT_NO_SHOW_REPORTED')) > 0;

-- (user) Q-F. Nghĩa vụ đền chưa tất toán
SELECT s.status, (c.id IS NOT NULL) AS contract_exists, count(*)
FROM session_settlements s LEFT JOIN contracts c ON c.id = s.contract_id
WHERE s.kind IN ('PT_NO_SHOW_COMPENSATION','PT_LATE_ARRIVAL_COMPENSATION') GROUP BY 1,2;
```

---

## 5. Phương án xử lý nghĩa vụ đền CŨ (KHÔNG quyết định)

Ràng buộc của D48 phải giữ cho mọi phương án: không xoá quyền lợi hợp đồng cũ; không đổi giao dịch đã quyết toán; hợp đồng không có quỹ mà có nghĩa vụ đền thì đưa vào báo cáo đối soát và đề xuất; từ nay không lấy ví gộp, không nợ, không ứng, không báo đủ khi chi thiếu.

Ví dụ thống nhất (`TÍNH TAY`): hợp đồng X 4.000.000đ, 8 buổi; PT vắng một buổi sau khi PENDING của X đã cạn (mục 1.4). PENDING của X có 300.000đ phần PT, AVAILABLE gộp của PT 1.000.000đ (tiền hợp đồng Y); khách chờ 500.000đ.
- Mã hiện tại: khách +500.000; PT −300.000 (PENDING X) −150.000 (AVAILABLE gộp = tiền Y); nền tảng −50.000 (REVENUE).
- Theo N7 (không ví gộp): khách +300.000 (chỉ phần PENDING của X) và 200.000 ghi "chưa giải quyết"; PT không mất đồng nào từ Y.

| Phương án | Nội dung | Ưu | Nhược | Ví dụ trên hợp đồng X |
|---|---|---|---|---|
| **A. Giữ nguyên lịch sử, chỉ chặn từ ngày triển khai** | Mọi khoản đã ghi sổ giữ nguyên; nghĩa vụ chưa tất toán sau ngày cắt đi theo quy tắc mới | Đơn giản; không đụng giao dịch đã quyết toán; không xoá quyền lợi | Khoản đã rút từ ví gộp trước đó không được sửa; PT chịu thiệt (nếu nghĩa vụ không hợp lệ) vẫn không được hoàn. Dev: 0đ như vậy, nhưng production chưa biết | Nếu X đã tất toán trước ngày cắt: PT Y mất 150.000 và giữ nguyên |
| **B. Tất toán nghĩa vụ đang mở chỉ bằng tiền chính hợp đồng** | Mỗi nghĩa vụ đang chờ tại ngày cắt được trả tới mức PENDING của hợp đồng đó cho phép; phần thiếu thành "chưa giải quyết" hiển thị cho admin và khách, không nợ | Giữ quyền lợi khách trong phạm vi tiền thật của hợp đồng; không đụng ví gộp | Khách có thể nhận ít hơn đã được hứa; cần thông điệp đúng sự thật ("đã hoàn X, Y chưa hoàn") | Khách +300.000 (không phải 500.000), 200.000 chưa giải quyết |
| **C. Chuyển nghĩa vụ mở thành hạng mục chờ Ngài quyết (khoản thiện chí do chủ sở hữu cho phép, ghi riêng)** | Phần chưa giải quyết đưa vào hàng đợi; chỉ khi Ngài chủ động cho phép một khoản chi thiện chí từ doanh thu nền tảng, có ghi riêng, có mã lý do, KHÔNG phải "nền tảng ứng/ghi nợ PT" | Khách được đủ tiền nếu Ngài muốn; không có nợ PT; minh bạch | Chi phí thật cho nền tảng; mở tiền lệ; chỉ dùng như quyết định thủ công từng khoản | Ngài duyệt 200.000 từ doanh thu → khách đủ 500.000; PT không mất gì thêm |
| **D. Hoàn lại ngược các khoản đã rút từ ví gộp** | Xác định khoản nào đã lấy từ AVAILABLE gộp và trả lại PT, lấy từ doanh thu nền tảng (hoặc từ khách) | Sửa sai cho PT nếu nghĩa vụ không hợp lệ | Trái "không đổi giao dịch đã quyết toán"; nếu lấy lại từ khách là cắt quyền lợi khách; phức tạp và dễ sai ở production | Trả PT 150.000 từ doanh thu; ghi riêng |
| **E. Huỷ các nghĩa vụ đang mở** | Coi nghĩa vụ chưa tất toán là vô hiệu | Dọn nhanh hàng đợi | **Trái D48** (xoá quyền lợi hợp đồng cũ của khách) trừ khi cố vấn pháp lý xác nhận không có quyền lợi | Khách mất 500.000 |

Quyết định phụ cần cho cả mọi phương án — khoản nợ PT còn tồn (`PartnerReceivable` 70.000đ của PT `e81ef52a`, tạo ra bởi `coverShortfall` khi kết thúc hợp đồng, tức ĐÚNG loại "nợ + nền tảng ứng" N7 bác): (i) giữ thu dần từ thu nhập sau; (ii) dừng thu và ghi giảm nợ (nền tảng chịu 70.000đ); (iii) giữ nhưng không thu thêm cho tới khi có quy tắc mới. Số này nhỏ nhưng là tiền lệ cho production.

Điều kiện nên xác định trước khi chọn: (1) chạy Q-A…Q-F trên production để biết quy mô thật (dev: 0đ rút ví gộp); (2) xác nhận văn bản điều khoản tồn tại ngoài kho (mục 2.5 điểm 4); (3) xác nhận cách đọc N7 cho đường hoàn giá trị buổi (thiết kế bản 3 mục 8.3, câu 2).

---

## 6. Những gì chưa kiểm / hạn chế

- Không có số liệu production. Mọi số `ĐỌC DB DEV` là dữ liệu dev có nhiều dư lượng harness.
- `PS/providers/*`, `PS/routes/{webhook,vnpay-return}` và các tệp user-service ở trạng thái đang thay đổi (nhóm F1–F3, gateway) không được audit ở đây.
- Chưa đọc hết các trang web/mobile khác ngoài các chuỗi tìm theo từ khoá "bồi thường / compensat / điều khoản / 10%": có thể còn văn bản khác không chứa các từ này.
- Việc phân loại pháp lý (điều khoản có hiệu lực hay không) cần người có thẩm quyền; tài liệu chỉ nêu bằng chứng trong kho.
- Container `gymcoach-postgres` đã được khởi động (docker start) để chạy các truy vấn đọc; không ghi gì. Docker sau đó không còn phản hồi trong phiên nên chưa dừng lại được; cần dừng lại nếu không dùng.
