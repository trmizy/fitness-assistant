# AWS DEV Seed Account Remediation Plan — 13 Identities

**Date:** 2026-09-29. Read-only AWS audit (1 login as the already-known admin credential, matching the pattern already used and accepted in prior Phase-1 E2E testing; every other check was a `GET /auth/users` read). No account was disabled, rotated, or modified while producing this plan.

Evidence legend: **VERIFIED** (confirmed live against AWS DEV in this session) · **SUSPECTED** (same seed hash as a VERIFIED account, not itself individually logged into) · **UNKNOWN**.

---

## Inventory

| # | Email (seed identity) | Role (seed) | Role (live AWS) | Live AWS status | Default-credential status | Serves E2E? | Cross-service dependency risk | Mailbox recovery | Recommended action |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `admin@example.com` | ADMIN | ADMIN | VERIFIED exists, active (logged in this session) | **VERIFIED** — logs in with `password123` | Yes — used throughout this entire audit engagement | High (gates every admin-only route across all services) | None (fake domain) | **ROTATE** (this session's approved Group A) |
| 2 | `john.doe@example.com` | CUSTOMER | CUSTOMER | VERIFIED exists (id `2adeb124-...`, created 2026-06-06) | **VERIFIED** — logged in successfully in Phase-1 E2E | Yes — seed.ts's own comment says "used by ~30 unrelated specs" | High — has a real, rich restored `user_profiles` row (confirmed Phase-1: weight history, equipment, onboarding complete); rotating without also updating whichever of those ~30 specs hardcode `password123` for this exact account would break them | None (fake domain) | **KEEP_WITH_REVIEW** — rotating this one is a bigger, coordinated change (touches E2E fixtures), not a drop-in replacement like admin's |
| 3 | `jane.smith@example.com` | CUSTOMER | **GYM_OWNER** | VERIFIED exists (id `b5f2fda6-...`, created 2026-06-06) | SUSPECTED (same seed hash, not individually logged in this session) | UNKNOWN | High — role changed from the seed's original CUSTOMER to GYM_OWNER at some point after seeding, via the real, audited `PATCH /auth/users/:id/role` path; a GYM_OWNER almost certainly owns real rows in gym-service (gym/brand records) | None (fake domain) | **KEEP_WITH_REVIEW** — the role change is itself evidence of real downstream use; disabling or rotating without checking gym-service first could orphan owned gym data |
| 4 | `pt@example.com` | PT | PT | VERIFIED exists (id `20e90250-...`, created 2026-06-06) | SUSPECTED | UNKNOWN | Medium-High — PT accounts typically have applications/service-package/session rows in user-service and gym-service | None (fake domain) | **KEEP_WITH_REVIEW** |
| 5 | `roadmap.client@example.test` | CUSTOMER | CUSTOMER | VERIFIED exists (created 2026-09-09) | SUSPECTED | Yes — seed.ts comment: purpose-built for `tests/31-fitness-roadmap.spec.ts` | Medium — deliberately isolated from john.doe's data per that same comment, so likely single-service (fitness-service roadmap tables) | None (fake domain) | **KEEP_WITH_REVIEW** (lower risk than #2-4, but still an active E2E fixture — do not act without confirming that spec is not mid-use) |
| 6 | `roadmap.client2@example.test` | CUSTOMER | CUSTOMER | VERIFIED exists (created 2026-09-09) | SUSPECTED | Likely (same roadmap E2E family as #5) | Medium | None | **KEEP_WITH_REVIEW** |
| 7 | `roadmap.client3@example.test` | CUSTOMER | CUSTOMER | VERIFIED exists (created 2026-09-09) | SUSPECTED | Likely | Medium | None | **KEEP_WITH_REVIEW** |
| 8 | `roadmap.client4@example.test` | CUSTOMER | CUSTOMER | VERIFIED exists (created 2026-09-09) | SUSPECTED | Likely | Medium | None | **KEEP_WITH_REVIEW** |
| 9 | `cross.system.client@example.test` | CUSTOMER | CUSTOMER | VERIFIED exists (created 2026-09-10) | SUSPECTED | Yes — name states it is a deliberate cross-system (multi-service) fixture | **High** — by its own name, this account exists specifically to have data in more than one service | None | **KEEP_WITH_REVIEW** — highest disable-risk of the CUSTOMER-role group precisely because of what it's named for |
| 10 | `cycle.transition.client@example.test` | CUSTOMER | CUSTOMER | VERIFIED exists (created 2026-09-10) | SUSPECTED | Yes — purpose-built for a cycle-assessment transition scenario | Medium-High (fitness-service `TrainingCycle`/`CycleAssessment` state machine) | None | **KEEP_WITH_REVIEW** |
| 11 | `pt.coaching.workspace@example.test` | PT | PT | VERIFIED exists (created 2026-09-10) | SUSPECTED | Yes — paired with #12/#13 by naming | **High** — almost certainly has contracts/sessions linking to #12 and #13; disabling this one alone could break those two accounts' own test scenarios | None | **KEEP_WITH_REVIEW** |
| 12 | `pt.coaching.clientA@example.test` | CUSTOMER | CUSTOMER | VERIFIED exists (created 2026-09-10) | SUSPECTED | Yes (paired with #11) | High (linked to #11) | None | **KEEP_WITH_REVIEW** |
| 13 | `pt.coaching.clientB@example.test` | CUSTOMER | CUSTOMER | VERIFIED exists (created 2026-09-10) | SUSPECTED | Yes (paired with #11) | High (linked to #11) | None | **KEEP_WITH_REVIEW** |

**No account in this inventory is classified `DISABLE_CANDIDATE`.** Every non-admin account shows plausible-to-high evidence of live E2E or cross-service use, and this session was explicitly told not to decide disablement unilaterally where that risk exists (§ HARD SAFETY of the request this plan responds to). If you independently know any of #5–13 are no longer needed by any running spec, they are the lowest-risk candidates to reclassify — but that determination requires you, not this audit.

**A live discrepancy worth flagging (UNKNOWN):** `auth.repository.ts`'s `listUsers` query explicitly selects `isActive` (confirmed by source read), but the live `GET /auth/users` response for all 12 accounts above showed no `isActive` field at all in the parsed JSON — not `true`, not `false`, simply absent. This session did not chase down why (out of scope for an account inventory), but it means **live active/disabled status for these 12 accounts could not actually be confirmed from this endpoint** — every "VERIFIED exists" above is exists-and-is-listed, not confirmed-still-active. Worth a follow-up before ever acting on a DISABLE decision for any of them.

---

## Why nothing here was rotated in bulk

The approving request was explicit: **"Không dùng chung một mật khẩu mới cho 13 account"** and **"Với tài khoản không có mailbox recovery, chuẩn bị secure administrative recovery mechanism có kiểm soát và yêu cầu phê duyệt riêng."** None of the 13 accounts has a real mailbox (all `@example.com`/`@example.test`), so every one of them shares the exact same recovery gap described for admin in the main report (§8.5 there) — there is no in-app forgot-password path that would actually deliver anywhere. A bulk rotation of all 13 would need 13 individually-generated passwords, 13 secure storage entries, and — for the E2E-serving ones — a coordinated update to whatever test specs/scripts hardcode `password123` for that specific account, so those specs don't just start failing for an unrelated reason. That coordination work is the actual blocker to "just rotate all 13 now," not a technical one — the mechanism (self-service change-password) is identical to admin's and already proven safe.

## Recommended sequencing (for your decision, not started)

1. **Now (this session's approved scope):** rotate admin only (see main report + runbook).
2. **Next, lowest coordination cost first:** #5–8 (`roadmap.client*`) and #9–10 — single-named-purpose fixtures with a findable owning spec each; rotate one at a time, updating that spec's credential source (ideally to an env var, not a second hardcoded string) in the same change.
3. **Then, higher coordination cost:** #11–13 as one linked group (rotate together, since #12/#13's specs likely need #11's account working too).
4. **Last, and separately planned:** #2–4 (`john.doe`, `jane.smith`, `pt`) — the three oldest, most broadly-depended-on accounts; #2 alone is named in ~30 specs per the seed file's own comment. This is a real find-and-update-every-caller exercise, not a config change, and deserves its own dedicated pass rather than being folded into this security-incident response.

---

## Files relevant to any future per-account rotation

- `backend/services/auth-service/prisma/seed.ts` — where every one of these 13 identities is defined (email/role only; the shared password there is what to stop relying on).
- `backend/services/auth-service/src/__tests__/*.test.ts`, `scripts/partner-application-e2e/*`, `frontend/mobile/e2e/*.e2e.ts` — the actual consumers of the shared seed password; see the main report's hardcoded-credential inventory (§7) for the specific files already found using `password123` directly.
- `PATCH /auth/me/password` (self-service) — the same safe, atomic (as of this session's fix), audited mechanism used for admin's rotation is the one to reuse for each of these, one account and one freshly-generated password at a time.
