# Conversational Intelligence V2 — evaluation

Evidence labels used exactly: **REAL BROWSER** · **REAL HTTP/API** · **BACKEND INTEGRATION** · **TEST FIXTURE** · **CODE AUDIT**.
Architecture: [conversational-intelligence-v2.md](conversational-intelligence-v2.md). Reproduce: `test/conversational-intelligence/README` commands at the bottom.

## 1. Decisions

| Item | Decision | Why |
|---|---|---|
| BAML | **NOT ADOPTED** | Not in the repo; needs a native binary + codegen step and its own LLM client, which bypasses `llmService` (timeouts, traces, rate limits). The repo already has `callLlmJson` + Zod for typed output, which gives the same "typed semantic result validated in TypeScript" without a second stack. |
| Promptfoo | **NOT ADOPTED** | `node:test` + a purpose-built corpus evaluator already runs in CI and reports per-capability metrics; Promptfoo would add a runner without adding a measurement we lack. Revisit if multi-model prompt comparison becomes routine. |
| Small-model routing (`qwen3:4b`) | **NOT MEASURED / NOT ADOPTED** | Only `qwen3:30b-a3b` and `nomic-embed-text` exist on the pod. No claim is made. |
| LLM in the parser | Fallback only, **off by default** (`CONVERSATIONAL_INTELLIGENCE_V2_LLM`) | Measured below: fast, but a weak intent classifier. |

## 2. Corpora (synthetic; no production text)

* **Development corpus** — `test/conversational-intelligence/corpus.json`, **171 cases, 16 categories** (units, target weight, goal signals, corrections, contradiction-vs-correction, recommendation requests, multi-slot, ambiguity, references, negation, workflow start, general Q&A, natural/no-diacritic/mixed Vietnamese, confirmation/dismissal, why, interruptions). The layer was tuned against it, so **100 % here is a development number, not evidence of generalisation**.
* **Held-out set** — `holdout.json`, **47 cases**, written after the dev corpus passed and *not* used to tune. Evaluated once before any fix (first row), then again after generic fixes for the gaps it exposed (second row; no longer independent).

| Metric | Dev corpus (171) | Held-out, first run, untuned (47) | Held-out after generic fixes |
|---|---|---|---|
| Intent accuracy | 100 % (35/35) | 100 % (3/3) | 100 % (3/3) |
| Entity exact-match | 100 % (110/110) | **91.4 % (32/35)** | 97.1 % (34/35) |
| Goal signals | 100 % (26/26) | 100 % (5/5) | 100 % (5/5) |
| Correction detection | 100 % (16/16) | **80 % (4/5)** | 100 % (5/5) |
| Recommendation-intent | 100 % (14/14) | **60 % (3/5)** | 100 % (5/5) |
| Reference resolution | 100 % (13/13) | **66.7 % (2/3)** | 100 % (3/3) |
| Ambiguity | 100 % (7/7) | n/a | n/a |
| Negation | 100 % (6/6) | 100 % (2/2) | 100 % (2/2) |
| Why | 100 % (4/4) | n/a | n/a |
| Workflow-intent | 100 % (8/8) | n/a | n/a |
| **Unit mistakes** (height fragment/age used as weight) | **0** | **0** | **0** |
| **Cross-field contamination** | **0** | **0** | **0** |
| **Confirmation bypasses** | **0** | **0** | **0** |

The single remaining held-out miss (`tôi nữ, 1m58, 52kg, …` → `WEIGHT_UNLABELED`, not `WEIGHT_KG`) is a deliberate conservative choice: the interpreter never guesses a weight's role; the policy layer resolves a lone unit-bearing weight to *current weight* only when none is on file.

## 3. Shadow comparison (legacy parsers vs semantic layer) — CODE AUDIT / BACKEND INTEGRATION

Legacy = `extractRoadmapSlotsFromMessage` + `parseWeightKg/parseTargetWeightKg` as they stood at the start of this task (already including the earlier same-day fixes). Full per-case tables: `results/corpus-shadow-comparison.md`, `results/holdout-shadow-comparison.md`.

| Corpus | Entities compared | Legacy correct | New correct | Old correct & new wrong |
|---|---|---|---|---|
| Dev | 93 | 76 (81.7 %) | **93 (100 %)** | **0** |
| Held-out (after fixes) | 34 | 25 (73.5 %) | 33 (97.1 %) | **0** |

The layer therefore did not regress any command the legacy parser handled. Runtime shadow mode (`CONVERSATIONAL_INTELLIGENCE_V2=shadow`) logs `ci_v2_turn` per turn; it was implemented and unit-exercised but the numbers above come from the offline corpus comparison, not from live shadow traffic.

## 4. Model measurement — REAL HTTP/API (configured `qwen3:30b-a3b-instruct-2507-q4_K_M` via the tunnel)

Typed LLM parser alone on a 40-case sample (`results/llm-qwen3-30b-results.json`):

