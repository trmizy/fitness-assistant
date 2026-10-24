# Rà soát hệ thống FitnessAssistant — 23/10/2026

Cập nhật 24/10/2026: bốn lỗi được tái hiện dưới đây đã có bản sửa và regression tests; xem [SYSTEM_FIXES_2026-10-24.md](SYSTEM_FIXES_2026-10-24.md). Phần còn lại giữ nguyên bằng chứng tại thời điểm review trước bản sửa.

## Phạm vi và cách đọc kết quả

Snapshot: nhánh `feature/payment-gateways`, HEAD `c4f2cc0d`, có thay đổi sẵn trong workspace. Đọc code triển khai và test làm căn cứ chính; tài liệu lịch sử chỉ để đối chiếu. Không sửa source ứng dụng, không commit, không gửi email hay thực hiện thanh toán.

Đã khảo sát kiến trúc, schema, route/controller, service/repository và các luồng nghiệp vụ chính trên 7 service, gateway, web và mobile. Đây là review diện rộng có đi sâu vào các điểm chuyển trạng thái, phân quyền và tiền; không phải cam kết đã đọc từng dòng của mọi file, audit bảo mật đầy đủ hoặc chứng nhận chạy production.

Nhãn bằng chứng:

- **CODE AUDIT:** kết luận từ code hiện tại.
- **TEST FIXTURE:** chạy logic với dữ liệu/phụ thuộc giả lập; không chứng minh hành vi PostgreSQL hay browser thật.
- Đợt này không thực hiện **BACKEND INTEGRATION**, **REAL HTTP/API** hoặc **REAL BROWSER** xuyên suốt các hành trình nghiệp vụ.

## Các phát hiện cần sửa

### 1. P1 — Refresh đang chạy có thể ghi đè phiên của tài khoản mới

Vị trí: `frontend/web/src/app/services/api.ts:151` và `frontend/mobile/src/services/api.ts:208`.

Kịch bản: tài khoản A bắt đầu refresh → logout → đăng nhập B → phản hồi refresh A đến sau → hàm refresh ghi token A vào storage. Các request tiếp theo có thể chạy với danh tính A dù người dùng vừa chọn B. Xóa React Query cache không ngăn được lần ghi token đến muộn này.

Nguyên nhân: refresh giữ token ban đầu nhưng không đối chiếu phiên hiện tại trước khi ghi kết quả; cơ chế gom request refresh không gắn với danh tính/thế hệ phiên.

**TEST FIXTURE:** lấy đúng hàm refresh trong hai file bằng TypeScript AST, chạy trong VM với HTTP chờ có điều khiển và storage giả lập. Cả web và mobile đều tái hiện ghi đè token B bằng token A. Chưa chạy bằng browser hoặc thiết bị thật.

Hướng sửa: tăng session generation khi login/logout; refresh chỉ ghi token và retry request nếu generation cùng refresh token vẫn thuộc phiên ban đầu. Promise refresh cũng phải gắn với phiên. Kiểm tra cả nhánh refresh thất bại để phản hồi cũ không xóa phiên mới.

### 2. P1 — Một token đặt lại mật khẩu có thể được sử dụng đồng thời hai lần

Vị trí: `backend/services/auth-service/src/services/auth.service.ts:665`, `backend/services/auth-service/src/repositories/auth.repository.ts:164`.

Hàm đọc token, kiểm tra `usedAt`, hash mật khẩu, cập nhật mật khẩu, đánh dấu token đã dùng rồi xóa refresh token bằng những thao tác tách rời. Hai request cùng qua kiểm tra trước lần đánh dấu đầu tiên đều có thể cập nhật mật khẩu; lần ghi sau quyết định mật khẩu cuối cùng.

**TEST FIXTURE:** gọi service thật với repository giả lập, cho hai request đọc cùng snapshot token chưa sử dụng. Kết quả: cả hai thành công, có hai lần ghi mật khẩu. Đây là lỗi bảo đảm dùng một lần; không phải bằng chứng có thể đoán token hoặc reset tài khoản bất kỳ.

Hướng sửa: claim token có điều kiện `usedAt IS NULL` và chưa hết hạn, cập nhật mật khẩu và thu hồi refresh token trong cùng transaction; chỉ request claim thành công được tiếp tục. Bổ sung test concurrency trên PostgreSQL riêng.

### 3. P1 — Duyệt rút tiền có thể ghi đè quyết định từ chối vừa hoàn tất

Vị trí: `backend/services/payment-service/src/services/withdrawal.service.ts:175`, `:199`, kiểm tra thêm đường `markPaid` ở `:236` khi sửa.

