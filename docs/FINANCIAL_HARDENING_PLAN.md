# Kế hoạch Financial Hardening (D75) — khảo sát + thứ tự thực hiện

Ngày 19/10/2026. Nhánh `feature/payment-gateways`, HEAD `643c4520`. Viết cho Ngài (chủ sở hữu). **Chỉ tài liệu + một tệp kiểm thử chứng minh lỗi; không sửa mã sản phẩm, không commit/push, không ghi DB dev.** Mọi thay đổi tài chính bên dưới chờ Ngài DUYỆT (D75).

Nhãn bằng chứng: `CODE AUDIT` (đọc mã HIỆN TẠI, có tệp:dòng; không phải E2E) · `BACKEND INTEGRATION` (sổ cái thật, DB `*_test`) · `ĐỌC DB DEV` (số liệu dev từ các báo cáo trước, KHÔNG phải production). Chưa có `REAL BROWSER` / `REAL HTTP` nào trong tài liệu này. Số dev chủ yếu là dữ liệu mồi/dư lượng harness: chỉ cho thấy HÌNH DẠNG lỗi.

Quy tắc giữ nguyên: giữ lại 10% vẫn TẮT (`resolvePtHoldbackRate` luôn "0"); không đổi tỷ lệ chia; không đổi đường tiền ngoài phạm vi khi chưa phân tích phụ thuộc; không thêm nút chuyển tiền thủ công.

---

## 0. Cần Ngài đọc trước (🔴 đặt trên cùng — D71)

| # | Mức | Vấn đề | Tình huống người dùng thật | Bằng chứng |
|---|---|---|---|---|
| R1 | 🔴 | **N7/D48 vẫn còn nguyên trong sổ cái.** Khi tiền của chính hợp đồng A cạn, đền PT vắng / đến muộn rút từ **ví AVAILABLE gộp của PT** (tiền kiếm ở hợp đồng B), nền tảng **ứng** phần thiếu và ghi **nợ PT**; nợ đó bị khấu vào **buổi dạy của hợp đồng C không liên quan**. Kẹp thu hồi "over-released" khi kết thúc cũng rút ví gộp. Phase 0 chỉ **đóng các cửa dẫn tới** (409 `CONTRACT_ENDING`, đỗ dòng đền sau kết thúc), KHÔNG gỡ nhánh trong sổ cái: payment-service tự nó vẫn làm điều D48 cấm khi bị gọi. | PT dạy hợp đồng B được 450.000đ. Hợp đồng A đã kết thúc (tiền chờ hết). Một lệnh đền A đến muộn (dòng FAILED phát lại, người gọi quên cổng, sổ phụ cũ đã thiếu) → PT mất 225.000đ của B, khách A cầm 1.250.000đ trên hợp đồng 1.000.000đ. Hoặc PT hết tiền → nền tảng ứng 225.000đ, PT "nợ", buổi kế của hợp đồng C PT nhận **0đ**. | `contract-ledger.service.ts:594-603` (nhánh AVAILABLE của `compensateNoShow`), `:675-684` (`compensateLateArrival`), `:1048-1058` (kẹp thu hồi), `:726-749` (`coverShortfall`), `:780-834` (`recoverReceivables`). **Đã chứng minh bằng sổ cái thật: 3 bài `[DEFECT N7]` mới, 3/3 qua = lỗi hiện diện** (mục 1.6). |
| R2 | 🔴 | **Khách trả tiền SAU khi đã hủy → tiền kẹt, không hoàn** cho **đơn dịch vụ cá nhân hóa** và **gói hội viên gym** (hợp đồng PT đã được sửa: `refundUnactivatedContractPayment`). | Khách đang ở trang ngân hàng, bấm hủy đơn/gói trên app, rồi thanh toán xong. Cổng báo "đã trả", dịch vụ trả "ok", giao dịch đánh `ACTIVATED`, tiền nằm trong ngăn chờ của PT/gym/nền tảng, khách không nhận lại gì, không ai biết. Trên dev đã xảy ra 1 lần (500.000đ, đơn `f42b2be2`, D62-B.3). | `ai-service/.../personalized-service.service.ts:329-347` (`updateMany where PENDING_PAYMENT`, đơn đã CANCELLED thì không làm gì và vẫn trả thành công); `gym-service/.../membership.service.ts:410-414` (`before.status !== 'PENDING_PAYMENT'` → `return before`, trong khi `cancelPending` `:218-223` cho phép hủy gói chờ thanh toán); `payment-service/.../reconciliation.service.ts:168-196` (`activateOrRefund` chỉ hoàn cho `PT_CONTRACT`). `CODE AUDIT`. |
| R3 | 🔴 (cổng) | **Chưa biết quy mô tiền tồn đọng ở production.** Dev có: 7 sổ phụ PENDING âm tổng 5.500.000đ, 3.200.000đ khách kẹt ở hợp đồng đã chết, 920.000đ khách nhận hoàn vượt, nợ PT 70.000đ do lỗi nền tảng. Production chưa kiểm kê (D63: chỉ đọc, Ngài chạy). Nếu production giống một phần dev, mọi sổ phụ âm sẽ khiến nhánh R1 kích hoạt thật. | — | `ĐỌC DB DEV` (D62, `AUDIT_D57_5_6`). Script sẵn: `_warroom/evidence/obligations_inventory_D57_{user,payment}.sql`, `post-deploy-state-check.ts`. |

Mức 🟡 và ⚪ ở mục 5. Không có phát hiện nào cho thấy tiền đang bị mất/trả hai lần **trong luồng bình thường đã được Phase 0 bảo vệ** (race/timeout/đa instance: xanh theo `AUDIT_D57`, `D64_TEST_CLASSIFICATION`).

---

## 1. N7 / D48 — truy nguyên MỌI đường rút ví gộp / nền tảng ứng / nợ PT

Ký hiệu: `PS` = `backend/services/payment-service/src/services`, `US` = `backend/services/user-service/src/services`. Mỗi PT / gym / REVENUE có MỘT ví, mỗi ví MỘT ngăn AVAILABLE gộp mọi hợp đồng. "Tiền chờ của hợp đồng" = `ownPending(ops, ví, mã giao dịch)` (`PS/contract-ledger.service.ts:94`): tổng dòng PENDING mang mã giao dịch của hợp đồng — đây là cơ chế đúng, được dùng cho mọi nhánh PENDING.

### 1.1 Bảng đường tiền (payment-service) — phiên bản đã kiểm lại với mã HIỆN TẠI

