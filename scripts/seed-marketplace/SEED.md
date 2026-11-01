# Marketplace seed (Phase G2)

Production-like data so every current client screen (PT discovery/detail, gym discovery/detail, owner and PT workspaces, admin queues) renders like production.
Status: live HTTP validation is recorded in `_warroom/evidence/seed-live/REPORT.md`. The live run uses seven isolated `*_seedrun` databases. Older Phase G2 notes below describe the earlier fixture-only validation; the live report supersedes them.

## What it creates (scale: LARGE)

| Entity | Count | Notes |
|---|---|---|
| Clients | 1,000 | natural Vietnamese names, 4 cities (HCM / Hà Nội / Đà Nẵng / Đồng Nai), profile + onboarding data; 376 have 2-4 InBody scans. "Phạm Thu Uyên" is the search-demo account. |
| PTs | 80 | 63 APPROVED + DRAFT 4 / SUBMITTED 4 / UNDER_REVIEW 3 / NEEDS_MORE_INFO 3 / REJECTED 3 |
| Gym Owners | 25 | one Brand each, 80 branches in total |
| Gym membership plans | 127 | 3-6 per brand, realistic prices (budget / mid / premium tiers), some INACTIVE |
| Photos | 365 Pexels files, 9.47 MB | `assets/` + `manifest.json` (photographer, source URL, sha256) + `ATTRIBUTION.md` |

### PT matrix (P1-P16 are fixed; the other 64 fill the quotas)

| # | Name | Application | Listing | Public photos | Packages | Other |
|---|---|---|---|---|---|---|
| P1 | Trần Minh Khoa | APPROVED | APPROVED, 3 approved rounds | 5 | 4 (1 inactive) | ACTIVE contract (COMPLETED + 12 reviews: **skipped**, see below) |
| P2 | Lê Hoàng Nam | APPROVED | PENDING (10-session package 2.000.000 -> 2.500.000; photos A,B,C -> A,C,D) | 3 | 2 | contract bought at the old price |
| P3 | Phạm Gia Huy | APPROVED | CHANGES_REQUESTED + child DRAFT | 1 | 1 | |
| P4 | Nguyễn Hoàng Anh | APPROVED | REJECTED (public v1 unchanged) | 3 | 3 | |
| P5 | Trần Ngọc Mai | APPROVED | DRAFT, sparse profile | 0 | 5 | optional fields missing |
| P6 | Võ Minh Quân | APPROVED (new) | first revision PENDING | 0 | 0 | |
| P7 | Bùi Thanh Hà | APPROVED | APPROVED | 3 | 2 | **account locked** (hidden from search) |
| P8 | Đặng Quốc Bảo | APPROVED | APPROVED | 1 | 2 | **contract-scope restriction** |
| P9 | Hoàng Thu Trang | APPROVED | APPROVED | 5 | 6 | not accepting clients |
| P10 | Châu Ngọc Hân | APPROVED | STALE (admin direct edit) + rebased child DRAFT | 3 | 2 | |
| P11 | Lý Thành Đạt | APPROVED | APPROVED | 1 | 1 | no orders |
| P12-P16 | Đỗ Khánh Linh / Phan Anh Tuấn / Mai Phương Thảo / Tạ Minh Hiếu / Kha Bảo Ngọc | DRAFT / SUBMITTED / UNDER_REVIEW / NEEDS_MORE_INFO / REJECTED | - | - | - | |

Totals over the 63 approved PTs: listing NONE 6 / DRAFT 6 / PENDING 8 / CHANGES_REQUESTED 5 / REJECTED 4 / STALE 4 / APPROVED 30; public photos 0 -> 16, 1 -> 14, 3 -> 18, 5 -> 15 PTs;
packages none 11 / 1-3: 35 / 4+: 17, 9 PTs with an inactive package; flags: locked 3, PT-scope (account) restriction 3, contract-scope restriction 3, not accepting 4.

### Gym Owner matrix (O1-O10 fixed; O11-O25 generated)

