# AWS Reference Data Bootstrap Audit — 2026-09-15

Scope: repository seed/bootstrap state only. No AWS CLI, no AWS deployment, no AWS seed execution, no demo/transaction data creation.

## 1 EXECUTIVE SUMMARY

Reference bootstrap is not fully ready for AWS Console execution yet.

Required bootstrap exists in source for User and Fitness reference data, and AI vector ingestion exists in source, but AWS one-time seed Lambda handlers/artifacts have not been created for the required services. Two local safety fixes were made: Fitness exercise partial reseed now fails closed instead of deleting existing rows, and User Vietnam location seed now upserts even on partial DBs.

## 2 AUTH SERVICE bootstrap required YES/NO datasets existing seed source

AUTH BOOTSTRAP REQUIRED = NO.

Existing seed source: `backend/services/auth-service/prisma/seed.ts`.

Classification: demo/test users, not production reference data. It creates real users and passwords for local/demo use. Do not run this against AWS dev reference bootstrap unless intentionally creating demo accounts in a separate demo-data phase.

## 3 USER SERVICE bootstrap required YES/NO datasets exact counts if determinable

USER BOOTSTRAP REQUIRED = YES.

Dataset:

- Vietnam provinces: 34
- Vietnam wards: 3,321

Source files:

- `backend/services/user-service/prisma/seed.ts`
- `backend/services/user-service/prisma/seed_vietnam_locations.ts`
- `backend/services/user-service/prisma/data/vietnam_provinces.json`

Dev/demo seeds explicitly excluded:

- `backend/services/user-service/src/scripts/seed-dev-inbody.ts`
- `backend/services/user-service/src/scripts/seed-agentic-demo.ts`

## 4 FITNESS SERVICE bootstrap required YES/NO exercises count equipment count muscles/anatomy count foods count aliases count templates/defaults count source files

FITNESS BOOTSTRAP REQUIRED = YES.

Counts determinable from repo files:

- Exercises from `raw_exercises.json`: 873
- Foods from `data/nutrition/foods_seed.csv`: 13,159
- Food aliases from `food_aliases.vi.json`: 196
- Muscles/anatomy from `ref_muscles.csv`: 29
- Equipment taxonomy CSV: 24
- Movement patterns: 16
- Levels taxonomy: 3
- Goals taxonomy: 10
- Workout plan CSV rows: 57 plans, 195 plan days, 1,137 plan exercises

Source files/scripts:

- `backend/services/fitness-service/prisma/seed_all.ts`
- `backend/services/fitness-service/prisma/seed_exercises_json.ts`
- `backend/services/fitness-service/prisma/seed_equipment.ts`
- `backend/services/fitness-service/prisma/seed_movement_patterns.ts`
- `backend/services/fitness-service/prisma/seed_equipment_gap_exercises.ts`
- `backend/services/fitness-service/prisma/seed_logging_modes.ts`
- `backend/services/fitness-service/prisma/seed_food_aliases.ts`
- `backend/services/fitness-service/prisma/raw_exercises.json`
- `backend/services/fitness-service/prisma/data/food_aliases.vi.json`
- `data/nutrition/foods_seed.csv`
- `data/catalog/taxonomy/ref_muscles.csv`
- `data/catalog/taxonomy/ref_equipment.csv`
- `data/catalog/taxonomy/ref_movement_patterns.csv`
- `data/catalog/plans/gym_workout_plans.csv`
- `data/catalog/plans/gym_workout_plan_days.csv`
- `data/catalog/plans/gym_workout_plan_exercises.csv`

Important source-backed note: `Muscle` rows are inserted by the Fitness migration `20260819020000_add_exercise_muscle_provenance_schema`, not by `seed_all.ts`.

## 5 GYM SERVICE bootstrap required YES/NO

GYM BOOTSTRAP REQUIRED = NO.

No production reference seed script was found. Gym data such as brands, branches, memberships, collaborations, check-ins and reviews is business/user/transaction data and must not be seeded as reference bootstrap.

## 6 PAYMENT SERVICE bootstrap required YES/NO

PAYMENT BOOTSTRAP REQUIRED = NO.

No production reference seed script was found. Wallets, ledger entries, transactions, commissions, withdrawals and webhook events are transactional/business data and must not be seeded.

Payment method availability is controlled by provider configuration/env, not a DB reference seed source in the audited package scripts.

## 7 AI POSTGRES bootstrap required YES/NO

AI POSTGRES BOOTSTRAP REQUIRED = CONDITIONAL.

Do not seed conversations, plans, orders, recommendations, agent actions, purchases, marketplace reviews or fake personalized-service data.

