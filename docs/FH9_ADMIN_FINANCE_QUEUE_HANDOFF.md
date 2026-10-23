# FH-9 — Bàn giao hàng đợi ADMIN_FINANCE_QUEUE (khoản tạm giữ thu nhập PT)

Tài liệu vận hành, ngắn. Nguồn sự thật là mã: `backend/services/payment-service/src/services/holdback-review.service.ts`,
`scripts/fh9-holdback-review.ts`, `contract-ledger.service.ts` (`terminateContract`, `releasePtHoldback`).
Tính năng đang TẮT mặc định (`PT_HOLDBACK_NEW_CONTRACTS_ENABLED` không bật) — hiện chưa hợp đồng thật nào có khoản tạm giữ.

## 1. Cái gì rơi vào ADMIN_FINANCE_QUEUE

Hệ thống KHÔNG tự trả tiền từ khoản tạm giữ cho khách trong bất kỳ trường hợp nào. Khi một hợp đồng kết thúc:

- PT hủy / chấm dứt / vắng mặt nhiều buổi, khách đã được hoàn đủ từ tiền của chính hợp đồng, không còn khoản nào chưa xử lý
  → TOÀN BỘ khoản tạm giữ trả về số dư khả dụng của PT ngay lúc kết thúc. Không có mục nào trong hàng đợi.
- Chỉ khi còn một khoản CỤ THỂ, chưa được bảo đảm, của CHÍNH hợp đồng đó, hệ thống giữ lại một "dự phòng" (reserve) và tạo một mục
  trong bảng `pt_holdback_reviews` (handler mặc định `ADMIN_FINANCE_QUEUE`, đổi bằng `PT_HOLDBACK_REVIEW_HANDLER`):

| Loại (`kind`) | Khi nào | Số tiền giữ |
|---|---|---|
| `OPEN_OBLIGATION` | hợp đồng còn nghĩa vụ NO_SHOW / LATE_ARRIVAL mở mà tiền chờ của hợp đồng không đủ trả | phần PT chịu (`floor(chưa trả × tỷ lệ PT)`), tối đa bằng số đang giữ |
| `UNSECURED_DISPUTE` | còn buổi đang khiếu nại mà tiền chờ của hợp đồng không bảo đảm được phần của PT | đúng phần PT chưa được bảo đảm |
| `UNCOMPUTABLE` | có khoản cụ thể như trên nhưng không tính được phần của PT một cách đáng tin cậy | tối đa toàn bộ khoản đang giữ của hợp đồng đó, kèm lý do |

Phần còn lại của khoản tạm giữ (không thuộc dự phòng) đã được trả về PT ngay lúc kết thúc.
`OPEN_OBLIGATION` và `UNSECURED_DISPUTE` tự đóng khi nguyên nhân hết (nghĩa vụ đã xử lý xong / buổi đã được quyết) — job quét
`releasePtHoldback` trả phần còn lại cho PT đúng một lần. `UNCOMPUTABLE` CHỈ đóng bằng quyết định của admin.

## 2. Vai trò (nguyên tắc bốn mắt)

- Người xem xét (`--actor`): kiểm tra chứng cứ, đề xuất quyết định.
- Người phê duyệt (`--approved-by`): một người KHÁC, xác nhận. Hai giá trị trùng nhau (không phân biệt hoa thường) bị từ chối `FOUR_EYES`.
- Cả hai phải là nhân sự được chỉ định tên trước khi bật tính năng (xem mục 6). Mã phê duyệt `--approval-ref` là duy nhất cho mỗi quyết định
  (số phiếu/ticket nội bộ); cùng mã thì lệnh được phát lại an toàn, mã khác trên mục đã quyết bị từ chối `ALREADY_DECIDED`.

## 3. SLA

14 ngày kể từ lúc hợp đồng kết thúc (`PT_HOLDBACK_REVIEW_DAYS`, mặc định 14). Quá hạn: mục hiện "QUÁ HẠN" trong
Admin → Tài chính → Đối soát → "Tiền tạm giữ của PT theo hợp đồng" (ô "Quá hạn xem xét"). Quá hạn KHÔNG tự trả hay tự thả tiền;
mục vẫn chờ quyết định.

## 4. Xem danh sách và quyết định (CLI)

Chạy từ `backend/services/payment-service`. `DATABASE_URL` phải là DB có tên kết thúc `_test`, hoặc thêm
`--i-have-owner-approval=<nhóm>` — chỉ dùng khi có phê duyệt của chủ sở hữu cho môi trường thật.

