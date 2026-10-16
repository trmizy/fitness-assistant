const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(lambda) {
  const calls = [];
  const file = path.join(__dirname, '../../backend/services/ai-service/src/clients/service-lambda.client.ts');
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  }}).outputText;
  const exports = {};
  vm.runInNewContext(code, { exports, process: { env: lambda ? { USER_LAMBDA_NAME: 'fixture-user' } : {} }, require(name) {
    if (name === 'axios') return Object.fromEntries(['get','post','put'].map(method => [method, async (...args) => {
      calls.push({ method, args }); return { status: 200, data: { ok: true } };
    }]));
    if (name === './lambda-http.client') return {
      async invokeHttpLambda(request) { calls.push(request); return { statusCode: 200, body: { ok: true } }; },
      throwForLambdaHttpError() {},
    };
    throw new Error(name);
  }});
  return { request: exports.requestService, calls };
}

test('Lambda PUT preserves method, body and authenticated headers', async () => {
  const h = load(true);
  await h.request({ service: 'user', method: 'PUT', path: '/profile/me', body: { goal: 'fixture' }, headers: { Authorization: 'Bearer fixture' } });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].functionName, 'fixture-user');
  assert.equal(h.calls[0].method, 'PUT');
  assert.equal(h.calls[0].body.goal, 'fixture');
  assert.equal(h.calls[0].headers.Authorization, 'Bearer fixture');
});

test('HTTP PUT stays PUT rather than becoming POST', async () => {
  const h = load(false);
  await h.request({ service: 'user', method: 'PUT', path: '/profile/me', body: { goal: 'fixture' } });
  assert.equal(h.calls[0].method, 'put');
  assert.equal(h.calls[0].args[1].goal, 'fixture');
});

test('Lambda GET forwards query parameters separately and has no request body', async () => {
  const h = load(true);
  await h.request({ service: 'user', method: 'GET', path: '/profile/agent/context', params: { limit: 20 } });
  assert.equal(h.calls[0].method, 'GET');
  assert.equal(h.calls[0].queryStringParameters.limit, '20');
  assert.equal(h.calls[0].body, undefined);
});