AI knowledge metadata may be created as a side effect of the knowledge pipeline, but the main required AWS bootstrap for AI is vector index ingestion into OpenSearch from source documents after re-embedding.

## 8 OPENSEARCH INITIAL INGESTION source datasets indices re-embedding strategy

OpenSearch is empty and must not receive raw legacy Qdrant vectors.

Required target indices/collections:

- `exercises`
- `fitness_knowledge`
- `fitness_faq`
- `fitness_evidence`

Source datasets:

- `backend/services/fitness-service/prisma/raw_exercises.json` / exercise catalog sources for exercise documents
- `data/catalog/rag/gym_rag_master_dataset.csv`: 7,072 rows
- `data/catalog/qa/gym_faq_qa.csv`: 5,946 rows
- `data/processed/evidence/*.jsonl`: 83 lines observed
- `data/processed/evidence/_index.json`: 31 indexed evidence records

Re-embedding strategy:

1. Set `VECTOR_STORE_PROVIDER=opensearch`.
2. Set Bedrock embedding provider/model for 1024-dimension vectors.
3. Re-read source documents from repo datasets.
4. Generate fresh embeddings through Bedrock Cohere.
5. Upsert deterministic document IDs into OpenSearch.
6. Verify index counts and vector dimension.

Do not copy or transform old Qdrant 768-dimensional vectors into OpenSearch.

## 9 REFERENCE DATA VS USER DATA VS TRANSACTION DATA

Reference/catalog data:

- Vietnam provinces/wards.
- Fitness exercise catalog.
- Food catalog.
- Food aliases.
- Equipment/muscle/movement taxonomy.
- Exercise provenance/localization/muscle mappings.
- RAG/FAQ/evidence source documents and embeddings.

User-generated/demo data:

- Auth demo users.
- User profiles, InBody demo records, PT synthetic cohorts.
- Conversations, generated plans, recommendations, agent actions.
- Gym brands/branches/reviews created by users/operators.

Transaction/business data:

- Gym memberships/check-ins/collaborations/referrals.
- Payment transactions, wallet ledger, commissions, withdrawals, webhooks.
- Personalized service orders/purchases/refunds.

## 10 IDEMPOTENCY AUDIT

User Vietnam seed:

- Uses `upsert` by province/ward code.
- Changed in this pass to remove the early `province.count() > 0` skip, so partial DBs can self-heal by re-upserting all rows.

Fitness exercise seed:

- `raw_exercises.json` import has no stable unique key in DB for safe partial top-up.
- Changed in this pass to fail closed when `0 < exercise.count() < 873`.
- Fresh DB with zero exercises can seed; complete DB skips; partial DB must be repaired manually.

Fitness food seed:

- Uses `createMany({ skipDuplicates: true })` from `foods_seed.csv`.

Fitness equipment seed:

- Uses stable equipment slugs and `upsert`.
- Recalculates reference exercise-equipment links.

Fitness food aliases:

- Uses unique constraint handling and skips duplicates.

AI/OpenSearch:

- Ingestion scripts use deterministic IDs/upsert patterns; AWS bootstrap still needs a dedicated seed Lambda wrapper/artifact.

## 11 CODE CHANGES

Changed:

- `backend/services/fitness-service/prisma/seed_exercises_json.ts`
  - Removed unsafe partial-catalog `deleteMany({})`.
  - Now throws instead of deleting when the Exercise table is partially populated.

- `backend/services/user-service/prisma/seed_vietnam_locations.ts`
  - Removed early skip on existing province count.
  - Existing upsert loop now runs every time, making partial location bootstrap recoverable.

Local verification:

- `pnpm --filter @gym-coach/user-service build`: PASS
- `pnpm --filter @gym-coach/fitness-service build`: PASS

## 12 SEED LAMBDA HANDLERS CREATED

None created in this pass.

Required but missing:

- `backend/services/user-service/src/seed-lambda.ts`
- `backend/services/fitness-service/src/seed-lambda.ts`
- AI seed/ingestion Lambda wrapper for OpenSearch initial ingestion, if owner wants Console-only one-time ingestion.

## 13 ARTIFACTS paths compressed sizes

No seed Lambda artifacts were created in this pass.

Required but missing:

- `backend/services/user-service/artifacts/user-seed-lambda.zip`
- `backend/services/fitness-service/artifacts/fitness-seed-lambda.zip`
- `backend/services/ai-service/artifacts/ai-seed-lambda.zip`

## 14 IAM REQUIRED FOR EACH SEED LAMBDA

User seed Lambda:

- CloudWatch Logs.
- Secrets Manager read for `fitness-assistant/dev/user-database`.
- VPC ENI permissions only if Aurora is private and the Lambda is VPC-attached.

