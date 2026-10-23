# Phase 2.5A — Lát 5: Đóng băng tiền theo hợp đồng và theo nghĩa vụ ("Financial Hold") — TÀI LIỆU THIẾT KẾ (bản 3, sửa theo D45–D51; cập nhật 15/10 theo D52–D56)

Chỉ thiết kế, không có mã. Chờ Ngài nghiệm thu rồi mới triển khai (D39). Không bật giữ lại 10% (D51). Không commit/push.

Lịch sử bản: bản 1 (14/10, một kỹ sư viết từ mã) → bản 2 (sửa theo D40–D44) → **bản 3 (tài liệu này, sửa theo D45–D51, tức các quyết định N1–N9 của chủ sở hữu ngày 15/10)**. Bản 3 viết lại gần như toàn bộ; mục 0.1 liệt kê khác biệt, mục 0.2 chỉ ra mỗi quyết định N1–N9 được đáp ứng ở mục nào.

## Cập nhật 15/10 (D52–D56)

Chỉ sửa đúng các mục liên quan; phần còn lại của bản 3 và kết luận N1–N9 giữ nguyên. Nguồn: `_warroom/decisions/LOG.md` D52–D56. Không có mã nào được viết.

| Quyết định | Ảnh hưởng lên tài liệu này | Mục đã sửa |
|---|---|---|
| **D52** — buổi `PT_NO_SHOW_REPORTED` lúc hợp đồng kết thúc: GIỮ để xác minh qua `unresolvedSessions` (không hủy, không tự kết luận hoàn thành/vắng, không tự đền trước khi nghĩa vụ được xác định; phần chưa dùng khác hoàn ngay theo lý do kết thúc; quyết toán theo kết quả, chống trùng; có trạng thái theo dõi, không treo mãi). *Đang được agent khác hiện thực.* | Bỏ hướng cũ "hủy, đóng không phán xử". Công việc chuyển từ F1 sang F2 (chung cơ chế `unresolvedSessions`). Căn cứ hold "báo PT vắng chưa phân xử" vẫn còn nguyên sau khi hợp đồng kết thúc. Số kịch bản Bình đổi: hoàn 3.000.000 thay vì 3.500.000, giữ 500.000 cho buổi 4 | 2.3, 7.7, 10.1, 15.1–15.2, 16.2, 17 (HT-50, HT-60) |
| **D53** — tạm GIỮ việc dừng tự xác nhận cho PT bị cấm/hạn chế (biện pháp chuyển tiếp, không phải quy tắc lâu dài). Quy tắc đích là **điều kiện nghiệm thu của Financial Hold** | Quy tắc đích thành tiêu chí chấp nhận của U7 và điều kiện 13 của cổng G | 10.2, 12 (dòng 9), 16.4 (U7), 16.5 |
| **D54** — từ chối thao tác trên buổi/hợp đồng đã bị quy trình kết thúc hủy (lỗi nghiệp vụ rõ, không phí, không đổi sổ cái, không ghi đè); yêu cầu lặp đúng khóa idempotency của lần đã thành công trả kết quả cũ | Quy tắc cho F1/F3 và kiểm thử HT-60b | 2.3, 16.2, 17 |
| **D55** — dọn buổi sót của dữ liệu cũ là việc **RIÊNG**, kiểm kê + dry-run trước, DỪNG chờ Ngài duyệt trước khi đổi dữ liệu thật | Tách khỏi F1 (F1 chỉ sửa đường mã mới); thêm dòng việc riêng và điều kiện 14 (đề xuất) của cổng G | 12 (dòng 1), 16.1, 16.2, 16.5 |
| **D56** — F4 ưu tiên bốn ca đua và đánh giá giữ khóa DB khi gọi payment-service; N7 giữ nguyên; **M0/M1 CHƯA CHỌN** | F4 thêm phạm vi + HT-93, HT-94. Mọi chỗ trình bày M1 như đã quyết được sửa thành "chưa chọn"; U1 chặn tới khi Ngài chọn | 0, 3.7, 5.5, 8.3, 16.1, 16.3 (F4), 16.4 (U1), 17, 18.0, 19 |

Giải thích nghiệp vụ M0/M1 bằng ví dụ 5.000.000đ / 10 buổi (mười câu hỏi của Ngài, bảng đối soát, khuyến nghị và đánh đổi): `docs/FINANCIAL_HOLD_M0_VS_M1.md`. Khuyến nghị "M1" ghi ở mục 3.7 và 18.0 của bản 3 chỉ là khuyến nghị, **không phải quyết định**.

**Một điểm đọc D53 cần Ngài xác nhận.** D53 viết "quá hạn tự xác nhận sau khi kiểm không có tranh chấp *hoặc Financial Hold chặn*". Tại hạ đọc: buổi là căn cứ của hold thì đã `DISPUTED`/đang chờ phân xử nên không tự xác nhận; còn hold loại A (quỹ 10%) KHÔNG chặn tiền của các buổi khác (D42: hai loại tiền quản lý riêng). Nếu Ngài muốn hold của hợp đồng chặn cả việc tự xác nhận các buổi KHÁC của hợp đồng đó thì phải sửa D42 và các mục 2.1, 10.2.

Nhãn bằng chứng (theo `CLAUDE.md`):
- `CODE AUDIT` = đọc mã thật trong cây làm việc (kể cả phần chưa commit), có `tệp:dòng`. Không phải E2E, không chạy gì.
- `ĐỌC DB DEV` = câu `SELECT` chỉ-đọc chạy trên DB dev `gymcoach_payment` / `gymcoach_user` (container `gymcoach-postgres`). Là dữ liệu thật của môi trường dev, KHÔNG phải kiểm thử, không phải E2E; phần lớn dữ liệu dev là dữ liệu mồi/harness.
- `THIẾT KẾ` = đề xuất mới, chưa có dòng mã nào được viết.
- `TÍNH TAY` = con số tự tính từ công thức trong mã. Các bảng bút toán ở mục 3 còn được đối chiếu bằng một chương trình tính độc lập (không nạp mã dự án, không chạm DB): kết quả khớp từng con số, nhưng vẫn là tính tay, không phải chạy sổ cái thật.
- `BACKEND INTEGRATION` = kết quả chạy thật hai dịch vụ trên DB kiểm thử. Trong tài liệu này chỉ dùng cho bảng 14.1 (kịch bản C của `cross-service-money.e2e.test.ts`, số do điều phối viên báo, bộ 12/12; tại hạ không chạy lại). Mọi nhãn `REAL HTTP/API`, `TEST FIXTURE` ở mục 16–17 là nhãn DỰ KIẾN cho kế hoạch kiểm thử; hôm nay chưa có kết quả nào mang nhãn đó cho lát 5.

Quy ước đường dẫn: `PS` = `backend/services/payment-service/src`, `US` = `backend/services/user-service/src`. Số dòng của `PS/services/contract-ledger.service.ts` và `contract-money.ts` đã được đối chiếu lại trong cây làm việc hôm nay. Các tệp của user-service (`contract-payout.service.ts`, `booking.service.ts`, `session-autoconfirm.service.ts`, `contract-session-closure.ts` mới…) đang có agent khác sửa (nhóm F1–F3), nên ở đó tại hạ trích theo TÊN HÀM, không trích số dòng.

**Phụ thuộc vào việc đang làm của agent khác (đọc trước khi dùng tài liệu):**
- F1–F3 (nhóm 1, đang chạy; `_warroom/sessions/S_F1F2F3_progress.md` còn trống): tại hạ ánh xạ theo D45 và theo tệp mới `US/services/contract-session-closure.ts` đã thấy trong cây làm việc — **F1** = mọi đường chấm dứt xử lý buổi theo TRẠNG THÁI (L1); **F2** = buổi chờ xác nhận / tranh chấp được GIỮ với mọi lý do (từ D52 gồm cả buổi `PT_NO_SHOW_REPORTED` chưa ai trả lời), PT không báo hủy/vắng trên hợp đồng đã kết thúc (L2, L3); **F3** = so-sánh-và-đặt (CAS) cho xác nhận / tự xác nhận / phân xử (không ghi đè buổi đã hủy/đã quyết toán). Đây là cách tại hạ hiểu; điều phối viên xác nhận lại ánh xạ.
- Cổng thanh toán (callback VNPay/ZaloPay/PayOS…): agent khác đang sửa `PS/providers`, `PS/routes/{webhook,vnpay-return}`, không giao với tài liệu này.
- Mọi chỗ dưới đây nói "F1/F2/F3 đã làm" là nói về ĐÍCH của chúng, không phải trạng thái hiện tại của mã.

---

## 0. Tóm tắt

1. **Hai loại tiền, quản lý riêng (D42, giữ).** (A) tiền bảo đảm 10% ("quỹ", `ptHeld`): hold chỉ đóng băng đúng phần quỹ thật của đúng hợp đồng có căn cứ; không bao giờ tạo khi tỷ lệ giữ là 0; không hồi tố; không đụng ví PT, tiền hợp đồng khác, tiền buổi đã kiếm. (B) giá trị buổi chờ xác nhận / tranh chấp: KHÔNG dùng hold; đi theo cơ chế buổi treo (`unresolvedSessions`) và phán quyết chính buổi đó; D45 quy định buổi xử lý theo TRẠNG THÁI khi hợp đồng kết thúc, buổi tranh chấp luôn được giữ với mọi lý do.
2. **Quỹ 10% được chứng minh bằng bút toán (mục 3, yêu cầu mục V của chủ sở hữu).** Kết luận ngắn: **quyền sở hữu quỹ theo từng hợp đồng đúng về mặt dòng sổ cái (mỗi dòng mang `transactionId` của hợp đồng), tổng không bao giờ vượt số khách trả, quỹ không đồng thời nằm ở AVAILABLE — nhưng sổ cái hiện tại KHÔNG bảo đảm được điều đó theo cấu trúc.** Quỹ không phải một số dư riêng mà là một con số SUY RA từ hậu tố mô tả dòng sổ cái, nằm lẫn trong PENDING của hợp đồng. Hậu quả cụ thể và có thể xảy ra: (a) phí đến muộn trừ vào PENDING mà không tiêu thụ buổi nào, làm quỹ bị ăn âm thầm trong khi `ptHeld` vẫn đọc đủ → cùng một đồng bị đếm hai lần (vừa là quỹ vừa là phần chưa kiếm của buổi sau); (b) `alreadyReleased` do user-service gửi lên, không suy từ sổ cái → có thể trả PT hai lần rồi nền tảng ứng; (c) DB dev đã có 7 sổ phụ (ví, PENDING, hợp đồng) âm — không có ràng buộc DB nào cấm. Hai phương án sổ cái, **CHƯA CHỌN (D56, Ngài quyết)**: **M0** giữ cấu trúc, kiểm bất biến và "sàn quỹ"; **M1** thêm ngăn thứ tư `HOLDBACK` cho ví (cùng dạng với ngăn `LOCKED` đã thêm ở cụm F). Cả hai đều không cần di chuyển dữ liệu cũ vì mọi hợp đồng hôm nay có tỷ lệ 0 và dev có 0 dòng "holdback" (mục 3.7; giải thích với ví dụ tiền ở `docs/FINANCIAL_HOLD_M0_VS_M1.md`).
3. **Cơ chế an toàn khi cấm / đình chỉ (N6, mục 11).** Chủ sở hữu BÁC "đóng băng xong mới được cấm". Thiết kế: quyết định an toàn (hạn chế tài khoản) áp dụng ngay trong một giao dịch DB của user-service; cùng giao dịch đó ghi "yêu cầu bảo vệ tiền" (`ContractHoldRequest`, kiểu outbox) CHỈ cho các hợp đồng có căn cứ riêng. Mọi đường user-service có thể trả quỹ cho PT kiểm "yêu cầu đang mở" trong DB của chính nó trước khi gọi payment-service (cổng cục bộ); lệnh chấm dứt gửi kèm yêu cầu để payment-service tạo hold NGUYÊN TỬ cùng lúc ghi sổ; payment-service ngừng hoạt động không chặn đình chỉ khẩn cấp, chỉ hoãn phần tiền. Bảng 11.4 liệt kê 15 tình huống lỗi, kèm rủi ro còn lại (khe vài mili-giây của quét nhàn rỗi, được phát hiện và báo, không tự thu hồi).
4. **Đền chỉ từ quỹ thật của đúng hợp đồng (N1, N2, N7; mục 6, 7).** Không bơm lại quỹ (N1: số đã đền được tính như "đã góp" vào quỹ, nên các buổi sau không lấp lại). Trần cộng dồn mỗi hợp đồng `= min(số dư quỹ thật, giới hạn chính sách còn lại, nghĩa vụ hợp lệ)`; thiếu thì ghi số đã trả + phần chưa giải quyết, không nợ PT, nền tảng không ứng, và hệ thống không bao giờ nói "đã đền đủ" khi trả thiếu. Không có công thức đền mới.
5. **Mâu thuẫn được nêu rõ (N3, N7; mục 8).** Cơ chế tự đền hiện tại có HAI nhóm vi phạm: (i) bốn đường trừ tiền ra khỏi AVAILABLE gộp / nền tảng ứng (`compensateNoShow`, `compensateLateArrival`, kẹp thu hồi và bù thiếu trong `terminateContract`, `coverShortfall`); (ii) các đường mà sự kiện kích hoạt, kết luận vi phạm và giải ngân là MỘT bước tự động (quét đóng phòng, PT huỷ muộn, `PT_REPEATED_NO_SHOW`). Mục 8 lập bảng, không tự quyết.
6. **Cấm không phải lỗi (N8, mục 9).** `SERVICE_DISCONTINUED_BY_PLATFORM` thay `PT_BANNED` làm lý do cho mọi lệnh MỚI: hoàn phần chưa dùng theo chính sách trung tính, không tự đền. Dữ liệu cũ `PT_BANNED` giữ nguyên và vẫn phát lại được. Cần đúng MỘT migration cộng giá trị enum ở user-service (lưu được lý do riêng); không có migration ở payment-service.
7. **Buổi đã báo trước khi bị cấm (N5/N9, mục 10).** Buổi tranh chấp được giữ; buổi PT đã báo hoàn thành trước lúc bị cấm, không tranh chấp, được khách xác nhận hoặc tự xác nhận sau khi hết cửa sổ; không đóng băng tiền đã kiếm; PT không báo hoàn thành mới sau lúc cấm; xác nhận không bao giờ ghi đè buổi đã hủy/đã quyết toán; không giải ngân tiền đang bị giữ hợp lệ.
8. **Vòng đời hold (N4, mục 7.6).** Hold phải có căn cứ, hợp đồng + nghĩa vụ, ngày bắt đầu, người phụ trách; quá 14 ngày chưa phân xử → cảnh báo + hàng đợi ưu tiên; gia hạn phải có lý do; hết hạn KHÔNG phải lỗi của PT và không tự làm gì với tiền; khi không còn căn cứ (do quyết định rõ ràng) hold đóng và tiền về đúng trạng thái hợp đồng.
9. **Kiểm toán nguồn đền từ ví gộp (Task C, `docs/PT_COMPENSATION_SOURCE_AUDIT.md`).** Kết luận ngắn: trong mã có 5 đường rút từ AVAILABLE gộp của PT (+ 3 đường lân cận của sản phẩm khác); không tìm thấy điều khoản nào đã ký hay màn hình nào nêu nghĩa vụ đó với PT; trên DB dev 3 khoản đền vắng (1.200.000đ) đều được trả từ PENDING của chính hợp đồng, 0 đồng từ AVAILABLE gộp. Chi tiết và phương án xử lý nghĩa vụ cũ nằm ở tệp riêng, không quyết.
10. **Kế hoạch (mục 16).** Nhóm 1 (F1–F3, agent khác) → Nhóm 2 (F4 nguồn tính tiền duy nhất, F5 cấm ≠ lỗi, F6 quét nhàn rỗi) → lát 5 theo 9 đơn vị nhỏ nghiệm thu độc lập (U1–U9) → **cổng cuối G: bật 10%, với 14 điều kiện tiên quyết ghi rõ** (12 gốc + 2 thêm 15/10). U1 chờ Ngài chọn M0/M1 (D56). Không bật 10%, không Phase 3, không Owner Management, không công thức đền mới (D51).

### 0.1 Thay đổi so với bản 2

| Bản 2 | Bản 3 |
|---|---|
| N1 (đầy lại quỹ?) là câu hỏi mở, khuyến nghị B | Đã chốt (D46): không bơm lại. Quy tắc cài đặt ở mục 7.4 |
| N2 (cách đo trần) là câu hỏi mở | Đã chốt công thức `min(quỹ thật, giới hạn chính sách còn lại, nghĩa vụ hợp lệ)`; chỉ còn MỘT chi tiết đo giới hạn chính sách (câu 1, mục 18) |
| N3, N4 (căn cứ, phần chưa giải quyết có trả nốt?) | Căn cứ: tách "sự kiện / kết luận / giải ngân" (mục 8); phần chưa giải quyết: ghi nhận, không trả nốt tự động, không nợ (D46) |
| N5 (buổi chờ/tranh chấp khi cấm) | D45 L1/L3 + D46 N5/N9: mục 2.3 và mục 10 |
| N6 (cấm: pot hợp đồng không hold về PT?) | Chủ sở hữu bác "hold trước khi cấm"; thay bằng cơ chế giao dịch + khôi phục (mục 11) |
| N7 (đền tự động lúc kết thúc khi không có hold) | D48: đền chỉ từ quỹ thật; rút ví gộp bị bác. Kiểm toán ở tệp riêng, mâu thuẫn ở mục 8 |
| N8 (admin chọn `PT_BANNED`?) | D49: `SERVICE_DISCONTINUED_BY_PLATFORM` thay thế (mục 9) |
| N9 (tự xác nhận cho PT bị cấm) | Đã chốt (D46): có, sau cửa sổ hợp lệ (mục 10) |
| Chứng minh quỹ | MỚI: mục 3 (bút toán theo tài khoản thật) |
| Kế hoạch F1–F6 (đánh số khác) | Viết lại theo D51 (mục 16): F4–F6 theo nghĩa của chủ sở hữu, thêm đơn vị U1–U9 và cổng bật 10% |
| 16 câu hỏi | 7 câu còn thật sự chưa quyết (mục 18), cộng một mục "cần Ngài duyệt" (18.0) |

### 0.2 Bản đồ N1–N9 → mục

| Quyết định | Nội dung rút gọn | Mục |
|---|---|---|
| N1 (D46) | Không bơm lại quỹ | 3.4 (bút toán), 7.4 (quy tắc) |
| N2 (D46) | Trần cộng dồn = min(quỹ thật, giới hạn chính sách, nghĩa vụ hợp lệ); thiếu → ghi phần chưa giải quyết, không nợ | 7.2, 7.3 |
| N3 (D46) | Sự kiện ≠ kết luận ≠ giải ngân; buổi admin hủy vì đình chỉ không là PT vắng; không công thức mới; nêu mâu thuẫn | 8 |
| N4 (D46) | Hold: căn cứ, hợp đồng + nghĩa vụ, ngày bắt đầu, người phụ trách; >14 ngày cảnh báo; gia hạn có lý do; hết hạn ≠ lỗi; nhả đúng trạng thái | 4, 7.1, 7.6 |
| N5/N9 (D46) | PT bị cấm: tranh chấp giữ; đã báo trước cấm → xác nhận; không đóng băng tiền kiếm được; không báo mới; không ghi đè; không giải ngân tiền đang giữ | 10 |
| N6 (D47) | Quyết định an toàn áp ngay; bảo vệ tiền đồng bộ hoặc qua trạng thái chờ an toàn; không khe giải ngân; giữ lỗi không báo thành công; payment-service lỗi không chặn khẩn cấp; hạn chế tài khoản không tự đóng băng mọi hợp đồng | 11 |
| N7 (D48) | Đền chỉ từ quỹ thật hợp đồng liên quan; không ví gộp, không nợ, không ứng, không báo đủ khi chi thiếu; kiểm toán + đối soát | 6, 7, 8; `PT_COMPENSATION_SOURCE_AUDIT.md` |
| N8 (D49) | `SERVICE_DISCONTINUED_BY_PLATFORM` thay `PT_BANNED`; dữ liệu cũ tương thích; migration chỉ khi cần | 9 |

---

## 1. Ràng buộc từ chủ sở hữu và cách thiết kế đáp ứng

| Yêu cầu (nguồn) | Cách đáp ứng |
|---|---|
| Hold theo TỪNG hợp đồng, chỉ mở bằng quyết định gắn căn cứ riêng của đúng hợp đồng đó; không tự động theo hạn chế tài khoản (D38, N6) | Căn cứ hợp lệ chỉ gồm: buổi tranh chấp, báo cáo PT vắng chưa phân xử, hạn chế cấp HỢP ĐỒNG. User-service tự xác minh từ DB. Hạn chế `PT_ACCOUNT_SCOPE` hay cấm vĩnh viễn KHÔNG phải căn cứ. Mục 7.1, 11.2 |
| Không đóng băng cả ví PT, không đóng băng mọi tiền đã kiếm (D38, N5) | Hold chỉ phủ quỹ A của một hợp đồng. Không `WalletStatus.FROZEN`, không dùng ngăn `LOCKED` (mục 2.5) |
| Hai loại tiền, quản lý riêng; buổi tranh chấp không tạo khoản đóng băng trùng (D42) | Mục 2 |
| Buổi xử lý theo trạng thái; tranh chấp luôn giữ (D45) | Mục 2.3 |
| Không giữ vô thời hạn khi đã xác minh (D42) | Phán quyết buổi → tiền chạy ngay; hold A tách rời, đóng bằng thao tác riêng, có hạn xem xét 14 ngày (mục 7.6) |
| Đền theo từng nghĩa vụ khi ACTIVE; không tự động; không trùng; không lấy tiền hợp đồng khác; không nợ; không ứng (D43) | Mục 7.2–7.3 |
| Quỹ chỉ giảm bằng đúng 3 cách: đền theo nghĩa vụ đã phán, trả PT khi hợp đồng kết thúc/hold đóng, giải phóng nhàn rỗi (D21–D24, D46) | Mục 3, bảng 6 |
| Nền tảng không ứng, đền không phát sinh nợ (D20, D22, D48) | Chỉ ghi nợ ngăn quỹ của PT dưới đúng `transactionId`; không `coverShortfall`, không `PartnerReceivable` |
| Cấm vĩnh viễn: không mặc định đền; trách nhiệm quyết riêng theo hợp đồng (D31, D44, D49) | Lý do mới không phải lỗi (mục 9) + phán nghĩa vụ theo hợp đồng (mục 7) |
| Kiểm khoản đóng băng ngay tại điểm ghi sổ | Mục 5 |
| Quyết định an toàn áp ngay, tiền bảo vệ đồng bộ hoặc qua trạng thái chờ an toàn (D47) | Mục 11 |
| Một admin + lý do + nhật ký; người phụ trách + hạn (D46 N4) | Mục 7.5, 7.6 |
| D34: xác nhận của khách và giải phóng tiền tách được | Mục 10.3 |
| Không bật 10% cho tới khi kiểm thử đạt (D31, D51) | Mục 16.5 (cổng G), mục 17 |


---

## 2. Hai loại tiền, quản lý riêng (D42) và buổi xử lý theo trạng thái (D45)

Ký hiệu: `T` = `paymentTransactionId` của hợp đồng (`Contract.paymentTransactionId`; `payableOrNull` trong `US/services/contract-payout.service.ts` — không có thì không có tiền để di chuyển). Mọi bút toán của hợp đồng mang `transactionId = T` (`PS/services/wallet.service.ts`, `withWallets` đóng dấu từng dòng). Hai hàm đọc dùng xuyên suốt tài liệu: `potOf(T)` = số dư quỹ thật của hợp đồng; `paidFromPot(T)` = tổng đã đền từ quỹ. Cách cài hai hàm (hậu tố mô tả như hôm nay, hay ngăn `HOLDBACK`) được chốt ở mục 3.7.

### 2.1 Bảng hai loại tiền

| | **A. Quỹ bảo đảm 10% của PT** ("quỹ", pot) | **B. Giá trị buổi chờ xác nhận / đang tranh chấp** |
|---|---|---|
| Là gì | `h × giá hợp đồng`, lấy từ thu nhập ĐẦU của PT (D21) | Một buổi `PENDING_CLIENT_CONFIRMATION` hoặc `DISPUTED` chưa trừ quota; giá trị = `unit = floor(P/N)` chia ba (`PS/services/contract-money.ts` `computeSessionRelease`) |
| Nằm đâu trong sổ cái hôm nay | Ngăn **PENDING** của ví PT, dưới `T`, các dòng "… PT holdback retained"; `ptHeld(T)` suy từ hậu tố (`PS/services/contract-ledger.service.ts:120-121, 145-165`) | Ngăn **PENDING** của ba ví PT, gym, REVENUE, dưới `T`, lẫn trong phần "chưa kiếm"; sau khi hợp đồng kết thúc kèm `unresolvedSessions`: phần được giữ lại bởi dòng 0 đồng `UNRESOLVED_HELD_MARKER`/`UNRESOLVED_RESOLVED_MARKER` trong PENDING của REVENUE (`:137-138, :1081-1094, :1141-1142, :1390`) |
| Dấu mới do lát 5 thêm | Bản ghi `ContractMoneyHold` + `ContractHoldObligation` (mục 4); nếu Ngài chọn M1 (CHƯA CHỌN, D56) thì ngăn `HOLDBACK` (mục 3.7) | **Không thêm gì ở sổ cái.** Chỉ mở rộng việc DÙNG cơ chế buổi treo cho mọi lý do (F2) |
| Hàm nào di chuyển | `releaseSession` (góp vào quỹ); `terminateContract` (trả PT, hoặc đền khách theo D23 — xem mục 8 về xung đột); `releasePtHoldback` (quét 30 ngày); **mới**: phán nghĩa vụ (đền), đóng hold (trả PT) | `releaseSession` (xác nhận lúc ACTIVE); `compensateNoShow` (admin xác nhận PT vắng lúc ACTIVE); `resolveUnresolvedSession` (sau khi hợp đồng kết thúc); `terminateContract` chỉ GIỮ, không chia |
| Do quyết định nào | Hold: admin mở (có căn cứ). Đền: admin phán từng nghĩa vụ (D43). Trả PT: đóng hold hoặc kết thúc hợp đồng | Phán quyết về CHÍNH buổi đó: khách xác nhận, tự xác nhận, hoặc admin phân xử |
| Không bao giờ | Tạo khi tỷ lệ giữ 0 hoặc đã giải phóng; hồi tố; đóng băng cả ví; đụng quỹ hợp đồng khác; đền khi chưa có quyết định hợp lệ; ghi nợ PT; nền tảng ứng; bơm lại sau khi đã đền (N1) | Bị giải phóng chỉ vì A đang bị đóng băng; bị giữ vô thời hạn sau khi đã có phán quyết; bị chia cho các bên khi hợp đồng kết thúc nếu buổi chưa có phán quyết |
| Hai loại ảnh hưởng nhau thế nào | Xác nhận một buổi B hợp lệ vẫn trả tiền kiếm được cho PT dù A đang đóng băng | Phán quyết B không mở khoá A; mở/đóng hold A không đổi trạng thái buổi |

Tiền đã kiếm hợp lệ, đã giải phóng vào AVAILABLE của PT: hold KHÔNG BAO GIỜ đụng. `CODE AUDIT`: nó gộp chung mọi hợp đồng của PT; khi PT rút, dòng ghi nợ mang `transactionId = WITHDRAWAL:<id>` chứ không mang `T` (`PS/services/withdrawal.service.ts`), nên không nhận diện được "phần của hợp đồng X" — đúng với yêu cầu "không đóng băng mọi tiền đã kiếm" (N5).

### 2.2 Quỹ A: định danh và phạm vi

- Hôm nay `ptHeld(T)` = Σ PENDING CREDIT kết thúc bằng `" — PT holdback retained"` − Σ PENDING DEBIT kết thúc bằng `" — PT holdback released (no activity)"`, kẹp bởi `ownPending` (`PS/services/contract-ledger.service.ts:94-99, 145-165`). Việc đền giữa chừng cần một hậu tố thứ ba `HOLDBACK_PAID_SUFFIX = ' — PT holdback paid to client'` (không dùng `HOLDBACK_RELEASED_SUFFIX`, vì dòng đó đồng thời là dấu "đã giải phóng toàn bộ", `:173-188`). Mục 3 chứng minh vì sao cách suy từ hậu tố chưa đủ chắc và đề xuất ngăn `HOLDBACK`.
- Chính sách: `Contract.ptHoldbackRate` chụp lúc tạo; `resolvePtHoldbackRate()` luôn trả `"0"` (`US/services/pt-holdback-rate.ts:23-25`); `holdbackArgOf` bỏ hẳn khoá khi 0 hoặc đã giải phóng (`US/services/contract-payout.service.ts`).
- Hold chỉ phủ `potOf(T)` tại lúc phán/đóng, đọc lại từ sổ cái dưới khoá. Hợp đồng tỷ lệ 0 hoặc đã `holdbackReleasedAt`: mở hold bị từ chối `HOLD_NOT_APPLICABLE`. Hôm nay là TẤT CẢ hợp đồng.
- Phần chưa kiếm của PT, phần gym, phần nền tảng: hold không phủ.

### 2.3 Buổi xử lý theo TRẠNG THÁI khi hợp đồng kết thúc (D45: L1, L2, L3; nhóm F1–F3)

Đây là hành vi ĐÍCH mà thiết kế lát 5 dựa vào. F1–F3 đang được agent khác làm; tệp `US/services/contract-session-closure.ts` (mới, chưa commit) đã thể hiện L1.

| Trạng thái buổi lúc hợp đồng kết thúc (mọi lý do) | Xử lý | Tiền | Nhóm |
|---|---|---|---|
| `REQUESTED`, `CONFIRMED` (chưa diễn ra) | Hủy theo lý do chấm dứt; KHÔNG tính vắng, KHÔNG `ptAtFault`, KHÔNG trừ quota, KHÔNG đền; hủy bằng CAS trên trạng thái đã đọc | Giá trị buổi nằm trong phần "chưa dùng", hoàn theo công thức lý do | F1 |
| `PT_NO_SHOW_REPORTED` (khách báo PT vắng, chưa ai trả lời) | **Giữ để xác minh (D52, 15/10; thay hướng cũ "hủy, đóng không phán xử")**: không hủy, không tự kết luận hoàn thành hay vắng, không `ptAtFault`, không đền trước khi nghĩa vụ được xác định; tính vào `unresolvedSessions`; phân xử bằng quy trình sẵn có (`resolveUnresolvedSession`); có trạng thái theo dõi và hạn xem xét để không treo mãi | `unresolvedSessions` giữ giá trị buổi trong PENDING cho tới phán quyết; các buổi chưa dùng KHÁC vẫn hoàn ngay theo lý do kết thúc | F2 (agent khác đang hiện thực; ghi chú cũ ở `US/services/pt-deactivation.service.ts` `FUTURE_SESSION_STATUSES` theo hướng hủy, phải đổi) |
| `PENDING_CLIENT_CONFIRMATION` (PT đã báo xong, khách chưa trả lời) | **Giữ** (không hủy, không chia); quyết toán RIÊNG qua đường xác nhận / tự xác nhận | `unresolvedSessions` giữ giá trị buổi trong PENDING cho tới phán quyết | F2 |
| `DISPUTED` | **Giữ với MỌI lý do** (khách hủy, PT hủy, đồng thuận, hết hạn, hoàn tất, admin, cấm); chỉ admin phán | Như trên | F2 (L3) |
| `COMPLETED`, `NO_SHOW` do khách vắng, buổi đã quyết toán | Không giao dịch lần hai; không bị ghi đè | — | F3 (CAS) |

