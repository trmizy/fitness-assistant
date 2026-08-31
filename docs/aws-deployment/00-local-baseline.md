# 00 — Local baseline

Date: 2026-08-26
Branch: `master`
Commit: `8d1f3f2 feat(fitness): JSON/CSV data export (roadmap P2.5)`

## Commands

| Command | Result | Evidence |
|---|---:|---|
| `corepack enable` | FAIL | `EPERM: operation not permitted, open 'C:\Program Files\nodejs\yarn'` |
| `pnpm install --frozen-lockfile` | PASS | Lockfile up to date, all 11 workspace projects installed |
| `pnpm lint` | PASS after fix | `Repository hygiene check passed.` |
| `pnpm build` | PASS | All workspace package builds completed |
| `pnpm test` | FAIL | DB-dependent fitness tests still run without `DATABASE_URL` |
| `pnpm --filter @gym-coach/ai-service run test:evaluation` | PASS | `Summary: 20/20 passed.` |
| `pnpm --filter @gym-coach/ai-service run test:policy` | PASS | `Summary: 6/6 passed.` |
| `pnpm docker:test:fast` | STOPPED | Docker build context exceeded ~748 MB before test execution |

## Fixes applied

- `.github/workflows/docker-test.yml`: branch trigger changed from `main` to `master`.
- `package.json`: root `db:migrate` and `prisma:generate` now include `gym-service` and `payment-service`.
- Hygiene cleanup:
  - removed forbidden tracked `frontend/web/public/favicon.svg`;
  - sanitized personal Windows paths in two tracked `.agnes` JSON artifacts.
- Gym service integration tests now skip when `DATABASE_URL` is absent, matching the fast-test expectation.
- Fitness `plan-equipment-validator.test.ts` now skips when neither `FITNESS_DATABASE_URL` nor `DATABASE_URL` is present.

## Remaining baseline blockers

1. `corepack enable` needs elevated permission or a user-level Corepack setup on this Windows machine.
2. `pnpm test` is still not fully green because several `fitness-service` DB/integration tests require an explicit test database URL.
3. `pnpm docker:test:fast` needs `.dockerignore`/test-profile hardening before it is practical in CI; the build context crossed ~748 MB before being stopped.

These blockers do not affect the isolated AWS Phase 1 `/hello` runtime.
