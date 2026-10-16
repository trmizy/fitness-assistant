# Phase 3 — Rollout Remediation R1.1 — Git Baseline Verification + Narration Latency Bound

Date: 2026-10-07/08. Scope: (1) establish factual git ground truth after HEAD moved
during R1, (2) re-baseline the regression suite against current HEAD, (3) bound
recommendation-narration latency (previously unbounded, up to 2 × 80 s), with a
deterministic fallback and no change to business authority.

Production defaults are unchanged and confirmed still `off` at current HEAD:
`GYMINI_UNIFIED_AI_COACH=off`, `CONVERSATIONAL_INTELLIGENCE_V2=off`,
`CONVERSATIONAL_INTELLIGENCE_V2_LLM=off` (`conversational-intelligence/index.ts`).

## A. Current HEAD

```
$ git rev-parse HEAD
71d2adf7b3e26b078cc229c060b2a6465516af40
$ git branch --show-current
aws-deploy
```

This is **not** the HEAD (`4fb1ae57`) the R1.1 instructions were written against.
HEAD moved three more times after `4fb1ae57`, all before this report was written
(see §B). No reset/rebase/cherry-pick/history-rewrite was performed by this
session at any point — only factual inspection (`git show`, `git log`, `git
reflog`, a detached `git worktree`, since removed).

## B. Merge parents / evidence

Current HEAD is itself a merge commit:

```
$ git show --no-patch --pretty=raw 71d2adf7
commit 71d2adf7b3e26b078cc229c060b2a6465516af40
tree 4dd4b11d75b349854e3fd575582565c40dac222c
parent 1008e5755a17907e02dc58201a53363ffa2ae974
parent f93b03ed99f780fed2e8e1816818de9a3e43c2ef
author trmizy <...> 1791382588 +0700
    Merge remote-tracking branch 'origin/feature/payment-gateways' into aws-deploy
```
55 files changed, 1308 insertions(+), 79 deletions(-) — all under `frontend/`,
`backend/services/user-service`, `backend/services/fitness-service`,
`scripts/aws/` (mobile/web notification + chat-socket fixes). **Zero files under
`backend/services/ai-service/` in this merge** (`git show --stat 71d2adf7 | grep
ai-service` returns nothing).

Local reflog for the full chain since the merge R1 reported (`4fb1ae57`):

```
71d2adf7  2026-10-07 21:16:28  merge origin/feature/payment-gateways
1008e575  2026-10-06 22:41:01  commit: fix(compose): bỏ khai báo AUTH_SERVICE_URL trùng trong ai-service
570f8364  2026-10-06 22:40:34  merge origin/feature/payment-gateways
d3995cd2  2026-10-06 22:40:34  commit: fix(compose): ai-service gọi auth-service qua tên dịch vụ
2bbee3d1  2026-10-06 21:34:49  commit: chore: lưu thay đổi local trên aws-deploy trước khi merge feature/payment-gateways
4fb1ae57  2026-10-06 15:16:49  merge origin/feature/payment-gateways   <- the merge R1 reported
81d9f432  2026-10-06 15:16:44  reset: moving to HEAD
```

`git merge-base --is-ancestor 4fb1ae57 HEAD` → **yes**. `570f8364`'s own
`--stat` also contains zero `ai-service` paths. The only commit in this chain
that touches `ai-service` is `2bbee3d1`.

