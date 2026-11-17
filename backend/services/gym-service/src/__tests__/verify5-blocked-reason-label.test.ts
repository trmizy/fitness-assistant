import test from 'node:test';
import assert from 'node:assert/strict';
import { blockedReasonText, deriveFinancialView } from '../services/complaint-case/rules';

const blocked = (blockedReason: string | null) =>
  deriveFinancialView({ outcome: 'REFUND_APPEAL_SUPPLEMENT', execStatus: 'EXEC_BLOCKED', observation: null, blockedReason });

test('VERIFY5: a blocked supplement shows a Vietnamese reason, never the stored machine code', () => {
  const v = blocked('SUPPLEMENT_REFUSED:PLATFORM_FUNDS_INSUFFICIENT');
  assert.equal(v.state, 'REFUND_BLOCKED');
  assert.equal(v.group, 'F3');
  assert.equal(v.label, 'Chưa hoàn tiền: ví doanh thu của nền tảng chưa đủ để ứng phần hoàn thêm');
  assert.doesNotMatch(v.label, /[A-Z]{3,}_[A-Z]/);
});

test('VERIFY5: every known blocked reason maps to text, with no UPPER_SNAKE code left in the label', () => {
  for (const r of [
    'SUPPLEMENT_REFUSED:PLATFORM_FUNDS_INSUFFICIENT',
    'SUPPLEMENT_REFUSED:Some gateway message',
    'SUPPLEMENT_REFUSED:500',
    'REFUND_REFUSED:Membership has already expired',
    'MEMBERSHIP_NOT_REFUNDABLE',
    'MEMBERSHIP_PENDING_NOT_RELEASED',
    'PRIOR_REFUND_SHORTFALL',
    'SOME_UNKNOWN_CODE',
    'SOME_UNKNOWN_CODE:detail',
    null,
    '',
  ]) {
    const label = blocked(r).label;
    assert.match(label, /^Chưa hoàn tiền: .+/);
    assert.doesNotMatch(label, /[A-Z]{3,}_[A-Z]/, `code leaked for ${String(r)}`);
  }
});

test('VERIFY5: a plain sentence is kept and the generic fallback is used for a code (the history still keeps the raw reason)', () => {
  assert.equal(blockedReasonText('Gói không hoàn được'), 'Gói không hoàn được');
  assert.equal(blockedReasonText('SOME_UNKNOWN_CODE'), 'đang chờ xử lý');
  assert.equal(blockedReasonText(undefined), 'đang chờ xử lý');
  assert.equal(blockedReasonText('PRIOR_REFUND_SHORTFALL'), 'lần hoàn trước còn khoản chưa trả được, cần đối soát');
});
