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

Rút tiền (VĐ1 — đã xong, xem §16 để biết chi tiết đầy đủ)
   └─> requestWithdrawal: chỉ được yêu cầu rút từ ngăn KHẢ DỤNG
        └─> approve(): ngăn khả dụng −= X, ngăn KHOÁ (locked) += X   ← tiền thật đã bị giữ,
             không còn tính vào số dư có thể rút/clawback lần nữa, nhưng ESCROW CHƯA đổi
             └─> markPaid() (sau khi chuyển khoản THỦ CÔNG xong):
                  ngăn khoá −= X  VÀ  ESCROW −= X   ← lúc này tiền mới thật sự rời hệ thống
             └─> reject() (nếu đã approve rồi mới từ chối):
                  ngăn khoá −= X, ngăn khả dụng += X   ← hoàn lại, ESCROW không đổi
```

**Nguyên tắc vàng: ESCROW chỉ đổi khi tiền thật vào hoặc ra khỏi nền tảng.** Mọi thao tác
khác chỉ là chuyển *quyền đòi* giữa các ngăn trên cùng số tiền đang giữ. Chính vì vậy bất
biến ở §6 sống sót qua mọi thao tác.

---

## 2. Bảng ký hiệu

| Ký hiệu | Ý nghĩa | Ghi chú |
|---|---|---|
| `P` | `contract.price` — tổng giá trị hợp đồng | `Decimal(14,2)`, **bất biến** sau khi ký |
| `N` | `contract.totalSessions` | **Bất biến** sau khi ký — xem cảnh báo bên dưới |
| `u` | Số buổi tính là đã dùng | Xem §3 |

> ⚠️ **Đã đổi từ thiết kế cũ (plan 1.5).** Trước đây PT vắng buổi thì `totalSessions` bị trừ đi
> 1 — điều này khiến `unit = P/N` của MỌI buổi sau đó trôi giá trị, và một hợp đồng 1 buổi bị
> PT vắng thì còn 0 buổi để trừ (khách vừa cầm tiền bồi thường, vừa còn quyền đặt lại buổi đó
> — nhận **hai lần**). `totalSessions` và `price` giờ **bất biến tuyệt đối** kể từ lúc ký; số
> buổi PT vắng được ghi vào một cột đếm riêng — xem mô hình quyền lợi §2.1.

### 2.1 Mô hình quyền lợi (entitlements) — plan 1.5

Ba trường trên `Contract`, không trường nào được tính lại từ trường khác:

| Trường | Ý nghĩa |
|---|---|
| `totalSessions` | Tổng số buổi đã mua — **bất biến**, đây chính là "purchasedSessions" |
| `usedSessions` | Số buổi khách đã thực sự tập, hoặc bị tính phí do huỷ trễ |
| `compensatedSessions` | Số buổi PT vắng mà khách đã được bồi thường bằng tiền mặt |

```
getRemainingEntitlements(contract) = max(0, totalSessions − usedSessions − compensatedSessions)
```

Cài đặt duy nhất tại `user-service/src/services/contract.service.ts#getRemainingEntitlements`.
**Mọi nơi cần biết "hợp đồng còn nợ bao nhiêu buổi" phải gọi hàm này** — cổng đặt lịch
(`booking.service.ts`), điều kiện tự hoàn tất hợp đồng, đều đi qua một chỗ, để một lần đổi mô
hình dữ liệu không phải sửa nhiều nơi khác nhau theo.
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

> **`EXPIRED` — "chỉ admin" là nói về ai được GỌI API, không phải ai KHỞI XƯỚNG (P0 cụm A3).**
> `contract.service.ts#expireContracts()` (một tiến trình nền, khuôn mẫu giống
> `reschedule-expiry.service.ts`, khởi động cùng `user-service` server) tự tìm các hợp đồng đã
> quá hạn và gọi thẳng `terminateContractMoney(contractId, "EXPIRED")` — không đi qua endpoint
> `terminate` công khai, nên không cần một "admin" thật bấm nút. **Trước cụm A3, hàm này chỉ
> đổi `status` sang `EXPIRED` mà KHÔNG hề đụng tới tiền** — ngăn chờ của hợp đồng hết hạn bị bỏ
> quên vĩnh viễn, không giải phóng cũng không hoàn. Mỗi hợp đồng được xử lý độc lập (bọc
> try/catch riêng), một hợp đồng lỗi không chặn các hợp đồng khác trong cùng lượt quét. Sweep
> **không** bọc `settleTracked` — cố ý, vì bản thân điều kiện quét lại (hợp đồng vẫn ở trạng
> thái coi như "chưa xử lý" tại lần quét sau) đã tự nhiên cho retry, không cần lớp theo dõi
> thêm.

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