**`2bbee3d1` is a plain single-parent commit** (`git show --no-patch --pretty=%P
2bbee3d1` → `4fb1ae577fa0ed13ca7a50fbaee82147457f07b5`, one parent), not a merge
resolution. It is a 724-file, 154,791-insertion snapshot of the working tree as
it stood at that moment — consistent with its own message ("save local changes
on aws-deploy before merging feature/payment-gateways") and with this repo's
documented normal workflow of broad safety-snapshot commits before a merge
(`gymini-parallel-agent-safety`). This session did not create that commit.

No judgment is made here about whether `71d2adf7` or `2bbee3d1` were intended —
this section reports only what the commit graph and reflog show.

## C. R1/R1.1 files affected by the merge chain

`git log --name-only 4fb1ae57..HEAD -- backend/services/ai-service/src/conversational-intelligence/ backend/services/ai-service/src/llm/ backend/services/ai-service/src/services/llm.service.ts`
shows exactly one commit touching those paths: `2bbee3d1`, listing every R1 file
(`llm-route.ts`, `readers.ts`, `orchestrator.service.ts`, `llm.service.ts`,
`json_llm_call.util.ts`, `recommendation_narrator.ts`,
`program_recommendation_narrator.ts`, and the rest of
`conversational-intelligence/`). **This is `2bbee3d1` committing this session's
then-uncommitted R1 (and, at that point, in-progress R1.1) working-tree edits —
not R1's work being overwritten.** Verified directly by reading the content at
HEAD:

```
$ git show HEAD:backend/services/ai-service/src/llm/json_llm_call.util.ts | grep NARRATION_BUDGET
export const NARRATION_BUDGET = {
$ git show HEAD:.../llm-route.ts | grep -n "routeAcceptance\|rejectionReason"
  (routeAcceptance, rejectionReason logging present)
$ git show HEAD:.../recommendation_narrator.ts | grep "NARRATION_BUDGET\|narration_result"
  (both present)
```

All R1 and R1.1 code markers are present and intact at current HEAD. Neither
`570f8364` nor `71d2adf7` (the two merges after `2bbee3d1`) touched any
`ai-service` path, so there was no later overwrite either.

The only thing still uncommitted in this session's working tree, as of this
report, is a one-line fixture fix in
`src/__tests__/recommendation-narration-budget.test.ts` (adding
`certificates: []`, `yearsExperience: ""` to a test fixture — the bug described
in §H below) and the new, untracked `src/scripts/narration-qwen-smoke.ts`.

## D. Post-merge regression baseline (current HEAD + working tree)

`npx tsc --noEmit -p tsconfig.json` → **0 errors**.

Full `src/__tests__/*.test.ts` run against the isolated `*_test` Postgres/Redis
(`DATABASE_URL`/`AI_DATABASE_URL` explicitly pointed at
`postgresql://...localhost:55433/gymcoach_ai_test`, `FITNESS_DISABLE_REDIS=true`,
`LLM_PROVIDER=mock`, `NODE_ENV=test`):

First attempt hung indefinitely inside `plan-generation-equipment.integration.test.ts`
(its `test.before()` spawns its own throwaway fitness-service instance on
`localhost:4302`; the spawned child produced no stdout/stderr at all before the
30 s `/health` wait expired). This is the same category of environment
dependency as the already-documented **N6** (`adoptPlan` tests needing a live
fitness-service) — not a narration or routing regression: nothing on that
file's startup path touches `conversational-intelligence/` or `llm/`. It was
excluded from the comparable run below, exactly as N6 was already excluded from
every prior baseline's "known failures" count.

Clean run, 99 of 100 `__tests__` files (excluding the one above):

| Run | Files | Top-level pass markers | Top-level fail markers |
|---|---|---|---|
| R1 "final" (pre-merge, `4fb1ae57`-adjacent) | 100 | 928 (of 937) | 5 |
| **R1.1 (current HEAD, this report)** | **99** | **852 (of 857)** | **5** |

The 5 failures are **identical by name** to every prior baseline, not merely
equal in count:
- `adoptPlan: rejects a customizedWeeklySchedule with the wrong number of days`
- `adoptPlan: rejects a customizedWeeklySchedule that invents an exercise not in the original plan`
- `adoptPlan: rejects a customizedWeeklySchedule that leaves a day with zero exercises`
  (all three: `marketplace-publisher-qualification.integration.test.ts`, `422 !== 400` — **N6**, needs a live fitness-service to return 400 instead of a generic 422)
- `ollama chat payload is unchanged (model, split messages, num_predict as given, JSON format, temperature)`
- `ollama health still requires both local models`
  (both: stale model-name expectation — **N7**)

**No new failures.** The `recommendation-narration-budget.test.ts` file (R1.1's
own new tests) passed 10/10 inside this same run.

Separately, `plan-generation-equipment.integration.test.ts` could not be run to
completion in this session (see above) and is recorded here as a test-infra
environment gap, not a regression — it has not been part of any prior
baseline's named failure list either, so this is new information about test
infra, not a new product defect.

## E. Narration call path

Two call sites per kind, both presentation-only (never inside a
confirmation/mutation path):
- `services/bounded-turn/executor.ts` (lines ~73, ~97)
- `services/fitness-agent.service.ts` (lines ~584, ~635)

Both call `narrateRecommendations()` / `narrateProgramRecommendations()`
(`llm/recommendation_narrator.ts`, `llm/program_recommendation_narrator.ts`)
after the candidate list (PT matches or program matches) has already been
deterministically ranked and selected. Narration's only job is choosing which
pre-built claim strings (from each candidate's own catalog,
`recommendation_claims.ts` / `program_recommendation_claims.ts`) to surface —
it cannot add, drop, or reorder candidates, and cannot borrow another
candidate's claims (enforced by filtering selections against that candidate's
own `catalogIds` set; confirmed by test G in `recommendation-narration-budget.test.ts`).