`approve` đọc trạng thái PENDING trước khi vào khóa ví, sau đó cập nhật APPROVED không kèm điều kiện trạng thái. `reject` có thể ghi REJECTED trong khoảng chờ đó. Approval tiếp tục sẽ khóa tiền AVAILABLE → LOCKED và ghi đè REJECTED bằng APPROVED.

**TEST FIXTURE:** gọi approve/reject thật, giả lập khoảng chờ trước khóa ví. Quan sát REJECTED đã được lưu, sau đó bị chuyển thành APPROVED và 100 đơn vị tiền bị khóa. Không có chuyển khoản thật; chưa chứng minh mất tiền hoặc chi hai lần trên database.

Idempotency key của từng ledger operation giúp chống lặp cùng thao tác, nhưng không tự giải quyết xung đột giữa approve/reject/pay khác loại.

Hướng sửa: thống nhất thứ tự khóa; đọc lại và kiểm tra trạng thái withdrawal trong transaction chung với chuyển bucket và cập nhật trạng thái. Mọi đường approve/reject/markPaid phải tuân theo cùng quy tắc. Test các cặp thao tác cạnh tranh và kiểm tra tổng số dư, trạng thái, ledger sau commit.

### 4. P2 — HTTP 429 khi refresh bị coi là phiên đã bị thu hồi

Vị trí: `frontend/web/src/app/services/api.ts:172`, `frontend/mobile/src/services/api.ts:229`.

Code trả `null` cho mọi HTTP 4xx. Caller hiểu `null` là phiên không còn hợp lệ và có đường xóa phiên. Vì vậy response 429 do rate limit có thể khiến người dùng bị đăng xuất dù refresh token vẫn hợp lệ.

**TEST FIXTURE:** mô phỏng response 429 cho đúng hàm refresh của cả hai client; cả hai đều trả `null`.

Hướng sửa: chỉ coi mã xác thực xác định token hết hạn/thu hồi là mất phiên. Lỗi tạm thời như rate limit cần được phân loại riêng và giữ phiên; tránh retry vô hạn. Bổ sung test cho 401 hợp lệ, 429, lỗi mạng và phản hồi của phiên cũ.

## Bản đồ code và logic nghiệp vụ

| Thành phần | Trách nhiệm chính và điểm cần giữ đúng |
|---|---|
| auth-service | Tài khoản, OTP, mật khẩu, access/refresh token, email đăng ký Gym Owner. Có tài khoản GYM_OWNER chưa đồng nghĩa đối tác đã được duyệt hoạt động. |
| user-service | Hồ sơ, PT, gói PT, hợp đồng, lịch/buổi tập, hạn chế PT và thông báo. Snapshot hợp đồng giữ điều khoản tại thời điểm mua. |
| gym-service | Đối tác, hồ sơ pháp lý, thương hiệu/chi nhánh, nhân viên và quyền theo chi nhánh, membership, nội dung listing. |
| payment-service | Checkout, webhook, escrow, phân bổ tiền, hoàn tiền, ví, rút tiền và đối soát. Không lấy trạng thái UI làm bằng chứng đã trả tiền. |
| fitness-service | Bài tập, chương trình/lịch/log, roadmap/phase/cycle, assessment, mục tiêu và chương trình dinh dưỡng. |
| ai-service | Hội thoại/workflow, thu thập slot, đề xuất và xác nhận hành động, kiểm tra an toàn và gọi các domain service. |
| chat-service | Hội thoại, tin nhắn, socket và cuộc gọi; cần phân biệt quyền ở kết nối với quyền nghiệp vụ tại thời điểm thao tác. |
| gateway | Xác thực, đóng dấu danh tính nội bộ, proxy, rate limit, CORS, origin công khai cho email. |
| web/mobile | Giao diện theo vai trò, API adapters, cache, phiên đăng nhập, thông báo và các tiện ích offline. Có hai implementation nên cần test parity. |

### Đăng ký Gym Owner và vận hành đối tác

Luồng email: yêu cầu đăng ký → link xác minh → setup session → đặt mật khẩu/tạo tài khoản → tạo và hoàn thiện hồ sơ đối tác. Token email được hash; có cooldown/cap cho gửi email. Email đã thuộc các vai trò không phù hợp không được tự chuyển thành chủ phòng tập bằng luồng này.

Hồ sơ đối tác có trạng thái riêng: SETUP_INCOMPLETE/ONBOARDING/UNDER_REVIEW/CHANGES_REQUESTED/REJECTED/APPROVED_PAYOUT_PENDING/ACTIVE/SUSPENDED/TERMINATED và trạng thái suy ra khác. Quyền hoạt động phụ thuộc cả tài khoản, xác minh và hoàn tất onboarding.

