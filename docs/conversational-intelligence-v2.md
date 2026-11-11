# Conversational Intelligence V2 (CI-V2)

Status: implemented behind `CONVERSATIONAL_INTELLIGENCE_V2` (`off` default · `shadow` · `on`). Evidence and numbers: [conversational-intelligence-evaluation.md](conversational-intelligence-evaluation.md).

## 1. The failure this fixes

A real chat (Vietnamese, muscle-gain goal stored, 80 kg / 173 cm):

```
"mục tiêu 70kg"                → "Mục tiêu của bạn là tăng cơ, nhưng 70kg không cao hơn 80kg…"
"ok hãy đề xuất cho tôi"       → "Bạn có thể cho mình một con số cụ thể…"
"74kg"                         → "…74kg không cao hơn 80kg…"
"…1m73 … tôi muốn xuống 72kg…" → "…73kg không cao hơn…"
```

Root causes (audited in code, not assumed):

| Symptom | Root cause |
|---|---|
| 1m73 → 73 kg | `parseWeightKg` took the first weight-shaped number of the message; `1m73` contains `73`. Numbers were not typed by unit. |
| "hãy đề xuất" → "give me a number" | The workflow layer only knows "slot missing → ask". There was no notion of *the user asked me to choose*. |
| endless "not higher than 80kg" | Business validation (`validateContext`) ran **before** any interpretation of what the user meant; the stored goal (muscle gain) was treated as truth and the user's contradicting statement as an invalid value. |
| "Thôi … đổi sang giảm mỡ" cancelled everything | `CANCEL_RE` matched the discourse marker "thôi" before anything else was read. |
| "à không, 72" ignored | Corrections/negations were not represented at all. |

## 2. Design rule: language is intelligent, business is deterministic

```
Natural language
   ↓  InterpretConversationTurn   (deterministic first; typed LLM only when unsure)
Structured semantic interpretation   (zod-validated; units/ranges cross-checked)
   ↓
Conversation belief state            (persisted fact vs current candidate; precedence)
   ↓
Conflict / correction resolution     (BEFORE business validation)
   ↓
Conversation policy                  (next action; loop detection)
   ↓  a `patch` of candidate slot values — never a write
Existing workflow pipeline           (slot validators → PROFILE_UPDATE_CONFIRMATION → confirm → write → RESUME_SENTINEL)
```

Nothing in `src/conversational-intelligence/` writes state, calls a business tool, or chooses a tool. It returns a decision; the existing orchestrator applies it through the existing validators and confirmation cards. HITL is unchanged.

## 3. Module map (`backend/services/ai-service/src/conversational-intelligence/`)

| File | Role |
|---|---|
| `schema.ts` | Strict types: `SemanticInterpretation`, entities, corrections, references, goal signals, negations, ambiguities. |
| `entity-extractor.ts` | Unit-aware, **span-consuming** extraction: height (`1m73`, `1m 73`, `1.73m`, `173cm`, `cao 173`), weights with role (current/target), age, sessions/week, minutes, meals, budget, gender. A character is claimed by at most one entity, so a height fragment can never resurface as a weight. Works on diacritic-stripped text. |
| `signals.ts` | Pattern *families* for goal language (explicit/implicit/negated), correction cues, negation, "you decide", references, "why". |
| `interpreter.ts` | `interpretDeterministic`, `interpretTurn`, typed LLM fallback (`interpretWithLlm`, `llmOnlyReading`) + `validateLlmEntities`. |
| `belief-state.ts` | `BeliefValue { persisted, currentCandidate, source, candidateSource, conflict }` and the precedence table. |
| `conflict-resolver.ts` | `GOAL_CHANGE`, `GOAL_VS_TARGET_DIRECTION`, `GOAL_DROPPED`. |
| `policy.ts` | `decide()` → `ANSWER_WHY · ASK_CLARIFICATION · ASK_MISSING_INFO · PROPOSE_VALUE · PROPOSE_PROFILE_CHANGE · APPLY_AND_CONTINUE · LEGACY`. Owns loop detection and the proposal store. |
| `recommenders.ts` | Deterministic, bounded recommendations (target weight, sessions/week, meals/day, session minutes). |
| `responses.ts` | Vietnamese prose composed from structured facts (numbers always rendered from state). |
| `index.ts` | Flag handling, `semanticTurn`, `persistedFromProfile`, session state (`known.__ci`). |
| `evaluate.ts` | Corpus evaluator shared by the CI test and `test/conversational-intelligence/run-corpus.ts`. |

Integration (the only change to existing code): `agent-workflow/orchestrator.ts` — `handleSemanticTurn` before `handleSlotReply`, a start-of-workflow hook, `applyPatch` (goal first, each value still passes its own slot validator; a rejection is *reported*, never silently dropped), and the cancel-word guard.

## 4. Semantic schema

