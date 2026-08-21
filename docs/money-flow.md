# Dòng tiền — hợp đồng PT, gói hội viên, ví hai ngăn

Tài liệu này mô tả **toàn bộ cách tiền di chuyển** trong hệ thống. Đây là phần khó nhất và
dễ sai nhất của dự án — sai một đồng ở đây là sai tiền thật của người dùng. Ai sắp sửa code
liên quan tới ví, hợp đồng, hoàn tiền hay hoa hồng thì **đọc hết file này trước**.

| | |
|---|---|
| Công thức thuần tuý | `backend/services/payment-service/src/services/contract-money.ts` |
| Ghi sổ | `backend/services/payment-service/src/services/contract-ledger.service.ts` |
| Đối soát | `backend/services/payment-service/src/services/reconcile.service.ts` |
| Nối vào hợp đồng | `backend/services/user-service/src/services/contract-payout.service.ts` |
| Kiểm thử công thức | `payment-service/src/__tests__/contract-money.test.ts` (22 test) |
| Kiểm thử ghi sổ | `payment-service/src/__tests__/contract-ledger.integration.test.ts` (10 test) |

---

## 1. Vòng đời tiền của một hợp đồng

```
Khách bấm "Thanh toán" → chọn cổng (VNPay / ZaloPay / MoMo)
   └─> POST /internal/payments/checkout
        · Tạo PaymentTransaction, ĐÓNG BĂNG bảng tỷ lệ + các bên vào metadata
        · Trả redirectUrl → trình duyệt sang trang cổng
        · KHÔNG có đồng nào dịch chuyển ở bước này
        └─> Cổng gửi webhook có chữ ký (hoặc job đối soát chủ động hỏi lại)
             ├─> ESCROW              += P
             ├─> PT ngăn chờ         += ptRate × P
             ├─> Phòng gym ngăn chờ  += gymRate × P
             ├─> Nền tảng ngăn chờ   += platformRate × P
             └─> Gọi ngược user-service kích hoạt hợp đồng → ACTIVE

Mỗi buổi khách xác nhận hoàn thành (hoặc tự duyệt sau 3 ngày)
   └─> Với từng bên: ngăn CHỜ −= tỷ lệ × unit, ngăn KHẢ DỤNG += tỷ lệ × unit
        · ESCROW KHÔNG đổi — tiền vẫn đang giữ, chỉ là đã được phép rút
        · Ghi 2 bút toán cùng transactionId (nợ PENDING + có AVAILABLE)

PT vắng buổi
   ├─> Trừ ngăn chờ ba bên theo tỷ lệ, tổng = unit
   ├─> Ví khách += unit
   ├─> totalSessions −= 1        ← BẮT BUỘC, xem §5
   └─> ESCROW KHÔNG đổi

Chấm dứt hợp đồng (6 lý do, xem §4)
   ├─> Tính refund theo lý do
   ├─> Bù mỗi bên lên đúng "tỷ lệ × (P − refund)"
   ├─> Vét sạch ngăn chờ của hợp đồng về 0
   ├─> Ví khách += refund
   └─> ESCROW KHÔNG đổi

Rút tiền (VĐ1, CHƯA LÀM)
   └─> Chỉ rút từ ngăn khả dụng, quản trị viên duyệt và chuyển khoản THỦ CÔNG
        └─> Ngăn khả dụng −= X  VÀ  ESCROW −= X   ← lúc này tiền mới thật sự rời hệ thống
```

**Nguyên tắc vàng: ESCROW chỉ đổi khi tiền thật vào hoặc ra khỏi nền tảng.** Mọi thao tác
khác chỉ là chuyển *quyền đòi* giữa các ngăn trên cùng số tiền đang giữ. Chính vì vậy bất
biến ở §6 sống sót qua mọi thao tác.

---

## 2. Bảng ký hiệu

| Ký hiệu | Ý nghĩa | Ghi chú |
|---|---|---|
| `P` | `contract.price` — tổng giá trị hợp đồng | `Decimal(14,2)` |
| `N` | `contract.totalSessions` | Có thể **giảm** khi PT vắng buổi |
| `u` | Số buổi tính là đã dùng | Xem §3 |
| `unit` | `P / N` — giá trị một buổi | **Không làm tròn ở bước trung gian** |
| `remaining` | `P × (N − u) / N` — giá trị phần chưa dùng | Luôn ≥ 0 |
| `platformRate` | Phần nền tảng | ≥ 0.10, ảnh chụp lúc ký |
| `ptRate` | Phần PT | ảnh chụp lúc ký |
| `gymRate` | Phần phòng gym | = 0 nếu ONLINE hoặc không gắn gym |

