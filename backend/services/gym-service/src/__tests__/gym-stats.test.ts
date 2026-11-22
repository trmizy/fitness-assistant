/**
 * TEST FIXTURE (không cần DB) — Item 4: khoảng ngày của GET /owner/gyms/:gymId/stats và query phân trang danh sách hội viên.
 * Hàm thuần: ngày theo múi giờ VN, trần 92 ngày, mặc định, từ chối đầu vào xấu; cursor encode/decode; trần limit.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStatsRange, STATS_MAX_DAYS, STATS_DEFAULT_DAYS } from '../services/gym-stats.service';
import {
  parseMembershipListQuery,
  encodeMembershipCursor,
  MEMBERSHIP_LIST_DEFAULT_LIMIT,
  MEMBERSHIP_LIST_MAX_LIMIT,
} from '../services/membership.service';

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e: any) {
    assert.equal(e.status, 400);
    return e.code;
  }
  return undefined;
}

test('stats range · mặc định = 7 ngày VN kết thúc hôm nay (ngày VN, không phải ngày UTC)', () => {
  // 2026-11-21T17:30:00Z = 2026-11-22 00:30 giờ VN: ngày VN đã sang 22 dù ngày UTC vẫn là 21.
  const r = resolveStatsRange({}, new Date('2026-11-21T17:30:00.000Z'));
  assert.equal(r.to, '2026-11-22');
  assert.equal(r.from, '2026-11-16');
  assert.equal(r.days, STATS_DEFAULT_DAYS);
  // 2026-11-21T16:59:59Z = 23:59:59 giờ VN vẫn là ngày 21.
  assert.equal(resolveStatsRange({}, new Date('2026-11-21T16:59:59.999Z')).to, '2026-11-21');
});

test('stats range · chỉ có to → 7 ngày kết thúc ở to; chỉ có from → from..hôm nay', () => {
  const now = new Date('2026-11-22T05:00:00.000Z');
  assert.deepEqual(resolveStatsRange({ to: '2026-03-10' }, now), { from: '2026-03-04', to: '2026-03-10', days: 7 });
  assert.deepEqual(resolveStatsRange({ from: '2026-11-20' }, now), { from: '2026-11-20', to: '2026-11-22', days: 3 });
});

test('stats range · trần đúng 92 ngày (cả hai đầu tính): 92 qua, 93 bị 400 RANGE_TOO_LARGE', () => {
  const now = new Date('2026-11-22T05:00:00.000Z');
  // 2026-08-22 .. 2026-11-21 = 92 ngày (30+30+31... đếm bằng hàm, không đếm tay): lấy to cố định rồi lùi 91 / 92 ngày.
  const ok = resolveStatsRange({ from: '2026-08-22', to: '2026-11-21' }, now);
  assert.equal(ok.days, STATS_MAX_DAYS);
  assert.equal(codeOf(() => resolveStatsRange({ from: '2026-08-21', to: '2026-11-21' }, now)), 'RANGE_TOO_LARGE');
  assert.equal(codeOf(() => resolveStatsRange({ from: '2025-01-01', to: '2026-11-21' }, now)), 'RANGE_TOO_LARGE');
});

test('stats range · from > to, sai định dạng, ngày không tồn tại, kiểu không phải chuỗi → 400', () => {
  const now = new Date('2026-11-22T05:00:00.000Z');
  assert.equal(codeOf(() => resolveStatsRange({ from: '2026-11-22', to: '2026-11-21' }, now)), 'INVALID_RANGE');
  assert.equal(codeOf(() => resolveStatsRange({ from: '22/11/2026' }, now)), 'INVALID_QUERY');
  assert.equal(codeOf(() => resolveStatsRange({ from: '2026-02-31', to: '2026-03-01' }, now)), 'INVALID_QUERY');
  assert.equal(codeOf(() => resolveStatsRange({ to: ['2026-11-22', '2026-11-23'] }, now)), 'INVALID_QUERY');
});

test('membership list query · không limit/cursor → không phân trang (limit null); có cursor mà không limit → mặc định 200', () => {
  const q = parseMembershipListQuery({});
  assert.equal(q.limit, null);
  assert.equal(parseMembershipListQuery({ status: 'ACTIVE' }).limit, null);
  assert.equal(parseMembershipListQuery({ cursor: encodeMembershipCursor({ createdAt: new Date(), id: 'x' }) }).limit, MEMBERSHIP_LIST_DEFAULT_LIMIT);
  assert.equal(MEMBERSHIP_LIST_DEFAULT_LIMIT, 200);
  assert.equal(q.cursor, null);
  assert.equal(q.status, undefined);
  assert.equal(q.expiringBefore, null);
});

test('membership list query · limit bị kẹp ở 500; 0/âm/chữ → 400', () => {
  assert.equal(parseMembershipListQuery({ limit: '99999' }).limit, MEMBERSHIP_LIST_MAX_LIMIT);
  assert.equal(parseMembershipListQuery({ limit: '25' }).limit, 25);
  for (const bad of ['0', '-3', 'abc', '1.5']) assert.equal(codeOf(() => parseMembershipListQuery({ limit: bad })), 'INVALID_QUERY', bad);
});

test('membership list query · status phải thuộc enum; expiringBefore phải là ngày hợp lệ; cursor rác → 400', () => {
  assert.equal(parseMembershipListQuery({ status: 'ACTIVE' }).status, 'ACTIVE');
  assert.equal(codeOf(() => parseMembershipListQuery({ status: 'active' })), 'INVALID_QUERY');
  assert.equal(codeOf(() => parseMembershipListQuery({ status: 'HACKED' })), 'INVALID_QUERY');
  assert.equal(parseMembershipListQuery({ expiringBefore: '2026-12-01T00:00:00.000Z' }).expiringBefore?.toISOString(), '2026-12-01T00:00:00.000Z');
  assert.equal(codeOf(() => parseMembershipListQuery({ expiringBefore: 'tomorrow' })), 'INVALID_QUERY');
  assert.equal(codeOf(() => parseMembershipListQuery({ cursor: 'not-a-cursor' })), 'INVALID_QUERY');
  assert.equal(codeOf(() => parseMembershipListQuery({ status: ['ACTIVE', 'EXPIRED'] })), 'INVALID_QUERY');
});

test('membership list query · cursor encode → decode giữ nguyên createdAt + id', () => {
  const row = { createdAt: new Date('2026-11-20T10:11:12.345Z'), id: '3b1f8c20-0000-4000-8000-000000000001' };
  const q = parseMembershipListQuery({ cursor: encodeMembershipCursor(row) });
  assert.equal(q.cursor?.createdAt.toISOString(), row.createdAt.toISOString());
  assert.equal(q.cursor?.id, row.id);
});