Quy tắc kèm theo (L2): PT không hủy / không báo vắng / không báo hoàn thành trên hợp đồng đã kết thúc; admin và tiến trình quyết toán vẫn xử lý buổi phát sinh TRƯỚC lúc kết thúc; không bao giờ ghi đè trạng thái đã quyết toán. **D54 (15/10):** thao tác muộn trên buổi/hợp đồng đã bị quy trình kết thúc hủy bị TỪ CHỐI với lỗi nghiệp vụ rõ ràng — không phí, không đổi sổ cái, không ghi đè, không bỏ qua im lặng; yêu cầu lặp đúng khóa idempotency của một lần đã thành công trả lại kết quả cũ, không xử lý lại.

Điều lát 5 yêu cầu thêm: phía payment-service `terminateContract` đã nhận `unresolvedSessions` cho mọi lý do (`PS/services/contract-money.ts` `computeTermination` không phân biệt lý do) và route cho phép (`PS/routes/internal.routes.ts:592-630`); nên KHÔNG đổi sổ cái. Điều kiện "hợp đồng đã kết thúc còn buổi treo" phải SUY RA (hợp đồng ở trạng thái cuối VÀ có buổi `PENDING_CLIENT_CONFIRMATION`/`DISPUTED`/`PT_NO_SHOW_REPORTED` chưa trừ quota) thay vì chỉ dựa vào lý do rút của khách (`isExitSettlementOpen` hôm nay); với hợp đồng cũ kết thúc trước thay đổi (không có dấu `UNRESOLVED_HELD`), `resolveUnresolvedSession` trả 409 `NO_UNRESOLVED_HELD` (`PS/services/contract-ledger.service.ts:1333-1335`) và user-service phải coi là trạng thái cuối (không thử lại mãi) — thuộc F4/F2.

### 2.4 Phán quyết buổi → đường tiền

| Phán quyết | Hợp đồng còn ACTIVE | Hợp đồng đã kết thúc, có buổi treo |
|---|---|---|
| Khách xác nhận / tự xác nhận / admin `COMPLETED` | `releaseSession` khoá `SESSION_RELEASE:<sessionId>` (PT: phần kiếm vượt quỹ về AVAILABLE; phần góp vào quỹ nếu quỹ chưa đầy ở lại, `PS/services/contract-ledger.service.ts:488-506`) | `resolveUnresolvedSession` DELIVERED, khoá `UNRESOLVED_SESSION:<sessionId>`: cả ba phần PENDING → AVAILABLE, KHÔNG áp quỹ (`:1271-1279`) |
| Admin `PT_NO_SHOW_CONFIRMED` | `compensateNoShow` khoá `PT_NO_SHOW:<sessionId>` (xem mục 8: nguồn tiền của hàm này có vi phạm N7), `compensatedSessions++`, quota không trừ | `resolveUnresolvedSession` NOT_DELIVERED: ba phần ra khỏi PENDING, khách nhận một dòng "refund" (`:1378-1389`) |
| Admin `CANCELLED` (không dạy, không đền) | Không có bút toán; đơn vị vẫn nằm trong PENDING, khách giữ quyền lợi buổi | Như NOT_DELIVERED |
| Chưa có phán quyết | Ở lại PENDING | Ở lại PENDING (`unresolvedHeld`) |

Mọi dòng trong cột phải đi qua `settleTracked` (thử lại, khoá chống lặp) đúng như hôm nay.

### 2.5 Vì sao không dùng cơ chế sẵn có để "đóng băng ví"

- `WalletStatus.FROZEN`: `withWallets` ném `WalletNotActiveError` nếu BẤT KỲ ví nào không ACTIVE (`PS/services/wallet.service.ts:230-233`) mà `resolveWallets` luôn khoá cả ví PT lẫn ví khách (`PS/services/contract-ledger.service.ts:53-72`): đóng băng ví PT làm hỏng hoàn tiền cho khách của hợp đồng khác — trái D38.
- Ngăn `LOCKED`: chỉ dành cho lệnh rút đã duyệt (`PS/services/withdrawal.service.ts`); chuyển quỹ sang LOCKED làm `ownPending` không còn thấy nó, `terminateContract` thấy PT "thiếu" và phát sinh shortfall → nền tảng ứng và ghi nợ PT (`:1048-1058` + `:1124-1133`), trái D20/D48.
- Cờ chặn rút cấp ví: chặn mọi tiền của PT thay vì một hợp đồng — trái D38/N5. Không làm.


---

## 3. Chứng minh quỹ 10% bằng bút toán (mục V của chủ sở hữu, D51)

Câu hỏi của chủ sở hữu: hợp đồng 5.000.000đ, quỹ 500.000đ. Quỹ được tạo từ tài khoản nào, khi nào; thuộc hợp đồng nào; trả đền 200.000đ thì tài khoản nào giảm; 300.000đ còn lại còn giữ không; hết hợp đồng thì ra sao; nhiều quyết định đền thì bị chặn cộng dồn thế nào; và phải chứng minh: (1) tổng không vượt 5.000.000 khách đã trả, (2) cùng một đồng không đồng thời là AVAILABLE của PT và là quỹ còn dùng được, (3) quyền sở hữu đúng ở TỪNG ĐỒNG chứ không chỉ ở tổng số dư.

Nhãn: mọi bảng dưới đây là `TÍNH TAY` theo mã (`PS/services/contract-ledger.service.ts`, `contract-money.ts`), đối chiếu bằng một chương trình tính độc lập; phần ghi `CODE AUDIT` dẫn dòng mã; phần ghi `ĐỌC DB DEV` là dữ liệu thật của DB dev (chỉ SELECT). Chưa có bảng nào là kết quả chạy sổ cái thật; bài kiểm thử thật là HT-70…HT-75 ở mục 17.

### 3.1 Tài khoản và nhãn thật trong sổ cái

Sổ cái là bảng `wallet_ledger_entries`: mỗi dòng = (ví, ngăn, `CREDIT`/`DEBIT`, số tiền, `transactionId`, mô tả). `CREDIT` làm số dư của ngăn đó TĂNG, `DEBIT` làm GIẢM (`PS/services/wallet.service.ts:79-136`). Vì vậy bảng dưới viết "Có" = tăng, "Nợ" = giảm; "đối ứng" là cặp dòng cùng bước. ESCROW là tiền mặt nền tảng đang giữ; mọi ví khác là QUYỀN ĐÒI trên số tiền đó; bất biến `ESCROW.available = Σ(pending + available + locked) của mọi ví khác` (`PS/services/reconcile.service.ts:6-20`).

| Tên trong bảng | Ví thật | Ngăn | Ghi chú |
|---|---|---|---|
| `ESCROW` | `PLATFORM/ESCROW` | AVAILABLE | tiền mặt đang giữ |
| `PT.PENDING` | ví PT | PENDING | phần PT "chưa kiếm" của MỌI hợp đồng của PT; sổ phụ của hợp đồng này = các dòng mang `T` |
| `PT.AVAILABLE` | ví PT | AVAILABLE | tiền đã kiếm, gộp chung mọi hợp đồng của PT |
| `REV.PENDING`, `REV.AVAILABLE` | `PLATFORM/REVENUE` | PENDING / AVAILABLE | hoa hồng nền tảng |
| `KHÁCH` | ví khách | AVAILABLE | hoàn tiền / đền |

**Quỹ KHÔNG phải một tài khoản.** Hôm nay không có ví, ngăn hay cột nào mang tên "quỹ". `ptHeld(T)` = Σ dòng `CREDIT` PENDING của ví PT dưới `T` có mô tả kết thúc `" — PT holdback retained"` trừ Σ dòng `DEBIT` PENDING kết thúc `" — PT holdback released (no activity)"`, rồi kẹp bởi `ownPending` (`:94-99, 145-165`).

Hợp đồng ví dụ (`TÍNH TAY`): giá `P` = 5.000.000; `N` = 10 buổi; nền tảng 10% / PT 90% / không gym; `h` = 10% nên quỹ mục tiêu `H` = `holdbackTarget` = 500.000; mỗi buổi `unit` = 500.000 = PT 450.000 + nền tảng 50.000. Ký hiệu `T` = mã giao dịch thanh toán của hợp đồng.

### 3.2 Quỹ được tạo từ đâu, khi nào (J0–J4)

**Quỹ không được "bơm" từ tài khoản nào khác.** Lúc khách thanh toán (J0) không có dòng nào mang tên quỹ: cả 4.500.000 phần PT nằm ở `PT.PENDING` dưới `T`. Quỹ xuất hiện từ buổi giải phóng đầu tiên (J1, J2) bằng cách GẮN NHÃN LẠI 500.000 đồng đã ở sẵn trong `PT.PENDING`: một dòng Nợ "release to available" rồi một dòng Có "PT holdback retained" cùng ngăn, cùng ví, cùng `T` (`:500-506`). Phần còn lại mới đi sang `PT.AVAILABLE`.

**Bảng 3.2a — các dòng sổ cái (đều mang `transactionId = T`)**

| Bước | Sự kiện (khoá chống lặp) | Dòng | Nợ / Có | Số tiền | Đuôi mô tả thật |
|---|---|---|---|---|---|
| J0 | Thanh toán qua cổng (`settleContractPayment`) | `ESCROW` | Có | 5.000.000 | `— received` |
| | | `PT.PENDING` | Có | 4.500.000 | `— PT share` |
| | | `REV.PENDING` | Có | 500.000 | `— platform share` |
| J1 | Buổi 1 xác nhận (`SESSION_RELEASE:S1`); quỹ trước = 0, còn thiếu 500.000 → giữ cả 450.000 | `PT.PENDING` | Nợ | 450.000 | `— release to available` |
| | | `PT.PENDING` | Có | 450.000 | `— PT holdback retained` ← **quỹ sinh ra** |
| | | (không dòng `PT.AVAILABLE`: `released` = 0) | | | |
| | | `REV.PENDING` | Nợ | 50.000 | `— release to available` |
| | | `REV.AVAILABLE` | Có | 50.000 | `— session earned` |
| J2 | Buổi 2 (`SESSION_RELEASE:S2`); quỹ trước = 450.000, còn thiếu 50.000 | `PT.PENDING` | Nợ | 450.000 | `— release to available` |
| | | `PT.PENDING` | Có | 50.000 | `— PT holdback retained` ← quỹ đầy 500.000 |
| | | `PT.AVAILABLE` | Có | 400.000 | `— session earned` |
| | | `REV.PENDING` / `REV.AVAILABLE` | Nợ / Có | 50.000 / 50.000 | như J1 |
| J3, J4 | Buổi 3, 4; quỹ đã đầy | `PT.PENDING` | Nợ | 450.000 (mỗi buổi) | `— release to available` |
| | | `PT.AVAILABLE` | Có | 450.000 (mỗi buổi) | `— session earned` |
| | | `REV.PENDING` / `REV.AVAILABLE` | Nợ / Có | 50.000 / 50.000 (mỗi buổi) | |

**Bảng 3.2b — trạng thái sau mỗi bước.** "Quỹ" và "chưa kiếm" là hai phần của cùng `PT.PENDING` dưới `T`.

| Sau bước | `PT.PENDING` dưới `T` | trong đó quỹ | trong đó chưa kiếm | `PT.AVAILABLE` (dòng của `T`) | `REV.PENDING` | `REV.AVAILABLE` | `KHÁCH` | `ESCROW` | **Σ quyền đòi** |
|---|---|---|---|---|---|---|---|---|---|
| J0 | 4.500.000 | 0 | 4.500.000 | 0 | 500.000 | 0 | 0 | 5.000.000 | **5.000.000** |
| J1 | 4.500.000 | 450.000 | 4.050.000 | 0 | 450.000 | 50.000 | 0 | 5.000.000 | **5.000.000** |
| J2 | 4.100.000 | 500.000 | 3.600.000 | 400.000 | 400.000 | 100.000 | 0 | 5.000.000 | **5.000.000** |
| J3 | 3.650.000 | 500.000 | 3.150.000 | 850.000 | 350.000 | 150.000 | 0 | 5.000.000 | **5.000.000** |
| J4 | 3.200.000 | 500.000 | 2.700.000 | 1.300.000 | 300.000 | 200.000 | 0 | 5.000.000 | **5.000.000** |

(Σ quyền đòi = `PT.PENDING` + `PT.AVAILABLE` + `REV.PENDING` + `REV.AVAILABLE` + `KHÁCH`.) Điểm cần nhìn: ở J1 số dư `PT.PENDING` KHÔNG đổi (Nợ 450.000 rồi Có 450.000); nghĩa là tạo quỹ không tạo tiền và không di chuyển tiền sang ngăn khác.

### 3.3 Trả đền 200.000đ rồi quyết định thứ hai (J5, J6): ngăn nào giảm, trần cộng dồn

Điều kiện (thiết kế N2, mục 7.2): sau J4, đã dạy 4 buổi, giá trị chưa dùng = 6 × 500.000 = 3.000.000, nên giới hạn chính sách (D22, `holdbackCompensationTarget` = `ceil(h × base)`, `PS/services/contract-money.ts:358-366`) = 300.000; quỹ thật = 500.000.

| Bước | Quyết định | Phép tính `min(quỹ thật, giới hạn còn lại, nghĩa vụ hợp lệ)` | Dòng sổ cái |
|---|---|---|---|
| J5 | Admin phán nghĩa vụ #1: **200.000** | `min(500.000; 300.000 − 0; 200.000)` = **200.000**, chưa giải quyết 0 | `PT.PENDING` **Nợ 200.000** `— PT holdback paid to client` (hậu tố mới; hoặc `PT.HOLDBACK` Nợ nếu duyệt M1). `KHÁCH` **Có 200.000** `— compensation for … (admin decision, from the PT's held-back earnings)`. **Không** dòng nào ở `PT.AVAILABLE`, `REV.*`, `ESCROW`. |
| J6 | Admin phán nghĩa vụ #2: **150.000** | `min(300.000; 300.000 − 200.000 = 100.000; 150.000)` = **100.000**; chưa giải quyết **50.000** | `PT.PENDING` **Nợ 100.000** cùng hậu tố; `KHÁCH` **Có 100.000**. Nghĩa vụ #2 ghi "trả một phần", phần 50.000 là MỘT dòng ghi nhận ở bảng nghĩa vụ, **không** dòng sổ cái, **không** nợ PT, **không** nền tảng ứng. |

Trạng thái: sau J5, `PT.PENDING` = 3.000.000 (quỹ còn 300.000, chưa kiếm 2.700.000), `KHÁCH` = 200.000. Sau J6, `PT.PENDING` = 2.900.000 (quỹ còn 200.000), `KHÁCH` = 300.000. Σ quyền đòi vẫn 5.000.000 (ESCROW không đổi: tiền mặt không rời nền tảng, quyền đòi chuyển từ PT sang khách).

**Chứng minh trần cộng dồn:** Σ đã đền = 300.000 ≤ giới hạn chính sách 300.000 ≤ `H` = 500.000 ≤ tổng khách đã trả 5.000.000. Quyết định thứ ba, dù admin nhập bao nhiêu, nhận `min(200.000; 300.000 − 300.000 = 0; …)` = 0: bị từ chối với "đã hết giới hạn", không dòng sổ cái. Nếu quỹ là ràng buộc chặt (ví dụ quỹ còn 100.000, giới hạn còn 300.000, admin nhập 150.000) thì trả 100.000 và ghi phần chưa giải quyết 50.000.

### 3.4 Quỹ còn lại sau đền; không bơm lại (N1); kết thúc hợp đồng (J7–J8)

Quỹ còn 200.000, đã đền 300.000. **Quy tắc N1:** khi tính phần giữ của buổi sau, "đã góp vào quỹ" = `potOf + paidFromPot` (= 200.000 + 300.000 = 500.000 = `H`), nên phần giữ = 0.

| | Mã HIỆN TẠI (không có N1) | Thiết kế N1 |
|---|---|---|
| Buổi 5: quỹ trước | `ptHeld` = 200.000 | `potOf + paidFromPot` = 500.000 |
| `room = H − trước` | 300.000 | 0 |
| Giữ vào quỹ / về `PT.AVAILABLE` | giữ **300.000**, trả 150.000 (quỹ đầy lại 500.000) | giữ 0, trả **450.000** |

(`splitReleaseWithHoldback`, `PS/services/contract-money.ts:309-318`, gọi ở `PS/services/contract-ledger.service.ts:489-492`.) Hành vi hiện tại là "bơm lại" bị D46 N1 cấm.

Buổi 5–10 (mỗi buổi, theo N1): `PT.PENDING` Nợ 450.000, `PT.AVAILABLE` Có 450.000, `REV.PENDING` Nợ 50.000, `REV.AVAILABLE` Có 50.000. Sau buổi 10: `PT.PENDING` = 200.000 (chỉ còn quỹ), `PT.AVAILABLE` = 1.300.000 + 6 × 450.000 = **4.000.000**, `REV.AVAILABLE` = 500.000, `KHÁCH` = 300.000. Σ = 200.000 + 4.000.000 + 0 + 500.000 + 300.000 = **5.000.000**.

**J8 — hợp đồng hoàn tất (`terminateContract` lý do `COMPLETED`, khoá `CONTRACT_TERMINATE:<id>`).** Quyền lợi PT `E` = `ptRate × (P − 0 − hoàn 0)` = 4.500.000; đã giải phóng `R` = 4.000.000 (`releasedToPt`); đã đền từ quỹ 300.000. Công thức (mục 7.8): `gap = E − R − paidFromPot` = 4.500.000 − 4.000.000 − 300.000 = **200.000**.

| Dòng | Nợ / Có | Số tiền | Mô tả |
|---|---|---|---|
| `PT.PENDING` | Nợ | 200.000 | `— final settlement` |
| `PT.AVAILABLE` | Có | 200.000 | `— final settlement` |

Kết quả cuối: `PT.AVAILABLE` 4.200.000 (= 4.500.000 − 300.000 đã đền); `REV.AVAILABLE` 500.000; `KHÁCH` 300.000; `ESCROW` 5.000.000; Σ = **5.000.000**; `PT.PENDING` dưới `T` = 0.

Nếu KHÔNG có phép trừ `paidFromPot` (hôm nay chưa có): `gap` = 500.000 nhưng `PT.PENDING` chỉ còn 200.000 → báo thiếu 300.000 → `coverShortfall` (nền tảng ứng 300.000, ghi nợ PT) — đúng điều D20/D48 cấm. Vì vậy phép trừ `paidFromPot` là điều kiện bắt buộc cùng lúc với việc đền giữa chừng (mục 7.8).

**Kết thúc bằng hủy của PT (đối chiếu với mã hiện tại, không có quyết định nào ở J5–J6).** Sau J4, PT hủy (`PT_CANCELLED`): hoàn 100% phần chưa dùng 3.000.000; quyền lợi PT = 0,9 × 2.000.000 = 1.800.000; mục tiêu đền = `ceil(10% × 3.000.000)` = 300.000; `min(300.000; quỹ 500.000; PT còn được trả 1.800.000 − 1.300.000 = 500.000)` = **300.000** (`:997-1000`). Kết quả: khách 3.000.000 + 300.000 = 3.300.000; `PT.AVAILABLE` = 1.300.000 + 200.000 = 1.500.000; nền tảng 200.000; Σ = 5.000.000. Đây là đền TỰ ĐỘNG (D23) — xung đột N3 được nêu ở mục 8.

### 3.5 Ba tính chất cần chứng minh

**(1) Tổng không bao giờ vượt 5.000.000.**
- Mỗi bút toán của hợp đồng là một cặp chuyển giữa các ví (Nợ ví này, Có ví kia) hoặc một cặp tái gắn nhãn trong cùng ngăn (J1, J2); không có thao tác nào ghi Có mà không ghi Nợ đối ứng, ngoại trừ J0 (Có ESCROW 5.000.000 đối ứng ba dòng Có quyền đòi tổng 5.000.000) và rút tiền thật (Nợ quyền đòi + Nợ ESCROW). Bảng 3.2b, 3.3, 3.4 cộng lại đúng 5.000.000 ở mọi bước (chương trình tính độc lập khớp).
- Quỹ là một phần của `PT.PENDING`; việc tạo quỹ không đổi số dư ngăn nào (J1: Nợ 450.000 rồi Có 450.000).
- `ĐỌC DB DEV`: với cả 24 giao dịch thanh toán hợp đồng PT trên DB dev (giao dịch có dòng "— PT share"), tổng dòng sổ cái của các ví KHÁC ESCROW mang cùng `transactionId` đúng bằng tổng dòng của ESCROW mang `transactionId` đó (24/24 bằng, 0 lệch). Bất biến toàn hệ thống cũng cân: ESCROW 107.447.000 = Σ ví khác 107.447.000 (kể cả 7 sổ phụ âm ở 3.6). Đây là bằng chứng "không tạo tiền ngoài số khách trả" trên dữ liệu dev, không phải kiểm thử.

**(2) Một đồng không đồng thời là AVAILABLE của PT và quỹ còn dùng được.**
- Trong `releaseSession`, số `moving` rời `PT.PENDING` đúng một lần (một dòng Nợ) và vào đúng một nơi: phần giữ quay lại `PT.PENDING` (nhãn "retained") hoặc phần còn lại vào `PT.AVAILABLE`; `toAvailable + heldNow = moving` (`:486-506`, và `splitReleaseWithHoldback`: `held = clamp(target − heldBefore, 0, share)`, `released = share − held`).
- Quỹ chỉ chuyển sang `PT.AVAILABLE` qua hai cửa, mỗi cửa đồng thời xoá quỹ: `releasePtHoldback` (Nợ PENDING + Có AVAILABLE cùng mô tả `HOLDBACK_RELEASED_SUFFIX`; dòng Nợ đó chính là thứ trừ quỹ trong `ptHeld`, `:1218-1222`) và bước top-up cuối của `terminateContract` (lấy từ PENDING, sau đó rút cạn PENDING của hợp đồng, `:1081-1094`).
- Hạn chế đã nêu: sau khi chuyển sang `PT.AVAILABLE` (gộp chung mọi hợp đồng) không còn nhận ra đồng nào của hợp đồng nào bằng số dư; chỉ còn dấu vết ở các dòng mang `T`. Điều này đúng với yêu cầu "không đóng băng tiền đã kiếm", nhưng cũng nghĩa là mọi nguồn trừ từ `PT.AVAILABLE` (mục 8) KHÔNG phân biệt được tiền của hợp đồng nào.

**(3) Quyền sở hữu từng đồng, không chỉ tổng.** Với trạng thái J4 (`TÍNH TAY`):

| Đồng | Nằm ở | Chứng cứ trong sổ cái (dòng mang `T`) | Thuộc hợp đồng |
|---|---|---|---|
| 500.000 quỹ | `PT.PENDING` | hai dòng Có "retained" 450.000 + 50.000 (J1, J2), không dòng "released" | `T` |
| 2.700.000 chưa kiếm | `PT.PENDING` | tổng dòng của `T` = 4.500.000 (J0) − 4 × 450.000 (Nợ release) + 500.000 (Có retained) = 3.200.000; trừ quỹ 500.000 = 2.700.000 | `T` |
| 1.300.000 đã kiếm | `PT.AVAILABLE` | 400.000 + 450.000 + 450.000 (mô tả "session earned" mang `T`) | `T` (nhưng đã gộp vào số dư chung của PT) |
| 300.000 / 200.000 | `REV.PENDING` / `REV.AVAILABLE` | | `T` |

Quyền sở hữu quỹ theo hợp đồng nằm ở TRƯỜNG `transactionId` của từng dòng, không ở số dư (số dư `PT.PENDING` là số gộp của mọi hợp đồng của PT; dòng `balance_before/after` của ví không cho biết gì về từng hợp đồng). Đó là lý do mọi hàm đọc quỹ phải lọc theo `(ví, ngăn, T)`.

### 3.6 Kết luận: cấu trúc hiện tại có bảo đảm được không?

**Không đủ.** Quyền sở hữu quỹ theo hợp đồng ĐÚNG khi mọi người viết mã đều tuân thủ quy ước, nhưng KHÔNG được bảo đảm bằng cấu trúc. Cụ thể và chính xác:

- **W1. Quỹ là số suy ra từ chuỗi mô tả, không phải số dư.** Đổi một chữ trong `HOLDBACK_RETAINED_SUFFIX`/`HOLDBACK_RELEASED_SUFFIX` (`:120-121`) làm quỹ về 0 hoặc đổi nghĩa mà không có bài báo lỗi nào. Chú thích trong mã thừa nhận (`:140-144`). Dòng 0 đồng `HOLDBACK_SETTLED_SUFFIX` (`:131`) là một cờ thứ hai cũng nằm trong mô tả; `ptHeld` KHÔNG trừ nó, hàm nào quên kiểm `holdbackWasReleased` trước khi gọi `ptHeld` sẽ đọc quỹ ma.
- **W2. Có thể đếm trùng (cùng một đồng vừa là "quỹ" vừa là "chưa kiếm của buổi sau").** `ptHeld = min(quỹ suy ra, ownPending)`, trong đó `ownPending` gồm CẢ phần chưa kiếm. Một khoản trừ vào `PT.PENDING` KHÔNG tiêu thụ buổi nào thì không giảm quỹ suy ra, trong khi tiền thật đã mất. Ví dụ `TÍNH TAY`: sau J4, PT đến muộn ở buổi 5 → `compensateLateArrival` trừ PT 225.000 vào `PT.PENDING` (nền tảng 25.000, khách nhận 250.000; `:675-684`, quyền lợi của khách KHÔNG bị tiêu thụ: `contract-money.ts:567-576`). `PT.PENDING` còn 2.975.000 nhưng cần 2.700.000 (6 buổi chưa kiếm) + 500.000 (quỹ) = 3.200.000: thiếu 225.000, vậy mà `ptHeld` vẫn đọc 500.000 (vì 2.975.000 > 500.000). Nếu bây giờ admin phán đền 500.000 theo "số dư quỹ thật" mà hàm trả về, các buổi sau của PT sẽ bị kẹp (`moving = min(ownPending, share)`, `:475-476`) — tiền đền thực ra được trả bằng thu nhập của các buổi PT đã dạy, không phải bằng quỹ. Cùng hợp đồng, không lấy hợp đồng khác, nhưng sai định nghĩa "quỹ thật" của N2 và N7.
- **W3. Hai nguồn sự thật cho "đã giải phóng".** `terminateContract` nhận `alreadyReleased` từ user-service (`Contract.releasedToPt`, `US/services/contract-payout.service.ts` `settleContractTermination`), không suy từ sổ cái. Nếu user-service ghi tăng `releasedToPt` hai lần cho một buổi (sập sau lệnh tăng, trước khi đánh dấu SETTLED; sweep thử lại, payment-service phát lại kết quả, user-service tăng lần nữa — điểm 6c bản 2), `gap` của PT nhỏ đi 450.000; 450.000 còn nằm trong `PT.PENDING` bị rút cạn thành "forfeited share" vào `REV.AVAILABLE` (`:1119-1123`): tiền của PT chuyển sang nền tảng mà không ai quyết. Đây là việc của F4.
- **W4. Không có ràng buộc DB cho sổ phụ.** Không có điều kiện "Σ dòng (ví, PENDING, T) ≥ 0" ở tầng DB hay tầng `applyDebit` (chỉ kiểm số dư gộp của ngăn, `PS/services/wallet.service.ts:88`). `ĐỌC DB DEV`: **7 sổ phụ (ví, PENDING, T) đang ÂM** — PT `f506697b` giao dịch `349b8fa3` −2.025.000; PT `e81ef52a` giao dịch `f3eea0b7` −1.440.000 và `349ac317` −1.440.000; `REVENUE` giao dịch `349b8fa3` −225.000, `f3eea0b7` −190.000, `4802a975` −130.000, `349ac317` −50.000. Đó là dấu vết lỗi "vét tiền chờ" đã sửa ở commit `2578561` (một hợp đồng rút tiền chờ của hợp đồng khác). Bất biến toàn hệ thống vẫn cân, nhưng quyền sở hữu theo hợp đồng đã sai ở 7 sổ phụ này, và `ownPending` chỉ che nó bằng cách kẹp về 0 (`:94-99`).
- **W5. Đường trừ ngoài quỹ vẫn chạm được vào PENDING chứa quỹ**: vắng buổi/đến muộn (W2), top-up cuối, hoàn tiền; không có hàm nào được phép nói "đừng chạm phần quỹ" ngoại trừ cách trừ `reserve`/`keepBack` thủ công trong `terminateContract`.

Kết luận cho câu hỏi của chủ sở hữu: *tổng* và *không đồng thời AVAILABLE* đúng trong mọi đường mã đã đọc; *quyền sở hữu từng đồng của quỹ* chỉ đúng nếu không có khoản trừ PENDING ngoài ý định (W2) và không có số đếm lệch giữa hai dịch vụ (W3). Vì vậy cần thay đổi sổ cái tối thiểu dưới đây TRƯỚC khi bật 10%.

### 3.7 Thay đổi sổ cái tối thiểu đề xuất

**Trạng thái: M0 / M1 CHƯA ĐƯỢC CHỌN (D56); Ngài quyết.** Giải thích bằng ví dụ 5.000.000đ / 10 buổi (mười câu hỏi, bảng đối soát, khuyến nghị, đánh đổi): `docs/FINANCIAL_HOLD_M0_VS_M1.md`. Chữ "khuyến nghị M1" trong bản 3 là khuyến nghị, không phải quyết định.

| Phương án | Nội dung | Ưu | Nhược |
|---|---|---|---|
| **M0 — không đổi schema** | Giữ hậu tố mô tả; thêm `HOLDBACK_PAID_SUFFIX`; thêm kiểm bất biến: sau mỗi thao tác ghi `PT.PENDING` dưới `T` phải còn `ownPending ≥ quỹ suy ra` (ném lỗi, không kẹp); thêm vào đối soát kiểm "(ví,PENDING,T) ≥ 0"; **kèm "sàn quỹ" ở mọi hàm đụng PENDING (mục 5.5, 6 dòng 2): chỉ kiểm bất biến thì ca phí đến muộn bị CHẶN thanh toán buổi cuối chứ không được xử lý (ví dụ số: `FINANCIAL_HOLD_M0_VS_M1.md` mục 3.11-c)** | Không migration | W1 và W2 chỉ được che bằng kiểm tra; vẫn so khớp chuỗi; phí đến muộn khi quỹ chiếm hết PENDING sẽ bị chặn thay vì xử lý |
| **M1 — ngăn thứ tư `HOLDBACK`** (bản 3 đề xuất; CHƯA CHỌN) | Thêm giá trị `HOLDBACK` vào enum `LedgerBucket`, cột `holdback_balance` (mặc định 0) vào `wallets`; quỹ = Σ dòng `HOLDBACK` của ví PT dưới `T`; `ownPending` không còn chứa quỹ | Quỹ là SỐ DƯ (cộng dòng), không phải chuỗi; W1, W2, W5 biến mất theo cấu trúc; `terminateContract` hết cần `reserve`/dấu `HOLDBACK_SETTLED`; kiểm "quỹ ≥ 0 theo hợp đồng" là một phép cộng | Có migration (cộng cột + enum); phải sửa `readBucket/writeBucket/bucketUpdate`, `reconcile.service.ts` (cộng thêm ngăn), kiểm thử; cùng dạng với ngăn `LOCKED` đã thêm ở cụm F nên bán kính ảnh hưởng đã biết |
| M2 — ví quỹ riêng cho từng hợp đồng | Mỗi hợp đồng một ví loại `CONTRACT_GUARANTEE` | Số dư riêng thật sự từng hợp đồng | Thêm một khoá ví vào MỌI thao tác của hợp đồng; hàng nghìn ví; đổi enum chủ ví và đối soát. **Không đề xuất** |