Ràng buộc kiểm ở máy chủ, **so sánh tuyệt đối bằng `Decimal`, không có sai số cho phép**:

```
platformRate + ptRate + gymRate = 1     ← lệch 0.0001 vẫn bị từ chối
platformRate >= 0.10
mọi tỷ lệ >= 0
```

---

## 3. Quy tắc đếm `u`

| Trạng thái buổi | Tính là đã dùng? | Vì sao |
|---|---|---|
| `COMPLETED` | ✅ | Buổi đã diễn ra |
| `NO_SHOW` do **khách** vắng | ✅ | Khách bỏ buổi thì mất buổi |
| `NO_SHOW` do **PT** vắng | ❌ | Lỗi PT — khách được bồi thường, xem §5 |
| `PENDING_CLIENT_CONFIRMATION` | ❌ | Chưa ai xác nhận |
| `DISPUTED` | ❌ | Đang tranh chấp |
| `REQUESTED`, `CONFIRMED`, `CANCELLED` | ❌ | Chưa diễn ra |

Cài đặt: `countsAsUsed()` trong `contract-money.ts`.

---

## 4. Công thức theo lý do chấm dứt

| Lý do | `refund` cho khách | Phạt thêm | Ai được khai |
|---|---|---|---|
| `CLIENT_CANCELLED` | `0,90 × remaining` | không | khách, admin |
| `PT_BANNED` | `remaining` (100%) | không | **chỉ admin** |
| `PT_CANCELLED` | `remaining` (100%) | `0,10 × remaining` trừ phía PT | PT, admin |
| `MUTUAL` | `remaining` (100%) | không | **chỉ admin** |
| `EXPIRED` | `0` | không | **chỉ admin** |
| `COMPLETED` | `0` | không | **chỉ admin** |

Kiểm quyền ở `contract.controller.ts#terminate`. Lý do quyết định ai chịu thiệt nên **không
bao giờ tin giá trị người gọi gửi lên**: để PT tự khai `MUTUAL` là mở đường cho họ né phí huỷ.

### Công thức tổng quát — một đường đi cho cả 6 lý do

```
quyền lợi cuối cùng của mỗi bên = tỷ lệ_của_bên_đó × (P − refund)
```

Thực hiện: tính `refund` → bù mỗi bên từ ngăn chờ lên đúng quyền lợi cuối (trừ đi phần đã
giải phóng theo buổi) → vét ngăn chờ về 0 → phần dư chính là tiền hoàn cho khách.

### ⚠️ Vì sao phạt trên `remaining` chứ không trên `P`

Đây là **lỗi đã tránh được**, và là lý do tồn tại của cả công thức.

Nếu phạt cố định 10% **tổng giá trị hợp đồng**, thì mọi hợp đồng **trên 10 buổi** sẽ cho
hoàn tiền **âm** khi khách huỷ ở giai đoạn cuối:

> Hợp đồng **20 buổi, 2.000.000đ**. Khách tập 19 buổi rồi huỷ.
> Giữ lại = giá trị đã dùng + phạt = `1.900.000 + 200.000` = **2.100.000đ**
> — **nhiều hơn cả số tiền khách từng trả.** Hoàn tiền = −100.000đ.

Phạt trên `remaining` cho kết quả luôn nằm trong `[0, remaining]` với mọi `N`:
`refund = 0,9 × 100.000 = 90.000đ`. Có một test ghim chặt cái bẫy này lại
(`a flat fee on the whole contract would have gone negative`) để không ai vô tình quay lại
thiết kế cũ.

---

## 5. PT vắng buổi

```
compensation  = unit                        ← khách nhận đúng giá trị một buổi
PT bị trừ     = ptRate × unit
Gym bị trừ    = gymRate × unit
Nền tảng trừ  = platformRate × unit         ← không được giữ hoa hồng của buổi không diễn ra
```

**Bắt buộc giảm `totalSessions` đi 1.** Không giảm thì khách vừa cầm tiền của buổi đó, vừa
còn quyền đặt lại buổi đó — tức được trả **hai lần**. Ghi chú tự động vào `contract.notes`.

Buổi này **không** tính vào `u`.

---

## 6. Hai ngăn ví, hai ví hệ thống, và bất biến

### Hai ngăn

