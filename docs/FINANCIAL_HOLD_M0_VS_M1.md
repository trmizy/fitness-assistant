# Quỹ bảo đảm 10%: hai cách ghi sổ (M0 và M1) — giải thích cho chủ sở hữu

Ngày 15/10/2026. Viết cho Ngài (không cần biết lập trình). Đi kèm `docs/PHASE_2_5A_SLICE5_FINANCIAL_HOLD_DESIGN.md` (bản 3, mục 3.6–3.7 và 18.0). **Ngài CHƯA chọn M0 hay M1 (D56). Tài liệu này chỉ giúp Ngài chọn; tại hạ không chọn thay.** Không có dòng mã nào được viết hay sửa, không ghi DB, không commit.

Nhãn bằng chứng (theo `CLAUDE.md`):
- `TÍNH TAY` = số tự tính từ công thức trong mã. Mọi con số trong tài liệu này đã được đối chiếu bằng một chương trình tính riêng (viết tạm, KHÔNG nạp mã dự án, KHÔNG chạm DB, không lưu vào kho): chương trình mô phỏng cả hai cách ghi sổ, tự kiểm hàng loạt điều kiện (tổng luôn bằng đúng 5.000.000; quỹ từng bước; so với công thức đóng; bảng J5/J6/J8 của bản 3 tái hiện đúng) và báo "đạt hết". Đây vẫn là tính tay, **không phải** kết quả chạy sổ cái thật.
- `CODE AUDIT` = đã đọc mã thật, có tên tệp. Không phải E2E.
- Con số về DB dev lấy từ bản 3 (mục 3.6, 3.7) và `PT_COMPENSATION_SOURCE_AUDIT.md`; phiên này tại hạ không đọc lại DB.

---

## 0. Đọc nhanh (một phút)

1. **Cả hai cách cho CÙNG con số trong tình huống bình thường.** Cùng ví dụ 5.000.000đ, PT rút được bao nhiêu sau mỗi buổi, quỹ còn bao nhiêu, đền 200.000đ rồi còn bao nhiêu: M0 và M1 giống nhau từng đồng (đã kiểm). Khác nhau không nằm ở "bao nhiêu" mà ở **tiền quỹ được cất ở đâu** và **có bị động nhầm hay không khi có sự cố**.
2. **M0** = giữ nguyên cấu trúc sổ hiện tại. Quỹ không có chỗ riêng; nó là một "tờ ghi chú" dán lên một phần tiền nằm chung trong ngăn "chờ" của PT. Muốn biết quỹ còn bao nhiêu, hệ thống đọc lại các dòng ghi chú trong sổ (so khớp chữ trong phần mô tả). Không cần đổi cấu trúc dữ liệu, nhưng **mọi chức năng đụng vào ngăn "chờ" phải tự nhớ chừa phần quỹ ra**.
3. **M1** = thêm một ngăn thứ tư, "két quỹ", nằm riêng trong ví PT. Quỹ là một con số thật của két. Các chức năng khác (trả tiền buổi, phạt đến muộn, hoàn tiền) không có đường nào chạm tới két. Cần một thay đổi cấu trúc dữ liệu (một migration), việc tương tự lần thêm ngăn `LOCKED` trước đây.
4. **Chỗ khác biệt có thể thấy bằng tiền** (mục 3.11-c): PT đến muộn một buổi bị trừ 225.000đ. Nếu M0 không có "sàn quỹ", quỹ vẫn "đọc là đủ 500.000" trong khi 225.000 trong đó đã trả cho PT như tiền buổi 10; cuối hợp đồng chỉ còn 275.000đ để bảo vệ khách. Nếu M0 chỉ có kiểm tra bất biến (như bản 3 mục 3.7 viết), hệ thống phát hiện nhưng bằng cách CHẶN thanh toán buổi 10 (PT không được trả cho tới khi có người xử lý). M0 chỉ xử lý đúng khi có "sàn quỹ" ở mọi hàm. Ở M1 két vẫn nguyên 500.000đ và PT chịu khoản trừ bằng chính tiền buổi 10 của mình, tự động.
5. **Công sức** (ước lượng của tại hạ, chưa đo): M0 khoảng 3–4 ngày, M1 khoảng 5–7 ngày; M1 thêm đúng một migration. Hợp đồng cũ (tỷ lệ giữ lại 0) không bị ảnh hưởng ở cả hai.
6. **Tại hạ nghiêng về M1** (mục 7), nhưng đánh đổi là có thật và **Ngài là người chọn**.

---

## 1. Ví dụ dùng chung

**Hợp đồng:** khách trả **5.000.000đ**, **10 buổi**, mỗi buổi **500.000đ**.

**Tiền chia thế nào (chụp cố định vào hợp đồng lúc ký, không đổi về sau):**

| Loại hợp đồng | Nền tảng | PT | Gym | Lấy ở đâu (`CODE AUDIT`) |
|---|---|---|---|---|
| PT tự do (không gắn phòng gym) — **mặc định thật** | 10% | 90% | 0 | ghi cứng khi tạo hợp đồng, `backend/services/user-service/src/services/contract.service.ts` (bước "Resolve revenue split": `platformRate 0.10, ptRate 0.90, gymRate 0`). 10% nền tảng cũng là mức sàn: `MIN_PLATFORM_RATE` mặc định 0,10 trong `backend/services/payment-service/src/services/contract-money.ts`, hợp đồng không được ký thấp hơn |
| Gắn phòng gym | 10% | tuỳ thoả thuận | tuỳ thoả thuận | lấy từ thoả thuận hợp tác PT–Gym còn hiệu lực lúc ký (`getActiveCollaboration`, cùng tệp `contract.service.ts`) |

