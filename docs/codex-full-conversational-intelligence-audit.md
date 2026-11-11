# Codex Full Conversational Intelligence Audit

Date: 2026-10-02

Role: independent evaluator. Scope was verification and reporting only. I did
not modify production code, prompts, model settings, or corpus labels. The only
repository change made by this pass is this report.

## Executive Verdict

| Area | Verdict |
|---|---|
| X1 - error origin | CLOSED |
| X2 - log privacy | CLOSED |
| X3 - CI-on regression | CLOSED, with live-harness caveat |
| X4 - confirmation truthfulness | OPEN |
| Targeted defect remediation | NO-GO |
| Demo readiness | GO WITH LIMITATIONS |
| CI-V2 default-on readiness | NO-GO |
| Full product readiness | NO-GO |

Primary reason X4 remains open: the required real HTTP reproduction and matrix
were blocked by the current auth test harness expecting `devOtp` while the
running stack returns `202 OTP sent`. Independently of that harness block, I
found a remaining confirmation-boundary ordering defect: when an older-created
action is updated/cancelled after a newer-created completed action, the boundary
still reports the completed action as the latest status because action selection
is ordered by `createdAt`, not latest event `updatedAt`.

## Evidence Classification

| Evidence type | What I treat as verified |
|---|---|
| Fresh commands in this pass | Verified by Codex on 2026-10-02. |
| Code inspection | Verified from current workspace files. |
| Prior docs | Treated as implementation-owner or prior-audit claims unless independently re-run here. |
| Live HTTP scripts blocked at registration | Not verified as product behavior; recorded as harness/environment limitation. |

The workspace is dirty with many tracked and untracked files. I did not revert
or normalize it; this audit evaluates the current workspace state.

## Reports Reviewed

- `docs/conversational-intelligence-v2.md`
- `docs/conversational-intelligence-evaluation.md`
- `docs/conversational-intelligence-global-coverage.md`
- `docs/conversational-intelligence-final-stabilization.md`
- `docs/codex-qwen3-4b-recheck.md`
- `docs/codex-conversational-intelligence-final-signoff.md`
- `docs/conversational-intelligence-targeted-remediation.md`
- `docs/codex-conversational-intelligence-targeted-remediation-signoff.md`
- `docs/conversational-intelligence-final-defect-closure.md`
- `docs/codex-conversational-intelligence-final-closure-signoff.md`
- `docs/conversational-intelligence-x4-followup-fix.md`
- `docs/conversational-intelligence-x4-event-ordering-fix.md`

## Timeline

| Phase | Problem | Implementation | Reported evidence | Independent verification | Remaining gap |
|---|---|---|---|---|---|
| CI-V2 workflow interpreter | Legacy workflow turns were brittle around slots, corrections, and confirmations. | Added deterministic CI layer behind `CONVERSATIONAL_INTELLIGENCE_V2`, with optional typed LLM fallback. | Golden 13/13; dev corpus 171/171 after tuning. | Code defaults are still off. Current backend test suite passes under CI off/on modes. | Tuned corpus numbers are not held-out product readiness. |
| Global coverage | CI only helped inside workflows; standalone reads/recommendations still misrouted. | Added global router, readers, standalone recommenders, and knowledge pass-through. | Blind corpus improved after remediations, but docs honestly record held-out deterministic limits near 80 percent. | Current code has deterministic global routing plus constrained LLM fallback. | Qwen3 4B is not sufficient for default-on generalization. |
| Final stabilization | Need compare deterministic vs 4B fallback. | Introduced frozen global-blind-2 and route metrics. | Config A 71.6 percent, Config B 64.9 percent on live 4B sample, Config C not measured. | `docs/codex-qwen3-4b-recheck.md` confirms 4B latency and routing weakness. | 30B remains unmeasured on frozen corpus. |
| Targeted remediation | D1 draft flakiness and D2 profile error mapping. | Added pending draft state, disabled LLM fallback while draft pending, and profile error boundary. | 39/39 stress and regression claims. | Prior Codex found X1-X6. Current code/tests close X1-X3, but X4 remains open. | Live browser and HTTP harness were not fully reverified. |
| Final defect closure | X1-X4 claimed closed. | Added profile-origin tagging, log redaction, specialist ownership gates, and confirmation boundary. | 212/212 A/B/C, X4 39/39. | Current suite passes 248/248 for B/C and effective A coverage passes. | Original X4 live script is blocked by auth harness. |
| X4 follow-up | Post-confirmation status answer could deny a real completed profile update. | Added two-source resolution across `FitnessAgentAction` and `AgentWorkflowSession`. | 45-cell matrix. | Code has two-source merge. Required live script blocked. | New action event-ordering edge remains. |
| X4 event-ordering fix | Terminal profile workflows could be truncated; action `createdAt` was not enough. | Added `FitnessAgentAction.updatedAt`, DB-level profile workflow query, workflow index. | 57/57 matrix, 246/246 A/B/C. | Migration exists; profile workflow query no longer truncates. | `fitness-agent.service.ts` still feeds the newest-created action, not newest-updated action. |

