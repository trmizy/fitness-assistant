import test from 'node:test';
import assert from 'node:assert/strict';
import { localDateOf, localDayWindow, windowOfLocalDate } from '../utils/local-day';

/**
 * Phase 2 / P2.2 - the PT check-in "local day" (Asia/Ho_Chi_Minh, fixed +07:00).
 * Evidence label: TEST FIXTURE (pure function, no DB). The process TZ is forced to UTC and then to
 * a far-off zone inside the suite to prove the result does not depend on it.
 */

test('23:59:59.999 local is still day D; 00:00:00.000 local is D+1', () => {
  // 2026-10-17 23:59:59.999 +07:00 = 2026-10-17T16:59:59.999Z
  assert.equal(localDateOf(new Date('2026-10-17T16:59:59.999Z')), '2026-10-17');
  // 2026-10-18 00:00:00.000 +07:00 = 2026-10-17T17:00:00.000Z
  assert.equal(localDateOf(new Date('2026-10-17T17:00:00.000Z')), '2026-10-18');
});

test('window is [D 00:00+07:00, D+1 00:00+07:00) as UTC instants', () => {
  const w = localDayWindow(new Date('2026-10-17T20:30:00Z')); // 03:30 local on 18/10
  assert.equal(w.localDate, '2026-10-18');
  assert.equal(w.start.toISOString(), '2026-10-17T17:00:00.000Z');
  assert.equal(w.end.toISOString(), '2026-10-18T17:00:00.000Z');
  assert.equal(w.end.getTime() - w.start.getTime(), 24 * 3600 * 1000);
});

test('an instant belongs to exactly one window (start inclusive, end exclusive)', () => {
  const w = localDayWindow(new Date('2026-10-18T05:00:00Z'));
  assert.equal(localDayWindow(w.start).localDate, w.localDate);
  assert.equal(localDayWindow(new Date(w.end.getTime() - 1)).localDate, w.localDate);
  assert.notEqual(localDayWindow(w.end).localDate, w.localDate);
});

test('UTC date differs from the local date between 17:00Z and 24:00Z', () => {
  // The old bug class: toISOString().slice(0,10) would say 2026-10-17.
  assert.equal(localDateOf(new Date('2026-10-17T18:00:00Z')), '2026-10-18');
});

test('month and year rollover', () => {
  assert.equal(localDateOf(new Date('2026-12-31T17:00:00Z')), '2027-01-01');
  assert.equal(localDateOf(new Date('2026-12-31T16:59:59Z')), '2026-12-31');
  assert.equal(localDateOf(new Date('2028-02-28T17:00:00Z')), '2028-02-29'); // leap year
});

test('windowOfLocalDate round-trips and rejects garbage', () => {
  const { start, end } = windowOfLocalDate('2026-10-18');
  assert.equal(start.toISOString(), '2026-10-17T17:00:00.000Z');
  assert.equal(localDateOf(start), '2026-10-18');
  assert.equal(localDateOf(new Date(end.getTime() - 1)), '2026-10-18');
  assert.throws(() => windowOfLocalDate('not-a-date'), RangeError);
  assert.throws(() => localDateOf(new Date('x')), RangeError);
});

test('result does not depend on process TZ (UTC and a far-off zone)', () => {
  const original = process.env.TZ;
  try {
    for (const tz of ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati']) {
      process.env.TZ = tz;
      assert.equal(localDateOf(new Date('2026-10-17T16:59:59.999Z')), '2026-10-17', tz);
      assert.equal(localDateOf(new Date('2026-10-17T17:00:00.000Z')), '2026-10-18', tz);
      assert.equal(localDayWindow(new Date('2026-10-17T17:00:00Z')).start.toISOString(), '2026-10-17T17:00:00.000Z', tz);
    }
  } finally {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  }
});