| Mã | Hàm (`PS/contract-ledger.service.ts`) | Kích hoạt | Số tiền | Thứ tự nguồn | Có lấy tiền hợp đồng KHÁC? |
|---|---|---|---|---|---|
| P1 | `compensateNoShow` `:563-640` | PT vắng / PT hủy <24h / PT chặn ngày / phòng đóng không PT / admin xác nhận PT vắng / PT thừa nhận | 1 buổi = `price/total` chia PT/gym/nền tảng theo tỷ lệ chụp | mỗi bên: (1) `ownPending` của hợp đồng → (2) **AVAILABLE gộp** (`:594`) → (3) phần thiếu `coverShortfall` (`:620`) | **CÓ** ở bước 2 (PT, gym, REVENUE) và 3 |
| P2 | `compensateLateArrival` `:650-715` | PT vào phòng online muộn | nửa buổi | như P1 (`:675`, `:695`) | **CÓ** |
| P3a | `terminateContract` — kẹp thu hồi `:1048-1058` | `gap = entitlement − alreadyReleased < 0`: người gọi gửi `alreadyReleased` lớn hơn quyền cuối | phần "đã giải phóng quá" | **AVAILABLE gộp** của PT/gym/REVENUE, ghi lại vào PENDING hợp đồng rồi bị xả thành `forfeited share` cho REVENUE | **CÓ**; kết quả: tiền kiếm ở B chuyển sang doanh thu nền tảng |
| P3b | `terminateContract` — `residue < 0` `:1124-1132` | tiền chờ của hợp đồng đã thiếu so với số hoàn khách | phần thiếu | `coverShortfall` | **CÓ** (nền tảng ứng + nợ PT) |
| P4 | `coverShortfall` `:726-749` | gọi từ P1, P2, P3b, `refundUnactivatedContractPayment :347`, `membership-ledger settleMembershipReferral :88`, `personalized refundOrder :191` | phần thiếu | trừ **AVAILABLE gộp REVENUE**, ghi `PartnerReceivable` (nợ PT/gym) | **CÓ**; đây là "nền tảng ứng" + "nợ tự động" |
| P5 | `recoverReceivables` `:780-834` | mỗi lần PT/gym được GHI CÓ vào AVAILABLE: `releaseSession :513`, `terminateContract :1037`, `releasePtHoldback :1225`, `resolveUnresolvedSession :1369`, hội viên (`membership-ledger :302,:317`), cá nhân hóa (`personalized :102`) | tối đa phần vừa ghi có | khấu từ khoản VỪA ghi có (không rút số dư cũ), trả về REVENUE | **CÓ**: nợ sinh ở hợp đồng A bị thu từ thu nhập hợp đồng C |
| A2 | `clawbackMembershipReferral` (`PS/membership-ledger.service.ts` ~`:150-200`) | admin hoàn gói hội viên | hoa hồng giới thiệu | PENDING giao dịch đó → **AVAILABLE gộp của PT** → `PartnerReceivable` | CÓ (sản phẩm khác — mục 6, DQ-3) |
| A3 | `personalized refundOrder` (`PS/personalized-service-ledger.service.ts` ~`:150-215`) | hoàn đơn cá nhân hóa | phần PT đã nhận | PENDING đơn → **AVAILABLE gộp** → `coverShortfall` | CÓ (sản phẩm khác — DQ-3) |

KHÔNG rút ví gộp (đúng N7): đền tự động từ quỹ 10% ở `terminateContract` (`min(h×base, quỹ, PT còn được trả)`, `:995-1000`, đang tắt vì h=0); nhánh `ownPending` của P1/P2; `releaseSession`, `resolveUnresolvedSession` (kẹp theo `ownPending`, phần thiếu chỉ báo `shortfall`, không ứng).

### 1.2 Người gọi phía user-service (`US`) và điều gì thực sự dẫn tới P1–P5

| Việc | Hàm gọi tiền | Vị trí | Hợp đồng nào bị chạm |
|---|---|---|---|
| PT hủy buổi <24h; khách hủy khi PT bị hạn chế (`FORCE_MAJEURE`) | `compensateNoShowMoney` | `booking.service.ts:968` (`cancelSession`) | hợp đồng của buổi |
| PT tự nhận vắng / khách báo vắng + PT đồng ý | `compensateNoShowMoney` | `booking.service.ts:1068` (`markNoShow`) | như trên |
| Admin phán PT vắng (hợp đồng còn chạy) | `compensateNoShowMoney`; hợp đồng đã kết thúc → `resolveUnresolvedSessionMoney(NOT_DELIVERED)` (tiền GIỮ của chính buổi đó — đúng D45/N7) | `booking.service.ts:773` | như trên |
| PT chặn ngày <24h | `compensateNoShowMoney` | `availability.service.ts:475` | mọi hợp đồng có buổi trong ngày |
| Quét đóng phòng: PT không vào / vào muộn | `compensateNoShowMoney` / `compensateLateArrivalMoney` | `room-close-resolution.service.ts:218`, `:289` | hợp đồng của buổi |
| Quét thử lại dòng FAILED | `runSessionMoneyRow` → hai hàm trên | `session-settlement-sweep.service.ts` (`dispatchSessionRow`, `:154-210`); hợp đồng đã kết thúc → dòng bị ĐỖ `ENDED_UNSETTLED`, KHÔNG gọi (comment F4: "would be drawn from the PT's pooled available balance") | — |
| Kết thúc hợp đồng (khách hủy, PT hủy, admin, hết hạn, hoàn thành, khóa PT, khách rút) | `settleContractTermination` → `paymentClient.terminate` | `contract-payout.service.ts:969`; người gọi: `contract.controller.ts:700`, `client-exit.service.ts:205,:219,:325`, `contract.service.ts:210,:1378`, `pt-deactivation.service.ts:345`, sweep `:187` | hợp đồng; P3a/P3b chỉ khi counters lệch hoặc tiền chờ đã thiếu |
| Khách hủy muộn <24h (khách mất buổi) | `releaseSessionMoney` | `booking.service.ts:967` | chỉ tiền chờ của chính hợp đồng (kẹp `ownPending`) — không phải P1–P5 cho tiền hợp đồng khác, **nhưng P5 chạy** (khấu nợ cũ) |

**Điều kiện thực tế để nhánh rút gộp chạy (CODE AUDIT + dữ liệu dev):** tiền chờ của chính hợp đồng không đủ. Trong luồng khỏe mạnh có hiệu lực Phase 0 điều này chỉ xảy ra khi (a) lệnh đền đến SAU kết thúc mà người gọi không chặn (đã chặn ở user-service bằng `CONTRACT_ENDING` và đỗ dòng; payment-service tự nó KHÔNG chặn), (b) sổ phụ PENDING của hợp đồng đã âm do lỗi vét tiền chờ cũ (dev: 7), (c) số đếm của người gọi lệch sổ cái (P3a), (d) nghĩa vụ cũ chưa quyết toán lúc triển khai. Xác suất thấp nhưng **hậu quả là đúng điều D48 cấm**, và bản thân sổ cái không tự bảo vệ — nên là công việc của payment-service, không dựa vào kỷ luật người gọi.

### 1.3 Bất biến phải bảo vệ (sau sửa N7 phải CHỨNG MINH bằng sổ cái thật)

- **I1** Tiền đền/phạt của hợp đồng X chỉ lấy từ tiền chờ + khoản giữ của chính X (`ownPending(…, txnX)`). Không có `debit AVAILABLE` nào mang mã giao dịch X trừ khi nó là khoản trả đã ghi có cho đúng bên đó từ chính X (không có trường hợp nào ở đường đền).
- **I2** Không `debit` ngăn AVAILABLE gộp của PT/gym/REVENUE trong bất kỳ bước PT-vi-phạm / kết thúc nào.
- **I3** Không `coverShortfall` trong đường hợp đồng PT (nền tảng không ứng); **không tạo `PartnerReceivable` mới**.
- **I4** Khách chỉ được ghi có đúng số đã trừ được (tổng thực lấy từ tiền của X). Phần thiếu = **nghĩa vụ chưa thanh toán** (bản ghi bền, hiển thị cho admin/khách), không phải nợ PT.
- **I5** Kết quả/thông báo không bao giờ nói "đã đền đủ / đã hoàn một buổi" khi chi thiếu (trả `paid`, `owed`, `unpaid`).
- **I6** Escrow = Σ claims, không ví âm, mỗi bút toán đúng một lần (khóa idempotency), kẹp `ownPending` không đẩy ngăn âm.
- **I7** Không đổi giao dịch đã quyết toán; không xóa quyền lợi hợp đồng cũ (D48).

### 1.4 Phương án sửa (khuyến nghị đánh dấu ★)

**Lõi (payment-service, một migration cộng):**
- ★ **A. "Chỉ tiền của chính hợp đồng + sổ nghĩa vụ chưa thanh toán."** Bỏ vòng `AVAILABLE` trong `compensateNoShow`/`compensateLateArrival`; bỏ `coverShortfall` khỏi P1, P2, P3b, `refundUnactivated…`; kẹp P3a **không rút** mà ghi nghĩa vụ `OVER_RELEASED` cho admin; thêm bảng `contract_unpaid_obligations` (`id, key UNIQUE (= khóa idempotency của thao tác), transaction_id, contract_ref, kind {NO_SHOW|LATE_ARRIVAL|REFUND_SHORT|OVER_RELEASED}, party, owed, paid, unpaid, status {OPEN|RESOLVED|WAIVED}, created_at, resolved_*`). Khách được ghi có `paid` (không phải `owed`). Kết quả trả thêm `paid/owed/unpaid`. Ưu: đúng D48/D20/D22, đơn giản, không tạo nợ ảo. Nhược: khách có thể nhận ít hơn đã hứa trong ca bất thường → phải có hàng đợi admin + thông điệp đúng sự thật. Công: 4–5 ngày.
- **B. Kẹp theo cờ (strict flag) + giữ code cũ.** Thêm cờ `LEDGER_STRICT_OWN_FUNDS` và giữ nhánh rút gộp khi cờ tắt. Nhược: để nguyên nhánh bị cấm; chỉ nên dùng làm **công tắc hoàn tác khẩn cấp** của A (xem rollback), không phải đích.
- **C. Chỉ chặn ở user-service.** Đã làm (Phase 0). Không đủ: ledger không tự bảo vệ (R1).

