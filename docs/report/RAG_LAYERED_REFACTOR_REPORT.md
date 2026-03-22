# RAG Layered Refactor Report

## Scope
Refactor AI service question-answering stack into deterministic layered architecture while preserving `/ai/ask` response compatibility.

## Implemented Layers
1. Input and intent parsing: `src/llm/input_parser.ts`
2. Personalization extraction: `src/llm/profile_extractor.ts`
3. Retrieval pipeline: `src/llm/retriever.ts`
4. Domain recommendation engine:
   - Nutrition targets: `src/llm/nutrition_calculator.ts`
   - Workout split and constraints: `src/llm/workout_plan_selector.ts`
   - Aggregation: `src/llm/recommendation_engine.ts`
5. Prompt orchestration: `src/llm/prompt_builder.ts`
6. Generation and validation:
   - Orchestration: `src/llm/orchestrator.service.ts`
   - Safety and consistency checks: `src/llm/answer_validator.ts`
7. Logging and traceability: `src/llm/trace_logger.ts`
8. Evaluation seed cases: `src/evaluation/evaluation_tests.ts`

## API Compatibility
- Existing `/ai/ask` route remains active.
- Existing fields remain returned: `conversationId`, `question`, `answer`, `modelUsed`, `responseTime`, `relevance`, `relevanceExplanation`, `promptTokens`, `completionTokens`, `totalTokens`.
- Added non-breaking enrichment fields: `traceId`, `usedFallback`, `missingFields`, `validationNotes`, `recommendation`.

## Behavior Improvements
- Retrieval is explicit and thresholded with query expansion.
- Nutrition and workout recommendations are deterministic and independent from LLM creativity.
- Prompt includes deterministic recommendation section as single source of truth.
- Answer is checked for numeric drift and unsafe language before returning.
- Orchestration emits trace metadata for observability.

## Current Flow
```mermaid
flowchart TD
  A[User question] --> B[input_parser]
  B --> C[profile_extractor]
  B --> D[retriever]
  C --> E[recommendation_engine]
  D --> F[prompt_builder]
  E --> F
  F --> G[llm_service.callLLM]
  G --> H[answer_validator]
  H --> I[orchestrator payload]
  I --> J[rag.service]
  J --> K[relevance evaluator]
  K --> L[conversation persistence]
  L --> M[/ai/ask response]
```

## Evaluation Coverage
`src/evaluation/evaluation_tests.ts` includes 20 cases across:
- retrieval relevance (4)
- personalization depth (4)
- nutrition consistency (4)
- safety guardrails (4)
- fallback behavior (4)

Executable harness:
- `src/evaluation/run_evaluation_tests.ts`
- Run command: `pnpm --filter @gym-coach/ai-service test:evaluation`
- Latest result: `20/20 passed`

## Build Validation
- Command executed: `pnpm --filter @gym-coach/ai-service build`
- Result: success

## TODO
1. Add automated test runner (Vitest or Jest) and convert evaluation cases to executable assertions.
2. Expand retrieval corpus beyond exercises (nutrition and coaching policy chunks).
3. Add response schema contract test for frontend integration.
4. Add explicit medical-risk escalation branch for severe injury or symptom keywords.
5. Add offline replay tool to benchmark old vs new pipeline with the 20 evaluation cases.
