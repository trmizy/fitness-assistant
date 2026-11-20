# AIPlansPage — đặc tả patch "trạng thái đồng bộ kế hoạch AI ↔ chương trình tập" (K9)

Ngày: 2026-11-20. Trạng thái: **ĐỀ XUẤT ĐỘC LẬP — chưa áp dụng vào cây làm việc chính.**
Lý do: `frontend/web/src/app/pages/client/AIPlansPage.tsx` và `services/api.ts` đang `M` (chưa commit từ 17–18/11) của một luồng khác; ownership chưa được bàn giao ⇒ **không sửa file**. Patch được thử trong bản sao cô lập `.tmp-stack/web-sync-patch` (copy `frontend/web/src` hiện tại + patch), không đụng cây chính.

File patch sẵn dùng: `docs/plan-review/aiplanspage-sync/aiplanspage-sync.patch` (`git apply --check` sạch trên cây hiện tại; 2 file: `AIPlansPage.tsx`, `services/api.ts`).

## 1. Lỗi gốc (K9)

`saveMutation.onSuccess` chỉ đọc `result.alreadyExists`. Server trả `alreadyExists:true` cho **mọi** lần lưu lên một program đã tồn tại, kể cả khi vừa đồng bộ một bản revision mới (`contentSynced:true`). Kết quả: ngay sau khi áp dụng bản sửa AI thành công, UI nói **"Kế hoạch này đã được lưu vào lịch tập trước đó."** — sai, vì chương trình vừa được cập nhật. Ngoài ra UI không có cách nào biết "bản đang xem đã được áp dụng chưa".

Bằng chứng (REAL BROWSER, UI hiện tại của owner, `browser-c.mjs` U2): `UI message after save: Kế hoạch này đã được lưu vào lịch tập trước đó.` trong khi backend là program v1→v2, `aiPlanVersion` 1→2.

Server đã trả đủ dữ liệu (không cần đổi backend): `contentSynced`, `previousAiPlanVersion`, `programVersion` (chỉ khi lưu lên program đã có).

## 2. Nguồn sự thật & máy trạng thái

Nguồn sự thật cho "plan đã lưu chưa" là **program đang tập** (`GET /workouts/programs/current`: `sourcePlanId`, `aiPlanVersion`), không phải cờ cục bộ.

Trạng thái suy ra (không lưu state riêng):

| State | Điều kiện | Nút mở | Dòng trạng thái |
|---|---|---|---|
| `never_saved` | không có program, hoặc `program.sourcePlanId !== plan.id` | "Lưu vào lịch tập" | "Kế hoạch này chưa được lưu vào lịch tập." |
| `synced` | `sourcePlanId === plan.id` và `(aiPlanVersion ?? 0) >= plan.version` | "Lưu lại vào lịch tập" | "Lịch tập đang theo bản N của kế hoạch này." |
| `pending_sync` | `sourcePlanId === plan.id` và `aiPlanVersion < plan.version` | "Cập nhật lịch tập theo bản N" | "Bản N chưa được áp dụng vào lịch tập đang tập." |
| `syncing` | `saveMutation.isPending` | — | "Đang đồng bộ lịch tập…" |
| `sync_failed` | lần lưu gần nhất lỗi cho plan này | — | "Chưa đồng bộ được: <lý do>" |
| sync completed | banner `saveOutcome` (tạm thời) | — | theo `kind` bên dưới |

`kind` của banner (từ phản hồi server + version của plan lúc bấm lưu):

| kind | Điều kiện | Thông điệp |
|---|---|---|
| `first_save` | `!alreadyExists` | "Đã lưu kế hoạch vào lịch tập." |
| `synced` | `alreadyExists && contentSynced` | "Đã cập nhật chương trình tập theo phiên bản N của kế hoạch." |
| `already_current` | `alreadyExists && !contentSynced && previousAiPlanVersion >= N` | "Chương trình tập đã khớp với phiên bản N của kế hoạch — không có gì thay đổi." |
| `unchanged_content` | `alreadyExists && !contentSynced && previousAiPlanVersion < N` | "Phiên bản N không đổi nội dung buổi tập nên chương trình giữ nguyên (đã ghi nhận theo phiên bản mới)." |

## 3. Thay đổi component (tóm tắt)

1. `SaveOutcome` thêm `planId`, `planVersion`, `kind`, `contentSynced`, `programVersion`; thêm kiểu `PlanSyncState`.
2. Thêm `useQuery(["current-workout-program", userScopeId])` → `workoutService.getCurrentProgram()`; `planSyncState` là `useMemo` trên `(program, currentPlan.id, currentPlan.version)`.
3. `saveMutation`: biến thêm `planVersion`; `onSuccess(result, variables)` tính `kind/message` như bảng; invalidate thêm `["ai-plans","current",scope]`; `onError` ghi `saveFailure` (kèm planId) và invalidate program.
4. `useEffect` theo `[currentPlan.id, currentPlan.version]` xoá `saveOutcome`/`saveFailure` của plan khác hoặc phiên bản cũ ⇒ **không còn banner "đã lưu" cũ** sau khi sửa AI, Undo hay đổi plan (xử lý phản hồi cũ/refresh).
4b. **Phản hồi muộn (cập nhật 2026-11-20)**: effect ở mục 4 chỉ chạy khi plan/version đổi, nên một phản hồi lưu đến *sau đó* vẫn có thể vẽ banner cho version cũ. Vì vậy khi render, banner chỉ hiện nếu `saveOutcome.planId === currentPlan.id && saveOutcome.planVersion === currentPlan.version`, và lỗi chỉ hiện nếu `saveFailure.planId === currentPlan.id` (`failureForThisPlan`). Đã kiểm bằng Chromium (request lưu bị giữ 6s, Undo trong lúc đó).
5. `revertMutation.onSuccess` invalidate `["current-workout-program"]`: Undo đưa `plan.version` **tiến** (v2→v3, cùng planId) nên program có thể tụt sau ⇒ `pending_sync` được tính lại tự động.
6. Nút/dòng trạng thái: thêm `data-testid="plan-sync-status"` (+`data-state`), `data-testid="save-outcome"` (+`data-kind`); nhãn nút mở/nút xác nhận theo state.
7. `services/api.ts` `savePlanToWorkoutLog`: kiểu trả về + ánh xạ `contentSynced`, `previousAiPlanVersion`, `programVersion` (additive).

Không tạo WorkoutProgram trùng: không đổi payload; backend đã dùng lại program theo `sourcePlanId` (kiểm bằng test: luôn 1 program, cùng id).

## 4. Chưa phủ / rủi ro của patch

- Chỉ chạy Chromium viewport 1280×1100; **chưa kiểm 360/375/390/412** (patch chỉ thêm một dòng chữ nhỏ và đổi nhãn nút — nên kiểm khi áp dụng thật).
- `vite build` xanh nhưng Vite không typecheck; chưa chạy `tsc` cho web.
- Chưa có thông báo khi một tab khác đã đồng bộ (chỉ dựa vào refetch/invalidate).
- Nhãn nút dài ("Cập nhật lịch tập theo bản 2") có thể xuống dòng trên màn hẹp.
- Patch dựa trên bản `AIPlansPage.tsx` hiện tại (đang chưa commit); nếu owner đổi file, cần rebase.