| Ngăn | Ý nghĩa |
|---|---|
| `pendingBalance` | Tiền đã thuộc về chủ ví nhưng **chưa được rút** — còn gắn với buổi chưa diễn ra |
| `availableBalance` | Tiền **được phép rút** |

`WalletLedgerEntry.bucket` cho biết bút toán động vào ngăn nào; `balanceBefore`/`balanceAfter`
tính theo đúng ngăn đó, nên **mỗi ngăn có một chuỗi số dư liên tục không đứt** — kiểm toán được.

### Hai ví hệ thống

Cùng `ownerType = PLATFORM`, phân biệt bằng `ownerId`:

| Ví | `ownerId` | Ý nghĩa |
|---|---|---|
| Tiền giữ hộ | `ESCROW` | Mọi đồng đã nhận qua cổng và chưa chi ra |
| Doanh thu | `REVENUE` | Hoa hồng nền tảng đã thực sự hưởng |

Trước đây chỉ có một ví lẫn lộn cả hai, và khi nhiều hợp đồng chạy song song thì **số dư đó
không diễn giải được** — không trả lời được câu "trong này bao nhiêu là của người khác".

### Bất biến

```
ESCROW.available = Σ (pending + available) của MỌI ví không phải ESCROW
                   (khách + PT + gym + REVENUE)
```

ESCROW là *tiền mặt đang giữ*; mọi ví khác là *quyền đòi* trên số tiền đó. Quyền đòi phải
bằng tiền giữ. Lệch một đồng nghĩa là tiền đã được tạo ra hoặc biến mất ở đâu đó, và **sổ
sách không còn đáng tin**.

> **📌 Khác với đề bài.** Tài liệu yêu cầu ban đầu chỉ liệt kê ví PT/GYM và ví khách ở vế
> phải. Công thức đó **không thể đúng**: bước thanh toán cộng `platformRate × P` vào ngăn chờ
> của nền tảng từ chính số `P` đã cộng vào ESCROW, nên bỏ quyền đòi của nền tảng ra sẽ để lại
> khoản thiếu hụt vĩnh viễn **đúng bằng tiền hoa hồng**. Bản cài đặt tính cả `REVENUE`, và nó
> ở lại trong tổng cho tới khi có lệnh chi thật — y như PT rút tiền.

**Cách chạy đối soát:**

```bash
# API (cần token ADMIN) — trả 409 nếu lệch
GET /admin/payments/reconciliation

# Trong kiểm thử, sau mỗi bước
await assertInvariant('mô tả bước');
```

Báo cáo gồm `escrow`, `claims`, `drift`, `balanced`, chi tiết từng nhóm ví, và
`negativeWallets` — danh sách này **luôn phải rỗng**.

---

## 7. Quy tắc làm tròn

1. Tính bằng `Decimal`, **không làm tròn ở bước trung gian**. (`Decimal` mặc định 20 chữ số
   có nghĩa; số tiền lớn nhất hệ thống chứa được là `Decimal(14,2)` = 16 chữ số, nên phép chia
   luôn chính xác dưới mức một đồng.)
2. Khi ghi vào CSDL: **PT và phòng gym làm tròn XUỐNG** tới đồng.
3. **Phần dư đưa hết về doanh thu nền tảng.** Phải có người nhận phần lẻ — nếu cả ba cùng làm
   tròn độc lập thì tổng không khớp, và khoản chênh sẽ phải lấy từ ESCROW, tức **tiền của
   người khác**. Nền tảng là bên duy nhất bị thiệt mà không oan ai.
4. Hoàn tiền cho khách: **làm tròn LÊN** cho khách, phần chênh trừ vào doanh thu nền tảng.

Sau mỗi phép chia, `splitThreeWays()` **tự khẳng định `tổng các phần = số gốc`** và ném lỗi
nếu lệch — không bao giờ âm thầm bỏ qua. Có test quét 800 tổ hợp số lẻ để chứng minh.

---

## 8. Ngăn chờ không đủ tiền (§3.9 đề bài)

Xảy ra khi PT vắng quá nhiều buổi. Thứ tự xử lý:

1. Trừ **ngăn chờ** trước.
2. Hết ngăn chờ thì trừ tiếp **ngăn khả dụng** — buổi không diễn ra thì không phải tiền đã
   kiếm được, đòi lại là hợp lý chứ không phải trừng phạt.
3. Còn thiếu bao nhiêu: **nền tảng ứng ra từ ví REVENUE** và tạo bản ghi `PartnerReceivable`
   ghi nợ bên đó.
