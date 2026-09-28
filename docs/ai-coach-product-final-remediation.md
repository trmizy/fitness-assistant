# AI Coach Product Final Remediation

Date: 2026-09-19. Responds to `docs/codex-ai-coach-product-final-recheck.md`
(RETURN TO CLAUDE: CRITICAL 0 / HIGH 0 / MEDIUM 3 / LOW 0). M3–M7 were
confirmed closed by Codex and are untouched. The signed-off foundation
(`orchestrator.ts`, `WorkflowDefinition`/`SlotDefinition`,
`AgentWorkflowSession`) has no change; the generic "never overwrite a known
slot" rule is deliberately preserved.

## 1. Intermediate nutrition constraint lost (was M1, still MEDIUM)

Reproduction: fish (turn 1) -> "À tôi cũng không ăn thịt bò" (turn 2, still
asking `mealsPerDay`) -> "4 bữa" queued `excludedFoodKeys=["fish"]`.

Root cause: `nutritionConstraints` is an optional `WORKFLOW_ONLY` slot; once it
is in `known`, the orchestrator (correctly, for scalar slots) never overwrites
it, so later constraints were dropped. It is an accumulating collection, not a
scalar.

Fix (product layer only): `accumulateNutritionWorkflowConstraints` runs in
`tryTurn` just before `runWorkflowTurn`. If the session's active workflow is a
COLLECTING_SLOTS `CREATE_NUTRITION_PLAN` (and the intent is not another
workflow's), constraints found in the message are merged with the stored set via
the existing `mergeNutritionConstraints` (dedupe by canonical key, never
replace) and written back to `slotsJson`. It never answers the pending slot; the
generic orchestrator then parses `mealsPerDay` from the same message as before.
So "À tôi cũng không ăn thịt bò" merges beef, does not satisfy `mealsPerDay`,
and the next question is still the meals question; "4 bữa, và tôi cũng không ăn
thịt bò" yields `mealsPerDay=4` with fish+beef.

Unsupported in a middle turn (M1 x M2): surfaced immediately — refused with the
list of enforceable groups, the workflow is CANCELLED and nothing is queued
(same "refuse, nothing queued" policy as an initiating message; the user
restates without the unsupported clause). It is never silently dropped.

Not supported (documented, not invented): removing a previously stated
constraint ("tôi ăn cá lại được").

## 2. Compound unsupported exclusion silently discarded (was M2, still MEDIUM)

Reproduction: "tôi không ăn cá và không ăn cay" recognised fish, ignored cay,
and queued a plan.

Root cause: `extractNutritionConstraints` recorded an unsupported item only for
`idx === 0` of a clause list.

Fix: every clause is processed independently; a clause that repeats an
explicit cue ("không ăn cay") is always classified (supported -> exclusion,
else unsupported). A clause WITHOUT its own cue is skipped only when it is
clearly not a food (empty after stop-words, starts with a digit or a
preference/quantity word such as ưu/giảm/dễ/cho/chia/muốn, or mentions "bữa"),
so "không ăn cá, 4 bữa" / "không ăn cá, ưu tiên món Việt" / "không ăn cá, đổi
giúp tôi" do not become false refusals; soft hints stay hints. Result order no
longer matters. Policy unchanged: any hard exclusion that cannot be enforced ->
explicit refusal, no generation. Downstream processor enforcement (fish/peanut/
egg vs eggplant/unknown key) is unchanged (7/7).

Matrix (parser tests): cá+cay, cay+cá, cá+cay+thịt bò (3 items), cay+cá+thịt bò,
thịt bò+cay+cá -> supported `fish`/`beef` and unsupported `["không ăn cay"]`
every time; cá+thịt bò -> both enforced, none unsupported; two sentences;
standalone unchanged; the six non-food follow-on clauses above -> no false
unsupported; duplicates dedupe.

## 3. CANCELLED action could still execute (was MEDIUM)

Reproduction: workout preview -> `dismissDraft` (CANCELLED) -> `execute` with the
same id -> import called, action COMPLETED.

Root cause: `execute()` only short-circuited COMPLETED and checked expiry; any
other status (including CANCELLED) fell through to the business branch.

Fix: in the COMMON `execute()` entry, before any per-kind branch:
`COMPLETED` -> return stored result (idempotent, unchanged); any status other
than `PENDING` -> 409 `Action is <STATUS> and can no longer be confirmed`;
expiry check unchanged. Statuses in use were audited (PENDING/COMPLETED/
CANCELLED only), so no other kind's semantics change. This also covers a
nutrition action auto-CANCELLED by a FAILED job and both draft kinds.
`dismissDraft` is now conditional (`updateMany ... status: PENDING`), idempotent
for repeats, and on a COMPLETED action returns "đã được lưu trước đó" without
touching its status.

Residual (documented): a confirm that has already passed the guard and is
mid-flight when a dismiss arrives is not serialised by a row lock; dismiss's
conditional update means a completed action is never turned CANCELLED.

## 4. Evidence

- `agent-workflow-product-final-remediation.test.ts` 13/13 (2 parser matrices,
  three-turn golden incl. DB row inspection `expectedSlot=mealsPerDay` and
  `mealsPerDay` unset after the beef turn, same-turn merge, dedupe, unsupported
  middle turn, compound initial refusals in 3 shapes, compound-in-revision keeps
  the preview, stale confirm after dismiss for workout and nutrition, FAILED-job
  action, double dismiss, dismiss-after-complete, COMPLETED idempotent, EXPIRED,
  cancelled draft not routed).
- All ai-service agent-workflow suites + exclusion + parsers: 103/103.
- Unchanged Codex v2 foundation evaluator: 30/30.
- fitness-service target resolution + bootstrap + engine (isolated test DB): 20/20.
- Focused regression (fitness-agent-*, Program v2 scoring, nutrition/workout
  invariants, memory, PT/program claims, narrator): 175/175.
- ai-service and fitness-service `tsc --noEmit` clean; frontend build clean.
- Not run: live BullMQ/Ollama nutrition generation (configured provider
  unavailable — ENVIRONMENT), authenticated browser journey,
  `plan-generation-equipment.integration.test.ts` (needs isolated DB
  localhost:55433 + Redis; the earlier "265/269" figure is withdrawn as
  non-reproduced — treat that suite as environment-blocked, neither passing nor
  proven pre-existing).

## Addendum 2026-09-19 (finalization race closure)

Codex's core sign-off found one race: concurrent confirm and dismiss of the same action could both report success. Fixed at the `FitnessAgentAction` lifecycle: confirm claims `PENDING -> EXECUTING` and dismiss claims `PENDING -> CANCELLED`, each one conditional UPDATE, so exactly one wins and the loser answers truthfully; a business failure after the claim returns the action to `PENDING` (no fake COMPLETED); a stale claim (>2 min) is reclaimable, safe through downstream idempotency. No schema migration (`status` is a free string). See `ai-coach-finalization-race-closure.md`.