Ví dụ chính dùng **90 / 10 / 0** → mỗi buổi **PT 450.000đ + nền tảng 50.000đ**. Ví dụ phụ khi gym > 0 dùng **70 / 10 / 20 (số MINH HOẠ, số thật do thoả thuận quy định)** → mỗi buổi PT 350.000đ, gym 100.000đ, nền tảng 50.000đ (Phụ lục cuối tài liệu).

**Quỹ bảo đảm:** theo chính sách D21: giữ lại **10% giá hợp đồng = 500.000đ**, lấy từ **tiền PT kiếm được ĐẦU TIÊN**, PT chưa rút được cho tới khi hợp đồng xong. Khi PT bỏ ngang, khách được đền bằng **số nhỏ hơn** của "10% phần chưa dùng" và "số quỹ đang giữ" (D22). *Giả định BẬT chỉ để minh hoạ; trong thực tế tính năng đang TẮT: hàm quyết định tỷ lệ (`pt-holdback-rate.ts`) luôn trả 0.*

**Từ ngữ dùng trong tài liệu:**
- **ESCROW** = tài khoản nền tảng giữ tiền mặt khách đã trả. Các "ví" khác (PT, nền tảng, khách) chỉ là quyền đòi trên số tiền mặt đó. Khi chưa ai rút tiền thật ra ngoài, ESCROW luôn bằng đúng 5.000.000.
- **PT rút được** = tiền PT đã kiếm xong, nằm ngăn "khả dụng".
- **PT chưa kiếm** = phần PT của các buổi chưa dạy, nằm ngăn "chờ".
- **Quỹ** = phần giữ bảo đảm 500.000đ.
- **Mã giao dịch của hợp đồng** = mã gắn trên từng dòng sổ, cho biết dòng đó thuộc hợp đồng nào.

**Hai cách, nói bằng hình ảnh:**
- **M0:** PT có một ngăn kéo "chờ" chứa tiền của MỌI hợp đồng của họ. Quỹ chỉ là tờ giấy ghi "trong ngăn này, 500.000đ của hợp đồng X là quỹ" — tiền không tách ra.
- **M1:** thêm một két riêng cạnh ngăn kéo. Quỹ nằm trong két; không ai mở ngăn kéo mà lấy nhầm được tiền két.

Quy ước cột trong các bảng: **Cộng** = PT rút được + quỹ + PT chưa kiếm + nền tảng đã kiếm + nền tảng chưa kiếm (+ khách khi có đền). Luôn phải bằng 5.000.000.

---

## 2. Điều cả hai phương án đều cần (để khỏi tính hai lần)

Dù chọn M0 hay M1, lát 5 vẫn phải làm: (a) quy tắc N1 "không bơm lại quỹ" (mã hiện tại SẼ bơm lại — xem Câu 6 bên dưới; bản 3 mục 3.4); (b) tính "đã đền từ quỹ" để cuối hợp đồng không báo thiếu; (c) ba bảng hold/nghĩa vụ của payment-service (U2); (d) cổng cục bộ khi cấm PT (U6). Phần chênh giữa M0 và M1 chỉ là **cách cất và bảo vệ quỹ**.

---

## 3. Phương án M0 — giữ cấu trúc hiện tại, quỹ suy từ phần mô tả dòng sổ, thêm kiểm tra bất biến

Mô tả đầy đủ cho kỹ sư ở bản 3 mục 3.7. Tại hạ hiểu M0 gồm: (i) thêm một nhãn mới "trả từ quỹ cho khách" để quỹ giảm khi đền; (ii) sau mỗi thao tác kiểm "ngăn chờ của hợp đồng ≥ quỹ suy ra", sai thì báo lỗi chứ không âm thầm cắt; (iii) thêm kiểm "mọi sổ phụ ≥ 0" vào đối soát hằng ngày; (iv) theo mục 5.5 bản 3: **mọi hàm đụng ngăn chờ phải chừa "sàn quỹ"** (gọi tắt **M0 + sàn**). Mục 3.11-c cho thấy vì sao (iv) cần thiết: nếu chỉ có (i)–(iii) thì lỗi phí đến muộn vẫn xảy ra (bị chặn thanh toán hoặc quỹ co lại).

### 3.1–3.10 Mười câu của Ngài

**Câu 1. Quỹ lấy từ phần tiền nào?**
Từ **phần của PT (90%)** ở các buổi đầu: 450.000 của buổi 1 + 50.000 của buổi 2 = 500.000. Không lấy thêm từ khách, không lấy phần 10% của nền tảng, không lấy phần gym. M0 cất quỹ **ngay trong ngăn "chờ" của PT**, chỉ gắn nhãn.

**Câu 2. Quỹ hình thành khi nào?**
Không phải lúc khách trả tiền (lúc đó 4.500.000 của PT đều là "chưa kiếm"). Quỹ xuất hiện **từ buổi đầu tiên được xác nhận**: buổi 1 giữ 450.000 (PT rút được 0), buổi 2 giữ thêm 50.000 (quỹ đủ 500.000) và trả 400.000; từ buổi 3 PT nhận đủ 450.000. Ở M0 việc "giữ" là hai dòng sổ cùng ngăn: một dòng "trả ra" rồi một dòng "giữ lại — quỹ"; số dư ngăn chờ không đổi.

**Câu 3 + 4. Sau mỗi buổi PT rút được bao nhiêu; bao nhiêu nằm trong ESCROW / bị giữ?** (`TÍNH TAY`, quỹ đang bật 10% giả định, 90/10/0)