Các điều kiện nộp hồ sơ gồm thông tin đại diện, thương hiệu, địa điểm, ảnh, pháp lý và điều khoản; các giấy tờ gồm BUSINESS_LICENSE, REPRESENTATIVE_ID, PREMISES_PROOF. Luồng mới còn có điều kiện tiện ích và đề xuất tiện ích đang chờ. Chi nhánh ban đầu và vấn đề cần giải quyết cũng được kiểm tra.

Nhân viên dùng phạm vi của đối tác nhưng vẫn phải giữ actor thực tế để audit. OWNER/MANAGER/RECEPTIONIST/ACCOUNTANT có quyền khác nhau. Chính sách SUSPENDED hiện còn cho một số vai trò vận hành tiếp; không nên hiểu thành khóa toàn bộ mọi thao tác của nhân viên.

Listing có bản nháp/moderation khác dữ liệu công khai và revision để phát hiện cập nhật cũ. Không nên sửa trực tiếp dữ liệu public để né quy trình duyệt.

### Membership, hợp đồng PT và buổi tập

Membership chỉ được bán khi điều kiện đối tác, chi nhánh và gói cho phép. Checkout chưa phải activation. Trường hợp đã trả tiền nhưng không còn kích hoạt được cần đi qua hoàn tiền/xử lý tồn đọng. Tự hủy membership và hủy hành chính không có cùng chính sách hoàn tiền.

Hợp đồng PT giữ snapshot giá, thời lượng, số buổi, điều khoản và tỷ lệ phân bổ. Thay đổi gói niêm yết sau đó không được đổi hợp đồng đã lập. Các mốc xét duyệt, chờ thanh toán, hoạt động và chấm dứt là các chuyển trạng thái khác nhau.

Quyền lợi còn lại được tính từ `totalSessions - usedSessions - compensatedSessions`; không giảm tùy tiện số buổi gốc. Booking có khóa lịch PT/hợp đồng và kiểm tra lại điều kiện sau khóa. Kết quả buổi tập cần nhất quán với quota và settlement intent; xử lý tiền sau đó phải retry được.

Policy đã kiểm tra bằng test: khách hủy đủ 24 giờ giữ quota; khách hủy muộn bị trừ buổi và PT hưởng tiền buổi; PT hủy sớm chuyển lịch; PT hủy muộn hoặc no-show có bồi hoàn; bất khả kháng không áp dụng cùng hình phạt. Mốc đúng 24 giờ thuộc phía đúng hạn.

Hạn chế PT có scope tài khoản hoặc hợp đồng. Khi gỡ, thời gian bị chặn được xử lý để gia hạn; các khoảng chồng nhau cần tránh cộng hai lần. Notification được ghi cùng transaction tại những đường đã đọc rồi mới phát realtime sau commit.

### Dòng tiền

Phân biệt tiền thực trong escrow với quyền nhận tiền trên ví các bên. Pending, available và locked là những bucket khác nhau. Duyệt rút tiền khóa số dư; `markPaid` ghi nhận chuyển khoản mà admin đã thực hiện ngoài hệ thống, không tự gửi lệnh chuyển khoản ngân hàng.

Checkout/webhook cần kiểm tra số tiền, chống xử lý lặp và phối hợp kích hoạt dịch vụ. Có đường xử lý thanh toán đến muộn/trùng, hoàn tiền, settlement intent và reconciliation. Các cơ chế này hữu ích nhưng vẫn cần kiểm thử mất kết nối/retry/crash bằng database thật; test công thức chia tiền không thay thế được.

### Tập luyện, dinh dưỡng và AI

Roadmap → phase → cycle; assessment và quyết định tiến triển có version. Forecast không phải số đo thực tế. Advance cycle phải dùng trạng thái và assessment phù hợp, tránh tạo trùng hoặc bỏ qua điều kiện sẵn sàng.

Nutrition goal là nguồn mục tiêu; chương trình liên kết goal và có kiểm tra macro/consistency. PT truy cập dữ liệu khách dựa trên quan hệ hợp đồng hợp lệ, không chỉ dựa vào role PT.

AI điều phối workflow và đề xuất; domain service và engine quyết định kiểm tra/ghi dữ liệu. Workflow có TTL, bước xác nhận, claim trước ghi và xử lý thất bại. Một số hành động có fingerprint để phát hiện context cũ. Các test safety/validation đã chạy chỉ xác minh logic cụ thể, không chứng nhận chất lượng hay an toàn của mọi câu trả lời mô hình.