## F. Timeout / retry — before and after

| | Before R1.1 | After R1.1 |
|---|---|---|
| Timeout per attempt | `CYCLE_ANALYSIS_LLM_TIMEOUT_MS` default (80 000 ms) — shared with cycle-analysis, not narration-specific | `RECOMMENDATION_NARRATION_TIMEOUT_MS`, default **20 000 ms**, narration's own budget |
| Attempts | 2 | **1** |
| Worst case | ~160 s (2 × 80 s) | **20 s** |
| Bound source | `llm/json_llm_call.util.ts`'s `NARRATION_BUDGET = { timeoutMs: ..., attempts: 1 }` | same |

One bounded attempt (not a retry pair) was chosen because a second attempt at
the same budget would double worst-case wait for a presentation-only layer that
already has a correct, instant deterministic fallback — there is no safety
reason to retry here, unlike routing or generation.

## G. Fallback design

On any failure (timeout, invalid JSON, schema-rejected selection, provider
error), `callLlmJson` returns `null` (never throws); the narrator then renders
every candidate from `buildDefaultProgramSelection`/the PT equivalent — a fixed,
deterministic claim selection drawn from that candidate's own real catalog, not
fabricated text, not the raw compatibility score, and not a hidden
recommendation. Candidate ids/order are the function's own input parameter and
are never read from or written by the model call, so a narration failure cannot
change them. This fallback path existed before R1.1 (it already rendered a
default selection whenever `selectionByCandidate` lacked a candidate) — R1.1
only bounded how long it takes to reach the fallback and added the telemetry
below; it did not invent the fallback itself.

## H. Exact model-call counts

Unit-level (`recommendation-narration-budget.test.ts`, 10/10 pass, stubbed at
the `llmService.callLLM` boundary so the narrators' own validation/fallback
code runs for real):
- Success (A, C2): **1** model call, `usedFallback: false`.
- Timeout / invalid JSON / provider error (B, C, D, D2/E2, E): **1** model call
  (never 2), `usedFallback: true`, and the call's `timeoutMs` is asserted equal
  to `NARRATION_BUDGET.timeoutMs` (not the 80 s cycle-analysis default — this is
  what proves the narration budget is actually wired in, not just defined).
- G: a response naming an invented candidate or another candidate's claim id
  falls back for that candidate specifically, with no candidate added/reordered.
- H/I: candidate ids are bit-for-bit unchanged (`JSON.stringify` before/after)
  after a failed narration call.
- A fixture bug was found and fixed while writing these tests: the PT candidate
  fixture was missing `certificates`/`yearsExperience`, which crashed
  `buildClaimCatalog` (`recommendation_claims.ts:148`,
  `candidate.certificates.filter(...)` on `undefined`) — a test-fixture defect,
  not a product defect; fixed in the fixture.

## I. PT narration evidence (real Qwen3 4B)

`src/scripts/narration-qwen-smoke.ts` (new, mirrors `unified-coach-qwen-smoke.ts`'s
pattern; not part of the automated suite — narration's correctness does not
require a live model) against `qwen3:4b-instruct-2507-q4_K_M`
(digest `0edcdef34593`, confirmed present via `ollama list`):

| Run | Budget | Outcome | Latency | `usedFallback` | ids/order preserved |
|---|---|---|---|---|---|
| 1 | 20 000 ms | timeout | 20 104 ms | true | yes |
| 2 (repeat) | 20 000 ms | timeout | 20 082 ms | true | yes |
| 3 (evidence-only, budget raised to 120 000 ms to see real completion time — **not** a production change) | 120 000 ms | timeout | 120 097 ms | true | yes |

On this CPU-only dev host, a PT-narration call (numPredict 800, the larger of
the two prompts) did not complete inside 20 s on any of three attempts,
including one given 120 s. The bound correctly produced exactly one attempt and
a deterministic fallback every time — no hang, no retry storm, no change to
which PTs were shown or in what order.

## J. Program narration evidence (real Qwen3 4B)

Same script, same model:

| Run | Budget | Outcome | Latency | `usedFallback` | ids/order preserved |
|---|---|---|---|---|---|
| 1 | 20 000 ms | timeout | 20 019 ms | true | yes |
| 2 (repeat) | 20 000 ms | timeout | 20 023 ms | true | yes |
| 3 (evidence-only, 120 000 ms budget, run immediately after the PT call above, model now warm) | 120 000 ms | **ok** | **16 752 ms** | **false** | yes |

Run 3 is a genuine success-path observation: `promptTokens: 285,
completionTokens: 87`, a real structured claim selection, well inside the
production 20 s budget once the model is warm. This, together with §I, shows
both ends of real behavior: warm → succeeds inside budget with a real model
selection; cold/contended → bounded fallback, never an unbounded wait.

## K. Real Qwen smoke — summary

Model tag confirmed exact (`qwen3:4b-instruct-2507-q4_K_M`, digest
`0edcdef34593`). Both narrators were exercised against the real model, not a
mock, for both the fallback path (4 of 6 calls, cold/contended) and the success
path (1 of 6 calls, warm — program kind). The PT success path was not directly
observed live in this session (only via the stubbed unit test, which is a valid
substitute since the model-boundary code is identical); this is noted honestly
rather than claimed as directly observed.

## L. Full-suite results on CURRENT HEAD

See §D. Summary: 0 TypeScript errors; 852/857 top-level test markers pass
across 99 of 100 `__tests__` files, with the same 5 named pre-existing failures
(N6 × 3, N7 × 2) as every prior baseline — compared by identity, not count, per
the instruction not to say "same failures" from count alone. One file
(`plan-generation-equipment.integration.test.ts`) could not complete due to its
own spawned-fitness-service dependency not responding; excluded and reported,
not silently dropped.

## M. Remaining AI blockers

- **Recommendation narration latency — closed** by this report (§F, §G,
  verified live in §I/§J).
- General-QA latency on this CPU host: open, unchanged from R1 (a hardware/
  prompt-size issue, not a code defect; see R1 report §"Partially closed").
- N4 (draft-time equipment gate fails open), N5 (`.env` default points at dev
  DB, mitigated by explicit env override in every run in this session), N6
  (`adoptPlan` live-fitness-service dependency), N7 (stale Ollama model-name
  expectation): all open, unchanged, out of this report's scope exactly as in
  R1/Batch 5.
- New, test-infra-only observation: `plan-generation-equipment.integration.test.ts`'s
  spawned fitness-service instance did not come up within 30 s in this
  environment (§D). Not investigated further — out of scope for an AI-narration
  report, and it is a test-harness dependency, not product code.

## N. Remaining platform blockers

- **N1** — fitness-service crashes on an unhandled Redis socket error
  (`repositories/redis.ts` has no `error` listener). Out of AI scope; restart
  `gymcoach-fitness-dev` if a nutrition/workout read starts failing.
- The isolated test Postgres container (`gymcoach-test-postgres-test-1`) was
  found exited (`exitCode=255`, no OOM) at the start of this session's
  continuation, apparently from a host/Docker Desktop restart between turns
  (dev containers with `restart: unless-stopped` came back up on their own;
  this test container, with no such policy, did not). Restarted in this
  session with its data volume intact (`fitness_agent_actions` row count
  unchanged before/after). Not a code defect; noted for whoever maintains the
  dev host's restart policy.

## O. Verdict

**`R1_1_NARRATION_BLOCKER_CLOSED`**

Recommendation narration now has its own bounded budget (one attempt, 20 s,
override via `RECOMMENDATION_NARRATION_TIMEOUT_MS`), a verified-correct
deterministic fallback that never changes the structured recommendation, and
`narration_result` telemetry — all confirmed by 10/10 new unit tests plus real
`qwen3:4b-instruct-2507-q4_K_M` calls exercising both the fallback path and a
genuine success path. The git situation that triggered this report (HEAD moving
during R1) is fully accounted for: R1 and R1.1's code survived three further
merges intact, verified by direct content inspection at current HEAD, not
assumption. The regression suite was re-run against current HEAD and shows the
exact same 5 pre-existing, already-documented failures as every prior
baseline — no new failures. Production defaults remain `off`.

This does not change the overall rollout verdict (`R1_AI_BLOCKERS_PARTIAL` from
R1 stands for the still-open general-QA-latency item); it closes the one AI
blocker this report was scoped to. Per instruction, R2 is not started.
