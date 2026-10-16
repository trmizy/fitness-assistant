# GYMINI — CONVERSATIONAL INTELLIGENCE GLOBAL COVERAGE

Evidence labels: **REAL BROWSER** · **REAL HTTP/API** · **BACKEND INTEGRATION** · **TEST FIXTURE** · **CODE AUDIT**. Builds on [conversational-intelligence-v2.md](conversational-intelligence-v2.md) and [conversational-intelligence-evaluation.md](conversational-intelligence-evaluation.md). Flags: `CONVERSATIONAL_INTELLIGENCE_V2=off|shadow|on` (default **off**) and `CONVERSATIONAL_INTELLIGENCE_V2_LLM=on` (default **off**).

## Decision

**PARTIAL.** Every scenario in the acceptance list passes on the real stack, but I am not signing it off because the deterministic router generalises to ~80 % on an independent set, the typed-LLM fallback that covers the rest is off by default and only measured on 9 turns, and two behaviours remain partial (see *Defects*).

## Existing architecture preserved?

**YES.** Nothing in the new layer writes state, calls a business tool, or chooses a tool from model output. `runGlobalTurn` sits in `tryTurn` before workflow routing and returns one of: an authoritative **read** answer, a deterministic **recommendation**, a **proposal** (the existing `PROFILE_UPDATE_CONFIRMATION` card via a tiny `UPDATE_GOAL` workflow reusing the roadmap's own `goal`/`targetWeight` slots and validators), or "hand back to the existing pipeline". Signed-off subsystems were not reopened; the full suites are green with the flag off **and** on (below).

## Standalone routing

`classifyGlobal` (deterministic) → optional typed-LLM second opinion **only** for turns nothing deterministic could place → policy. Routes: `READ_STATE · RECOMMEND · WRITE_ACTION · START_WORKFLOW · KNOWLEDGE_QA · SLOT_ANSWER · CORRECTION · CANCEL · SWITCH_WORKFLOW · REFERENCE · EXPLAIN_AND_PROPOSE · NEGATE_ACTION · MULTI`. The LLM can only return READ / RECOMMEND(non-workflow topics) / KNOWLEDGE_QA; a read topic must be corroborated by the message's own vocabulary; pain/injury wording is never handed to it; it is never consulted while a confirmation card is pending or for a generic slot-directed reply inside a waiting workflow. Those limits are re-applied by the caller, so a substituted (worst-case) model cannot bypass them — proven by a test.

## Read-state intents — REAL HTTP/API + REAL BROWSER + BACKEND INTEGRATION

`READ ≠ FIND`: "Tôi đang có PT chưa?" reads `GET user-service /contracts/client` with the caller's own token → *"Bạn đã gửi yêu cầu hợp đồng với PT Linh Phạm — Gói 10 buổi, hiện đang chờ PT duyệt; chưa phải hợp đồng đang hoạt động."* (matches the DB row). No PT search, no workflow, no write. A user with no contract hears "chưa có PT". Also read live from the owning service: program (`/workouts/programs/current`), nutrition target (`/nutrition/goals` → *2.187 kcal/ngày — đạm 193g, carb 201g, béo 68g*, equal to the DB), current menu, goal / height / weight / target (profile), "còn cần giảm bao nhiêu kg" (computed). "Hôm nay tôi tập gì?" is answered by the existing schedule context and never starts `CREATE_WORKOUT_PLAN`; roadmap status stays with the existing roadmap-status intent.

## Personalized recommendations — REAL HTTP/API + REAL BROWSER

Standalone "với tình trạng hiện tại tôi nên cut hay bulk?" → loads the real profile, *"Với 173cm và 80kg (BMI khoảng 26,7) … nên giảm mỡ (cut) trước … Đây là gợi ý tham khảo, không phải chẩn đoán, và mình chưa thay đổi gì."* **No write** (DB snapshot identical). Also sessions/week, meals/day, target weight, "có nên thuê PT" (reads the real contract state first). PT/program recommendations start the existing search workflow. Ask → act: "ok đổi theo đề xuất đó" → `PROFILE_UPDATE_CONFIRMATION` (goal → giảm mỡ) → confirm → one write → "Mục tiêu hiện tại của tôi là gì?" immediately returns *giảm mỡ*.

## Interruptions / Workflow resume — REAL HTTP/API + REAL BROWSER (desktop + 360/375/390/412)

PT search waiting on the budget → "Macro hiện tại của tôi bao nhiêu?" → answered from the ACTIVE NutritionGoal and *"Bạn vẫn đang tìm PT dở. Khi muốn tiếp tục: Ngân sách của bạn cho PT khoảng bao nhiêu …"*; the `agent_workflow_sessions` row is byte-identical (same id, `COLLECTING_SLOTS`, `budgetVnd`) → "2 triệu." resumes it. A knowledge question during a waiting workflow (`protein là gì?`) returns to the chat pipeline and leaves the workflow untouched. **Multi-workflow policy (documented):** one active workflow per session (DB unique index). A new workflow command → the existing behaviour (switch = cancel the old one); a goal change while another workflow waits → the assistant **asks** (no silent cancel); "pause & resume several workflows" is **not** supported.

## Multi-intent

`MULTI` answers every READ/RECOMMEND part and **offers** (never auto-runs) START parts ("Nếu bạn muốn tìm PT, hãy nhắn riêng …"); a knowledge part is left for a separate question. `EXPLAIN_AND_PROPOSE` ("Vì sao bạn nghĩ tôi nên giảm mỡ? Nếu hợp lý thì đổi giúp tôi") explains from the user's own numbers ("không phải chẩn đoán") **and** shows the confirmation proposal — both parts, HITL preserved. Blind corpus: multi-intent 62.5 % first pass → 100 % after fixes (tuned).

## References

In-workflow proposal references ("ok đổi theo đề xuất đó", "lấy mức thấp hơn", "mức giữa" with 2 options → clarification) work. PT/program **item** references ("PT đầu tiên", "thuê người đó") are still resolved by the existing pending-recommendation routing; the classifier labels them (`WRITE_ACTION`) but does not resolve entities. No entity ids are invented.

## Fresh authoritative context — REAL HTTP/API

goal update → next "mục tiêu hiện tại" = new goal ✔; PT hire (two real confirmations → real contract) → next "Tôi có PT chưa?" = the new pending contract ✔; before the hire = "chưa có PT" ✔. Reads never come from memory/RAG/assistant history.

## Enterprise Data Agent / Recommendation Agent

Traces (`ci_global_trace`, Docker logs) for real turns:
`"Tôi đang có PT chưa?"` → `{route:READ_STATE, topic:PT_STATUS, agent:EnterpriseDataAgent, source:user-service:/contracts/client, facts:{live:0}}` ·
interruption → `{route:READ_STATE, topic:NUTRITION_TARGET, interrupts:true, activeWorkflow:FIND_PT, agent:EnterpriseDataAgent, source:fitness-service:/nutrition/goals}` ·
`"PT nào hợp với tôi?"` → `{route:RECOMMEND, topic:PT, agent:FitnessRecommendationAgent, action:start-existing-workflow}` ·
goal proposal → `{action:PROPOSE_PROFILE_CHANGE, write:false}` · `"PT là gì?"` → `{route:KNOWLEDGE_QA, action:routed to chat}`. Full samples: `test/conversational-intelligence/results/live-global.json`.

## Browser verification — REAL BROWSER (Chromium, real login)

`globalcov` 8/8 and `globalmobile` 12/12 (360/375/390/412: natural recommendation readable, confirmation card reachable ≥ 44 px, no horizontal overflow, interruption reminder, resume). Whole browser matrix in the last chain: **48/49**; the one failure was an "AI phản hồi quá lâu" model timeout in the PT-search step; the suite re-run **2/2 pass** (transient model latency, not routing). Screenshots in `test/ai-chat-full-verification/results/screenshots/2x-global-*`.

## Blind corpus

`test/conversational-intelligence/global-blind.json` — **164 turns, 12 categories**, SHA-256 `fefad93d…a8f6`, written **before** the router existed, labels never edited. Frozen first pass: `results/global-blind-first-pass.json` (the runner refuses to overwrite it).

| Metric | **First pass (frozen)** | Post-remediation (tuned — no longer independent) |
|---|---|---|
| Route accuracy | **89.6 % (147/164)** | 100 % |
| READ vs FIND | 92.7 % (38/41) | 100 % |
| READ vs RECOMMEND | 88.7 % (55/62) | 100 % |
| Workflow start | 81.3 % (13/16) | 100 % |
| Interruption | 90.5 % (38/42) | 100 % |
| Switch / cancel | 100 % (8/8) | 100 % |
| Correction | 100 % (10/10) | 100 % |
| Reference | 70.0 % (7/10) | 100 % |
| Multi-intent | **62.5 % (5/8)** | 100 % |
| Negation | 80 % (4/5) | 100 % |
| Knowledge Q&A | 94.7 % (18/19) | 100 % |
| **Unsafe misroutes** (read/recommend/QA/negation → something that mutates) | **0** | **0** |
| Confirmation bypass | 0 (the classifier executes nothing; live: writes only after a card) | 0 |
| Cross-user errors | 0 (live) | 0 |

**Second, independent held-out set** (`global-holdout2.json`, 46 turns, written after the fixes, evaluated once): **76.1 % (35/46)** → 80.4 % (37/46) after two generic fixes (a missing word boundary that made "hai" match "ai", and politeness fillers like "hãy…"); 0 unsafe misroutes. **This is the honest generalisation figure for the deterministic router.** The typed-LLM fallback on the turns it leaves UNKNOWN (qwen3:30b, real): **8/9** correct-or-safe pass-through, 0 unsafe routes, p50 0.7 s. Not a large sample.

## Golden cases

| Golden | Result |
|---|---|
| "Tôi đang có PT chưa?" → READ_CURRENT_PT (no search) | ✅ API + browser + integration |
| "PT nào hợp với tôi?" → recommendation workflow | ✅ |
| "Thuê PT này." → proposed write requiring confirmation (no contract until 2 confirmations) | ✅ live hire |
| Pending-workflow golden (PT waits → macro question → "2 triệu.") | ✅ API + browser + mobile |
| Goal recommendation golden (standalone → "ok đổi theo đề xuất đó" → card) | ✅ |
| Current-state golden after confirmed goal update | ✅ |
| PT status golden (seeded pending contract) | ✅ |
| Program status golden | ✅ |
| Workout status golden ("Hôm nay tôi tập gì?" ≠ CREATE_WORKOUT_PLAN) | ✅ |
| Nutrition status golden (ACTIVE NutritionGoal, 2.187 kcal = DB) | ✅ |
| Earlier CI-V2 golden (70 → đề xuất → 74 → 1m73/72kg) | ✅ **13/13** with the global layer on |

## Regression (flag on, last state)

| Suite | Result |
|---|---|
| ai-service workflow / agent / CI-V2 / global / llm (`--test-concurrency=1`) | **519 / 519**, flag off **and** on |
| whole ai-service suite, flag on | 1008 / 1015; the 3 failures are `plan-generation-equipment.integration` (need a live fitness-service exercise catalog; environment-dependent, unrelated) |
| Foundation evaluator (conversational-workflow-v2) | **30 / 30** both flags; `run_evaluation_tests` 20 / 20 |
| CI-V2 dev corpus 171 / held-out 47 | 0 unit mistakes, 0 contamination, 0 bypass |
| Live chain (Docker, real stack): CI-V2 golden 13/13 · global 23/23 · supervisor 21/21 · QA 99/99 · failure/retry 4/4 · browser 48/49 (+PT re-run 2/2) | ✅ |
| Nutrition repair, bootstrap concurrency, PT/Program/memory | inside the 1008 above |

## Production files changed

New: `conversational-intelligence/global/{router,readers,global-turn,llm-route,evaluate-global}.ts`, `agent-workflow/workflows/update-goal.workflow.ts`. Modified: `agent-workflow/orchestrator.ts` (exports `peekActiveWorkflow`, `describePendingWorkflow`, `startProfileChangeWorkflow`, `storeProposalWorkflow`), `services/fitness-agent.service.ts` (the gate, `UPDATE_GOAL` registration + result), `conversational-intelligence/{recommenders,signals}.ts` (`recommendGoal`; `khoan` word boundary; accept phrases). Tests/tools: `__tests__/conversational-intelligence-global.test.ts`, `test/conversational-intelligence/*` (blind + holdout corpora, runners, live scripts), browser suites `globalcov`/`globalmobile`. No dependency added; no schema/migration.

## Defects

**CRITICAL:** none.

**HIGH — found and fixed before this report (never in a delivered state):**
* The LLM routing fallback sent an *injury* sentence ("Tôi đau lưng nhưng muốn deadlift nặng.") into the PT-search workflow (QA case R01). Fix: no model-derived route can start a workflow; PT/program topics are discarded; pain wording is never handed to the model; regression test with a worst-case model.
* The same fallback could swallow a pending confirmation ("Xác nhận cập nhật") or a slot-directed "ok hãy đề xuất cho tôi" (CI-V2 golden dropped to 10/13). Fix: never consulted with a pending card or a slot-directed reply; regression test.

**MEDIUM — found and fixed:** "Tôi cao bao nhiêu?" answered with the weight (P03); "cần giảm bao nhiêu kg nữa" lost its arithmetic (P17); a meal-*content* question got a "3 bữa" recommendation (N08); a program/roadmap question read the wrong topic (P15/P20); a stale pending draft from another session blocked reads (now session-scoped, non-expired); NEGATE/QA interception broke legacy draft/EVALUATE flows (caught by the existing suites before release); `khoan` matched inside "khoảng" and misread budgets as corrections (CI-V2 signals).

**MEDIUM — open:**
* Deterministic-router generalisation is ~80 % on an independent set. With the LLM fallback **off (default)** an unusual phrasing of a read question can still fall through to the legacy pipeline (e.g. start a PT search). Turn the fallback on and re-measure on a larger set before sign-off.
* The interruption reminder ("Bạn vẫn đang tìm PT dở …") is appended only to structured answers, **not** to RAG-generated knowledge answers (the workflow is preserved, the reminder is missing).

**LOW — open:** `MULTI` never auto-starts a workflow and leaves knowledge parts for a separate question; pausing/resuming several workflows is unsupported; PT/program item references are labelled but resolved by legacy routing; live shadow-mode traffic not collected; `qwen3:4b` not measured.

**INFO:** the typed-LLM path adds ~0.7 s only on UNKNOWN turns; deterministic classification costs microseconds.

## Can Gymini answer naturally outside workflows?

**PARTIAL.** Yes for the supported read / recommend / propose scenarios (proved live, incl. browser); phrasing coverage beyond those patterns depends on the fallback that is off by default.

## Can Gymini preserve a workflow while answering another question?

**YES** (structured reads and recommendations with a reminder; knowledge questions without a reminder).

## Can Gymini distinguish READ vs RECOMMEND vs WRITE?

**YES** for the supported scenarios: read = authoritative service; recommend = deterministic, no write; write = proposal behind the existing confirmation. **Caveat:** independent-set accuracy ≈ 80 % deterministic.

## Is Conversational Intelligence ready for full product sign-off?

**NO.** Ready to keep behind the flag for demos and further evaluation. Before sign-off: enable the LLM fallback in staging and measure it on a larger, independent set; append the reminder to RAG interruption answers; then decide the default-on rollout and the cleanup of the legacy branches.

## Operational note

The Docker dev containers (`auth/user/fitness/ai/gateway`) currently run with the verification override: **isolated test DB/Redis**, both CI flags **on**, SMTP disabled. Restore the normal dev config with `docker compose -f infra/compose/docker-compose.dev.yml up -d --force-recreate`. Nothing was committed. Stop the RunPod pod when finished.