### Cloudflare và link email

Chức năng Gym Owner không được thiết kế chỉ cho localhost. `Khoi-dong-Tunnel.bat` phục vụ tunnel gateway; `Khoi-dong-Tunnel-Web.bat` gọi `scripts/dev/tunnel-web.ps1` để public frontend và cập nhật `infra/compose/runtime/public-web-origin`.

Gateway đọc origin công khai qua `PUBLIC_WEB_ORIGIN_FILE`; file quá cũ bị bỏ qua. Auth chọn trusted origin, sau đó `FRONTEND_URL`, cuối cùng mới fallback `http://localhost:5173` tại `auth.controller.ts:168`. Mở tunnel API đơn thuần không bảo đảm host trong email trở thành địa chỉ public của web.

Link có localhost sẽ trỏ về thiết bị đang mở link. Để kiểm tra ngoài máy chủ cần frontend public, API mà frontend gọi cũng truy cập được, cấu hình origin được nhận và email mới được tạo sau cấu hình. Link cũ không tự đổi host. Chưa thực hiện lại hành trình Gmail → trình duyệt điện thoại trong đợt review này.

## Kiểm chứng đã chạy trong đợt review

| Nhóm test được chọn | Số test đạt |
|---|---:|
| Auth: login/refresh, OTP, recovery, partner application | 39 |
| Gym: access, application state, permissions, listing state | 33 |
| Fitness: cycle decision, roadmap forecast, nutrition decision/bootstrap | 97 |
| Payment: contract money, auth header spoofing | 33 |
| AI: hai nhóm safety guard và proposed-change validator | 42 |
| Chat: message validation | 5 |
| Web: active-workout offline queue | 6 |
| User: session outcome, price snapshot, holdback snapshot | 16 |
| Mobile: token, refresh-once, application, contracts, payments, gym/PT listing | 185 |
| Gateway: public web origin, partner application rate limit | 11 |
| **Tổng** | **467** |

Không có test thất bại trong các nhóm trên. Đây là các test được chọn, không phải toàn bộ suite. Các lần chạy backend dùng NODE_ENV=test và URL database giả ở cổng 1 để tránh thao tác dữ liệu thật. Test user có log không ghi được ClientCompatEvent vào database này; test vẫn đạt, nên không coi nó là bằng chứng audit event đã được lưu thành công.

Script bổ sung `reports/system-review-reproductions.ts` chạy được và quan sát **6 trường hợp tái hiện thuộc 4 nhóm lỗi**: reset token, refresh race web/mobile, 429 web/mobile, withdrawal race. Assertions trong script xác nhận lỗi đang tồn tại, không phải test chứng minh bản sửa đã đúng.

Chạy lại bằng PowerShell từ root:

```powershell
$env:NODE_ENV='test'
$env:DATABASE_URL='postgresql://audit:audit@127.0.0.1:1/audit_test'
node --import tsx reports/system-review-reproductions.ts
```

## Khoảng trống và thứ tự xử lý

Ưu tiên sửa ba lỗi P1 trước, sau đó phân loại refresh failure. Mỗi bản sửa cần test chứng minh trước/sau; riêng token reset và withdrawal cần concurrency integration trên database test.

CI đã có fast tests và một gate DB integration riêng; không nên mô tả dự án là không có integration tests. Tuy nhiên web không có script test/typecheck trong package, chat không có script test; `pnpm test` đệ quy không tự chạy các test của hai package chỉ vì file test tồn tại. Cần nối rõ các kiểm tra đó vào CI. Đợt review này chưa chạy lại toàn bộ build/typecheck/lint hay pipeline CI.

Các hành trình cần xác minh tiếp bằng môi trường thật: đăng ký Gym Owner từ thiết bị ngoài LAN qua Gmail; duyệt hồ sơ và chuyển quyền theo chi nhánh; checkout/webhook lặp hoặc đến muộn; buổi tập → quota → phân bổ/hoàn tiền; rút tiền cạnh tranh; PT bị hạn chế rồi mở lại; đổi tài khoản trong lúc request/socket/offline queue đang chạy. Chưa đánh giá tải, khôi phục backup, migration rollout, native build, cuộc gọi trên thiết bị thật hoặc chất lượng Ollama/Qdrant thực tế.

Tài liệu nghiệp vụ tiền có chỗ chưa đồng nhất với code hiện tại, ví dụ diễn giải giảm tổng buổi so với invariant compensatedSessions, và danh sách lý do chấm dứt. Khi sửa cần cập nhật tài liệu theo invariant đã thống nhất, tránh dựa riêng vào comment hoặc báo cáo lịch sử.