4. REVENUE cũng không đủ → **từ chối toàn bộ thao tác** và ném lỗi.

**Khách luôn được nhận đủ.** Để ví âm, hoặc cộng cho khách khoản tiền không ai tài trợ, đều
làm vỡ bất biến — mà bất biến vỡ thì người đi kiểm toán không phân biệt được với ăn cắp.

`PartnerReceivable` có cột `recovered` để trừ dần vào các lần ghi có sau của PT.
**Việc trừ tự động đó CHƯA cài** — xem §11.

---

## 9. Bảy kịch bản nghiệm thu

Chạy (**phải chạy riêng file này**, xem ghi chú trong file test):

```bash
cd backend/services/payment-service
DATABASE_URL="postgresql://gymcoach:gymcoach_password@localhost:5433/gymcoach_payment_test" \
  npx tsx --test src/__tests__/contract-ledger.integration.test.ts
```

| Kịch bản | Điều kiện | Kết quả phải đúng |
|---|---|---|
| **A** | 1.000.000đ / 10 buổi / 90-10 | Sau trả: ESCROW 1.000.000, PT chờ 900.000, NT chờ 100.000, PT khả dụng 0.<br>Sau 3 buổi: PT khả dụng **270.000**, chờ **630.000**.<br>Sau 10 buổi: PT khả dụng **900.000**, chờ **0**, doanh thu NT **100.000** |
| **B** | Như A, khách huỷ sau 2 buổi | Khách **720.000** · PT **252.000** · NT **28.000** · ngăn chờ 0 · tổng = 1.000.000 |
| **C** | Như A, PT vắng 1 buổi | Khách **100.000** · PT chờ 900.000→**810.000** · NT chờ 100.000→**90.000** · `totalSessions` còn 9 |
| **D** | 2.000.000đ / **20 buổi** / tập 19 rồi huỷ | Hoàn **90.000**, **không âm**, không ví nào âm |
| **E** | 1.000.000đ / 10 buổi / **55-35-10**, huỷ sau 2 buổi | Khách 720.000 · PT **154.000** · Gym **98.000** · NT **28.000** · tổng = 1.000.000 |
| **F** | 1.000.000đ / **3 buổi** / 55-35-10, huỷ sau 1 buổi | Tổng khớp 1.000.000 **không lệch một đồng**; phần dư nằm ở doanh thu NT |
| **G** | Chạy liên tiếp 5 kịch bản trên **cùng một CSDL** | Bất biến §6 đúng **sau mỗi bước**, `drift = 0.00` |

Ngoài ra: webhook gửi 2 lần liên tiếp và 2 lần đồng thời đều chỉ phân bổ một lần; PT cạn
ngăn chờ vẫn hoàn đủ cho khách.

---

## 10. Hằng số cấu hình

| Biến môi trường | Mặc định | Ý nghĩa |
|---|---|---|
| `CONTRACT_CLIENT_CANCEL_REFUND_RATE` | `0.90` | Phần khách nhận lại khi tự huỷ |
| `MIN_PLATFORM_RATE` | `0.10` | Sàn hoa hồng nền tảng — hợp đồng dưới mức này bị từ chối |
| `PLATFORM_COMMISSION_RATE` | `0.10` | Hoa hồng nền tảng cho gói hội viên gym |
| `GYM_MEMBERSHIP_REFERRAL_RATE` | `0.10` | Hoa hồng PT giới thiệu hội viên (xem §13.5–13.6) |
| `MAX_COLLABORATION_ROUNDS` | `5` | Số vòng thương thảo tối đa (§14.1) |
| `COLLABORATION_OFFER_TTL_DAYS` | `7` | Số ngày một đề xuất cộng tác còn hiệu lực (§14.1) |
| `PAYMENT_PROVIDER` | `VNPAY` | Cổng dự phòng khi yêu cầu không nêu rõ |
| `SESSION_AUTO_CONFIRM_DAYS` | `3` | Số ngày trước khi buổi tập tự duyệt |

---

## 11. Những gì CHƯA làm

Liệt kê thẳng để không ai tưởng đã xong:

- **Chi trả tự động ra ngân hàng.** Cố ý không làm — cổng đang chạy môi trường thử nghiệm,
  mọi lệnh chi ra ngoài là thao tác **thủ công** do quản trị viên xác nhận.
- **Rút tiền (VĐ1).** Model `WithdrawalRequest` và luồng duyệt chưa có. Ngăn khả dụng hiện
  chỉ tăng, chưa có đường ra.