Fitness seed Lambda:

- CloudWatch Logs.
- Secrets Manager read for `fitness-assistant/dev/fitness-database`.
- VPC ENI permissions only if Aurora is private and the Lambda is VPC-attached.

AI seed Lambda:

- CloudWatch Logs.
- Secrets Manager read for `fitness-assistant/dev/ai-database` if it writes AI Postgres metadata.
- OpenSearch Serverless data access policy for the target collection/indexes.
- Bedrock invoke permission for embedding model.
- VPC ENI permissions only if private networking is required.

## 15 ENV REQUIRED FOR EACH SEED LAMBDA

User seed Lambda:

- `AWS_REGION=ap-southeast-1`
- `DATABASE_SECRET_ID=fitness-assistant/dev/user-database`
- Database guard must require `fitness_assistant_user`.

Fitness seed Lambda:

- `AWS_REGION=ap-southeast-1`
- `DATABASE_SECRET_ID=fitness-assistant/dev/fitness-database`
- Database guard must require `fitness_assistant_fitness`.

AI seed Lambda:

- `AWS_REGION=ap-southeast-1`
- `DATABASE_SECRET_ID=fitness-assistant/dev/ai-database` if AI Postgres metadata is written
- `VECTOR_STORE_PROVIDER=opensearch`
- `OPENSEARCH_SERVERLESS_ENDPOINT=<collection endpoint>`
- `EMBEDDING_PROVIDER=bedrock`
- Bedrock embedding model env used by current AI service configuration
- Database guard must require `fitness_assistant_ai` when touching AI Postgres.

## 16 EXACT AWS MANUAL RUN ORDER

1. Confirm all six logical databases have migrations applied.
2. Do not run Auth seed.
3. Run User reference seed Lambda once for Vietnam locations.
4. Verify province/ward counts.
5. Run Fitness reference seed Lambda once.
6. Verify exercise/food/equipment/muscle/alias counts.
7. Run AI/OpenSearch seed ingestion Lambda once.
8. Verify OpenSearch index counts and vector dimensions.
9. Only after reference bootstrap passes, optionally prepare separate demo-data seed scripts behind explicit demo flags.

This order cannot be executed yet because the seed Lambda handlers/artifacts in section 12/13 are missing.

## 17 POST-SEED VERIFICATION COUNTS

Expected minimum checks:

- User `vietnam_provinces`: 34
- User `vietnam_wards`: 3,321
- Fitness exercises: at least 873 catalog rows on a fresh DB after raw seed, plus any curated additive rows if the full seed pipeline creates them.
- Fitness foods: 13,159 from `foods_seed.csv`
- Fitness food aliases: up to 196 alias source terms, depending on matching against seeded foods.
- Fitness muscles: 29 from migration.
- OpenSearch `fitness_knowledge`: 7,072 source rows expected before chunking/index-specific transformations.
- OpenSearch `fitness_faq`: 5,946 source rows expected before index-specific transformations.
- OpenSearch `fitness_evidence`: 83 JSONL lines / 31 evidence index records observed in source data.

## 18 DEMO DATA what exists what is optional do NOT deploy automatically

Existing demo/test data sources:

- `backend/services/auth-service/prisma/seed.ts`
- `scripts/seed-test-users.mjs`
- `backend/services/user-service/src/scripts/seed-dev-inbody.ts`
- `backend/services/user-service/src/scripts/seed-agentic-demo.ts`
- test fixtures under `src/__tests__`

These are optional demo data only. Do not run automatically as production/reference bootstrap.

## 19 BLOCKERS

P0:

- Required seed Lambda handlers/artifacts are not present for AWS Console manual bootstrap.
- Fitness reference seed was unsafe before this pass; source is now safer, but the Lambda wrapper still does not exist.
- OpenSearch initial ingestion needs a dedicated Console-runnable seed/ingestion artifact with Bedrock re-embedding.

P1:

- Fitness `seed_all.ts` does not run `seed_food_aliases.ts`; AWS bootstrap plan must explicitly include aliases.
- Workout plan/template CSVs exist, but no package-level production seed was confirmed for `WorkoutProgramTemplate`/related defaults.
- Fitness raw exercise seed cannot safely top up a partial DB because exercises lack a stable unique catalog key.

P2:

- Auth seed is demo-heavy and should be split/renamed so operators do not confuse it with production bootstrap.
- AI knowledge ingestion has multiple historical scripts; one authoritative AWS bootstrap wrapper should be created.

## 20 FINAL VERDICT

NOT READY — REFERENCE DATA BOOTSTRAP BLOCKERS REMAIN

