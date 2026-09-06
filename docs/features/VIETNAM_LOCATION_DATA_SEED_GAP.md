# Vietnam Administrative Location Data — Empty Dropdown Bug

Date: 2026-09-01

## Report

PT application form ("Đăng ký trở thành PT") — the "NƠI LUYỆN TẬP" (training
location) section's "Chọn tỉnh/thành" (select province/city) dropdown showed
only the placeholder, no actual provinces.

## Root cause — confirmed, not assumed

**Not a stale-data problem. Not a query bug.** The reference data itself
(`backend/services/user-service/prisma/data/vietnam_provinces.json`, vendored
from `sunshine-tech/VietnamProvinces`) is already the **correct, current
post-2025-merger structure**: 34 provinces, 3,321 wards, **no district level**
(`quận/huyện` abolished — wards sit directly under `tỉnh/thành phố`, matching
Vietnam's 2-tier local-government reform). The schema
(`VietnamProvince`/`VietnamWard` in `schema.prisma`) correctly has no
`District` model at all.

The actual bug: **the tables were simply never seeded** in this dev
database.

- Direct query confirmed it: `vietnam_provinces` and `vietnam_wards` both had
  **0 rows** (tables existed — created by migration
  `20260812000000_catch_up_db_push_drift` — just empty).
- `GET /locations/provinces` (the exact endpoint the PT application form's
  dropdown calls, via `locationService.getProvinces()`) was reachable,
  returned HTTP 200, correctly empty `[]` — every layer of the stack
  (route → controller → repository → Prisma) was wired correctly; there was
  genuinely nothing to return.
- A real, self-guarding seed script already existed
  (`prisma/seed_vietnam_locations.ts`, skips instantly if already seeded)
  but nothing in the actual running pipeline ever invoked it:
  `Dockerfile.dev`'s CMD ran `prisma migrate deploy` (creates empty tables)
  but never `db:seed`; the `db-seeder` compose service only seeds
  auth/user/contract/fitness/chat test fixtures, not this reference data.

## Fix

1. **Immediate**: ran `npx tsx prisma/seed_vietnam_locations.ts` against the
   dev DB — seeded 34 provinces / 3,321 wards. Verified live:
   `GET /locations/provinces` → 34 real provinces (Hà Nội, TP.HCM, Hải
   Phòng, Huế, Cần Thơ as `thành phố trung ương`, etc.);
   `GET /locations/provinces/1/wards` → 126 real phường under Hà Nội, no
   quận in between.
2. **Closed the process gap** so this can't silently recur on a fresh DB
   (new dev machine, CI, a reset volume) — both `Dockerfile.dev` and the
   production `Dockerfile` now chain
   `prisma migrate deploy && tsx prisma/seed_vietnam_locations.ts && <start>`.
   Safe to run on every boot (the script's own `count() > 0` guard makes it
   an instant no-op once seeded).
   - **Production Dockerfile also needed an additional fix**: the runner
     stage only copied the generated Prisma client into `dist/generated`,
     not `src/generated` — but the seed script (run via `tsx` on the raw
     `.ts` file, not compiled) imports `"../src/generated/prisma"` by that
     literal path. Without also copying `src/generated` to the same
     relative location in the runner image, this would have thrown
     `MODULE_NOT_FOUND` and **crashed the production container on every
     boot** — caught before this shipped, not after. Added the missing
     `COPY --from=builder .../src/generated ./backend/services/user-service/src/generated`
     line.
   - **Not yet build-tested**: the production Dockerfile change is
     reasoned from the existing, already-proven `prisma migrate deploy`
     pattern in the same file (same `node_modules/.bin/` path, same stage)
     but a full `docker build` of the production image was not run in this
     pass. Build and boot it once before the next real AWS deploy.

## Every other feature audited — same root cause, same fix

All of these read the exact same `VietnamProvince`/`VietnamWard` tables
through the exact same `location.repository.ts` — none of them had a
separate bug; the one seed fixes all of them:

| Feature | File(s) |
|---|---|
| PT application — residence address | `PTApplicationPage.tsx` (`residenceProvinceCode`/`residenceWardCode`) |
| PT application — "Nơi luyện tập" repeatable block | `PTApplicationPage.tsx` (`handleTrainingProvinceChange`) |
| PT profile — manage training locations (post-approval) | `PTProfilePage.tsx` → `trainingLocationService` → `training_location.controller.ts` (`PTTrainingLocation`) |
| PT discovery — client search-by-location filter | `PTDiscoveryPage.tsx` → `profileService.listPTs({provinceCode, wardCode})` → `profile.repository.ts` `findPTs` |

**Structurally different, NOT affected by this bug** (flagged, not fixed
here — different scope):

- **Gym registration/address** (`gym-service`'s `Gym.address`) is a plain
  free-text string with no province/ward FK at all — no location-based
  filtering or validation exists for gyms today. Not broken by this bug,
  but also has no structured location data to begin with. Worth a
  follow-up if gym search-by-location is ever wanted.

## Follow-up recommendation

Add a preflight/health-check assertion (or a `db-seeder` step) that fails
loudly if `vietnam_provinces` is empty in any environment that expects PT
registration to work — an empty-but-200-OK dropdown is a silent failure
mode with no error anywhere in the stack, exactly what let this ship
unnoticed.