**Cách xử lý phần nền tảng và phần thiếu (quyết định DQ-1, mục 7):** khi tiền chờ của chính hợp đồng thiếu, ví dụ buổi 250.000đ = PT 225.000 + nền tảng 25.000, PENDING của A đã 0:

| Phương án | Khách nhận | Nghĩa vụ chưa trả | Ai chịu |
|---|---|---|---|
| S (chặt) ★ | +0đ | 250.000đ OPEN | không ai bị trừ; admin xử lý |
| P (nền tảng chịu phần của mình) | +25.000đ (từ doanh thu AVAILABLE nền tảng, ghi rõ "phần hoa hồng hoàn lại") | 225.000đ OPEN | nền tảng 25.000đ — không phải "ứng thay PT" |
| G (thiện chí do admin duyệt từng khoản) | +250.000đ sau khi admin duyệt, ghi riêng có lý do | 0 | nền tảng 250.000đ, thao tác có kiểm toán, không nợ PT |

(G chính là phương án C của `PT_COMPENSATION_SOURCE_AUDIT.md` mục 5; G có thể chạy trên S hoặc P — chỉ khi Ngài cho phép loại thao tác này.)

**Kẹp thu hồi P3a:** ★ chỉ ghi `OVER_RELEASED` (không rút) — vì ví gộp không phân biệt được tiền của hợp đồng nào còn lại; hoặc giữ rút nhưng tối đa bằng tiền hợp đồng đó đã giải phóng (không xác định được sau khi PT rút tiền) → không khuyến nghị. (DQ-5)

**`recoverReceivables` (P5):** sau A không còn nợ mới. Nợ cũ vẫn bị khấu từ thu nhập hợp đồng khác (dev: 70.000đ). ★ Bước FH-0: **công tắc dừng thu** (`RECEIVABLE_RECOVERY_ENABLED`, mặc định giữ hành vi hiện tại ở dev, đặt `false` ở môi trường thật cho tới khi xem xét từng khoản) + bước FH-8: thao tác tạm ngừng/miễn có kiểm toán (thiết kế sẵn ở `D62 mục C.4`: cột `suspended_at/by/reason/ref`, `waived`, bảng sự kiện chỉ thêm, CAS theo số tiền + mã giao dịch). Không sửa DB trực tiếp, không đánh dấu đã trả.

### 1.5 Xử lý số tiền ĐÃ ứng / nợ đã có — không viết lại lịch sử

1. Giữ nguyên mọi bút toán đã quyết toán, mọi dòng `PartnerReceivable`, mọi khóa `ledger_operations`: phát lại một khóa cũ vẫn trả kết quả CŨ (kể cả phần "fronted") — đúng tinh thần D48 "không đổi giao dịch đã quyết toán".
2. **Cut-off:** từ ngày triển khai FH-1 mọi thao tác MỚI theo quy tắc mới. Dòng đền đang FAILED lúc triển khai (nếu có) khi phát lại lần đầu: trả đến mức tiền chờ của chính hợp đồng, phần thiếu thành nghĩa vụ OPEN (D48: không xóa quyền lợi khách).
3. **Khoản đã ứng / nợ PT hiện có:** đưa vào báo cáo đối soát (trang admin FH-4) với phân loại: (a) lỗi nền tảng (như 70.000đ dev: sinh 100% từ PENDING nền tảng bị vét, PT không làm gì sai — `D62 C.1`) → **tạm ngừng thu rồi miễn** qua thao tác có kiểm toán, nền tảng chịu; (b) do PT vi phạm có căn cứ → quyết định riêng của Ngài từng nhóm; (c) không phân loại được → giữ ngừng thu. Không bao giờ: sửa DB tay, đánh dấu "đã trả", đổi `recovered`.
4. Quyền lợi khách của dòng đền cũ: B của `PT_COMPENSATION_SOURCE_AUDIT` — tất toán đến mức tiền chính hợp đồng, phần thiếu thành nghĩa vụ OPEN hiển thị cho admin (G nếu Ngài duyệt).
5. Dữ liệu tồn đọng khác (D62 A–F) xử lý ở FH-8 theo từng nhóm sau khi có kiểm kê production.

### 1.6 Bài chứng minh lỗi đã thêm (BACKEND INTEGRATION, sổ cái thật)

Tệp: `backend/services/payment-service/src/__tests__/fin-hardening-n7-cross-contract-draw.integration.test.ts` (MỚI; DB cô lập `gymcoach_payment_fin_test`, tạo mới trong container test, `migrate deploy` 11 migration; chốt `_test`). Chạy: 3/3 qua (= lỗi hiện diện), `tsc` payment-service 0. Quy ước `[DEFECT]` giống `timeout-faults`: khi sửa N7 phải **lật** thành `[REGRESSION]`.

| Bài | Số liệu đo được |
|---|---|
| `[DEFECT N7 / P1]` no-show trên A (tiền chờ A đã 0) trừ AVAILABLE gộp PT | ví AVAILABLE PT 450.000 (toàn là tiền của B) → 225.000; REVENUE −25.000; khách A cầm **1.250.000đ trên hợp đồng 1.000.000đ**; kết quả báo `shortfall 0`; escrow vẫn cân (đây là lý do chỉ test kiểu này thấy được) |
| `[DEFECT N7 / P1]` PT hết tiền → nền tảng ứng + nợ PT, nợ bị thu ở HĐ khác | `shortfall 225.000` → 1 `PartnerReceivable` 225.000 của PT; nền tảng chi 250.000; PT dạy 1 buổi hợp đồng **C** nhận **0đ** (225.000 "withheld against outstanding debt") |
| `[DEFECT N7 / P2]` terminate kẹp thu hồi | PT −225.000 AVAILABLE (tiền B) chuyển thành "forfeited share" của REVENUE; khách A vẫn nhận 1.000.000 |

Ảnh hưởng đã biết khi sửa: `contract-pending-isolation.integration.test.ts` (bài ~dòng 784 "charged to earnings, not to B's pending") hiện ghim hành vi rút gộp là ĐÚNG → phải đổi cùng lúc; `personalized` test ~dòng 916 (A3) thuộc DQ-3.

---

## 2. SETTLING (D57/D60 Giai đoạn 1) — đã giao ở Phase 0 và còn lại

Kiểm trực tiếp với mã HEAD (`CODE AUDIT`), đối chiếu thiết kế `AUDIT_D57_2_4 §4`:

| Hạng mục thiết kế | Phase 0 | Còn lại |
|---|---|---|
| Ý định bền TRƯỚC khi chuyển tiền | ✅ buổi: dòng `session_settlements` ghi cùng giao dịch khóa quyết định (`recordIntent…`, `contract-payout.service.ts:230-253`); kết thúc: `beginContractTermination :801` ghi `CONTRACT_TERMINATE:<id>` + lý do | ❌ **hoàn thành tự nhiên** vẫn ghi trạng thái `COMPLETED` TRƯỚC rồi mới ghi ý định (`contract.service.ts:196-211`, `:981-1000`): chết giữa hai lệnh → hợp đồng COMPLETED, không dòng ý định, sweep không thấy, PT/gym không được top-up (tiền kẹt trong pending). Không phát hiện được bằng truy vấn nào hiện có (X-02 báo WARN/FAIL nhưng chỉ khi chạy tay) |
| Snapshot bất biến của yêu cầu | ⚠️ KHÔNG có cột. Số đếm "đóng băng" gián tiếp bằng cách CHẶN mọi thao tác tiền khi đang kết thúc (409 `CONTRACT_ENDING`, D59); thử lại tính lại từ hợp đồng (tất định). Lý do kết thúc lưu ở `reason` | ❌ `request_snapshot jsonb` (cấu trúc chứ không dựa vào việc mọi đường mã tôn trọng cổng chặn) — thấp hơn ưu tiên sau khi có fingerprint |
| Trạng thái UNCONFIRMED / NEEDS_HUMAN / CONFLICT | ⚠️ mã hóa bằng **tiền tố chữ trong `last_error`** (`ENDED_UNSETTLED:`, `NEEDS_RECONCILIATION:`, `CONFLICT:`; `session-settlement.repository.ts:9-24`), enum vẫn `PENDING/PROCESSING/SETTLED/FAILED` (`schema.prisma:1189`). Ngưỡng cảnh báo 8 / trần 12 (`session-settlement.service.ts:86-96`) | ❌ trạng thái thật trong enum + cột (migration M1) — hiện mọi truy vấn phụ thuộc `startsWith` trên chuỗi lỗi, dễ vỡ và không lập chỉ mục được |
| Áp kết quả đúng một lần | ✅ `settleOnce` + `apply` cùng giao dịch (`repository :115-122`, `settleTracked :163-169`); thua lật = không áp | — |
| Lease + hàng đợi đa instance | ⚠️ `claim` CAS theo `updatedAt` stale 2 phút (`repository :73-90`), cờ `running` trong bộ nhớ (`sweep :69`); kiểm chứng `mi-races 13/13`, `mi-crash 14/14` | ⚪ `lease_until` + `FOR UPDATE SKIP LOCKED`: tối ưu hàng đợi/độ trễ phục hồi (hiện ~3 phút), **không phải** điều kiện đúng đắn. Khuyến nghị làm sau, hoặc không |
| 202 SETTLING | ❌ trả **409 `CONTRACT_ENDING`** (D59 đã chốt "không báo đã kết thúc khi bút toán còn xử lý") | ⚠️ khách thấy lỗi dù đã được hoàn; muốn 202 + chữ "Đang chốt hợp đồng" cần sửa UI web/mobile (cần Ngài cho phép) |
| Kết thúc đồng thời / thử lại cùng ý định | ✅ (`ending-intent 7/7`, `race-family 23/23`) | — |
| **D65-B** tách phần hoàn chắc chắn khỏi khoản chưa xác minh | ❌ `KNOWN-GAP D64-B`: MỘT dòng buổi đã đỗ chặn **cả** việc kết thúc hợp đồng với mọi lý do (`settlement-parked-row-blocks-ending.integration.test.ts` 3/3). Ví dụ 5.000.000đ/10 buổi: 4 buổi đã giao, release buổi 4 thất bại 12 lần → đỗ; khách hủy: 3.000.000đ hoàn được kẹt đến khi người xử lý dòng 450.000đ. Dòng đỗ còn **giữ khóa** `SESSION_RELEASE:<id>` (buổi giao thật sau này không được gửi) | ❌ cần thiết kế dưới đây; **phụ thuộc tra cứu theo khóa (mục 3)** |
| Thứ tự `UNRESOLVED_SESSION_RESOLUTION` sau kết thúc | ✅ (`hasUnconfirmedTermination` trong `runSessionMoneyRow`/`assess…`) | — |
| Graceful shutdown, `stop_grace_period 45s`, back-off, chống nghẽn dòng mồ côi | ✅ (Phase 0 + D64/D65; `SETTLEMENT_SWEEP_PARK_ORPHANS=false` mặc định) | — |
| API/báo cáo cho người xử lý dòng đỗ | ❌ `findNeedingAttention` (`repository :227`) CÓ NHƯNG KHÔNG CÓ route; không đường admin gỡ/giải quyết; chỉ log `[MoneyAttention]` | → trang đối soát (FH-4) |

**Thiết kế D65-B (đề xuất):** khi kết thúc gặp một dòng buổi chưa xác minh (FAILED/PARKED/CONFLICT-free), user-service **tra cứu theo khóa** payment-service: (a) *đã thực hiện* → áp kết quả đã lưu tại chỗ (`releasedTo*`/`compensatedSessions`) rồi kết thúc bình thường; (b) *chưa thực hiện* → coi buổi như "buổi đang giữ" đã có sẵn (`unresolvedSessions`, D45-L3/D52): hoàn ngay phần chưa dùng chắc chắn, GIỮ giá trị buổi trong tiền chờ của chính hợp đồng, dòng chuyển sang `UNCONFIRMED` + đường admin; giải quyết sau bằng `UNRESOLVED_SESSION:<id>` (release → DELIVERED; đền vắng → NOT_DELIVERED = hoàn khách từ chính số tiền giữ — cũng thỏa N7); (c) payment không trả lời → không thể kết thúc (cũng không thể chuyển tiền) — giữ `CONTRACT_ENDING`. Phải có **fencing** phía payment (mục 3.3) để một lệnh release đến muộn không ăn mất khoản giữ. Dòng "premise void" (buổi chưa giao) → trạng thái cuối riêng, không giữ khóa.

---

## 3. Payment idempotency (Giai đoạn 2, D60)

### 3.1 Hiện trạng (`CODE AUDIT`)
- `withIdempotentLedgerOp` (`PS/ledger-idempotency.ts:23-29`): theo khóa, `findUnique` → trả `result` cũ NGUYÊN VĂN; nếu chưa có thì chạy + ghi cùng giao dịch ví. Nguyên tử tốt, **không so tham số**: cùng khóa + giá/hợp đồng/lý do khác = 200 với kết quả cũ (bài `[KNOWN-DEFECT/P2]` ở `cross-service-money-timeout-faults:188`). Chỉ `/payments/checkout` có `computeFingerprint` + 409 (`internal.routes.ts:~345`).
- Không route tra theo khóa (bảng `ledger_operations`: `key, result, created_at`; không có `transaction_id`, không `kind`).
- payment-service **không đối chiếu** `price/rates/parties` của `release/no-show/late/terminate/resolve` với giao dịch đã thanh toán (`txn.amount` + `metadata.rates/parties` chụp lúc checkout, `internal.routes.ts:~395-410`); chỉ `refundUnactivated…` dùng `txn.amount` (`:328`). Người gọi gửi sai `ptUserId` ⇒ `ownPending` = 0 ở ví PT khác ⇒ (hiện) rút AVAILABLE ví PT sai.