| # | Owner | Brand | Partner state | Branches |
|---|---|---|---|---|
| O1 | Nguyễn Trường Thành | Iron District Fitness | ACTIVE | Quận 1 (OPEN, **exactly 20 photos**, 14 amenities, listing APPROVED), Bình Thạnh (OPEN, listing PENDING: photos A,B,C -> A,C,D + pool), Thủ Đức (TEMPORARILY_CLOSED, listing DRAFT); also the REENABLE / MERGED amenity scenarios |
| O2 | Vũ Tấn Cường | Peak Performance | ACTIVE | Phú Nhuận (listing CHANGES_REQUESTED, PENDING custom amenity "Phòng boxing"), Gò Vấp (**SUSPENDED**) |
| O3 | Lâm Thu Hà | Lotus Yoga & Fitness | ACTIVE | Quận 3 (listing REJECTED, custom amenity proposal rejected), Thảo Điền (0 amenities, old-app compat) |
| O4 | Trịnh Gia Bảo | Hanoi Strength Lab | ACTIVE | Cầu Giấy (custom amenity **APPROVED** "Khu strongman"), Long Biên (PENDING_REVIEW), Đống Đa (wizard DRAFT, step 4), Hai Bà Trưng (PERMANENTLY_CLOSED) |
| O5 | Phùng Thanh Sơn | Saigon Movement Studio | APPROVED_PAYOUT_PENDING | 1 |
| O6 | Đoàn Minh Tâm | Tâm Fitness Studio | ONBOARDING, stops after 6 of 10 sections | draft branch |
| O7 | Huỳnh Kim Ngân | Coastal Fit Đà Nẵng | UNDER_REVIEW (one PENDING amenity proposal) | draft branch |
| O8 | Tô Quang Vinh | Urban Pulse Gym | CHANGES_REQUESTED, issue category AMENITIES | draft branch |
| O9 | Kiều Anh Thư | Bamboo Wellness | REJECTED | draft branch |
| O10 | Cao Văn Lộc | Titan Gym Biên Hòa | partner SUSPENDED | 2 |
| O11-O17 | 7 generated ACTIVE chains (Dragon Fit Club 10 branches ... Việt Power Gym 6) | | ACTIVE | 53 branches |
| O18-O25 | 8 generated: APPROVED_PAYOUT_PENDING, SUSPENDED, ONBOARDING x2, UNDER_REVIEW x2, CHANGES_REQUESTED (PHOTOS + document), REJECTED | | | 1-2 each |

Owner states: ACTIVE 11 / APPROVED_PAYOUT_PENDING 2 / ONBOARDING 3 / UNDER_REVIEW 3 / CHANGES_REQUESTED 2 / REJECTED 2 / SUSPENDED 2.
Branches (80): APPROVED+OPEN 48, TEMPORARILY_CLOSED 6, PERMANENTLY_CLOSED 3, SUSPENDED 3, PENDING_REVIEW 4, DRAFT 14, REJECTED 2.
Branch listings: NONE 48, APPROVED 15, PENDING 5, DRAFT 4, CHANGES_REQUESTED 4, REJECTED 2, STALE 2. Branches with 0 amenities: 2. Photos per branch: 0 to 20.
Amenity catalogue: the 18 SYSTEM rows + admin-created "Khu stretching", "Khu recovery", "Khăn tập" (the plan's "Nước uống miễn phí" **already exists as SYSTEM DRINKING_WATER** with the identical name, the catalogue's unique-name rule would reject a second one).
Custom proposals: PENDING (Phòng boxing, Khu tắm biển nước ngọt), REJECTED (Phòng karaoke), APPROVED (Khu strongman), MERGED ("Khu giãn cơ" into "Khu stretching"), REENABLE ("Khăn tập" after the admin switches it OFF).

## Accounts and the three groups (plan 8.1)

* Seed accounts: `<slug>@seed.gymini.test` (slug = accent-stripped full name, `-2` suffix on a name clash). Group (3) only.
* Fixed dev password: **`Seed@Gymini2026`** (override with `SEED_MARKETPLACE_PASSWORD`). It satisfies the auth-service rule (8+ chars, upper, lower, digit). It is hashed (bcrypt, 10 rounds) once per run and **never printed or logged** (client logs redact password / token / secret keys).
* The seed **never creates, updates or deletes** anything outside the seed domain: Tier A has no UPDATE/DELETE statement at all (checked by a test); before writing, every planned e-mail is looked up and a clash with an account that is not the seed's own stops the run (`SeedCollisionError`, nothing written).
* `--target fresh` and `--target partner` create the deterministic seed admin `marketplace-admin@seed.gymini.test`, using the same seed password above. Other targets require `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.

## How to run

```powershell
# 0. assets - ONE TIME, needs network + PEXELS_API_KEY in .env (already done; assets/ is committed-ready)
node scripts/seed-marketplace/generate-assets.mjs            # no-op while assets/manifest.json exists; --force regenerates