- **Trừ tự động `PartnerReceivable`.** Bản ghi công nợ được tạo và ghi log cảnh báo, nhưng
  chưa tự trừ vào các lần ghi có sau của PT. Hiện phải xử lý tay.
- **Ký kết điện tử cho hợp đồng cộng tác.**
- **Giao diện hiển thị hai ngăn ví.** API `/me/wallet` đã trả cả hai, trang ví chưa vẽ.
- **Giải phóng tiền gói hội viên theo ngày.** Hiện giữ toàn bộ tới khi gói kết thúc — xem §13
  để biết vì sao và vì sao cách đó không thực tế lâu dài.

---

## 13. Gói hội viên: huỷ, hoàn tiền, và giải phóng ngăn chờ

### 13.1 Chính sách huỷ và hoàn tiền

| Ai khởi xướng | Được làm gì | Tiền |
|---|---|---|
| **Khách hàng** | Huỷ gói bất cứ lúc nào | **Không hoàn tiền.** Phần chưa dùng bị mất |
| **Quản trị viên** | Hoàn tiền, chỉ trong tình huống ngoại lệ | Hoàn theo tỉ lệ số ngày còn lại |

**Ba tình huống duy nhất được hoàn tiền:**

1. Phòng tập **vi phạm và bị khoá**
2. Phòng tập **ngừng hoạt động / đóng cửa** khi khách còn hạn
3. **Lỗi giao dịch** — thanh toán thành công nhưng kích hoạt thất bại vĩnh viễn, hoặc giao
   dịch sai cần huỷ

Cài đặt: `membershipService.cancelByClient` (chỉ đổi trạng thái, **không chuyển một đồng nào**
cho khách) và `membershipService.refundByAdmin` (bắt buộc nhập lý do thuộc ba tình huống trên).
Tuyến hoàn tiền **đã bỏ khỏi phía khách**, chuyển sang nhóm tuyến quản trị viên.

Giao diện **phải nói rõ trước khi khách xác nhận huỷ**: *"Bạn sẽ không được hoàn lại số tiền
của phần thời gian chưa sử dụng."* Không được để khách bấm huỷ mà tưởng sẽ có tiền về ví.

### 13.2 Vì sao khách tự huỷ thì KHÔNG thu hồi hoa hồng giới thiệu

Thu hồi hoa hồng **chỉ chạy khi quản trị viên hoàn tiền**. Khách tự huỷ thì PT **giữ trọn**
hoa hồng: gói đã được bán và kích hoạt hợp lệ, việc khách bỏ ngang **không phải lỗi của PT**.
Tuyệt đối không nối thu hồi vào luồng khách tự huỷ.

### 13.3 Ba tình huống kích hoạt giải phóng ngăn chờ

| Tình huống | Giải phóng bao nhiêu |
|---|---|
| Gói **hết hạn tự nhiên** | Toàn bộ phần còn lại trong ngăn chờ |
| **Khách tự huỷ** (không hoàn tiền) | **Toàn bộ** phần còn lại, giải phóng **ngay**, không đợi ngày hết hạn — gói đã chấm dứt, không còn khả năng phát sinh hoàn tiền |
| **Quản trị viên hoàn tiền** | Hoàn cho khách trước, phần còn lại quy thuộc gói đó mới được giải phóng |

Hai ràng buộc áp dụng cho **cả ba** tình huống:

- **Release gồm BA phần**: phòng gym, nền tảng, và **hoa hồng giới thiệu của PT chưa bị thu
  hồi**. Sót phần thứ ba thì hoa hồng của PT **kẹt trong ngăn chờ vĩnh viễn** — gói hết hạn,
  gym và nền tảng rút được tiền, PT thì không.
- **Release đúng bằng phần ngăn chờ CÒN LẠI quy thuộc gói đó**, đọc từ các bút toán đã ghi cho
  `transactionId` ấy — **không tính lại từ `rate × P`**. Ở kịch bản hoàn tiền, một phần tiền đã
  rời ngăn chờ để trả cho khách; tính lại từ giá gốc sẽ **giải phóng thừa** và phá bất biến §6.

**Ràng buộc trạng thái:** `membership-release` **chỉ được chạy khi gói đã huỷ hoặc đã hết
hạn**. Còn hiệu lực thì còn khả năng phát sinh hoàn tiền, nên release lúc đó là sai. Kiểm tra
ngay đầu endpoint, trả lỗi rõ ràng nếu bị gọi sai lúc.