**Bút toán cho cùng kịch bản, theo M1** (khác M0 ở các dòng in đậm): J1: `PT.PENDING` Nợ 450.000; **`PT.HOLDBACK` Có 450.000** `— PT holdback retained`; J2: `PT.PENDING` Nợ 450.000, **`PT.HOLDBACK` Có 50.000**, `PT.AVAILABLE` Có 400.000; J5: **`PT.HOLDBACK` Nợ 200.000**, `KHÁCH` Có 200.000; J6: **`PT.HOLDBACK` Nợ 100.000**, `KHÁCH` Có 100.000; J8: **`PT.HOLDBACK` Nợ 200.000** `— holdback returned to PT`, `PT.AVAILABLE` Có 200.000; top-up từ `PT.PENDING` = `E − R − quỹ còn lại − đã đền` = 4.500.000 − 4.000.000 − 200.000 − 300.000 = 0. Trong M1, phí đến muộn ở buổi 5 chỉ trừ vào `PT.PENDING` (phần chưa kiếm), không chạm quỹ; nếu `PT.PENDING` không đủ thì thiếu được GHI (phần chưa giải quyết), không lấy quỹ, không lấy `PT.AVAILABLE`.

**Dữ liệu cũ:** `ĐỌC DB DEV`: 0 dòng sổ cái nào có chữ "PT holdback" (0/702); mọi hợp đồng hiện có tỷ lệ giữ 0 (`US/services/pt-holdback-rate.ts:23-25`). Vì vậy M1 KHÔNG cần di chuyển dữ liệu cũ trên dev. Trên các môi trường khác: chạy truy vấn 3.8 (Q3) trước; nếu thấy dòng quỹ, thêm một script một lần chuyển Σ(retained − released) của từng `T` từ `PENDING` sang `HOLDBACK` bên trong khoá ví (script mặc định chạy thử, như script gym-service).

**Hành vi không đổi khi tỷ lệ giữ = 0:** M1 không đụng đường mã của hợp đồng không quỹ (HT-26 ghim: kết quả mọi hàm y như trước).

**Ngài chọn M0 hay M1 (D56: CHƯA CHỌN).** Bản 3 khuyến nghị M1 (chỉ là khuyến nghị). Nếu Ngài chọn M0 (không migration ở sổ cái), đơn vị U1 ở mục 16.4 chuyển thành "M0 + kiểm bất biến + sàn quỹ ở mọi hàm", và W2 được xử lý bằng cách CHẶN/chừa sàn thay vì sửa tận gốc. Ngài duyệt ở mục 18.0.

### 3.8 Truy vấn chỉ-đọc để kiểm chứng (chạy được trên mọi môi trường)

```sql
-- Q1. Sổ phụ (ví, ngăn PENDING, hợp đồng) âm: quyền sở hữu theo hợp đồng đã sai
SELECT w.owner_type, w.owner_id, e.transaction_id,
       SUM(CASE WHEN e.entry_type='CREDIT' THEN e.amount ELSE -e.amount END) AS pending_of_txn
FROM wallet_ledger_entries e JOIN wallets w ON w.id = e.wallet_id
WHERE e.bucket = 'PENDING'
GROUP BY 1,2,3 HAVING SUM(CASE WHEN e.entry_type='CREDIT' THEN e.amount ELSE -e.amount END) < 0;

-- Q2. Bất biến toàn hệ thống (khớp reconcile.service.ts)
SELECT (SELECT SUM(available_balance) FROM wallets WHERE owner_type='PLATFORM' AND owner_id='ESCROW') AS escrow,
       (SELECT SUM(available_balance+pending_balance+locked_balance) FROM wallets
         WHERE NOT (owner_type='PLATFORM' AND owner_id='ESCROW')) AS claims;

-- Q3. Quỹ suy ra theo hợp đồng (hôm nay, theo hậu tố)
SELECT e.transaction_id,
       SUM(CASE WHEN e.entry_type='CREDIT' AND e.description LIKE '% — PT holdback retained' THEN e.amount
                WHEN e.entry_type='DEBIT'  AND e.description LIKE '% — PT holdback released (no activity)' THEN -e.amount
                ELSE 0 END) AS derived_pot
FROM wallet_ledger_entries e JOIN wallets w ON w.id = e.wallet_id
WHERE e.bucket='PENDING' AND w.owner_type='PT' GROUP BY 1 HAVING SUM(CASE WHEN e.description LIKE '%PT holdback%' THEN 1 ELSE 0 END) > 0;

-- Q4. Bảo toàn theo hợp đồng: tổng dòng ESCROW = tổng dòng các ví khác, cho từng giao dịch thanh toán hợp đồng PT
WITH ct AS (SELECT DISTINCT transaction_id t FROM wallet_ledger_entries WHERE description LIKE '% — PT share')
SELECT e.transaction_id,
  SUM(CASE WHEN w.owner_type='PLATFORM' AND w.owner_id='ESCROW' THEN (CASE WHEN e.entry_type='CREDIT' THEN e.amount ELSE -e.amount END) ELSE 0 END) AS escrow_rows,
  SUM(CASE WHEN NOT (w.owner_type='PLATFORM' AND w.owner_id='ESCROW') THEN (CASE WHEN e.entry_type='CREDIT' THEN e.amount ELSE -e.amount END) ELSE 0 END) AS other_rows
FROM wallet_ledger_entries e JOIN wallets w ON w.id = e.wallet_id
WHERE e.transaction_id IN (SELECT t FROM ct) GROUP BY 1;
```

Kết quả trên DB dev (chỉ-đọc, trong phiên này): Q1 = 7 hàng âm (liệt kê ở W4); Q2 = 107.447.000 / 107.447.000; Q3 = 0 hàng; Q4 = 24/24 giao dịch cân. Hai bài kiểm thử tự động thay thế cho truy vấn này nằm ở HT-70, HT-71 (mục 17).


---

## 4. Bản ghi hold và nghĩa vụ — nằm ở payment-service

payment-service sở hữu tiền, nên hold, nghĩa vụ và sự kiện ở đây. user-service KHÔNG sao chép TRẠNG THÁI hold (không có cột `financialHoldActive` — sẽ là nguồn sự thật thứ hai). Nó chỉ giữ MỆNH LỆNH đã gửi (`ContractHoldRequest`, mục 11) — giống bảng `PtDeactivationCall` của auth-service: lệnh là của người gửi, trạng thái tiền là của người giữ sổ. Muốn biết hold thì hỏi payment-service.

### 4.1 Đơn vị quản lý

| Đơn vị | Là gì | Khoá |
|---|---|---|
| Hợp đồng | Một hold ACTIVE tối đa cho mỗi `T`; đóng băng quỹ A của hợp đồng đó | chỉ mục duy nhất một phần `(transaction_id) WHERE status='ACTIVE'` |
| Nghĩa vụ | Một khoản có thể phải đền, gắn một căn cứ đã được user-service xác minh; chỉ được phán MỘT lần | `(hold_id, obligation_key)` duy nhất; `obligation_key = "<basisType>:<basisRef>"` |
| Buổi (loại B) | Một buổi chờ/tranh chấp; không có bản ghi hold, định danh bằng `sessionId` | khoá sổ cái `SESSION_RELEASE:`/`PT_NO_SHOW:`/`UNRESOLVED_SESSION:<sessionId>` đã có |

### 4.2 Phác thảo schema (`THIẾT KẾ`, chỉ thêm mới, không sửa bảng cũ)

Khác bản 2 (đánh dấu ◀): người phụ trách, ngày bắt đầu, hạn xem xét, gia hạn (N4); nghĩa vụ được tạo ngay lúc mở hold ở trạng thái `OPEN` (hold luôn gắn một nghĩa vụ, N4); TÁCH kết luận vi phạm khỏi sự kiện và khỏi giải ngân (N3); lưu rõ phần chưa giải quyết (N2); mã yêu cầu của user-service để tạo hold chống lặp (N6).

```prisma
enum ContractHoldStatus { ACTIVE CLOSED }

model ContractMoneyHold {
  id            String             @id @default(uuid())
  transactionId String             @map("transaction_id")  // = Contract.paymentTransactionId
  contractId    String             @map("contract_id")     // kiểm: PaymentTransaction.relatedEntityId == contractId
  status        ContractHoldStatus @default(ACTIVE)
  requestId     String             @unique @map("request_id")  // ◀ = ContractHoldRequest.id của user-service; gọi lại cùng mã → trả hold cũ
  basisType     String             @map("basis_type")      // căn cứ MỞ hold: SESSION_DISPUTE | SESSION_NO_SHOW_REPORT | CONTRACT_RESTRICTION
  basisRef      String             @map("basis_ref")       // sessionId | restrictionId
  openedBy      String             @map("opened_by")       // adminId do máy chủ lấy từ danh tính, KHÔNG từ body
  openReason    String             @map("open_reason")
  assigneeAdminId String           @map("assignee_admin_id") // ◀ người phụ trách; mặc định = openedBy; đổi được (sự kiện ASSIGNED)
  openedAt      DateTime           @default(now()) @map("opened_at")   // ◀ ngày bắt đầu (dùng giờ của payment-service)
  dueAt         DateTime           @map("due_at")          // ◀ = openedAt + HOLD_REVIEW_DAYS (mặc định 14); gia hạn làm dời
  overdueFlaggedAt DateTime?       @map("overdue_flagged_at") // ◀ lần đầu bị gắn cờ quá hạn (không tự làm gì với tiền)
  extensionCount Int               @default(0) @map("extension_count") // ◀
  potAtOpen     Decimal            @db.Decimal(14, 2) @map("pot_at_open")  // quỹ lúc mở, chỉ để kiểm toán
  endedAt       DateTime?          @map("ended_at")        // đặt bởi terminateContract trong cùng giao dịch khi hợp đồng kết thúc lúc hold còn hoạt động
  endReason     String?            @map("end_reason")
  compensatedTotal   Decimal       @default(0) @db.Decimal(14, 2) @map("compensated_total") // Σ đã đền, kiểm toán
  releasedToPtTotal  Decimal       @default(0) @db.Decimal(14, 2) @map("released_to_pt_total")
  closedAt      DateTime?          @map("closed_at")
  closedBy      String?            @map("closed_by")
  closeKind     String?            @map("close_kind")      // ◀ BASIS_CLEARED_NO_OBLIGATION | OBLIGATIONS_RULED | CONTRACT_ENDED_RELEASED | ADMIN_CLOSED
  closeReason   String?            @map("close_reason")
  createdAt     DateTime           @default(now()) @map("created_at")
  updatedAt     DateTime           @updatedAt @map("updated_at")

  obligations ContractHoldObligation[]
  events      ContractMoneyHoldEvent[]
  // DB (viết tay trong migration, như pt_restrictions_one_active_*):
  //   CREATE UNIQUE INDEX contract_money_holds_one_active ON contract_money_holds (transaction_id) WHERE status = 'ACTIVE';
  //   CHECK (compensated_total >= 0 AND released_to_pt_total >= 0 AND due_at >= opened_at)
  @@index([contractId])
  @@index([status, dueAt])      // ◀ hàng đợi ưu tiên: quá hạn trước
  @@map("contract_money_holds")
}

enum HoldObligationState { OPEN FINDING_RECORDED PAID PARTIALLY_PAID NOT_AWARDED }  // ◀ FINDING_RECORDED = đã có kết luận vi phạm, chưa giải ngân (N3)

model ContractHoldObligation {
  id             String                @id @default(uuid())
  holdId         String                @map("hold_id")
  obligationKey  String                @map("obligation_key")   // "<basisType>:<basisRef>", user-service xác minh căn cứ thuộc đúng hợp đồng
  state          HoldObligationState   @default(OPEN)            // ◀ tạo ngay khi mở hold
  findingKind    String?               @map("finding_kind")     // ◀ KẾT LUẬN vi phạm (tách khỏi sự kiện và khỏi giải ngân, N3): PT_ABANDONMENT | REPEATED_NO_SHOW | TERMINATION_PT_FAULT | NO_VIOLATION
  findingNote    String?               @map("finding_note")     // ◀ bắt buộc, nêu chứng cứ
  findingBy      String?               @map("finding_by")
  findingAt      DateTime?             @map("finding_at")
  policyBasis    String?               @map("policy_basis")     // điều khoản đã ký làm căn cứ trần (mục 7.2); SUY từ findingKind, không do admin nhập tự do
  decisionId     String?               @map("decision_id")      // khoá bấm của giao diện, chống bấm đúp
  policyLimitAtRuling Decimal?         @db.Decimal(14, 2) @map("policy_limit_at_ruling") // giới hạn chính sách CÒN LẠI lúc phán, để kiểm toán
  potAtRuling    Decimal?              @db.Decimal(14, 2) @map("pot_at_ruling")          // quỹ thật lúc phán
  awardedAmount  Decimal?              @db.Decimal(14, 2) @map("awarded_amount")         // số admin quyết (không bao giờ do hệ thống tính)
  paidAmount     Decimal?              @db.Decimal(14, 2) @map("paid_amount")            // số THỰC đã ghi sổ
  unresolvedAmount Decimal?            @db.Decimal(14, 2) @map("unresolved_amount")      // ◀ awarded − paid; LƯU để không ai tính lại sai; KHÔNG phải nợ
  actorUserId    String?               @map("actor_user_id")
  reason         String?
  ledgerOpKey    String?               @map("ledger_op_key")
  openedAt       DateTime              @default(now()) @map("opened_at")
  ruledAt        DateTime?             @map("ruled_at")

  hold ContractMoneyHold @relation(fields: [holdId], references: [id])
  @@unique([holdId, obligationKey])
  @@unique([holdId, decisionId])
  @@map("contract_hold_obligations")
  // CHECK: state='OPEN' ⇒ finding_kind IS NULL AND ruled_at IS NULL; state='FINDING_RECORDED' ⇒ finding_kind IS NOT NULL AND finding_kind<>'NO_VIOLATION' AND awarded_amount IS NULL;
  //        state IN ('PAID','PARTIALLY_PAID') ⇒ finding_kind IS NOT NULL AND finding_kind<>'NO_VIOLATION' AND awarded_amount IS NOT NULL;
  //        state='NOT_AWARDED' ⇒ ruled_at IS NOT NULL;
  //        paid_amount BETWEEN 0 AND awarded_amount; unresolved_amount = awarded_amount − paid_amount;
  //        state='PAID' ⇒ unresolved_amount = 0; state='PARTIALLY_PAID' ⇒ unresolved_amount > 0
}

model ContractMoneyHoldEvent {
  id          String   @id @default(uuid())
  holdId      String   @map("hold_id")
  kind        String   // OPENED | BASIS_ADDED | ASSIGNED | EXTENDED | OVERDUE_FLAGGED | FINDING_RECORDED | OBLIGATION_RULED | CARVED_AT_TERMINATION | BASIS_CLEARED | RELEASED_TO_PT | CLOSED
  obligationId String? @map("obligation_id")
  amount      Decimal  @db.Decimal(14, 2)   // 0 cho sự kiện không di chuyển tiền
  actorUserId String   @map("actor_user_id")
  reason      String?  // BẮT BUỘC với EXTENDED, ASSIGNED, BASIS_CLEARED, CLOSED
  ledgerOpKey String?  @map("ledger_op_key")
  createdAt   DateTime @default(now()) @map("created_at")

  hold ContractMoneyHold @relation(fields: [holdId], references: [id])
  @@index([holdId, createdAt])
  @@map("contract_money_hold_events")
}
```

Chỉ thêm bảng/enum mới; không cột mới ở bảng cũ (trừ M1 nếu duyệt, mục 3.7: một cột `holdback_balance` và một giá trị enum ngăn); không đổi `WalletLedgerEntry`. Migration thử trên DB `*_test` dựng bằng `migrate deploy`, viết tay (không `migrate dev`).

### 4.3 Trạng thái — tối thiểu

Hold chỉ có 2 trạng thái lưu (`ACTIVE`, `CLOSED`); nghĩa vụ có 5 (`OPEN`, `FINDING_RECORDED`, `PAID`, `PARTIALLY_PAID`, `NOT_AWARDED`). Các tên như "đã bàn giao", "quá hạn", "đã hết căn cứ" là trạng thái SUY RA (`dueAt < now`, `overdueFlaggedAt`, mọi nghĩa vụ không còn `OPEN`). Lý do: mỗi trạng thái lưu thêm là một chỗ có thể lệch với sổ cái; số tiền thật luôn được đọc lại từ sổ cái (mục 5.3).

### 4.4 Đáp ứng N4 — bảng đối chiếu

| Yêu cầu N4 | Cột / cơ chế |
|---|---|
| Phải có căn cứ | `basisType` + `basisRef` (không NULL), do user-service tự xác minh từ DB của nó |
| Hợp đồng + nghĩa vụ | `transactionId`, `contractId`; một dòng `ContractHoldObligation` `OPEN` tạo cùng lúc với hold |
| Ngày bắt đầu | `openedAt` |
| Người phụ trách | `assigneeAdminId`; đổi phải có lý do (`ASSIGNED`) |
| Quá 14 ngày → cảnh báo + hàng đợi ưu tiên | `dueAt`, `overdueFlaggedAt`, chỉ mục `(status, dueAt)`; tiến trình quét ở mục 7.6 |
| Gia hạn phải có lý do | sự kiện `EXTENDED` với `reason` không rỗng; `extensionCount` |
| Quá hạn ≠ PT có lỗi | không có trường nào gắn "lỗi" vào quá hạn; quá hạn không đổi tiền, không đổi trạng thái PT/hợp đồng, không thông báo cho khách theo lối ám chỉ lỗi |
| Hết căn cứ → nhả đúng trạng thái hợp đồng | `closeKind` và mục 7.7 |

---

## 5. Cưỡng chế tại điểm ghi sổ (không có khe hở kiểm–ghi) — giữ từ bản 1, bổ sung 5.5

### 5.1 Bằng chứng khoá hiện có đủ dùng (`CODE AUDIT`)

1. Mọi hàm di chuyển tiền của hợp đồng (`settleContractPayment`, `refundUnactivatedContractPayment`, `releaseSession`, `compensateNoShow`, `compensateLateArrival`, `terminateContract`, `releasePtHoldback`, `resolveUnresolvedSession`) gọi `walletService.withWallets(wallets.all, T, …)` với `wallets.all` gồm ESCROW, REVENUE, ví PT, ví khách (+ gym) (`PS/services/contract-ledger.service.ts:62-63, 227, 313, 452, 579, 666, 979, 1214, 1325`).
2. `withWallets` mở một `prisma.$transaction`, khoá các ví `FOR UPDATE` theo thứ tự id tăng dần rồi mới chạy callback (`PS/services/wallet.service.ts:44-53, 224-248`); không truyền `isolationLevel` nên dùng mặc định Postgres (READ COMMITTED).
3. `withIdempotentLedgerOp` kiểm khoá và ghi kết quả trong cùng `ops.tx` (`PS/services/ledger-idempotency.ts:23-29`).

### 5.2 Quy tắc (`THIẾT KẾ`)

- Mọi thao tác hold (mở, phán nghĩa vụ, đóng, ghi sự kiện) cũng chạy qua `withWallets(wallets.all, T, …)` → cùng tập khoá ví với mọi hàm di chuyển tiền của hợp đồng đó; chúng tuần tự hoá hoàn toàn.
- Mỗi hàm di chuyển tiền, ngay sau khi có khoá và TRƯỚC khi ghi dòng đầu tiên, gọi `readActiveHold(ops.tx, T)` (một `SELECT` chỉ mục duy nhất một phần). Kết quả quyết định nhánh; không có trạng thái được truyền từ ngoài vào.
- Vì hold được mở/đóng sau khi lấy khoá và các hàm khác chỉ chạy sau khi lấy khoá, mọi đường đi có một thứ tự tuyến tính: hoặc hold có trước (hàm thấy hold) hoặc hàm có trước (hold thấy sổ cái sau hàm). Không tồn tại "kiểm ở ngoài rồi ghi sau".
- Hàm KHÔNG xử lý hold mà phát hiện hold (`refundUnactivatedContractPayment`) thì ném lỗi chứ không rút `ownPending`.

### 5.3 Số liệu luôn đọc lại từ sổ cái

Số đang đóng băng = `potOf(T)` đọc trong lúc giữ khoá. `compensatedTotal`/`paidAmount` chỉ là luỹ kế kiểm toán, được đối chiếu với `paidFromPot(T)` của sổ cái bằng kiểm thử (HT-25, HT-71).

### 5.4 Đối soát

Hold không di chuyển tiền khi mở nên không đổi bất biến `ESCROW.available = Σ pending + available + locked` của mọi ví khác (`PS/services/reconcile.service.ts:6-20`). Đền chuyển PENDING PT → AVAILABLE khách, ESCROW không động (cùng dạng hoàn tiền: `PS/services/contract-ledger.service.ts:1096-1100`). Tuỳ chọn thêm kiểm tra đối soát: mọi hold có `compensatedTotal = Σ HOLDBACK_PAID` và `ptHeld ≤ ownPending`.

### 5.5 Bổ sung bản 3 — ba đường duy nhất có thể làm quỹ rời khỏi hợp đồng, và cách mỗi đường thấy hold

Yêu cầu N5/N6 "không giải ngân tiền đang bị giữ hợp lệ" quy về việc liệt kê MỌI cửa mà quỹ của một hợp đồng có thể đi ra, rồi bắt mỗi cửa tự đọc hold dưới khoá. `CODE AUDIT` (`PS/services/contract-ledger.service.ts`) cho thấy hôm nay chỉ có đúng ba cửa:

| Cửa | Hàm | Quỹ đi đâu | Khi có hold ACTIVE |
|---|---|---|---|
| 1 | `terminateContract` (top-up PT ở bước `settleParty`, hoặc `compensation` cho khách khi lý do thuộc `PT_FAULT_REASONS`) | PT hoặc khách | quỹ ở nguyên; không top-up phần quỹ; không tự đền (mục 6 dòng 3) |
| 2 | `releasePtHoldback` (quét 30 ngày) | PT | từ chối, trả `blockedByHold`, KHÔNG ghi dòng "released" |
| 3 | **mới** `hold/:id/close` (hợp đồng đã kết thúc) và `hold/:id/obligations` (đền) | PT hoặc khách | chính là thao tác của admin |

Mọi thao tác khác của hợp đồng (`releaseSession`, `compensateNoShow`, `compensateLateArrival`, `resolveUnresolvedSession`, `refundUnactivatedContractPayment`) không cố ý đụng quỹ. Việc chúng có THỂ vô tình đụng quỹ (vì quỹ nằm lẫn trong PENDING) là lý do để cân nhắc M1 (mục 3.7; chưa chọn, D56); nếu giữ M0 thì mỗi hàm phải trừ "sàn quỹ" như mục 6 dòng 2.

Phía user-service, các hàm gọi cửa 1 và cửa 2 là: `settleContractTermination` (mọi lý do), `contractService.releaseIdleHoldbacks` (quét nhàn rỗi), và hai nơi gửi lại (`session-settlement-sweep` cho `CONTRACT_TERMINATION`). Cổng cục bộ của mục 11 đặt ĐÚNG ở các hàm này, không ở đâu khác.

---

## 6. Bảng luồng tiền — mỗi thao tác khi có hold ACTIVE trên hợp đồng

"H" = `potOf(T)`. Cột "hôm nay" là `CODE AUDIT`; cột "đích" là `THIẾT KẾ`. Số dòng của `PS/services/contract-ledger.service.ts` đã được đối chiếu lại hôm nay.

| # | Thao tác (nơi định nghĩa) | Chạm tiền nào hôm nay | Đích khi hold ACTIVE (và theo N1/N7) | Cưỡng chế |
|---|---|---|---|---|
| 1 | `releaseSession` (`:433-542`; route `PS/routes/internal.routes.ts:470-492`) | PENDING → AVAILABLE phần PT vượt quỹ; PENDING → quỹ phần góp (`:468-506`) | **Chạy bình thường.** Phần vượt mục tiêu về AVAILABLE; phần góp vào quỹ ở lại. **N1:** mục tiêu góp tính `potOf + paidFromPot` (mục 3.4), nên sau khi đã đền, quỹ KHÔNG được lấp lại. Trả thêm `holdActive:true` (chỉ hiển thị) | Không cần chặn. HT-05, HT-72 |
| 2 | `compensateNoShow` (`:563-640`), `compensateLateArrival` (`:650-715`) | Trừ PENDING(T) → trừ AVAILABLE gộp của PT/gym/nền tảng (`:594-603`, `:675-684`) → `coverShortfall`: nền tảng ứng + `PartnerReceivable` (`:620-627`, `:695-702`) | **N7:** chỉ trừ phần chưa kiếm của PENDING(T) (không quỹ). Hết thì **không** lấy AVAILABLE, **không** `coverShortfall`: thao tác bị TỪ CHỐI `INSUFFICIENT_CONTRACT_FUNDS`, rollback toàn bộ, `settleTracked` ghi lỗi, admin thấy ở hàng đợi; khách không được báo "đã bồi thường" (mục 8) | `charge()` bỏ nhánh AVAILABLE; U5 |
| 3 | `terminateContract`, **mọi lý do** (`:933-1182`; route `:592-630`) | Hoàn khách; top-up PT/gym/nền tảng từ PENDING; quỹ trả PT hoặc đền khách (`:992-1000`, `:1107-1113`, `:1081-1094`) | **H nằm nguyên, không top-up, không tự đền**; ghi `endedAt/endReason` vào hold; phần còn lại như cũ. Cộng: `gap = E − R − paidFromPot` (mục 7.8) | Đọc hold sau khoá; `reserve` (`:1018`) tăng H; vòng rút cạn (`:1081-1094`) giữ lại `unresolvedHeld + H`; KHÔNG ghi dấu `HOLDBACK_SETTLED` khi có hold (`:1143` đổi thành `holding && !holdActive`) |
| 3a | …`COMPLETED`, `EXPIRED`, `CLIENT_CANCELLED`, `MUTUAL` | Quỹ về PT qua top-up; hoàn theo công thức lý do | Quỹ đóng băng, PT nhận phần còn lại | như dòng 3 |
| 3b | …`CLIENT_EXIT_DUE_TO_PT_RESTRICTION` (D32) | Hoàn 100%, không phí, không đền (`PS/services/contract-money.ts:427-440`; không thuộc `PT_FAULT_REASONS`, `:321-325`) | Hoàn 100%, quỹ đóng băng, không tự đền; khách không phải chờ | như dòng 3 |
| 3c | …**`SERVICE_DISCONTINUED_BY_PLATFORM`** (D49, mục 9) | (chưa có) | Như 3b: hoàn 100%, không đền; quỹ đóng băng nếu có hold, nếu không quỹ về PT | như dòng 3 |
| 3d | …`PT_CANCELLED`, `PT_REPEATED_NO_SHOW` | Đền khách `min(ceil(h×base), held, ptStillToBePaid)` từ quỹ (`:997-1000`, `:1107-1113`) | **Có hold: tắt** (`compensation = 0`), quỹ đóng băng, admin phán bằng nghĩa vụ. **Không có hold:** hôm nay vẫn tự đền (D23) — là một trong các xung đột N3 ở mục 8 (cần quyết); nếu giữ, số tự đền phải trừ `paidFromPot` | Mục 7.8, 8 |
| 3e | …`PT_BANNED` (dữ liệu cũ) | Như 3d (`PT_BANNED ∈ PT_FAULT_REASONS`) | Chỉ còn để PHÁT LẠI kết quả cũ qua khoá `CONTRACT_TERMINATE:<id>`; không đường nào MỚI gửi lý do này (mục 9) | Bài tĩnh HT-62 |
| 3f | …kèm `unresolvedSessions > 0` (buổi B) | `keepBack` giữ giá trị buổi treo (`:1064-1068`) | Cả hai khoản cùng được giữ: `unresolvedHeld` (B) và H (A); `refund + Σ entitlement + unresolvedHeld + H = P − compensationValue` | HT-08 |
| 4 | `releasePtHoldback` (`:1204-1239`; route `:672-693`; quét giờ `contractService.releaseIdleHoldbacks`) | Quỹ → AVAILABLE (`:1220-1222`) | **Từ chối**, trả `{ released:"0.00", status:"BLOCKED_BY_HOLD" }`, KHÔNG ghi dòng "released" (ghi sẽ vĩnh viễn tắt khả năng đền). Trả `status` có cấu trúc để F6 phân biệt | Đọc hold ngay sau `holdbackWasReleased` (`:1216`). user-service chỉ đánh dấu `holdbackReleasedAt` khi `status` là `RELEASED`/`ALREADY_RELEASED` (F6) |
| 5 | `resolveUnresolvedSession` (`:1305-1405`) | PENDING của buổi treo (`:1355-1382`) | Chạy; không ăn vào quỹ | Không để buổi treo ăn vào quỹ khi PENDING thiếu |
| 6 | `refundUnactivatedContractPayment` (`:300-388`) | Rút cạn `ownPending` của hợp đồng chưa kích hoạt; thiếu → `coverShortfall` (`:347`) | Hợp đồng chưa kích hoạt không có quỹ nên không có hold; thấy hold thì **ném lỗi bất biến** | Dây an toàn. Nhánh `coverShortfall` ở đây là ca "sổ cái đã hỏng" — xếp cùng nhóm N7 (mục 8) |
| 7 | Yêu cầu rút / duyệt / chi (`PS/services/withdrawal.service.ts`) | Chỉ AVAILABLE và LOCKED của chủ yêu cầu | **Không bị ảnh hưởng** (kể cả PT bị cấm: N5 "không đóng băng tiền đã kiếm") | Hold ở PENDING/HOLDBACK; rút tiền không chạm. Tối thiểu 10.000đ vẫn áp |
| 8 | Quét tiền giữ nhàn rỗi 30 ngày (D24/D29/D30) | Gọi dòng 4 | Không trả. Đồng hồ sau khi đóng hold: câu 4 mục 18 | Chặn ở payment-service (dòng 4) + cổng cục bộ (mục 11) |
| 9 | Tự xác nhận (`session-autoconfirm.service.ts`, `runAutoConfirm`) và khách xác nhận (`booking.service.ts`, `clientConfirmSession`) | `deductQuotaOnce` → `releaseOrResolveSessionMoney` | Như dòng 1 (ACTIVE) hoặc `resolveUnresolvedSession` (đã kết thúc). **N5/N9:** mở lại cho buổi đã báo trước hạn chế/cấm (mục 10.2) | Quyết định tiền do dòng 1/5; "có tự xác nhận hay không" do user-service |
| 10 | Quét thử lại thanh toán buổi (`session-settlement-sweep.service.ts`) | Gọi lại dòng 1, 2, 3, 5 với CÙNG khoá | Tự thấy hold dưới khoá; không nhánh riêng | HT-10b |
| 11 | `settleContractPayment` (`:213-263`) | Nhận tiền | Không liên quan | — |
| 12 | Hoàn tiền kiểu ví-sang-ví `POST /internal/payments/:id/refund` và đường admin `POST /admin/payments/:id/refund` (`PS/routes/admin.routes.ts:160-206`) | AVAILABLE người nhận | `CODE AUDIT` + `ĐỌC DB DEV`: giao dịch cổng của hợp đồng PT KHÔNG có `payer_wallet_id`/`receiver_wallet_id` (đọc 864ede79: cả hai NULL), nên đường admin trả 400 `NOT_REFUNDABLE` (`:178-180`) → không giao với hold | Điều kiện kiểm tra khi triển khai: HT-24b ghim 400 cho giao dịch hợp đồng |
| 13 | **Mới** `hold/open` | không di chuyển tiền | tạo hold + nghĩa vụ `OPEN` | mục 7.1 |
| 14 | **Mới** `hold/:id/obligations` (phán nghĩa vụ) | `PT.PENDING`(hoặc `PT.HOLDBACK`) → `KHÁCH` | — | mục 7.2 |
| 15 | **Mới** `hold/:id/close`, `hold/:id/extend`, `hold/:id/assign` | `close`: không (ACTIVE) hoặc quỹ → `PT.AVAILABLE` (đã kết thúc) | — | mục 7.6, 7.7 |

