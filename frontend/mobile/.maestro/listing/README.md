# Maestro flows — Listing Management (Phase M)

REAL DEVICE runs against the Expo app (never Capacitor). Verified 29/10/2026 on an ASUS ROG (Android 12), release build installed 24/10, all 7 flows passing.

| Flow | Account (seed) | Covers |
|---|---|---|
| `a1-pt-edit-submit.yaml` (+ `a1b-pt-pending-after-relogin.yaml`) | tran-minh-khoa | edit listing → save draft → submit → "Chờ duyệt" survives re-login |
| `a2-pt-photo-limit-reorder.yaml` | hoang-thu-trang | 5/5 physique photos: the 6th is refused with the Vietnamese message; ↑↓ reorder |
| `b-owner-listing-amenities.yaml` | nguyen-truong-thanh | toggle amenity, propose a new one, 21st photo refused, submit |
| `c-owner-application-resume.yaml` | doan-minh-tam | resume a 10-step application at its saved step, reach Tiện ích |
| `d-pt-changes-or-rejected.yaml` | pham-gia-huy / nguyen-hoang-anh | CHANGES_REQUESTED note and REJECTED screen |
| `e-client-search-detail.yaml` | pham-thu-uyen | PT and gym search + detail (photos, packages, grouped amenities) |

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
