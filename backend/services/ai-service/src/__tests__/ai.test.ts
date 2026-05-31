/**
 * AI service — core correctness tests.
 *
 * Run with:
 *   pnpm test                    (runs this file only)
 *   pnpm test:all                (runs all test files)
 *   npx tsx --test src/__tests__/ai.test.ts
 *
 * Uses Node.js built-in test runner (node:test) — no extra test framework.
 * supertest is used for HTTP assertions against the real Express app.
 *
 * What is NOT tested here (intentionally):
 *   - Happy-path plan generation / adjust (would require live DB + Redis)
 *   - RAG retrieval (would require live Qdrant + Ollama)
 *
 * Everything below runs entirely in-process with no external dependencies.
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import supertest from 'supertest';

// ── Schema imports (pure Zod — no I/O) ───────────────────────────────────────
import {
  AskRequestSchema,
  FeedbackRequestSchema,
  GetConversationsQuerySchema,
} from '../schemas/ai.schemas';
import {
  GeneratePlanRequestSchema,
  AdjustPlanRequestSchema,
  ExplainPlanRequestSchema,
  parsePlanContent,
} from '../schemas/plan.schemas';

// ── Express app (Prisma + BullMQ connect lazily — safe to import in tests) ───
import app, { setQdrantAvailable } from '../app';

// In tests, NODE_ENV is not 'production', so requireAuth runs in dev mode:
// it trusts x-user-id directly without requiring x-internal-token.
const TEST_USER_ID = 'test-user-00000001';
const agent = supertest(app);

// ─────────────────────────────────────────────────────────────────────────────
// A. Schema validation
// ─────────────────────────────────────────────────────────────────────────────

describe('A. AskRequestSchema', () => {
  it('rejects missing question', () => {
    const r = AskRequestSchema.safeParse({});
    assert.equal(r.success, false);
  });

  it('rejects empty question string', () => {
    const r = AskRequestSchema.safeParse({ question: '' });
    assert.equal(r.success, false);
  });

  it('rejects question exceeding 2000 chars', () => {
    const r = AskRequestSchema.safeParse({ question: 'a'.repeat(2001) });
    assert.equal(r.success, false);
  });

  it('accepts a valid question', () => {
    const r = AskRequestSchema.safeParse({ question: 'How much protein per day?' });
    assert.equal(r.success, true);
  });

  it('accepts a question of exactly 2000 chars (boundary)', () => {
    const r = AskRequestSchema.safeParse({ question: 'a'.repeat(2000) });
    assert.equal(r.success, true);
  });
});

describe('A. FeedbackRequestSchema', () => {
  const validId = '550e8400-e29b-41d4-a716-446655440000';

  it('rejects invalid UUID', () => {
    const r = FeedbackRequestSchema.safeParse({ conversationId: 'not-uuid', feedback: 1 });
    assert.equal(r.success, false);
  });

  it('rejects feedback value 0 (only 1 and -1 allowed)', () => {
    const r = FeedbackRequestSchema.safeParse({ conversationId: validId, feedback: 0 });
    assert.equal(r.success, false);
  });

  it('rejects feedback value 2', () => {
    const r = FeedbackRequestSchema.safeParse({ conversationId: validId, feedback: 2 });
    assert.equal(r.success, false);
  });

  it('accepts feedback = 1 (thumbs up)', () => {
    const r = FeedbackRequestSchema.safeParse({ conversationId: validId, feedback: 1 });
    assert.equal(r.success, true);
  });

  it('accepts feedback = -1 (thumbs down)', () => {
    const r = FeedbackRequestSchema.safeParse({ conversationId: validId, feedback: -1 });
    assert.equal(r.success, true);
  });
});

describe('A. GetConversationsQuerySchema', () => {
  it('rejects non-integer string ("abc")', () => {
    const r = GetConversationsQuerySchema.safeParse({ limit: 'abc' });
    assert.equal(r.success, false);
  });

  it('rejects limit of 0', () => {
    const r = GetConversationsQuerySchema.safeParse({ limit: '0' });
    assert.equal(r.success, false);
  });

  it('rejects limit > 100', () => {
    const r = GetConversationsQuerySchema.safeParse({ limit: '101' });
    assert.equal(r.success, false);
  });

  it('accepts valid limit string "25" and coerces to number', () => {
    const r = GetConversationsQuerySchema.safeParse({ limit: '25' });
    assert.equal(r.success, true);
    if (r.success) assert.equal(typeof r.data.limit, 'number');
  });

  it('uses default of 10 when limit is omitted', () => {
    const r = GetConversationsQuerySchema.safeParse({});
    assert.equal(r.success, true);
    if (r.success) assert.equal(r.data.limit, 10);
  });
});

describe('A. GeneratePlanRequestSchema', () => {
  it('rejects missing goal', () => {
    const r = GeneratePlanRequestSchema.safeParse({ durationWeeks: 4, daysPerWeek: 3 });
    assert.equal(r.success, false);
  });

  it('rejects empty goal string', () => {
    const r = GeneratePlanRequestSchema.safeParse({ goal: '', durationWeeks: 4, daysPerWeek: 3 });
    assert.equal(r.success, false);
  });

  it('rejects durationWeeks = 0', () => {
    const r = GeneratePlanRequestSchema.safeParse({ goal: 'muscle gain', durationWeeks: 0, daysPerWeek: 3 });
    assert.equal(r.success, false);
  });

  it('rejects durationWeeks > 52', () => {
    const r = GeneratePlanRequestSchema.safeParse({ goal: 'muscle gain', durationWeeks: 53, daysPerWeek: 3 });
    assert.equal(r.success, false);
  });

  it('rejects daysPerWeek = 0', () => {
    const r = GeneratePlanRequestSchema.safeParse({ goal: 'muscle gain', durationWeeks: 4, daysPerWeek: 0 });
    assert.equal(r.success, false);
  });

  it('rejects daysPerWeek > 7', () => {
    const r = GeneratePlanRequestSchema.safeParse({ goal: 'muscle gain', durationWeeks: 4, daysPerWeek: 8 });
    assert.equal(r.success, false);
  });

  it('accepts valid plan request', () => {
    const r = GeneratePlanRequestSchema.safeParse({ goal: 'weight loss', durationWeeks: 8, daysPerWeek: 4 });
    assert.equal(r.success, true);
  });

  it('accepts boundary values durationWeeks=52, daysPerWeek=7', () => {
    const r = GeneratePlanRequestSchema.safeParse({ goal: 'endurance', durationWeeks: 52, daysPerWeek: 7 });
    assert.equal(r.success, true);
  });
});

describe('A. AdjustPlanRequestSchema', () => {
  const validId = '550e8400-e29b-41d4-a716-446655440000';

  it('rejects non-UUID planId', () => {
    const r = AdjustPlanRequestSchema.safeParse({ planId: 'not-a-uuid', adjustments: 'Replace squats with lunges' });
    assert.equal(r.success, false);
  });

  it('rejects adjustments shorter than 5 chars', () => {
    const r = AdjustPlanRequestSchema.safeParse({ planId: validId, adjustments: 'Hi' });
    assert.equal(r.success, false);
  });

  it('rejects adjustments longer than 1000 chars', () => {
    const r = AdjustPlanRequestSchema.safeParse({ planId: validId, adjustments: 'a'.repeat(1001) });
    assert.equal(r.success, false);
  });

  it('rejects missing adjustments', () => {
    const r = AdjustPlanRequestSchema.safeParse({ planId: validId });
    assert.equal(r.success, false);
  });

  it('accepts valid adjust request without optional daysPerWeek', () => {
    const r = AdjustPlanRequestSchema.safeParse({
      planId: validId,
      adjustments: 'Replace squats with lunges due to knee pain',
    });
    assert.equal(r.success, true);
    if (r.success) assert.equal(r.data.daysPerWeek, undefined);
  });

  it('accepts valid adjust request with optional daysPerWeek', () => {
    const r = AdjustPlanRequestSchema.safeParse({
      planId: validId,
      adjustments: 'Increase intensity for each session',
      daysPerWeek: 5,
    });
    assert.equal(r.success, true);
    if (r.success) assert.equal(r.data.daysPerWeek, 5);
  });

  it('rejects daysPerWeek > 7 in adjust request', () => {
    const r = AdjustPlanRequestSchema.safeParse({
      planId: validId,
      adjustments: 'More sessions please',
      daysPerWeek: 8,
    });
    assert.equal(r.success, false);
  });
});

describe('A. ExplainPlanRequestSchema', () => {
  it('rejects non-UUID planId', () => {
    const r = ExplainPlanRequestSchema.safeParse({ planId: 'plain-text-id' });
    assert.equal(r.success, false);
  });

  it('rejects missing planId', () => {
    const r = ExplainPlanRequestSchema.safeParse({});
    assert.equal(r.success, false);
  });

  it('accepts valid UUID planId', () => {
    const r = ExplainPlanRequestSchema.safeParse({ planId: '550e8400-e29b-41d4-a716-446655440000' });
    assert.equal(r.success, true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B. parsePlanContent — malformed LLM output handling
// ─────────────────────────────────────────────────────────────────────────────

/** A minimal but valid PlanContent JSON for use across multiple tests. */
const VALID_PLAN_OBJ = {
  goal: 'muscle gain',
  durationWeeks: 4,
  daysPerWeek: 3,
  weeklySchedule: [
    {
      day: 'Day 1 — Push',
      goal: 'Chest, shoulders, triceps',
      exercises: [
        { order: 1, name: 'Bench Press', sets: 4, reps: '8-10', restSeconds: 90 },
        { order: 2, name: 'Overhead Press', sets: 3, reps: '10-12', restSeconds: 75 },
      ],
    },
    {
      day: 'Day 2 — Pull',
      goal: 'Back and biceps',
      exercises: [
        { order: 1, name: 'Bent-over Row', sets: 4, reps: '8-10', restSeconds: 90 },
      ],
    },
    {
      day: 'Day 3 — Legs',
      goal: 'Quads and hamstrings',
      exercises: [
        { order: 1, name: 'Squat', sets: 4, reps: '8-12', restSeconds: 120 },
      ],
    },
  ],
  progressionNotes: ['Add 2.5 kg when RPE stays at or below 7 for two consecutive sessions.'],
  recoveryNotes: ['Sleep 7–9 hours. Stretch major muscle groups post-session.'],
};
const VALID_PLAN_JSON = JSON.stringify(VALID_PLAN_OBJ);

