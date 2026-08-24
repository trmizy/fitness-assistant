# QA REMAINING ISSUES

## BUG-AI-SAFETY-LIVE-001

- Severity: P1 health safety
- Actual: live fine-tuned safety recall is 42.9%; acute pain, neurological symptoms and extreme dieting were missed.
- Expected: deterministic pre-LLM triage catches every critical golden case; direct model output is never exposed.
- Status: OPEN; pipeline guard remains mandatory.

## BUG-E2E-PROVIDER-GAPS-001

- Severity: P1 release assurance
- Actual: no SMS sandbox, Dropbox Sign credential, real payment sandbox or production vision ground-truth set. Escrow/release/no-show/prorated-refund/clawback were not verified end-to-end.
- Expected: provider sandbox tests with role-separated users plus DB/ledger reconciliation.
- Status: BLOCKED EXTERNALLY / COVERAGE OPEN.

## BUG-TEST-DOCKER-BUILD-001

- Severity: P2 DevOps
- Actual: `docker:test:full` image build remained active beyond 10 minutes and produced no runner container.
- Root cause: Dockerfile copies the whole monorepo before a fresh frozen pnpm install, reducing cache effectiveness.
- Status: OPEN; isolated service suites were used as fallback.

## BUG-UI-AI-HEALTH-DUPLICATE-001

- Severity: P3/P2 performance
- Actual: one AI Plans load made three successful `/plans/llm-health` requests.
- Expected: one request per freshness window unless explicitly retried.
- Status: OPEN; no functional failure.

## BUG-AI-WORKOUT-001

- Severity: P0/P1 health-safety boundary
- Module: AI workout plan generation
- Actual: invalid schedule or semantically wrong exercise replacement can reach a completed result.
- Expected: final schema and semantic invariants pass, otherwise fail closed.
- Status: FIXED IN CODE / FOCUSED RETEST PASS — full regression remains.

## BUG-AI-EVAL-001

- Severity: P1
- Module: live model evaluation
- Actual: direct raw-model plan output frequently violates structure/semantics. Live golden results: base/fine-tuned workout invariant both 33.3%; base/fine-tuned safety recall 71.4%/42.9%; citation precision and coverage 100%/50%.
- Expected: models must meet release thresholds; safety triage must occur before model generation and final deterministic validation must remain mandatory.
- Evidence: `backend/services/ai-service/artifacts/live-evaluation/summary-2026-08-17T05-34-13-375Z.json` plus raw JSONL.
- Status: HARNESS FIXED / MODEL QUALITY OPEN. Fine-tuned is not demonstrably better than base.

## BUG-AI-NUTRITION-ALLERGY-001

- Severity: P1 safety
- Module: nutrition food candidate filtering
- Actual: restrictions are included in the prompt, but the catalog endpoint has no authoritative allergen metadata and deterministic selection cannot prove allergen safety from food names alone.
- Expected: structured allergen/dietary tags and exclusion in the candidate query before LLM/deterministic composition.
- Status: OPEN — final arithmetic/catalog validation is fixed, but allergy certification remains blocked by missing structured source data.

## Known environment issue

- Prisma generation on Windows may hit `EPERM` while its engine binary is held open; workflow verification remains pending.

## BUG-DATA-WORKOUT-LEGACY-001

- Severity: P1
- Module: existing active workout programs / workout schedule chat
- Actual: test account's persisted legacy PPL plan labels a Pull day but contains press/quadriceps exercises; a Push day contains core exercises. The chat faithfully exposes this inconsistent stored plan.
- Expected: existing active plans must pass the same semantic taxonomy invariants as newly generated plans.
- Evidence: live schedule queries on 2026-08-18, 2026-08-20 and 2026-08-21.
- Status: OPEN — new generation is protected; existing persisted data needs a non-destructive audit/quarantine/regeneration workflow.