### 3.2 Thiết kế
- **FH-2a — Tra cứu chỉ đọc (không migration):** `GET /internal/ledger-operations/:key` → `200 {key, kind (suy từ tiền tố), result, createdAt}` | `404`; `POST /internal/ledger-operations/lookup {keys[≤100]}`; `GET /internal/ledger-operations?prefix&since&cursor&limit≤200` cho quét mồ côi. Bảo vệ `serviceSecretMiddleware` (đã có cho `/internal`), không nằm trong gateway, log truy cập (số khóa, người gọi), không tạo bút toán, giới hạn tốc độ. Tương thích: dùng cột có sẵn.
- **FH-2b — Fingerprint (migration cộng):** `ALTER TABLE ledger_operations ADD COLUMN request_fingerprint text NULL, ADD COLUMN transaction_id text NULL, ADD COLUMN kind text NULL` + chỉ mục `(transaction_id)`; `withIdempotentLedgerOp(ops, key, fingerprint, run)`; lệch → `IdempotencyKeyConflictError` → **409 `IDEMPOTENCY_KEY_CONFLICT`** (user-service ánh xạ thành `CONFLICT:` đỗ + cảnh báo, không thử lại). **Trường tham gia fingerprint = chỉ trường BẤT BIẾN**: loại + `transactionId`, `price`, `totalSessions`, `rates`, `parties`, `reason`/`outcome`; KHÔNG đưa `unresolvedSessions`/`usedSessions` của `terminate` vào so sánh cứng (chúng thay đổi hợp lệ sau kết thúc khi buổi giữ được giải quyết — `contract-payout.service.ts:951-953`), chỉ ghi/so mềm. **Tương thích khóa cũ:** hàng `request_fingerprint IS NULL` → phát lại như hôm nay (không so), tính số liệu; không "điền bù" fingerprint cho hàng cũ.
- **Ràng buộc với giao dịch (cùng migration, không cần cột):** từ chối `422 REQUEST_DOES_NOT_MATCH_TRANSACTION` khi `price ≠ txn.amount`, `rates ≠ metadata.rates`, `parties ≠ metadata.parties` (bỏ qua có log với giao dịch cũ thiếu metadata). Đóng đường "đúng khóa nhưng sai bên → rút nhầm ví".
- **FH-2c — Fencing:** `releaseSession` / `compensate*` sau khi đã có `CONTRACT_TERMINATE:<txn>`: không được ăn khoản GIỮ của buổi treo (`UNRESOLVED_HELD_MARKER`): chỉ `resolveUnresolvedSession` được dùng khoản giữ. Hiện `releaseSession` chỉ kẹp `ownPending` nên một release trễ (payment chậm hơn timeout 15–20 s của user-service) sau khi kết thúc đã giữ n buổi có thể tiêu khoản giữ của buổi khác. (🟡, mục 5.)

### 3.3 Đường user-service dùng tra cứu để đối soát
1. Sweep: dòng `UNCONFIRMED`/FAILED lần thử ≥ ngưỡng cảnh báo → tra cứu trước khi gửi lại; có → áp kết quả (không gửi), không → gửi lại. Ít tải hơn, bớt vòng lặp vô ích.
2. `completeContractTermination` (`contract-payout.service.ts:949-1025`): xác nhận kết quả khi phản hồi mất (hiện chỉ "phát lại cùng khóa").
3. D65-B (mục 2): quyết định *giữ* hay *áp* một dòng buổi.
4. `resolveUnresolvedSessionMoney` khi payment trả `NO_UNRESOLVED_HELD`/`ALL_UNRESOLVED_RESOLVED`: phân biệt "đã giải quyết" với "chưa bao giờ giữ" (hiện suy diễn, `:313-316`).
5. Trang đối soát (FH-4 V2): khóa có ở payment mà không có ý định (bút toán mồ côi: đúng loại X-05/§2.1a của audit) và ngược lại (X-04); `post-deploy-state-check` chuyển từ truy vấn chéo DB sang gọi API.
6. Idempotency PHÍA KHÁCH (`Idempotency-Key` cho `terminate/pay/cancel/no-show/confirm/…`, `AUDIT_D57_2_4 §5`, migration M3 user-service): **không thuộc gói này** (D60: giai đoạn 3, sau khi backend ổn; header tùy chọn). Giữ ở backlog có điều kiện.

---

## 4. Trang admin đối soát CHỈ ĐỌC (D64-D/E, D65-E)

**Nguồn dữ liệu & API (không sửa `backend/gateway/src/routes/proxy.routes.ts`):** gateway đã proxy `/admin/sessions/*` → user-service và `/admin/payments/*` → payment-service (cả hai đã `requireRoles('ADMIN')`, `proxy.routes.ts:~1343,~1603`), nên đặt route mới dưới hai tiền tố đó.

| Nhóm | Nguồn | API đề xuất | Ghi chú |
|---|---|---|---|
| Dòng settlement cần người (`NEEDS_RECONCILIATION`, `CONFLICT`, kẹt `PROCESSING` > stale, đạt trần thử) | user-service `session_settlements` — **đã có** `findNeedingAttention` (`repository :227`, xếp CONFLICT → số tiền → lần thử → tuổi) | `GET /admin/sessions/settlements/attention` | chưa có route; thêm DTO, KHÔNG lộ PII |
| Hợp đồng đang CHỐT quá lâu (`CONTRACT_TERMINATION` chưa SETTLED > X phút) | `session_settlements` | cùng route, nhóm `endingsUnconfirmed` | `hasUnconfirmedTermination` đã có |
| Hợp đồng đã kết thúc & đã trả nhưng KHÔNG có dòng kết thúc SETTLED (cửa sổ COMPLETED ở mục 2) | user-service (`contracts` ⟕ `session_settlements`) | nhóm `endedWithoutSettledEnding` | truy vấn mới, trong một DB |
| Tranh chấp theo tuổi (SLA 10/14 ngày, D61) | `GET /admin/sessions/disputed` có sẵn nhưng thiếu `ageDays/slaState` | mở rộng tối thiểu (V1 `AUDIT_D57_5_6 §5.5`) | giữ mốc `disputedAt` đầu tiên (hiện bị ghi đè khi PT phản đối) |
| Sổ phụ PENDING âm / ví âm / ví ≠ sổ | payment-service (đã có truy vấn P-02…P-04 trong `post-deploy-state-check`) | `GET /admin/payments/obligations` → `negativeSubledgers[]` | chuyển SQL thành hàm dùng chung, không nhân đôi logic |
| Khoản phải thu PT còn nợ (tách "đang thu" / "tạm ngừng") | `partner_receivables` | cùng route → `receivables[]` | P-05 |
| Nghĩa vụ chưa thanh toán (sau FH-1) | `contract_unpaid_obligations` | cùng route → `unpaidObligations[]` | điều kiện của D48 "đưa vào báo cáo đối soát" |
| Giao dịch cổng lệch số tiền | có sẵn `GET /admin/payments/gateway-discrepancies` | tái dùng | — |
| PAID nhưng chưa kích hoạt (P-06), tiền kẹt cho hợp đồng/đơn/gói đã hủy (X-03, R2) | payment-service + user/gym/ai | `activationStatus`, `ACTIVATION_FAILED` + danh sách giao dịch PAID quá hạn | phía user-service do khóa chéo DB: V2 qua tra cứu |
| Lệch chéo dịch vụ (X-01…X-05) | cần tra cứu theo khóa (FH-2a) | V2 | trước đó vẫn chạy bằng `post-deploy-state-check.ts` do vận hành |

**Chỗ đặt trong giao diện hiện có:** `AdminFinancePage` đã có 4 tab (`overview/reconciliation/withdrawals/refunds`, `AdminFinancePage.tsx:13-54`); tab **"Đối soát"** hiện chỉ là `AdminReconciliationPanel` (bất biến tổng). Mở rộng tab đó bằng các khối chỉ đọc ở trên (không thêm trang mới — tránh bùng nổ trang). **Không nút chuyển tiền.** Cảnh báo `[MoneyAttention]` giữ nguyên (cần Ngài/vận hành nối bộ lọc log → alert). **Việc sửa giao diện cần Ngài cho phép riêng** (ghi nhớ: không sửa UI khi chưa cho phép); phần API/DTO có thể làm trước và kiểm bằng `REAL HTTP` mà không đụng UI.

---

## 5. Rủi ro tiền khác tìm thấy (🔴/🟡/⚪ — D71)

🔴 đã nêu ở mục 0 (R1, R2, R3).