### 13.4 Vì sao giữ tiền trong ngăn chờ tới khi gói kết thúc

Phòng tập có thể **rút tiền rồi mới vi phạm hoặc đóng cửa** — lúc đó không còn nguồn nào để
hoàn cho khách. Giữ trong ngăn chờ bảo đảm tình huống hoàn tiền ngoại lệ **hầu như luôn có đủ
nguồn**. Nếu vẫn không đủ, dùng `PartnerReceivable` ghi nợ phòng gym; **khách vẫn nhận đủ**.

> ⚠️ **Đây là đánh đổi có chủ đích, không phải thiết kế cuối cùng.** Phòng gym bán gói 12 tháng
> phải chờ hết 12 tháng mới rút được tiền — **không thực tế trong vận hành thương mại**. Phương
> án vận hành thật nên **giải phóng dần theo ngày**: số tiền tối đa có thể phải hoàn tại mọi
> thời điểm là `giá × số ngày còn lại / tổng số ngày`, nên phần ứng với những ngày đã trôi qua
> giải phóng ra là **an toàn tuyệt đối**. Chưa làm.

### 13.5 Điều kiện hợp lệ của mã giới thiệu

Mã của PT **chỉ dùng được khi PT đó có cộng tác `ACCEPTED` với đúng phòng gym đang bán gói**,
và **chỉ cho gói hội viên đầu tiên** của khách tại phòng gym đó. Mã sai, PT không cộng tác, hay
khách đã từng là hội viên ở đây — cả ba đều **từ chối kèm thông báo riêng**, không im lặng bỏ qua.

Ba lý do:

1. Hoa hồng trừ vào phần của phòng gym. Không giới hạn thì PT có thể phát tán mã công khai và
   ăn hoa hồng ở **mọi** phòng gym trên nền tảng, kể cả nơi chưa từng có quan hệ. **Bên trả
   tiền phải là bên có quyền đồng ý.**
2. Ràng buộc này tự nó chặn lạm dụng → **không cần** giới hạn số lần dùng, hạn dùng mã, hay cơ
   chế phát hiện gian lận.
3. Nó biến cộng tác thành **cánh cổng duy nhất** cho mọi dòng tiền giữa PT và phòng gym.

Guard "gói đầu tiên" là để PT không đưa mã cho những người **vốn đã sắp gia hạn** — không giới
thiệu gì mà vẫn hưởng hoa hồng.

### 13.6 Cơ sở tính hoa hồng giới thiệu: giá GỘP của gói

Gói 1.000.000đ, nền tảng thu 10% → nền tảng 100.000, phòng gym 900.000.

| Cơ sở tính | Phép tính | PT nhận | Phòng gym còn lại |
|---|---|---|---|
| **Giá gộp (đang dùng)** | 10% × 1.000.000 | 100.000 | 800.000 |
| Phần của phòng gym | 10% × 900.000 | 90.000 | 810.000 |

Khác biệt nhỏ khi tỷ lệ nền tảng là 10%, nhưng **lộ ra khi tỷ lệ đó đổi**: nền tảng thu 30% thì
phòng gym chỉ còn 700.000, hoa hồng 100.000 tính theo giá gộp tương đương **14,3%** doanh thu
thật của phòng gym thay vì 10%. Chọn giá gộp vì dễ giải thích cho người dùng — *"PT nhận 10%
giá trị gói"* — và tỷ lệ nền tảng cho gói hội viên đang cố định.

### 13.7 Cảnh báo khi đăng ký nhiều phòng gym

**Cảnh báo, không chặn.** Khách có quyền là hội viên nhiều phòng tập cùng lúc. Khi khách mua
gói mà đang có ít nhất một gói còn hiệu lực ở phòng tập **khác**, hiện hộp thoại liệt kê tên
từng phòng tập và ngày hết hạn, kèm câu hỏi xác nhận.

Cột `GymMembershipContract.multiGymWarned` ghi lại bằng chứng đã cảnh báo, dùng khi có tranh
chấp kiểu *"tôi không biết mình đang còn gói ở chỗ khác"*.

Không ảnh hưởng check-in: bản ghi check-in vốn gắn với một gói cụ thể.

---

## 14. Cộng tác PT ↔ phòng gym

PT liên kết phòng gym được check-in miễn phí; đổi lại phòng gym hưởng một phần hoa hồng từ
hợp đồng PT ký với khách **tại phòng gym đó**.

### 14.1 Luồng thương thảo

