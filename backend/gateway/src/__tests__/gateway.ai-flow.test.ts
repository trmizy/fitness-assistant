import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import nock from 'nock';

process.env.NODE_ENV = 'test';
process.env.AUTH_SERVICE_URL = 'http://auth-service.test';
process.env.AI_SERVICE_URL = 'http://ai-service.test';
process.env.INTERNAL_SERVICE_SECRET = 'gateway-secret';

const { default: app } = await import('../app');

test.afterEach(() => {
  nock.cleanAll();
});

test('gateway forwards x-internal-token and user identity to AI service', async () => {
  nock('http://auth-service.test')
    .post('/auth/verify')
    .reply(200, { user: { id: 'user-42', email: 'u@example.com', role: 'CUSTOMER' } });

  let forwardedInternalToken = '';
  let forwardedUserId = '';

  nock('http://ai-service.test')
    .post('/ai/ask')
    .reply(function (_uri, body) {
      forwardedInternalToken = String(this.req.headers['x-internal-token'] || '');
      forwardedUserId = String(this.req.headers['x-user-id'] || '');
      return [
        200,
        {
          success: true,
          data: {
            conversationId: 'conv-1',
            question: (body as { question: string }).question,
            answer: 'AI response',
          },
        },
      ];
    });

  const res = await request(app)
    .post('/ai/ask')
    .set('Authorization', 'Bearer gateway-token')
    .send({ question: 'create my workout plan' });

  assert.equal(res.status, 200);
  assert.equal(res.body.success, true);
  assert.equal(forwardedInternalToken, 'gateway-secret');
  assert.equal(forwardedUserId, 'user-42');
});