Ghi chú: một lần đền ghi nợ ngăn quỹ của PT (mô tả có hậu tố `HOLDBACK_PAID_SUFFIX` nếu M0; ngăn `HOLDBACK` nếu M1), ghi có AVAILABLE ví khách (mô tả có chữ `compensation` để `sumRefundSourcedCredits` tính là tiền hoàn rút được: `PS/repositories/withdrawal.repository.ts:95-109`). ESCROW không động.

---

## 7. Quyết định của admin

### 7.1 Mở hold (`hold/open`)

Chuỗi điều kiện, TẤT CẢ kiểm trong `withWallets` (khoá); từ chối với mã máy đọc được; không ghi gì khi từ chối:
1. Giao dịch `T` tồn tại, `status=PAID`, `relatedEntityType=PT_CONTRACT`, `relatedEntityId=contractId` (không tin `contractId` thuần từ người gọi; cùng cách `activateOrRefund` đọc người tham gia từ `metadata`).
2. Tỷ lệ giữ của hợp đồng > 0 (user-service gửi từ `Contract.ptHoldbackRate`) và chưa `holdbackWasReleased` → nếu không `HOLD_NOT_APPLICABLE` (không có quỹ giả để giữ).
3. Mở độc lập (route riêng): hợp đồng chưa kết thúc (không có khoá `CONTRACT_TERMINATE:<contractId>`). Sau khi kết thúc không lỗi, quỹ đã về PT — **không hồi tố**. Ngoại lệ: yêu cầu đi KÈM lệnh chấm dứt (mục 11) tạo hold trong chính giao dịch ghi sổ của lệnh chấm dứt nên không có khe.
4. `potOf(T) > 0` → nếu không `HOLD_NOTHING_TO_HOLD`.
5. Chưa có hold ACTIVE cho `T`. Có rồi thì KHÔNG tạo hold thứ hai: thêm sự kiện `BASIS_ADDED` và một nghĩa vụ `OPEN` mới cho căn cứ mới (mỗi căn cứ một nghĩa vụ). Mở lặp cùng `requestId` → trả hold cũ.
6. Căn cứ và lý do không rỗng; `assigneeAdminId` mặc định là người mở.

Kết quả ghi: hold `ACTIVE` với `openedAt`, `dueAt = openedAt + 14 ngày`, một nghĩa vụ `OPEN` (`obligationKey = "<basisType>:<basisRef>"`), sự kiện `OPENED`.

Phía user-service (route admin): `POST /admin/contracts/:contractId/financial-hold`.
- `adminId` lấy từ danh tính đã xác thực ở gateway, **không từ body**. `contractId` từ URL; `ptUserId`, `clientUserId`, `gymId`, `paymentTransactionId`, `ptHoldbackRate` đọc từ bản ghi `Contract` trong DB.
- Xác minh căn cứ từ DB: `SESSION_DISPUTE` với buổi thuộc hợp đồng đang `DISPUTED`; `SESSION_NO_SHOW_REPORT` với buổi `PT_NO_SHOW_REPORTED` của hợp đồng; hoặc `CONTRACT_RESTRICTION` với hạn chế cấp HỢP ĐỒNG của chính hợp đồng này. **Hạn chế cấp tài khoản và cấm vĩnh viễn không phải căn cứ** (D38, N6).
- Luôn ghi `ContractHoldRequest` trước (mục 11). Trả `201` + `status: "ACTIVE"` CHỈ khi payment-service đã xác nhận; chưa xác nhận được → `202` + `status: "PENDING_SYNC"` (**không bao giờ báo thành công khi chưa có hold thật**, D47).
- Ghi `AuditLog` (`AuditEntityType.CONTRACT`) `FINANCIAL_HOLD_REQUESTED` trước và `FINANCIAL_HOLD_CONFIRMED`/`…_REJECTED` sau.

### 7.2 Phán một nghĩa vụ: kết luận rồi giải ngân (N2, N3, N7; D43)

Hai thao tác TÁCH RỜI, có thể do cùng một admin nhưng lưu và ghi nhật ký riêng (N3: sự kiện kích hoạt ≠ kết luận vi phạm ≠ điều kiện giải ngân).

**Bước 1 — kết luận (`hold/:id/obligations/:oid/finding`)** → nghĩa vụ `OPEN` → `FINDING_RECORDED` hoặc `NOT_AWARDED`.
- Đầu vào: `findingKind` ∈ {`PT_ABANDONMENT` (công thức "PT bỏ ngang", D21–D23), `REPEATED_NO_SHOW` (D28; user-service kiểm đủ số lần vắng bằng `repeatedNoShowEligibility`), `TERMINATION_PT_FAULT` (nghĩa vụ tự sinh khi hợp đồng kết thúc vì lý do lỗi PT lúc đang có hold, mục 7.7), `NO_VIOLATION`}; `findingNote` bắt buộc, nêu chứng cứ; `decisionId`.
- **Không có `findingKind` thứ năm**: N3 cấm công thức đền mới, nên không có kết luận "admin thấy PT có lỗi" mà không gắn công thức. Muốn thêm một loại phải do chủ sở hữu định nghĩa trần riêng (không có câu hỏi mở nào về việc này; câu 1 mục 18 chỉ về cách đo giới hạn).
- Một buổi bị admin hủy VÌ ĐÌNH CHỈ (hoặc vì cấm) KHÔNG phải là "PT vắng" và KHÔNG được dùng làm căn cứ cho `REPEATED_NO_SHOW`: user-service chỉ đếm buổi `ptAtFault = true`, và các đường hủy do hạn chế/cấm không bao giờ đặt `ptAtFault` (`US/services/pt-deactivation.service.ts` ghi chú đầu `FUTURE_SESSION_STATUSES`; `pt-restriction.service.ts` khối "no ptAtFault"). Kiểm thử HT-63.
- `NO_VIOLATION` → `NOT_AWARDED`, không bút toán, không phán lại được.

**Bước 2 — giải ngân (`hold/:id/obligations/:oid/payout`)**, chỉ khi nghĩa vụ đang `FINDING_RECORDED`.
- Đầu vào: `amount` (số đồng nguyên dương **do admin nhập, không bao giờ do hệ thống đề xuất hay mặc định**), `reason`, `decisionId`. `policyBasis` suy từ `findingKind`, không nhập tự do. user-service gửi thêm các số đếm của hợp đồng (`usedSessions`, `compensatedSessions`, `unresolvedSessions`, `ptHoldbackRate`) đọc từ DB.
- Kiểm tra dưới khoá (từ chối nếu sai, không ghi gì):
  1. Hold phải `ACTIVE` (`409 HOLD_REQUIRED`).
  2. Nghĩa vụ phải ở `FINDING_RECORDED` (`409 FINDING_REQUIRED`); đã `PAID`/`PARTIALLY_PAID`/`NOT_AWARDED` → phát lại nếu cùng `decisionId` và cùng số, `409 OBLIGATION_ALREADY_RULED` nếu khác. **Một nghĩa vụ chỉ được giải ngân một lần.**
  3. Giới hạn chính sách còn lại `L = policyBound − paidFromPot(T)`, trong đó `policyBound = holdbackCompensationTarget(input, reasonOf(policyBasis), remaining)` = `ceil(h × base)` (`PS/services/contract-money.ts:358-366`), `base` là giá trị chưa dùng lúc phán (cộng buổi vắng đã đền cho `REPEATED_NO_SHOW`, D28). `L ≤ 0` → `409 POLICY_LIMIT_REACHED`.
  4. `pay = min(potOf(T), L, amount)`, đọc dưới khoá (**công thức N2**): `potOf ≤ phần PENDING/HOLDBACK của đúng hợp đồng này` nên không bao giờ là tiền hợp đồng khác (D43).
  5. `amount > L` → KHÔNG từ chối cả khoản mà trả `L` và ghi phần chưa giải quyết (nhất quán N2); `amount` vẫn lưu nguyên để kiểm toán.
- Bút toán (một giao dịch DB, một khoá `HOLD_OBLIGATION:<holdId>:<obligationKey>` qua `withIdempotentLedgerOp`):
  - Giảm quỹ `pay` (ngăn quỹ của PT: hậu tố `HOLDBACK_PAID_SUFFIX` nếu M0; Nợ `PT.HOLDBACK` nếu M1);
  - Ghi có AVAILABLE ví khách `pay`, mô tả có chữ `compensation` (rút được qua `sumRefundSourcedCredits`);
  - Cập nhật nghĩa vụ (`awardedAmount = amount`, `paidAmount = pay`, `unresolvedAmount = amount − pay`, `state = PAID` nếu `pay = amount`, `PARTIALLY_PAID` nếu `pay < amount`, kể cả `pay = 0`), `compensatedTotal += pay`, sự kiện `OBLIGATION_RULED`.
- **Cấm tuyệt đối (D20, D22, D43, D48):** không `coverShortfall`; không `PartnerReceivable`; không chạm AVAILABLE của PT, gym, nền tảng; không đổi trạng thái hợp đồng, `compensatedSessions`, `usedSessions`, `releasedToPt`; không gọi `terminateContract`; không lấy từ quỹ của hợp đồng khác.

### 7.3 Quỹ không đủ: ghi phần chưa giải quyết, không nợ, không báo "đủ" (N2, N7)

| Tình huống (ví dụ 5.000.000đ, 10 buổi, h 10%, đã dạy 4) | `min(quỹ; L; nghĩa vụ)` | Khách nhận | Ghi nhận |
|---|---|---|---|
| Quỹ 500.000, `L` 300.000, admin quyết 200.000 | `min(500; 300; 200)` = 200.000 | 200.000 | `PAID`, chưa giải quyết 0 |
| Quỹ 200.000 (đã đền 300.000), `L` 0 | 0 | 0 | `PARTIALLY_PAID`, chưa giải quyết = toàn bộ số quyết |
| Quỹ chỉ còn 100.000, `L` 300.000, admin quyết 250.000 | 100.000 | 100.000 | `PARTIALLY_PAID`, chưa giải quyết 150.000 |
| Quỹ 500.000, `L` 100.000, admin quyết 150.000 | 100.000 | 100.000 | `PARTIALLY_PAID`, chưa giải quyết 50.000 |

Phần chưa giải quyết **không phải nợ của PT, không phải khoản nền tảng ứng, không tự được trả nốt khi quỹ có tiền trở lại** (D46; theo N1 quỹ cũng không đầy lại). Có cho phép một quyết định thứ hai trên chính nghĩa vụ đó hay không: KHÔNG; nếu admin cho rằng quyết định chưa đủ, đó là một nghĩa vụ mới có căn cứ mới. Quy tắc phát ngôn (D48): mọi API, thông báo và giao diện phải lấy số từ `paidAmount`/`unresolvedAmount`; API luôn trả `fullyCompensated = (paidAmount ≥ awardedAmount)`; chuỗi "đã đền đủ" / "đã bồi thường toàn bộ" chỉ được sinh khi `fullyCompensated = true`; khi `false`, mẫu câu bắt buộc nêu cả hai số ("Đã hoàn X đ; Y đ chưa thể hoàn từ khoản bảo đảm của hợp đồng này"). Kiểm thử HT-45b.

### 7.4 Sau một phán quyết: quỹ còn lại và KHÔNG bơm lại (N1, D46)

- Hợp đồng và buổi còn lại không đổi: hợp đồng vẫn ACTIVE; khách giữ quyền lợi các buổi chưa dùng (khoản đền KHÔNG phải một buổi, không tăng `compensatedSessions`); PT tiếp tục dạy; hai bên vẫn có thể chấm dứt về sau.
- **Quy tắc N1.** Trong `releaseSession`, phần giữ của buổi tính bằng `splitReleaseWithHoldback(share, heldBefore, target)` (`PS/services/contract-money.ts:309-318`); thay `heldBefore = ptHeld` bằng `heldBefore = potOf(T) + paidFromPot(T)`. `paidFromPot(T)` = Σ khoản đã giảm quỹ để đền (mục 3.7). Khi quỹ đã từng đạt `H` và một phần đã đền, tổng "đã góp" vẫn = `H`, nên mọi buổi sau giải phóng đủ; quỹ CHỈ còn giảm.
- Trường hợp biên: (a) đền trước khi quỹ đầy (sau buổi 1, quỹ 450.000, đền 100.000) → đã góp = 450.000, buổi 2 chỉ giữ thêm 50.000, quỹ cuối = 400.000; (b) quỹ đã giải phóng vì nhàn rỗi (`holdbackWasReleased`) → không còn giữ gì; (c) `paidFromPot` không bao giờ vượt `H` (vì đền ≤ quỹ ≤ H).
- Số liệu: mục 3.4 (hôm nay mã bơm lại 300.000 ở buổi 5; thiết kế N1 không giữ gì).

### 7.5 Hai pha giữa hai dịch vụ, chống lặp, nhật ký, phân quyền

- **Hai pha**: user-service ghi `AuditLog …_DECISION_REQUESTED` (ý định, kèm `decisionId`), gọi payment-service, và CHỈ khi nhận thành công mới ghi `…_DECISION_POSTED` cùng số tiền THỰC (từ kết quả payment-service). Thất bại/hết giờ → `…_FAILED`; giao diện hiển thị "đang xử lý"; admin bấm lại với CÙNG `decisionId`, kết quả được phát lại. Không bao giờ có chữ "đã đền" ở user-service mà thiếu bút toán ở payment-service. Trong payment-service sổ cái, nghĩa vụ, sự kiện và khoá `LedgerOperation` cùng một giao dịch DB.
- **Chống lặp**: ba lớp — `HOLD_OBLIGATION:<holdId>:<obligationKey>` qua `withIdempotentLedgerOp`; `@@unique([holdId, obligationKey])`; `@@unique([holdId, decisionId])`.
- **Nhật ký**: payment-service lưu `actorUserId`, `reason`, số tiền, giới hạn, số quỹ, thời điểm; user-service ghi `AuditLog` (mẫu `auditService.record` trong `US/services/client-exit.service.ts`).
- **Phân quyền**: chỉ `role === ADMIN`, kiểm ở cổng admin của gateway và `roleMiddleware(["ADMIN"])`. Một admin quyết + lý do bắt buộc + nhật ký. Người duyệt thứ hai: không (chủ sở hữu chưa yêu cầu; nhật ký đủ để nâng lên sau).

### 7.6 Vòng đời hold: hạn 14 ngày, cảnh báo, hàng đợi ưu tiên, gia hạn (N4)

- **Hạn**: `dueAt = openedAt + HOLD_REVIEW_DAYS` (biến môi trường, mặc định 14; cùng nhịp với `PT_RESTRICTION_OVERDUE_DAYS` ở `US/services/pt-restriction.service.ts:54`).
- **Cảnh báo**: tiến trình quét của user-service chạy mỗi giờ, gọi `POST /internal/holds/flag-overdue` của payment-service (idempotent: đặt `overdueFlaggedAt` cho hold `ACTIVE` có `dueAt < now` chưa gắn cờ, ghi sự kiện `OVERDUE_FLAGGED`, trả danh sách). Với mỗi hold vừa gắn cờ: `AuditLog` `FINANCIAL_HOLD_OVERDUE` + thông báo cho `assigneeAdminId` (cần thêm một giá trị `NotificationEventType`, migration user-service; nội dung chỉ nói "có khoản giữ đã quá hạn xem xét", không nêu tên PT lỗi).
- **Hàng đợi ưu tiên**: `GET /admin/financial-holds?sort=priority` sắp xếp: quá hạn trước (ngày quá hạn giảm dần), rồi theo số quỹ đang giữ giảm dần, rồi theo `openedAt`. Hiển thị chỉ cho admin.
- **Gia hạn**: `hold/:id/extend` với `reason` bắt buộc (≥ 10 ký tự), `newDueAt ≤ now + 14 ngày`; mỗi lần là một sự kiện `EXTENDED` và tăng `extensionCount`. Không có gia hạn "im lặng".
- **Đổi người phụ trách**: `hold/:id/assign` với `reason` bắt buộc, sự kiện `ASSIGNED`.
- **Hết hạn ≠ PT có lỗi**: quá hạn KHÔNG đổi tiền (không tự trả PT, không tự đền, không tự đóng), KHÔNG đổi trạng thái PT hay hợp đồng, KHÔNG sinh thông báo cho khách hay PT theo lối ám chỉ lỗi, KHÔNG được dùng làm căn cứ cho kết luận vi phạm. Nó chỉ làm cho hold nổi lên hàng đợi. Có nên có hạn tối đa tuyệt đối (ví dụ 60 ngày) rồi tự nhả hay không: chưa quyết (mục 18, câu 5).

### 7.7 Đóng hold và nhả về đúng trạng thái hợp đồng (N4)

- Hold đóng khi MỌI nghĩa vụ đã ra khỏi `OPEN`/`FINDING_RECORDED` (đều `PAID`, `PARTIALLY_PAID` hoặc `NOT_AWARDED`) — hệ thống đóng ngay trong giao dịch phán nghĩa vụ cuối cùng (`closeKind = OBLIGATIONS_RULED`, hoặc `BASIS_CLEARED_NO_OBLIGATION` nếu tất cả `NOT_AWARDED`), hoặc admin đóng thủ công với lý do (`ADMIN_CLOSED`).
- **Nhả về đúng trạng thái hợp đồng** (cùng một bảng với mục 3 và 14):
  - Hợp đồng **còn chạy**: không bút toán. Quỹ còn lại vẫn là quỹ và đi tiếp theo quy tắc thường (top-up khi kết thúc, hoặc quét nhàn rỗi — đồng hồ: câu 4 mục 18).
  - Hợp đồng **đã kết thúc không lỗi** lúc hold hoạt động (quỹ nằm mồ côi): đóng = chuyển quỹ còn lại vào `PT.AVAILABLE` đúng một lần (ghi dòng với `HOLDBACK_RELEASED_SUFFIX` hoặc Nợ `PT.HOLDBACK`; `recoverReceivables` chạy; đồng thời là dấu khiến quét 30 ngày là no-op).
  - Hợp đồng đã kết thúc vì lý do lỗi PT (`PT_CANCELLED`, `PT_REPEATED_NO_SHOW`) lúc có hold: lúc kết thúc, payment-service tắt tự đền (mục 6 dòng 3d) và ghi thêm một nghĩa vụ `OPEN` `TERMINATION:<reason>` vào hold; công thức trần chính là công thức tự đền của D23 (KHÔNG công thức mới) nhưng phải có kết luận và giải ngân của admin. Nếu admin kết luận `NO_VIOLATION`, quỹ về PT. Cách này loại khe "PT có hold thì huỷ rồi khỏi đền" mà không đặt thêm công thức.
- **Căn cứ biến mất mà chưa có quyết định** (hạn chế bị gỡ, căn cứ đã được phán quyết xong ở nơi khác…; riêng buổi tranh chấp và buổi `PT_NO_SHOW_REPORTED` KHÔNG còn nằm trong nhóm này: theo D45 L3 và D52 hợp đồng kết thúc không làm chúng mất hiệu lực, chúng được giữ qua `unresolvedSessions` nên căn cứ của hold còn nguyên): KHÔNG tự đóng. user-service ghi `BASIS_CLEARED` (sự kiện, có lý do hệ thống) và hold vào hàng đợi với hạn ngắn 3 ngày, ghi chú "không còn căn cứ — cần đóng". Chỉ phán quyết rõ ràng của admin mới nhả tiền (vì nhả tiền sớm là hành động không đảo ngược được).
- Không thể mở lại hold đã đóng (mở hold mới theo 7.1: chỉ khi vẫn thoả điều kiện 3).

### 7.8 Hệ quả lên `terminateContract` khi đã có khoản đền lúc ACTIVE (`THIẾT KẾ`, bắt buộc)

`TÍNH TAY` (mục 3.4): nếu 300.000 đã rút khỏi quỹ lúc ACTIVE rồi hợp đồng kết thúc, `settleParty` của PT thấy `gap = E − R − reserve = 500.000` nhưng `PT.PENDING` chỉ còn quỹ 200.000 → thiếu 300.000 → `coverShortfall` (`:1124-1133`): nền tảng ứng và ghi nợ PT. Đúng điều D20/D48 cấm. Phải sửa cùng lúc với thao tác phán:
- `terminateContract` đọc `paidFromPot(T)` từ sổ cái (không nhận từ người gọi) và tính `gap = E − R − reserve − paidFromPot` cho PT. Với số trên `gap = 200.000`, `residue = 0`. `gap` không bao giờ âm vì `R + paidFromPot ≤ thu nhập PT ≤ E`. (Với M1: top-up từ `PT.PENDING` = `E − R − potOf − paidFromPot` và quỹ còn lại chuyển `PT.HOLDBACK → PT.AVAILABLE` riêng.)
- Số tự đền của `PT_CANCELLED`/`PT_REPEATED_NO_SHOW` khi KHÔNG có hold (nếu Ngài giữ D23) giảm đi `paidFromPot`: `target' = max(0, ptFaultCompensationTarget − paidFromPot)`, và `ptStillToBePaid` cũng trừ nó (`:997-1000`), để tổng đã đền một hợp đồng không vượt trần chính sách khi hai đường cộng lại.
- Kiểm thử HT-46.

---

## 8. Ba việc tách rời (N3) và các chỗ cơ chế tự đền hiện tại mâu thuẫn (N3, N7)

### 8.1 Nguyên tắc

N3 yêu cầu ba việc không dính vào nhau, mỗi việc có bản ghi riêng và người/hệ thống chịu trách nhiệm riêng:

| Việc | Là gì | Ghi ở đâu (thiết kế) | Ai làm |
|---|---|---|---|
| 1. Sự kiện kích hoạt xem xét | Có chuyện xảy ra đáng xem: khách tranh chấp buổi, khách báo PT vắng, hạn chế cấp hợp đồng | `basisType/basisRef` của hold; nghĩa vụ `OPEN` | user-service xác minh từ DB |
| 2. Kết luận vi phạm | "PT đã bỏ ngang" / "vắng lặp lại" / "không vi phạm" | `findingKind`, `findingNote`, `findingBy` của nghĩa vụ (mục 7.2 bước 1) | admin |
| 3. Điều kiện giải ngân | Có kết luận; trong giới hạn chính sách; có quỹ thật; chưa giải ngân lần nào | bước 2 (mục 7.2), công thức N2 | admin + sổ cái kiểm |

Hai quy tắc kèm theo: (a) **buổi do admin hủy vì đình chỉ/cấm KHÔNG phải PT vắng**: các đường hủy do hạn chế không đặt `ptAtFault`, không gọi `compensateNoShowMoney`, không tính vào "vắng 3 lần" (`US/services/pt-deactivation.service.ts` ghi chú đầu `FUTURE_SESSION_STATUSES`; `contract-session-closure.ts` mới; HT-63 ghim bằng kiểm thử); (b) **không công thức đền mới**: trần chỉ là `holdbackCompensationTarget` của hai lý do đã có.

### 8.2 Bảng xung đột của cơ chế TỰ ĐỀN hiện tại

`CODE AUDIT` (mã hôm nay). "Nguồn tiền" theo thứ tự trừ. N3 = có dính "sự kiện + kết luận + giải ngân" vào MỘT bước tự động không người; N7 = có lấy ngoài quỹ thật của hợp đồng (ví gộp / nền tảng ứng / nợ PT).

| # | Đường tự động | Sự kiện kích hoạt → ai kết luận → giải ngân | Nguồn tiền | N3? | N7? |
|---|---|---|---|---|---|
| A | PT tự nhận vắng: `markNoShow` (`US/services/booking.service.ts`) → `compensateNoShowMoney` | PT tự nhận = sự kiện và kết luận cùng một hành động của PT; giải ngân tự động | `PENDING(T)` (phần buổi đó) → **AVAILABLE gộp** → **nền tảng ứng** (`PS/services/contract-ledger.service.ts:594-603, 620-627`) | Nhẹ (PT tự khai) | **CÓ** (nhánh sau PENDING) |
| B | PT đồng ý báo cáo của khách: `respondToNoShowReport` AGREE → như A | như A | như A | Nhẹ | **CÓ** |
| C | Admin phân xử: `resolveDispute` `PT_NO_SHOW_CONFIRMED` → `compensateNoShowMoney` | Admin kết luận buổi PT vắng; **giải ngân dính luôn vào cùng lệnh** | như A | **CÓ** (kết luận → tiền trong một nút bấm, không bước giải ngân riêng) | **CÓ** |
| D | PT chặn ngày / huỷ < 24h: `addException`, `cancelSession` (`US/services/session-outcome.ts` dòng 4) | PT tự hành động; "kết luận" là bảng quy tắc, không ai | như A | Nhẹ | **CÓ** |
| E | **Quét đóng phòng**, PT không vào phòng (`room-close-resolution.service.ts` ca 2) | Hệ thống quan sát → hệ thống kết luận `NO_SHOW` + `ptAtFault = true` → hệ thống giải ngân; không người nào | như A | **CÓ, mạnh nhất** | **CÓ** |
| F | Quét đóng phòng, PT vào muộn (`compensateLateArrivalMoney`) | tương tự E, nhưng buổi vẫn diễn ra và khách vẫn giữ quyền lợi buổi (`contract-money.ts:555-576`): đây là phạt thật, không phải hoàn tiền buổi không diễn ra | `PENDING(T)` rộng (cả phần chưa kiếm của buổi khác) → AVAILABLE gộp → nền tảng ứng (`:675-684, 695-702`) | **CÓ** | **CÓ** |
| G | Chấm dứt `PT_CANCELLED`, `PT_REPEATED_NO_SHOW`: đền tự động `min(ceil(h×base), quỹ, PT còn được trả)` (`:997-1000`, D23) | `PT_CANCELLED`: PT tự khai (nhẹ). `PT_REPEATED_NO_SHOW`: khách bấm, nhưng điều kiện "3 buổi `ptAtFault`" có thể toàn do đường E (hệ thống) → chuỗi E → E → E → G **không qua người nào** | **Quỹ thật** của đúng hợp đồng (đúng N7) | `PT_REPEATED_NO_SHOW`: **CÓ** (gián tiếp). `PT_CANCELLED`: nhẹ | Không |
| H | Chấm dứt `PT_BANNED` đền tự động | Cấm ⇒ đền mọi khách | Quỹ thật | **CÓ** (D31/D44 đã bác) | Không | → **Gỡ bởi N8 (mục 9)** |
| I | Bù thiếu / thu hồi khi chấm dứt: `coverShortfall` (`:1124-1133`), kẹp thu hồi từ AVAILABLE gộp (`:1048-1058`), hoàn khi hợp đồng không kích hoạt được (`:343-353`) | Không phải đền; là hoàn tiền hợp đồng mà sổ phụ thiếu | Nền tảng ứng + `PartnerReceivable`; AVAILABLE gộp | Không | **CÓ** (nền tảng ứng, nợ PT) |

### 8.3 Cách tại hạ đọc N7 với đường A–D (cần Ngài xác nhận, câu 2 mục 18)

Với A–D, khoản khách nhận bằng đúng giá trị MỘT buổi (`unit`) và được chi bằng phần PT/nền tảng chưa kiếm của CHÍNH buổi đó trong `PENDING(T)` (dữ liệu dev xác nhận: cả ba khoản đền vắng, 1.200.000đ, đều trừ từ PENDING; 0đ từ AVAILABLE — xem `PT_COMPENSATION_SOURCE_AUDIT.md`). Về bản chất đó là HOÀN giá trị buổi chưa được dạy (D19: khách được hoàn phần chưa dùng), không phải "đền" từ quỹ bảo đảm. Nếu hiểu vậy thì N7 chỉ vi phạm ở nhánh thừa (AVAILABLE gộp, nền tảng ứng) và ở F (phạt thật); đề xuất mặc định (không đổi công thức):
1. A–E: giữ "hoàn giá trị buổi" bằng tiền chưa kiếm của chính buổi đó; **bỏ nhánh AVAILABLE và `coverShortfall`**; thiếu → thao tác bị từ chối `INSUFFICIENT_CONTRACT_FUNDS`, rollback, `settleTracked` ghi lỗi, admin xử lý — khách không bao giờ được báo "đã hoàn" khi chưa có tiền. Sau F1–F3 và khi quỹ được bảo vệ (M1, hoặc M0 + sàn quỹ — chưa chọn, D56), ca thiếu chỉ còn là dị thường (sổ cái hỏng), không còn là đường thường.
2. F (đến muộn): chọn một trong ba (câu 2): giữ nguyên nguồn PENDING(T) phần chưa kiếm của buổi đó (không đụng quỹ, không ví gộp); tắt hẳn cho tới khi có quy trình kết luận; hoặc chuyển thành nghĩa vụ phải qua kết luận như 7.2.
3. E, G: giữ nguyên hoặc cho `PT_REPEATED_NO_SHOW` chỉ đếm buổi vắng do PT tự nhận hoặc admin xác nhận (không đếm buổi do hệ thống quan sát); tắt tự đền G và chỉ cho đền qua nghĩa vụ.

Ví dụ tiền (hợp đồng 5.000.000đ, 10 buổi): PT mất kết nối 3 buổi liên tiếp, quét đóng phòng đánh `NO_SHOW` cả ba (khách hoàn 3 × 500.000 = 1.500.000, PT bị trừ 3 × 450.000). Khách bấm "PT vắng 3 lần" và kết thúc: hoàn phần còn lại, tự đền thêm `ceil(10% × (còn lại + 1.500.000))`. Không người nào xem xét lý do mất kết nối; D28 chấp nhận hệ quả "PT vắng vì lý do chính đáng cũng chịu mức cao" cho CHÍNH đường này, nhưng N3 nói cần kết luận riêng. Thiết kế này chỉ nêu, không tự đổi.

### 8.4 Ghi chú về thành phần của mã (để người triển khai không đoán)