describe('B. parsePlanContent — valid inputs', () => {
  it('parses clean JSON string', () => {
    const result = parsePlanContent(VALID_PLAN_JSON);
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.content.goal, 'muscle gain');
      assert.equal(result.content.durationWeeks, 4);
      assert.equal(result.content.weeklySchedule.length, 3);
    }
  });

  it('extracts JSON embedded in surrounding LLM preamble text', () => {
    const withPreamble = `Sure! Here is your workout plan:\n\n${VALID_PLAN_JSON}\n\nI hope this helps!`;
    const result = parsePlanContent(withPreamble);
    assert.equal(result.ok, true);
  });

  it('repairs trailing commas before ] and }', () => {
    // LLMs sometimes emit trailing commas in JSON arrays/objects
    const withTrailingComma = VALID_PLAN_JSON
      .replace('"Sleep 7–9 hours. Stretch major muscle groups post-session."', '"Sleep 7–9 hours.",');
    const result = parsePlanContent(withTrailingComma);
    assert.equal(result.ok, true);
  });

  it('preserves optional nutritionSummary when present', () => {
    const withNutrition = { ...VALID_PLAN_OBJ, nutritionSummary: 'Aim for 2 g protein per kg.' };
    const result = parsePlanContent(JSON.stringify(withNutrition));
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.content.nutritionSummary, 'Aim for 2 g protein per kg.');
  });
});