## Production Change Inventory

Conversational interpretation:
- `backend/services/ai-service/src/conversational-intelligence/schema.ts`
- `entity-extractor.ts`
- `signals.ts`
- `interpreter.ts`
- `belief-state.ts`
- `conflict-resolver.ts`
- `policy.ts`
- `recommenders.ts`
- `responses.ts`
- `index.ts`
- `evaluate.ts`

Global routing:
- `backend/services/ai-service/src/conversational-intelligence/global/router.ts`
- `readers.ts`
- `global-turn.ts`
- `llm-route.ts`
- `turn-state.ts`
- `profile-errors.ts`
- `evaluate-global.ts`

Workflow integration:
- `backend/services/ai-service/src/agent-workflow/orchestrator.ts`
- `workflow-state.repository.ts`
- `workflows/update-goal.workflow.ts`
- `workflows/roadmap.workflow.ts`
- `workflows/find-pt-program.workflow.ts`
- `workflows/create-workout-plan.workflow.ts`
- `workflows/create-nutrition-plan.workflow.ts`
- `backend/services/ai-service/src/services/fitness-agent.service.ts`
- `backend/services/ai-service/src/services/confirmation-boundary.ts`

Tool and business boundaries:
- `backend/services/ai-service/src/services/fitness-agent-tools.ts`
- `backend/services/ai-service/src/services/fitness-agent-intent.ts`
- existing clients remain the business-service boundary; CI does not own
  enterprise data.

Persistence and migrations:
- `backend/services/ai-service/prisma/migrations/20260915120000_agent_workflow_session/migration.sql`
- `backend/services/ai-service/prisma/migrations/20260916090000_agent_workflow_session_active_unique/migration.sql`
- `backend/services/ai-service/prisma/migrations/20260927150000_fitness_agent_action_updated_at/migration.sql`
- Prisma models include `AgentWorkflowSession` and `FitnessAgentAction.updatedAt`.

## Architecture Verification

The current code still matches the intended architecture:

1. CI/global interpretation runs in `fitness-agent.service.ts` before normal
   workflow/RAG routing when `CONVERSATIONAL_INTELLIGENCE_V2=on`.
2. `conversational-intelligence/global/global-turn.ts` decides whether a turn is
   read, recommend, write/propose, knowledge Q&A, correction, or pass-through.
3. Read/recommend paths call deterministic readers and recommenders. They do
   not directly write business state.
4. Write/propose paths start or continue `AgentWorkflowSession` workflows.
5. Human-in-the-loop confirmation remains required before business writes.
6. Confirmed writes call service tools and downstream business services rather
   than directly authoring enterprise state.
7. The DB records workflow/action state and the business services remain the
   source of truth.

This is still an enterprise-data-agent plus fitness-recommendation-agent shape,
not unrestricted model tool execution.

## Feature Flags

Code inspection of `conversational-intelligence/index.ts` confirms:

- `CONVERSATIONAL_INTELLIGENCE_V2` defaults to `off`.
- `CONVERSATIONAL_INTELLIGENCE_V2_LLM` defaults to `off`.

The verification override `test/ai-chat-full-verification/docker-compose.verification.override.yml`
sets `CONVERSATIONAL_INTELLIGENCE_V2=on` and defaults
`CONVERSATIONAL_INTELLIGENCE_V2_LLM` to `on` for test stacks. That is test-only
configuration and does not change the code default.

## Fresh Regression Results

Commands were run against the running `gymcoach-ai-dev` container.

| Configuration | Result |
|---|---|
| A: CI-V2 off, LLM off | Initial full command: 248 discovered, 244 pass, 4 fail because corpus files were absent in `/app/test/conversational-intelligence`. After copying `corpus.json`, `holdout.json`, `global-blind.json`, and `global-holdout2.json` into the container, the affected corpus test files passed 26/26. This is effective coverage, but not a single clean 248/248 A command. |
| B: CI-V2 on, LLM off | 248/248 pass, 0 fail, duration 298.038s. |
| C: CI-V2 on, LLM on | 248/248 pass, 0 fail, duration 390.837s. |

Live HTTP checks:

- `node test/conversational-intelligence/codex-final-confirmation-followup.mjs`
  failed before AI behavior: `register failed 202 {"message":"OTP sent", ...}`.
- `node test/conversational-intelligence/x4-confirmation-matrix.mjs codex-full-audit 1`
  failed across scenarios for the same registration expectation.
- `node test/conversational-intelligence/live-golden.mjs` failed at the same
  `devOtp` registration assumption.