- `compensateNoShow` và `compensateLateArrival` là hai bản gần như trùng nhau (cố ý, ghi trong mã `:642-649`); sửa nguồn tiền ở U5 phải sửa CẢ HAI và `coverShortfall` ở ba nơi gọi (`:347`, `:621`, `:696`, `:1127`) — và cả `membership-ledger.service.ts` (hoa hồng giới thiệu) cùng `personalized-service-ledger.service.ts` (hoàn đơn dịch vụ cá nhân hoá) dùng chung `coverShortfall`/kẹp AVAILABLE; hai nơi này KHÔNG phải đền PT-hợp đồng nên nằm ngoài N7, nhưng cùng cơ chế; xem audit.
- Khi hợp đồng có hold, các đường A–F KHÔNG được ăn vào quỹ (sàn quỹ nếu M0; cấu trúc nếu M1) — mục 6 dòng 2.

---

## 9. Lý do chấm dứt mới thay `PT_BANNED` làm lý do quy lỗi (N8, D49)

**Vấn đề (`CODE AUDIT`).** Lệnh gỡ hợp đồng khi cấm vĩnh viễn gọi `settleContractTermination(contract.id, "PT_BANNED", …)` (`US/services/pt-deactivation.service.ts` `unwindContract`, hiện dòng 346). `PT_BANNED` nằm trong `PT_FAULT_REASONS` (`PS/services/contract-money.ts:321-325`), nên khi hợp đồng có tỷ lệ giữ > 0, `terminateContract` tự đền khách `min(ceil(h×base), held, ptStillToBePaid)` (`PS/services/contract-ledger.service.ts:997-1000`) — "cấm = đền mọi khách" mà D31/D44/D49 đã bác. Hôm nay vô hại vì tỷ lệ 0. `contract.controller.ts:621-632` còn cho admin chọn `PT_BANNED`.

**Tên đã chốt (D49):** `SERVICE_DISCONTINUED_BY_PLATFORM` ("dịch vụ không thể tiếp tục do quyết định của nền tảng").

**Công thức**: giống `MUTUAL`/`CLIENT_EXIT_DUE_TO_PT_RESTRICTION` — hoàn 100% phần chưa dùng theo chính sách trung tính, không phí khách, các bên giữ phần buổi đã dạy; KHÔNG thuộc `PT_FAULT_REASONS` → `ptFaultCompensationTarget = 0`; không đền tự động; không phạt PT; không `PartnerReceivable`. Trách nhiệm bồi thường của từng hợp đồng là quyết định riêng qua nghĩa vụ (mục 7.2) — chỉ làm được nếu hold đã tồn tại lúc kết thúc (mục 11 giải bài toán thời điểm).

**Thay đổi (`THIẾT KẾ`).**
| Nơi | Thay đổi |
|---|---|
| `PS/services/contract-money.ts:19-37` | thêm giá trị vào `TerminationReason`; thêm `case` vào `computeTermination` cùng nhánh `MUTUAL` (`:427-440`; `default: never` làm trình biên dịch buộc mọi chỗ phải xử lý); KHÔNG thêm vào `PT_FAULT_REASONS` |
| `PS/routes/internal.routes.ts:546-554` | thêm vào `terminationReasonSchema` (dùng chung terminate và preview) |
| `PS/services/contract-ledger.service.ts:877-881` | `PT_FAULT_WORDING` không cần mục mới (không phải lỗi) |
| `US/prisma/schema.prisma:383-394` + migration `ALTER TYPE "TerminationReason" ADD VALUE` | thêm giá trị enum (cùng mẫu `20261010170000_client_exit_termination_reason`); **đây là migration DUY NHẤT của N8** và là cần thiết vì cột `contracts.termination_reason` là enum DB — không thêm thì không lưu được lý do riêng, và nếu tái dùng `PT_BANNED` trong DB thì báo cáo vẫn đọc "lỗi PT". Không có migration ở payment-service (lý do chỉ nằm trong mô tả dòng sổ cái và kết quả JSON) |
| `US/services/contract-payout.service.ts` (kiểu `TerminationReason`, `statusFor`) | thêm giá trị; `statusFor` → `CANCELLED` |
| `US/services/contract-session-closure.ts` `sessionCallOffReasonFor` | thêm `case` cùng lời văn trung tính của `PT_BANNED` (tệp F1 đang sửa; chờ F1 xong) |
| `US/services/pt-deactivation.service.ts` `unwindContract` | gửi lý do mới thay `"PT_BANNED"`; sửa chú thích |
| `US/controllers/contract.controller.ts:621-632` | bảng quyền: lý do mới `isAdmin`; **`PT_BANNED` không còn được chọn cho yêu cầu MỚI** (trả 400 `REASON_RETIRED`), vẫn nằm trong enum cho dữ liệu cũ |
| Giao diện/nhãn | KHÔNG đổi giao diện trong lát này (cần Ngài cho phép); web/mobile hiện không hiển thị chuỗi `PT_BANNED` (`ĐỌC mã`: grep không thấy ở `frontend/web`, `frontend/mobile` ngoài một chú thích), nên lý do mới không làm vỡ màn hình nào |

**Tương thích dữ liệu cũ (không viết lại).**
- `ĐỌC DB DEV`: 0 hợp đồng có `termination_reason = PT_BANNED` (lý do hiện có: `EXPIRED` 751, `CLIENT_CANCELLED` 9). Trên môi trường khác chạy `SELECT count(*) FROM contracts WHERE termination_reason='PT_BANNED'` trước.
- Hợp đồng đã kết thúc bằng `PT_BANNED` giữ nguyên `terminationReason`, số tiền, dòng sổ cái (D44/D49: "không đổi lịch sử"). `PT_BANNED` vẫn nằm trong enum DB, kiểu TypeScript và `computeTermination` để phát lại: thử lại `CONTRACT_TERMINATE:<id>` dùng khoá chống lặp nên trả kết quả đầu (`settleContractTermination` không ghi đè trạng thái cuối).
- Thứ tự: sửa lý do TRƯỚC khi bật 10%. Trước khi bật, `PT_BANNED` và lý do mới cho cùng một con số (hoàn 100%, tỷ lệ 0) nên việc đổi an toàn.
- Một lệnh gỡ khi cấm đã gửi `PT_BANNED` tới payment-service nhưng user-service chưa ghi trạng thái, rồi thử lại với lý do mới: payment-service phát lại kết quả `PT_BANNED` cũ (khoá giống nhau) còn user-service ghi lý do mới. Chỉ lệch nhãn khi tỷ lệ 0 — một lý do để làm F4 (một nguồn tính tiền) và ghi lý do thật theo kết quả payment-service.

**Kiểm thử.** payment-service, đơn vị: lý do mới cho đúng số của `MUTUAL` trên lưới đầu vào; `ptFaultCompensationTarget = 0`; không thuộc `PT_FAULT_REASONS`; zod nhận; lý do chưa biết vẫn bị từ chối. Sổ cái thật, tỷ lệ giữ 10%: bốn hợp đồng của An kết thúc bằng lý do mới → không dòng "compensation", không `PartnerReceivable`; quỹ về PT nếu không hold, đóng băng nếu hold. user-service: lệnh gỡ khi cấm gửi lý do mới; một bài tĩnh (HT-62) không cho đường mã nào ngoài kiểm thử gửi `"PT_BANNED"`; `terminate` phát lại với `PT_BANNED` cho hợp đồng cũ trả kết quả cũ, không ghi đè trạng thái; admin chọn `PT_BANNED` mới → 400.

---

## 10. PT bị cấm hoặc đình chỉ: buổi đã báo, buổi tranh chấp, tiền đã kiếm (N5, N9, D34, D45)

### 10.1 Quy tắc theo trạng thái buổi và loại tiền

| Tình huống lúc PT bị cấm / đình chỉ | Quy tắc (N5/N9) | Cơ chế |
|---|---|---|
| Buổi `DISPUTED` | **Giữ**; chỉ admin phán; không tự xác nhận, không hủy, không giải phóng | Mục 2.3 (F2, L3) |
| Buổi `PENDING_CLIENT_CONFIRMATION` mà PT đã báo hoàn thành **trước** lúc bị hạn chế, không tranh chấp | Khách xác nhận như bình thường, hoặc **tự xác nhận khi hết cửa sổ hợp lệ** (hạn gốc `clientConfirmDeadline`); khách vẫn có quyền tranh chấp trong cửa sổ đó | Mục 10.2 (U7) |
| Buổi `REQUESTED` / `CONFIRMED` (chưa diễn ra) | Hủy trung tính theo lý do chấm dứt, không tính vắng | F1 |
| Buổi `PT_NO_SHOW_REPORTED` chưa ai trả lời | **Giữ để xác minh (D52)** qua `unresolvedSessions`; không `ptAtFault`; không tự đền trước khi nghĩa vụ được xác định; phân xử bằng quy trình sẵn có | F2 |
| Buổi admin hủy vì đình chỉ | **Không** là PT vắng; không tính vào "vắng 3 lần" | Mục 8.1(a), HT-63 |
| PT báo hoàn thành buổi MỚI sau lúc hạn chế/cấm | **Từ chối**; phải đọc lại trạng thái dưới khoá cùng khoá PT mà lệnh cấm lấy (một sự kiện có thứ tự: "PT bị cấm lúc T" và "báo cáo tạo trước T") | Mã đã có trong cây làm việc: `booking.service.ts` `completeSession` (khoá `withPtScheduleLock`, `assertPtMayActOnContract`, `assertContractRunning`, CAS từ `CONFIRMED`) — thuộc F2/F3, không làm lại ở lát 5 |
| Xác nhận / tự xác nhận / phân xử gặp buổi đã `CANCELLED`/`NO_SHOW`/đã quyết toán | **Không ghi đè**; không trả tiền hai lần | F3 (CAS trên trạng thái đã đọc) |
| Tiền đã kiếm (AVAILABLE của PT) | **Không đóng băng**; PT bị cấm vẫn rút được; hold chỉ phủ quỹ của hợp đồng có căn cứ | Mục 2.1, 6 dòng 7 |
| Quỹ của hợp đồng đang có hold | **Không giải ngân** trong mọi đường | Mục 5.5 |
| Quỹ của hợp đồng KHÔNG có căn cứ riêng (chỉ vì PT bị cấm) | Trả PT theo chính sách không lỗi lúc kết thúc | D38, D44, D49 |

### 10.2 Tự xác nhận mở lại cho buổi đã báo trước hạn chế (N9; điều kiện của D34)

- `CODE AUDIT`: tiến trình tự xác nhận hôm nay bỏ qua PT/hợp đồng bị hạn chế ở hai nơi (`US/services/session-autoconfirm.service.ts` `runAutoConfirm`: `isPtRestricted`, `isContractRestricted`; và `session.repository.ts` `findExpiredPendingConfirmation` nhận hai danh sách loại trừ). Với PT bị cấm vĩnh viễn, hợp đồng kết thúc nhưng buổi chờ xác nhận không bao giờ được quyết toán nếu khách không bấm: tiền buổi đã dạy treo mãi. Với tạm đình chỉ, `pt-restriction.service.ts` còn cộng bù hạn xác nhận khi gỡ hạn chế (giả định "đồng hồ đã dừng").
- **Thiết kế** (chỉ bật sau U7, tức SAU khi hold và các lỗi F1–F3 đã đạt; D34): bỏ hai điều kiện bỏ qua cho **buổi `PENDING_CLIENT_CONFIRMATION` không tranh chấp**; buổi `DISPUTED` không nằm trong truy vấn; bỏ việc cộng bù hạn cho các buổi này; xử lý đóng phòng/phạt vắng tự động (`room-close-resolution.service.ts`) VẪN DỪNG với PT bị hạn chế — đó là quyết định CHỐNG PT, khác với trả tiền cho việc đã báo.
- Điều kiện "đã báo trước hạn chế" được bảo đảm bằng cấu trúc: sau lệnh hạn chế, PT không tạo thêm báo cáo (mục 10.1) và quét đóng phòng bỏ qua PT bị hạn chế, nên mọi buổi `PENDING_CLIENT_CONFIRMATION` của PT đó đều có trước lúc hạn chế. Vẫn thêm bài kiểm HT-64b: tạo buổi chờ sau hạn chế bằng mọi đường → không có đường nào thành công.
- Đường tiền: hợp đồng còn chạy → `releaseSession`; hợp đồng đã kết thúc → `resolveUnresolvedSession` DELIVERED (không áp quỹ, `PS/services/contract-ledger.service.ts:1271-1279`). Hold, nếu có, không chặn việc này (loại B độc lập loại A).
- Ví dụ tiền (hợp đồng 5.000.000đ, mỗi buổi PT 450.000 + nền tảng 50.000): PT báo xong buổi 5 ngày 1; bị cấm ngày 2; khách im lặng. Ngày 4 (hạn gốc 3 ngày): buổi được tự xác nhận → PT +450.000 vào AVAILABLE (rút được), nền tảng +50.000. Nếu khách tranh chấp trước ngày 4: buổi `DISPUTED`, 500.000 ở lại PENDING cho tới khi admin phán (mục 2.4). Quỹ 500.000 (nếu có hold) vẫn đứng yên trong cả hai nhánh.

- **D53 (15/10) — tình trạng chuyển tiếp và quy tắc đích.** Hôm nay việc dừng tự xác nhận cho PT bị cấm/hạn chế (hai điều kiện bỏ qua nêu ở trên) được GIỮ NGUYÊN; đó là **biện pháp chuyển tiếp, không phải quy tắc lâu dài**. Quy tắc đích là **điều kiện nghiệm thu bắt buộc của Financial Hold** (đã đưa vào tiêu chí chấp nhận của U7 và điều kiện 13 của cổng G, mục 16.5): (1) buổi PT đã báo hoàn thành hợp lệ TRƯỚC lúc cấm/hạn chế và không tranh chấp → khách xác nhận hoặc khiếu nại; (2) quá hạn thì tự xác nhận SAU KHI kiểm không có tranh chấp (và không có hold của chính buổi đó chặn — xem điểm đọc ở "Cập nhật 15/10"); (3) cấm không làm mất doanh thu đã kiếm hợp lệ của PT; (4) không tạo được báo cáo hoàn thành MỚI sau lúc cấm (mục 10.1). Cho tới khi U7 đạt, các buổi chờ của PT bị cấm tiếp tục treo — đó là rủi ro P1 đã ghi ở mục 12 dòng 9 và KHÔNG được coi là đã giải quyết.

### 10.3 D34 — tách "khách đã xác nhận" khỏi "tiền đã giải phóng"

- `CODE AUDIT`: `deductQuotaOnce` giành quyền khấu trừ (`sessionDeducted`), tăng `usedSessions`, gọi giải phóng tiền, rồi kiểm tra hoàn tất hợp đồng; giải phóng chạy dưới `settleTracked`, nuốt lỗi và ghi `SessionSettlement` để quét thử lại; `Contract.releasedToPt` chỉ tăng đúng số payment-service báo đã chuyển (`US/services/contract-payout.service.ts` `releaseSessionMoney`, `session-settlement.service.ts`, `session-settlement-sweep.service.ts`). Nghĩa là "ghi nhận khách xác nhận" và "giải phóng tiền" đã tách ở mức dữ liệu.
- Với thiết kế này: xác nhận buổi vẫn → buổi `COMPLETED`, `usedSessions++`, tiền kiếm được vượt quỹ về AVAILABLE; phần góp vào quỹ (nếu quỹ chưa đầy và chưa từng đền) ở lại và thuộc loại A. Không cần hoãn gì → đáp ứng D34 và D42 mà không thêm trạng thái mới.
- Nếu về sau cần hoãn giải phóng thật của một buổi đã xác nhận, cần trạng thái `DEFERRED` cho `SessionSettlement` (hôm nay chỉ PENDING/PROCESSING/SETTLED/FAILED; FAILED quét lại mỗi 5 phút mãi, `session-settlement-sweep.service.ts`). D42 đã chọn không làm. Mục 11 dùng ĐÚNG trạng thái đó cho lệnh `HOLD_REQUEST` nhưng ở bảng riêng, không đụng `SessionSettlement`.

### 10.4 Tương tác với phần đã có

- **Khách rút khi PT bị hạn chế (D32/D36/D37)**: khách vẫn nhận ngay 100% phần chắc chắn chưa thực hiện (`US/services/client-exit.service.ts` `terminateAsClient`); hold không làm khách chờ; buổi treo giữ bằng `unresolvedHeld`, nay cho mọi lý do (mục 2.3). D37 (không âm thầm đổi 100% thành 90%): hold không đổi lý do hay công thức hoàn.
- **Quét tiền giữ 30 ngày (D24/D29/D30)**: hold ACTIVE → payment-service từ chối (mục 6 dòng 4). Hôm nay quét bỏ qua PT/hợp đồng bị hạn chế (`contractService.releaseIdleHoldbacks`), nhưng hạn chế ≠ hold: hạn chế có thể gỡ trong khi tranh chấp tiền chưa xong; hold là hàng rào duy nhất bảo vệ quỹ sau khi hạn chế gỡ. Căn cứ nào của hold cũng làm hợp đồng "không nhàn rỗi" theo `findIdleHoldbackCandidates` (buổi `DISPUTED`/`PT_NO_SHOW_REPORTED` là hoạt động; hạn chế cấp hợp đồng bị loại), nên quét chỉ chạm hold trong khe vài mili-giây mô tả ở mục 11.4.
- **Hạn chế, cấm và hold (D38/D44/D47)**: hạn chế tài khoản/hợp đồng KHÔNG tự mở hold. Gỡ hạn chế không đóng hold; đóng hold không gỡ hạn chế. Cấm vĩnh viễn: lệnh gỡ dùng lý do mới (mục 9) và cơ chế an toàn của mục 11 bảo vệ quỹ của các hợp đồng CÓ CĂN CỨ RIÊNG ngay lúc cấm, mà không đòi "đóng băng xong mới cấm".
- **Rút tiền tối thiểu (D26)**: khoản đền dưới 10.000đ không rút riêng được (hiển thị trong ví khách; đây là mặc định của thiết kế, chưa có quyết định riêng của chủ sở hữu).

---

## 11. Cơ chế an toàn khi cấm / đình chỉ: giao dịch và khôi phục giữa hai dịch vụ (N6, D47)

### 11.1 Yêu cầu của chủ sở hữu, đọc nguyên văn thành kiểm tra được

| # | Yêu cầu D47 | Kiểm tra được bằng |
|---|---|---|
| R1 | Chủ sở hữu BÁC "đóng băng xong mới được cấm": quyết định an toàn (hạn chế) áp dụng NGAY | Lệnh cấm/đình chỉ thành công không phụ thuộc payment-service (HT-80) |
| R2 | Bảo vệ tiền đồng bộ hoặc qua một trạng thái chờ an toàn | Có trạng thái `PENDING_SYNC` thật, có cổng chặn, có kiểm thử (HT-81) |
| R3 | Không có khe để giải ngân chạy khi một khoản giữ hợp lệ đang áp | Mọi cửa trả quỹ (mục 5.5) tự đọc yêu cầu/hold (HT-82); khe còn lại được nêu và phát hiện (11.4 dòng 9) |
| R4 | Giữ thất bại không được báo thành công | Chỉ có `ACTIVE` khi payment-service xác nhận; còn lại `PENDING_SYNC`/`REJECTED` (HT-83) |
| R5 | payment-service lỗi không chặn đình chỉ khẩn cấp | Không có lời gọi payment-service nào trong giao dịch hạn chế (HT-80) |
| R6 | Hạn chế tài khoản không tự đóng băng quỹ MỌI hợp đồng | Yêu cầu bảo vệ chỉ sinh cho hợp đồng có căn cứ riêng (11.2c); HT-84 |

### 11.2 Thiết kế

Hiện trạng (`CODE AUDIT`, `US/services/pt-deactivation.service.ts`): lệnh khoá đến theo `seq` từ auth-service (`PtDeactivationCall`, relay + quét thử lại); `claimLockCommand` trong MỘT giao dịch DB của user-service ghi `seq`, đóng/mở bản ghi hạn chế và cờ `ptSuspended` — tức quyết định an toàn đã áp ngay và không gọi payment-service; sau đó `unwindContract` từng hợp đồng: huỷ buổi chưa diễn ra → `settleContractTermination` (gọi payment-service, khoá `CONTRACT_TERMINATE:<id>`), lỗi thì hợp đồng ở lại trạng thái "cần xử lý" và relay gọi lại. Thiết kế dưới đây CHỈ thêm vào khung đó, không đổi nó.

**(a) Bảng lệnh `ContractHoldRequest` (user-service, kiểu outbox).** Lệnh là của user-service; trạng thái tiền là của payment-service (mục 4).

```prisma
enum HoldRequestStatus { REQUESTED CONFIRMED REJECTED }

model ContractHoldRequest {
  id            String            @id @default(uuid())   // = requestId gửi payment-service (khoá chống lặp)
  contractId    String            @map("contract_id")
  paymentTransactionId String     @map("payment_transaction_id")
  ptUserId      String            @map("pt_user_id")
  basisType     String            @map("basis_type")     // SESSION_DISPUTE | SESSION_NO_SHOW_REPORT | CONTRACT_RESTRICTION
  basisRef      String            @map("basis_ref")
  origin        String                                    // ADMIN_OPEN | BAN_PROTECTION
  requestedBy   String            @map("requested_by")   // adminId
  reason        String
  lockSeq       BigInt?           @map("lock_seq")       // lệnh cấm đã sinh ra nó (nếu origin = BAN_PROTECTION)
  status        HoldRequestStatus @default(REQUESTED)
  attempts      Int               @default(0)
  lastError     String?           @map("last_error")
  nextAttemptAt DateTime          @default(now()) @map("next_attempt_at")
  holdId        String?           @map("hold_id")        // của payment-service, khi CONFIRMED
  rejectedCode  String?           @map("rejected_code")  // HOLD_NOT_APPLICABLE | HOLD_NOTHING_TO_HOLD | CONTRACT_ALREADY_SETTLED
  createdAt     DateTime          @default(now()) @map("created_at")
  confirmedAt   DateTime?         @map("confirmed_at")

  @@unique([contractId, basisType, basisRef])            // mở/ cấm lặp không sinh hai lệnh
  @@index([status, nextAttemptAt])
  @@index([contractId, status])
  @@map("contract_hold_requests")
}
```

**(b) Cổng cục bộ.** Một hàm duy nhất `hasOpenHoldRequest(contractId, db)` = tồn tại dòng `status = REQUESTED`. Nó được gọi ở ĐÚNG hai chỗ làm quỹ có thể rời hợp đồng (mục 5.5): `settleContractTermination` (không chặn chấm dứt — chỉ quyết định có đính kèm lệnh hay không) và `contractService.releaseIdleHoldbacks` (bỏ qua hợp đồng). Đọc ngay trong DB của chính user-service, cùng DB với quyết định hạn chế, nên không có độ trễ hay mất kết nối nào làm cổng sai.

**(c) Quyết định cấm sinh lệnh bảo vệ trong CÙNG giao dịch.** Trong `claimLockCommand` (giao dịch hiện có, dưới khoá PT), TRƯỚC khi đóng các hạn chế cấp hợp đồng, với mỗi hợp đồng đang mở (`BLOCKING_CONTRACT_STATUSES`) có thanh toán và `ptHoldbackRate > 0` mà có **căn cứ riêng** (buổi `DISPUTED`, buổi `PT_NO_SHOW_REPORTED`, hoặc hạn chế cấp hợp đồng đang mở) thì ghi một dòng `ContractHoldRequest` `REQUESTED` (`origin = BAN_PROTECTION`, `lockSeq`). Hợp đồng không có căn cứ riêng KHÔNG có dòng nào (R6). Hạn chế tạm thời (đình chỉ) không sinh lệnh tự động: admin dùng `POST /admin/contracts/:id/financial-hold` khi cần (không có hợp đồng nào bị chấm dứt khi đình chỉ nên quỹ không rời đi; quét nhàn rỗi đã loại PT bị hạn chế). Hôm nay tất cả hợp đồng có tỷ lệ 0 nên không sinh lệnh nào; tính "đang bật" của đoạn này phụ thuộc cờ của U6.

**(d) Lệnh chấm dứt đính kèm yêu cầu.** `settleContractTermination` đọc các dòng `REQUESTED` của hợp đồng ngay trước khi gọi payment-service và gửi kèm `holdRequests: [{ requestId, basisType, basisRef, openedBy, openReason }]`. Trong `terminateContract` (đã chạy dưới khoá ví và khoá `CONTRACT_TERMINATE:<id>`), TRƯỚC khi tính top-up/đền, payment-service gọi `ensureHold` (idempotent theo `requestId`/`transactionId`): nếu hợp đồng thoả điều kiện 1–2, 4–6 của mục 7.1 thì tạo hold (+ nghĩa vụ `OPEN`) rồi chạy nhánh "có hold" của mục 6 dòng 3; điều kiện 3 ("chưa kết thúc") không áp vì chính lệnh này là lệnh kết thúc. Nhờ vậy việc tạo hold và việc KHÔNG trả quỹ là MỘT giao dịch ghi sổ: không có khe giữa "hold có" và "quỹ chưa trả". Kết quả trả về kèm `holds: [{requestId, holdId, status}]`; user-service cập nhật dòng lệnh thành `CONFIRMED` (hoặc `REJECTED` + mã).

**(e) Đồng bộ nền khi chưa có lệnh chấm dứt.** Tiến trình `syncHoldRequests` (mỗi phút, cùng khung `session-settlement-sweep`) lấy các dòng `REQUESTED` có `nextAttemptAt ≤ now`, gọi `POST /internal/holds/ensure` (idempotent theo `requestId`); thành công → `CONFIRMED`; từ chối cuối (`HOLD_NOT_APPLICABLE`, `HOLD_NOTHING_TO_HOLD`, `CONTRACT_ALREADY_SETTLED`) → `REJECTED`; lỗi tạm → `attempts++`, `nextAttemptAt` lùi mũ (tối đa 15 phút). Một dòng `REQUESTED` quá 15 phút, hoặc `attempts ≥ 5`, vào hàng đợi ưu tiên của admin dưới tên "bảo vệ tiền chưa xác nhận" (thông báo + `AuditLog`).

**(f) Đối soát định kỳ (mỗi ngày).** So sánh hai chiều: (i) dòng `CONFIRMED` mà payment-service không có hold `ACTIVE`/`CLOSED` tương ứng; (ii) hold `ACTIVE` ở payment-service không có dòng lệnh; (iii) dòng `REQUESTED` mà hợp đồng đã kết thúc và quỹ đã trả (tức rơi vào khe). Mỗi lệch vào hàng đợi admin; không có sửa tiền tự động.

**(g) Ngôn ngữ trạng thái với người dùng (R4).** Mọi API/giao diện về hold chỉ có ba giá trị: `PENDING_SYNC` ("đang bảo vệ tạm thời, chưa xác nhận ở sổ cái"), `ACTIVE`, `REJECTED` (kèm lý do). Không có đường nào trả `ACTIVE` khi payment-service chưa xác nhận. Thông báo "đã giữ tiền" chỉ gửi khi `CONFIRMED`.

### 11.3 Trình tự khi admin cấm một PT có hai hợp đồng có căn cứ (ví dụ)

PT An bị cấm. Hợp đồng Bình (5.000.000đ, buổi 6 `DISPUTED`, quỹ 500.000) và Chi (5.000.000đ, không tranh chấp, quỹ 450.000).
1. auth-service ghi `PtDeactivationCall` (seq n) và relay tới user-service (như hôm nay).
2. user-service, MỘT giao dịch: nhận seq, mở hạn chế `PERMANENT_BAN`, ghi cờ — **và** ghi lệnh `REQUESTED` cho Bình (căn cứ buổi 6). Không có lệnh cho Chi. Không có lời gọi payment-service. *Từ lúc commit, hạn chế đã áp và cổng đã đóng cho Bình.*
3. `unwindContract(Bình)`: gọi huỷ buổi chưa diễn ra (F1; buổi 6 `DISPUTED` được giữ, F2) → `settleContractTermination` đọc lệnh `REQUESTED`, gửi `terminate` kèm `holdRequests`. payment-service: tạo hold + nghĩa vụ `OPEN`, hoàn khách phần chưa dùng, KHÔNG trả quỹ 500.000, giữ giá trị buổi 6 (`unresolvedHeld`). user-service: lệnh → `CONFIRMED`.
4. `unwindContract(Chi)`: không lệnh; `terminate` chạy; quỹ 450.000 về An theo chính sách không lỗi (mục 9).
5. Nếu bước 3 gặp payment-service ngừng: hợp đồng Bình ở lại "cần xử lý" như hôm nay, lệnh vẫn `REQUESTED`, cổng chặn quét nhàn rỗi; khi payment-service trở lại, relay hoặc `syncHoldRequests` chạy trước/sau — thứ tự nào cũng đúng vì `terminate` đính kèm lệnh và `ensure` đều idempotent theo `requestId`.

### 11.4 Bảng tình huống lỗi

