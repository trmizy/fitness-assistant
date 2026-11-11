/**
 * BACKEND INTEGRATION without a database (real Express app + the real middleware / schemas / services; every case here is refused BEFORE any query,
 * so no DB is touched). Bugs from the 09-10/11/2026 partner-tunnel test round (_warroom/evidence/partner-test-20261109/BUG_LOG.md):
 *   N-A-01  POST /owner/gyms/:id/trainers without ptId -> 500 + Prisma text + file path   -> 400 Vietnamese, and no 5xx ever leaks internal text
 *   N-A-02  staff contact phone "abc" was saved                                          -> 400 INVALID_PHONE_NUMBER
 *   N09C-02 English / raw messages ("Cannot cancel membership in ACTIVE status", "Not authorized — ...", "VALIDATION_ERROR", zod "Required")
 *   N09C-03 gym review comment had no length cap                                         -> 1000 characters
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import { z } from 'zod';

import { localizeErrors } from '../middleware/localize-errors.middleware';
import { validateBody } from '../middleware/validate.middleware';
import { affiliationInviteSchema } from '../schemas/affiliation.schemas';
import { installViZodErrorMap } from '../config/zod-vi';
import { localizeErrorBody, hasVietnamese, GENERIC_SERVER_ERROR_VI } from '../utils/error-messages.vi';
import { isValidPhoneNumber } from '../utils/phone.util';
import { onboardingService } from '../services/onboarding.service';
import { reviewService, REVIEW_COMMENT_MAX } from '../services/review.service';
import { partnerController } from '../controllers/partner.controller';
import { partnerService } from '../services/partner.service';

installViZodErrorMap();

let server: http.Server;
let base = '';

const PRISMA_LEAK =
  '\nInvalid `prisma.gymTrainerAffiliation.create()` invocation in\n/app/backend/services/gym-service/src/repositories/affiliation.repository.ts:6:30\n\n  Argument `ptId` is missing.';

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use(localizeErrors);
  // the same wiring as owner.routes.ts: validateBody(affiliationInviteSchema) in front of the controller
  app.post('/owner/gyms/:gymId/trainers', validateBody(affiliationInviteSchema), (_req, res) => res.status(201).json({ success: true, data: { ok: true } }));
  // a controller of the old style: copies e.message to the response with `status || 500`
  app.get('/leak/prisma', (_req, res) => res.status(500).json({ success: false, error: { message: PRISMA_LEAK } }));
  app.get('/leak/top-level', (_req, res) => res.status(500).json({ success: false, error: { message: PRISMA_LEAK }, message: PRISMA_LEAK }));
  app.get('/leak/vi-with-path', (_req, res) => res.status(500).json({ success: false, error: { message: 'Lỗi tại /app/backend/services/gym-service/src/x.ts:12' } }));
  app.get('/deliberate/vi', (_req, res) => res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Không xử lý được yêu cầu. Vui lòng thử lại.' } }));
  app.get('/en/cancel', (_req, res) => res.status(400).json({ success: false, error: { code: 'Cannot cancel membership in ACTIVE status', message: 'Cannot cancel membership in ACTIVE status' } }));
  app.get('/en/own-gym', (_req, res) => res.status(403).json({ success: false, error: { message: 'Not authorized — you do not own this gym' } }));
  app.get('/en/code-only', (_req, res) => res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR' } }));
  app.get('/en/code-as-message', (_req, res) => res.status(409).json({ success: false, error: { code: 'ALREADY_PAID', message: 'ALREADY_PAID' } }));
  app.get('/ok', (_req, res) => res.json({ success: true, data: { message: 'Not authorized' } }));
  app.post('/zod', validateBody(z.object({ name: z.string(), kind: z.enum(['A', 'B']) }).strict()), (_req, res) => res.json({ success: true }));
  server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

test.after(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json()) as any };
}

// ── N-A-01 ────────────────────────────────────────────────────────────────────────────────────────────────────────
test('N-A-01: inviting a trainer without ptId is a 400 in Vietnamese, never a 500', async () => {
  for (const payload of [{}, { employmentType: 'FREELANCE' }, { ptId: '' }, { ptId: '   ' }, { ptId: 123 }, { ptId: null }]) {
    const r = await call('POST', '/owner/gyms/g1/trainers', payload);
    assert.equal(r.status, 400, JSON.stringify(payload));
    assert.equal(r.body.error.code, 'VALIDATION_ERROR');
    assert.ok(hasVietnamese(r.body.error.message), r.body.error.message);
    assert.match(r.body.error.message, /ptId/);
    assert.doesNotMatch(JSON.stringify(r.body), /prisma|\/app\/|\.ts:/i);
  }
});

test('N-A-01: a valid invite body passes; a bad enum / commission is a 400 (it fell through to Prisma too)', async () => {
  assert.equal((await call('POST', '/owner/gyms/g1/trainers', { ptId: 'pt-1', employmentType: 'FREELANCE', visibility: 'PUBLIC', commissionRate: 0.2 })).status, 201);
  assert.equal((await call('POST', '/owner/gyms/g1/trainers', { ptId: 'pt-1' })).status, 201);
  for (const bad of [{ ptId: 'pt-1', employmentType: 'BOSS' }, { ptId: 'pt-1', visibility: 'SECRET' }, { ptId: 'pt-1', commissionRate: 5 }, { ptId: 'pt-1', commissionRate: 'x' }]) {
    const r = await call('POST', '/owner/gyms/g1/trainers', bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.ok(hasVietnamese(r.body.error.message));
  }
});

test('N-A-01: a 5xx never carries Prisma text or a file path (error.message and a top-level message)', async () => {
  for (const path of ['/leak/prisma', '/leak/top-level', '/leak/vi-with-path']) {
    const r = await call('GET', path);
    assert.equal(r.status, 500, path);
    assert.equal(r.body.error.message, GENERIC_SERVER_ERROR_VI, path);
    assert.equal(r.body.error.code, 'INTERNAL_ERROR');
    assert.doesNotMatch(JSON.stringify(r.body), /prisma|\/app\/|\.ts:|invocation/i, path);
    if (r.body.message !== undefined) assert.equal(r.body.message, GENERIC_SERVER_ERROR_VI);
  }
});

test('a deliberate Vietnamese 500 message is left alone', async () => {
  const r = await call('GET', '/deliberate/vi');
  assert.equal(r.status, 500);
  assert.equal(r.body.error.message, 'Không xử lý được yêu cầu. Vui lòng thử lại.');
});

// ── N09C-02 ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('N09C-02: English membership / ownership messages become Vietnamese, the code is kept or made stable', async () => {
  const cancel = await call('GET', '/en/cancel');
  assert.equal(cancel.status, 400);
  assert.ok(hasVietnamese(cancel.body.error.message));
  assert.match(cancel.body.error.message, /đang hoạt động/);
  assert.doesNotMatch(cancel.body.error.message, /Cannot cancel/);
  assert.equal(cancel.body.error.code, 'Cannot cancel membership in ACTIVE status'); // the old route's own "code" is kept: clients (admin web) match on it

  const own = await call('GET', '/en/own-gym');
  assert.equal(own.status, 403);
  assert.ok(hasVietnamese(own.body.error.message));
  assert.doesNotMatch(own.body.error.message, /Not authorized/);
  assert.equal(own.body.error.code, 'NOT_GYM_OWNER'); // there was no code: a stable one is added
});

test('N09C-02: a bare code as the message (or as the only field) gets a Vietnamese message and keeps the code', async () => {
  const codeOnly = await call('GET', '/en/code-only');
  assert.equal(codeOnly.body.error.code, 'VALIDATION_ERROR');
  assert.ok(hasVietnamese(codeOnly.body.error.message));
  const paid = await call('GET', '/en/code-as-message');
  assert.equal(paid.status, 409);
  assert.equal(paid.body.error.code, 'ALREADY_PAID');
  assert.ok(hasVietnamese(paid.body.error.message));
  assert.notEqual(paid.body.error.message, 'ALREADY_PAID');
});

test('N09C-02: successful bodies are never rewritten', async () => {
  const r = await call('GET', '/ok');
  assert.equal(r.body.data.message, 'Not authorized');
});

test('N09C-02: zod default messages ("Required", "Unrecognized key(s)", "Invalid enum value") are Vietnamese', async () => {
  const missing = await call('POST', '/zod', {});
  assert.equal(missing.status, 400);
  assert.doesNotMatch(missing.body.error.message, /Required/);
  assert.ok(hasVietnamese(missing.body.error.message), missing.body.error.message);
  const extra = await call('POST', '/zod', { name: 'a', kind: 'A', hack: 1 });
  assert.ok(hasVietnamese(extra.body.error.message), extra.body.error.message);
  assert.doesNotMatch(extra.body.error.message, /Unrecognized/);
  const badEnum = await call('POST', '/zod', { name: 'a', kind: 'Z' });
  assert.ok(hasVietnamese(badEnum.body.error.message), badEnum.body.error.message);
  assert.doesNotMatch(badEnum.body.error.message, /Invalid enum/);
  assert.ok(Array.isArray(badEnum.body.error.fields) && badEnum.body.error.fields[0].path === 'kind');
});

test('N09C-02: pure localizer - already Vietnamese stays, unknown 4xx English is not invented, statuses are translated', () => {
  const vi = { success: false, error: { code: 'X', message: 'Số sao phải từ 1 đến 5' } };
  assert.deepEqual(localizeErrorBody(400, structuredClone(vi)), vi);
  const unknown = { success: false, error: { code: 'WHATEVER', message: 'Something odd' } };
  assert.deepEqual(localizeErrorBody(400, structuredClone(unknown)), unknown);
  for (const [status, expected] of [['PENDING_PAYMENT', /chờ thanh toán/], ['CANCELLED', /đã huỷ/], ['EXPIRED', /hết hạn/]] as const) {
    const out = localizeErrorBody(400, { success: false, error: { message: `Cannot pay for membership in ${status} status` } }) as any;
    assert.match(out.error.message, expected);
  }
  assert.equal(localizeErrorBody(200, { success: true }) !== undefined, true);
  const withheld: string[] = [];
  const five = localizeErrorBody(502, { success: false, error: { message: 'connect ECONNREFUSED 10.0.0.1:3003' } }, (o) => withheld.push(o)) as any;
  assert.equal(five.error.message, GENERIC_SERVER_ERROR_VI);
  assert.deepEqual(withheld, ['connect ECONNREFUSED 10.0.0.1:3003']);
});

// ── N-A-02 ────────────────────────────────────────────────────────────────────────────────────────────────────────
test('N-A-02: Vietnamese phone format is the same rule as the PT application phone', () => {
  for (const ok of ['0901234567', '+84 901 234 567', '090-123-4567', '(028) 3822 1234']) assert.equal(isValidPhoneNumber(ok), true, ok);
  for (const bad of ['abc', '', '   ', '12345', '+++-----', '0901234567890123456', '09012x4567', 12345, null, undefined]) assert.equal(isValidPhoneNumber(bad), false, String(bad));
});

test('N-A-02: the onboarding contact step refuses "abc" with INVALID_PHONE_NUMBER before touching the database', async () => {
  for (const phone of ['abc', '1234', '+++-----']) {
    await assert.rejects(
      () => onboardingService.submitContact('account-that-never-gets-queried', phone),
      (e: any) => e.status === 400 && e.code === 'INVALID_PHONE_NUMBER' && hasVietnamese(e.message),
      phone,
    );
  }
  await assert.rejects(() => onboardingService.submitContact('x', undefined), (e: any) => e.status === 400 && hasVietnamese(e.message));
  await assert.rejects(() => onboardingService.submitContact('x', 90123456 as unknown), (e: any) => e.status === 400);
});

// ── N09C-03 ───────────────────────────────────────────────────────────────────────────────────────────────────────
test('N09C-03: a review comment over the cap is a 400 COMMENT_TOO_LONG (refused before any query)', async () => {
  assert.equal(REVIEW_COMMENT_MAX, 1000);
  await assert.rejects(
    () => reviewService.submit('gym-1', 'client-1', 5, 'x'.repeat(REVIEW_COMMENT_MAX + 1)),
    (e: any) => e.status === 400 && e.code === 'COMMENT_TOO_LONG' && hasVietnamese(e.message) && e.message.includes('1000'),
  );
  await assert.rejects(
    () => reviewService.submit('gym-1', 'client-1', 5, { evil: true } as unknown as string),
    (e: any) => e.status === 400 && e.code === 'INVALID_COMMENT',
  );
});

// ── N-A-06 (GET /admin/partners?status=BOGUS) ─────────────────────────────────────────────────────────────────────
function listWith(query: Record<string, unknown>) {
  let out: { status: number; body: any } = { status: 200, body: null };
  const res: any = { status(c: number) { out.status = c; return res; }, json(b: unknown) { out.body = b; return res; } };
  return partnerController.list({ query } as any, res).then(() => out);
}

test('N-A-06: an unknown status filter on /admin/partners is a 400 INVALID_STATUS_FILTER in Vietnamese; valid / absent filters still work', async () => {
  const seen: unknown[] = [];
  const original = partnerService.listPartners;
  (partnerService as any).listPartners = async (f: unknown) => { seen.push(f); return []; };
  try {
    for (const bad of ['BOGUS', 'active', ['ACTIVE', 'PROSPECT'], '1; DROP']) {
      const r = await listWith({ status: bad });
      assert.equal(r.status, 400, JSON.stringify(bad));
      assert.equal(r.body.error.code, 'INVALID_STATUS_FILTER');
      assert.ok(hasVietnamese(r.body.error.message));
    }
    const v = await listWith({ verificationStatus: 'BOGUS' });
    assert.equal(v.status, 400);
    assert.equal(v.body.error.code, 'INVALID_VERIFICATION_FILTER');
    assert.equal(seen.length, 0, 'a refused filter never reaches the query');

    for (const ok of ['PROSPECT', 'INVITED', 'ACTIVE', 'SUSPENDED', 'TERMINATED']) {
      const r = await listWith({ status: ok });
      assert.equal(r.status, 200, ok);
    }
    assert.equal((await listWith({})).status, 200);
    assert.equal((await listWith({ status: '' })).status, 200); // the web's "all" sends no status; an empty one is also no filter
    assert.equal((await listWith({ verificationStatus: 'VERIFIED', status: 'ACTIVE' })).status, 200);
    assert.deepEqual(seen[0], { status: 'PROSPECT', verificationStatus: undefined, assignedAdminId: undefined });
  } finally {
    (partnerService as any).listPartners = original;
  }
});
