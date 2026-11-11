# AWS DEV Auth Rotation Runbook

**Status of this document: a plan, not a log.** Nothing below has been executed against AWS as of 2026-09-29. Each stage states exactly what it needs from you and whether it touches AWS at all.

**Load-bearing fact that shapes every stage below:** the local code changes made in this session (transaction fix, seed guard, test-script credential removal) live in `prisma/seed.ts`, `src/scripts/seedGuard.ts`, `src/repositories/auth.repository.ts`, `src/services/auth.service.ts`, and `scripts/test-admin-e2e.mjs`. Of these, **only** `auth.repository.ts` and `auth.service.ts` are runtime code that gets bundled into the deployed `fitness-assistant-dev-auth` Lambda. `seed.ts`, `seedGuard.ts`, and `test-admin-e2e.mjs` are a Prisma seed script and a local test runner — **they are never bundled into any Lambda and redeploying Auth would not make them "take effect" on AWS**, because they don't run there in the first place. Do not conflate "code changed locally" with "Lambda must be redeployed."

---

## Stage 1 — Local hardening tests
**AWS write? No. Status: DONE this session.**
`npm test` (82/82 pass, including 3 real-Postgres integration tests proving transaction rollback), `tsc --noEmit` clean, `npm run build` clean. See main report §10 for the full breakdown.

## Stage 2 — Review code changes
**AWS write? No. Status: awaiting your review, not this session's to approve for itself.**
Files: `src/repositories/auth.repository.ts`, `src/services/auth.service.ts` (the actual runtime fix — §5/§6 of the main report), `prisma/seed.ts` + `src/scripts/seedGuard.ts` (seed guard), `scripts/test-admin-e2e.mjs` (credential fallback removed), plus the 3 new/changed test files. Nothing has been committed or pushed.

## Stage 3 — Prepare secure credential storage and recovery
**AWS write? Only if you choose the Secrets Manager option below — otherwise no.**
Before Stage 5 runs, decide where the new admin password will live once generated (Stage 5, step 1). Options, in order of preference:
1. A password manager entry, created by whoever runs Stage 5, never leaving their machine except into the one `PATCH` request.
2. `aws secretsmanager put-secret-value` into a new/existing secret — this IS an AWS write, listed explicitly in the approval table below (Group A includes it as an optional sub-step).

Either way: confirm now who can act if the new password is needed later (see main report §8.5 — `admin@example.com` has no real mailbox, so losing this password has no self-service recovery path).

## Stage 4 — Human approval for AWS credential rotation
**AWS write? No — this stage IS the approval gate itself.**
You review the approval table in §"Approval Gate" below and explicitly approve Group A (and, separately, Group B and/or C if/when you want those). Nothing in Stage 5 onward runs without this.

## Stage 5 — Rotate ADMIN
**AWS write? YES.** Exactly two HTTP calls against the live, public API Gateway:
```
POST  /auth/login          { "email": "admin@example.com", "password": "password123" }
PATCH /auth/me/password     { "currentPassword": "password123", "newPassword": "<CSPRNG, generated locally, never typed into this session>" }
                             Authorization: Bearer <accessToken from step 1>
```
As of this session's Stage-1 fix, step 2 runs inside a single Prisma transaction: the password update and the deletion of every refresh-token row for this user either both commit or neither does — proven with a real (non-mocked) Postgres database in `credential-rotation-transaction.integration.test.ts`. Do not run this from a shell history that gets persisted, and do not log the request body.

## Stage 6 — Verify ADMIN identity, role, new login, and token revocation
**AWS write? No — read-only verification calls.**
1. `POST /auth/login` with the OLD password (`password123`) → must now return `401 Invalid credentials`.
2. `POST /auth/login` with the NEW password → must return `200`, with the **same** `id` as before rotation and `role: "ADMIN"`.
3. Attempt any call with a refresh token obtained **before** rotation (if one was kept from earlier testing) → must be rejected (`401`, since `changePassword` deleted every refresh-token row for this user).
4. Note the timestamp of step 5's `PATCH`; any admin-authenticated write seen in CloudWatch in the 15 minutes after that timestamp using an access token minted before it deserves a second look (§ main report's stateless-JWT exposure window).

## Stage 7 — Remediate the remaining 12 seed accounts
**AWS write? Only for whichever accounts you individually approve.**
Per `docs/deployment/AWS_DEV_SEED_ACCOUNT_REMEDIATION_PLAN.md` — every one of the 12 is currently `KEEP_WITH_REVIEW`, none is pre-approved for rotation or disablement. This stage does not start until you pick specific accounts from that plan (Group B approval, below).