| Sau buổi | PT rút được | Quỹ đang giữ | PT chưa kiếm (buổi sau) | Nền tảng đã kiếm | Nền tảng chưa kiếm | Cộng | ESCROW (tiền mặt) |
|---|---|---|---|---|---|---|---|
| 0 (vừa thanh toán) | 0 | 0 | 4.500.000 | 0 | 500.000 | 5.000.000 | 5.000.000 |
| 1 | 0 | 450.000 | 4.050.000 | 50.000 | 450.000 | 5.000.000 | 5.000.000 |
| 2 | 400.000 | 500.000 | 3.600.000 | 100.000 | 400.000 | 5.000.000 | 5.000.000 |
| 3 | 850.000 | 500.000 | 3.150.000 | 150.000 | 350.000 | 5.000.000 | 5.000.000 |
| 4 | 1.300.000 | 500.000 | 2.700.000 | 200.000 | 300.000 | 5.000.000 | 5.000.000 |
| 5 | 1.750.000 | 500.000 | 2.250.000 | 250.000 | 250.000 | 5.000.000 | 5.000.000 |
| 6 | 2.200.000 | 500.000 | 1.800.000 | 300.000 | 200.000 | 5.000.000 | 5.000.000 |
| 7 | 2.650.000 | 500.000 | 1.350.000 | 350.000 | 150.000 | 5.000.000 | 5.000.000 |
| 8 | 3.100.000 | 500.000 | 900.000 | 400.000 | 100.000 | 5.000.000 | 5.000.000 |
| 9 | 3.550.000 | 500.000 | 450.000 | 450.000 | 50.000 | 5.000.000 | 5.000.000 |
| 10 | 4.000.000 | 500.000 | 0 | 500.000 | 0 | 5.000.000 | 5.000.000 |
| Hợp đồng hoàn tất | 4.500.000 | 0 | 0 | 500.000 | 0 | 5.000.000 | 5.000.000 |

- **ESCROW luôn 5.000.000** vì quỹ chỉ là một quyền đòi đổi nhãn, tiền mặt không rời nền tảng. ESCROW chỉ giảm khi có người rút tiền thật ra ngoài (khi đó PT rút được và ESCROW cùng giảm một số).
- **Ở M0, cột "Quỹ" và cột "PT chưa kiếm" là hai phần của CÙNG một ngăn chờ.** Ví dụ sau buổi 4 ngăn chờ của hợp đồng là 3.200.000 = 500.000 (quỹ) + 2.700.000 (chưa kiếm); hệ thống tách hai phần bằng cách cộng/trừ các dòng có chữ "PT holdback …" trong mô tả.

**Câu 5. Nếu PT bị phán đền 200.000đ, tiền đi từ đâu?**
Điều kiện: PT bỏ ngang sau buổi 4 → mức trần chính sách = 10% × phần chưa dùng (6 buổi × 500.000 = 3.000.000) = **300.000**; quỹ đang có 500.000; admin quyết 200.000 → trả `min(500.000; 300.000; 200.000)` = **200.000**.
- Tiền đi **từ quỹ của đúng hợp đồng đó** → ví khách (+200.000, rút về được).
- Không lấy từ PT rút được (vẫn 1.300.000), không lấy từ hợp đồng khác của PT, không nền tảng ứng, không ghi nợ PT (D20, D22, D43, D48).
- Cách ghi ở M0: một dòng **giảm ngăn chờ của PT** dưới mã hợp đồng đó, mô tả kết thúc bằng nhãn mới "trả từ quỹ cho khách". Quỹ suy ra = (đã giữ) − (đã nhả) − (đã trả đền).

**Câu 6. Phần còn lại sau đền (N1: không bơm lại).**
Quỹ còn **300.000**. Quy tắc N1 (D46): phần "đã góp vào quỹ" vẫn tính 500.000 (= 300.000 còn + 200.000 đã trả), nên các buổi sau **không lấp lại quỹ**. Mã hiện tại sẽ lấp lại (buổi 5 giữ thêm 200.000, chỉ trả 250.000 — đã kiểm: trái N1). Ở M0 muốn thi hành N1 phải cộng ba loại dòng chữ (giữ − nhả − đền) để ra "đã góp" — chạy được nhưng dựa vào việc so khớp chữ.

**Câu 7. Hợp đồng tiếp tục, quỹ còn lại diễn biến thế nào?** (`TÍNH TAY`)

| Sau buổi | PT rút được | Quỹ | PT chưa kiếm | Khách (đã nhận đền) | Nền tảng đã kiếm | Nền tảng chưa kiếm | Cộng |
|---|---|---|---|---|---|---|---|
| 4, vừa đền 200.000 | 1.300.000 | 300.000 | 2.700.000 | 200.000 | 200.000 | 300.000 | 5.000.000 |
| 5 | 1.750.000 | 300.000 | 2.250.000 | 200.000 | 250.000 | 250.000 | 5.000.000 |
| 6 | 2.200.000 | 300.000 | 1.800.000 | 200.000 | 300.000 | 200.000 | 5.000.000 |
| 7 | 2.650.000 | 300.000 | 1.350.000 | 200.000 | 350.000 | 150.000 | 5.000.000 |
| 8 | 3.100.000 | 300.000 | 900.000 | 200.000 | 400.000 | 100.000 | 5.000.000 |
| 9 | 3.550.000 | 300.000 | 450.000 | 200.000 | 450.000 | 50.000 | 5.000.000 |
| 10 | 4.000.000 | 300.000 | 0 | 200.000 | 500.000 | 0 | 5.000.000 |

Quỹ **đứng yên 300.000**, chỉ có thể giảm thêm nếu admin phán đền tiếp (trần cộng dồn: tổng đền không vượt trần chính sách; cách đo trần theo thời gian còn là câu 1 mục 18 bản 3).

