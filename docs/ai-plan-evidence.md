# AI Plan Evidence Pipeline

## Goal

The evidence pipeline enriches AI workout plans with body-composition-aware adjustments and verifiable evidence metadata. It helps the plan worker explain why training volume, cardio, recovery, and nutrition guidance were adjusted, while keeping the existing `plan` response backward compatible.

## Data Sources

- NHANES processed body-measurement data for validation and norms.
- ESPEN BIA guideline summaries for body-composition and BIA interpretation.
- HHS Physical Activity Guidelines summaries.
- WHO Physical Activity Guidelines summaries.
- ISSN sports nutrition and body-composition summaries.

The current ISSN/ESPEN/HHS/WHO chunks are `curated_summary` when they come from curated knowledge chunks. They are not labeled as parsed `paper` or `guideline` text unless the pipeline actually parsed the PDF. The original source class is preserved separately as metadata.

## Commands

Run from `backend/services/ai-service`:

```bash
npm run data:validate
npm run data:ingest
npm run ai:test:evidence
npm run ai:test:plan-evidence
```

Optional, when curated paper chunks change:

```bash
npm run data:process:papers -- --force
npm run data:ingest -- --force
```

## Dev InBody Seed

The real AI Plan worker reads body metrics from `user-service` InBody entries. For demo data, seed a test user without resetting or deleting existing data:

```bash
docker compose -f infra/compose/docker-compose.dev.yml exec user-service \
  sh -lc "pnpm exec tsx src/scripts/seed-dev-inbody.ts --user-id <auth-user-id> --email user@example.com"
```

The script upserts the user's profile and today's InBody entry with:

- heightCm: 173
- weightKg: 85
- bmi: 28.4
- bodyFatPct: 27.3
- waistCm: 90 in notes
- muscleMassKg: 35
- goal: WEIGHT_LOSS
- experience: BEGINNER

## API Test

Generate through the gateway:

```bash
POST /plans/workout/generate
{
  "goal": "FAT_LOSS",
  "durationWeeks": 8,
  "daysPerWeek": 4,
  "exercisesPerDay": 2,
  "trainingLocation": "GYM",
  "equipmentPreference": "MIXED_GYM"
}
```

Then poll:

```bash
GET /plans/job/:jobId
```

Completed plans keep the existing `plan` field and add:

```json
{
  "adjustment_reason": [],
  "evidence_used": [],
  "safety_notes": [],
  "adjustmentReasons": [],
  "evidenceUsed": [],
  "safetyNotes": []
}
```

`evidence_used` is built from retriever metadata, not from model-generated citations. If the LLM invents a source, it is ignored.

## Limitations

- The AI does not diagnose disease or treat medical conditions.
- InBody/BIA depends on hydration, timing, recent exercise, device setup, and measurement conditions.
- Evidence supports plan adjustment; it does not replace a physician, dietitian, or qualified clinical professional.
- Curated summaries are useful for demos and retrieval tests, but they are not a substitute for full PDF extraction and review.
