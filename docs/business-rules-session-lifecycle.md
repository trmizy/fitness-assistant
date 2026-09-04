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

### 1.1 Trạng thái nào vẫn đang "giữ quyền lợi" (P0 cụm B1)

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

### 1.2 Đặt lịch không bao giờ được double-book PT (P0 cụm B2)

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

### 2.1 Chỉ được báo hoàn thành/vắng mặt sau đúng thời điểm (P0 cụm B3/B4)

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

## 3. Đặt lại lịch (reschedule)

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