`SemanticInterpretation { primaryIntent, workflowIntent?, entities[], corrections[], references[], goalSignals[], negations[], ambiguities[], requestedAction?, asksWhy?, clarificationRequired, confidence, source }`.
Entity: `{ type, value, sourceText, explicit, confidence, negated? }`. `WEIGHT_UNLABELED` exists on purpose: a weight whose role the text does not state is **not guessed**.

## 5. Unit-aware extraction (the `1m73` rule)

Order of claiming: role statements ("80 là cân hiện tại, 72 mới là mục tiêu") → height forms → age → minutes → meals → sessions/week → budget → body weights. A weight needs a unit (`kg/ký/cân`) or an explicit role cue; a bare `72` without either is an **ambiguity** unless the slot context (the assistant just asked for the target) or a same-message anchor (`80kg … muốn xuống 72`) makes it clear.

## 6. Belief state & precedence

`CURRENT_CORRECTION > CURRENT_USER > CONFIRMED_WORKFLOW > AUTHORITATIVE_DB > STABLE_MEMORY > INFERENCE`.
A higher-ranked candidate wins **for reasoning only**; the persisted value stays untouched until the existing confirmation card is accepted. The state that must survive turns (an assistant proposal, loop counters) lives in the workflow session (`known.__ci`), not in long-term memory.

## 7. Conflict → policy examples

| Situation | Decision |
|---|---|
| target < weight, stored goal = muscle gain, **no** goal words | `ASK_CLARIFICATION` with both ways out (change goal / raise target) + offer to recommend |
| same conflict asked once already, user keeps going the same way | loop detection → `PROPOSE_PROFILE_CHANGE` (goal + target) |
| explicit goal change ("đổi sang giảm mỡ", "không tăng cơ nữa, muốn giảm mỡ") | `PROPOSE_PROFILE_CHANGE` |
| implicit goal language ("khá mập") **and** the numbers point the same way | `PROPOSE_PROFILE_CHANGE`; the casual remark is never turned into a diagnosis |
| implicit goal language alone | not trusted (no change proposed) |
| "hãy đề xuất" while the target is missing | `PROPOSE_VALUE` (derived range + checkpoints + why) |
| "lấy mức thấp hơn / mức đó / ok" after a proposal | `APPLY_AND_CONTINUE` (or `PROPOSE_PROFILE_CHANGE` if the proposal implies a goal change) |
| "mức giữa" with only two options | `ASK_CLARIFICATION` (ambiguous reference) |
| budget / availability days | the user's decision — no invented value |

## 8. Recommendations (no invented health targets)

`recommendTargetWeight` derives everything from the user's height, weight and goal: BMI, checkpoints at 5 % / 10 % loss (or +2 % / +4 % lean gain), never below a BMI-21 floor, a 0.65 %/week (loss) or 0.25 %/week (gain) pace. It returns the inputs it used, so "vì sao?" is answered from data. High BMI + muscle gain → `GAIN_NOT_ADVISED` (suggest fat loss / recomposition). Missing height or weight → `INSUFFICIENT` and the assistant says which fact is missing.

## 9. Confidence policy

`≥ 0.85` use as-is (still unit/range validated) · `0.55 – 0.85` combine with the deterministic parser and context · `< 0.55` (or any ambiguity) → clarify. The typed LLM is consulted **only** when the deterministic reading is `UNKNOWN` or low-confidence with no entities; its entities are dropped if the digits are not in the message, if out of physical range, or if a metre-form height's tail is offered as a weight. LLM entities can only **add** types the parser missed; deterministic entities win on conflict.

## 10. Feature flag & rollout

`CONVERSATIONAL_INTELLIGENCE_V2=off|shadow|on` (default `off`). `shadow` runs the layer and logs `ci_v2_turn` (action, reason, intent, conflicts) while the legacy pipeline answers. `CONVERSATIONAL_INTELLIGENCE_V2_LLM=on` additionally allows the typed LLM second opinion. Rollout: shadow → compare → `on` in the verification stack → default `on`.

**Cleanup plan (no permanent duplicate architecture):** after sign-off make `on` the default, delete the `off`/`shadow` branches in `orchestrator.ts`, and fold the legacy slot parsers that the semantic layer supersedes (`extractRoadmapSlotsFromMessage`, `parseTargetWeightKg` cue logic) into `entity-extractor.ts`. The `LEGACY` policy action then remains only as "no conversational signal → canonical slot answer".

## 11. Known limits (honest)

* CI-V2 acts **inside workflows** (slot collection / start). A stand-alone question outside any workflow ("bạn thấy mục tiêu nào hợp với tôi?") is still answered by the RAG chat, not by the policy layer.
* PT/program *item* references ("PT đầu tiên", "thuê người đó") are labelled by the interpreter but the selection itself is still handled by the existing pending-draft / recommendation routing.
* Responses are composed deterministically from structured state (no LLM narration) — predictable, but less varied than free generation.
* `qwen3:4b` was not available on the pod, so small-model routing is **not measured and not adopted**.
* BAML and Promptfoo were evaluated and not adopted (see the evaluation doc).