**Câu 8. Hết hợp đồng, phần còn lại được nhả ra sao?**
- **Hoàn tất bình thường (COMPLETED):** PT còn được nhận = quyền lợi 4.500.000 − đã rút được 4.000.000 − đã đền 200.000 = **300.000**, chuyển từ ngăn chờ sang rút được → PT cuối cùng **4.300.000**, khách 200.000, nền tảng 500.000; Σ = 5.000.000 (đã kiểm). Ở M0 điều này chỉ đúng nếu `terminateContract` được sửa để **trừ phần "đã đền"** (bản 3 mục 7.8); nếu quên, hệ thống tính PT còn được 500.000 nhưng ngăn chờ chỉ có 300.000 và báo thiếu 200.000.
- **Quy tắc 30 ngày không có buổi (D24, D29):** hết 30 ngày không hoạt động, 300.000 còn lại được trả cho PT ngay (PT rút được 1.300.000 → 1.600.000), hợp đồng chạy tiếp **không còn quỹ**, các buổi sau trả đủ 450.000; cuối cùng PT vẫn 4.300.000 (đã kiểm). Ở M0 việc "đã nhả" được ghi bằng một dòng 0 đồng/dòng mô tả có chữ "released (no activity)". **Nếu đang có Financial Hold (đóng băng) thì quét 30 ngày bị từ chối.**

**Câu 9. Cần bao nhiêu migration / thay đổi sổ cái?**
- Migration ở sổ cái: **0**. (Toàn kế hoạch vẫn có F5 và U6 ở user-service, U2 ở payment-service: tổng 3 migration, chung cho cả hai phương án.)
- Thay đổi mã sổ cái (`CODE AUDIT`, `contract-ledger.service.ts`): thêm nhãn "trả từ quỹ"; sửa hàm đọc quỹ để trừ phần đã đền; **thêm "sàn quỹ" ở mọi hàm đụng ngăn chờ** — trả tiền buổi, phạt vắng, phạt đến muộn, giải quyết buổi treo, rút cạn khi kết thúc, hoàn thanh toán chưa kích hoạt (ít nhất 6 hàm); thêm kiểm bất biến + đối soát. Dấu `HOLDBACK_SETTLED` và các chuỗi hậu tố giữ nguyên.
- Công sức ước lượng: **3–4 ngày** (gồm kiểm thử HT-70…HT-75).

**Câu 10. Hợp đồng cũ (mọi hợp đồng hiện có đều tỷ lệ giữ lại 0)?**
Tương thích hoàn toàn: với tỷ lệ 0, mục tiêu quỹ = 0 nên đường mã quỹ **không chạy** (`holding = false` trong `releaseSession`/`terminateContract`); kết quả mọi hàm y như trước (bài ghim HT-26). Không migration, không di chuyển dữ liệu. (Bản 3: dev có 0/702 dòng sổ mang chữ "PT holdback"; môi trường khác chạy truy vấn Q3 trước.) **Điểm cần lưu ý:** nếu sau này đổi từ M0 sang M1 SAU khi đã có hợp đồng mang quỹ thật, phải chạy một script chuyển quỹ từng hợp đồng — đắt hơn quyết định ngay từ bây giờ.

### 3.11 Bảng đối soát M0

**(a) Tổng không bao giờ vượt 5.000.000** — mọi dòng trong bảng ở câu 3, câu 7 đều cộng đúng 5.000.000 (đã kiểm từng hàng). Lý do cấu trúc: mọi thao tác chỉ chuyển quyền đòi từ ví này sang ví khác (ghi giảm một nơi, ghi tăng một nơi); riêng "quỹ" là hai dòng cùng ngăn (giảm rồi tăng) nên không tạo tiền.

**(b) Không đồng nào đếm hai lần** — ví dụ ngay sau buổi 4 và đền 200.000:

| Phần | Số tiền | Nằm ở | Cũng được tính là… |
|---|---|---|---|
| Khách nhận đền | 200.000 | ví khách | không |
| PT rút được | 1.300.000 | ví PT, khả dụng | không (đã ra khỏi quỹ từ lúc nhả) |
| Quỹ | 300.000 | ngăn chờ PT (nhãn) | không phải "chưa kiếm" |
| PT chưa kiếm (6 buổi) | 2.700.000 | ngăn chờ PT | không phải quỹ |
| Nền tảng đã kiếm | 200.000 | doanh thu, khả dụng | |
| Nền tảng chưa kiếm | 300.000 | doanh thu, chờ | |
| **Cộng** | **5.000.000** | | |

Quỹ và "chưa kiếm" là hai phần của ngăn chờ PT (3.000.000). **M0 chỉ đúng nếu chữ ghi chú đúng**: bản 3 (mục 3.6, W1) ghi rõ đổi một chữ trong hậu tố làm quỹ về 0 mà không có cảnh báo nào.

**(c) Quyền sở hữu theo từng hợp đồng + ca phí đến muộn (từ kiểm toán bản 3, W2).** Sau buổi 4, PT đến muộn buổi 5: PT bị trừ 225.000, nền tảng bị trừ 25.000, khách nhận 250.000. Ngăn chờ PT của hợp đồng còn 2.975.000, trong khi để vừa giữ quỹ 500.000 vừa trả đủ 6 buổi × 450.000 cần 3.200.000: **thiếu 225.000** (mọi cách ghi sổ đều thiếu như nhau; câu hỏi là AI gánh khoản thiếu và quỹ của khách còn nguyên không). Sau đó Financial Hold đang đóng băng quỹ và các buổi 5–10 vẫn diễn ra (hold loại A không chặn tiền buổi, D42):

