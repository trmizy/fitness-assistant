# Exercise Duplicate Semantic Review

Date: 2026-09-10
Scope: seven known duplicate normalized exercise-name groups
Status: `REVIEWED - NO AUTOMATIC MERGE`

## Verdict

No duplicate group was merged, deleted, or backfilled into a new canonical-id
scheme. The current source of truth remains:

```text
Exercise.id
```

The safe product behavior is:

```text
PUBLISHED rows can be selected by public/AI paths
STAGING rows stay out of public/AI selection
ambiguous name-only references must fail unless the resolver finds one visible canonical row
explicit exerciseId wins over display name
bad explicit exerciseId never falls back to a good name
```

## Reviewed Groups

`band assisted pull up`

```text
PUBLISHED free_exercise_db row: pull-up-bar + resistance-band
STAGING curated row: resistance-band only
classification: staging/source duplicate with equipment nuance
action: no merge; needs human catalog review before any alias/enrichment
```

`dumbbell floor press`

```text
PUBLISHED free_exercise_db row and STAGING curated row both describe the same broad movement.
classification: staging/source duplicate
action: no merge; candidate for future alias/localization review
```

`goblet squat`

```text
PUBLISHED row coarse equipment=KETTLEBELL
STAGING curated row coarse equipment=DUMBBELLS but required equipment says kettlebell
classification: needs human review due equipment inconsistency
action: no merge
```

`incline dumbbell curl`

```text
PUBLISHED movementPattern=ELBOW_FLEXION
STAGING movementPattern=HORIZONTAL_PULL
classification: likely duplicate, but movement-pattern conflict needs human review
action: no merge
```

`spider curl`

```text
PUBLISHED coarse equipment BODYWEIGHT conflicts with required ez-curl-bar.
STAGING row uses DUMBBELLS coarse equipment while also requiring ez-curl-bar.
classification: needs human review
action: no merge
```

`trap bar deadlift`

```text
PUBLISHED coarse equipment BODYWEIGHT and required bodyweight conflict with actual movement.
STAGING coarse equipment BARBELL but required bodyweight.
classification: needs human review; equipment taxonomy is suspect
action: no merge
```

`zottman curl`

```text
PUBLISHED movementPattern=ELBOW_FLEXION
STAGING movementPattern=HORIZONTAL_PULL
both use dumbbell requirement
classification: likely duplicate, but movement-pattern conflict needs human review
action: no merge
```

## Test Evidence

Current catalog validation intentionally reports these seven groups as
`duplicateNormalizedNames`, while all structural invariants remain clean:

```text
duplicateEquipmentSlugs=[]
duplicateExerciseSources=[]
duplicateExerciseAliases=0
duplicateExerciseMuscleLinks=0
duplicateExerciseEquipmentLinks=0
orphanExerciseEquipmentLinks=0
missingMovementPatternCount=0
missingEquipmentLinkCount=0
invalidRequirementTypeCount=0
invalidMovementPatternCount=0
```

