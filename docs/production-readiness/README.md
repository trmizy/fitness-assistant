# Gymini Production Readiness — Audit Package

Status: **audit complete, implementation not started.** Verdict: **NO-GO** for public production.
Branch at audit time: `aws-deploy` (HEAD `81d9f432`). The audit changed no product code and no research artefact.

## Reading order

1. [00-executive-summary.md](00-executive-summary.md) — verdict, blockers, first batch.
2. [15-production-gap-register.md](15-production-gap-register.md) — every finding with evidence, severity, status, fix and test.
3. [16-production-roadmap.md](16-production-roadmap.md) — phased plan P0–P6.
4. [17-go-live-checklist.md](17-go-live-checklist.md) — gates; only evidence-backed boxes are checked.
5. Detail chapters 01–14 for each area.

| File | Area |
|---|---|
| 01-system-inventory.md | Repository, services, flags, artefacts, research isolation |
| 02-architecture-audit.md | Principles, boundaries, coupling |
| 03-authentication-security.md | Login, OTP (offline brute-force analysis), tokens, sessions |
| 04-authorization-user-isolation.md | Identity sources, owner checks, cross-user rules |
| 05-database-integrity.md | Invariants, destructive migrations, drift |
| 06-workflow-concurrency-idempotency.md | Confirmation claim, reclaim, idempotent writes |
| 07-ai-llm-safety.md | LLM entry points, LLM cannot …, flags, timeouts |
| 08-module-readiness.md | Per-module status and decisions |
| 09-reliability-failure-modes.md | Failure matrix and required drills |
| 10-observability.md | Logging, metrics, alerts, sensitive data in logs |
| 11-performance.md | Measured evidence only; likely bottlenecks |
| 12-deployment-infrastructure.md | Compose, Terraform, images, AWS gaps |
| 13-ci-cd-test-strategy.md | CI stages, missing gates, test inventory and evidence classes |
| 14-security-findings.md | Security view linked to gap IDs |
| 15-production-gap-register.md | Gap register |
| 16-production-roadmap.md | Roadmap |
| 17-go-live-checklist.md | Checklist |

## Method

- **Inspection:** `git ls-files`, `git grep`, targeted `grep` and `sed` reads of source, schema, migrations, Dockerfiles, compose and CI. Secret
  values were never printed; findings name file and location only.
- **Live local observation:** read-only queries against the running local Docker stack (`docker logs`, `docker exec … psql` against test
  databases, one anonymous login probe through the gateway). No write to any database, no authentication bypass, no production system.
- **Synthetic benchmark:** one local timing of SHA-256 over six-digit values using a synthetic value (not a real OTP).
- **Evidence labels:**
  - `CODE_INSPECTION` — read in source or schema.
  - `LIVE_LOCAL` — observed on the local Docker stack.
  - `TEST_FIXTURE` — exercised through a test-only harness.
  - `UNIT_TEST`, `INTEGRATION_TEST` — not executed in this audit.
  - `NOT_VERIFIED` — no evidence obtained.

## Commands executed for this audit (no state changes)

```
git status --porcelain | wc -l
git branch --show-current
git log --oneline -8
git rev-parse HEAD
git ls-files | grep …            (inventory of tracked artefacts)
git grep -nE "<pattern>" -- <paths>   (many: secrets patterns masked, fallbacks, guards, routes, Prisma, cache keys, webhooks)
find . -name "Dockerfile*" / "docker-compose*.yml"
node -e 'require("./package.json").scripts'
grep / sed / awk on compose, Terraform, migrations, schemas
docker logs gymcoach-auth-dev --tail 2000 | grep -c …       (counts only)
docker logs gymcoach-ai-dev|gateway-dev … | grep -c …        (counts only)
docker logs gymcoach-ollama --since … (access-log analysis, parsed with the research observer)
docker exec gymcoach-test-postgres-test-1 psql … -c "select …"   (read-only, test databases)
curl -s -o /dev/null -w … http://localhost:3000/health ; POST /auth/login with an invalid account
node -e <SHA-256 sweep 100000..999999>                        (synthetic benchmark)
pnpm audit --prod --json                                      (no output; NOT_VERIFIED)
```

Not run: product unit suites (`pnpm test`), product integration suites, Playwright, load tests, chaos tests, any production or staging command.

## Research isolation

The workout BPM research track lives in three folders that the audit did not modify:

| Path | Git state | Anchor |
|---|---|---|
| `test/research/workout-plan-bpm/` | untracked | frozen dataset `dataset/frozen-150.v1.jsonl`, SHA-256 `eedb1adb…cc849` |
| `results/research/workout-plan-bpm/20261003T054521Z/` | untracked | evaluator manifest SHA-256 `45712c437f1c99b26197f7cdc465ed60662947cf9076a733a8386254752ddcbe` (v4); Gate 1 source aggregate `bd9269003a03883e6b68a46c0cd14fbdf37c3a3d566e4723c7543e2b20de23ef` |
| `docs/research/workout-plan-bpm/` | tracked in part | design package 00–12 |

The frozen artefacts are not in any commit, so the hashes above are the only proof of their content. Production work must not edit these paths.

### Recommended Git strategy (not executed)

1. **Freeze the research snapshot.** On a branch `research/workout-plan-bpm`, commit the research folders in one commit (after the owner
   approves the scope; the working tree also contains unrelated changes). Create an annotated tag `research-bpm-frozen-150-v1` on that commit.
   Record the dataset and evaluator SHA-256 in the tag message.
2. **Production branch.** Create `production-readiness/p0` from `aws-deploy` HEAD after the Batch 0 decision. Keep research paths out of
   production commits (path filter in review).
3. **Release tags.** `production-candidate-rc1` only after all P0 gaps are closed and P5 staging is green. Tags are annotated and signed when
   the team has a signing key.
4. **Remotes.** Per project memory: push only to `aws-deploy` or `master`. Do not push to `feature/payment-gateways` (partner branch); merge or
   cherry-pick from it only.
5. **Working tree hygiene.** Resolve the 171 pre-existing entries before any production tag. Each path is owned by a named workstream.

## Counting

Severity counts are read from the summary table in [15-production-gap-register.md](15-production-gap-register.md) at audit completion:

| Severity | Count |
|---|---|
| P0 | 4 |
| P1 | 20 |
| P2 | 10 |
| P3 | 2 |

## Not in scope

- Workout benchmark results, Qwen quality claims, research conclusions. Those belong to the research track.
- Code changes. None were made.