**Bắt buộc tăng `compensatedSessions` lên 1 — KHÔNG giảm `totalSessions` (đổi từ plan 1.5, xem
§2.1).** Giảm `totalSessions` sẽ làm `unit = P/N` của mọi buổi sau đó trôi giá trị; tăng
`compensatedSessions` đạt đúng hiệu quả tương đương (một quyền lợi đã được "trả bằng tiền mặt
thay vì bằng buổi tập") mà không đụng tới con số mọi công thức khác đang chia cho.

Buổi này **không** tính vào `u` (usedSessions), nhưng **có** tính vào quyền lợi đã tiêu thụ —
xem `getRemainingEntitlements()` ở §2.1.

---

## 6. Ba ngăn ví, hai ví hệ thống, và bất biến

### Ba ngăn

| Ngăn | Ý nghĩa |
|---|---|
| `pendingBalance` | Tiền đã thuộc về chủ ví nhưng **chưa được rút** — còn gắn với buổi chưa diễn ra |
| `availableBalance` | Tiền **được phép rút**, chưa có yêu cầu rút nào đang xử lý trên nó |
| `lockedBalance` | **(P0 cụm F)** Tiền đã được duyệt rút (`withdrawal.approve`) nhưng **chưa chuyển khoản
xong** (`markPaid`) — tách khỏi `availableBalance` chính vì lý do này: một khoản thu hồi
(clawback) phát sinh SAU khi đã duyệt rút không được phép ăn vào tiền đang chờ chuyển khoản đó
(xem §16 và §12 "clawback không được đụng ngăn khoá"). |

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
ESCROW.available = Σ (pending + available + locked) của MỌI ví không phải ESCROW
                   (khách + PT + gym + REVENUE)
```

`lockedBalance` **phải** nằm trong tổng quyền đòi — tiền đã được duyệt rút (§16) vẫn chưa rời
hệ thống thật sự (chỉ `markPaid` mới trừ ESCROW), nên nó vẫn là quyền đòi hợp lệ trên tiền
đang giữ. Bỏ sót ngăn này khỏi công thức đối soát (lỗi thực tế đã xảy ra ở
`reconcile.service.ts` trước khi cụm F vá — xem §12) sẽ khiến `GET /admin/payments/reconciliation`
báo lệch giả ngay khi có một yêu cầu rút đang ở trạng thái đã duyệt.

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
| `PERSONALIZED_SERVICE_AUTO_ACCEPT_DAYS` | `3` | Số ngày trước khi bản nháp dịch vụ cá nhân hoá tự được chấp nhận thay khách (§19.4) |
| `GYM_MEMBERSHIP_PENDING_PAYMENT_STALE_MINUTES` | `10` | Đơn hội viên chờ thanh toán quá lâu (chưa từng trả tiền) tự huỷ sau bao nhiêu phút — cùng ngưỡng `NON_TOPUP_STALE_MINUTES` của payment-service |

---

## 11. Những gì CHƯA làm

Liệt kê thẳng để không ai tưởng đã xong:

- **Chi trả tự động ra ngân hàng.** Cố ý không làm — cổng đang chạy môi trường thử nghiệm,
  mọi lệnh chi ra ngoài là thao tác **thủ công** do quản trị viên xác nhận (§16 — luồng rút
  tiền tự nó ĐÃ xong, chỉ riêng bước "chuyển khoản thật" là vẫn thủ công, có chủ đích).
- ~~Trừ tự động `PartnerReceivable`~~ — **ĐÃ có từ trước** (`recoverReceivables` trong
  `contract-ledger.service.ts`), không phải khoảng trống. Mỗi lần ngăn khả dụng của một PT/gym
  đang nợ được ghi có (giải phóng buổi, giải phóng dịch vụ cá nhân hoá, giải phóng gói hội
  viên, chấm dứt hợp đồng...), hàm này tự trừ khoản nợ cũ nhất trước, giới hạn đúng bằng số
  tiền vừa ghi có — không bao giờ đụng số dư đã có từ trước. **Khoảng trống thật, hẹp hơn nhiều
  so với bản trước của tài liệu này mô tả:** một yêu cầu rút mới ở trạng thái `PENDING` (chưa
  `approve()`, nên vẫn còn nằm trong `availableBalance`) chưa được giữ chỗ — một khoản thu hồi
  xảy ra cùng lúc vẫn có thể ăn vào đúng số tiền yêu cầu rút đó đang trông cậy vào. Yêu cầu đã
  `approve()` thì AN TOÀN tự nhiên: cụm F đã chuyển số tiền đó sang ngăn `lockedBalance` riêng,
  ngoài tầm với của `recoverReceivables` (nó chỉ đọc `availableBalance` — xem §16). Quy tắc ưu
  tiên cho khoảng trống còn lại — thu hồi thắng yêu cầu rút đang `PENDING` — đã ghi ở §15.
- **Giao diện hiển thị đủ các ngăn ví cho PT/khách.** Trang ví PT và khách hiện chỉ vẽ
  `availableBalance` (giống trước), dù API đã trả cả `pendingBalance` và (từ cụm F)
  `lockedBalance`. Trang ví phòng gym (`GymManagePage`) đã vẽ `pending`+`available` từ trước,
  nhưng chưa vẽ `lockedBalance` — mọi loại ví đều có ngăn này (cột nằm trên chính model `Wallet`,
  không phân biệt theo `ownerType`), và chủ gym cũng rút tiền qua đúng luồng khoá ở §16
  (`POST/GET /owner/gyms/:gymId/withdrawals`), nên khoảng trống này áp dụng như nhau cho cả ba
  trang.
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

## 16. Rút tiền (VĐ1 — đã xong)

Luồng thủ công tối thiểu: khách/PT/gym gửi yêu cầu → quản trị viên duyệt (tuỳ chọn) → quản trị
viên **tự chuyển khoản bên ngoài hệ thống** → bấm "đã chi trả" kèm mã tham chiếu ngân hàng.
**Không có tích hợp API chi hộ nào** — cố ý, giống mọi chỗ khác trong tài liệu này.

| | |
|---|---|
| Model | `payment-service/prisma/schema.prisma` — `WithdrawalRequest`, enum `WithdrawalRequestStatus` |
| Service | `payment-service/src/services/withdrawal.service.ts` |
| Tự phục vụ (PT/khách) | `POST/GET /me/withdrawals` |
| Nội bộ (gym-service gọi sau khi tự xác minh chủ sở hữu) | `POST/GET /internal/withdrawals/gym/:gymId` |
| Chủ gym | `POST/GET /owner/gyms/:gymId/withdrawals` (gym-service, proxy sang payment-service) |
| Quản trị viên | `GET/POST /admin/payments/withdrawals`, `.../:id/approve`, `.../:id/reject`, `.../:id/mark-paid` |

**Trạng thái:** `PENDING → APPROVED (tuỳ chọn) → PAID`, hoặc `→ REJECTED` bất cứ lúc nào trước
`PAID`.

> **P0 cụm F — sửa lại nhận định cũ của mục này.** Bản trước ghi *"`markPaid` là nơi DUY NHẤT
> tiền thực sự dịch chuyển — request/approve/reject chỉ đổi trạng thái, không đụng sổ cái"*.
> Điều đó **sai** sau cụm F (ví đã có ngăn `lockedBalance` thứ ba — xem §6): `approve()` giờ
> thật sự chuyển tiền, `availableBalance → lockedBalance`, bằng `withWallets`/`applyDebit`/
> `applyCredit` như mọi thao tác khác — không còn là phép tính suy ra suông. Cụ thể:
>
> - **`approve()`**: `ops.debit(AVAILABLE)` + `ops.credit(LOCKED)` cùng khoản đúng bằng số tiền
>   yêu cầu, khoá `WITHDRAWAL_LOCK:<id>`. ESCROW không đổi (tiền chưa rời nền tảng).
> - **`reject()`**: nếu yêu cầu đang ở `APPROVED` (đã khoá) → đảo ngược, `LOCKED → AVAILABLE`,
>   khoá `WITHDRAWAL_UNLOCK:<id>`. Nếu còn `PENDING` (chưa từng khoá) → chỉ đổi trạng thái,
>   không có bút toán nào — không có gì để hoàn.
> - **`markPaid()`** vẫn là nơi DUY NHẤT tiền thực sự **rời khỏi nền tảng** (trừ ESCROW), nhưng
>   không còn là nơi duy nhất ví chủ sở hữu bị động tới. Nếu yêu cầu đang `PENDING` (bỏ qua nút
>   duyệt, đi thẳng sang chi trả — lối tắt cũ vẫn được giữ), nó tự khoá ngay trong cùng một
>   transaction trước khi trừ, để lại đúng dấu vết sổ sách như khi đi qua `approve()` trước.
>   Nếu đã `APPROVED` từ trước, chỉ cần trừ `LOCKED` + ESCROW.
>
> **Vì sao tách hẳn một ngăn `lockedBalance` thay vì chỉ tính suy ra từ tổng các yêu cầu đang mở
> (cách làm cũ):** mọi thao tác trừ tiền khác trong hệ thống (một khoản thu hồi `PartnerReceivable`,
> một khoản hoàn tiền admin, …) mặc định chỉ đụng `availableBalance` (xem `Bucket` type và tham
> số mặc định của `applyDebit` trong `wallet.service.ts`) — muốn đụng `lockedBalance` phải gọi
> tường minh, và **không nơi nào ngoài file `withdrawal.service.ts` làm vậy**. Nghĩa là: **một
> yêu cầu rút đã được duyệt (`APPROVED`) an toàn tuyệt đối trước mọi khoản thu hồi phát sinh
> sau đó** — về mặt cấu trúc, không phải vì có thêm một lớp kiểm tra thứ tự nào. Đây chính là
> điều bản kế hoạch cộng tác/giới thiệu (§14/§13, mục B3 ở đó) đã lường trước và để ngỏ.
>
> **Khoảng trống còn lại (đã ghi rõ ở §11 và §15):** một yêu cầu còn **`PENDING`** (chưa duyệt)
> không có sự bảo vệ này — nó vẫn nằm trong `availableBalance` thường, nên một khoản thu hồi
> đến đúng lúc đó vẫn có thể ăn vào đúng số tiền yêu cầu đang trông cậy. Quy tắc ưu tiên cho
> trường hợp này (thu hồi thắng, giảm/xem-lại yêu cầu rút) đã ghi ở §15 nhưng **chưa cài đặt**.

**Số tiền được phép rút** (kiểm tra ở `requestWithdrawal`, trước khi tạo yêu cầu):
- **PT / phòng gym:** `availableBalance − Σ(các yêu cầu đang PENDING)`. **Chỉ trừ `PENDING`,
  không cộng thêm `APPROVED`** (khác bản trước của tài liệu này) — một yêu cầu `APPROVED` đã
  thật sự rời `availableBalance` sang `lockedBalance` rồi, `availableBalance` đọc trực tiếp từ
  ví đã tự phản ánh đúng, cộng thêm lần nữa sẽ trừ trùng hai lần cho cùng một khoản.
- **Khách hàng:** chỉ được rút phần **có nguồn gốc hoàn trả/bồi thường** — nhận diện qua mô tả
  bút toán chứa `"refund"` hoặc `"compensation"` (không phân biệt hoa thường), trừ đi cả
  `PENDING` lẫn `APPROVED` (`sumOpenAmount`, giữ nguyên công thức cũ cho nhánh này — nó không
  suy ra được từ `availableBalance` như nhánh PT/gym, vì tiêu chí là theo mô tả bút toán chứ
  không phải theo ngăn ví). **Hạn chế đã biết:** không có cột "lý do" có cấu trúc trên
  `WalletLedgerEntry`; một mô tả tự do nào đó vô tình không chứa hai từ khoá này sẽ bị tính
  thiếu — **thiếu, không bao giờ thừa** (khách mất quyền rút, không bao giờ được rút tiền
  không phải của mình), nên đây là hướng lỗi an toàn nếu nó xảy ra.

**Mỗi lần `markPaid` tạo một `PaymentTransaction` riêng, `purpose = WITHDRAWAL`.**
`WalletLedgerEntry.transactionId` là FK thật tới `PaymentTransaction` — rút tiền không có giao
dịch gốc nào để tái dùng (khác REFUND, vốn tái dùng transactionId của giao dịch mua ban đầu),
nên cần một dòng riêng làm điểm neo FK và bằng chứng kiểm toán cho riêng lần chi trả đó.

> ⚠️ **Lỗi P0 bắt được bằng chính quy trình TDD của tài liệu này, ngay trong lúc code.**
> Bản đầu tiên của `markPaid` trừ đúng ví của PT/gym/khách nhưng **quên trừ ví ESCROW**.
> ESCROW đại diện "mọi đồng đã nhận qua cổng và chưa chi ra" (§6) — mọi thao tác KHÁC trong
> toàn hệ thống chỉ chuyển *quyền đòi* giữa các ngăn, nhưng rút tiền là thao tác ĐẦU TIÊN tiền
> thật sự **rời khỏi nền tảng**. Thiếu dòng trừ ESCROW khiến `GET /admin/payments/reconciliation`
> báo `drift` đúng bằng số tiền đã rút. Bắt được bằng một test gọi `assertInvariant()` sau
> `markPaid` — RED thật (đã verify bằng cách bỏ dòng sửa và chạy lại), sửa xong GREEN. Một dữ
> liệu lệch 100.000đ đã lỡ sinh ra trên CSDL dev trong lúc test sống trước khi vá kịp — đã sửa
> bằng đúng cơ chế ghi sổ (`withWallets`/`applyDebit`), không sửa tay số dư.

---

## 17. Idempotency key — danh sách đầy đủ

Mọi thao tác tiền không phải `PaymentTransaction` gốc (tức không tự nhiên có
`idempotencyKey` unique của riêng nó) đi qua `withIdempotentLedgerOp` (payment-service) hoặc
`settleTracked` (user-service/gym-service) với một khoá nghiệp vụ cố định. Gọi lại đúng khoá
này thay tiền bằng cách replay kết quả cũ, **không bao giờ chạy lại lần hai**.

| Khoá | Thao tác | Nơi cài |
|---|---|---|
| `SESSION_RELEASE:<sessionId>` | Giải phóng tiền một buổi từ ngăn chờ sang khả dụng | `contract-payout.service.ts` |
| `PT_NO_SHOW:<sessionId>` | Bồi thường khách khi PT vắng | `contract-payout.service.ts` |
| `CONTRACT_TERMINATE:<contractId>` | Chấm dứt hợp đồng PT (6 lý do, §4) | `contract-payout.service.ts`, `contract.service.ts` |
| `MEMBERSHIP_RELEASE:<membershipId>` | Giải phóng/thu hồi ngăn chờ gói hội viên (hết hạn, huỷ, hoàn tiền) | `gym-service/membership.service.ts`, `membershipPayout.sweep.ts` |
| `MEMBERSHIP_REFERRAL:<membershipId>` | Chuyển hoa hồng giới thiệu PT khi gói kích hoạt | `gym-service/membership.service.ts` |
| `REFERRAL_CLAWBACK:<membershipId>` | Thu hồi hoa hồng giới thiệu khi admin hoàn tiền | `gym-service/membership.service.ts` |
| `WITHDRAWAL:<withdrawalRequestId>` | `markPaid` — chi trả yêu cầu rút tiền (§16) | `payment-service/withdrawal.service.ts` |
| `WITHDRAWAL_LOCK:<withdrawalRequestId>` | **(P0 cụm F)** `approve()` — chuyển `AVAILABLE → LOCKED` (§16) | `payment-service/withdrawal.service.ts` |
| `WITHDRAWAL_UNLOCK:<withdrawalRequestId>` | **(P0 cụm F)** `reject()` sau khi đã `APPROVED` — hoàn `LOCKED → AVAILABLE` (§16) | `payment-service/withdrawal.service.ts` |
| `PERSONALIZED_RELEASE:<orderId>` | **(P0 cụm C)** Giải phóng ngăn chờ dịch vụ cá nhân hoá khi khách/hệ thống chấp nhận bản giao (§19) | `payment-service/personalized-service-ledger.service.ts` |
| `PERSONALIZED_REFUND:<orderId>:<refundAmount>` | **(P0 cụm C)** Hoàn tiền đơn dịch vụ cá nhân hoá — **có thêm số tiền vào khoá**, khác quy ước `<id>`-suông của các dòng trên, vì một đơn có thể được hoàn tiền hợp lệ **nhiều lần** (hoàn từng phần qua cơ chế trần hoàn tiền tối đa của admin) — dùng khoá `<orderId>` suông sẽ khiến lần hoàn thứ hai bị coi là replay của lần thứ nhất và không chạy | `payment-service/personalized-service-ledger.service.ts` |

`WITHDRAWAL:<id>` được dùng **hai lần cho hai mục đích khác nhau** trong `markPaid`: làm
`idempotencyKey` của `PaymentTransaction` mới (để một lần retry tái dùng đúng dòng thay vì tạo
dòng mồ côi thứ hai) **và** làm business key cho `withIdempotentLedgerOp` (để hai lệnh gọi
đồng thời chỉ một bên thắng debit — bên thua tìm thấy khoá đã bị chiếm và replay). Hai bộ ID
này tồn tại độc lập, cùng giá trị chuỗi chỉ là trùng hợp có chủ đích, không phải cùng một cơ
chế.

---

## 18. Thu hẹp phạm vi (Phase 5)

Ghi lại những gì bị **loại khỏi phạm vi có chủ đích**, để không ai tưởng đó là thiếu sót:

- **Vai trò `GYM_STAFF` đã bị xoá khỏi hệ thống** (enum, cả hai phía backend + frontend).
  Xác nhận 0 tài khoản đang giữ vai trò này trước khi xoá. Chủ gym (`GYM_OWNER`) là vai trò
  duy nhất quản lý một phòng gym.
- **Ký điện tử (e-sign) tạm dừng.** `REQUIRE_CONTRACT_ESIGN=false` — hợp đồng đi thẳng sang
  `PENDING_PAYMENT`, không qua bước ký. Route webhook Dropbox Sign bị gỡ đăng ký khỏi cả
  user-service lẫn gateway khi cờ này tắt (trước đó chỉ user-service tắt, gateway vẫn đăng ký
  route — hai phía không đồng bộ).
- **Chi trả vẫn hoàn toàn thủ công** — không có API chi hộ/chuyển khoản tự động nào được tích
  hợp, kể cả sau khi luồng rút tiền (§16) hoàn thành. Quản trị viên luôn là người bấm nút
  chuyển khoản thật, ngoài hệ thống.
- **Không có luồng đóng cửa hàng loạt cho phòng gym.** Một phòng gym bị khoá/đóng cửa được xử
  lý từng trường hợp qua `refundByAdmin` (§13.1) — không có thao tác "đóng toàn bộ phòng gym,
  hoàn tiền mọi hội viên cùng lúc".
- **Endpoint quyết toán hoa hồng cũ đã nghỉ hưu.** `PATCH /admin/payments/commissions/:id/settle`
  chưa từng có logic thật (luôn 501) và không có caller nào — trả về `410 ENDPOINT_RETIRED`,
  trỏ sang luồng rút tiền (§16) là con đường thật để lấy hoa hồng ra khỏi ví.
- **P0 cụm D (marketplace hard-delete) bị bỏ qua có chủ đích, theo lệnh trực tiếp của người
  dùng** — không phải thiếu sót hay bỏ quên. Cụm D đặt ra để sửa một lỗi trong luồng xoá cứng
  (hard-delete) sản phẩm marketplace, nhưng marketplace là phần thuộc quyền của đối tác
  ("đó là phần của partner của ta"), và người dùng yêu cầu dừng hẳn, không sửa logic
  marketplace nữa, chỉ tập trung vào thanh toán. Không có file marketplace nào bị **sửa**
  trong cả đợt P0 này (có đọc/grep để xác định phạm vi, nhưng dừng ngay khi phát hiện đây là
  logic marketplace, trước khi viết bất kỳ dòng sửa nào). Lỗi gốc của cụm D **vẫn còn tồn tại
  trong code**, chưa được vá.

---

## 15. Quyết định phát sinh

Ghi lại những quyết định khác với tài liệu yêu cầu ban đầu, kèm lý do — **không sửa lặng lẽ**.

**Thu hồi hoa hồng ưu tiên cao hơn yêu cầu rút tiền đang chờ.** Nếu số dư khả dụng sau khi thu
hồi không còn đủ cho một yêu cầu rút đang treo, phải giảm số tiền yêu cầu đó hoặc chuyển nó
sang trạng thái cần xem xét lại và báo PT. Không được để cả hai cùng trừ vào một khoản tiền.
Model `WithdrawalRequest` **giờ đã tồn tại** (§16), nhưng bước tự động này (thu hồi tự tìm và
điều chỉnh một yêu cầu rút đang treo) **vẫn chưa cài** — vẫn phải xử lý tay khi tình huống này
xảy ra. Ca kiểm thử tương ứng vẫn hoãn.

**`totalSessions` giữ nguyên tên trường dù ngữ nghĩa đã đổi (plan 1.5).** Đổi tên thành
`purchasedSessions` sẽ đúng hơn về mặt đặt tên, nhưng kéo theo sửa mọi nơi tham chiếu trường
này (nhiều hơn một service) chỉ để đổi tên — không đổi hành vi. Giữ tên cũ, **ngữ nghĩa mới
(bất biến) được ghi rõ trong comment tại nơi khai báo và ở §2.1 tài liệu này.**

**Mục 2.4 gốc của kế hoạch (một hạng mục Phase 2) bị bỏ qua** vì cách làm duy nhất hợp lý đòi
hỏi đọc dữ liệu qua `ai-service` — vi phạm thẳng luật cấm tuyệt đối "không đụng ai-service".
Người dùng xác nhận bỏ qua, giữ nguyên luật cấm.

**Plan 5.1 mở rộng thêm việc relay `REACTIVATE`, không chỉ `DEACTIVATE`.** Kế hoạch gốc chỉ
nói tới khoá tài khoản PT; mở khoá lại (admin bật lại một PT từng bị khoá) cũng cần đồng bộ
sang user-service theo đúng cách — nếu không, một PT được mở khoá ở auth-service vẫn bị coi là
đã khoá ở user-service, một trạng thái nửa vời không nơi nào chủ động sửa.

**5.3 dùng heuristic dựa trên mô tả bút toán để nhận diện tiền hoàn trả của khách**, thay vì
một cột "nguồn tiền" có cấu trúc — xem giải thích đầy đủ và hướng lỗi an toàn ở §16.

**Bất biến đối soát khác đề bài** — xem ghi chú ở §6.

### P0 sửa lỗi kế toán hợp đồng / toàn vẹn buổi tập / ký quỹ dịch vụ cá nhân hoá (cụm G→A→B→C→E→F→H)

**Cụm C — "giữ tiền" (hold) của dịch vụ cá nhân hoá tái dùng nguyên xi bơm-checkout +
webhook đã có, không phải 3 endpoint mới như đề bài mô tả.** Đề bài hình dung cần dựng riêng
một cơ chế giữ tiền cho đơn dịch vụ cá nhân hoá. Khi bắt tay vào mới thấy: checkout chung
(`POST /internal/payments/checkout`) đã làm đúng thứ cần — nhận tiền qua cổng, đóng băng tỷ lệ,
cộng ESCROW + ngăn chờ hai bên (PT/nền tảng, không có gym) — chỉ cần thêm một `purpose` mới
(`PERSONALIZED_SERVICE_PURCHASE`) và một trạng thái đơn hàng mới (`PENDING_PAYMENT`) chờ
webhook kích hoạt, đúng khuôn mẫu hợp đồng PT/gói hội viên đã có. Dựng một cơ chế giữ tiền
riêng sẽ là **một đường tiền thứ hai** — vi phạm thẳng luật bắt buộc "mọi chuyển tiền đi qua
`withWallets`", nên bị loại ngay từ đầu. Chỉ thật sự có 2 endpoint payment-service **mới**
(`/personalized-service/release`, `/personalized-service/refund`) — endpoint thứ ba (giữ tiền)
không cần vì đã có sẵn.

**Cụm C4 — ngưỡng "còn huỷ được" của đơn dịch vụ cá nhân hoá tái dùng đúng luật đã có trong
code (`PURCHASED`/`INTAKE_PENDING`/`INTAKE_SUBMITTED`, §XXXII cũ), không hỏi lại người dùng.**
Đây là một quy tắc nghiệp vụ đã được code hoá, có kiểm thử, và ổn định từ trước — không phải
một con số nghiệp vụ còn thiếu cần STOP-và-hỏi theo luật của task. Dùng lại nguyên trạng khi
nối `refundOrder` vào `cancelOrder`.

**Cụm C3 — số ngày tự-chấp-nhận bản giao mặc định `3` ngày
(`PERSONALIZED_SERVICE_AUTO_ACCEPT_DAYS`).** Đây LÀ một con số nghiệp vụ chưa có trong task —
đã hỏi qua `AskUserQuestion` với phương án đề xuất là 3 ngày (khớp `SESSION_AUTO_CONFIRM_DAYS`
đã có, để hai luồng tự-duyệt trong hệ thống nhất quán). Người dùng không chọn cụ thể mà bảo
tiếp tục — đã chọn đúng phương án đề xuất (3 ngày) làm mặc định, ghi rõ ở đây để không ai tưởng
đây là số bịa ra không hỏi.

**Khoá idempotency `PERSONALIZED_REFUND:<orderId>:<refundAmount>` có thêm số tiền vào khoá,
khác quy ước `<id>` suông đề bài gợi ý.** Lý do và hệ quả: xem §17.

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

---

## 19. Dịch vụ cá nhân hoá (`ai-service`) — vòng đời tiền, ký quỹ (P0 cụm C)

> Đây là logic **thương mại** (giá, ký quỹ, chia ba... đúng ra là chia hai, xem dưới) sống
> trong codebase `ai-service` — không phải logic AI/LLM/dinh dưỡng/an toàn hội thoại. Luật cấm
> "không đụng ai-service" của task áp cho phần thứ hai; cụm C chỉ chạm đúng các file thương mại
> nêu tên tường minh trong đề bài (`payment.client.ts`, module `personalized-service.*`).

### 19.1 Trước cụm C — vì sao phải sửa

Luồng cũ chuyển tiền **ngay lập tức** bằng `walletTransfer` (chuyển thẳng khách → PT, không
qua ESCROW/ngăn chờ) tại thời điểm mua, **và** `receiverOwnerType` bị gán cứng sai thành
`"CLIENT"` — tiền lẽ ra trả cho PT lại được ghi có vào chính ví khách vừa trả tiền (C1, tự vá
lại tiền mình vừa trả). Ngoài lỗi đó, chuyển tiền ngay khi mua vi phạm nguyên tắc ký quỹ dùng
cho mọi luồng tiền khác trong hệ thống này (PT-contract, gói hội viên): tiền phải nằm ở ngăn
chờ tới khi **có việc thật đã xảy ra** (ở đây là: khách nhận và chấp nhận bản giao), không phải
ngay khi thanh toán thành công — nếu không, PT có thể nhận trọn tiền rồi không giao gì, và
không có nguồn nào để hoàn khi khách huỷ trước khi PT bắt đầu làm việc (C2).

### 19.2 Luồng tiền mới — dùng lại đúng bơm checkout + webhook chung (không phải cơ chế riêng)

```
Khách bấm mua dịch vụ cá nhân hoá → chọn cổng
   └─> POST /internal/payments/checkout  (purpose = PERSONALIZED_SERVICE_PURCHASE — MỚI)
        · Đơn ở trạng thái PENDING_PAYMENT (ENUM MỚI), platformRateSnapshot/ptRateSnapshot
          đóng băng ngay lúc này — cùng nguyên tắc "khoá tỷ lệ tại thời điểm ký" của §12
        · Trả redirectUrl, KHÔNG đồng nào dịch chuyển
        └─> Webhook cổng (hoặc job đối soát chủ động hỏi lại — TÁI DÙNG nguyên xi, không viết
             thêm gì riêng cho dịch vụ cá nhân hoá)
             ├─> ESCROW                     += P
             ├─> PT ngăn chờ                += ptRateSnapshot × P
             ├─> Nền tảng (REVENUE) ngăn chờ += platformRateSnapshot × P   (KHÔNG có phần gym
             │                                   — PersonalizedService không gắn gymId)
             └─> Gọi ngược ai-service (POST /internal/personalized-service/orders/:id/
                  activate-after-payment) → PENDING_PAYMENT chuyển thẳng sang INTAKE_PENDING
                  (bỏ qua PURCHASED — enum giữ giá trị đó chỉ vì code cũ vẫn còn nhắc tên)

PT giao bản nháp (deliverDraft) → DRAFT_DELIVERED, autoAcceptDeadline = now + 3 ngày
   (PERSONALIZED_SERVICE_AUTO_ACCEPT_DAYS)

Khách chấp nhận (acceptOrder) — HOẶC sweep tự chấp nhận thay khi quá hạn (§19.4)
   └─> POST /internal/personalized-service/release  (endpoint MỚI, MỘT trong hai endpoint
        payment-service thật sự mới của cụm C — xem §15)
        ├─> PT ngăn chờ    −= phần PT còn giữ, PT khả dụng    += cùng số đó
        └─> NT ngăn chờ    −= phần NT còn giữ, NT khả dụng    += cùng số đó
             (releaseOrder luôn giải phóng TOÀN BỘ phần còn trong ngăn chờ của đơn — một đơn,
             một lần giao, không có khái niệm giải phóng từng phần)

Huỷ trước khi PT bắt đầu làm việc (cancelOrder, còn ở PURCHASED/INTAKE_PENDING/
INTAKE_SUBMITTED — ngưỡng tái dùng nguyên luật cũ, xem §15) HOẶC admin duyệt hoàn tiền
(adminResolveRefund, có thể từng phần và gọi nhiều lần)
   └─> POST /internal/personalized-service/refund  (endpoint MỚI thứ hai)
        ├─> Rút trước từ ngăn CHỜ của PT/NT (trường hợp thường — chưa giải phóng gì)
        ├─> Không đủ → rút tiếp từ ngăn KHẢ DỤNG (đơn đã được accept, hoặc một lần hoàn từng
        │    phần trước đó đã rút cạn ngăn chờ)
        ├─> Vẫn không đủ (PT đã rút hết) → PartnerReceivable ghi nợ PT, phần NT thiếu thì báo
        │    lỗi mức "error" — nền tảng không thể tự nợ chính mình
        └─> Ví khách += refundAmount. ESCROW KHÔNG đổi (tiền chưa hề rời nền tảng — chỉ đổi
             quyền đòi).
```

### 19.3 Bảng trạng thái đơn hàng → trạng thái tiền

| Trạng thái đơn | Tiền đang ở đâu |
|---|---|
| `PENDING_PAYMENT` | Chưa vào hệ thống — khách chưa thanh toán xong hoặc webhook chưa về |
| `INTAKE_PENDING` … `DRAFT_DELIVERED` … `REVISION_*` | Trong ngăn **CHỜ** của PT + NT (đã nhận tiền, chưa giao xong) |
| `ACCEPTED` / `ACTIVE` / `COMPLETED` | Đã giải phóng sang ngăn **KHẢ DỤNG** của PT + NT |
| `CANCELLED` (huỷ trước khi PT bắt đầu) | Toàn bộ hoàn lại khách, ngăn chờ PT/NT về 0 cho đơn này |
| `REFUND_REQUESTED` → `REFUNDED` (admin duyệt) | Hoàn một phần hoặc toàn bộ — có thể lặp lại nhiều lần cho tới trần hoàn tiền tối đa |
| `DISPUTED` | Không tự động động tới tiền — chờ xử lý thủ công như tranh chấp buổi tập (§ tranh chấp) |

### 19.4 Tự động chấp nhận sau khi hết hạn xem xét (C3)

`ai-service/src/services/personalized-service-autoaccept-sweep.service.ts`, khởi động cùng
server (`startPersonalizedServiceAutoAcceptJob`), khuôn mẫu giống mọi sweep khác trong hệ
thống này (cờ chống chạy chồng, cô lập lỗi từng dòng). Hai lượt quét mỗi lần chạy:

1. **Tự chấp nhận** các đơn `DRAFT_DELIVERED` đã quá `autoAcceptDeadline` — gọi lại đúng
   `commitAcceptance` mà `acceptOrder` (khách bấm tay) cũng gọi, **một bản cài đặt duy nhất**
   cho cả hai đường, không để hai đường trôi lệch nhau.
2. **Thử lại giải phóng** cho các đơn đã `ACCEPTED`/`ACTIVE` nhưng vì lý do gì đó
   (payment-service tạm sập lúc accept, …) chưa thực sự giải phóng được tiền — best-effort,
   đúng tinh thần "giải phóng theo buổi là best-effort" đã có ở §12 cho PT-contract.

Mặc định `3` ngày — xem lý do chọn con số này ở §15.

### 19.5 Lỗi đã bắt được và sửa trong lúc code (C1, tự bản thân)

`commitAcceptance` bản đầu tiên có lỗi trả-về-cũ: `const [, updated] = await
prisma.$transaction([...])` đọc `updated` **trước** khi bước giải phóng tiền (`releasedAt`)
chạy xong, nên hàm trả về một object có `releasedAt: null` ngay cả khi giải phóng đã thành
công — sai dữ liệu trả về (không sai tiền, tiền đã giải phóng đúng), nhưng đủ để giao diện/log
hiểu nhầm trạng thái. Sửa bằng `let [, updated]` rồi gán lại `updated` sau bước giải phóng.

---

<a id="merged-business-rules-session-lifecycle"></a>

## Consolidated reference: business-rules-session-lifecycle.md

> Consolidated 2026-09-07. Original dates, verification results and deployment
> snapshots below are historical; confirm them against current code/environment.

## Vòng đời buổi tập PT — trạng thái, đặt lại lịch, huỷ/bồi thường, check-in

Tài liệu này mô tả **hành vi nghiệp vụ** của một buổi tập PT từ lúc đặt tới lúc kết thúc —
tách riêng khỏi `docs/money-flow.md`, vốn nói về tiền. Đọc file đó trước nếu câu hỏi là "tiền
đi đâu"; đọc file này nếu câu hỏi là "buổi tập chuyển trạng thái ra sao và ai được làm gì".

| | |
|---|---|
| Nguồn sự thật duy nhất cho hậu quả huỷ/vắng | `backend/services/user-service/src/services/session-outcome.ts` |
| Đặt lịch, huỷ, đặt lại lịch | `backend/services/user-service/src/services/booking.service.ts` |
| Chặn ngày (PT tự đóng lịch) | `backend/services/user-service/src/services/availability.service.ts` |
| Check-in phòng gym | `backend/services/gym-service/src/services/checkin.service.ts` |

---

### 1. Trạng thái một buổi tập (`SessionStatus`)

```
REQUESTED ──(PT xác nhận)──> CONFIRMED
REQUESTED ──(huỷ)───────────> CANCELLED

CONFIRMED ──(PT báo đã diễn ra)──> PENDING_CLIENT_CONFIRMATION
CONFIRMED ──(huỷ, PT/khách/bất khả kháng)──> CANCELLED
CONFIRMED ──(PT vắng, khách tự báo)──> PT_NO_SHOW_REPORTED

PENDING_CLIENT_CONFIRMATION ──(khách xác nhận, hoặc tự động sau
                                 SESSION_AUTO_CONFIRM_DAYS)──> COMPLETED
PENDING_CLIENT_CONFIRMATION ──(khách khiếu nại)──> DISPUTED

PT_NO_SHOW_REPORTED ──(PT đồng ý)──> NO_SHOW
PT_NO_SHOW_REPORTED ──(PT phủ nhận)──> DISPUTED

DISPUTED ──(quản trị viên phân xử)──> COMPLETED hoặc CANCELLED
```

`COMPLETED` là trạng thái **duy nhất** trừ quota bình thường (`usedSessions += 1`). `NO_SHOW`
do PT gây ra không trừ quota bình thường — nó tăng `compensatedSessions` (xem
`docs/money-flow.md` §2.1, §5). Không trạng thái nào đi lùi.

#### 1.1 Trạng thái nào vẫn đang "giữ quyền lợi" (P0 cụm B1)

Khi đếm "hợp đồng còn cho phép đặt thêm bao nhiêu buổi" (`sessionRepository.countActiveByContract`),
**năm** trạng thái sau vẫn tính là đang giữ một suất quyền lợi của hợp đồng — chưa buổi nào
trong số đó đã được giải phóng hay hoàn trả:

```
REQUESTED · CONFIRMED · PENDING_CLIENT_CONFIRMATION · DISPUTED · PT_NO_SHOW_REPORTED
```

Trước đây chỉ đếm `REQUESTED`/`CONFIRMED` — một buổi đang chờ khách xác nhận, đang tranh chấp,
hay đang chờ PT phản hồi báo cáo vắng mặt đều **không bị tính**, nên khách có thể đặt vượt quá
số buổi đã mua trong đúng lúc một buổi khác của họ đang ở một trong ba trạng thái đó. `COMPLETED`,
`CANCELLED`, `NO_SHOW` không tính — mỗi trạng thái đó đã được hạch toán xong ở nơi khác
(`usedSessions`, `compensatedSessions`, hoặc đơn giản là chưa từng diễn ra).

#### 1.2 Đặt lịch không bao giờ được double-book PT (P0 cụm B2)

Kiểm tra số buổi còn được đặt (§1.1) và kiểm tra trùng khung giờ của PT trước đây chỉ là hai
lần đọc riêng lẻ, không có khoá nào — hai yêu cầu đặt lịch gửi gần như đồng thời có thể cùng
đọc thấy "còn chỗ"/"còn trống" trước khi cái nào ghi xong, tạo ra hai buổi tập chồng giờ cho
cùng một PT hoặc vượt quá số buổi hợp đồng cho phép.

`bookSession` giờ khoá theo PT bằng `pg_advisory_xact_lock` (khoá cấp transaction, tự giải
phóng khi commit/rollback, không cần đổi schema) **ngay trước** bước kiểm tra số buổi còn lại
và kiểm tra trùng giờ, gộp cả hai kiểm tra đó cùng với việc tạo buổi tập vào **một** transaction
có khoá. `respondToReschedule`'s nhánh ACCEPT (§3) dùng đúng cùng cơ chế khoá này. Các kiểm tra
không cạnh tranh (giờ PT công bố, ngày PT nghỉ, thời hạn hợp đồng) vẫn chạy trước, ngoài khoá —
chỉ phần thật sự có thể bị đua mới cần nằm trong khoá.

#### Vì sao có `PENDING_CLIENT_CONFIRMATION` thay vì để PT tự quyết

Trước đây PT một mình vừa khai buổi tập đã diễn ra, vừa được trả tiền ngay, không ai kiểm lại.
Giờ PT chỉ **báo cáo**; khách xác nhận, khiếu nại, hoặc im lặng — sau `SESSION_AUTO_CONFIRM_DAYS`
ngày (mặc định 3) hệ thống tự xác nhận thay, để một khách không phản hồi không giữ tiền của PT
mắc kẹt vô thời hạn. Đây cũng là lý do có `PT_NO_SHOW_REPORTED` (chiều ngược lại — khách báo PT
vắng, PT phải phản hồi) và `DISPUTED` (khi hai bên không đồng ý, một quản trị viên phân xử —
màn `/admin/disputes`).

---

### 2. Ma trận hậu quả huỷ/vắng buổi — §0.1

Nguồn sự thật duy nhất: `resolveSessionOutcome({ actor, event, hoursBeforeStart })` trong
`session-outcome.ts`. **Ba nơi khác nhau từng tính hậu quả độc lập** (`addException` huỷ ngày
của PT, `cancelSession` huỷ một buổi trực tiếp, `markNoShow`), và cùng một sự kiện thật —
PT huỷ trễ — cho ra hai kết quả tiền khác nhau tuỳ đi qua đường nào. PT chọn đường nào **rẻ
hơn cho họ**, không đường nào đúng cả. Giờ cả ba đều gọi vào đúng một hàm.

**Mốc "trễ" = `SESSION_LATE_CANCEL_HOURS`, mặc định 24 giờ**, đọc từ biến môi trường một lần
lúc nạp module.

| # | Ai gây ra | Sự kiện | Báo trước | Trạng thái buổi | Quota | Bồi thường khách | PT được trả |
|---|---|---|---|---|---|---|---|
| 1 | Khách | Huỷ | ≥ 24h | `CANCELLED` | **Giữ** (không trừ) | Không | Không |
| 2 | Khách | Huỷ | < 24h | `CANCELLED` | **Trừ** | Không | **Có** (PT hưởng trọn) |
| 3 | PT | Huỷ/chặn ngày | ≥ 24h | `CANCELLED` | Giữ | Không | Không |
| 4 | PT | Huỷ/chặn ngày | < 24h | `NO_SHOW` | Giữ | **Có** | Không |
| 5 | PT | Không tới (vắng thật) | *(không áp dụng)* | `NO_SHOW` | Giữ | **Có** | Không |
| 6 | Bất khả kháng | Huỷ | *(bất kỳ)* | `CANCELLED` | Giữ | Không | Không |

Đọc cách khác:

- **Khách huỷ sớm (≥24h) hoặc có bất khả kháng: không ai bị phạt**, buổi trả về, đặt lại được.
- **Khách huỷ trễ (<24h): khách mất buổi, PT vẫn được trả** — vì PT đã giữ chỗ đó, không kịp
  nhận khách khác.
- **PT huỷ/chặn ngày sớm (≥24h): không ai bị phạt tiền**, chỉ buộc phải đặt lại — PT báo trước
  đủ xa thì không có gì để phạt.
- **PT huỷ/chặn ngày trễ (<24h) hoặc vắng mặt thật: luôn bồi thường khách, PT không được trả**
  — hai trường hợp này **tài chính giống hệt nhau** dù trạng thái buổi khác nhau về mặt hiển
  thị (đều gắn `NO_SHOW`), vì trải nghiệm của khách giống hệt nhau: một buổi họ tưởng sẽ diễn
  ra thì không diễn ra, báo quá trễ để xoay sở.
- **Dòng 5 không có khái niệm "báo trước"** — một buổi đã trôi qua mà PT không xuất hiện thì
  không còn ý nghĩa để hỏi "báo trước bao lâu".

**PT huỷ tính "trễ" không giảm `totalSessions`** — xem cảnh báo ở `money-flow.md` §2. Trừ quota
kiểu KEEP/DEDUCT ở bảng trên chỉ nói buổi đó có tính là "đã dùng" (`u`) hay không; quyền lợi
tổng của hợp đồng (`totalSessions`) không bao giờ đổi sau khi ký.

#### 2.1 Chỉ được báo hoàn thành/vắng mặt sau đúng thời điểm (P0 cụm B3/B4)

Hai mốc thời gian riêng biệt, không dùng chung:

| Hành động | Mốc chặn | Vì sao dùng mốc này |
|---|---|---|
| PT báo **hoàn thành** (`completeSession`) | `scheduledEndAt` (giờ **kết thúc**) | "Hoàn thành" nghĩa là *toàn bộ* buổi đã diễn ra — báo được ngay sau khi vừa bắt đầu là sai, dù chỉ mới trôi qua vài phút |
| PT báo **khách vắng mặt** / PT tự nhận **vắng mặt** (`markNoShow`, cả hai chiều) | `scheduledStartAt` (giờ **bắt đầu**) | "Vắng mặt" chỉ cần biết thời điểm hẹn đã trôi qua — không cần đợi hết cả buổi mới kết luận được ai không tới |
| Khách báo **PT vắng mặt** (`reportPtNoShow`) | `scheduledStartAt` | Đã có từ trước — hai chiều báo vắng mặt giờ **đối xứng nhau**, dùng cùng một mốc |

Trước đây `completeSession` và `markNoShow` (cả hai nhánh) không kiểm tra thời gian nào cả —
PT có thể báo một buổi đã "hoàn thành" hoặc khách "vắng mặt" ngay sau khi vừa xác nhận, trước
khi buổi tập thật sự diễn ra. Không có ngưỡng phút "cho phép sai số" nào ở đây — mốc chặn là
tuyệt đối, giống hệt cách `reportPtNoShow` (chiều ngược lại) đã làm từ trước.

---

### 3. Đặt lại lịch (reschedule)

- Bên đề xuất gửi giờ mới; bên kia **chấp nhận** hoặc **từ chối**. Không tự bên nào có thể ép.
- **Giờ kết thúc đề xuất luôn tính từ máy chủ (P0 cụm H1)** — `sessionDurationMinutes` đóng
  băng trên hợp đồng, không bao giờ đọc từ thân yêu cầu. Trước đây người gọi trực tiếp API có
  thể tự gửi một giờ kết thúc bất kỳ, đề xuất dời sang một buổi dài/ngắn hẳn so với gói đã mua
  — đúng lỗ hổng `bookSession` (đặt lịch ban đầu) đã vá từ trước (money-flow plan 3.4), giờ
  `requestReschedule` cũng theo đúng kỷ luật đó.
- Khi **chấp nhận**, hệ thống **kiểm tra lại slot còn trống** ngay trước khi ghi (`assertSlotBookable`)
  — vì thời gian giữa lúc đề xuất và lúc chấp nhận có thể đã có buổi khác chen vào đúng khung
  giờ đó. Không kiểm tra lại thì hai buổi có thể trùng giờ. **Chạy trong cùng khoá theo PT mà
  §1.2 mô tả (P0 cụm H2)** — bản thân việc kiểm tra lại cũng có khoảng hở đua tương tự B2 nếu
  hai lượt "chấp nhận" gửi gần như đồng thời, nên phải nằm trong cùng một transaction có khoá
  với hai bước ghi (đổi trạng thái yêu cầu + đổi giờ buổi tập), không phải ba câu lệnh rời rạc.
- Yêu cầu đặt lại lịch tự hết hạn sau một khoảng thời gian nếu không ai phản hồi (job nền —
  "Reschedule expiry job", chạy mỗi 10 phút).
- PT **không được công bố lịch rảnh trống** → mọi thao tác đặt lịch (kể cả đặt lại) bị chặn với
  thông báo rõ ràng, thay vì âm thầm coi "trống hoàn toàn" = "rảnh cả ngày" (hành vi cũ, đã đảo
  ngược — xem `money-flow.md` §15 nếu cần bối cảnh các quyết định đảo ngược hành vi khác).

---

### 4. Chính sách quét check-in phòng gym — §0.3

Một lượt quét mã QR tại quầy = **một lượt ghé** (`usedVisits += 1`), miễn:

- Cùng một gói hội viên, cách lượt quét **liền trước tối thiểu 60 giây** (`COOLDOWN_MS`) — chặn
  quét đúp do mạng chậm hoặc bấm nhầm hai lần, không phải chặn ghé nhiều lần trong ngày.
- **Không giới hạn số lượt ghé trong một ngày** — khách có thể vào-ra nhiều lần cùng ngày, mỗi
  lần cách nhau ≥60 giây đều tính là một lượt ghé hợp lệ riêng.

Khi `usedVisits` chạm `totalVisits` (gói giới hạn lượt ghé, không phải gói không giới hạn),
gói **tự chuyển `EXPIRED` ngay trong cùng transaction** với lượt quét cuối cùng — tái dùng
đúng luồng giải phóng tiền đã có ở `membershipPayout.sweep.ts` (§16 file money-flow.md), không
viết thêm đường giải phóng thứ hai.

Khoá `FOR UPDATE` khi ghi lượt ghé (giống cách `payment-service` khoá ví) — hai lượt quét gần
như đồng thời của cùng một khách không thể cùng lọt qua kiểm tra cooldown.

---

### 5. Khiếu nại và phân xử

`DISPUTED` chỉ phát sinh từ hai hướng: khách khiếu nại một `PENDING_CLIENT_CONFIRMATION`, hoặc
PT phủ nhận một `PT_NO_SHOW_REPORTED`. Cả hai đều dừng lại chờ quản trị viên tại
`/admin/disputes` — **không có đường tự động nào giải quyết tranh chấp**, tiền đứng yên
(quota không trừ, không bên nào được/mất tiền) cho tới khi có kết luận kèm ghi chú bắt buộc.

Quản trị viên chọn một trong **ba** kết luận — không còn chỉ hai (P0 cụm B5):

| Kết luận | Khi nào dùng | Quota | Tiền |
|---|---|---|---|
| `COMPLETED` | Buổi tập coi như đã diễn ra | **Trừ** | PT được trả — công thức giải phóng bình thường |
| `CANCELLED` | Buổi không diễn ra, không ai sai hẳn | Giữ | Không ai được trả |
| `PT_NO_SHOW_CONFIRMED` | Quản trị viên xác nhận PT **thật sự** vắng mặt (chỉ có ý nghĩa cho tranh chấp đến từ nhánh PT phủ nhận báo cáo vắng mặt của khách) | Giữ | **Bồi thường khách** — đúng công thức PT-vắng-buổi ở `money-flow.md` §5, y hệt như khi PT tự nhận vắng mặt (`markNoShow`) |

**`PT_NO_SHOW_CONFIRMED` là kết luận mới.** Trước đây tranh chấp đến từ việc PT phủ nhận báo
cáo vắng mặt của khách (`respondToNoShowReport`'s nhánh DENY) chỉ có hai lựa chọn cũ — nếu quản
trị viên xác nhận khách đúng (PT thật sự vắng), lựa chọn gần nhất là `CANCELLED`: huỷ buổi,
không trừ quota, **nhưng cũng không bồi thường khách**. Cùng một sự thật (PT vắng mặt) nhưng
cho ra hai kết cục tiền khác nhau tuỳ tranh chấp tới từ hướng nào — đúng khoảng trống đề bài mô
tả. Kết luận này tái dùng **nguyên** luồng bồi thường `markNoShow`'s nhánh PT tự nhận đã dùng,
không viết công thức tiền mới riêng cho tranh chấp.

Không có lựa chọn thứ tư; mọi kết luận phải rơi đúng vào một trong ba nhánh tiền đã có sẵn công
thức, không tạo nhánh tiền mới chỉ cho riêng một trường hợp tranh chấp.

---

### 6. PT báo cáo khách vắng mặt

Song song với `PT_NO_SHOW_REPORTED` (khách báo PT vắng), PT cũng có thể báo **khách** không tới
cho một buổi `CONFIRMED` đã quá giờ mà không ai xác nhận gì. Luồng này tái dùng đúng nhánh
"PT tự nhận khách vắng" của `markNoShow` — khách bị trừ quota (dòng 2/4 tương ứng của ma trận
§2 tuỳ báo trước hay không), không có bước xác nhận hai chiều riêng cho hướng này vì khách
không có động lực tự nhận mình vắng oan.

---

### 7. Liên quan tới `docs/money-flow.md`

Mọi con số tiền tạo ra từ các trạng thái/sự kiện ở tài liệu này đều được tính theo công thức ở
`money-flow.md` — file đó là nơi duy nhất có quyền tính tiền (§12 "Vì sao công thức chỉ nằm ở
payment-service"). Tài liệu này chỉ trả lời "chuyện gì đã xảy ra"; **không bao giờ tự tính lại
số tiền** ở tầng user-service/gym-service.


---

<a id="merged-pt-service-packages"></a>

## Consolidated reference: pt-service-packages.md

> Consolidated 2026-09-07. Original dates, verification results and deployment
> snapshots below are historical; confirm them against current code/environment.

## Gói dịch vụ của PT, ảnh chụp giá, và cảnh báo lịch trống

Tài liệu bàn giao Phase 1. Ai sắp sửa code liên quan tới **giá gói, tạo hợp đồng, hay con số
slot trống hiện cho khách** thì đọc hết file này trước.

| | |
|---|---|
| Model gói | `user-service/prisma/schema.prisma` — `PTServicePackage` |
| Nghiệp vụ gói | `user-service/src/services/pt_service_package.service.ts` |
| Ảnh chụp giá | `contract.service.ts` — `buildPackageSnapshot()` |
| Đếm slot | `availability.service.ts` — `countSlotsFromRows()` |
| Di trú | `user-service/src/scripts/migrate-pt-service-packages.ts` |
| Kiểm thử ảnh chụp | `src/__tests__/contract-price-snapshot.test.ts` (7 test) |
| Kiểm thử đếm slot | `src/__tests__/slot-counting.test.ts` (14 test) |

Chạy kiểm thử:

```bash
cd backend/services/user-service && npm test
```

---

### 1. Hệ thống có HAI khái niệm "gói" — không được gộp

Đây là nguồn nhầm lẫn chính của cả phase.

| | Gói **kế hoạch tập** | Gói **dịch vụ PT** |
|---|---|---|
| Model | `TrainingPackage` (ai-service) | `PTServicePackage` (user-service) |
| Bán cái gì | **Nội dung** — một kế hoạch tập soạn sẵn | **Dịch vụ** — số buổi PT kèm cặp trực tiếp |
| Mua xong nhận gì | Quyền xem kế hoạch | Hợp đồng có hạn mức buổi, ràng buộc, hoàn tiền |
| Ai bán | Bất kỳ ai xuất bản kế hoạch | Chỉ PT đã được duyệt |
| Đường dẫn | `/marketplace/plans` | `/profile/me/service-packages` |
| Dính tới tiền hợp đồng | ❌ | ✅ — xem `docs/money-flow.md` |

Nhãn ở chợ kế hoạch đã đổi thành **"Bán kế hoạch tập"** để không lẫn với gói buổi coaching
(commit `c964361`).

---

### 2. Ảnh chụp giá vào hợp đồng

#### Quy tắc

Khi khách mua, `Contract` **sao chép** các giá trị dưới đây từ `PTServicePackage`, **không**
tham chiếu động:

```
packageId              ← chỉ để tra cứu nguồn gốc
packageName            ← ảnh chụp tên
price                  ← ảnh chụp giá
totalSessions          ← ảnh chụp số buổi
sessionMode            ← ảnh chụp
sessionDurationMinutes ← ảnh chụp
```

Cài đặt gom vào **một hàm thuần tuý** `buildPackageSnapshot(pkg)`.

#### Vì sao là một hàm riêng, và vì sao nó chỉ nhận `pkg`

Đây là tính chất **bảo mật**, không phải sở thích trình bày. Hàm không có tham số nào mang
được thân yêu cầu của khách vào, nên **không có sửa đổi tương lai nào lỡ tay tin nó được**.

Khách tự khai `price` là lỗ hổng kinh điển: gói 10 buổi bị mua với giá một đồng. Nếu để lời gọi
`contractRepository.create` đọc trực tiếp từ `data`, chỉ cần một lần copy-paste là thủng.

#### Vì sao là bản sao chứ không phải tham chiếu

PT có quyền đổi giá hoặc lưu trữ gói bất cứ lúc nào. Hợp đồng đã ký **không được đổi theo** —
khách đã đồng ý một con số, bên bán không được sửa nó về sau từ phía nào cả.

Đây **cùng một nguyên tắc** với việc khoá bảng tỷ lệ chia hoa hồng tại thời điểm ký
(`docs/money-flow.md` §12). Hai chỗ dùng chung một lý lẽ: *cái gì hai bên đã thoả thuận thì
đóng băng tại thời điểm thoả thuận*.

#### Ghi chú về kiểu số

`price` được thu về `number` vì đó là kiểu `contractRepository.create` nhận. **An toàn có căn
cứ, không phải may mắn**: cột là `Decimal(14,2)`, giá trị lớn nhất biểu diễn được là `10^12` với
hai chữ số thập phân — tức `10^14` đơn vị nhỏ nhất, nằm gọn trong khoảng số nguyên mà `double`
biểu diễn chính xác (`2^53 ≈ 9×10^15`).

Có một test ghim đúng biên này (`999999999999.99` và `0.01`), nên nếu ai nới cột rộng ra thì
test **vỡ ầm ĩ** thay vì âm thầm làm tròn hợp đồng của người ta.

> ⚠️ Mọi **phép tính** trên tiền vẫn phải nằm ở payment-service và dùng `Decimal`. Chỗ này chỉ
> là chép nguyên xi, không phải tính toán.

---

### 3. Đếm slot trống

#### Công thức

`countSlotsFromRows()` — hàm thuần tuý, nhận dữ liệu đã đọc sẵn từ CSDL:

```
Với mỗi ngày D trong [fromDate, toDate]:
   nếu D nằm trong PTScheduleException  → bỏ qua cả ngày
   ngược lại, với mỗi PTAvailability khớp thứ của D và isActive:
        chia [startTime, endTime] thành các khối sessionDurationMinutes
        khối nào chưa có buổi REQUESTED/CONFIRMED trùng giờ → +1
```

| Yếu tố bị trừ | Nguồn |
|---|---|
| Ngày nghỉ ngoại lệ | `PTScheduleException` — trừ **trọn ngày** |
| Buổi đã đặt | `Session` ở trạng thái `REQUESTED` hoặc `CONFIRMED` |
| Khối lịch đã tắt | `PTAvailability.isActive = false` |
| Phần lẻ cuối khối | Không đủ một buổi thì không tính (09:00–17:30, buổi 60′ → 8 slot, không phải 8,5) |

**Cửa sổ mặc định 28 ngày**, hằng số `availabilityService.SLOT_LOOKAHEAD_DAYS`. Chọn 4 tuần vì
đủ dài để có tín hiệu, đủ ngắn để lịch PT còn tương đối ổn định.

#### Hiệu năng

Ba truy vấn gom cho **cả trang**, không phải 3N. Danh sách 20 PT vẫn là ba truy vấn.
Chưa dùng Redis — ở quy mô hiện tại ba truy vấn đã đủ nhanh; nếu đo thấy chậm thì thêm đệm
được mà không đổi giao diện hàm.

#### 🐛 Lỗi múi giờ — đọc kỹ trước khi sửa chỗ này

Bản cũ khoá ngày bằng `toISOString().slice(0, 10)` (**giờ UTC**) trong khi lấy thứ bằng
`getDay()` và giờ bằng `getHours()` (**giờ địa phương**). Container chạy `TZ=Asia/Ho_Chi_Minh`
(commit `78a3702`), nên nửa đêm địa phương ngày 12 là **17:00 UTC ngày 11** — hai vế lệch nhau
đúng một ngày.

Hậu quả **không phải** "bỏ qua buổi đã đặt", mà là **trừ nhầm sang ngày hôm sau**:

| Tình huống | Bản cũ | Đúng ra |
|---|---|---|
| Buổi đặt ngày **thứ Sáu** | Đẩy sang thứ Bảy — ngày PT không làm việc — **biến mất hoàn toàn** | Trừ 1 |
| Buổi đặt **ngay trước ngày nghỉ** | Đẩy vào ngày nghỉ, ngày đó bị bỏ qua → **biến mất** | Trừ 1 |
| Buổi đặt **đúng ngày nghỉ** | Đẩy sang ngày làm việc kế tiếp → **trừ nhầm một slot đang trống thật** | Không trừ gì thêm |
| Buổi đặt giữa tuần | Đẩy sang hôm sau; **tổng vô tình đúng** nhưng sai ngày | Trừ 1 đúng ngày |

Nghĩa là PT kín lịch thứ Sáu vẫn quảng cáo thứ Sáu còn trống. Con số này gác cửa hộp thoại cảnh
báo lúc mua, nên sai ở đây là khách mua nhầm.

**Cách sửa:** hàm `localDateKey()` đọc `getFullYear/getMonth/getDate`, cùng đồng hồ với
`getDay()` và `getHours()`. Nguyên tắc chung: **thứ gì so sánh ngày theo lịch treo tường thì
phải đọc cùng một đồng hồ với thứ đọc giờ.**

Bộ test dựng `Date` bằng hàm tạo giờ địa phương nên **đúng ở mọi múi giờ**, không chỉ UTC+7.

---

### 4. Ba lớp cảnh báo lịch trống

**Không chặn cứng.** Slot sẽ trống dần theo thời gian; chặn cứng là chặn nhầm những hợp đồng
hoàn toàn khả thi.

| Lớp | Cơ chế | Vì sao |
|---|---|---|
| **1** | Công tắc `isAcceptingClients` trên `UserProfile` | PT tự biết năng lực của mình rõ hơn mọi thuật toán — hiệu quả nhất so với công sức |
| **2** | `availableSlotsNext28Days` trả kèm hồ sơ và danh sách PT | Cho khách con số trước khi quyết định |
| **3** | Hộp thoại xác nhận khi `slot < sessionCount` | Chỉ hỏi khi thật sự có rủi ro |

Chi tiết từng lớp:

- **Lớp 1.** PT tắt nhận khách → ẩn nút mua, hiện nhãn *"Tạm ngưng nhận khách mới"*. **Vẫn hiện
  trong kết quả tìm kiếm** nhưng xếp cuối — khách vẫn cần xem được hồ sơ. Hợp đồng đang chạy
  không bị ảnh hưởng.
- **Lớp 3.** Máy chủ trả `409` kèm mã `LOW_AVAILABILITY`, `availableSlots`, `packageSessions` —
  **không phải** tạo hợp đồng thành công. Giao diện hiện hộp thoại rồi gửi lại kèm
  `acknowledgedLowAvailability: true`.

**Lưu bằng chứng đã cảnh báo:** `Contract.lowAvailabilityWarned` và `Contract.slotsAtPurchase`.
Dùng khi phân xử tranh chấp kiểu *"mua rồi không tập được"*. Cùng khuôn mẫu với
`multiGymWarned` ở gói hội viên (`docs/money-flow.md` §13.7).

---

### 5. Kết quả di trú

Chạy lại lúc bàn giao (`npx tsx src/scripts/migrate-pt-service-packages.ts`):

```
Tìm thấy 12 PT đang hoạt động.
  PT đã có gói, bỏ qua : 5
  Gói sẽ tạo           : 0
  PT không sinh được   : 7
```

**Ba nhánh của script**, theo đúng đề bài:

1. Có `offlinePackagePrice` → tạo gói `OFFLINE`
2. Có `onlinePackagePrice` → tạo thêm gói `ONLINE`
3. Chỉ có `packagePrice` → tạo một gói theo `serviceMode` của PT

Tên tự sinh `"Gói {sessionCount} buổi"`, `isActive = true`, `sessionsPerPackage` rỗng thì mặc
định 10 buổi.

**Idempotent:** PT đã có gói chưa lưu trữ thì bỏ qua. Chạy lại sau lỗi giữa chừng **không nhân
đôi gói của ai** — đã kiểm chứng bằng cách chạy lại và thấy tạo 0 gói.

#### 7 PT không sinh được gói — và vì sao

Cả bảy đều **không có bản ghi `PTApplication`**, nên không có giá nào để chuyển. Script **nêu
đích danh từng người** thay vì lặng lẽ bỏ qua, đúng yêu cầu.

Nguyên nhân gốc: sự cố `prisma db push --accept-data-loss` mô tả ở commit `5219cc8` đã **làm
rỗng bảng `pt_applications`** (hiện chỉ còn 3 dòng cho 12 PT). Đây là **mất dữ liệu có thật**,
không phải thiếu sót của script.

> ⚠️ **Việc còn lại cho người vận hành.** Bảy PT này hiện **không bán được gì** — họ biến mất
> khỏi luồng bán hàng đúng như đề bài cảnh báo. Không có cách nào tự khôi phục vì giá gốc đã mất.
> Phải hoặc nhờ từng PT khai lại gói qua giao diện, hoặc phục hồi `pt_applications` từ bản sao
> lưu trước sự cố rồi chạy lại script.

---

### 6. Điểm cuối

| Phương thức | Đường dẫn | Ai gọi |
|---|---|---|
| `GET` | `/profile/me/service-packages` | PT xem gói của mình, gồm cả gói đã lưu trữ |
| `POST` | `/profile/me/service-packages` | PT tạo gói |
| `PATCH` | `/profile/me/service-packages/:id` | PT sửa gói |
| `DELETE` | `/profile/me/service-packages/:id` | Lưu trữ gói (xoá mềm) |
| `GET` | `/profile/pts/:ptUserId/service-packages` | Khách xem gói đang bán — **chỉ `isActive` và chưa lưu trữ** |

⚠️ **Tiền tố `/profile` là bắt buộc khi đi qua gateway.** user-service mount bộ tuyến này ở
**hai** chỗ — `app.use("/me/service-packages", ...)` trong `app.ts` và một lần nữa trong
`profile.routes.ts` — nhưng gateway **chỉ proxy `/profile`**. Gọi thẳng `/me/service-packages`
qua cổng 3000 trả `404`. Bản mount trong `app.ts` hiện **không tuyến nào ngoài chạm tới được**.

---

### 7. Ràng buộc nghiệp vụ

- `sessionCount >= 1`, `price > 0`
- `sessionMode` không nhận `HYBRID` — chỉ `ONLINE` hoặc `OFFLINE`
- `sessionDurationMinutes` trong khoảng 15–240
- Tối đa **10 gói chưa lưu trữ** mỗi PT — tránh làm rối giao diện khách
- **Không xoá cứng**, chỉ đặt `archivedAt`, vì hợp đồng cũ còn tham chiếu `packageId`
- Gói đã lưu trữ **không sửa được** nữa

---

### 8. Nhật ký kiểm toán

Ba thao tác trên gói đều ghi `AuditLog` (bảng `audit_logs` của user-service):

| Hành động | Ghi kèm |
|---|---|
| `SERVICE_PACKAGE_CREATED` | tên, giá, số buổi, hình thức |
| `SERVICE_PACKAGE_UPDATED` | **chỉ những trường thật sự đổi**, dạng `{before, after}` |
| `SERVICE_PACKAGE_ARCHIVED` | tên, có hợp đồng đang tham chiếu hay không |

`SERVICE_PACKAGE_UPDATED` chỉ ghi phần thay đổi, vì ghi cả dòng mỗi lần sửa sẽ **chôn một lần
đổi giá giữa hàng chục giá trị không đổi**. Đổi giá chính là bằng chứng mà tranh chấp về ảnh
chụp giá cần tới.

Chi tiết mô hình `AuditLog`: xem `docs/pt-scheduling-and-discovery.md` §6.

---

### 9. Quyết định phát sinh

Ghi lại những chỗ khác với đề bài, kèm lý do — **không sửa lặng lẽ**.

**Không dùng Redis để đệm số slot.** Đề bài yêu cầu "gom truy vấn **hoặc** lưu đệm Redis 5
phút". Đã chọn vế đầu: ba truy vấn gom cho cả trang thoả yêu cầu "số truy vấn không tăng tuyến
tính theo số PT" mà không thêm một tầng đệm nữa — mà đệm thì lại kéo theo câu hỏi làm mất hiệu
lực lúc nào khi PT vừa đổi lịch.

**`countAvailableSlotsForPT` tách khỏi phần đọc CSDL.** Phần số học nằm ở
`countSlotsFromRows()`, thuần tuý và test được bằng dữ liệu cố định. Không tách thì lỗi múi giờ
ở §3 vẫn còn nguyên tới hôm nay — nó chỉ lộ ra khi có test ghim từng ngày cụ thể.

**Luồng khám phá đếm slot từ thời điểm gọi, không từ nửa đêm.** `enrichForDiscovery` truyền
`new Date()` làm `fromDate`, nên ngày đầu tiên chỉ tính phần còn lại của hôm nay. Hợp lý cho
danh sách (không mời khách đặt vào giờ đã trôi qua), nhưng **khác** với
`countAvailableSlotsForPT` dùng ở luồng tạo hợp đồng — hàm đó lùi về nửa đêm địa phương. Hai
con số có thể lệch nhau trong phạm vi một ngày. Chưa hợp nhất vì mỗi bên đang đúng với mục đích
của mình; nếu sau này khách thắc mắc "sao trang danh sách ghi khác trang mua" thì đây là chỗ cần
xem.

**Các trường giá trong `PTApplication` giữ nguyên, không xoá.** Chúng trở thành **thông tin
tham khảo lúc nộp hồ sơ**, không còn là nguồn sự thật. Giữ lại để không mất lịch sử hồ sơ.


---

<a id="merged-safemerge"></a>

## Consolidated reference: SafeMerge.txt

> Consolidated 2026-09-07. Original dates, verification results and deployment
> snapshots below are historical; confirm them against current code/environment.

Bối cảnh
Nhánh feature/payment-gateways (commit 7b948d6) vừa hoàn tất một đợt sửa lỗi lớn về dòng tiền và luồng nghiệp vụ (đặt lịch, hợp đồng PT, gói hội viên gym, ví, rút tiền). Rất nhiều bug tiền thật (double-charge, tiền kẹt vĩnh viễn, thiếu bước trừ ví) đã được tìm và vá bằng TDD nghiêm ngặt. Khi merge, hai bên cùng sửa một file dùng chung rất dễ khiến Git tự động giữ lại bản CŨ đã có bug — Git không biết bên nào đúng về nghiệp vụ, nó chỉ thấy "cả hai đều là code hợp lệ".

Mục tiêu: không một fix tiền/nghiệp vụ nào bị revert, dù chỉ vô tình. Merge xong không có nghĩa là git merge không báo conflict — một khối text giống hệt nhau ở hai bên vẫn có thể là bug nếu logic đã đổi ở một bên mà bạn không biết.

Đọc trước khi resolve bất kỳ conflict nào
docs/money-flow.md — công thức tiền, mô hình quyền lợi buổi tập, bất biến đối soát, luồng rút tiền. Đặc biệt §18 "Thu hẹp phạm vi" và §15 "Quyết định phát sinh".
docs/business-rules-session-lifecycle.md — ma trận hậu quả huỷ/vắng buổi, quy tắc đặt lại lịch, chính sách check-in.
Nếu code đang resolve mâu thuẫn với hai file này — nó sai, bất kể nằm bên nào của conflict.

8 điểm cụ thể — đã chốt, không được để bản cũ đè lên
Ví khách không còn nạp tiền — POST /me/wallet/topup trả 410. Nếu thấy nút "Top Up" gọi walletService.topup(...) ở WalletPage.tsx (client) — đó là bản cũ, bỏ.
Khách tự huỷ gói gym: không hoàn tiền — route POST /me/gym-memberships/:id/refund (phía khách) đã bị gỡ khỏi backend. Đúng là .../cancel-membership (không chuyển tiền) + /admin/gym-memberships/:id/refund (chỉ admin).
GYM_STAFF đã xoá hoàn toàn, kể cả enum Postgres. Không thêm lại điều kiện role === "gym_staff".
totalSessions/price bất biến sau ký — PT vắng buổi tăng compensatedSessions, không còn trừ totalSessions. getRemainingEntitlements() là nơi tính duy nhất.
runAutoConfirm phải đi qua deductQuotaOnce() (gồm cả releaseSessionMoney) — có bản cũ bỏ sót hoàn toàn bước trả tiền PT.
resolveSessionOutcome() là nguồn sự thật duy nhất cho hậu quả huỷ/vắng buổi — addException/cancelSession/markNoShow đều phải gọi vào đây, không tự tính riêng.
Idempotency key bắt buộc cho mọi thao tác tiền không phải PaymentTransaction gốc (bảng đầy đủ ở docs/money-flow.md §17) — thiếu là double-charge khi retry.
markPaid trong luồng rút tiền phải trừ cả ví ESCROW, không chỉ ví người nhận — thiếu bước này từng vỡ bất biến đối soát thật.
Quy tắc chung
File bạn chưa từng sửa cho workout/nutrition/AI (payment-service, gym-service, phần lớn user-service liên quan hợp đồng/buổi tập/ví) → lấy nguyên bản feature/payment-gateways.
File cả hai bên cùng sửa (routes.tsx, Sidebar.tsx, AppContext.tsx, api.ts, docker-compose.dev.yml) → merge tay, giữ cả hai phần thêm mới nếu không thật sự chống nhau.
Cảnh giác với "merge sạch nhưng nhân đôi nội dung" — Git từng tự merge không báo conflict nhưng nhân đôi y hệt một khối (đã gặp ở enum TerminationReason trong schema.prisma và hàm computeAgeFromDob). Bắt bằng tsc --noEmit / prisma generate. pnpm-lock.yaml cũng có thể dính lỗi này (ERR_PNPM_BROKEN_LOCKFILE: duplicated mapping key).
Bắt buộc kiểm thử sau merge

grep -rl "^<<<<<<< HEAD$" --include="*.ts" --include="*.tsx" --include="*.prisma" backend frontend
cd backend/services/<service> && npx prisma generate && npx tsc --noEmit
DATABASE_URL="..." npx prisma migrate deploy   # cả DB dev lẫn _test
DATABASE_URL="..." npx tsx --test src/__tests__/<file>.test.ts   # từng file, không glob
cd frontend/web && npx vite build
docker compose -f infra/compose/docker-compose.dev.yml up -d --no-deps --force-recreate <service>
curl -s http://localhost:3000/admin/payments/reconciliation -H "Authorization: Bearer <admin_token>"
Nếu bước cuối trả "balanced": false — dừng lại, đừng push. Nghĩa là một trong 8 điểm ở trên bị revert nhầm.

Khi nào dừng lại hỏi thay vì tự quyết
File không rõ thuộc phạm vi bên nào, và hai bên có nội dung thật sự khác nhau.
Một trong 8 điểm ở trên có vẻ bị đổi lại có chủ đích ở nhánh đối tác (không phải do merge tự động) — đây là xung đột quyết định giữa hai đội, cần người quyết chứ không phải agent tự chọn.
Đối soát không cân bằng và không tìm ra nguyên nhân trong 15 phút.