```
# 1) danh sách mục đang mở (mục quá hạn có tiền tố OVERDUE)
npx tsx scripts/fh9-holdback-review.ts --op=list

# 2) chạy thử (dry-run, MẶC ĐỊNH, không ghi gì)
npx tsx scripts/fh9-holdback-review.ts --op=decide --id=<reviewId> \
  --expected-reserve=<số tiền dự phòng đang thấy, vd 90000.00> --expected-transaction-id=<transactionId> \
  --decision=VERIFIED --verified-amount=<số tiền xác minh> \
  --note="đã kiểm tra gì, chứng cứ nào (vd biên bản, mã khiếu nại)" \
  --actor=<người xem xét> --approved-by=<người phê duyệt khác> --approval-ref=<số phiếu>

# 3) ghi thật: chạy lại đúng lệnh trên, thêm --apply
```

- `--decision=VERIFIED`: PT chịu trách nhiệm `verified-amount` (0 < số tiền ≤ dự phòng, chỉ phần PT chịu). Số đó trả cho khách từ
  khoản tạm giữ của CHÍNH hợp đồng; phần còn lại của dự phòng về PT. Với `OPEN_OBLIGATION`, nghĩa vụ giảm đúng số đó trong cùng giao dịch.
- `--decision=NOT_VERIFIED`: PT không chịu trách nhiệm — toàn bộ dự phòng về PT.
- `--expected-reserve` / `--expected-transaction-id` là kiểm tra so sánh-và-đặt (CAS): phải đúng với những gì người vận hành vừa xem.
  Sai → `CAS_MISMATCH`, không ghi gì.
- Chứng cứ: ghi vào `--note` (tối thiểu vài từ có nghĩa) và lưu hồ sơ/phiếu theo mã `--approval-ref`. Mỗi quyết định thêm một dòng
  vào `pt_holdback_review_events` (chỉ thêm, không sửa/xóa được).
- Nếu khoản tạm giữ không đủ trả số đã xác minh: phần thiếu được ghi thành nghĩa vụ MỞ (OPEN) với khách; nền tảng không ứng tiền,
  không tạo PartnerReceivable.

## 5. Điều không bao giờ xảy ra

- Không tự trả tiền cho khách từ khoản tạm giữ (không do PT hủy, bị khóa, bị hạn chế, khách khiếu nại hay quá hạn).
- Không dùng tiền của hợp đồng khác, không lấy từ số dư khả dụng của PT, không dùng tiền nền tảng/phòng gym; chỉ phần thuộc PT chịu.
- Không trả một khoản hai lần (khóa `HOLDBACK_FAULT_COMP:<contractId>:<approvalRef>`, CAS, giao dịch khóa ví).
- Không giữ khoản tạm giữ chỉ vì "PT hủy hợp đồng" — phải có khoản cụ thể chưa xử lý của chính hợp đồng đó.
- Không áp dụng cho hợp đồng đã tạo trước khi tính năng bật (ảnh chụp `pt_holdback_rate` / `pt_holdback_policy_version` theo hợp đồng).

## 6. Checklist trước khi bật ở môi trường thật

- [ ] Điều khoản PT phát hành CHÍNH THỨC dưới mã phiên bản mới (không còn "draft", ví dụ `2026-10-pt-v1`); `PT_TERMS_IS_DRAFT=false`.
- [ ] Rà soát pháp lý Điều 2 (khoản tạm giữ) và Điều 10 (thông báo dữ liệu cá nhân) đã xong; bỏ dòng "đang chờ rà soát pháp lý — bản nháp".
- [ ] `PT_HOLDBACK_TERMS_VERSION` (user-service) = đúng mã phiên bản chính thức đó.
- [ ] `PT_HOLDBACK_NEW_CONTRACTS_ENABLED=true` (user-service; chỉ đúng giá trị `true`) — chỉ sau khi chủ sở hữu duyệt. Chỉ hợp đồng tạo SAU đó,
      của PT đã xác nhận phiên bản điều khoản chính thức, mới có khoản tạm giữ.
- [ ] Đã áp dụng đủ 5 migration: payment-service `20261022100000_fh9_holdback_bucket_enum`, `20261022100001_fh9_holdback_balance_column`,
      `20261023100000_fh9_holdback_reviews`; user-service `20261022110000_fh9_termination_reason_d49`, `20261022110001_fh9_contract_holdback_policy_version`.
- [ ] Đã chỉ định TÊN người xem xét và người phê duyệt (hai người khác nhau) cho ADMIN_FINANCE_QUEUE, kèm người thay thế khi vắng mặt;
      (tùy chọn) đặt `PT_HOLDBACK_REVIEW_HANDLER` thành tên hàng đợi/người phụ trách.
- [ ] Job quét hoàn trả khoản tạm giữ đang chạy (chạy cùng contract-expiry sweep của user-service, chu kỳ `CONTRACT_HOLDBACK_SWEEP_INTERVAL_MS`,
      mặc định 60 phút) và log không báo lỗi.
- [ ] Có người theo dõi ô "Quá hạn xem xét" và "Xong mà chưa trả" (phải bằng 0) trong trang Đối soát của Admin.
- [ ] Đã thử đúng quy trình mục 4 trên môi trường kiểm thử (dry-run, rồi `--apply`) với hai người thật.