| # | Tình huống | Điều xảy ra | An toàn nhờ | Khôi phục | Rủi ro còn lại |
|---|---|---|---|---|---|
| 1 | payment-service ngừng lúc cấm/đình chỉ | Hạn chế commit ngay; lệnh `REQUESTED`; `terminate` thất bại, hợp đồng "cần xử lý" | Hạn chế và lệnh trong một giao dịch DB của user-service; không gọi payment-service trong giao dịch (R1, R5) | relay (auth-service) và `syncHoldRequests` thử lại có lùi mũ | Khách chờ hoàn tiền lâu hơn (như hôm nay); không mất tiền |
| 2 | `ensure`/`terminate` hết giờ nhưng payment-service đã ghi | user-service không biết kết quả | Idempotent theo `requestId`/`CONTRACT_TERMINATE:<id>` | Gọi lại nhận kết quả cũ; dòng lệnh → `CONFIRMED` | Không |
| 3 | user-service sập giữa giao dịch hạn chế | Giao dịch hoàn tác toàn bộ (hạn chế, lệnh, cờ cùng nhau) | Một giao dịch DB | auth-service thử lại cùng `seq` (`RETRY`) | Không |
| 4 | payment-service từ chối: tỷ lệ 0 / không có quỹ / đã giải phóng | Lệnh → `REJECTED` + mã | Không báo thành công (R4) | Admin thấy "không có quỹ để giữ"; không việc gì thêm | Không |
| 5 | payment-service lỗi tạm kéo dài | Lệnh `REQUESTED`, `attempts` tăng | Cổng chặn quét nhàn rỗi; `terminate` cũng không chạy được (cùng dịch vụ) | Hàng đợi ưu tiên khi > 15 phút hoặc ≥ 5 lần | Quỹ không rời đi trong lúc đó, nên không mất |
| 6 | `terminate` đính kèm lệnh, payment-service chạy bình thường | Tạo hold và carve-out trong một giao dịch ghi sổ | Cùng khoá ví (mục 5) | — | Không |
| 7 | Sập giữa ghi sổ và ghi trạng thái hợp đồng | Sổ cái đã kết thúc + hold; user-service hợp đồng còn "cần xử lý" | Khoá `CONTRACT_TERMINATE:<id>` phát lại kết quả; kèm `holds` | relay gọi lại; lệnh → `CONFIRMED` | Nhãn lý do có thể lệch tạm thời (đã ghi ở mục 9) |
| 8 | Quét nhàn rỗi chạy đúng lúc có lệnh `REQUESTED` | Quét bỏ qua hợp đồng | Cổng cục bộ (mục 11.2b) đọc cùng DB | — | Không |
| 9 | **Quét nhàn rỗi đã qua cổng ngay TRƯỚC khi lệnh được ghi, rồi gọi payment-service ngay SAU khi lệnh ghi và `ensure` chưa tới** | Quỹ có thể được trả cho PT khi lệnh đã tồn tại | Khe chỉ rộng vài mili-giây, và chỉ xảy ra khi hợp đồng đang "nhàn rỗi ≥ 30 ngày" mà vẫn xuất hiện căn cứ mới: các căn cứ hợp lệ (buổi chờ/tranh chấp/hạn chế hợp đồng) đều làm hợp đồng KHÔNG nhàn rỗi (`findIdleHoldbackCandidates`), nên quét đã kiểm lại ngay trước lời gọi | **Phát hiện, không tự thu hồi**: sau lời gọi quét, đọc lại cổng; nếu có lệnh được tạo giữa lúc bắt đầu và kết thúc lời gọi → `AuditLog` + hàng đợi ưu tiên "quỹ đã trả khi có căn cứ"; việc xử lý là quyết định của admin (không tự thu hồi từ AVAILABLE gộp — N7) | Có, bị chặn trên: tối đa quỹ của MỘT hợp đồng (≤ 10% giá), ví dụ 500.000đ trên hợp đồng 5.000.000đ; xác suất rất thấp. Cần Ngài chấp nhận (câu 3 mục 18) hoặc đòi khoá mạnh hơn (đánh đổi nêu ở 11.5) |
| 10 | Lệnh khoá/mở cũ đến trễ hoặc lặp | `seq` loại bỏ lệnh cũ (`STALE`) | Cơ chế `seq` đã có | — | Không |
| 11 | Mở/cấm lặp, admin bấm đúp | `@@unique([contractId, basisType, basisRef])` + `requestId` | Ràng buộc DB | Trả lệnh cũ | Không |
| 12 | Cấm → mở khoá → cấm lại | Căn cứ mới thêm lệnh mới; lệnh cũ KHÔNG bị mở khoá làm huỷ (hold ≠ hạn chế) | Hold độc lập với hạn chế (mục 10.4) | Admin đóng hold thủ công | Quỹ giữ lâu hơn nếu admin quên → hàng đợi 14 ngày |
| 13 | payment-service trở lại sau ngừng dài, có đống việc | Nhiều `terminate`, nhiều `ensure` | Mỗi cái idempotent; thứ tự nào cũng cho cùng kết quả vì `terminate` tự đính kèm lệnh | Tự hết | Không |
| 14 | Lệch hai bên phát hiện bởi đối soát hằng ngày | Dòng `CONFIRMED` không có hold, hold không có lệnh, hoặc lệnh `REQUESTED` mà quỹ đã trả | Đối soát (11.2f) | Hàng đợi admin; sửa bằng thao tác có nhật ký, không sửa tiền tự động | Phát hiện chậm tối đa 1 ngày |
| 15 | Hợp đồng đã kết thúc (quỹ đã trả PT) TRƯỚC khi có căn cứ/lệnh | Lệnh bị `REJECTED: CONTRACT_ALREADY_SETTLED` | Không hồi tố (mục 7.1 điều kiện 3) | Thông báo admin: "quỹ đã trả trước khi có căn cứ"; trách nhiệm đền (nếu có) là chuyện riêng, ngoài quỹ | Có, theo thiết kế (D44, không hồi tố) |

### 11.5 Vì sao không dùng khoá mạnh hơn, và đánh đổi (cho Ngài chọn ở câu 3)

Khe ở dòng 9 xuất phát từ một sự thật: hai dịch vụ có hai DB, không có giao dịch phân tán. Ba cách đóng khe, theo thứ tự tăng độ chặt:
- **Cách hiện tại (khuyến nghị)**: cổng cục bộ + phát hiện sau. Không chặn quyết định an toàn; khe bị chặn trên bởi một quỹ.
- **Khoá hợp đồng ở user-service quanh lời gọi quét**: giữ một khoá DB (advisory lock theo hợp đồng) suốt lời gọi quét, và giao dịch tạo lệnh phải lấy cùng khoá. Đóng khe hoàn toàn, NHƯNG giao dịch hạn chế phải chờ nếu quét đang gọi payment-service chậm — tức là khi payment-service treo, lệnh cấm khẩn cấp có thể bị chặn đến hết thời gian chờ. Trái R5; bị loại.
- **payment-service từ chối trả quỹ nếu thiếu "chứng nhận không có lệnh" còn hạn**: user-service xin payment-service một chứng nhận ngắn hạn trước mỗi lần trả; lệnh mới huỷ chứng nhận. Đóng khe, nhưng thêm một vòng hai chiều cho mỗi lần quét và chính nó cần payment-service sống — nhẹ hơn khoá nhưng thêm bề mặt lỗi; chỉ nên làm nếu Ngài không chấp nhận rủi ro dòng 9.

### 11.6 Khác gì với "đóng băng trước khi cấm"

Chủ sở hữu bác phương án đó vì nó làm quyết định an toàn phụ thuộc vào một dịch vụ khác. Ở đây quyết định an toàn không đợi gì; tiền được bảo vệ bằng một lệnh nằm trong CÙNG giao dịch với quyết định, và mọi cửa tiền đều tự đọc lệnh. Giá phải trả: một bảng mới, một tiến trình đồng bộ nền, một đối soát, và khe 9 (đã nêu rõ).

---

## 12. Điều kiện bắt buộc trước khi bật giữ lại 10%

`CODE AUDIT` (mã hôm nay; mục "nhóm" theo D51). "Chặn lát 5" = phải sửa TRƯỚC khi viết lát 5 vì mã lát 5 hoặc kiểm thử của nó dựa vào. "Chặn bật 10%" = lát 5 có thể viết xong, nhưng không được bật `resolvePtHoldbackRate` cho tới khi sửa. Cột "Sống hôm nay" = có thể làm mất/sai tiền thật ngay khi tỷ lệ giữ vẫn 0.

| # | Lỗi (một dòng) | Chỗ trong mã (`CODE AUDIT`) | Nhóm / đơn vị | Chặn lát 5 | Chặn bật 10% | Sống hôm nay? |
|---|---|---|---|---|---|---|
| 1 | **Buổi sót trên hợp đồng đã kết thúc**: nhiều đường chấm dứt không huỷ buổi chưa diễn ra; buổi sót còn kích hoạt bồi thường vắng/muộn lần hai, trừ AVAILABLE gộp của PT. *D55: dữ liệu CŨ (157 buổi sót trên dev) là việc RIÊNG, kiểm kê + dry-run trước và DỪNG chờ Ngài duyệt (mục 16.2); F1 chỉ sửa đường mã mới* | `US/services/contract-session-closure.ts` (mới, đang viết); sinks: `availability.service.ts` `addException`, `booking.service.ts` `cancelSession`/`markNoShow`/`resolveDispute`, `room-close-resolution.service.ts`; tiền: `PS/services/contract-ledger.service.ts:594-603, 675-684` | **Nhóm 1 / F1** (agent khác) | CÓ | CÓ | CÓ (P0) — `ĐỌC DB DEV`: 157 buổi `CONFIRMED` còn treo trên hợp đồng đã kết thúc (141 hợp đồng `COMPLETED`, 16 `EXPIRED`); không hợp đồng nào đã thanh toán nên chưa kích hoạt tiền |
| 2 | **Chấm dứt bằng lý do khác chia giá trị buổi chờ/tranh chấp**; đường cấm thì huỷ cả buổi chờ/tranh chấp | `contract-payout.service.ts` `terminationTermsFor`, `isExitSettlementOpen`; `booking.service.ts` `resolveDispute` (`heldOnExit`); `pt-deactivation.service.ts` `FUTURE_SESSION_STATUSES` | **Nhóm 1 / F2** | CÓ | CÓ | CÓ (P0) |
| 3 | **Xác nhận ghi đè buổi đã khác trạng thái** | `session.repository.ts` `claimDeduction`; `booking.service.ts` `clientConfirmSession`, `resolveDispute`; `session-autoconfirm.service.ts` | **Nhóm 1 / F3** | CÓ | CÓ | CÓ (P1) |
| 4 | **Rút ví gộp / nền tảng ứng khi đền**: `compensateNoShow`, `compensateLateArrival`, kẹp thu hồi, `coverShortfall` | `PS/services/contract-ledger.service.ts:594-603, 620-627, 675-684, 695-702, 1048-1058, 1124-1133, 343-353` | **Kiểm toán: Nhóm 1** (`PT_COMPENSATION_SOURCE_AUDIT.md`); **sửa: U5**, sau khi Ngài chọn cách xử lý nghĩa vụ cũ | Không | **CÓ** | CÓ ở mã (P0); `ĐỌC DB DEV`: 0đ thực rút từ AVAILABLE |
| 5 | **Nhiều nguồn tính tiền**: `alreadyReleased`, `usedSessions`, `compensatedSessions`, `unresolvedSessions` do user-service gửi, không suy từ sổ cái; tăng `releasedTo*` không chống lặp | `contract-payout.service.ts` `settleContractTermination`, `releaseSessionMoney` | **Nhóm 2 / F4** | Một phần (F4 chuẩn bị `paidFromPot`) | **CÓ** | CÓ (P1) |
| 6 | **`PT_BANNED` là lý do lỗi PT** | `pt-deactivation.service.ts` `unwindContract`; `contract-money.ts:321-325`; `contract.controller.ts:621-632` | **Nhóm 2 / F5** | CÓ | CÓ | Không (vô hại khi tỷ lệ 0) |
| 7 | **Quét nhàn rỗi tự đánh dấu "đã giải phóng" dù payment-service từ chối** | `contract.service.ts` `releaseIdleHoldbacks`; `contract.repository.ts` `markHoldbackReleased` | **Nhóm 2 / F6** | CÓ | CÓ | Không (tiềm ẩn) |
| 8 | **Quỹ là số suy ra từ hậu tố, đếm trùng được** (mục 3.6, W1–W5) | `PS/services/contract-ledger.service.ts:120-188` | **U1** | CÓ (mọi bước sau dựa vào `potOf`) | CÓ | Không |
| 9 | **Buổi chờ treo mãi cho PT bị hạn chế/cấm**; cộng bù hạn xác nhận. *D53: dừng tự xác nhận hiện nay chỉ là biện pháp chuyển tiếp; quy tắc đích là điều kiện nghiệm thu của Financial Hold (mục 10.2)* | `session-autoconfirm.service.ts`; `session.repository.ts`; `pt-restriction.service.ts` | **U7** | Không | CÓ | CÓ (P1, chỉ khi có hạn chế/cấm) |
| 10 | **Lệch user-service ↔ sổ cái khi gọi chéo hết giờ/lặp**: ghi trạng thái hợp đồng sau lời gọi tiền; 409 `NO_UNRESOLVED_HELD` bị thử lại mãi | `settleContractTermination`; `session-settlement.service.ts`; `PS/services/contract-ledger.service.ts:1333-1341` | F4 (6a, 6d) + F2 | Một phần | CÓ | CÓ (P1) |
| 11 | **Sổ phụ (ví, PENDING, hợp đồng) âm trên dev** — hậu quả của lỗi vét tiền chờ đã sửa (`2578561`) | `ĐỌC DB DEV`: 7 sổ phụ âm (mục 3.6, W4); `_warroom/TINH_THE.md`: ~3.880.000đ chưa hoàn lại | Báo cáo đối soát (mục 17), quyết định riêng của Ngài | Không | CÓ (phải sạch trước khi bật) | CÓ (dữ liệu) |
| 12 | **Chức năng xác nhận điều khoản (D25) chưa có**; quyền đồng ý của PT không được ghi ở backend (`ĐỌC mã`: hộp chọn "Điều khoản" chỉ gate nút gửi ở `frontend/web/.../PTApplicationPage.tsx`, không thấy trường lưu ở user-service) | `pt-holdback-rate.ts:23-25` (`ptUserId` chưa dùng) | **Cổng G** | Không | **CÓ** | Không |

Hậu quả nếu bật 10% mà chưa sửa: 1, 4 làm lấy tiền hợp đồng khác (trái D43/D48) và có thể ăn vào quỹ đang đóng băng; 2, 3 làm mất hoặc nhân đôi tiền buổi; 5, 8 làm quỹ đếm trùng; 6 làm cấm = đền mọi khách; 7 làm hợp đồng mất quỹ vĩnh viễn sau lần từ chối đầu; 9, 10 treo hoặc lệch tiền; 12 là hợp đồng với PT không có bằng chứng đã đồng ý.

---

## 13. Cuộc đua, di trú, cờ bật

### 13.1 Các cuộc đua và cơ chế đóng

| # | Cuộc đua | Cơ chế đóng |
|---|---|---|
| R1 | Admin mở hold ⟷ quét 30 ngày đang trả quỹ | Cả hai trong `withWallets` cùng tập khoá; hold-open thấy dấu "released" (từ chối `HOLD_NOT_APPLICABLE`) hoặc quét thấy hold (từ chối). Khe phía user-service: mục 11.4 dòng 9 |
| R2 | Mở hold ⟷ `terminateContract` | Cùng khoá; mở độc lập kiểm khoá `CONTRACT_TERMINATE:<id>`. Terminate thắng → mở hold từ chối (và lệnh `REJECTED: CONTRACT_ALREADY_SETTLED`); hold thắng → terminate thấy hold và giữ quỹ. Lệnh ĐÍNH KÈM terminate không có khe |
| R3 | Mở hold ⟷ `releaseSession` | Tuần tự; cả hai thứ tự hợp lệ (mục 6 dòng 1) |
| R4 | Hai phán nghĩa vụ đồng thời cho CÙNG nghĩa vụ | Khoá ví tuần tự hoá; lần hai phát lại hoặc `OBLIGATION_ALREADY_RULED`. HT-43 |
| R5 | Hai phán nghĩa vụ KHÁC nghĩa vụ đồng thời | Khoá ví tuần tự hoá; lần hai thấy `potOf` và `paidFromPot` đã cập nhật; Σ ≤ min(giới hạn, quỹ). HT-17 |
| R6 | Phán nghĩa vụ ⟷ `terminateContract` | Cùng khoá. Phán trước: `terminate` đọc `paidFromPot` nên không shortfall. Terminate trước: hold còn ACTIVE, phán vẫn hợp lệ trên quỹ nằm lại |
| R7 | Thử lại sau timeout | Cùng `decisionId` → phát lại; user-service chỉ ghi POSTED khi nhận kết quả |
| R8 | `releaseSession` ⟷ `terminate` cùng khoản | Tuần tự bằng khoá ví, kẹp `ownPending`; phần buổi treo bảo vệ bằng `unresolvedHeld` |
| R9 | Lệnh khoá/mở cũ đến trễ ⟷ hold | Hold không phụ thuộc hạn chế; lệnh cấm sinh lệnh bảo vệ theo `seq` (mục 11) |
| R10 | Hold ⟷ rút tiền của PT | Không giao nhau (hold ở PENDING/HOLDBACK; rút ở AVAILABLE/LOCKED). HT-21 |
| R11 | Phán ⟷ rút tiền của khách | Phán chỉ ghi CREDIT AVAILABLE khách; rút tính từ tổng credit "refund/compensation" trừ đã chi |
| R12 | Hai kết thúc hợp đồng khác lý do cùng lúc | Khoá `CONTRACT_TERMINATE:<id>`: kết quả đầu thắng; `endedAt/endReason` ghi đúng một lần |
| R13 | Buổi chuyển sang chờ xác nhận GIỮA lúc đếm `unresolvedSessions` và lúc ghi trạng thái kết thúc | Mọi hành động PT trên hợp đồng yêu cầu hợp đồng đang chạy ở điểm ghi (F2/F3); phần còn lại: kiểm lại số buổi treo sau khi ghi trạng thái, lệch → cảnh báo, không tự sửa tiền |
| R14 | Sweep hoàn thanh toán không kích hoạt được ⟷ hold | Hold không tồn tại trên hợp đồng chưa kích hoạt; nếu có thì ném lỗi |
| R15 | **Lệnh bảo vệ ⟷ `terminate`/quét nhàn rỗi** (N6) | Lệnh cùng giao dịch với hạn chế; `terminate` đính kèm lệnh; quét đọc cổng; khe 11.4 dòng 9 |
| R16 | **Hai lệnh cho cùng căn cứ** | `@@unique([contractId, basisType, basisRef])` + `requestId` idempotent ở payment-service |
| R17 | **`ensure` ⟷ `releaseSession` cùng hợp đồng** | Cùng khoá ví; cả hai thứ tự hợp lệ |

### 13.2 Di trú và hợp đồng cũ

Danh sách migration của cả kế hoạch (viết tay, `migrate deploy` trên DB `*_test`; KHÔNG `migrate dev`/`db push`, KHÔNG áp lên DB dev trong phiên thiết kế này):

| Đơn vị | Dịch vụ | Nội dung | Không hồi tố? |
|---|---|---|---|
| F5 | user-service | `ALTER TYPE "TerminationReason" ADD VALUE 'SERVICE_DISCONTINUED_BY_PLATFORM'` | Có |
| U1 (nếu M1) | payment-service | `ALTER TYPE "LedgerBucket" ADD VALUE 'HOLDBACK'`; `ALTER TABLE wallets ADD COLUMN holdback_balance numeric(14,2) NOT NULL DEFAULT 0` | Có (0 dòng quỹ để chuyển; mục 3.7) |
| U2 | payment-service | 3 bảng + 2 enum + chỉ mục duy nhất một phần + CHECK (mục 4.2) | Có |
| U6 | user-service | bảng `contract_hold_requests` + enum; giá trị `NotificationEventType` (quá hạn, bảo vệ chưa xác nhận, quỹ đã trả khi có căn cứ) | Có |

Không backfill, không sửa dòng sổ cái cũ, không đổi cột `Contract`. Hợp đồng đang có (tỷ lệ 0): không mở hold được; mọi hàm di chuyển tiền chạy như cũ vì `readActiveHold` trả rỗng và `paidFromPot = 0` (HT-26 ghim: kết quả JSON không có khoá mới khi không hold — cùng nguyên tắc "khoá không tồn tại thay vì `undefined`" ở `PS/services/contract-ledger.service.ts:1157-1169`). Hợp đồng ký sau khi bật 10% mới có quỹ; hợp đồng cũ không bao giờ bị áp dụng hồi tố.

### 13.3 Cờ bật (mặc định tắt)

| Cờ | Bật gì | Ai đặt |
|---|---|---|
| `FINANCIAL_HOLD_ENABLED` (payment-service) | route `hold/open|read|close|extend|assign`, `holds/ensure` | U3 |
| `FINANCIAL_HOLD_PAYOUT_ENABLED` (payment-service) | bước kết luận + giải ngân nghĩa vụ | U4, sau câu 1 mục 18 |
| `BAN_PROTECTION_ENABLED` (user-service) | sinh lệnh bảo vệ trong `claimLockCommand`, `syncHoldRequests`, cổng quét | U6 |
| `AUTOCONFIRM_RESTRICTED_ENABLED` (user-service) | mục 10.2 | U7 |
| `resolvePtHoldbackRate` trả `"0.10"` | **cổng G** | Ngài |

---

## 14. Bảng đối soát — ví dụ của chủ sở hữu

Hợp đồng 5.000.000đ, 10 buổi (mỗi buổi 500.000đ = PT 450.000 + nền tảng 50.000), PT 90% / nền tảng 10% / không gym. 4 buổi đã hoàn thành, 1 buổi (S5) đang chờ khách xác nhận, 1 buổi (S6) đang tranh chấp, 4 buổi chưa diễn ra. Khách rút trung tính (lý do `CLIENT_EXIT_DUE_TO_PT_RESTRICTION`, hoàn 100% phần chưa dùng, không phí, không đền). Sau đó S5 được xác nhận đã dạy, S6 được phán chưa dạy.

Đơn vị: đồng. "Giữ" = chưa thể giải phóng. Dòng "Tổng kiểm" = hoàn cho khách + PT + gym + nền tảng + (giữ + chưa kiếm) + bảo đảm, phải bằng đúng 5.000.000 ở mọi cột.

### 14.1 Bảng 1 — tỷ lệ giữ lại TẮT (hôm nay)

Nhãn: cột 2 `TÍNH TAY` (kịch bản C không in cột này, tính từ cùng công thức và khớp các cột sau); cột 3–5 `BACKEND INTEGRATION` (số in ra của kịch bản C `US/__tests__/cross-service-money.e2e.test.ts:253`, do điều phối viên báo, tại hạ không chạy lại): sau khi rút khách 2.000.000 / PT khả dụng 1.800.000 / PT giữ 900.000 / nền tảng khả dụng 200.000 / nền tảng giữ 100.000; sau khi xác nhận PT 2.250.000 / giữ 450.000 / nền tảng 250.000 / giữ 50.000 / khách 2.000.000; cuối cùng đã dùng 5, chưa dùng 5, khách 2.500.000, PT 2.250.000, nền tảng 250.000, không còn gì chờ. Cột 1 `TÍNH TAY`.

| Chỉ tiêu | 1. Vừa thanh toán | 2. Sau 4 buổi hoàn thành (còn S5, S6) | 3. Sau khi khách rút trung tính | 4. Sau khi S5 được xác nhận đã dạy | 5. Sau khi S6 được phán chưa dạy |
|---|---|---|---|---|---|
| Khách đã trả | 5.000.000 | 5.000.000 | 5.000.000 | 5.000.000 | 5.000.000 |
| Đã hoàn cho khách (luỹ kế, ví khách) | 0 | 0 | 2.000.000 | 2.000.000 | 2.500.000 |
| PT đã kiếm (khả dụng) | 0 | 1.800.000 | 1.800.000 | 2.250.000 | 2.250.000 |
| Phần gym | 0 | 0 | 0 | 0 | 0 |
| Doanh thu nền tảng (khả dụng) | 0 | 200.000 | 200.000 | 250.000 | 250.000 |
| Chưa thể giải phóng — S5 (chờ xác nhận): PT / nền tảng | 0 | 450.000 / 50.000 | 450.000 / 50.000 | 0 | 0 |
| Chưa thể giải phóng — S6 (tranh chấp): PT / nền tảng | 0 | 450.000 / 50.000 | 450.000 / 50.000 | 450.000 / 50.000 | 0 |
| Chưa thể giải phóng — tổng giữ theo buổi | 0 | 1.000.000 | 1.000.000 | 500.000 | 0 |
| Chưa kiếm (pending của 4 buổi chưa diễn ra; ở cột 1 là cả 10 buổi) | 5.000.000 | 2.000.000 | 0 (đã hoàn khách) | 0 | 0 |
| Tiền bảo đảm 10% | 0 (tắt) | 0 | 0 | 0 | 0 |
| Số dư ESCROW | 5.000.000 | 5.000.000 | 5.000.000 | 5.000.000 | 5.000.000 |
| **Tổng kiểm** (hoàn + PT + gym + nền tảng + giữ theo buổi + chưa kiếm + bảo đảm) | 0+0+0+0+0+5.000.000+0 = **5.000.000** | 0+1.800.000+0+200.000+1.000.000+2.000.000+0 = **5.000.000** | 2.000.000+1.800.000+0+200.000+1.000.000+0+0 = **5.000.000** | 2.000.000+2.250.000+0+250.000+500.000+0+0 = **5.000.000** | 2.500.000+2.250.000+0+250.000+0+0+0 = **5.000.000** |

Tách phần giữ của cột 3 theo ví để khớp số in ra: PT giữ 900.000 (450.000 × 2 buổi) và nền tảng giữ 100.000 (50.000 × 2) = 1.000.000.

**Vì sao ESCROW luôn 5.000.000.** ESCROW là tài khoản lưu ký giữ toàn bộ tiền mặt đã thu qua cổng và chưa chi ra ngoài; mọi ví khác (PT, gym, nền tảng, khách) chỉ là *quyền đòi* (claim) trên số tiền đó, và bất biến là `ESCROW.available = Σ (pending + available + locked) của mọi ví khác` (`PS/services/reconcile.service.ts:6-20`). Giải phóng một buổi, hoàn cho khách, đền, giữ lại: tất cả chỉ chuyển quyền đòi từ ví này sang ví kia (ghi nợ PENDING của PT/nền tảng, ghi có AVAILABLE của PT/khách), tiền mặt không rời nền tảng nên ESCROW không đổi — mã nói rõ ở `PS/services/contract-ledger.service.ts:1098-1099` (hoàn khách) và `:612-615` (bồi thường vắng). ESCROW chỉ giảm khi có một khoản chi thật ra ngoài: PT/gym rút tiền được chi (`markPaid`) hoặc khách rút ví về cổng. Trong ví dụ không ai rút nên ESCROW đứng yên ở giá hợp đồng.

### 14.2 Bảng 2 — tỷ lệ giữ lại BẬT 10% (giả định, `TÍNH TAY`, KHÔNG phải kết quả chạy)

Giả định: `ptHoldbackRate = 0,10` → pot H = 500.000, lấy từ thu nhập đầu của PT (S1 giữ 450.000 và trả 0; S2 giữ 50.000 và trả 400.000; S3, S4 trả đủ 450.000 → sau 4 buổi PT khả dụng 1.300.000 và pot 500.000, theo `splitReleaseWithHoldback`, `PS/services/contract-money.ts:309-318`). Admin đã mở hold (căn cứ: tranh chấp S6) trước khi khách rút, nên khi hợp đồng kết thúc pot bị đóng băng (mục 6 dòng 3), không top-up. Nhãn toàn bảng: `TÍNH TAY`, một giả định mới của thiết kế.

Hai điểm chính: (1) 500.000 bảo đảm là một dòng riêng, nằm trong PENDING của PT dưới `T`, tách khỏi 1.000.000 giá trị S5/S6 (cũng ở PENDING nhưng là loại B); (2) việc S5 được xác nhận và S6 được phán chỉ đụng loại B, pot đứng yên; chỉ cột 6a/6b (quyết định riêng về hold) mới đụng pot.

| Chỉ tiêu | 1. Vừa thanh toán | 2. Sau 4 buổi hoàn thành | 3. Sau khi khách rút trung tính (hold ACTIVE) | 4. Sau khi S5 xác nhận đã dạy | 5. Sau khi S6 phán chưa dạy | 6a. Hold đóng, không đền | 6b. Admin phán nghĩa vụ 200.000 rồi đóng hold |
|---|---|---|---|---|---|---|---|
| Khách đã trả | 5.000.000 | 5.000.000 | 5.000.000 | 5.000.000 | 5.000.000 | 5.000.000 | 5.000.000 |
| Đã hoàn/đền cho khách (luỹ kế) | 0 | 0 | 2.000.000 | 2.000.000 | 2.500.000 | 2.500.000 | 2.700.000 |
| PT đã kiếm (khả dụng) | 0 | 1.300.000 | 1.300.000 | 1.750.000 | 1.750.000 | 2.250.000 | 2.050.000 |
| Phần gym | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Doanh thu nền tảng (khả dụng) | 0 | 200.000 | 200.000 | 250.000 | 250.000 | 250.000 | 250.000 |
| Chưa thể giải phóng — S5 + S6 (loại B), PT + nền tảng | 0 | 1.000.000 | 1.000.000 | 500.000 | 0 | 0 | 0 |
| Chưa kiếm (pending buổi chưa diễn ra) | 5.000.000 | 2.000.000 | 0 | 0 | 0 | 0 | 0 |
| **Tiền bảo đảm 10% (loại A, trong PENDING PT)** | 0 | **500.000** | **500.000 (đóng băng)** | **500.000** | **500.000** | 0 (trả PT) | 0 (200.000 đền khách + 300.000 trả PT) |
| Số dư ESCROW | 5.000.000 | 5.000.000 | 5.000.000 | 5.000.000 | 5.000.000 | 5.000.000 | 5.000.000 |
| **Tổng kiểm** | 5.000.000 | 1.300.000+200.000+1.000.000+2.000.000+500.000 = **5.000.000** | 2.000.000+1.300.000+200.000+1.000.000+0+500.000 = **5.000.000** | 2.000.000+1.750.000+250.000+500.000+500.000 = **5.000.000** | 2.500.000+1.750.000+250.000+0+500.000 = **5.000.000** | 2.500.000+2.250.000+250.000 = **5.000.000** | 2.700.000+2.050.000+250.000 = **5.000.000** |

Ghi chú cho bảng 2:
- Cột 3: nếu KHÔNG có hold ACTIVE, `terminateContract` trả pot cho PT (lý do không lỗi): PT khả dụng 1.800.000, bảo đảm 0, mọi số khác như bảng 1 cột 3. Đó là lý do hold phải mở TRƯỚC khi kết thúc (không hồi tố).
- Cột 4: S5 giải quyết bằng `resolveUnresolvedSession` DELIVERED, không áp pot (`PS/services/contract-ledger.service.ts:1271-1279`) → PT +450.000 khả dụng, nền tảng +50.000.
- Cột 6b: trần chính sách `ceil(0,10 × 2.000.000) = 200.000` (giá trị chưa dùng lúc kết thúc là 4 buổi × 500.000, theo `holdbackCompensationTarget`, `PS/services/contract-money.ts:341-366`; kết luận `PT_ABANDONMENT`, mục 7.2). 200.000 ≤ trần ≤ pot 500.000; 300.000 còn lại trả PT khi đóng hold (mục 7.7).
- Nguồn: bảng 1 cột 3–5 là số chạy thật; bảng 2 là tính tay từ cùng công thức với pot 500.000. Kịch bản C có hold chưa được chạy (XS-05, mục 17).

### 14.3 Bảng 3 — một khoản đền khi hợp đồng còn ACTIVE (D43) và không bơm lại quỹ (N1), `TÍNH TAY`

Bản 2 có hai cột phương án N1-A/N1-B; D46 đã chọn "không bơm lại" nên chỉ còn một. Hợp đồng như trên, h 10%, đã dạy 3 buổi, hold ACTIVE, không buổi treo. Quỹ 500.000. Admin kết luận `PT_ABANDONMENT` rồi giải ngân 350.000 (giới hạn `ceil(0,10 × 7 × 500.000)` = 350.000; `min(500.000; 350.000; 350.000)` = 350.000); sau đó buổi 4 được xác nhận. Đối chiếu hai cột "mã hôm nay" (bơm lại) và "thiết kế N1".

| Chỉ tiêu | Trước khi phán | Sau khi phán 350.000 | Buổi 4 xong — mã HÔM NAY (bơm lại, bị D46 cấm) | Buổi 4 xong — THIẾT KẾ N1 |
|---|---|---|---|---|
| Đã đền cho khách | 0 | 350.000 | 350.000 | 350.000 |
| PT khả dụng | 850.000 | 850.000 | 950.000 (+100.000) | 1.300.000 (+450.000) |
| Doanh thu nền tảng khả dụng | 150.000 | 150.000 | 200.000 | 200.000 |
| Chưa kiếm (các buổi chưa dạy) | 3.500.000 | 3.500.000 | 3.000.000 | 3.000.000 |
| Quỹ còn lại | 500.000 | 150.000 | 500.000 (+350.000 góp lại từ thu nhập buổi 4) | 150.000 |
| ESCROW | 5.000.000 | 5.000.000 | 5.000.000 | 5.000.000 |
| **Tổng kiểm** | 0+850.000+150.000+3.500.000+500.000 = **5.000.000** | 350.000+850.000+150.000+3.500.000+150.000 = **5.000.000** | 350.000+950.000+200.000+3.000.000+500.000 = **5.000.000** | 350.000+1.300.000+200.000+3.000.000+150.000 = **5.000.000** |