| Cách | Quỹ "đọc" ngay sau phí | Điều xảy ra ở buổi 10 | Quỹ sau cùng | PT rút được |
|---|---|---|---|---|
| **M0 như mã hiện tại (không kiểm gì thêm)** | 500.000 ("đủ") | PT nhận đủ 450.000, **bằng tiền nằm dưới quỹ** | **275.000** | 4.000.000 |
| **M0 + kiểm bất biến** (đúng chữ bản 3 mục 3.7: ngăn chờ phải ≥ quỹ suy ra, sai thì báo lỗi) | 500.000 (kiểm vẫn đạt: 2.975.000 ≥ 500.000) | **BỊ CHẶN**: thanh toán buổi 10 báo lỗi và hoàn tác, thử lại mãi cho tới khi người xử lý | 500.000 | 3.550.000 (buổi 10 chưa được trả) |
| **M0 + sàn quỹ ở mọi hàm** | 500.000 | PT nhận 225.000 (phí trừ vào tiền buổi 10 của chính PT) | 500.000 | 3.775.000 |
| **M1 — két riêng** | 500.000 | PT nhận 225.000 (như trên, tự động) | 500.000 | 3.775.000 |

- **Không cách nào tạo ra hoặc làm mất tiền**: tổng quỹ + PT rút được + phần chưa trả buổi 10 luôn bằng nhau (4.275.000 cho PT); khác nhau là *quỹ của khách có còn nguyên không* và *thanh toán có bị kẹt không*.
- Dòng 1 là điều sẽ xảy ra nếu bật 10% với mã hiện tại: cùng một đồng vừa được tính là quỹ (đang bị đóng băng), vừa được tính là tiền buổi 10 đã trả cho PT. Mã hiện tại tự kẹp im lặng ở bước này (bản 3 mục 19.7), nên không có cảnh báo nào.
- Dòng 2 phát hiện nhưng không xử lý: tiền không mất, nhưng một buổi đã dạy xong mà PT không được trả cho tới khi có người can thiệp (đúng như bản 3 viết "bị chặn thay vì xử lý").
- Dòng 3 đúng, nhưng chỉ chừng nào **mỗi hàm** đụng ngăn chờ đều có sàn: hàm nào quên (kể cả hàm viết sau này) là lỗ hổng.

**(d) Nhiều hợp đồng của cùng một PT: An với Bình, Chi, Dũng** (số liệu mục 15.1 bản 3, mỗi hợp đồng 5.000.000đ / 10 buổi / 90-10-0; Bình đã dạy 3 buổi, Chi 1, Dũng 5). Đền cho Bình 200.000.

| Hợp đồng | Quỹ trước | Ngăn chờ của hợp đồng trước → sau | Quỹ sau | Có bị động tới? |
|---|---|---|---|---|
| Bình | 500.000 | 3.650.000 → 3.450.000 | **300.000** | có (đúng hợp đồng được phán) |
| Chi | 450.000 | 4.500.000 → 4.500.000 | 450.000 | **không** |
| Dũng | 500.000 | 2.750.000 → 2.750.000 | 500.000 | **không** |
| Ngăn chờ gộp của An (3 hợp đồng) | | 10.900.000 → 10.700.000 | | giảm đúng 200.000 |

PT rút được của An vẫn 2.600.000 (850.000 + 0 + 1.750.000). Nếu admin sau đó viết thêm 700.000 cho Bình: trần còn lại = 350.000 − 200.000 = 150.000 → trả **150.000**, ghi "chưa giải quyết" 550.000 (không phải nợ PT, nền tảng không ứng); Chi và Dũng vẫn nguyên (đã kiểm).

**Vì sao Bình không thể chạm tiền Chi/Dũng ở M0:** (1) mỗi dòng sổ mang mã giao dịch của riêng hợp đồng; quỹ của Bình chỉ cộng các dòng mang mã của Bình; (2) khoản đền bị chặn bởi quỹ của Bình và trần chính sách của Bình; (3) dòng ghi giảm mang mã Bình. **Giới hạn của M0:** số dư "ngăn chờ" 10.900.000 là con số **gộp** của cả ba hợp đồng — chính con số gộp này từng bị dùng nhầm (lỗi "vét tiền chờ", đã sửa ở commit `2578561`; bản 3 mục 3.6 W4 ghi dev còn 7 sổ phụ âm do lỗi đó). Ở M0 chỉ có thể kiểm theo từng mã hợp đồng, không có con số tổng nào để đối chiếu cho quỹ.

---

## 4. Phương án M1 — thêm ngăn thứ tư "HOLDBACK" (két quỹ) trong ví PT

Mô tả đầy đủ cho kỹ sư ở bản 3 mục 3.7. Thêm một giá trị ngăn mới và một cột số dư; quỹ của hợp đồng = tổng các dòng có mã hợp đồng đó trong két.

### 4.1–4.10 Mười câu của Ngài

**Câu 1. Quỹ lấy từ phần tiền nào?**
Y hệt M0: từ **phần PT (90%) của các buổi đầu** (450.000 + 50.000), không lấy từ khách, nền tảng hay gym. Khác ở chỗ cất: M1 **chuyển** số này từ "chưa kiếm" sang **két riêng**.

**Câu 2. Quỹ hình thành khi nào?**
Cũng từ buổi đầu được xác nhận: buổi 1 chuyển 450.000 từ ngăn chờ vào két (PT rút được 0); buổi 2 chuyển thêm 50.000 (két đủ 500.000) và trả 400.000; từ buổi 3 trả đủ 450.000. Lúc khách trả tiền chưa có quỹ.

**Câu 3 + 4. Sau mỗi buổi PT rút được bao nhiêu; ESCROW / bị giữ?**
**Bảng GIỐNG HỆT bảng M0 ở câu 3+4** (đã kiểm từng ô, hai mô phỏng cho cùng số). Chỉ khác chỗ đọc: cột "Quỹ" nay là **số dư két** và cột "PT chưa kiếm" là **số dư ngăn chờ**, hai con số riêng trong ví, không phải hai phần của một số:

| Sau buổi | PT rút được | Két quỹ | Ngăn chờ PT (chưa kiếm) | ESCROW |
|---|---|---|---|---|
| 1 | 0 | 450.000 | 4.050.000 | 5.000.000 |
| 2 | 400.000 | 500.000 | 3.600.000 | 5.000.000 |
| 4 | 1.300.000 | 500.000 | 2.700.000 | 5.000.000 |
| 10 | 4.000.000 | 500.000 | 0 | 5.000.000 |
| Hoàn tất | 4.500.000 | 0 | 0 | 5.000.000 |