| Mức | # | Vấn đề | Tác động | Bằng chứng | Gói sửa |
|---|---|---|---|---|---|
| 🟡 | Y1 | **Hoàn thành tự nhiên: trạng thái trước, ý định sau** (mục 2) | chết đúng giữa hai lệnh → PT/gym không bao giờ được top-up, tiền kẹt pending; không có truy vấn tự phát hiện | `contract.service.ts:196-211,:981-1000` | FH-3 |
| 🟡 | Y2 | **D64-B / D65-B:** một dòng buổi đã đỗ chặn kết thúc cả hợp đồng + giữ khóa idempotency | tiền hoàn của khách kẹt vô hạn (ví dụ 3.000.000đ), không công cụ admin | `settlement-parked-row-blocks-ending.integration.test.ts` | FH-3 (+FH-2a, FH-4) |
| 🟡 | Y3 | **payment-service tin con số của người gọi** (không fingerprint, không đối chiếu giao dịch) | một lỗi/thao túng ở user-service → rút nhầm ví/hợp đồng; hiện bị che bởi `ownPending` nhưng nhánh rút gộp biến nó thành rút tiền thật | mục 3.1 | FH-2b |
| 🟡 | Y4 | **Release/đền đến muộn sau khi kết thúc đã giữ buổi** có thể tiêu khoản giữ của buổi khác | PT nhận hai lần cho một buổi, khoản giữ cạn → `shortfall` | `releaseSession` chỉ kẹp `ownPending` (`:475`); cần payment chậm > timeout | FH-2c |
| 🟡 | Y5 | **Thông báo hứa hoàn không phụ thuộc kết quả**: "Bạn được hoàn tiền một buổi vào ví" gửi vô điều kiện, có khi trước cả khi tiền chuyển | vi phạm D48 "không báo đã đền đủ khi chi thiếu" khi có shortfall | `booking.service.ts:784,:1076`, `availability.service.ts:487`, `room-close-resolution.service.ts:225,:294` | FH-6 (sau FH-1) |
| 🟡 | Y6 | **Nợ cũ vẫn được thu từ thu nhập hợp đồng khác** (7 chỗ gọi `recoverReceivables`, không công tắc) | PT mất tiền cho lỗi của nền tảng (dev: 70.000đ) | `D62 C.1-C.2` | FH-0 (công tắc) + FH-8 |
| 🟡 | Y7 | A2/A3 (hoa hồng giới thiệu, hoàn đơn cá nhân hóa) cùng kiểu "rút gộp + nợ PT" | cùng D48 nhưng khác sản phẩm — chưa có quyết định | mục 1.1 | DQ-3 |
| 🟡 | Y8 | **Dữ liệu dev đã hỏng chưa sửa** (5.500.000 / 3.200.000 / 920.000 / 70.000) và production chưa kiểm | R3 | D62 | FH-0 → FH-8 |
| ⚪ | Z1 | Thanh toán hai lần cho cùng hợp đồng (mỗi lần `/pay` sinh `attemptId` mới) → giao dịch thứ hai được hoàn đủ vào VÍ (không về thẻ) | khách phải rút ví | `AUDIT_D57_2_4 §2.7` | idempotency phía khách (backlog) |
| ⚪ | Z2 | Sweep 50 dòng × 15 s khi payment-service sập chặn tick ~12 phút; Lambda margin 30 s < chờ khóa 30 s + cuộc gọi 20 s | trễ phục hồi, không mất tiền | `D64 §3 mục 5, 6` | circuit breaker (backlog, D65-D) |
| ⚪ | Z3 | Yêu cầu rút tiền (PENDING) chưa đặt chỗ nên khấu nợ cùng lúc có thể làm số dư nhỏ hơn dự kiến | lệch nhẹ UX | comment `contract-ledger.service.ts:769-778` | gỡ nếu P5 bị vô hiệu |
| ⚪ | Z4 | Giữ lại 10% (tắt): `HOLDBACK_RELEASE` thiếu khoản đã nhả nếu hợp đồng kết thúc trước lần quét kế (P1 *ngủ*); D49 (`SERVICE_DISCONTINUED_BY_PLATFORM`) chưa làm, `PT_BANNED` còn trong `PT_FAULT_REASONS` (`contract-money.ts:321-325`) | chỉ khi bật 10% | `AUDIT_D57_2_4 §2.5` | FH-9 (điều kiện trước khi bật) |
| ⚪ | Z5 | Rút tiền: `markPaid` là chuyển khoản THỦ CÔNG của admin (đã có khóa idempotency + ngăn LOCKED); không có chi trả tự động | quy trình vận hành | `withdrawal.service.ts` | ngoài phạm vi |
| ⚪ | Z6 | Cổng ZaloPay/PayOS/MoMo chặn production bằng cờ `*_PRODUCTION_VERIFIED`; VNPay đã xác minh số tiền | cổng cần xác minh thật trước tiền thật | `gateway-policy.ts` | thuộc M-C, ngoài gói này |

Không phát hiện: trả hai lần ở cùng một endpoint khi timeout + gửi lại (khóa sổ cái chặn, `AUDIT_D57_2_4 §3`); race kết thúc/đền (Phase 0 xanh).

---

## 6. KẾ HOẠCH THỰC HIỆN — các lát, độc lập kiểm thử

Quy ước mọi lát: DB riêng `*_test`; migration viết tay, chỉ cộng; chạy sổ cái thật (không giả ranh giới tiền); nhãn bằng chứng đúng loại; không commit/push (Ngài tự commit); mỗi lát báo: gốc lỗi, tệp, migration, test + số, sổ cái trước/sau, race đã kiểm, rủi ro, tách commit được không (D51).

Ước lượng = ngày công 1 lập trình viên gồm kiểm thử (ước lượng của tại hạ, chưa đo).

### FH-0 — Kiểm kê production + công tắc dừng thu nợ (0,5 ngày mã + việc của Ngài)
- **Phạm vi:** (a) Ngài/vận hành chạy CHỈ ĐỌC trên replica/snapshot: `obligations_inventory_D57_{user,payment}.sql` + `post-deploy-state-check.ts` + `PT_COMPENSATION_SOURCE_AUDIT.md` mục 4 (Q-A…Q-F); không in bí mật (D63). (b) payment-service: biến `RECEIVABLE_RECOVERY_ENABLED` đọc lúc gọi trong `recoverReceivables` (mặc định bật = hành vi hiện tại; đặt `false` ở môi trường thật). Không migration.
- **Phụ thuộc:** quyết định DQ-4. **Test:** bài ledger thật: tắt cờ → buổi kế của PT có nợ không bị khấu, nợ giữ nguyên, escrow cân; bật → như cũ. **Chấp nhận:** có số liệu production (hoặc ghi "chưa có") trước FH-1; cờ có test. **Rollback:** đặt lại cờ. **Phải xong trước tiền thật:** có.

### FH-1 — Sửa N7: chỉ tiền của chính hợp đồng + nghĩa vụ chưa thanh toán (4–5 ngày)
- **Phạm vi:** payment-service `contract-ledger.service.ts` (P1, P2, P3a, P3b, `refundUnactivated…` bỏ `coverShortfall`), route `/internal/contracts/{no-show,late-arrival,terminate}` trả `paid/owed/unpaid`; **migration cộng** `contract_unpaid_obligations` (+ chỉ mục `(status)`, `(transaction_id)`); user-service chỉ đọc kết quả mới (`compensateNoShowMoney`/`late`/`terminate` + log; `validate` thêm `paid ≤ owed`). Không đổi `contract-money.ts` (công thức). Không đổi tỷ lệ chia.
- **Phụ thuộc:** DQ-1, DQ-2, DQ-5 (mục 7); nên sau FH-0. **Công tắc hoàn tác:** `LEDGER_STRICT_OWN_FUNDS` (mặc định BẬT); tắt = hành vi cũ, **chỉ để hoàn tác khẩn cấp** (ghi rõ).
- **Test (sổ cái thật):** lật 3 bài `[DEFECT N7]` → `[REGRESSION]` (PT còn 450.000, khách chỉ nhận đúng số trừ được, 0 `PartnerReceivable`, REVENUE không đổi, nghĩa vụ OPEN đúng 1 dòng, escrow cân, `assertBooksSound`); lật bài ~784 của `contract-pending-isolation`; **thử lại cùng khóa** → đúng 1 nghĩa vụ; **hai đền đồng thời** cho 2 hợp đồng cùng PT → mỗi bên chỉ chạm tiền của mình; **liên dịch vụ** (user-service ↔ payment-service thật): đền sau kết thúc → khách nhận phần có, thông báo dùng số thật; **đa instance**: 2 tiến trình user-service phát lại cùng khóa → 1 nghĩa vụ; **crash**: kill giữa lúc payment commit và `settleOnce` → phát lại trả kết quả cũ, không nghĩa vụ trùng. Kiểm hồi quy: `contract-ledger`, `contract-pending-isolation`, `unresolved-sessions`, `compensated-session-termination`, `pt-holdback`, `cross-service-money*` (12/8/7/3/23), `timeout-faults` 31, `restart-recovery`, `mi-*`.
- **Chấp nhận:** I1–I7 (mục 1.3) có bài chứng minh; khóa cũ phát lại cho kết quả cũ; không đổi giao dịch đã quyết toán. **Rollback:** tắt cờ → hành vi cũ; bảng nghĩa vụ giữ nguyên (cộng). **Phải xong trước tiền thật:** có.