# 1. tests (no network; DB tests auto-skip if the test container is unreachable)
node --test scripts/seed-marketplace/__tests__/world.test.mjs scripts/seed-marketplace/__tests__/guard.test.mjs scripts/seed-marketplace/__tests__/planners.test.mjs scripts/seed-marketplace/__tests__/flows.test.mjs scripts/seed-marketplace/__tests__/db.test.mjs
node --import tsx --test scripts/seed-marketplace/__tests__/payloads.test.mjs      # parses every body with the services' real zod schemas

# 2. test DBs (localhost:55433, own gymcoach_<svc>_seed_test databases, created and migrated with `prisma migrate deploy`)
node scripts/seed-marketplace/index.mjs --target test --tier a            # Tier A; run it 3x -> identical counts
node scripts/seed-marketplace/index.mjs --target test --counts
node scripts/seed-marketplace/verify-integrity.mjs --target test
node scripts/seed-marketplace/index.mjs --tier b --dry-run                # Tier B request plan, nothing sent

# 3. dev (ONLY after Phase G/H cleanup was approved and finished)
$env:SEED_MARKETPLACE_CONFIRM = "dev"; $env:SEED_ADMIN_EMAIL = "..."; $env:SEED_ADMIN_PASSWORD = "..."
node scripts/seed-marketplace/index.mjs --target dev --tier all --gateway http://localhost:3000        # Tier A + Tier B
node scripts/seed-marketplace/index.mjs --target dev --tier all --gateway http://localhost:3000 --reseed   # re-run on a DB that already has seed data (ensure-only)
node scripts/seed-marketplace/verify-integrity.mjs --target dev
```

### Guards (`lib/guard.mjs`, unit-tested in `guard.test.mjs`)

* Always refused: `NODE_ENV=production`; a database name containing `prod` / `staging` / `live`; any name outside `gymcoach_<svc>[_...]_test` / `gymcoach_<svc>`; a service/name mismatch; a non-local host.
* Test DBs (`*_test`): no marker needed. The repo's own `gymcoach_<svc>_test` DBs are refused unless `--allow-shared-test-db` (use the dedicated `*_seed_test`).
* Dev DBs (`gymcoach_<svc>` on `localhost:5433` / `gymcoach-postgres:5432`): need the marker `verify-clean.ok` (written by the cleanup step H4; must contain a 64-hex `confirmToken` and an ISO time; searched at `SEED_MARKETPLACE_MARKER` or the newest `D:\FitnessAssistant-backups\<ts>\verify-clean.ok`) **and** `SEED_MARKETPLACE_CONFIRM=dev`. If the dev DBs already hold seed data, `--reseed` is required; it only runs the "ensure" functions and deletes nothing.
* The guard runs before any connection is opened: a refused run does not even read a database.

## Tier A (direct DB, ran on test DBs)

`auth.users` (1,080 CUSTOMER accounts: 1,000 clients + 80 PT candidates), `user_profiles` (1,080), `inbody_entries` (1,138). PT candidates start as CUSTOMER / `is_pt=false`; the real approval flow (Tier B) promotes them, so `auth role <-> is_pt` is consistent at every step.
Deterministic ids (sha256 -> uuid, as `seed-agentic-demo.ts`), fixed timestamps (epoch 2026-10-23, never `now()`), `ON CONFLICT (id) DO NOTHING`.
Gym Owners are *not* Tier A: their accounts exist only through `start -> verify -> set-password`. If a future Tier A write touches `gyms` / `gym_partners`, it must `SET LOCAL gymini.compat_writer = 'seed'` (the integrity test shows what happens otherwise: a WRITER_ABSENT event).
**Skipped on purpose:** historical COMPLETED sessions, session reviews and COMPLETED PT contracts. Nothing in the API can move time backwards, and writing them by SQL would need matching payment-service ledger rows (escrow, commission, wallet buckets) that only a real paid contract creates. They are reported as `contract.SKIPPED_no_api_for_completed_history` and are an open question.

## Tier B (HTTP through the gateway; built, NOT run live)

Order: admin amenity catalogue -> PT applications (draft, presign/PUT/confirm documents, submit, admin review) -> PT listings (rounds that end APPROVED, then the open/closed tail per scenario; physique photos via presign -> MinIO -> confirm) -> owners (`start/verify/set-password`, 10 application sections, submit, admin accept/resolve/approve or request-changes/reject, onboarding payout/terms, suspend) -> brand plans -> extra branches (wizard / quick create / legacy quick create without the flow header) -> branch listings -> amenity proposals -> PT contracts + gym memberships paid through the VNPay **simulator** -> gym reviews -> PT account/contract restrictions and lock.
Every step is an *ensure*: the pure planners in `lib/tierB/planners.mjs` look at what the API reports and return only the missing actions, so re-running is a no-op.

### Tier B prerequisites (temporary dev-stack override, NOT applied)

1. `PARTNER_APPLICATION_DEV_ECHO=true` on auth-service (+ gym-service) - owner accounts are created with the e-mail link returned in the response.
2. `VNPAY_SIMULATE=true` on payment-service - the old **MOCK gateway no longer exists** (`payment.service.ts`: "The MOCK provider is gone"); the only offline way to pay with play money is the VNPay simulator page, which the seed follows (`settleViaSimulator`). `.env` currently has `VNPAY_SIMULATE=false`.
3. Gateway rate limit for `/auth/partner-applications/start` (10 per 15 min per IP by default; the seed makes 25).
4. A running stack whose databases are the ones being seeded, MinIO up (photo/document presign), the admin account kept in Phase G.

Exact override and commands: `compose.seed-override.example.yml` (do not apply it yourself without Ngài's go). Turn on:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml -f <copy-of-override.yml> up -d --force-recreate auth-service gym-service payment-service api-gateway
```