| Metric | Result |
|---|---|
| Invalid / unparsable JSON | 0 / 40 |
| Entity exact-match, raw | 100 % (34/34) |
| Entity exact-match, after the TypeScript validator | 100 % (34/34) (an earlier validator bug dropped `1m 73` / `1.73m`; fixed and re-measured) |
| Forbidden entity (e.g. `73` as a weight) — raw / after validator | 0 / 0 (the sample never provoked the error, so the validator's catch rate is **untested**) |
| Recommendation-request detection | 100 % (5/5) |
| **Intent accuracy** | **40 % (6/15)** — biased to `PROVIDE_INFORMATION`; therefore deterministic rules keep authority over intent and the LLM may only add entity types / fill `UNKNOWN` |
| Latency | min 0.89 s · **p50 1.3 s** · p90 2.1 s · max 3.0 s (short JSON output; the 30B chat answers take 12–16 s) |
| Deterministic layer | **0.063 ms / turn** (3 420 turns) |

Hybrid strategy adopted: deterministic first (≈ instant); typed LLM only when the deterministic reading is `UNKNOWN`/low-confidence; never on the hot path of a plain slot answer.

## 5. Golden conversation

**BACKEND INTEGRATION** (real DB, real orchestrator, stubbed business tools) — `__tests__/conversational-intelligence-v2.test.ts`, and **REAL HTTP/API** (Docker ai-service, flag `on`, real registration/login, isolated test DBs, qwen3:30b) — `test/conversational-intelligence/live-golden.mjs` → **13/13**:

| Turn | Result |
|---|---|
| `Tạo lộ trình cho tôi` | asks target weight |
| `mục tiêu 70kg` (stored goal muscle gain, 80 kg / 173 cm) | conflict question with both ways out — **not** the validator loop |
| `ok hãy đề xuất cho tôi` | derived recommendation: BMI ≈ 26,7, checkpoints 76 → 72 kg, ~0,5 kg/week, ~16 weeks, reasoning inputs, proposes goal change — **not** "give me a number" |
| `74kg` | proposal card: goal → giảm mỡ, target 74 (follows the direction of the assistant's own proposal); **nothing written** |
| `với chiều cao 1m73 thì 80kg là đang khá mập rồi tôi muốn xuống 72kg là đẹp` | card: goal → giảm mỡ, **target 72 (never 73)**; no muscle-gain validator message; no "béo phì/thừa cân" diagnosis; **nothing written** |
| `Xác nhận cập nhật` | one write (`WEIGHT_LOSS`, 72), roadmap request **resumes** into its own confirmable preview |

Also verified live: `Thôi tôi thấy mình đang quá nặng, đổi sang giảm mỡ đi.` is *not* a cancel (proposes the change) while a bare `thôi` still cancels; general Q&A starts no workflow; `Gợi ý chương trình tập cho tôi` still starts the program workflow.

## 6. Special scenarios — BACKEND INTEGRATION (`probe-scenarios.ts` + tests)

| # | Scenario | Result |
|---|---|---|
| 40 | multi-turn belief 70 → propose → 74 → "không phải 74, là 72" | final candidate **72** |
| 50 | goal changed mid-workflow | proposed change, workflow kept, no stale validation loop |
| 51 | "tôi không biết nên tập mấy buổi" / meals / "bạn tự đề xuất đi" | derived proposal (3 buổi / 4 bữa …) behind confirmation; budget & availability are refused as the user's own decision |
| 52 | "tại sao bạn nghĩ tôi nên giảm mỡ? nếu hợp lý thì đổi mục tiêu giúp tôi" | explanation from the user's own numbers ("không phải chẩn đoán") **+** proposed goal change; HITL preserved *(fixed after this scenario first failed)* |
| 53 | negation | `không phải 72` / `tôi không muốn xuống 70` → rejected value, asks for a replacement; never assigned |
| 54 | references | `lấy mức thấp hơn` → 72; `mức giữa` with only two options → clarification (ambiguous) |
| 38 | "vì sao?" | answered from the stored recommendation inputs, no invented certainty |
| 37 | loop | same direction conflict twice → escalates to a proposal instead of repeating |

## 7. Regression

| Suite | Flag off | Flag on |
|---|---|---|
| ai-service workflow / fitness-agent / roadmap / nutrition-authority / CI-V2 / llm tests (`--test-concurrency=1`) | **505 / 505** | **505 / 505** |
| Whole ai-service suite, flag on (1000 tests) | — | 993 pass; 3 fail = `plan-generation-equipment.integration` (needs live fitness-service exercise catalog; **environment-dependent, also failing for non-CI reasons, not exercised by this change**) |
| Foundation evaluator (`conversational-workflow-v2`) | **30 / 30** | **30 / 30** |
| `run_evaluation_tests` | 20 / 20 | — |
| `Remediation Fix E` (20 concurrent starts) | 11/11 alone, both flags | flaky **only** when suites share the test DB in parallel |

## 8. Full multi-agent chat verification, re-run with CI-V2 `on` — REAL HTTP/API + REAL BROWSER (Docker stack)

| Suite | Result |
|---|---|
| 20-step supervisor (roadmap → workout → PT search/why/hire → nutrition → schedule) | **21 / 21** |
| QA corpora (general, exercise, nutrition, personalized, freshness, adversarial/injection, cross-user) — 99 assertions | 97 / 99. Fail 1: **P09** "Tôi đang có PT chưa?" re-enters PT search (known limitation, no contract-status read intent). Fail 2: freshness assertion was a harness regex false-negative — the answer *is* correct ("74 kg … giảm từ mức ban đầu 78 kg"); assertion corrected. |
| Failure/retry (fitness-service container stopped → truthful failure → same action retried once) | 4 / 4 |
| Browser (Chromium, real login; 9 suites: chat, workout, two-tab race, stale card, mobile 360/375/390/412, session/logout/account switch, nutrition, PT hire, roadmap; + "Mở chi tiết" link) | all pass; PT run shows the duplicate-contract guard answering when the client already holds a pending contract with that PT |

Latency (chat, qwen3:30b, unchanged by CI-V2): general/exercise/nutrition/personalized median ≈ 12 s; deterministic/agent turns 0.1–0.3 s; slot turns handled by CI-V2 ≈ 0.1 s.

## 9. Defects found and fixed while doing this (real, reproduced, root-caused, regression-tested)

| # | Class | Defect | Fix |
|---|---|---|---|
| 1 | FRONTEND | Whole page crashed ("Objects are not valid as a React child") on any partial workflow card: backend `known` is `{label,value}[]`, frontend rendered it as strings | render `label: value`; type corrected |
| 2 | FRONTEND | "Mở chi tiết" after saving a plan → 404 (`/client/training` does not exist; real page is `/client/workout`) | route map in `FitnessAgentBlocks.tsx` (verified in a real browser) |
| 3 | INFRASTRUCTURE | Docker dev images for ai/gateway/user were stale (missing dependencies / shared package): `ai-dev` dead for days, PT search 500 | rebuilt |
| 4 | LLM PARSER / WORKFLOW | multi-slot sentence filled only age+height; "nặng 80kg", "mục tiêu của tôi là 70kg", "nam giới" ignored | cue window + gender extraction (then subsumed by CI-V2) |
| 5 | LLM PARSER | `1m73` → target weight 73 in the slot parser | span-consuming typed extraction (CI-V2) + legacy parser fix |
| 6 | WORKFLOW | unparseable answer to a pending slot repeated an unhelpful canned line ("số gì?" → same line) | restate what is being asked; drop the number-scolding when no number was given |
| 7 | CONTEXT | chat stated a generic 2000 kcal while the ACTIVE `NutritionGoal` said 2187 | profile carries the ACTIVE goal; calculator + meal-plan header use it |
| 8 | INTENT ROUTING | nutrition *knowledge* questions ("Macro là gì?") returned a personalized meal-plan template; "hôm nay … bao nhiêu calo?" treated as schedule | knowledge-question guard; nutrition-only guard |
| 9 | WORKFLOW | roadmap bundle showed ✅ for nutrition when `bootstrapNutrition` returned `insufficient_data` (no goal written) | reported as ❌ with the missing fields |
| 10 | INTENT | recommendation cue swallowed the ordinary command "Gợi ý chương trình tập cho tôi" once CI-V2 was on | workflow commands take priority; start hook needs real semantic content |

## 10. Known limits / open items (honest)

* CI-V2 acts inside workflows only; a stand-alone "bạn thấy mục tiêu nào hợp với tôi?" is still answered by the RAG chat. **MEDIUM (coverage).**
* A pending slot workflow still swallows an unrelated question (asks the slot again instead of answering, e.g. a calorie question during a PT search). Reproduced in the supervisor run; the reply now restates the pending question and how to cancel. **MEDIUM (not reopened: signed-off pending-draft routing).**
* PT/program item references are labelled but selection stays with the existing routing. **LOW.**
* Contract-status questions ("Tôi đang có PT chưa?") re-enter PT search. **MEDIUM.**
* The roadmap workflow does not ask for `activityLevel`, which nutrition bootstrap needs. **LOW–MEDIUM** (now reported honestly instead of ✅).
* Default flag is `off`; the verification Docker override sets `on`. Sign-off decision + cleanup plan are in the architecture doc.
* Live runtime shadow traffic was not collected; shadow numbers are offline.
* `qwen3:4b` not measured. The typed-LLM path's catch rate for unit errors is untested (0 raw errors on the sample).

## 11. Reproduce

```
node test/conversational-intelligence/build-corpus.mjs && node test/conversational-intelligence/build-holdout.mjs
node node_modules/tsx/dist/cli.mjs test/conversational-intelligence/run-corpus.ts corpus.json      # or holdout.json
node node_modules/tsx/dist/cli.mjs test/conversational-intelligence/run-llm.ts 40                    # needs the tunnel on :11435
node test/conversational-intelligence/live-golden.mjs                                                # needs the Docker verification stack
(cd backend/services/ai-service && npx tsx --test src/__tests__/conversational-intelligence-v2.test.ts)
```