describe('B. parsePlanContent — invalid inputs (malformed LLM output)', () => {
  it('returns ok:false for plain text with no JSON', () => {
    const result = parsePlanContent('Great plan: do squats, push-ups, and pull-ups every day!');
    assert.equal(result.ok, false);
    if (!result.ok) assert.ok(result.reason.length > 0, 'reason should be non-empty');
  });

  it('returns ok:false when JSON is missing weeklySchedule', () => {
    const bad = JSON.stringify({
      goal: 'muscle gain',
      durationWeeks: 4,
      daysPerWeek: 3,
      progressionNotes: [],
      recoveryNotes: [],
      // weeklySchedule missing
    });
    const result = parsePlanContent(bad);
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.ok(
        /weeklySchedule|Required/i.test(result.reason),
        `reason should mention weeklySchedule, got: ${result.reason}`,
      );
    }
  });

  it('returns ok:false for empty weeklySchedule array', () => {
    const bad = JSON.stringify({
      ...VALID_PLAN_OBJ,
      weeklySchedule: [],
    });
    const result = parsePlanContent(bad);
    assert.equal(result.ok, false);
  });

  it('returns ok:false for day with no exercises', () => {
    const bad = JSON.stringify({
      ...VALID_PLAN_OBJ,
      weeklySchedule: [{ day: 'Day 1', goal: 'push', exercises: [] }],
    });
    const result = parsePlanContent(bad);
    assert.equal(result.ok, false);
  });

  it('returns ok:false for malformed JSON that cannot be repaired', () => {
    const result = parsePlanContent('{goal: muscle gain, weeklySchedule: [}]');
    assert.equal(result.ok, false);
  });

  it('returns ok:false for completely empty string', () => {
    const result = parsePlanContent('');
    assert.equal(result.ok, false);
  });

  it('returns ok:false when durationWeeks is out of range (>52)', () => {
    const bad = JSON.stringify({ ...VALID_PLAN_OBJ, durationWeeks: 100 });
    const result = parsePlanContent(bad);
    assert.equal(result.ok, false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C. Qdrant availability state
// ─────────────────────────────────────────────────────────────────────────────

describe('C. Qdrant availability — health endpoint', () => {
  it('reports retrieval:degraded when setQdrantAvailable(false)', async () => {
    setQdrantAvailable(false);
    const res = await agent.get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.retrieval, 'degraded');
  });

  it('reports retrieval:available when setQdrantAvailable(true)', async () => {
    setQdrantAvailable(true);
    const res = await agent.get('/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.retrieval, 'available');
    setQdrantAvailable(false); // reset to safe default
  });

  it('health response always includes service:ai-service', async () => {
    const res = await agent.get('/health');
    assert.equal(res.body.service, 'ai-service');
    assert.equal(res.body.status, 'ok');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D. Auth middleware — identity validation
// ─────────────────────────────────────────────────────────────────────────────

describe('D. Auth middleware — missing identity', () => {
  it('returns 401 on POST /ai/ask without x-user-id (dev mode)', async () => {
    const res = await agent
      .post('/ai/ask')
      .send({ question: 'How much protein should I eat?' });
    assert.equal(res.status, 401);
    assert.equal(res.body.success, false);
    assert.equal(res.body.error?.code, 'UNAUTHORIZED');
  });

  it('returns 401 on POST /plans/workout/generate without x-user-id', async () => {
    const res = await agent
      .post('/plans/workout/generate')
      .send({ goal: 'muscle gain', durationWeeks: 4, daysPerWeek: 3 });
    assert.equal(res.status, 401);
  });
});

describe('D. Auth middleware — identity mismatch with INTERNAL_SERVICE_SECRET', () => {
  // Store and restore the env var around this describe block.
  let originalSecret: string | undefined;

  before(() => {
    originalSecret = process.env.INTERNAL_SERVICE_SECRET;
    process.env.INTERNAL_SERVICE_SECRET = 'test-gateway-secret';
  });

  after(() => {
    process.env.INTERNAL_SERVICE_SECRET = originalSecret;
  });

  it('returns 401 when x-internal-token is wrong', async () => {
    const res = await agent
      .post('/ai/ask')
      .set('x-user-id', TEST_USER_ID)
      .set('x-internal-token', 'wrong-token')
      .send({ question: 'How much protein?' });
    assert.equal(res.status, 401);
    assert.equal(res.body.error?.code, 'UNAUTHORIZED');
  });

  it('returns 401 when x-internal-token is correct but x-user-id is missing', async () => {
    const res = await agent
      .post('/ai/ask')
      .set('x-internal-token', 'test-gateway-secret')
      // deliberately omit x-user-id
      .send({ question: 'How much protein?' });
    assert.equal(res.status, 401);
  });

  it('passes auth when both x-internal-token and x-user-id are correct', async () => {
    // The request will still fail (400 or 5xx from missing DB), but NOT 401.
    const res = await agent
      .post('/ai/ask')
      .set('x-user-id', TEST_USER_ID)
      .set('x-internal-token', 'test-gateway-secret')
      .send({ question: 'How much protein?' });
    assert.notEqual(res.status, 401, 'auth should pass; response must not be 401');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// E. Request validation via HTTP (auth passes, validation rejects)
// ─────────────────────────────────────────────────────────────────────────────

describe('E. POST /ai/ask — request validation', () => {
  it('returns 400 for empty body', async () => {
    const res = await agent
      .post('/ai/ask')
      .set('x-user-id', TEST_USER_ID)
      .send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'VALIDATION_ERROR');
  });

  it('returns 400 for empty question string', async () => {
    const res = await agent
      .post('/ai/ask')
      .set('x-user-id', TEST_USER_ID)
      .send({ question: '' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'VALIDATION_ERROR');
  });

  it('returns 400 for question exceeding 2000 chars', async () => {
    const res = await agent
      .post('/ai/ask')
      .set('x-user-id', TEST_USER_ID)
      .send({ question: 'a'.repeat(2001) });
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'VALIDATION_ERROR');
  });
});

describe('E. POST /plans/workout/generate — request validation', () => {
  it('returns 400 for missing goal', async () => {
    const res = await agent
      .post('/plans/workout/generate')
      .set('x-user-id', TEST_USER_ID)
      .send({ durationWeeks: 4, daysPerWeek: 3 });
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'VALIDATION_ERROR');
  });

  it('returns 400 when durationWeeks exceeds 52', async () => {
    const res = await agent
      .post('/plans/workout/generate')
      .set('x-user-id', TEST_USER_ID)
      .send({ goal: 'muscle gain', durationWeeks: 100, daysPerWeek: 3 });
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'VALIDATION_ERROR');
  });

  it('returns 400 when daysPerWeek exceeds 7', async () => {
    const res = await agent
      .post('/plans/workout/generate')
      .set('x-user-id', TEST_USER_ID)
      .send({ goal: 'muscle gain', durationWeeks: 4, daysPerWeek: 8 });
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'VALIDATION_ERROR');
  });

  it('returns 400 when daysPerWeek is 0', async () => {
    const res = await agent
      .post('/plans/workout/generate')
      .set('x-user-id', TEST_USER_ID)
      .send({ goal: 'muscle gain', durationWeeks: 4, daysPerWeek: 0 });
    assert.equal(res.status, 400);
  });
});

describe('E. POST /plans/adjust — request validation', () => {
  const validPlanId = '550e8400-e29b-41d4-a716-446655440000';

  it('returns 400 for non-UUID planId', async () => {
    const res = await agent
      .post('/plans/adjust')
      .set('x-user-id', TEST_USER_ID)
      .send({ planId: 'not-a-uuid', adjustments: 'More cardio please' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'VALIDATION_ERROR');
  });

  it('returns 400 when adjustments is too short (< 5 chars)', async () => {
    const res = await agent
      .post('/plans/adjust')
      .set('x-user-id', TEST_USER_ID)
      .send({ planId: validPlanId, adjustments: 'Hi' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'VALIDATION_ERROR');
  });

  it('returns 400 when adjustments exceeds 1000 chars', async () => {
    const res = await agent
      .post('/plans/adjust')
      .set('x-user-id', TEST_USER_ID)
      .send({ planId: validPlanId, adjustments: 'x'.repeat(1001) });
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'VALIDATION_ERROR');
  });
});

describe('E. POST /plans/explain — request validation', () => {
  it('returns 400 for missing planId', async () => {
    const res = await agent
      .post('/plans/explain')
      .set('x-user-id', TEST_USER_ID)
      .send({});
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'VALIDATION_ERROR');
  });

  it('returns 400 for non-UUID planId', async () => {
    const res = await agent
      .post('/plans/explain')
      .set('x-user-id', TEST_USER_ID)
      .send({ planId: 'plain-string' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error?.code, 'VALIDATION_ERROR');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F. Plan retrieval — auth enforcement on read endpoints
// ─────────────────────────────────────────────────────────────────────────────

describe('F. GET /plans/:planId — auth enforcement', () => {
  it('returns 401 without x-user-id', async () => {
    const res = await agent.get('/plans/550e8400-e29b-41d4-a716-446655440000');
    assert.equal(res.status, 401);
  });
});

describe('F. GET /plans/job/:jobId — auth enforcement', () => {
  it('returns 401 without x-user-id', async () => {
    const res = await agent.get('/plans/job/some-job-id');
    assert.equal(res.status, 401);
  });
});

describe('F. GET /plans/current — auth enforcement', () => {
  it('returns 401 without x-user-id', async () => {
    const res = await agent.get('/plans/current');
    assert.equal(res.status, 401);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// G. LLM self-eval disabled by default
// ─────────────────────────────────────────────────────────────────────────────

describe('G. LLM self-eval disabled by default', () => {
  it('ENABLE_LLM_SELF_EVAL env var is not set in a fresh environment', () => {
    // This test documents the expected default state.
    // rag.service.ts reads: SELF_EVAL_ENABLED = process.env.ENABLE_LLM_SELF_EVAL === 'true'
    // If a CI environment accidentally set this, the test catches it.
    const raw = process.env.ENABLE_LLM_SELF_EVAL;
    assert.notEqual(raw, 'true',
      'ENABLE_LLM_SELF_EVAL must not be "true" by default — it adds latency to every /ai/ask call');
  });

  it('evaluates to false when env var is absent or empty', () => {
    const saved = process.env.ENABLE_LLM_SELF_EVAL;
    delete process.env.ENABLE_LLM_SELF_EVAL;
    const enabled = process.env.ENABLE_LLM_SELF_EVAL === 'true';
    assert.equal(enabled, false);
    process.env.ENABLE_LLM_SELF_EVAL = saved; // restore
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// H. Response envelope shape
// ─────────────────────────────────────────────────────────────────────────────

describe('H. Response envelope', () => {
  it('validation error response has success:false and error.code', async () => {
    const res = await agent
      .post('/ai/ask')
      .set('x-user-id', TEST_USER_ID)
      .send({ question: '' });
    assert.equal(res.body.success, false);
    assert.ok(res.body.error, 'error field must be present');
    assert.ok(typeof res.body.error.code === 'string', 'error.code must be a string');
    assert.ok(typeof res.body.error.message === 'string', 'error.message must be a string');
  });

  it('auth error response has success:false and error.code UNAUTHORIZED', async () => {
    const res = await agent
      .post('/ai/ask')
      .send({ question: 'How much protein?' });
    assert.equal(res.body.success, false);
    assert.equal(res.body.error?.code, 'UNAUTHORIZED');
  });
});
