# Maestro flows — Listing Management (Phase M)

REAL DEVICE runs against the Expo app (never Capacitor). Verified 29/10/2026 on an ASUS ROG (Android 12), release build installed 24/10, all 7 flows (a1-e) passing. Flows f, g, h were added afterwards (plan §12.10 mobile row) and have NOT been run on a device yet.

| Flow | Account (seed) | Covers |
|---|---|---|
| `a1-pt-edit-submit.yaml` (+ `a1b-pt-pending-after-relogin.yaml`) | tran-minh-khoa | edit listing → save draft → submit → "Chờ duyệt" survives re-login |
| `a2-pt-photo-limit-reorder.yaml` | hoang-thu-trang | 5/5 physique photos: the 6th is refused with the Vietnamese message; ↑↓ reorder |
| `b-owner-listing-amenities.yaml` | nguyen-truong-thanh | toggle amenity, propose a new one, 21st photo refused, submit |
| `c-owner-application-resume.yaml` | doan-minh-tam | resume a 10-step application at its saved step, reach Tiện ích |
| `d-pt-changes-or-rejected.yaml` | pham-gia-huy / nguyen-hoang-anh | CHANGES_REQUESTED note and REJECTED screen |
| `e-client-search-detail.yaml` | pham-thu-uyen | PT and gym search + detail (photos, packages, grouped amenities) |
| `f-pt-photo-invalid.yaml` | dang-quoc-bao (P8) | an undecodable image as physique photo: Vietnamese picker-failure toast "Không đọc được ảnh này…" (no raw English), photo count unchanged, draft discarded. Server IMAGE_INVALID is covered by the backend integration test. Helper: `helpers/push-broken-image.sh` (+ `make-broken-image.mjs`) |
| `g-owner-amenity-disabled.yaml` | trinh-gia-bao (O4, Cầu Giấy) | draft whose amenity the admin switched off: "Một số tiện ích đã ngừng trong danh mục" + "Đề xuất bật lại", and the draft can still be submitted. Helpers: `helpers/g-amenity-setup.mjs`, `helpers/g-amenity-teardown.mjs` |
| `h-client-package-changed.yaml` | pham-thu-uyen → PT ly-thanh-dat (P11) | package price changed (real approved revision) while the client is on the PT screen → buy is refused with the "Gói đã thay đổi — xem giá mới" sheet, new price shown. Helpers: `helpers/h-package-trigger.mjs serve/restore` + `helpers/trigger.js` |

## Running

- Accounts are `<slug>@seed.gymini.test`; the password is in `scripts/seed-marketplace/SEED.md` (Accounts). Pass it at run time only, `-e PASSWORD=...`, never commit it, and redact Maestro's `commands*.json` logs afterwards (they record typed text).
- A release build only talks HTTPS, so point the app at a tunnel to the local gateway (`set-server.sh <url>` or the `_server-open` / `_server-save` subflows on the login screen's "Cấu hình máy chủ"). Note the server value shown before you change it and put it back afterwards.
- `-e` values must be ASCII (the Windows console corrupts Vietnamese).

## Device traps (ROG)

- Set Gboard to English before typing; Telex keyboards rewrite what Maestro types. Restore the user's keyboard afterwards.
- Do not use `hideKeyboard` (it presses Back and leaves the screen); `eraseText` is unreliable, so start from empty fields and log out at the end of every flow (the confirm button is "ĐĂNG XUẤT").
- Multi-word labels contain non-breaking spaces: match them with `.` between words.
- Wake the screen and `adb shell svc power stayon usb` before a run; `stayon false` after.
- Never open a front camera on the TECNO test phone.

## Helpers (flows f, g, h) - REAL HTTP/API setup, never SQL

All scripts live in `helpers/`, talk to the gateway only (`GATEWAY_URL`, default `http://localhost:3000` = the PC's own gateway; the phone reaches it through the tunnel) and read credentials from the environment, never from a file:

| Env | Used by |
|---|---|
| `SEED_PASSWORD` | seed account password (SEED.md, "Accounts") - g and h |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | an ADMIN of the target stack (the kept admin) - g setup, h |
| `OWNER_SLUG`, `BRANCH_MATCH` / `GYM_ID`, `FORCE_DISCARD=1`, `REENABLE=1` | g (defaults: trinh-gia-bao, "cau giay") |
| `PT_SLUG`, `PKG_INDEX`, `DELTA`, `PORT`, `AUTO_RESTORE=0` | h (defaults: ly-thanh-dat, 0, 100000, 8765) |

Run order:

- **f**: `helpers/push-broken-image.sh push [header-only|truncated-png|text]` -> flow `-e EMAIL=dang-quoc-bao@seed.gymini.test -e PHOTOS=<current photo count, 1 on the seed>` -> `helpers/push-broken-image.sh remove`. The script refuses the TECNO serial; `DEVICE=<serial>` overrides the ROG default. The broken file is a **device fixture** (adb push + media scan), not product code. The flow only taps "Thư viện ảnh" (never the camera).
- **g**: `node helpers/g-amenity-setup.mjs` (admin creates the catalogue amenity "E2E Maestro Zone", owner drafts with it, admin switches it OFF -> the server writes the `AMENITY_DISABLED_REMOVED` notice) -> flow `-e EMAIL=trinh-gia-bao@seed.gymini.test -e BRANCH_TAP="Hanoi.Strength.Lab.C.*Gi.*"` -> `node helpers/g-amenity-teardown.mjs` (withdraws + discards the revision; the E2E amenity stays DISABLED, `REENABLE=1` switches it on). The branch must have no open revision first.
- **h**: terminal 1 `node helpers/h-package-trigger.mjs serve` (preflight: the PT has no open revision and an active package; listens on 127.0.0.1 only) -> terminal 2 the flow `-e EMAIL=pham-thu-uyen@seed.gymini.test` (its runScript steps call `/state` and `/change`; the change is PT draft -> submit -> admin approve) -> Ctrl+C in terminal 1 (auto-restores) or `node helpers/h-package-trigger.mjs restore` (another approved revision back to the original price). `status` shows the saved state.
- Run state (ids and prices only, no credentials) is written to `helpers/.state/` (git-ignored). Playwright specs 33-35 use the same PT/owner/branch (P11, O4 Cầu Giấy): do not run them at the same time.
- Redact Maestro's `commands*.json` afterwards as for every flow.
