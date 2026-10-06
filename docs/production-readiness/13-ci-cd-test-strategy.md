# 13 — CI/CD and Test Strategy

## CI pipeline (`.github/workflows/docker-test.yml`)

Two jobs on `pull_request` and `push` to `master`.

**Job 1 `fast-docker-test` (45 minutes):**
1. Checkout, Node 20, pnpm with cache.
2. `pnpm install --frozen-lockfile`.
3. `pnpm run lint` → `node scripts/check-repo-hygiene.mjs` (hygiene only; not TypeScript or ESLint).
4. `pnpm run build` (recursive build).
5. `pnpm test` (recursive unit tests).
6. AI evaluation tests (`test:evaluation`) and policy tests (`test:policy`).
7. `pnpm docker:test:fast`.

**Job 2 `db-integration` (25 minutes):** Redis 7 and Postgres 15 service containers. Creates isolated test databases
(`scripts/ci-create-test-databases.mjs`), generates Prisma clients, runs `prisma migrate deploy` for test databases, checks fitness-service migration
status, and runs four named DB regression files (equipment semantics, apply-plan idempotency, PT contract idempotency, ClientJourney concurrency).

## What CI does not do (gaps)

| Missing stage | Gap |
|---|---|
| TypeScript typecheck (`tsc --noEmit`) | G-11 |
| ESLint or security lint | G-11 |
| Dependency audit | G-22 |
| Container image scan | G-11 |
| Secret scan | G-30 |
| Migration from zero for every service plus schema-diff | G-20 |
| Destructive-statement report for migrations | G-04 |
| End-to-end browser tests | G-11 |
| Staging deploy and smoke | G-12 |
| Load test | G-18 (performance) |
| Production build with production flags (`NODE_ENV=production` boot test) | G-01, G-10 |
| Cross-user isolation suite | G-24 |

Node version differs: CI pins Node 20; the audit host runs Node 24.14.1. The production runtime version is not declared.

## Test inventory

| Category | Count or location | Evidence class (when run) | Notes |
|---|---|---|---|
| Unit and integration (`*.test.ts`, `__tests__`) | 393 files | Mocked or database-backed depending on file | Run through `pnpm test` (recursive) |
| Frontend unit | 61 files | Mocked | |
| Playwright specs | 4 files | REAL BROWSER when run against a live stack | Not in CI |
| Conversational verification (`test/conversational-intelligence/*.mjs`) | 57-cell X4 matrix, repro scripts | REAL HTTP/API + DB against local stack | Run manually; results under `test/conversational-intelligence/results/` |
| AI-chat full verification (`test/ai-chat-full-verification/`) | scripts with real JWTs through the gateway | REAL HTTP/API | Manual |
| Research harnesses (`test/research/workout-plan-bpm/`) | smoke tests (18), runner | TEST FIXTURE; runner REAL HTTP/API | Research track only |
| Live LLM tests | `live-golden.mjs`, `live-global.mjs` | REAL HTTP with Qwen | Historical note: `live-global.mjs` hangs on CPU Qwen (X6) |

Mocked and live evidence must not be merged in reporting. Each test file should declare its evidence class in its header (not consistently done).

## Evidence created by this audit

| Check | Class | Result |
|---|---|---|
| Harness unit tests (research runner) | UNIT_TEST | 18 pass (`node --test test/research/workout-plan-bpm/smoke/harness.test.mjs`) |
| Local auth log inspection | LIVE_LOCAL | Bearer tokens and OTP values present in logs (counts only) |
| Local gateway anonymous login probe | LIVE_LOCAL | `POST /auth/login` returned 401 in 0.02 s |
| Local OTP brute-force timing | CODE_INSPECTION + synthetic benchmark | About 1.3 s for 900,000 hashes |
| Dependency audit | NOT_VERIFIED | `pnpm audit` returned no usable output |
| Product unit suites | NOT_VERIFIED | Not executed in this audit (time-boxed); CI result on master should be cited instead |

## Gate definitions for release

1. CI green on the release commit, including typecheck, lint, audit, container scan and secret scan (new).
2. DB from-zero replay and schema-diff clean for every service (new).
3. Cross-user isolation suite green (new).
4. Production-boot tests green: every service refuses default or missing secrets (new).
5. Staging E2E green: registration, login, logout, one AI turn, one confirmation, cross-account cache clearing (new).
6. Load test thresholds met and recorded (P4).

## Test quality issues

- Many tests mock the LLM; the mocked evidence is useful for logic but does not show model behaviour.
- The four DB regression files in CI cover a narrow set. The broader integration suite is excluded from CI for resource reasons (documented in the workflow comment).
- No test asserts log redaction, OTP non-disclosure in production configuration, or the absence of internal routes on the public proxy.
