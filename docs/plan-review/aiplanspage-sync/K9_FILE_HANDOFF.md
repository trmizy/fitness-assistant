# K9 — bàn giao theo file (chờ owner của AIPlansPage.tsx / api.ts)

Trạng thái: **CHƯA TÍCH HỢP.** Hai file dưới đây đang `M` (chưa commit từ 17–18/11) của một luồng khác; không có worktree/báo cáo/phiên nào nhận. Không ai xác nhận ownership ⇒ không sửa chồng. Patch đã thử trong bản sao cô lập; **kết quả trên bản sao không phải bằng chứng cho source thật.**

## File → thay đổi cần owner chấp nhận

| File | Thay đổi | Lý do |
|---|---|---|
| `frontend/web/src/app/pages/client/AIPlansPage.tsx` | Trạng thái suy ra từ chương trình đang tập (`never_saved/synced/pending_sync` + `syncing/sync_failed`), thông điệp theo `contentSynced`/`previousAiPlanVersion`, banner chỉ hiện khi khớp `planId`+`version` hiện tại (chặn phản hồi muộn), `["current-workout-program"]` và `["ai-plans","current",scope]` được invalidate sau lưu/Undo, `data-testid` cho kiểm thử; **mới:** `Idempotency-Key` + `expectedVersion` cho điều chỉnh AI (dùng lại key khi không có phản hồi hoặc 408/502/503/504, đổi key khi server trả lời dứt khoát) | K9 + C3/C4 |
| `frontend/web/src/app/services/api.ts` | `savePlanToWorkoutLog` trả thêm `contentSynced/previousAiPlanVersion/programVersion` (+ `daysChange` nếu server trả); `adjustPlan(..., options?)` gửi header `Idempotency-Key` và `expectedVersion`; `newIdempotencyKey()` | K9 + C3/C4 |

Patch: `docs/plan-review/aiplanspage-sync/aiplanspage-sync.patch` (`git apply --check` sạch trên cây hiện tại, dry-run). Đặc tả trạng thái: `AIPLANSPAGE_SYNC_PATCH_SPEC.md`.

## Hợp đồng server mà UI phải xử lý (B1, mới)
`POST /plans/:id/save-to-workout-log` có thể trả:
- `200` + `contentSynced:true` + `daysChange:{from,to}` khi số buổi/tuần đổi (cùng program, version +1).
- `409 PROGRAM_SYNC_SCHEDULE_CONFLICT` (`error.details`: `daysFrom, daysTo, futureScheduleCount, removedDays[], resolution:"REPLACE_EXISTING_SCHEDULE"`) — chỉ khi người dùng chọn **giữ** lịch cũ và bản mới bỏ bớt ngày còn buổi tập tương lai. Panel lưu đã có lựa chọn "Thay thế lịch cũ"; UI nên gợi ý chọn nó.
- `409 PROGRAM_SYNC_SESSION_IN_PROGRESS` — đang có buổi tập dở dang; kết thúc buổi rồi áp dụng.
- `409 PROGRAM_CHANGED_CONCURRENTLY` — chương trình vừa đổi ở nơi khác; tải lại.
Hiện `summarizeApiError` hiển thị `error.message` tiếng Việt nên UI không vỡ nếu chưa xử lý `code`.

## Owner cần làm (theo thứ tự)
1. Xem `aiplanspage-sync.patch`; áp dụng (`git apply`) hoặc tự cài theo spec; giữ nguyên diff hiện có của mình.
2. `cd frontend/web && ./node_modules/.bin/vite build` (web không có `tsconfig`/script typecheck — chuẩn repo chỉ là `vite build`).
3. Dựng stack cục bộ (`docs/plan-review/integration-c/stack.sh up`; DB `*_test`, model stub) rồi chạy Chromium trên **source thật**:
   - `node docs/plan-review/integration-c/browser-sync.mjs http://127.0.0.1:5173` (5 trạng thái, Undo v2→v3, viewport 360/375/390/412, phản hồi muộn, 401, Idempotency-Key);
   - `node docs/plan-review/integration-c/browser-b1.mjs http://127.0.0.1:5173` (số buổi/tuần đổi 4→5→4 hiển thị trên trang Workout).
   Lưu ý: limiter `/auth/*` của gateway là 20 lần/15 phút (restart gateway cục bộ để xoá); `logs/tokens.json` hết hạn sau ~1 giờ (chạy `run-c.mjs compat` để làm mới).
4. Chỉ đóng K9 khi các lệnh trên PASS trên source thật.
