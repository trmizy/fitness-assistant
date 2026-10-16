# Dataset Review — Workout-BPM Frozen Dataset v1.0

Frozen: 2026-10-03T05:51:59.776Z  |  SHA-256: `eedb1adb16bd3a1284371118b5a03c05a883294a815aa0fb3d79cd76ef8cc849`  |  git HEAD: `81d9f432fa856c4e4f06d6b412071f4dbd6c15be`
Cases: **150**  |  Turns: **244**  |  Annotation version: 1.0

Annotator: the implementation author (single annotator; declared threat to validity). Labels follow annotation-guideline.md and were written BEFORE any model output existed.

## Category table

| Category | Cases | Single-turn | Multi-turn |
|---|---|---|---|
| Explicit complete requests | 10 | 9 | 1 |
| Missing-slot requests | 10 | 10 | 0 |
| Multi-turn slot filling | 10 | 0 | 10 |
| Correction | 10 | 2 | 8 |
| Negation | 10 | 6 | 4 |
| No-diacritic Vietnamese | 10 | 7 | 3 |
| Typo/slang | 10 | 10 | 0 |
| Reference/anaphora | 10 | 0 | 10 |
| Equipment constraints | 10 | 8 | 2 |
| Availability | 10 | 8 | 2 |
| Interruptions | 10 | 0 | 10 |
| Resume | 10 | 0 | 10 |
| Conflicting information | 10 | 8 | 2 |
| Adversarial write requests | 10 | 8 | 2 |
| Out-of-scope requests | 10 | 10 | 0 |

## Gold write-authorization labels (turn level)

- PENDING_ONLY: 99
- AUTHORIZED_WRITE: 6
- NO_WRITE: 139

## Gold route distribution (turn level)

- START_WORKFLOW: 112
- SLOT_ANSWER: 33
- UNKNOWN: 27
- KNOWLEDGE_QA: 21
- CONFIRM: 13
- CORRECTION: 11
- WRITE_ACTION: 9
- CANCEL: 6
- NEGATE_ACTION: 5
- REFERENCE: 4
- READ_STATE: 2
- STATUS: 1

## Pre-freeze annotation QA edits (applied before any result existed)

- W001: appended T2 (CONFIRM_LAST_ACTION) to exercise real endpoint confirmation — dataset had no CONFIRM_LAST_ACTION cases, so exactly_once_persistence could not be measured
- W134: appended T3 (CONFIRM_LAST_ACTION) to exercise real endpoint confirmation — dataset had no CONFIRM_LAST_ACTION cases, so exactly_once_persistence could not be measured
- W137: appended T3 (CONFIRM_LAST_ACTION) to exercise real endpoint confirmation — dataset had no CONFIRM_LAST_ACTION cases, so exactly_once_persistence could not be measured
- W137: appended T4 (CONFIRM_LAST_ACTION) to exercise real endpoint confirmation — dataset had no CONFIRM_LAST_ACTION cases, so exactly_once_persistence could not be measured
- W047: T2 route CONFIRM -> CANCEL (family WORKFLOW) — dismissal is a cancellation outcome, not a confirmation (annotation guideline section 4)
- W042 T1: route_family WORKFLOW -> CORRECTION_FAMILY — route NEGATE_ACTION belongs to family CORRECTION_FAMILY in route-vocabulary.json
- W044 T2: route_family WORKFLOW -> CORRECTION_FAMILY — route NEGATE_ACTION belongs to family CORRECTION_FAMILY in route-vocabulary.json
- W045 T1: route_family WORKFLOW -> CORRECTION_FAMILY — route NEGATE_ACTION belongs to family CORRECTION_FAMILY in route-vocabulary.json
- W046 T2: route_family WORKFLOW -> CORRECTION_FAMILY — route NEGATE_ACTION belongs to family CORRECTION_FAMILY in route-vocabulary.json

JSONL syntax: 49 lines had a trailing comma removed (formatting only).

## Coverage notes

- EX01 (missing profile) is NOT represented: no category in the approved taxonomy targets it. Stated as a limitation.
- Draft confirmation happens only through real HTTP (CONFIRM_LAST_ACTION) in cases W001, W134, W137; repeated confirmation is W137 T4.
- Dismissal is W047 T2, W060 T2, W041 T2 (text cancel) and W047 (endpoint dismiss).
- Equipment labels use annotation vocabulary: DUMBBELL, BARBELL, CABLE, PULL_UP_BAR, KETTLEBELL, BODYWEIGHT, RESISTANCE_BAND, FULL_GYM.
