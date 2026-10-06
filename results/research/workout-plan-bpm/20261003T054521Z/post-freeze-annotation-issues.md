# Post-freeze annotation issues

None recorded at freeze time. Any issue found after freezing is listed here and is NOT repaired in the frozen file.

## Known labeling caveats (recorded, not edited)

- W035 ("À không, tôi muốn giảm mỡ.") is labeled CORRECTION because the correction cue dominates; a reviewer could argue WRITE_ACTION.
- Out-of-scope cases (W141-W150) are labeled UNKNOWN. A reviewer could argue for an existing topic route; the guideline chose UNKNOWN.
- W067 (slang read question) is labeled READ_STATE with a PROGRAM_STATUS reading, which is an interpretation.

## Observed caveats found during the run setup (recorded, NOT repaired in the frozen file)

- **sessionMinutes for F_MG_NO_DAYS.** §9 does not name `sessionDurationMinutes` for F_MG_NO_DAYS, but the production schema defaults it to 60. Verified on the seeded profile of the smoke user: `session_duration_minutes = 60`, `preferredTrainingDays = null`. The gold `missing_slots` for 89 turns list `sessionMinutes` as missing. Whether the workflow treats the profile default as "known" is a question about the workflow's own slot state (`agent_workflow_sessions.slots_json`), which the run measures directly. Not repaired. Reported as a threat to validity.
