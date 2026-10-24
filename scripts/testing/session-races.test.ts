/** TEST FIXTURE: execute production client functions/interceptors with deferred HTTP/storage.
 * AST selection avoids loading native UI modules in Node; no production logic is copied here. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createSessionGuard as webGuard, SessionChangedError as WebChanged } from '../../frontend/web/src/app/services/sessionGuard';
import { createSessionGuard as mobileGuard, SessionChangedError as MobileChanged } from '../../frontend/mobile/src/services/sessionGuard';
import { makeRefreshOnce as webOnce } from '../../frontend/web/src/app/services/refresh-once';
import { makeRefreshOnce as mobileOnce } from '../../frontend/mobile/src/services/refresh-once';

function deferred<T = any>() {
  let resolve!: (value: T) => void, reject!: (error: any) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function fixture(kind: 'web' | 'mobile') {
  const dir = kind === 'web' ? 'frontend/web/src/app/services' : 'frontend/mobile/src/services';
  const file = `${dir}/api.ts`;
  const ast = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const functions = new Set(['refreshAccessToken', 'clearStoredSession', 'clearSessionAndRedirectToLogin']);
  const selected = ast.statements.filter(s =>
    ts.isFunctionDeclaration(s) ? functions.has(s.name?.text ?? '') :
    ts.isClassDeclaration(s) ? s.name?.text === 'RefreshUnavailableError' :
    ts.isVariableStatement(s) ? s.declarationList.declarations.some(d => ['refreshOnce', 'authService'].includes(d.name.getText(ast))) :
    ts.isExpressionStatement(s) && (s.getText(ast).startsWith('api.interceptors.response.use(') || s.getText(ast).startsWith('api.interceptors.request.use(async')));
  assert.equal(selected.length, 8, 'all production declarations/interceptors must be selected');
  const storage = new Map([['accessToken', 'A-access'], ['refreshToken', 'A-refresh'], ['user', '{"id":"A"}']]);
  let memory: string | null = 'A-access';
  let expired = 0;
  let request: any, success: any, failure: any;
  const refreshes: ReturnType<typeof deferred>[] = [];
  let writeGate: ReturnType<typeof deferred> | null = null;
  let writeStarted = deferred();
  const guard = (kind === 'web' ? webGuard : mobileGuard)();
  const Changed = kind === 'web' ? WebChanged : MobileChanged;
  const transport = async (config: any) => ({ config, data: { accessToken: 'B-access', refreshToken: 'B-refresh', user: { id: 'B' } } });
  const api: any = async (config: any) => {
    const outgoing = await request({ headers: {}, ...config });
    return success(await transport(outgoing));
  };
  api.post = (url: string, body: any) => api({ url, data: body });
  api.interceptors = { request: { use: (fn: any) => { request = fn; } }, response: { use: (ok: any, bad: any) => { success = ok; failure = bad; } } };
  const context = vm.createContext({
    exports: {}, api, sessionGuard: guard, SessionChangedError: Changed,
    makeRefreshOnce: kind === 'web' ? webOnce : mobileOnce,
    hasUsableToken: (v: any) => typeof v === 'string' && v.length > 0,
    emitSessionExpired: () => { expired++; },
    Preferences: {
      get: async ({ key }: any) => ({ value: storage.get(key) ?? null }),
      set: async ({ key, value }: any) => {
        const gate = writeGate; writeGate = null;
        if (gate) { writeStarted.resolve(null); await gate.promise; }
        storage.set(key, value);
      },
      remove: async ({ key }: any) => { storage.delete(key); },
    },
    tokenStore: { get: () => memory, set: (v: string | null) => { memory = v; } },
    readRefreshToken: async () => storage.get('refreshToken') ?? null,
    writeRefreshToken: async (v: string) => { storage.set('refreshToken', v); },
    clearRefreshToken: async () => { storage.delete('refreshToken'); },
    refreshClient: { post: () => { const d = deferred(); refreshes.push(d); return d.promise; } },
  });
  vm.runInContext(ts.transpileModule(selected.map(s => s.getText(ast)).join('\n'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, context, { filename: file });
  return {
    client: context.exports as any, storage, guard, Changed,
    token: () => memory, expired: () => expired, refreshes,
    fail: (generation: number) => failure({ response: { status: 401 }, config: { url: '/profile/me', _sessionGeneration: generation } }),
    succeed: (generation: number) => success({ config: { _sessionGeneration: generation }, data: { id: 'A' } }),
    blockWrite: () => { writeGate = deferred(); writeStarted = deferred(); return { gate: writeGate, started: writeStarted.promise }; },
  };
}

async function started(f: ReturnType<typeof fixture>, count = 1) {
  for (let i = 0; i < 100 && f.refreshes.length < count; i++) await new Promise(r => setImmediate(r));
  assert.equal(f.refreshes.length, count);
}

for (const kind of ['web', 'mobile'] as const) {
  for (const outcome of ['success', '401', '429'] as const) {
    test(`${kind}: old refresh ${outcome} cannot replace or clear account B`, async () => {
      const f = fixture(kind);
      const pending = f.client.refreshOnce();
      const rejected = assert.rejects(pending, f.Changed);
      await started(f);
      await f.client.clearStoredSession();
      await f.client.authService.login('b@test', 'password');
      if (outcome === 'success') f.refreshes[0].resolve({ data: { accessToken: 'A-new', refreshToken: 'A-new-refresh' } });
      else f.refreshes[0].reject({ response: { status: Number(outcome) } });
      await rejected;
      assert.equal(f.token(), 'B-access');
      assert.equal(f.storage.get('accessToken'), 'B-access');
      assert.equal(f.storage.get('refreshToken'), 'B-refresh');
      assert.equal(f.expired(), 0);
    });
  }

  test(`${kind}: logout alone cannot be undone by a late refresh`, async () => {
    const f = fixture(kind);
    const pending = f.client.refreshOnce();
    const rejected = assert.rejects(pending, f.Changed);
    await started(f);
    await f.client.authService.logout();
    f.refreshes[0].resolve({ data: { accessToken: 'A-new', refreshToken: 'A-new-refresh' } });
    await rejected;
    assert.equal(f.token(), null);
    assert.equal(f.storage.has('accessToken'), false);
    assert.equal(f.storage.has('refreshToken'), false);
  });

  test(`${kind}: B refresh does not join A's pending promise; A finalizer cannot release B's guard`, async () => {
    const f = fixture(kind);
    const a = f.client.refreshOnce();
    const rejected = assert.rejects(a, f.Changed);
    await started(f);
    await f.client.authService.login('b@test', 'password');
    const b = f.client.refreshOnce();
    await started(f, 2);
    f.refreshes[0].resolve({ data: { accessToken: 'A-new' } });
    await rejected;
    assert.equal(f.client.refreshOnce(), b);
    f.refreshes[1].resolve({ data: { accessToken: 'B-new', refreshToken: 'B-new-refresh' } });
    assert.equal(await b, 'B-new');
    assert.equal(f.token(), 'B-new');
  });

  test(`${kind}: delayed native write finishes before new account writes`, async () => {
    const f = fixture(kind);
    const block = f.blockWrite();
    const a = f.client.refreshOnce();
    const rejected = assert.rejects(a, f.Changed);
    await started(f);
    f.refreshes[0].resolve({ data: { accessToken: 'A-new', refreshToken: 'A-new-refresh' } });
    await block.started;
    const b = f.client.authService.login('b@test', 'password');
    block.gate.resolve(null);
    await rejected; await b;
    assert.equal(f.token(), 'B-access');
    assert.equal(f.storage.get('accessToken'), 'B-access');
    assert.equal(f.storage.get('refreshToken'), 'B-refresh');
  });

  test(`${kind}: old 401 does not retry with B; old successful data is discarded`, async () => {
    const f = fixture(kind);
    const generation = f.guard.current();
    await f.client.authService.login('b@test', 'password');
    await assert.rejects(f.fail(generation), f.Changed);
    assert.throws(() => f.succeed(generation), f.Changed);
    assert.equal(f.refreshes.length, 0);
    assert.equal(f.expired(), 0);
  });

  for (const status of [401, 403, 400, 408, 429, 500, undefined]) {
    test(`${kind}: refresh status ${status ?? 'network'} ${status === 401 || status === 403 ? 'revokes' : 'preserves'} session`, async () => {
      const f = fixture(kind);
      const pending = f.fail(f.guard.current());
      const rejected = assert.rejects(pending);
      await started(f);
      f.refreshes[0].reject(status ? { response: { status } } : new Error('offline'));
      await rejected;
      const revoked = status === 401 || status === 403;
      assert.equal(f.storage.has('refreshToken'), !revoked);
      assert.equal(f.expired(), revoked ? 1 : 0);
    });
  }

  test(`${kind}: malformed 2xx refresh preserves session`, async () => {
    const f = fixture(kind);
    const pending = f.client.refreshOnce();
    const rejected = assert.rejects(pending, f.client.RefreshUnavailableError);
    await started(f);
    f.refreshes[0].resolve({ data: {} });
    await rejected;
    assert.equal(f.storage.get('refreshToken'), 'A-refresh');
  });
}
