# 07 — Context Model

Five conceptual groups, each tagged by where its value actually comes from in the real system
(`02-as-is-process.md`). The central rule, stated once and enforced everywhere in this BPM: **the LLM/conversational
layer may propose a candidate value; it may never itself become the persisted, authoritative value.** Persistence
always goes through the Business Service (`08-agent-input-output.md`), after deterministic validation and explicit
confirmation.

## 1. Intent

The single recognized intent for this BPM: `CREATE_WORKOUT_PLAN`. Produced by deterministic keyword/pattern
matching (`global/router.ts`) when CI-V2 is on, or by the legacy intent router when it is off
(`fitness-agent-intent.ts`) — both routes converge on the same `agent-workflow/workflows/create-workout-plan.
workflow.ts` definition. **CANDIDATE** (the router's classification can be wrong) until the workflow actually
starts; **effectively authoritative** once a real `AgentWorkflowSession` row of this type exists, since that row
is itself the source of truth for "which workflow is active."

## 2. Entities

| Entity | Source today | Status |
|---|---|---|
| `goal` | `UserProfile.goal` (authoritative) | AUTHORITATIVE |
| `daysPerWeek` | slot: profile `days.length` if known, else asked | CANDIDATE until slot-resolved, then WORKFLOW_ONLY (not itself persisted to the profile) |
| `sessionMinutes` | slot: profile `sessionMinutes` if known, else asked | same as above |
| `experienceLevel` | `UserProfile.experienceLevel` (via `profileExtractor`) | AUTHORITATIVE |
| `trainingDays` (specific weekdays) | `UserProfile.preferredTrainingDays` → agent 1–7 numbering | AUTHORITATIVE when present; a day **count**, not specific days, is what the generator consumes for scheduling, with weekday labels re-applied afterward |

## 3. Constraints

| Constraint | Source today | Status |
|---|---|---|
| `equipment` | `UserProfile`/`UserEquipment` (authoritative) | AUTHORITATIVE, but **not enforced as a generation-time filter** today — only at confirm-time validation (named gap, `02`/`12`) |
| `trainingLocation` | not a distinct modeled field today — folded into equipment availability in practice | GAP — see `12-gap-analysis-and-next-implementation.md` |
| injury-related exclusions | `UserProfile.injuries` → soft warning only (`workoutSafetyWarnings`) | AUTHORITATIVE fact, **advisory-only** effect (not a hard filter) — disclosed, not silent |
| time availability | `sessionMinutes` (see Entities) | same lifecycle as `sessionMinutes` |
| exercise preferences / exclusions | free-text revision (`exclusions` array in the draft payload) | CANDIDATE, draft-scoped only — never written to the profile |

## 4. User State (authoritative, enterprise-owned)

- `UserProfile` (goal, experience, injuries, safety-screening status, equipment on file).
- Current `WorkoutProgram` (if any) — read before deciding whether a new confirm should replace it
  (`replaceExisting: true` in the import payload).
- `AgentWorkflowSession` — the active (or most recent terminal) workflow row for this user/session; DB-enforced
  at most one active row per (userId, sessionId).
- `FitnessAgentAction` — the pending/terminal draft row(s) for this user/session; TTL-bounded.
- All of the above are read through the Enterprise Data Agent / repository layer — never guessed by the LLM.

## 5. Conversation Context

- Previously supplied values for the current slot-filling pass (kept in `AgentWorkflowSession.slotsJson`,
  authoritative for "what has this workflow already collected," even though each individual value started as a
  CANDIDATE extraction).
- Corrections: the most recent value for a tracked slot always supersedes an earlier one (FR05); no averaging.
- References ("tại sao bài squat lại ở đây" referring to the just-shown draft) — resolved against the
  **currently pending draft's own payload**, never re-inferred by the LLM from scratch.
- Pending-question / interruption-resume bookkeeping — implicit in "which workflow/draft row is still open",
  not a separate persisted field; resuming means re-entering the same row's own `expectedSlot` logic.

## CANDIDATE vs AUTHORITATIVE — summary table

| Group | Example field | Who can set it | Can it alone become persisted truth? |
|---|---|---|---|
| Intent | `CREATE_WORKOUT_PLAN` | deterministic router / legacy intent router | No — only starting a real workflow row makes it operative |
| Entities | `goal` | `UserProfile` | Yes (already authoritative) |
| Entities | `daysPerWeek` | user answer or profile | No — stays `WORKFLOW_ONLY` until the draft/program itself encodes it |
| Constraints | `equipment` | `UserProfile`/`UserEquipment` | Yes (already authoritative), but not generation-filtered today |
| User State | any of the above tables | the owning business service only | Yes — this is the definition of authoritative here |
| Conversation Context | corrections, references | the user, via free text | Never directly — always mediated through a slot/draft field first |

No field in this model is ever written to `WorkoutProgram`/`WorkoutSchedule` directly from the LLM's own inferred
text; every path goes: candidate extraction → slot/draft state → deterministic validation → explicit confirm →
Business Service write.

## Structured context contract (proposed typed shape for the Context Understanding Layer)

This is a **design proposal** — the current implementation carries the same information, but split across
`EnterpriseContext.profile` (authoritative) and `AgentWorkflowSession.slotsJson` (workflow-scoped candidates)
rather than one unified object. A unified shape is proposed here for clarity of research presentation; adopting it
as an actual internal type is listed as implementation work in `12-gap-analysis-and-next-implementation.md`, not
claimed as already built.

```json
{
  "intent": "CREATE_WORKOUT_PLAN",
  "entities": {
    "goal": "FAT_LOSS",
    "daysPerWeek": 4,
    "sessionMinutes": 60,
    "experienceLevel": "INTERMEDIATE"
  },
  "constraints": {
    "equipment": ["DUMBBELL"],
    "trainingLocation": "HOME",
    "exclusions": ["squat"]
  },
  "conversationContext": {
    "corrections": [{ "field": "daysPerWeek", "from": 3, "to": 5 }],
    "missingFields": [],
    "references": [{ "utterance": "tại sao bài squat lại ở đây", "resolvesToDraftId": "..." }],
    "pendingQuestion": null,
    "interruption": { "active": false }
  }
}
```

Field provenance (mirrors the Entities/Constraints tables above):

| Field | How it is obtained |
|---|---|
| `intent` | deterministically parsed (router keyword/pattern match), occasionally confirmed by the constrained LLM fallback |
| `entities.goal` | retrieved from enterprise data (authoritative) |
| `entities.daysPerWeek`, `entities.sessionMinutes` | deterministically parsed from the user's slot answer, or retrieved from enterprise data if already on file |
| `entities.experienceLevel` | retrieved from enterprise data |
| `constraints.equipment`, `constraints.trainingLocation` | retrieved from enterprise data (today; not yet generation-filtered — gap) |
| `constraints.exclusions` | deterministically parsed from free-text revision turns, confirmed by the user implicitly (they stated it) |
| `conversationContext.corrections`, `.missingFields`, `.references`, `.pendingQuestion`, `.interruption` | deterministic state reconciliation inside the workflow orchestrator; the LLM fallback may propose a correction/reference candidate, which the deterministic policy layer accepts or rejects — it is never auto-applied without that check |

No field in `entities`/`constraints` is ever populated purely from unvalidated LLM inference when an authoritative
source exists; the LLM's role, where used at all, is confined to `intent` disambiguation and free-text
`conversationContext` interpretation (see the Conversational Intelligence role section in `08-agent-input-output.md`).
