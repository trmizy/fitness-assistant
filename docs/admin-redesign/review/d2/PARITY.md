# D2 - parity of `AdminDisputes.tsx` (old page vs. new queue)

Old page = `AdminDisputes.tsx` at HEAD 8cd240fc plus the D1 edits (header sentence, `parseDisputeError`). New page = the queue at `/admin/disputes` (`?view=sessions` is where the old list now lives).
Evidence for each tick: **MOCK BROWSER TEST** (Playwright with `page.route`, fixtures; not E2E) unless marked **TEST FIXTURE** / **CODE AUDIT**.

| # | What the old page did | New behaviour | Ticked |
|---|---|---|---|
| 1 | Listed `GET /admin/sessions/disputed` (status DISPUTED), no paging | Same call, "Buổi chưa xử lý" chip, oldest dispute first, no paging (server has none) | [x] |
| 2 | Loading spinner, empty text "Không có khiếu nại nào đang chờ xử lý." | Skeleton, same empty sentence; a failed read is a failure panel with retry (the old page showed an empty list on error) | [x] improved |
| 3 | Per session: scheduled time, contract name | Same ("Buổi tập lúc ...", "Hợp đồng: ...") | [x] |
| 4 | Short client/PT ids ("Khách 1234abcd...") | Short refs kept as "Khách mã xxxxxxxx · PT mã xxxxxxxx" (no names exist in the list, R-04); never a full id | [x] |
| 5 | Badge "Đang khiếu nại" | Replaced by the type badge + SLA chip + age ("Bị khiếu nại 13 ngày trước"); every row is a disputed session so the badge carried no information | [x] changed on purpose |
| 6 | Type badge `data-testid="dispute-type-badge"` with `data-dispute-type` for DELIVERY_DISPUTE / PT_NO_SHOW_CLAIM / CLIENT_NO_SHOW_CLAIM | Same test id and attribute; a session with no type shows "Phân loại tạm (cần phân loại)" | [x] |
| 7 | Evidence boxes: "PT báo cáo" (`ptNotes`, "(không có ghi chú)") and "Khách khiếu nại" (`disputeReason`, "(không có lý do)") | Same two boxes and same empty texts ("Lý do khách khiếu nại") | [x] |
| 8 | Header sentence (D1) | Same `DISPUTE_PAGE_PENDING_SENTENCE` | [x] |
| 9 | Three ruling buttons: "Buổi tập đã diễn ra", "Xác nhận PT vắng mặt", "Buổi tập không diễn ra" | Same three labels, but behind ONE secondary disclosure "Phán quyết theo đường cũ (một người duyệt, không qua hồ sơ)" with a warning sentence (pending R-06 recommendation, needs Ngài's confirmation) | [x] moved |
| 10 | Inline note box, "Huỷ" / "Xác nhận kết luận", note required | `MoneyActionDialog` (who / consequence / warning), note required (confirm disabled until typed), "Huỷ" / "Xác nhận kết luận" | [x] |
| 11 | Consequence text per ruling (PT absent: "hoàn giá trị buổi cho khách; ... vẫn tính là đã dùng") | DQ-2(a) wording from `FINDING_CONSEQUENCE` / `OUTCOME_CONSEQUENCE` ("vẫn mất 1 quyền buổi", "không có buổi bù", PT not paid); never "buổi tập không bị trừ" | [x] corrected |
| 12 | Same endpoint and body: `POST /admin/sessions/:id/resolve {resolution, note}` | Same (note trimmed). Exactly 1 POST per confirm even on double click | [x] |
| 13 | Success toast "Đã phân xử khiếu nại", list invalidated | Same toast; list re-read after success | [x] |
| 14 | Errors: toast with `parseDisputeError` message | Inside the dialog (`role="alert"`), same mapping: POLICY_ELIGIBILITY_UNVERIFIED, POLICY_EXCEPTION_APPLIES, CANCELLED_BLOCKED_BY_D77, CONTRACT_ENDING, SESSION_ALREADY_PROCESSED, CASE_REQUIRED, unknown outcome (no answer / 5xx = "Chưa xác nhận được kết quả"); a refusal blocks a blind retry and offers a reload | [x] |
| 15 | Zinc/amber/green/red utility colours | Admin tokens only (`adm-*`, `st-*`); guarded by `d2-source-guards.test.ts`. Clears the 3 AdminDisputes axe findings of B10 | [x] |
| 16 | Layout `max-w-5xl` cards | Cards at every width in the sessions view; the cases view is a table from xl and cards below | [x] |

Not in the old page, added here (not parity items): cases list (A2) with paging, "Mở hồ sơ" (A1), SLA chip (C2), workspace route.

Dropped on purpose: nothing functional. The "Đang khiếu nại" red badge (row 5) and the icon-only styling are gone.

Open: Ngài must confirm the R-06 recommendation (keep the legacy ruling behind the disclosure). If Ngài decides to remove it, delete `queue/LegacyRuling.tsx` and its line in `queue/SessionList.tsx`; nothing else depends on it.