Cùng thu nhập tổng của PT sau buổi 4 (1.450.000); khác nhau ở chỗ tiền nằm. Trong cột "hôm nay", quỹ đầy lại 500.000 nên lần phán sau có thể rút thêm tới 500.000 nữa (tổng đền tới 850.000 = 17% giá hợp đồng). Cột N1 giới hạn tổng đền cứng ở `H` = 10%.

---

## 15. Kịch bản bốn hợp đồng của chủ sở hữu (cập nhật theo D46–D49)

### 15.1 Dữ liệu (`TÍNH TAY`, chưa chạy)

An có 4 hợp đồng độc lập với khách Bình, Chi, Dũng, Em. Mỗi hợp đồng: giá 5.000.000đ, N=10, nền tảng 10% / PT 90% / gym 0; h=0,10 ⇒ H=500.000; mỗi buổi PT 450.000, nền tảng 50.000. Chỉ hợp đồng Bình có căn cứ riêng: khách báo PT vắng buổi 4 (buổi `PT_NO_SHOW_REPORTED`, chưa ai phân xử) nên có hold; khi hợp đồng còn ACTIVE buổi này nằm trong 7 buổi chưa dùng; khi hợp đồng kết thúc, theo D52 (15/10) nó thành buổi TREO (`unresolvedSessions = 1`, giữ 500.000 = PT 450.000 + nền tảng 50.000 trong ngăn chờ của Bình), không còn bị hủy.

| Khách | Đã dạy u | PT đã được giải phóng (AVAILABLE) | Quỹ (A) | Chưa kiếm của PT | PT PENDING tổng |
|---|---|---|---|---|---|
| Bình | 3 | 850.000 | 500.000 | 7×450.000 = 3.150.000 | 3.650.000 |
| Chi | 1 | 0 | 450.000 | 9×450.000 = 4.050.000 | 4.500.000 |
| Dũng | 5 | 1.750.000 | 500.000 | 5×450.000 = 2.250.000 | 2.750.000 |
| Em | 0 | 0 | 0 | 4.500.000 | 4.500.000 |

AVAILABLE của An từ bốn hợp đồng: 2.600.000. **Bị đóng băng**: DUY NHẤT 500.000 quỹ của Bình. **Không**: 850.000 đã kiếm của Bình, 3.150.000 chưa kiếm của Bình, mọi thứ của Chi, Dũng, Em, toàn bộ ví An (N5).

### 15.2 Kết cục

**(a) Khiếu nại bị bác (`NO_VIOLATION`)**, hợp đồng Bình còn chạy: nghĩa vụ `NOT_AWARDED`; hold tự đóng (`BASIS_CLEARED_NO_OBLIGATION`); không bút toán; quỹ 500.000 vẫn là quỹ và đi tiếp theo quy tắc thường (hết hợp đồng hoặc nhàn rỗi). An không rút được 500.000 ngay. Chi/Dũng/Em không đổi.

**(b) Admin kết luận `PT_ABANDONMENT` khi Bình còn ACTIVE, rồi giải ngân (N2)**: giới hạn `ceil(0,10×3.500.000)` = 350.000. Giải ngân 200.000: khách +200.000, quỹ → 300.000, `paidFromPot` = 200.000, AVAILABLE của An vẫn 2.600.000, hợp đồng còn ACTIVE với 7 buổi. Giải ngân nghĩa vụ thứ hai 250.000 (căn cứ khác): `min(quỹ 300.000; giới hạn còn 350.000−200.000 = 150.000; 250.000)` = 150.000, chưa giải quyết 100.000, quỹ → 150.000. Phán lại cùng nghĩa vụ → `OBLIGATION_ALREADY_RULED`. Giải ngân khi giới hạn hết → `POLICY_LIMIT_REACHED`. Tỷ lệ giữ = 0 → không mở được hold, không đền, nền tảng không ứng. Không buổi nào sau đó bơm lại quỹ (N1).

**(c) PT có lỗi với Bình, Bình rút không phí (D32) rồi admin phán**: (số sửa theo D52, `TÍNH TAY` đối chiếu bằng chương trình tính độc lập) `terminate`: buổi 4 được GIỮ chứ không hủy → hoàn khách 6×500.000 = 3.000.000; giữ 500.000 của buổi 4 trong ngăn chờ (PT 450.000 + nền tảng 50.000); quyền lợi PT cuối = 0,9×2.000.000 − 450.000 = 1.350.000 (không đổi so với cách hủy buổi); đã giải phóng 850.000; chênh 500.000 = quỹ → đóng băng. Giới hạn chính sách đo khi buổi 4 còn treo = ceil(0,10×3.000.000) = 300.000 (nếu đo sau khi buổi 4 được phán "chưa dạy" thì cách đo là chi tiết của câu 1 mục 18). Giải ngân 300.000: khách 3.000.000 + 300.000 = 3.300.000; 200.000 còn lại về AVAILABLE của An khi hold đóng → An có 850.000 + 200.000 = 1.050.000 từ Bình (= 1.350.000 − 300.000). Buổi 4 phán sau đó: "chưa dạy" → khách +500.000 (tổng 3.800.000; An vẫn 1.050.000; nền tảng 150.000; Σ 5.000.000); "đã dạy" → An +450.000 (1.500.000), nền tảng +50.000 (200.000), khách 3.300.000, Σ 5.000.000.

**(d) Cấm vĩnh viễn An (D44, D47, D49)**: lệnh cấm commit ngay (hạn chế `PERMANENT_BAN`) và, CÙNG giao dịch, ghi một lệnh bảo vệ `REQUESTED` cho Bình (căn cứ: báo cáo PT vắng buổi 4) — không cho Chi, Dũng, Em (không có căn cứ riêng). Mỗi hợp đồng được chấm dứt bằng `SERVICE_DISCONTINUED_BY_PLATFORM` (mỗi hợp đồng một kết quả riêng, có chống lặp): hoàn Bình 3.000.000 (buổi 4 khách báo PT vắng, chưa ai phân xử, được GIỮ để xác minh theo D52: 500.000 ở lại ngăn chờ của Bình, không tính vắng, không tự đền, phán sau bằng quy trình sẵn có; đã sửa từ 3.500.000 của bản trước), Chi 4.500.000, Dũng 2.500.000, Em 5.000.000. Top-up cho An theo chính sách không lỗi: Chi +450.000, Dũng +500.000; **Bình KHÔNG top-up quỹ** (hold tạo ngay trong `terminate`, quỹ 500.000 đứng yên); Em 0. **Không khách nào tự nhận tiền đền.** AVAILABLE của An = 2.600.000 + 450.000 + 500.000 = 3.550.000; 500.000 quỹ của Bình còn đóng băng, kèm nghĩa vụ `OPEN` hạn xem xét 14 ngày, và 500.000 giá trị buổi 4 giữ để xác minh (loại B, không thuộc hold). Đối chứng lỗi hiện tại (10% bật, chưa sửa F5): `PT_BANNED` tự đền Bình 350.000, Chi 450.000, Dũng 250.000 (`TÍNH TAY` theo `min(ceil(0,1×phần chưa dùng), quỹ, phần PT còn được trả)`) — đúng điều D31/D44/D49 cấm. Nếu payment-service ngừng lúc cấm: hạn chế vẫn có hiệu lực; lệnh của Bình ở `REQUESTED` và chặn quét nhàn rỗi; hợp đồng "cần xử lý" tới khi payment-service trở lại (mục 11.4 dòng 1, 5). Nếu hợp đồng Chi/Dũng sau này có khiếu nại: quỹ đã về An, không còn gì để phán (không hồi tố, mục 11.4 dòng 15; phần này là quyết định D44, không phải lỗi thiết kế).

### 15.3 Các kịch bản còn lại

Đồng thời: HT-17, HT-03, HT-43, R1/R2/R6 (hai giao dịch song song `Promise.all` trên DB thật). Yêu cầu lặp: HT-07, HT-43. Quỹ không đủ: HT-42 (tạo trường hợp quỹ nhỏ hơn số admin quyết). Hợp đồng cũ không quỹ: HT-01, HT-26. Buổi sót: HT-60. Cấm khi payment-service ngừng: HT-80, HT-81.

---

## 16. Kế hoạch lát: đơn vị nhỏ, nghiệm thu độc lập, thứ tự và cổng bật 10% (Task D)

### 16.1 Nguyên tắc và thứ tự

Thứ tự bắt buộc (D51): **Nhóm 1** (F1, F2, F3 + kiểm việc rút ví AVAILABLE gộp) → **Nhóm 2** (F4, F5, F6) → **Lát 5** (U1…U9) → **Cổng G** (bật 10%, bước CUỐI CÙNG, do Ngài). Quy tắc cho mọi đơn vị:
- Nhỏ, nghiệm thu độc lập: mỗi đơn vị có phạm vi, tệp, migration (có/không), kiểm thử, tiêu chí chấp nhận, cách quay lui. Dừng sau bất kỳ đơn vị nào vẫn là hệ thống đúng.
- Với hợp đồng tỷ lệ giữ 0 (tất cả hợp đồng hôm nay), mọi đơn vị phải KHÔNG đổi kết quả: bộ kiểm thử HT-26 ghim kết quả JSON của mọi hàm trước/sau.
- Kiểm thử DB-backed chạy trên DB kiểm thử `*_test` (`gymcoach-test-postgres-test-1`, `FITNESS_DISABLE_REDIS=true` nơi áp dụng); không ghi DB dev, không `migrate dev`/`db push`; migration viết tay, thử bằng `migrate deploy` trên DB kiểm thử.
- Nhãn bằng chứng khi báo cáo xong từng đơn vị: `BACKEND INTEGRATION` (sổ cái thật trên DB kiểm thử), `TEST FIXTURE` (dựng dữ liệu), `REAL HTTP/API` (qua gateway), `CODE AUDIT`. Không gọi chạy từng tệp là "full regression"; ghi tên bộ đã chạy.
- Sau mỗi nhóm báo (D51): root cause, tệp, migration, kiểm thử thật, sổ cái trước/sau, cuộc đua đã kiểm, rủi ro, có tách commit được không. Ngài tự commit/push.
- Bản đồ phụ thuộc: F1→F2→F3 (cùng agent) → F4 → U1 → U2 → U3 → U4; F5, F6 độc lập với nhau; U5 sau câu 7; U6 sau U3; U7 sau U2 và F3; U8 sau tất cả; U9 song song U6. **Điều chỉnh 15/10:** (a) U1 chờ HAI điều kiện: F4 xong VÀ Ngài chọn M0/M1 (D56). Phần của U2 chỉ tạo ba bảng + `readActiveHold` không phụ thuộc M0/M1 nên có thể tách làm trước; các phần cần `potOf` (nhánh "có hold" trong `terminateContract`, vắng/muộn không ăn quỹ, U3–U4) đứng sau U1. (b) D52 mở rộng F2 (thêm buổi `PT_NO_SHOW_REPORTED`) nhưng không đổi thứ tự. (c) D53 là điều kiện nghiệm thu của U7 và cổng G, không đổi thứ tự. (d) D55 (dọn dữ liệu cũ) là việc riêng, KHÔNG nằm trên đường găng của F1–F6/U1–U9; bước 1 (kiểm kê dry-run) nên có trước cổng G.

### 16.2 Nhóm 1 (agent khác đang làm; chỉ ghi điều lát 5 dựa vào)

| Đơn vị | Đích | Lát 5 dựa vào điều gì |
|---|---|---|
| F1 | Mọi đường chấm dứt xử lý buổi theo trạng thái (L1); PT không hủy/báo vắng trên hợp đồng đã kết thúc (L2); **D54:** thao tác muộn trên buổi đã bị quy trình kết thúc hủy bị từ chối bằng lỗi nghiệp vụ rõ (không phí, không đổi sổ cái, không ghi đè), yêu cầu lặp đúng khóa idempotency trả kết quả cũ | Hợp đồng đã kết thúc không còn buổi sống nên HT-60 và các bài về buổi có nghĩa |
| F2 | Buổi chờ xác nhận/tranh chấp được giữ với mọi lý do (L3); điều kiện "đã kết thúc còn buổi treo" suy ra; **D52:** buổi `PT_NO_SHOW_REPORTED` lúc kết thúc cũng được GIỮ qua `unresolvedSessions` (không hủy) | `unresolvedSessions` cho mọi lý do (mục 2.3) |
| F3 | CAS cho xác nhận / tự xác nhận / phân xử | HT-61; mở lại tự xác nhận (U7) không ghi đè |
| Kiểm ví gộp | Kiểm toán nguồn đền từ AVAILABLE gộp | Xong ở bước này: `docs/PT_COMPENSATION_SOURCE_AUDIT.md` (không quyết) |
| Dọn dữ liệu cũ (D55) | Việc RIÊNG, không thuộc F1. Bước 1: kiểm kê + dry-run, phân loại buổi sót (chưa bắt đầu còn mở / đã báo hoàn thành / chờ xác nhận / tranh chấp / đã có giao dịch tài chính / dấu hiệu đã đền hoặc hoàn). Bước 2: chỉ đề xuất đóng tự động buổi chắc chắn chưa diễn ra và chưa có quyền lợi tài chính; script có dry-run, giới hạn phạm vi, nhật ký trước/sau, chạy lại không đổi kết quả, không xóa lịch sử, có kế hoạch khôi phục. **DỪNG chờ Ngài duyệt trước khi đổi dữ liệu thật** | Không dựa vào; liên quan điều kiện 14 của cổng G |

### 16.3 Nhóm 2 (trước khi bật 10%)

**F4 — nguồn tính tiền duy nhất** (cách hiểu của tại hạ; điều phối viên sửa nếu khác)
- Phạm vi: payment-service tự suy "đã giải phóng cho từng bên" từ sổ cái dưới `T` (Σ dòng Có AVAILABLE mô tả `— session earned` và `HOLDBACK_RELEASED_SUFFIX`, trừ dòng `— over-released, clawed back`) thay cho `alreadyReleased` do user-service gửi; so khớp bằng số đếm bổ sung `compensatedSessions` (Σ dòng khách `— compensation for a missed session`). Hai pha: (1) chạy bóng — tính cả hai, dùng số của người gọi, ghi chỉ số `CONTRACT_COUNTER_MISMATCH` khi lệch; (2) chuyển sang tin sổ cái (`LEDGER_DERIVED_RELEASED=true`). user-service: tăng `releasedTo*` chỉ một lần cho mỗi lần giải phóng (cập nhật có điều kiện, cùng giao dịch với việc đánh dấu SETTLED); 409 `NO_UNRESOLVED_HELD`/`ALL_UNRESOLVED_RESOLVED` là trạng thái cuối, không thử lại mãi; ghi trạng thái hợp đồng chống lệch khi hết giờ (6a, 6d).
- **Phạm vi bổ sung và ưu tiên theo D56 (15/10).** Ưu tiên bốn ca đua: (1) hủy muộn, (2) PT báo khách vắng, (3) quét đóng phòng, (4) kết thúc hợp đồng đồng thời với bất kỳ ca nào ở trên. Với mỗi ca và mỗi cặp ca chạy đồng thời: đúng MỘT kết quả hợp lệ, không trùng bút toán, không mất bút toán — kiểm ở ĐIỂM GHI (so-sánh-và-đặt / khóa chống lặp trong cùng giao dịch ghi sổ), không chỉ ở đầu hàm. Đồng thời ĐÁNH GIÁ (ghi vào báo cáo F4, không tự đổi kiến trúc): việc user-service giữ khóa DB trong lúc gọi payment-service (rủi ro timeout, deadlock, giữ khóa lâu) và phương án an toàn hơn (ví dụ để đánh giá, chưa quyết: ghi ý định, nhả khóa rồi mới gọi, kết quả phát lại bằng khóa chống lặp — cùng khung `settleTracked`/outbox của mục 11). Không viết lại kiến trúc thanh toán. **N7 giữ nguyên** (D56): không rút ví chung cho hợp đồng khác; kiểm nghĩa vụ trong hợp đồng hiện hành trước khi đổi (đã có `PT_COMPENSATION_SOURCE_AUDIT.md`); thiếu tiền thì ghi chưa thanh toán; không nợ, không ứng, không báo đã đền khi chưa chuyển tiền thật.
- Tệp: `PS/services/contract-ledger.service.ts` (`terminateContract`), `PS/routes/internal.routes.ts`; `US/services/contract-payout.service.ts`, `session-settlement.service.ts`, `clients/payment.client.ts`.
- Migration: không.
- Kiểm thử: HT-90 (`releasedToPt` thấp giả → sổ cái thắng, PT không bị trả dư); HT-91 (user-service tăng hai lần cho một buổi → không có "forfeited share" từ PT sang nền tảng); HT-92 (bóng: lệch được ghi, tiền không đổi); HT-67; XS-01 (sổ cái thật hai dịch vụ: giải phóng thành công, user-service sập trước khi ghi tăng, kết thúc hợp đồng → tiền đúng); **D56:** HT-93, HT-94 (mục 17).
- Chấp nhận: 9 lý do × {0, 3, 10 buổi dùng}: kết quả giống hệt khi số đếm đúng; số đếm sai không làm tiền sai; `assertMoneyInvariant` đạt.
- Quay lui: tắt `LEDGER_DERIVED_RELEASED`; không đổi dữ liệu.

**F5 — cấm ≠ lỗi** (mục 9)
- Phạm vi: `SERVICE_DISCONTINUED_BY_PLATFORM`; lệnh gỡ khi cấm và admin `terminate` dùng lý do mới; `PT_BANNED` ngừng nhận ở yêu cầu mới, giữ cho dữ liệu cũ.
- Tệp: `PS/services/contract-money.ts`, `PS/routes/internal.routes.ts`; `US/prisma/schema.prisma`, `US/services/contract-payout.service.ts`, `pt-deactivation.service.ts`, `contract-session-closure.ts`, `controllers/contract.controller.ts`.
- Migration: CÓ, một (user-service, thêm giá trị enum).
- Kiểm thử: bộ ở mục 9 + HT-62 (bài tĩnh).
- Chấp nhận: không còn đường mã không-kiểm-thử nào gửi `"PT_BANNED"`; bốn hợp đồng của An (tỷ lệ 10% truyền thẳng vào payment-service) kết thúc không có dòng "compensation".
- Quay lui: hoàn lại lời gọi; giá trị enum đã thêm vô hại, không xoá.

**F6 — quét nhàn rỗi không đánh dấu "đã giải phóng" khi payment-service từ chối**
- Phạm vi: `release-holdback` trả thêm `status` ∈ {`RELEASED`, `ALREADY_RELEASED`, `NOT_HELD`, `BLOCKED_BY_HOLD`} (thêm khoá, tương thích ngược); `releaseHoldbackMoney` trả `status`; `releaseIdleHoldbacks` chỉ gọi `markHoldbackReleased` khi `status` là `RELEASED`/`ALREADY_RELEASED`/`NOT_HELD`; `BLOCKED_BY_HOLD` → không đánh dấu, không cộng `releasedToPt`, lần quét sau thử lại (giới hạn tần suất nhật ký).
- Tệp: `PS/services/contract-ledger.service.ts` (`releasePtHoldback`), `PS/routes/internal.routes.ts`; `US/clients/payment.client.ts`, `contract-payout.service.ts` (`releaseHoldbackMoney`), `contract.service.ts`, `contract.repository.ts`.
- Migration: không.
- Kiểm thử: HT-63b (payment-service giả trả `BLOCKED_BY_HOLD`: `holdbackReleasedAt` vẫn rỗng, `releasedToPt` không đổi, lần quét kế thử lại); các bộ `contract-holdback.integration` cũ vẫn xanh (HT-27).
- Chấp nhận: hôm nay (chưa có hold) hành vi không đổi; khi U2 thêm hold, đường chặn đã đúng.
- Quay lui: hoàn lại hai tệp user-service.

### 16.4 Lát 5

**U1 — Sở hữu quỹ + N1 + `paidFromPot`** (mục 3.7, 7.4, 7.8). **Chặn tới khi Ngài chọn M0 hay M1 (D56): CHƯA CHỌN.**
- Phạm vi: `potOf(T)` và `paidFromPot(T)`; ngăn `HOLDBACK` (nếu Ngài chọn M1) hoặc bản M0 + kiểm bất biến + sàn quỹ ở mọi hàm đụng PENDING (nếu chọn M0); `releaseSession` dùng `potOf + paidFromPot` làm "đã góp"; `terminateContract` trừ `paidFromPot` ở `gap`; bỏ dấu `HOLDBACK_SETTLED` nếu M1; reconcile cộng ngăn mới; KHÔNG có route đền/hold.
- Tệp: `PS/prisma/schema.prisma` + migration; `PS/services/wallet.service.ts`, `contract-ledger.service.ts`, `reconcile.service.ts`.
- Migration: CÓ nếu M1 (enum + cột, mặc định 0); KHÔNG nếu M0.
- Kiểm thử: HT-70, HT-71 (thuộc tính ngẫu nhiên: quỹ suy ra = Σ dòng; sổ phụ (ví, ngăn, T) ≥ 0 sau mọi thao tác), HT-72 (N1: sau đền, buổi sau không giữ), HT-73 (đến muộn không đổi quỹ), HT-74 (migration tiến trên DB kiểm thử rỗng quỹ), HT-26, HT-27, HT-25.
- Chấp nhận: bảng 3.2b và 3.3 tái hiện đúng từng con số bằng sổ cái thật; hợp đồng tỷ lệ 0 không đổi một byte.
- Quay lui: quay lại mã cũ; cột/enum thêm vào vô hại (không dòng nào dùng).

**U2 — Bản ghi hold + cưỡng chế tại điểm ghi sổ** (mục 4, 5, 6)
- Phạm vi: 3 bảng, `readActiveHold`, nhánh "có hold" trong `terminateContract` (quỹ nguyên, không tự đền, ghi `endedAt/endReason`), `releasePtHoldback` (BLOCKED), `refundUnactivated…` (ném), vắng/muộn không ăn quỹ (M0); chưa route nào tạo hold.
- Tệp: `PS/prisma/schema.prisma` + migration, `PS/services/contract-ledger.service.ts`, `PS/repositories/*` mới.
- Migration: CÓ (3 bảng, 2 enum, chỉ mục duy nhất một phần).
- Kiểm thử: HT-04…HT-10, HT-24, HT-24b, HT-25, HT-26, HT-27 (dựng hold bằng fixture trực tiếp trên DB kiểm thử).
- Chấp nhận: bảng luồng tiền mục 6 đúng từng dòng; bộ cũ xanh nguyên.
- Quay lui: bảng thêm vào để trống; không đường nào ghi vào.

**U3 — Vòng đời hold ở payment-service** (mục 7.1, 7.6, 7.7)
- Phạm vi: `hold/open`, `holds/ensure`, `hold/read`, `hold/:id/extend`, `assign`, `close`, `holds/flag-overdue`, chống lặp, sự kiện; sau cờ `FINANCIAL_HOLD_ENABLED`.
- Tệp: `PS/routes/internal.routes.ts`, `PS/services/contract-hold.service.ts` (mới), repository mới.
- Migration: không (dùng bảng U2).
- Kiểm thử: HT-01, HT-02, HT-03, HT-11, HT-12, HT-19, HT-21, HT-23, HT-30 (gia hạn bắt buộc lý do), HT-31 (quá hạn: chỉ cờ, tiền không đổi), HT-32 (đóng thế nào theo trạng thái hợp đồng, mục 7.7).
- Chấp nhận: mọi từ chối trả mã máy đọc được và không ghi gì; mở đồng thời N lần → một hold.
- Quay lui: tắt cờ.

**U4 — Kết luận và giải ngân nghĩa vụ** (mục 7.2, 7.3)
- Phạm vi: `finding` rồi `payout`; công thức N2; `fullyCompensated`; `TERMINATION:<reason>` tự sinh khi kết thúc lỗi PT lúc có hold; sau cờ `FINANCIAL_HOLD_PAYOUT_ENABLED`; chỉ bật sau câu 1.
- Tệp: `PS/services/contract-hold.service.ts`, `contract-ledger.service.ts`.
- Migration: không.
- Kiểm thử: HT-40…HT-48 (mục 17), HT-17, HT-45b.
- Chấp nhận: bảng 3.3, 7.3 và 15.2(b) tái hiện từng số; không `coverShortfall`/`PartnerReceivable` trong mọi đường.
- Quay lui: tắt cờ.

**U5 — Bỏ rút ví gộp và nền tảng ứng khi đền** (N7, mục 8)
- Phạm vi: `compensateNoShow`/`compensateLateArrival` chỉ trừ phần chưa kiếm của PENDING(T), thiếu → `INSUFFICIENT_CONTRACT_FUNDS`; kẹp thu hồi và bù thiếu trong `terminateContract`/`refundUnactivated…` xử lý theo quyết định câu 2 và câu 7. Hai nơi cùng cơ chế ngoài phạm vi (hoa hồng giới thiệu, hoàn dịch vụ cá nhân hoá) chỉ ghi vào báo cáo.
- Tệp: `PS/services/contract-ledger.service.ts`; (user-service: `settleTracked` hiển thị lỗi).
- Migration: không.
- Kiểm thử: HT-95 (hết PENDING(T): không dòng AVAILABLE, không `PartnerReceivable`, không ứng, khách không nhận số chưa có), HT-96 (kết quả JSON cũ với hợp đồng khoẻ giữ nguyên), HT-97 (đối soát cân sau từ chối).
- Chấp nhận: quét `grep` kiểm tĩnh không còn `coverShortfall` trong đường PT-hợp đồng (ngoài ca ngoại lệ Ngài chấp nhận).
- Quay lui: hoàn lại hàm; không đổi dữ liệu. Phụ thuộc: câu 7 (nghĩa vụ cũ) và câu 2.

**U6 — Lệnh bảo vệ, cổng cục bộ, đồng bộ, route admin** (mục 11, 7.1, 7.6)
- Phạm vi: bảng `ContractHoldRequest`; `claimLockCommand` sinh lệnh theo căn cứ riêng; `settleContractTermination` đính kèm `holdRequests`; payment-service `terminate` nhận và tạo hold trong cùng giao dịch; `syncHoldRequests`; cổng ở `releaseIdleHoldbacks`; route `POST /admin/contracts/:id/financial-hold`, `…/finding`, `…/payout`, `…/extend`, `…/close`, `GET /admin/financial-holds?sort=priority`; gateway; `AuditLog`; quét quá hạn; thông báo; đối soát hằng ngày (U9). Cờ `BAN_PROTECTION_ENABLED`.
- Tệp: `US/prisma/schema.prisma` + migration, `US/services/pt-deactivation.service.ts`, `contract-payout.service.ts`, `contract.service.ts`, `hold-request.service.ts` (mới), `routes/admin.routes.ts`, `clients/payment.client.ts`, `backend/gateway/src/routes/proxy.routes.ts`; `PS/routes/internal.routes.ts` (`terminate` nhận `holdRequests`).
- Migration: CÓ (user-service: bảng, enum, giá trị `NotificationEventType`).
- Kiểm thử: HT-65, HT-66, HT-80…HT-84; XS-02 (sổ cái thật: cấm khi payment-service bị tắt rồi bật, quỹ Bình đứng yên, Chi/Dũng về An).
- Chấp nhận: bảng 11.4 — mỗi dòng có một bài hoặc một lý do không cần bài; không có đường trả `ACTIVE` khi chưa xác nhận.
- Quay lui: tắt `BAN_PROTECTION_ENABLED`; bảng để trống.

**U7 — Mở lại tự xác nhận cho buổi đã báo trước hạn chế** (N5/N9, mục 10.2)
- Phạm vi: bỏ hai điều kiện bỏ qua cho buổi chờ không tranh chấp; bỏ cộng bù hạn cho các buổi đó; đóng phòng vẫn dừng. Cờ `AUTOCONFIRM_RESTRICTED_ENABLED`.
- Tệp: `US/services/session-autoconfirm.service.ts`, `repositories/session.repository.ts`, `services/pt-restriction.service.ts`.
- Migration: không.
- Kiểm thử: HT-64, HT-64b, XS-03 (PT bị cấm, buổi chờ tự xác nhận, buổi tranh chấp giữ).
- Chấp nhận: bảng 10.1 đúng; ví dụ 10.2 tái hiện; **quy tắc đích D53** (mục 10.2) được chứng minh bằng kiểm thử: PT bị cấm, buổi báo hợp lệ trước lúc cấm không tranh chấp tự xác nhận khi quá hạn; buổi tranh chấp được giữ; không tạo được báo cáo hoàn thành mới sau lúc cấm; cấm không làm mất doanh thu đã kiếm. Đây là điều kiện nghiệm thu của Financial Hold (D53).
- Quay lui: tắt cờ. Phụ thuộc: U2 và F3.

**U8 — Kịch bản chạy thật hai dịch vụ và qua gateway**
- Phạm vi: kịch bản bốn hợp đồng (mục 15) và kịch bản C của `cross-service-money.e2e.test.ts` với tỷ lệ 10%, hold, đền, cấm; chạy `REAL HTTP/API` qua gateway; báo cáo xác minh mang đủ nhãn bằng chứng.
- Tệp: `US/__tests__/cross-service-money.e2e.test.ts` (mở rộng), tệp kịch bản mới; báo cáo `docs/…_VERIFICATION_REPORT.md`.
- Migration: không. Kiểm thử: XS-01…XS-06 (mục 17).
- Chấp nhận: bảng 14.2, 14.3 và 15.2 khớp từng số; `assertMoneyInvariant` đạt sau mỗi kịch bản.
- Quay lui: không có (chỉ kiểm thử).

**U9 — Đối soát, giám sát, xử lý dữ liệu cũ**
- Phạm vi: đối soát hằng ngày hai chiều lệnh ↔ hold (mục 11.2f); báo cáo Q1–Q4 (mục 3.8) chạy định kỳ; hàng đợi admin "bảo vệ chưa xác nhận", "quỹ đã trả khi có căn cứ", "hold quá hạn"; thực hiện lựa chọn của Ngài cho nghĩa vụ cũ và 7 sổ phụ âm (audit, câu 7).
- Migration: không (hoặc script dữ liệu có chạy-thử mặc định, như script gym-service).
- Kiểm thử: HT-98 (đối soát phát hiện từng loại lệch dựng sẵn), HT-99 (script dữ liệu: chạy thử không ghi gì).
- Chấp nhận: báo cáo sạch hoặc mọi ngoại lệ có chữ ký của Ngài.

### 16.5 Cổng G — bật giữ lại 10% (bước cuối, do Ngài; không agent nào tự làm)

