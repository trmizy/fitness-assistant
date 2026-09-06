# Settings Center Implementation Report

Date: 2026-09-01

## Summary

Added a dedicated client Settings Center at `/client/settings` and wired it into
desktop sidebar, mobile drawer, and the Topbar user menu. Profile remains the
place for body and fitness facts; Settings owns account/display/preferences/data
entry points.

## Implemented

- Account section uses the existing auth account update path for display name
  and a new authenticated password-change path that verifies the current
  password, stores a fresh bcrypt hash, and revokes refresh tokens.
- Appearance section reuses the existing settings context and adds real
  `system` theme behavior.
- Unit settings persist `unitSystem` and `energyUnit` on `UserProfile` while
  keeping canonical domain storage metric.
- Workout settings expose real active-workout controls for RPE/RIR visibility,
  fallback rest duration, Screen Wake Lock behavior, and rest-timer
  sound/vibration feedback.
- Nutrition settings expose only a real macro display toggle.
- Notifications link to the existing backend-backed notification preferences.
- Privacy/Data links to existing export/import pages and accurately labels the
  existing scoped profile-data delete action.
- Connections are non-interactive coming-later entries.
- Help/About are present without inventing legal pages.

## Safety Decisions

- No Settings control can override deterministic training progression, deload,
  safety constraints, or nutrition prescriptions.
- No fake delete-account button was added because current deletion is not
  cross-service account deletion.
- No notification toggles were added for event types the backend cannot persist.

## Verification

- Web build passed.
- Auth-service build passed.
- Auth-service login/refresh/password tests passed: 10/10.
- User-service build passed.
- Unit conversion tests passed: 14/14.
- Workout settings tests passed: 2/2.
- Unit preference schema tests passed: 5/5.
- Browser desktop and mobile snapshots verified `/client/settings`.
- Unit preference persistence was verified against the dev Postgres profile row,
  then the seeded demo account was restored to `metric`/`kcal`.

## Rest Timer Feedback Follow-up

- Added `Am bao het gio nghi` and `Rung khi het gio nghi` toggles to Workout
  Settings.
- `WorkoutLogPage` now plays best-effort browser audio and vibration once when
  the rest timer reaches zero.

## Smart Prefill Follow-up

- Added `Dien san thong minh` to Workout Settings.
- When disabled, active workout logging still restores the user's own draft and
  prescription defaults, but skips previous-performance/progression based
  prefill.
