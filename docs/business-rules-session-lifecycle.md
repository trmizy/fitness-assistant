# Vòng đời buổi tập PT — trạng thái, đặt lại lịch, huỷ/bồi thường, check-in

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

## 1. Trạng thái một buổi tập (`SessionStatus`)

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

### Vì sao có `PENDING_CLIENT_CONFIRMATION` thay vì để PT tự quyết

Trước đây PT một mình vừa khai buổi tập đã diễn ra, vừa được trả tiền ngay, không ai kiểm lại.
Giờ PT chỉ **báo cáo**; khách xác nhận, khiếu nại, hoặc im lặng — sau `SESSION_AUTO_CONFIRM_DAYS`
ngày (mặc định 3) hệ thống tự xác nhận thay, để một khách không phản hồi không giữ tiền của PT
mắc kẹt vô thời hạn. Đây cũng là lý do có `PT_NO_SHOW_REPORTED` (chiều ngược lại — khách báo PT
vắng, PT phải phản hồi) và `DISPUTED` (khi hai bên không đồng ý, một quản trị viên phân xử —
màn `/admin/disputes`).

---

## 2. Ma trận hậu quả huỷ/vắng buổi — §0.1

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

---

## 3. Đặt lại lịch (reschedule)

- Bên đề xuất gửi giờ mới; bên kia **chấp nhận** hoặc **từ chối**. Không tự bên nào có thể ép.
- Khi **chấp nhận**, hệ thống **kiểm tra lại slot còn trống** ngay trước khi ghi (`assertSlotBookable`)
  — vì thời gian giữa lúc đề xuất và lúc chấp nhận có thể đã có buổi khác chen vào đúng khung
  giờ đó. Không kiểm tra lại thì hai buổi có thể trùng giờ.
- Yêu cầu đặt lại lịch tự hết hạn sau một khoảng thời gian nếu không ai phản hồi (job nền —
  "Reschedule expiry job", chạy mỗi 10 phút).
- PT **không được công bố lịch rảnh trống** → mọi thao tác đặt lịch (kể cả đặt lại) bị chặn với
  thông báo rõ ràng, thay vì âm thầm coi "trống hoàn toàn" = "rảnh cả ngày" (hành vi cũ, đã đảo
  ngược — xem `money-flow.md` §15 nếu cần bối cảnh các quyết định đảo ngược hành vi khác).

---

## 4. Chính sách quét check-in phòng gym — §0.3

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

## 5. Khiếu nại và phân xử

`DISPUTED` chỉ phát sinh từ hai hướng: khách khiếu nại một `PENDING_CLIENT_CONFIRMATION`, hoặc
PT phủ nhận một `PT_NO_SHOW_REPORTED`. Cả hai đều dừng lại chờ quản trị viên tại
`/admin/disputes` — **không có đường tự động nào giải quyết tranh chấp**, tiền đứng yên
(quota không trừ, không bên nào được/mất tiền) cho tới khi có kết luận kèm ghi chú bắt buộc.

Quản trị viên chọn `COMPLETED` (buổi tập coi như đã diễn ra — trừ quota, PT được trả, theo
đúng công thức giải phóng bình thường) hoặc `CANCELLED` (buổi không diễn ra — không trừ quota,
không ai được trả). Không có lựa chọn thứ ba; quyết định phải rơi vào đúng một trong hai nhánh
tiền đã có sẵn công thức, không tạo nhánh tiền mới chỉ cho riêng trường hợp tranh chấp.

---

## 6. PT báo cáo khách vắng mặt

Song song với `PT_NO_SHOW_REPORTED` (khách báo PT vắng), PT cũng có thể báo **khách** không tới
cho một buổi `CONFIRMED` đã quá giờ mà không ai xác nhận gì. Luồng này tái dùng đúng nhánh
"PT tự nhận khách vắng" của `markNoShow` — khách bị trừ quota (dòng 2/4 tương ứng của ma trận
§2 tuỳ báo trước hay không), không có bước xác nhận hai chiều riêng cho hướng này vì khách
không có động lực tự nhận mình vắng oan.

---

## 7. Liên quan tới `docs/money-flow.md`

Mọi con số tiền tạo ra từ các trạng thái/sự kiện ở tài liệu này đều được tính theo công thức ở
`money-flow.md` — file đó là nơi duy nhất có quyền tính tiền (§12 "Vì sao công thức chỉ nằm ở
payment-service"). Tài liệu này chỉ trả lời "chuyện gì đã xảy ra"; **không bao giờ tự tính lại
số tiền** ở tầng user-service/gym-service.