(Các buổi còn lại như bảng M0; ở mọi hàng Cộng với phần nền tảng = 5.000.000.)

**Câu 5. Nếu PT bị phán đền 200.000đ, tiền đi từ đâu?**
Cùng điều kiện và cùng số như M0: `min(500.000; 300.000; 200.000)` = **200.000**, từ quỹ đúng hợp đồng đó → ví khách; không chạm PT rút được, hợp đồng khác, nền tảng ứng, nợ. Cách ghi: một dòng **ghi giảm két quỹ** (số dư két 500.000 → 300.000). Không có chữ nào phải so khớp.

**Câu 6. Phần còn lại sau đền (N1).**
Két còn **300.000**; "đã góp vào quỹ" = tổng các lần ghi tăng két (500.000) — chỉ cộng một loại dòng — nên các buổi sau không lấp lại; PT nhận đủ 450.000 từ buổi 5 (giống M0).

**Câu 7. Hợp đồng tiếp tục.**
**Bảng giống hệt bảng M0 ở câu 7** (két đứng yên 300.000; PT rút được 1.750.000 → 4.000.000 sau buổi 10; Σ luôn 5.000.000, đã kiểm).

**Câu 8. Hết hợp đồng, phần còn lại được nhả ra sao?**
- **COMPLETED:** két 300.000 chuyển sang PT rút được **bằng một dòng riêng** ("quỹ trả lại PT"); phần bù từ ngăn chờ = 4.500.000 − 4.000.000 − 300.000 − 200.000 = 0. PT cuối **4.300.000**, khách 200.000, nền tảng 500.000 (đã kiểm). Không cần dấu `HOLDBACK_SETTLED` nữa (bản 3 mục 19.10).
- **30 ngày không có buổi (D24):** két 300.000 chuyển sang rút được (1.300.000 → 1.600.000), hợp đồng chạy tiếp không quỹ, cuối cùng 4.300.000 (đã kiểm — cùng số với M0). Vẫn cần một dấu "đã nhả" để không nhả hai lần. **Đang có Financial Hold thì quét bị từ chối.**

**Câu 9. Cần bao nhiêu migration / thay đổi sổ cái?**
- Migration ở sổ cái: **1** (hai câu lệnh nhỏ: thêm giá trị `HOLDBACK` vào danh sách ngăn và thêm cột `holdback_balance` mặc định 0 vào bảng ví). Toàn kế hoạch: 4 migration (M0 là 3). Tiền lệ: ngăn `LOCKED` cũng được thêm bằng một migration nhỏ (`20260830000002_add_locked_ledger_bucket`).
- Thay đổi mã (`CODE AUDIT`): `wallet.service.ts` (kiểu ngăn, đọc/ghi số dư, cập nhật cột — 4–5 chỗ, giống chỗ `LOCKED` đã đi qua); `reconcile.service.ts` (cộng ngăn mới vào bất biến ESCROW = tổng quyền đòi, và báo số dư âm); `contract-ledger.service.ts` (ghi vào két thay vì nhãn chữ; trả quỹ két → rút được; bỏ các dấu hậu tố). **Không cần "sàn quỹ" ở từng hàm**, vì các hàm khác không có đường tới két.
- Công sức ước lượng: **5–7 ngày** (gồm chạy migration bằng `migrate deploy` trên DB kiểm thử, HT-70…HT-75, HT-74).
- Chưa kiểm: màn hình ví PT/gym có cộng các ngăn để hiển thị hay không (tại hạ chưa đọc phần giao diện) — nếu có, cần thêm dòng "tiền bảo đảm đang giữ".

**Câu 10. Hợp đồng cũ (tỷ lệ 0)?**
Tương thích: cột mới mặc định 0 cho mọi ví hiện có; hợp đồng tỷ lệ 0 không bao giờ ghi vào két (HT-26 ghim kết quả không đổi); không cần chuyển dữ liệu (dev 0 dòng quỹ). Thay đổi chạy được **trước** khi bật 10% nên không có hợp đồng nào mang quỹ phải chuyển. Nếu một môi trường nào đó đã có quỹ theo kiểu chữ (chạy Q3 để biết), cần một script một lần chuyển quỹ từng hợp đồng từ ngăn chờ sang két (mặc định chạy thử).

### 4.11 Bảng đối soát M1

**(a) Tổng không bao giờ vượt 5.000.000:** mọi hàng trong các bảng đều cộng 5.000.000 (đã kiểm). Bất biến hệ thống mở rộng: ESCROW = ngăn chờ + rút được + đã khoá + **két quỹ** của mọi ví khác.

**(b) Không đồng nào đếm hai lần** — ví dụ ngay sau buổi 4 và đền 200.000:

| Phần | Số tiền | Nằm ở | Cũng được tính là… |
|---|---|---|---|
| Khách nhận đền | 200.000 | ví khách | không |
| PT rút được | 1.300.000 | ví PT, khả dụng | không |
| **Két quỹ** | 300.000 | ví PT, ngăn HOLDBACK | **không thể** là chưa kiếm: số dư ngăn chờ riêng |
| PT chưa kiếm (6 buổi) | 2.700.000 | ví PT, ngăn chờ | không thể là quỹ |
| Nền tảng đã kiếm | 200.000 | doanh thu, khả dụng | |
| Nền tảng chưa kiếm | 300.000 | doanh thu, chờ | |
| **Cộng** | **5.000.000** | | |