### FH-2a — Tra cứu theo khóa, chỉ đọc (1,5 ngày)
- payment-service route + `service-secret` + log; user-service `payment.client` thêm `lookupLedgerOperation(s)`. Không migration, không bút toán. **Test:** 404 khi chưa có; 200 trả đúng `result` sau thao tác thật; nhiều khóa; chứng minh không ghi (đếm hàng trước/sau, kết nối `READ ONLY` cho tuyến đọc); từ chối không có secret; chịu tải 100 khóa. **Phụ thuộc:** không. **Chấp nhận:** đối soát D65-B có thể xác định "đã/chưa thực hiện". **Rollback:** gỡ route (không dữ liệu). **Trước tiền thật:** có (điều kiện của FH-3).

### FH-2b — Fingerprint + đối chiếu giao dịch + fencing (3–4 ngày)
- **Phạm vi:** migration cộng `ledger_operations(request_fingerprint, transaction_id, kind)`; `withIdempotentLedgerOp` nhận fingerprint; 409 `IDEMPOTENCY_KEY_CONFLICT`; 422 `REQUEST_DOES_NOT_MATCH_TRANSACTION`; fencing (mục 3.2); user-service ánh xạ 409/422 → `CONFLICT:` (đỗ + `[MoneyAttention]`), không thử lại.
- **Test:** 4 dạng đã chứng minh ở `timeout-faults:188` lật từ `[KNOWN-DEFECT]` → `[REGRESSION]` (cùng khóa khác giá / hợp đồng / lý do / kết quả → 409, không bút toán); khóa cũ không fingerprint phát lại bình thường; sai `ptUserId` → 422, không ví nào đổi; `terminate` phát lại sau khi buổi giữ đã giải quyết (counters khác) vẫn 200 (không so cứng); release muộn sau kết thúc giữ buổi không ăn khoản giữ. **Rollback:** migration cộng giữ nguyên; cờ `LEDGER_FINGERPRINT_ENFORCE=false` chuyển 409 thành chỉ cảnh báo. **Phụ thuộc:** FH-1 (cùng vùng mã — làm sau để khỏi xung đột), FH-2a. **Trước tiền thật:** có.

### FH-3 — SETTLING hoàn chỉnh phần còn lại (8–10 ngày; +2–3 nếu làm 202 và UI)
- **FH-3a (2–3 ngày):** migration M1 tách ra hai tệp: (1) `ALTER TYPE "SessionSettlementStatus" ADD VALUE 'UNCONFIRMED','NEEDS_HUMAN','CONFLICT'` (PostgreSQL không dùng giá trị mới trong cùng giao dịch); (2) cột `request_snapshot jsonb, result jsonb, applied_at timestamptz, conflict_note text, next_attempt_at` (+ tùy chọn `lease_owner/lease_until`), chỉ mục `(status, next_attempt_at)`, điền ngược từ tiền tố `last_error` (NEEDS_RECONCILIATION→NEEDS_HUMAN, CONFLICT→CONFLICT; giữ `ENDED_UNSETTLED:` như nhãn cuối của mồ côi). Chuyển mọi truy vấn `startsWith` sang `status`. Hành vi KHÔNG đổi (refactor có bài ghim). Hợp đồng cũ không ảnh hưởng. Ghi snapshot khi ghi ý định.
- **FH-3b (2 ngày):** hoàn thành tự nhiên: ghi dòng `CONTRACT_TERMINATION` CÙNG giao dịch với `status=COMPLETED` (hoặc `begin…` rồi `complete…` như các đường khác); thêm truy vấn "đã kết thúc + đã trả + không có dòng SETTLED" vào báo cáo (FH-4). Test: kill giữa hai bước (tiến trình thật) → sweep hoàn tất.
- **FH-3c (3–4 ngày):** D65-B (mục 2): dùng FH-2a; test mở rộng `KNOWN-GAP D64-B` → `[REGRESSION]`: ví dụ 5.000.000đ/10 buổi, release buổi 4 đỗ → khách hủy: hoàn 3.000.000đ ngay, giữ 500.000đ chờ đối soát, không trả hai lần dù payment đã thực hiện thật (kịch bản "mất câu trả lời" và "chưa thực hiện" đều kiểm), đường admin xử lý; đa instance + crash.
- **FH-3d (tùy chọn, 2–3 ngày, cần Ngài cho phép sửa UI):** trả `202 SETTLING` thay 409 `CONTRACT_ENDING` cho kết thúc, chữ "Đang chốt hợp đồng và hoàn tiền". **FH-3e (⚪):** lease/SKIP LOCKED — không khuyến nghị làm trước khi đo tải.
- **Rollback:** migration cộng giữ nguyên; cờ `SETTLING_D65B=false` quay về chặn như cũ. **Phụ thuộc:** FH-2a (3c), FH-2b nên xong trước. **Trước tiền thật:** 3a–3c có (3a để quan sát/giám sát được); 3d/3e không.

### FH-4 — Trang đối soát chỉ đọc (V1: 3 ngày API + 1–2 ngày giao diện)
- API mục 4 (user-service dưới `/admin/sessions`, payment-service dưới `/admin/payments`). **Không** sửa `proxy.routes.ts`. Chỉ đọc: kết nối `READ ONLY`, phân trang, không PII. Phụ thuộc: không (khối nghĩa vụ chưa trả sau FH-1; khối chéo V2 sau FH-2a). **Test:** `REAL HTTP` qua gateway thật với tài khoản ADMIN và không-ADMIN (403), dữ liệu dựng từ sổ cái thật (sổ phụ âm, dòng đỗ, nợ); không có route ghi (kiểm). **Giao diện** (tab "Đối soát", `REAL BROWSER` 360/375/390/412, theme hiện có): chỉ làm khi Ngài cho phép. **Trước tiền thật:** có (D65-E: ít nhất một cơ chế phát hiện).

### FH-5 — Hoàn tiền khi thanh toán về cho đơn/gói đã hủy (R2) (3 ngày)
- Tổng quát hóa `activateOrRefund` (payment-service) cho `PERSONALIZED_SERVICE_PURCHASE` và `GYM_MEMBERSHIP` bằng mã `409 NOT_ACTIVATABLE`; ai-service (`activateAfterPayment`) và gym-service (`activateViaTransaction`) trả mã đó thay vì "ok". Dùng lại `refundUnactivatedContractPayment` (khóa theo giao dịch, đã kiểm). **Lưu ý:** gym-service đang do phiên khác sửa → chỉ bắt đầu phần gym-service sau khi họ gộp xong (hoặc làm phần ai-service + payment trước). **Test:** sổ cái thật + dịch vụ thật: hủy trước/trả sau → khách nhận đủ, một lần, thử lại/đồng thời không hoàn hai lần; dữ liệu cũ (giao dịch `ACTIVATED` mà đơn CANCELLED) vào báo cáo FH-4, xử lý ở FH-8. **Trước tiền thật:** có.

### FH-6 — Thông báo trung thực theo kết quả tiền (1 ngày)
- Sau FH-1: thông báo đền/hoàn dùng `paid/owed/unpaid`; khi thiếu: "Đã hoàn X; Y đang được xem xét". Cần Ngài duyệt câu chữ. Test: bài đơn vị + liên dịch vụ. **Trước tiền thật:** có (D48).

### FH-7 — (gộp vào FH-3b/FH-4; không tách)