Turn off after the run:

```powershell
docker compose -f infra/compose/docker-compose.dev.yml up -d --force-recreate auth-service gym-service payment-service api-gateway
```

## Re-run semantics

* Tier A: inserts only what is missing (deterministic ids); nothing is ever updated or deleted. Three runs -> identical counts (proved).
* Tier B: each flow re-reads state; a finished scenario produces **zero write requests** (proved on the fake gateway for the PT flows: runs 2 and 3 sent 0 writes). A state *past* the scenario (e.g. an application already APPROVED when the scenario says DRAFT) is reported as a warning and left alone; the seed never rolls anything back.
* Changing the world (names, counts) changes ids; to move to a different universe set `SEED_MARKETPLACE_NAMESPACE`. Do not edit world files between a partial run and its completion.
* Photo reuse: 365 licensed photos cover ~600 placements (453 branch + 143 PT); a photo is never repeated inside one branch / PT, but is reused across different branches.

## What has / has not been run

| Item | Evidence label |
|---|---|
| world determinism, quotas, names, geo, assets | TEST FIXTURE (pure unit tests) |
| guard refusals (production / dev without marker / bad names / hosts) | TEST FIXTURE + CLI refusals shown |
| payload bodies vs the services' real zod schemas | CODE AUDIT executed as tests (imports the TS schemas) |
| planners (idempotency, resume, no rollback) | TEST FIXTURE |
| Tier B flows vs fake gateway (PT application + listing) | TEST FIXTURE - not evidence the real services accept the calls |
| Tier B dry-run (all flows, ~4,250 requests recorded, nothing sent) | TEST FIXTURE |
| Tier A x3 + integrity on `*_seed_test` DBs | BACKEND INTEGRATION (isolated test container) |
| Tier B against a live stack | **REAL HTTP/API**: isolated seedrun databases; see live report for exit codes, timings, counts and limitations |
| Gym-owner / branch / listing / money flows vs a fake | **NOT RUN** (only planners + body schemas + dry-run) |

## Questions for Ngài

See the end of the Phase G2 report; the short list is also kept in `_warroom`.

## Live partner runbook (2026-10-23)

The live validation report is `_warroom/evidence/seed-live/REPORT.md`. No browser or real bank payment is implied: all business writes use the real gateway and the local VNPay simulator. PT documents use the approved multipart API because this stack has no AWS user-upload bucket; listing photos still use presign → MinIO → confirm. Multipart uploads create runtime files in user-service's uploads directory.

Approved changes to the matrix above: O5 and O18 finish onboarding and become ACTIVE (ACTIVE 13, payout-pending 0). Urban Pulse selects Tạ tự do before submission and receives an AMENITIES issue requesting a more detailed description. Submitted partner applications have at least one facility photo. Suspended owners are suspended only after their plans and branches exist. The original matrix describes planned rows; use the SQL tables and deviations in the live report for actual counts. ONBOARDING/review/rejected owners cannot create operational plans through the API. An application stopped after the brand section has no branch yet.