Quỹ và "chưa kiếm" nằm ở hai ngăn khác nhau nên không thể trùng nhau bằng cấu trúc; tiền từ két ra khỏi két chỉ qua hai cửa (đền cho khách, nhả cho PT), mỗi cửa vừa ghi giảm két vừa ghi tăng nơi nhận.

**(c) Ca phí đến muộn (cùng kịch bản mục 3.11-c):** phí chỉ có thể trừ vào ngăn chờ (phần chưa kiếm), **không có đường nào tới két**. Kết quả (dòng cuối bảng 3.11-c): két còn **500.000** sau buổi 10; buổi 10 PT nhận 225.000 (chịu khoản phí bằng chính tiền buổi 10 của mình); PT tổng (két + rút được) 4.275.000. Không có thao tác nào bị chặn và không cần ai can thiệp. Financial Hold đóng băng đúng 500.000 thật. Nếu phần chưa kiếm không đủ để chịu phí, thiếu hụt hiển thị ở ngăn chờ (và theo N7 phải **ghi nhận chưa thanh toán**, không lấy quỹ, không lấy PT rút được, không nền tảng ứng — việc này thuộc đơn vị U5, không phụ thuộc M0/M1).

**(d) Nhiều hợp đồng: An với Bình, Chi, Dũng**, đền cho Bình 200.000:

| Hợp đồng | Két quỹ trước | Ngăn chờ trước → sau | Két sau | Có bị động tới? |
|---|---|---|---|---|
| Bình | 500.000 | 3.150.000 → 3.150.000 | **300.000** | có (đúng hợp đồng được phán) |
| Chi | 450.000 | 4.050.000 → 4.050.000 | 450.000 | **không** |
| Dũng | 500.000 | 2.250.000 → 2.250.000 | 500.000 | **không** |
| Ví PT của An | | ngăn chờ 9.450.000 (không đổi); **két 1.450.000 → 1.250.000** | | giảm đúng 200.000 |

PT rút được vẫn 2.600.000. Viết thêm 700.000 cho Bình → trả 150.000 (trần còn lại), chưa giải quyết 550.000; Chi và Dũng nguyên (đã kiểm).

**Vì sao Bình không thể chạm tiền Chi/Dũng ở M1:** cùng ba lớp bảo vệ như M0 (mã giao dịch từng dòng; trần theo quỹ và trần chính sách của riêng Bình), **cộng thêm một lớp có con số kiểm được**: số dư két của An phải bằng tổng quỹ ba hợp đồng (500.000 + 450.000 + 500.000 = 1.450.000 trước, 1.250.000 sau). Lệch một đồng là đối soát hằng ngày báo ngay. Và con số gộp "ngăn chờ" — thứ từng bị dùng nhầm — không còn chứa quỹ nên khoản đền không có cách nào ăn vào nó.

---

## 5. So sánh nhanh

| Tiêu chí | M0 (giữ cấu trúc, kiểm bất biến + sàn quỹ) | M1 (két quỹ riêng) |
|---|---|---|
| Con số bình thường (mười câu) | như nhau từng đồng | như nhau từng đồng |
| Quỹ là… | suy từ chữ trong phần mô tả | một số dư thật |
| Bảo vệ khỏi bị động nhầm | phải viết "sàn quỹ" ở ≥ 6 hàm; hàm nào quên là lỗ hổng | cấu trúc: không có đường tới két |
| Ca phí đến muộn (mục 3.11-c) | không kiểm gì thêm: quỹ co còn 275.000; chỉ kiểm bất biến: chặn thanh toán buổi 10; có sàn quỹ: đúng | két 500.000 nguyên, PT nhận 225.000 buổi 10, tự động |
| Kiểm chéo nhiều hợp đồng | chỉ theo từng mã hợp đồng | thêm: tổng két = tổng quỹ các hợp đồng |
| Migration sổ cái | 0 (tổng kế hoạch: 3) | 1 (tổng kế hoạch: 4) |
| Sửa mã sổ cái | ≥ 6 hàm cho sàn + hàm đọc quỹ + kiểm | lõi ví (4–5 chỗ) + đối soát + vài hàm ghi/nhả quỹ |
| Công sức ước lượng | 3–4 ngày | 5–7 ngày |
| Hợp đồng cũ (tỷ lệ 0) | không đổi | không đổi (cột mặc định 0) |
| Chuyển sang cách kia về sau | M0 → M1 sau khi có quỹ thật: phải chạy script chuyển dữ liệu | M1 → M0: không cần chuyển dữ liệu (nhưng bỏ mất lợi thế) |
| Rủi ro chính | lỗi âm thầm do quên sàn / đổi chữ; Hold đóng băng "một con số" | đụng lõi ví dùng cho mọi thanh toán; màn hình tổng hợp ví phải kiểm |

---

## 6. Hai phương án KHÔNG giải quyết được (để Ngài khỏi kỳ vọng sai)

Dù chọn M0 hay M1, các việc sau vẫn phải làm riêng: phạt đến muộn/vắng hiện còn lấy từ ví gộp và để nền tảng ứng (N7, đơn vị U5); các số đếm do user-service gửi lệch sổ cái (F4); buổi sót trên hợp đồng đã kết thúc (D55); điều khoản PT đồng ý quy tắc giữ 10% (D25, cổng G). M0/M1 chỉ quyết **cách cất và bảo vệ quỹ**.

---

## 7. Khuyến nghị

**Tại hạ nghiêng về M1. Đây là khuyến nghị, KHÔNG phải quyết định. Ngài chọn.**