`PENDING → COUNTERED → ACCEPTED / REJECTED / EXPIRED / TERMINATED`

- Mỗi lần đề xuất lại **ghi đè tỷ lệ đang có và đảo `proposedBy`**, nên "lượt của ai" không
  bao giờ mơ hồ. Bên vừa đề xuất **không tự accept được đề xuất của chính mình** — nếu không
  họ có thể ràng buộc bên kia vào điều khoản chưa từng được đồng ý.
- Tối đa `MAX_COLLABORATION_ROUNDS` vòng (mặc định 5), quá thì tự chuyển `EXPIRED`.
- Mỗi đề xuất sống `COLLABORATION_OFFER_TTL_DAYS` ngày (mặc định 7) tính từ lần đề xuất gần nhất.
- Mỗi cặp (gym, PT) chỉ có **tối đa một** bản ghi `ACCEPTED` tại một thời điểm.
- Chấm dứt cộng tác: **hợp đồng đang chạy giữ nguyên tỷ lệ cũ**, chỉ hợp đồng mới không còn áp
  dụng — vì tỷ lệ là ảnh chụp trên hợp đồng, không phải tra cứu vào bảng này (xem §12).

### 14.2 Bảng đường dẫn đầy đủ

`gym-service/src/app.ts` mount `ownerRoutes` tại `/owner` và `ptRoutes` tại `/`, nên hai phía
có đường dẫn khác nhau dù cùng một controller — `actor` suy ra từ route, **không nhận từ thân
yêu cầu** (nhận từ body là để người gọi tự nhận mình là bên kia).

| Bên | Đường dẫn thật |
|---|---|
| PT đề xuất | `POST /gyms/:gymId/collaborations` |
| PT phản hồi (accept/reject/counter) | `PATCH /collaborations/:id` |
| PT chấm dứt | `DELETE /collaborations/:id` |
| **Chủ gym mời PT** | `POST /owner/gyms/:gymId/collaborations` |
| **Chủ gym phản hồi** | `PATCH /owner/collaborations/:id` |
| **Chủ gym chấm dứt** | `DELETE /owner/collaborations/:id` |
| Danh sách của PT | `GET /me/collaborations` |
| Danh sách của chủ gym | `GET /owner/collaborations` |
| Gym mà PT có cộng tác (công khai) | `GET /pt/:ptUserId/gyms` |
| Nội bộ — user-service lấy tỷ lệ | `GET /internal/collaborations/active?gymId=&ptUserId=` |

⚠️ Gateway khai `/gyms` bằng `router.get` tường minh, nên **POST không tự đi qua** — cả hai
tuyến `/gyms/:gymId/collaborations` và `/owner/...` đều phải khai riêng ở
`backend/gateway/src/routes/proxy.routes.ts`.

### 14.3 Lấy tỷ lệ khi tạo hợp đồng — phải phân biệt 400 với 503

| Tình huống | Phản hồi |
|---|---|
| Không gửi `gymId` | 90/10/0, `source = INDEPENDENT` |
| Có `gymId`, gọi được, **có** cộng tác `ACCEPTED` | Sao chép ba tỷ lệ, `source = GYM` |
| Có `gymId`, gọi được, **không** có cộng tác | **400** — chưa có thoả thuận cộng tác |
| Có `gymId`, **gọi không được** (timeout / gym-service chết) | **503**, log mức `error`, **không tạo hợp đồng** |
| Có `gymId` nhưng `sessionMode = ONLINE` | **400** báo lỗi tường minh |

**Tuyệt đối không** rơi về tỷ lệ độc lập ở hai dòng cuối. Bắt lỗi chung rồi coi như "không có
cộng tác" sẽ khiến phòng gym **mất phần chia một cách âm thầm** — loại lỗi khó phát hiện nhất
vì hệ thống vẫn chạy bình thường, chỉ sai tiền. Timeout đặt 3 giây vì chưa có circuit breaker.

Dòng cuối cũng không im lặng: khách tưởng đã chọn phòng gym mà thực tế không, và tỷ lệ chia
khác hẳn thứ họ nhìn thấy lúc đặt.

---

## 15. Quyết định phát sinh

Ghi lại những quyết định khác với tài liệu yêu cầu ban đầu, kèm lý do — **không sửa lặng lẽ**.

