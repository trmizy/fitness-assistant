import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toPublicOperatingHours } from '../services/gym-public';

test('no rows saved -> [] (hours unknown, never seven closed days)', () => {
  assert.deepEqual(toPublicOperatingHours([]), []);
});

test('always Monday..Sunday, missing days CLOSED, no ids leak', () => {
  const out = toPublicOperatingHours([
    { day: 'SUNDAY', type: 'ALL_DAY', openMinute: null, closeMinute: null },
    { day: 'MONDAY', type: 'OPEN', openMinute: 300, closeMinute: 1260, id: 'x', gymId: 'g' } as any,
  ]);
  assert.deepEqual(out.map((d) => d.day), ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY']);
  assert.deepEqual(out[0], { day: 'MONDAY', type: 'OPEN', openMinute: 300, closeMinute: 1260 });
  assert.deepEqual(out[1], { day: 'TUESDAY', type: 'CLOSED', openMinute: null, closeMinute: null });
  assert.deepEqual(out[6], { day: 'SUNDAY', type: 'ALL_DAY', openMinute: null, closeMinute: null });
  assert.ok(out.every((d) => Object.keys(d).sort().join() === 'closeMinute,day,openMinute,type'));
});

test('a CLOSED row drops stray minutes', () => {
  const out = toPublicOperatingHours([{ day: 'MONDAY', type: 'CLOSED', openMinute: 60, closeMinute: 120 }]);
  assert.deepEqual(out[0], { day: 'MONDAY', type: 'CLOSED', openMinute: null, closeMinute: null });
});