- `node test/conversational-intelligence/live-global.mjs` failed because it
  expected `gymcoach-test-postgres-test-1`, while the running stack is the dev
  stack.

Therefore live golden 13/13, global golden 23/23, and the strengthened X4 live
matrix are not freshly verified in this pass.

## X1 Error Origin

Verdict: CLOSED.

Code and tests support the fix:

- Profile errors are classified through profile-read origin handling, not by a
  broad status-code-only catch.
- Food substitution and unrelated tool errors are not supposed to be converted
  into profile outage answers.
- Authorization failures remain authorization failures and are not turned into
  successful responses.
- Current regression suite passes with CI-V2 off and on.

Limitation: I did not get a clean live HTTP X1 run because the live harness is
currently blocked at registration.

## X2 Log Privacy

Verdict: CLOSED.

Code inspection supports the fix:

- `global/llm-route.ts` constrains LLM route output to a small schema and
  allowlisted topics.
- Rejected topic diagnostics use `[rejected]` instead of untrusted topic text.
- `callLlmJson` is invoked with redacted error detail for CI routing.
- Accepted/rejected routing diagnostics and correlation identifiers remain
  available.

Current tests pass in B and C. I did not observe raw private profile values or
model-generated secret text in the CI routing diagnostic path during this pass.

## X3 CI-On Regression

Verdict: CLOSED, with live-harness caveat.

Evidence:

- B: 248/248 pass with CI on and LLM off.
- C: 248/248 pass with CI on and LLM on.
- Code inspection confirms topic-less recommend is gated by
  `STANDALONE_RECOMMEND_TOPICS` before profile read.
- Pending draft turns block LLM fallback, preserving draft correction routing.
- Legacy specialist cues remain able to retain ownership for food substitution
  and meal logging.
- LLM fallback is constrained to read/recommend/knowledge/other, not write.

Caveat: live golden and live global scripts were not verified due harness
failures described above.

## X4 Confirmation Truthfulness

Verdict: OPEN.

Verified closed portions:

- `findLatestProfileConfirmation` now queries terminal profile workflows at the
  DB level using user/session scope and `pendingProfileUpdate` existence.
- It is not limited to the last five terminal workflow rows.
- `mergeConfirmationState` compares profile workflow `updatedAt` against action
  event time.
- `tryConfirmationBoundary` is anchored to confirmation/status utterances and
  returns state-specific answers for pending, completed, cancelled, expired, and
  absent confirmations.

Required live reproduction not verified:

- The requested script
  `test/conversational-intelligence/codex-final-confirmation-followup.mjs`
  failed at registration because auth returned `202 OTP sent` instead of
  inline `devOtp`.
- The strengthened matrix failed for the same reason and did not exercise DB
  transitions.

New independently reproduced defect:

In `fitness-agent.service.ts`, the confirmation boundary loads actions with:

```ts
orderBy: { createdAt: "desc" },
take: 10,
select: { status: true, expiresAt: true, updatedAt: true },
```

It then derives action state from that created-time ordering and passes
`actions[0]?.updatedAt` into `mergeConfirmationState`.

I created two temporary `FitnessAgentAction` rows in the dev DB:

- Action A: status `CANCELLED`, older `createdAt`, newer `updatedAt`.
- Action B: status `COMPLETED`, newer `createdAt`, older `updatedAt`.

Expected latest-event answer: cancelled/no active saved operation. Actual
boundary result for `Da luu thanh cong chua?`: `state:"COMPLETED"` and a
positive saved answer: "Rồi - thao tác gần nhất ... đã được xác nhận và lưu."

The script cleaned up the temporary rows. This is a false positive success
claim after multi-action event ordering. It does not demonstrate an
unauthorized write, but it keeps X4 open.

## Business-State Truth And HITL

Status: pass with limitations.

What is verified:

- CI/global routing does not directly write profile, PT, nutrition, or workout
  business state.
- Profile writes still go through workflow confirmation.
- LLM fallback is not allowed to produce write/action routes.
- The strengthened profile-workflow path fixes the earlier "completed profile
  workflow with no action row" blind spot at code level.

Limitation:

- The action ordering defect can produce an incorrect post-confirmation status
  answer in a multi-action history.
- Live confirmation matrix DB transitions were not verified because of auth
  harness registration failure.

## Deterministic Router And LLM Fallback

Status: not default-on ready.

The deterministic router is useful and safer than open-ended model routing, but
the repo's own reports still show meaningful held-out limits:

- First global held-out after generic fixes reached only 80.4 percent route
  accuracy.
- Frozen global-blind-2 deterministic Config A was 71.6 percent route accuracy.
- Local qwen3:4b hybrid was slower and worse than deterministic on the fair
  live subset in the stabilization report.

The LLM fallback is properly constrained in code and useful as a second opinion,
but qwen3:4b is not accurate enough to justify default-on.