## Stage 8 — Deploy Auth code changes, if necessary
**AWS write? Only if you want the transaction-atomicity fix live on AWS.**
The rotation in Stage 5 works correctly **whether or not** this stage ever happens — Stage 5 only calls the already-deployed `PATCH /auth/me/password`, which today runs the OLD (non-transactional) code on AWS. The local fix from Stage 1 makes that same endpoint atomic, but **the currently-deployed Lambda does not have it yet**. Two honest options:
- **Rotate now, deploy the atomicity fix later** (as its own, separately-reviewed change): the exposure this closes is a rare crash-between-two-writes window, not the credential leak itself. Reasonable to decouple.
- **Deploy first, then rotate**, if you want the rotation itself to run through the hardened code path.
Either is defensible; this runbook does not choose for you. If you do deploy: that is a real Lambda deployment (build → package → `aws lambda update-function-code`/CI pipeline — this repo currently has no CI/CD for it, confirmed in the earlier recovery audit, so it would be a manual deploy), and belongs to **Approval Group C**, separate from A and B.

## Stage 9 — Repeat Auth/User E2E regression tests
**AWS write? No — same read/login-based tests as the original Phase-1 E2E report.**
Re-run the same scenario set as `docs/deployment/AWS_DEV_E2E_AUTH_USER_2026-09-29.md` against the NEW admin password, to confirm nothing broke for Auth/User specifically. Not Fitness/Gym/Payment — out of scope per the original request.

## Stage 10 — Security verification and final report
**AWS write? No.**
Confirm Stage 6's checks all hold, confirm CloudWatch shows no anomaly in the post-rotation window, and record the outcome (this is the natural follow-up to `AWS_DEV_AUTH_SECURITY_REMEDIATION_2026-09-29.md`, not a new document unless something unexpected happened).

---

## Rollback / recovery per stage

| Stage | If it fails partway | Recovery |
|---|---|---|
| 5 | Network error after `PATCH` returns but before you see the response | Stage 6, step 1/2 tells you definitively which state you're in — the old password either still works or it doesn't. There is no "half-applied" state to roll back: it's a single transaction (Stage 1's fix) or, on the currently-deployed code, a fast sequence of two independent writes with no meaningful gap in practice. |
| 5 | New password is lost before Stage 6 confirms it works | No email-recovery path exists for this account (§ main report 8.5). Recovery is a separate, explicitly-approved direct database update of one row — not pre-approved by this runbook. |
| 7 | A rotated/disabled seed account turns out to have been needed by a running spec | Re-enable via `PATCH /auth/users/:id/enable` (already audited, working) if disabled; if rotated, the spec needs its credential source updated — there is no way to "undo" a password rotation back to the old value, by design. |
| 8 | A Lambda deploy introduces a regression | Roll back to the previous Lambda version/alias (standard Lambda versioning) — not detailed further here since no CI/CD pipeline for this exists yet in this repo. |

---

## Approval Gate

Nothing below is authorized by this document. Each row needs your explicit go-ahead, and approving one group is **not** approval for another.

### Group A — ADMIN credential rotation

| Operation | Target account | Expected DB mutation | User impact | Recovery path | Verification method |
|---|---|---|---|---|---|
| `POST /auth/login` (old password) | `admin@example.com` | 1 new `refresh_tokens` row | None (this is how the operator authenticates to perform the rotation) | N/A | Response `200` + `role: "ADMIN"` |
| `PATCH /auth/me/password` | `admin@example.com` | `users.password` updated (new bcrypt hash); every `refresh_tokens` row for this user id deleted | Admin's existing sessions (if any) are logged out; anyone using the old password loses access immediately | New password lost → no email recovery; would need a separate approved direct DB update | Old password → `401`; new password → `200` with same `id`/`role` |
| *(optional)* `aws secretsmanager put-secret-value` | New/existing secret holding the new admin password | New secret version | None | Delete/rotate the secret again | `aws secretsmanager get-secret-value` (by someone authorized) confirms it's stored |

### Group B — 12 remaining seed accounts

No default action. For each account you choose from `AWS_DEV_SEED_ACCOUNT_REMEDIATION_PLAN.md`, the same table shape as Group A applies once you specify ROTATE or DISABLE for it individually — this runbook does not pre-fill it because no account there is pre-approved.

### Group C — Auth runtime deployment

| Operation | Target | Expected mutation | User impact | Recovery path | Verification method |
|---|---|---|---|---|---|
| Deploy updated `fitness-assistant-dev-auth` Lambda code (transaction fix) | `fitness-assistant-dev-auth` | New Lambda version/code; no data mutation by itself | None expected — same public API contract, same responses; only internal atomicity changes | Revert to previous Lambda version | Re-run Stage 9's E2E set; specifically re-run `changePassword`/`resetPasswordWithToken` scenarios and confirm identical responses to before |

**Approving Group A does not approve Group B or Group C.**