Run these PowerShell commands on the partner's local development machine with the repository's normal dependencies installed. The recipe deliberately uses isolated seedrun databases on THEIR local Postgres. Existing development databases are not seed targets. If they choose a different database suffix, both service URLs and `SEED_DB_SUFFIX` must match; changing the CLI alone does not reconfigure services.

```powershell
git pull --ff-only origin feature/payment-gateways
pnpm install --frozen-lockfile
docker compose -f infra/compose/docker-compose.dev.yml up -d postgres redis minio
# First installation only: createdb refuses an existing name; never drop an existing DB.
$seedServices = @('auth','user','fitness','ai','chat','payment','gym')
foreach ($seedService in $seedServices) {
  docker exec gymcoach-postgres createdb -U gymcoach "gymcoach_${seedService}_seedrun"
  if ($LASTEXITCODE -ne 0) { throw "Database creation failed; inspect before continuing." }
}
docker compose -f infra/compose/docker-compose.dev.yml -f scripts/seed-marketplace/compose.seedrun.override.yml up -d --no-deps --force-recreate auth-service user-service fitness-service ai-service chat-service gym-service payment-service api-gateway
# Wait for gateway/backends to be healthy and migrations to finish.
$env:NODE_ENV='development'
$env:SEED_MARKETPLACE_CONFIRM='partner'
$env:SEED_DB_SUFFIX='seedrun'
$env:SEED_PG_HOST='localhost'
$env:SEED_PG_PORT='5433'
$env:SEED_PT_DOCUMENT_UPLOAD='multipart'
node scripts/seed-marketplace/index.mjs --target partner --tier all --gateway http://localhost:3000 --fail-fast --evidence _warroom/evidence/seed-live/partner-run.json
if ($LASTEXITCODE -ne 0) { throw 'Seed incomplete; inspect evidence and resume with --reseed.' }
node scripts/seed-marketplace/verify-integrity.mjs --target partner
if ($LASTEXITCODE -ne 0) { throw 'Integrity failed; inspect before accepting the seed.' }
node scripts/seed-marketplace/snapshot.mjs --target partner --output _warroom/evidence/seed-live/partner-counts.json
# Keep the populated DBs for testing; disable all temporary capabilities.
docker compose -f infra/compose/docker-compose.dev.yml -f scripts/seed-marketplace/compose.seedrun.override.yml -f scripts/seed-marketplace/compose.restore.override.yml -f scripts/seed-marketplace/compose.seedrun.ready.override.yml up -d --no-deps --force-recreate auth-service user-service fitness-service ai-service chat-service gym-service payment-service api-gateway
docker exec gymcoach-payment-dev printenv VNPAY_SIMULATE
docker exec gymcoach-auth-dev printenv PARTNER_APPLICATION_DEV_ECHO
docker exec gymcoach-gym-dev printenv PARTNER_APPLICATION_DEV_ECHO
```

The last three commands must print `false`: `VNPAY_SIMULATE=true` is set only by `compose.seedrun.override.yml` for the seed run, and `compose.seedrun.ready.override.yml` (always the LAST file) turns it off again.
`compose.restore.override.yml` restores each service's original dev startup, including `prisma migrate deploy` (fitness uses `migrate deploy` instead of `db push --accept-data-loss`; ai skips Qdrant ingestion), so a restart still applies pending migrations. The override explicitly applies migrations to fitness instead of its original `db push --accept-data-loss && db seed`; AI ingestion into shared Qdrant is also skipped. SMTP is disabled during seeding. Do not start the original compose alone against the fresh target.

For a partial or complete rerun, re-enable the seed override first, then use the same command with `--reseed`. No database reset is needed. `fresh` performs an empty-business-data check on first use and requires its matching local `.runtime` receipt for `--reseed`; `partner` requires the explicit environment confirmation and retains collision/production/local-host guards. Never copy a fresh receipt to authorize a different database set. Token and audit rows produced by real authentication are reported separately from business writes.

Seed accounts end in `@seed.gymini.test`; `data_origin` stays REAL. Admin: `marketplace-admin@seed.gymini.test`, password from **Accounts and the three groups** above. Useful logins: `pham-thu-uyen` (client), `tran-minh-khoa` (approved PT), `le-hoang-nam` (pending listing), `dang-quoc-bao` (contract restriction), `hoang-thu-trang` (not accepting clients), `nguyen-truong-thanh` (active owner), `doan-minh-tam` (onboarding owner), `huynh-kim-ngan` (under review), `to-quang-vinh` (changes requested), `cao-van-loc` (suspended owner; login intentionally blocked). Append the seed domain to each slug.
