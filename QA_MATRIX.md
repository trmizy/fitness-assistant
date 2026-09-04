# QA MATRIX

| Area | Status | Evidence |
|---|---|---|
| Workout generation P0 reproduction | PASS | Raw fine-tuned model reproduced short schedule |
| Workout semantic repair | PASS | 6 regression tests + 5 live generated plans pass final invariants |
| Workout/nutrition date routing | PASS | Dynamic-clock scripts; live nutrition and workout routing pass |
| Legacy active workout data quality | FAIL | Existing PPL program has label/exercise taxonomy mismatch |
| Live Ollama evaluation | FAIL QUALITY / HARNESS PASS | 24 real calls; fine-tuned workout invariant 33.3%, safety recall 42.9%, citation precision/coverage 50% |
| Dataset evaluator routing | PASS | 1,771 rows routed: 1,762 free text, 9 evidence; structured JSON correctly reports N/A |
| Nutrition hard constraints | PASS | 2 regression tests + live 7-day plan passes calorie/macro/catalog gate |
| Existing full suite | PASS | Current `test:all` scope: 402/402 tests, 54 suites, after nutrition changes |
| Cycle/feedback | PASS | 80/80 on isolated Postgres test DB, including concurrent active-cycle constraint |
| E2E client UI | PARTIAL | Login + six-step onboarding persisted; 8 core routes render; no console warnings/errors; no provider transactions |
| Financial invariants | PARTIAL/PASS | Mock/test DB: duplicate/concurrent webhook, transfer and refund exactly-once pass; real provider/escrow lifecycle blocked |
| Authorization/concurrency | PASS COVERED SCOPE | payment 18/18, gateway 21/21, user 36/36, gym 9/9, chat 9/9; full cross-role business matrix not implemented |
| Monorepo production build | PASS WITH WARNINGS | All workspaces build; frontend bundle 2.05 MB and 6.33 MB background image warnings |
| Docker full-test harness | FAIL ENV/PERF | image build did not finish within 10 minutes; no test container created |