**Thu hồi hoa hồng ưu tiên cao hơn yêu cầu rút tiền đang chờ.** Nếu số dư khả dụng sau khi thu
hồi không còn đủ cho một yêu cầu rút đang treo, phải giảm số tiền yêu cầu đó hoặc chuyển nó
sang trạng thái cần xem xét lại và báo PT. Không được để cả hai cùng trừ vào một khoản tiền.
**Chưa cài** — model `WithdrawalRequest` chưa tồn tại (VĐ1). Hàm thu hồi được viết sao cho chèn
được bước kiểm tra này khi model ra đời, không phải sửa lõi. Ca kiểm thử tương ứng **hoãn tới
VĐ1**, không giả vờ đã phủ.

**Bất biến đối soát khác đề bài** — xem ghi chú ở §6.

---

## 12. Các quyết định thiết kế và lý do

**Vì sao giải phóng tiền theo từng buổi thay vì đợi hết hợp đồng.**
Cách này khiến **ngăn chờ luôn đúng bằng giá trị các buổi chưa dùng** — mà đó chính là nguồn
tiền việc hoàn tiền cần lấy. Hai cơ chế khớp nhau tự nhiên, không cần sổ sách phụ. Ngoài ra
PT nhận tiền dần thay vì chờ tới cuối, thực tế hơn với hợp đồng dài.

**Vì sao tỷ lệ khoá tại thời điểm ký thay vì đọc động.**
Ba tỷ lệ được đóng băng vào `Contract` **và** vào `metadata` của giao dịch lúc checkout. Lý do:
webhook có thể về sau vài phút, hoặc bị job đối soát phát lại sau vài ngày — nó phải chia theo
đúng điều khoản khách đã đồng ý khi bấm thanh toán, không phải theo tỷ lệ PT và phòng gym đã
thương lượng lại trong lúc đó. Nếu hai bên đổi tỷ lệ, hợp đồng cũ **không bị ảnh hưởng**.

**Vì sao giải phóng theo buổi là best-effort còn bồi thường thì ném lỗi.**
payment-service sập không được phép huỷ buổi khách đã xác nhận, vì buổi đó có thật; mà bỏ lỡ
cũng tự lành, bởi lúc chấm dứt hệ thống bù mỗi bên lên đúng `tỷ lệ × (P − refund)` bất kể đã
giải phóng bao nhiêu — PT chỉ nhận chậm chứ không mất. Bồi thường PT vắng thì ngược lại: ở đó
**khách đang bị nợ tiền**, nuốt lỗi là âm thầm quỵt của khách.

**Vì sao trả tiền theo buổi móc vào `deductQuotaOnce`.**
Trừ quota và trả tiền là hai mặt của **cùng một sự kiện** — "buổi này đã diễn ra". Gác cả hai
lên một lần compare-and-swap là thứ ngăn việc thử lại, hoặc job tự duyệt chạy đua với xác nhận
thủ công, trả cho PT **hai lần một buổi**.

**Vì sao công thức chỉ nằm ở payment-service.**
user-service sở hữu hợp đồng, payment-service sở hữu sổ cái. user-service **không tính một
con số tiền nào** — nó gửi bảng tỷ lệ đã đóng băng sang và ghi lại kết quả trả về. Nhờ vậy
trong toàn hệ thống chỉ có **một** bản cài đặt của các công thức, không có bản sao để lệch nhau.

**Vì sao `MOCK` bị xoá và `Contract.price` đổi sang `Decimal`.**
`MOCK` tự đánh dấu PAID không cần tiền và không kiểm chữ ký — nó là công cụ đúc tiền chỉ cách
môi trường thật một biến môi trường. `Float` thì không thể hứa "tổng ba phần bằng số gốc", mà
đó là điều kiện sống còn của mọi phép chia ở đây. Việc đổi kiểu chạy bằng `ALTER ... USING`
tường minh, **không** để `prisma db push --accept-data-loss` tự xử (nó có thể drop-and-recreate
cột và xoá sạch giá mọi hợp đồng). Đã kiểm chứng: 736 hợp đồng, 2.360.709.500đ trước và sau y nguyên.

**Vì sao danh sách cổng thanh toán do máy chủ quyết.**
Cổng nào dùng được phụ thuộc deployment có creds nào. Danh sách cứng trong giao diện sẽ bắt
đầu nói dối ngay khi có người thêm hoặc bỏ một cổng — mà mời người dùng chọn một cổng không
thể hoàn tất còn tệ hơn không mời, vì họ chỉ biết sau khi đã quyết định mua. Cổng chưa cấu
hình vẫn hiện nhưng mờ đi kèm lý do, thay vì bị giấu.