Lý do:
1. Nguyên tắc của Ngài là quỹ phải chứng minh được bằng quyền sở hữu từng khoản và Financial Hold phải đóng băng đúng tiền (D42, D51). M1 làm điều đó bằng cấu trúc; M0 làm bằng kỷ luật viết mã ở mọi hàm, và bằng chứng ở mục 3.11-c cho thấy chỉ một hàm quên sàn là quỹ "đọc đủ" mà tiền đã đi.
2. Chi phí chênh nhỏ so với lợi ích: thêm khoảng 2–3 ngày và một migration cỡ lần thêm ngăn `LOCKED`, trong một kế hoạch còn nhiều bước trước cổng G.
3. Thời điểm rẻ nhất để làm là bây giờ: mọi hợp đồng đang tỷ lệ 0, không có quỹ nào phải chuyển. Sau khi bật 10% mới đổi thì tốn thêm một script chuyển dữ liệu.

Cái giá và những gì có thể hỏng nếu chọn M1:
- Đụng lõi ví mà mọi thanh toán đều đi qua → rủi ro hồi quy; giảm nhẹ bằng bài ghim HT-26 (tỷ lệ 0 cho kết quả không đổi) và chạy migration thử bằng `migrate deploy` trên DB kiểm thử `*_test`.
- Mọi nơi cộng các ngăn của ví (đối soát, có thể cả màn hình ví) phải được cập nhật; quên là số hiển thị lệch (tại hạ chưa đọc phần giao diện).
- Thêm giá trị vào danh sách ngăn là thay đổi không gỡ ra được (vô hại nếu không dùng).
- Chậm hơn 2–3 ngày.

Khi nào M0 hợp lý hơn: nếu Ngài muốn **không đổi cấu trúc sổ cái trước cổng G** hoặc chưa chắc sẽ bật 10%; khi đó chấp nhận: bắt buộc "M0 + sàn quỹ" (không phải chỉ kiểm bất biến), mỗi hàm mới đụng ngăn chờ sau này phải qua kiểm duyệt, và hiểu rằng Hold đóng băng "một con số" nhờ các hàm khác tôn trọng.

**Việc cần Ngài làm:** trả lời "M0" hoặc "M1" **trước khi bắt đầu đơn vị U1** (sau F4). Không chặn F1–F3, F5, F6. Chưa có quyết định nên tài liệu thiết kế vẫn giữ hai nhánh (mục 3.7, 16.4).

---

## 8. Kiểm chứng số liệu

- Chương trình tính riêng (Node.js, không nạp mã dự án, không DB) mô phỏng: 10 buổi với M0 và M1; đền 200.000 sau buổi 4 rồi buổi 5–10 rồi hoàn tất; nhàn rỗi 30 ngày; gym > 0 (70/10/20); phí đến muộn với bốn biến thể (M0 không kiểm, M0 + kiểm bất biến, M0 + sàn, M1); An với Bình/Chi/Dũng (đền 200.000 và 700.000); bảng J5/J6/J8 của bản 3 (PT cuối 4.200.000 khi đền 300.000); và số liệu bình luận D52 (Bình giữ buổi 4: hoàn 3.000.000, PT còn được 1.350.000, giữ 500.000).
- Kết quả: tất cả điều kiện kiểm đạt, Σ luôn đúng 5.000.000 (hoặc 15.000.000 cho ba hợp đồng). Mô phỏng được viết lại từ công thức trong `contract-money.ts` (`splitReleaseWithHoldback`, `holdbackCompensationTarget`) và `contract-ledger.service.ts` (`releaseSession`, `terminateContract`, `releasePtHoldback`, `compensateLateArrival`), cộng quy tắc N1/N2 của bản 3. Hai chỗ mô phỏng DIỄN GIẢI thiết kế (không phải mã đang chạy): quy tắc N1 và công thức đền theo nghĩa vụ — vì mã hiện tại chưa có.
- Tất cả vẫn là `TÍNH TAY`. Chưa có kết quả `BACKEND INTEGRATION` hay `REAL HTTP/API` nào cho M0/M1; bài kiểm thử sổ cái thật để chốt là HT-70…HT-75 của bản 3, mục 17.

---

## Phụ lục — ví dụ khi gym > 0 (70 / 10 / 20, số minh hoạ)

Cùng hợp đồng 5.000.000đ / 10 buổi. Mỗi buổi: PT 350.000, gym 100.000, nền tảng 50.000. Quỹ vẫn **500.000** (10% giá hợp đồng), chỉ lấy từ phần của PT; gym không bị giữ.

| Sau buổi | PT rút được | Quỹ | Gym đã nhận | Nền tảng đã kiếm |
|---|---|---|---|---|
| 1 | 0 | 350.000 | 100.000 | 50.000 |
| 2 | 200.000 | 500.000 | 200.000 | 100.000 |
| 3 | 550.000 | 500.000 | 300.000 | 150.000 |
| 4 | 900.000 | 500.000 | 400.000 | 200.000 |
| 5 | 1.250.000 | 500.000 | 500.000 | 250.000 |
| 6 | 1.600.000 | 500.000 | 600.000 | 300.000 |
| 7 | 1.950.000 | 500.000 | 700.000 | 350.000 |
| 8 | 2.300.000 | 500.000 | 800.000 | 400.000 |
| 9 | 2.650.000 | 500.000 | 900.000 | 450.000 |
| 10 | 3.000.000 | 500.000 | 1.000.000 | 500.000 |
| Hoàn tất | 3.500.000 | 0 | 1.000.000 | 500.000 |

Quỹ hình thành ở buổi 1 (350.000) và buổi 2 (150.000, trả 200.000); đền 200.000 sau buổi 4: trần vẫn 300.000, quỹ còn 300.000, PT cuối 3.300.000, khách 200.000, gym 1.000.000, nền tảng 500.000 (Σ = 5.000.000). Các câu 1–10 và hai cách M0/M1 không đổi ý nghĩa; chỉ con số PT rút được nhỏ hơn vì PT chỉ có 70%. Lưu ý: nếu phần PT của một hợp đồng nhỏ hơn quỹ mục tiêu (PT nhận ít), quỹ chỉ giữ tối đa bằng tổng tiền PT kiếm được.
