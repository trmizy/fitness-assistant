# Gymini Knowledge Catalog Design

Date: 2026-09-09
Scope: fitness-service catalog foundation

## 1. Current Foundation

The fitness-service already owns the structured exercise catalog:

```text
Exercise
Equipment
ExerciseEquipment
ExerciseSource
ExerciseAlias
Muscle
ExerciseMuscle
ExerciseReviewDecision
```

The AI service owns RAG ingestion and vector retrieval. The fitness-service
catalog should therefore remain the relational source of truth for structured
exercise facts, while AI/RAG can consume snapshots or internal read APIs.

## 2. Catalog Facts Suitable For Knowledge Use

Recommended stable fact groups:

```text
exercise identity: id, exerciseName, status, source, ownerId
taxonomy: typeOfActivity, typeOfEquipment, bodyPart, type, movementPattern, mechanics
prescription shape: loggingMode, difficultyLevel
equipment: required/alternative/optional equipment slugs
muscles: primary/secondary/stabilizer muscle mappings
localization/search: aliases and normalized aliases
provenance: ExerciseSource sourceName, externalId, dataLicense, sourceVersion
review: ExerciseReviewDecision for staging/manual-review workflows
```

## 3. Current Read API Surface

Existing user-facing/internal surfaces are enough for browsing and selection:

```text
exercise routes/controller/service
equipment routes/controller
exercise substitution service
exercise muscle map/library endpoints
```

This pass intentionally did not add new public APIs. The immediate gap was not
API shape; it was deterministic test seed parity.

## 4. Suggested Internal Knowledge Endpoint

If AI/RAG needs a clean catalog feed later, add an internal-only endpoint rather
than exposing raw tables publicly:

```text
GET /internal/exercises/catalog-knowledge
```

Access:

```text
x-service-secret or existing internal auth only
not mounted publicly through API Gateway
read-only
paginated
```

Suggested query parameters:

```text
updatedAfter
status
limit
cursor
includeStaging
```

Suggested response shape:

```json
{
  "items": [
    {
      "id": "exercise-id",
      "name": "Barbell Bench Press - Medium Grip",
      "status": "PUBLISHED",
      "movementPattern": "HORIZONTAL_PUSH",
      "mechanics": "COMPOUND",
      "bodyPart": "UPPER_BODY",
      "loggingMode": "REPS_WEIGHT",
      "difficultyLevel": "INTERMEDIATE",
      "equipment": [
        { "slug": "barbell", "requirementType": "REQUIRED" },
        { "slug": "bench", "requirementType": "REQUIRED" }
      ],
      "muscles": [
        { "code": "pectoralis_major", "role": "PRIMARY" }
      ],
      "aliases": [
        { "language": "vi", "alias": "Day nguc don" }
      ],
      "sources": [
        {
          "sourceName": "free_exercise_db",
          "externalId": "Barbell_Bench_Press_-_Medium_Grip",
          "dataLicense": "free-exercise-db"
        }
      ]
    }
  ],
  "nextCursor": "opaque"
}
```

## 5. Ownership Rules

Keep these boundaries:

```text
fitness-service owns structured catalog truth
ai-service owns embeddings, vector ids, prompts, RAG chunks, and retrieval
no vector columns inside fitness-service
no direct Qdrant dependency in fitness-service
no LLM calls during catalog seed
no dev DB dump as knowledge source
```

## 6. Validation Before Export

Before any future catalog-to-RAG export, run:

```text
pnpm --filter @gym-coach/fitness-service run test:catalog:validate
```

Hard requirements for export:

```text
missingMovementPatternCount = 0
missingEquipmentLinkCount = 0
duplicateExerciseSources = 0
duplicateExerciseAliases = 0
duplicateExerciseMuscleLinks = 0
duplicateExerciseEquipmentLinks = 0
orphanExerciseEquipmentLinks = 0
invalidRequirementTypeCount = 0
invalidMovementPatternCount = 0
```

`duplicateNormalizedNames` should stay advisory until the product defines a
canonical slug or variant policy.

