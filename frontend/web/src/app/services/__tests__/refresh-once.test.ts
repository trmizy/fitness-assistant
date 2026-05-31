/**
 * Race-condition tests for makeRefreshOnce.
 * Runs with: npx tsx --test src/app/services/__tests__/refresh-once.test.ts
 * No npm dependencies beyond Node built-ins.
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { makeRefreshOnce } from '../refresh-once';

// ── Test 1 & 2: 3 concurrent 401s → only 1 refresh call, all 3 succeed ────────

describe('makeRefreshOnce — concurrent refresh guard', () => {
  it('3 concurrent callers → fn called exactly once', async () => {
    let callCount = 0;
    let settle!: (token: string) => void;

    const fn = () => {
      callCount++;
      return new Promise<string>((res) => {
        settle = res;
      });
    };

    const refreshOnce = makeRefreshOnce(fn);

    // Simulate 3 requests all hitting 401 at the same time.
    const p1 = refreshOnce();
    const p2 = refreshOnce();
    const p3 = refreshOnce();

    settle('new-access-token');
    const results = await Promise.all([p1, p2, p3]);

    assert.equal(callCount, 1, 'refresh fn must be called only once for concurrent callers');
    assert.ok(
      results.every((t) => t === 'new-access-token'),
      `All callers must receive the new token. Got: ${JSON.stringify(results)}`,
    );
  });

  it('refresh success → all 3 retry calls carry the new token', async () => {
    const refreshOnce = makeRefreshOnce(() => Promise.resolve('retry-token'));

    type Request = { _retry: boolean; headers: Record<string, string> };

    async function simulateInterceptor(req: Request): Promise<string> {
      if (req._retry) return 'already-retried';
      req._retry = true;
      const token = await refreshOnce();
      if (token) {
        req.headers['Authorization'] = `Bearer ${token}`;
        return 'retried-ok';
      }
      return 'session-cleared';
    }

    const req1: Request = { _retry: false, headers: {} };
    const req2: Request = { _retry: false, headers: {} };
    const req3: Request = { _retry: false, headers: {} };

    const [r1, r2, r3] = await Promise.all([
      simulateInterceptor(req1),
      simulateInterceptor(req2),
      simulateInterceptor(req3),
    ]);

    assert.equal(r1, 'retried-ok');
    assert.equal(r2, 'retried-ok');
    assert.equal(r3, 'retried-ok');
    assert.equal(req1.headers['Authorization'], 'Bearer retry-token');
    assert.equal(req2.headers['Authorization'], 'Bearer retry-token');
    assert.equal(req3.headers['Authorization'], 'Bearer retry-token');
  });

  // ── Test 3: refresh fail → no infinite loop ────────────────────────────────

  it('refresh fail → _retry flag blocks a second refresh attempt', async () => {
    let callCount = 0;
    const refreshOnce = makeRefreshOnce(async () => {
      callCount++;
      return null;
    });

    type Request = { _retry: boolean };

    async function simulateInterceptor(req: Request): Promise<'session-cleared' | 'rejected-no-refresh'> {
      // _retry prevents re-entry — same guarantee as the real interceptor.
      if (req._retry) return 'rejected-no-refresh';
      req._retry = true;
      const token = await refreshOnce();
      if (token) throw new Error('unexpected success');
      return 'session-cleared';
    }

    // First wave: 3 concurrent 401s.
    const req1: Request = { _retry: false };
    const req2: Request = { _retry: false };
    const req3: Request = { _retry: false };
    const firstWave = await Promise.all([
      simulateInterceptor(req1),
      simulateInterceptor(req2),
      simulateInterceptor(req3),
    ]);

    assert.equal(callCount, 1, 'fn called only once even on failure');
    assert.ok(firstWave.every((r) => r === 'session-cleared'));

    // Second wave: same requests (already have _retry=true) → no new refresh.
    const callCountBefore = callCount;
    const [r4, r5] = await Promise.all([
      simulateInterceptor(req1),
      simulateInterceptor(req2),
    ]);

    assert.equal(callCount, callCountBefore, 'no new refresh triggered for _retry=true requests');
    assert.equal(r4, 'rejected-no-refresh');
    assert.equal(r5, 'rejected-no-refresh');
  });

  // ── State reset: after settlement a new call should start a fresh refresh ──

  it('resets after settlement — independent requests get their own refresh', async () => {
    let callCount = 0;
    const refreshOnce = makeRefreshOnce(async () => `token-${++callCount}`);

    const first = await refreshOnce();
    const second = await refreshOnce(); // settled already, starts new

    assert.equal(callCount, 2);
    assert.equal(first, 'token-1');
    assert.equal(second, 'token-2');
  });
});