Điều kiện tiên quyết (đủ cả 14 mới được xét; điều kiện 13–14 thêm 15/10):
1. F1–F3 đã `BACKEND INTEGRATION` đạt, kể cả kịch bản sổ cái thật hai dịch vụ.
2. F4, F5, F6 đạt.
3. U1–U9 đã nghiệm thu từng đơn vị.
4. Ngài đã quyết và đã THỰC HIỆN cách xử lý nghĩa vụ cũ (câu 7); báo cáo đối soát Q1–Q4 trên môi trường bật: Q1 = 0 hàng (hoặc ngoại lệ có chữ ký), Q2 cân.
5. Khoản vét tiền chờ trên dev (~3.880.000đ theo `_warroom/TINH_THE.md`) đã được Ngài quyết định hoàn/không hoàn.
6. Chức năng xác nhận điều khoản (D25) đã chạy: PT đồng ý đúng phiên bản điều khoản có quy tắc giữ lại; lưu ở backend (phiên bản, thời điểm, tài khoản); `resolvePtHoldbackRate(ptUserId)` đọc từ đó; chỉ hợp đồng ký SAU khi đồng ý mới mang tỷ lệ.
7. Văn bản điều khoản và hộp thoại hồ sơ PT nêu rõ: giữ 10% từ thu nhập đầu, khi nào nhả, khi nào được dùng để đền, điều gì KHÔNG tự động; khách cũng thấy; Ngài duyệt câu chữ (pháp lý do Ngài).
8. Quy tắc "không báo đủ khi trả thiếu" (7.3) đã có trong API, thông báo và kiểm thử.
9. Chạy lại các bộ liên quan trên DB kiểm thử (ghi tên bộ, không gọi là full regression).
10. Một lượt `REAL HTTP/API` qua gateway: kịch bản bốn hợp đồng; cấm khi payment-service bị tắt rồi bật lại; hold quá hạn 14 ngày (đồng hồ giả lập) lên hàng đợi.
11. Sổ tay vận hành: cờ, cảnh báo, người trực, cách quay lui.
12. Bật theo bậc: bước 1 chỉ cho danh sách 1–3 PT thử (biến môi trường đọc trong `resolvePtHoldbackRate`), quan sát một chu kỳ xem xét 14 ngày; bước 2 mới mở rộng. Quay lui = hàm trả `"0"` lại: chỉ ảnh hưởng hợp đồng tạo SAU; các quỹ đã hình thành tiếp tục theo quy tắc (đóng hold/đền/nhả bằng thao tác admin có nhật ký). Quay lui KHÔNG xoá quỹ đang giữ.
13. **(D53)** Quy tắc đích cho PT bị cấm/hạn chế đã chạy và có bằng chứng (U7 đạt, `AUTOCONFIRM_RESTRICTED_ENABLED` bật ở môi trường thử): buổi báo hợp lệ trước lúc cấm, không tranh chấp, quá hạn thì tự xác nhận sau khi kiểm không có tranh chấp; buổi tranh chấp được giữ; cấm không làm mất doanh thu đã kiếm; không có báo cáo hoàn thành mới sau lúc cấm (XS-03, HT-64, HT-64b). Biện pháp chuyển tiếp "dừng tự xác nhận" đã được thay bằng quy tắc đích.
14. **(đề xuất theo D55; không phải chữ của D55)** Bước 1 của việc dọn dữ liệu cũ (kiểm kê + dry-run buổi sót trên hợp đồng đã kết thúc) đã chạy ở môi trường bật và báo cáo đã được Ngài xem; mọi thay đổi dữ liệu thật chỉ sau khi Ngài duyệt.

Điều kiện 13–14 xét trước bước 12 (bật theo bậc là bước cuối). Điều kiện M0/M1 không nằm trong danh sách này vì nó là điều kiện để BẮT ĐẦU U1, không phải điều kiện bật.

### 16.6 Các lớp kiểm thử và nhãn dự kiến

| Lớp | Chạy ở đâu | Nhãn |
|---|---|---|
| Đơn vị thuần (`contract-money`) | payment-service | `BACKEND INTEGRATION` nếu có DB; nếu không, ghi "đơn vị" |
| Sổ cái thật, một dịch vụ | payment-service, DB `*_test` | `BACKEND INTEGRATION` |
| user-service với payment-service giả | user-service, DB `*_test` | `TEST FIXTURE` (nói rõ payment-service là giả) |
| Sổ cái thật hai dịch vụ (XS-xx) | `cross-service-money.e2e.test.ts` (`RUN_CROSS_SERVICE_MONEY=1`, `E2E_PAYMENT_DATABASE_URL`) | `BACKEND INTEGRATION` |
| Qua gateway (HTTP) | stack thử | `REAL HTTP/API` |
| Trình duyệt / thiết bị | KHÔNG thuộc lát này (không giao diện) | — |

---

## 17. Kiểm thử bắt buộc (mã HT của bản 3 thay thế mã của bản 2)

Nhóm A — payment-service, sổ cái thật trên DB `*_test` (`BACKEND INTEGRATION`):
- HT-01 hợp đồng tỷ lệ 0: mở hold bị từ chối, không hàng hold, không dòng sổ cái.
- HT-02 hợp đồng đã `holdbackWasReleased`: mở hold bị từ chối.
- HT-03 mở hold lặp cùng `requestId` → trả hold cũ; mở đồng thời N lần → đúng một hold ACTIVE; căn cứ thứ hai → `BASIS_ADDED` + nghĩa vụ mới, không hold thứ hai.
- HT-04 `releasePtHoldback` khi có hold: `status BLOCKED_BY_HOLD`, `released 0.00`, không dòng "released"; sau khi hold đóng vẫn giải phóng được.
- HT-05 `releaseSession` khi có hold: phần vượt mục tiêu vẫn về AVAILABLE, quỹ không giảm; đối soát cân.
- HT-06 `terminateContract` với CẢ 9 lý do (gồm lý do mới) khi có hold: quỹ giữ nguyên, không tự đền, top-up PT không gồm quỹ, hoàn khách đúng chính sách, `shortfall = 0`, `endedAt/endReason` đúng, không `PartnerReceivable`.
- HT-07 `terminate` phát lại cùng khoá: không thêm sự kiện, không bút toán.
- HT-08 `terminate` có cả hold và `unresolvedSessions`: `refund + Σ entitlement + unresolvedHeld + quỹ = P − compensationValue`.
- HT-09 vắng/đến muộn khi có hold: quỹ không bị ăn (M1: cấu trúc; M0: sàn).
- HT-10 `resolveUnresolvedSession` khi có hold: quỹ không bị ăn; HT-10b quét thử lại của user-service vẫn đúng.
- HT-11 đóng hold hợp đồng đã kết thúc: quỹ còn lại về AVAILABLE PT đúng một lần, `recoverReceivables` chạy; lặp = phát lại; quét 30 ngày sau là no-op.
- HT-12 đóng hold hợp đồng còn chạy: không bút toán; sau đó `terminate` chạy như chưa từng có hold.
- HT-17 N giải ngân KHÁC nghĩa vụ đồng thời (`Promise.all`): Σ ≤ min(giới hạn, quỹ); đối soát cân.
- HT-19 chèn lỗi giữa bút toán và cập nhật nghĩa vụ/hold: rollback toàn bộ.
- HT-21 rút / duyệt / chi của PT khi có hold ở hợp đồng X: không đổi; AVAILABLE và hợp đồng khác không đổi.
- HT-23 hold ở hợp đồng Bình không đổi dòng sổ cái nào của Chi, Dũng, Em (cùng PT).
- HT-24 `refundUnactivatedContractPayment` khi có hold bất thường: ném lỗi, không rút; mở hold trên hợp đồng chưa kích hoạt: từ chối. HT-24b `POST /admin/payments/:id/refund` cho giao dịch hợp đồng cổng trả 400 `NOT_REFUNDABLE` (không có `payer_wallet_id`).
- HT-25 sau MỖI kịch bản: `assertMoneyInvariant` đạt, `negativeWallets` rỗng.
- HT-26 hợp đồng tỷ lệ 0, không hold: kết quả JSON của mọi hàm ghim y hệt trước thay đổi.
- HT-27 các bộ cũ vẫn xanh: `contract-ledger.integration`, `pt-holdback.integration`, `unresolved-sessions.integration`, `client-exit-due-to-pt-restriction.integration`, `contract-pending-isolation.integration`, `ledger-idempotency.integration`, `withdrawal-*`, `wallet-financial-invariants.integration`.
- **Vòng đời (N4):** HT-30 gia hạn không lý do → từ chối, có lý do → `EXTENDED`, `extensionCount++`; HT-31 quá hạn chỉ đặt `overdueFlaggedAt`, tiền/trạng thái PT/hợp đồng không đổi; HT-32 đóng hold theo trạng thái hợp đồng (còn chạy / kết thúc không lỗi / kết thúc lỗi PT với nghĩa vụ `TERMINATION:<reason>`).
- **Nghĩa vụ (N2, N3, N7):** HT-40 kết luận rồi giải ngân hợp lệ khi ACTIVE (khách nhận đúng số, rút được; ngăn quỹ giảm đúng số; AVAILABLE PT, gym, nền tảng không đổi; hợp đồng vẫn ACTIVE; `compensatedSessions`/`releasedToPt` không đổi; không `PartnerReceivable`); HT-41 giải ngân khi chưa có kết luận → `FINDING_REQUIRED`, `findingKind` thứ năm → từ chối; HT-42 `min(quỹ; giới hạn còn lại; số quyết)` đúng cho cả ba ràng buộc chặt (bảng 7.3), `PARTIALLY_PAID`, không nợ, không ứng, AVAILABLE PT không đổi; HT-43 cùng nghĩa vụ giải ngân hai lần (cùng nội dung / khác số / khác `decisionId` / N song song): đúng một lần ghi sổ; HT-44 không hold → `HOLD_REQUIRED`, tỷ lệ 0 → `HOLD_NOT_APPLICABLE`; HT-45 `NO_VIOLATION` → `NOT_AWARDED`, không bút toán; HT-45b `fullyCompensated` đúng và chuỗi "đã đền đủ" không bao giờ sinh khi `paidAmount < awardedAmount`; HT-46 sau một khoản đền lúc ACTIVE, `terminate` với từng lý do trong 9: không shortfall, PT nhận đúng `E − R − đã đền`, đối soát cân; HT-47 trần cộng dồn qua nhiều quyết định (mục 3.3: 200.000 rồi 100.000 rồi 0); HT-48 hold + giải ngân ở hợp đồng X không đổi dòng sổ cái nào của hợp đồng Y cùng PT.
- **Quỹ (N1, sở hữu):** HT-70 quỹ suy ra bằng cộng dòng khớp quỹ mong đợi trên chuỗi ngẫu nhiên (thuộc tính); HT-71 sau mọi thao tác, mọi sổ phụ (ví, ngăn, T) ≥ 0 và Σ các ví theo T = số khách đã trả; HT-72 N1: sau đền, buổi kế giải phóng đủ, quỹ chỉ giảm (bảng 3.4: mã cũ bơm 300.000, thiết kế N1 giữ 0); HT-73 đến muộn khi quỹ đã đầy không đổi quỹ (M1) hoặc bị chặn (M0); HT-74 migration `HOLDBACK` chạy tiến trên DB kiểm thử; HT-75 "đã giải phóng" suy từ sổ cái bằng số đếm của người gọi trên chuỗi khoẻ.
- **Buổi B (D42, D45):** HT-49 hợp đồng ACTIVE, quỹ đóng băng, buổi tranh chấp, ba phán quyết `COMPLETED`/`PT_NO_SHOW_CONFIRMED`/`CANCELLED`: tiền đi đúng bảng 2.4, quỹ không đổi; HT-50 kết thúc bằng từng lý do trong 9 khi có buổi chờ + buổi tranh chấp + buổi `PT_NO_SHOW_REPORTED` (D52): giá trị buổi giữ nguyên, phán sau giải quyết đúng, `refund + Σ entitlement + held = P − comp`; HT-51 chưa phán: không đường nào làm giá trị buổi ra khỏi PENDING.
- **N7:** HT-95 hết PENDING(T): đền vắng/muộn bị từ chối, không dòng AVAILABLE, không `PartnerReceivable`, không ứng; HT-96 hợp đồng khoẻ giữ nguyên kết quả JSON; HT-97 đối soát cân sau từ chối.

Nhóm B — user-service (`BACKEND INTEGRATION`; payment-service là `TEST FIXTURE` hoặc gọi payment-service thật khi nói "sổ cái thật"):
- HT-60 mọi đường chấm dứt huỷ buổi chưa diễn ra và giữ buổi chờ/tranh chấp; sau khi hợp đồng kết thúc, `addException`, `cancelSession`, `markNoShow`, `resolveDispute`, quét đóng phòng KHÔNG gọi bồi thường (F1/F2). **D52:** buổi `PT_NO_SHOW_REPORTED` lúc kết thúc được giữ (không hủy, không tính vắng, không đền) và tính vào `unresolvedSessions`. **HT-60b (D54):** thao tác muộn trên buổi đã bị quy trình kết thúc hủy bị từ chối bằng lỗi nghiệp vụ rõ, không phí, không đổi sổ cái, không ghi đè; lặp đúng khóa idempotency của lần thành công trả kết quả cũ, không xử lý lại.
- HT-61 xác nhận/tự xác nhận/phân xử là CAS: buổi đã `CANCELLED`/`NO_SHOW` không bị ghi `COMPLETED`; không trả tiền hai lần (F3).
- HT-62 bài tĩnh: không đường mã nào ngoài kiểm thử gửi `"PT_BANNED"`; lệnh gỡ khi cấm gửi lý do mới; admin chọn `PT_BANNED` mới → 400.
- HT-63 buổi admin hủy vì đình chỉ/cấm: không `ptAtFault`, không gọi bồi thường, không tính vào `repeatedNoShowEligibility`; HT-63b (F6) payment-service giả trả `BLOCKED_BY_HOLD`: `holdbackReleasedAt` rỗng, `releasedToPt` không đổi.
- HT-64 tự xác nhận (U7): buổi báo trước hạn chế & không tranh chấp được xác nhận và trả tiền; `DISPUTED` thì không; đóng phòng vẫn dừng; HT-64b sau hạn chế không đường nào tạo được báo cáo hoàn thành mới.
- HT-65 route admin: không-admin 403; `contractId` từ URL, `ptUserId/clientUserId/paymentTransactionId/ptHoldbackRate` đọc từ DB không từ body; căn cứ phải thuộc đúng hợp đồng; lý do bắt buộc; đủ `AuditLog`; lỗi payment-service → không có dòng POSTED.
- HT-66 khách rút không phí (D32/D37) với hold: hoàn 100% phần chưa dùng, không phí, không đền, quỹ đóng băng, buổi treo vẫn xử lý.
- HT-67 phản hồi 409 `NO_UNRESOLVED_HELD`/`ALL_UNRESOLVED_RESOLVED` là trạng thái cuối, không thử lại mãi.
- **N6:** HT-80 lệnh cấm thành công khi payment-service ném lỗi/không phản hồi; hạn chế, cờ và lệnh `REQUESTED` commit CÙNG giao dịch (chèn lỗi giữa chừng → không có gì được ghi); HT-81 lệnh `REQUESTED` làm quét nhàn rỗi bỏ qua hợp đồng và `terminate` đính kèm `holdRequests`; HT-82 chèn lỗi giữa `ensureHold` và bút toán trong payment-service → hoàn tác cả hai, lệnh vẫn `REQUESTED`; HT-83 lệnh bị từ chối (`HOLD_NOT_APPLICABLE`…) không bao giờ trả `ACTIVE`; HT-84 hợp đồng không có căn cứ riêng không sinh lệnh; hạn chế tài khoản không sinh lệnh cho mọi hợp đồng.
- **F4:** HT-90, HT-91, HT-92 (mục 16.3); **HT-93** (D56) bốn ca đua — hủy muộn / PT báo khách vắng / quét đóng phòng / kết thúc hợp đồng — chạy song song (`Promise.all`) trên DB thật: đúng một kết quả hợp lệ, không trùng, không mất bút toán; **HT-94** (D56) ghi kết quả đánh giá việc giữ khóa DB khi gọi payment-service (timeout, deadlock, phương án an toàn hơn) vào báo cáo F4.
- **Hàng đợi:** HT-98 đối soát phát hiện từng loại lệch (11.2f); HT-99 script dữ liệu chạy thử không ghi gì.

Nhóm C — sổ cái thật hai dịch vụ (`BACKEND INTEGRATION`, `cross-service-money.e2e.test.ts`, chạy riêng với `RUN_CROSS_SERVICE_MONEY=1`):
- XS-01 giải phóng thành công, user-service sập trước khi ghi tăng, kết thúc hợp đồng → tiền đúng (F4); XS-02 cấm khi payment-service bị tắt rồi bật, quỹ Bình đứng yên, Chi/Dũng về An (U6); XS-03 PT bị cấm, buổi chờ tự xác nhận, buổi tranh chấp giữ (U7); XS-04 bốn hợp đồng của An đủ ba nhánh (a)(b)(c)(d) mục 15.2; XS-05 kịch bản C có hold và 10% khớp bảng 14.2; XS-06 bảng 3.2b–3.4 tái hiện đúng từng con số.

Nhóm D — `REAL HTTP/API` qua gateway: XS-04 và XS-02 lặp qua gateway (cổng G, điều kiện 10). Kiểm thử trình duyệt thuộc phase khác (không có giao diện trong lát này).

---

## 18. Câu hỏi còn mở (chỉ những điểm thật sự chưa quyết)

N1–N9 và D45–D51 đã trả lời phần lớn các câu của bản 2; các câu bản 2 còn lại đã được thiết kế điền mặc định hợp lý (ghi rõ ở chỗ dùng). Dưới đây là phần CHƯA có quyết định. Mỗi câu có phương án, ví dụ tiền, tác động và **khuyến nghị (chỉ là khuyến nghị, KHÔNG phải quyết định)**.

### 18.0 Cần Ngài duyệt (đề xuất, không phải câu hỏi)

- **M0 hay M1 — CHƯA CHỌN (D56), Ngài quyết** (mục 3.7; giải thích bằng ví dụ tiền, mười câu hỏi, bảng đối soát và đánh đổi: `docs/FINANCIAL_HOLD_M0_VS_M1.md`). M1 = ngăn `HOLDBACK` thay vì giữ quỹ suy từ hậu tố (M0). Bản 3 đã khuyến nghị M1 (cần một migration ở payment-service, 0 dữ liệu cũ phải chuyển); đó chỉ là khuyến nghị. Nếu Ngài chọn M0, đơn vị U1 đổi thành "M0 + kiểm bất biến + sàn quỹ ở mọi hàm"; chỉ kiểm bất biến thì ca đến muộn khi quỹ chiếm PENDING bị CHẶN thanh toán buổi cuối thay vì được xử lý (ví dụ số: tài liệu trên, mục 3.11-c).
- `HOLD_REVIEW_DAYS = 14` (khớp N4); `FINANCIAL_HOLD_*` cờ mặc định tắt; tên lý do `SERVICE_DISCONTINUED_BY_PLATFORM` (đã chốt D49).

### Câu 1. Giới hạn chính sách cộng dồn đo thế nào khi hợp đồng còn ACTIVE? (chi tiết còn lại của N2)

N2 đã chốt `min(quỹ thật, giới hạn chính sách/hợp đồng, nghĩa vụ hợp lệ)`, cộng dồn theo hợp đồng. Chưa rõ "giới hạn chính sách/hợp đồng" là con số nào theo thời gian.
- (A) `ceil(h × giá trị chưa dùng)` tính tại mỗi lần giải ngân, trừ tổng đã đền (đúng chữ D22 "10% phần chưa dùng"); giới hạn co lại theo thời gian.
- (C) Cố định tại lần giải ngân đầu: `ceil(h × chưa dùng lúc đó)`; các lần sau chỉ lấy phần còn lại.
- (D) Cố định bằng `H` = 10% giá hợp đồng.
- Ví dụ (5.000.000đ, 10 buổi): giải ngân lần đầu khi đã dạy 3 buổi (chưa dùng 3.500.000): A và C cho tối đa 350.000; D cho 500.000. Sau khi đã đền 350.000, khi đã dạy 5 buổi (chưa dùng 2.500.000): A → giới hạn 250.000 < đã đền → 0 thêm; C → 0 thêm; D → còn 150.000 nữa.
- Tác động: khách có thể nhận tối đa A/C 350.000, D 500.000 mỗi hợp đồng; PT chịu tối đa cùng số. A co lại theo thời gian (PT dạy càng nhiều càng ít rủi ro).
- *Khuyến nghị (không phải quyết định): A*, đúng chữ D22.

### Câu 2. N7 áp dụng thế nào cho các đường tự động A–F của mục 8?

Tại hạ đọc: đường A–E (PT tự nhận vắng, admin xác nhận PT vắng, PT huỷ muộn, quét đóng phòng PT không vào) hoàn giá trị MỘT buổi bằng tiền chưa kiếm của chính buổi đó (không phải đền từ quỹ); chỉ phần thừa (AVAILABLE gộp, nền tảng ứng) và đường F (phạt đến muộn) vi phạm N7; đường E, G còn vướng N3 (sự kiện, kết luận, giải ngân là một bước tự động).
- (α) Giữ A–E như hoàn buổi, bỏ nhánh thừa (từ chối khi thiếu); F tắt cho tới khi có quy trình kết luận; `PT_REPEATED_NO_SHOW` chỉ đếm buổi vắng do PT tự nhận hoặc admin xác nhận (không đếm buổi do quét đóng phòng).
- (β) Như α nhưng F chuyển thành nghĩa vụ phải qua kết luận (mục 7.2); `PT_REPEATED_NO_SHOW` giữ cách đếm hiện tại.
- (γ) Cả A–F, G đều phải qua kết luận + giải ngân của admin: khách không nhận gì ngay.
- Ví dụ (500.000đ/buổi): PT không vào phòng. α/β: khách +500.000 ngay (PT −450.000, nền tảng −50.000, từ PENDING của buổi đó). γ: khách chờ admin; nếu admin chậm 20 ngày, 500.000 nằm ở PENDING. F (đến muộn, 250.000): α tắt, β chờ admin, γ chờ admin.
- Tác động: γ an toàn nhất cho PT nhưng làm khách chờ và tải admin tăng mạnh (210 lần đền vắng trong lịch sử dev); α giữ trải nghiệm hiện tại và bỏ phần vi phạm.
- *Khuyến nghị (không phải quyết định): α*.

### Câu 3. Khe nhỏ của quét nhàn rỗi (mục 11.4 dòng 9): chấp nhận hay đóng bằng chứng nhận?

- (i) Chấp nhận khe vài mili-giây, có phát hiện và báo (cổng cục bộ + kiểm sau).
- (ii) Thêm chứng nhận ngắn hạn do payment-service cấp trước mỗi lần trả quỹ nhàn rỗi.
- (iii) Khoá DB quanh lời gọi quét: bị loại vì chặn đình chỉ khẩn cấp khi payment-service treo (trái N6).
- Ví dụ: hợp đồng 5.000.000đ, nhàn rỗi 31 ngày, đúng lúc đó khách báo PT vắng và admin mở hold; nếu rơi vào khe, 500.000 quỹ về AVAILABLE của PT trước khi hold tới; admin nhận cảnh báo, không thu hồi tự động.
- Tác động: tối đa 500.000 mỗi sự kiện; (ii) là thêm một vòng gọi cho mỗi lần quét nhàn rỗi.
- *Khuyến nghị (không phải quyết định): (i)*.

### Câu 4. Sau khi hold đóng mà hợp đồng còn chạy, đồng hồ "30 ngày không có buổi" tính thế nào?

- (A) Bắt đầu lại 30 ngày từ lúc đóng hold. (B) Tính cả thời gian hold (quỹ về PT ngay sau khi đóng nếu đã nhàn rỗi). (C) Không tự giải phóng nữa, chỉ khi hợp đồng kết thúc.
- Ví dụ: buổi cuối ngày 5, hold mở ngày 6, đóng ngày 40. A: quét trả quỹ ngày 70; B: ngày 40 ngay; C: chỉ khi kết thúc.
- Tác động: B trả 500.000 ngay sau đóng hold; A giữ thêm 30 ngày; C giữ tới hết.
- *Khuyến nghị (không phải quyết định): A* (rẻ nhất: payment-service từ chối trong `idleDays` ngày sau `closedAt`).

### Câu 5. Hold có hạn tối đa tuyệt đối không?

N4: quá 14 ngày chỉ cảnh báo + hàng đợi + gia hạn có lý do; hết hạn KHÔNG phải lỗi của PT. Chưa quyết: có lúc nào tự nhả không.
- (i) Không: hold tồn tại tới khi admin quyết; chỉ hàng đợi nhắc.
- (ii) Sau N ngày (ví dụ 60) hold tự đóng và quỹ trở về trạng thái hợp đồng (còn chạy: vẫn là quỹ; đã kết thúc: về PT), không đền, không lỗi.
- (iii) Như ii nhưng chỉ khi admin không có gia hạn hợp lệ trong N ngày.
- Ví dụ: hợp đồng đã kết thúc, quỹ 500.000, không ai quyết trong 60 ngày. (i): 500.000 vẫn nằm đó; (ii)/(iii): về PT, khách mất cơ hội được đền từ quỹ đó.
- Tác động: (i) giữ tiền PT vô thời hạn (trái tinh thần D42 nếu admin quên); (ii) có thể làm khách mất bảo đảm vì admin chậm.
- *Khuyến nghị (không phải quyết định): (iii)* với N = 60.

### Câu 6. Khi cấm một PT, lệnh bảo vệ tiền sinh tự động cho hợp đồng nào?

- (i) Tự động cho hợp đồng có căn cứ riêng lúc cấm (buổi `DISPUTED`, `PT_NO_SHOW_REPORTED`, hạn chế cấp hợp đồng đang mở) — mục 11.2c.
- (ii) Không tự động; chỉ hợp đồng admin chủ động liệt kê khi cấm (cần thêm danh sách vào lệnh cấm, tức đổi auth-service và form admin).
- (iii) Cả hai.
- Ví dụ (An bị cấm; Bình có khiếu nại, Chi và Dũng không): (i) quỹ 500.000 của Bình được giữ, 450.000 của Chi và 500.000 của Dũng về An; (ii) không hợp đồng nào được giữ nếu admin quên liệt kê (cả ba quỹ về An: 1.450.000).
- Tác động: (i) đúng tinh thần N6 ("hạn chế tài khoản không tự đóng băng mọi hợp đồng") vì căn cứ là của từng hợp đồng chứ không phải của hạn chế; nhưng vẫn là giữ tiền không do quyết định riêng của admin cho hợp đồng đó. (ii) giữ nguyên tắc "mọi hold do admin quyết" nhưng dễ sót.
- *Khuyến nghị (không phải quyết định): (i)*, vì căn cứ đã tồn tại và bị admin biết trước khi cấm.

### Câu 7. Nghĩa vụ đền CŨ (đã/đang tính từ ví gộp) xử lý thế nào?

Thuộc `docs/PT_COMPENSATION_SOURCE_AUDIT.md` (phương án A–E, ví dụ tiền, ưu nhược). Tóm tắt dữ liệu dev: 3 khoản đền vắng (1.200.000đ) đều từ PENDING của chính hợp đồng; 2 khoản nền tảng ứng khi kết thúc (270.000đ, còn 70.000đ chưa thu); không hợp đồng đang chạy nào chạm được AVAILABLE gộp. Chưa chọn.

---

## 19. Những điểm trong mã hôm nay làm thiết kế khó hơn cần thiết (`CODE AUDIT`)

1. **Quỹ không có chỗ chứa riêng** (mục 3.6) — giải bằng M1 hoặc bằng M0 + sàn quỹ (chưa chọn, D56).
2. **Lý do cấm vĩnh viễn là lý do lỗi PT** — F5.
3. **Quét nhàn rỗi tự đánh dấu "đã giải phóng" bất kể kết quả** — F6.
4. **Mọi thao tác tiền của hợp đồng khoá cả ESCROW và REVENUE** (`PS/services/contract-ledger.service.ts:62-63`; `wallet.service.ts` `withWallets`): an toàn tuyệt đối cho kiểm hold, nhưng tuần tự hoá mọi thao tác tiền hợp đồng toàn hệ thống. Hold cộng thêm một `SELECT` mỗi thao tác; chấp nhận được, cần biết khi đo tải.
5. **`terminateContract` đã quá nhiều tham số/nhánh** (`reserve`, `keepBack`, `unresolvedHeld`, `compensation`, `holding`, dấu SETTLED). Thêm đóng băng và `paidFromPot` là thêm hai khoản nữa; tái dùng `reserve`/danh sách giữ khi rút cạn thay vì thêm tham số; với M1 bỏ được dấu `HOLDBACK_SETTLED`.
6. **`settleTracked` không có trạng thái "hoãn"**, thử lại FAILED mỗi 5 phút không giới hạn (`session-settlement.service.ts`, `session-settlement-sweep.service.ts`).
7. **`ownPending` kẹp im lặng** (`:87-99`) che sổ cái hỏng thành "shortfall" thay vì ném lỗi; với hold, lỗi sổ cái làm quỹ đọc thấp hơn thật và phải được bắt bằng HT-25, HT-71.
8. **Bản sao số liệu ở user-service** (`Contract.releasedTo*`, `holdbackReleasedAt`) phải chỉ tăng đúng số payment-service thực sự chuyển — F4.
9. **`coverShortfall`/kẹp AVAILABLE gộp dùng chung với hoa hồng giới thiệu và hoàn dịch vụ cá nhân hoá** (`membership-ledger.service.ts`, `personalized-service-ledger.service.ts`): sửa N7 ở đường PT-hợp đồng không được làm đổi hai đường kia khi chưa có quyết định riêng.
10. **Ba nơi dùng `HOLDBACK_SETTLED`/chuỗi hậu tố khác nhau** để ghi "đã kết thúc/đã giải phóng" — mất đi khi dùng M1.
11. **Chưa đọc**: `PS/providers/*` và các route webhook (agent khác đang sửa), `PS/services/membership-ledger.service.ts` ngoài phần trích, `isolationLevel` ngoài mặc định Prisma (READ COMMITTED; khoá ví `FOR UPDATE` là cái bảo đảm thứ tự), gateway route admin cần thêm, `isPtRestricted` có coi PT bị cấm vĩnh viễn là bị hạn chế hay không (giả định có theo `session-autoconfirm.service.ts`).

---

## 20. Phụ lục — những gì tài liệu này KHÔNG làm

- Không viết mã, không chạy test, không đổi trạng thái git, không ghi DB (chỉ `SELECT` trên DB dev trong phiên viết bản 3; DB kiểm thử không đụng), không sửa `_warroom/`.
- Chỉ các số ở bảng 14.1 cột 3–5 là kết quả chạy thật (`BACKEND INTEGRATION`, do điều phối viên báo, tại hạ không chạy lại); số trong mục 3 và 14.2–14.3 là `TÍNH TAY` đối chiếu bằng chương trình tính độc lập; số `ĐỌC DB DEV` là dữ liệu dev thật nhưng không phải kiểm thử; chưa có kết quả nào mang nhãn `REAL HTTP/API` cho lát 5.
- Không thiết kế giao diện, không chức năng xác nhận điều khoản (D25, chỉ nêu là điều kiện cổng G), không dịch vụ cá nhân hoá (D39).
- Không mở lại các phần lát 1–4 đã làm, trừ các lỗi ở mục 12 là bằng chứng thật nằm trong đường tiền sẽ bật 10%.
- Không công thức đền mới, không bật 10%, không Phase 3, không Owner Management (D51).
- Không quyết các điểm chưa có quyết định: mục 18 là câu hỏi, mỗi câu kèm khuyến nghị đánh dấu rõ là khuyến nghị.