### FH-8 — Xử lý dữ liệu tồn đọng + thao tác điều chỉnh có kiểm toán (4–6 ngày, SAU kiểm kê production và Ngài duyệt từng nhóm)
- payment-service: thao tác điều chỉnh có kiểm toán (khóa `LEGACY_RESTORE_D62:<giao dịch>`, CAS theo số tiền, bất biến escrow giữ nguyên — thiết kế `D62 A.5`); thao tác tạm ngừng/miễn nợ (`D62 C.4`); migration cộng. Chỉ chạy theo bảng từng giao dịch Ngài đã duyệt (A: sổ phụ âm; B: tiền khách kẹt; C: nợ 70.000; D: hoàn vượt = nền tảng chịu, không trừ ví khách; F: dòng SETTLED thiếu đối ứng = đối soát). Dev: sau khi Ngài quyết các nhóm R-1…R-4 (4.010.000 truy vết được + 1.490.000 quyết riêng). **Test:** mỗi nhóm trên bản sao DB (`*_test`) rồi chạy lại P-03/P-04 = 0. **Trước tiền thật:** có, trừ nhóm production = 0.

### FH-9 — NGOÀI GÓI (giữ TẮT): Financial Hold, giữ lại 10%, M0/M1, D49, SLA, circuit breaker, idempotency phía khách
- Điều kiện trước khi bật 10%: FH-1 xong (đền thống nhất nguồn), FH-2b, M1 két quỹ (khuyến nghị theo `FINANCIAL_HOLD_M0_VS_M1.md`), vá `HOLDBACK_RELEASE` (Z4), D49, Điều 5 điều khoản PT (hiện cố ý không nêu nguồn tiền đền vì N7 — D74; phải cập nhật khi N7 chốt, phiên bản điều khoản mới).

### Thứ tự và phụ thuộc

```
FH-0 ─┬─► FH-1 ─► FH-2b ─► FH-3c ─┐
      │     ▲                     ├─► (cổng tiền thật)
FH-2a ┴─────┘ ─► FH-3a ─► FH-3b ───┤
FH-4 (API V1 song song từ FH-0; khối nghĩa vụ sau FH-1; V2 sau FH-2a) ─┤
FH-5 (song song; phần gym-service sau phiên khác) ────────────────────┤
FH-6 (sau FH-1) ───────────────────────────────────────────────────────┤
FH-8 (sau kiểm kê production + FH-1 + FH-5) ───────────────────────────┘
```
Thứ tự đề xuất: **FH-0 → FH-2a → FH-1 → FH-2b → FH-3a/3b → FH-3c → FH-4 → FH-5 → FH-6 → FH-8**; FH-4 API và FH-5 (phần ai-service/payment) có thể chạy song song với FH-1 (khác tệp). Tổng ≈ 28–36 ngày công (chưa tính 3d/UI ≈ 5–7).

### Trước khi có tiền thật BẮT BUỘC xong
FH-0 (kiểm kê production có số), FH-1, FH-2a, FH-2b, FH-3a–3c, FH-4 (ít nhất API + phát hiện), FH-5, FH-6, FH-8 (nhóm có trong production). **Không bắt buộc:** FH-3d/3e, FH-9. Ngoài gói nhưng cũng là cổng: xoay khóa (Security Hardening), cờ cổng thanh toán, triển khai (migration là bước riêng, sao lưu/khôi phục — D63).

---

## 7. Quyết định cần Ngài (phương án + ví dụ tiền)

Ví dụ chung: hợp đồng 1.000.000đ / 4 buổi, một buổi = 250.000đ = PT 225.000 + nền tảng 25.000; PT cùng có hợp đồng B đã kiếm 450.000đ.

| # | Quyết định | Phương án | Ví dụ |
|---|---|---|---|
| DQ-1 | Khi tiền chờ của chính hợp đồng thiếu lúc đền PT vắng/đến muộn: ai gánh phần thiếu? | **S** (khuyến nghị): khách chỉ nhận đúng phần trừ được, phần còn lại = nghĩa vụ OPEN cho admin · **P**: nền tảng hoàn phần hoa hồng của mình · **G**: thiện chí do admin duyệt từng khoản (không nợ PT) | PENDING hợp đồng = 0: S → khách +0, OPEN 250.000; P → khách +25.000, OPEN 225.000; G → admin duyệt 250.000 từ doanh thu |
| DQ-2 | Buổi chỉ được đền một phần thì có tính là đã dùng/đã đền? | (a) **tính đã đền, phần chưa trả là nghĩa vụ OPEN** (khuyến nghị) · (b) không tính, khách giữ quyền đặt lại buổi | (a) hợp đồng còn 3 buổi, khách chờ 250.000đ · (b) hợp đồng còn 4 buổi, khách không nhận tiền |
| DQ-3 | Mở rộng nguyên tắc D48 (không rút ví gộp, không nợ PT, không ứng) sang hoa hồng giới thiệu (A2) và hoàn đơn cá nhân hóa (A3)? | mở rộng ở lát riêng sau FH-1 / để nguyên | khách hủy gói hội viên sau khi PT đã nhận 100.000đ hoa hồng và đã rút → hôm nay PT bị ghi nợ 100.000đ |
| DQ-4 | Nợ PT đã có: tạm ngừng thu ngay + miễn phần lỗi nền tảng? | ngừng thu toàn bộ rồi xem từng khoản (khuyến nghị) / thu tiếp | dev: 70.000đ, sinh 100% từ lỗi nền tảng; buổi 180.000đ kế tiếp của PT bị khấu 70.000đ nếu không ngừng |
| DQ-5 | Kẹp thu hồi "over-released" khi kết thúc: | chỉ báo nghĩa vụ `OVER_RELEASED`, không rút (khuyến nghị) / giữ rút có trần | counters lệch 225.000đ: hôm nay rút tiền B của PT chuyển sang doanh thu |
| DQ-6 | Cho phép sửa giao diện: 202 "Đang chốt hợp đồng" (FH-3d), câu chữ thông báo (FH-6), tab Đối soát (FH-4)? | cho từng việc / chưa | khách hủy hợp đồng khi mạng chập chờn, hôm nay thấy "thất bại" dù đã hoàn 3.600.000đ |
| DQ-7 | Duyệt bắt đầu sửa payment-service (D60 cho phép ở giai đoạn riêng): FH-0/1/2a/2b/5/8? | duyệt theo thứ tự trên | — |
| DQ-8 | Hoàn thành tự nhiên: ghi ý định cùng giao dịch với trạng thái (khuyến nghị) hay chuyển sang `begin…/complete…` (hợp đồng "đang chốt" ngắn trước khi COMPLETED)? | cùng giao dịch / begin-complete | hợp đồng buổi cuối: COMPLETED ngay hay sau khi payment xác nhận |
| DQ-9 | Ai chạy kiểm kê production (FH-0) và khi nào? | Ngài/ops chạy script chỉ đọc trên replica | chặn FH-8 và đánh giá R3 |
| DQ-10 | M0/M1 chưa chốt — không chặn gói này, nhưng chặn bật 10%. Khuyến nghị cũ vẫn nghiêng M1 | — | — |

---

## 8. Giới hạn của tài liệu này
- Không có số liệu production; số dev lấy từ báo cáo D57/D62 (không đọc lại DB dev trong phiên này).
- Chỉ chạy lại ĐÚNG một tệp kiểm thử (3 bài mới, DB `gymcoach_payment_fin_test`) và `tsc` payment-service; không chạy hồi quy rộng — không phải "full regression".
- Tệp gym-service / `proxy.routes.ts` do phiên khác sửa: chỉ đọc; nhận định R2 phía gym-service dựa trên `membership.service.ts` ở cây làm việc hiện tại.
- Ước lượng công là của tại hạ, chưa đo.
- Tệp đã tạo: `docs/FINANCIAL_HARDENING_PLAN.md`, `_warroom/sessions/S_fin_hardening.md`, `backend/services/payment-service/src/__tests__/fin-hardening-n7-cross-contract-draw.integration.test.ts`; DB kiểm thử mới `gymcoach_payment_fin_test` (container test, không dừng).