## Model Evidence

Verified from existing reports, not freshly remeasured here:

- qwen3:4b local routing/generalization remains insufficient.
- qwen3:4b local latency is high; the C regression run took 390.837s.
- qwen3:30b has not been measured on the relevant frozen global corpus.
- Fine-tuning is not proven necessary; the stronger current conclusion is that
  product logic should remain deterministic-first and model fallback should
  remain optional/off by default.

## Specialist Routing

Status: closed for the targeted regression scope.

Code inspection and current tests support:

- Food substitution keeps specialist ownership.
- Meal-log turns keep specialist ownership.
- Topic-less recommend does not force an unnecessary profile read.
- Pending draft correction is not hijacked by LLM fallback.

## Security And Cross-User Isolation

Status: partially verified.

Code inspection supports user/session scoping across workflow sessions and
confirmation boundary queries. LLM fallback has no unrestricted tool execution
path and cannot produce arbitrary write routes.

Not freshly verified in this pass:

- Live cross-user HTTP matrix, because live scripts failed before auth/login.

Known remaining limitation from prior reports:

- Profile-origin 401/403 may still be represented as HTTP 500 at an outer
  boundary.

## RAG, Browser, And Runtime Readiness

RAG interruption reminder:
- Previous reports list this as remediated in product copy/routing. I did not
  re-run a browser/RAG interruption path here.

Browser:
- Not verified in this pass. The live browser/golden harness was blocked by
  current auth/test-stack assumptions.

AWS/runtime consistency:
- Local Docker/Ollama qwen3 results are not proof of AWS runtime readiness.
- Existing deployment/readiness reports indicate provider-specific live checks
  must be treated separately.

## Report Versus Code Consistency

Consistent:

- CI-V2 and CI-V2 LLM defaults remain off in code.
- Verification Docker config can override them on.
- Profile workflow confirmation is now included in confirmation-boundary
  resolution.
- `FitnessAgentAction.updatedAt` migration exists.

Inconsistent or overclaimed:

- A report claim of fully closed X4 is stronger than the current code supports
  because action selection still begins from newest `createdAt`.
- Live matrix/golden claims are not reproducible in this environment without
  fixing the auth/test harness or supplying OTP retrieval.
- Successful X1-X3 regression does not imply CI-V2 default-on readiness.

## Defect Register

| ID | Status | Severity | Evidence |
|---|---|---|---|
| X1 profile-origin misclassification | Closed | High | Code origin tagging plus current regression pass. |
| X2 unsafe routing diagnostics | Closed | High | Allowlist/redaction code and current regression pass. |
| X3 CI-on ownership regression | Closed | High | B/C 248/248 and code gates. |
| X4 confirmation truthfulness | Open | Medium/High | New multi-action event-ordering false positive; live required scripts blocked. |
| X5 free-text draft exclusion | Open limitation | Medium | Prior reports preserve this limitation; not reopened here. |
| X6 browser timeout/slow local model | Open limitation | Medium | Browser not freshly verified; 4B remains slow. |
| 401/403 as HTTP 500 | Open limitation | Medium | Preserved from prior reports. |
| qwen3 4B routing accuracy | Open limitation | High for default-on | Existing frozen/held-out metrics insufficient. |
| qwen3 30B frozen corpus | Not measured | Medium | No relevant frozen-corpus measurement found. |
| Live test harness OTP assumption | Open test infra issue | Medium | Multiple live scripts fail at `register failed 202 {"message":"OTP sent"}`. |

## Thesis And Product Claims

Safe claims:

- Gymini has a deterministic-first conversational workflow layer.
- CI-V2 improves workflow slot/correction/confirmation behavior behind flags.
- Business writes remain gated by workflow/HITL confirmation.
- LLM routing is constrained and off by default.
- The current system is demo-usable with scripted, known-good paths and stated
  limitations.

Unsafe claims:

- "CI-V2 is ready to enable by default."
- "X4 is fully closed across all DB states."
- "qwen3:4b is accurate enough for broad autonomous routing."
- "qwen3:30b has passed the frozen corpus."
- "Targeted closure proves full product readiness."

## Final Decisions

1. X1 CLOSED.
2. X2 CLOSED.
3. X3 CLOSED, with live-harness caveat.
4. X4 OPEN.
5. Targeted defect remediation: NO-GO.
6. Demo readiness: GO WITH LIMITATIONS.
7. CI-V2 default-on readiness: NO-GO.
8. Full product readiness: NO-GO.

Recommended stopping point: do not start another hardening cycle from this
report unless explicitly requested. The next narrow fix would be to order
confirmation action state by latest event (`updatedAt`) rather than newest
creation time, then repair the live auth harness so the X4 matrix and golden
scripts can be run as real HTTP evidence again.
