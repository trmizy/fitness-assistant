# Workout Log QA Checklist

## Setup

Apply the fitness-service schema update before testing against a local database:

```bash
pnpm --filter @gym-coach/fitness-service run db:generate
pnpm --filter @gym-coach/fitness-service run db:migrate
```

If migration is not applied, the consistency checker will report the missing `program_exercise_id` column.

1. Login with a test customer.
2. Create or import a workout plan with 4 exercises in Day 1.
3. Open Workout Log.
4. Open the "Ke hoach tap" tab.
5. Select Day 1.
6. Verify initial progress is 0%.
7. Click "Bat dau tap".
8. Complete exercise 1.
9. Verify progress is 25% and the row shows completed.
10. Complete exercise 2.
11. Verify progress is 50%.
12. Complete exercise 3.
13. Verify progress is 75%.
14. Complete exercise 4.
15. Verify progress is 100% and the session completion screen appears.
16. Return to the plan/day list.
17. Verify the Day 1 progress ring still shows 100%.
18. Refresh the browser.
19. Verify Day 1 still shows 100%.
20. Logout and login again.
21. Verify Day 1 still shows 100%.
22. Run:

```bash
pnpm --filter @gym-coach/fitness-service run workout:check-consistency -- --dry-run
```

23. If dry-run reports only recomputable progress mismatch in dev data, run:

```bash
pnpm --filter @gym-coach/fitness-service run workout:check-consistency -- --fix-safe
```

Do not use `--fix-safe` against production data without backup and review.

For CI-like failure behavior, add `--strict`:

```bash
pnpm --filter @gym-coach/fitness-service run workout:check-consistency -- --dry-run --strict
```

## Docker Verification

Fast profile:

```bash
pnpm docker:test:fast
```

Full profile with mock embeddings:

```bash
pnpm docker:test:full
```

Full profile now seeds Qdrant test collections before AI/RAG checks:

- `exercises`
- `fitness_knowledge`
- `fitness_faq`
- `fitness_evidence`

Real Ollama mode is opt-in:

```bash
USE_OLLAMA=true pnpm docker:test:full
```

If a real model is missing, the test runner prints the `ollama pull` command instead of downloading large models automatically.
