import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../app';
import { ragService } from '../services/rag.service';
import { llmService } from '../services/llm.service';
import { conversationService } from '../services/conversation.service';
import { LlmError } from '../errors/api-error';

const originalRag = ragService.rag;
const originalCallLlm = llmService.callLLM;
const originalQueuePlanGeneration = conversationService.queuePlanGeneration;

const requiredHeaders = {
  Authorization: 'Bearer test-token',
  'x-user-id': 'user-123',
  'x-internal-token': 'test-internal-secret',
};

test.beforeEach(() => {
  process.env.INTERNAL_SERVICE_SECRET = 'test-internal-secret';
});

test.afterEach(() => {
  ragService.rag = originalRag;
  llmService.callLLM = originalCallLlm;
  conversationService.queuePlanGeneration = originalQueuePlanGeneration;
});

test('POST /ai/ask accepts valid Vietnamese request and avoids placeholder markers', { concurrency: false }, async () => {
  ragService.rag = async (question: string) => ({
    conversationId: 'conv-1',
    question,
    answer: 'Ban nen uu tien squat va deadlift 3 buoi moi tuan de tang suc manh.',
    modelUsed: 'test-model',
    responseTime: 0.2,
    promptTokens: 10,
    completionTokens: 30,
    totalTokens: 40,
    traceId: 'trace-1',
    responseLanguage: 'vi' as const,
    usedFallback: false,
    missingFields: [],
    validationNotes: [],
    recommendation: {} as any,
  });

  const res = await request(app)
    .post('/ai/ask')
    .set(requiredHeaders)
    .send({ question: 'toi muon giam mo bung va tang co' });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.match(res.body.data.answer, /(Ban|nen|squat|deadlift)/i);
  assert.doesNotMatch(res.body.data.answer.toLowerCase(), /(coming soon|demo|sample|mock|placeholder)/);
});

test('POST /ai/ask rejects invalid body', { concurrency: false }, async () => {
  const res = await request(app)
    .post('/ai/ask')
    .set(requiredHeaders)
    .send({ question: '' });

  assert.equal(res.status, 400);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, 'VALIDATION_ERROR');
});

test('POST /ai/ask rejects direct request without gateway token', { concurrency: false }, async () => {
  const res = await request(app)
    .post('/ai/ask')
    .set({ Authorization: 'Bearer test-token', 'x-user-id': 'user-123' })
    .send({ question: 'test direct access' });

  assert.equal(res.status, 401);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, 'UNAUTHORIZED');
});

test('POST /ai/ask returns structured 503 when LLM provider is unavailable', { concurrency: false }, async () => {
  ragService.rag = async () => {
    throw new LlmError('provider unavailable');
  };

  const res = await request(app)
    .post('/ai/ask')
    .set(requiredHeaders)
    .send({ question: 'tao lich tap 4 ngay/tuan' });

  assert.equal(res.status, 503);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, 'LLM_UNAVAILABLE');
});

test('POST /ai/generate-workout returns 502 for malformed LLM output', { concurrency: false }, async () => {
  llmService.callLLM = async () => ({
    answer: 'not-json-response',
    promptTokens: 1,
    completionTokens: 1,
    totalTokens: 2,
  });

  const res = await request(app)
    .post('/ai/generate-workout')
    .set(requiredHeaders)
    .send({
      goal: 'strength',
      duration: 45,
      equipment: ['barbell'],
      bodyParts: ['legs'],
    });

  assert.equal(res.status, 502);
  assert.equal(res.body.success, false);
  assert.equal(res.body.error.code, 'LLM_GENERATION_FAILED');
});

test('POST /plans/workout/generate returns queued response with real status contract', { concurrency: false }, async () => {
  conversationService.queuePlanGeneration = async () => ({
    planId: 'plan-1',
    jobId: 'job-1',
    status: 'QUEUED',
  });

  const res = await request(app)
    .post('/plans/workout/generate')
    .set(requiredHeaders)
    .send({ goal: 'muscle_gain', durationWeeks: 8, daysPerWeek: 4 });

  assert.equal(res.status, 202);
  assert.equal(res.body.success, true);
  assert.equal(res.body.data.status, 'QUEUED');
  assert.equal(typeof res.body.data.planId, 'string');
  assert.equal(typeof res.body.data.jobId, 'string');
});
